-- A peça 21 da Fase 1: as tarefas das filas que pedem uma pessoa (docs/33;
-- decisão DW; Diogo, 11/10/2026: «sim, aprovo o desenho com as sete filas»;
-- issue #366). Ex.: um documento retido há 3 dias por falta de emissor
-- aparece em `tarefas_casos()` como fila `documento_fiscal`, motivo
-- `emissor_por_configurar`, sem responsável e vencido (o prazo por omissão é
-- de 2 dias); quando alguém o liberta, sai da lista sozinho.
--
-- O que esta migração faz:
-- - a lista das sete filas, com o âmbito que lê e o que decide cada uma, num
--   sítio só (`tarefas_filas()`); o espelho em TypeScript é conferido por um
--   teste;
-- - uma função por domínio que devolve os seus casos abertos
--   (`<dominio>_casos_a_decidir()`), lida com o RLS de quem chama; o domínio
--   das tarefas só lê estas funções, nunca escreve nas tabelas das filas
--   (docs/33 §3, forma B);
-- - «na fila desde» nos três casos que podem voltar à fila (o documento, o
--   par de duplicados e o reembolso), posto pelo gatilho do próprio domínio;
--   uma passagem nova é uma atribuição nova (R9). As linhas que já estavam na
--   fila antes desta migração tiram a hora do rasto ou da última mudança, e
--   essa hora fica guardada à primeira mudança (não se reescreve passado);
-- - a atribuição (`atribuicao`: responsável, prazo, aviso, versão) e o rasto
--   dela (`atribuicao_rasto`, só se acrescenta, com o contexto da transacção
--   pelo gatilho comum `rasto_completar()`); cada linha do rasto põe o evento
--   na `evento_saida`;
-- - as escritas por funções do dono: atribuir ou tirar (R3, R7), mudar o
--   prazo (R5) e marcar o aviso de vencido (R6); quem sai da equipa ou muda
--   para um papel que não decide a fila deixa de ser responsável (R8);
-- - o âmbito `tasks:assign` (dono e gestor).
--
-- Não faz: o ecrã do Hub (parte 2), o e-mail do aviso (Notificações), nem
-- ligar o motivo de uma mudança de prazo ao apagamento do titular (docs/23
-- §15, decisão DU, ainda sem código).

SET LOCAL lock_timeout = '10s';

-- --------------------------------------------------------------- As filas

-- A régua das filas (docs/33 §1): a fila, o âmbito que a lê e o que a decide.
-- Uma fila nova acrescenta-se aqui, na sua função de casos e no
-- `tarefas_casos()`.
CREATE FUNCTION tarefas_filas()
  RETURNS TABLE (fila text, ambito_ler text, ambito_decidir text)
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  VALUES ('pagamento', 'payments:read', 'payments:resolve'),
         ('documento_fiscal', 'invoices:read', 'invoices:write'),
         ('duplicado_cliente', 'customers:read', 'customers:merge'),
         ('prazo_reembolso', 'returns:read', 'refunds:write'),
         ('livre_resolucao', 'returns:read', 'returns:write'),
         ('problema', 'returns:read', 'refunds:write'),
         ('reembolso', 'refunds:read', 'refunds:write')
$$;

-- O prazo por omissão (R4; proposta de funcionamento, **não é lei**): 1 dia
-- nas diferenças dos pagamentos e nos reembolsos, 2 nos documentos, nos
-- pedidos fora de prazo e nos problemas, 7 nos duplicados; onde há prazo
-- legal, o fim desse dia no fuso do comerciante, e nunca depois dele.
CREATE FUNCTION tarefas_prazo_por_omissao(p_fila text, p_entrou timestamptz,
                                          p_prazo_legal date, p_fuso text)
  RETURNS timestamptz
  LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT CASE p_fila
    WHEN 'pagamento' THEN p_entrou + interval '1 day'
    WHEN 'documento_fiscal' THEN p_entrou + interval '2 days'
    WHEN 'duplicado_cliente' THEN p_entrou + interval '7 days'
    WHEN 'prazo_reembolso' THEN x.fim
    WHEN 'livre_resolucao' THEN coalesce(x.fim, p_entrou + interval '2 days')
    WHEN 'problema' THEN p_entrou + interval '2 days'
    -- `least` ignora o nulo: sem prazo legal, 1 dia.
    WHEN 'reembolso' THEN least(p_entrou + interval '1 day', x.fim)
  END
  FROM (SELECT CASE WHEN p_prazo_legal IS NULL THEN NULL
          ELSE ((p_prazo_legal + 1)::timestamp AT TIME ZONE p_fuso) END AS fim) x
$$;

-- ---------------------------------------------------- «Na fila desde»

-- O documento está na fila de uma pessoa: retido, divergente, ou incerto
-- entregue a uma pessoa (`reconciliacao_manual`, docs/29 §12).
CREATE FUNCTION documento_na_fila(p_estado text, p_motivos text[]) RETURNS boolean
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT p_estado IN ('retido', 'divergente')
    OR (p_estado = 'incerto' AND 'reconciliacao_manual' = ANY (p_motivos))
$$;

-- Antes desta migração não se guardava: a última entrada no rasto do
-- documento para um estado da fila, ou a criação.
CREATE FUNCTION documento_na_fila_antes(p_documento uuid, p_criado timestamptz)
  RETURNS timestamptz
  LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT coalesce((SELECT max(r.em) FROM public.documento_rasto r
                   WHERE r.documento_id = p_documento
                     AND r.para IN ('retido', 'incerto', 'divergente')), p_criado)
$$;

ALTER TABLE documento_fiscal ADD COLUMN na_fila_desde timestamptz;
CREATE FUNCTION documento_fila_desde() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NOT public.documento_na_fila(NEW.estado, NEW.motivos) THEN
    NEW.na_fila_desde := NULL;
  ELSIF TG_OP = 'INSERT' OR NOT public.documento_na_fila(OLD.estado, OLD.motivos) THEN
    NEW.na_fila_desde := now();
  ELSE
    -- Continua na fila: a mesma passagem.
    NEW.na_fila_desde := coalesce(OLD.na_fila_desde,
      public.documento_na_fila_antes(OLD.id, OLD.criado_em));
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER documento_fiscal_na_fila BEFORE INSERT OR UPDATE ON documento_fiscal
  FOR EACH ROW EXECUTE FUNCTION documento_fila_desde();

ALTER TABLE duplicado_cliente ADD COLUMN por_decidir_desde timestamptz;
CREATE FUNCTION duplicado_fila_desde() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.estado <> 'por_decidir' THEN
    NEW.por_decidir_desde := NULL;
  ELSIF TG_OP = 'INSERT' OR OLD.estado <> 'por_decidir' THEN
    -- Novo, ou reaberto por um sinal novo (0046).
    NEW.por_decidir_desde := now();
  ELSE
    NEW.por_decidir_desde := coalesce(OLD.por_decidir_desde, OLD.actualizado_em);
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER duplicado_cliente_na_fila BEFORE INSERT OR UPDATE ON duplicado_cliente
  FOR EACH ROW EXECUTE FUNCTION duplicado_fila_desde();

ALTER TABLE reembolso ADD COLUMN na_fila_desde timestamptz;
CREATE FUNCTION reembolso_fila_desde() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.estado NOT IN ('incerto', 'falhado') THEN
    NEW.na_fila_desde := NULL;
  ELSIF TG_OP = 'INSERT' OR OLD.estado NOT IN ('incerto', 'falhado') THEN
    NEW.na_fila_desde := now();
  ELSE
    NEW.na_fila_desde := coalesce(OLD.na_fila_desde, OLD.criado_em);
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER reembolso_na_fila BEFORE INSERT OR UPDATE ON reembolso
  FOR EACH ROW EXECUTE FUNCTION reembolso_fila_desde();

-- ------------------------------------- Os casos abertos de cada domínio

-- Cada função lê com o RLS de quem chama (o comerciante do contexto): o caso,
-- quando entrou nesta passagem, o motivo (da lista de valores da fila, nunca
-- dados pessoais), o prazo legal onde o há e a encomenda, se houver.

CREATE FUNCTION pagamentos_casos_a_decidir()
  RETURNS TABLE (caso uuid, entrou_em timestamptz, motivo text, prazo_legal date,
                 encomenda uuid)
  LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT d.id, d.criada_em, d.motivo, NULL::date, p.encomenda_id
  FROM public.diferenca_pagamento d
  LEFT JOIN public.pagamento p ON p.id = d.pagamento_id
  WHERE d.estado = 'aberta'
$$;

CREATE FUNCTION documentos_casos_a_decidir()
  RETURNS TABLE (caso uuid, entrou_em timestamptz, motivo text, prazo_legal date,
                 encomenda uuid)
  LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT d.id,
    coalesce(d.na_fila_desde, public.documento_na_fila_antes(d.id, d.criado_em)),
    CASE WHEN d.estado = 'retido' THEN array_to_string(d.motivos, ',')
         WHEN d.estado = 'incerto' THEN 'reconciliacao_manual'
         ELSE d.estado END,
    NULL::date, d.encomenda_id
  FROM public.documento_fiscal d
  WHERE public.documento_na_fila(d.estado, d.motivos)
$$;

CREATE FUNCTION clientes_casos_a_decidir()
  RETURNS TABLE (caso uuid, entrou_em timestamptz, motivo text, prazo_legal date,
                 encomenda uuid)
  LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  -- Só o tipo dos sinais, nunca o valor (0046, R12).
  SELECT d.id, coalesce(d.por_decidir_desde, d.actualizado_em),
    array_to_string(d.sinais, ','), NULL::date, NULL::uuid
  FROM public.duplicado_cliente d
  WHERE d.estado = 'por_decidir'
$$;

-- A pós-venda tem quatro filas: o prazo do reembolso (as devoluções de um
-- pedido feito no prazo, ainda à espera; docs/30 §14, A1), o pedido de livre
-- resolução pendente ou fora de prazo, o problema aberto e o reembolso
-- incerto ou falhado. O pedido pendente corre o prazo legal desde que foi
-- recebido (docs/33 §2: hoje sem aviso).
CREATE FUNCTION posvenda_casos_a_decidir()
  RETURNS TABLE (fila text, caso uuid, entrou_em timestamptz, motivo text,
                 prazo_legal date, encomenda uuid)
  LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT 'prazo_reembolso', d.id, d.criada_em, d.estado, x.ate, d.encomenda_id
  FROM public.devolucao d
  CROSS JOIN LATERAL public.posvenda_prazo_da_devolucao(d.id) x
  WHERE d.pedido_livre_resolucao_id IS NOT NULL
    AND d.estado NOT IN ('fechada', 'cancelada') AND x.ate IS NOT NULL
  UNION ALL
  SELECT 'livre_resolucao', p.id, p.recebido_em, p.estado,
    CASE WHEN p.estado = 'pendente'
      THEN public.posvenda_reembolsar_ate(p.recebido_em, c.fuso) END,
    p.encomenda_id
  FROM public.pedido_livre_resolucao p
  JOIN public.comerciante c ON c.id = p.comerciante_id
  WHERE p.estado IN ('pendente', 'fora_de_prazo')
  UNION ALL
  SELECT 'problema', b.id, b.criado_em, b.tipo, NULL::date, b.encomenda_id
  FROM public.problema b
  WHERE b.estado = 'aberto'
  UNION ALL
  SELECT 'reembolso', r.id, coalesce(r.na_fila_desde, r.criado_em), r.estado,
    (SELECT x.ate FROM public.posvenda_prazo_da_devolucao(r.devolucao_id) x),
    r.encomenda_id
  FROM public.reembolso r
  WHERE r.estado IN ('incerto', 'falhado')
$$;

-- --------------------------------------------------------- A atribuição

-- Uma atribuição por passagem de um caso pela fila (R9): o responsável, o
-- prazo (vazio = o por omissão) e o aviso de vencido. A `versao` conta as
-- mudanças de responsável e de prazo (R7): o aviso não a muda, para não
-- fazer falhar quem estava a atribuir. Nasce com 0 quando a cria o aviso.
CREATE TABLE atribuicao (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  fila text NOT NULL CHECK (fila IN ('pagamento', 'documento_fiscal', 'duplicado_cliente',
    'prazo_reembolso', 'livre_resolucao', 'problema', 'reembolso')),
  caso uuid NOT NULL,
  entrou_em timestamptz NOT NULL,
  responsavel uuid REFERENCES pessoa (id),
  prazo timestamptz,
  aviso_vencido_em timestamptz,
  versao integer NOT NULL DEFAULT 1 CHECK (versao >= 0),
  criada_em timestamptz NOT NULL DEFAULT now(),
  actualizada_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (comerciante_id, id),
  UNIQUE (comerciante_id, fila, caso, entrou_em)
);
CREATE INDEX atribuicao_por_responsavel ON atribuicao (comerciante_id, responsavel)
  WHERE responsavel IS NOT NULL;

-- O rasto da atribuição: só se acrescenta (regra 3), com o contexto da
-- transacção pelo gatilho comum (docs/28 §3.1).
CREATE TABLE atribuicao_rasto (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  atribuicao_id uuid NOT NULL,
  acto text NOT NULL CHECK (acto IN ('atribuida', 'retirada', 'prazo_mudado', 'vencida')),
  responsavel_antes uuid,
  responsavel_depois uuid,
  prazo_antes timestamptz,
  prazo_depois timestamptz,
  motivo text CHECK (motivo IS NULL OR length(btrim(motivo)) BETWEEN 1 AND 500),
  quem text NOT NULL CHECK (length(btrim(quem)) BETWEEN 1 AND 200),
  em timestamptz NOT NULL DEFAULT clock_timestamp(),
  canal text,
  pedido text,
  ia jsonb,
  autorizado_por text,
  a_pedido_de jsonb,
  FOREIGN KEY (comerciante_id, atribuicao_id) REFERENCES atribuicao (comerciante_id, id)
);
CREATE INDEX atribuicao_rasto_por_atribuicao ON atribuicao_rasto (atribuicao_id, em);

CREATE TRIGGER rasto_completar BEFORE INSERT ON atribuicao_rasto
  FOR EACH ROW EXECUTE FUNCTION rasto_completar();
CREATE TRIGGER atribuicao_rasto_so_se_acrescenta BEFORE UPDATE OR DELETE ON atribuicao_rasto
  FOR EACH ROW EXECUTE FUNCTION rasto_so_se_acrescenta();
CREATE TRIGGER atribuicao_rasto_sem_truncate BEFORE TRUNCATE ON atribuicao_rasto
  FOR EACH STATEMENT EXECUTE FUNCTION rasto_so_se_acrescenta();
ALTER TABLE atribuicao_rasto ENABLE ALWAYS TRIGGER atribuicao_rasto_so_se_acrescenta;
ALTER TABLE atribuicao_rasto ENABLE ALWAYS TRIGGER atribuicao_rasto_sem_truncate;

-- Cada linha do rasto põe o evento (docs/33 §7): só identificadores, a fila
-- e o prazo; nunca dados pessoais.
CREATE FUNCTION atribuicao_evento() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  a public.atribuicao;
BEGIN
  SELECT x.* INTO a FROM public.atribuicao x WHERE x.id = NEW.atribuicao_id;
  INSERT INTO public.evento_saida (comerciante_id, tipo, agregado_tipo, agregado_id, dados)
  VALUES (NEW.comerciante_id,
    CASE NEW.acto WHEN 'atribuida' THEN 'task.assigned'
                  WHEN 'retirada' THEN 'task.unassigned'
                  WHEN 'prazo_mudado' THEN 'task.deadline_changed'
                  WHEN 'vencida' THEN 'task.overdue' END,
    'atribuicao', NEW.atribuicao_id,
    jsonb_build_object('fila', a.fila, 'caso', a.caso,
      'responsavel', CASE WHEN a.responsavel IS NULL THEN NULL
                          ELSE 'per_' || a.responsavel::text END,
      'prazo', to_char(coalesce(NEW.prazo_depois, a.prazo) AT TIME ZONE 'UTC',
                       'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'em', to_char(NEW.em AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
  RETURN NULL;
END
$$;
CREATE TRIGGER atribuicao_evento AFTER INSERT ON atribuicao_rasto
  FOR EACH ROW EXECUTE FUNCTION atribuicao_evento();
ALTER TABLE atribuicao_rasto ENABLE ALWAYS TRIGGER atribuicao_evento;

-- A API lê as duas: o RLS forçado, como as outras tabelas do produto (0001).
-- As funções do dono correm sempre com o comerciante no contexto; a que serve
-- quem sai da equipa (R8) põe-no ela própria.
DO $$
DECLARE
  tabela text;
BEGIN
  FOREACH tabela IN ARRAY ARRAY['atribuicao', 'atribuicao_rasto'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tabela);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tabela);
    EXECUTE format(
      'CREATE POLICY so_o_proprio ON %I USING (comerciante_id = comerciante_actual()) WITH CHECK (comerciante_id = comerciante_actual())',
      tabela);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC', tabela);
  END LOOP;
END
$$;
GRANT SELECT ON atribuicao, atribuicao_rasto TO eurolify_api;

-- ----------------------------------------------------- A lista comum

-- Os casos abertos das filas pedidas, no comerciante do contexto, com a
-- atribuição da passagem (se houver) e o prazo em vigor. «Vencida» calcula-se
-- (docs/33 §4.2): não há estado guardado.
CREATE FUNCTION tarefas_casos(p_filas text[])
  RETURNS TABLE (fila text, caso uuid, entrou_em timestamptz, motivo text,
                 prazo_legal date, encomenda uuid, atribuicao uuid, responsavel uuid,
                 prazo timestamptz, prazo_definido boolean, vencida boolean,
                 aviso_vencido_em timestamptz, versao integer)
  LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  WITH casos AS (
    SELECT 'pagamento'::text AS fila, x.* FROM public.pagamentos_casos_a_decidir() x
    WHERE 'pagamento' = ANY (p_filas)
    UNION ALL
    SELECT 'documento_fiscal', x.* FROM public.documentos_casos_a_decidir() x
    WHERE 'documento_fiscal' = ANY (p_filas)
    UNION ALL
    SELECT 'duplicado_cliente', x.* FROM public.clientes_casos_a_decidir() x
    WHERE 'duplicado_cliente' = ANY (p_filas)
    UNION ALL
    SELECT x.* FROM public.posvenda_casos_a_decidir() x
    WHERE p_filas && ARRAY['prazo_reembolso', 'livre_resolucao', 'problema', 'reembolso']
      AND x.fila = ANY (p_filas)
  )
  SELECT k.fila, k.caso, k.entrou_em, k.motivo, k.prazo_legal, k.encomenda,
    a.id, a.responsavel, p.prazo, a.prazo IS NOT NULL, p.prazo <= now(),
    a.aviso_vencido_em, coalesce(a.versao, 0)
  FROM casos k
  CROSS JOIN (SELECT c.fuso FROM public.comerciante c
              WHERE c.id = public.comerciante_actual()) f
  LEFT JOIN public.atribuicao a
    ON a.comerciante_id = public.comerciante_actual() AND a.fila = k.fila
   AND a.caso = k.caso AND a.entrou_em = k.entrou_em
  CROSS JOIN LATERAL (SELECT coalesce(a.prazo,
    public.tarefas_prazo_por_omissao(k.fila, k.entrou_em, k.prazo_legal, f.fuso)) AS prazo) p
$$;

-- A pessoa pode decidir a fila neste comerciante (R3): membro activo, pessoa
-- activa e o âmbito de decidir no papel dela. A base decide; a rota só pede.
CREATE FUNCTION tarefas_pode_decidir(p_pessoa uuid, p_fila text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.membro m
    JOIN public.pessoa p ON p.id = m.pessoa_id
    JOIN public.tarefas_filas() f ON f.fila = p_fila
    WHERE m.comerciante_id = public.comerciante_actual() AND m.pessoa_id = p_pessoa
      AND m.ate IS NULL AND p.estado = 'activa'
      AND f.ambito_decidir = ANY (public.papel_ambitos(m.papel)))
$$;

-- Um caso de cada vez, pela mesma ordem em todo o lado: a tranca dos membros
-- do comerciante (a mesma das mudanças de equipa, 0018) e depois a do caso.
CREATE FUNCTION tarefas_trancar_caso(p_fila text, p_caso uuid) RETURNS void
  LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT public.membros_trancar(public.comerciante_actual());
  SELECT pg_advisory_xact_lock(hashtextextended(
    'atribuicao:' || public.comerciante_actual()::text || ':' || p_fila || ':' || p_caso::text, 0))
$$;

-- Atribuir (ou tirar, com `p_responsavel` nulo) o caso aberto (R3, R7). A
-- versão é a que quem pede leu (0 sem atribuição); outra dá conflito. Devolve
-- a versão nova.
CREATE FUNCTION tarefas_atribuir(p_fila text, p_caso uuid, p_responsavel uuid,
                                 p_versao integer, p_quem text)
  RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  c record;
  nova integer;
  id_atr uuid;
BEGIN
  PERFORM public.tarefas_trancar_caso(p_fila, p_caso);
  SELECT x.* INTO c FROM public.tarefas_casos(ARRAY[p_fila]) x WHERE x.caso = p_caso;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tasks.not_found: o caso não está aberto nesta fila';
  END IF;
  IF c.versao <> p_versao THEN
    RAISE EXCEPTION 'tasks.version_conflict: a versão é %, não %', c.versao, p_versao;
  END IF;
  IF p_responsavel IS NOT NULL AND NOT public.tarefas_pode_decidir(p_responsavel, p_fila) THEN
    RAISE EXCEPTION 'tasks.assignee_not_allowed: a pessoa não pode decidir esta fila';
  END IF;
  IF c.responsavel IS NOT DISTINCT FROM p_responsavel THEN
    RETURN c.versao;
  END IF;
  IF c.atribuicao IS NULL THEN
    INSERT INTO public.atribuicao (comerciante_id, fila, caso, entrou_em, responsavel)
    VALUES (public.comerciante_actual(), p_fila, p_caso, c.entrou_em, p_responsavel)
    RETURNING id, versao INTO id_atr, nova;
  ELSE
    UPDATE public.atribuicao a SET responsavel = p_responsavel, versao = a.versao + 1,
      actualizada_em = now()
    WHERE a.id = c.atribuicao AND a.comerciante_id = public.comerciante_actual()
    RETURNING a.id, a.versao INTO id_atr, nova;
  END IF;
  INSERT INTO public.atribuicao_rasto (comerciante_id, atribuicao_id, acto,
    responsavel_antes, responsavel_depois, quem)
  VALUES (public.comerciante_actual(), id_atr,
    CASE WHEN p_responsavel IS NULL THEN 'retirada' ELSE 'atribuida' END,
    c.responsavel, p_responsavel, p_quem);
  RETURN nova;
END
$$;

-- Mudar o prazo (R5): com motivo, nunca no passado e nunca depois do prazo
-- legal. Um prazo novo permite um aviso novo (R6).
CREATE FUNCTION tarefas_mudar_prazo(p_fila text, p_caso uuid, p_prazo timestamptz,
                                    p_motivo text, p_versao integer, p_quem text)
  RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  c record;
  fim timestamptz;
  nova integer;
  id_atr uuid;
BEGIN
  IF p_motivo IS NULL OR length(btrim(p_motivo)) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'tasks.reason_required: mudar o prazo pede o motivo';
  END IF;
  PERFORM public.tarefas_trancar_caso(p_fila, p_caso);
  SELECT x.* INTO c FROM public.tarefas_casos(ARRAY[p_fila]) x WHERE x.caso = p_caso;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tasks.not_found: o caso não está aberto nesta fila';
  END IF;
  IF c.versao <> p_versao THEN
    RAISE EXCEPTION 'tasks.version_conflict: a versão é %, não %', c.versao, p_versao;
  END IF;
  IF p_prazo IS NULL OR p_prazo <= now() THEN
    RAISE EXCEPTION 'tasks.deadline_invalid: o prazo não pode ficar no passado';
  END IF;
  IF c.prazo_legal IS NOT NULL THEN
    SELECT (c.prazo_legal + 1)::timestamp AT TIME ZONE x.fuso INTO fim
    FROM public.comerciante x WHERE x.id = public.comerciante_actual();
    IF p_prazo > fim THEN
      RAISE EXCEPTION 'tasks.deadline_invalid: o prazo não passa do prazo legal (%)', c.prazo_legal;
    END IF;
  END IF;
  IF c.atribuicao IS NULL THEN
    INSERT INTO public.atribuicao (comerciante_id, fila, caso, entrou_em, prazo)
    VALUES (public.comerciante_actual(), p_fila, p_caso, c.entrou_em, p_prazo)
    RETURNING id, versao INTO id_atr, nova;
  ELSE
    UPDATE public.atribuicao a SET prazo = p_prazo, aviso_vencido_em = NULL,
      versao = a.versao + 1, actualizada_em = now()
    WHERE a.id = c.atribuicao AND a.comerciante_id = public.comerciante_actual()
    RETURNING a.id, a.versao INTO id_atr, nova;
  END IF;
  INSERT INTO public.atribuicao_rasto (comerciante_id, atribuicao_id, acto,
    prazo_antes, prazo_depois, motivo, quem)
  VALUES (public.comerciante_actual(), id_atr, 'prazo_mudado', c.prazo, p_prazo,
    btrim(p_motivo), p_quem);
  RETURN nova;
END
$$;

-- --------------------------------------------- O aviso de hora a hora

-- Os comerciantes com equipa (sem equipa não há a quem avisar). A tabela dos
-- membros não tem o RLS forçado (0018): o dono lê-a.
CREATE FUNCTION tarefas_comerciantes() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT DISTINCT m.comerciante_id FROM public.membro m WHERE m.ate IS NULL ORDER BY 1
$$;

-- Os vencidos ainda sem aviso, no comerciante do contexto, os mais antigos
-- primeiro. O prazo do reembolso fica de fora: tem os avisos da pós-venda
-- (0063), e não sai um segundo (R6).
CREATE FUNCTION tarefas_por_avisar(p_limite integer)
  RETURNS TABLE (fila text, caso uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT x.fila, x.caso
  FROM public.tarefas_casos(ARRAY(SELECT f.fila FROM public.tarefas_filas() f
                                  WHERE f.fila <> 'prazo_reembolso')) x
  WHERE x.vencida AND x.aviso_vencido_em IS NULL
  ORDER BY x.prazo, x.fila, x.caso
  LIMIT greatest(p_limite, 0)
$$;

-- Marca o aviso de um caso vencido, uma vez por prazo; falso se já não é hora
-- (decidido, prazo mudado, ou outra volta ao mesmo tempo).
CREATE FUNCTION tarefas_marcar_vencida(p_fila text, p_caso uuid, p_quem text)
  RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  c record;
  id_atr uuid;
BEGIN
  IF p_fila = 'prazo_reembolso' THEN
    RETURN false;
  END IF;
  PERFORM public.tarefas_trancar_caso(p_fila, p_caso);
  SELECT x.* INTO c FROM public.tarefas_casos(ARRAY[p_fila]) x WHERE x.caso = p_caso;
  IF NOT FOUND OR NOT c.vencida OR c.aviso_vencido_em IS NOT NULL THEN
    RETURN false;
  END IF;
  IF c.atribuicao IS NULL THEN
    INSERT INTO public.atribuicao (comerciante_id, fila, caso, entrou_em, versao,
      aviso_vencido_em)
    VALUES (public.comerciante_actual(), p_fila, p_caso, c.entrou_em, 0, now())
    RETURNING id INTO id_atr;
  ELSE
    UPDATE public.atribuicao a SET aviso_vencido_em = now(), actualizada_em = now()
    WHERE a.id = c.atribuicao AND a.comerciante_id = public.comerciante_actual()
    RETURNING a.id INTO id_atr;
  END IF;
  INSERT INTO public.atribuicao_rasto (comerciante_id, atribuicao_id, acto, prazo_depois, quem)
  VALUES (public.comerciante_actual(), id_atr, 'vencida', c.prazo, p_quem);
  RETURN true;
END
$$;

-- ------------------------------------ Quem sai da equipa ou muda de papel

-- R8: deixa de ser responsável dos casos abertos das filas que já não pode
-- decidir, na mesma transacção, com o rasto e o evento. Serve as três
-- portas (mudar de papel, sair, ser desactivado pelo operador): corre como
-- o dono e põe o comerciante do membro só enquanto trabalha.
CREATE FUNCTION membro_tarefas_largar() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  anterior text := pg_catalog.current_setting('eurolify.comerciante', true);
  saiu boolean := OLD.ate IS NULL AND NEW.ate IS NOT NULL;
  quem text;
  a record;
BEGIN
  IF NOT saiu AND NEW.papel IS NOT DISTINCT FROM OLD.papel THEN
    RETURN NULL;
  END IF;
  -- O RLS da atribuição é forçado: o comerciante do membro antes de a ler
  -- (o operador que desactiva uma pessoa não tem nenhum).
  PERFORM pg_catalog.set_config('eurolify.comerciante', NEW.comerciante_id::text, true);
  IF NOT EXISTS (SELECT 1 FROM public.atribuicao x
                 WHERE x.comerciante_id = NEW.comerciante_id AND x.responsavel = NEW.pessoa_id) THEN
    PERFORM pg_catalog.set_config('eurolify.comerciante', coalesce(anterior, ''), true);
    RETURN NULL;
  END IF;
  quem := coalesce(NEW.terminado_por,
    nullif(btrim(pg_catalog.current_setting('eurolify.quem', true)), ''), 'sistema:equipa');
  FOR a IN SELECT x.id FROM public.atribuicao x
           JOIN public.tarefas_casos(ARRAY(SELECT f.fila FROM public.tarefas_filas() f)) k
             ON k.atribuicao = x.id
           WHERE x.comerciante_id = NEW.comerciante_id AND x.responsavel = NEW.pessoa_id
             AND (saiu OR NOT EXISTS (
               SELECT 1 FROM public.tarefas_filas() f
               WHERE f.fila = x.fila AND f.ambito_decidir = ANY (public.papel_ambitos(NEW.papel))))
           ORDER BY x.id
           FOR UPDATE OF x LOOP
    UPDATE public.atribuicao x SET responsavel = NULL, versao = x.versao + 1,
      actualizada_em = now()
    WHERE x.id = a.id;
    INSERT INTO public.atribuicao_rasto (comerciante_id, atribuicao_id, acto,
      responsavel_antes, motivo, quem)
    VALUES (NEW.comerciante_id, a.id, 'retirada', NEW.pessoa_id,
      CASE WHEN saiu THEN 'saiu da equipa' ELSE 'mudou para um papel que não decide esta fila' END,
      quem);
  END LOOP;
  PERFORM pg_catalog.set_config('eurolify.comerciante', coalesce(anterior, ''), true);
  RETURN NULL;
END
$$;
CREATE TRIGGER membro_tarefas_largar AFTER UPDATE OF ate, papel ON membro
  FOR EACH ROW EXECUTE FUNCTION membro_tarefas_largar();

-- ------------------------------------------------- O âmbito tasks:assign

ALTER TABLE chave_api DROP CONSTRAINT chave_api_ambitos_validos;
ALTER TABLE chave_api ADD CONSTRAINT chave_api_ambitos_validos CHECK (
  cardinality(ambitos) BETWEEN 1 AND 60
  AND ambitos <@ ARRAY[
    'merchant:read', 'merchant:write',
    'catalog:read', 'catalog:write', 'catalog:publish', 'catalog:import',
    'catalog:history', 'prices:read', 'prices:write', 'prices:history',
    'customers:read', 'customers:write', 'customers:billing',
    'customers:exemptions', 'customers:merge', 'customers:privacy', 'tax:read', 'tax:write',
    'legal:read', 'legal:write', 'shipping:read', 'shipping:write', 'orders:read',
    'payments:read', 'payments:write', 'payments:accounts', 'payments:resolve',
    'inventory:read', 'inventory:write', 'inventory:policy', 'fulfilment:read',
    'fulfilment:write', 'invoices:read', 'invoices:write', 'invoices:accounts',
    'returns:read', 'returns:write', 'refunds:read', 'refunds:write',
    'tasks:assign', 'keys:write', 'storefront'
  ]::text[]);

CREATE OR REPLACE FUNCTION papel_ambitos(p_papel text) RETURNS text[]
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  -- Por ordem alfabética, como em src/identidade/papeis.ts. Como a 0059, mais
  -- o tasks:assign no dono e no gestor (docs/33 R3; decisão DW).
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
                  'payments:write', 'prices:history', 'prices:read', 'prices:write', 'refunds:read',
                  'refunds:write', 'returns:read', 'returns:write', 'shipping:read',
                  'shipping:write', 'tasks:assign', 'tax:read', 'tax:write']
    WHEN 'gestor' THEN ARRAY['catalog:history', 'catalog:import', 'catalog:publish',
                  'catalog:read', 'catalog:write', 'customers:merge', 'customers:read',
                  'customers:write', 'fulfilment:read', 'fulfilment:write',
                  'inventory:policy', 'inventory:read', 'inventory:write',
                  'invoices:read', 'invoices:write', 'legal:read', 'merchant:read',
                  'orders:read', 'payments:read', 'payments:write', 'prices:history', 'prices:read',
                  'prices:write', 'refunds:read', 'refunds:write', 'returns:read',
                  'returns:write', 'shipping:read', 'shipping:write', 'tasks:assign', 'tax:read']
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

-- ------------------------------------------------------------ Permissões

REVOKE EXECUTE ON FUNCTION tarefas_filas(),
  tarefas_prazo_por_omissao(text, timestamptz, date, text),
  documento_na_fila(text, text[]), documento_na_fila_antes(uuid, timestamptz),
  documento_fila_desde(), duplicado_fila_desde(), reembolso_fila_desde(),
  pagamentos_casos_a_decidir(), documentos_casos_a_decidir(), clientes_casos_a_decidir(),
  posvenda_casos_a_decidir(), atribuicao_evento(), tarefas_casos(text[]),
  tarefas_pode_decidir(uuid, text), tarefas_trancar_caso(text, uuid),
  tarefas_atribuir(text, uuid, uuid, integer, text),
  tarefas_mudar_prazo(text, uuid, timestamptz, text, integer, text),
  tarefas_comerciantes(), tarefas_por_avisar(integer),
  tarefas_marcar_vencida(text, uuid, text), membro_tarefas_largar() FROM PUBLIC;
-- Os gatilhos «na fila desde» chamam estas com os privilégios de quem escreve
-- no documento: a API e a limpeza.
GRANT EXECUTE ON FUNCTION documento_na_fila(text, text[]),
  documento_na_fila_antes(uuid, timestamptz) TO eurolify_api, eurolify_limpeza;
GRANT EXECUTE ON FUNCTION tarefas_filas(),
  tarefas_prazo_por_omissao(text, timestamptz, date, text),
  pagamentos_casos_a_decidir(), documentos_casos_a_decidir(), clientes_casos_a_decidir(),
  posvenda_casos_a_decidir(), tarefas_casos(text[]),
  tarefas_atribuir(text, uuid, uuid, integer, text),
  tarefas_mudar_prazo(text, uuid, timestamptz, text, integer, text),
  tarefas_comerciantes(), tarefas_por_avisar(integer),
  tarefas_marcar_vencida(text, uuid, text) TO eurolify_api;
