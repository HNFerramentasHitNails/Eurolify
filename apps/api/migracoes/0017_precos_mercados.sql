-- Domínio Preços e mercados, parte 1: mercados, canais, listas de preços,
-- preços e o histórico (docs/20 §3.1 a §3.5, §4 e §5; issue #127; desenho
-- aprovado pelo Diogo a 06/10/2026). Ex.: o mercado «Portugal» (PT, EUR,
-- português, preços com IVA) da loja online, com a lista «Base PT», onde a
-- variante GEL-001 custa 990 cêntimos; mudar para 1090 deixa as duas linhas
-- no histórico.
--
-- Regras (docs/20; as marcadas «proposta» são desta parte do código e ficam
-- escritas no docs/20):
-- - montantes em cêntimos, sem moeda própria: a moeda é a do mercado da lista
--   (R2); 0 só com «gratuito», e «gratuito» só com 0 (R4);
-- - um mercado nasce em rascunho; activa-se com países, moeda, línguas e uma
--   lista de base activa; numa loja, um país só está num mercado activo (Q4,
--   BV); um mercado arquivado volta a activo com as mesmas condições;
-- - a moeda e o «preço inclui IVA» de um mercado não mudam depois de haver
--   preços nas listas dele (proposta: mudariam o significado dos montantes
--   já escritos);
-- - uma lista de base activa por mercado; a de um mercado activo não se
--   arquiva; as listas B2B por etiqueta (a etiqueta é de Clientes, ainda sem
--   tabela: guarda-se o identificador) com prioridade única entre as activas
--   do mercado, e uma etiqueta só numa lista activa do mercado (proposta);
-- - num canal, os mercados são da mesma loja (chaves compostas); na Fase 1 o
--   canal é «online»;
-- - um preço não se escreve numa lista arquivada; quem o define vem de
--   `eurolify.quem` (como a classificação, 0006); a data é da base;
-- - o histórico só se acrescenta (como o rasto da 0008): uma linha quando o
--   preço nasce, quando o montante ou o «gratuito» mudam e quando o preço sai
--   (também quando sai porque a variante de um rascunho foi apagada). Escreve-o
--   um gatilho com os direitos do dono: a API não lhe pode escrever.
--
-- Concorrência: as escritas nos mercados de uma loja passam por uma fila só
-- delas (o país único olha para várias linhas); as escritas nas listas de um
-- mercado tomam a linha do mercado (a lista de base e as prioridades).
-- Assumem READ COMMITTED (base/ligacao.ts).

SET LOCAL lock_timeout = '10s';

