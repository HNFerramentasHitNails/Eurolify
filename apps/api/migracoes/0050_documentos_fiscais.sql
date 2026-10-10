-- Documentos fiscais, parte 1 (docs/28; issue #310; decisão do Diogo,
-- 10/10/2026: «sim, aprovo; avança com o código da fatia 10»).
--
-- O documento é emitido pelo software certificado do comerciante, por
-- adaptador (ADR-0037); com sistema de gestão próprio, emite o sistema dele e
-- o Eurolify não pede documento nenhum (ADR-0041). Nesta parte só há o
-- adaptador de ensaio (Q5): nenhum documento real sai.
--
-- O que esta migração faz:
-- - `emissor_fiscal` na entidade legal e na encomenda (copiado no botão
--   final, imutável); a base recusa um documento numa encomenda com
--   `sistema_proprio` (R1);
-- - `ligacao_faturacao` (`isx_`): adaptador, modo (só teste), credenciais
--   cifradas, série, mapas de taxas e de isenções;
-- - `documento_fiscal` (`inv_`): nasce quando a encomenda fica paga, com os
--   estados da §4; `documento_conteudo` (versões, só se acrescentam),
--   `documento_prova` (`ivp_`, só se acrescenta) e `documento_rasto`;
-- - os eventos `invoice.*`, as funções da tarefa e a marca de perfil usado
--   num documento, também numa ficha fundida (R12);
-- - os âmbitos `invoices:read`, `invoices:write`, `invoices:accounts`.

SET LOCAL lock_timeout = '10s';

-- ------------------------------------------------------- Quem emite (§3.1)

ALTER TABLE entidade_legal ADD COLUMN emissor_fiscal text NOT NULL DEFAULT 'por_configurar'
  CHECK (emissor_fiscal IN ('por_configurar', 'eurolify', 'sistema_proprio'));
ALTER TABLE encomenda ADD COLUMN emissor_fiscal text NOT NULL DEFAULT 'por_configurar'
  CHECK (emissor_fiscal IN ('por_configurar', 'eurolify', 'sistema_proprio'));

-- O emissor copia-se da entidade no botão final e não muda (ADR-0041: uma
-- venda nunca tem os dois emissores; Q6).
CREATE FUNCTION encomenda_emissor_fiscal() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT e.emissor_fiscal INTO NEW.emissor_fiscal FROM public.entidade_legal e
    WHERE e.comerciante_id = NEW.comerciante_id AND e.id = NEW.entidade_legal_id;
    NEW.emissor_fiscal := coalesce(NEW.emissor_fiscal, 'por_configurar');
  ELSIF NEW.emissor_fiscal IS DISTINCT FROM OLD.emissor_fiscal THEN
    RAISE EXCEPTION 'orders.immutable: o emissor do documento fiscal de uma encomenda não muda';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER encomenda_emissor_fiscal BEFORE INSERT OR UPDATE ON encomenda
  FOR EACH ROW EXECUTE FUNCTION encomenda_emissor_fiscal();
ALTER TABLE encomenda ENABLE ALWAYS TRIGGER encomenda_emissor_fiscal;

-- ------------------------------------------------ A ligação ao emissor (§3.2)

CREATE TABLE ligacao_faturacao (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  entidade_legal_id uuid NOT NULL,
  adaptador text NOT NULL CHECK (adaptador IN ('ensaio', 'moloni')),
  -- Abrir o modo real é uma migração com decisão escrita (como os
  -- pagamentos, 0044); o adaptador de ensaio nunca o terá (R14).
  modo text NOT NULL DEFAULT 'teste' CHECK (modo = 'teste'),
  estado text NOT NULL DEFAULT 'por_testar' CHECK (estado IN ('por_testar', 'pronta', 'com_erro')),
  activa boolean NOT NULL DEFAULT true,
  credenciais bytea,
  credenciais_versao_chave text,
  credenciais_em timestamptz,
  credenciais_por text,
  serie text CHECK (serie IS NULL OR serie ~ '^[A-Za-z0-9._/-]{1,40}$'),
  -- [{pais, taxa (centésimas de ponto), emissor}]: um par país-taxa por linha
  -- (eu-vat-oss-ioss, regra 7; lição 2.7).
  taxas jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(taxas) = 'array'),
  -- [{codigo, emissor}]: o código do motivo (M05, M16…) para a isenção do emissor.
  isencoes jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(isencoes) = 'array'),
  testada_em timestamptz,
  erro text,
  versao integer NOT NULL DEFAULT 1,
  criada_por text NOT NULL,
  criada_em timestamptz NOT NULL DEFAULT now(),
  actualizada_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (comerciante_id, id),
  FOREIGN KEY (comerciante_id, entidade_legal_id) REFERENCES entidade_legal (comerciante_id, id)
);
CREATE UNIQUE INDEX ligacao_faturacao_uma_activa ON ligacao_faturacao (entidade_legal_id) WHERE activa;

