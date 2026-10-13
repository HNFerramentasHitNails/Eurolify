-- O prazo de resposta a um pedido do titular, parte 1 (docs/23 §15.14, T1–T4,
-- T6 e T7; Diogo, 13/10/2026: Q-P1 «A» e Q-P2 «A»; docs/06, EO). Ex.: a Ana
-- escreve a 2/10 a pedir o apagamento; o dono regista a chegada na ficha
-- dela; o prazo legal fica a 2/11, o caso entra na fila `pedido_titular` do
-- «A decidir» com o prazo da tarefa a 27/10 e sai quando o apagamento
-- executado se liga ao pedido recebido.
--
-- A lei (RGPD, art. 12.º, n.os 3 e 4 — `eur-lex`
-- `corpus/dados-e-privacidade/32016R0679-rgpd.md`, versão consolidada
-- 02016R0679-20160504, obtido_em 2026-10-12): responde-se «no prazo de um mês
-- a contar da data de receção do pedido» (W); o prazo «pode ser prorrogado
-- até dois meses», informando o titular dentro do primeiro mês (W quanto à
-- obrigação; C quanto à conta do máximo, ver abaixo). A oposição (art. 21.º)
-- segue o mesmo mês por proposta nossa (C, jurista).
--
-- O que esta migração faz:
-- - `pedido_titular_recebido` (`prq_`): o tipo, o canal (sem texto livre), o
--   dia em que chegou, o prazo legal (guardado, calculado aqui), a
--   prorrogação (uma vez, com motivo curto e o dia em que o titular foi
--   informado), o fim (executado, respondido ou recusado, com o dia) e quem
--   registou. Só se regista numa ficha activa (T6; Q-P2). Não se apaga; a
--   pseudonimização não lhe toca (T7: é a prova de que se respondeu);
-- - as funções da API: registar, prorrogar e fechar (do dono, como as da
--   0049; a API só lê a tabela);
-- - a nona fila do «A decidir», `pedido_titular` (T4): lê e decide
--   `customers:privacy` (só o dono); o prazo da tarefa por omissão é 7 dias
--   antes do fim do prazo legal (proposta, **não é lei**), nunca antes de o
--   caso entrar. A régua, o prazo, a lista comum e a restrição da atribuição
--   passam a ter as nove (`tarefas_filas()`, `tarefas_prazo_por_omissao()`,
--   `tarefas_casos()` e `atribuicao.fila`, redefinidas pela última vez na
--   0084).
--
-- O que não faz (parte 2): o segundo aviso, quando o prazo legal passa com o
-- pedido aberto (T5). O aviso da peça 21 (`task.overdue`) ao vencer o prazo
-- da tarefa vem da fila.

SET LOCAL lock_timeout = '10s';

-- ------------------------------------------------------------ A tabela

