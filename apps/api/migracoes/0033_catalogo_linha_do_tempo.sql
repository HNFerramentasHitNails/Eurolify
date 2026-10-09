-- A linha do tempo do artigo (docs/14 §3.12; regra C7: quem, quando, antes e
-- depois; Diogo, 09/10/2026: «sim, aprovo; avança com o código do
-- histórico»). Ex.: a chave `key_…` muda o nome do «Gel UV 15 ml» para «Gel
-- UV 15 ml transparente»; fica uma linha com quem, o instante, o campo
-- `nome`, o antes e o depois. Se, na mesma transacção, a publicação sai de
-- venda, fica outra linha com a mesma `transacao`.
--
-- O que esta migração faz:
-- - a tabela `alteracao_catalogo`, que só se acrescenta (como o rasto da
--   0008 e os eventos da 0021): nem UPDATE, nem DELETE, nem TRUNCATE, nem
--   pelo dono;
-- - os gatilhos que a escrevem, com os direitos do dono, em cada tabela do
--   Catálogo que o comerciante muda: uma linha por cada linha criada,
--   alterada ou apagada, com só os campos que mudaram. A API, a importação,
--   os gatilhos em cadeia (a reverificação) e o SQL à mão no contexto do
--   comerciante não mudam o catálogo sem deixar rasto;
-- - **sem `eurolify.quem` na transacção, a escrita falha** (como na 0001);
-- - o âmbito `catalog:history` (docs/06, CU): na lista das chaves (o CHECK
--   da 0010) e nos papéis `dono` e `gestor` (a função da 0018).
--
-- O que não faz (e onde fica):
-- - entradas de antes desta migração: a linha do tempo começa aqui (não se
--   inventa um passado);
-- - as tabelas `ficheiro` (os bytes; a `media` aponta para o resumo) e
--   `combinacoes_por_verificar` (técnica);
-- - o prazo de guarda e a pseudonimização num apagamento: por decidir — C
--   (docs/17 §3, como os eventos);
-- - o dono das tabelas pode desligar ou apagar um gatilho por DDL; isso só
--   entra por migração revista, e o teste da linha do tempo falha se faltar
--   um gatilho numa tabela do Catálogo.

SET LOCAL lock_timeout = '10s';

