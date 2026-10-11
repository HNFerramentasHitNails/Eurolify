-- Pós-venda: o aviso do prazo do reembolso (R10; docs/30 §14; issue #328;
-- Diogo, 11/10/2026: «aprovado», docs/06, DQ).
--
-- O que esta migração faz:
-- - `posvenda_reembolsar_ate()`: o último dia para reembolsar uma livre
--   resolução — o dia do pedido no fuso do comerciante mais 14 dias (**C**,
--   J4). Uma regra, um sítio: a leitura da devolução e a tarefa usam-na.
-- - `devolucao.aviso_prazo_em` e `prazo_passado_em`: os dois avisos, cada um
--   uma vez; o gatilho de eventos põe `refund.deadline_approaching` (faltam 3
--   dias ou menos) e `refund.deadline_passed` (passou) na evento_saida.
-- - `tarefa_prazo_reembolso`, interna, com a origem de quem pediu (0060):
--   enquanto a devolução de uma livre resolução não fecha nem se cancela. O
--   reembolso executado fecha a devolução, e com ela a tarefa.

-- ---------------------------------------------------------------- O prazo

CREATE FUNCTION posvenda_reembolsar_ate(p_recebido timestamptz, p_fuso text) RETURNS date
  LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT (p_recebido AT TIME ZONE p_fuso)::date + 14
$$;

-- O prazo de uma devolução do comerciante do contexto: o último dia, e os
-- dias que faltam hoje no fuso dele (negativo depois de passar). Vazio se a
-- devolução não vem de um pedido de livre resolução.
CREATE FUNCTION posvenda_prazo_da_devolucao(p_devolucao uuid)
  RETURNS TABLE (ate date, dias integer, fuso text)
  LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT x.ate, (x.ate - (now() AT TIME ZONE x.fuso)::date)::int, x.fuso
  FROM (SELECT public.posvenda_reembolsar_ate(p.recebido_em, c.fuso) AS ate, c.fuso
        FROM public.devolucao d
        JOIN public.pedido_livre_resolucao p ON p.id = d.pedido_livre_resolucao_id
        JOIN public.comerciante c ON c.id = d.comerciante_id
        WHERE d.id = p_devolucao) x
$$;

-- --------------------------------------------------------- Os dois avisos

ALTER TABLE devolucao ADD COLUMN aviso_prazo_em timestamptz;
ALTER TABLE devolucao ADD COLUMN prazo_passado_em timestamptz;
GRANT UPDATE (aviso_prazo_em, prazo_passado_em) ON devolucao TO eurolify_api;

