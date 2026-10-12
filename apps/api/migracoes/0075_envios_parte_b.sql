-- Envios, parte B (docs/36 §3.3 a §3.5, §4, §8; docs/06, ED; issue #393;
-- Diogo, 12/10/2026: «depois avança com a parte B dos envios»): a etiqueta
-- pedida à transportadora pela conta e pelo serviço vendidos, com o peso da
-- caixa; o ficheiro dela, privado e apagado 30 dias depois de a expedição
-- acabar (Q7); os eventos de seguimento, só acrescentados; os avisos das
-- transportadoras em bruto; e o trabalho que a API faz sozinha (consultar o
-- seguimento, resolver uma etiqueta incerta, apagar ficheiros).
SET LOCAL lock_timeout = '10s';

-- --------------------------------------------- O peso da caixa (Q6)

-- O peso da embalagem por omissão do armazém, somado ao das variantes. Zero
-- até o comerciante o dizer: nenhum peso se inventa.
ALTER TABLE armazem
  ADD COLUMN embalagem_g integer NOT NULL DEFAULT 0 CHECK (embalagem_g BETWEEN 0 AND 100000);
GRANT UPDATE (embalagem_g) ON armazem TO eurolify_api;

-- ------------------------------------------- A etiqueta na expedição (§3.3)

-- A chave estrangeira nova valida-se lendo as linhas existentes, e a migração
-- corre sem comerciante: o NO FORCE só dura esta transacção (como a 0044).
ALTER TABLE expedicao NO FORCE ROW LEVEL SECURITY;
ALTER TABLE conta_transportadora NO FORCE ROW LEVEL SECURITY;
ALTER TABLE expedicao
  -- A conta e o serviço copiam-se do método vendido (R1); o serviço da 0047
  -- passa a ser o código da transportadora quando há conta.
  ADD COLUMN conta_transportadora_id uuid,
  ADD COLUMN peso_g integer CHECK (peso_g IS NULL OR peso_g BETWEEN 1 AND 1000000),
  ADD COLUMN etiqueta text NOT NULL DEFAULT 'por_pedir' CHECK (etiqueta IN (
    'por_pedir', 'a_pedir', 'emitida', 'incerta', 'recusada', 'anulada')),
  -- Cada pedido de etiqueta leva uma tentativa nova; a referência na
  -- transportadora é «<expedição>-<tentativa>» (R2).
  ADD COLUMN etiqueta_tentativa integer NOT NULL DEFAULT 0 CHECK (etiqueta_tentativa BETWEEN 0 AND 1000),
  ADD COLUMN etiqueta_motivo text CHECK (etiqueta_motivo IS NULL OR length(etiqueta_motivo) <= 500),
  ADD COLUMN etiqueta_em timestamptz,
  ADD COLUMN url_seguimento text CHECK (url_seguimento IS NULL
    OR (length(url_seguimento) <= 500 AND url_seguimento ~ '^https://')),
  ADD CONSTRAINT expedicao_conta_fk FOREIGN KEY (comerciante_id, conta_transportadora_id)
    REFERENCES conta_transportadora (comerciante_id, id);
ALTER TABLE expedicao FORCE ROW LEVEL SECURITY;

GRANT UPDATE (conta_transportadora_id, peso_g, etiqueta, etiqueta_tentativa, etiqueta_motivo,
  etiqueta_em, url_seguimento) ON expedicao TO eurolify_api;

