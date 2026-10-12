-- Documentos fiscais: a saída «emitida fora do Eurolify» (docs/29 §15;
-- docs/06, EA; issue #310; revisão do #312, P2-1).
--
-- Uma encomenda paga antes de a entidade escolher quem emite, cuja entidade
-- escolheu depois o sistema próprio (ADR-0041), tinha o pedido de fatura
-- retido para sempre. O dono leva-o a um estado final, `fora`, com o número
-- do documento no sistema próprio **declarado** (não é prova). A NC já
-- pedida para essa fatura vai com ela, e um reembolso depois não pede NC.

SET LOCAL lock_timeout = '10s';

ALTER TABLE documento_fiscal DROP CONSTRAINT documento_fiscal_estado_check;
ALTER TABLE documento_fiscal ADD CONSTRAINT documento_fiscal_estado_check
  CHECK (estado IN ('a_verificar', 'retido', 'pronto', 'rascunho', 'emitido', 'incerto',
    'divergente', 'resolvido', 'fora'));

-- O número declarado (F3): só num pedido `fora`; obrigatório na fatura. A NC
-- que sai com a fatura não tem número declarado — ninguém o declarou, e o da
-- fatura não é o dela (revisão do #386, P2-2). Sem quebras de linha (P3).
ALTER TABLE documento_fiscal ADD COLUMN fora_numero text
  CHECK (fora_numero IS NULL OR fora_numero ~ '^[^\s]([^\r\n]{0,58}[^\s])?$');
ALTER TABLE documento_fiscal ADD CONSTRAINT documento_fiscal_fora_com_numero
  CHECK ((fora_numero IS NULL OR estado = 'fora')
         AND (estado <> 'fora' OR tipo = 'nota_credito' OR fora_numero IS NOT NULL));

-- A máquina de estados de 0058, com `fora`: só a partir do caso exacto da
-- §15 (F2), final (F4) e sem identificador do emissor.
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
    IF NEW.tipo = 'nota_credito' AND (NEW.reembolso_id IS NULL OR NOT EXISTS (
         SELECT 1 FROM public.documento_fiscal o
         WHERE o.id = NEW.original_id AND o.tipo = 'fatura' AND o.encomenda_id = NEW.encomenda_id)) THEN
      RAISE EXCEPTION 'invoices.invalid_field: a nota de crédito precisa da fatura da encomenda e do reembolso';
    END IF;
    -- A fatura emitida fora: a NC é do sistema próprio (F5). A fatura
    -- tranca-se (FOR SHARE): quem a está a marcar `fora` ao mesmo tempo
    -- termina primeiro, e o estado lê-se já confirmado (revisão do #386,
    -- P2-1).
    IF NEW.tipo = 'nota_credito' AND EXISTS (
         SELECT 1 FROM public.documento_fiscal o WHERE o.id = NEW.original_id AND o.estado = 'fora'
         FOR SHARE) THEN
      RAISE EXCEPTION 'invoices.other_issuer: a fatura desta encomenda foi emitida fora do Eurolify';
    END IF;
    NEW.entidade_legal_id := e.entidade_legal_id;
    NEW.estado := 'a_verificar';
    NEW.motivos := '{}';
    NEW.validados := '{}';
    NEW.ligacao_id := NULL;
    NEW.emissor_id := NULL;
    NEW.fora_numero := NULL;
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
  -- `fora` é final (F4): nada muda depois, nem o número declarado.
  IF OLD.estado = 'fora' THEN
    RAISE EXCEPTION 'invoices.immutable: um documento emitido fora do Eurolify não muda';
  END IF;
  IF NEW.estado IS DISTINCT FROM OLD.estado THEN
    IF NOT (OLD.estado, NEW.estado) IN (
         ('a_verificar', 'retido'), ('a_verificar', 'pronto'),
         ('retido', 'a_verificar'),
         ('pronto', 'rascunho'), ('pronto', 'retido'), ('pronto', 'incerto'),
         ('rascunho', 'emitido'), ('rascunho', 'retido'), ('rascunho', 'incerto'),
         ('incerto', 'emitido'), ('incerto', 'pronto'), ('incerto', 'rascunho'), ('incerto', 'retido'),
         ('emitido', 'divergente'), ('divergente', 'resolvido'),
         ('retido', 'fora'), ('a_verificar', 'fora')) THEN
      RAISE EXCEPTION 'invoices.invalid_transition: % → %', OLD.estado, NEW.estado;
    END IF;
    IF NEW.estado IN ('emitido', 'divergente') AND NOT EXISTS (
         SELECT 1 FROM public.documento_prova p WHERE p.documento_id = NEW.id) THEN
      RAISE EXCEPTION 'invoices.invalid_transition: emitido só com a prova lida do emissor';
    END IF;
    IF NEW.estado IN ('rascunho', 'emitido') AND NEW.emissor_id IS NULL THEN
      RAISE EXCEPTION 'invoices.invalid_transition: % sem o identificador do emissor', NEW.estado;
    END IF;
    IF NEW.estado = 'fora' THEN
      -- Nunca foi ao emissor do Eurolify: sem identificador e sem prova
      -- (revisão do #386, P3).
      IF NEW.emissor_id IS NOT NULL OR EXISTS (
           SELECT 1 FROM public.documento_prova p WHERE p.documento_id = NEW.id) THEN
        RAISE EXCEPTION 'invoices.invalid_transition: um documento emitido fora não foi ao emissor do Eurolify';
      END IF;
      IF NEW.tipo = 'fatura' THEN
        -- F2: retida por quem emite, numa encomenda paga antes da escolha,
        -- cuja entidade escolheu depois o sistema próprio.
        SELECT x.emissor_fiscal AS encomenda, l.emissor_fiscal AS entidade INTO e
        FROM public.encomenda x JOIN public.entidade_legal l ON l.id = x.entidade_legal_id
        WHERE x.id = NEW.encomenda_id;
        IF e IS NULL OR OLD.estado <> 'retido' OR NOT 'emissor_por_configurar' = ANY (OLD.motivos)
           OR e.encomenda <> 'por_configurar' OR e.entidade <> 'sistema_proprio'
           OR NEW.fora_numero IS NULL THEN
          RAISE EXCEPTION 'invoices.invalid_transition: só uma fatura retida por quem emite, de uma encomenda paga antes da escolha, cuja entidade emite no sistema próprio';
        END IF;
      ELSIF NOT EXISTS (SELECT 1 FROM public.documento_fiscal o
                        WHERE o.id = NEW.original_id AND o.estado = 'fora') THEN
        -- F5: a NC só vai para fora com a fatura dela.
        RAISE EXCEPTION 'invoices.invalid_transition: a nota de crédito só sai fora com a fatura';
      END IF;
    END IF;
  END IF;
  IF NEW.estado <> 'retido' THEN
    NEW.motivos := CASE WHEN NEW.estado = 'incerto' THEN NEW.motivos ELSE '{}' END;
  END IF;
  NEW.actualizado_em := now();
  RETURN NEW;
END
$$;

-- F5: um reembolso de uma encomenda cuja fatura saiu fora não pede NC.
CREATE OR REPLACE FUNCTION nota_credito_pedir(p_reembolso uuid) RETURNS uuid
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
  -- FOR SHARE: espera por quem estiver a marcar a fatura `fora` (revisão do
  -- #386, P2-1).
  SELECT d.id, d.entidade_legal_id, d.modo, d.estado INTO f FROM public.documento_fiscal d
  WHERE d.encomenda_id = r.encomenda_id AND d.tipo = 'fatura'
  FOR SHARE;
  IF f IS NULL OR f.estado = 'fora' THEN
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

-- O rasto e os eventos de 0050, com `invoice.issued_elsewhere` (F6).
CREATE OR REPLACE FUNCTION documento_fiscal_rasto() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.estado IS NOT DISTINCT FROM OLD.estado THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.documento_rasto (documento_id, comerciante_id, passo, de, para, motivo, quem, dados)
  VALUES (NEW.id, NEW.comerciante_id, 'estado',
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.estado END, NEW.estado,
    nullif(btrim(current_setting('eurolify.motivo', true)), ''),
    coalesce(nullif(btrim(current_setting('eurolify.quem', true)), ''), 'sistema:documentos'),
    jsonb_build_object('motivos', to_jsonb(NEW.motivos))
      || CASE WHEN NEW.estado = 'fora'
              THEN jsonb_build_object('numero_declarado', NEW.fora_numero)
              ELSE '{}'::jsonb END);
  INSERT INTO public.evento_saida (comerciante_id, tipo, agregado_tipo, agregado_id, dados)
  SELECT NEW.comerciante_id, t, 'documento_fiscal', NEW.id,
    jsonb_build_object('documento_id', NEW.id, 'encomenda_id', NEW.encomenda_id,
      'estado', NEW.estado, 'modo', NEW.modo, 'tipo', NEW.tipo,
      'em', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
  FROM (SELECT CASE NEW.estado
      WHEN 'a_verificar' THEN CASE WHEN TG_OP = 'INSERT' THEN 'invoice.requested' END
      WHEN 'retido' THEN 'invoice.held'
      WHEN 'emitido' THEN 'invoice.issued'
      WHEN 'incerto' THEN 'invoice.uncertain'
      WHEN 'divergente' THEN 'invoice.discrepancy'
      WHEN 'resolvido' THEN 'invoice.resolved'
      WHEN 'fora' THEN 'invoice.issued_elsewhere'
    END AS t) x
  WHERE t IS NOT NULL;
  RETURN NULL;
END
$$;

GRANT UPDATE (fora_numero) ON documento_fiscal TO eurolify_api;