-- A loja ganha a chave com o comerciante e o id, para os mercados e os canais
-- apontarem para uma loja do mesmo comerciante (a 0010 já criou uma igual:
-- só se cria se faltar).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conrelid = 'public.loja'::regclass AND contype = 'u'
      AND conkey = ARRAY[
        (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.loja'::regclass AND attname = 'comerciante_id'),
        (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.loja'::regclass AND attname = 'id')]::int2[]) THEN
    ALTER TABLE loja ADD CONSTRAINT loja_comerciante_id_unico UNIQUE (comerciante_id, id);
  END IF;
END
$$;

CREATE TABLE mercado (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  loja_id uuid NOT NULL,
  nome text NOT NULL,
  paises text[] NOT NULL,
  moeda text NOT NULL,
  linguas text[] NOT NULL,
  lingua_principal text NOT NULL,
  -- Q1, BS: com IVA por omissão.
  preco_inclui_iva boolean NOT NULL DEFAULT true,
  estado text NOT NULL DEFAULT 'rascunho'
    CHECK (estado IN ('rascunho', 'activo', 'arquivado')),
  criado_em timestamptz NOT NULL DEFAULT now(),
  actualizado_em timestamptz NOT NULL DEFAULT now(),
  versao integer NOT NULL DEFAULT 1,
  CONSTRAINT mercado_nome_check CHECK (length(btrim(nome)) > 0 AND length(nome) <= 100),
  -- País em código ISO 3166-1 alfa-2 (eu-localization); os repetidos recusa-os
  -- o gatilho (um CHECK não aceita subconsultas).
  CONSTRAINT mercado_paises_validos CHECK (
    cardinality(paises) BETWEEN 1 AND 50
    AND array_to_string(paises, ',') ~ '^[A-Z]{2}(,[A-Z]{2})*$'),
  -- Moeda em código ISO 4217 (R2). Que moedas usa cada país: C (docs/20 §3.1).
  CONSTRAINT mercado_moeda_valida CHECK (moeda ~ '^[A-Z]{3}$'),
  CONSTRAINT mercado_linguas_validas CHECK (
    cardinality(linguas) BETWEEN 1 AND 30
    AND array_to_string(linguas, ',') ~ '^[a-z]{2}(,[a-z]{2})*$'),
  CONSTRAINT mercado_lingua_principal_da_lista CHECK (lingua_principal = ANY (linguas)),
  UNIQUE (comerciante_id, id),
  UNIQUE (comerciante_id, loja_id, id),
  CONSTRAINT mercado_da_loja FOREIGN KEY (comerciante_id, loja_id)
    REFERENCES loja (comerciante_id, id)
);
CREATE INDEX mercado_por_loja ON mercado (comerciante_id, loja_id);

CREATE TABLE canal (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  loja_id uuid NOT NULL,
  nome text NOT NULL,
  -- Fase 1: só canais online (docs/20 §3.2); pos e marketplace na Fase 2.
  tipo text NOT NULL DEFAULT 'online' CHECK (tipo IN ('online')),
  estado text NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'arquivado')),
  criado_em timestamptz NOT NULL DEFAULT now(),
  actualizado_em timestamptz NOT NULL DEFAULT now(),
  versao integer NOT NULL DEFAULT 1,
  CONSTRAINT canal_nome_check CHECK (length(btrim(nome)) > 0 AND length(nome) <= 100),
  UNIQUE (comerciante_id, id),
  UNIQUE (comerciante_id, loja_id, id),
  CONSTRAINT canal_da_loja FOREIGN KEY (comerciante_id, loja_id)
    REFERENCES loja (comerciante_id, id)
);

-- Em que mercados um canal vende: os dois da mesma loja (as duas chaves
-- compostas levam a loja).
CREATE TABLE canal_mercado (
  comerciante_id uuid NOT NULL,
  loja_id uuid NOT NULL,
  canal_id uuid NOT NULL,
  mercado_id uuid NOT NULL,
  PRIMARY KEY (canal_id, mercado_id),
  CONSTRAINT canal_mercado_do_canal FOREIGN KEY (comerciante_id, loja_id, canal_id)
    REFERENCES canal (comerciante_id, loja_id, id),
  CONSTRAINT canal_mercado_do_mercado FOREIGN KEY (comerciante_id, loja_id, mercado_id)
    REFERENCES mercado (comerciante_id, loja_id, id)
);
CREATE INDEX canal_mercado_por_mercado ON canal_mercado (comerciante_id, mercado_id);

CREATE TABLE lista_precos (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  mercado_id uuid NOT NULL,
  nome text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('base', 'b2b')),
  -- A etiqueta é de Clientes (docs/20 §2), que ainda não tem tabela: só o id.
  etiqueta_id uuid,
  prioridade integer,
  estado text NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa', 'arquivada')),
  criado_em timestamptz NOT NULL DEFAULT now(),
  actualizado_em timestamptz NOT NULL DEFAULT now(),
  versao integer NOT NULL DEFAULT 1,
  CONSTRAINT lista_precos_nome_check CHECK (length(btrim(nome)) > 0 AND length(nome) <= 100),
  CONSTRAINT lista_precos_b2b_com_etiqueta CHECK (
    (tipo = 'base' AND etiqueta_id IS NULL AND prioridade IS NULL)
    OR (tipo = 'b2b' AND etiqueta_id IS NOT NULL AND prioridade IS NOT NULL)),
  CONSTRAINT lista_precos_prioridade_valida CHECK (prioridade IS NULL OR prioridade BETWEEN 0 AND 1000),
  UNIQUE (comerciante_id, id),
  CONSTRAINT lista_precos_do_mercado FOREIGN KEY (comerciante_id, mercado_id)
    REFERENCES mercado (comerciante_id, id)
);
-- Uma lista de base activa por mercado; nas B2B activas de um mercado, a
-- prioridade não se repete (o empate é recusado) e a etiqueta também não.
CREATE UNIQUE INDEX lista_precos_uma_base_activa
  ON lista_precos (mercado_id) WHERE tipo = 'base' AND estado = 'activa';
