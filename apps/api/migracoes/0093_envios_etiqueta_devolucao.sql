-- Envios: a etiqueta de devolução pela transportadora (docs/36 §22; issue
-- #393; Diogo, 13/10/2026: «sim, aprovo; avança com o código»). Ex.: numa
-- devolução à espera, o armazém pede a etiqueta pela conta da Sendcloud; sai
-- um PDF com o número de seguimento, e a devolução fica com a transportadora
-- e o seguimento dela.
--
-- - Uma etiqueta por devolução, com os estados da etiqueta da expedição
--   (§4.1): a pedir, emitida, incerta, recusada, anulada. No máximo uma viva.
-- - A resposta perdida fica incerta: a lista da Sendcloud não procura pela
--   nossa referência, por isso só uma pessoa a resolve (§22.3).
-- - Anular é a pessoa a dizer que a anulou no painel da transportadora: a
--   Sendcloud só aceita um pedido de anulação, sem confirmação (V13).
-- - O ficheiro leva o nome e a morada do cliente: privado, apagado 30 dias
--   depois de a devolução acabar (Q7) ou logo no apagamento do titular.
-- - Cada tentativa e cada anulação ficam num histórico só de acréscimo (o
--   seguimento de uma etiqueta paga não se perde; revisão do #447, P2).
-- - No máximo 10 tentativas por devolução (revisão do #447, P2).
SET LOCAL lock_timeout = '10s';

CREATE TABLE etiqueta_devolucao (
  devolucao_id uuid PRIMARY KEY,
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  conta_transportadora_id uuid NOT NULL,
  transportadora text NOT NULL CHECK (transportadora IN ('ctt', 'sendcloud')),
  servico text NOT NULL CHECK (servico ~ '^[0-9A-Za-z_.:/-]{1,100}$'),
  estado text NOT NULL DEFAULT 'a_pedir' CHECK (estado IN ('a_pedir', 'emitida', 'incerta',
    'recusada', 'anulada')),
  tentativa integer NOT NULL DEFAULT 1 CHECK (tentativa BETWEEN 1 AND 10),
  peso_g integer NOT NULL CHECK (peso_g BETWEEN 1 AND 1000000),
  motivo text CHECK (motivo IS NULL OR length(motivo) <= 500),
  seguimento text CHECK (seguimento IS NULL OR length(seguimento) BETWEEN 1 AND 200),
  url_seguimento text CHECK (url_seguimento IS NULL
    OR (url_seguimento LIKE 'https://%' AND length(url_seguimento) <= 500)),
  em timestamptz NOT NULL DEFAULT now(),
  -- Quando a devolução acabou (fechada ou cancelada): o ficheiro sai 30 dias
  -- depois (Q7).
  acabou_em timestamptz,
  criado_por text NOT NULL CHECK (length(criado_por) BETWEEN 1 AND 200),
  UNIQUE (comerciante_id, devolucao_id),
  FOREIGN KEY (comerciante_id, devolucao_id) REFERENCES devolucao (comerciante_id, id),
  -- A conta é do mesmo comerciante (revisão do #447, P2).
  FOREIGN KEY (comerciante_id, conta_transportadora_id)
    REFERENCES conta_transportadora (comerciante_id, id),
  CHECK ((estado = 'emitida') = (seguimento IS NOT NULL) OR estado = 'anulada')
);

-- Os caminhos da etiqueta (como a da expedição, 0079): só para a frente, e
-- cada pedido novo é uma tentativa nova.
CREATE FUNCTION etiqueta_devolucao_valida() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.devolucao_id IS DISTINCT FROM OLD.devolucao_id
     OR NEW.comerciante_id IS DISTINCT FROM OLD.comerciante_id THEN
    RAISE EXCEPTION 'shipping.invalid_transition: a etiqueta não muda de devolução';
  END IF;
  IF NEW.estado IS DISTINCT FROM OLD.estado AND NOT (
       (OLD.estado IN ('recusada', 'anulada') AND NEW.estado = 'a_pedir')
    OR (OLD.estado = 'a_pedir' AND NEW.estado IN ('emitida', 'incerta', 'recusada'))
    OR (OLD.estado IN ('emitida', 'incerta') AND NEW.estado = 'anulada')) THEN
    RAISE EXCEPTION 'shipping.invalid_transition: etiqueta de devolução % → %', OLD.estado, NEW.estado;
  END IF;
  IF NEW.estado = 'a_pedir' AND OLD.estado <> 'a_pedir'
     AND NEW.tentativa <> OLD.tentativa + 1 THEN
    RAISE EXCEPTION 'shipping.invalid_transition: cada pedido de etiqueta é uma tentativa nova';
  END IF;
  -- Fora de uma transição, só o motivo (apagamento do titular) e o fim da
  -- devolução mudam; o resto é da tentativa (revisão do #447, P3).
  IF NEW.estado = OLD.estado AND (
       NEW.tentativa IS DISTINCT FROM OLD.tentativa
    OR NEW.conta_transportadora_id IS DISTINCT FROM OLD.conta_transportadora_id
    OR NEW.transportadora IS DISTINCT FROM OLD.transportadora
    OR NEW.servico IS DISTINCT FROM OLD.servico
    OR NEW.peso_g IS DISTINCT FROM OLD.peso_g
    OR NEW.seguimento IS DISTINCT FROM OLD.seguimento
    OR NEW.url_seguimento IS DISTINCT FROM OLD.url_seguimento
    OR NEW.criado_por IS DISTINCT FROM OLD.criado_por) THEN
    RAISE EXCEPTION 'shipping.immutable: a etiqueta só muda pelas transições';
  END IF;
  IF NEW.estado IS DISTINCT FROM OLD.estado THEN
    NEW.em := now();
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER etiqueta_devolucao_valida BEFORE UPDATE ON etiqueta_devolucao
  FOR EACH ROW EXECUTE FUNCTION etiqueta_devolucao_valida();

CREATE TABLE etiqueta_devolucao_ficheiro (
  devolucao_id uuid PRIMARY KEY,
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  tentativa integer NOT NULL,
  formato text NOT NULL CHECK (formato IN ('pdf', 'zpl')),
  conteudo bytea NOT NULL CHECK (octet_length(conteudo) BETWEEN 1 AND 2000000),
  criado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (comerciante_id, devolucao_id)
    REFERENCES etiqueta_devolucao (comerciante_id, devolucao_id)
);

-- O histórico de cada etiqueta (revisão do #447, P2): uma linha por mudança
-- de estado, só se acrescenta; escreve-o o gatilho. Guarda o seguimento de
-- uma etiqueta paga mesmo depois de se pedir outra.
CREATE TABLE etiqueta_devolucao_historico (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  devolucao_id uuid NOT NULL,
  tentativa integer NOT NULL,
  estado text NOT NULL,
  conta_transportadora_id uuid NOT NULL,
  servico text NOT NULL,
  seguimento text,
  motivo text,
  quem text,
  em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (comerciante_id, devolucao_id)
    REFERENCES etiqueta_devolucao (comerciante_id, devolucao_id)
);

CREATE FUNCTION etiqueta_devolucao_historico() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.estado IS NOT DISTINCT FROM OLD.estado THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.etiqueta_devolucao_historico (comerciante_id, devolucao_id, tentativa,
    estado, conta_transportadora_id, servico, seguimento, motivo, quem)
  VALUES (NEW.comerciante_id, NEW.devolucao_id, NEW.tentativa, NEW.estado,
    NEW.conta_transportadora_id, NEW.servico, NEW.seguimento, NEW.motivo,
    nullif(btrim(current_setting('eurolify.quem', true)), ''));
  RETURN NULL;
END
$$;
CREATE TRIGGER etiqueta_devolucao_historico AFTER INSERT OR UPDATE OF estado
  ON etiqueta_devolucao FOR EACH ROW EXECUTE FUNCTION etiqueta_devolucao_historico();

-- O apagamento do titular limpa o motivo no histórico (pode citar a morada).
CREATE FUNCTION etiqueta_devolucao_historico_limpar(p_encomenda uuid) RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  UPDATE public.etiqueta_devolucao_historico h SET motivo = NULL
  FROM public.devolucao d
  WHERE h.devolucao_id = d.id AND d.encomenda_id = p_encomenda
    AND h.comerciante_id = public.comerciante_actual() AND h.motivo IS NOT NULL
$$;

-- Quando apagar o ficheiro de cada devolução acabada (Q7). Interna (RLS sem
-- forçar, como o `trabalho_envio` da 0079): a volta da API percorre-a por
-- todos os comerciantes; escrita só pelo gatilho e pela função.
CREATE TABLE etiqueta_devolucao_prazo (
  devolucao_id uuid PRIMARY KEY,
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  apagar_em timestamptz NOT NULL
);
ALTER TABLE etiqueta_devolucao_prazo ENABLE ROW LEVEL SECURITY;
CREATE POLICY so_o_proprio ON etiqueta_devolucao_prazo
  USING (comerciante_id = comerciante_actual())
  WITH CHECK (comerciante_id = comerciante_actual());
REVOKE ALL ON etiqueta_devolucao_prazo FROM PUBLIC;

-- A devolução acabou (fechada ou cancelada): a etiqueta guarda quando, e o
-- ficheiro sai 30 dias depois (Q7). Sem ALWAYS (regra da 0053).
CREATE FUNCTION devolucao_etiqueta_acabou() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.estado IN ('fechada', 'cancelada') AND OLD.estado NOT IN ('fechada', 'cancelada') THEN
    UPDATE public.etiqueta_devolucao SET acabou_em = now()
    WHERE devolucao_id = NEW.id AND comerciante_id = NEW.comerciante_id;
    IF FOUND THEN
      INSERT INTO public.etiqueta_devolucao_prazo (devolucao_id, comerciante_id, apagar_em)
      VALUES (NEW.id, NEW.comerciante_id, now() + interval '30 days')
      ON CONFLICT (devolucao_id) DO NOTHING;
    END IF;
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER devolucao_etiqueta_acabou AFTER UPDATE OF estado ON devolucao
  FOR EACH ROW EXECUTE FUNCTION devolucao_etiqueta_acabou();

-- Os ficheiros com o prazo passado, comerciante a comerciante (o RLS do
-- ficheiro é forçado), como `envios_avisos_resumir` (0079).
CREATE FUNCTION envios_devolucao_ficheiros_apagar() RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  antes text := current_setting('eurolify.comerciante', true);
  p record;
  n integer := 0;
  m integer;
BEGIN
  FOR p IN SELECT d.devolucao_id, d.comerciante_id FROM public.etiqueta_devolucao_prazo d
           WHERE d.apagar_em <= now() ORDER BY d.apagar_em LIMIT 1000 LOOP
    PERFORM set_config('eurolify.comerciante', p.comerciante_id::text, true);
    DELETE FROM public.etiqueta_devolucao_ficheiro f
    WHERE f.devolucao_id = p.devolucao_id AND f.comerciante_id = p.comerciante_id;
    GET DIAGNOSTICS m = ROW_COUNT;
    n := n + m;
    DELETE FROM public.etiqueta_devolucao_prazo d WHERE d.devolucao_id = p.devolucao_id;
  END LOOP;
  PERFORM set_config('eurolify.comerciante', coalesce(antes, ''), true);
  RETURN n;
END
$$;

-- O apagamento do titular (0072) leva também a etiqueta de devolução (o
-- nome e a morada) e o motivo de uma recusa, que pode citar a morada.
CREATE FUNCTION encomenda_titular_devolucoes() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NOT public.clientes_pseudonimizacao_em_curso()
     OR NEW.entrega IS NOT DISTINCT FROM OLD.entrega THEN
    RETURN NULL;
  END IF;
  DELETE FROM public.etiqueta_devolucao_ficheiro f
  USING public.devolucao d
  WHERE f.devolucao_id = d.id AND d.encomenda_id = NEW.id;
  UPDATE public.etiqueta_devolucao e SET motivo = NULL
  FROM public.devolucao d
  WHERE e.devolucao_id = d.id AND d.encomenda_id = NEW.id AND e.motivo IS NOT NULL;
  PERFORM public.etiqueta_devolucao_historico_limpar(NEW.id);
  RETURN NULL;
END
$$;
CREATE TRIGGER encomenda_titular_devolucoes AFTER UPDATE OF entrega ON encomenda
  FOR EACH ROW EXECUTE FUNCTION encomenda_titular_devolucoes();

DO $$
DECLARE
  tabela text;
BEGIN
  FOREACH tabela IN ARRAY ARRAY['etiqueta_devolucao', 'etiqueta_devolucao_ficheiro',
    'etiqueta_devolucao_historico'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tabela);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tabela);
    EXECUTE format(
      'CREATE POLICY so_o_proprio ON %I USING (comerciante_id = comerciante_actual()) WITH CHECK (comerciante_id = comerciante_actual())',
      tabela);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC', tabela);
  END LOOP;
END
$$;

GRANT SELECT ON etiqueta_devolucao, etiqueta_devolucao_ficheiro, etiqueta_devolucao_historico
  TO eurolify_api;
GRANT INSERT (devolucao_id, comerciante_id, conta_transportadora_id, transportadora, servico,
  peso_g, criado_por) ON etiqueta_devolucao TO eurolify_api;
GRANT UPDATE (conta_transportadora_id, transportadora, servico, estado, tentativa, peso_g, motivo,
  seguimento, url_seguimento, criado_por) ON etiqueta_devolucao TO eurolify_api;
GRANT INSERT (devolucao_id, comerciante_id, tentativa, formato, conteudo)
  ON etiqueta_devolucao_ficheiro TO eurolify_api;
GRANT DELETE ON etiqueta_devolucao_ficheiro TO eurolify_api;

REVOKE EXECUTE ON FUNCTION etiqueta_devolucao_valida(), devolucao_etiqueta_acabou(),
  envios_devolucao_ficheiros_apagar(), encomenda_titular_devolucoes(),
  etiqueta_devolucao_historico(), etiqueta_devolucao_historico_limpar(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION envios_devolucao_ficheiros_apagar() TO eurolify_api;
