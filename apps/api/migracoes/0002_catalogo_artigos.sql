-- Domínio Catálogo, parte 1: artigos e variantes (docs/14-dominio-catalogo.md
-- §3.1, §3.2, §4.1 e §5; issue #77). O mesmo isolamento da 0001: RLS forçado
-- por comerciante, para o eurolify_api, que não o ignora.
--
-- Fica para as partes seguintes: opções e valores, composição dos kits,
-- traduções, media, categorias, colecções, publicação, atributos
-- regulamentares (as referências à Conformidade), eventos e linha do tempo.

-- Artigo: o produto comercial. «Activo» não quer dizer «à venda» (§3.1).
CREATE TABLE artigo (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  tipo text NOT NULL CHECK (tipo IN (
    'fisico', 'servico', 'digital', 'bilhete', 'cartao_oferta')),
  estado text NOT NULL DEFAULT 'rascunho' CHECK (estado IN (
    'rascunho', 'activo', 'arquivado')),
  -- Na língua de origem do comerciante; as outras ficam em Tradução (§3.8).
  nome text NOT NULL CHECK (length(btrim(nome)) > 0),
  descricao text,
  marca text,
  -- Só o código: a lista e o que significa são do Motor de IVA (§2).
  categoria_fiscal text CHECK (
    categoria_fiscal IS NULL OR categoria_fiscal ~ '^[a-z][a-z0-9_]*$'),
  -- Onde nasce a ficha (§3.1, P5): no Eurolify, ou num sistema externo do
  -- comerciante, com o identificador de lá.
  origem text NOT NULL DEFAULT 'eurolify' CHECK (origem IN ('eurolify', 'externo')),
  origem_ref text,
  -- Já esteve activo? Um artigo que esteve activo não se apaga (§4.1).
  ja_esteve_activo boolean NOT NULL DEFAULT false,
  criado_em timestamptz NOT NULL DEFAULT now(),
  actualizado_em timestamptz NOT NULL DEFAULT now(),
  versao integer NOT NULL DEFAULT 1,
  CONSTRAINT artigo_origem_com_referencia CHECK (
    (origem = 'eurolify' AND origem_ref IS NULL)
    OR (origem = 'externo' AND origem_ref IS NOT NULL
        AND length(btrim(origem_ref)) > 0)),
  -- A chave das FK das variantes: a variante é sempre do mesmo comerciante.
  UNIQUE (comerciante_id, id)
);

-- Variante: a unidade vendável (§3.2).
CREATE TABLE variante (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL,
  artigo_id uuid NOT NULL,
  -- Obrigatório e único por comerciante, também entre as arquivadas: um SKU
  -- arquivado não volta a ser usado (C3; P7, Diogo, 05/10/2026).
  sku text NOT NULL CHECK (sku ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$'),
  gtin text CHECK (gtin IS NULL OR gtin ~ '^([0-9]{8}|[0-9]{12,14})$'),
  gtin_origem text CHECK (gtin_origem IN ('gs1_comerciante', 'fornecedor', 'interno')),
  unidade_de_venda text NOT NULL CHECK (unidade_de_venda IN (
    'unidade', 'par', 'caixa', 'embalagem', 'conjunto')),
  -- Para o preço por unidade (Dir. 98/6/CE): quantidade inteira e a unidade.
  conteudo_quantidade integer CHECK (conteudo_quantidade IS NULL OR conteudo_quantidade > 0),
  conteudo_unidade text CHECK (conteudo_unidade IN (
    'mg', 'g', 'kg', 'ml', 'cl', 'l', 'mm', 'cm', 'm', 'm2', 'm3')),
  peso_g integer CHECK (peso_g IS NULL OR peso_g > 0),
  comprimento_mm integer CHECK (comprimento_mm IS NULL OR comprimento_mm > 0),
  largura_mm integer CHECK (largura_mm IS NULL OR largura_mm > 0),
  altura_mm integer CHECK (altura_mm IS NULL OR altura_mm > 0),
  onu text CHECK (onu IS NULL OR onu ~ '^UN[0-9]{4}$'),
  classe_adr text CHECK (classe_adr IS NULL OR length(btrim(classe_adr)) > 0),
  estado text NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa', 'arquivada')),
  posicao integer NOT NULL DEFAULT 0 CHECK (posicao >= 0),
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT variante_sku_unico UNIQUE (comerciante_id, sku),
  -- Com código de barras, a origem dele (C4).
  CONSTRAINT variante_gtin_com_origem CHECK ((gtin IS NULL) = (gtin_origem IS NULL)),
  CONSTRAINT variante_conteudo_completo CHECK (
    (conteudo_quantidade IS NULL) = (conteudo_unidade IS NULL)),
  FOREIGN KEY (comerciante_id, artigo_id) REFERENCES artigo (comerciante_id, id)
);

-- O dígito de controlo de um GTIN (GTIN-8, 12, 13 e 14): da direita para a
-- esquerda, sem contar o último, pesos 3 e 1 alternados; o último é o que
-- leva a soma ao múltiplo de 10 seguinte (o algoritmo GS1 do dígito de
-- controlo; não verifiquei em que secção das especificações está). Os testes
-- provam-no com códigos calculados à mão e com um dígito trocado.
-- Só algarismos (sem depender de outro CHECK correr antes) e nunca só zeros
-- (revisão do #78, P1-2 e P2-6).
CREATE FUNCTION gtin_valido(codigo text) RETURNS boolean
  LANGUAGE sql IMMUTABLE STRICT SET search_path = pg_catalog AS $$
  SELECT CASE
    WHEN codigo !~ '^[0-9]{2,}$' OR codigo ~ '^0+$' THEN false
    ELSE (
      SELECT (10 - (sum(
               substr(codigo, length(codigo) - i, 1)::int
               * CASE WHEN i % 2 = 1 THEN 3 ELSE 1 END) % 10)) % 10
             = substr(codigo, length(codigo), 1)::int
      FROM generate_series(1, length(codigo) - 1) AS i)
  END
$$;

ALTER TABLE variante
  ADD CONSTRAINT variante_gtin_digito_de_controlo
  CHECK (gtin IS NULL OR public.gtin_valido(gtin));

-- Único por comerciante na forma de 14 algarismos: o mesmo código escrito
-- como GTIN-12, 13 ou 14 (zeros à esquerda) é o mesmo código (revisão do
-- #78, P1-2; C4: no Hub havia 18 códigos repetidos).
CREATE UNIQUE INDEX variante_gtin_unico
  ON variante (comerciante_id, lpad(gtin, 14, '0'))
  WHERE gtin IS NOT NULL;

-- Artigo: estados (§4.1), versão e o que não muda.
CREATE FUNCTION artigo_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.estado <> 'rascunho' OR NEW.ja_esteve_activo THEN
      RAISE EXCEPTION 'catalog.invalid_transition: um artigo nasce em rascunho';
    END IF;
    -- Digital e cartão-oferta estão desenhados mas desligados até às portas
    -- deles (P3, ADR-0034).
    IF NEW.tipo IN ('digital', 'cartao_oferta') THEN
      RAISE EXCEPTION 'catalog.type_disabled: o tipo % está desligado (ADR-0034)', NEW.tipo;
    END IF;
    NEW.versao := 1;
    -- As datas são da base, não de quem cria (revisão do #78, P2-2).
    NEW.criado_em := now();
    NEW.actualizado_em := now();
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id OR NEW.comerciante_id <> OLD.comerciante_id THEN
    RAISE EXCEPTION 'catalog.immutable_identity: o id e o comerciante de um artigo não mudam';
  END IF;
  IF NEW.tipo IS DISTINCT FROM OLD.tipo THEN
    RAISE EXCEPTION 'catalog.immutable_type: o tipo de um artigo não muda; criar outro';
  END IF;
  IF NEW.ja_esteve_activo IS DISTINCT FROM OLD.ja_esteve_activo THEN
    RAISE EXCEPTION 'catalog.invalid_transition: ja_esteve_activo só muda com o estado';
  END IF;
  NEW.criado_em := OLD.criado_em;
  NEW.versao := OLD.versao + 1;
  NEW.actualizado_em := now();

  IF NEW.estado IS DISTINCT FROM OLD.estado THEN
    IF NOT (
      (OLD.estado = 'rascunho' AND NEW.estado = 'activo') OR
      (OLD.estado = 'activo' AND NEW.estado = 'arquivado') OR
      (OLD.estado = 'arquivado' AND NEW.estado = 'activo')
    ) THEN
      RAISE EXCEPTION 'catalog.invalid_transition: % → %', OLD.estado, NEW.estado;
    END IF;
    -- Activar exige pelo menos uma variante activa; o SKU e a unidade já são
    -- obrigatórios em todas (C3). FOR SHARE: quem arquiva a última variante
    -- ao mesmo tempo espera, e esta activação vê o resultado. Depois de
    -- activo, arquivar a última variante é permitido (C6): o artigo fica
    -- activo sem variantes activas e não se pode publicar.
    IF NEW.estado = 'activo' AND NOT EXISTS (
      SELECT FROM (
        SELECT v.id FROM public.variante v
        WHERE v.comerciante_id = NEW.comerciante_id
          AND v.artigo_id = NEW.id
          AND v.estado = 'activa'
        FOR SHARE
      ) activas
    ) THEN
      RAISE EXCEPTION 'catalog.no_variants: activar exige pelo menos uma variante activa';
    END IF;
    IF NEW.estado = 'activo' THEN
      NEW.ja_esteve_activo := true;
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER artigo_antes_de_gravar
  BEFORE INSERT OR UPDATE ON artigo
  FOR EACH ROW EXECUTE FUNCTION artigo_antes_de_gravar();

-- Apagar só um rascunho que nunca esteve activo (§4.1); o resto arquiva-se.
-- As variantes dele vão com ele (só um rascunho pode chegar aqui).
CREATE FUNCTION artigo_antes_de_apagar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF OLD.estado <> 'rascunho' OR OLD.ja_esteve_activo THEN
    RAISE EXCEPTION 'catalog.not_draft: só se apaga um rascunho que nunca esteve activo; arquivar';
  END IF;
  DELETE FROM public.variante v
  WHERE v.comerciante_id = OLD.comerciante_id AND v.artigo_id = OLD.id;
  RETURN OLD;
END
$$;

CREATE TRIGGER artigo_antes_de_apagar
  BEFORE DELETE ON artigo
  FOR EACH ROW EXECUTE FUNCTION artigo_antes_de_apagar();

-- Variante: o artigo e o SKU não mudam (um SKU é a identidade da variante para
-- faturas e importações); arquivada é final, como a entidade legal (P7: o SKU
-- não volta); arquivar não toca no artigo (C6). Só se apaga enquanto o artigo
-- é rascunho (sozinha ou com ele): um rascunho nunca esteve activo, por isso o
-- SKU dela nunca foi usado fora e fica livre — se isto está bem é uma pergunta
-- em aberto para o Diogo ou o Bruno (revisão do #78, P2-3).
CREATE FUNCTION variante_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  estado_do_artigo text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT a.estado INTO estado_do_artigo FROM public.artigo a
    WHERE a.comerciante_id = OLD.comerciante_id AND a.id = OLD.artigo_id;
    -- Sem artigo (apagado na mesma instrução) ou artigo rascunho: deixa.
    IF estado_do_artigo IS NOT NULL AND estado_do_artigo <> 'rascunho' THEN
      RAISE EXCEPTION 'catalog.not_draft: uma variante não se apaga; arquivar';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.estado <> 'activa' THEN
      RAISE EXCEPTION 'catalog.invalid_transition: uma variante nasce activa';
    END IF;
    -- Um artigo arquivado pode receber variantes novas: é assim que se repõe
    -- um artigo cujas variantes estão todas arquivadas (decisão do Diogo,
    -- 05/10/2026, revisão do #78, P1-1, opção a). Arquivado não está à venda.
    -- As datas são da base (revisão do #78, P2-2).
    NEW.criado_em := now();
    RETURN NEW;
  END IF;
  IF OLD.estado = 'arquivada' THEN
    RAISE EXCEPTION 'catalog.variant_archived_is_final: uma variante arquivada não muda; o SKU não volta a ser usado';
  END IF;
  IF NEW.id <> OLD.id OR NEW.comerciante_id <> OLD.comerciante_id
     OR NEW.artigo_id <> OLD.artigo_id OR NEW.sku <> OLD.sku THEN
    RAISE EXCEPTION 'catalog.immutable_identity: o artigo e o SKU de uma variante não mudam';
  END IF;
  NEW.criado_em := OLD.criado_em;
  RETURN NEW;
END
$$;

CREATE TRIGGER variante_antes_de_gravar
  BEFORE INSERT OR UPDATE OR DELETE ON variante
  FOR EACH ROW EXECUTE FUNCTION variante_antes_de_gravar();

-- RLS forçado, como na 0001.
DO $$
DECLARE
  tabela text;
BEGIN
  FOREACH tabela IN ARRAY ARRAY['artigo', 'variante']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tabela);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tabela);
    EXECUTE format(
      'CREATE POLICY so_o_proprio ON %I USING (comerciante_id = comerciante_actual()) WITH CHECK (comerciante_id = comerciante_actual())',
      tabela);
  END LOOP;
END
$$;

-- O que a API pode fazer. Apagar só o artigo (o trigger só deixa o rascunho
-- que nunca esteve activo); as variantes vão com ele, pelo trigger, que corre
-- com os direitos da API: por isso DELETE em variante também, e o trigger da
-- variante só deixa apagar a de um artigo rascunho. No INSERT, o `id` é sempre
-- o da base: a API não o escolhe, e um id escolhido não revela que já existe
-- noutro comerciante (revisão do #78, P2-5).
GRANT SELECT, UPDATE, DELETE ON artigo, variante TO eurolify_api;
GRANT INSERT (comerciante_id, tipo, estado, nome, descricao, marca,
  categoria_fiscal, origem, origem_ref, ja_esteve_activo, criado_em,
  actualizado_em, versao) ON artigo TO eurolify_api;
GRANT INSERT (comerciante_id, artigo_id, sku, gtin, gtin_origem,
  unidade_de_venda, conteudo_quantidade, conteudo_unidade, peso_g,
  comprimento_mm, largura_mm, altura_mm, onu, classe_adr, estado, posicao,
  criado_em) ON variante TO eurolify_api;