CREATE TABLE pedido_titular_recebido (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  cliente_id uuid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('acesso', 'apagamento', 'limitacao', 'rectificacao',
    'portabilidade', 'oposicao', 'outro')),
  -- Por onde chegou; sem texto livre, para não entrarem dados novos da pessoa.
  canal text NOT NULL CHECK (canal IN ('email', 'telefone', 'carta', 'presencial', 'loja',
    'outro')),
  recebido_em timestamptz NOT NULL,
  -- O dia em que chegou, no fuso do comerciante, fixado ao registar: a conta
  -- do prazo não muda se o fuso do comerciante mudar depois.
  recebido_dia date NOT NULL,
  -- Um mês no calendário, a contar do dia em que chegou (art. 12.º, n.º 3,
  -- W). A regra vive só aqui: a lista, a fila e a API lêem esta coluna. É o
  -- `+ interval '1 month'` do PostgreSQL: num dia que o mês seguinte não tem,
  -- fica o último dia desse mês (31/01 → 28/02 ou 29/02).
  prazo_legal date GENERATED ALWAYS AS ((recebido_dia + interval '1 month')::date) STORED,
  -- A prorrogação (art. 12.º, n.º 3): até ao dia em que chegou mais dois meses.
  -- **C**: a versão portuguesa diz «até dois meses»; lê-se aqui pela conta
  -- mais curta (dois meses ao todo, não um mais dois) até o jurista confirmar.
  prorrogado_ate date,
  -- Porquê (complexidade, número de pedidos), curto e sem dados da pessoa:
  -- quem escreve não põe aqui o nome, o contacto nem o que pediu.
  prorrogado_motivo text CHECK (length(btrim(prorrogado_motivo)) BETWEEN 1 AND 200),
  -- O dia em que o titular foi informado da prorrogação e dos motivos: dentro
  -- do primeiro mês (art. 12.º, n.º 3, W).
  titular_informado_em date,
  estado text NOT NULL DEFAULT 'aberto'
    CHECK (estado IN ('aberto', 'executado', 'respondido', 'recusado')),
  -- O dia em que se respondeu (executado ou respondido) ou em que se
  -- informou o titular das razões da recusa (n.º 4).
  fechado_em date,
  -- O pedido executado (0049) que responde a este; só no fim `executado`.
  pedido_titular_id uuid REFERENCES pedido_titular (id),
  quem text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (comerciante_id, cliente_id) REFERENCES cliente (comerciante_id, id),
  CONSTRAINT pedido_recebido_prorrogacao_inteira CHECK (
    (prorrogado_ate IS NULL) = (prorrogado_motivo IS NULL)
    AND (prorrogado_ate IS NULL) = (titular_informado_em IS NULL)),
  CONSTRAINT pedido_recebido_prorrogacao_ate_dois_meses CHECK (
    prorrogado_ate > prazo_legal
    AND prorrogado_ate <= (recebido_dia + interval '2 months')::date),
  CONSTRAINT pedido_recebido_informado_no_primeiro_mes CHECK (
    titular_informado_em BETWEEN recebido_dia AND prazo_legal),
  CONSTRAINT pedido_recebido_fecho CHECK (
    (estado = 'aberto') = (fechado_em IS NULL) AND fechado_em >= recebido_dia),
  CONSTRAINT pedido_recebido_executado_com_pedido CHECK (
    (estado = 'executado') = (pedido_titular_id IS NOT NULL))
);
CREATE INDEX pedido_titular_recebido_por_cliente
  ON pedido_titular_recebido (comerciante_id, cliente_id, id);
CREATE INDEX pedido_titular_recebido_abertos
  ON pedido_titular_recebido (comerciante_id) WHERE estado = 'aberto';

-- O dia de hoje no fuso do comerciante.
CREATE FUNCTION clientes_hoje(p_comerciante uuid) RETURNS date
  LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT (now() AT TIME ZONE c.fuso)::date FROM public.comerciante c WHERE c.id = p_comerciante
$$;

-- As mudanças permitidas, para qualquer um (também o dono das tabelas): a
-- prorrogação, uma vez, enquanto o prazo de um mês não passou; o fim,
-- aberto → executado, respondido ou recusado, uma vez. Fechado não muda.
-- Só recusa (é uma guarda): fica `ALWAYS`, como as do rasto (regra da 0091).
CREATE FUNCTION pedido_recebido_antes_de_alterar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  hoje date := public.clientes_hoje(OLD.comerciante_id);
BEGIN
  IF ROW(NEW.id, NEW.comerciante_id, NEW.cliente_id, NEW.tipo, NEW.canal, NEW.recebido_em,
         NEW.recebido_dia, NEW.quem, NEW.criado_em)
     IS DISTINCT FROM ROW(OLD.id, OLD.comerciante_id, OLD.cliente_id, OLD.tipo, OLD.canal,
         OLD.recebido_em, OLD.recebido_dia, OLD.quem, OLD.criado_em) THEN
    RAISE EXCEPTION 'customers.immutable_identity: o pedido recebido não muda de ficha, tipo, canal, data de chegada nem de quem o registou';
  END IF;
  IF OLD.estado <> 'aberto' THEN
    RAISE EXCEPTION 'customers.invalid_transition: o pedido recebido está %; fechado não muda',
      OLD.estado;
  END IF;
  IF ROW(NEW.prorrogado_ate, NEW.prorrogado_motivo, NEW.titular_informado_em)
     IS DISTINCT FROM ROW(OLD.prorrogado_ate, OLD.prorrogado_motivo, OLD.titular_informado_em) THEN
    IF OLD.prorrogado_ate IS NOT NULL THEN
      RAISE EXCEPTION 'customers.invalid_transition: o prazo já foi prorrogado; prorroga-se uma vez';
    END IF;
    IF NEW.estado <> OLD.estado THEN
      RAISE EXCEPTION 'customers.invalid_transition: prorrogar e fechar são dois actos';
    END IF;
    -- A prorrogação comunica-se dentro do primeiro mês (art. 12.º, n.º 3).
    IF hoje > OLD.prazo_legal THEN
      RAISE EXCEPTION 'customers.invalid_transition: o prazo de um mês acabou a %; já não se prorroga',
        OLD.prazo_legal;
    END IF;
    IF NEW.titular_informado_em > hoje THEN
      RAISE EXCEPTION 'customers.invalid_field: o dia em que o titular foi informado não pode ser no futuro';
    END IF;
  END IF;
  IF NEW.estado <> OLD.estado AND NEW.fechado_em > hoje THEN
    RAISE EXCEPTION 'customers.invalid_field: o dia do fim não pode ser no futuro';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER pedido_titular_recebido_antes_de_alterar
  BEFORE UPDATE ON pedido_titular_recebido
  FOR EACH ROW EXECUTE FUNCTION pedido_recebido_antes_de_alterar();
