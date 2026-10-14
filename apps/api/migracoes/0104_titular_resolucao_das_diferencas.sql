-- O texto da resolução de uma diferença de pagamento limpa-se no apagamento
-- do titular (docs/23 §15.1, grupo C dos «textos livres», e §15.2; decisão DU;
-- Diogo, 14/10/2026). A resolução (`diferenca_pagamento.resolucao`, 0044, texto
-- livre até 2000) é escrita por quem resolve a diferença e pode ter dados de
-- um cliente. Ex.: «falei com a Ana Silva, ligou do 912…» numa diferença do
-- pagamento da encomenda da Ana: quando a encomenda acaba e a limpeza corre, a
-- resolução passa a «(pseudonimizado)»; a de outro cliente e o resto da linha
-- (estado, resolvida_por, resolvida_em) ficam como estão.
--
-- O que esta migração faz:
-- - `titular_limpar_encomenda` (última versão: 0102) limpa também a resolução
--   das diferenças resolvidas dos pagamentos dessa encomenda
--   (`diferenca_pagamento.pagamento_id` -> `pagamento.encomenda_id`) e
--   devolve a contagem `resolucoes_de_diferencas`. A encomenda só acaba sem
--   diferenças abertas (`titular_encomenda_acabou`, 0072), por isso só há
--   resolvidas. Uma encomenda por acabar limpa-se quando acabar
--   (`titular_pendentes_aplicar`, que chama a mesma função).
-- - O gatilho de guarda da `diferenca_pagamento` («resolvida é imutável»,
--   0044) deixa passar só um UPDATE que muda a `resolucao` de uma diferença
--   resolvida para o marcador, com a marca da pseudonimização
--   (`titular_limpeza_permitida`, 0072). Tudo o resto continua recusado: o
--   DELETE, outras colunas, outro valor, a falta da marca e a API. Fica
--   `ALWAYS`: só recusa (regra da 0091). Esta tabela não tem gatilhos AFTER
--   UPDATE: não saem eventos nem notificações.
-- - Corrige o filtro do aviso em bruto (`aviso_pagamento.corpo`, 0072): o
--   `NOT LIKE '{"pseudonimizado"%'` nunca reconhecia um corpo já limpo, porque
--   o jsonb ordena as chaves (`{"resumo": "ab12cd34", "pseudonimizado":
--   true}`); correr a limpeza duas vezes recalculava o resumo sobre o resumo.
--   Agora reconhece a forma exacta que a função gera (resumo de 8 hex) com
--   uma expressão regular sobre o texto, que não rebenta com um corpo que
--   não seja JSON.
-- - `cliente_pseudonimizar` não muda: chama `titular_limpar_encomenda` para
--   as encomendas acabadas.
--
-- Fora: as diferenças sem pagamento (`aviso_sem_pagamento`) não têm
-- encomenda nem titular e ficam como estão.
SET LOCAL lock_timeout = '10s';

-- ------------------------------------------------------ A guarda da diferença

CREATE OR REPLACE FUNCTION diferenca_pagamento_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payments.immutable: uma diferença não se apaga';
  END IF;
  -- O apagamento do titular (0104): só a resolução de uma diferença resolvida,
  -- só para o marcador, só com a marca da pseudonimização.
  IF OLD.estado = 'resolvida' AND NEW.resolucao = '(pseudonimizado)'
     AND public.titular_limpeza_permitida(to_jsonb(OLD), to_jsonb(NEW),
       ARRAY['resolucao']) THEN
    RETURN NEW;
  END IF;
  IF OLD.estado = 'resolvida' THEN
    RAISE EXCEPTION 'payments.immutable: uma diferença resolvida não muda';
  END IF;
  IF (to_jsonb(NEW) - 'estado' - 'resolucao' - 'resolvida_por' - 'resolvida_em')
     IS DISTINCT FROM (to_jsonb(OLD) - 'estado' - 'resolucao' - 'resolvida_por' - 'resolvida_em') THEN
    RAISE EXCEPTION 'payments.immutable: a diferença só muda ao resolver';
  END IF;
  -- Um processo automático (sistema:, checkout:) nunca resolve: só quem
  -- tem a conta do comerciante (a sessão de uma pessoa ou a chave dela).
  IF NEW.resolvida_por !~ '^(pessoa|chave):' THEN
    RAISE EXCEPTION 'payments.issue_needs_person: só uma pessoa resolve uma diferença';
  END IF;
  NEW.resolvida_em := now();
  RETURN NEW;
END
$$;
-- O gatilho (0044) já existe e fica `ALWAYS`; repete-se por clareza: só recusa.
ALTER TABLE diferenca_pagamento ENABLE ALWAYS TRIGGER diferenca_pagamento_antes_de_gravar;

-- ------------------------------------ A limpeza de uma encomenda, com a resolução

-- Cópia da 0102 com o que está marcado «0104». O resto não mudou.
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
  n_resolucoes integer;
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
  WHERE a.comerciante_id = c AND a.corpo !~ '^\{"resumo": "[0-9a-f]{8}", "pseudonimizado": true\}$'
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
  -- O texto com que uma pessoa resolveu uma diferença de pagamento (0104).
  -- Só as resolvidas: a encomenda só acaba sem diferenças abertas
  -- (titular_encomenda_acabou, 0072). A guarda deixa mudar só a `resolucao`.
  UPDATE public.diferenca_pagamento d SET resolucao = m
  WHERE d.comerciante_id = c AND d.estado = 'resolvida'
    AND d.resolucao IS NOT NULL AND d.resolucao <> m
    AND d.pagamento_id IN (SELECT p.id FROM public.pagamento p
                           WHERE p.comerciante_id = c AND p.encomenda_id = e.id);
  GET DIAGNOSTICS n_resolucoes = ROW_COUNT;
  RETURN jsonb_build_object(
    'dados_fiscais_mantidos', fiscal,
    'sessoes_de_checkout', n_sessoes,
    'expedicoes', n_expedicoes,
    'transicoes', n_transicoes + n_transicoes_pagamento,
    'avisos_de_pagamento', n_avisos,
    'pedidos_de_livre_resolucao', n_pedidos,
    'devolucoes', n_devolucoes,
    'problemas', n_problemas,
    'motivos_de_prazo_limpos', n_motivos,
    'resolucoes_de_diferencas', n_resolucoes);
END
$$;
