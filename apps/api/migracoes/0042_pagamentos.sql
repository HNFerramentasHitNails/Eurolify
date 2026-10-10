-- Pagamentos, parte 1 (docs/26; issue #287; Diogo, 09/10/2026: «sim,
-- aprovo; avança com o código da fatia 8»): contas do comerciante no
-- prestador (só em modo teste nesta parte), a régua método → conta por
-- mercado, o pagamento com a máquina de estados da skill payments-psd2-sca,
-- as transições com a origem, os avisos em bruto, a fila de diferenças e a
-- encomenda paga ou cancelada sem pagamento. O Eurolify nunca recebe o
-- dinheiro (ADR-0038): só os avisos do prestador.
SET LOCAL lock_timeout = '10s';

-- ------------------------------------------------------ Conta de pagamento

CREATE TABLE conta_pagamento (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  prestador text NOT NULL CHECK (prestador IN ('eupago')),
  nome text NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 100),
  -- Só teste nesta parte: nenhum pagamento real entra no ensaio (ADR-0019).
  -- Abrir o modo real é uma migração com decisão escrita.
  modo text NOT NULL DEFAULT 'teste' CHECK (modo = 'teste'),
  -- As credenciais e o segredo dos avisos, cifrados com AES-256-GCM pela API
  -- (a chave fica fora da base, PAGAMENTOS_CHAVE); nunca saem pela API.
  credenciais_cifra bytea,
  segredo_aviso_cifra bytea,
  chave_versao text CHECK (chave_versao IS NULL OR chave_versao ~ '^[0-9A-Za-z_-]{1,20}$'),
  credenciais_em timestamptz,
  credenciais_por text,
  testada_em timestamptz,
  estado text NOT NULL DEFAULT 'rascunho' CHECK (estado IN ('rascunho', 'pronta', 'arquivada')),
  criado_em timestamptz NOT NULL DEFAULT now(),
  actualizado_em timestamptz NOT NULL DEFAULT now(),
  versao integer NOT NULL DEFAULT 1,
  UNIQUE (comerciante_id, id),
  UNIQUE (comerciante_id, prestador, id),
  CHECK ((credenciais_cifra IS NULL) = (chave_versao IS NULL)),
  -- Pronta só com as credenciais, o segredo dos avisos e a chamada de teste.
  CHECK (estado <> 'pronta' OR (credenciais_cifra IS NOT NULL
    AND segredo_aviso_cifra IS NOT NULL AND testada_em IS NOT NULL))
);

-- A porta dos avisos: do endereço (a conta) para o comerciante. Como o
-- token_checkout da 0041, uma tabela interna (RLS sem forçar), que só o
-- gatilho escreve e só a função lê.
CREATE TABLE conta_pagamento_aviso (
  conta_id uuid PRIMARY KEY,
  comerciante_id uuid NOT NULL REFERENCES comerciante (id)
);
ALTER TABLE conta_pagamento_aviso ENABLE ROW LEVEL SECURITY;
CREATE POLICY so_o_proprio ON conta_pagamento_aviso
  USING (comerciante_id = comerciante_actual())
  WITH CHECK (comerciante_id = comerciante_actual());
REVOKE ALL ON conta_pagamento_aviso FROM PUBLIC;

CREATE FUNCTION conta_pagamento_porta() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  INSERT INTO public.conta_pagamento_aviso (conta_id, comerciante_id)
  VALUES (NEW.id, NEW.comerciante_id);
  RETURN NULL;
END
$$;
CREATE TRIGGER conta_pagamento_porta AFTER INSERT ON conta_pagamento
  FOR EACH ROW EXECUTE FUNCTION conta_pagamento_porta();

CREATE FUNCTION pagamentos_conta_do_aviso(p_conta uuid) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT a.comerciante_id FROM public.conta_pagamento_aviso a WHERE a.conta_id = p_conta
$$;

CREATE FUNCTION conta_pagamento_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payments.immutable: uma conta de pagamento não se apaga (arquiva-se)';
  END IF;
  IF NEW.prestador IS DISTINCT FROM OLD.prestador OR NEW.modo IS DISTINCT FROM OLD.modo
     OR NEW.comerciante_id IS DISTINCT FROM OLD.comerciante_id THEN
    RAISE EXCEPTION 'payments.immutable: o prestador e o modo de uma conta não mudam';
  END IF;
  IF OLD.estado = 'arquivada' THEN
    RAISE EXCEPTION 'payments.immutable: uma conta arquivada não muda';
  END IF;
  -- Credenciais novas: a conta volta a rascunho até à chamada de teste.
  IF NEW.credenciais_cifra IS DISTINCT FROM OLD.credenciais_cifra
     OR NEW.segredo_aviso_cifra IS DISTINCT FROM OLD.segredo_aviso_cifra THEN
    IF NEW.estado = 'pronta' AND NEW.testada_em IS NOT DISTINCT FROM OLD.testada_em THEN
      NEW.estado := 'rascunho';
      NEW.testada_em := NULL;
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER conta_pagamento_antes_de_gravar
  BEFORE UPDATE OR DELETE ON conta_pagamento
  FOR EACH ROW EXECUTE FUNCTION conta_pagamento_antes_de_gravar();