ALTER TABLE pedido_titular_recebido ENABLE ALWAYS TRIGGER pedido_titular_recebido_antes_de_alterar;
-- Não se apaga nem se esvazia: é a prova de que se respondeu (T7).
CREATE TRIGGER pedido_titular_recebido_nao_se_apaga
  BEFORE DELETE ON pedido_titular_recebido
  FOR EACH ROW EXECUTE FUNCTION rasto_so_se_acrescenta();
CREATE TRIGGER pedido_titular_recebido_sem_truncate
  BEFORE TRUNCATE ON pedido_titular_recebido
  FOR EACH STATEMENT EXECUTE FUNCTION rasto_so_se_acrescenta();
ALTER TABLE pedido_titular_recebido ENABLE ALWAYS TRIGGER pedido_titular_recebido_nao_se_apaga;
ALTER TABLE pedido_titular_recebido ENABLE ALWAYS TRIGGER pedido_titular_recebido_sem_truncate;

-- ----------------------------------------------------- As funções da API

-- Quem regista, prorroga ou fecha: o que a API pôs em `eurolify.quem`.
CREATE FUNCTION pedido_recebido_quem() RETURNS text
  LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem text := nullif(btrim(current_setting('eurolify.quem', true)), '');
BEGIN
  IF quem IS NULL THEN
    RAISE EXCEPTION 'customers.change_without_who: um pedido recebido regista-se com quem';
  END IF;
  RETURN quem;
END
$$;

-- T1 e T6: regista a chegada, só numa ficha activa (sem ficha não há registo,
-- Q-P2; numa fundida, pede-se pela que ficou). `p_recebido` nulo é agora;
-- nunca no futuro.
CREATE FUNCTION pedido_recebido_registar(p_cliente uuid, p_tipo text, p_canal text,
  p_recebido timestamptz) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  comerciante uuid := public.comerciante_actual();
  quem text := public.pedido_recebido_quem();
  recebido timestamptz := coalesce(p_recebido, now());
  ficha record;
  fuso text;
  id uuid;
BEGIN
  -- FOR SHARE: espera por uma pseudonimização ou fusão em curso da ficha.
  SELECT c.estado INTO ficha FROM public.cliente c
  WHERE c.comerciante_id = comerciante AND c.id = p_cliente
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'customers.not_found: a ficha não existe';
  END IF;
  IF ficha.estado <> 'activo' THEN
    RAISE EXCEPTION 'customers.invalid_transition: a ficha está %; registe o pedido na ficha que ficou', ficha.estado;
  END IF;
  IF recebido > now() THEN
    RAISE EXCEPTION 'customers.invalid_field: o pedido não pode ter chegado no futuro';
  END IF;
  SELECT c.fuso INTO fuso FROM public.comerciante c WHERE c.id = comerciante;
  INSERT INTO public.pedido_titular_recebido (comerciante_id, cliente_id, tipo, canal,
    recebido_em, recebido_dia, quem)
  VALUES (comerciante, p_cliente, p_tipo, p_canal, recebido, (recebido AT TIME ZONE fuso)::date,
    quem)
  RETURNING pedido_titular_recebido.id INTO id;
  RETURN id;
END
$$;

-- T2: a prorrogação, uma vez, até ao limite (C), com o motivo e o dia em que o
-- titular foi informado. As regras estão na tabela e na guarda.
CREATE FUNCTION pedido_recebido_prorrogar(p_id uuid, p_ate date, p_motivo text,
  p_informado date) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  r record;
