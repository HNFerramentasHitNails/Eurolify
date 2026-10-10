-- Clientes, parte 2b: duplicados e fusões (docs/23 §3.7; issue #233; Diogo,
-- 10/10/2026: «sim, avança com a parte 2b» e, sobre os perfis, «sim, copiar
-- (A)»). Ex.: a ficha «Ana Silva» (ana@exemplo.pt) e a ficha «A. Silva»
-- (ANA@exemplo.pt) ficam na fila como talvez a mesma pessoa (o e-mail); uma
-- pessoa funde a segunda na primeira: a segunda fica `fundido`, só de
-- leitura, com as encomendas dela; a primeira recebe o e-mail, os telefones,
-- as etiquetas e uma cópia de cada perfil activo.
--
-- O que esta migração faz:
-- - a fila de candidatos (`duplicado_cliente`, `dup_`): o servidor sinaliza,
--   nunca funde (R10). Os sinais: o mesmo NIF em perfis **particulares**
--   (forte); o mesmo e-mail (sem diferença de maiúsculas) ou telefone
--   (talvez). O NIF de um perfil empresa não é sinal (Q2) e o nome nunca é;
-- - descartar um candidato (`duplicado_descartar`), só por uma pessoa ou a
--   chave dela; um sinal novo no mesmo par volta a pô-lo por decidir;
-- - a fusão (`cliente_fundir`), só por uma pessoa ou a chave dela, com ensaio:
--   - a ficha absorvida fica `fundido`, com `fundido_em`, e não se apaga;
--   - os perfis **copiam-se** (Diogo, 10/10/2026, opção A): um perfil nunca
--     muda de ficha (0037) e cada encomenda está presa ao par ficha e perfil
--     (0041). A cópia diz de onde veio (`copiado_de`) e volta ao VIES; uma
--     cópia igual a um perfil activo da ficha que fica não se faz. A isenção
--     manual não se copia: uma pessoa volta a pô-la (eu-vat-oss-ioss,
--     regra 4); a fusão diz quais;
--   - os e-mails e os telefones da absorvida acrescentam-se, guardados e não
--     perdidos (eu-gdpr-privacy); se passarem de 10, a fusão é recusada;
--   - as etiquetas activas copiam-se; a limitação de uma passa à que fica;
--   - os consentimentos não se movem (não se alteram, 0042): a régua da
--     ficha que fica conta também os das fichas fundidas nela, e uma
--     declaração pedida com o id antigo regista-se na ficha que ficou
--     (revisão do #289, P2-4: retirar tão fácil como dar);
--   - as encomendas ficam na ficha absorvida, como estavam;
-- - a chave estrangeira de `fundido_em` (adiada na 0037, P3-10);
-- - o evento `customer.merged` (§6), só com identificadores;
-- - o âmbito `customers:merge` (§7), no dono e no gestor.
--
-- O que não faz: desfazer uma fusão (§3.7, Fase 1 sem desfazer); o MCP
-- (`eurolify_duplicados`, §7.3), que entra com as ferramentas de Clientes;
-- os pedidos do titular (parte 2c).

SET LOCAL lock_timeout = '10s';

-- ----------------------------------------------------- Ficha fundida

-- A validação das chaves estrangeiras lê as tabelas: sem o RLS forçado
-- enquanto valida (como a 0037 com as listas de preços).
ALTER TABLE cliente NO FORCE ROW LEVEL SECURITY;
ALTER TABLE cliente ADD CONSTRAINT cliente_fundida_em
  FOREIGN KEY (comerciante_id, fundido_em) REFERENCES cliente (comerciante_id, id);
ALTER TABLE cliente FORCE ROW LEVEL SECURITY;
CREATE INDEX cliente_por_fundido_em ON cliente (comerciante_id, fundido_em)
  WHERE fundido_em IS NOT NULL;

-- A ficha e todas as que foram fundidas nela, directa ou indirectamente (A
-- fundida em B, B fundida em C: o grupo de C tem A, B e C). Sem ciclos: só
-- se funde numa ficha activa, e uma fundida nunca volta a estar activa.
CREATE FUNCTION clientes_do_grupo(p_cliente uuid) RETURNS SETOF uuid
  LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  WITH RECURSIVE grupo (id, comerciante_id) AS (
    SELECT f.id, f.comerciante_id FROM public.cliente f WHERE f.id = p_cliente
    UNION
    SELECT c.id, c.comerciante_id FROM public.cliente c
    JOIN grupo g ON c.comerciante_id = g.comerciante_id AND c.fundido_em = g.id)
  SELECT id FROM grupo
$$;

-- -------------------------------------------- Perfis copiados numa fusão

-- O perfil de onde veio a cópia; só a fusão o põe (a API não tem o
-- privilégio).
ALTER TABLE perfil_faturacao ADD COLUMN copiado_de uuid;
ALTER TABLE perfil_faturacao NO FORCE ROW LEVEL SECURITY;
ALTER TABLE perfil_faturacao ADD CONSTRAINT perfil_copiado_de
  FOREIGN KEY (comerciante_id, copiado_de) REFERENCES perfil_faturacao (comerciante_id, id);
ALTER TABLE perfil_faturacao FORCE ROW LEVEL SECURITY;

-- --------------------------------------- Consentimentos de fichas fundidas

-- Uma declaração pedida numa ficha fundida segue `fundido_em` até à ficha
-- activa e regista-se lá; a hora fica depois da última do grupo.
CREATE OR REPLACE FUNCTION consentimento_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem text := nullif(btrim(current_setting('eurolify.quem', true)), '');
  ficha record;
  passos integer := 0;
BEGIN
  IF quem IS NULL THEN
    RAISE EXCEPTION 'customers.change_without_who: um consentimento sem eurolify.quem';
  END IF;
  -- Toma a ficha até ao fim da transacção: duas declarações da mesma ficha
  -- entram uma de cada vez, e a hora (abaixo) segue a ordem em que entram.
  LOOP
    SELECT c.estado, c.fundido_em INTO ficha FROM public.cliente c
    WHERE c.comerciante_id = NEW.comerciante_id AND c.id = NEW.cliente_id
    FOR NO KEY UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'customers.not_found: a ficha não existe';
    END IF;
    EXIT WHEN ficha.estado <> 'fundido';
    passos := passos + 1;
    IF passos > 100 THEN
      RAISE EXCEPTION 'customers.invalid_transition: fusões encadeadas demais';
    END IF;
    NEW.cliente_id := ficha.fundido_em;
  END LOOP;
  IF ficha.estado <> 'activo' THEN
    RAISE EXCEPTION 'customers.invalid_transition: a ficha está %', ficha.estado;
  END IF;
  -- A hora do relógio, depois de tomada a ficha, e sempre depois da última
  -- do grupo (revisão do #289, P2-1).
  NEW.declarado_em := greatest(clock_timestamp(), (
    SELECT max(c.declarado_em) + interval '1 microsecond'
    FROM public.consentimento c
    WHERE c.comerciante_id = NEW.comerciante_id
      AND c.cliente_id IN (SELECT public.clientes_do_grupo(NEW.cliente_id))));
  NEW.quem := quem;
  RETURN NEW;
END
$$;

-- A régua sobre um conjunto de fichas (as de um grupo): só declarações
-- explícitas, vale a hora mais recente, empate ⇒ não, sem nenhuma ⇒ não. É a
-- única que conta declarações: a `pode_receber_marketing` e o ensaio da fusão
-- (o «depois») chamam-na (R6).
CREATE FUNCTION regua_marketing(p_comerciante uuid, p_clientes uuid[], p_canal text)
  RETURNS boolean
  LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT coalesce((
    SELECT bool_and(c.declaracao = 'aceitou')
    FROM public.consentimento c
    WHERE c.comerciante_id = p_comerciante AND c.cliente_id = ANY (p_clientes)
      AND c.canal = p_canal AND c.finalidade = 'marketing'
      AND c.declarado_em = (
        SELECT max(d.declarado_em) FROM public.consentimento d
        WHERE d.comerciante_id = p_comerciante AND d.cliente_id = ANY (p_clientes)
          AND d.canal = p_canal AND d.finalidade = 'marketing')), false)
$$;

-- A régua de uma ficha conta as declarações do grupo (as dela e as das
-- fundidas nela). O grupo calcula-se uma vez, não por linha (revisão do #298,
-- P2-3).
CREATE OR REPLACE FUNCTION pode_receber_marketing(p_cliente uuid, p_canal text) RETURNS boolean
  LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT coalesce((
    SELECT public.regua_marketing(f.comerciante_id,
      ARRAY(SELECT public.clientes_do_grupo(f.id)), p_canal)
    FROM public.cliente f
    WHERE f.id = p_cliente AND f.estado = 'activo' AND NOT f.limitado), false)
$$;

-- ------------------------------------------------- A fila de candidatos

-- Os e-mails como se comparam: sem espaços nas pontas e em minúsculas.
CREATE FUNCTION emails_para_comparar(p text[]) RETURNS text[]
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT coalesce(array_agg(lower(btrim(e)) ORDER BY lower(btrim(e))), '{}') FROM unnest(p) e
$$;
CREATE INDEX cliente_por_email ON cliente USING gin (emails_para_comparar(emails));
CREATE INDEX cliente_por_telefone ON cliente USING gin (telefones);

CREATE TABLE duplicado_cliente (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  -- O par, sempre pela mesma ordem (a < b): um par, uma linha.
  cliente_a uuid NOT NULL,
  cliente_b uuid NOT NULL,
  -- Só o tipo do sinal, nunca o valor (R12).
  sinais text[] NOT NULL CHECK (cardinality(sinais) > 0
    AND sinais <@ ARRAY['nif_particular', 'email', 'telefone']),
  forte boolean GENERATED ALWAYS AS ('nif_particular' = ANY (sinais)) STORED,
  estado text NOT NULL DEFAULT 'por_decidir'
    CHECK (estado IN ('por_decidir', 'descartado', 'fundido', 'fechado')),
  motivo text CHECK (motivo IS NULL OR length(btrim(motivo)) BETWEEN 1 AND 500),
  decidido_por text,
  decidido_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  actualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT duplicado_par_ordenado CHECK (cliente_a < cliente_b),
  CONSTRAINT duplicado_decidido_inteiro CHECK (
    (estado = 'por_decidir') = (decidido_por IS NULL)
    AND (decidido_por IS NULL) = (decidido_em IS NULL)),
  UNIQUE (comerciante_id, cliente_a, cliente_b),
  FOREIGN KEY (comerciante_id, cliente_a) REFERENCES cliente (comerciante_id, id),
  FOREIGN KEY (comerciante_id, cliente_b) REFERENCES cliente (comerciante_id, id)
);
CREATE INDEX duplicado_por_estado ON duplicado_cliente (comerciante_id, estado, id);
CREATE INDEX duplicado_por_cliente_b ON duplicado_cliente (comerciante_id, cliente_b);

-- Procura os candidatos de uma ficha activa e põe-nos na fila. Corre com os
-- direitos do dono (a API não escreve na fila), filtrando pelo comerciante da
-- ficha.
CREATE FUNCTION duplicados_sinalizar(p_cliente uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  ficha record;
BEGIN
  SELECT f.id, f.comerciante_id, f.estado, f.emails, f.telefones INTO ficha
  FROM public.cliente f WHERE f.id = p_cliente;
  IF NOT FOUND OR ficha.estado <> 'activo' THEN
    RETURN;
  END IF;
  INSERT INTO public.duplicado_cliente AS d (comerciante_id, cliente_a, cliente_b, sinais)
  SELECT ficha.comerciante_id, least(ficha.id, x.outra), greatest(ficha.id, x.outra),
         array_agg(DISTINCT x.sinal ORDER BY x.sinal)
  FROM (
    SELECT c.id AS outra, 'email' AS sinal FROM public.cliente c
    WHERE c.comerciante_id = ficha.comerciante_id AND c.id <> ficha.id
      AND c.estado = 'activo'
      AND public.emails_para_comparar(c.emails) && public.emails_para_comparar(ficha.emails)
    UNION ALL
    SELECT c.id, 'telefone' FROM public.cliente c
    WHERE c.comerciante_id = ficha.comerciante_id AND c.id <> ficha.id
      AND c.estado = 'activo' AND c.telefones && ficha.telefones
    UNION ALL
    -- O mesmo NIF só em perfis particulares (Q2: numa empresa podem ser dois
    -- funcionários).
    SELECT p2.cliente_id, 'nif_particular'
    FROM public.perfil_faturacao p1
    JOIN public.perfil_faturacao p2
      ON p2.comerciante_id = p1.comerciante_id AND p2.nif_numero = p1.nif_numero
      AND p2.pais_contribuinte = p1.pais_contribuinte AND p2.cliente_id <> p1.cliente_id
    JOIN public.cliente c ON c.comerciante_id = p2.comerciante_id AND c.id = p2.cliente_id
    WHERE p1.comerciante_id = ficha.comerciante_id AND p1.cliente_id = ficha.id
      AND p1.tipo = 'particular' AND p2.tipo = 'particular'
      AND p1.nif_numero IS NOT NULL AND c.estado = 'activo'
  ) x
  GROUP BY x.outra
  ON CONFLICT (comerciante_id, cliente_a, cliente_b) DO UPDATE
  SET sinais = (SELECT array_agg(DISTINCT s ORDER BY s)
                FROM unnest(d.sinais || EXCLUDED.sinais) s),
      -- Um sinal novo num par descartado volta a pô-lo por decidir.
      estado = 'por_decidir', motivo = NULL, decidido_por = NULL, decidido_em = NULL,
      actualizado_em = now()
  WHERE d.estado IN ('por_decidir', 'descartado') AND NOT (EXCLUDED.sinais <@ d.sinais);
END
$$;

CREATE FUNCTION cliente_sinalizar_duplicados() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME = 'cliente' THEN
    IF TG_OP = 'INSERT' OR NEW.emails IS DISTINCT FROM OLD.emails
       OR NEW.telefones IS DISTINCT FROM OLD.telefones THEN
      PERFORM public.duplicados_sinalizar(NEW.id);
    END IF;
  ELSIF TG_OP = 'INSERT' OR NEW.tipo <> OLD.tipo
     OR NEW.nif_numero IS DISTINCT FROM OLD.nif_numero
     OR NEW.pais_contribuinte IS DISTINCT FROM OLD.pais_contribuinte THEN
    PERFORM public.duplicados_sinalizar(NEW.cliente_id);
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER cliente_sinalizar_duplicados
  AFTER INSERT OR UPDATE ON cliente
  FOR EACH ROW EXECUTE FUNCTION cliente_sinalizar_duplicados();
CREATE TRIGGER perfil_sinalizar_duplicados
  AFTER INSERT OR UPDATE ON perfil_faturacao
  FOR EACH ROW EXECUTE FUNCTION cliente_sinalizar_duplicados();

-- As fichas que já existem entram na fila uma vez.
DO $$
DECLARE
  f uuid;
BEGIN
  PERFORM set_config('eurolify.quem', 'sistema:migracao_0045', true);
  ALTER TABLE cliente NO FORCE ROW LEVEL SECURITY;
  ALTER TABLE perfil_faturacao NO FORCE ROW LEVEL SECURITY;
  FOR f IN SELECT id FROM public.cliente WHERE estado = 'activo' ORDER BY id LOOP
    PERFORM public.duplicados_sinalizar(f);
  END LOOP;
  ALTER TABLE cliente FORCE ROW LEVEL SECURITY;
  ALTER TABLE perfil_faturacao FORCE ROW LEVEL SECURITY;
END
$$;

-- Só uma pessoa (pelo Hub) ou a chave que ela usa decide um candidato ou
-- funde: nunca um processo de sistema nem uma IA sem chave (R10).
CREATE FUNCTION clientes_quem_decide() RETURNS text
  LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem text := nullif(btrim(current_setting('eurolify.quem', true)), '');
BEGIN
  IF quem IS NULL OR quem !~ '^(pessoa:per_|chave:key_)' THEN
    RAISE EXCEPTION 'customers.merge_by_person: só uma pessoa decide uma fusão ou um candidato (quem: %)',
      coalesce(quem, 'nenhum');
  END IF;
  RETURN quem;
END
$$;

CREATE FUNCTION duplicado_descartar(p_duplicado uuid, p_motivo text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem text := public.clientes_quem_decide();
  d record;
BEGIN
  SELECT x.estado INTO d FROM public.duplicado_cliente x
  WHERE x.comerciante_id = public.comerciante_actual() AND x.id = p_duplicado
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'customers.not_found: o candidato não existe';
  END IF;
  IF d.estado <> 'por_decidir' THEN
    RAISE EXCEPTION 'customers.duplicate_decided: o candidato já está %', d.estado;
  END IF;
  UPDATE public.duplicado_cliente
  SET estado = 'descartado', motivo = nullif(btrim(p_motivo), ''),
      decidido_por = quem, decidido_em = now(), actualizado_em = now()
  WHERE id = p_duplicado;
END
$$;

-- ------------------------------------------------------------- A fusão

CREATE FUNCTION cliente_fundir(p_fica uuid, p_absorve uuid, p_ensaio boolean) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  comerciante uuid := public.comerciante_actual();
  quem text := public.clientes_quem_decide();
  fica record;
  absorve record;
  emails_novos text[];
  telefones_novos text[];
  p record;
  copias jsonb := '[]';
  iguais jsonb := '[]';
  isencoes jsonb;
  etiquetas_copiar uuid[];
  etiquetas_arquivadas uuid[];
  novo uuid;
  marketing_antes jsonb;
  plano jsonb;
BEGIN
  IF p_fica = p_absorve THEN
    RAISE EXCEPTION 'customers.merge_same: uma ficha não se funde nela própria';
  END IF;
  -- As duas fichas tomadas pela mesma ordem (sem interbloqueios entre duas
  -- fusões ao contrário).
  PERFORM 1 FROM public.cliente c
  WHERE c.comerciante_id = comerciante AND c.id IN (p_fica, p_absorve)
  ORDER BY c.id FOR UPDATE;
  SELECT * INTO fica FROM public.cliente c
  WHERE c.comerciante_id = comerciante AND c.id = p_fica;
  SELECT * INTO absorve FROM public.cliente c
  WHERE c.comerciante_id = comerciante AND c.id = p_absorve;
  IF fica.id IS NULL OR absorve.id IS NULL THEN
    RAISE EXCEPTION 'customers.not_found: a ficha não existe';
  END IF;
  IF fica.estado <> 'activo' OR absorve.estado <> 'activo' THEN
    RAISE EXCEPTION 'customers.invalid_transition: só se fundem fichas activas';
  END IF;

  -- Os contactos da absorvida que a que fica ainda não tem, pela ordem dela.
  SELECT coalesce(array_agg(e ORDER BY n), '{}') INTO emails_novos
  FROM unnest(absorve.emails) WITH ORDINALITY AS u (e, n)
  WHERE lower(btrim(e)) <> ALL (public.emails_para_comparar(fica.emails));
  SELECT coalesce(array_agg(t ORDER BY n), '{}') INTO telefones_novos
  FROM unnest(absorve.telefones) WITH ORDINALITY AS u (t, n)
  WHERE t <> ALL (fica.telefones);
  IF cardinality(fica.emails) + cardinality(emails_novos) > 10
     OR cardinality(fica.telefones) + cardinality(telefones_novos) > 10 THEN
    RAISE EXCEPTION 'customers.merge_too_many_contacts: juntas, as fichas passavam de 10 e-mails ou 10 telefones; tire os que já não servem antes de fundir';
  END IF;

  -- A régua da ficha que fica antes da fusão (a de depois calcula-se no plano).
  SELECT jsonb_object_agg(k, public.pode_receber_marketing(p_fica, k)) INTO marketing_antes
  FROM unnest(ARRAY['email', 'sms', 'whatsapp']) k;

  -- A absorvida fica fundida antes de tudo o resto: a procura de candidatos
  -- que as cópias e os contactos novos disparam já não a encontra.
  IF NOT p_ensaio THEN
    UPDATE public.cliente SET estado = 'fundido', fundido_em = p_fica WHERE id = p_absorve;
  END IF;

  -- Os perfis activos da absorvida: copia-se cada um, salvo se a que fica já
  -- tem um activo igual.
  -- O principal da absorvida primeiro: se a que fica não tem perfis, a cópia
  -- dele é que fica principal (revisão do #298, P3-6).
  FOR p IN SELECT * FROM public.perfil_faturacao x
    WHERE x.comerciante_id = comerciante AND x.cliente_id = p_absorve AND x.estado = 'activo'
    ORDER BY x.principal DESC, x.id LOOP
    IF EXISTS (
      SELECT FROM public.perfil_faturacao y
      WHERE y.comerciante_id = comerciante AND y.cliente_id = p_fica AND y.estado = 'activo'
        AND y.tipo = p.tipo AND y.nome_documento = p.nome_documento
        AND y.nif_numero IS NOT DISTINCT FROM p.nif_numero
        AND y.pais_contribuinte IS NOT DISTINCT FROM p.pais_contribuinte
        AND y.morada_linha1 IS NOT DISTINCT FROM p.morada_linha1
        AND y.morada_linha2 IS NOT DISTINCT FROM p.morada_linha2
        AND y.morada_codigo_postal IS NOT DISTINCT FROM p.morada_codigo_postal
        AND y.morada_localidade IS NOT DISTINCT FROM p.morada_localidade
        AND y.morada_pais IS NOT DISTINCT FROM p.morada_pais) THEN
      iguais := iguais || to_jsonb(p.id);
      CONTINUE;
    END IF;
    novo := NULL;
    IF NOT p_ensaio THEN
      INSERT INTO public.perfil_faturacao (comerciante_id, cliente_id, tipo, nome_documento,
        nif_escrito, pais_contribuinte, morada_linha1, morada_linha2, morada_codigo_postal,
        morada_localidade, morada_pais, copiado_de)
      VALUES (comerciante, p_fica, p.tipo, p.nome_documento, p.nif_escrito,
        p.pais_contribuinte, p.morada_linha1, p.morada_linha2, p.morada_codigo_postal,
        p.morada_localidade, p.morada_pais, p.id)
      RETURNING id INTO novo;
    END IF;
    copias := copias || jsonb_build_object('de', p.id, 'para', novo);
  END LOOP;

  -- As isenções manuais em vigor na absorvida: não se copiam (uma pessoa
  -- volta a pô-las).
  SELECT coalesce(jsonb_agg(i.perfil_id ORDER BY i.perfil_id), '[]') INTO isencoes
  FROM public.isencao_manual i
  JOIN public.perfil_faturacao x ON x.comerciante_id = i.comerciante_id AND x.id = i.perfil_id
  WHERE i.comerciante_id = comerciante AND x.cliente_id = p_absorve
    AND i.retirada_em IS NULL;

  SELECT coalesce(array_agg(ce.etiqueta_id ORDER BY ce.etiqueta_id)
           FILTER (WHERE e.estado = 'activa'), '{}'),
         coalesce(array_agg(ce.etiqueta_id ORDER BY ce.etiqueta_id)
           FILTER (WHERE e.estado <> 'activa'), '{}')
    INTO etiquetas_copiar, etiquetas_arquivadas
  FROM public.cliente_etiqueta ce
  JOIN public.etiqueta_cliente e ON e.comerciante_id = ce.comerciante_id AND e.id = ce.etiqueta_id
  WHERE ce.comerciante_id = comerciante AND ce.cliente_id = p_absorve
    AND NOT EXISTS (SELECT FROM public.cliente_etiqueta y
      WHERE y.comerciante_id = comerciante AND y.cliente_id = p_fica
        AND y.etiqueta_id = ce.etiqueta_id);

  plano := jsonb_build_object(
    'ensaio', p_ensaio,
    'fica', p_fica,
    'absorvida', p_absorve,
    'emails_acrescentados', to_jsonb(emails_novos),
    'telefones_acrescentados', to_jsonb(telefones_novos),
    'perfis_copiados', copias,
    'perfis_iguais_nao_copiados', iguais,
    'isencoes_por_repor', isencoes,
    'etiquetas_copiadas', to_jsonb(etiquetas_copiar),
    'etiquetas_arquivadas_nao_copiadas', to_jsonb(etiquetas_arquivadas),
    'consentimentos_da_absorvida', (
      SELECT count(*) FROM public.consentimento c
      WHERE c.comerciante_id = comerciante
        AND c.cliente_id IN (SELECT public.clientes_do_grupo(p_absorve))),
    'encomendas_ficam_na_absorvida', (
      SELECT count(*) FROM public.encomenda o
      WHERE o.comerciante_id = comerciante AND o.cliente_id = p_absorve),
    'limitado', fica.limitado OR absorve.limitado,
    -- O que a régua do marketing dá na ficha que fica, antes e depois: o
    -- consentimento passa a cobrir os contactos acrescentados (revisão do
    -- #298, P2-1; docs/23 §3.7, C).
    'marketing_antes', marketing_antes,
    'marketing_depois', (
      SELECT jsonb_object_agg(k, NOT (fica.limitado OR absorve.limitado)
        AND public.regua_marketing(comerciante,
          ARRAY(SELECT public.clientes_do_grupo(p_fica)
                UNION SELECT public.clientes_do_grupo(p_absorve)), k))
      FROM unnest(ARRAY['email', 'sms', 'whatsapp']) k));
  IF p_ensaio THEN
    RETURN plano;
  END IF;

  INSERT INTO public.cliente_etiqueta (comerciante_id, cliente_id, etiqueta_id)
  SELECT comerciante, p_fica, unnest(etiquetas_copiar);
  UPDATE public.cliente
  SET emails = fica.emails || emails_novos, telefones = fica.telefones || telefones_novos,
      limitado = fica.limitado OR absorve.limitado
  WHERE id = p_fica;
  -- Os perfis da absorvida saem da fila do VIES (a consulta já os ignorava;
  -- revisão do #298, P3-2); as cópias entram pela delas.
  DELETE FROM public.vies_fila v
  USING public.perfil_faturacao x
  WHERE x.comerciante_id = comerciante AND x.cliente_id = p_absorve AND v.perfil_id = x.id;
  UPDATE public.duplicado_cliente
  SET estado = CASE WHEN cliente_a = least(p_fica, p_absorve)
                     AND cliente_b = greatest(p_fica, p_absorve) THEN 'fundido' ELSE 'fechado' END,
      motivo = CASE WHEN cliente_a = least(p_fica, p_absorve)
                     AND cliente_b = greatest(p_fica, p_absorve) THEN motivo
                    ELSE 'uma das fichas foi fundida noutra' END,
      decidido_por = quem, decidido_em = now(), actualizado_em = now()
  WHERE comerciante_id = comerciante AND estado IN ('por_decidir', 'descartado')
    AND (cliente_a = p_absorve OR cliente_b = p_absorve);
  INSERT INTO public.evento_saida (comerciante_id, tipo, agregado_tipo, agregado_id, dados)
  VALUES (comerciante, 'customer.merged', 'cliente', p_fica,
    jsonb_build_object('cliente_id', p_fica, 'absorvido_id', p_absorve, 'quem', quem,
      'em', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
  RETURN plano;
END
$$;

-- ------------------------------------------- A ficha fundida, só de leitura

-- Uma isenção nova, tirar uma etiqueta ou pedir o VIES numa ficha que não
-- está activa: recusado (revisão do #298, P2-2). Quem segue a lista
-- `isencoes_por_repor` de uma fusão põe a isenção na cópia, não no perfil
-- antigo.
CREATE FUNCTION isencao_so_em_ficha_activa() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  estado_da_ficha text;
BEGIN
  SELECT c.estado INTO estado_da_ficha
  FROM public.perfil_faturacao p
  JOIN public.cliente c ON c.comerciante_id = p.comerciante_id AND c.id = p.cliente_id
  WHERE p.comerciante_id = NEW.comerciante_id AND p.id = NEW.perfil_id;
  IF estado_da_ficha IS DISTINCT FROM 'activo' AND estado_da_ficha IS NOT NULL THEN
    RAISE EXCEPTION 'customers.invalid_transition: a ficha do perfil está %; ponha a isenção na cópia do perfil', estado_da_ficha;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER isencao_so_em_ficha_activa
  BEFORE INSERT ON isencao_manual
  FOR EACH ROW EXECUTE FUNCTION isencao_so_em_ficha_activa();
ALTER TABLE isencao_manual ENABLE ALWAYS TRIGGER isencao_so_em_ficha_activa;

CREATE FUNCTION cliente_etiqueta_antes_de_tirar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  estado_da_ficha text;
BEGIN
  SELECT c.estado INTO estado_da_ficha FROM public.cliente c
  WHERE c.comerciante_id = OLD.comerciante_id AND c.id = OLD.cliente_id;
  IF estado_da_ficha <> 'activo' THEN
    RAISE EXCEPTION 'customers.invalid_transition: a ficha está %', estado_da_ficha;
  END IF;
  RETURN OLD;
END
$$;
CREATE TRIGGER cliente_etiqueta_antes_de_tirar
  BEFORE DELETE ON cliente_etiqueta
  FOR EACH ROW EXECUTE FUNCTION cliente_etiqueta_antes_de_tirar();

CREATE OR REPLACE FUNCTION vies_pedir(p_perfil uuid) RETURNS timestamptz
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  perfil record;
BEGIN
  SELECT p.comerciante_id, p.estado, p.estado_vies, p.nif_numero, c.estado AS estado_da_ficha
    INTO perfil
  FROM public.perfil_faturacao p
  JOIN public.cliente c ON c.comerciante_id = p.comerciante_id AND c.id = p.cliente_id
  WHERE p.id = p_perfil;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'customers.not_found: o perfil não existe';
  END IF;
  IF perfil.estado_da_ficha <> 'activo' THEN
    RAISE EXCEPTION 'customers.invalid_transition: a ficha do perfil está %', perfil.estado_da_ficha;
  END IF;
  IF perfil.estado <> 'activo' OR perfil.estado_vies = 'nao_aplicavel' OR perfil.nif_numero IS NULL THEN
    RAISE EXCEPTION 'customers.vies_not_applicable: o VIES só se consulta num perfil activo com NIF de outro país da UE';
  END IF;
  INSERT INTO public.vies_fila (perfil_id, comerciante_id, proxima_em, tentativas, motivo)
  VALUES (p_perfil, perfil.comerciante_id, now(), 0, 'pedido')
  ON CONFLICT (perfil_id) DO UPDATE SET proxima_em = now(), tentativas = 0, motivo = 'pedido';
  RETURN now();
END
$$;

-- ---------------------------------------------------------------- Rasto

-- As decisões sobre um candidato entram na linha do tempo da ficha `a`.
ALTER TABLE alteracao_cliente DROP CONSTRAINT alteracao_cliente_entidade_check;
ALTER TABLE alteracao_cliente ADD CONSTRAINT alteracao_cliente_entidade_check
  CHECK (entidade IN ('cliente', 'perfil_faturacao', 'etiqueta_cliente',
    'cliente_etiqueta', 'consentimento', 'duplicado_cliente'));

CREATE OR REPLACE FUNCTION clientes_escrever_alteracao() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem text := nullif(btrim(current_setting('eurolify.quem', true)), '');
  origem text := nullif(btrim(current_setting('eurolify.origem', true)), '');
  linha jsonb := CASE TG_OP WHEN 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  campos jsonb;
  transacao uuid;
BEGIN
  campos := public.clientes_campos_mudados(TG_OP,
    CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END);
  IF campos = '{}' THEN
    RETURN NULL;
  END IF;
  IF quem IS NULL THEN
    RAISE EXCEPTION 'customers.change_without_who: % em % sem eurolify.quem', TG_OP, TG_TABLE_NAME;
  END IF;
  transacao := nullif(current_setting('eurolify.transacao_rasto', true), '')::uuid;
  IF transacao IS NULL THEN
    transacao := uuidv7();
    PERFORM set_config('eurolify.transacao_rasto', transacao::text, true);
  END IF;
  INSERT INTO public.alteracao_cliente (comerciante_id, cliente_id, entidade,
    entidade_id, operacao, campos, quem, origem, transacao)
  VALUES ((linha ->> 'comerciante_id')::uuid,
    CASE TG_TABLE_NAME
      WHEN 'cliente' THEN (linha ->> 'id')::uuid
      WHEN 'etiqueta_cliente' THEN NULL
      WHEN 'duplicado_cliente' THEN (linha ->> 'cliente_a')::uuid
      ELSE (linha ->> 'cliente_id')::uuid
    END,
    TG_TABLE_NAME,
    CASE TG_TABLE_NAME WHEN 'cliente_etiqueta' THEN NULL ELSE (linha ->> 'id')::uuid END,
    CASE TG_OP WHEN 'INSERT' THEN 'criado' WHEN 'UPDATE' THEN 'alterado' ELSE 'apagado' END,
    campos, quem, origem, transacao);
  RETURN NULL;
END
$$;
CREATE TRIGGER duplicado_cliente_rasto
  AFTER UPDATE ON duplicado_cliente
  FOR EACH ROW EXECUTE FUNCTION clientes_escrever_alteracao();
ALTER TABLE duplicado_cliente ENABLE ALWAYS TRIGGER duplicado_cliente_rasto;

-- ----------------------------------------------------- RLS e permissões

ALTER TABLE duplicado_cliente ENABLE ROW LEVEL SECURITY;
ALTER TABLE duplicado_cliente FORCE ROW LEVEL SECURITY;
CREATE POLICY so_o_proprio ON duplicado_cliente
  USING (comerciante_id = comerciante_actual())
  WITH CHECK (comerciante_id = comerciante_actual());
-- A API só lê a fila; escrevem-na as funções do dono.
GRANT SELECT ON duplicado_cliente TO eurolify_api;

REVOKE EXECUTE ON FUNCTION regua_marketing(uuid, uuid[], text),
  isencao_so_em_ficha_activa(), cliente_etiqueta_antes_de_tirar() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION regua_marketing(uuid, uuid[], text) TO eurolify_api;
REVOKE EXECUTE ON FUNCTION clientes_do_grupo(uuid), emails_para_comparar(text[]),
  duplicados_sinalizar(uuid), cliente_sinalizar_duplicados(), clientes_quem_decide(),
  duplicado_descartar(uuid, text), cliente_fundir(uuid, uuid, boolean) FROM PUBLIC;
-- A régua, o gatilho do consentimento e o índice correm com quem pergunta ou
-- escreve; o gatilho dos candidatos chama a função do dono.
GRANT EXECUTE ON FUNCTION clientes_do_grupo(uuid), emails_para_comparar(text[]),
  duplicados_sinalizar(uuid), duplicado_descartar(uuid, text),
  cliente_fundir(uuid, uuid, boolean) TO eurolify_api;

-- ------------------------------------------------------------- O âmbito

ALTER TABLE chave_api DROP CONSTRAINT chave_api_ambitos_validos;
ALTER TABLE chave_api ADD CONSTRAINT chave_api_ambitos_validos CHECK (
  cardinality(ambitos) BETWEEN 1 AND 30
  AND ambitos <@ ARRAY[
    'merchant:read', 'merchant:write',
    'catalog:read', 'catalog:write', 'catalog:publish', 'catalog:import',
    'catalog:history', 'prices:read', 'prices:write',
    'customers:read', 'customers:write', 'customers:billing',
    'customers:exemptions', 'customers:merge', 'tax:read', 'tax:write',
    'legal:read', 'legal:write', 'shipping:read', 'shipping:write', 'orders:read',
    'payments:read', 'payments:write', 'payments:accounts', 'payments:resolve',
    'keys:write', 'storefront'
  ]::text[]);

-- Como a 0044, mais o customers:merge no dono e no gestor.
CREATE OR REPLACE FUNCTION papel_ambitos(p_papel text) RETURNS text[]
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT CASE p_papel
    WHEN 'dono' THEN ARRAY['catalog:history', 'catalog:import', 'catalog:publish',
                           'catalog:read', 'catalog:write', 'customers:billing',
                           'customers:exemptions', 'customers:merge', 'customers:read',
                           'customers:write', 'keys:write', 'legal:read',
                           'legal:write', 'merchant:read', 'merchant:write',
                           'orders:read', 'payments:accounts', 'payments:read',
                           'payments:resolve', 'payments:write', 'prices:read',
                           'prices:write',
                           'shipping:read', 'shipping:write', 'tax:read', 'tax:write']
    WHEN 'gestor' THEN ARRAY['catalog:history', 'catalog:import', 'catalog:publish',
                             'catalog:read', 'catalog:write', 'customers:merge',
                             'customers:read', 'customers:write', 'legal:read',
                             'merchant:read', 'orders:read', 'payments:read',
                             'payments:write', 'prices:read', 'prices:write',
                             'shipping:read', 'shipping:write', 'tax:read']
    WHEN 'armazem' THEN ARRAY['catalog:read', 'prices:read', 'shipping:read']
    WHEN 'apoio' THEN ARRAY['catalog:read', 'customers:read', 'customers:write',
                            'legal:read', 'merchant:read', 'orders:read',
                            'payments:read', 'prices:read', 'shipping:read', 'tax:read']
  END::text[]
$$;
