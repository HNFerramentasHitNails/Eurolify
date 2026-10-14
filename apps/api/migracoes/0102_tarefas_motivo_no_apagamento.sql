-- O motivo livre de uma mudança de prazo limpa-se no apagamento do titular
-- (docs/33 §6; decisão DU, docs/23 §15.1, grupo C dos «textos livres»; Diogo,
-- 14/10/2026). O motivo de uma mudança de prazo (`atribuicao_rasto.motivo`,
-- 0066, texto livre até 500) pode ter dados de um cliente. Ex.: «falei com a
-- Ana Silva» num caso da encomenda da Ana: quando a Ana pede o apagamento, o
-- motivo passa a «(pseudonimizado)»; o de um caso de outra pessoa fica como
-- está, e o resto da linha do rasto (quem, quando, o prazo antes e depois)
-- também.
--
-- O que esta migração faz:
-- - `tarefas_casos_das_encomendas(uuid[])` e `tarefas_casos_do_titular(uuid[])`:
--   os casos das filas que são de um titular (fila, caso), em qualquer estado
--   do caso (o rasto fica depois de o caso fechar). Com a origem de cada ramo.
-- - `tarefas_limpar_motivos(clientes, encomendas)`: o motivo desses casos
--   passa a «(pseudonimizado)» (o marcador da 0072). Só a coluna `motivo`.
-- - A guarda do `atribuicao_rasto`: o gatilho `rasto_so_se_acrescenta` (0008,
--   sem excepção) dá lugar ao `titular_rasto_so_se_acrescenta` (0072), que
--   recusa tudo menos um UPDATE que só muda o motivo para o marcador com a
--   marca da pseudonimização posta na transacção (a mesma dos rastos das
--   transições). O TRUNCATE continua recusado (`..._sem_truncate`, intocado).
--   Fica `ALWAYS`: só recusa (regra da 0091). Os gatilhos AFTER INSERT do
--   rasto (`atribuicao_evento`, `atribuicao_vencida_notificacao`) não correm
--   num UPDATE: não saem eventos nem notificações.
-- - `cliente_pseudonimizar` (última versão: 0072) chama a limpeza para o
--   grupo, com a marca posta, e devolve `motivos_de_prazo_limpos`.
-- - `titular_limpar_encomenda` (única versão: 0072) limpa também os casos
--   dessa encomenda: uma mudança de prazo feita depois do pedido, numa
--   encomenda por acabar, fica limpa quando ela acabar. Devolve a contagem.
--
-- Fora: `ligacao_faturacao` não tem titular.
SET LOCAL lock_timeout = '10s';

-- ------------------------------------------------- Os casos de um titular

-- Por fila, do caso até à ficha (`atribuicao.fila`/`caso`, 0066/0092). Os
-- casos que chegam à ficha por uma encomenda ficam numa função à parte, para
-- a limpeza de uma encomenda (titular_limpar_encomenda) usar os mesmos ramos.
-- Lê todos os estados: o rasto de uma atribuição fica depois de o caso fechar.
CREATE FUNCTION tarefas_casos_das_encomendas(p_encomendas uuid[])
  RETURNS TABLE (fila text, caso uuid)
  LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  -- pagamento: diferenca_pagamento.id -> pagamento.encomenda_id
  -- (pagamentos_casos_a_decidir, 0066; sem encomenda, o caso fica de fora).
  SELECT 'pagamento'::text, d.id
  FROM public.diferenca_pagamento d
  JOIN public.pagamento p ON p.id = d.pagamento_id
  WHERE d.comerciante_id = public.comerciante_actual() AND p.encomenda_id = ANY (p_encomendas)
  UNION ALL
  -- documento_fiscal: documento_fiscal.id -> encomenda_id
  -- (documentos_casos_a_decidir, 0066).
  SELECT 'documento_fiscal', d.id FROM public.documento_fiscal d
  WHERE d.comerciante_id = public.comerciante_actual() AND d.encomenda_id = ANY (p_encomendas)
  UNION ALL
  -- prazo_reembolso: devolucao.id -> encomenda_id (posvenda_casos_a_decidir, 0066).
  SELECT 'prazo_reembolso', d.id FROM public.devolucao d
  WHERE d.comerciante_id = public.comerciante_actual() AND d.encomenda_id = ANY (p_encomendas)
  UNION ALL
  -- livre_resolucao: pedido_livre_resolucao.id -> encomenda_id (idem).
  SELECT 'livre_resolucao', p.id FROM public.pedido_livre_resolucao p
  WHERE p.comerciante_id = public.comerciante_actual() AND p.encomenda_id = ANY (p_encomendas)
  UNION ALL
  -- problema: problema.id -> encomenda_id (idem).
  SELECT 'problema', b.id FROM public.problema b
  WHERE b.comerciante_id = public.comerciante_actual() AND b.encomenda_id = ANY (p_encomendas)
  UNION ALL
  -- reembolso: reembolso.id -> encomenda_id (idem).
  SELECT 'reembolso', r.id FROM public.reembolso r
  WHERE r.comerciante_id = public.comerciante_actual() AND r.encomenda_id = ANY (p_encomendas)