BEGIN
  PERFORM public.pedido_recebido_quem();
  SELECT x.prazo_legal, x.recebido_dia INTO r FROM public.pedido_titular_recebido x
  WHERE x.comerciante_id = public.comerciante_actual() AND x.id = p_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'customers.not_found: o pedido recebido não existe';
  END IF;
  -- As mensagens antes das restrições da tabela, que só dizem «não aceite».
  IF p_ate IS NULL OR p_ate <= r.prazo_legal
     OR p_ate > (r.recebido_dia + interval '2 months')::date THEN
    RAISE EXCEPTION 'customers.invalid_field: a prorrogação vai de % a %, no máximo dois meses depois da chegada',
      r.prazo_legal + 1, (r.recebido_dia + interval '2 months')::date;
  END IF;
  IF p_informado IS NULL OR p_informado < r.recebido_dia OR p_informado > r.prazo_legal THEN
    RAISE EXCEPTION 'customers.invalid_field: o titular é informado da prorrogação dentro do primeiro mês (até %)',
      r.prazo_legal;
  END IF;
  IF length(btrim(coalesce(p_motivo, ''))) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'customers.invalid_field: o motivo da prorrogação tem de 1 a 200 caracteres';
  END IF;
  UPDATE public.pedido_titular_recebido x
  SET prorrogado_ate = p_ate, prorrogado_motivo = btrim(p_motivo),
      titular_informado_em = p_informado
  WHERE x.comerciante_id = public.comerciante_actual() AND x.id = p_id;
END
$$;

-- T3: fecha, uma vez. `executado` liga o pedido executado (0049) do mesmo
-- titular: a ficha do pedido recebido, a ficha em que ela foi fundida ou as
-- fundidas nela. Funciona também depois da pseudonimização (o apagamento
-- executado fecha-se depois).
CREATE FUNCTION pedido_recebido_fechar(p_id uuid, p_fim text, p_em date, p_pedido uuid)
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  comerciante uuid := public.comerciante_actual();
  r record;
  topo uuid;
  do_pedido uuid;
BEGIN
  PERFORM public.pedido_recebido_quem();
  SELECT x.cliente_id, x.estado, x.recebido_dia INTO r FROM public.pedido_titular_recebido x
  WHERE x.comerciante_id = comerciante AND x.id = p_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'customers.not_found: o pedido recebido não existe';
  END IF;
  IF r.estado <> 'aberto' THEN
    RAISE EXCEPTION 'customers.invalid_transition: o pedido recebido está %; fechado não muda', r.estado;
  END IF;
  IF p_fim IS NULL OR p_fim NOT IN ('executado', 'respondido', 'recusado') THEN
    RAISE EXCEPTION 'customers.invalid_field: o fim é executado, respondido ou recusado';
  END IF;
  IF (p_fim = 'executado') <> (p_pedido IS NOT NULL) THEN
    RAISE EXCEPTION 'customers.invalid_field: o pedido executado (dsr_…) indica-se só, e sempre, no fim executado';
  END IF;
  IF p_pedido IS NOT NULL THEN
    SELECT p.cliente_id INTO do_pedido FROM public.pedido_titular p
    WHERE p.comerciante_id = comerciante AND p.id = p_pedido;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'customers.not_found: o pedido executado não existe';
    END IF;
    -- A ficha que ficou: sobe pelas fusões até à que não foi fundida.
    WITH RECURSIVE acima (id, fundido_em) AS (
      SELECT c.id, c.fundido_em FROM public.cliente c
      WHERE c.comerciante_id = comerciante AND c.id = r.cliente_id
      UNION
      SELECT c.id, c.fundido_em FROM public.cliente c
      JOIN acima a ON c.comerciante_id = comerciante AND c.id = a.fundido_em)
    SELECT a.id INTO topo FROM acima a WHERE a.fundido_em IS NULL;
    IF NOT do_pedido IN (SELECT public.clientes_do_grupo(topo)) THEN
      RAISE EXCEPTION 'customers.invalid_field: o pedido executado é de outro titular';
    END IF;
  END IF;
  IF p_em IS NULL OR p_em < r.recebido_dia THEN
    RAISE EXCEPTION 'customers.invalid_field: o fim leva o dia, não antes de o pedido chegar (%)',
      r.recebido_dia;
  END IF;
  UPDATE public.pedido_titular_recebido x
  SET estado = p_fim, fechado_em = p_em, pedido_titular_id = p_pedido
  WHERE x.comerciante_id = comerciante AND x.id = p_id;
END
$$;

-- ------------------------------------------------------------ A fila

