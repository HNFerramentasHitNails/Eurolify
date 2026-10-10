-- Stock e encomendas, parte 1 (docs/27; issue #295; Diogo, 10/10/2026:
-- «sim, aprovo; avança com o código da fatia 9»): armazém (um por loja),
-- saldo escrito só pelo livro de movimentos, lotes, política de stock por
-- variante, expedições e os estados da encomenda depois de paga. O stock só
-- muda por movimento (order-fulfilment, regra 1; docs/04, lição 3.2): a API
-- não escreve o saldo.
SET LOCAL lock_timeout = '10s';

-- ---------------------------------------------------------------- Armazém

CREATE TABLE armazem (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  loja_id uuid NOT NULL,
  nome text NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 100),
  morada jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(morada) = 'object'),
  estado text NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'arquivado')),
  criado_em timestamptz NOT NULL DEFAULT now(),
  actualizado_em timestamptz NOT NULL DEFAULT now(),
  versao integer NOT NULL DEFAULT 1,
  UNIQUE (comerciante_id, id),
  FOREIGN KEY (comerciante_id, loja_id) REFERENCES loja (comerciante_id, id)
);
-- Um armazém activo por loja nesta fase (docs/27 Q1).
CREATE UNIQUE INDEX armazem_um_por_loja ON armazem (loja_id) WHERE estado = 'activo';

-- ------------------------------------------------- Política de stock e lote

-- Sem linha, a política é a do tipo do artigo: físico controla, o resto não
-- (docs/27 §3.5).
CREATE TABLE politica_stock (
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  variante_id uuid NOT NULL,
  politica text NOT NULL CHECK (politica IN ('controla', 'nao_controla', 'vende_sem_stock')),
  exige_lote boolean NOT NULL DEFAULT false,
  actualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (variante_id),
  FOREIGN KEY (comerciante_id, variante_id) REFERENCES variante (comerciante_id, id)
);

CREATE TABLE lote (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  variante_id uuid NOT NULL,
  numero text NOT NULL CHECK (length(btrim(numero)) BETWEEN 1 AND 60),
  validade date,
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (comerciante_id, id),
  UNIQUE (comerciante_id, variante_id, id),
  UNIQUE (variante_id, numero),
  FOREIGN KEY (comerciante_id, variante_id) REFERENCES variante (comerciante_id, id)
);
CREATE TRIGGER lote_so_se_acrescenta
  BEFORE UPDATE OR DELETE ON lote
  FOR EACH ROW EXECUTE FUNCTION rasto_so_se_acrescenta();
ALTER TABLE lote ENABLE ALWAYS TRIGGER lote_so_se_acrescenta;

-- ------------------------------------------------------------------ Saldo

-- Só os gatilhos do livro o escrevem (a API não tem INSERT nem UPDATE).
CREATE TABLE saldo_stock (
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  armazem_id uuid NOT NULL,
  variante_id uuid NOT NULL,
  fisico integer NOT NULL DEFAULT 0 CHECK (fisico >= 0),
  reservado integer NOT NULL DEFAULT 0 CHECK (reservado >= 0),
  PRIMARY KEY (armazem_id, variante_id),
  FOREIGN KEY (comerciante_id, armazem_id) REFERENCES armazem (comerciante_id, id),
  FOREIGN KEY (comerciante_id, variante_id) REFERENCES variante (comerciante_id, id)
);

CREATE TABLE saldo_lote (
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  armazem_id uuid NOT NULL,
  lote_id uuid NOT NULL,
  fisico integer NOT NULL DEFAULT 0 CHECK (fisico >= 0),
  PRIMARY KEY (armazem_id, lote_id),
  FOREIGN KEY (comerciante_id, armazem_id) REFERENCES armazem (comerciante_id, id),
  FOREIGN KEY (comerciante_id, lote_id) REFERENCES lote (comerciante_id, id)
);

-- ------------------------------------------------------------- Expedição