CREATE UNIQUE INDEX lista_precos_prioridade_unica
  ON lista_precos (mercado_id, prioridade) WHERE tipo = 'b2b' AND estado = 'activa';
CREATE UNIQUE INDEX lista_precos_etiqueta_unica
  ON lista_precos (mercado_id, etiqueta_id) WHERE tipo = 'b2b' AND estado = 'activa';

CREATE TABLE preco (
  comerciante_id uuid NOT NULL,
  lista_id uuid NOT NULL,
  variante_id uuid NOT NULL,
  -- Cêntimos, na moeda do mercado da lista (R2). O limite (mil milhões em
  -- unidades da moeda) é proposta, para um engano de zeros não passar.
  montante bigint NOT NULL,
  gratuito boolean NOT NULL DEFAULT false,
  quantidade_minima integer NOT NULL DEFAULT 1,
  multiplo integer NOT NULL DEFAULT 1,
  definido_por text NOT NULL DEFAULT '',
  definido_em timestamptz NOT NULL DEFAULT now(),
  versao integer NOT NULL DEFAULT 1,
  PRIMARY KEY (lista_id, variante_id),
  CONSTRAINT preco_montante_valido CHECK (montante BETWEEN 0 AND 100000000000),
  -- R4: nada a 0,00 € sem ser explicitamente gratuito (catalog-pim, regra 2).
  CONSTRAINT preco_gratuito_so_a_zero CHECK (gratuito = (montante = 0)),
  CONSTRAINT preco_quantidades_validas CHECK (
    quantidade_minima BETWEEN 1 AND 1000000 AND multiplo BETWEEN 1 AND 1000000),
  CONSTRAINT preco_da_lista FOREIGN KEY (comerciante_id, lista_id)
    REFERENCES lista_precos (comerciante_id, id),
  -- Apagar o rascunho de um artigo apaga as variantes e, com elas, os preços
  -- (o histórico fica, com a saída registada).
  CONSTRAINT preco_da_variante FOREIGN KEY (comerciante_id, variante_id)
    REFERENCES variante (comerciante_id, id) ON DELETE CASCADE
);
CREATE INDEX preco_por_variante ON preco (comerciante_id, variante_id);

CREATE TABLE historico_preco (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  lista_id uuid NOT NULL,
  -- Sem chave para a variante: a linha fica depois de a variante de um
  -- rascunho ser apagada.
  variante_id uuid NOT NULL,
  -- Nulos quando o preço saiu da lista.
  montante bigint,
  gratuito boolean,
  saiu boolean NOT NULL,
  em_vigor_desde timestamptz NOT NULL DEFAULT now(),
  definido_por text NOT NULL,
  CONSTRAINT historico_preco_saida_sem_montante CHECK (
    (saiu AND montante IS NULL AND gratuito IS NULL)
    OR (NOT saiu AND montante IS NOT NULL AND gratuito IS NOT NULL)),
  CONSTRAINT historico_preco_da_lista FOREIGN KEY (comerciante_id, lista_id)
    REFERENCES lista_precos (comerciante_id, id)
);
CREATE INDEX historico_preco_por_preco
  ON historico_preco (comerciante_id, lista_id, variante_id, em_vigor_desde);

