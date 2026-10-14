-- O reembolso incerto uma vez só em «A decidir» (Diogo, 14/10/2026, Q3 A do
-- ecrã das diferenças de pagamento, docs/22 §34).
--
-- Um reembolso incerto abre duas coisas: o próprio reembolso (estado
-- `incerto`, fila `reembolso`) e uma diferença `reembolso_incerto` (fila
-- `pagamento`, 0066). Eram dois cartões para a mesma decisão. A pessoa que
-- reconcilia o reembolso fecha a diferença no mesmo passo
-- (`fecharDiferencas`, posvenda/prestador.ts): a decisão é uma, na fila
-- `reembolso`. A diferença continua a ver-se no ecrã «Diferenças de
-- pagamento» do Hub (que lê a tabela, não a fila).
--
-- O que esta migração faz: `pagamentos_casos_a_decidir()` (única versão: 0066)
-- deixa de devolver as diferenças de motivo `reembolso_incerto`. Tudo o resto
-- é igual ao da 0066. Só mexe na função: nenhuma linha muda.
--
-- Fica de fora de propósito (desvio da decisão, a confirmar com o Diogo): os
-- motivos `reembolso_por_confirmar` e `reembolso_desconhecido` CONTINUAM na
-- fila. Nenhum tem um reembolso em `incerto` ou `falhado` que os substitua
-- na fila `reembolso` (0066, `posvenda_casos_a_decidir`):
-- - `reembolso_por_confirmar`: o reembolso está em `a_confirmar`;
-- - `reembolso_desconhecido`: o prestador avisou de um reembolso que o
--   Eurolify não pediu, e não há linha de `reembolso` nenhuma.
-- Tirá-los deixava um reembolso por conferir fora de todas as filas.
--
-- Uma atribuição já aberta de um caso que sai da fila fica como está, sem
-- rasto novo: `tarefas_casos` (0092) só junta a atribuição aos casos que a
-- função devolve, como acontece a qualquer caso resolvido. O aviso de vencido
-- (`tarefas_por_avisar`), o largar de quem sai da equipa
-- (`membro_tarefas_largar`) e a atribuição de um caso só olham para os casos
-- da fila: a linha da atribuição e o rasto ficam guardados, sem efeito, e a
-- limpeza de motivos do apagamento (0102) continua a vê-los (lê a tabela
-- `diferenca_pagamento`, em qualquer estado).
SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION pagamentos_casos_a_decidir()
  RETURNS TABLE (caso uuid, entrou_em timestamptz, motivo text, prazo_legal date,
                 encomenda uuid)
  LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT d.id, d.criada_em, d.motivo, NULL::date, p.encomenda_id
  FROM public.diferenca_pagamento d
  LEFT JOIN public.pagamento p ON p.id = d.pagamento_id
  WHERE d.comerciante_id = public.comerciante_actual() AND d.estado = 'aberta'
    -- O reembolso incerto decide-se na fila `reembolso` (Q3 A, 14/10/2026).
    AND d.motivo <> 'reembolso_incerto'
$$;