-- Os casos da fila `pedido_titular` (T4): os pedidos recebidos abertos. O
-- motivo é um código (nunca o tipo nem dados da pessoa); o prazo legal é o
-- que está em vigor (o prorrogado, se houver). Sem encomenda.
CREATE FUNCTION clientes_titular_casos_a_decidir()
  RETURNS TABLE (caso uuid, entrou_em timestamptz, motivo text, prazo_legal date,
                 encomenda uuid)
  LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT r.id, r.criado_em,
    CASE WHEN r.prorrogado_ate IS NULL THEN 'por_responder' ELSE 'prorrogado' END,
    coalesce(r.prorrogado_ate, r.prazo_legal), NULL::uuid
  FROM public.pedido_titular_recebido r
  WHERE r.comerciante_id = public.comerciante_actual() AND r.estado = 'aberto'
$$;

CREATE OR REPLACE FUNCTION tarefas_filas()
  RETURNS TABLE (fila text, ambito_ler text, ambito_decidir text)
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  VALUES ('pagamento', 'payments:read', 'payments:resolve'),
         ('documento_fiscal', 'invoices:read', 'invoices:write'),
         ('duplicado_cliente', 'customers:read', 'customers:merge'),
         ('prazo_reembolso', 'returns:read', 'refunds:write'),
         ('livre_resolucao', 'returns:read', 'returns:write'),
         ('problema', 'returns:read', 'refunds:write'),
         ('reembolso', 'refunds:read', 'refunds:write'),
         ('ligacao_faturacao', 'invoices:read', 'invoices:accounts'),
         ('pedido_titular', 'customers:privacy', 'customers:privacy')
$$;

-- O prazo por omissão (R4; **não é lei**): no pedido do titular, 7 dias antes
-- do fim do prazo legal em vigor, nunca antes de o caso entrar (um pedido
-- registado tarde vence logo).
CREATE OR REPLACE FUNCTION tarefas_prazo_por_omissao(p_fila text, p_entrou timestamptz,
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
    WHEN 'ligacao_faturacao' THEN p_entrou + interval '1 day'
    WHEN 'pedido_titular' THEN greatest(p_entrou, x.fim - interval '7 days')
  END
  FROM (SELECT CASE WHEN p_prazo_legal IS NULL THEN NULL
          ELSE ((p_prazo_legal + 1)::timestamp AT TIME ZONE p_fuso) END AS fim) x
$$;

ALTER TABLE atribuicao DROP CONSTRAINT atribuicao_fila_check;
ALTER TABLE atribuicao ADD CONSTRAINT atribuicao_fila_check
  CHECK (fila IN ('pagamento', 'documento_fiscal', 'duplicado_cliente', 'prazo_reembolso',
    'livre_resolucao', 'problema', 'reembolso', 'ligacao_faturacao', 'pedido_titular'));

CREATE OR REPLACE FUNCTION tarefas_casos(p_filas text[])
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
    UNION ALL
    SELECT 'ligacao_faturacao', x.* FROM public.faturacao_casos_a_decidir() x
    WHERE 'ligacao_faturacao' = ANY (p_filas)
    UNION ALL
    SELECT 'pedido_titular', x.* FROM public.clientes_titular_casos_a_decidir() x
    WHERE 'pedido_titular' = ANY (p_filas)
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

-- ----------------------------------------------------- RLS e permissões

ALTER TABLE pedido_titular_recebido ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedido_titular_recebido FORCE ROW LEVEL SECURITY;
CREATE POLICY so_o_proprio ON pedido_titular_recebido
  USING (comerciante_id = comerciante_actual())
  WITH CHECK (comerciante_id = comerciante_actual());
REVOKE ALL ON pedido_titular_recebido FROM PUBLIC;
-- A API só lê; escrevem as funções do dono.
GRANT SELECT ON pedido_titular_recebido TO eurolify_api;

REVOKE EXECUTE ON FUNCTION clientes_hoje(uuid), pedido_recebido_antes_de_alterar(),
  pedido_recebido_quem(), pedido_recebido_registar(uuid, text, text, timestamptz),
  pedido_recebido_prorrogar(uuid, date, text, date),
  pedido_recebido_fechar(uuid, text, date, uuid), clientes_titular_casos_a_decidir()
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pedido_recebido_registar(uuid, text, text, timestamptz),
  pedido_recebido_prorrogar(uuid, date, text, date),
  pedido_recebido_fechar(uuid, text, date, uuid), clientes_titular_casos_a_decidir()
  TO eurolify_api;