CREATE TABLE expedicao (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  encomenda_id uuid NOT NULL,
  armazem_id uuid NOT NULL,
  -- Copiado da encomenda: o serviço da etiqueta é o vendido (docs/04, 3.7).
  metodo_entrega jsonb NOT NULL CHECK (jsonb_typeof(metodo_entrega) = 'object'),
  transportadora text CHECK (transportadora IS NULL OR length(btrim(transportadora)) BETWEEN 1 AND 100),
  servico text CHECK (servico IS NULL OR length(btrim(servico)) BETWEEN 1 AND 100),
  seguimento text CHECK (seguimento IS NULL OR length(btrim(seguimento)) BETWEEN 1 AND 200),
  estado text NOT NULL DEFAULT 'criada' CHECK (estado IN ('criada', 'expedida', 'entregue',
    'devolvida_ao_remetente', 'perdida')),
  expedida_em timestamptz,
  entregue_em timestamptz,
  prova_entrega text CHECK (prova_entrega IS NULL OR length(prova_entrega) <= 500),
  criada_por text NOT NULL,
  criada_em timestamptz NOT NULL DEFAULT now(),
  versao integer NOT NULL DEFAULT 1,
  UNIQUE (comerciante_id, id),
  FOREIGN KEY (comerciante_id, encomenda_id) REFERENCES encomenda (comerciante_id, id),
  FOREIGN KEY (comerciante_id, armazem_id) REFERENCES armazem (comerciante_id, id),
  CHECK ((estado = 'criada') = (expedida_em IS NULL)),
  CHECK ((estado = 'entregue') = (entregue_em IS NOT NULL))
);
CREATE INDEX expedicao_por_encomenda ON expedicao (comerciante_id, encomenda_id);

-- O que a expedição leva de cada linha da encomenda (um kit em unidades do
-- kit; os componentes saem pelos movimentos, com o lote de cada um).
CREATE TABLE linha_expedicao (
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  expedicao_id uuid NOT NULL,
  linha_encomenda_id uuid NOT NULL,
  quantidade integer NOT NULL CHECK (quantidade > 0),
  PRIMARY KEY (expedicao_id, linha_encomenda_id),
  FOREIGN KEY (comerciante_id, expedicao_id) REFERENCES expedicao (comerciante_id, id),
  FOREIGN KEY (comerciante_id, linha_encomenda_id) REFERENCES linha_encomenda (comerciante_id, id)
);
CREATE TRIGGER linha_expedicao_so_se_acrescenta
  BEFORE UPDATE OR DELETE ON linha_expedicao
  FOR EACH ROW EXECUTE FUNCTION rasto_so_se_acrescenta();
ALTER TABLE linha_expedicao ENABLE ALWAYS TRIGGER linha_expedicao_so_se_acrescenta;

-- A expedição só anda para a frente; os campos copiados não mudam.
CREATE FUNCTION expedicao_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem text := nullif(btrim(current_setting('eurolify.quem', true)), '');
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'shipments.immutable: uma expedição não se apaga';
  END IF;
  IF quem IS NULL THEN
    RAISE EXCEPTION 'shipments.change_without_who: % sem eurolify.quem', TG_OP;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.estado := 'criada';
    NEW.expedida_em := NULL;
    NEW.entregue_em := NULL;
    NEW.criada_por := quem;
    NEW.criada_em := now();
    RETURN NEW;
  END IF;
  IF NEW.encomenda_id IS DISTINCT FROM OLD.encomenda_id OR NEW.armazem_id IS DISTINCT FROM OLD.armazem_id
     OR NEW.metodo_entrega IS DISTINCT FROM OLD.metodo_entrega OR NEW.criada_por IS DISTINCT FROM OLD.criada_por THEN
    RAISE EXCEPTION 'shipments.immutable: a encomenda, o armazém e o método de entrega não mudam';
  END IF;
  IF NEW.estado IS DISTINCT FROM OLD.estado AND NOT (
       (OLD.estado = 'criada' AND NEW.estado = 'expedida')
    OR (OLD.estado = 'expedida' AND NEW.estado IN ('entregue', 'devolvida_ao_remetente', 'perdida'))) THEN
    RAISE EXCEPTION 'shipments.invalid_transition: % → %', OLD.estado, NEW.estado;
  END IF;
  IF OLD.estado IN ('entregue', 'devolvida_ao_remetente', 'perdida') THEN
    RAISE EXCEPTION 'shipments.immutable: uma expedição acabada não muda';
  END IF;
  IF NEW.estado = 'expedida' AND OLD.estado = 'criada' THEN NEW.expedida_em := now(); END IF;
  IF NEW.estado = 'entregue' AND OLD.estado <> 'entregue' THEN NEW.entregue_em := now(); END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER expedicao_antes_de_gravar
  BEFORE INSERT OR UPDATE OR DELETE ON expedicao
  FOR EACH ROW EXECUTE FUNCTION expedicao_antes_de_gravar();