-- Um par (país, taxa) aparece uma vez; um código de isenção também.
CREATE FUNCTION ligacao_faturacao_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'invoices.immutable: uma ligação não se apaga; desliga-se';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.taxas) t
       WHERE jsonb_typeof(t) <> 'object' OR t->>'pais' !~ '^[A-Z]{2}$'
         OR jsonb_typeof(t->'taxa') <> 'number' OR (t->>'taxa')::numeric < 0
         OR coalesce(t->>'emissor', '') !~ '^[A-Za-z0-9._:-]{1,60}$')
     OR (SELECT count(*) FROM jsonb_array_elements(NEW.taxas))
       <> (SELECT count(DISTINCT (t->>'pais', t->>'taxa')) FROM jsonb_array_elements(NEW.taxas) t) THEN
    RAISE EXCEPTION 'invoices.invalid_field: as taxas são pares (país, taxa) únicos com a taxa do emissor';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.isencoes) t
       WHERE jsonb_typeof(t) <> 'object' OR t->>'codigo' !~ '^[A-Z0-9]{1,10}$'
         OR coalesce(t->>'emissor', '') !~ '^[A-Za-z0-9._:-]{1,60}$')
     OR (SELECT count(*) FROM jsonb_array_elements(NEW.isencoes))
       <> (SELECT count(DISTINCT t->>'codigo') FROM jsonb_array_elements(NEW.isencoes) t) THEN
    RAISE EXCEPTION 'invoices.invalid_field: as isenções são códigos únicos com a isenção do emissor';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.entidade_legal_id <> OLD.entidade_legal_id OR NEW.adaptador <> OLD.adaptador
       OR NEW.modo <> OLD.modo OR NEW.criada_por <> OLD.criada_por THEN
      RAISE EXCEPTION 'invoices.immutable: a entidade, o adaptador e o modo de uma ligação não mudam';
    END IF;
    -- Com documentos a meio no emissor, a ligação não muda (R15).
    IF (NEW.credenciais IS DISTINCT FROM OLD.credenciais OR NEW.serie IS DISTINCT FROM OLD.serie
        OR NEW.taxas <> OLD.taxas OR NEW.isencoes <> OLD.isencoes OR NEW.activa <> OLD.activa)
       AND EXISTS (SELECT 1 FROM public.documento_fiscal d
         WHERE d.ligacao_id = NEW.id AND d.estado IN ('rascunho', 'incerto')) THEN
      RAISE EXCEPTION 'invoices.issuer_busy: há documentos a meio no emissor desta ligação';
    END IF;
    -- Mudar as credenciais, a série ou os mapas obriga a testar outra vez.
    IF NEW.credenciais IS DISTINCT FROM OLD.credenciais OR NEW.serie IS DISTINCT FROM OLD.serie
       OR NEW.taxas <> OLD.taxas OR NEW.isencoes <> OLD.isencoes THEN
      IF NEW.estado = 'pronta' AND OLD.estado = 'pronta' THEN
        NEW.estado := 'por_testar';
      END IF;
    END IF;
    NEW.criada_em := OLD.criada_em;
    NEW.actualizada_em := now();
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER ligacao_faturacao_antes_de_gravar BEFORE INSERT OR UPDATE OR DELETE ON ligacao_faturacao
  FOR EACH ROW EXECUTE FUNCTION ligacao_faturacao_antes_de_gravar();
ALTER TABLE ligacao_faturacao ENABLE ALWAYS TRIGGER ligacao_faturacao_antes_de_gravar;