CREATE TABLE alteracao_catalogo (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  -- Sem chave estrangeira: apagar um rascunho deixa as entradas.
  artigo_id uuid,
  entidade text NOT NULL CHECK (entidade IN (
    'artigo', 'variante', 'opcao', 'valor_opcao', 'variante_valor',
    'componente', 'traducao', 'artigo_categoria', 'colecao_artigo', 'media',
    'publicacao', 'categoria', 'colecao')),
  -- O `id` da linha; vazio nas tabelas de ligação (as chaves vão nos campos).
  entidade_id uuid,
  operacao text NOT NULL CHECK (operacao IN ('criado', 'alterado', 'apagado')),
  -- {"campo": {"antes": …, "depois": …}}, só os que mudaram.
  campos jsonb NOT NULL CHECK (jsonb_typeof(campos) = 'object' AND campos <> '{}'),
  quem text NOT NULL CHECK (length(quem) BETWEEN 1 AND 200),
  origem text CHECK (origem IS NULL OR length(origem) BETWEEN 1 AND 200),
  transacao bigint NOT NULL,
  em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX alteracao_catalogo_por_artigo
  ON alteracao_catalogo (comerciante_id, artigo_id, id);

CREATE TRIGGER alteracao_catalogo_so_se_acrescenta
  BEFORE UPDATE OR DELETE ON alteracao_catalogo
  FOR EACH ROW EXECUTE FUNCTION rasto_so_se_acrescenta();
CREATE TRIGGER alteracao_catalogo_sem_truncate
  BEFORE TRUNCATE ON alteracao_catalogo
  FOR EACH STATEMENT EXECUTE FUNCTION rasto_so_se_acrescenta();
ALTER TABLE alteracao_catalogo ENABLE ALWAYS TRIGGER alteracao_catalogo_so_se_acrescenta;
ALTER TABLE alteracao_catalogo ENABLE ALWAYS TRIGGER alteracao_catalogo_sem_truncate;

ALTER TABLE alteracao_catalogo ENABLE ROW LEVEL SECURITY;
ALTER TABLE alteracao_catalogo FORCE ROW LEVEL SECURITY;
-- Ler, só as do comerciante posto. Escrever, só o gatilho (com os direitos
-- do dono; a API não tem INSERT): a linha que muda já passou o RLS da sua
-- tabela, e o comerciante da entrada é o dela. Sem esta política, o SQL à
-- mão sem `eurolify.comerciante` (que o RLS das tabelas do catálogo não
-- trava ao dono que é superutilizador) falhava aqui com um erro de uuid em
-- vez de deixar rasto.
CREATE POLICY ler_o_proprio ON alteracao_catalogo FOR SELECT
  USING (comerciante_id = comerciante_actual());
CREATE POLICY escreve_o_gatilho ON alteracao_catalogo FOR INSERT
  WITH CHECK (true);
-- A API só lê (a rota pede `catalog:history`); escrevem os gatilhos.
GRANT SELECT ON alteracao_catalogo TO eurolify_api;

-- Os campos que não entram: a chave, os técnicos e os que já dizem quem e
-- quando (o «quem» de cada entrada é o da entrada).
CREATE FUNCTION catalogo_sem_tecnicos(j jsonb) RETURNS jsonb
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT j - ARRAY['id', 'comerciante_id', 'criado_em', 'actualizado_em',
                   'versao', 'classificado_por', 'classificado_em',
                   'publicado_por', 'publicado_em', 'arquivado_por',
                   'arquivado_em', 'traduzido_por', 'traduzido_em',
                   'revisto_por', 'revisto_em', 'verificado_em']
$$;

CREATE FUNCTION catalogo_escrever_alteracao() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem text := nullif(btrim(current_setting('eurolify.quem', true)), '');
  origem text := nullif(btrim(current_setting('eurolify.origem', true)), '');
  linha jsonb;
  antes jsonb := '{}';
  depois jsonb := '{}';
  campos jsonb := '{}';
  chave text;
  artigo uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    linha := to_jsonb(OLD);
    antes := public.catalogo_sem_tecnicos(linha);
  ELSE
    linha := to_jsonb(NEW);
    depois := public.catalogo_sem_tecnicos(linha);
    IF TG_OP = 'UPDATE' THEN
      antes := public.catalogo_sem_tecnicos(to_jsonb(OLD));
    END IF;
  END IF;
  FOR chave IN SELECT k FROM jsonb_object_keys(antes || depois) AS k LOOP
    -- Ao criar e ao apagar, um campo vazio não diz nada.
    CONTINUE WHEN TG_OP = 'INSERT' AND jsonb_typeof(depois -> chave) = 'null';
    CONTINUE WHEN TG_OP = 'DELETE' AND jsonb_typeof(antes -> chave) = 'null';
    IF (antes -> chave) IS DISTINCT FROM (depois -> chave) THEN
      campos := campos || jsonb_build_object(chave, jsonb_build_object(
        'antes', antes -> chave, 'depois', depois -> chave));
    END IF;
  END LOOP;
  -- Uma escrita que não muda nada não deixa entrada (docs/14 §4.1).
  IF campos = '{}' THEN
    RETURN NULL;
  END IF;
  IF quem IS NULL THEN
    RAISE EXCEPTION 'catalog.change_without_who: % em % sem eurolify.quem', TG_OP, TG_TABLE_NAME;
  END IF;
  artigo := CASE TG_TABLE_NAME
    WHEN 'artigo' THEN (linha ->> 'id')::uuid
    WHEN 'categoria' THEN NULL
    WHEN 'colecao' THEN NULL
    WHEN 'componente' THEN (
      SELECT v.artigo_id FROM public.variante v
      WHERE v.comerciante_id = (linha ->> 'comerciante_id')::uuid
        AND v.id = (linha ->> 'kit_id')::uuid)
    ELSE (linha ->> 'artigo_id')::uuid
  END;
  INSERT INTO public.alteracao_catalogo (comerciante_id, artigo_id, entidade,
    entidade_id, operacao, campos, quem, origem, transacao)
  VALUES ((linha ->> 'comerciante_id')::uuid, artigo, TG_TABLE_NAME,
    (linha ->> 'id')::uuid,
    CASE TG_OP WHEN 'INSERT' THEN 'criado' WHEN 'UPDATE' THEN 'alterado' ELSE 'apagado' END,
    campos, quem, origem, pg_current_xact_id()::text::bigint);
  RETURN NULL;
END
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['artigo', 'variante', 'opcao', 'valor_opcao',
    'variante_valor', 'componente', 'traducao', 'artigo_categoria',
    'colecao_artigo', 'media', 'publicacao', 'categoria', 'colecao'] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION catalogo_escrever_alteracao()',
      t || '_linha_do_tempo', t);
  END LOOP;
END
$$;

-- O âmbito novo (docs/06, CU): nas chaves e nos papéis.
ALTER TABLE chave_api DROP CONSTRAINT chave_api_ambitos_validos;
ALTER TABLE chave_api ADD CONSTRAINT chave_api_ambitos_validos CHECK (
  cardinality(ambitos) BETWEEN 1 AND 20
  AND ambitos <@ ARRAY[
    'merchant:read', 'merchant:write',
    'catalog:read', 'catalog:write', 'catalog:publish', 'catalog:import',
    'catalog:history', 'keys:write', 'storefront'
  ]::text[]);

CREATE OR REPLACE FUNCTION papel_ambitos(p_papel text) RETURNS text[]
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT CASE p_papel
    WHEN 'dono' THEN ARRAY['catalog:history', 'catalog:import', 'catalog:publish',
                           'catalog:read', 'catalog:write', 'keys:write',
                           'merchant:read', 'merchant:write']
    WHEN 'gestor' THEN ARRAY['catalog:history', 'catalog:import', 'catalog:publish',
                             'catalog:read', 'catalog:write', 'merchant:read']
    WHEN 'armazem' THEN ARRAY['catalog:read']
    WHEN 'apoio' THEN ARRAY['catalog:read', 'merchant:read']
  END::text[]
$$;