ALTER TABLE conta_pagamento ENABLE ALWAYS TRIGGER conta_pagamento_antes_de_gravar;

-- ------------------------------------------------ A régua: método por mercado

CREATE TABLE metodo_pagamento (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  loja_id uuid NOT NULL,
  mercado_id uuid NOT NULL,
  -- A lista fechada do núcleo (docs/26 §3.2); a parte 2 acrescenta o cartão.
  metodo text NOT NULL CHECK (metodo IN ('mb_way', 'multibanco')),
  conta_id uuid NOT NULL,
  ordem integer NOT NULL DEFAULT 0 CHECK (ordem BETWEEN 0 AND 1000),
  -- O tempo do cliente para pagar (proposta; docs/26 Q5: nunca mais de 24 h).
  prazo_minutos integer NOT NULL CHECK (prazo_minutos BETWEEN 5 AND 1440),
  estado text NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'arquivado')),
  criado_em timestamptz NOT NULL DEFAULT now(),
  actualizado_em timestamptz NOT NULL DEFAULT now(),
  versao integer NOT NULL DEFAULT 1,
  UNIQUE (comerciante_id, id),
  FOREIGN KEY (comerciante_id, loja_id, mercado_id) REFERENCES mercado (comerciante_id, loja_id, id),
  FOREIGN KEY (comerciante_id, conta_id) REFERENCES conta_pagamento (comerciante_id, id)
);
-- Um método activo por mercado.
CREATE UNIQUE INDEX metodo_pagamento_um_activo
  ON metodo_pagamento (mercado_id, metodo) WHERE estado = 'activo';