ALTER TABLE expedicao ENABLE ALWAYS TRIGGER expedicao_antes_de_gravar;

-- ----------------------------------------------------- Livro de movimentos

CREATE TABLE movimento_stock (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  armazem_id uuid NOT NULL,
  variante_id uuid NOT NULL,
  lote_id uuid,
  tipo text NOT NULL CHECK (tipo IN ('entrada', 'reserva', 'libertacao', 'saida', 'ajuste')),
  -- Positiva; só o ajuste tem sinal (+ ou −).
  quantidade integer NOT NULL CHECK (quantidade <> 0 AND (tipo = 'ajuste' OR quantidade > 0)),
  origem text NOT NULL CHECK (origem IN ('encomenda', 'expedicao', 'inventario', 'importacao',
    'sistema_externo')),
  encomenda_id uuid,
  expedicao_id uuid,
  motivo text CHECK (motivo IS NULL OR length(btrim(motivo)) BETWEEN 1 AND 500),
  fisico_antes integer NOT NULL DEFAULT 0,
  fisico_depois integer NOT NULL DEFAULT 0,
  reservado_antes integer NOT NULL DEFAULT 0,
  reservado_depois integer NOT NULL DEFAULT 0,
  quem text NOT NULL DEFAULT '',
  em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (comerciante_id, id),
  FOREIGN KEY (comerciante_id, armazem_id) REFERENCES armazem (comerciante_id, id),
  FOREIGN KEY (comerciante_id, variante_id) REFERENCES variante (comerciante_id, id),
  FOREIGN KEY (comerciante_id, variante_id, lote_id) REFERENCES lote (comerciante_id, variante_id, id),
  FOREIGN KEY (comerciante_id, encomenda_id) REFERENCES encomenda (comerciante_id, id),
  FOREIGN KEY (comerciante_id, expedicao_id) REFERENCES expedicao (comerciante_id, id),
  CHECK (tipo <> 'ajuste' OR motivo IS NOT NULL),
  CHECK (tipo NOT IN ('reserva', 'libertacao') OR encomenda_id IS NOT NULL),
  CHECK (tipo <> 'saida' OR (encomenda_id IS NOT NULL AND expedicao_id IS NOT NULL))
);
CREATE INDEX movimento_por_variante ON movimento_stock (comerciante_id, variante_id, em);
CREATE INDEX movimento_por_encomenda ON movimento_stock (encomenda_id) WHERE encomenda_id IS NOT NULL;
CREATE TRIGGER movimento_stock_so_se_acrescenta
  BEFORE UPDATE OR DELETE ON movimento_stock
  FOR EACH ROW EXECUTE FUNCTION rasto_so_se_acrescenta();
ALTER TABLE movimento_stock ENABLE ALWAYS TRIGGER movimento_stock_so_se_acrescenta;
CREATE TRIGGER movimento_stock_sem_truncate
  BEFORE TRUNCATE ON movimento_stock
  FOR EACH STATEMENT EXECUTE FUNCTION rasto_so_se_acrescenta();
ALTER TABLE movimento_stock ENABLE ALWAYS TRIGGER movimento_stock_sem_truncate;

-- A política de uma variante (sem linha: a do tipo do artigo).
CREATE FUNCTION stock_politica(p_variante uuid, OUT politica text, OUT exige_lote boolean)
  LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT coalesce(p.politica, CASE WHEN a.tipo = 'fisico' THEN 'controla' ELSE 'nao_controla' END),
         coalesce(p.exige_lote, false)
  FROM public.variante v
  JOIN public.artigo a ON a.comerciante_id = v.comerciante_id AND a.id = v.artigo_id
  LEFT JOIN public.politica_stock p ON p.variante_id = v.id
  WHERE v.id = p_variante
$$;

