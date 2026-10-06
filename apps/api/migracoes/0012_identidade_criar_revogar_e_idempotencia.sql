-- Fatia «identidade»: criar e revogar chaves pela API, e a idempotência das
-- escritas (docs/19 §6.1, docs/18 §4; issue #107; Diogo, 06/10/2026: «avança
-- com o POST /keys e a revogação»). Ex.: o software de gestão de um
-- comerciante, com uma chave que tem `keys:write` e `catalog:read`, cria outra
-- só com `catalog:read`; não consegue criar uma com `merchant:write`.
--
-- O que esta migração faz:
-- - duas funções SECURITY DEFINER, as únicas por onde a API escreve chaves:
--   `chave_criar_pela_api` e `chave_revogar_pela_api`. A base encontra quem
--   pede pelo RESUMO do segredo apresentado (não por um id que a aplicação
--   escolhesse) e impõe: chave válida, do comerciante do contexto, com
--   `keys:write`; a nova não tem âmbitos que quem pede não tem (T9); uma
--   chave não se revoga a si própria se for a última com `keys:write` (T11),
--   com uma tranca por comerciante;
-- - a tabela `idempotencia` (docs/18 §4), com RLS forçado por comerciante.
--
-- Só acrescenta: a versão anterior da API (que já abre a base na VPS desde o
-- #116) continua a funcionar sem saber disto (infra/vps/LEIA-ME.md).

SET LOCAL lock_timeout = '10s';

-- A chave que pede, a partir do resumo do segredo apresentado: válida, do
-- comerciante do contexto e com `keys:write`. Sem isso, `auth.forbidden`.
-- Não se dá à API: só as duas funções abaixo a chamam.
CREATE FUNCTION chave_que_pede(p_resumo text) RETURNS public.chave_api
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem public.chave_api;
BEGIN
  SELECT c.* INTO quem FROM public.chave_api c
  WHERE c.resumo = p_resumo
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
CREATE FUNCTION chave_criar_pela_api(p_resumo_quem text, p_tipo text,
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
  quem := public.chave_que_pede(p_resumo_quem);
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
-- tempo não deixam o comerciante sem nenhuma com keys:write (T11).
CREATE FUNCTION chave_revogar_pela_api(p_resumo_quem text, p_id uuid)
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem public.chave_api;
  alvo public.chave_api;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('chave_api:' || public.comerciante_actual()::text, 0));
  quem := public.chave_que_pede(p_resumo_quem);
  SELECT c.* INTO alvo FROM public.chave_api c
  WHERE c.id = p_id AND c.comerciante_id = quem.comerciante_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'key.not_found: a chave não existe neste comerciante';
  END IF;
  IF alvo.revogada_em IS NOT NULL THEN
    RAISE EXCEPTION 'key.already_revoked: a chave já foi revogada';
  END IF;
  IF alvo.id = quem.id AND NOT EXISTS (
       SELECT 1 FROM public.chave_api c
       WHERE c.comerciante_id = quem.comerciante_id
         AND c.id <> quem.id
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
