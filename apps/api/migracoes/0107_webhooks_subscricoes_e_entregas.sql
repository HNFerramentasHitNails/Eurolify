-- Webhooks de saída: as subscrições e as entregas (docs/38; issue #473;
-- desenho escrito sob a autorização geral do Diogo de 16/10/2026, à espera do
-- OK dele no pedido). Ex.: o comerciante Alfa subscreve `product.published`
-- em https://alfa.example/hooks; quando um artigo se publica, o evento da
-- outbox (0021) dá uma entrega para essa subscrição, que a API envia assinada,
-- repete com recuo durante 72 h e, falhando, desiste (e o comerciante pode
-- reenviar).
--
-- O que esta migração faz:
-- - `webhook_subscricao`: por comerciante, o endereço https, os tipos de
--   evento e o segredo de assinatura **só cifrado** (AES-256-GCM, chave fora
--   da base; docs/38 §3). Não se apaga (desactiva-se), para as entregas
--   guardarem a história;
-- - `webhook_entrega`: uma linha por (subscrição, evento), com o estado, as
--   tentativas e a próxima tentativa. O corpo não se guarda: monta-se do
--   evento no envio (docs/38 §6);
-- - `webhook_comerciante`: a lista interna dos comerciantes com webhooks, para
--   a volta do publicador (que não lê a outbox entre comerciantes: RLS); só
--   as funções do dono lhe tocam (como `tarefa_notificacao`, 0071).
-- O que não faz: a distribuição e a leitura do evento (0108).
SET LOCAL lock_timeout = '10s';

CREATE TABLE webhook_subscricao (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  url text NOT NULL CHECK (length(url) <= 2000 AND url ~ '^https://[^/?#@[:space:]]+(/[^#[:space:]]*)?$'),
  descricao text CHECK (descricao IS NULL OR length(descricao) BETWEEN 1 AND 200),
  eventos text[] NOT NULL CHECK (
    cardinality(eventos) BETWEEN 1 AND 30
    AND array_position(eventos, NULL) IS NULL
    AND eventos <@ ARRAY[
      'product.published', 'product.unpublished', 'product.archived',
      'price.changed', 'market.activated', 'market.archived']::text[]),
  segredo_cifra bytea NOT NULL,
  chave_versao text NOT NULL CHECK (chave_versao ~ '^[0-9A-Za-z_-]{1,20}$'),
  estado text NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa', 'pausada', 'desactivada')),
  criada_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  criada_por text NOT NULL CHECK (length(criada_por) BETWEEN 1 AND 200),
  actualizada_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  actualizada_por text CHECK (actualizada_por IS NULL OR length(actualizada_por) BETWEEN 1 AND 200),
  versao integer NOT NULL DEFAULT 1 CHECK (versao >= 1)
);
CREATE INDEX webhook_subscricao_por_comerciante
  ON webhook_subscricao (comerciante_id, criada_em, id);

-- Uma subscrição não se apaga, e o que a identifica não muda; uma
-- desactivada não volta (docs/38 §3).
CREATE FUNCTION webhook_subscricao_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'webhooks.immutable: uma subscrição não se apaga (desactiva-se)';
  END IF;
  IF (NEW.id, NEW.comerciante_id, NEW.criada_em, NEW.criada_por)
     IS DISTINCT FROM (OLD.id, OLD.comerciante_id, OLD.criada_em, OLD.criada_por) THEN
    RAISE EXCEPTION 'webhooks.immutable: a identidade de uma subscrição não muda';
  END IF;
  IF OLD.estado = 'desactivada' THEN
    RAISE EXCEPTION 'webhooks.immutable: uma subscrição desactivada não muda';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER webhook_subscricao_antes_de_gravar
  BEFORE UPDATE OR DELETE ON webhook_subscricao
  FOR EACH ROW EXECUTE FUNCTION webhook_subscricao_antes_de_gravar();
ALTER TABLE webhook_subscricao ENABLE ALWAYS TRIGGER webhook_subscricao_antes_de_gravar;
CREATE TRIGGER webhook_subscricao_sem_truncate
  BEFORE TRUNCATE ON webhook_subscricao
  FOR EACH STATEMENT EXECUTE FUNCTION rasto_so_se_acrescenta();
ALTER TABLE webhook_subscricao ENABLE ALWAYS TRIGGER webhook_subscricao_sem_truncate;

