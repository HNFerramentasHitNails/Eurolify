# Pós-venda: o aviso do prazo do reembolso (R10; #328, #353), 11/10/2026

## O que se fez

- **Pedido do Diogo, 11/10/2026:** *«avança com o aviso do prazo do
  reembolso»*. A R10 do `docs/30` já estava aprovada; faltava dizer a quem e
  como. Desenho em `docs/30` §14; **aprovado** (*«aprovado»*; `docs/06`, DQ).
- **Não há e-mail nem entrega de webhooks no código** (procurado em
  `apps/api/src` e no plano, 11/10/2026): o aviso é um evento na
  `evento_saida` e uma lista da API.
- **Código (#353, migração 0063):**
  - o prazo **no fuso do comerciante** (o dia do pedido + 14, **C**, J4),
    numa função da base, usada pela leitura, pela lista e pela tarefa; era UTC
    desde a parte 1;
  - o limiar dos 3 dias numa função da base (`posvenda_dias_de_aviso`);
  - `refund.deadline_approaching` (faltam 3 dias ou menos) e
    `refund.deadline_passed` (passou), cada um uma vez, sem dados pessoais; a
    base recusa um aviso fora de hora ou numa devolução fechada ou cancelada;
  - a tarefa de hora a hora, com a origem de quem pediu (regra da 0060);
  - `GET /returns?prazo_reembolso=a_acabar|passado`.
- **Um pedido fora de prazo aceite pela loja não tem aviso** (revisão do
  #353, P2-4; **C**, J4): o prazo legal pressupõe uma livre resolução no
  prazo.
- **A migração é a 0063:** começou como 0062; o #354 (rasto) entrou primeiro.
- **Revisão do agente** (`eurolify-critical-review`, Claude Sonnet 5.5): 0 P0,
  0 P1, 4 P2, 8 P3; tratados, com o que fica explicado no pedido.
- **Juntado** a 11/10/2026 (`dd112af`). **Publicado no ensaio:** corrida 38165970858, com sucesso às 19:05 UTC; o registo diz «migrar: aplicadas 0063_pos_venda_prazo_do_reembolso» e «O /health da API responde».

## Números (com data e como se contaram)

- 11/10/2026, neste contentor (PostgreSQL 18.6 da lista
  `infra/ci/imagens-base.txt`, Node 24.21), com o `main` do #357: `pnpm lint` e
  `pnpm tipos` limpos; **API 1358 de 1358**, Hub 161, MCP 58.
- 3 testes novos em `test/posvenda-api.test.ts`.
- Mutações: 17, 16 apanhadas; uma equivalente (o filtro do estado na lista,
  que a base já garante).

## O que ficou por verificar

- **O desempenho da lista** com muitas devoluções: não medido.
- **O jurista (J4):** os 14 dias, o direito de reter até receber o bem, e se
  o pedido fora de prazo aceite fica mesmo sem prazo.
- **Por fazer:** o e-mail ao comerciante (com as notificações), o ecrã do
  Hub (com a pós-venda no Hub), a marca «selado por higiene» (R4).
- **Não li a base do ensaio** depois de publicar.