-- ----------------------------------------------- O pedido de documento (§3.3)

CREATE TABLE documento_fiscal (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  encomenda_id uuid NOT NULL,
  entidade_legal_id uuid NOT NULL,
  -- A nota de crédito fica para a fatia 11 (§3.6).
  tipo text NOT NULL DEFAULT 'fatura' CHECK (tipo = 'fatura'),
  modo text NOT NULL CHECK (modo = 'teste'),
  estado text NOT NULL DEFAULT 'a_verificar' CHECK (estado IN ('a_verificar', 'retido', 'pronto',
    'rascunho', 'emitido', 'incerto', 'divergente', 'resolvido')),
  motivos text[] NOT NULL DEFAULT '{}',
  -- Os motivos libertados à mão para este pedido (R9): não voltam a reter.
  validados text[] NOT NULL DEFAULT '{}',
  ligacao_id uuid,
  emissor_id text CHECK (emissor_id IS NULL OR length(emissor_id) BETWEEN 1 AND 100),
  tentativas integer NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
  proxima_em timestamptz NOT NULL DEFAULT now(),
  versao integer NOT NULL DEFAULT 1,
  criado_em timestamptz NOT NULL DEFAULT now(),
  actualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (comerciante_id, id),
  -- Uma fatura por encomenda (lição 4.4).
  UNIQUE (encomenda_id, tipo),
  CHECK (estado <> 'retido' OR cardinality(motivos) > 0),
  FOREIGN KEY (comerciante_id, encomenda_id) REFERENCES encomenda (comerciante_id, id),
  FOREIGN KEY (comerciante_id, entidade_legal_id) REFERENCES entidade_legal (comerciante_id, id),
  FOREIGN KEY (comerciante_id, ligacao_id) REFERENCES ligacao_faturacao (comerciante_id, id)
);
CREATE INDEX documento_fiscal_a_tratar ON documento_fiscal (comerciante_id, proxima_em)
  WHERE estado IN ('a_verificar', 'pronto', 'rascunho', 'incerto');

CREATE TABLE documento_conteudo (
  documento_id uuid NOT NULL,
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  versao integer NOT NULL CHECK (versao >= 1),
  conteudo jsonb NOT NULL CHECK (jsonb_typeof(conteudo) = 'object'),
  impressao text NOT NULL CHECK (impressao ~ '^[0-9a-f]{64}$'),
  motivo text NOT NULL CHECK (length(motivo) BETWEEN 1 AND 500),
  quem text NOT NULL,
  em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (documento_id, versao),
  FOREIGN KEY (comerciante_id, documento_id) REFERENCES documento_fiscal (comerciante_id, id)
);

CREATE TABLE documento_prova (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  documento_id uuid NOT NULL UNIQUE,
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  -- Como o emissor os devolve; nunca os inventamos (§3.4).
  numero text NOT NULL CHECK (length(numero) BETWEEN 1 AND 100),
  serie text,
  data date,
  atcud text,
  nif text,
  nome text,
  pais text,
  linhas jsonb NOT NULL CHECK (jsonb_typeof(linhas) = 'array'),
  totais jsonb NOT NULL CHECK (jsonb_typeof(totais) = 'object'),
  pdf bytea,
  em_bruto jsonb NOT NULL,
  divergencias jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(divergencias) = 'array'),
  lida_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (comerciante_id, id),
  FOREIGN KEY (comerciante_id, documento_id) REFERENCES documento_fiscal (comerciante_id, id)
);

CREATE TABLE documento_rasto (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  documento_id uuid NOT NULL,
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  passo text NOT NULL CHECK (passo ~ '^[a-z_]{2,40}$'),
  de text,
  para text,
  motivo text CHECK (motivo IS NULL OR length(motivo) BETWEEN 1 AND 500),
  quem text NOT NULL,
  dados jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(dados) = 'object'),
  em timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (comerciante_id, documento_id) REFERENCES documento_fiscal (comerciante_id, id)
);
CREATE INDEX documento_rasto_por_documento ON documento_rasto (documento_id, em);

-- O conteúdo, a prova e o rasto só se acrescentam (regra 3).
CREATE TRIGGER documento_conteudo_so_se_acrescenta BEFORE UPDATE OR DELETE ON documento_conteudo
  FOR EACH ROW EXECUTE FUNCTION rasto_so_se_acrescenta();