$$;

-- As nove filas de `tarefas_filas()` (0092): oito têm titular, uma não.
CREATE FUNCTION tarefas_casos_do_titular(p_clientes uuid[])
  RETURNS TABLE (fila text, caso uuid)
  LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  -- duplicado_cliente: duplicado_cliente.id -> cliente_a / cliente_b (0046;
  -- clientes_casos_a_decidir, 0066). Um par tem duas pessoas: o motivo fala
  -- das duas e limpa-se se qualquer uma pedir (como o da linha do tempo, 0072).
  SELECT 'duplicado_cliente'::text, d.id FROM public.duplicado_cliente d
  WHERE d.comerciante_id = public.comerciante_actual()
    AND (d.cliente_a = ANY (p_clientes) OR d.cliente_b = ANY (p_clientes))
  UNION ALL
  -- pedido_titular: pedido_titular_recebido.id -> cliente_id
  -- (clientes_titular_casos_a_decidir, 0092).
  SELECT 'pedido_titular', r.id FROM public.pedido_titular_recebido r
  WHERE r.comerciante_id = public.comerciante_actual() AND r.cliente_id = ANY (p_clientes)
  UNION ALL
  -- pagamento, documento_fiscal, prazo_reembolso, livre_resolucao, problema e
  -- reembolso: pela encomenda (encomenda.cliente_id).
  SELECT x.fila, x.caso
  FROM public.tarefas_casos_das_encomendas(ARRAY(
    SELECT e.id FROM public.encomenda e
    WHERE e.comerciante_id = public.comerciante_actual() AND e.cliente_id = ANY (p_clientes))) x
  -- ligacao_faturacao (0084): sem titular, fica de fora.
$$;

-- --------------------------------------------------------------- A limpeza

-- O motivo dos casos desses clientes e dessas encomendas passa a marcador.
-- Só corre com a marca da pseudonimização (o gatilho recusa sem ela) e só a
-- chamam as funções do dono. Devolve quantas linhas do rasto mudaram.
CREATE FUNCTION tarefas_limpar_motivos(p_clientes uuid[], p_encomendas uuid[])
  RETURNS integer
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  c uuid := public.comerciante_actual();
  n integer;
BEGIN
  UPDATE public.atribuicao_rasto r SET motivo = '(pseudonimizado)'
  WHERE r.comerciante_id = c AND r.motivo IS NOT NULL AND r.motivo <> '(pseudonimizado)'
    AND r.atribuicao_id IN (
      SELECT a.id FROM public.atribuicao a
      WHERE a.comerciante_id = c AND (a.fila, a.caso) IN (
        SELECT x.fila, x.caso FROM public.tarefas_casos_do_titular(p_clientes) x
        UNION
        SELECT y.fila, y.caso FROM public.tarefas_casos_das_encomendas(p_encomendas) y));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;

-- ------------------------------------------------------ A guarda do rasto

-- Como as transições (0072): só o motivo, só para o marcador, só com a marca.
-- O DELETE e qualquer outro UPDATE continuam recusados; o TRUNCATE também
-- (gatilho `atribuicao_rasto_sem_truncate`, 0066, intocado). ALWAYS: só recusa.
DROP TRIGGER atribuicao_rasto_so_se_acrescenta ON atribuicao_rasto;
CREATE TRIGGER atribuicao_rasto_so_se_acrescenta BEFORE UPDATE OR DELETE ON atribuicao_rasto
  FOR EACH ROW EXECUTE FUNCTION titular_rasto_so_se_acrescenta();
ALTER TABLE atribuicao_rasto ENABLE ALWAYS TRIGGER atribuicao_rasto_so_se_acrescenta;

-- ------------------------------------ As funções do apagamento, com a limpeza