CREATE FUNCTION metodo_pagamento_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payments.immutable: um método não se apaga (arquiva-se)';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.mercado_id IS DISTINCT FROM OLD.mercado_id
     OR NEW.metodo IS DISTINCT FROM OLD.metodo OR NEW.loja_id IS DISTINCT FROM OLD.loja_id) THEN
    RAISE EXCEPTION 'payments.immutable: o mercado e o método não mudam';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.estado = 'arquivado' THEN
    RAISE EXCEPTION 'payments.immutable: um método arquivado não muda';
  END IF;
  -- O prestador da conta tem de saber o método (nesta parte, a EuPago sabe
  -- os dois) e a conta não pode estar arquivada.
  -- Arquivar um método nunca se recusa (revisão do #288, P3-4).
  IF NEW.estado = 'activo' AND NOT EXISTS (SELECT 1 FROM public.conta_pagamento c
                 WHERE c.id = NEW.conta_id AND c.estado <> 'arquivada') THEN
    RAISE EXCEPTION 'payments.account_not_ready: a conta está arquivada';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER metodo_pagamento_antes_de_gravar
  BEFORE INSERT OR UPDATE OR DELETE ON metodo_pagamento
  FOR EACH ROW EXECUTE FUNCTION metodo_pagamento_antes_de_gravar();
ALTER TABLE metodo_pagamento ENABLE ALWAYS TRIGGER metodo_pagamento_antes_de_gravar;

-- -------------------------------------------------------------- Pagamento

CREATE TABLE pagamento (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  encomenda_id uuid NOT NULL,
  -- Copiados da régua: mudar a régua depois não muda o pagamento.
  conta_id uuid NOT NULL,
  prestador text NOT NULL CHECK (prestador IN ('eupago')),
  metodo text NOT NULL CHECK (metodo IN ('mb_way', 'multibanco')),
  modo text NOT NULL CHECK (modo = 'teste'),
  -- Copiados da encomenda; nunca do pedido (docs/26 R1).
  montante bigint NOT NULL CHECK (montante > 0),
  moeda text NOT NULL CHECK (moeda ~ '^[A-Z]{3}$'),
  -- A nossa referência, a mesma que vai ao prestador (identifier).
  referencia text NOT NULL UNIQUE CHECK (referencia ~ '^[0-9a-f]{32}$'),
  referencia_prestador text CHECK (referencia_prestador IS NULL
    OR length(referencia_prestador) BETWEEN 1 AND 100),
  instrucoes jsonb CHECK (instrucoes IS NULL OR jsonb_typeof(instrucoes) = 'object'),
  estado text NOT NULL DEFAULT 'criado' CHECK (estado IN ('criado', 'a_aguardar_cliente',
    'autorizado', 'capturado', 'falhado', 'expirado', 'anulado', 'incerto',
    'reembolsado_parcial', 'reembolsado', 'em_disputa', 'ganha', 'perdida')),
  expira_em timestamptz NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  actualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (comerciante_id, id),
  FOREIGN KEY (comerciante_id, encomenda_id) REFERENCES encomenda (comerciante_id, id),
  FOREIGN KEY (comerciante_id, prestador, conta_id)
    REFERENCES conta_pagamento (comerciante_id, prestador, id)
);
-- Só um pagamento vivo por encomenda (docs/26 R2).
CREATE UNIQUE INDEX pagamento_um_vivo ON pagamento (encomenda_id)
  WHERE estado IN ('criado', 'a_aguardar_cliente', 'autorizado', 'incerto');
CREATE INDEX pagamento_por_encomenda ON pagamento (comerciante_id, encomenda_id);

-- A máquina de estados (skill payments-psd2-sca): só para a frente. Do
-- incerto só se sai por consulta ao prestador ou por uma pessoa.
CREATE FUNCTION pagamento_transicao_valida(p_de text, p_para text) RETURNS boolean
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT (p_de, p_para) IN (
    ('criado', 'a_aguardar_cliente'), ('criado', 'falhado'), ('criado', 'incerto'),
    ('a_aguardar_cliente', 'autorizado'), ('a_aguardar_cliente', 'capturado'),
    ('a_aguardar_cliente', 'falhado'), ('a_aguardar_cliente', 'expirado'),
    ('a_aguardar_cliente', 'incerto'),
    ('autorizado', 'capturado'), ('autorizado', 'anulado'),
    ('incerto', 'autorizado'), ('incerto', 'capturado'), ('incerto', 'falhado'),
    -- A prova tardia (revisão do #288, P1-1 e P1-2): um aviso ou uma consulta
    -- de que foi pago depois de o darmos por expirado ou falhado conta; nunca
    -- se perde um pagamento por o termos dado por acabado cedo.
    ('expirado', 'capturado'), ('falhado', 'capturado'),
    ('capturado', 'reembolsado_parcial'), ('capturado', 'reembolsado'),
    ('capturado', 'em_disputa'), ('reembolsado_parcial', 'reembolsado'),
    ('em_disputa', 'ganha'), ('em_disputa', 'perdida'))
$$;

CREATE FUNCTION pagamento_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  origem text := nullif(btrim(current_setting('eurolify.origem', true)), '');
  quem text := nullif(btrim(current_setting('eurolify.quem', true)), '');
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payments.immutable: um pagamento não se apaga';
  END IF;
  IF quem IS NULL THEN
    RAISE EXCEPTION 'payments.change_without_who: % sem eurolify.quem', TG_OP;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.estado := 'criado';
    NEW.criado_em := now();
    NEW.actualizado_em := now();
    IF NOT EXISTS (SELECT 1 FROM public.encomenda e WHERE e.id = NEW.encomenda_id
                   AND e.estado = 'a_aguardar_pagamento'
                   AND e.total = NEW.montante AND e.moeda = NEW.moeda) THEN
      RAISE EXCEPTION 'payments.order_not_payable: a encomenda não está a aguardar pagamento, ou o montante não é o dela';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - 'estado' - 'actualizado_em' - 'referencia_prestador' - 'instrucoes')
     IS DISTINCT FROM (to_jsonb(OLD) - 'estado' - 'actualizado_em' - 'referencia_prestador' - 'instrucoes') THEN
    RAISE EXCEPTION 'payments.immutable: as cópias do pagamento não mudam';
  END IF;
  IF OLD.referencia_prestador IS NOT NULL
     AND NEW.referencia_prestador IS DISTINCT FROM OLD.referencia_prestador THEN
    RAISE EXCEPTION 'payments.immutable: a referência do prestador não muda';
  END IF;
  IF OLD.instrucoes IS NOT NULL AND NEW.instrucoes IS DISTINCT FROM OLD.instrucoes THEN
    RAISE EXCEPTION 'payments.immutable: as instruções do pagamento não mudam';
  END IF;
  IF NEW.estado IS DISTINCT FROM OLD.estado THEN
    IF origem IS NULL OR origem NOT IN ('aviso', 'consulta', 'pessoa', 'sistema') THEN
      RAISE EXCEPTION 'payments.change_without_origin: a transição precisa de eurolify.origem';
    END IF;
    IF NOT public.pagamento_transicao_valida(OLD.estado, NEW.estado) THEN
      RAISE EXCEPTION 'payments.invalid_transition: % → %', OLD.estado, NEW.estado;
    END IF;
    IF OLD.estado = 'incerto' AND origem NOT IN ('consulta', 'pessoa') THEN
      RAISE EXCEPTION 'payments.invalid_transition: do incerto só por consulta ou por uma pessoa';
    END IF;
    IF OLD.estado IN ('expirado', 'falhado') AND origem NOT IN ('aviso', 'consulta', 'pessoa') THEN
      RAISE EXCEPTION 'payments.invalid_transition: depois de acabado, só com prova do prestador ou de uma pessoa';
    END IF;
  END IF;
  NEW.actualizado_em := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER pagamento_antes_de_gravar
  BEFORE INSERT OR UPDATE OR DELETE ON pagamento
  FOR EACH ROW EXECUTE FUNCTION pagamento_antes_de_gravar();
ALTER TABLE pagamento ENABLE ALWAYS TRIGGER pagamento_antes_de_gravar;
CREATE TRIGGER pagamento_sem_truncate
  BEFORE TRUNCATE ON pagamento
  FOR EACH STATEMENT EXECUTE FUNCTION rasto_so_se_acrescenta();
ALTER TABLE pagamento ENABLE ALWAYS TRIGGER pagamento_sem_truncate;

-- ----------------------------------------------- Aviso do prestador (em bruto)

CREATE TABLE aviso_pagamento (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  conta_id uuid NOT NULL,
  -- O identificador do evento no prestador: a idempotência (o mesmo aviso
  -- duas vezes não conta duas vezes; skill, «Avisos», 3).
  id_evento text NOT NULL CHECK (length(id_evento) BETWEEN 1 AND 200),
  corpo text NOT NULL CHECK (length(corpo) <= 65536),
  assinatura_valida boolean NOT NULL,
  pagamento_id uuid,
  resultado text CHECK (resultado IS NULL OR resultado IN ('aplicado', 'repetido',
    'sem_pagamento', 'assinatura_invalida', 'diferenca', 'erro')),
  erro text CHECK (erro IS NULL OR length(erro) <= 500),
  recebido_em timestamptz NOT NULL DEFAULT now(),
  processado_em timestamptz,
  UNIQUE (comerciante_id, id),
  UNIQUE (conta_id, id_evento),
  FOREIGN KEY (comerciante_id, conta_id) REFERENCES conta_pagamento (comerciante_id, id),
  FOREIGN KEY (comerciante_id, pagamento_id) REFERENCES pagamento (comerciante_id, id)
);

CREATE FUNCTION aviso_pagamento_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payments.immutable: um aviso não se apaga';
  END IF;
  IF (to_jsonb(NEW) - 'pagamento_id' - 'resultado' - 'erro' - 'processado_em')
     IS DISTINCT FROM (to_jsonb(OLD) - 'pagamento_id' - 'resultado' - 'erro' - 'processado_em') THEN
    RAISE EXCEPTION 'payments.immutable: o aviso em bruto não muda';
  END IF;
  IF OLD.resultado IS NOT NULL AND OLD.resultado <> 'erro' THEN
    RAISE EXCEPTION 'payments.immutable: um aviso tratado não muda';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER aviso_pagamento_antes_de_gravar
  BEFORE UPDATE OR DELETE ON aviso_pagamento
  FOR EACH ROW EXECUTE FUNCTION aviso_pagamento_antes_de_gravar();
ALTER TABLE aviso_pagamento ENABLE ALWAYS TRIGGER aviso_pagamento_antes_de_gravar;

-- ------------------------------------------------- Transição (só se acrescenta)

CREATE TABLE transicao_pagamento (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  pagamento_id uuid NOT NULL,
  de text,
  para text NOT NULL,
  origem text NOT NULL CHECK (origem IN ('aviso', 'consulta', 'pessoa', 'sistema')),
  aviso_id uuid,
  quem text NOT NULL,
  motivo text CHECK (motivo IS NULL OR length(motivo) <= 500),
  em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (comerciante_id, pagamento_id) REFERENCES pagamento (comerciante_id, id),
  FOREIGN KEY (comerciante_id, aviso_id) REFERENCES aviso_pagamento (comerciante_id, id)
);
CREATE INDEX transicao_por_pagamento ON transicao_pagamento (pagamento_id, em);
CREATE TRIGGER transicao_pagamento_so_se_acrescenta
  BEFORE UPDATE OR DELETE ON transicao_pagamento
  FOR EACH ROW EXECUTE FUNCTION rasto_so_se_acrescenta();
ALTER TABLE transicao_pagamento ENABLE ALWAYS TRIGGER transicao_pagamento_so_se_acrescenta;
CREATE TRIGGER transicao_pagamento_sem_truncate
  BEFORE TRUNCATE ON transicao_pagamento
  FOR EACH STATEMENT EXECUTE FUNCTION rasto_so_se_acrescenta();
ALTER TABLE transicao_pagamento ENABLE ALWAYS TRIGGER transicao_pagamento_sem_truncate;

-- Cada transição fica com a origem, quem, o aviso e o motivo (skill: cada
-- transição tem origem e o evento em bruto guardado). Escreve-a o gatilho:
-- a API não tem INSERT nesta tabela.
CREATE FUNCTION pagamento_regista_transicao() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  origem text := coalesce(nullif(btrim(current_setting('eurolify.origem', true)), ''), 'sistema');
  aviso text := nullif(btrim(current_setting('eurolify.aviso', true)), '');
  motivo text := nullif(btrim(current_setting('eurolify.motivo', true)), '');
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.estado IS NOT DISTINCT FROM OLD.estado THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.transicao_pagamento (comerciante_id, pagamento_id, de, para, origem,
    aviso_id, quem, motivo)
  VALUES (NEW.comerciante_id, NEW.id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.estado END,
    NEW.estado, origem, aviso::uuid, current_setting('eurolify.quem'), left(motivo, 500));
  INSERT INTO public.evento_saida (comerciante_id, tipo, agregado_tipo, agregado_id, dados)
  VALUES (NEW.comerciante_id,
    CASE NEW.estado
      WHEN 'criado' THEN 'payment.created'
      WHEN 'a_aguardar_cliente' THEN 'payment.pending'
      WHEN 'autorizado' THEN 'payment.authorized'
      WHEN 'capturado' THEN 'payment.captured'
      WHEN 'falhado' THEN 'payment.failed'
      WHEN 'expirado' THEN 'payment.expired'
      WHEN 'anulado' THEN 'payment.voided'
      WHEN 'incerto' THEN 'payment.uncertain'
      ELSE 'payment.' || NEW.estado
    END,
    'pagamento', NEW.id,
    jsonb_build_object('pagamento_id', NEW.id, 'encomenda_id', NEW.encomenda_id,
      'estado', NEW.estado, 'metodo', NEW.metodo, 'modo', NEW.modo,
      'montante', NEW.montante, 'moeda', NEW.moeda,
      'em', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
  RETURN NULL;
END
$$;
CREATE TRIGGER pagamento_regista_transicao AFTER INSERT OR UPDATE OF estado ON pagamento
  FOR EACH ROW EXECUTE FUNCTION pagamento_regista_transicao();

-- ------------------------------------------------------ Diferença (a fila)

CREATE TABLE diferenca_pagamento (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  pagamento_id uuid,
  aviso_id uuid,
  motivo text NOT NULL CHECK (motivo IN ('incerto', 'aviso_sem_pagamento',
    'montante_diferente', 'moeda_diferente', 'transicao_impossivel',
    'pago_depois_de_cancelada', 'pagamento_duplicado')),
  prova jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(prova) = 'object'),
  estado text NOT NULL DEFAULT 'aberta' CHECK (estado IN ('aberta', 'resolvida')),
  resolucao text CHECK (resolucao IS NULL OR length(btrim(resolucao)) BETWEEN 1 AND 2000),
  resolvida_por text,
  resolvida_em timestamptz,
  criada_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (comerciante_id, id),
  FOREIGN KEY (comerciante_id, pagamento_id) REFERENCES pagamento (comerciante_id, id),
  FOREIGN KEY (comerciante_id, aviso_id) REFERENCES aviso_pagamento (comerciante_id, id),
  CHECK ((estado = 'resolvida') = (resolucao IS NOT NULL AND resolvida_por IS NOT NULL
    AND resolvida_em IS NOT NULL))
);
CREATE INDEX diferenca_aberta ON diferenca_pagamento (comerciante_id) WHERE estado = 'aberta';

-- Só uma pessoa a resolve (nunca um processo automático), e resolvida não muda.
CREATE FUNCTION diferenca_pagamento_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payments.immutable: uma diferença não se apaga';
  END IF;
  IF OLD.estado = 'resolvida' THEN
    RAISE EXCEPTION 'payments.immutable: uma diferença resolvida não muda';
  END IF;
  IF (to_jsonb(NEW) - 'estado' - 'resolucao' - 'resolvida_por' - 'resolvida_em')
     IS DISTINCT FROM (to_jsonb(OLD) - 'estado' - 'resolucao' - 'resolvida_por' - 'resolvida_em') THEN
    RAISE EXCEPTION 'payments.immutable: a diferença só muda ao resolver';
  END IF;
  -- Um processo automático (sistema:, checkout:) nunca resolve: só quem
  -- tem a conta do comerciante (a sessão de uma pessoa ou a chave dela).
  IF NEW.resolvida_por !~ '^(pessoa|chave):' THEN
    RAISE EXCEPTION 'payments.issue_needs_person: só uma pessoa resolve uma diferença';
  END IF;
  NEW.resolvida_em := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER diferenca_pagamento_antes_de_gravar
  BEFORE UPDATE OR DELETE ON diferenca_pagamento
  FOR EACH ROW EXECUTE FUNCTION diferenca_pagamento_antes_de_gravar();
ALTER TABLE diferenca_pagamento ENABLE ALWAYS TRIGGER diferenca_pagamento_antes_de_gravar;

-- -------------------------------------------------- A encomenda paga ou não

-- Paga só com um pagamento capturado com o montante e a moeda dela;
-- cancelada sem pagamento só sem pagamento vivo nem capturado (docs/26 §4.2).
CREATE FUNCTION encomenda_estado_com_prova() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.estado IS NOT DISTINCT FROM OLD.estado THEN
    RETURN NEW;
  END IF;
  IF NEW.estado = 'paga' AND NOT EXISTS (
       SELECT 1 FROM public.pagamento p
       WHERE p.encomenda_id = NEW.id AND p.estado = 'capturado'
         AND p.montante = NEW.total AND p.moeda = NEW.moeda) THEN
    RAISE EXCEPTION 'payments.order_not_paid: sem pagamento capturado com o montante e a moeda da encomenda';
  END IF;
  IF NEW.estado = 'cancelada_sem_pagamento' AND EXISTS (
       SELECT 1 FROM public.pagamento p
       WHERE p.encomenda_id = NEW.id
         AND p.estado IN ('criado', 'a_aguardar_cliente', 'autorizado', 'incerto', 'capturado')) THEN
    RAISE EXCEPTION 'payments.order_has_payment: há um pagamento vivo ou capturado';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER encomenda_estado_com_prova
  BEFORE UPDATE OF estado ON encomenda
  FOR EACH ROW EXECUTE FUNCTION encomenda_estado_com_prova();
ALTER TABLE encomenda ENABLE ALWAYS TRIGGER encomenda_estado_com_prova;

CREATE FUNCTION encomenda_estado_evento() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.estado IS NOT DISTINCT FROM OLD.estado THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.evento_saida (comerciante_id, tipo, agregado_tipo, agregado_id, dados)
  VALUES (NEW.comerciante_id,
    CASE NEW.estado WHEN 'paga' THEN 'order.paid' ELSE 'order.cancelled' END,
    'encomenda', NEW.id,
    jsonb_build_object('encomenda_id', NEW.id, 'estado', NEW.estado,
      'total', NEW.total, 'moeda', NEW.moeda,
      'em', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
  RETURN NULL;
END
$$;
CREATE TRIGGER encomenda_estado_evento AFTER UPDATE OF estado ON encomenda
  FOR EACH ROW EXECUTE FUNCTION encomenda_estado_evento();

-- ----------------------------------------------------------- As tarefas

-- O que a tarefa da API tem de olhar (pagamentos vivos que passam do prazo,
-- encomendas por pagar): uma tabela interna, como a vies_fila da 0039, que
-- só os gatilhos escrevem. A função devolve os comerciantes com trabalho.
CREATE TABLE tarefa_pagamento (
  alvo_tipo text NOT NULL CHECK (alvo_tipo IN ('pagamento', 'encomenda')),
  alvo_id uuid NOT NULL,
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  quando timestamptz NOT NULL,
  PRIMARY KEY (alvo_tipo, alvo_id)
);
CREATE INDEX tarefa_pagamento_quando ON tarefa_pagamento (quando);
ALTER TABLE tarefa_pagamento ENABLE ROW LEVEL SECURITY;
CREATE POLICY so_o_proprio ON tarefa_pagamento
  USING (comerciante_id = comerciante_actual())
  WITH CHECK (comerciante_id = comerciante_actual());
REVOKE ALL ON tarefa_pagamento FROM PUBLIC;

-- O prazo de uma encomenda por pagar (docs/26 Q5): 24 h depois do botão final.
CREATE FUNCTION encomenda_prazo_de_pagamento(p_criada_em timestamptz) RETURNS timestamptz
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT p_criada_em + interval '24 hours'
$$;

CREATE FUNCTION pagamento_tarefa() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.estado IN ('criado', 'a_aguardar_cliente', 'autorizado') THEN
    -- Um pagamento ainda `criado` (sem resposta do prestador) olha-se ao fim
    -- de 5 minutos, não no fim do prazo (revisão do #288, P2-5).
    INSERT INTO public.tarefa_pagamento (alvo_tipo, alvo_id, comerciante_id, quando)
    VALUES ('pagamento', NEW.id, NEW.comerciante_id,
      CASE WHEN NEW.estado = 'criado'
        THEN least(NEW.expira_em, now() + interval '5 minutes')
        ELSE NEW.expira_em END)
    ON CONFLICT (alvo_tipo, alvo_id) DO UPDATE SET quando = EXCLUDED.quando;
  ELSE
    DELETE FROM public.tarefa_pagamento WHERE alvo_tipo = 'pagamento' AND alvo_id = NEW.id;
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER pagamento_tarefa AFTER INSERT OR UPDATE OF estado ON pagamento
  FOR EACH ROW EXECUTE FUNCTION pagamento_tarefa();

CREATE FUNCTION encomenda_tarefa() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.estado = 'a_aguardar_pagamento' THEN
    INSERT INTO public.tarefa_pagamento (alvo_tipo, alvo_id, comerciante_id, quando)
    VALUES ('encomenda', NEW.id, NEW.comerciante_id,
      public.encomenda_prazo_de_pagamento(NEW.criada_em))
    ON CONFLICT (alvo_tipo, alvo_id) DO NOTHING;
  ELSE
    DELETE FROM public.tarefa_pagamento WHERE alvo_tipo = 'encomenda' AND alvo_id = NEW.id;
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER encomenda_tarefa AFTER INSERT OR UPDATE OF estado ON encomenda
  FOR EACH ROW EXECUTE FUNCTION encomenda_tarefa();

-- As encomendas que já estavam por pagar (a parte 1 do checkout já estava no
-- ensaio): para as tarefas. A encomenda tem o RLS forçado e a migração corre
-- sem comerciante: o NO FORCE só dura esta transacção.
ALTER TABLE encomenda NO FORCE ROW LEVEL SECURITY;
INSERT INTO tarefa_pagamento (alvo_tipo, alvo_id, comerciante_id, quando)
SELECT 'encomenda', e.id, e.comerciante_id, encomenda_prazo_de_pagamento(e.criada_em)
FROM encomenda e WHERE e.estado = 'a_aguardar_pagamento';
ALTER TABLE encomenda FORCE ROW LEVEL SECURITY;

CREATE FUNCTION pagamentos_comerciantes_com_tarefas() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT DISTINCT t.comerciante_id FROM public.tarefa_pagamento t WHERE t.quando <= now()
$$;

-- As tarefas para fazer agora no comerciante posto, as mais antigas primeiro.
CREATE FUNCTION pagamentos_tarefas(p_limite integer)
  RETURNS TABLE (alvo_tipo text, alvo_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT t.alvo_tipo, t.alvo_id FROM public.tarefa_pagamento t
  WHERE t.comerciante_id = public.comerciante_actual() AND t.quando <= now()
  ORDER BY t.quando, t.alvo_id
  LIMIT greatest(p_limite, 0)
$$;

-- Uma tarefa que não se resolveu agora (o prestador não respondeu) volta
-- mais tarde, para não bloquear as outras.
CREATE FUNCTION pagamentos_adiar_tarefa(p_tipo text, p_alvo uuid, p_minutos integer)
  RETURNS void
  LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  UPDATE public.tarefa_pagamento SET quando = now() + make_interval(mins => greatest(p_minutos, 1))
  WHERE comerciante_id = public.comerciante_actual() AND alvo_tipo = p_tipo AND alvo_id = p_alvo
$$;

REVOKE EXECUTE ON FUNCTION conta_pagamento_porta(), pagamentos_conta_do_aviso(uuid),
  pagamento_regista_transicao(), encomenda_estado_evento(), pagamento_tarefa(),
  encomenda_tarefa(), pagamentos_comerciantes_com_tarefas(), pagamentos_tarefas(integer),
  pagamentos_adiar_tarefa(text, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pagamento_transicao_valida(text, text),
  encomenda_prazo_de_pagamento(timestamptz) TO eurolify_api;
GRANT EXECUTE ON FUNCTION pagamentos_conta_do_aviso(uuid),
  pagamentos_comerciantes_com_tarefas(), pagamentos_tarefas(integer),
  pagamentos_adiar_tarefa(text, uuid, integer) TO eurolify_api;

-- ----------------------------------------------------- RLS e permissões

DO $$
DECLARE
  tabela text;
BEGIN
  FOREACH tabela IN ARRAY ARRAY['conta_pagamento', 'metodo_pagamento', 'pagamento',
    'aviso_pagamento', 'transicao_pagamento', 'diferenca_pagamento'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tabela);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tabela);
    EXECUTE format(
      'CREATE POLICY so_o_proprio ON %I USING (comerciante_id = comerciante_actual()) WITH CHECK (comerciante_id = comerciante_actual())',
      tabela);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC', tabela);
  END LOOP;
END
$$;

GRANT SELECT ON conta_pagamento, metodo_pagamento, pagamento, aviso_pagamento,
  transicao_pagamento, diferenca_pagamento TO eurolify_api;
GRANT INSERT (comerciante_id, prestador, nome) ON conta_pagamento TO eurolify_api;
GRANT UPDATE (nome, credenciais_cifra, segredo_aviso_cifra, chave_versao, credenciais_em,
  credenciais_por, testada_em, estado, actualizado_em, versao) ON conta_pagamento TO eurolify_api;
GRANT INSERT (comerciante_id, loja_id, mercado_id, metodo, conta_id, ordem, prazo_minutos)
  ON metodo_pagamento TO eurolify_api;
GRANT UPDATE (conta_id, ordem, prazo_minutos, estado, actualizado_em, versao)
  ON metodo_pagamento TO eurolify_api;
GRANT INSERT (comerciante_id, encomenda_id, conta_id, prestador, metodo, modo, montante,
  moeda, referencia, expira_em) ON pagamento TO eurolify_api;
GRANT UPDATE (estado, referencia_prestador, instrucoes, actualizado_em) ON pagamento TO eurolify_api;
GRANT INSERT (comerciante_id, conta_id, id_evento, corpo, assinatura_valida)
  ON aviso_pagamento TO eurolify_api;
GRANT UPDATE (pagamento_id, resultado, erro, processado_em) ON aviso_pagamento TO eurolify_api;
GRANT INSERT (comerciante_id, pagamento_id, aviso_id, motivo, prova)
  ON diferenca_pagamento TO eurolify_api;
GRANT UPDATE (estado, resolucao, resolvida_por, resolvida_em) ON diferenca_pagamento TO eurolify_api;
GRANT UPDATE (estado) ON encomenda TO eurolify_api;

-- ------------------------------------------------------------- Os âmbitos

ALTER TABLE chave_api DROP CONSTRAINT chave_api_ambitos_validos;
ALTER TABLE chave_api ADD CONSTRAINT chave_api_ambitos_validos CHECK (
  cardinality(ambitos) BETWEEN 1 AND 30
  AND ambitos <@ ARRAY[
    'merchant:read', 'merchant:write',
    'catalog:read', 'catalog:write', 'catalog:publish', 'catalog:import',
    'catalog:history', 'prices:read', 'prices:write',
    'customers:read', 'customers:write', 'customers:billing',
    'customers:exemptions', 'tax:read', 'tax:write',
    'legal:read', 'legal:write', 'shipping:read', 'shipping:write', 'orders:read',
    'payments:read', 'payments:write', 'payments:accounts', 'payments:resolve',
    'keys:write', 'storefront'
  ]::text[]);

CREATE OR REPLACE FUNCTION papel_ambitos(p_papel text) RETURNS text[]
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT CASE p_papel
    WHEN 'dono' THEN ARRAY['catalog:history', 'catalog:import', 'catalog:publish',
                           'catalog:read', 'catalog:write', 'customers:billing',
                           'customers:exemptions', 'customers:read',
                           'customers:write', 'keys:write', 'legal:read',
                           'legal:write', 'merchant:read', 'merchant:write',
                           'orders:read', 'payments:accounts', 'payments:read',
                           'payments:resolve', 'payments:write', 'prices:read',
                           'prices:write',
                           'shipping:read', 'shipping:write', 'tax:read', 'tax:write']
    WHEN 'gestor' THEN ARRAY['catalog:history', 'catalog:import', 'catalog:publish',
                             'catalog:read', 'catalog:write', 'customers:read',
                             'customers:write', 'legal:read', 'merchant:read',
                             'orders:read', 'payments:read', 'payments:write',
                             'prices:read', 'prices:write',
                             'shipping:read', 'shipping:write', 'tax:read']
    WHEN 'armazem' THEN ARRAY['catalog:read', 'prices:read', 'shipping:read']
    WHEN 'apoio' THEN ARRAY['catalog:read', 'customers:read', 'customers:write',
                            'legal:read', 'merchant:read', 'orders:read',
                            'payments:read', 'prices:read', 'shipping:read', 'tax:read']
  END::text[]
$$;
