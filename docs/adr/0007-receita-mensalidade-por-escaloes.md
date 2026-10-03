# ADR-0007 · A base da receita é a mensalidade por escalões de vendas, sem taxa sobre cada venda

- **Estado:** aceite
- **Data:** 03/10/2026
- **Quem decidiu:** Diogo
- **Decisão em aberto de origem:** D-14 (`docs/06-decisoes-em-aberto.md`), em parte

## Contexto

Estudo em `docs/09-modelo-de-receita.md`. O Lumavo não recebe o dinheiro dos
comerciantes (D-5), por isso não pode ganhar com pagamentos como o Shopify (76 %
da receita do Shopify em 2025, segundo um resumo do relatório anual). Uma taxa
sobre cada venda somava-se à taxa do prestador de pagamento.

Pergunta feita ao Diogo: *«Fica a mensalidade por escalões de vendas, sem taxa
sobre cada venda, como base do modelo?»* Resposta, a 03/10/2026: *«sim, fica
assim»*.

## Opções consideradas

As nove fontes de receita de `docs/09` §3.

## Decisão

A receita do Lumavo assenta numa **mensalidade por plano que sobe por escalões
de vendas anuais**. **Não há taxa sobre cada venda.**

## Consequências

- O Lumavo mede o volume de vendas anual de cada comerciante para saber o
  escalão (dado que já tem: as encomendas passam por ele).
- **Continuam por decidir:** os preços e os limites de cada escalão (depois de
  falar com 3 a 5 comerciantes e da estimativa D-13), e as outras fontes
  propostas em `docs/09` §4 (partilha com o prestador de pagamento às claras,
  módulos por país, migração, comissão da loja de extensões).
- **Nunca custos de saída** (Data Act, a partir de 12/01/2027) — não é escolha,
  é lei.
- Não é o OK para código (ADR-0001).

## O que ficou por verificar

- Como um comerciante muda de escalão a meio do ano (subida e descida) — por
  desenhar.
- O IVA das mensalidades para comerciantes de outros países (autoliquidação) —
  com contabilista.
