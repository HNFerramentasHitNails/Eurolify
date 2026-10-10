-- Pós-venda, parte 1 (docs/30; issue #328; decisões do Diogo, 10/10/2026:
-- «aprovado» (DM) e «avança»).
--
-- Devolução = volta mercadoria; problema = não volta; nenhum reembolso sem
-- um dos dois (ou o cancelamento de uma encomenda paga não expedida, Q7). Só
-- o aceite na inspecção volta a stock. Reembolso e nota de crédito são dois
-- registos, ligados; a nota de crédito copia o tratamento fiscal da fatura.
--
-- O que esta migração faz:
-- - `pedido_livre_resolucao` (`wdr_`) e as linhas: o botão (R2), com a
--   confirmação de recepção e o prazo gravado (14 dias por omissão, C);
-- - `devolucao` (`rma_`) e as linhas (recebida, aceite, estado do artigo);
-- - `problema` (`prb_`);
-- - `reembolso` (`rfd_`) e as linhas: nunca acima do pago (a base garante),
--   manual nesta parte (Q2), com a prova da transferência;
-- - o movimento de stock `devolucao` (só o aceite, com o lote da saída);
-- - a encomenda `cancelada` (paga, sem expedição; liberta as reservas);
-- - a nota de crédito no domínio dos documentos (`tipo = nota_credito`, com a
--   fatura original e o reembolso);
-- - os âmbitos `returns:*` e `refunds:*`.

SET LOCAL lock_timeout = '10s';

-- --------------------------------------------- A encomenda paga cancelada (Q7)

ALTER TABLE encomenda DROP CONSTRAINT encomenda_estado_check;
ALTER TABLE encomenda ADD CONSTRAINT encomenda_estado_check CHECK (estado IN (
  'a_aguardar_pagamento', 'paga', 'cancelada_sem_pagamento', 'em_preparacao',
  'expedida_parcial', 'expedida', 'entregue', 'concluida', 'cancelada',
  'devolvida_parcial', 'devolvida'));

