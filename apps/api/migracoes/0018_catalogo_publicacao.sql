-- Catálogo, parte 4: publicação por canal × mercado (docs/14 §3.9, §4.2 e §5,
-- regra C2; issue #77). Ex.: o artigo «Gel» publica-se na «Loja online» ×
-- «Portugal» depois de a verificação «pode publicar?» não encontrar
-- impedimentos; se a variante GEL-001 não tiver preço na lista de base de
-- Portugal, a publicação é recusada.
--
-- A verificação completa (C2) corre no servidor, em
-- `apps/api/src/catalogo/publicacao.ts`, e o resultado fica em
-- `ultima_verificacao`. A base repete aqui o que não pode falhar nunca, mesmo
-- com SQL escrito à mão pela API (decisão do Diogo, 06/10/2026, opção a):
-- - só se publica um artigo activo, num mercado activo, num canal activo que
--   vende nesse mercado (a chave para canal_mercado), com a última
--   verificação sem impedimentos;
-- - cada variante vendida (activa e fora de `variantes_fora`) tem preço na
--   lista de base activa do mercado (e nunca 0,00 € sem ser gratuita: a 0017
--   já o garante no preço); num artigo físico, tem peso;
-- - há pelo menos uma variante vendida.
-- Também (propostas desta parte):
-- - o preço de uma variante vendida numa publicação publicada não se tira da
--   lista de base: retira-se primeiro a publicação;
-- - uma variante nova de um artigo já publicado nasce fora das publicações
--   publicadas, para não se vender sem verificação.
--
-- Arquivar o artigo, o mercado ou o canal arquiva as publicações publicadas,
-- com o motivo (docs/14 §4.1 e §4.2; docs/20 §4.1). Os eventos
-- (`product.published`, `product.unpublished`) entram com a outbox (parte 5).
--
-- NÃO verificado (decisão do Diogo, 06/10/2026, opção a): os atributos
-- regulamentares (domínio Conformidade, ainda sem desenho) e o texto
-- alternativo da media (parte 5). A verificação diz-o sempre em
-- `nao_verificado`; a rede tem fim escrito no docs/14 §5.
--
-- Concorrência: publicar toma a linha da publicação (UPDATE) e, no gatilho,
-- o artigo, o mercado, o canal, a lista de base e os preços das variantes
-- vendidas (FOR SHARE): arquivar um deles ou tirar um desses preços espera e
-- depois vê a publicação. Uma variante nova toma as publicações do artigo
-- (FOR UPDATE) antes de decidir se nasce fora. Assumem READ COMMITTED.

SET LOCAL lock_timeout = '10s';

-- A publicação aponta para o par canal × mercado pela chave completa (o
-- comerciante, a loja, o canal e o mercado).
ALTER TABLE canal_mercado
  ADD CONSTRAINT canal_mercado_completo UNIQUE (comerciante_id, loja_id, canal_id, mercado_id);

CREATE TABLE publicacao (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  artigo_id uuid NOT NULL,
  loja_id uuid NOT NULL,
  canal_id uuid NOT NULL,
  mercado_id uuid NOT NULL,
  estado text NOT NULL DEFAULT 'rascunho'
    CHECK (estado IN ('rascunho', 'publicado', 'arquivado')),
  -- Variantes do artigo que não se vendem nesta publicação (C6).
  variantes_fora uuid[] NOT NULL DEFAULT '{}',
  -- O resultado da última verificação «pode publicar?» (C2), escrito pelo
  -- servidor: {impedimentos: [...], nao_verificado: [...]}.
  ultima_verificacao jsonb,
  verificado_em timestamptz,
  publicado_por text,
  publicado_em timestamptz,
  arquivado_por text,
  arquivado_em timestamptz,
  motivo_arquivo text CHECK (motivo_arquivo IS NULL OR motivo_arquivo IN (
    'retirada', 'artigo_arquivado', 'mercado_arquivado', 'canal_arquivado')),
  criado_em timestamptz NOT NULL DEFAULT now(),
  actualizado_em timestamptz NOT NULL DEFAULT now(),
  versao integer NOT NULL DEFAULT 1,
  CONSTRAINT publicacao_unica UNIQUE (artigo_id, canal_id, mercado_id),
  CONSTRAINT publicacao_do_artigo FOREIGN KEY (comerciante_id, artigo_id)
    REFERENCES artigo (comerciante_id, id),
  -- O canal vende neste mercado: tirar o mercado do canal com publicações
  -- é recusado (prices.channel_market_in_use).
  CONSTRAINT publicacao_do_canal_mercado FOREIGN KEY (comerciante_id, loja_id, canal_id, mercado_id)
    REFERENCES canal_mercado (comerciante_id, loja_id, canal_id, mercado_id),
  CONSTRAINT publicacao_verificacao_e_objecto CHECK (
    ultima_verificacao IS NULL OR jsonb_typeof(ultima_verificacao) = 'object')
);
CREATE INDEX publicacao_por_mercado ON publicacao (comerciante_id, mercado_id);
CREATE INDEX publicacao_por_canal ON publicacao (comerciante_id, canal_id);

CREATE FUNCTION publicacao_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem text := nullif(btrim(current_setting('eurolify.quem', true)), '');
  motivo text := nullif(current_setting('eurolify.motivo_arquivo', true), '');
  estado_do_artigo text;
  tipo_do_artigo text;
  estado_do_mercado text;
  estado_do_canal text;
  lista_base uuid;
  vendidas integer;
  sem_preco text;
  sem_peso text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.estado <> 'rascunho' THEN
      RAISE EXCEPTION 'catalog.invalid_transition: uma publicação nasce em rascunho';
    END IF;
    NEW.versao := 1;
    NEW.criado_em := now();
    NEW.actualizado_em := now();
  ELSE
    IF NEW.id <> OLD.id OR NEW.comerciante_id <> OLD.comerciante_id
       OR NEW.artigo_id <> OLD.artigo_id OR NEW.loja_id <> OLD.loja_id
       OR NEW.canal_id <> OLD.canal_id OR NEW.mercado_id <> OLD.mercado_id THEN
      RAISE EXCEPTION 'catalog.immutable_identity: o artigo, o canal e o mercado de uma publicação não mudam';
    END IF;
    IF NEW.estado <> OLD.estado AND NOT (
         (OLD.estado = 'rascunho' AND NEW.estado = 'publicado')
      OR (OLD.estado = 'publicado' AND NEW.estado = 'arquivado')
      OR (OLD.estado = 'arquivado' AND NEW.estado = 'publicado')) THEN
      RAISE EXCEPTION 'catalog.invalid_transition: % → % não é permitido', OLD.estado, NEW.estado;
    END IF;
    NEW.criado_em := OLD.criado_em;
    NEW.actualizado_em := now();
    NEW.versao := OLD.versao + 1;
  END IF;

  -- As variantes fora são do artigo, sem repetidos.
  IF cardinality(NEW.variantes_fora) <> (SELECT count(DISTINCT v) FROM unnest(NEW.variantes_fora) v) THEN
    RAISE EXCEPTION 'catalog.invalid_field: uma variante repetida em variantes_fora';
  END IF;
  IF EXISTS (
    SELECT FROM unnest(NEW.variantes_fora) f
    WHERE NOT EXISTS (
      SELECT FROM public.variante v
      WHERE v.comerciante_id = NEW.comerciante_id AND v.artigo_id = NEW.artigo_id AND v.id = f)) THEN
    RAISE EXCEPTION 'catalog.not_found: uma variante de variantes_fora não é deste artigo';
  END IF;

  -- O arquivo: quem e porquê. Uma retirada pede quem; os arquivos em cadeia
  -- (artigo, mercado, canal) trazem o motivo.
  IF TG_OP = 'UPDATE' AND NEW.estado = 'arquivado' AND OLD.estado <> 'arquivado' THEN
    IF motivo IS NULL AND quem IS NULL THEN
      RAISE EXCEPTION 'catalog.published_by_required: quem retira a publicação (eurolify.quem) é obrigatório';
    END IF;
    NEW.motivo_arquivo := coalesce(motivo, 'retirada');
    NEW.arquivado_por := left(coalesce(quem, 'catalogo:' || motivo), 200);
    NEW.arquivado_em := clock_timestamp();
  END IF;

  -- Publicar, ou pôr variantes de volta à venda numa publicação publicada: o
  -- que não pode falhar nunca. Tirar variantes da venda (acrescentá-las a
  -- `variantes_fora`) não precisa de verificação.
  IF NEW.estado = 'publicado' AND (TG_OP = 'INSERT' OR OLD.estado <> 'publicado'
       OR NOT (OLD.variantes_fora <@ NEW.variantes_fora)) THEN
    IF quem IS NULL THEN
      RAISE EXCEPTION 'catalog.published_by_required: quem publica (eurolify.quem) é obrigatório';
    END IF;
    IF NEW.ultima_verificacao IS NULL
       OR jsonb_typeof(NEW.ultima_verificacao -> 'impedimentos') IS DISTINCT FROM 'array'
       OR jsonb_array_length(NEW.ultima_verificacao -> 'impedimentos') > 0 THEN
      RAISE EXCEPTION 'catalog.publish_blocked: a última verificação tem impedimentos ou falta';
    END IF;
    SELECT a.estado, a.tipo INTO estado_do_artigo, tipo_do_artigo FROM public.artigo a
    WHERE a.comerciante_id = NEW.comerciante_id AND a.id = NEW.artigo_id
    FOR SHARE;
    IF estado_do_artigo IS DISTINCT FROM 'activo' THEN
      RAISE EXCEPTION 'catalog.publish_blocked: o artigo não está activo';
    END IF;
    SELECT m.estado INTO estado_do_mercado FROM public.mercado m
    WHERE m.comerciante_id = NEW.comerciante_id AND m.id = NEW.mercado_id
    FOR SHARE;
    IF estado_do_mercado IS DISTINCT FROM 'activo' THEN
      RAISE EXCEPTION 'catalog.publish_blocked: o mercado não está activo';
    END IF;
    SELECT c.estado INTO estado_do_canal FROM public.canal c
    WHERE c.comerciante_id = NEW.comerciante_id AND c.id = NEW.canal_id
    FOR SHARE;
    IF estado_do_canal IS DISTINCT FROM 'activo' THEN
      RAISE EXCEPTION 'catalog.publish_blocked: o canal não está activo';
    END IF;
    SELECT l.id INTO lista_base FROM public.lista_precos l
    WHERE l.comerciante_id = NEW.comerciante_id AND l.mercado_id = NEW.mercado_id
      AND l.tipo = 'base' AND l.estado = 'activa'
    FOR SHARE;

    SELECT count(*) INTO vendidas FROM public.variante v
    WHERE v.comerciante_id = NEW.comerciante_id AND v.artigo_id = NEW.artigo_id
      AND v.estado = 'activa' AND NOT (v.id = ANY (NEW.variantes_fora));
    IF vendidas = 0 THEN
      RAISE EXCEPTION 'catalog.publish_blocked: nenhuma variante à venda';
    END IF;

    -- Os preços das vendidas ficam tomados até ao fim da transacção.
    PERFORM FROM public.preco p
    WHERE p.comerciante_id = NEW.comerciante_id AND p.lista_id = lista_base
      AND p.variante_id IN (
        SELECT v.id FROM public.variante v
        WHERE v.comerciante_id = NEW.comerciante_id AND v.artigo_id = NEW.artigo_id
          AND v.estado = 'activa' AND NOT (v.id = ANY (NEW.variantes_fora)))
    FOR SHARE;
    SELECT string_agg(v.sku, ', ' ORDER BY v.sku) INTO sem_preco FROM public.variante v
    WHERE v.comerciante_id = NEW.comerciante_id AND v.artigo_id = NEW.artigo_id
      AND v.estado = 'activa' AND NOT (v.id = ANY (NEW.variantes_fora))
      AND NOT EXISTS (
        SELECT FROM public.preco p
        WHERE p.comerciante_id = v.comerciante_id AND p.lista_id = lista_base
          AND p.variante_id = v.id);
    IF sem_preco IS NOT NULL THEN
      RAISE EXCEPTION 'catalog.publish_blocked: sem preço na lista de base do mercado: %', sem_preco;
    END IF;
    IF tipo_do_artigo = 'fisico' THEN
      SELECT string_agg(v.sku, ', ' ORDER BY v.sku) INTO sem_peso FROM public.variante v
      WHERE v.comerciante_id = NEW.comerciante_id AND v.artigo_id = NEW.artigo_id
        AND v.estado = 'activa' AND NOT (v.id = ANY (NEW.variantes_fora))
        AND v.peso_g IS NULL;
      IF sem_peso IS NOT NULL THEN
        RAISE EXCEPTION 'catalog.publish_blocked: sem peso: %', sem_peso;
      END IF;
    END IF;

    IF TG_OP = 'INSERT' OR OLD.estado <> 'publicado' THEN
      NEW.publicado_por := left(quem, 200);
      NEW.publicado_em := clock_timestamp();
      NEW.arquivado_por := NULL;
      NEW.arquivado_em := NULL;
      NEW.motivo_arquivo := NULL;
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER publicacao_antes_de_gravar
  BEFORE INSERT OR UPDATE ON publicacao
  FOR EACH ROW EXECUTE FUNCTION publicacao_antes_de_gravar();

-- Uma publicação não se apaga: arquiva-se.
CREATE FUNCTION publicacao_nao_se_apaga() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'catalog.immutable_identity: uma publicação não se apaga; retira-se';
END
$$;
CREATE TRIGGER publicacao_nao_se_apaga
  BEFORE DELETE ON publicacao
  FOR EACH ROW EXECUTE FUNCTION publicacao_nao_se_apaga();

-- Arquivar o artigo, o mercado ou o canal arquiva as publicações publicadas,
-- com o motivo (o argumento do gatilho). Corre com os direitos de quem
-- arquiva (a API tem UPDATE no estado da publicação).
CREATE FUNCTION arquivar_publicacoes_em_cadeia() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  motivo text := TG_ARGV[0];
  anterior text := current_setting('eurolify.motivo_arquivo', true);
BEGIN
  IF NEW.estado = 'arquivado' AND OLD.estado <> 'arquivado' THEN
    PERFORM set_config('eurolify.motivo_arquivo', motivo, true);
    UPDATE public.publicacao p SET estado = 'arquivado'
    WHERE p.comerciante_id = NEW.comerciante_id AND p.estado = 'publicado'
      AND CASE TG_TABLE_NAME
            WHEN 'artigo' THEN p.artigo_id = NEW.id
            WHEN 'mercado' THEN p.mercado_id = NEW.id
            WHEN 'canal' THEN p.canal_id = NEW.id
          END;
    PERFORM set_config('eurolify.motivo_arquivo', coalesce(anterior, ''), true);
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER artigo_arquiva_publicacoes
  AFTER UPDATE OF estado ON artigo
  FOR EACH ROW EXECUTE FUNCTION arquivar_publicacoes_em_cadeia('artigo_arquivado');
CREATE TRIGGER mercado_arquiva_publicacoes
  AFTER UPDATE OF estado ON mercado
  FOR EACH ROW EXECUTE FUNCTION arquivar_publicacoes_em_cadeia('mercado_arquivado');
CREATE TRIGGER canal_arquiva_publicacoes
  AFTER UPDATE OF estado ON canal
  FOR EACH ROW EXECUTE FUNCTION arquivar_publicacoes_em_cadeia('canal_arquivado');

-- O preço de uma variante vendida numa publicação publicada não sai da lista
-- de base do mercado: retira-se primeiro a publicação (proposta). A saída em
-- cadeia de uma variante apagada não chega aqui com publicação publicada (só
-- um rascunho apaga variantes, e um rascunho não se publica).
CREATE FUNCTION preco_de_variante_publicada() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  publicada uuid;
BEGIN
  SELECT p.id INTO publicada
  FROM public.lista_precos l
  JOIN public.publicacao p ON p.comerciante_id = l.comerciante_id AND p.mercado_id = l.mercado_id
  JOIN public.variante v ON v.comerciante_id = p.comerciante_id AND v.artigo_id = p.artigo_id
  WHERE l.comerciante_id = OLD.comerciante_id AND l.id = OLD.lista_id AND l.tipo = 'base'
    AND v.id = OLD.variante_id AND p.estado = 'publicado'
    AND NOT (OLD.variante_id = ANY (p.variantes_fora))
  LIMIT 1
  FOR SHARE OF p;
  IF publicada IS NOT NULL THEN
    RAISE EXCEPTION 'prices.published_variant: a variante está publicada (%); retirar a publicação primeiro', publicada;
  END IF;
  RETURN OLD;
END
$$;
CREATE TRIGGER preco_de_variante_publicada
  BEFORE DELETE ON preco
  FOR EACH ROW EXECUTE FUNCTION preco_de_variante_publicada();

-- Uma variante nova de um artigo publicado nasce fora das publicações
-- publicadas: vende-se só depois de a pôr dentro, com nova verificação
-- (proposta). Corre com os direitos do dono, porque quem cria variantes pode
-- não ter direito a mudar publicações.
CREATE FUNCTION variante_nova_fica_fora() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM FROM public.publicacao p
  WHERE p.comerciante_id = NEW.comerciante_id AND p.artigo_id = NEW.artigo_id
  FOR UPDATE;
  UPDATE public.publicacao p
  SET variantes_fora = p.variantes_fora || NEW.id
  WHERE p.comerciante_id = NEW.comerciante_id AND p.artigo_id = NEW.artigo_id
    AND p.estado = 'publicado';
  RETURN NULL;
END
$$;
CREATE TRIGGER variante_nova_fica_fora
  AFTER INSERT ON variante
  FOR EACH ROW EXECUTE FUNCTION variante_nova_fica_fora();

ALTER TABLE publicacao ENABLE ROW LEVEL SECURITY;
ALTER TABLE publicacao FORCE ROW LEVEL SECURITY;
CREATE POLICY so_o_proprio ON publicacao
  USING (comerciante_id = comerciante_actual())
  WITH CHECK (comerciante_id = comerciante_actual());

GRANT SELECT ON publicacao TO eurolify_api;
GRANT INSERT (comerciante_id, artigo_id, loja_id, canal_id, mercado_id, variantes_fora)
  ON publicacao TO eurolify_api;
GRANT UPDATE (estado, variantes_fora, ultima_verificacao, verificado_em)
  ON publicacao TO eurolify_api;
