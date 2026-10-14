# Ecrã das diferenças de pagamento: acrescentos Q1, Q2, Q3 (14/10/2026)

## O que se fez
- Diogo, 14/10/2026: Q1 A, Q2 A, Q3 A (desenho em `docs/22` §34, parágrafo
  «Acrescentos de 14/10/2026»).
- Q1: diálogo do incerto com montante, data (fuso do comerciante), a referência
  do prestador só se existir e o identificador nosso à parte; texto da
  resolução sugerido e editável («Vi na conta da {prestador}…»; sem referência
  do prestador, só montante e data). A rota `GET /hub/payment-issues` dá
  `prestador`, `referencia_prestador`, `identificador`, `criado_em` e o `fuso`
  (revisão do #470, P2-1: a nossa referência hex não se vê na conta da EuPago).
- Q2: frase «A encomenda não fica paga…» em `montante_diferente` e
  `moeda_diferente`; «Escreva aqui o que fez.» só no diálogo.
- Q3: migração 0106 tira `reembolso_incerto` da fila `pagamento`.
  Uma atribuição aberta fica guardada, sem efeito (testado).

## Números (com data e como se contaram)
- A 14/10/2026, com o PostgreSQL 18.6 local (`vitest run`, uma suite de cada vez):
  Hub inteiro, 324 testes certos (28 ficheiros); suite inteira da API,
  1721 testes certos e 2 saltados (116 ficheiros: 114 certos, 2 saltados),
  exit 0, antes e depois da revisão do #470.
- Prova de falha: sem o filtro da 0106, falham os testes da fila `pagamento`
  (`tarefas-pagamentos-sem-reembolsos`, `posvenda-api` «recusado fica falhado»).

## O que ficou por verificar
- Desvio: `reembolso_por_confirmar` e `reembolso_desconhecido` continuam na
  fila (não têm um reembolso `incerto`/`falhado` na fila `reembolso`); falta
  o Diogo confirmar.
- Se a data do pagamento que o Hub mostra (criação do pagamento, no fuso do
  comerciante) é a que a EuPago mostra na conta: não verifiquei.
- A migração 0106 e a lista de `comerciante.test.ts` acertam-se no merge com
  as 0104 e 0105.