-- Cópias da 0072 com o que está marcado «0102». O resto não mudou.
CREATE OR REPLACE FUNCTION titular_limpar_encomenda(p_encomenda uuid) RETURNS jsonb
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  c uuid := public.comerciante_actual();
  e record;
  fiscal boolean;
  m text := '(pseudonimizado)';
  n_expedicoes integer;
  n_transicoes integer;
  n_transicoes_pagamento integer;
  n_avisos integer;
  n_pedidos integer;
  n_devolucoes integer;
  n_problemas integer;
  n_sessoes integer;
  n_motivos integer;
BEGIN
  SELECT x.id, x.estado, x.perfil_copia, x.sessao_id INTO e FROM public.encomenda x
  WHERE x.comerciante_id = c AND x.id = p_encomenda FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'orders.not_found: a encomenda não existe';
  END IF;
  -- Voltou a ficar em curso entre a escolha e o bloqueio (ex.: abriu-se uma
  -- livre resolução): não se limpa, e quem chama põe-na na fila (revisão do
  -- #374, P3).
  IF NOT public.titular_encomenda_acabou(p_encomenda) THEN
    RETURN NULL;
  END IF;
  -- Grupo A: a cópia de onde se emite fica se há documento, ou se a
  -- encomenda foi paga (o documento é devido) — Q2, C contabilista.
  fiscal := e.estado <> 'cancelada_sem_pagamento' OR EXISTS (
    SELECT FROM public.documento_fiscal d WHERE d.comerciante_id = c AND d.encomenda_id = e.id);
  UPDATE public.encomenda x
  SET contacto = public.titular_jsonb_so(x.contacto, '{}'),
      entrega = public.titular_morada_sem(x.entrega),
      perfil_copia = CASE WHEN fiscal THEN x.perfil_copia ELSE
        public.titular_jsonb_so(x.perfil_copia,
          ARRAY['tipo', 'pais_contribuinte', 'outra_pessoa', 'morada'])
        || CASE WHEN jsonb_typeof(x.perfil_copia -> 'morada') = 'object'
             THEN jsonb_build_object('morada', public.titular_morada_sem(x.perfil_copia -> 'morada'))
             ELSE '{}'::jsonb END END
  WHERE x.comerciante_id = c AND x.id = e.id;
  -- A sessão de checkout desta encomenda tem a mesma cópia: chega-se a ela
  -- pela encomenda, sem decidir nada pelo e-mail (revisão do #374, P2-1).
  -- Vazia (o e-mail da sessão tem formato obrigatório).
  UPDATE public.sessao_checkout x
  SET email = NULL, nome = NULL, telefone = NULL, entrega = NULL, faturacao = NULL
  WHERE x.comerciante_id = c AND x.id = e.sessao_id
    AND (x.email IS NOT NULL OR x.nome IS NOT NULL OR x.telefone IS NOT NULL
         OR x.entrega IS NOT NULL OR x.faturacao IS NOT NULL);
  GET DIAGNOSTICS n_sessoes = ROW_COUNT;
  UPDATE public.expedicao x SET prova_entrega = m
  WHERE x.comerciante_id = c AND x.encomenda_id = e.id
    AND x.prova_entrega IS NOT NULL AND x.prova_entrega <> m;
  GET DIAGNOSTICS n_expedicoes = ROW_COUNT;
  UPDATE public.transicao_encomenda t SET motivo = m
  WHERE t.comerciante_id = c AND t.encomenda_id = e.id
    AND t.motivo IS NOT NULL AND t.motivo <> m;
  GET DIAGNOSTICS n_transicoes = ROW_COUNT;
  UPDATE public.transicao_pagamento t SET motivo = m
  WHERE t.comerciante_id = c AND t.motivo IS NOT NULL AND t.motivo <> m
    AND t.pagamento_id IN (SELECT p.id FROM public.pagamento p
                           WHERE p.comerciante_id = c AND p.encomenda_id = e.id);
  GET DIAGNOSTICS n_transicoes_pagamento = ROW_COUNT;
  -- O aviso em bruto passa a resumo (Q3): o pagamento guarda o montante, a
  -- referência e o estado. O resumo leva a chave do rasto (0054): sem ela,
  -- um telefone adivinha-se por tentativa (revisão do #374, P3).
  UPDATE public.aviso_pagamento a
  SET corpo = jsonb_build_object('pseudonimizado', true,
        'resumo', public.rasto_resumo(c, 'aviso_pagamento.corpo', to_jsonb(a.corpo)))::text
  WHERE a.comerciante_id = c AND a.corpo NOT LIKE '{"pseudonimizado"%'
    AND a.pagamento_id IN (SELECT p.id FROM public.pagamento p
                           WHERE p.comerciante_id = c AND p.encomenda_id = e.id);
  GET DIAGNOSTICS n_avisos = ROW_COUNT;
  UPDATE public.pedido_livre_resolucao p
  SET contacto = 'sem e-mail',
      motivo_decisao = CASE WHEN p.motivo_decisao IS NULL THEN NULL ELSE m END
  WHERE p.comerciante_id = c AND p.encomenda_id = e.id
    AND (p.contacto <> 'sem e-mail' OR p.motivo_decisao IS DISTINCT FROM
         CASE WHEN p.motivo_decisao IS NULL THEN NULL ELSE m END);
  GET DIAGNOSTICS n_pedidos = ROW_COUNT;
  UPDATE public.devolucao d SET motivo = m
  WHERE d.comerciante_id = c AND d.encomenda_id = e.id
    AND d.motivo IS NOT NULL AND d.motivo <> m;
  GET DIAGNOSTICS n_devolucoes = ROW_COUNT;
  UPDATE public.problema x SET descricao = m
  WHERE x.comerciante_id = c AND x.encomenda_id = e.id AND x.descricao <> m;
  GET DIAGNOSTICS n_problemas = ROW_COUNT;
  -- O motivo de uma mudança de prazo feita depois do pedido (0102).
  n_motivos := public.tarefas_limpar_motivos('{}'::uuid[], ARRAY[e.id]);
  RETURN jsonb_build_object(
    'dados_fiscais_mantidos', fiscal,
    'sessoes_de_checkout', n_sessoes,
    'expedicoes', n_expedicoes,
    'transicoes', n_transicoes + n_transicoes_pagamento,
    'avisos_de_pagamento', n_avisos,
    'pedidos_de_livre_resolucao', n_pedidos,
    'devolucoes', n_devolucoes,
    'problemas', n_problemas,
    'motivos_de_prazo_limpos', n_motivos);
END
$$;
CREATE OR REPLACE FUNCTION cliente_pseudonimizar(p_cliente uuid, p_confirmacao text, p_verificacao text)
  RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  comerciante uuid := public.comerciante_actual();
  quem text := public.clientes_quem_decide();
  ficha record;
  grupo uuid[];
  usados uuid[];
  nao_usados uuid[];
  resultado jsonb;
  n_consentimentos integer;
  n_etiquetas integer;
  n_validacoes integer;
  n_isencoes integer;
  n_rasto integer;
  n_motivos integer;
  n_encomendas integer;
  acabadas uuid[];
  por_acabar uuid[];
  enc uuid;
  limpeza jsonb;
  n_fiscais integer := 0;
  pedido uuid;
BEGIN
  -- Irreversível: a confirmação escreve o que vai acontecer (como as acções
  -- do MCP da VPS).
  IF p_confirmacao IS DISTINCT FROM 'pseudonimizar cus_' || p_cliente::text THEN
    -- A mensagem não repete a frase: quem confirma escreve-a (P3-5).
    RAISE EXCEPTION 'customers.confirmation_required: escreva «pseudonimizar» seguido de um espaço e do id da ficha para confirmar';
  END IF;
  -- A ficha pedida tomada primeiro, e só depois o grupo: uma fusão para ela
  -- precisa deste bloqueio, e as fundidas já não mudam, por isso o grupo
  -- lido a seguir está completo (revisão do #314, P1-2).
  SELECT c.estado INTO ficha FROM public.cliente c
  WHERE c.comerciante_id = comerciante AND c.id = p_cliente
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'customers.not_found: a ficha não existe';
  END IF;
  IF ficha.estado <> 'activo' THEN
    RAISE EXCEPTION 'customers.invalid_transition: a ficha está %; peça pela ficha que ficou', ficha.estado;
  END IF;
  grupo := ARRAY(SELECT public.clientes_do_grupo(p_cliente));
  -- As outras fichas do grupo, pela ordem dos ids (como a fusão).
  PERFORM 1 FROM public.cliente c
  WHERE c.comerciante_id = comerciante AND c.id = ANY (grupo)
  ORDER BY c.id FOR UPDATE;

  -- Ficam como estão os perfis usados num documento e os que uma encomenda
  -- aponta, com as provas do VIES e as isenções deles: a decisão do IVA da
  -- encomenda cita-as, e a fatura e a nota de crédito ainda podem precisar
  -- delas (R9; revisão do #314, P1-1). Uma encomenda cancelada sem pagamento
  -- não gera documento e já não conta (Q2 do docs/23 §15; C contabilista).
  usados := ARRAY(SELECT p.id FROM public.perfil_faturacao p
    WHERE p.comerciante_id = comerciante AND p.cliente_id = ANY (grupo)
      AND (p.usado_em_documento OR EXISTS (
        SELECT FROM public.encomenda e
        WHERE e.comerciante_id = comerciante AND e.perfil_id = p.id
          AND e.estado <> 'cancelada_sem_pagamento')));
  nao_usados := ARRAY(SELECT p.id FROM public.perfil_faturacao p
    WHERE p.comerciante_id = comerciante AND p.cliente_id = ANY (grupo)
      AND p.id <> ALL (usados));
  -- As encomendas (docs/23 §15): as acabadas limpam-se já; as outras ficam
  -- na fila e limpam-se quando acabarem (Q1).
  acabadas := ARRAY(SELECT e.id FROM public.encomenda e
    WHERE e.comerciante_id = comerciante AND e.cliente_id = ANY (grupo)
      AND public.titular_encomenda_acabou(e.id) ORDER BY e.id);
  por_acabar := ARRAY(SELECT e.id FROM public.encomenda e
    WHERE e.comerciante_id = comerciante AND e.cliente_id = ANY (grupo)
      AND e.id <> ALL (acabadas) ORDER BY e.id);
  n_encomendas := cardinality(por_acabar);

  INSERT INTO public.pseudonimizacao_em_curso VALUES (pg_current_xact_id());

  DELETE FROM public.vies_fila v WHERE v.perfil_id = ANY (nao_usados || usados);
  DELETE FROM public.validacao_vies v
  WHERE v.comerciante_id = comerciante AND v.perfil_id = ANY (nao_usados);
  GET DIAGNOSTICS n_validacoes = ROW_COUNT;
  UPDATE public.isencao_manual i
  SET nif_numero = NULL, pais_contribuinte = NULL, nota = NULL, motivo = '(pseudonimizado)',
      motivo_retirada = CASE WHEN i.motivo_retirada IS NULL THEN NULL ELSE '(pseudonimizado)' END
  WHERE i.comerciante_id = comerciante AND i.perfil_id = ANY (nao_usados);
  GET DIAGNOSTICS n_isencoes = ROW_COUNT;
  UPDATE public.perfil_faturacao p
  SET tipo = 'particular', nome_documento = 'Pseudonimizado', nif_escrito = NULL,
      pais_contribuinte = NULL, morada_linha1 = NULL, morada_linha2 = NULL,
      morada_codigo_postal = NULL, morada_localidade = NULL, morada_pais = NULL,
      estado = 'arquivado', principal = false
  WHERE p.comerciante_id = comerciante AND p.id = ANY (nao_usados);
  DELETE FROM public.consentimento c
  WHERE c.comerciante_id = comerciante AND c.cliente_id = ANY (grupo);
  GET DIAGNOSTICS n_consentimentos = ROW_COUNT;
  DELETE FROM public.cliente_etiqueta ce
  WHERE ce.comerciante_id = comerciante AND ce.cliente_id = ANY (grupo);
  GET DIAGNOSTICS n_etiquetas = ROW_COUNT;
  UPDATE public.duplicado_cliente d
  SET estado = 'fechado', motivo = 'uma das fichas foi pseudonimizada',
      decidido_por = quem, decidido_em = now(), actualizado_em = now()
  WHERE d.comerciante_id = comerciante AND d.estado IN ('por_decidir', 'descartado')
    AND (d.cliente_a = ANY (grupo) OR d.cliente_b = ANY (grupo));
  UPDATE public.cliente c
  SET nome = 'Pseudonimizado', emails = '{}', telefones = '{}', lingua = NULL, pais = NULL,
      estado = CASE WHEN c.id = p_cliente THEN 'pseudonimizado' ELSE c.estado END
  WHERE c.comerciante_id = comerciante AND c.id = ANY (grupo);

  -- Por último: as entradas que as escritas acima acabaram de criar também
  -- levavam os valores de antes.
  UPDATE public.alteracao_cliente a
  -- Os valores de um perfil usado num documento ficam (R9; já marcadores
  -- desde a 0054); o motivo, texto livre que pode falar da pessoa, limpa-se
  -- em todas, também nesses: a prova fiscal é a cópia no documento (Diogo,
  -- 10/10/2026, R9; revisão do #354, P2-2).
  SET campos = CASE
        WHEN a.entidade = 'perfil_faturacao' AND a.entidade_id = ANY (usados) THEN a.campos
        ELSE public.clientes_rasto_sem_dados(a.campos) END,
      motivo = CASE WHEN a.motivo IS NULL THEN NULL ELSE '(pseudonimizado)' END
  WHERE a.comerciante_id = comerciante
    AND (a.cliente_id = ANY (grupo)
      -- Um par de duplicados fica na linha do tempo da primeira ficha do
      -- par, que pode ser a outra pessoa; o motivo escrito fala das duas.
      OR (a.entidade = 'duplicado_cliente' AND a.entidade_id IN (
        SELECT d.id FROM public.duplicado_cliente d
        WHERE d.comerciante_id = comerciante
          AND (d.cliente_a = ANY (grupo) OR d.cliente_b = ANY (grupo)))))
    AND ((NOT (a.entidade = 'perfil_faturacao' AND a.entidade_id = ANY (usados))
          AND a.campos IS DISTINCT FROM public.clientes_rasto_sem_dados(a.campos))
      OR a.motivo IS DISTINCT FROM
        CASE WHEN a.motivo IS NULL THEN NULL ELSE '(pseudonimizado)' END);
  GET DIAGNOSTICS n_rasto = ROW_COUNT;

  -- O motivo livre de uma mudança de prazo nas filas, nos casos desta
  -- pessoa (0102; docs/33 §6; docs/23 §15.1, grupo C).
  n_motivos := public.tarefas_limpar_motivos(grupo, '{}'::uuid[]);

  FOREACH enc IN ARRAY acabadas LOOP
    limpeza := public.titular_limpar_encomenda(enc);
    IF limpeza IS NULL THEN
      -- Voltou a ficar em curso: vai para a fila em vez de falhar o pedido
      -- todo (revisão do #374, P3).
      acabadas := array_remove(acabadas, enc);
      por_acabar := por_acabar || enc;
    ELSIF (limpeza ->> 'dados_fiscais_mantidos')::boolean THEN
      n_fiscais := n_fiscais + 1;
    END IF;
  END LOOP;
  n_encomendas := cardinality(por_acabar);

  DELETE FROM public.pseudonimizacao_em_curso m WHERE m.transaccao = pg_current_xact_id();

  resultado := jsonb_build_object(
    'fichas', cardinality(grupo),
    'perfis_pseudonimizados', cardinality(nao_usados),
    'perfis_mantidos_por_obrigacao_fiscal', cardinality(usados),
    'consentimentos_apagados', n_consentimentos,
    'etiquetas_retiradas', n_etiquetas,
    'provas_vies_apagadas', n_validacoes,
    'isencoes_limpas', n_isencoes,
    'entradas_da_linha_do_tempo', n_rasto,
    'motivos_de_prazo_limpos', n_motivos,
    'encomendas_limpas', cardinality(acabadas),
    'encomendas_com_dados_fiscais_mantidos', n_fiscais,
    'encomendas_por_acabar', n_encomendas,
    -- Com mais de zero, o apagamento ainda não está completo: as que faltam
    -- limpam-se quando acabarem (P2-4; §15.3).
    'encomendas_com_dados_por_tratar', n_encomendas);
  INSERT INTO public.evento_saida (comerciante_id, tipo, agregado_tipo, agregado_id, dados)
  VALUES (comerciante, 'customer.pseudonymized', 'cliente', p_cliente,
    jsonb_build_object('cliente_id', p_cliente, 'fichas', cardinality(grupo), 'quem', quem,
      'em', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
  pedido := public.pedido_titular_registar(p_cliente, 'apagamento', p_verificacao, resultado);
  INSERT INTO public.titular_pendente (comerciante_id, pedido_id, encomenda_id)
  SELECT comerciante, pedido, x FROM unnest(por_acabar) AS x;
  RETURN resultado;
END
$$;

REVOKE EXECUTE ON FUNCTION tarefas_casos_das_encomendas(uuid[]),
  tarefas_casos_do_titular(uuid[]), tarefas_limpar_motivos(uuid[], uuid[]) FROM PUBLIC;
