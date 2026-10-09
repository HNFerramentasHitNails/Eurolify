-- Checkout alojado, parte 1 (docs/25; issue #273; Diogo, 09/10/2026: «sim,
-- aprovo; avança com o código da fatia 7»): textos legais com versões,
-- métodos de entrega por mercado (Q2), carrinho, sessão de checkout e o
-- núcleo da encomenda criado pelo botão final (Q1), com a cópia de tudo o
-- que o cliente viu e aceitou. Os âmbitos legal:*, shipping:* e orders:read.
SET LOCAL lock_timeout = '10s';

-- As chaves estrangeiras compostas (comerciante, loja) precisam desta.
ALTER TABLE loja ADD CONSTRAINT loja_comerciante_id_unico UNIQUE (comerciante_id, id);
-- O perfil da encomenda é do cliente da encomenda (revisão do #276, P3-2).
ALTER TABLE perfil_faturacao ADD CONSTRAINT perfil_faturacao_do_cliente_unico
  UNIQUE (comerciante_id, cliente_id, id);

-- --------------------------------------------------------- Textos legais

CREATE TABLE texto_legal (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  loja_id uuid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('condicoes_gerais', 'informacao_pre_contratual',
    'privacidade', 'livre_resolucao', 'garantia_legal')),
  pais text NOT NULL CHECK (pais ~ '^[A-Z]{2}$'),
  lingua text NOT NULL CHECK (lingua ~ '^[a-z]{2}$'),
  tipo_cliente text NOT NULL CHECK (tipo_cliente IN ('consumidor', 'profissional')),
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (comerciante_id, id),
  UNIQUE (comerciante_id, loja_id, tipo, pais, lingua, tipo_cliente),
  FOREIGN KEY (comerciante_id, loja_id) REFERENCES loja (comerciante_id, id)
);

-- Uma versão nasce rascunho e publica-se uma vez; publicada, não muda nem
-- sai (consumer-rights-eu: «mudança de texto ⇒ versão nova»).
CREATE TABLE versao_texto_legal (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  texto_legal_id uuid NOT NULL,
  numero integer NOT NULL CHECK (numero >= 1),
  texto text NOT NULL CHECK (length(btrim(texto)) > 0 AND length(texto) <= 200000),
  estado text NOT NULL DEFAULT 'rascunho' CHECK (estado IN ('rascunho', 'publicada')),
  -- Sem validação do jurista, a versão fica C: a porta para produção não
  -- abre (docs/25 §3.4).
  validado_por_jurista boolean NOT NULL DEFAULT false,
  jurista text CHECK (jurista IS NULL OR length(btrim(jurista)) BETWEEN 1 AND 200),
  validado_em date,
  criada_por text NOT NULL,
  criada_em timestamptz NOT NULL DEFAULT now(),
  publicada_por text,
  publicada_em timestamptz,
  UNIQUE (comerciante_id, id),
  UNIQUE (texto_legal_id, numero),
  FOREIGN KEY (comerciante_id, texto_legal_id) REFERENCES texto_legal (comerciante_id, id),
  CHECK ((estado = 'publicada') = (publicada_em IS NOT NULL AND publicada_por IS NOT NULL)),
  CHECK (NOT validado_por_jurista OR (jurista IS NOT NULL AND validado_em IS NOT NULL))
);

CREATE FUNCTION versao_texto_legal_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem text := nullif(btrim(current_setting('eurolify.quem', true)), '');
BEGIN
  IF quem IS NULL THEN
    RAISE EXCEPTION 'legal.change_without_who: % sem eurolify.quem', TG_OP;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'legal.version_immutable: uma versão não se apaga';
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.estado := 'rascunho';
    NEW.publicada_em := NULL;
    NEW.publicada_por := NULL;
    NEW.criada_por := quem;
    NEW.criada_em := now();
    SELECT coalesce(max(v.numero), 0) + 1 INTO NEW.numero
    FROM public.versao_texto_legal v WHERE v.texto_legal_id = NEW.texto_legal_id;
    RETURN NEW;
  END IF;
  IF OLD.estado = 'publicada' THEN
    RAISE EXCEPTION 'legal.version_immutable: uma versão publicada não muda (crie outra)';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.comerciante_id IS DISTINCT FROM OLD.comerciante_id
     OR NEW.texto_legal_id IS DISTINCT FROM OLD.texto_legal_id
     OR NEW.numero IS DISTINCT FROM OLD.numero
     OR NEW.criada_por IS DISTINCT FROM OLD.criada_por
     OR NEW.criada_em IS DISTINCT FROM OLD.criada_em THEN
    RAISE EXCEPTION 'legal.version_immutable: campos fixos';
  END IF;
  IF NEW.estado = 'publicada' THEN
    NEW.publicada_por := quem;
    NEW.publicada_em := now();
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER versao_texto_legal_antes_de_gravar
  BEFORE INSERT OR UPDATE OR DELETE ON versao_texto_legal
  FOR EACH ROW EXECUTE FUNCTION versao_texto_legal_antes_de_gravar();