CREATE TRIGGER documento_prova_so_se_acrescenta BEFORE UPDATE OR DELETE ON documento_prova
  FOR EACH ROW EXECUTE FUNCTION rasto_so_se_acrescenta();
CREATE TRIGGER documento_rasto_so_se_acrescenta BEFORE UPDATE OR DELETE ON documento_rasto
  FOR EACH ROW EXECUTE FUNCTION rasto_so_se_acrescenta();
CREATE TRIGGER documento_conteudo_sem_truncate BEFORE TRUNCATE ON documento_conteudo
  FOR EACH STATEMENT EXECUTE FUNCTION rasto_so_se_acrescenta();
CREATE TRIGGER documento_prova_sem_truncate BEFORE TRUNCATE ON documento_prova
  FOR EACH STATEMENT EXECUTE FUNCTION rasto_so_se_acrescenta();
CREATE TRIGGER documento_rasto_sem_truncate BEFORE TRUNCATE ON documento_rasto
  FOR EACH STATEMENT EXECUTE FUNCTION rasto_so_se_acrescenta();
CREATE TRIGGER documento_fiscal_sem_truncate BEFORE TRUNCATE ON documento_fiscal
  FOR EACH STATEMENT EXECUTE FUNCTION rasto_so_se_acrescenta();
ALTER TABLE documento_conteudo ENABLE ALWAYS TRIGGER documento_conteudo_so_se_acrescenta;
ALTER TABLE documento_prova ENABLE ALWAYS TRIGGER documento_prova_so_se_acrescenta;
ALTER TABLE documento_rasto ENABLE ALWAYS TRIGGER documento_rasto_so_se_acrescenta;
ALTER TABLE documento_conteudo ENABLE ALWAYS TRIGGER documento_conteudo_sem_truncate;
ALTER TABLE documento_prova ENABLE ALWAYS TRIGGER documento_prova_sem_truncate;
ALTER TABLE documento_rasto ENABLE ALWAYS TRIGGER documento_rasto_sem_truncate;
ALTER TABLE documento_fiscal ENABLE ALWAYS TRIGGER documento_fiscal_sem_truncate;

-- Os estados só andam pelos caminhos da §4.1; a encomenda, a entidade, o tipo
-- e o modo não mudam; um pedido nunca se apaga; com `sistema_proprio` não
-- nasce (R1); `emitido` só com a prova lida.
CREATE FUNCTION documento_fiscal_antes_de_gravar() RETURNS trigger
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
    NEW.entidade_legal_id := e.entidade_legal_id;
    NEW.estado := 'a_verificar';
    NEW.motivos := '{}';
    NEW.validados := '{}';
    NEW.ligacao_id := NULL;
    NEW.emissor_id := NULL;
    NEW.tentativas := 0;
    NEW.versao := 1;
    NEW.criado_em := now();
    NEW.actualizado_em := now();
    RETURN NEW;
  END IF;
  IF NEW.encomenda_id <> OLD.encomenda_id OR NEW.entidade_legal_id <> OLD.entidade_legal_id
     OR NEW.tipo <> OLD.tipo OR NEW.modo <> OLD.modo OR NEW.criado_em <> OLD.criado_em THEN
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
CREATE TRIGGER documento_fiscal_antes_de_gravar BEFORE INSERT OR UPDATE OR DELETE ON documento_fiscal
  FOR EACH ROW EXECUTE FUNCTION documento_fiscal_antes_de_gravar();
ALTER TABLE documento_fiscal ENABLE ALWAYS TRIGGER documento_fiscal_antes_de_gravar;

