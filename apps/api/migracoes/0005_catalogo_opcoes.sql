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
--   valor); valores novos acrescentam-se sempre; o texto de uma opção ou de
--   um valor só muda num rascunho (Diogo, 05/10/2026, revisão do #83, P2-4:
--   «não, bloqueia fora do rascunho»); a ordem muda sempre;
-- - os valores de uma variante dão-se ao criá-la; depois só mudam enquanto o
--   artigo é rascunho (proposta: depois de vendida, a variante não muda de
--   identidade);
-- - num rascunho, a combinação pode estar incompleta; activar (ou repor) o
--   artigo exige-a completa e sem repetidos em todas as variantes activas; em
--   qualquer estado, as combinações verificam-se no fim de cada transacção que
--   lhes toque (valores, variantes novas, opções criadas ou apagadas), uma vez
--   por artigo (revisão do #83, P1-1 e P2-1);
-- - as verificações assumem READ COMMITTED (o da API, base/ligacao.ts): cada
--   instrução vê o que os outros já confirmaram depois de esperar pela fila.
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
-- que a opção, o valor e a variante são do mesmo artigo e comerciante; a
-- chave primária leva o comerciante, para um comerciante não saber, pelo erro,
-- se uma linha de outro existe (revisão do #83, P2-3b).
CREATE TABLE variante_valor (
  comerciante_id uuid NOT NULL,
  artigo_id uuid NOT NULL,
  variante_id uuid NOT NULL,
  opcao_id uuid NOT NULL,
  valor_id uuid NOT NULL,
  CONSTRAINT variante_valor_pkey PRIMARY KEY (comerciante_id, variante_id, opcao_id),
  CONSTRAINT variante_valor_variante FOREIGN KEY (comerciante_id, artigo_id, variante_id)
    REFERENCES variante (comerciante_id, artigo_id, id) ON DELETE CASCADE,
  CONSTRAINT variante_valor_valor FOREIGN KEY (comerciante_id, artigo_id, opcao_id, valor_id)
    REFERENCES valor_opcao (comerciante_id, artigo_id, opcao_id, id) ON DELETE CASCADE
);
CREATE INDEX variante_valor_por_valor ON variante_valor (comerciante_id, valor_id);

-- Uma fila por artigo para tudo o que mexe nas combinações dele. A chave leva
-- o comerciante do contexto (ou o da linha, sem contexto): um comerciante não
-- entra na fila de outro, nem chamando a função directamente (revisão do #83,
-- P2-3a).
CREATE FUNCTION catalogo_fila_do_artigo(comerciante uuid, artigo uuid) RETURNS void
  LANGUAGE sql SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT pg_advisory_xact_lock(hashtextextended('eurolify.opcoes:' ||
    coalesce(nullif(current_setting('eurolify.comerciante', true), '')::uuid, comerciante)::text
    || ':' || artigo::text, 0))
$$;

-- Estado do artigo, lido dentro dos triggers.
CREATE FUNCTION catalogo_estado_do_artigo(comerciante uuid, artigo uuid) RETURNS text
  LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT a.estado FROM public.artigo a WHERE a.comerciante_id = comerciante AND a.id = artigo
$$;

-- Artigos com combinações por verificar no fim desta transacção. A API não
-- tem acesso a esta tabela: só as duas funções abaixo (com os direitos do
-- dono) escrevem nela. Assim a verificação corre uma vez por artigo e por
-- transacção (revisão do #83, P2-1: com uma verificação por linha, 512
-- variantes demoravam 220 s), e a API não a pode dar por feita — ao
-- contrário de uma marca em set_config, que ela própria poderia pôr.
-- A chave leva o comerciante: uma marca com outro comerciante não ocupa o
-- lugar da verdadeira (revisão do #83, 2.ª, P1-1).
CREATE TABLE combinacoes_por_verificar (
  comerciante_id uuid NOT NULL,
  artigo_id uuid NOT NULL,
  transaccao xid8 NOT NULL,
  PRIMARY KEY (comerciante_id, artigo_id, transaccao)
);
CREATE INDEX combinacoes_por_verificar_transaccao ON combinacoes_por_verificar (transaccao);

-- Só os triggers marcam (pg_trigger_depth() > 0): a API não a chama
-- directamente, nem com outros argumentos. Ao marcar, tira as marcas de
-- transacções que já acabaram (uma linha que não entrou, por exemplo com
-- ON CONFLICT DO NOTHING, marcou sem verificar) para a tabela não crescer
-- (revisão do #83, 2.ª, P2-2).
CREATE FUNCTION catalogo_marcar_combinacoes(comerciante uuid, artigo uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF pg_trigger_depth() = 0 THEN
    RAISE EXCEPTION 'só os triggers do catálogo marcam combinações'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- SKIP LOCKED: duas sessões a limpar ao mesmo tempo não esperam uma pela
  -- outra (nem um comerciante pelo outro); um pouco de cada vez.
  DELETE FROM public.combinacoes_por_verificar
  WHERE ctid IN (
    SELECT ctid FROM public.combinacoes_por_verificar
    WHERE transaccao < pg_snapshot_xmin(pg_current_snapshot())
    LIMIT 100
    FOR UPDATE SKIP LOCKED);
  INSERT INTO public.combinacoes_por_verificar (comerciante_id, artigo_id, transaccao)
  VALUES (comerciante, artigo, pg_current_xact_id())
  ON CONFLICT DO NOTHING;
END
$$;

-- Devolve verdadeiro (e tira a marca) só à primeira chamada depois de marcar.
CREATE FUNCTION catalogo_tirar_marca(comerciante uuid, artigo uuid) RETURNS boolean
  LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  WITH tirada AS (
    DELETE FROM public.combinacoes_por_verificar
    WHERE artigo_id = artigo AND transaccao = pg_current_xact_id()
      AND comerciante_id = comerciante
    RETURNING 1
  )
  SELECT EXISTS (SELECT FROM tirada)
$$;

-- Opção: só se cria e apaga num rascunho; o texto só muda num rascunho; o
-- artigo dela não muda.
CREATE FUNCTION opcao_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  linha public.opcao;
  estado text;
BEGIN
  linha := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  PERFORM public.catalogo_fila_do_artigo(linha.comerciante_id, linha.artigo_id);
  estado := public.catalogo_estado_do_artigo(linha.comerciante_id, linha.artigo_id);
  IF TG_OP = 'UPDATE' AND (NEW.comerciante_id <> OLD.comerciante_id
      OR NEW.artigo_id <> OLD.artigo_id) THEN
    RAISE EXCEPTION 'catalog.immutable_identity: o artigo de uma opção não muda';
  END IF;
  -- Sem artigo: está a ser apagado (rascunho) e as opções vão com ele.
  IF estado IS NOT NULL AND estado <> 'rascunho' AND (TG_OP IN ('INSERT', 'DELETE')
      OR NEW.nome IS DISTINCT FROM OLD.nome) THEN
    RAISE EXCEPTION 'catalog.not_draft: as opções só se criam, apagam ou mudam de nome num rascunho';
  END IF;
  IF TG_OP <> 'UPDATE' AND estado IS NOT NULL THEN
    PERFORM public.catalogo_marcar_combinacoes(linha.comerciante_id, linha.artigo_id);
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

-- Valor: acrescenta-se sempre; apaga-se e muda de texto só num rascunho; a
-- opção não muda.
CREATE FUNCTION valor_opcao_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  linha public.valor_opcao;
  estado text;
BEGIN
  linha := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  PERFORM public.catalogo_fila_do_artigo(linha.comerciante_id, linha.artigo_id);
  estado := public.catalogo_estado_do_artigo(linha.comerciante_id, linha.artigo_id);
  IF TG_OP = 'UPDATE' AND (NEW.comerciante_id <> OLD.comerciante_id
      OR NEW.artigo_id <> OLD.artigo_id OR NEW.opcao_id <> OLD.opcao_id) THEN
    RAISE EXCEPTION 'catalog.immutable_identity: a opção de um valor não muda';
  END IF;
  IF estado IS NOT NULL AND estado <> 'rascunho' AND (TG_OP = 'DELETE'
      OR (TG_OP = 'UPDATE' AND NEW.valor IS DISTINCT FROM OLD.valor)) THEN
    RAISE EXCEPTION 'catalog.not_draft: um valor só se apaga ou muda de texto num rascunho';
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

-- Valor de uma variante: dá-se a uma variante activa; mudar ou tirar só num
-- rascunho. (Num artigo que não é rascunho não há regra própria para quem
-- recebe valores: a verificação no fim exige as activas completas e sem
-- repetidos, e a chave primária impede dois valores na mesma opção.)
CREATE FUNCTION variante_valor_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  linha public.variante_valor;
  estado text;
  estado_da_variante text;
BEGIN
  linha := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  PERFORM public.catalogo_fila_do_artigo(linha.comerciante_id, linha.artigo_id);
  estado := public.catalogo_estado_do_artigo(linha.comerciante_id, linha.artigo_id);
  SELECT v.estado INTO estado_da_variante FROM public.variante v
  WHERE v.comerciante_id = linha.comerciante_id AND v.id = linha.variante_id;
  IF TG_OP = 'DELETE' THEN
    -- Vem de apagar a variante, o valor ou a opção (cascata, profundidade
    -- > 1): deixa; a variante ou o artigo já estão a ser apagados, ou é um
    -- rascunho (as opções e os valores só se apagam aí).
    IF pg_trigger_depth() = 1 THEN
      IF estado IS NOT NULL AND estado <> 'rascunho' THEN
        RAISE EXCEPTION 'catalog.not_draft: os valores de uma variante só mudam num rascunho';
      END IF;
      IF estado_da_variante = 'arquivada' THEN
        RAISE EXCEPTION 'catalog.variant_archived_is_final: uma variante arquivada não muda';
      END IF;
    END IF;
    IF estado IS NOT NULL THEN
      PERFORM public.catalogo_marcar_combinacoes(OLD.comerciante_id, OLD.artigo_id);
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
  IF estado_da_variante = 'arquivada' THEN
    RAISE EXCEPTION 'catalog.variant_archived_is_final: uma variante arquivada não muda';
  END IF;
  PERFORM public.catalogo_marcar_combinacoes(NEW.comerciante_id, NEW.artigo_id);
  RETURN NEW;
END
$$;
CREATE TRIGGER variante_valor_antes_de_gravar
  BEFORE INSERT OR UPDATE OR DELETE ON variante_valor
  FOR EACH ROW EXECUTE FUNCTION variante_valor_antes_de_gravar();

-- Uma variante nova marca o artigo para verificar no fim.
CREATE FUNCTION variante_nova_marca() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM public.catalogo_marcar_combinacoes(NEW.comerciante_id, NEW.artigo_id);
  RETURN NEW;
END
$$;
CREATE TRIGGER variante_nova_marca
  BEFORE INSERT ON variante
  FOR EACH ROW EXECUTE FUNCTION variante_nova_marca();

-- As combinações de um artigo: nenhuma repetida entre as variantes activas
-- completas; e, se o artigo não é rascunho, todas as activas completas.
CREATE FUNCTION catalogo_verificar_combinacoes(comerciante uuid, artigo uuid) RETURNS void
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  n_opcoes integer;
  estado text;
BEGIN
  -- Só se vê com client_min_messages em debug: os testes contam as vezes.
  RAISE DEBUG 'eurolify: verificar combinacoes %', artigo;
  PERFORM public.catalogo_fila_do_artigo(comerciante, artigo);
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

-- No fim da transacção: cada linha que mexeu nas combinações chama isto, mas
-- só a primeira de cada artigo verifica (a marca sai ao verificar). Corre com
-- os direitos do dono, porque tirar a marca é só dele: se a API a pudesse
-- tirar, poderia saltar a verificação. Lê com o RLS do comerciante do
-- contexto (as tabelas têm RLS forçado, também para o dono).
CREATE FUNCTION combinacoes_no_fim() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  comerciante uuid;
  artigo uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    comerciante := OLD.comerciante_id;
    artigo := OLD.artigo_id;
  ELSE
    comerciante := NEW.comerciante_id;
    artigo := NEW.artigo_id;
  END IF;
  IF public.catalogo_tirar_marca(comerciante, artigo) THEN
    PERFORM public.catalogo_verificar_combinacoes(comerciante, artigo);
  END IF;
  RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER combinacoes_no_fim
  AFTER INSERT OR UPDATE OR DELETE ON variante_valor
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION combinacoes_no_fim();
CREATE CONSTRAINT TRIGGER combinacoes_no_fim
  AFTER INSERT ON variante
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION combinacoes_no_fim();
CREATE CONSTRAINT TRIGGER combinacoes_no_fim
  AFTER INSERT OR DELETE ON opcao
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION combinacoes_no_fim();

-- Activar ou repor o artigo exige as combinações completas e sem repetidos
-- (o «sem repetidos» também aqui: apagar uma opção sem valores num rascunho
-- podia tornar duas variantes completas e iguais; revisão do #83, P1-1).
CREATE FUNCTION artigo_combinacoes_ao_activar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  n_opcoes integer;
BEGIN
  PERFORM public.catalogo_fila_do_artigo(NEW.comerciante_id, NEW.id);
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
  PERFORM public.catalogo_verificar_combinacoes(NEW.comerciante_id, NEW.id);
  RETURN NEW;
END
$$;
CREATE TRIGGER artigo_combinacoes_ao_activar
  BEFORE UPDATE ON artigo
  FOR EACH ROW WHEN (NEW.estado = 'activo' AND OLD.estado IS DISTINCT FROM 'activo')
  EXECUTE FUNCTION artigo_combinacoes_ao_activar();

-- Apagar um rascunho (0004), agora com opções: entra na fila do artigo antes
-- de prender as variantes, para não esperar ao contrário de quem dá valores
-- a uma variante dele (revisão do #83, P2-2). Ordem dos bloqueios: a linha do
-- artigo, a fila do comerciante (kits), a fila do artigo (opções).
CREATE OR REPLACE FUNCTION artigo_antes_de_apagar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF OLD.estado <> 'rascunho' OR OLD.ja_esteve_activo THEN
    RAISE EXCEPTION 'catalog.not_draft: só se apaga um rascunho que nunca esteve activo; arquivar';
  END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended('eurolify.componente:' || OLD.comerciante_id::text, 0));
  PERFORM public.catalogo_fila_do_artigo(OLD.comerciante_id, OLD.id);
  DELETE FROM public.componente c
  WHERE c.comerciante_id = OLD.comerciante_id
    AND c.kit_id IN (SELECT v.id FROM public.variante v
                     WHERE v.comerciante_id = OLD.comerciante_id
                       AND v.artigo_id = OLD.id);
  DELETE FROM public.variante v
  WHERE v.comerciante_id = OLD.comerciante_id AND v.artigo_id = OLD.id;
  RETURN OLD;
END
$$;

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

-- A tabela das marcas é só das duas funções acima (com os direitos do dono).
ALTER TABLE combinacoes_por_verificar ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON combinacoes_por_verificar FROM PUBLIC;

-- As funções: só a API tem EXECUTE (os triggers correm com os direitos dela),
-- não qualquer papel. Marcar exige-o também, mas recusa fora de um trigger
-- (pg_trigger_depth); tirar a marca, nem a API.
REVOKE EXECUTE ON FUNCTION catalogo_fila_do_artigo(uuid, uuid),
  catalogo_estado_do_artigo(uuid, uuid), catalogo_marcar_combinacoes(uuid, uuid),
  catalogo_tirar_marca(uuid, uuid), catalogo_verificar_combinacoes(uuid, uuid)
  FROM PUBLIC;
-- Tirar a marca, não: só o trigger do fim, com os direitos do dono.
GRANT EXECUTE ON FUNCTION catalogo_fila_do_artigo(uuid, uuid),
  catalogo_estado_do_artigo(uuid, uuid), catalogo_marcar_combinacoes(uuid, uuid),
  catalogo_verificar_combinacoes(uuid, uuid)
  TO eurolify_api;

-- A API não escolhe ids nem datas; muda textos e posições (os triggers só
-- deixam os textos num rascunho); apaga (só num rascunho).
GRANT SELECT, DELETE ON opcao, valor_opcao, variante_valor TO eurolify_api;
GRANT INSERT (comerciante_id, artigo_id, nome, posicao) ON opcao TO eurolify_api;
GRANT UPDATE (nome, posicao) ON opcao TO eurolify_api;
GRANT INSERT (comerciante_id, artigo_id, opcao_id, valor, posicao) ON valor_opcao TO eurolify_api;
GRANT UPDATE (valor, posicao) ON valor_opcao TO eurolify_api;
GRANT INSERT (comerciante_id, artigo_id, variante_id, opcao_id, valor_id) ON variante_valor TO eurolify_api;
GRANT UPDATE (valor_id) ON variante_valor TO eurolify_api;