CREATE TABLE webhook_entrega (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  subscricao_id uuid NOT NULL REFERENCES webhook_subscricao (id),
  evento_id uuid NOT NULL REFERENCES evento_saida (id),
  estado text NOT NULL DEFAULT 'pendente'
    CHECK (estado IN ('pendente', 'entregue', 'desistida', 'cancelada')),
  tentativas integer NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
  reenvios integer NOT NULL DEFAULT 0 CHECK (reenvios >= 0),
  proxima_em timestamptz NOT NULL,
  prazo_ate timestamptz NOT NULL,
  -- Só o código HTTP e um código curto do erro; nunca o corpo da resposta
  -- (pode ter dados pessoais do receptor).
  ultimo_estado_http integer CHECK (ultimo_estado_http IS NULL OR ultimo_estado_http BETWEEN 100 AND 599),
  ultimo_erro text CHECK (ultimo_erro IS NULL OR ultimo_erro ~ '^[a-z_.]{1,60}$'),
  criada_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  terminada_em timestamptz,
  UNIQUE (subscricao_id, evento_id)
);
CREATE INDEX webhook_entrega_por_enviar ON webhook_entrega (proxima_em, id)
  WHERE estado = 'pendente';
CREATE INDEX webhook_entrega_por_comerciante
  ON webhook_entrega (comerciante_id, criada_em DESC, id);
CREATE INDEX webhook_entrega_por_subscricao ON webhook_entrega (subscricao_id, criada_em DESC);

CREATE FUNCTION webhook_entrega_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'webhooks.immutable: uma entrega não se apaga';
  END IF;
  IF (NEW.id, NEW.comerciante_id, NEW.subscricao_id, NEW.evento_id, NEW.criada_em)
     IS DISTINCT FROM (OLD.id, OLD.comerciante_id, OLD.subscricao_id, OLD.evento_id, OLD.criada_em) THEN
    RAISE EXCEPTION 'webhooks.immutable: a identidade de uma entrega não muda';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER webhook_entrega_antes_de_gravar
  BEFORE UPDATE OR DELETE ON webhook_entrega
  FOR EACH ROW EXECUTE FUNCTION webhook_entrega_antes_de_gravar();
ALTER TABLE webhook_entrega ENABLE ALWAYS TRIGGER webhook_entrega_antes_de_gravar;
CREATE TRIGGER webhook_entrega_sem_truncate
  BEFORE TRUNCATE ON webhook_entrega
  FOR EACH STATEMENT EXECUTE FUNCTION rasto_so_se_acrescenta();
ALTER TABLE webhook_entrega ENABLE ALWAYS TRIGGER webhook_entrega_sem_truncate;

-- Os comerciantes com webhooks (interna, sem RLS): entra o que cria uma
-- subscrição e não sai (docs/38 §7; a volta de um comerciante sem trabalho
-- custa uma leitura por um índice).
CREATE TABLE webhook_comerciante (
  comerciante_id uuid PRIMARY KEY REFERENCES comerciante (id)
);

CREATE FUNCTION webhook_subscricao_comerciante() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  INSERT INTO public.webhook_comerciante (comerciante_id) VALUES (NEW.comerciante_id)
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END
$$;
CREATE TRIGGER webhook_subscricao_comerciante
  AFTER INSERT ON webhook_subscricao
  FOR EACH ROW EXECUTE FUNCTION webhook_subscricao_comerciante();

CREATE FUNCTION webhook_comerciantes() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT w.comerciante_id FROM public.webhook_comerciante w ORDER BY w.comerciante_id
$$;

-- RLS e permissões
ALTER TABLE webhook_subscricao ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_subscricao FORCE ROW LEVEL SECURITY;
CREATE POLICY so_o_proprio ON webhook_subscricao
  USING (comerciante_id = comerciante_actual())
  WITH CHECK (comerciante_id = comerciante_actual());
ALTER TABLE webhook_entrega ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_entrega FORCE ROW LEVEL SECURITY;
CREATE POLICY so_o_proprio ON webhook_entrega
  USING (comerciante_id = comerciante_actual())
  WITH CHECK (comerciante_id = comerciante_actual());
REVOKE ALL ON webhook_subscricao, webhook_entrega, webhook_comerciante FROM PUBLIC;

GRANT SELECT ON webhook_subscricao TO eurolify_api;
GRANT INSERT (id, comerciante_id, url, descricao, eventos, segredo_cifra, chave_versao,
  criada_por) ON webhook_subscricao TO eurolify_api;
GRANT UPDATE (url, descricao, eventos, estado, actualizada_em, actualizada_por, versao)
  ON webhook_subscricao TO eurolify_api;
-- As entregas inserem-nas a função de distribuição (0108); a API muda só o
-- andamento.
GRANT SELECT ON webhook_entrega TO eurolify_api;
GRANT UPDATE (estado, tentativas, reenvios, proxima_em, prazo_ate, ultimo_estado_http,
  ultimo_erro, terminada_em) ON webhook_entrega TO eurolify_api;

REVOKE EXECUTE ON FUNCTION webhook_subscricao_antes_de_gravar(), webhook_entrega_antes_de_gravar(),
  webhook_subscricao_comerciante(), webhook_comerciantes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION webhook_comerciantes() TO eurolify_api;
