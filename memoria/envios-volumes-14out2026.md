# Envios: vários volumes numa expedição (14/10/2026)

O Diogo aprovou o desenho a 14/10/2026 (*«sim, aprovo; avança com o
código»*). O desenho é o `docs/36` §23, a parte 3 da Q6 da decisão ED
(issue #393). Esta parte usa só a Sendcloud: os CTT continuam sem
especificação (§11, V1).

## O que se fez

- **Os volumes:** uma expedição pode ter 2 a 15 caixas, cada uma com o seu
  peso (migração 0099; a 0097 é da faturação e a 0098 dos clientes). Mudam como o peso corrigido: só antes da etiqueta,
  com motivo, e ficam no rasto.
- **O serviço** tem de os levar (`maxVolumes` no contrato; na Sendcloud,
  `functionalities.multicollo`), e o peso máximo é por caixa.
- **A etiqueta:** um pedido, uma etiqueta e um seguimento por caixa. Menos
  etiquetas do que caixas fica incerta.
- **A entrega:** só com todas as caixas entregues. A livre resolução conta
  do último bem (Dir. 2011/83/UE, art. 9.º, n.º 2, b), i) e ii); DL
  24/2014, art. 10.º, lidos no `eur-lex`). Uma caixa perdida abre um
  problema e não acaba a expedição.

## Números (com data e como se contaram)

- 14/10/2026, local, com o PostgreSQL 18.6 num contentor (resumo do
  `vitest`):
  - `test/envios-volumes.test.ts`: 5 verdes;
  - `test/envios-sendcloud.test.ts`: 14 verdes (1 novo);
  - os testes dos envios e os de contrato (16 ficheiros): 165 verdes.
- **Prova pela falha:** sem «entregue só com todos» e sem «menos
  etiquetas fica incerta», falham 2 de 5.

## O que ficou por verificar

- Numa conta real da Sendcloud: o caminho do anúncio com várias caixas
  (V15) e se há um estado por caixa (V16). Em modo teste só há
  `sendcloud:letter`, por isso os volumes só se usam em modo real.
- **O Hub** («Volumes» em «Expedir»): pedido 2.
