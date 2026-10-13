# Envios: entrega num ponto de recolha ou cacifo (13/10/2026)

O Diogo aprovou o desenho a 13/10/2026 (*«sim, aprovo; avança com o
código»*), incluindo não pedir a morada de casa numa entrega num ponto. O
desenho é o `docs/36` §21 e é a parte 3 da Q5 da decisão ED (issue #393).
Esta parte usa só a Sendcloud: os CTT continuam sem especificação (§11, V1).

## O que se fez

- **O método de entrega diz onde entrega:** na `morada` ou num `ponto`
  (migração 0089). Um método `ponto` só aceita um serviço que a
  transportadora declare para pontos, e o contrário também.
- **No checkout:**
  - o cliente escolhe o método `ponto`, escreve o código postal e recebe até
    10 pontos (`GET /checkout/{token}/pickup-points`);
  - escolhe um (`PUT …/pickup-point`). O servidor procura outra vez e guarda
    a morada que a transportadora devolve, nunca a que o navegador manda;
  - só o país e o código postal saem para a transportadora;
  - há no máximo 20 procuras por sessão.
- **Antes do botão final** confere-se se o ponto ainda recebe encomendas.
  Se o ponto disser que não, ou se a transportadora não responder, a compra
  não se faz.
- **A morada fiscal nunca é a do ponto.** Sem morada de faturação, o perfil
  fica sem morada. Com NIF, o resumo pede a morada de faturação, porque o
  software de faturação recusa um cliente com NIF sem morada. Isto
  apareceu ao ler o `concluir`, fora do desenho.
- **A etiqueta** leva o id do ponto. O serviço de uma expedição para um
  ponto só muda para outro serviço de ponto.
- **Chegar ao ponto não é entregar** (DL 84/2021, art. 11.º, n.º 1, lido no
  `eur-lex`). Um «entregue» que não venha depois de um «para levantar» fica
  em «outro» e abre um problema na encomenda, para uma pessoa confirmar.

## Números (com data e como se contaram)

- 13/10/2026, local, com o PostgreSQL 18.6 num contentor (contados pelo
  resumo do `vitest`):
  - `test/envios-pontos.test.ts`: 6 testes verdes;
  - `test/envios-sendcloud.test.ts`: 11 verdes, 2 deles novos.
- **Prova pela falha,** com quatro protecções tiradas ao mesmo tempo:
  - a conferência do ponto no botão final;
  - a morada fiscal;
  - o filtro do país;
  - o «entregue» prudente.

  Falham 3 de 6 testes. Só sem a protecção da morada fiscal, falha o teste
  do botão final.

## O que ficou por verificar

- Numa conta real da Sendcloud, não se verificou nada:
  - se a entrega num ponto exige o telefone ou o e-mail de quem recebe (V7);
  - se `delivered` quer dizer «levantado» ou «deixado no ponto» (V8);
  - os erros de um ponto fechado (V9);
  - o formato do horário (V10);
  - se `carrier_code` é a parte do código do serviço antes de «:».
- **Em modo teste a Sendcloud só tem `sendcloud:letter`**, que não é um
  serviço de ponto. Por isso, um método `ponto` com a Sendcloud só se
  configura em modo real.
- **O jurista** tem de dizer se o dono do ponto é «um terceiro indicado
  pelo consumidor» (**C**; não encontrei regra no `eur-lex`).
- **O Hub** (o campo no método e o ponto em «Expedir») fica para o pedido 2.
