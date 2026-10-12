-- As sessões de checkout sem dados pessoais (docs/23 §15.4, parte 2 do
-- §15.10; docs/25 §7; decisão DU, Diogo, 11/10/2026: «aprovado»; issue
-- #233). Ex.: a Ana preenche o e-mail e a morada e desiste; 7 dias depois de
-- a sessão expirar, o e-mail e a morada saem da sessão. Se compra, saem logo
-- (a encomenda tem a cópia).
--
-- A sessão não tem cliente (0041): procurá-la pelo e-mail seria decidir
-- identidade por um sinal que só diz «talvez». Por isso, por prazo:
-- - concluída: limpa-se ao criar a encomenda (no código, `concluir`); esta
--   tarefa apanha as concluídas antes desta migração;
-- - expirada ou abandonada: 7 dias depois da última mudança;
-- - aberta e já expirada (só passa a «expirada» quando alguém volta ao
--   token): 7 dias depois de `expira_em`.
-- O prazo de 7 dias é proposta (docs/25 §7, J3/J4: **C**, jurista).
--
-- A limpeza põe as cinco colunas a NULL (os CHECK da 0041 aceitam) e usa a
-- marca da 0049, como a 0072: o gatilho da sessão só deixa mudar essas
-- colunas, e só dentro desta função do dono.

-- Os comerciantes a percorrer. A sessão tem RLS forçada (0041), por isso não
-- se lê aqui sem contexto: vão todos os que alguma vez tiveram uma pessoa ou
-- uma chave (todo o comerciante tem o primeiro dono), como em
-- `tarefas_comerciantes()` (0066), mas sem filtrar pelos activos — uma
-- sessão antiga de um comerciante sem chaves também se limpa.
CREATE FUNCTION checkout_comerciantes_com_sessoes_a_limpar() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT m.comerciante_id FROM public.membro m
  UNION
  SELECT k.comerciante_id FROM public.chave_api k
  ORDER BY 1
$$;

-- No comerciante do contexto, limpa até `p_limite` sessões. Devolve quantas.
CREATE FUNCTION checkout_sessoes_limpar(p_limite integer) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  c uuid := public.comerciante_actual();
  n integer;
BEGIN
  IF c IS NULL THEN
    RAISE EXCEPTION 'merchant.context_required: sem comerciante';
  END IF;
  INSERT INTO public.pseudonimizacao_em_curso VALUES (pg_current_xact_id())
    ON CONFLICT DO NOTHING;
  UPDATE public.sessao_checkout x
  SET email = NULL, nome = NULL, telefone = NULL, entrega = NULL, faturacao = NULL
  WHERE x.comerciante_id = c AND x.id IN (
    SELECT s.id FROM public.sessao_checkout s
    WHERE s.comerciante_id = c
      AND (s.email IS NOT NULL OR s.nome IS NOT NULL OR s.telefone IS NOT NULL
           OR s.entrega IS NOT NULL OR s.faturacao IS NOT NULL)
      AND (s.estado = 'concluida'
        OR (s.estado IN ('expirada', 'abandonada') AND s.actualizado_em < now() - interval '7 days')
        OR (s.estado = 'aberta' AND s.expira_em < now() - interval '7 days'))
    ORDER BY s.criado_em, s.id
    LIMIT greatest(p_limite, 0)
    FOR UPDATE SKIP LOCKED);
  GET DIAGNOSTICS n = ROW_COUNT;
  DELETE FROM public.pseudonimizacao_em_curso m WHERE m.transaccao = pg_current_xact_id();
  RETURN n;
END
$$;

REVOKE EXECUTE ON FUNCTION checkout_comerciantes_com_sessoes_a_limpar(),
  checkout_sessoes_limpar(integer) FROM PUBLIC;
-- A tarefa corre pela API, como a da fila do titular (0072).
GRANT EXECUTE ON FUNCTION checkout_comerciantes_com_sessoes_a_limpar(),
  checkout_sessoes_limpar(integer) TO eurolify_api;
