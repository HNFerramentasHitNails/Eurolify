# Hub: o ecrã «A decidir» (#366, parte 2) — 12/10/2026

## O que se fez

- **Desenho:** `docs/22` §28, pedido #394. Diogo, 12/10/2026: *«A, aprovado»*.
  Pela Q1 A, a lista avança sem ligação ao caso enquanto as filas não tiverem
  ecrã no Hub.
- **Código, no pedido #396:**
  - as rotas `/hub/tasks` (lista, caso, atribuir, prazo), com as filas que o
    papel lê. Para se atribuir a si próprio basta decidir a fila; atribuir a
    outra pessoa, tirar o responsável e mudar o prazo pedem também
    `tasks:assign`;
  - a migração 0073 (`tarefas_podem_ser_responsaveis`; era a 0072, renumerada porque o #374 entrou primeiro com a 0072);
  - o ecrã, o módulo na entrada e os textos PT, ES e EN.
- **O prazo escolhe-se no fuso do comerciante:** a lista do Hub leva o
  `fuso`, e a conversão está em `apps/hub/src/tarefas.ts`, testada com a
  mudança de hora.

## Números (com data e como se contaram)

- **Testes**, 12/10/2026, base local PostgreSQL 18.6:
  - 6 pela API, em `apps/api/test/tarefas-hub.test.ts`;
  - 13 sem servidor, em `apps/hub/test/tarefas.test.ts`;
  - 191 do Hub, todos a passar.
- **Mutações nas rotas, uma de cada vez:** foram apanhadas a falta de
  `tasks:assign` para atribuir a outros, o `responsavel=eu` ignorado e,
  depois da revisão do #396, tirar o caso a outra pessoa sem `tasks:assign`
  e a falta do bloqueio da IA declarada.
- **Depois da revisão:** 8 testes pela API e 193 do Hub.

## O que ficou por verificar

- Os textos de 15 dos 19 motivos de retenção de um documento (contados em
  `MOTIVOS_RETENCAO`, 12/10/2026): até lá, aparece o
  código (`docs/22` §28.7).
- A ligação de cada linha ao ecrã da fila, que ainda não existe.
- Safari e um telemóvel real.
- O motivo livre de uma mudança de prazo vê-se no histórico por todos os
  papéis que lêem a fila. A ligação dele ao apagamento do titular (DU)
  continua por fazer (`docs/33` §6).
- Os testes do componente sem servidor para o conflito, «Ver mais» e
  atribuir a outra pessoa.