-- Cada mudança de estado fica no rasto, com quem e o motivo da sessão.
CREATE FUNCTION documento_fiscal_rasto() RETURNS trigger
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
    jsonb_build_object('motivos', to_jsonb(NEW.motivos)));
  INSERT INTO public.evento_saida (comerciante_id, tipo, agregado_tipo, agregado_id, dados)
  SELECT NEW.comerciante_id, t, 'documento_fiscal', NEW.id,
    jsonb_build_object('documento_id', NEW.id, 'encomenda_id', NEW.encomenda_id,
      'estado', NEW.estado, 'modo', NEW.modo,
      'em', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
  FROM (SELECT CASE NEW.estado
      WHEN 'a_verificar' THEN CASE WHEN TG_OP = 'INSERT' THEN 'invoice.requested' END
      WHEN 'retido' THEN 'invoice.held'
      WHEN 'emitido' THEN 'invoice.issued'
      WHEN 'incerto' THEN 'invoice.uncertain'
      WHEN 'divergente' THEN 'invoice.discrepancy'
      WHEN 'resolvido' THEN 'invoice.resolved'
    END AS t) x
  WHERE t IS NOT NULL;
  RETURN NULL;
END
$$;
CREATE TRIGGER documento_fiscal_rasto AFTER INSERT OR UPDATE OF estado ON documento_fiscal
  FOR EACH ROW EXECUTE FUNCTION documento_fiscal_rasto();
ALTER TABLE documento_fiscal ENABLE ALWAYS TRIGGER documento_fiscal_rasto;

-- A prova só se grava num pedido que foi ao emissor.
CREATE FUNCTION documento_prova_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.documento_fiscal d
       WHERE d.id = NEW.documento_id AND d.comerciante_id = NEW.comerciante_id
         AND d.estado IN ('rascunho', 'incerto')) THEN
    RAISE EXCEPTION 'invoices.invalid_transition: a prova só se grava num pedido em rascunho ou incerto';
  END IF;
  NEW.lida_em := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER documento_prova_antes_de_gravar BEFORE INSERT ON documento_prova
  FOR EACH ROW EXECUTE FUNCTION documento_prova_antes_de_gravar();
ALTER TABLE documento_prova ENABLE ALWAYS TRIGGER documento_prova_antes_de_gravar;

-- O pedido nasce quando a encomenda fica paga (R1; Q2), salvo com sistema
-- próprio. O modo vem do pagamento capturado (docs/26, R9).
CREATE FUNCTION encomenda_pede_documento() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.estado = 'paga' AND OLD.estado IS DISTINCT FROM 'paga'
     AND NEW.emissor_fiscal <> 'sistema_proprio' THEN
    INSERT INTO public.documento_fiscal (comerciante_id, encomenda_id, entidade_legal_id, modo)
    SELECT NEW.comerciante_id, NEW.id, NEW.entidade_legal_id, p.modo
    FROM public.pagamento p
    WHERE p.encomenda_id = NEW.id AND p.estado = 'capturado'
    ORDER BY p.id LIMIT 1
    ON CONFLICT (encomenda_id, tipo) DO NOTHING;
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER encomenda_pede_documento AFTER UPDATE OF estado ON encomenda
  FOR EACH ROW EXECUTE FUNCTION encomenda_pede_documento();
ALTER TABLE encomenda ENABLE ALWAYS TRIGGER encomenda_pede_documento;

-- ------------------------------------------------------------- A tarefa (R11)

-- A fila da tarefa é interna (RLS sem FORÇAR, como a tarefa_encomenda da
-- 0047): só os gatilhos e as funções do dono lhe tocam.
CREATE TABLE tarefa_documento (
  documento_id uuid PRIMARY KEY,
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  quando timestamptz NOT NULL
);
CREATE INDEX tarefa_documento_quando ON tarefa_documento (quando);
ALTER TABLE tarefa_documento ENABLE ROW LEVEL SECURITY;
CREATE POLICY so_o_proprio ON tarefa_documento
  USING (comerciante_id = comerciante_actual())
  WITH CHECK (comerciante_id = comerciante_actual());
REVOKE ALL ON tarefa_documento FROM PUBLIC;

CREATE FUNCTION documento_fiscal_tarefa() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.estado IN ('a_verificar', 'pronto', 'rascunho', 'incerto') THEN
    INSERT INTO public.tarefa_documento (documento_id, comerciante_id, quando)
    VALUES (NEW.id, NEW.comerciante_id, NEW.proxima_em)
    ON CONFLICT (documento_id) DO UPDATE SET quando = EXCLUDED.quando;
  ELSE
    DELETE FROM public.tarefa_documento WHERE documento_id = NEW.id;
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER documento_fiscal_tarefa AFTER INSERT OR UPDATE OF estado, proxima_em ON documento_fiscal
  FOR EACH ROW EXECUTE FUNCTION documento_fiscal_tarefa();