-- A etiqueta só anda pelos caminhos do §4.1, e no máximo uma viva por
-- expedição (R2): pedir outra exige anular, ou a transportadora dizer que
-- não existe (recusada).
CREATE FUNCTION expedicao_etiqueta_valida() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.etiqueta IS NOT DISTINCT FROM OLD.etiqueta THEN
    RETURN NEW;
  END IF;
  IF NOT (
       (OLD.etiqueta IN ('por_pedir', 'recusada', 'anulada') AND NEW.etiqueta = 'a_pedir')
    OR (OLD.etiqueta = 'a_pedir' AND NEW.etiqueta IN ('emitida', 'incerta', 'recusada'))
    OR (OLD.etiqueta = 'incerta' AND NEW.etiqueta IN ('emitida', 'recusada'))
    OR (OLD.etiqueta = 'emitida' AND NEW.etiqueta = 'anulada')) THEN
    RAISE EXCEPTION 'shipping.invalid_transition: etiqueta % → %', OLD.etiqueta, NEW.etiqueta;
  END IF;
  IF NEW.etiqueta = 'a_pedir' AND NEW.etiqueta_tentativa <> OLD.etiqueta_tentativa + 1 THEN
    RAISE EXCEPTION 'shipping.invalid_transition: cada pedido de etiqueta é uma tentativa nova';
  END IF;
  IF NEW.etiqueta = 'a_pedir' AND OLD.estado <> 'criada' THEN
    RAISE EXCEPTION 'shipping.label_exists: a expedição já saiu';
  END IF;
  IF NEW.etiqueta = 'anulada' AND OLD.estado <> 'criada' THEN
    RAISE EXCEPTION 'shipping.void_not_allowed: a expedição já saiu';
  END IF;
  NEW.etiqueta_em := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER expedicao_etiqueta_valida
  BEFORE UPDATE OF etiqueta ON expedicao
  FOR EACH ROW EXECUTE FUNCTION expedicao_etiqueta_valida();
ALTER TABLE expedicao ENABLE ALWAYS TRIGGER expedicao_etiqueta_valida;