CREATE TRIGGER historico_preco_so_se_acrescenta
  BEFORE UPDATE OR DELETE ON historico_preco
  FOR EACH ROW EXECUTE FUNCTION rasto_so_se_acrescenta();
CREATE TRIGGER historico_preco_sem_truncate
  BEFORE TRUNCATE ON historico_preco
  FOR EACH STATEMENT EXECUTE FUNCTION rasto_so_se_acrescenta();
ALTER TABLE historico_preco ENABLE ALWAYS TRIGGER historico_preco_so_se_acrescenta;
ALTER TABLE historico_preco ENABLE ALWAYS TRIGGER historico_preco_sem_truncate;

-- Mercados: a fila da loja, o país único entre os activos, as transições e o
-- que não muda.
CREATE FUNCTION mercado_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  outros text;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('eurolify.mercado:' || NEW.loja_id::text, 0));

  IF cardinality(NEW.paises) <> (SELECT count(DISTINCT x) FROM unnest(NEW.paises) x) THEN
    RAISE EXCEPTION 'prices.country_invalid: um país repetido na lista';
  END IF;
  IF cardinality(NEW.linguas) <> (SELECT count(DISTINCT x) FROM unnest(NEW.linguas) x) THEN
    RAISE EXCEPTION 'prices.language_invalid: uma língua repetida na lista';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.estado <> 'rascunho' THEN
      RAISE EXCEPTION 'prices.invalid_transition: um mercado nasce em rascunho';
    END IF;
    NEW.versao := 1;
    NEW.criado_em := now();
    NEW.actualizado_em := now();
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id OR NEW.comerciante_id <> OLD.comerciante_id
     OR NEW.loja_id <> OLD.loja_id THEN
    RAISE EXCEPTION 'prices.immutable_identity: o id, o comerciante e a loja de um mercado não mudam';
  END IF;
  IF (NEW.moeda <> OLD.moeda OR NEW.preco_inclui_iva <> OLD.preco_inclui_iva)
     AND EXISTS (
       SELECT FROM public.preco p
       JOIN public.lista_precos l ON l.comerciante_id = p.comerciante_id AND l.id = p.lista_id
       WHERE l.comerciante_id = NEW.comerciante_id AND l.mercado_id = NEW.id) THEN
    RAISE EXCEPTION 'prices.market_has_prices: a moeda e o «preço inclui IVA» não mudam depois de haver preços';
  END IF;
  IF NEW.estado <> OLD.estado AND NOT (
       (OLD.estado = 'rascunho' AND NEW.estado = 'activo')
    OR (OLD.estado = 'activo' AND NEW.estado = 'arquivado')
    OR (OLD.estado = 'arquivado' AND NEW.estado = 'activo')) THEN
    RAISE EXCEPTION 'prices.invalid_transition: % → % não é permitido', OLD.estado, NEW.estado;
  END IF;

  IF NEW.estado = 'activo' THEN
    IF NOT EXISTS (
      SELECT FROM public.lista_precos l
      WHERE l.comerciante_id = NEW.comerciante_id AND l.mercado_id = NEW.id
        AND l.tipo = 'base' AND l.estado = 'activa') THEN
      RAISE EXCEPTION 'prices.base_list_required: um mercado activo tem uma lista de base activa';
    END IF;
    SELECT string_agg(DISTINCT pais, ', ' ORDER BY pais) INTO outros
    FROM public.mercado m, unnest(m.paises) AS pais
    WHERE m.comerciante_id = NEW.comerciante_id AND m.loja_id = NEW.loja_id
      AND m.id <> NEW.id AND m.estado = 'activo' AND pais = ANY (NEW.paises);
    IF outros IS NOT NULL THEN
      RAISE EXCEPTION 'prices.country_in_other_market: % já está noutro mercado activo da loja', outros;
    END IF;
  END IF;

  NEW.criado_em := OLD.criado_em;
  NEW.actualizado_em := now();
  NEW.versao := OLD.versao + 1;
  RETURN NEW;
END
$$;

