-- Fatia «identidade»: criar e revogar chaves pela API, e a idempotência das
-- escritas (docs/19 §6.1, docs/18 §4; issue #107; Diogo, 06/10/2026: «avança
-- com o POST /keys e a revogação»). Ex.: o software de gestão de um
-- comerciante, com uma chave que tem `keys:write` e `catalog:read`, cria outra
-- só com `catalog:read`; não consegue criar uma com `merchant:write`.
--
-- O que esta migração faz:
-- - duas funções SECURITY DEFINER, as únicas por onde a API escreve chaves:
--   `chave_criar_pela_api` e `chave_revogar_pela_api`. A base recebe o
--   SEGREDO apresentado e calcula ela o resumo (não aceita um id nem um
--   resumo que a aplicação escolhesse: o resumo das chaves do operador
--   passa pelo GitHub; revisão do #118, P2-2) e impõe: chave válida, do
--   comerciante do contexto, com `keys:write`; um comerciante suspenso ou
--   fechado não cria chaves, mas revoga; a nova não tem âmbitos que quem
--   pede não tem (T9); nenhuma revogação deixa o comerciante sem uma
--   chave válida com `keys:write` (T11), com uma tranca por comerciante;
--   o segredo não se guarda nem vai para o registo da base (o PostgreSQL
--   não regista parâmetros por omissão: log_statement = none,
--   log_parameter_max_length_on_error = 0);
-- - a tabela `idempotencia` (docs/18 §4), com RLS forçado por comerciante.
--
-- Só acrescenta: a versão anterior da API (que já abre a base na VPS desde o
-- #116) continua a funcionar sem saber disto (infra/vps/LEIA-ME.md).

SET LOCAL lock_timeout = '10s';

-- A chave que pede, a partir do segredo apresentado (o resumo calcula-se
-- aqui, como em src/identidade/chaves.ts): válida, do comerciante do
-- contexto e com `keys:write`. Sem isso, `auth.forbidden`.
-- Não se dá à API: só as duas funções abaixo a chamam.
CREATE FUNCTION chave_que_pede(p_segredo text) RETURNS public.chave_api
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem public.chave_api;
BEGIN
  SELECT c.* INTO quem FROM public.chave_api c
  WHERE c.resumo = encode(sha256(convert_to(coalesce(p_segredo, ''), 'UTF8')), 'hex')
    AND c.comerciante_id = public.comerciante_actual()
    AND c.revogada_em IS NULL
    AND (c.expira_em IS NULL OR c.expira_em > now());
  IF NOT FOUND OR NOT ('keys:write' = ANY (quem.ambitos)) THEN
    RAISE EXCEPTION 'auth.forbidden: a chave que pede não pode gerir chaves deste comerciante';
  END IF;
  RETURN quem;
END
$$;

-- Criar uma chave no comerciante do contexto, em nome da chave que pede. O
-- segredo nunca chega à base: vem só o resumo e o prefixo da nova.
CREATE FUNCTION chave_criar_pela_api(p_segredo_quem text, p_tipo text,
                                     p_loja_id uuid, p_nome text,
                                     p_ambitos text[], p_prefixo text,
                                     p_resumo text, p_expira_em timestamptz)
  RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem public.chave_api;
  ambitos text[];
  nova uuid;
BEGIN
  -- A mesma tranca da revogação: não se cria em nome de uma chave que está a
  -- ser revogada nesse instante.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('chave_api:' || public.comerciante_actual()::text, 0));
  quem := public.chave_que_pede(p_segredo_quem);
  -- Um comerciante suspenso ou fechado não cria chaves; revogar continua,
  -- para poder fechar acessos (Diogo, 06/10/2026, revisão do #118, P2-3).
  IF (SELECT m.estado FROM public.comerciante m WHERE m.id = quem.comerciante_id)
     IN ('suspenso', 'fechado') THEN
    RAISE EXCEPTION 'key.merchant_inactive: um comerciante suspenso ou fechado não cria chaves; pode revogá-las';
  END IF;
  IF p_expira_em IS NOT NULL AND p_expira_em <= now() THEN
    RAISE EXCEPTION 'key.invalid_expiry: a data de expiração tem de ser no futuro';
  END IF;
  IF p_tipo = 'publica' THEN
    -- A pública tem a lista fixa da Loja, só leitura (docs/19 §6.1): não
    -- se escolhe, e qualquer chave com keys:write a pode criar.
    ambitos := ARRAY['storefront']::text[];
  ELSE
    -- Sem repetidos e por ordem, para a lista guardada ser sempre a mesma.
    SELECT array_agg(DISTINCT a ORDER BY a) INTO ambitos FROM unnest(p_ambitos) AS a;
    -- T9: nada que quem pede não tenha.
    IF ambitos IS NULL OR NOT (ambitos <@ quem.ambitos) THEN
      RAISE EXCEPTION 'key.scope_escalation: uma chave não cria outra com âmbitos que não tem';
    END IF;
  END IF;
  INSERT INTO public.chave_api (comerciante_id, tipo, loja_id, nome, ambitos,
                                prefixo, resumo, criada_por, expira_em)
  VALUES (quem.comerciante_id, p_tipo, p_loja_id, p_nome, ambitos,
          p_prefixo, p_resumo, 'chave:key_' || quem.id::text, p_expira_em)
  RETURNING chave_api.id INTO nova;
  RETURN nova;
END
$$;

-- Revogar uma chave do comerciante do contexto, em nome da chave que pede.
-- A tranca por comerciante põe as revogações em fila: quem pede volta a ser
-- verificado debaixo dela, por isso duas chaves que se revoguem ao mesmo
-- tempo não deixam o comerciante sem nenhuma com keys:write (T11). A regra
-- vale para qualquer revogação de uma chave que gere chaves, não só a
-- própria (revisão do #118, P3-7). O comando do operador (chave_revogar,
-- 0010) pode revogar a última: é a porta de emergência.
CREATE FUNCTION chave_revogar_pela_api(p_segredo_quem text, p_id uuid)
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem public.chave_api;
  alvo public.chave_api;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('chave_api:' || public.comerciante_actual()::text, 0));
  quem := public.chave_que_pede(p_segredo_quem);
  SELECT c.* INTO alvo FROM public.chave_api c
  WHERE c.id = p_id AND c.comerciante_id = quem.comerciante_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'key.not_found: a chave não existe neste comerciante';
  END IF;
  IF alvo.revogada_em IS NOT NULL THEN
    RAISE EXCEPTION 'key.already_revoked: a chave já foi revogada';
  END IF;
  IF 'keys:write' = ANY (alvo.ambitos) AND NOT EXISTS (
       SELECT 1 FROM public.chave_api c
       WHERE c.comerciante_id = quem.comerciante_id
         AND c.id <> alvo.id
         AND c.revogada_em IS NULL
         AND (c.expira_em IS NULL OR c.expira_em > now())
         AND 'keys:write' = ANY (c.ambitos)) THEN
    RAISE EXCEPTION 'key.last_key_writer: é a última chave que gere chaves deste comerciante; crie outra antes de a revogar';
  END IF;
  UPDATE public.chave_api c SET revogada_por = 'chave:key_' || quem.id::text
  WHERE c.id = alvo.id;
END
$$;

REVOKE EXECUTE ON FUNCTION chave_que_pede(text),
  chave_criar_pela_api(text, text, uuid, text, text[], text, text, timestamptz),
  chave_revogar_pela_api(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  chave_criar_pela_api(text, text, uuid, text, text[], text, text, timestamptz),
  chave_revogar_pela_api(text, uuid) TO eurolify_api;

-- Idempotência das escritas (docs/18 §4). Uma linha por (comerciante, chave
-- de idempotência). A aplicação põe `em_curso` numa transacção própria antes
-- da escrita e passa a `concluido` na mesma transacção da escrita; se a
-- escrita falhar, apaga a linha. As datas são da base.
CREATE TABLE idempotencia (
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  -- Caracteres visíveis em ASCII, 1 a 255 (docs/19 §6.1).
  chave text NOT NULL CHECK (chave ~ '^[!-~]{1,255}$'),
  metodo text NOT NULL CHECK (metodo IN ('POST', 'PUT', 'PATCH', 'DELETE')),
  caminho text NOT NULL CHECK (length(caminho) BETWEEN 1 AND 2000),
  resumo_corpo text NOT NULL CHECK (resumo_corpo ~ '^[0-9a-f]{64}$'),
  estado text NOT NULL DEFAULT 'em_curso' CHECK (estado IN ('em_curso', 'concluido')),
  resposta_status integer CHECK (resposta_status BETWEEN 200 AND 299),
  resposta_corpo jsonb,
  criado_em timestamptz NOT NULL DEFAULT now(),
  expira_em timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  PRIMARY KEY (comerciante_id, chave),
  CONSTRAINT idempotencia_resposta_so_concluida CHECK (
    (estado = 'concluido') = (resposta_status IS NOT NULL AND resposta_corpo IS NOT NULL))
);

CREATE INDEX idempotencia_por_expiracao ON idempotencia (expira_em);

ALTER TABLE idempotencia ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotencia FORCE ROW LEVEL SECURITY;
CREATE POLICY so_o_proprio ON idempotencia
  USING (comerciante_id = comerciante_actual())
  WITH CHECK (comerciante_id = comerciante_actual());

-- A API escolhe a chave, o pedido e a resposta; as datas e o estado inicial
-- são da base. Apaga a sua linha quando a escrita falha, ou uma expirada.
REVOKE ALL ON idempotencia FROM PUBLIC;
GRANT SELECT, DELETE ON idempotencia TO eurolify_api;
GRANT INSERT (comerciante_id, chave, metodo, caminho, resumo_corpo)
  ON idempotencia TO eurolify_api;
GRANT UPDATE (estado, resposta_status, resposta_corpo) ON idempotencia TO eurolify_api;
