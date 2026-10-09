-- Preços e mercados, parte 2 (docs/20 §10; issue #127; Diogo, 09/10/2026:
-- «sim, aprovo; avança com o código de Preços»). Ex.: o «Gel UV 15 ml» custa
-- 990 cêntimos na lista «Base PT» desde 01/09/2026; a 09/10/2026 anuncia-se
-- uma redução para 790 até 31/10/2026; a base calcula o preço de referência
-- (o mais baixo praticado entre 09/09 e 09/10: 990) e guarda-o com a redução.
--
-- O que esta migração faz:
-- - a tabela `reducao` (o preço riscado, §3.6 e §10.2): uma de cada vez por
--   variante e lista; o preço de referência calcula-o a base ao gravar,
--   nunca quem pede; sem 30 dias seguidos de preço, ou com um preço reduzido
--   igual ou acima do de referência, recusa; nada se apaga (tira-se, com
--   quem e quando);
-- - enquanto há uma redução em vigor, o preço da lista não muda nem sai
--   (`prices.reduction_active`), excepto quando a variante de um rascunho é
--   apagada: a redução fica terminada com ela;
-- - os eventos `promotion.started` e `promotion.ended` (§6);
-- - os âmbitos `prices:read` e `prices:write` (§10.1): nas chaves (o CHECK
--   da 0010, já com o `catalog:history` da 0033) e nos papéis (o dono e o
--   gestor, os dois; o armazém e o apoio, só a leitura).
--
-- O que não faz (e onde fica):
-- - reduções marcadas para o futuro, progressivas e as excepções do art.
--   6.º-A: **C**, à espera do jurista (docs/12, B, ponto 7);
-- - o evento de uma redução que acaba sozinha no `fim` (não há tarefa que o
--   escreva; o `promotion.started` leva o `fim`).

SET LOCAL lock_timeout = '10s';

CREATE TABLE reducao (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  lista_id uuid NOT NULL,
  -- Sem chave para a variante, como o histórico: a redução fica depois de a
  -- variante de um rascunho ser apagada.
  variante_id uuid NOT NULL,
  montante bigint NOT NULL CHECK (montante BETWEEN 1 AND 100000000000),
  preco_referencia bigint NOT NULL DEFAULT 0,
  inicio timestamptz NOT NULL DEFAULT clock_timestamp(),
  fim timestamptz,
  terminada_em timestamptz,
  terminada_por text,
  criada_por text NOT NULL DEFAULT '',
  CONSTRAINT reducao_fim_depois CHECK (fim IS NULL OR fim > inicio),
  CONSTRAINT reducao_terminada_inteira CHECK ((terminada_em IS NULL) = (terminada_por IS NULL)),
  CONSTRAINT reducao_da_lista FOREIGN KEY (comerciante_id, lista_id)
    REFERENCES lista_precos (comerciante_id, id)
);
CREATE INDEX reducao_por_preco ON reducao (comerciante_id, lista_id, variante_id, inicio);

/** Em vigor agora: nem terminada nem passada do fim. */
CREATE FUNCTION reducao_em_vigor(r public.reducao, p_em timestamptz) RETURNS boolean
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT r.inicio <= p_em AND r.terminada_em IS NULL AND (r.fim IS NULL OR r.fim > p_em)
$$;