ALTER TABLE documento_fiscal ENABLE ALWAYS TRIGGER documento_fiscal_tarefa;

CREATE FUNCTION documentos_comerciantes_com_trabalho() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT DISTINCT t.comerciante_id FROM public.tarefa_documento t WHERE t.quando <= now()
$$;

CREATE FUNCTION documentos_a_tratar(p_limite integer) RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT t.documento_id FROM public.tarefa_documento t
  WHERE t.comerciante_id = public.comerciante_actual() AND t.quando <= now()
  ORDER BY t.quando, t.documento_id
  LIMIT greatest(p_limite, 0)
$$;

-- --------------------------------------------- O perfil usado num documento

CREATE OR REPLACE FUNCTION perfil_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  estado_da_ficha text;
  regua record;
  pais_comerciante text;
BEGIN
  -- A pseudonimização (0049) limpa os perfis não usados em documentos, também
  -- nas fichas fundidas no grupo; nunca toca num perfil usado (R9).
  IF TG_OP = 'UPDATE' AND public.clientes_pseudonimizacao_em_curso() THEN
    IF NEW.id <> OLD.id OR NEW.comerciante_id <> OLD.comerciante_id
       OR NEW.cliente_id <> OLD.cliente_id THEN
      RAISE EXCEPTION 'customers.immutable_identity: o id, o comerciante e a ficha de um perfil não mudam';
    END IF;
    IF OLD.usado_em_documento THEN
      RAISE EXCEPTION 'customers.profile_used: um perfil usado num documento fica o prazo fiscal (R9)';
    END IF;
    NEW.nif_numero := NULL;
    NEW.estado_vies := 'nao_aplicavel';
    NEW.criado_em := OLD.criado_em;
    NEW.actualizado_em := now();
    NEW.versao := OLD.versao + 1;
    RETURN NEW;
  END IF;

  -- A ficha tem de se ver (RLS) e estar activa; tomá-la serializa os perfis
  -- dela (o principal do primeiro perfil, os arquivos).
  SELECT c.estado INTO estado_da_ficha FROM public.cliente c
  WHERE c.comerciante_id = NEW.comerciante_id AND c.id = NEW.cliente_id
  FOR UPDATE;
  IF estado_da_ficha IS NULL THEN
    RAISE EXCEPTION 'customers.not_found: a ficha não existe';
  END IF;
  -- A única mudança aceite num perfil de uma ficha que já não está activa
  -- (fundida): a marca de usado num documento, de falso para verdadeiro
  -- (docs/23 §12; docs/28, R12). O resto do perfil fica igual.
  IF estado_da_ficha <> 'activo' AND NOT (
       TG_OP = 'UPDATE' AND NEW.usado_em_documento AND NOT OLD.usado_em_documento
       AND (to_jsonb(NEW) - 'usado_em_documento' - 'actualizado_em' - 'versao')
         = (to_jsonb(OLD) - 'usado_em_documento' - 'actualizado_em' - 'versao')) THEN
    RAISE EXCEPTION 'customers.invalid_transition: a ficha está %', estado_da_ficha;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.id <> OLD.id OR NEW.comerciante_id <> OLD.comerciante_id
       OR NEW.cliente_id <> OLD.cliente_id THEN
      RAISE EXCEPTION 'customers.immutable_identity: o id, o comerciante e a ficha de um perfil não mudam';
    END IF;
    IF NEW.usado_em_documento IS DISTINCT FROM OLD.usado_em_documento
       AND NOT NEW.usado_em_documento THEN
      RAISE EXCEPTION 'customers.profile_used: um perfil usado num documento não deixa de o ter sido';
    END IF;
  END IF;

  -- A régua do NIF, quando o NIF ou o país mudam (a API manda os dois).
  IF TG_OP = 'INSERT' OR NEW.nif_escrito IS DISTINCT FROM OLD.nif_escrito
     OR NEW.pais_contribuinte IS DISTINCT FROM OLD.pais_contribuinte THEN
    IF NEW.nif_escrito IS NULL AND NEW.pais_contribuinte IS NOT NULL THEN
      RAISE EXCEPTION 'customers.nif_invalid: um país do contribuinte sem NIF';
    END IF;
    pais_comerciante := public.pais_do_comerciante(NEW.comerciante_id);
    SELECT r.pais, r.numero INTO regua
    FROM public.nif_regua(NEW.nif_escrito, NEW.pais_contribuinte,
      pais_comerciante IS NOT DISTINCT FROM 'PT') r;
    NEW.pais_contribuinte := regua.pais;
    NEW.nif_numero := regua.numero;
  ELSE
    NEW.nif_numero := OLD.nif_numero;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.usado_em_documento
     AND (NEW.tipo <> OLD.tipo
       OR NEW.nif_numero IS DISTINCT FROM OLD.nif_numero
       OR NEW.pais_contribuinte IS DISTINCT FROM OLD.pais_contribuinte) THEN
    -- R4 (Q3 decidida): cria-se outro perfil; o NIF escrito pode mudar só na
    -- pontuação (o mesmo número).
    RAISE EXCEPTION 'customers.profile_used: um perfil usado num documento não muda de NIF, tipo nem país; crie outro perfil';
  END IF;

  -- O estado do VIES (§4.2): a consulta (parte 3) muda-o; aqui só se sabe se
  -- se aplica. Um NIF novo volta a precisar de validação.
  IF TG_OP = 'INSERT' OR NEW.nif_numero IS DISTINCT FROM OLD.nif_numero
     OR NEW.pais_contribuinte IS DISTINCT FROM OLD.pais_contribuinte THEN
    pais_comerciante := public.pais_do_comerciante(NEW.comerciante_id);
    NEW.estado_vies := CASE
      WHEN NEW.nif_numero IS NOT NULL AND public.prefixo_fiscal(NEW.pais_contribuinte) IS NOT NULL
        AND NEW.pais_contribuinte IS DISTINCT FROM pais_comerciante THEN 'por_validar'
      ELSE 'nao_aplicavel'
    END;
  ELSIF current_setting('eurolify.vies_registar', true) IS DISTINCT FROM 'sim' THEN
    -- Só a `vies_registar` (com a resposta do VIES) muda o estado do VIES.
    NEW.estado_vies := OLD.estado_vies;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.estado <> 'activo' THEN
      RAISE EXCEPTION 'customers.invalid_transition: um perfil nasce activo';
    END IF;
    IF NEW.usado_em_documento THEN
      RAISE EXCEPTION 'customers.profile_used: um perfil novo não foi usado em nenhum documento';
    END IF;
    -- O primeiro perfil activo da ficha é o principal (R5).
    NEW.principal := NOT EXISTS (
      SELECT FROM public.perfil_faturacao p
      WHERE p.cliente_id = NEW.cliente_id AND p.principal);
    NEW.versao := 1;
    NEW.criado_em := now();
    NEW.actualizado_em := now();
    RETURN NEW;
  END IF;

  IF OLD.estado = 'activo' AND NEW.estado = 'arquivado' THEN
    IF OLD.principal AND EXISTS (
      SELECT FROM public.perfil_faturacao p
      WHERE p.cliente_id = NEW.cliente_id AND p.id <> NEW.id AND p.estado = 'activo') THEN
      RAISE EXCEPTION 'customers.primary_profile: o perfil principal não se arquiva enquanto houver outro activo; torne outro principal primeiro';
    END IF;
    NEW.principal := false;
  ELSIF OLD.estado = 'arquivado' AND NEW.estado = 'activo' THEN
    NEW.principal := NOT EXISTS (
      SELECT FROM public.perfil_faturacao p
      WHERE p.cliente_id = NEW.cliente_id AND p.id <> NEW.id AND p.principal);
  ELSIF NEW.estado = 'arquivado' AND NEW.principal THEN
    RAISE EXCEPTION 'customers.invalid_transition: um perfil arquivado não é o principal';
  END IF;
  NEW.criado_em := OLD.criado_em;
  NEW.actualizado_em := now();
  NEW.versao := OLD.versao + 1;
  RETURN NEW;