-- O coração do livro (docs/27 R1, R3, R5): escreve o saldo no mesmo passo
-- que o movimento, com o antes e o depois; recusa o físico negativo, a
-- reserva acima do físico (salvo «vende sem stock») e a entrada ou saída sem
-- lote numa variante que o exige.
CREATE FUNCTION movimento_stock_antes_de_gravar() RETURNS trigger
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
  IF pol.politica = 'nao_controla' THEN
    RAISE EXCEPTION 'inventory.not_controlled: esta variante não controla stock';
  END IF;
  IF pol.exige_lote AND NEW.tipo IN ('entrada', 'saida') AND NEW.lote_id IS NULL THEN
    RAISE EXCEPTION 'inventory.lot_required: esta variante exige lote';
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
  NEW.em := now();
  UPDATE public.saldo_stock SET fisico = f, reservado = r
  WHERE armazem_id = NEW.armazem_id AND variante_id = NEW.variante_id;
  IF NEW.lote_id IS NOT NULL AND NEW.tipo IN ('entrada', 'saida', 'ajuste') THEN
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
CREATE TRIGGER movimento_stock_antes_de_gravar
  BEFORE INSERT ON movimento_stock
  FOR EACH ROW EXECUTE FUNCTION movimento_stock_antes_de_gravar();
ALTER TABLE movimento_stock ENABLE ALWAYS TRIGGER movimento_stock_antes_de_gravar;

