-- A limpeza dos carrinhos expirados e o índice do tecto (docs/25 §14; issue
-- #479; revisão do #276, P2-9). Um carrinho aberto que expirou há mais de 7
-- dias (valor nosso, a medir) e que nunca teve sessão de checkout apaga-se
-- com as linhas. O que tem sessão (e, por ela, uma encomenda) fica: a chave
-- estrangeira da 0041 recusa apagá-lo e a sessão não se apaga (P2-3).
--
-- A API não ganha DELETE sobre o carrinho: apaga-se só por esta função do
-- dono, no comerciante do contexto (RLS forçada da 0041).

-- Os comerciantes a percorrer: os que têm (ou tiveram) uma chave pública, a
-- única porta que cria carrinhos. O carrinho tem RLS forçada e não se lê aqui
-- sem contexto; a `chave_api` tem RLS sem forçar (0010), como o token do
-- checkout, e a tabela `comerciante` tem-na forçada (0009).
CREATE FUNCTION checkout_comerciantes_com_carrinhos_a_limpar() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT DISTINCT k.comerciante_id FROM public.chave_api k WHERE k.tipo = 'publica' ORDER BY 1
$$;

-- No comerciante do contexto, apaga até `p_limite` carrinhos. Devolve quantos.
CREATE FUNCTION checkout_carrinhos_limpar(p_limite integer) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  c uuid := public.comerciante_actual();
  ids uuid[];
  n integer;
BEGIN
  IF c IS NULL THEN
    RAISE EXCEPTION 'merchant.context_required: sem comerciante';
  END IF;
  -- Primeiro os bloqueios: o que alguém está a usar (o pedido que o bloqueou
  -- primeiro) salta-se e fica para a volta seguinte.
  SELECT coalesce(array_agg(x.id), '{}') INTO ids FROM (
    SELECT k.id FROM public.carrinho k
    WHERE k.comerciante_id = c
      AND k.estado = 'aberto'
      AND k.expira_em < now() - interval '7 days'
      AND NOT EXISTS (SELECT FROM public.sessao_checkout s
                      WHERE s.comerciante_id = c AND s.carrinho_id = k.id)
    ORDER BY k.expira_em, k.id
    LIMIT greatest(p_limite, 0)
    FOR UPDATE OF k SKIP LOCKED) x;
  -- Depois de bloqueados, a condição volta a conferir-se com uma imagem nova
  -- da base: uma sessão que nasceu entre a escolha e o bloqueio não se perde
  -- (e a chave estrangeira recusaria, de qualquer forma).
  DELETE FROM public.carrinho k
  WHERE k.comerciante_id = c
    AND k.id = ANY (ids)
    AND k.estado = 'aberto'
    AND k.expira_em < now() - interval '7 days'
    AND NOT EXISTS (SELECT FROM public.sessao_checkout s
                    WHERE s.comerciante_id = c AND s.carrinho_id = k.id);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;

-- A limpeza percorre os abertos por prazo; o tecto conta os abertos e não
-- expirados da loja.
CREATE INDEX carrinho_abertos_por_prazo ON carrinho (comerciante_id, expira_em)
  WHERE estado = 'aberto';
CREATE INDEX carrinho_abertos_da_loja ON carrinho (comerciante_id, loja_id, expira_em)
  WHERE estado = 'aberto';

-- Um carrinho sem linhas vive 24 h (docs/25 §14); a API passa-o a 30 dias ao
-- pôr a primeira linha. Só vale para os carrinhos novos: os que já existem
-- ficam como estão (o RLS forçado impede o dono de os alterar sem contexto, e
-- ainda não há dados reais; ADR-0019) e expiram aos 30 dias.
ALTER TABLE carrinho ALTER COLUMN expira_em SET DEFAULT now() + interval '24 hours';

REVOKE EXECUTE ON FUNCTION checkout_comerciantes_com_carrinhos_a_limpar(),
  checkout_carrinhos_limpar(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION checkout_comerciantes_com_carrinhos_a_limpar(),
  checkout_carrinhos_limpar(integer) TO eurolify_api;
