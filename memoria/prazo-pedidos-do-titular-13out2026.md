# O prazo de resposta a um pedido do titular — 13/10/2026

## O que se fez

Decisões do Diogo, 13/10/2026: Q-P1 «A» (desenho), Q-P2 «A» (sem ficha, fora
até se saber quem é), Q-P3 «a» (o aviso do prazo passado); `docs/06` EO;
`docs/23` §15.14 e §15.15.

- Parte 1 (migração 0092): `pedido_titular_recebido` (`prq_`), o prazo legal
  de um mês gerado na base, a prorrogação uma vez (o titular informado dentro
  do primeiro mês; o motivo da lista do art. 12.º, n.º 3), os
  três fins, a nona fila `pedido_titular` no «A decidir» (prazo 7 dias antes
  do legal). Escrita por um agente construtor (Opus 5.5) a partir da
  especificação; revista na sessão.
- Parte 2 (o aviso quando o prazo legal passa): desenho aprovado, por fazer.

## Números (com data e como se contaram)

- Testes da API: 1655 certos, 1 saltado (13/10/2026, suite inteira, base
  local pg18); Hub: 294 (13/10/2026).

## O que ficou por verificar

- O limite da prorrogação (dois meses ao todo, leitura conservadora): **C**.
- A oposição (art. 21.º) seguir o mesmo mês: **C**.
- O aviso `task.overdue` desta fila não foi testado de ponta a ponta.
- A exportação do titular junta os pedidos recebidos desde 14/10/2026
  (`pedidos_recebidos`, como os executados).