-- Os eventos da etiqueta (§7.5): só identificadores e o estado.
CREATE FUNCTION expedicao_etiqueta_evento() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.etiqueta IS NOT DISTINCT FROM OLD.etiqueta
     OR NEW.etiqueta NOT IN ('emitida', 'recusada', 'anulada') THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.evento_saida (comerciante_id, tipo, agregado_tipo, agregado_id, dados)
  VALUES (NEW.comerciante_id,
    CASE NEW.etiqueta
      WHEN 'emitida' THEN 'shipment.label_created'
      WHEN 'recusada' THEN 'shipment.label_refused'
      ELSE 'shipment.label_voided'
    END,
    'expedicao', NEW.id,
    jsonb_build_object('expedicao_id', NEW.id, 'encomenda_id', NEW.encomenda_id,
      'etiqueta', NEW.etiqueta,
      'em', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
  RETURN NULL;
END
$$;
CREATE TRIGGER expedicao_etiqueta_evento AFTER UPDATE OF etiqueta ON expedicao
  FOR EACH ROW EXECUTE FUNCTION expedicao_etiqueta_evento();

-- ----------------------------------------- O ficheiro da etiqueta (§3.5)

-- Na base, privado e à parte das imagens públicas (desvio do §3.5: a pasta
-- das imagens apaga o que nenhum artigo usa). Leva o nome, a morada e o
-- telefone de quem recebe: apaga-se 30 dias depois de a expedição acabar
-- (Q7), ou logo, num pedido de apagamento do titular.
CREATE TABLE etiqueta_ficheiro (
  expedicao_id uuid PRIMARY KEY,
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  tentativa integer NOT NULL,
  formato text NOT NULL CHECK (formato IN ('pdf', 'zpl')),
  conteudo bytea NOT NULL CHECK (octet_length(conteudo) BETWEEN 1 AND 2000000),
  criado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (comerciante_id, expedicao_id) REFERENCES expedicao (comerciante_id, id)
);

-- --------------------------------------- Os eventos de seguimento (§3.4)

CREATE TABLE evento_seguimento (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  expedicao_id uuid NOT NULL,
  origem text NOT NULL CHECK (origem IN ('aviso', 'consulta')),
  id_externo text NOT NULL CHECK (length(btrim(id_externo)) BETWEEN 1 AND 200),
  estado_transportadora text NOT NULL CHECK (length(estado_transportadora) BETWEEN 1 AND 100),
  estado_normalizado text NOT NULL CHECK (estado_normalizado IN ('recolhida', 'em_transito',
    'tentativa_falhada', 'disponivel_para_levantar', 'entregue', 'devolvida', 'perdida', 'outro')),
  em timestamptz NOT NULL,
  recebido_em timestamptz NOT NULL DEFAULT now(),
  -- O mesmo evento duas vezes não conta duas vezes (§3.4).
  UNIQUE (expedicao_id, id_externo),
  FOREIGN KEY (comerciante_id, expedicao_id) REFERENCES expedicao (comerciante_id, id)
);
CREATE INDEX evento_seguimento_por_expedicao ON evento_seguimento (comerciante_id, expedicao_id, em);
CREATE TRIGGER evento_seguimento_so_se_acrescenta
  BEFORE UPDATE OR DELETE ON evento_seguimento
  FOR EACH ROW EXECUTE FUNCTION rasto_so_se_acrescenta();
ALTER TABLE evento_seguimento ENABLE ALWAYS TRIGGER evento_seguimento_so_se_acrescenta;
CREATE TRIGGER evento_seguimento_sem_truncate BEFORE TRUNCATE ON evento_seguimento
  FOR EACH STATEMENT EXECUTE FUNCTION rasto_so_se_acrescenta();

-- --------------------------------- Os avisos das transportadoras (R3)

-- O aviso grava-se em bruto antes de se tratar; o corpo pode trazer quem
-- recebeu, por isso o apagamento do titular resume-o.
CREATE TABLE aviso_transportadora (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  conta_id uuid NOT NULL,
  expedicao_id uuid,
  corpo text NOT NULL CHECK (length(corpo) <= 65536),
  assinatura_valida boolean NOT NULL,
  resultado text CHECK (resultado IS NULL OR resultado IN ('tratado', 'ignorado', 'erro')),
  erro text CHECK (erro IS NULL OR length(erro) <= 500),
  recebido_em timestamptz NOT NULL DEFAULT now(),
  processado_em timestamptz,
  FOREIGN KEY (comerciante_id, conta_id) REFERENCES conta_transportadora (comerciante_id, id),
  FOREIGN KEY (comerciante_id, expedicao_id) REFERENCES expedicao (comerciante_id, id)
);
CREATE FUNCTION aviso_transportadora_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND public.titular_limpeza_permitida(to_jsonb(OLD), to_jsonb(NEW),
       ARRAY['corpo']) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'shipping.immutable: um aviso não se apaga';
  END IF;
  IF (to_jsonb(NEW) - 'expedicao_id' - 'resultado' - 'erro' - 'processado_em')
     IS DISTINCT FROM (to_jsonb(OLD) - 'expedicao_id' - 'resultado' - 'erro' - 'processado_em') THEN
    RAISE EXCEPTION 'shipping.immutable: o aviso em bruto não muda';
  END IF;
  IF OLD.resultado IS NOT NULL AND OLD.resultado <> 'erro' THEN
    RAISE EXCEPTION 'shipping.immutable: um aviso tratado não muda';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER aviso_transportadora_antes_de_gravar
  BEFORE UPDATE OR DELETE ON aviso_transportadora
  FOR EACH ROW EXECUTE FUNCTION aviso_transportadora_antes_de_gravar();
ALTER TABLE aviso_transportadora ENABLE ALWAYS TRIGGER aviso_transportadora_antes_de_gravar;

-- A porta dos avisos: do endereço (a conta) para o comerciante, como a dos
-- pagamentos (0044): uma tabela interna (RLS sem forçar) que só o gatilho
-- escreve e só a função lê.
CREATE TABLE conta_transportadora_aviso (
  conta_id uuid PRIMARY KEY,
  comerciante_id uuid NOT NULL REFERENCES comerciante (id)
);
ALTER TABLE conta_transportadora_aviso ENABLE ROW LEVEL SECURITY;
CREATE POLICY so_o_proprio ON conta_transportadora_aviso
  USING (comerciante_id = comerciante_actual())
  WITH CHECK (comerciante_id = comerciante_actual());
REVOKE ALL ON conta_transportadora_aviso FROM PUBLIC;
INSERT INTO conta_transportadora_aviso (conta_id, comerciante_id)
  SELECT id, comerciante_id FROM conta_transportadora;
ALTER TABLE conta_transportadora FORCE ROW LEVEL SECURITY;

CREATE FUNCTION conta_transportadora_porta() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  INSERT INTO public.conta_transportadora_aviso (conta_id, comerciante_id)
  VALUES (NEW.id, NEW.comerciante_id);
  RETURN NULL;
END
$$;
CREATE TRIGGER conta_transportadora_porta AFTER INSERT ON conta_transportadora
  FOR EACH ROW EXECUTE FUNCTION conta_transportadora_porta();

CREATE FUNCTION envios_conta_do_aviso(p_conta uuid) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT a.comerciante_id FROM public.conta_transportadora_aviso a WHERE a.conta_id = p_conta
$$;

-- ------------------------------------------ O trabalho que a API faz só

-- Uma linha por expedição com trabalho: seguir uma etiqueta emitida até a
-- expedição acabar, resolver uma incerta, apagar o ficheiro 30 dias depois
-- (Q7). Interna (RLS sem forçar), escrita só pelo gatilho e pelas funções.
CREATE TABLE trabalho_envio (
  expedicao_id uuid PRIMARY KEY,
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  quando timestamptz NOT NULL
);
ALTER TABLE trabalho_envio ENABLE ROW LEVEL SECURITY;
CREATE POLICY so_o_proprio ON trabalho_envio
  USING (comerciante_id = comerciante_actual())
  WITH CHECK (comerciante_id = comerciante_actual());
REVOKE ALL ON trabalho_envio FROM PUBLIC;

CREATE FUNCTION expedicao_trabalho() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quando timestamptz;
BEGIN
  IF NEW.estado IN ('entregue', 'devolvida_ao_remetente', 'perdida', 'cancelada') THEN
    -- Acabou: só fica o ficheiro, que sai 30 dias depois (Q7).
    IF EXISTS (SELECT FROM public.etiqueta_ficheiro f WHERE f.expedicao_id = NEW.id) THEN
      quando := now() + interval '30 days';
    END IF;
  ELSIF NEW.etiqueta IN ('emitida', 'incerta') THEN
    quando := now() + interval '15 minutes';
  END IF;
  IF quando IS NULL THEN
    DELETE FROM public.trabalho_envio WHERE expedicao_id = NEW.id;
  ELSE
    INSERT INTO public.trabalho_envio (expedicao_id, comerciante_id, quando)
    VALUES (NEW.id, NEW.comerciante_id, quando)
    ON CONFLICT (expedicao_id) DO UPDATE SET quando = EXCLUDED.quando;
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER expedicao_trabalho AFTER UPDATE OF etiqueta, estado ON expedicao
  FOR EACH ROW EXECUTE FUNCTION expedicao_trabalho();

CREATE FUNCTION envios_comerciantes_com_trabalho() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT DISTINCT t.comerciante_id FROM public.trabalho_envio t WHERE t.quando <= now()
$$;

CREATE FUNCTION envios_trabalho(p_limite integer) RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT t.expedicao_id FROM public.trabalho_envio t
  WHERE t.comerciante_id = public.comerciante_actual() AND t.quando <= now()
  ORDER BY t.quando, t.expedicao_id
  LIMIT greatest(p_limite, 0)
$$;

-- Adia a próxima volta (a consulta falhou, ou ainda não há nada novo).
CREATE FUNCTION envios_trabalho_adiar(p_expedicao uuid, p_minutos integer) RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  UPDATE public.trabalho_envio
  SET quando = now() + make_interval(mins => least(greatest(p_minutos, 1), 10080))
  WHERE expedicao_id = p_expedicao AND comerciante_id = public.comerciante_actual()
$$;

-- O ficheiro saiu: a expedição acabada já não tem trabalho.
CREATE FUNCTION envios_trabalho_feito(p_expedicao uuid) RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  DELETE FROM public.trabalho_envio
  WHERE expedicao_id = p_expedicao AND comerciante_id = public.comerciante_actual()
$$;

-- ---------------------------------- O apagamento do titular (docs/23 §15)

-- A encomenda limpa pelo apagamento do titular (0072) leva a etiqueta (tem
-- o nome, a morada e o telefone) e resume os avisos das transportadoras:
-- não esperam os 30 dias (eu-gdpr-privacy).
CREATE FUNCTION encomenda_titular_envios() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NOT public.clientes_pseudonimizacao_em_curso()
     OR NEW.entrega IS NOT DISTINCT FROM OLD.entrega THEN
    RETURN NULL;
  END IF;
  DELETE FROM public.etiqueta_ficheiro f
  USING public.expedicao x
  WHERE f.expedicao_id = x.id AND x.encomenda_id = NEW.id;
  UPDATE public.aviso_transportadora a SET corpo = '(pseudonimizado)'
  FROM public.expedicao x
  WHERE a.expedicao_id = x.id AND x.encomenda_id = NEW.id AND a.corpo <> '(pseudonimizado)';
  RETURN NULL;
END
$$;
CREATE TRIGGER encomenda_titular_envios AFTER UPDATE OF entrega ON encomenda
  FOR EACH ROW EXECUTE FUNCTION encomenda_titular_envios();

-- ----------------------------------------------------- RLS e permissões

DO $$
DECLARE
  tabela text;
BEGIN
  FOREACH tabela IN ARRAY ARRAY['etiqueta_ficheiro', 'evento_seguimento',
    'aviso_transportadora'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tabela);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tabela);
    EXECUTE format(
      'CREATE POLICY so_o_proprio ON %I USING (comerciante_id = comerciante_actual()) WITH CHECK (comerciante_id = comerciante_actual())',
      tabela);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC', tabela);
  END LOOP;
END
$$;

GRANT SELECT ON etiqueta_ficheiro, evento_seguimento, aviso_transportadora TO eurolify_api;
GRANT INSERT (expedicao_id, comerciante_id, tentativa, formato, conteudo) ON etiqueta_ficheiro
  TO eurolify_api;
GRANT DELETE ON etiqueta_ficheiro TO eurolify_api;
GRANT INSERT (comerciante_id, expedicao_id, origem, id_externo, estado_transportadora,
  estado_normalizado, em) ON evento_seguimento TO eurolify_api;
GRANT INSERT (comerciante_id, conta_id, corpo, assinatura_valida) ON aviso_transportadora
  TO eurolify_api;
GRANT UPDATE (expedicao_id, resultado, erro, processado_em) ON aviso_transportadora
  TO eurolify_api;

REVOKE EXECUTE ON FUNCTION expedicao_etiqueta_valida(), expedicao_etiqueta_evento(),
  aviso_transportadora_antes_de_gravar(), conta_transportadora_porta(),
  envios_conta_do_aviso(uuid), expedicao_trabalho(), envios_comerciantes_com_trabalho(),
  envios_trabalho(integer), envios_trabalho_adiar(uuid, integer),
  envios_trabalho_feito(uuid), encomenda_titular_envios() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION envios_conta_do_aviso(uuid), envios_comerciantes_com_trabalho(),
  envios_trabalho(integer), envios_trabalho_adiar(uuid, integer), envios_trabalho_feito(uuid)
  TO eurolify_api;
