-- Eventos de domínio na outbox (docs/18 §5; platform-architect, regra 5; o
-- pedido do Diogo, 06/10/2026: «sim, avança com os eventos de domínio»).
-- Ex.: publicar o «Gel» na «Loja online» × «Portugal» grava, na mesma
-- transacção, o evento `product.published` com o artigo, a publicação, o
-- canal, o mercado e quem publicou; se a transacção desfaz, o evento também.
--
-- O que esta migração faz:
-- - a tabela `evento_saida` (docs/18 §5): o evento grava-se na mesma
--   transacção que a mudança, com o mínimo de dados (identificadores e o que
--   mudou); o publicador (webhooks, ainda por fazer) pede o resto à API;
-- - os eventos escrevem-nos gatilhos com os direitos do dono, nas tabelas que
--   mudam: a API, o SQL à mão no contexto do comerciante e os gatilhos em
--   cadeia não mudam o estado sem o evento. O limite é o do rasto da 0008: o
--   dono pode desligar ou apagar um gatilho por DDL, e isso só entra por
--   migração revista; os gatilhos que escrevem os eventos ficam no estado
--   normal, como os da 0017 (revisão do #143, P3-2). A API **não** escreve na tabela
--   directamente nem a lê (mais fechado do que o docs/18 §5 dizia: «a API só
--   faz INSERT»); as funções de gatilho não se chamam fora de um gatilho;
-- - os eventos desta parte:
--   - `product.published` e `product.unpublished` (docs/14 §6, P6), com quem
--     e, no segundo, o motivo: são também o rasto das transições da
--     publicação (docs/14 §8; revisão do #139, P3-1);
--   - `product.archived` (docs/14 §6, P6);
--   - `price.changed` (docs/20 §6): uma linha nova no histórico do preço,
--     com o montante antigo e o novo, a moeda e se o preço saiu;
--   - `market.activated` e `market.archived` (docs/20 §6, BX);
-- - um evento não se altera nem se apaga (como o rasto da 0008): só as
--   colunas do publicador (`publicado_em`, `tentativas`, `ultimo_erro`)
--   mudam, e só enquanto o evento não estiver publicado. O prazo de guarda
--   decide-se com os webhooks (docs/18 §5);
-- - os instantes (`em`) vão em UTC, com formato fixo, qualquer que seja o
--   fuso da sessão (docs/14 §6; revisão do #143, P3-4).
--
-- O que não faz (e onde fica):
-- - o publicador e o seu utilizador da base: com os webhooks (docs/18);
-- - voltar a verificar as publicações quando estes eventos chegam: um pedido
--   próprio, a seguir (docs/14 §8);
-- - os outros eventos da lista (`product.created`, `product.updated`,
--   `promotion.*`, os do Comerciante e das contas): entram com o domínio ou a
--   parte que os escreve (docs/14 §6, docs/20 §6, docs/15);
-- - apagar eventos: nem os já publicados nem os de um comerciante apagado; o
--   prazo de guarda e a forma de apagar (um DELETE só do que está publicado e
--   fora do prazo, ou partições) entram com o publicador, noutra migração
--   (revisão do #143, P3-7);
-- - a ordem global: o publicador lê o conjunto `publicado_em IS NULL` (com
--   `FOR UPDATE SKIP LOCKED`), nunca «o último `criado_em` visto», porque uma
--   transacção pode ficar visível depois de outra com `criado_em` posterior; a
--   ordem só é garantida dentro da mesma linha (a mesma publicação, o mesmo
--   preço lista × variante, o mesmo mercado), não do agregado inteiro
--   (revisão do #143, P2-3 e ronda 2, P3-B).

SET LOCAL lock_timeout = '10s';

CREATE TABLE evento_saida (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  tipo text NOT NULL CHECK (tipo ~ '^[a-z]+(_[a-z]+)*\.[a-z]+(_[a-z]+)*$'),
  versao_esquema integer NOT NULL DEFAULT 1 CHECK (versao_esquema >= 1),
  agregado_tipo text NOT NULL CHECK (agregado_tipo ~ '^[a-z_]+$'),
  agregado_id uuid NOT NULL,
  dados jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(dados) = 'object'),
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  -- Do publicador; só ele os muda (docs/18 §5).
  publicado_em timestamptz,
  tentativas integer NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
  ultimo_erro text
);
-- O publicador lê os que faltam publicar (sem usar `criado_em` como cursor:
-- ver acima); o rasto lê por agregado.
CREATE INDEX evento_saida_por_publicar ON evento_saida (criado_em, id)
  WHERE publicado_em IS NULL;
CREATE INDEX evento_saida_por_agregado
  ON evento_saida (comerciante_id, agregado_tipo, agregado_id, criado_em);

-- Um evento não se altera nem se apaga; o publicador só marca o envio.
CREATE FUNCTION evento_saida_so_o_publicador() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'audit.append_only: um evento não se apaga (o prazo de guarda decide-se com os webhooks)';
  END IF;
  IF (NEW.id, NEW.comerciante_id, NEW.tipo, NEW.versao_esquema, NEW.agregado_tipo,
      NEW.agregado_id, NEW.dados, NEW.criado_em)
     IS DISTINCT FROM
     (OLD.id, OLD.comerciante_id, OLD.tipo, OLD.versao_esquema, OLD.agregado_tipo,
      OLD.agregado_id, OLD.dados, OLD.criado_em) THEN
    RAISE EXCEPTION 'audit.append_only: um evento não se altera; só o publicador marca o envio';
  END IF;
  IF OLD.publicado_em IS NOT NULL THEN
    RAISE EXCEPTION 'audit.append_only: um evento já publicado não se altera';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER evento_saida_so_o_publicador
  BEFORE UPDATE OR DELETE ON evento_saida
  FOR EACH ROW EXECUTE FUNCTION evento_saida_so_o_publicador();
CREATE TRIGGER evento_saida_sem_truncate
  BEFORE TRUNCATE ON evento_saida
  FOR EACH STATEMENT EXECUTE FUNCTION rasto_so_se_acrescenta();
ALTER TABLE evento_saida ENABLE ALWAYS TRIGGER evento_saida_so_o_publicador;
ALTER TABLE evento_saida ENABLE ALWAYS TRIGGER evento_saida_sem_truncate;

ALTER TABLE evento_saida ENABLE ROW LEVEL SECURITY;
ALTER TABLE evento_saida FORCE ROW LEVEL SECURITY;
CREATE POLICY so_o_proprio ON evento_saida
  USING (comerciante_id = comerciante_actual())
  WITH CHECK (comerciante_id = comerciante_actual());
-- A API não tem nenhum privilégio na tabela: os eventos escrevem-nos os
-- gatilhos abaixo, com os direitos do dono.

-- Publicação: publicado e arquivado (docs/14 §6, P6). `quem` vem de
-- `eurolify.quem` ou, num arquivo em cadeia, de `arquivado_por`.
CREATE FUNCTION publicacao_evento() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.estado = 'publicado' AND (TG_OP = 'INSERT' OR OLD.estado <> 'publicado') THEN
    INSERT INTO public.evento_saida (comerciante_id, tipo, agregado_tipo, agregado_id, dados)
    VALUES (NEW.comerciante_id, 'product.published', 'artigo', NEW.artigo_id,
      jsonb_build_object(
        'artigo_id', NEW.artigo_id, 'publicacao_id', NEW.id,
        'canal_id', NEW.canal_id, 'mercado_id', NEW.mercado_id,
        'quem', NEW.publicado_por,
        'em', to_char(NEW.publicado_em AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
  ELSIF TG_OP = 'UPDATE' AND NEW.estado = 'arquivado' AND OLD.estado <> 'arquivado' THEN
    INSERT INTO public.evento_saida (comerciante_id, tipo, agregado_tipo, agregado_id, dados)
    VALUES (NEW.comerciante_id, 'product.unpublished', 'artigo', NEW.artigo_id,
      jsonb_build_object(
        'artigo_id', NEW.artigo_id, 'publicacao_id', NEW.id,
        'canal_id', NEW.canal_id, 'mercado_id', NEW.mercado_id,
        'motivo', NEW.motivo_arquivo, 'quem', NEW.arquivado_por,
        'em', to_char(NEW.arquivado_em AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER publicacao_evento
  AFTER INSERT OR UPDATE OF estado ON publicacao
  FOR EACH ROW EXECUTE FUNCTION publicacao_evento();

-- Artigo arquivado (docs/14 §6, P6).
CREATE FUNCTION artigo_evento() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.estado = 'arquivado' AND OLD.estado <> 'arquivado' THEN
    INSERT INTO public.evento_saida (comerciante_id, tipo, agregado_tipo, agregado_id, dados)
    VALUES (NEW.comerciante_id, 'product.archived', 'artigo', NEW.id,
      jsonb_build_object('artigo_id', NEW.id));
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER artigo_evento
  AFTER UPDATE OF estado ON artigo
  FOR EACH ROW EXECUTE FUNCTION artigo_evento();

-- Mercado activado ou arquivado (docs/20 §6, BX).
CREATE FUNCTION mercado_evento() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.estado IS DISTINCT FROM OLD.estado AND NEW.estado IN ('activo', 'arquivado') THEN
    INSERT INTO public.evento_saida (comerciante_id, tipo, agregado_tipo, agregado_id, dados)
    VALUES (NEW.comerciante_id,
      CASE NEW.estado WHEN 'activo' THEN 'market.activated' ELSE 'market.archived' END,
      'mercado', NEW.id,
      jsonb_build_object('mercado_id', NEW.id, 'loja_id', NEW.loja_id));
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER mercado_evento
  AFTER UPDATE OF estado ON mercado
  FOR EACH ROW EXECUTE FUNCTION mercado_evento();

-- Preço mudado (docs/20 §6): cada linha nova no histórico do preço, com o
-- montante da linha anterior (nulo no primeiro preço ou depois de uma saída).
CREATE FUNCTION historico_preco_evento() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  anterior bigint;
BEGIN
  SELECT h.montante INTO anterior
  FROM public.historico_preco h
  WHERE h.comerciante_id = NEW.comerciante_id AND h.lista_id = NEW.lista_id
    AND h.variante_id = NEW.variante_id AND h.id <> NEW.id
    AND (h.em_vigor_desde, h.id) < (NEW.em_vigor_desde, NEW.id)
  ORDER BY h.em_vigor_desde DESC, h.id DESC
  LIMIT 1;
  INSERT INTO public.evento_saida (comerciante_id, tipo, agregado_tipo, agregado_id, dados)
  VALUES (NEW.comerciante_id, 'price.changed', 'variante', NEW.variante_id,
    jsonb_build_object(
      'lista_id', NEW.lista_id, 'variante_id', NEW.variante_id,
      'montante_antigo', anterior, 'montante_novo', NEW.montante,
      'gratuito', NEW.gratuito, 'saiu', NEW.saiu, 'moeda', NEW.moeda,
      'preco_inclui_iva', NEW.preco_inclui_iva,
      'quem', NEW.definido_por,
      'em', to_char(NEW.em_vigor_desde AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
  RETURN NULL;
END
$$;
CREATE TRIGGER historico_preco_evento
  AFTER INSERT ON historico_preco
  FOR EACH ROW EXECUTE FUNCTION historico_preco_evento();
