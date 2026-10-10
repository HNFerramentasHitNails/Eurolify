-- O contexto comum do rasto de auditoria (docs/28 §3.1; decisão DK; Diogo,
-- 10/10/2026: «aprovado»; issue #322), passo 1 da §4. Ex.: um pedido da API
-- com a chave `key_…`, identificado `req-8f2`, feito por um agente que se
-- declara «fornecedor=anthropic; modelo=claude-x» dá
-- `{"quem": "chave:key_…", "canal": "api", "pedido": "req-8f2",
--   "ia": {"fornecedor": "anthropic", "modelo": "claude-x", "prova": "declarado"}}`.
--
-- O que esta migração faz:
-- - `contexto_do_rasto()`: lê as variáveis da transacção que a API põe num só
--   sítio (`comComerciante`, src/base/rasto.ts) — `eurolify.quem`,
--   `eurolify.canal`, `eurolify.pedido`, `eurolify.origem`, `eurolify.motivo`,
--   `eurolify.autorizado_por` e `eurolify.ia` — confere a forma de cada uma e
--   devolve-as num objecto, sem as vazias. Uma variável mal formada é um erro
--   (`audit.context_invalid`), nunca se grava às escondidas;
-- - nada mais: as colunas nas tabelas do rasto e os gatilhos que a usam são o
--   passo 2 (docs/28 §4). Fechada a PUBLIC (0008) e aberta só à API: os
--   gatilhos do passo 2 correm com quem escreve, como os da 0049. Só lê as
--   variáveis da própria transacção; não dá nada que a API não tenha posto.

SET LOCAL lock_timeout = '10s';

CREATE FUNCTION contexto_do_rasto() RETURNS jsonb
  LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem text := nullif(btrim(current_setting('eurolify.quem', true)), '');
  canal text := nullif(btrim(current_setting('eurolify.canal', true)), '');
  pedido text := nullif(btrim(current_setting('eurolify.pedido', true)), '');
  origem text := nullif(btrim(current_setting('eurolify.origem', true)), '');
  motivo text := nullif(btrim(current_setting('eurolify.motivo', true)), '');
  autorizado text := nullif(btrim(current_setting('eurolify.autorizado_por', true)), '');
  ia_texto text := nullif(btrim(current_setting('eurolify.ia', true)), '');
  ia jsonb;
  chave text;
BEGIN
  IF canal IS NOT NULL AND canal NOT IN
     ('hub', 'api', 'importacao', 'integracao', 'mcp', 'sistema', 'operador') THEN
    RAISE EXCEPTION 'audit.context_invalid: canal desconhecido';
  END IF;
  IF pedido IS NOT NULL AND pedido !~ '^[A-Za-z0-9._:-]{1,100}$' THEN
    RAISE EXCEPTION 'audit.context_invalid: identificador do pedido mal formado';
  END IF;
  -- Quem autoriza é sempre uma pessoa (docs/28 §3.2): nunca uma chave nem uma IA.
  IF autorizado IS NOT NULL
     AND autorizado !~ '^pessoa:per_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'audit.context_invalid: quem autoriza tem de ser uma pessoa';
  END IF;
  IF motivo IS NOT NULL AND length(motivo) > 500 THEN
    RAISE EXCEPTION 'audit.context_invalid: motivo com mais de 500 caracteres';
  END IF;
  IF ia_texto IS NOT NULL THEN
    BEGIN
      ia := ia_texto::jsonb;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'audit.context_invalid: a IA não é JSON';
    END;
    -- §3.3: só «comprovado» ou «declarado»; «desconhecido» é não haver IA.
    IF jsonb_typeof(ia) <> 'object'
       OR (ia ->> 'prova') IS NULL
       OR (ia ->> 'prova') NOT IN ('comprovado', 'declarado') THEN
      RAISE EXCEPTION 'audit.context_invalid: a IA precisa da prova (comprovado ou declarado)';
    END IF;
    FOR chave IN SELECT jsonb_object_keys(ia) LOOP
      IF chave NOT IN ('fornecedor', 'modelo', 'execucao', 'prova')
         OR jsonb_typeof(ia -> chave) <> 'string'
         OR length(ia ->> chave) NOT BETWEEN 1 AND 100 THEN
        RAISE EXCEPTION 'audit.context_invalid: campo da IA desconhecido ou mal formado';
      END IF;
    END LOOP;
  END IF;
  RETURN jsonb_strip_nulls(jsonb_build_object(
    'quem', quem, 'canal', canal, 'pedido', pedido, 'origem', origem,
    'motivo', motivo, 'autorizado_por', autorizado, 'ia', ia));
END
$$;

REVOKE EXECUTE ON FUNCTION contexto_do_rasto() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION contexto_do_rasto() TO eurolify_api;