CREATE OR REPLACE FUNCTION encomenda_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem text := nullif(btrim(current_setting('eurolify.quem', true)), '');
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'orders.immutable: uma encomenda não se apaga';
  END IF;
  IF quem IS NULL THEN
    RAISE EXCEPTION 'orders.change_without_who: % sem eurolify.quem', TG_OP;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.estado := 'a_aguardar_pagamento';
    NEW.criada_por := quem;
    NEW.criada_em := now();
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - 'estado') IS DISTINCT FROM (to_jsonb(OLD) - 'estado') THEN
    RAISE EXCEPTION 'orders.immutable: as cópias da encomenda não mudam';
  END IF;
  -- Só para a frente (docs/27 §4.1); cancelar uma paga não expedida
  -- (docs/30, Q7).
  IF NOT (OLD.estado, NEW.estado) IN (
       ('paga', 'cancelada'), ('em_preparacao', 'cancelada'),
       ('a_aguardar_pagamento', 'paga'), ('a_aguardar_pagamento', 'cancelada_sem_pagamento'),
       ('paga', 'em_preparacao'), ('em_preparacao', 'expedida_parcial'),
       ('em_preparacao', 'expedida'), ('expedida_parcial', 'expedida'),
       ('expedida', 'entregue'), ('entregue', 'concluida'),
       -- Devolvida pela soma do reembolsado nas devoluções (docs/30 §4.4),
       -- só depois de tudo entregue (uma expedição ainda a caminho não fica
       -- presa a um estado de devolução).
       ('entregue', 'devolvida_parcial'), ('entregue', 'devolvida'),
       ('concluida', 'devolvida_parcial'), ('concluida', 'devolvida'),
       ('devolvida_parcial', 'devolvida')) THEN
    RAISE EXCEPTION 'orders.invalid_transition: % → %', OLD.estado, NEW.estado;
  END IF;
  -- Uma encomenda com uma expedição que não foi cancelada já não se cancela
  -- (devolve-se).
  IF NEW.estado = 'cancelada' AND EXISTS (SELECT 1 FROM public.expedicao x
       WHERE x.encomenda_id = NEW.id AND x.estado <> 'cancelada') THEN
    RAISE EXCEPTION 'orders.invalid_transition: há uma expedição; devolve-se em vez de cancelar';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION encomenda_estado_evento() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.estado IS NOT DISTINCT FROM OLD.estado THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.transicao_encomenda (comerciante_id, encomenda_id, de, para, quem, motivo)
  VALUES (NEW.comerciante_id, NEW.id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.estado END, NEW.estado,
    current_setting('eurolify.quem'),
    left(nullif(btrim(current_setting('eurolify.motivo', true)), ''), 500));
  IF TG_OP = 'INSERT' THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.evento_saida (comerciante_id, tipo, agregado_tipo, agregado_id, dados)
  VALUES (NEW.comerciante_id,
    CASE NEW.estado
      WHEN 'paga' THEN 'order.paid'
      WHEN 'cancelada_sem_pagamento' THEN 'order.cancelled'
      WHEN 'cancelada' THEN 'order.cancelled'
      WHEN 'em_preparacao' THEN 'order.preparing'
      WHEN 'expedida_parcial' THEN 'order.partially_shipped'
      WHEN 'expedida' THEN 'order.shipped'
      WHEN 'entregue' THEN 'order.delivered'
      WHEN 'devolvida_parcial' THEN 'order.partially_returned'
      WHEN 'devolvida' THEN 'order.returned'
      ELSE 'order.completed'
    END,
    'encomenda', NEW.id,
    jsonb_build_object('encomenda_id', NEW.id, 'estado', NEW.estado,
      'total', NEW.total, 'moeda', NEW.moeda,
      'em', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION encomenda_liberta_reservas() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  r record;
BEGIN
  IF NEW.estado NOT IN ('cancelada_sem_pagamento', 'cancelada') OR OLD.estado = NEW.estado THEN
    RETURN NULL;
  END IF;
  FOR r IN
    SELECT m.armazem_id, m.variante_id,
      sum(CASE m.tipo WHEN 'reserva' THEN m.quantidade ELSE -m.quantidade END) AS q
    FROM public.movimento_stock m
    WHERE m.encomenda_id = NEW.id AND m.tipo IN ('reserva', 'libertacao', 'saida')
    GROUP BY m.armazem_id, m.variante_id
    HAVING sum(CASE m.tipo WHEN 'reserva' THEN m.quantidade ELSE -m.quantidade END) > 0
    -- A mesma ordem das reservas e das saídas (revisão do #296, P2-2).
    ORDER BY m.variante_id
  LOOP
    INSERT INTO public.movimento_stock (comerciante_id, armazem_id, variante_id, tipo,
      quantidade, origem, encomenda_id, motivo)
    VALUES (NEW.comerciante_id, r.armazem_id, r.variante_id, 'libertacao', r.q, 'encomenda',
      NEW.id, CASE NEW.estado WHEN 'cancelada' THEN 'encomenda paga cancelada'
        ELSE 'encomenda cancelada sem pagamento' END);
  END LOOP;
  RETURN NULL;
END
$$;

-- ------------------------------------------------ O livro: a devolução (R4)

ALTER TABLE movimento_stock ADD COLUMN devolucao_id uuid;
ALTER TABLE movimento_stock DROP CONSTRAINT movimento_stock_tipo_check;
ALTER TABLE movimento_stock ADD CONSTRAINT movimento_stock_tipo_check
  CHECK (tipo IN ('entrada', 'reserva', 'libertacao', 'saida', 'ajuste', 'devolucao'));
ALTER TABLE movimento_stock DROP CONSTRAINT movimento_stock_origem_check;
ALTER TABLE movimento_stock ADD CONSTRAINT movimento_stock_origem_check
  CHECK (origem IN ('encomenda', 'expedicao', 'inventario', 'importacao', 'sistema_externo',
    'devolucao'));
ALTER TABLE movimento_stock ADD CONSTRAINT movimento_stock_devolucao_check
  CHECK (tipo <> 'devolucao' OR (encomenda_id IS NOT NULL AND devolucao_id IS NOT NULL));

CREATE OR REPLACE FUNCTION movimento_stock_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem text := nullif(btrim(current_setting('eurolify.quem', true)), '');
  pol record;
  s record;
  f integer;
  r integer;
BEGIN
  IF quem IS NULL THEN
    RAISE EXCEPTION 'inventory.change_without_who: movimento sem eurolify.quem';
  END IF;
  -- O comerciante do movimento é o da sessão (a função é do dono).
  IF NEW.comerciante_id IS DISTINCT FROM public.comerciante_actual() THEN
    RAISE EXCEPTION 'inventory.not_found: o movimento não é do comerciante da sessão';
  END IF;
  SELECT * INTO pol FROM public.stock_politica(NEW.variante_id);
  IF pol.politica IS NULL THEN
    RAISE EXCEPTION 'inventory.not_found: a variante não existe';
  END IF;
  -- Uma variante que não controla não ganha stock nem reservas novas; as
  -- que já tinha libertam-se e saem (revisão do #296, P1-4).
  IF pol.politica = 'nao_controla' AND NEW.tipo IN ('entrada', 'reserva', 'ajuste', 'devolucao') THEN
    RAISE EXCEPTION 'inventory.not_controlled: esta variante não controla stock';
  END IF;
  -- Um kit não tem stock próprio (docs/27, regra 3; revisão do #296, P2-3).
  IF EXISTS (SELECT 1 FROM public.componente k WHERE k.kit_id = NEW.variante_id) THEN
    RAISE EXCEPTION 'inventory.not_controlled: um kit não tem stock próprio (os componentes têm)';
  END IF;
  -- O lote: obrigatório em tudo o que mexe no físico de uma variante que o
  -- exige, e recusado nas outras; assim a soma dos lotes é sempre o físico
  -- (revisão do #296, P1-1).
  IF pol.exige_lote AND NEW.tipo IN ('entrada', 'saida', 'ajuste', 'devolucao') AND NEW.lote_id IS NULL THEN
    RAISE EXCEPTION 'inventory.lot_required: esta variante exige lote';
  END IF;
  IF NOT pol.exige_lote AND NEW.lote_id IS NOT NULL THEN
    RAISE EXCEPTION 'inventory.lot_required: esta variante não usa lotes';
  END IF;
  -- O armazém tem de estar activo para receber stock ou reservas; o arquivar
  -- espera por este bloqueio (revisão do #296, P2-6).
  IF NEW.tipo IN ('entrada', 'reserva', 'ajuste', 'devolucao') AND NOT EXISTS (
       SELECT 1 FROM public.armazem a WHERE a.id = NEW.armazem_id AND a.estado = 'activo'
       FOR SHARE) THEN
    RAISE EXCEPTION 'inventory.no_warehouse: o armazém está arquivado';
  END IF;
  INSERT INTO public.saldo_stock (comerciante_id, armazem_id, variante_id)
  VALUES (NEW.comerciante_id, NEW.armazem_id, NEW.variante_id)
  ON CONFLICT (armazem_id, variante_id) DO NOTHING;
  SELECT fisico, reservado INTO s FROM public.saldo_stock
  WHERE armazem_id = NEW.armazem_id AND variante_id = NEW.variante_id FOR UPDATE;
  f := s.fisico;
  r := s.reservado;
  CASE NEW.tipo
    WHEN 'entrada' THEN f := f + NEW.quantidade;
    WHEN 'reserva' THEN r := r + NEW.quantidade;
    WHEN 'libertacao' THEN r := r - NEW.quantidade;
    WHEN 'saida' THEN f := f - NEW.quantidade; r := r - NEW.quantidade;
    WHEN 'ajuste' THEN f := f + NEW.quantidade;
    -- A devolução aceite na inspecção volta ao físico (docs/30, R4).
    WHEN 'devolucao' THEN f := f + NEW.quantidade;
  END CASE;
  IF f < 0 THEN
    RAISE EXCEPTION 'inventory.negative: o físico ficava negativo (%)', f;
  END IF;
  IF r < 0 THEN
    RAISE EXCEPTION 'inventory.negative: o reservado ficava negativo (%)', r;
  END IF;
  IF r > f AND pol.politica <> 'vende_sem_stock' AND NEW.tipo IN ('reserva', 'ajuste') THEN
    RAISE EXCEPTION 'inventory.insufficient: disponível insuficiente (físico %, reservado %)', f, r;
  END IF;
  NEW.fisico_antes := s.fisico;
  NEW.reservado_antes := s.reservado;
  NEW.fisico_depois := f;
  NEW.reservado_depois := r;
  NEW.quem := quem;
  -- O relógio real: o livro ordena-se pela ordem em que os bloqueios
  -- passaram (revisão do #296, P3).
  NEW.em := clock_timestamp();
  UPDATE public.saldo_stock SET fisico = f, reservado = r
  WHERE armazem_id = NEW.armazem_id AND variante_id = NEW.variante_id;
  IF NEW.lote_id IS NOT NULL AND NEW.tipo IN ('entrada', 'saida', 'ajuste', 'devolucao') THEN
    INSERT INTO public.saldo_lote (comerciante_id, armazem_id, lote_id)
    VALUES (NEW.comerciante_id, NEW.armazem_id, NEW.lote_id)
    ON CONFLICT (armazem_id, lote_id) DO NOTHING;
    UPDATE public.saldo_lote
    SET fisico = fisico + CASE WHEN NEW.tipo = 'saida' THEN -NEW.quantidade ELSE NEW.quantidade END
    WHERE armazem_id = NEW.armazem_id AND lote_id = NEW.lote_id;
  END IF;
  RETURN NEW;
END
$$;

-- ---------------------------------------- O pedido de livre resolução (§3.1)

CREATE TABLE pedido_livre_resolucao (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  encomenda_id uuid NOT NULL,
  origem text NOT NULL CHECK (origem IN ('botao', 'apoio')),
  contacto text NOT NULL CHECK (length(contacto) BETWEEN 3 AND 254),
  recebido_em timestamptz NOT NULL DEFAULT now(),
  -- A data-limite calculada no momento (entregue + dias do país; C).
  prazo_ate date,
  dentro_do_prazo boolean NOT NULL,
  estado text NOT NULL CHECK (estado IN ('aceite', 'fora_de_prazo', 'recusado')),
  confirmacao jsonb NOT NULL CHECK (jsonb_typeof(confirmacao) = 'object'),
  decidido_por text,
  motivo_decisao text CHECK (motivo_decisao IS NULL OR length(motivo_decisao) BETWEEN 3 AND 500),
  versao integer NOT NULL DEFAULT 1,
  UNIQUE (comerciante_id, id),
  CHECK ((estado = 'aceite') OR (estado = 'fora_de_prazo' AND NOT dentro_do_prazo)
    OR (estado = 'recusado' AND motivo_decisao IS NOT NULL)),
  FOREIGN KEY (comerciante_id, encomenda_id) REFERENCES encomenda (comerciante_id, id)
);

CREATE TABLE linha_livre_resolucao (
  pedido_id uuid NOT NULL,
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  linha_encomenda_id uuid NOT NULL,
  quantidade integer NOT NULL CHECK (quantidade >= 1),
  PRIMARY KEY (pedido_id, linha_encomenda_id),
  FOREIGN KEY (comerciante_id, pedido_id) REFERENCES pedido_livre_resolucao (comerciante_id, id),
  FOREIGN KEY (comerciante_id, linha_encomenda_id) REFERENCES linha_encomenda (comerciante_id, id)
);

-- O pedido só muda de fora_de_prazo para aceite ou recusado, por uma pessoa.
CREATE FUNCTION pedido_livre_resolucao_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'returns.immutable: um pedido de livre resolução não se apaga';
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.recebido_em := now();
    NEW.versao := 1;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - 'estado' - 'decidido_por' - 'motivo_decisao' - 'versao')
     IS DISTINCT FROM (to_jsonb(OLD) - 'estado' - 'decidido_por' - 'motivo_decisao' - 'versao') THEN
    RAISE EXCEPTION 'returns.immutable: o pedido e a confirmação não mudam';
  END IF;
  IF NEW.estado IS DISTINCT FROM OLD.estado AND NOT (OLD.estado = 'fora_de_prazo'
       AND NEW.estado IN ('aceite', 'recusado')) THEN
    RAISE EXCEPTION 'returns.invalid_transition: % → %', OLD.estado, NEW.estado;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER pedido_livre_resolucao_antes_de_gravar BEFORE INSERT OR UPDATE OR DELETE
  ON pedido_livre_resolucao FOR EACH ROW EXECUTE FUNCTION pedido_livre_resolucao_antes_de_gravar();
ALTER TABLE pedido_livre_resolucao ENABLE ALWAYS TRIGGER pedido_livre_resolucao_antes_de_gravar;

-- ------------------------------------------------------ A devolução (§3.2)

CREATE TABLE devolucao (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  encomenda_id uuid NOT NULL,
  armazem_id uuid NOT NULL,
  origem text NOT NULL CHECK (origem IN ('livre_resolucao', 'apoio', 'comercial')),
  pedido_livre_resolucao_id uuid UNIQUE,
  motivo text CHECK (motivo IS NULL OR length(motivo) BETWEEN 1 AND 500),
  transportadora text CHECK (transportadora IS NULL OR length(transportadora) BETWEEN 1 AND 100),
  seguimento text CHECK (seguimento IS NULL OR length(seguimento) BETWEEN 1 AND 200),
  estado text NOT NULL DEFAULT 'a_aguardar' CHECK (estado IN ('a_aguardar', 'recebida',
    'inspeccionada', 'decidida', 'fechada', 'cancelada')),
  criada_por text NOT NULL,
  criada_em timestamptz NOT NULL DEFAULT now(),
  versao integer NOT NULL DEFAULT 1,
  UNIQUE (comerciante_id, id),
  CHECK ((origem = 'livre_resolucao') = (pedido_livre_resolucao_id IS NOT NULL)),
  FOREIGN KEY (comerciante_id, encomenda_id) REFERENCES encomenda (comerciante_id, id),
  FOREIGN KEY (comerciante_id, armazem_id) REFERENCES armazem (comerciante_id, id),
  FOREIGN KEY (comerciante_id, pedido_livre_resolucao_id)
    REFERENCES pedido_livre_resolucao (comerciante_id, id)
);
-- NOT VALID: as linhas que já existem não têm a coluna; a validação
-- correria com o RLS forçado (as novas são verificadas).
ALTER TABLE movimento_stock ADD CONSTRAINT movimento_stock_devolucao_fk
  FOREIGN KEY (comerciante_id, devolucao_id) REFERENCES devolucao (comerciante_id, id) NOT VALID;

CREATE TABLE linha_devolucao (
  devolucao_id uuid NOT NULL,
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  linha_encomenda_id uuid NOT NULL,
  pedida integer NOT NULL CHECK (pedida >= 1),
  recebida integer CHECK (recebida IS NULL OR recebida BETWEEN 0 AND pedida),
  aceite integer CHECK (aceite IS NULL OR aceite >= 0),
  estado_artigo text CHECK (estado_artigo IS NULL OR estado_artigo IN ('revendavel', 'aberto',
    'danificado', 'em_falta')),
  PRIMARY KEY (devolucao_id, linha_encomenda_id),
  -- O aceite (volta a stock) é parte do recebido, e só revendável (Q5).
  CHECK (aceite IS NULL OR (recebida IS NOT NULL AND aceite <= recebida)),
  CHECK (aceite IS NULL OR aceite = 0 OR estado_artigo = 'revendavel'),
  FOREIGN KEY (comerciante_id, devolucao_id) REFERENCES devolucao (comerciante_id, id),
  FOREIGN KEY (comerciante_id, linha_encomenda_id) REFERENCES linha_encomenda (comerciante_id, id)
);

CREATE FUNCTION devolucao_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem text := nullif(btrim(current_setting('eurolify.quem', true)), '');
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'returns.immutable: uma devolução não se apaga';
  END IF;
  IF quem IS NULL THEN
    RAISE EXCEPTION 'returns.change_without_who: % sem eurolify.quem', TG_OP;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.estado := 'a_aguardar';
    NEW.criada_por := quem;
    NEW.criada_em := now();
    NEW.versao := 1;
    RETURN NEW;
  END IF;
  IF NEW.encomenda_id <> OLD.encomenda_id OR NEW.armazem_id <> OLD.armazem_id
     OR NEW.origem <> OLD.origem
     OR NEW.pedido_livre_resolucao_id IS DISTINCT FROM OLD.pedido_livre_resolucao_id
     OR NEW.criada_por <> OLD.criada_por OR NEW.criada_em <> OLD.criada_em THEN
    RAISE EXCEPTION 'returns.immutable: a encomenda, o armazém e a origem não mudam';
  END IF;
  IF NEW.estado IS DISTINCT FROM OLD.estado AND NOT (OLD.estado, NEW.estado) IN (
       ('a_aguardar', 'recebida'), ('recebida', 'inspeccionada'), ('inspeccionada', 'decidida'),
       ('decidida', 'fechada'), ('a_aguardar', 'cancelada'), ('recebida', 'cancelada')) THEN
    RAISE EXCEPTION 'returns.invalid_transition: % → %', OLD.estado, NEW.estado;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER devolucao_antes_de_gravar BEFORE INSERT OR UPDATE OR DELETE ON devolucao
  FOR EACH ROW EXECUTE FUNCTION devolucao_antes_de_gravar();
ALTER TABLE devolucao ENABLE ALWAYS TRIGGER devolucao_antes_de_gravar;

-- As linhas: a pedida não muda; a recebida só na recepção; o aceite e o
-- estado só na inspecção; nada depois de decidida. A quantidade pedida não
-- passa a expedida menos o já pedido noutras devoluções vivas.
CREATE FUNCTION linha_devolucao_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  estado_dev text;
  expedido integer;
  pedido integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'returns.immutable: uma linha de devolução não se apaga';
  END IF;
  SELECT d.estado INTO estado_dev FROM public.devolucao d
  WHERE d.id = NEW.devolucao_id FOR UPDATE;
  IF TG_OP = 'INSERT' THEN
    IF estado_dev <> 'a_aguardar' OR NEW.recebida IS NOT NULL OR NEW.aceite IS NOT NULL
       OR NEW.estado_artigo IS NOT NULL THEN
      RAISE EXCEPTION 'returns.invalid_transition: as linhas entram com a devolução, por receber';
    END IF;
    -- A linha da encomenda é desta encomenda e foi expedida.
    SELECT coalesce(sum(le.quantidade), 0) INTO expedido
    FROM public.linha_expedicao le
    JOIN public.expedicao x ON x.id = le.expedicao_id
    JOIN public.devolucao d ON d.id = NEW.devolucao_id AND d.encomenda_id = x.encomenda_id
    WHERE le.linha_encomenda_id = NEW.linha_encomenda_id
      AND x.estado IN ('expedida', 'entregue');
    SELECT coalesce(sum(l.pedida), 0) INTO pedido
    FROM public.linha_devolucao l
    JOIN public.devolucao d ON d.id = l.devolucao_id
    WHERE l.linha_encomenda_id = NEW.linha_encomenda_id AND d.estado <> 'cancelada';
    IF pedido + NEW.pedida > expedido THEN
      RAISE EXCEPTION 'returns.quantity_exceeded: a devolver % de % expedidas (já pedidas %)',
        NEW.pedida, expedido, pedido;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.devolucao_id <> OLD.devolucao_id OR NEW.linha_encomenda_id <> OLD.linha_encomenda_id
     OR NEW.pedida <> OLD.pedida THEN
    RAISE EXCEPTION 'returns.immutable: a linha e a quantidade pedida não mudam';
  END IF;
  IF NEW.recebida IS DISTINCT FROM OLD.recebida AND estado_dev <> 'a_aguardar' THEN
    RAISE EXCEPTION 'returns.invalid_transition: o recebido regista-se na recepção';
  END IF;
  IF (NEW.aceite IS DISTINCT FROM OLD.aceite OR NEW.estado_artigo IS DISTINCT FROM OLD.estado_artigo)
     AND estado_dev <> 'recebida' THEN
    RAISE EXCEPTION 'returns.invalid_transition: o estado do artigo regista-se na inspecção';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER linha_devolucao_antes_de_gravar BEFORE INSERT OR UPDATE OR DELETE ON linha_devolucao
  FOR EACH ROW EXECUTE FUNCTION linha_devolucao_antes_de_gravar();
ALTER TABLE linha_devolucao ENABLE ALWAYS TRIGGER linha_devolucao_antes_de_gravar;

-- -------------------------------------------------------- O problema (§3.3)

CREATE TABLE problema (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  encomenda_id uuid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('chegou_danificado', 'em_falta', 'atraso', 'outro')),
  descricao text NOT NULL CHECK (length(descricao) BETWEEN 3 AND 2000),
  estado text NOT NULL DEFAULT 'aberto' CHECK (estado IN ('aberto', 'decidido', 'fechado')),
  criado_por text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  versao integer NOT NULL DEFAULT 1,
  UNIQUE (comerciante_id, id),
  FOREIGN KEY (comerciante_id, encomenda_id) REFERENCES encomenda (comerciante_id, id)
);

CREATE FUNCTION problema_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem text := nullif(btrim(current_setting('eurolify.quem', true)), '');
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'returns.immutable: um problema não se apaga';
  END IF;
  IF quem IS NULL THEN
    RAISE EXCEPTION 'returns.change_without_who: % sem eurolify.quem', TG_OP;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.estado := 'aberto';
    NEW.criado_por := quem;
    NEW.criado_em := now();
    NEW.versao := 1;
    RETURN NEW;
  END IF;
  IF NEW.encomenda_id <> OLD.encomenda_id OR NEW.tipo <> OLD.tipo
     OR NEW.descricao <> OLD.descricao OR NEW.criado_por <> OLD.criado_por THEN
    RAISE EXCEPTION 'returns.immutable: o problema não muda (abre-se outro)';
  END IF;
  IF NEW.estado IS DISTINCT FROM OLD.estado AND NOT (OLD.estado, NEW.estado) IN (
       ('aberto', 'decidido'), ('decidido', 'fechado'), ('aberto', 'fechado')) THEN
    RAISE EXCEPTION 'returns.invalid_transition: % → %', OLD.estado, NEW.estado;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER problema_antes_de_gravar BEFORE INSERT OR UPDATE OR DELETE ON problema
  FOR EACH ROW EXECUTE FUNCTION problema_antes_de_gravar();
ALTER TABLE problema ENABLE ALWAYS TRIGGER problema_antes_de_gravar;

-- ------------------------------------------------------- O reembolso (§3.4)

CREATE TABLE reembolso (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  encomenda_id uuid NOT NULL,
  pagamento_id uuid NOT NULL,
  -- R1: nunca sem uma origem.
  origem text NOT NULL CHECK (origem IN ('devolucao', 'problema', 'cancelamento')),
  devolucao_id uuid,
  problema_id uuid,
  montante bigint NOT NULL CHECK (montante > 0),
  moeda text NOT NULL CHECK (moeda ~ '^[A-Z]{3}$'),
  via text NOT NULL DEFAULT 'manual' CHECK (via IN ('manual', 'prestador')),
  estado text NOT NULL DEFAULT 'rascunho' CHECK (estado IN ('rascunho', 'a_executar', 'executado',
    'falhado', 'incerto')),
  -- A prova da transferência manual (data, referência do banco, quem).
  prova jsonb CHECK (prova IS NULL OR jsonb_typeof(prova) = 'object'),
  executado_em timestamptz,
  decidido_por text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  versao integer NOT NULL DEFAULT 1,
  UNIQUE (comerciante_id, id),
  CHECK ((origem = 'devolucao') = (devolucao_id IS NOT NULL)),
  CHECK ((origem = 'problema') = (problema_id IS NOT NULL)),
  CHECK ((estado = 'executado') = (executado_em IS NOT NULL)),
  CHECK (estado <> 'executado' OR via <> 'manual' OR prova IS NOT NULL),
  FOREIGN KEY (comerciante_id, encomenda_id) REFERENCES encomenda (comerciante_id, id),
  FOREIGN KEY (comerciante_id, devolucao_id) REFERENCES devolucao (comerciante_id, id),
  FOREIGN KEY (comerciante_id, problema_id) REFERENCES problema (comerciante_id, id)
);

CREATE TABLE linha_reembolso (
  reembolso_id uuid NOT NULL,
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  posicao integer NOT NULL CHECK (posicao >= 1),
  -- Null nos portes (linha própria, lição 3.6).
  linha_encomenda_id uuid,
  quantidade integer NOT NULL CHECK (quantidade >= 1),
  montante bigint NOT NULL CHECK (montante > 0),
  PRIMARY KEY (reembolso_id, posicao),
  FOREIGN KEY (comerciante_id, reembolso_id) REFERENCES reembolso (comerciante_id, id),
  FOREIGN KEY (comerciante_id, linha_encomenda_id) REFERENCES linha_encomenda (comerciante_id, id)
);
CREATE TRIGGER linha_reembolso_so_se_acrescenta BEFORE UPDATE OR DELETE ON linha_reembolso
  FOR EACH ROW EXECUTE FUNCTION rasto_so_se_acrescenta();
ALTER TABLE linha_reembolso ENABLE ALWAYS TRIGGER linha_reembolso_so_se_acrescenta;

-- As linhas só entram num rascunho.
CREATE FUNCTION linha_reembolso_antes_de_inserir() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.reembolso r
       WHERE r.id = NEW.reembolso_id AND r.estado = 'rascunho') THEN
    RAISE EXCEPTION 'refunds.invalid_transition: as linhas entram no rascunho do reembolso';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER linha_reembolso_antes_de_inserir BEFORE INSERT ON linha_reembolso
  FOR EACH ROW EXECUTE FUNCTION linha_reembolso_antes_de_inserir();
ALTER TABLE linha_reembolso ENABLE ALWAYS TRIGGER linha_reembolso_antes_de_inserir;

-- Os estados; ao sair do rascunho, a soma das linhas é o montante, nenhuma
-- linha passa o que foi pago por ela e o total não passa o pagamento (R5).
CREATE FUNCTION reembolso_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem text := nullif(btrim(current_setting('eurolify.quem', true)), '');
  pago bigint;
  ja bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'refunds.immutable: um reembolso não se apaga';
  END IF;
  IF quem IS NULL THEN
    RAISE EXCEPTION 'refunds.change_without_who: % sem eurolify.quem', TG_OP;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM public.pagamento p WHERE p.id = NEW.pagamento_id
         AND p.encomenda_id = NEW.encomenda_id
         AND p.estado IN ('capturado', 'reembolsado_parcial')) THEN
      RAISE EXCEPTION 'refunds.not_refundable: a encomenda não tem um pagamento capturado';
    END IF;
    NEW.estado := 'rascunho';
    NEW.executado_em := NULL;
    NEW.decidido_por := quem;
    NEW.criado_em := now();
    NEW.versao := 1;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - 'estado' - 'prova' - 'executado_em' - 'versao' - 'via')
     IS DISTINCT FROM (to_jsonb(OLD) - 'estado' - 'prova' - 'executado_em' - 'versao' - 'via') THEN
    RAISE EXCEPTION 'refunds.immutable: o reembolso não muda (decide-se outro)';
  END IF;
  IF NEW.estado IS DISTINCT FROM OLD.estado THEN
    IF NOT (OLD.estado, NEW.estado) IN (
         ('rascunho', 'a_executar'), ('a_executar', 'executado'), ('a_executar', 'falhado'),
         ('a_executar', 'incerto'), ('incerto', 'executado'), ('incerto', 'a_executar'),
         ('falhado', 'a_executar')) THEN
      RAISE EXCEPTION 'refunds.invalid_transition: % → %', OLD.estado, NEW.estado;
    END IF;
    IF OLD.estado = 'rascunho' THEN
      IF NEW.montante <> (SELECT coalesce(sum(l.montante), 0) FROM public.linha_reembolso l
                          WHERE l.reembolso_id = NEW.id) THEN
        RAISE EXCEPTION 'refunds.invalid_field: o montante não é a soma das linhas';
      END IF;
      -- Por linha da encomenda: nunca acima do que foi pago por ela.
      IF EXISTS (
           SELECT 1 FROM public.linha_reembolso l
           JOIN public.linha_encomenda le ON le.id = l.linha_encomenda_id
           WHERE l.reembolso_id = NEW.id
             AND (SELECT coalesce(sum(l2.montante), 0) FROM public.linha_reembolso l2
                  JOIN public.reembolso r2 ON r2.id = l2.reembolso_id
                  WHERE l2.linha_encomenda_id = l.linha_encomenda_id
                    AND (r2.id = NEW.id OR r2.estado IN ('a_executar', 'executado', 'incerto')))
                 > le.total) THEN
        RAISE EXCEPTION 'refunds.exceeds_paid: uma linha ficava reembolsada acima do que se pagou';
      END IF;
      SELECT p.montante INTO pago FROM public.pagamento p WHERE p.id = NEW.pagamento_id FOR UPDATE;
      SELECT coalesce(sum(r.montante), 0) INTO ja FROM public.reembolso r
      WHERE r.pagamento_id = NEW.pagamento_id AND r.id <> NEW.id
        AND r.estado IN ('a_executar', 'executado', 'incerto');
      IF ja + NEW.montante > pago THEN
        RAISE EXCEPTION 'refunds.exceeds_paid: reembolsos % mais % passam o pago %', ja, NEW.montante, pago;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER reembolso_antes_de_gravar BEFORE INSERT OR UPDATE OR DELETE ON reembolso
  FOR EACH ROW EXECUTE FUNCTION reembolso_antes_de_gravar();
ALTER TABLE reembolso ENABLE ALWAYS TRIGGER reembolso_antes_de_gravar;

-- Executado o reembolso de uma devolução, a encomenda entregue passa a
-- devolvida (tudo reembolsado) ou devolvida_parcial (docs/30 §4.4). Corre
-- com quem escreve (o eurolify.quem já está).
CREATE FUNCTION reembolso_marca_devolvida() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  atual text;
  comprado bigint;
  devolvido bigint;
  novo text;
BEGIN
  IF NEW.estado <> 'executado' OR OLD.estado = 'executado' OR NEW.origem <> 'devolucao' THEN
    RETURN NULL;
  END IF;
  SELECT e.estado INTO atual FROM public.encomenda e WHERE e.id = NEW.encomenda_id FOR UPDATE;
  IF atual NOT IN ('entregue', 'concluida', 'devolvida_parcial') THEN
    RETURN NULL;
  END IF;
  SELECT coalesce(sum(l.quantidade), 0) INTO comprado
  FROM public.linha_encomenda l WHERE l.encomenda_id = NEW.encomenda_id;
  -- Nenhuma linha passa a quantidade comprada (o gatilho do reembolso), por
  -- isso a soma igual quer dizer todas as linhas.
  SELECT coalesce(sum(l.quantidade), 0) INTO devolvido
  FROM public.linha_reembolso l JOIN public.reembolso r ON r.id = l.reembolso_id
  WHERE r.encomenda_id = NEW.encomenda_id AND r.origem = 'devolucao'
    AND r.estado = 'executado' AND l.linha_encomenda_id IS NOT NULL;
  novo := CASE WHEN devolvido >= comprado THEN 'devolvida' ELSE 'devolvida_parcial' END;
  IF novo <> atual THEN
    UPDATE public.encomenda SET estado = novo WHERE id = NEW.encomenda_id;
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER reembolso_marca_devolvida AFTER UPDATE OF estado ON reembolso
  FOR EACH ROW EXECUTE FUNCTION reembolso_marca_devolvida();
ALTER TABLE reembolso ENABLE ALWAYS TRIGGER reembolso_marca_devolvida;

-- --------------------------------------------- A nota de crédito (§3.5)

ALTER TABLE documento_fiscal DROP CONSTRAINT documento_fiscal_tipo_check;
ALTER TABLE documento_fiscal ADD CONSTRAINT documento_fiscal_tipo_check
  CHECK (tipo IN ('fatura', 'nota_credito'));
ALTER TABLE documento_fiscal ADD COLUMN original_id uuid;
ALTER TABLE documento_fiscal ADD COLUMN reembolso_id uuid UNIQUE;
ALTER TABLE documento_fiscal ADD CONSTRAINT documento_fiscal_original_fk
  FOREIGN KEY (comerciante_id, original_id) REFERENCES documento_fiscal (comerciante_id, id) NOT VALID;
ALTER TABLE documento_fiscal ADD CONSTRAINT documento_fiscal_reembolso_fk
  FOREIGN KEY (comerciante_id, reembolso_id) REFERENCES reembolso (comerciante_id, id) NOT VALID;
ALTER TABLE documento_fiscal ADD CONSTRAINT documento_fiscal_nota_credito_check
  CHECK ((tipo = 'nota_credito') = (original_id IS NOT NULL AND reembolso_id IS NOT NULL));
-- Uma fatura por encomenda; notas de crédito, as que os reembolsos pedirem.
ALTER TABLE documento_fiscal DROP CONSTRAINT documento_fiscal_encomenda_id_tipo_key;
CREATE UNIQUE INDEX documento_fiscal_uma_fatura ON documento_fiscal (encomenda_id)
  WHERE tipo = 'fatura';

CREATE OR REPLACE FUNCTION documento_fiscal_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  e record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'invoices.immutable: um pedido de documento não se apaga';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT x.emissor_fiscal, x.estado, x.entidade_legal_id INTO e FROM public.encomenda x
    WHERE x.comerciante_id = NEW.comerciante_id AND x.id = NEW.encomenda_id;
    IF e IS NULL THEN
      RAISE EXCEPTION 'invoices.not_found: a encomenda não existe';
    END IF;
    IF e.emissor_fiscal = 'sistema_proprio' THEN
      RAISE EXCEPTION 'invoices.other_issuer: esta encomenda é emitida pelo sistema do comerciante (ADR-0041)';
    END IF;
    IF e.estado IN ('a_aguardar_pagamento', 'cancelada_sem_pagamento') THEN
      RAISE EXCEPTION 'invoices.order_not_paid: o documento só nasce depois do pagamento confirmado';
    END IF;
    -- A nota de crédito referencia a fatura da mesma encomenda e um
    -- reembolso (docs/30 §3.5).
    IF NEW.tipo = 'nota_credito' AND (NEW.reembolso_id IS NULL OR NOT EXISTS (
         SELECT 1 FROM public.documento_fiscal o
         WHERE o.id = NEW.original_id AND o.tipo = 'fatura' AND o.encomenda_id = NEW.encomenda_id)) THEN
      RAISE EXCEPTION 'invoices.invalid_field: a nota de crédito precisa da fatura da encomenda e do reembolso';
    END IF;
    NEW.entidade_legal_id := e.entidade_legal_id;
    NEW.estado := 'a_verificar';
    NEW.motivos := '{}';
    NEW.validados := '{}';
    NEW.ligacao_id := NULL;
    NEW.emissor_id := NULL;
    NEW.tentativas := 0;
    NEW.falhas := 0;
    NEW.reservado_ate := NULL;
    NEW.versao := 1;
    NEW.criado_em := now();
    NEW.actualizado_em := now();
    RETURN NEW;
  END IF;
  IF NEW.encomenda_id <> OLD.encomenda_id OR NEW.entidade_legal_id <> OLD.entidade_legal_id
     OR NEW.tipo <> OLD.tipo OR NEW.modo <> OLD.modo OR NEW.criado_em <> OLD.criado_em
     OR NEW.original_id IS DISTINCT FROM OLD.original_id
     OR NEW.reembolso_id IS DISTINCT FROM OLD.reembolso_id THEN
    RAISE EXCEPTION 'invoices.immutable: a encomenda, a entidade, o tipo e o modo de um pedido não mudam';
  END IF;
  IF OLD.estado IN ('emitido', 'divergente', 'resolvido') AND NEW.emissor_id IS DISTINCT FROM OLD.emissor_id THEN
    RAISE EXCEPTION 'invoices.immutable: o documento emitido não muda de identificador';
  END IF;
  IF NEW.estado IS DISTINCT FROM OLD.estado THEN
    IF NOT (OLD.estado, NEW.estado) IN (
         ('a_verificar', 'retido'), ('a_verificar', 'pronto'),
         ('retido', 'a_verificar'),
         ('pronto', 'rascunho'), ('pronto', 'retido'), ('pronto', 'incerto'),
         ('rascunho', 'emitido'), ('rascunho', 'retido'), ('rascunho', 'incerto'),
         ('incerto', 'emitido'), ('incerto', 'pronto'), ('incerto', 'rascunho'), ('incerto', 'retido'),
         ('emitido', 'divergente'), ('divergente', 'resolvido')) THEN
      RAISE EXCEPTION 'invoices.invalid_transition: % → %', OLD.estado, NEW.estado;
    END IF;
    IF NEW.estado IN ('emitido', 'divergente') AND NOT EXISTS (
         SELECT 1 FROM public.documento_prova p WHERE p.documento_id = NEW.id) THEN
      RAISE EXCEPTION 'invoices.invalid_transition: emitido só com a prova lida do emissor';
    END IF;
    IF NEW.estado IN ('rascunho', 'emitido') AND NEW.emissor_id IS NULL THEN
      RAISE EXCEPTION 'invoices.invalid_transition: % sem o identificador do emissor', NEW.estado;
    END IF;
  END IF;
  IF NEW.estado <> 'retido' THEN
    NEW.motivos := CASE WHEN NEW.estado = 'incerto' THEN NEW.motivos ELSE '{}' END;
  END IF;
  NEW.actualizado_em := now();
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION encomenda_pede_documento() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.estado = 'paga' AND OLD.estado IS DISTINCT FROM 'paga'
     AND NEW.emissor_fiscal <> 'sistema_proprio' THEN
    INSERT INTO public.documento_fiscal (comerciante_id, encomenda_id, entidade_legal_id, modo)
    SELECT NEW.comerciante_id, NEW.id, NEW.entidade_legal_id, p.modo
    FROM public.pagamento p
    WHERE p.encomenda_id = NEW.id AND p.estado = 'capturado'
    ORDER BY p.id LIMIT 1
    ON CONFLICT (encomenda_id) WHERE tipo = 'fatura' DO NOTHING;
  END IF;
  RETURN NULL;
END
$$;

-- O pedido da nota de crédito de um reembolso (com sistema próprio não há:
-- o evento leva as linhas ao sistema do comerciante, ADR-0041).
CREATE FUNCTION nota_credito_pedir(p_reembolso uuid) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  r record;
  f record;
  novo uuid;
BEGIN
  SELECT x.id, x.comerciante_id, x.encomenda_id INTO r FROM public.reembolso x
  WHERE x.id = p_reembolso AND x.comerciante_id = public.comerciante_actual();
  IF r IS NULL THEN
    RAISE EXCEPTION 'invoices.not_found: o reembolso não existe';
  END IF;
  SELECT d.id, d.entidade_legal_id, d.modo INTO f FROM public.documento_fiscal d
  WHERE d.encomenda_id = r.encomenda_id AND d.tipo = 'fatura';
  IF f IS NULL THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.documento_fiscal (comerciante_id, encomenda_id, entidade_legal_id, tipo,
    modo, original_id, reembolso_id)
  VALUES (r.comerciante_id, r.encomenda_id, f.entidade_legal_id, 'nota_credito', f.modo, f.id,
    r.id)
  ON CONFLICT (reembolso_id) DO NOTHING
  RETURNING id INTO novo;
  RETURN novo;
END
$$;

-- --------------------------------------------------------------- Os eventos

CREATE FUNCTION pos_venda_evento() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  t text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.estado IS NOT DISTINCT FROM OLD.estado THEN
    RETURN NULL;
  END IF;
  t := CASE TG_TABLE_NAME
    WHEN 'pedido_livre_resolucao' THEN CASE WHEN TG_OP = 'INSERT' THEN 'withdrawal.requested'
      ELSE 'withdrawal.decided' END
    WHEN 'devolucao' THEN CASE NEW.estado WHEN 'a_aguardar' THEN 'return.created'
      WHEN 'recebida' THEN 'return.received' WHEN 'inspeccionada' THEN 'return.inspected'
      WHEN 'decidida' THEN 'return.decided' WHEN 'cancelada' THEN 'return.cancelled'
      ELSE 'return.closed' END
    WHEN 'problema' THEN CASE NEW.estado WHEN 'aberto' THEN 'problem.created'
      ELSE 'problem.' || NEW.estado END
    WHEN 'reembolso' THEN CASE NEW.estado WHEN 'a_executar' THEN 'refund.created'
      WHEN 'executado' THEN 'refund.completed' WHEN 'falhado' THEN 'refund.failed'
      WHEN 'incerto' THEN 'refund.uncertain' END
  END;
  IF t IS NULL THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.evento_saida (comerciante_id, tipo, agregado_tipo, agregado_id, dados)
  VALUES (NEW.comerciante_id, t, TG_TABLE_NAME, NEW.id,
    jsonb_build_object('id', NEW.id, 'encomenda_id', NEW.encomenda_id, 'estado', NEW.estado,
      'em', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
  RETURN NULL;
END
$$;
CREATE TRIGGER pedido_livre_resolucao_evento AFTER INSERT OR UPDATE OF estado ON pedido_livre_resolucao
  FOR EACH ROW EXECUTE FUNCTION pos_venda_evento();
CREATE TRIGGER devolucao_evento AFTER INSERT OR UPDATE OF estado ON devolucao
  FOR EACH ROW EXECUTE FUNCTION pos_venda_evento();
CREATE TRIGGER problema_evento AFTER INSERT OR UPDATE OF estado ON problema
  FOR EACH ROW EXECUTE FUNCTION pos_venda_evento();
CREATE TRIGGER reembolso_evento AFTER INSERT OR UPDATE OF estado ON reembolso
  FOR EACH ROW EXECUTE FUNCTION pos_venda_evento();
ALTER TABLE pedido_livre_resolucao ENABLE ALWAYS TRIGGER pedido_livre_resolucao_evento;
ALTER TABLE devolucao ENABLE ALWAYS TRIGGER devolucao_evento;
ALTER TABLE problema ENABLE ALWAYS TRIGGER problema_evento;
ALTER TABLE reembolso ENABLE ALWAYS TRIGGER reembolso_evento;

-- Nada destas tabelas se apaga em bloco.
CREATE TRIGGER pedido_livre_resolucao_sem_truncate BEFORE TRUNCATE ON pedido_livre_resolucao
  FOR EACH STATEMENT EXECUTE FUNCTION rasto_so_se_acrescenta();
CREATE TRIGGER linha_livre_resolucao_sem_truncate BEFORE TRUNCATE ON linha_livre_resolucao
  FOR EACH STATEMENT EXECUTE FUNCTION rasto_so_se_acrescenta();
CREATE TRIGGER devolucao_sem_truncate BEFORE TRUNCATE ON devolucao
  FOR EACH STATEMENT EXECUTE FUNCTION rasto_so_se_acrescenta();
CREATE TRIGGER linha_devolucao_sem_truncate BEFORE TRUNCATE ON linha_devolucao
  FOR EACH STATEMENT EXECUTE FUNCTION rasto_so_se_acrescenta();
CREATE TRIGGER problema_sem_truncate BEFORE TRUNCATE ON problema
  FOR EACH STATEMENT EXECUTE FUNCTION rasto_so_se_acrescenta();
CREATE TRIGGER reembolso_sem_truncate BEFORE TRUNCATE ON reembolso
  FOR EACH STATEMENT EXECUTE FUNCTION rasto_so_se_acrescenta();
CREATE TRIGGER linha_reembolso_sem_truncate BEFORE TRUNCATE ON linha_reembolso
  FOR EACH STATEMENT EXECUTE FUNCTION rasto_so_se_acrescenta();
CREATE TRIGGER linha_livre_resolucao_so_se_acrescenta BEFORE UPDATE OR DELETE ON linha_livre_resolucao
  FOR EACH ROW EXECUTE FUNCTION rasto_so_se_acrescenta();
ALTER TABLE linha_livre_resolucao ENABLE ALWAYS TRIGGER linha_livre_resolucao_so_se_acrescenta;

-- ------------------------------------------------------------- Os âmbitos

ALTER TABLE chave_api DROP CONSTRAINT chave_api_ambitos_validos;
ALTER TABLE chave_api ADD CONSTRAINT chave_api_ambitos_validos CHECK (
  cardinality(ambitos) BETWEEN 1 AND 40
  AND ambitos <@ ARRAY[
    'merchant:read', 'merchant:write',
    'catalog:read', 'catalog:write', 'catalog:publish', 'catalog:import',
    'catalog:history', 'prices:read', 'prices:write',
    'customers:read', 'customers:write', 'customers:billing',
    'customers:exemptions', 'customers:merge', 'customers:privacy', 'tax:read', 'tax:write',
    'legal:read', 'legal:write', 'shipping:read', 'shipping:write', 'orders:read',
    'payments:read', 'payments:write', 'payments:accounts', 'payments:resolve',
    'inventory:read', 'inventory:write', 'inventory:policy', 'fulfilment:read',
    'fulfilment:write', 'invoices:read', 'invoices:write', 'invoices:accounts',
    'returns:read', 'returns:write', 'refunds:read', 'refunds:write',
    'keys:write', 'storefront'
  ]::text[]);

CREATE OR REPLACE FUNCTION papel_ambitos(p_papel text) RETURNS text[]
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  -- Por ordem alfabética, como em src/identidade/papeis.ts. Como a 0050, mais
  -- os returns:* e refunds:* (docs/30, Q6): dono e gestor todos; armazém
  -- recebe e inspecciona; apoio regista e vê os reembolsos.
  SELECT CASE p_papel
    WHEN 'dono' THEN ARRAY['catalog:history', 'catalog:import', 'catalog:publish',
                  'catalog:read', 'catalog:write', 'customers:billing',
                  'customers:exemptions', 'customers:merge', 'customers:privacy',
                  'customers:read', 'customers:write', 'fulfilment:read', 'fulfilment:write',
                  'inventory:policy', 'inventory:read', 'inventory:write',
                  'invoices:accounts', 'invoices:read', 'invoices:write',
                  'keys:write', 'legal:read', 'legal:write',
                  'merchant:read', 'merchant:write', 'orders:read',
                  'payments:accounts', 'payments:read', 'payments:resolve',
                  'payments:write', 'prices:read', 'prices:write', 'refunds:read',
                  'refunds:write', 'returns:read', 'returns:write', 'shipping:read',
                  'shipping:write', 'tax:read', 'tax:write']
    WHEN 'gestor' THEN ARRAY['catalog:history', 'catalog:import', 'catalog:publish',
                  'catalog:read', 'catalog:write', 'customers:merge', 'customers:read',
                  'customers:write', 'fulfilment:read', 'fulfilment:write',
                  'inventory:policy', 'inventory:read', 'inventory:write',
                  'invoices:read', 'invoices:write', 'legal:read', 'merchant:read',
                  'orders:read', 'payments:read', 'payments:write', 'prices:read',
                  'prices:write', 'refunds:read', 'refunds:write', 'returns:read',
                  'returns:write', 'shipping:read', 'shipping:write', 'tax:read']
    WHEN 'armazem' THEN ARRAY['catalog:read', 'fulfilment:read', 'fulfilment:write',
                  'inventory:read', 'inventory:write', 'prices:read', 'returns:read',
                  'returns:write', 'shipping:read']
    WHEN 'apoio' THEN ARRAY['catalog:read', 'customers:read', 'customers:write',
                  'fulfilment:read', 'inventory:read', 'invoices:read', 'legal:read',
                  'merchant:read', 'orders:read', 'payments:read', 'prices:read',
                  'refunds:read', 'returns:read', 'returns:write', 'shipping:read',
                  'tax:read']
  END::text[]
$$;

-- ----------------------------------------------------- RLS e permissões

DO $$
DECLARE
  tabela text;
BEGIN
  FOREACH tabela IN ARRAY ARRAY['pedido_livre_resolucao', 'linha_livre_resolucao', 'devolucao',
    'linha_devolucao', 'problema', 'reembolso', 'linha_reembolso'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tabela);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tabela);
    EXECUTE format(
      'CREATE POLICY so_o_proprio ON %I USING (comerciante_id = comerciante_actual()) WITH CHECK (comerciante_id = comerciante_actual())',
      tabela);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC', tabela);
  END LOOP;
END
$$;

REVOKE EXECUTE ON FUNCTION pedido_livre_resolucao_antes_de_gravar(), devolucao_antes_de_gravar(),
  linha_devolucao_antes_de_gravar(), problema_antes_de_gravar(), reembolso_antes_de_gravar(),
  linha_reembolso_antes_de_inserir(), nota_credito_pedir(uuid), pos_venda_evento() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nota_credito_pedir(uuid) TO eurolify_api;

GRANT SELECT ON pedido_livre_resolucao, linha_livre_resolucao, devolucao, linha_devolucao,
  problema, reembolso, linha_reembolso TO eurolify_api;
GRANT INSERT (comerciante_id, encomenda_id, origem, contacto, prazo_ate, dentro_do_prazo, estado,
  confirmacao) ON pedido_livre_resolucao TO eurolify_api;
GRANT UPDATE (estado, decidido_por, motivo_decisao, versao) ON pedido_livre_resolucao TO eurolify_api;
GRANT INSERT (pedido_id, comerciante_id, linha_encomenda_id, quantidade)
  ON linha_livre_resolucao TO eurolify_api;
GRANT INSERT (comerciante_id, encomenda_id, armazem_id, origem, pedido_livre_resolucao_id, motivo,
  transportadora, seguimento, criada_por) ON devolucao TO eurolify_api;
GRANT UPDATE (transportadora, seguimento, estado, versao) ON devolucao TO eurolify_api;
GRANT INSERT (devolucao_id, comerciante_id, linha_encomenda_id, pedida) ON linha_devolucao
  TO eurolify_api;
GRANT UPDATE (recebida, aceite, estado_artigo) ON linha_devolucao TO eurolify_api;
GRANT INSERT (comerciante_id, encomenda_id, tipo, descricao, criado_por) ON problema TO eurolify_api;
GRANT UPDATE (estado, versao) ON problema TO eurolify_api;
GRANT INSERT (comerciante_id, encomenda_id, pagamento_id, origem, devolucao_id, problema_id,
  montante, moeda, via, decidido_por) ON reembolso TO eurolify_api;
GRANT UPDATE (estado, prova, executado_em, versao, via) ON reembolso TO eurolify_api;
GRANT INSERT (reembolso_id, comerciante_id, posicao, linha_encomenda_id, quantidade, montante)
  ON linha_reembolso TO eurolify_api;
GRANT INSERT (devolucao_id) ON movimento_stock TO eurolify_api;