END
$$;

-- A marca põe-na o domínio dos documentos, nunca a API (docs/23, R4).
CREATE FUNCTION perfil_marcar_usado(p_perfil uuid) RETURNS void
  LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  UPDATE public.perfil_faturacao SET usado_em_documento = true
  WHERE id = p_perfil AND comerciante_id = public.comerciante_actual() AND NOT usado_em_documento
$$;

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
    'keys:write', 'storefront'
  ]::text[]);

CREATE OR REPLACE FUNCTION papel_ambitos(p_papel text) RETURNS text[]
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  -- Por ordem alfabética, como em src/identidade/papeis.ts. Como a 0049 (com o
  -- customers:privacy no dono), mais os invoices:* (docs/28, Q7): dono
  -- todos, gestor ler e decidir a fila, apoio ler.
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
                  'payments:write', 'prices:read', 'prices:write', 'shipping:read',
                  'shipping:write', 'tax:read', 'tax:write']
    WHEN 'gestor' THEN ARRAY['catalog:history', 'catalog:import', 'catalog:publish',
                  'catalog:read', 'catalog:write', 'customers:merge', 'customers:read',
                  'customers:write', 'fulfilment:read', 'fulfilment:write',
                  'inventory:policy', 'inventory:read', 'inventory:write',
                  'invoices:read', 'invoices:write', 'legal:read', 'merchant:read',
                  'orders:read', 'payments:read', 'payments:write', 'prices:read',
                  'prices:write', 'shipping:read', 'shipping:write', 'tax:read']
    WHEN 'armazem' THEN ARRAY['catalog:read', 'fulfilment:read', 'fulfilment:write',
                  'inventory:read', 'inventory:write', 'prices:read', 'shipping:read']
    WHEN 'apoio' THEN ARRAY['catalog:read', 'customers:read', 'customers:write',
                  'fulfilment:read', 'inventory:read', 'invoices:read', 'legal:read',
                  'merchant:read', 'orders:read', 'payments:read', 'prices:read',
                  'shipping:read', 'tax:read']
  END::text[]