ALTER TABLE versao_texto_legal ENABLE ALWAYS TRIGGER versao_texto_legal_antes_de_gravar;

CREATE FUNCTION versao_texto_legal_evento() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.estado = 'publicada' AND OLD.estado = 'rascunho' THEN
    INSERT INTO public.evento_saida (comerciante_id, tipo, agregado_tipo, agregado_id, dados)
    VALUES (NEW.comerciante_id, 'legal_text.published', 'texto_legal', NEW.texto_legal_id,
      jsonb_build_object('texto_legal_id', NEW.texto_legal_id, 'versao_id', NEW.id,
        'numero', NEW.numero, 'quem', NEW.publicada_por,
        'em', to_char(NEW.publicada_em AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER versao_texto_legal_evento AFTER UPDATE ON versao_texto_legal
  FOR EACH ROW EXECUTE FUNCTION versao_texto_legal_evento();

-- ------------------------------------------------------ Métodos de entrega

-- Q2: tarifa fixa por encomenda, por mercado, com gratuitidade opcional.
CREATE TABLE metodo_entrega (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  loja_id uuid NOT NULL,
  mercado_id uuid NOT NULL,
  nome jsonb NOT NULL CHECK (jsonb_typeof(nome) = 'object' AND nome <> '{}'),
  prazo jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(prazo) = 'object'),
  tarifa bigint NOT NULL CHECK (tarifa BETWEEN 0 AND 100000000),
  gratis_a_partir_de bigint CHECK (gratis_a_partir_de IS NULL
    OR gratis_a_partir_de BETWEEN 1 AND 100000000000),
  pede_telefone boolean NOT NULL DEFAULT false,
  estado text NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'arquivado')),
  criado_em timestamptz NOT NULL DEFAULT now(),
  actualizado_em timestamptz NOT NULL DEFAULT now(),
  versao integer NOT NULL DEFAULT 1,
  UNIQUE (comerciante_id, id),
  UNIQUE (comerciante_id, mercado_id, id),
  FOREIGN KEY (comerciante_id, loja_id, mercado_id) REFERENCES mercado (comerciante_id, loja_id, id)
);

-- ------------------------------------------------------------- Carrinho

CREATE TABLE carrinho (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  loja_id uuid NOT NULL,
  canal_id uuid NOT NULL,
  mercado_id uuid NOT NULL,
  lingua text NOT NULL CHECK (lingua ~ '^[a-z]{2}$'),
  estado text NOT NULL DEFAULT 'aberto'
    CHECK (estado IN ('aberto', 'em_checkout', 'convertido', 'expirado')),
  -- O segredo do carrinho (sem conta): só o resumo SHA-256.
  segredo_resumo text NOT NULL CHECK (segredo_resumo ~ '^[0-9a-f]{64}$'),
  expira_em timestamptz NOT NULL DEFAULT now() + interval '30 days',
  criado_em timestamptz NOT NULL DEFAULT now(),
  actualizado_em timestamptz NOT NULL DEFAULT now(),
  versao integer NOT NULL DEFAULT 1,
  UNIQUE (comerciante_id, id),
  UNIQUE (comerciante_id, loja_id, id),
  FOREIGN KEY (comerciante_id, loja_id, canal_id) REFERENCES canal (comerciante_id, loja_id, id),
  FOREIGN KEY (comerciante_id, loja_id, mercado_id) REFERENCES mercado (comerciante_id, loja_id, id)
);