-- O preço de referência (§3.6, §10.2; Dir. 98/6/CE, art. 6.º-A — C): o
-- montante mais baixo praticado na variante e lista nos 30 dias antes de
-- `p_inicio` — o preço do histórico em vigor em cada momento da janela, ou o
-- de uma redução anterior quando estava em vigor. Nulo quando não há 30 dias
-- seguidos de preço (nenhuma linha em vigor no início da janela, ou o preço
-- saiu da lista em algum momento dela).
CREATE FUNCTION preco_referencia(p_comerciante uuid, p_lista uuid, p_variante uuid,
                                 p_inicio timestamptz) RETURNS bigint
  LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  -- 30 dias de 24 horas (720 h), qualquer que seja o fuso da sessão e a
  -- mudança da hora (revisão do #224, P3-1); o que a lei conta como «30 dias»
  -- é C (docs/12, B, ponto 7).
  janela timestamptz := p_inicio - make_interval(hours => 720);
  primeira public.historico_preco;
  do_historico bigint;
  das_reducoes bigint;
BEGIN
  SELECT * INTO primeira FROM public.historico_preco h
  WHERE h.comerciante_id = p_comerciante AND h.lista_id = p_lista
    AND h.variante_id = p_variante AND h.em_vigor_desde <= janela
  ORDER BY h.em_vigor_desde DESC, h.id DESC
  LIMIT 1;
  IF primeira.id IS NULL OR primeira.saiu THEN
    RETURN NULL;
  END IF;
  IF EXISTS (
    SELECT FROM public.historico_preco h
    WHERE h.comerciante_id = p_comerciante AND h.lista_id = p_lista
      AND h.variante_id = p_variante AND h.em_vigor_desde > janela
      AND h.em_vigor_desde < p_inicio AND h.saiu) THEN
    RETURN NULL;
  END IF;
  SELECT least(primeira.montante, min(h.montante)) INTO do_historico
  FROM public.historico_preco h
  WHERE h.comerciante_id = p_comerciante AND h.lista_id = p_lista
    AND h.variante_id = p_variante AND h.em_vigor_desde > janela
    AND h.em_vigor_desde < p_inicio;
  SELECT min(r.montante) INTO das_reducoes
  FROM public.reducao r
  WHERE r.comerciante_id = p_comerciante AND r.lista_id = p_lista
    AND r.variante_id = p_variante AND r.inicio < p_inicio
    AND coalesce(least(r.terminada_em, r.fim), 'infinity'::timestamptz) > janela;
  RETURN least(do_historico, das_reducoes);
END
$$;

CREATE FUNCTION reducao_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem text := nullif(btrim(current_setting('eurolify.quem', true)), '');
  estado_da_lista text;
  referencia bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'audit.append_only: uma redução não se apaga (tira-se)';
  END IF;
  IF quem IS NULL OR length(quem) > 200 THEN
    RAISE EXCEPTION 'prices.defined_by_required: quem anuncia ou tira a redução (eurolify.quem) é obrigatório';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.id, NEW.comerciante_id, NEW.lista_id, NEW.variante_id, NEW.montante,
        NEW.preco_referencia, NEW.inicio, NEW.fim, NEW.criada_por)
       IS DISTINCT FROM
       (OLD.id, OLD.comerciante_id, OLD.lista_id, OLD.variante_id, OLD.montante,
        OLD.preco_referencia, OLD.inicio, OLD.fim, OLD.criada_por) THEN
      RAISE EXCEPTION 'prices.immutable_identity: uma redução não muda; tira-se e anuncia-se outra';
    END IF;
    IF NEW.terminada_em IS NULL OR NOT public.reducao_em_vigor(OLD, clock_timestamp()) THEN
      -- Só se tira uma em vigor: nem uma já tirada, nem uma passada do fim
      -- (revisão do #224, P3-3).
      RAISE EXCEPTION 'prices.invalid_transition: só se tira uma redução em vigor, e uma vez';
    END IF;
    NEW.terminada_em := clock_timestamp();
    NEW.terminada_por := quem;
    RETURN NEW;
  END IF;

  -- O preço da variante na lista, tomado: quem o mudar espera, e vê a
  -- redução (e é recusado) depois (§10.2). Aqui toma-se a lista (FOR SHARE)
  -- e depois o preço; numa escrita de preço, o PostgreSQL toma a linha do
  -- preço antes dos gatilhos, que tomam a lista depois. Os bloqueios da lista
  -- são todos partilhados, por isso as duas ordens não se prendem uma à outra
  -- (revisão do #224, P3-9); um impasse inesperado sai como prices.retry.
  SELECT l.estado INTO estado_da_lista FROM public.lista_precos l
  WHERE l.comerciante_id = NEW.comerciante_id AND l.id = NEW.lista_id
  FOR SHARE;
  IF estado_da_lista IS NULL THEN
    RAISE EXCEPTION 'prices.not_found: a lista não existe';
  END IF;
  IF estado_da_lista = 'arquivada' THEN
    RAISE EXCEPTION 'prices.list_archived: não se anunciam reduções numa lista arquivada';
  END IF;
  PERFORM FROM public.preco p
  WHERE p.comerciante_id = NEW.comerciante_id AND p.lista_id = NEW.lista_id
    AND p.variante_id = NEW.variante_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'prices.not_found: a variante não tem preço nesta lista';
  END IF;
  IF EXISTS (
    SELECT FROM public.reducao r
    WHERE r.comerciante_id = NEW.comerciante_id AND r.lista_id = NEW.lista_id
      AND r.variante_id = NEW.variante_id
      AND public.reducao_em_vigor(r, clock_timestamp())) THEN
    RAISE EXCEPTION 'prices.reduction_active: já há uma redução em vigor; tire-a primeiro';
  END IF;
  NEW.inicio := clock_timestamp();
  NEW.terminada_em := NULL;
  NEW.terminada_por := NULL;
  NEW.criada_por := quem;
  IF NEW.fim IS NOT NULL AND NEW.fim <= NEW.inicio THEN
    RAISE EXCEPTION 'prices.invalid_field: o fim da redução é depois do início';
  END IF;
  referencia := public.preco_referencia(NEW.comerciante_id, NEW.lista_id, NEW.variante_id, NEW.inicio);
  IF referencia IS NULL THEN
    RAISE EXCEPTION 'prices.reduction_without_history: sem 30 dias seguidos de preço nesta lista não há redução (docs/20 §3.6)';
  END IF;
  IF NEW.montante >= referencia THEN
    RAISE EXCEPTION 'prices.reduction_not_lower: o preço reduzido (%) não é mais baixo que o de referência (%)',
      NEW.montante, referencia;
  END IF;
  NEW.preco_referencia := referencia;
  RETURN NEW;
END
$$;
CREATE TRIGGER reducao_antes_de_gravar
  BEFORE INSERT ON reducao
  FOR EACH ROW EXECUTE FUNCTION reducao_antes_de_gravar();
-- A redução é prova do que se mostrou: não se altera nem se apaga, também
-- no modo `replica` (como o histórico, 0017; revisão do #224, P3-2).
CREATE TRIGGER reducao_so_se_tira
  BEFORE UPDATE OR DELETE ON reducao
  FOR EACH ROW EXECUTE FUNCTION reducao_antes_de_gravar();
ALTER TABLE reducao ENABLE ALWAYS TRIGGER reducao_so_se_tira;
CREATE TRIGGER reducao_sem_truncate
  BEFORE TRUNCATE ON reducao
  FOR EACH STATEMENT EXECUTE FUNCTION rasto_so_se_acrescenta();
ALTER TABLE reducao ENABLE ALWAYS TRIGGER reducao_sem_truncate;

-- Os eventos (§6): anunciada e tirada.
CREATE FUNCTION reducao_evento() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.evento_saida (comerciante_id, tipo, agregado_tipo, agregado_id, dados)
    VALUES (NEW.comerciante_id, 'promotion.started', 'variante', NEW.variante_id,
      jsonb_build_object(
        'reducao_id', NEW.id, 'lista_id', NEW.lista_id, 'variante_id', NEW.variante_id,
        'montante', NEW.montante, 'preco_referencia', NEW.preco_referencia,
        'fim', to_char(NEW.fim AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'quem', NEW.criada_por,
        'em', to_char(NEW.inicio AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
  ELSE
    INSERT INTO public.evento_saida (comerciante_id, tipo, agregado_tipo, agregado_id, dados)
    VALUES (NEW.comerciante_id, 'promotion.ended', 'variante', NEW.variante_id,
      jsonb_build_object(
        'reducao_id', NEW.id, 'lista_id', NEW.lista_id, 'variante_id', NEW.variante_id,
        'quem', NEW.terminada_por,
        'em', to_char(NEW.terminada_em AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER reducao_evento
  AFTER INSERT OR UPDATE OF terminada_em ON reducao
  FOR EACH ROW EXECUTE FUNCTION reducao_evento();

-- O preço não muda nem sai com uma redução em vigor (§10.2). A variante de
-- um rascunho apagada (a cascata) leva o preço; a redução fica terminada.
-- Vê as reduções pelo RLS: com o comerciante posto (sempre, pela API). Um
-- SQL à mão do dono sem `eurolify.comerciante` não as vê e não é travado
-- aqui (revisão do #224, P3-4); é o mesmo limite das outras regras do dono.
CREATE FUNCTION preco_com_reducao() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem text := nullif(btrim(current_setting('eurolify.quem', true)), '');
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.montante = OLD.montante AND NEW.gratuito = OLD.gratuito THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT FROM public.reducao r
    WHERE r.comerciante_id = OLD.comerciante_id AND r.lista_id = OLD.lista_id
      AND r.variante_id = OLD.variante_id
      AND public.reducao_em_vigor(r, clock_timestamp())) THEN
    RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE' AND NOT EXISTS (
    SELECT FROM public.variante v
    WHERE v.comerciante_id = OLD.comerciante_id AND v.id = OLD.variante_id) THEN
    PERFORM set_config('eurolify.quem', coalesce(quem, 'catalogo:variante apagada'), true);
    UPDATE public.reducao r SET terminada_em = clock_timestamp()
    WHERE r.comerciante_id = OLD.comerciante_id AND r.lista_id = OLD.lista_id
      AND r.variante_id = OLD.variante_id
      AND public.reducao_em_vigor(r, clock_timestamp());
    PERFORM set_config('eurolify.quem', coalesce(quem, ''), true);
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'prices.reduction_active: há uma redução em vigor; tire-a antes de mudar ou tirar o preço';
END
$$;
CREATE TRIGGER preco_com_reducao
  BEFORE UPDATE OR DELETE ON preco
  FOR EACH ROW EXECUTE FUNCTION preco_com_reducao();

ALTER TABLE reducao ENABLE ROW LEVEL SECURITY;
ALTER TABLE reducao FORCE ROW LEVEL SECURITY;
CREATE POLICY so_o_proprio ON reducao
  USING (comerciante_id = comerciante_actual())
  WITH CHECK (comerciante_id = comerciante_actual());

GRANT SELECT ON reducao TO eurolify_api;
GRANT INSERT (comerciante_id, lista_id, variante_id, montante, fim) ON reducao TO eurolify_api;
GRANT UPDATE (terminada_em) ON reducao TO eurolify_api;
REVOKE EXECUTE ON FUNCTION reducao_em_vigor(public.reducao, timestamptz),
  preco_referencia(uuid, uuid, uuid, timestamptz), reducao_antes_de_gravar(),
  reducao_evento(), preco_com_reducao() FROM PUBLIC;
-- A API lê o preço de referência de uma redução já guardada; o cálculo, só
-- a base (no gatilho, com os direitos de quem escreve: precisa do EXECUTE).
GRANT EXECUTE ON FUNCTION reducao_em_vigor(public.reducao, timestamptz),
  preco_referencia(uuid, uuid, uuid, timestamptz) TO eurolify_api;

-- A lista de outro comerciante não se denuncia pelos índices únicos (a 0017
-- verificava o mercado depois deles).
CREATE OR REPLACE FUNCTION lista_precos_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  estado_do_mercado text;
BEGIN
  SELECT m.estado INTO estado_do_mercado FROM public.mercado m
  WHERE m.comerciante_id = NEW.comerciante_id AND m.id = NEW.mercado_id
  FOR SHARE;
  -- Um mercado que não se vê (de outro comerciante, ou inexistente) pára
  -- aqui, antes dos índices únicos por mercado: sem isto, criar uma lista no
  -- mercado de outro respondia «já há uma lista de base» e dizia que ele
  -- existe (revisão do #224, encontrado pelo teste das rotas, P2-1).
  IF estado_do_mercado IS NULL THEN
    RAISE EXCEPTION 'prices.not_found: o mercado não existe';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.estado <> 'activa' THEN
      RAISE EXCEPTION 'prices.invalid_transition: uma lista nasce activa';
    END IF;
    NEW.versao := 1;
    NEW.criado_em := now();
    NEW.actualizado_em := now();
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id OR NEW.comerciante_id <> OLD.comerciante_id
     OR NEW.mercado_id <> OLD.mercado_id OR NEW.tipo <> OLD.tipo THEN
    RAISE EXCEPTION 'prices.immutable_identity: o id, o comerciante, o mercado e o tipo de uma lista não mudam';
  END IF;
  IF OLD.estado = 'activa' AND NEW.estado = 'arquivada' AND NEW.tipo = 'base'
     AND estado_do_mercado = 'activo' THEN
    RAISE EXCEPTION 'prices.base_list_in_use: a lista de base de um mercado activo não se arquiva';
  END IF;
  NEW.criado_em := OLD.criado_em;
  NEW.actualizado_em := now();
  NEW.versao := OLD.versao + 1;
  RETURN NEW;
END
$$;

-- Os âmbitos novos (§10.1; docs/06, CW).
ALTER TABLE chave_api DROP CONSTRAINT chave_api_ambitos_validos;
ALTER TABLE chave_api ADD CONSTRAINT chave_api_ambitos_validos CHECK (
  cardinality(ambitos) BETWEEN 1 AND 20
  AND ambitos <@ ARRAY[
    'merchant:read', 'merchant:write',
    'catalog:read', 'catalog:write', 'catalog:publish', 'catalog:import',
    'catalog:history', 'prices:read', 'prices:write', 'keys:write', 'storefront'
  ]::text[]);

CREATE OR REPLACE FUNCTION papel_ambitos(p_papel text) RETURNS text[]
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT CASE p_papel
    WHEN 'dono' THEN ARRAY['catalog:history', 'catalog:import', 'catalog:publish',
                           'catalog:read', 'catalog:write', 'keys:write',
                           'merchant:read', 'merchant:write', 'prices:read',
                           'prices:write']
    WHEN 'gestor' THEN ARRAY['catalog:history', 'catalog:import', 'catalog:publish',
                             'catalog:read', 'catalog:write', 'merchant:read',
                             'prices:read', 'prices:write']
    WHEN 'armazem' THEN ARRAY['catalog:read', 'prices:read']
    WHEN 'apoio' THEN ARRAY['catalog:read', 'merchant:read', 'prices:read']
  END::text[]
$$;
