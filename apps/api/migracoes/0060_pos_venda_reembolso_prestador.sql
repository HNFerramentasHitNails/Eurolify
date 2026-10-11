-- Pós-venda, parte 2: o reembolso pela EuPago (docs/30 §13; issue #328;
-- Diogo, 11/10/2026: «aprovado, com a A», docs/06, DP).
--
-- O que esta migração faz:
-- - `pagamento.id_transaccao_prestador`: o `trid` da EuPago, que o reembolso
--   pede (E1) e que só chega nos avisos (E5); grava-se uma vez (P2). Os
--   pagamentos antigos ficam sem ele e reembolsam-se à mão.
-- - O reembolso ganha `a_pedir` (dura a chamada ao prestador: dois pedidos ao
--   mesmo tempo não saem os dois) e `a_confirmar` (o prestador aceitou; falta
--   a consulta dizer «reembolsado»), com quem pediu e quando, a referência
--   do prestador, o código de uma recusa e a última consulta (P4 a P6).
-- - Voltar de `incerto` a `a_executar` é de uma pessoa, com motivo (P7), e
--   os tectos de R5 voltam a conferir-se (P8). Um `a_confirmar` (aceite pelo
--   prestador) só passa a `executado` (revisão do #350, P1-1).
-- - `refund.requested` (P9) e os motivos novos da fila de diferenças.
-- - A função que diz à tarefa que comerciantes têm reembolsos a olhar.
-- Q8 (opção A): o Multibanco continua à mão; isso decide-se na API, não aqui.

-- ------------------------------------------------------------ O pagamento

ALTER TABLE pagamento ADD COLUMN id_transaccao_prestador text
  CHECK (id_transaccao_prestador IS NULL OR id_transaccao_prestador ~ '^[0-9]{1,20}$');
GRANT UPDATE (id_transaccao_prestador) ON pagamento TO eurolify_api;

CREATE OR REPLACE FUNCTION pagamento_antes_de_gravar() RETURNS trigger
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
  IF (to_jsonb(NEW) - 'estado' - 'actualizado_em' - 'referencia_prestador' - 'instrucoes'
       - 'id_transaccao_prestador')
     IS DISTINCT FROM (to_jsonb(OLD) - 'estado' - 'actualizado_em' - 'referencia_prestador' - 'instrucoes'
       - 'id_transaccao_prestador') THEN
    RAISE EXCEPTION 'payments.immutable: as cópias do pagamento não mudam';
  END IF;
  IF OLD.referencia_prestador IS NOT NULL
     AND NEW.referencia_prestador IS DISTINCT FROM OLD.referencia_prestador THEN
    RAISE EXCEPTION 'payments.immutable: a referência do prestador não muda';
  END IF;
  -- O identificador da transacção no prestador (o `trid` da EuPago) grava-se
  -- uma vez, do aviso que deu o pagamento como pago (docs/30 §13, P2).
  IF OLD.id_transaccao_prestador IS NOT NULL
     AND NEW.id_transaccao_prestador IS DISTINCT FROM OLD.id_transaccao_prestador THEN
    RAISE EXCEPTION 'payments.immutable: o identificador da transacção no prestador não muda';
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

-- ------------------------------------------------------------ O reembolso

ALTER TABLE reembolso DROP CONSTRAINT reembolso_estado_check;
ALTER TABLE reembolso ADD CONSTRAINT reembolso_estado_check
  CHECK (estado IN ('rascunho', 'a_executar', 'a_pedir', 'a_confirmar', 'executado',
    'falhado', 'incerto', 'cancelado'));
ALTER TABLE reembolso ADD COLUMN pedido_em timestamptz;
ALTER TABLE reembolso ADD COLUMN pedido_por text
  CHECK (pedido_por IS NULL OR length(pedido_por) BETWEEN 1 AND 200);
ALTER TABLE reembolso ADD COLUMN referencia_prestador text
  CHECK (referencia_prestador IS NULL OR referencia_prestador ~ '^[0-9A-Za-z_-]{1,100}$');
ALTER TABLE reembolso ADD COLUMN falha text
  CHECK (falha IS NULL OR length(falha) BETWEEN 1 AND 200);
ALTER TABLE reembolso ADD COLUMN consultado_em timestamptz;
ALTER TABLE reembolso ADD CONSTRAINT reembolso_pedido_check
  CHECK (estado NOT IN ('a_pedir', 'a_confirmar') OR (via = 'prestador'
    AND pedido_em IS NOT NULL AND pedido_por IS NOT NULL));
ALTER TABLE reembolso ADD CONSTRAINT reembolso_a_confirmar_check
  CHECK (estado <> 'a_confirmar' OR referencia_prestador IS NOT NULL);
-- Executado pelo prestador: pela referência dele ou pela prova de uma pessoa.
ALTER TABLE reembolso ADD CONSTRAINT reembolso_executado_prestador_check
  CHECK (estado <> 'executado' OR via <> 'prestador'
    OR referencia_prestador IS NOT NULL OR prova IS NOT NULL);
GRANT UPDATE (pedido_em, pedido_por, referencia_prestador, falha, consultado_em)
  ON reembolso TO eurolify_api;
CREATE INDEX reembolso_no_prestador ON reembolso (comerciante_id)
  WHERE estado IN ('a_pedir', 'a_confirmar');

CREATE OR REPLACE FUNCTION reembolso_antes_de_gravar() RETURNS trigger
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
    -- A origem é desta encomenda e está no ponto certo (R1, Q3; revisão do
    -- #329, P3-3).
    IF NEW.origem = 'devolucao' AND NOT EXISTS (SELECT 1 FROM public.devolucao d
         WHERE d.id = NEW.devolucao_id AND d.encomenda_id = NEW.encomenda_id
           AND d.estado = 'inspeccionada') THEN
      RAISE EXCEPTION 'refunds.invalid_transition: a devolução não é desta encomenda ou não está inspeccionada';
    END IF;
    IF NEW.origem = 'problema' AND NOT EXISTS (SELECT 1 FROM public.problema x
         WHERE x.id = NEW.problema_id AND x.encomenda_id = NEW.encomenda_id
           AND x.estado = 'aberto') THEN
      RAISE EXCEPTION 'refunds.invalid_transition: o problema não é desta encomenda ou não está aberto';
    END IF;
    IF NEW.origem = 'cancelamento' AND NOT EXISTS (SELECT 1 FROM public.encomenda e
         WHERE e.id = NEW.encomenda_id AND e.estado = 'cancelada') THEN
      RAISE EXCEPTION 'refunds.invalid_transition: a encomenda não está cancelada';
    END IF;
    NEW.estado := 'rascunho';
    NEW.executado_em := NULL;
    NEW.decidido_por := quem;
    NEW.criado_em := now();
    NEW.versao := 1;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - 'estado' - 'prova' - 'executado_em' - 'versao' - 'via'
       - 'referencia_prestador' - 'pedido_em' - 'pedido_por' - 'falha' - 'consultado_em')
     IS DISTINCT FROM (to_jsonb(OLD) - 'estado' - 'prova' - 'executado_em' - 'versao' - 'via'
       - 'referencia_prestador' - 'pedido_em' - 'pedido_por' - 'falha' - 'consultado_em') THEN
    RAISE EXCEPTION 'refunds.immutable: o reembolso não muda (decide-se outro)';
  END IF;
  -- Executado ou anulado, nada mais muda: nem a prova, nem a via (revisão do
  -- #329, P2-6).
  IF OLD.estado IN ('executado', 'cancelado') AND to_jsonb(NEW) - 'versao' IS DISTINCT FROM to_jsonb(OLD) - 'versao' THEN
    RAISE EXCEPTION 'refunds.immutable: um reembolso % não muda', OLD.estado;
  END IF;
  -- O pedido ao prestador (docs/30 §13, P4 e P5): quem e quando, só ao
  -- passar a `a_pedir`; a referência dele, só ao passar a `a_confirmar`; o
  -- código da recusa, só ao passar a `falhado` por ele. Nunca se apagam.
  IF (NEW.pedido_em, NEW.pedido_por) IS DISTINCT FROM (OLD.pedido_em, OLD.pedido_por)
     AND NOT (OLD.estado = 'a_executar' AND NEW.estado = 'a_pedir'
              AND NEW.pedido_em IS NOT NULL AND NEW.pedido_por IS NOT NULL) THEN
    RAISE EXCEPTION 'refunds.immutable: o pedido ao prestador só se grava ao pedir';
  END IF;
  IF NEW.referencia_prestador IS DISTINCT FROM OLD.referencia_prestador
     AND NOT (OLD.estado = 'a_pedir' AND NEW.estado = 'a_confirmar'
              AND NEW.referencia_prestador IS NOT NULL) THEN
    RAISE EXCEPTION 'refunds.immutable: a referência do prestador só se grava quando ele aceita';
  END IF;
  IF NEW.falha IS DISTINCT FROM OLD.falha
     AND NOT (OLD.estado = 'a_pedir' AND NEW.estado = 'falhado' AND NEW.falha IS NOT NULL) THEN
    RAISE EXCEPTION 'refunds.immutable: o motivo da recusa só se grava quando o prestador recusa';
  END IF;
  IF NEW.estado = 'a_pedir' AND OLD.estado <> 'a_pedir' AND NEW.via <> 'prestador' THEN
    RAISE EXCEPTION 'refunds.invalid_transition: só se pede ao prestador com a via prestador';
  END IF;
  IF NEW.estado IS DISTINCT FROM OLD.estado THEN
    IF NOT (OLD.estado, NEW.estado) IN (
         ('rascunho', 'a_executar'), ('a_executar', 'executado'), ('a_executar', 'falhado'),
         ('a_executar', 'incerto'), ('incerto', 'executado'), ('incerto', 'a_executar'),
         ('falhado', 'a_executar'), ('a_executar', 'cancelado'), ('falhado', 'cancelado'),
         -- Pelo prestador (docs/30 §13): pedir, aceite ou recusado ou sem
         -- resposta; confirmado pela consulta ou por uma pessoa. Um pedido
         -- que o prestador aceitou nunca volta a `a_executar`: pedir outra
         -- vez podia reembolsar duas vezes (revisão do #350, P1-1).
         ('a_executar', 'a_pedir'), ('a_pedir', 'a_confirmar'), ('a_pedir', 'falhado'),
         ('a_pedir', 'incerto'), ('a_confirmar', 'executado')) THEN
      RAISE EXCEPTION 'refunds.invalid_transition: % → %', OLD.estado, NEW.estado;
    END IF;
    -- Anular (antes de o dinheiro sair) pede o motivo; o do cancelamento da
    -- encomenda não se anula: é sempre tudo (revisão do #329, P1-4).
    IF NEW.estado = 'cancelado' THEN
      IF nullif(btrim(current_setting('eurolify.motivo', true)), '') IS NULL THEN
        RAISE EXCEPTION 'refunds.invalid_field: anular um reembolso pede o motivo';
      END IF;
      IF NEW.origem = 'cancelamento' THEN
        RAISE EXCEPTION 'refunds.invalid_transition: o reembolso de um cancelamento não se anula';
      END IF;
    END IF;
    -- Voltar a executar o que não saiu, ou não se sabe se saiu, é de uma
    -- pessoa e pede o motivo (P7).
    IF NEW.estado = 'a_executar' AND OLD.estado = 'incerto'
       AND nullif(btrim(current_setting('eurolify.motivo', true)), '') IS NULL THEN
      RAISE EXCEPTION 'refunds.invalid_field: voltar a executar pede o motivo';
    END IF;
    -- Os tectos (R5) ao sair do rascunho e também ao voltar a `a_executar`:
    -- outro reembolso pode ter saído entretanto (P8; revisão do #329, P3-15).
    IF OLD.estado = 'rascunho' OR NEW.estado = 'a_executar' THEN
      IF OLD.estado = 'rascunho' AND NEW.montante <> (SELECT coalesce(sum(l.montante), 0)
                          FROM public.linha_reembolso l WHERE l.reembolso_id = NEW.id) THEN
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
                    AND (r2.id = NEW.id OR r2.estado IN ('a_executar', 'a_pedir', 'a_confirmar', 'executado', 'incerto')))
                 > le.total) THEN
        RAISE EXCEPTION 'refunds.exceeds_paid: uma linha ficava reembolsada acima do que se pagou';
      END IF;
      -- Nem acima da quantidade comprada (linhas repetidas incluídas;
      -- revisão do #329, P1-1), nem, numa devolução, acima do que voltou.
      IF EXISTS (
           SELECT 1 FROM public.linha_reembolso l
           JOIN public.linha_encomenda le ON le.id = l.linha_encomenda_id
           WHERE l.reembolso_id = NEW.id
             AND (SELECT coalesce(sum(l2.quantidade), 0) FROM public.linha_reembolso l2
                  JOIN public.reembolso r2 ON r2.id = l2.reembolso_id
                  WHERE l2.linha_encomenda_id = l.linha_encomenda_id
                    AND (r2.id = NEW.id OR r2.estado IN ('a_executar', 'a_pedir', 'a_confirmar', 'executado', 'incerto')))
                 > le.quantidade) THEN
        RAISE EXCEPTION 'refunds.exceeds_paid: uma linha ficava reembolsada acima da quantidade comprada';
      END IF;
      IF NEW.origem = 'devolucao' AND EXISTS (
           SELECT 1 FROM public.linha_reembolso l
           LEFT JOIN public.linha_devolucao ld ON ld.devolucao_id = NEW.devolucao_id
             AND ld.linha_encomenda_id = l.linha_encomenda_id
           WHERE l.reembolso_id = NEW.id AND l.linha_encomenda_id IS NOT NULL
           GROUP BY l.linha_encomenda_id, ld.recebida
           HAVING sum(l.quantidade) > coalesce(ld.recebida, 0)) THEN
        RAISE EXCEPTION 'refunds.exceeds_paid: não se reembolsa mais do que voltou';
      END IF;
      SELECT p.montante INTO pago FROM public.pagamento p WHERE p.id = NEW.pagamento_id FOR UPDATE;
      SELECT coalesce(sum(r.montante), 0) INTO ja FROM public.reembolso r
      WHERE r.pagamento_id = NEW.pagamento_id AND r.id <> NEW.id
        AND r.estado IN ('a_executar', 'a_pedir', 'a_confirmar', 'executado', 'incerto');
      IF ja + NEW.montante > pago THEN
        RAISE EXCEPTION 'refunds.exceeds_paid: reembolsos % mais % passam o pago %', ja, NEW.montante, pago;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION pos_venda_evento() RETURNS trigger
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
    WHEN 'problema' THEN CASE NEW.estado
      WHEN 'aberto' THEN CASE WHEN TG_OP = 'INSERT' THEN 'problem.created' ELSE 'problem.reopened' END
      WHEN 'decidido' THEN 'problem.decided' ELSE 'problem.closed' END
    WHEN 'reembolso' THEN CASE NEW.estado WHEN 'a_executar' THEN 'refund.created'
      WHEN 'executado' THEN 'refund.completed' WHEN 'falhado' THEN 'refund.failed'
      WHEN 'incerto' THEN 'refund.uncertain' WHEN 'cancelado' THEN 'refund.cancelled'
      -- Aceite pelo prestador, à espera da confirmação; o `a_pedir` dura só
      -- a chamada e não sai (docs/30 §13, P9).
      WHEN 'a_confirmar' THEN 'refund.requested' END
  END;
  IF t IS NULL THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.evento_saida (comerciante_id, tipo, agregado_tipo, agregado_id, dados)
  VALUES (NEW.comerciante_id, t, TG_TABLE_NAME, NEW.id,
    jsonb_build_object('id', NEW.id, 'encomenda_id', NEW.encomenda_id, 'estado', NEW.estado,
      'em', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
    -- O reembolso leva o montante e as linhas (identificadores e montantes,
    -- nunca o IBAN): é o que o sistema próprio do comerciante precisa para
    -- emitir a NC (docs/30 §3.5; revisão do #329, P2-8).
    || CASE WHEN TG_TABLE_NAME = 'reembolso' THEN jsonb_build_object(
         'montante', (to_jsonb(NEW)->>'montante')::bigint, 'moeda', to_jsonb(NEW)->>'moeda',
         'linhas', (SELECT coalesce(jsonb_agg(jsonb_build_object(
             'linha_encomenda_id', l.linha_encomenda_id, 'quantidade', l.quantidade,
             'montante', l.montante) ORDER BY l.posicao), '[]'::jsonb)
           FROM public.linha_reembolso l WHERE l.reembolso_id = NEW.id))
       ELSE '{}'::jsonb END);
  RETURN NULL;
END
$$;

-- ------------------------------------------- A fila de diferenças e a tarefa

ALTER TABLE diferenca_pagamento DROP CONSTRAINT diferenca_pagamento_motivo_check;
ALTER TABLE diferenca_pagamento ADD CONSTRAINT diferenca_pagamento_motivo_check
  CHECK (motivo IN ('incerto', 'aviso_sem_pagamento',
    'montante_diferente', 'moeda_diferente', 'transicao_impossivel',
    'pago_depois_de_cancelada', 'pagamento_duplicado',
    -- Os reembolsos pelo prestador (docs/30 §13): sem resposta (P5, P7), sem
    -- confirmação ao fim de 7 dias (P6), ou um aviso de reembolso que o
    -- Eurolify não pediu.
    'reembolso_incerto', 'reembolso_por_confirmar', 'reembolso_desconhecido'));

-- Os reembolsos no prestador a olhar (os `a_pedir`, uma chamada que pode ter
-- ficado a meio, e os `a_confirmar`): uma tabela interna, como a
-- tarefa_pagamento da 0044, que só o gatilho escreve. O reembolso tem o RLS
-- forçado e a tarefa corre sem comerciante: a função devolve os comerciantes
-- com trabalho, e a API lê os reembolsos já dentro de cada um.
CREATE TABLE tarefa_reembolso (
  reembolso_id uuid PRIMARY KEY,
  comerciante_id uuid NOT NULL REFERENCES comerciante (id)
);
ALTER TABLE tarefa_reembolso ENABLE ROW LEVEL SECURITY;
CREATE POLICY so_o_proprio ON tarefa_reembolso
  USING (comerciante_id = comerciante_actual())
  WITH CHECK (comerciante_id = comerciante_actual());
REVOKE ALL ON tarefa_reembolso FROM PUBLIC;

CREATE FUNCTION reembolso_tarefa() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.estado IN ('a_pedir', 'a_confirmar') THEN
    INSERT INTO public.tarefa_reembolso (reembolso_id, comerciante_id)
    VALUES (NEW.id, NEW.comerciante_id) ON CONFLICT (reembolso_id) DO NOTHING;
  ELSE
    DELETE FROM public.tarefa_reembolso WHERE reembolso_id = NEW.id;
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER reembolso_tarefa AFTER UPDATE OF estado ON reembolso
  FOR EACH ROW EXECUTE FUNCTION reembolso_tarefa();
-- Como os outros gatilhos do reembolso (revisão do #350, P3).
ALTER TABLE reembolso ENABLE ALWAYS TRIGGER reembolso_tarefa;

CREATE FUNCTION posvenda_comerciantes_com_reembolsos() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT DISTINCT t.comerciante_id FROM public.tarefa_reembolso t
$$;
REVOKE EXECUTE ON FUNCTION reembolso_tarefa(), posvenda_comerciantes_com_reembolsos()
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION posvenda_comerciantes_com_reembolsos() TO eurolify_api;
