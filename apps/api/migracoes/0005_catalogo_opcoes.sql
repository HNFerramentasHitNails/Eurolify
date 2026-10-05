-- Domínio Catálogo, parte 2b: opções e valores (docs/14 §3.3 e §3.2; issue
-- #77). Ex.: a opção «Cor» com os valores «Vermelho 12» e «Nude 3»; cada
-- variante do artigo leva um valor de cada opção.
--
-- Regras (as marcadas «proposta» são desta parte do código, docs/14 §3.3):
-- - um artigo sem opções pode ter várias variantes (P10, Diogo, 05/10/2026);
-- - com opções, cada variante activa leva **um valor de cada opção**, e duas
--   variantes activas do mesmo artigo não têm a mesma combinação (§3.2; P10).
--   Uma variante arquivada não conta: a combinação dela volta a ficar livre
--   (proposta: é assim que se substitui uma variante);
-- - as opções só se criam (e apagam) enquanto o artigo é rascunho (proposta:
--   uma opção nova num artigo à venda deixava as variantes vendidas sem
--   valor); valores novos acrescentam-se sempre;
-- - os valores de uma variante dão-se ao criá-la; depois só mudam enquanto o
--   artigo é rascunho (proposta: depois de vendida, a variante não muda de
--   identidade);
-- - num rascunho, a combinação pode estar incompleta; activar (ou repor) o
--   artigo exige-a completa em todas as variantes activas; num artigo que já
--   não é rascunho, verifica-se no fim de cada transacção;
-- - nomes de opção únicos no artigo e valores únicos na opção, sem distinguir
--   maiúsculas (proposta, como o SKU, P9).
--
-- Os textos (nome e valor) são do original; as traduções são da parte 3.

-- Para as chaves compostas: a variante e o artigo dela.
ALTER TABLE variante ADD CONSTRAINT variante_artigo_id_unico UNIQUE (comerciante_id, artigo_id, id);

CREATE TABLE opcao (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL,
  artigo_id uuid NOT NULL,
  nome text NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 100),
  posicao integer NOT NULL DEFAULT 0 CHECK (posicao >= 0),
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT opcao_do_artigo UNIQUE (comerciante_id, artigo_id, id),
  -- Apagar o rascunho do artigo leva as opções.
  CONSTRAINT opcao_artigo FOREIGN KEY (comerciante_id, artigo_id)
    REFERENCES artigo (comerciante_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX opcao_nome_unico ON opcao (comerciante_id, artigo_id, lower(btrim(nome)));

CREATE TABLE valor_opcao (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL,
  artigo_id uuid NOT NULL,
  opcao_id uuid NOT NULL,
  valor text NOT NULL CHECK (length(btrim(valor)) BETWEEN 1 AND 100),
  posicao integer NOT NULL DEFAULT 0 CHECK (posicao >= 0),
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT valor_da_opcao UNIQUE (comerciante_id, artigo_id, opcao_id, id),
  CONSTRAINT valor_opcao_opcao FOREIGN KEY (comerciante_id, artigo_id, opcao_id)
    REFERENCES opcao (comerciante_id, artigo_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX valor_opcao_unico ON valor_opcao (comerciante_id, opcao_id, lower(btrim(valor)));

-- O valor que cada variante leva em cada opção. As chaves compostas garantem
-- que a opção, o valor e a variante são do mesmo artigo e comerciante.
CREATE TABLE variante_valor (
  comerciante_id uuid NOT NULL,
  artigo_id uuid NOT NULL,
  variante_id uuid NOT NULL,
  opcao_id uuid NOT NULL,
  valor_id uuid NOT NULL,
  PRIMARY KEY (variante_id, opcao_id),
  CONSTRAINT variante_valor_variante FOREIGN KEY (comerciante_id, artigo_id, variante_id)
    REFERENCES variante (comerciante_id, artigo_id, id) ON DELETE CASCADE,
  CONSTRAINT variante_valor_valor FOREIGN KEY (comerciante_id, artigo_id, opcao_id, valor_id)
    REFERENCES valor_opcao (comerciante_id, artigo_id, opcao_id, id) ON DELETE CASCADE
);
CREATE INDEX variante_valor_por_valor ON variante_valor (comerciante_id, valor_id);

-- Uma fila por artigo para tudo o que mexe nas combinações dele.
CREATE FUNCTION catalogo_fila_do_artigo(artigo uuid) RETURNS void
  LANGUAGE sql SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT pg_advisory_xact_lock(hashtextextended('eurolify.opcoes:' || artigo::text, 0))
$$;

-- Estado do artigo, lido dentro dos triggers.
CREATE FUNCTION catalogo_estado_do_artigo(comerciante uuid, artigo uuid) RETURNS text
  LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT a.estado FROM public.artigo a WHERE a.comerciante_id = comerciante AND a.id = artigo
$$;

-- Opção: só num rascunho; o artigo dela não muda.
CREATE FUNCTION opcao_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  linha public.opcao;
  estado text;
BEGIN
  linha := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  PERFORM public.catalogo_fila_do_artigo(linha.artigo_id);
  estado := public.catalogo_estado_do_artigo(linha.comerciante_id, linha.artigo_id);
  IF TG_OP = 'UPDATE' AND (NEW.comerciante_id <> OLD.comerciante_id
      OR NEW.artigo_id <> OLD.artigo_id) THEN
    RAISE EXCEPTION 'catalog.immutable_identity: o artigo de uma opção não muda';
  END IF;
  -- Sem artigo: está a ser apagado (rascunho) e as opções vão com ele.
  IF TG_OP IN ('INSERT', 'DELETE') AND estado IS NOT NULL AND estado <> 'rascunho' THEN
    RAISE EXCEPTION 'catalog.not_draft: as opções só se criam ou apagam num rascunho';
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.criado_em := now();
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.criado_em := OLD.criado_em;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;
CREATE TRIGGER opcao_antes_de_gravar
  BEFORE INSERT OR UPDATE OR DELETE ON opcao
  FOR EACH ROW EXECUTE FUNCTION opcao_antes_de_gravar();

-- Valor: acrescenta-se sempre; apaga-se só num rascunho; a opção não muda.
CREATE FUNCTION valor_opcao_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  linha public.valor_opcao;
  estado text;
BEGIN
  linha := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  PERFORM public.catalogo_fila_do_artigo(linha.artigo_id);
  estado := public.catalogo_estado_do_artigo(linha.comerciante_id, linha.artigo_id);
  IF TG_OP = 'UPDATE' AND (NEW.comerciante_id <> OLD.comerciante_id
      OR NEW.artigo_id <> OLD.artigo_id OR NEW.opcao_id <> OLD.opcao_id) THEN
    RAISE EXCEPTION 'catalog.immutable_identity: a opção de um valor não muda';
  END IF;
  IF TG_OP = 'DELETE' AND estado IS NOT NULL AND estado <> 'rascunho' THEN
    RAISE EXCEPTION 'catalog.not_draft: um valor só se apaga num rascunho';
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.criado_em := now();
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.criado_em := OLD.criado_em;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;
CREATE TRIGGER valor_opcao_antes_de_gravar
  BEFORE INSERT OR UPDATE OR DELETE ON valor_opcao
  FOR EACH ROW EXECUTE FUNCTION valor_opcao_antes_de_gravar();

-- Valor de uma variante: dá-se a uma variante activa; num artigo que não é
-- rascunho, só a uma variante que ainda não tem valor nessa opção (a que se
-- está a criar); mudar ou tirar, só num rascunho.
CREATE FUNCTION variante_valor_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  linha public.variante_valor;
  estado text;
  estado_da_variante text;
BEGIN
  linha := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  PERFORM public.catalogo_fila_do_artigo(linha.artigo_id);
  estado := public.catalogo_estado_do_artigo(linha.comerciante_id, linha.artigo_id);
  IF TG_OP = 'DELETE' THEN
    -- Sem artigo, ou sem a variante: está a ser apagado e vai com ele.
    IF estado IS NOT NULL AND estado <> 'rascunho' AND EXISTS (
      SELECT FROM public.variante v
      WHERE v.comerciante_id = OLD.comerciante_id AND v.id = OLD.variante_id) THEN
      RAISE EXCEPTION 'catalog.not_draft: os valores de uma variante só mudam num rascunho';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.comerciante_id <> OLD.comerciante_id OR NEW.artigo_id <> OLD.artigo_id
       OR NEW.variante_id <> OLD.variante_id OR NEW.opcao_id <> OLD.opcao_id THEN
      RAISE EXCEPTION 'catalog.immutable_identity: a variante e a opção de um valor não mudam';
    END IF;
    IF estado <> 'rascunho' THEN
      RAISE EXCEPTION 'catalog.not_draft: os valores de uma variante só mudam num rascunho';
    END IF;
  END IF;
  SELECT v.estado INTO estado_da_variante FROM public.variante v
  WHERE v.comerciante_id = NEW.comerciante_id AND v.id = NEW.variante_id;
  IF estado_da_variante = 'arquivada' THEN
    RAISE EXCEPTION 'catalog.variant_archived_is_final: uma variante arquivada não muda';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER variante_valor_antes_de_gravar
  BEFORE INSERT OR UPDATE OR DELETE ON variante_valor
  FOR EACH ROW EXECUTE FUNCTION variante_valor_antes_de_gravar();

-- As combinações de um artigo: nenhuma repetida entre as variantes activas
-- completas; e, se o artigo não é rascunho, todas as activas completas.
CREATE FUNCTION catalogo_verificar_combinacoes(comerciante uuid, artigo uuid) RETURNS void
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  n_opcoes integer;
  estado text;
BEGIN
  PERFORM public.catalogo_fila_do_artigo(artigo);
  estado := public.catalogo_estado_do_artigo(comerciante, artigo);
  IF estado IS NULL THEN
    RETURN;  -- o artigo foi apagado (rascunho)
  END IF;
  SELECT count(*) INTO n_opcoes FROM public.opcao o
  WHERE o.comerciante_id = comerciante AND o.artigo_id = artigo;
  IF n_opcoes = 0 THEN
    RETURN;  -- sem opções, várias variantes são permitidas (P10)
  END IF;
  IF estado <> 'rascunho' AND EXISTS (
    SELECT FROM public.variante v
    WHERE v.comerciante_id = comerciante AND v.artigo_id = artigo AND v.estado = 'activa'
      AND (SELECT count(*) FROM public.variante_valor vv
           WHERE vv.comerciante_id = comerciante AND vv.variante_id = v.id) <> n_opcoes
  ) THEN
    RAISE EXCEPTION 'catalog.options_incomplete: cada variante activa leva um valor de cada opção';
  END IF;
  IF EXISTS (
    SELECT FROM (
      SELECT string_agg(vv.valor_id::text, ',' ORDER BY vv.opcao_id) AS combinacao,
             count(*) AS n
      FROM public.variante v
      JOIN public.variante_valor vv
        ON vv.comerciante_id = v.comerciante_id AND vv.variante_id = v.id
      WHERE v.comerciante_id = comerciante AND v.artigo_id = artigo AND v.estado = 'activa'
      GROUP BY v.id
    ) c
    WHERE c.n = n_opcoes
    GROUP BY c.combinacao HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'catalog.option_combination_duplicate: duas variantes activas com a mesma combinação';
  END IF;
END
$$;

-- No fim da transacção (as variantes e os valores entram em várias
-- instruções), depois de qualquer mudança nos valores das variantes ou numa
-- variante nova.
CREATE FUNCTION variante_valor_no_fim() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  linha public.variante_valor;
BEGIN
  linha := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  PERFORM public.catalogo_verificar_combinacoes(linha.comerciante_id, linha.artigo_id);
  RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER variante_valor_no_fim
  AFTER INSERT OR UPDATE OR DELETE ON variante_valor
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION variante_valor_no_fim();

CREATE FUNCTION variante_nova_no_fim() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM public.catalogo_verificar_combinacoes(NEW.comerciante_id, NEW.artigo_id);
  RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER variante_nova_no_fim
  AFTER INSERT ON variante
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION variante_nova_no_fim();

-- Activar ou repor o artigo exige as combinações completas e sem repetidos.
CREATE FUNCTION artigo_combinacoes_ao_activar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  n_opcoes integer;
BEGIN
  PERFORM public.catalogo_fila_do_artigo(NEW.id);
  SELECT count(*) INTO n_opcoes FROM public.opcao o
  WHERE o.comerciante_id = NEW.comerciante_id AND o.artigo_id = NEW.id;
  IF n_opcoes > 0 AND EXISTS (
    SELECT FROM public.variante v
    WHERE v.comerciante_id = NEW.comerciante_id AND v.artigo_id = NEW.id AND v.estado = 'activa'
      AND (SELECT count(*) FROM public.variante_valor vv
           WHERE vv.comerciante_id = NEW.comerciante_id AND vv.variante_id = v.id) <> n_opcoes
  ) THEN
    RAISE EXCEPTION 'catalog.options_incomplete: cada variante activa leva um valor de cada opção';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER artigo_combinacoes_ao_activar
  BEFORE UPDATE ON artigo
  FOR EACH ROW WHEN (NEW.estado = 'activo' AND OLD.estado IS DISTINCT FROM 'activo')
  EXECUTE FUNCTION artigo_combinacoes_ao_activar();

DO $$
DECLARE
  tabela text;
BEGIN
  FOREACH tabela IN ARRAY ARRAY['opcao', 'valor_opcao', 'variante_valor']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tabela);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tabela);
    EXECUTE format(
      'CREATE POLICY so_o_proprio ON %I USING (comerciante_id = comerciante_actual()) WITH CHECK (comerciante_id = comerciante_actual())',
      tabela);
  END LOOP;
END
$$;

-- A API não escolhe ids nem datas; muda textos e posições; apaga (os
-- triggers só deixam num rascunho).
GRANT SELECT, DELETE ON opcao, valor_opcao, variante_valor TO eurolify_api;
GRANT INSERT (comerciante_id, artigo_id, nome, posicao) ON opcao TO eurolify_api;
GRANT UPDATE (nome, posicao) ON opcao TO eurolify_api;
GRANT INSERT (comerciante_id, artigo_id, opcao_id, valor, posicao) ON valor_opcao TO eurolify_api;
GRANT UPDATE (valor, posicao) ON valor_opcao TO eurolify_api;
GRANT INSERT (comerciante_id, artigo_id, variante_id, opcao_id, valor_id) ON variante_valor TO eurolify_api;
GRANT UPDATE (valor_id) ON variante_valor TO eurolify_api;