CREATE TABLE linha_carrinho (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  carrinho_id uuid NOT NULL,
  variante_id uuid NOT NULL,
  quantidade integer NOT NULL CHECK (quantidade BETWEEN 1 AND 10000),
  criada_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (comerciante_id, id),
  UNIQUE (carrinho_id, variante_id),
  FOREIGN KEY (comerciante_id, carrinho_id) REFERENCES carrinho (comerciante_id, id) ON DELETE CASCADE,
  FOREIGN KEY (comerciante_id, variante_id) REFERENCES variante (comerciante_id, id)
);

-- Mexer nas linhas só com o carrinho aberto, e no máximo 100 linhas.
CREATE FUNCTION linha_carrinho_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  estado_do_carrinho text;
  carrinho uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.carrinho_id ELSE NEW.carrinho_id END;
BEGIN
  SELECT c.estado INTO estado_do_carrinho FROM public.carrinho c WHERE c.id = carrinho FOR UPDATE;
  IF estado_do_carrinho IS NOT NULL AND estado_do_carrinho <> 'aberto' THEN
    RAISE EXCEPTION 'cart.not_open: o carrinho está %', estado_do_carrinho;
  END IF;
  IF TG_OP = 'INSERT' AND (SELECT count(*) FROM public.linha_carrinho l
                           WHERE l.carrinho_id = NEW.carrinho_id) >= 100 THEN
    RAISE EXCEPTION 'cart.too_many_lines: no máximo 100 linhas';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.carrinho_id IS DISTINCT FROM OLD.carrinho_id
                           OR NEW.variante_id IS DISTINCT FROM OLD.variante_id) THEN
    RAISE EXCEPTION 'cart.invalid_field: a linha não muda de carrinho nem de variante';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;
CREATE TRIGGER linha_carrinho_antes_de_gravar
  BEFORE INSERT OR UPDATE OR DELETE ON linha_carrinho
  FOR EACH ROW EXECUTE FUNCTION linha_carrinho_antes_de_gravar();

-- --------------------------------------------------- Sessão de checkout