CREATE TRIGGER mercado_antes_de_gravar
  BEFORE INSERT OR UPDATE ON mercado
  FOR EACH ROW EXECUTE FUNCTION mercado_antes_de_gravar();

CREATE FUNCTION canal_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.estado <> 'activo' THEN
      RAISE EXCEPTION 'prices.invalid_transition: um canal nasce activo';
    END IF;
    NEW.versao := 1;
    NEW.criado_em := now();
    NEW.actualizado_em := now();
    RETURN NEW;
  END IF;
  IF NEW.id <> OLD.id OR NEW.comerciante_id <> OLD.comerciante_id
     OR NEW.loja_id <> OLD.loja_id OR NEW.tipo <> OLD.tipo THEN
    RAISE EXCEPTION 'prices.immutable_identity: o id, o comerciante, a loja e o tipo de um canal não mudam';
  END IF;
  NEW.criado_em := OLD.criado_em;
  NEW.actualizado_em := now();
  NEW.versao := OLD.versao + 1;
  RETURN NEW;
END
$$;

CREATE TRIGGER canal_antes_de_gravar
  BEFORE INSERT OR UPDATE ON canal
  FOR EACH ROW EXECUTE FUNCTION canal_antes_de_gravar();

-- Listas: tomam a linha do mercado (a lista de base de um mercado activo e as
-- prioridades leem-se depois de esperar por quem o esteja a mudar).
CREATE FUNCTION lista_precos_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  estado_do_mercado text;
BEGIN
  SELECT m.estado INTO estado_do_mercado FROM public.mercado m
  WHERE m.comerciante_id = NEW.comerciante_id AND m.id = NEW.mercado_id
  FOR SHARE;

  IF TG_OP = 'INSERT' THEN
    IF NEW.estado <> 'activa' THEN
      RAISE EXCEPTION 'prices.invalid_transition: uma lista nasce activa';
    END IF;
    NEW.versao := 1;
    NEW.criado_em := now();
    NEW.actualizado_em := now();
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id OR NEW.comerciante_id <> OLD.comerciante_id
     OR NEW.mercado_id <> OLD.mercado_id OR NEW.tipo <> OLD.tipo THEN
    RAISE EXCEPTION 'prices.immutable_identity: o id, o comerciante, o mercado e o tipo de uma lista não mudam';
  END IF;
  IF OLD.estado = 'activa' AND NEW.estado = 'arquivada' AND NEW.tipo = 'base'
     AND estado_do_mercado = 'activo' THEN
    RAISE EXCEPTION 'prices.base_list_in_use: a lista de base de um mercado activo não se arquiva';
  END IF;
  NEW.criado_em := OLD.criado_em;
  NEW.actualizado_em := now();
  NEW.versao := OLD.versao + 1;
  RETURN NEW;
END
$$;

CREATE TRIGGER lista_precos_antes_de_gravar
  BEFORE INSERT OR UPDATE ON lista_precos
  FOR EACH ROW EXECUTE FUNCTION lista_precos_antes_de_gravar();

-- Preços: quem e quando, a lista activa e a versão.
CREATE FUNCTION preco_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem text := nullif(btrim(current_setting('eurolify.quem', true)), '');
BEGIN
  IF quem IS NULL THEN
    RAISE EXCEPTION 'prices.defined_by_required: quem define o preço (eurolify.quem) é obrigatório';
  END IF;
  IF length(quem) > 200 THEN
    RAISE EXCEPTION 'prices.defined_by_required: quem define o preço tem no máximo 200 caracteres';
  END IF;
  IF EXISTS (
    SELECT FROM public.lista_precos l
    WHERE l.comerciante_id = NEW.comerciante_id AND l.id = NEW.lista_id
      AND l.estado = 'arquivada') THEN
    RAISE EXCEPTION 'prices.list_archived: não se escrevem preços numa lista arquivada';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.lista_id <> OLD.lista_id OR NEW.variante_id <> OLD.variante_id
       OR NEW.comerciante_id <> OLD.comerciante_id THEN
      RAISE EXCEPTION 'prices.immutable_identity: a lista e a variante de um preço não mudam';
    END IF;
    NEW.versao := OLD.versao + 1;
  ELSE
    NEW.versao := 1;
  END IF;
  NEW.definido_por := quem;
  NEW.definido_em := now();
  RETURN NEW;
