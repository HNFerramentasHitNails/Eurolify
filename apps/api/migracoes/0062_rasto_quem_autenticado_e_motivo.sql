-- O rasto de auditoria comum: os pendentes do #322 (comentários de 10/10/2026,
-- 18:31 e 19:58; Diogo, 11/10/2026: «avança com os pendentes»).
-- Ex.: um erro de código que gravasse uma alteração feita pela chave A como
-- se fosse da chave B passa a ser recusado pela base; e pseudonimizar uma
-- ficha passa a limpar também o motivo escrito no histórico dela.
--
-- O que esta migração faz:
-- - `contexto_do_rasto()` (o corpo é o da 0060) confere o `quem`: com a
--   variável nova `eurolify.autenticado`, que a API põe a partir da chave ou
--   da sessão do pedido, um `quem` de chave ou de pessoa tem de ser igual a
--   ela;
-- - `cliente_pseudonimizar()` (o corpo é o da 0049) troca também o `motivo`
--   das entradas do histórico por «(pseudonimizado)», como os valores — e
--   também nas dos perfis usados em documentos, cujos valores ficam (R9).
--
-- Não faz: mudar as linhas já gravadas fora de uma pseudonimização.

SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION contexto_do_rasto() RETURNS jsonb
  LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem text := nullif(btrim(current_setting('eurolify.quem', true)), '');
  canal text := nullif(btrim(current_setting('eurolify.canal', true)), '');
  pedido text := nullif(btrim(current_setting('eurolify.pedido', true)), '');
  origem text := nullif(btrim(current_setting('eurolify.origem', true)), '');
  -- Cortado, não recusado (revisão do #334, P1-1).
  motivo text := left(nullif(btrim(current_setting('eurolify.motivo', true)), ''), 500);
  autorizado text := nullif(btrim(current_setting('eurolify.autorizado_por', true)), '');
  ia_texto text := nullif(btrim(current_setting('eurolify.ia', true)), '');
  a_pedido_texto text := nullif(btrim(current_setting('eurolify.a_pedido_de', true)), '');
  autenticado text := nullif(btrim(current_setting('eurolify.autenticado', true)), '');
  ia jsonb;
  a_pedido jsonb;
  chave text;
BEGIN
  IF canal IS NOT NULL AND canal NOT IN
     ('hub', 'api', 'importacao', 'integracao', 'mcp', 'sistema', 'operador') THEN
    RAISE EXCEPTION 'audit.context_invalid: canal desconhecido';
  END IF;
  IF pedido IS NOT NULL AND pedido !~ '^[A-Za-z0-9._:-]{1,100}$' THEN
    RAISE EXCEPTION 'audit.context_invalid: identificador do pedido mal formado';
  END IF;
  -- Quem autoriza é sempre uma pessoa (docs/28 §3.2): nunca uma chave nem uma IA.
  IF autorizado IS NOT NULL
     AND autorizado !~ '^pessoa:per_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'audit.context_invalid: quem autoriza tem de ser uma pessoa';
  END IF;
  IF ia_texto IS NOT NULL THEN
    IF NOT pg_input_is_valid(ia_texto, 'jsonb') THEN
      RAISE EXCEPTION 'audit.context_invalid: a IA não é JSON';
    END IF;
    ia := ia_texto::jsonb;
    -- §3.3: só «comprovado» ou «declarado»; «desconhecido» é não haver IA.
    IF jsonb_typeof(ia) <> 'object'
       OR (ia ->> 'prova') IS NULL
       OR (ia ->> 'prova') NOT IN ('comprovado', 'declarado') THEN
      RAISE EXCEPTION 'audit.context_invalid: a IA precisa da prova (comprovado ou declarado)';
    END IF;
    FOR chave IN SELECT jsonb_object_keys(ia) LOOP
      IF chave NOT IN ('fornecedor', 'modelo', 'execucao', 'prova')
         OR jsonb_typeof(ia -> chave) <> 'string'
         OR length(ia ->> chave) NOT BETWEEN 1 AND 100 THEN
        RAISE EXCEPTION 'audit.context_invalid: campo da IA desconhecido ou mal formado';
      END IF;
    END LOOP;
  END IF;
  -- Quem executou, se é uma chave ou uma pessoa, é quem se autenticou no
  -- pedido (docs/28 §3.2): um domínio não atribui uma escrita a outra chave
  -- nem a outra pessoa. As outras formas (sistema:, catalogo:, checkout:,
  -- prestador:, operador:) são consequências ou actores sem autenticação de
  -- chave ou sessão, e passam (#322, pendente de 10/10/2026).
  IF autenticado IS NOT NULL THEN
    IF autenticado !~ '^(chave:key|pessoa:per)_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'audit.context_invalid: autenticado mal formado';
    END IF;
    IF quem IS NOT NULL AND (quem LIKE 'chave:%' OR quem LIKE 'pessoa:%')
       AND quem <> autenticado THEN
      RAISE EXCEPTION 'audit.context_invalid: quem executou não é quem se autenticou';
    END IF;
  END IF;
  -- §3.7: o pedido de origem de uma tarefa e quem o fez; só estes dois.
  IF a_pedido_texto IS NOT NULL THEN
    IF NOT pg_input_is_valid(a_pedido_texto, 'jsonb') THEN
      RAISE EXCEPTION 'audit.context_invalid: a origem não é JSON';
    END IF;
    a_pedido := a_pedido_texto::jsonb;
    IF jsonb_typeof(a_pedido) <> 'object' OR a_pedido = '{}'::jsonb THEN
      RAISE EXCEPTION 'audit.context_invalid: a origem tem de ter o pedido ou quem pediu';
    END IF;
    FOR chave IN SELECT jsonb_object_keys(a_pedido) LOOP
      IF chave NOT IN ('pedido', 'quem')
         OR jsonb_typeof(a_pedido -> chave) <> 'string'
         OR length(a_pedido ->> chave) NOT BETWEEN 1 AND 200 THEN
        RAISE EXCEPTION 'audit.context_invalid: campo da origem desconhecido ou mal formado';
      END IF;
    END LOOP;
    IF (a_pedido ->> 'pedido') IS NOT NULL
       AND (a_pedido ->> 'pedido') !~ '^[A-Za-z0-9._:-]{1,100}$' THEN
      RAISE EXCEPTION 'audit.context_invalid: identificador do pedido de origem mal formado';
    END IF;
  END IF;
  RETURN jsonb_strip_nulls(jsonb_build_object(
    'quem', quem, 'canal', canal, 'pedido', pedido, 'origem', origem,
    'motivo', motivo, 'autorizado_por', autorizado, 'ia', ia,
    'a_pedido_de', a_pedido));
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
  n_encomendas integer;
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
  -- delas (R9; revisão do #314, P1-1). Até a fatia 10 marcar os documentos,
  -- qualquer encomenda conta, também a não paga; um critério mais estreito
  -- é do contabilista (C).
  usados := ARRAY(SELECT p.id FROM public.perfil_faturacao p
    WHERE p.comerciante_id = comerciante AND p.cliente_id = ANY (grupo)
      AND (p.usado_em_documento OR EXISTS (
        SELECT FROM public.encomenda e
        WHERE e.comerciante_id = comerciante AND e.perfil_id = p.id)));
  nao_usados := ARRAY(SELECT p.id FROM public.perfil_faturacao p
    WHERE p.comerciante_id = comerciante AND p.cliente_id = ANY (grupo)
      AND p.id <> ALL (usados));
  -- O que fica nas encomendas (o contacto, a entrega, a cópia do perfil) é
  -- delas e ainda não se trata aqui: o resultado di-lo (P2-4).
  SELECT count(*) INTO n_encomendas FROM public.encomenda e
  WHERE e.comerciante_id = comerciante AND e.cliente_id = ANY (grupo);

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
    'encomendas_com_dados_por_tratar', n_encomendas);
  INSERT INTO public.evento_saida (comerciante_id, tipo, agregado_tipo, agregado_id, dados)
  VALUES (comerciante, 'customer.pseudonymized', 'cliente', p_cliente,
    jsonb_build_object('cliente_id', p_cliente, 'fichas', cardinality(grupo), 'quem', quem,
      'em', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
  PERFORM public.pedido_titular_registar(p_cliente, 'apagamento', p_verificacao, resultado);
  RETURN resultado;
END
$$;