CREATE TABLE sessao_checkout (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  loja_id uuid NOT NULL,
  carrinho_id uuid NOT NULL,
  mercado_id uuid NOT NULL,
  lingua text NOT NULL CHECK (lingua ~ '^[a-z]{2}$'),
  -- O endereço da sessão: só o resumo SHA-256 do token.
  token_resumo text NOT NULL UNIQUE CHECK (token_resumo ~ '^[0-9a-f]{64}$'),
  estado text NOT NULL DEFAULT 'aberta'
    CHECK (estado IN ('aberta', 'concluida', 'expirada', 'abandonada')),
  expira_em timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  email text CHECK (email IS NULL OR (length(email) <= 254 AND email ~ '^[^@\s]+@[^@\s]+$')),
  nome text CHECK (nome IS NULL OR length(btrim(nome)) BETWEEN 1 AND 200),
  telefone text CHECK (telefone IS NULL OR telefone ~ '^\+[1-9][0-9]{6,14}$'),
  entrega jsonb CHECK (entrega IS NULL OR jsonb_typeof(entrega) = 'object'),
  finalidade text NOT NULL DEFAULT 'consumo'
    CHECK (finalidade IN ('consumo', 'profissional', 'revenda')),
  faturacao jsonb CHECK (faturacao IS NULL OR jsonb_typeof(faturacao) = 'object'),
  metodo_entrega_id uuid,
  metodo_pagamento text CHECK (metodo_pagamento IS NULL OR metodo_pagamento ~ '^[a-z_]{2,40}$'),
  criado_em timestamptz NOT NULL DEFAULT now(),
  actualizado_em timestamptz NOT NULL DEFAULT now(),
  concluida_em timestamptz,
  versao integer NOT NULL DEFAULT 1,
  UNIQUE (comerciante_id, id),
  UNIQUE (comerciante_id, loja_id, id),
  -- A loja da sessão é a do carrinho, e o método de entrega é do mercado da
  -- sessão (revisão do #276, P3-2).
  FOREIGN KEY (comerciante_id, loja_id, carrinho_id) REFERENCES carrinho (comerciante_id, loja_id, id),
  FOREIGN KEY (comerciante_id, loja_id, mercado_id) REFERENCES mercado (comerciante_id, loja_id, id),
  FOREIGN KEY (comerciante_id, mercado_id, metodo_entrega_id)
    REFERENCES metodo_entrega (comerciante_id, mercado_id, id),
  CHECK ((estado = 'concluida') = (concluida_em IS NOT NULL))
);
-- Uma sessão aberta por carrinho.
CREATE UNIQUE INDEX sessao_checkout_uma_aberta
  ON sessao_checkout (carrinho_id) WHERE estado = 'aberta';

-- Concluída, a sessão não muda (a encomenda tem a cópia).
CREATE FUNCTION sessao_checkout_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF OLD.estado <> 'aberta' THEN
    RAISE EXCEPTION 'checkout.closed: a sessão está %', OLD.estado;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.comerciante_id IS DISTINCT FROM OLD.comerciante_id
     OR NEW.carrinho_id IS DISTINCT FROM OLD.carrinho_id
     OR NEW.token_resumo IS DISTINCT FROM OLD.token_resumo
     OR NEW.loja_id IS DISTINCT FROM OLD.loja_id THEN
    RAISE EXCEPTION 'checkout.invalid_field: campos fixos';
  END IF;
  NEW.actualizado_em := now();
  NEW.versao := OLD.versao + 1;
  RETURN NEW;
END
$$;
CREATE TRIGGER sessao_checkout_antes_de_gravar
  BEFORE UPDATE ON sessao_checkout
  FOR EACH ROW EXECUTE FUNCTION sessao_checkout_antes_de_gravar();

CREATE FUNCTION sessao_checkout_evento() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  INSERT INTO public.evento_saida (comerciante_id, tipo, agregado_tipo, agregado_id, dados)
  VALUES (NEW.comerciante_id, 'checkout.started', 'sessao_checkout', NEW.id,
    jsonb_build_object('sessao_id', NEW.id, 'carrinho_id', NEW.carrinho_id,
      'mercado_id', NEW.mercado_id,
      'em', to_char(NEW.criado_em AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
  RETURN NULL;
END
$$;
CREATE TRIGGER sessao_checkout_evento AFTER INSERT ON sessao_checkout
  FOR EACH ROW EXECUTE FUNCTION sessao_checkout_evento();

-- A porta do checkout alojado: do resumo do token para a sessão e o
-- comerciante. As tabelas com o RLS forçado não se lêem sem comerciante, nem
-- pelo dono; por isso o token vive numa tabela interna (RLS sem FORÇAR, como a
-- chave_api da 0010), que só o gatilho escreve e só a função lê.
CREATE TABLE token_checkout (
  token_resumo text PRIMARY KEY CHECK (token_resumo ~ '^[0-9a-f]{64}$'),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  sessao_id uuid NOT NULL UNIQUE
);
ALTER TABLE token_checkout ENABLE ROW LEVEL SECURITY;
CREATE POLICY so_o_proprio ON token_checkout
  USING (comerciante_id = comerciante_actual())
  WITH CHECK (comerciante_id = comerciante_actual());
REVOKE ALL ON token_checkout FROM PUBLIC;

CREATE FUNCTION sessao_checkout_token() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  INSERT INTO public.token_checkout (token_resumo, comerciante_id, sessao_id)
  VALUES (NEW.token_resumo, NEW.comerciante_id, NEW.id);
  RETURN NULL;
END
$$;
CREATE TRIGGER sessao_checkout_token AFTER INSERT ON sessao_checkout
  FOR EACH ROW EXECUTE FUNCTION sessao_checkout_token();

-- Devolve a sessão e o comerciante; o estado lê-se depois, já no comerciante.
CREATE FUNCTION checkout_resolver(p_resumo text)
  RETURNS TABLE (id uuid, comerciante_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT t.sessao_id, t.comerciante_id
  FROM public.token_checkout t
  WHERE t.token_resumo = p_resumo
$$;

-- ------------------------------------------------------------ Encomenda

-- O núcleo da encomenda (Q1): nasce no botão final, a aguardar pagamento, e
-- guarda a cópia de tudo. As cópias não mudam; só o estado, para a frente
-- (a fatia 8 marca paga ou cancelada; a 9 acrescenta o resto).
CREATE TABLE encomenda (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  loja_id uuid NOT NULL,
  canal_id uuid NOT NULL,
  mercado_id uuid NOT NULL,
  entidade_legal_id uuid NOT NULL,
  sessao_id uuid NOT NULL UNIQUE,
  cliente_id uuid NOT NULL,
  perfil_id uuid NOT NULL,
  perfil_copia jsonb NOT NULL CHECK (jsonb_typeof(perfil_copia) = 'object'),
  contacto jsonb NOT NULL CHECK (jsonb_typeof(contacto) = 'object'),
  entrega jsonb NOT NULL CHECK (jsonb_typeof(entrega) = 'object'),
  finalidade text NOT NULL CHECK (finalidade IN ('consumo', 'profissional', 'revenda')),
  moeda text NOT NULL CHECK (moeda ~ '^[A-Z]{3}$'),
  preco_inclui_iva boolean NOT NULL,
  lingua text NOT NULL CHECK (lingua ~ '^[a-z]{2}$'),
  total_base bigint NOT NULL CHECK (total_base >= 0),
  total_iva bigint NOT NULL CHECK (total_iva >= 0),
  total bigint NOT NULL CHECK (total = total_base + total_iva),
  portes jsonb NOT NULL CHECK (jsonb_typeof(portes) = 'object'),
  metodo_entrega jsonb NOT NULL CHECK (jsonb_typeof(metodo_entrega) = 'object'),
  metodo_pagamento text NOT NULL CHECK (metodo_pagamento ~ '^[a-z_]{2,40}$'),
  -- As versões aceites (lgv_), o texto do botão final e o momento.
  aceitacoes jsonb NOT NULL CHECK (jsonb_typeof(aceitacoes) = 'object'),
  estado text NOT NULL DEFAULT 'a_aguardar_pagamento'
    CHECK (estado IN ('a_aguardar_pagamento', 'paga', 'cancelada_sem_pagamento')),
  criada_por text NOT NULL,
  criada_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (comerciante_id, id),
  -- A loja é a da sessão, e o perfil é do cliente (revisão do #276, P3-2).
  FOREIGN KEY (comerciante_id, loja_id, sessao_id) REFERENCES sessao_checkout (comerciante_id, loja_id, id),
  FOREIGN KEY (comerciante_id, cliente_id) REFERENCES cliente (comerciante_id, id),
  FOREIGN KEY (comerciante_id, cliente_id, perfil_id)
    REFERENCES perfil_faturacao (comerciante_id, cliente_id, id),
  FOREIGN KEY (comerciante_id, loja_id, canal_id) REFERENCES canal (comerciante_id, loja_id, id),
  FOREIGN KEY (comerciante_id, loja_id, mercado_id) REFERENCES mercado (comerciante_id, loja_id, id),
  FOREIGN KEY (comerciante_id, entidade_legal_id) REFERENCES entidade_legal (comerciante_id, id)
);

CREATE TABLE linha_encomenda (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  encomenda_id uuid NOT NULL,
  posicao integer NOT NULL CHECK (posicao >= 1),
  variante_id uuid NOT NULL,
  sku text NOT NULL,
  nome text NOT NULL,
  quantidade integer NOT NULL CHECK (quantidade BETWEEN 1 AND 10000),
  preco_unitario bigint NOT NULL CHECK (preco_unitario >= 0),
  -- A lista, a redução e o preço de referência, o preço por unidade
  -- (docs/20, R11).
  preco jsonb NOT NULL CHECK (jsonb_typeof(preco) = 'object'),
  -- A decisão de IVA inteira, com a evidência (eu-vat-oss-ioss, regras 2 e 3).
  decisao_iva jsonb NOT NULL CHECK (jsonb_typeof(decisao_iva) = 'object'),
  base bigint NOT NULL CHECK (base >= 0),
  iva bigint NOT NULL CHECK (iva >= 0),
  total bigint NOT NULL CHECK (total = base + iva),
  UNIQUE (comerciante_id, id),
  UNIQUE (encomenda_id, posicao),
  FOREIGN KEY (comerciante_id, encomenda_id) REFERENCES encomenda (comerciante_id, id),
  FOREIGN KEY (comerciante_id, variante_id) REFERENCES variante (comerciante_id, id)
);

CREATE TRIGGER linha_encomenda_so_se_acrescenta
  BEFORE UPDATE OR DELETE ON linha_encomenda
  FOR EACH ROW EXECUTE FUNCTION rasto_so_se_acrescenta();
ALTER TABLE linha_encomenda ENABLE ALWAYS TRIGGER linha_encomenda_so_se_acrescenta;

CREATE FUNCTION encomenda_antes_de_gravar() RETURNS trigger
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
  IF NOT (OLD.estado = 'a_aguardar_pagamento'
          AND NEW.estado IN ('paga', 'cancelada_sem_pagamento')) THEN
    RAISE EXCEPTION 'orders.invalid_transition: % → %', OLD.estado, NEW.estado;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER encomenda_antes_de_gravar
  BEFORE INSERT OR UPDATE OR DELETE ON encomenda
  FOR EACH ROW EXECUTE FUNCTION encomenda_antes_de_gravar();
ALTER TABLE encomenda ENABLE ALWAYS TRIGGER encomenda_antes_de_gravar;
CREATE TRIGGER encomenda_sem_truncate
  BEFORE TRUNCATE ON encomenda
  FOR EACH STATEMENT EXECUTE FUNCTION rasto_so_se_acrescenta();
ALTER TABLE encomenda ENABLE ALWAYS TRIGGER encomenda_sem_truncate;
CREATE TRIGGER linha_encomenda_sem_truncate
  BEFORE TRUNCATE ON linha_encomenda
  FOR EACH STATEMENT EXECUTE FUNCTION rasto_so_se_acrescenta();
ALTER TABLE linha_encomenda ENABLE ALWAYS TRIGGER linha_encomenda_sem_truncate;

-- Os totais batem com as linhas (revisão do #276, P2-4): no fim da
-- transacção que cria a encomenda, a soma das linhas mais os portes tem de dar
-- os totais copiados, e há pelo menos uma linha. As linhas só se acrescentam
-- na transacção que criou a encomenda (criada_em é o now() dela); depois, a
-- encomenda e as linhas ficam fechadas.
CREATE FUNCTION linha_encomenda_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.encomenda e
                 WHERE e.id = NEW.encomenda_id AND e.criada_em = now()) THEN
    RAISE EXCEPTION 'orders.immutable: as linhas só se acrescentam ao criar a encomenda';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER linha_encomenda_antes_de_gravar
  BEFORE INSERT ON linha_encomenda
  FOR EACH ROW EXECUTE FUNCTION linha_encomenda_antes_de_gravar();
ALTER TABLE linha_encomenda ENABLE ALWAYS TRIGGER linha_encomenda_antes_de_gravar;

CREATE FUNCTION encomenda_confere_totais() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  n bigint;
  soma_base bigint;
  soma_iva bigint;
BEGIN
  SELECT count(*), coalesce(sum(l.base), 0), coalesce(sum(l.iva), 0)
    INTO n, soma_base, soma_iva
    FROM public.linha_encomenda l WHERE l.encomenda_id = NEW.id;
  IF n = 0 THEN
    RAISE EXCEPTION 'orders.totals_mismatch: encomenda sem linhas';
  END IF;
  IF soma_base + (NEW.portes->>'base')::bigint <> NEW.total_base
     OR soma_iva + (NEW.portes->>'iva')::bigint <> NEW.total_iva THEN
    RAISE EXCEPTION 'orders.totals_mismatch: os totais não batem com as linhas e os portes';
  END IF;
  RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER encomenda_confere_totais
  AFTER INSERT ON encomenda DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION encomenda_confere_totais();
ALTER TABLE encomenda ENABLE ALWAYS TRIGGER encomenda_confere_totais;

-- Só identificadores e o total (headless-commerce: mínimo de dados no corpo).
CREATE FUNCTION encomenda_evento() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  INSERT INTO public.evento_saida (comerciante_id, tipo, agregado_tipo, agregado_id, dados)
  VALUES (NEW.comerciante_id, 'order.created', 'encomenda', NEW.id,
    jsonb_build_object('encomenda_id', NEW.id, 'cliente_id', NEW.cliente_id,
      'total', NEW.total, 'moeda', NEW.moeda, 'quem', NEW.criada_por,
      'em', to_char(NEW.criada_em AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
  RETURN NULL;
END
$$;
CREATE TRIGGER encomenda_evento AFTER INSERT ON encomenda
  FOR EACH ROW EXECUTE FUNCTION encomenda_evento();

REVOKE EXECUTE ON FUNCTION versao_texto_legal_evento(), sessao_checkout_evento(),
  sessao_checkout_token(), encomenda_evento(), checkout_resolver(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION checkout_resolver(text) TO eurolify_api;

-- ----------------------------------------------------- RLS e permissões

DO $$
DECLARE
  tabela text;
BEGIN
  FOREACH tabela IN ARRAY ARRAY['texto_legal', 'versao_texto_legal', 'metodo_entrega',
    'carrinho', 'linha_carrinho', 'sessao_checkout', 'encomenda', 'linha_encomenda'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tabela);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tabela);
    EXECUTE format(
      'CREATE POLICY so_o_proprio ON %I USING (comerciante_id = comerciante_actual()) WITH CHECK (comerciante_id = comerciante_actual())',
      tabela);
  END LOOP;
END
$$;

GRANT SELECT ON texto_legal, versao_texto_legal, metodo_entrega, carrinho,
  linha_carrinho, sessao_checkout, encomenda, linha_encomenda TO eurolify_api;
GRANT INSERT (comerciante_id, loja_id, tipo, pais, lingua, tipo_cliente) ON texto_legal TO eurolify_api;
GRANT INSERT (comerciante_id, texto_legal_id, texto, validado_por_jurista, jurista,
  validado_em, criada_por) ON versao_texto_legal TO eurolify_api;
GRANT UPDATE (texto, validado_por_jurista, jurista, validado_em, estado) ON versao_texto_legal TO eurolify_api;
GRANT INSERT (comerciante_id, loja_id, mercado_id, nome, prazo, tarifa, gratis_a_partir_de,
  pede_telefone) ON metodo_entrega TO eurolify_api;
GRANT UPDATE (nome, prazo, tarifa, gratis_a_partir_de, pede_telefone, estado, actualizado_em,
  versao) ON metodo_entrega TO eurolify_api;
GRANT INSERT (comerciante_id, loja_id, canal_id, mercado_id, lingua, segredo_resumo)
  ON carrinho TO eurolify_api;
GRANT UPDATE (mercado_id, estado, expira_em, actualizado_em, versao) ON carrinho TO eurolify_api;
GRANT INSERT (comerciante_id, carrinho_id, variante_id, quantidade) ON linha_carrinho TO eurolify_api;
GRANT UPDATE (quantidade) ON linha_carrinho TO eurolify_api;
GRANT DELETE ON linha_carrinho TO eurolify_api;
GRANT INSERT (comerciante_id, loja_id, carrinho_id, mercado_id, lingua, token_resumo)
  ON sessao_checkout TO eurolify_api;
GRANT UPDATE (mercado_id, estado, email, nome, telefone, entrega, finalidade, faturacao,
  metodo_entrega_id, metodo_pagamento, concluida_em, expira_em)
  ON sessao_checkout TO eurolify_api;
GRANT INSERT (comerciante_id, loja_id, canal_id, mercado_id, entidade_legal_id, sessao_id,
  cliente_id, perfil_id, perfil_copia, contacto, entrega, finalidade, moeda, preco_inclui_iva,
  lingua, total_base, total_iva, total, portes, metodo_entrega, metodo_pagamento, aceitacoes,
  criada_por) ON encomenda TO eurolify_api;
GRANT INSERT (comerciante_id, encomenda_id, posicao, variante_id, sku, nome, quantidade,
  preco_unitario, preco, decisao_iva, base, iva, total) ON linha_encomenda TO eurolify_api;

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
                           'orders:read', 'prices:read', 'prices:write',
                           'shipping:read', 'shipping:write', 'tax:read', 'tax:write']
    WHEN 'gestor' THEN ARRAY['catalog:history', 'catalog:import', 'catalog:publish',
                             'catalog:read', 'catalog:write', 'customers:read',
                             'customers:write', 'legal:read', 'merchant:read',
                             'orders:read', 'prices:read', 'prices:write',
                             'shipping:read', 'shipping:write', 'tax:read']
    -- O armazém não lê as encomendas inteiras (perfil de faturação, NIF,
    -- e-mail): a vista do que expedir vem com a fatia da expedição
    -- (minimização de dados; revisão do #276, P2-10).
    WHEN 'armazem' THEN ARRAY['catalog:read', 'prices:read', 'shipping:read']
    WHEN 'apoio' THEN ARRAY['catalog:read', 'customers:read', 'customers:write',
                            'legal:read', 'merchant:read', 'orders:read',
                            'prices:read', 'shipping:read', 'tax:read']
  END::text[]
$$;
