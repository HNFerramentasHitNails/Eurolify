# Ecrã das diferenças de pagamento: acrescentos Q1, Q2, Q3 (14/10/2026)

## O que se fez
- Diogo, 14/10/2026: Q1 A, Q2 A, Q3 A (desenho em `docs/22` §34, parágrafo
  «Acrescentos de 14/10/2026»).
- Q1: diálogo do incerto com montante, referência e data; texto da resolução
  sugerido e editável («Vi na conta da {prestador}…»). A rota
  `GET /hub/payment-issues` passou a dar `prestador`, `referencia`, `criado_em`.
- Q2: frase «A encomenda não fica paga…» em `montante_diferente` e
  `moeda_diferente`.
- Q3: migração 0106 tira `reembolso_incerto` da fila `pagamento`.
  Uma atribuição aberta fica guardada, sem efeito (testado).

## Números (com data e como se contaram)
- Ver a descrição do pedido; testes corridos a 14/10/2026 com o PostgreSQL 18.6.

## O que ficou por verificar
- Desvio: `reembolso_por_confirmar` e `reembolso_desconhecido` continuam na
  fila (não têm um reembolso `incerto`/`falhado` na fila `reembolso`); falta
  o Diogo confirmar.
- Qual referência o prestador mostra na conta (a dele ou o `identifier`).
- A migração 0106 e a lista de `comerciante.test.ts` acertam-se no merge com
  as 0104 e 0105.
