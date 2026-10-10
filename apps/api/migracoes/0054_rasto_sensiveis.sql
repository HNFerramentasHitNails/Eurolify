-- O rasto de auditoria comum, passo 3: os dados sensíveis (docs/28 §3.4 e
-- §4; Q1 e Q2 decididas pelo Diogo a 10/10/2026: «aprovado»; issue #322).
-- Ex.: uma pessoa muda o e-mail de um cliente de `ana@exemplo.pt` para
-- `ana.silva@exemplo.pt`. A linha do tempo guardava os dois e-mails em
-- claro; passa a guardar
-- `{"emails": {"antes": {"protegido": true, "resumo": "3f9a…"},
--              "depois": {"protegido": true, "resumo": "b71c…"}}}`:
-- diz que o e-mail mudou e se dois valores eram iguais, nunca qual era.
--
-- O que esta migração faz:
-- - `campo_sensivel`: a lista dos campos sensíveis, por rasto, entidade e
--   campo — uma tabela da base, não uma lista em cada gatilho (§3.4). Começa
--   com a Q1: nos Clientes, o nome, os e-mails e os telefones da ficha, e o
--   nome, o NIF e a morada do perfil de faturação;
-- - `chave_do_rasto`: a chave do resumo, gerada aqui dentro, uma vez, e só
--   legível pelo dono (nunca no repositório nem na API). Vai nas cópias com
--   o resto da base;
-- - `rasto_proteger()`: troca, nos campos sensíveis, cada valor por um
--   marcador `{"protegido": true, "resumo": "<8 hex>"}` (HMAC-SHA-256 com a
--   chave, cortado a 8 hexadecimais). Um valor vazio fica vazio (vê-se que
--   passou a haver, ou a deixar de haver, um e-mail); um marcador ou um
--   «(pseudonimizado)» ficam como estão. A forma `{antes, depois}` mantém-se:
--   o contrato da linha do tempo não muda (`clientes/rotas.ts`, `Alteracao`);
-- - um gatilho antes de cada linha entrar em `alteracao_cliente`;
-- - Q2: os valores pessoais que já estão em claro no rasto dos Clientes
--   passam a marcador, nesta migração revista, com o gatilho «só se
--   acrescenta» desligado só durante o UPDATE (o ensaio não tem dados reais,
--   ADR-0019).
--
-- Não faz:
-- - as Contas de pessoas (e-mail e nome, Q1): o `evento_conta` não guarda
--   valores, só o acto; nada a marcar hoje;
-- - as notas: nenhuma tabela do rasto as guarda hoje;
-- - o `motivo` (texto livre) da linha do tempo na pseudonimização: fica
--   registado no #322.
--
-- Nota (docs/28 §6): para um valor de poucas hipóteses, mesmo com a chave
-- secreta, um resumo igual diz que o valor não mudou; quem tiver a base e a
-- chave pode testar valores. É o compromisso da §3.4.

SET LOCAL lock_timeout = '10s';

CREATE TABLE campo_sensivel (
  rasto text NOT NULL CHECK (rasto IN ('alteracao_cliente')),
  entidade text NOT NULL CHECK (entidade ~ '^[a-z_]{2,40}$'),
  campo text NOT NULL CHECK (campo ~ '^[a-z_0-9]{2,60}$'),
  PRIMARY KEY (rasto, entidade, campo)
);
INSERT INTO campo_sensivel (rasto, entidade, campo) VALUES
  ('alteracao_cliente', 'cliente', 'nome'),
  ('alteracao_cliente', 'cliente', 'emails'),
  ('alteracao_cliente', 'cliente', 'telefones'),
  ('alteracao_cliente', 'perfil_faturacao', 'nome_documento'),
  ('alteracao_cliente', 'perfil_faturacao', 'nif_escrito'),
  ('alteracao_cliente', 'perfil_faturacao', 'nif_numero'),
  ('alteracao_cliente', 'perfil_faturacao', 'morada_linha1'),
  ('alteracao_cliente', 'perfil_faturacao', 'morada_linha2'),
  ('alteracao_cliente', 'perfil_faturacao', 'morada_codigo_postal'),
  ('alteracao_cliente', 'perfil_faturacao', 'morada_localidade');
REVOKE ALL ON campo_sensivel FROM PUBLIC;

-- A chave: 32 bytes de dois uuid aleatórios (244 bits ao acaso), e as duas
-- metades do HMAC (RFC 2104) já calculadas, para cada resumo custar dois
-- sha256 e nada mais.
CREATE TABLE chave_do_rasto (
  unica boolean PRIMARY KEY DEFAULT true CHECK (unica),
  interna bytea NOT NULL CHECK (length(interna) = 64),
  externa bytea NOT NULL CHECK (length(externa) = 64),
  criada_em timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON chave_do_rasto FROM PUBLIC;
DO $$
DECLARE
  -- 32 bytes ao acaso, completados com zeros até aos 64 do bloco do sha256.
  k bytea := decode(replace(gen_random_uuid()::text, '-', '')
    || replace(gen_random_uuid()::text, '-', '') || repeat('00', 32), 'hex');
  interna bytea;
  externa bytea;
  i integer;
BEGIN
  interna := k;
  externa := k;
  FOR i IN 0..63 LOOP
    interna := set_byte(interna, i, get_byte(k, i) # 54);  -- 0x36
    externa := set_byte(externa, i, get_byte(k, i) # 92);  -- 0x5c
  END LOOP;
  INSERT INTO public.chave_do_rasto (interna, externa) VALUES (interna, externa);
END
$$;

CREATE FUNCTION rasto_resumo(p_valor jsonb) RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  -- O texto do jsonb é canónico (chaves por ordem, sem espaços a mais): dois
  -- valores iguais dão o mesmo resumo.
  SELECT left(encode(sha256(c.externa
    || sha256(c.interna || convert_to(p_valor::text, 'UTF8'))), 'hex'), 8)
  FROM public.chave_do_rasto c
$$;
REVOKE EXECUTE ON FUNCTION rasto_resumo(jsonb) FROM PUBLIC;

CREATE FUNCTION rasto_marcador(p_valor jsonb) RETURNS jsonb
  LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT CASE
    WHEN p_valor IS NULL OR jsonb_typeof(p_valor) = 'null' THEN p_valor
    WHEN jsonb_typeof(p_valor) = 'object' AND p_valor ? 'protegido' THEN p_valor
    WHEN p_valor = to_jsonb('(pseudonimizado)'::text) THEN p_valor
    ELSE jsonb_build_object('protegido', true, 'resumo', public.rasto_resumo(p_valor))
  END
$$;
REVOKE EXECUTE ON FUNCTION rasto_marcador(jsonb) FROM PUBLIC;

CREATE FUNCTION rasto_proteger(p_rasto text, p_entidade text, p_campos jsonb)
  RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT coalesce(jsonb_object_agg(e.k, CASE
      WHEN s.campo IS NOT NULL AND jsonb_typeof(e.v) = 'object' THEN
        jsonb_build_object(
          'antes', public.rasto_marcador(e.v -> 'antes'),
          'depois', public.rasto_marcador(e.v -> 'depois'))
      ELSE e.v END), '{}')
  FROM jsonb_each(p_campos) AS e (k, v)
  LEFT JOIN public.campo_sensivel s
    ON s.rasto = p_rasto AND s.entidade = p_entidade AND s.campo = e.k
$$;
REVOKE EXECUTE ON FUNCTION rasto_proteger(text, text, jsonb) FROM PUBLIC;

CREATE FUNCTION rasto_proteger_linha() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  NEW.campos := public.rasto_proteger(TG_TABLE_NAME, NEW.entidade, NEW.campos);
  RETURN NEW;
END
$$;
REVOKE EXECUTE ON FUNCTION rasto_proteger_linha() FROM PUBLIC;

CREATE TRIGGER rasto_proteger BEFORE INSERT ON alteracao_cliente
  FOR EACH ROW EXECUTE FUNCTION rasto_proteger_linha();

-- Q2: o que já está em claro passa a marcador, em todos os comerciantes. O
-- gatilho «só se acrescenta» e o RLS forçado (o dono na VPS não o ignora;
-- como na 0046) desligam-se só para este UPDATE e voltam como estavam.
ALTER TABLE alteracao_cliente DISABLE TRIGGER alteracao_cliente_so_se_acrescenta;
ALTER TABLE alteracao_cliente NO FORCE ROW LEVEL SECURITY;
UPDATE alteracao_cliente a
SET campos = public.rasto_proteger('alteracao_cliente', a.entidade, a.campos)
WHERE a.entidade IN ('cliente', 'perfil_faturacao')
  AND a.campos IS DISTINCT FROM public.rasto_proteger('alteracao_cliente', a.entidade, a.campos);
ALTER TABLE alteracao_cliente FORCE ROW LEVEL SECURITY;
ALTER TABLE alteracao_cliente ENABLE ALWAYS TRIGGER alteracao_cliente_so_se_acrescenta;