END
$$;

CREATE TRIGGER preco_antes_de_gravar
  BEFORE INSERT OR UPDATE ON preco
  FOR EACH ROW EXECUTE FUNCTION preco_antes_de_gravar();

-- O histórico, escrito com os direitos do dono (a API não tem INSERT nele).
-- A saída de um preço com a variante já apagada (o rascunho do artigo foi
-- apagado) regista-se sem pedir `eurolify.quem`, que o Catálogo não põe.
CREATE FUNCTION preco_depois_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem text := nullif(btrim(current_setting('eurolify.quem', true)), '');
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF quem IS NULL THEN
      IF EXISTS (
        SELECT FROM public.variante v
        WHERE v.comerciante_id = OLD.comerciante_id AND v.id = OLD.variante_id) THEN
        RAISE EXCEPTION 'prices.defined_by_required: quem tira o preço (eurolify.quem) é obrigatório';
      END IF;
      quem := 'catalogo:variante apagada';
    END IF;
    INSERT INTO public.historico_preco
      (comerciante_id, lista_id, variante_id, montante, gratuito, saiu, definido_por)
    VALUES (OLD.comerciante_id, OLD.lista_id, OLD.variante_id, NULL, NULL, true, left(quem, 200));
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' OR NEW.montante <> OLD.montante OR NEW.gratuito <> OLD.gratuito THEN
    INSERT INTO public.historico_preco
      (comerciante_id, lista_id, variante_id, montante, gratuito, saiu, definido_por)
    VALUES (NEW.comerciante_id, NEW.lista_id, NEW.variante_id, NEW.montante, NEW.gratuito, false, NEW.definido_por);
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER preco_depois_de_gravar
  AFTER INSERT OR UPDATE OR DELETE ON preco
  FOR EACH ROW EXECUTE FUNCTION preco_depois_de_gravar();

-- RLS forçado em todas, com a política por comerciante (como a 0007).
DO $$
DECLARE
  tabela text;
BEGIN
  FOREACH tabela IN ARRAY ARRAY['mercado', 'canal', 'canal_mercado', 'lista_precos', 'preco', 'historico_preco'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tabela);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tabela);
    EXECUTE format(
      'CREATE POLICY so_o_proprio ON %I USING (comerciante_id = comerciante_actual()) WITH CHECK (comerciante_id = comerciante_actual())',
      tabela);
  END LOOP;
END
$$;

GRANT SELECT ON mercado, canal, canal_mercado, lista_precos, preco, historico_preco TO eurolify_api;
GRANT INSERT (comerciante_id, loja_id, nome, paises, moeda, linguas, lingua_principal, preco_inclui_iva)
  ON mercado TO eurolify_api;
GRANT UPDATE (nome, paises, moeda, linguas, lingua_principal, preco_inclui_iva, estado)
  ON mercado TO eurolify_api;
GRANT INSERT (comerciante_id, loja_id, nome) ON canal TO eurolify_api;
GRANT UPDATE (nome, estado) ON canal TO eurolify_api;
GRANT INSERT, DELETE ON canal_mercado TO eurolify_api;
GRANT INSERT (comerciante_id, mercado_id, nome, tipo, etiqueta_id, prioridade)
  ON lista_precos TO eurolify_api;
GRANT UPDATE (nome, etiqueta_id, prioridade, estado) ON lista_precos TO eurolify_api;
GRANT INSERT (comerciante_id, lista_id, variante_id, montante, gratuito, quantidade_minima, multiplo)
  ON preco TO eurolify_api;
GRANT UPDATE (montante, gratuito, quantidade_minima, multiplo) ON preco TO eurolify_api;
GRANT DELETE ON preco TO eurolify_api;