CREATE FUNCTION movimento_stock_evento() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  INSERT INTO public.evento_saida (comerciante_id, tipo, agregado_tipo, agregado_id, dados)
  VALUES (NEW.comerciante_id,
    CASE NEW.tipo WHEN 'entrada' THEN 'inventory.received' WHEN 'reserva' THEN 'inventory.reserved'
      WHEN 'libertacao' THEN 'inventory.released' WHEN 'saida' THEN 'inventory.dispatched'
      ELSE 'inventory.adjusted' END,
    'variante', NEW.variante_id,
    jsonb_build_object('movimento_id', NEW.id, 'variante_id', NEW.variante_id,
      'armazem_id', NEW.armazem_id, 'quantidade', NEW.quantidade,
      'fisico', NEW.fisico_depois, 'reservado', NEW.reservado_depois,
      'encomenda_id', NEW.encomenda_id,
      'em', to_char(NEW.em AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
  RETURN NULL;
END
$$;
CREATE TRIGGER movimento_stock_evento AFTER INSERT ON movimento_stock
  FOR EACH ROW EXECUTE FUNCTION movimento_stock_evento();

-- ----------------------------------------------- A encomenda depois de paga

ALTER TABLE encomenda DROP CONSTRAINT encomenda_estado_check;
ALTER TABLE encomenda ADD CONSTRAINT encomenda_estado_check CHECK (estado IN (
  'a_aguardar_pagamento', 'paga', 'cancelada_sem_pagamento', 'em_preparacao',
  'expedida_parcial', 'expedida', 'entregue', 'concluida'));

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
  -- Só para a frente (docs/27 §4.1); cancelar uma paga é da fatia 11.
  IF NOT (OLD.estado, NEW.estado) IN (
       ('a_aguardar_pagamento', 'paga'), ('a_aguardar_pagamento', 'cancelada_sem_pagamento'),
       ('paga', 'em_preparacao'), ('em_preparacao', 'expedida_parcial'),
       ('em_preparacao', 'expedida'), ('expedida_parcial', 'expedida'),
       ('expedida', 'entregue'), ('entregue', 'concluida')) THEN
    RAISE EXCEPTION 'orders.invalid_transition: % → %', OLD.estado, NEW.estado;
  END IF;
  RETURN NEW;
END
$$;

-- As transições da encomenda (só se acrescentam): quem, quando, o motivo.
CREATE TABLE transicao_encomenda (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  encomenda_id uuid NOT NULL,
  de text,
  para text NOT NULL,
  quem text NOT NULL,
  motivo text CHECK (motivo IS NULL OR length(motivo) <= 500),
  em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (comerciante_id, encomenda_id) REFERENCES encomenda (comerciante_id, id)
);
CREATE INDEX transicao_por_encomenda ON transicao_encomenda (encomenda_id, em);
CREATE TRIGGER transicao_encomenda_so_se_acrescenta
  BEFORE UPDATE OR DELETE ON transicao_encomenda
  FOR EACH ROW EXECUTE FUNCTION rasto_so_se_acrescenta();
ALTER TABLE transicao_encomenda ENABLE ALWAYS TRIGGER transicao_encomenda_so_se_acrescenta;

-- O evento e a transição de cada mudança de estado (substitui o da 0044, que
-- só conhecia «paga» e «cancelada»).
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
      WHEN 'em_preparacao' THEN 'order.preparing'
      WHEN 'expedida_parcial' THEN 'order.partially_shipped'
      WHEN 'expedida' THEN 'order.shipped'
      WHEN 'entregue' THEN 'order.delivered'
      ELSE 'order.completed'
    END,
    'encomenda', NEW.id,
    jsonb_build_object('encomenda_id', NEW.id, 'estado', NEW.estado,
      'total', NEW.total, 'moeda', NEW.moeda,
      'em', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
  RETURN NULL;
END
$$;
-- Também a criação fica no rasto das transições.
CREATE TRIGGER encomenda_transicao_inicial AFTER INSERT ON encomenda
  FOR EACH ROW EXECUTE FUNCTION encomenda_estado_evento();

-- Cancelada sem pagamento: as reservas que ficaram libertam-se aqui, venha o
-- cancelamento de onde vier (docs/27 §4.2).
CREATE FUNCTION encomenda_liberta_reservas() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  r record;
BEGIN
  IF NEW.estado <> 'cancelada_sem_pagamento' OR OLD.estado = NEW.estado THEN
    RETURN NULL;
  END IF;
  FOR r IN
    SELECT m.armazem_id, m.variante_id,
      sum(CASE m.tipo WHEN 'reserva' THEN m.quantidade ELSE -m.quantidade END) AS q
    FROM public.movimento_stock m
    WHERE m.encomenda_id = NEW.id AND m.tipo IN ('reserva', 'libertacao', 'saida')
    GROUP BY m.armazem_id, m.variante_id
    HAVING sum(CASE m.tipo WHEN 'reserva' THEN m.quantidade ELSE -m.quantidade END) > 0
  LOOP
    INSERT INTO public.movimento_stock (comerciante_id, armazem_id, variante_id, tipo,
      quantidade, origem, encomenda_id, motivo)
    VALUES (NEW.comerciante_id, r.armazem_id, r.variante_id, 'libertacao', r.q, 'encomenda',
      NEW.id, 'encomenda cancelada sem pagamento');
  END LOOP;
  RETURN NULL;
END
$$;
CREATE TRIGGER encomenda_liberta_reservas AFTER UPDATE OF estado ON encomenda
  FOR EACH ROW EXECUTE FUNCTION encomenda_liberta_reservas();

-- ----------------------------------------------------- A tarefa da conclusão

-- Concluída 14 dias depois de entregue (docs/27 Q6; o prazo dos bens,
-- consumer-rights-eu; a contagem por país é C). Tabela interna, como a
-- tarefa_pagamento da 0044.
CREATE TABLE tarefa_encomenda (
  encomenda_id uuid PRIMARY KEY,
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  quando timestamptz NOT NULL
);
CREATE INDEX tarefa_encomenda_quando ON tarefa_encomenda (quando);
ALTER TABLE tarefa_encomenda ENABLE ROW LEVEL SECURITY;
CREATE POLICY so_o_proprio ON tarefa_encomenda
  USING (comerciante_id = comerciante_actual())
  WITH CHECK (comerciante_id = comerciante_actual());
REVOKE ALL ON tarefa_encomenda FROM PUBLIC;

CREATE FUNCTION encomenda_tarefa_conclusao() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.estado = 'entregue' AND OLD.estado <> 'entregue' THEN
    INSERT INTO public.tarefa_encomenda (encomenda_id, comerciante_id, quando)
    VALUES (NEW.id, NEW.comerciante_id, now() + interval '14 days')
    ON CONFLICT (encomenda_id) DO UPDATE SET quando = EXCLUDED.quando;
  ELSIF NEW.estado <> 'entregue' THEN
    DELETE FROM public.tarefa_encomenda WHERE encomenda_id = NEW.id;
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER encomenda_tarefa_conclusao AFTER UPDATE OF estado ON encomenda
  FOR EACH ROW EXECUTE FUNCTION encomenda_tarefa_conclusao();

CREATE FUNCTION encomendas_comerciantes_com_tarefas() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT DISTINCT t.comerciante_id FROM public.tarefa_encomenda t WHERE t.quando <= now()
$$;

CREATE FUNCTION encomendas_tarefas(p_limite integer) RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT t.encomenda_id FROM public.tarefa_encomenda t
  WHERE t.comerciante_id = public.comerciante_actual() AND t.quando <= now()
  ORDER BY t.quando, t.encomenda_id
  LIMIT greatest(p_limite, 0)
$$;

REVOKE EXECUTE ON FUNCTION movimento_stock_antes_de_gravar(), movimento_stock_evento(),
  encomenda_tarefa_conclusao(), encomendas_comerciantes_com_tarefas(),
  encomendas_tarefas(integer), stock_politica(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION encomendas_comerciantes_com_tarefas(), encomendas_tarefas(integer),
  stock_politica(uuid) TO eurolify_api;

-- ----------------------------------------------------- RLS e permissões

DO $$
DECLARE
  tabela text;
BEGIN
  FOREACH tabela IN ARRAY ARRAY['armazem', 'politica_stock', 'lote', 'saldo_stock', 'saldo_lote',
    'movimento_stock', 'expedicao', 'linha_expedicao', 'transicao_encomenda'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tabela);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tabela);
    EXECUTE format(
      'CREATE POLICY so_o_proprio ON %I USING (comerciante_id = comerciante_actual()) WITH CHECK (comerciante_id = comerciante_actual())',
      tabela);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC', tabela);
  END LOOP;
END
$$;

GRANT SELECT ON armazem, politica_stock, lote, saldo_stock, saldo_lote, movimento_stock,
  expedicao, linha_expedicao, transicao_encomenda TO eurolify_api;
GRANT INSERT (comerciante_id, loja_id, nome, morada) ON armazem TO eurolify_api;
GRANT UPDATE (nome, morada, estado, actualizado_em, versao) ON armazem TO eurolify_api;
GRANT INSERT (comerciante_id, variante_id, politica, exige_lote) ON politica_stock TO eurolify_api;
GRANT UPDATE (politica, exige_lote, actualizado_em) ON politica_stock TO eurolify_api;
GRANT INSERT (comerciante_id, variante_id, numero, validade) ON lote TO eurolify_api;
GRANT INSERT (comerciante_id, armazem_id, variante_id, lote_id, tipo, quantidade, origem,
  encomenda_id, expedicao_id, motivo) ON movimento_stock TO eurolify_api;
GRANT INSERT (comerciante_id, encomenda_id, armazem_id, metodo_entrega, transportadora, servico,
  seguimento, criada_por) ON expedicao TO eurolify_api;
GRANT UPDATE (transportadora, servico, seguimento, estado, prova_entrega, versao)
  ON expedicao TO eurolify_api;
GRANT INSERT (comerciante_id, expedicao_id, linha_encomenda_id, quantidade)
  ON linha_expedicao TO eurolify_api;

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
    'inventory:read', 'inventory:write', 'fulfilment:read', 'fulfilment:write',
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
                           'fulfilment:read', 'fulfilment:write', 'inventory:read',
                           'inventory:write', 'orders:read', 'payments:accounts', 'payments:read',
                           'payments:resolve', 'payments:write', 'prices:read',
                           'prices:write',
                           'shipping:read', 'shipping:write', 'tax:read', 'tax:write']
    WHEN 'gestor' THEN ARRAY['catalog:history', 'catalog:import', 'catalog:publish',
                             'catalog:read', 'catalog:write', 'customers:read',
                             'customers:write', 'fulfilment:read', 'fulfilment:write',
                             'inventory:read', 'inventory:write', 'legal:read', 'merchant:read',
                             'orders:read', 'payments:read', 'payments:write',
                             'prices:read', 'prices:write',
                             'shipping:read', 'shipping:write', 'tax:read']
    -- O armazém vê o que expedir pela vista própria (docs/27 §6).
    WHEN 'armazem' THEN ARRAY['catalog:read', 'fulfilment:read', 'fulfilment:write',
                              'inventory:read', 'inventory:write', 'prices:read',
                              'shipping:read']
    WHEN 'apoio' THEN ARRAY['catalog:read', 'customers:read', 'customers:write',
                            'fulfilment:read', 'inventory:read',
                            'legal:read', 'merchant:read', 'orders:read',
                            'payments:read', 'prices:read', 'shipping:read', 'tax:read']
  END::text[]
$$;
