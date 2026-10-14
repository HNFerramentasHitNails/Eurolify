# Gatilhos `ALWAYS` e a reposição da base (#435, #441, #444), 13/10/2026

## O que se fez

- **#441 (migração 0091):** quatro gatilhos das notificações deixaram de ser
  `ALWAYS` (regra da 0053). Um teste de `seguranca-base` recusa um gatilho
  novo que crie notificações e fique `ALWAYS`.
- **#444, a fase de leitura:** em vez de mudar os outros gatilhos, mediu-se
  primeiro se a reposição da VPS os faz correr. Não faz. O Diogo aprovou não
  os mudar (*«sim, aprovo a proposta»*). Fica escrito em `docs/28` §7, com o
  teste `apps/api/test/copia-reposicao.test.ts`.
- **Lição:** a #435 e o #441 partiram do pressuposto de que uma reposição
  corria os gatilhos `ALWAYS`. Devia ter sido medido antes do pedido.

## Números (com data e como se contaram)

- **161 gatilhos `ALWAYS`** a 13/10/2026, depois da 0091. Contados em
  `pg_trigger` com `tgenabled = 'A'`, numa base com as migrações todas.
  Classificados pelo `prosrc`:
  - 95 guardas;
  - 31 `BEFORE` que mudam `NEW`;
  - 35 `AFTER` com `insert`, `update` ou `delete` noutra tabela.
- **Reposição de ensaio** (PostgreSQL 18 local, `pg_dump -Fc` e
  `pg_restore --no-owner`):
  - a data mudada pelo `BEFORE` ficou a original (2020-01-01);
  - a tabela escrita pelo `AFTER` ficou com 1 linha;
  - no `pg_restore -l`, os gatilhos vêm depois de todos os `TABLE DATA`.

## O que ficou por verificar

- **A VPS:** se a `eurolify-reposicao` lá corre com o mesmo resultado. O
  script é o mesmo (`pg_restore --no-owner --exit-on-error`), mas não foi
  corrido nesta sessão.
- **A classificação:** é por expressões regulares. Um gatilho que escreva
  através de uma função auxiliar pode ter ficado mal contado.