$$;

-- ----------------------------------------------------- RLS e permissões

DO $$
DECLARE
  tabela text;
BEGIN
  FOREACH tabela IN ARRAY ARRAY['ligacao_faturacao', 'documento_fiscal', 'documento_conteudo',
    'documento_prova', 'documento_rasto'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tabela);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tabela);
    EXECUTE format(
      'CREATE POLICY so_o_proprio ON %I USING (comerciante_id = comerciante_actual()) WITH CHECK (comerciante_id = comerciante_actual())',
      tabela);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC', tabela);
  END LOOP;
END
$$;

REVOKE EXECUTE ON FUNCTION encomenda_emissor_fiscal(), ligacao_faturacao_antes_de_gravar(),
  documento_fiscal_tarefa(),
  documento_fiscal_antes_de_gravar(), documento_fiscal_rasto(), documento_prova_antes_de_gravar(),
  encomenda_pede_documento(), documentos_comerciantes_com_trabalho(), documentos_a_tratar(integer),
  perfil_marcar_usado(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION documentos_comerciantes_com_trabalho(), documentos_a_tratar(integer),
  perfil_marcar_usado(uuid) TO eurolify_api;

GRANT SELECT ON ligacao_faturacao, documento_fiscal, documento_conteudo, documento_prova,
  documento_rasto TO eurolify_api;
GRANT INSERT (comerciante_id, entidade_legal_id, adaptador, serie, taxas, isencoes, criada_por)
  ON ligacao_faturacao TO eurolify_api;
GRANT UPDATE (estado, activa, credenciais, credenciais_versao_chave, credenciais_em,
  credenciais_por, serie, taxas, isencoes, testada_em, erro, versao)
  ON ligacao_faturacao TO eurolify_api;
GRANT UPDATE (estado, motivos, validados, ligacao_id, emissor_id, tentativas, proxima_em, versao)
  ON documento_fiscal TO eurolify_api;
GRANT INSERT (documento_id, comerciante_id, versao, conteudo, impressao, motivo, quem)
  ON documento_conteudo TO eurolify_api;
GRANT INSERT (documento_id, comerciante_id, numero, serie, data, atcud, nif, nome, pais, linhas,
  totais, pdf, em_bruto, divergencias) ON documento_prova TO eurolify_api;
GRANT INSERT (documento_id, comerciante_id, passo, de, para, motivo, quem, dados)
  ON documento_rasto TO eurolify_api;
