-- Domínio Catálogo, parte 3a: categorias e colecções manuais (docs/14 §3.6,
-- §3.7 e §3.1 «categorias»; issue #77). Ex.: a categoria «Unhas de gel»
-- (endereço `unhas-de-gel`) dentro de «Unhas», e a colecção manual «Novidades
-- de Outono», com os artigos pela ordem que o comerciante escolher.
--
-- Regras (as marcadas «proposta» são desta parte do código, docs/14 §3.6 e
-- §3.7):
-- - a árvore de categorias não tem ciclos (§3.6): uma categoria não fica
--   dentro de si própria, nem por outra;
-- - uma categoria nasce activa; arquivar e repor são livres; arquivar não
--   arquiva os artigos (§3.6) nem os tira da categoria;
-- - uma categoria activa não fica dentro de uma arquivada, e uma categoria
--   com subcategorias activas não se arquiva (proposta: na loja, a
--   subcategoria ficava sem caminho);
-- - um artigo só entra numa categoria activa; uma categoria arquivada que o
--   artigo já tinha pode ficar quando se muda o resto da lista (proposta,
--   como os componentes dos kits, revisão do #81, P2-1);
-- - categorias e colecções não se apagam: arquivam-se (proposta: o rasto,
--   `catalog-pim`, regra 7);
-- - o endereço amigável é obrigatório, em minúsculas sem acentos, algarismos
--   e hífenes, e único por comerciante entre as categorias e, à parte, entre
--   as colecções, também as arquivadas (proposta: um endereço antigo não
--   passa a mostrar outra coisa). As traduções (dos nomes e dos endereços)
--   são da parte 3b;
-- - a colecção é uma lista manual, ordenada, sem repetidos; qualquer artigo
--   pode entrar (a loja só mostra os publicados, §7.2); apagar o rascunho de
--   um artigo tira-o das categorias e das colecções.
--
-- Concorrência: as escritas nas categorias de um comerciante passam por uma
-- fila só delas (o ciclo e o «sem subcategorias activas» olham para várias
-- linhas), como os kits na 0004. Assumem READ COMMITTED (base/ligacao.ts).

CREATE TABLE categoria (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  pai_id uuid,
  nome text NOT NULL,
  endereco_amigavel text NOT NULL,
  posicao integer NOT NULL DEFAULT 0 CHECK (posicao >= 0),
  estado text NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa', 'arquivada')),
  criado_em timestamptz NOT NULL DEFAULT now(),
  actualizado_em timestamptz NOT NULL DEFAULT now(),
  versao integer NOT NULL DEFAULT 1,
  CONSTRAINT categoria_nome_check CHECK (length(btrim(nome)) > 0),
  CONSTRAINT categoria_nome_comprimento CHECK (length(nome) <= 200),
  CONSTRAINT categoria_endereco_valido CHECK (
    endereco_amigavel ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    AND length(endereco_amigavel) <= 100),
  CONSTRAINT categoria_nao_e_o_pai CHECK (pai_id <> id),
  UNIQUE (comerciante_id, id),
  -- O pai é do mesmo comerciante.
  CONSTRAINT categoria_do_pai FOREIGN KEY (comerciante_id, pai_id)
    REFERENCES categoria (comerciante_id, id)
);
CREATE UNIQUE INDEX categoria_endereco_unico
  ON categoria (comerciante_id, endereco_amigavel);
CREATE INDEX categoria_por_pai ON categoria (comerciante_id, pai_id);

CREATE FUNCTION categoria_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  estado_do_pai text;
BEGIN
  -- A fila das categorias do comerciante: o ciclo e as subcategorias activas
  -- lêem-se depois de esperar por ela, com o que os outros já confirmaram.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('eurolify.categoria:' || NEW.comerciante_id::text, 0));

  IF TG_OP = 'INSERT' THEN
    IF NEW.estado <> 'activa' THEN
      RAISE EXCEPTION 'catalog.invalid_transition: uma categoria nasce activa';
    END IF;
    NEW.versao := 1;
    NEW.criado_em := now();
    NEW.actualizado_em := now();
  ELSE
    IF NEW.id <> OLD.id OR NEW.comerciante_id <> OLD.comerciante_id THEN
      RAISE EXCEPTION 'catalog.immutable_identity: o id e o comerciante de uma categoria não mudam';
    END IF;
    NEW.criado_em := OLD.criado_em;
    NEW.versao := OLD.versao + 1;
    NEW.actualizado_em := now();
  END IF;

  -- O pai (ao nascer, ao mudar de pai ou ao repor): activo, e sem ciclos.
  IF NEW.pai_id IS NOT NULL AND (
       TG_OP = 'INSERT'
       OR NEW.pai_id IS DISTINCT FROM OLD.pai_id
       OR NEW.estado IS DISTINCT FROM OLD.estado) THEN
    SELECT c.estado INTO estado_do_pai FROM public.categoria c
    WHERE c.comerciante_id = NEW.comerciante_id AND c.id = NEW.pai_id;
    -- Sem pai visível: a chave estrangeira recusa-o («não existe»).
    IF NEW.estado = 'activa' AND estado_do_pai = 'arquivada' THEN
      RAISE EXCEPTION 'catalog.category_archived: uma categoria activa não fica dentro de uma arquivada';
    END IF;
    IF TG_OP = 'UPDATE' AND EXISTS (
      WITH RECURSIVE acima (id) AS (
        SELECT NEW.pai_id
        UNION
        SELECT c.pai_id FROM public.categoria c
        JOIN acima ON c.comerciante_id = NEW.comerciante_id AND c.id = acima.id
        WHERE c.pai_id IS NOT NULL
      )
      SELECT FROM acima WHERE acima.id = NEW.id
    ) THEN
      RAISE EXCEPTION 'catalog.category_cycle: a categoria ficava dentro de si própria';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.estado = 'arquivada' AND OLD.estado = 'activa'
     AND EXISTS (
       SELECT FROM public.categoria c
       WHERE c.comerciante_id = NEW.comerciante_id
         AND c.pai_id = NEW.id AND c.estado = 'activa') THEN
    RAISE EXCEPTION 'catalog.category_has_children: arquivar primeiro as subcategorias activas';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER categoria_antes_de_gravar
  BEFORE INSERT OR UPDATE ON categoria
  FOR EACH ROW EXECUTE FUNCTION categoria_antes_de_gravar();

-- As categorias de um artigo (§3.1). Apagar o rascunho do artigo leva-as.
CREATE TABLE artigo_categoria (
  comerciante_id uuid NOT NULL,
  artigo_id uuid NOT NULL,
  categoria_id uuid NOT NULL,
  PRIMARY KEY (comerciante_id, artigo_id, categoria_id),
  CONSTRAINT artigo_categoria_do_artigo FOREIGN KEY (comerciante_id, artigo_id)
    REFERENCES artigo (comerciante_id, id) ON DELETE CASCADE,
  CONSTRAINT artigo_categoria_da_categoria FOREIGN KEY (comerciante_id, categoria_id)
    REFERENCES categoria (comerciante_id, id)
);
CREATE INDEX artigo_categoria_por_categoria
  ON artigo_categoria (comerciante_id, categoria_id);

-- Só entra numa categoria activa. Arquivar a categoria ao mesmo tempo não
-- muda nada que importe: arquivar não tira os artigos (§3.6).
CREATE FUNCTION artigo_categoria_antes_de_inserir() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF EXISTS (
    SELECT FROM public.categoria c
    WHERE c.comerciante_id = NEW.comerciante_id AND c.id = NEW.categoria_id
      AND c.estado = 'arquivada') THEN
    RAISE EXCEPTION 'catalog.category_archived: um artigo não entra numa categoria arquivada';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER artigo_categoria_antes_de_inserir
  BEFORE INSERT ON artigo_categoria
  FOR EACH ROW EXECUTE FUNCTION artigo_categoria_antes_de_inserir();

CREATE TABLE colecao (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  nome text NOT NULL,
  descricao text,
  endereco_amigavel text NOT NULL,
  estado text NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa', 'arquivada')),
  criado_em timestamptz NOT NULL DEFAULT now(),
  actualizado_em timestamptz NOT NULL DEFAULT now(),
  versao integer NOT NULL DEFAULT 1,
  CONSTRAINT colecao_nome_check CHECK (length(btrim(nome)) > 0),
  CONSTRAINT colecao_nome_comprimento CHECK (length(nome) <= 200),
  CONSTRAINT colecao_endereco_valido CHECK (
    endereco_amigavel ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    AND length(endereco_amigavel) <= 100),
  UNIQUE (comerciante_id, id)
);
CREATE UNIQUE INDEX colecao_endereco_unico
  ON colecao (comerciante_id, endereco_amigavel);

CREATE FUNCTION colecao_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.estado <> 'activa' THEN
      RAISE EXCEPTION 'catalog.invalid_transition: uma colecção nasce activa';
    END IF;
    NEW.versao := 1;
    NEW.criado_em := now();
    NEW.actualizado_em := now();
    RETURN NEW;
  END IF;
  IF NEW.id <> OLD.id OR NEW.comerciante_id <> OLD.comerciante_id THEN
    RAISE EXCEPTION 'catalog.immutable_identity: o id e o comerciante de uma colecção não mudam';
  END IF;
  NEW.criado_em := OLD.criado_em;
  NEW.versao := OLD.versao + 1;
  NEW.actualizado_em := now();
  RETURN NEW;
END
$$;

CREATE TRIGGER colecao_antes_de_gravar
  BEFORE INSERT OR UPDATE ON colecao
  FOR EACH ROW EXECUTE FUNCTION colecao_antes_de_gravar();

-- Os artigos de uma colecção, pela ordem (§3.7). Apagar o rascunho do artigo
-- tira-o da colecção.
CREATE TABLE colecao_artigo (
  comerciante_id uuid NOT NULL,
  colecao_id uuid NOT NULL,
  artigo_id uuid NOT NULL,
  posicao integer NOT NULL CHECK (posicao >= 0),
  PRIMARY KEY (comerciante_id, colecao_id, artigo_id),
  CONSTRAINT colecao_artigo_da_colecao FOREIGN KEY (comerciante_id, colecao_id)
    REFERENCES colecao (comerciante_id, id),
  CONSTRAINT colecao_artigo_do_artigo FOREIGN KEY (comerciante_id, artigo_id)
    REFERENCES artigo (comerciante_id, id) ON DELETE CASCADE
);
CREATE INDEX colecao_artigo_por_artigo ON colecao_artigo (comerciante_id, artigo_id);

-- RLS forçado, como na 0001.
DO $$
DECLARE
  tabela text;
BEGIN
  FOREACH tabela IN ARRAY ARRAY['categoria', 'artigo_categoria', 'colecao', 'colecao_artigo']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tabela);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tabela);
    EXECUTE format(
      'CREATE POLICY so_o_proprio ON %I USING (comerciante_id = comerciante_actual()) WITH CHECK (comerciante_id = comerciante_actual())',
      tabela);
  END LOOP;
END
$$;

-- A API não escolhe ids, datas nem versões; categorias e colecções não se
-- apagam (arquivam-se); as ligações apagam-se para mudar a lista.
GRANT SELECT ON categoria, colecao TO eurolify_api;
GRANT INSERT (comerciante_id, pai_id, nome, endereco_amigavel, posicao)
  ON categoria TO eurolify_api;
GRANT UPDATE (pai_id, nome, endereco_amigavel, posicao, estado)
  ON categoria TO eurolify_api;
GRANT INSERT (comerciante_id, nome, descricao, endereco_amigavel)
  ON colecao TO eurolify_api;
GRANT UPDATE (nome, descricao, endereco_amigavel, estado)
  ON colecao TO eurolify_api;
GRANT SELECT, DELETE ON artigo_categoria, colecao_artigo TO eurolify_api;
GRANT INSERT (comerciante_id, artigo_id, categoria_id)
  ON artigo_categoria TO eurolify_api;
GRANT INSERT (comerciante_id, colecao_id, artigo_id, posicao)
  ON colecao_artigo TO eurolify_api;