CREATE OR REPLACE FUNCTION devolucao_antes_de_gravar() RETURNS trigger
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
  -- Os avisos do prazo do reembolso (docs/30 §14): só numa devolução de um
  -- pedido de livre resolução, gravam-se uma vez e nunca se apagam.
  IF (OLD.aviso_prazo_em IS NOT NULL AND NEW.aviso_prazo_em IS DISTINCT FROM OLD.aviso_prazo_em)
     OR (OLD.prazo_passado_em IS NOT NULL
         AND NEW.prazo_passado_em IS DISTINCT FROM OLD.prazo_passado_em) THEN
    RAISE EXCEPTION 'returns.immutable: um aviso do prazo não muda';
  END IF;
  IF (NEW.aviso_prazo_em IS NOT NULL OR NEW.prazo_passado_em IS NOT NULL)
     AND NEW.pedido_livre_resolucao_id IS NULL THEN
    RAISE EXCEPTION 'returns.invalid_field: só uma devolução de livre resolução tem o prazo do reembolso';
  END IF;
  IF NEW.estado IS DISTINCT FROM OLD.estado AND NOT (OLD.estado, NEW.estado) IN (
       ('a_aguardar', 'recebida'), ('recebida', 'inspeccionada'), ('inspeccionada', 'decidida'),
       ('decidida', 'fechada'), ('a_aguardar', 'cancelada'), ('recebida', 'cancelada'),
       -- Fechada sem reembolso, com motivo (nada a reembolsar; revisão do
       -- #329, P2-5); de volta a inspeccionada quando o reembolso se anula
       -- antes de executado (P1-4).
       ('inspeccionada', 'fechada'), ('decidida', 'inspeccionada')) THEN
    RAISE EXCEPTION 'returns.invalid_transition: % → %', OLD.estado, NEW.estado;
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION devolucao_prazo_evento() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  t text;
  prazo record;
BEGIN
  IF NEW.prazo_passado_em IS NOT NULL AND OLD.prazo_passado_em IS NULL THEN
    t := 'refund.deadline_passed';
  ELSIF NEW.aviso_prazo_em IS NOT NULL AND OLD.aviso_prazo_em IS NULL THEN
    t := 'refund.deadline_approaching';
  ELSE
    RETURN NULL;
  END IF;
  SELECT * INTO prazo FROM public.posvenda_prazo_da_devolucao(NEW.id);
  -- Só identificadores, o prazo e os dias: nunca dados pessoais (A4).
  INSERT INTO public.evento_saida (comerciante_id, tipo, agregado_tipo, agregado_id, dados)
  VALUES (NEW.comerciante_id, t, 'devolucao', NEW.id,
    jsonb_build_object('id', NEW.id, 'encomenda_id', NEW.encomenda_id,
      'estado', NEW.estado, 'reembolsar_ate', to_char(prazo.ate, 'YYYY-MM-DD'),
      'dias', prazo.dias,
      'em', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
  RETURN NULL;
END
$$;
CREATE TRIGGER devolucao_prazo_evento
  AFTER UPDATE OF aviso_prazo_em, prazo_passado_em ON devolucao
  FOR EACH ROW EXECUTE FUNCTION devolucao_prazo_evento();
ALTER TABLE devolucao ENABLE ALWAYS TRIGGER devolucao_prazo_evento;

-- ------------------------------------------------------------- A tarefa

-- As devoluções de livre resolução ainda por reembolsar (A1, A5): uma
-- tabela interna, como a tarefa_encomenda da 0047, que só os gatilhos e as
-- funções do dono escrevem. `quando` é a hora do próximo aviso.
CREATE TABLE tarefa_prazo_reembolso (
  devolucao_id uuid PRIMARY KEY,
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  quando timestamptz NOT NULL,
  origem jsonb
);
CREATE INDEX tarefa_prazo_reembolso_quando ON tarefa_prazo_reembolso (quando);
ALTER TABLE tarefa_prazo_reembolso ENABLE ROW LEVEL SECURITY;
CREATE POLICY so_o_proprio ON tarefa_prazo_reembolso
  USING (comerciante_id = comerciante_actual())
  WITH CHECK (comerciante_id = comerciante_actual());
REVOKE ALL ON tarefa_prazo_reembolso FROM PUBLIC;
-- A origem de quem pediu (docs/28 §3.7; 0060).
CREATE TRIGGER tarefa_guardar_origem BEFORE INSERT OR UPDATE ON tarefa_prazo_reembolso
  FOR EACH ROW EXECUTE FUNCTION tarefa_guardar_origem();

-- A hora do próximo aviso: o início do dia em que faltam 3 (no fuso do
-- comerciante) ou, avisado, o início do dia seguinte ao último.
CREATE FUNCTION posvenda_prazo_quando(p_devolucao uuid) RETURNS timestamptz
  LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT CASE WHEN d.aviso_prazo_em IS NULL
    THEN ((x.ate - 3)::timestamp AT TIME ZONE x.fuso)
    ELSE ((x.ate + 1)::timestamp AT TIME ZONE x.fuso) END
  FROM public.devolucao d, public.posvenda_prazo_da_devolucao(d.id) x
  WHERE d.id = p_devolucao
$$;

CREATE FUNCTION devolucao_tarefa_prazo() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.pedido_livre_resolucao_id IS NULL OR NEW.estado IN ('fechada', 'cancelada')
     OR NEW.prazo_passado_em IS NOT NULL THEN
    DELETE FROM public.tarefa_prazo_reembolso WHERE devolucao_id = NEW.id;
  ELSE
    INSERT INTO public.tarefa_prazo_reembolso (devolucao_id, comerciante_id, quando)
    VALUES (NEW.id, NEW.comerciante_id, public.posvenda_prazo_quando(NEW.id))
    ON CONFLICT (devolucao_id) DO UPDATE SET quando = EXCLUDED.quando;
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER devolucao_tarefa_prazo
  AFTER INSERT OR UPDATE OF estado, aviso_prazo_em, prazo_passado_em ON devolucao
  FOR EACH ROW EXECUTE FUNCTION devolucao_tarefa_prazo();
ALTER TABLE devolucao ENABLE ALWAYS TRIGGER devolucao_tarefa_prazo;

CREATE FUNCTION posvenda_prazo_comerciantes() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT DISTINCT t.comerciante_id FROM public.tarefa_prazo_reembolso t WHERE t.quando <= now()
$$;

CREATE FUNCTION posvenda_prazo_tarefas(p_limite integer) RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT t.devolucao_id FROM public.tarefa_prazo_reembolso t
  WHERE t.comerciante_id = public.comerciante_actual() AND t.quando <= now()
  ORDER BY t.quando, t.devolucao_id
  LIMIT greatest(p_limite, 0)
$$;

-- A tarefa olhou cedo de mais (a volta das que já estavam abertas, ou o
-- relógio): volta à hora do próximo aviso.
CREATE FUNCTION posvenda_prazo_reagendar(p_devolucao uuid) RETURNS void
  LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  UPDATE public.tarefa_prazo_reembolso SET quando = public.posvenda_prazo_quando(p_devolucao)
  WHERE comerciante_id = public.comerciante_actual() AND devolucao_id = p_devolucao
$$;

CREATE OR REPLACE FUNCTION tarefa_origem(p_tipo text, p_alvo uuid) RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT CASE p_tipo
    WHEN 'pagamento' THEN (SELECT t.origem FROM public.tarefa_pagamento t
      WHERE t.comerciante_id = public.comerciante_actual()
        AND t.alvo_tipo = 'pagamento' AND t.alvo_id = p_alvo)
    WHEN 'encomenda' THEN (SELECT t.origem FROM public.tarefa_pagamento t
      WHERE t.comerciante_id = public.comerciante_actual()
        AND t.alvo_tipo = 'encomenda' AND t.alvo_id = p_alvo)
    WHEN 'conclusao' THEN (SELECT t.origem FROM public.tarefa_encomenda t
      WHERE t.comerciante_id = public.comerciante_actual() AND t.encomenda_id = p_alvo)
    WHEN 'documento' THEN (SELECT t.origem FROM public.tarefa_documento t
      WHERE t.comerciante_id = public.comerciante_actual() AND t.documento_id = p_alvo)
    WHEN 'reembolso' THEN (SELECT t.origem FROM public.tarefa_reembolso t
      WHERE t.comerciante_id = public.comerciante_actual() AND t.reembolso_id = p_alvo)
    WHEN 'prazo_reembolso' THEN (SELECT t.origem FROM public.tarefa_prazo_reembolso t
      WHERE t.comerciante_id = public.comerciante_actual() AND t.devolucao_id = p_alvo)
  END
$$;

-- As devoluções de livre resolução que já estavam abertas no ensaio: para a
-- tarefa, agora (ela calcula e reagenda). A devolução tem o RLS forçado e a
-- migração corre sem comerciante: o NO FORCE só dura esta transacção.
ALTER TABLE devolucao NO FORCE ROW LEVEL SECURITY;
INSERT INTO tarefa_prazo_reembolso (devolucao_id, comerciante_id, quando)
SELECT d.id, d.comerciante_id, now() FROM devolucao d
WHERE d.pedido_livre_resolucao_id IS NOT NULL AND d.estado NOT IN ('fechada', 'cancelada');
ALTER TABLE devolucao FORCE ROW LEVEL SECURITY;

REVOKE EXECUTE ON FUNCTION posvenda_reembolsar_ate(timestamptz, text),
  posvenda_prazo_da_devolucao(uuid), devolucao_prazo_evento(), posvenda_prazo_quando(uuid),
  devolucao_tarefa_prazo(), posvenda_prazo_comerciantes(), posvenda_prazo_tarefas(integer),
  posvenda_prazo_reagendar(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION posvenda_prazo_da_devolucao(uuid), posvenda_reembolsar_ate(timestamptz, text),
  posvenda_prazo_comerciantes(), posvenda_prazo_tarefas(integer), posvenda_prazo_reagendar(uuid)
  TO eurolify_api;
