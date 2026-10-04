# Fatia 2 (Comerciante): o primeiro código com base — 04/10/2026

**Pedido do Diogo (04/10/2026):** *«juntei o #42, começa o código da fatia 2»*.
Desenho: `docs/15-dominio-comerciante.md` (decidido no mesmo dia).

## O que se fez

- `apps/api/migracoes/0001_comerciante.sql`:
  - seis tabelas: comerciante, entidade legal, loja, aceitação de contrato, prova de verificação, transição de estado;
  - RLS `ENABLE` + `FORCE` em todas, com a política `comerciante_id = comerciante_actual()`;
  - o utilizador `eurolify_api` criado `NOLOGIN NOBYPASSRLS`, sem palavra-passe (dá-a cada ambiente), com `SELECT/INSERT/UPDATE` nas três primeiras tabelas e só `SELECT/INSERT` nas três que só se acrescentam;
  - na base, as transições permitidas e as condições para activar (os dois contratos aceites e a prova do número fiscal, decisão P3);
  - na base, um gatilho diferido que desfaz uma mudança de estado sem linha de rasto na mesma transacção.
- O Kysely 0.29.6 (ADR-0025). Na série 0.29 o `Migrator` vem de `kysely/migration`, e não de `kysely`. O migrador lê os `.sql` (`src/base/migracoes.ts`). O `dist/migrar.js` usa `BASE_DADOS_URL_MIGRACAO`; sem ela diz-o e sai sem erro, porque o `api.env` da VPS está vazio.
- No `Dockerfile`, as migrações passam a ir na imagem, ao lado do `dist/`.
- `src/comerciante/repositorio.ts`: o acesso interno, com `comComerciante` (`set_config(…, true)` = `SET LOCAL`); traduz os erros da base para `merchant.*` e `legal_entity.*`.
- 21 testes (`test/comerciante.test.ts`), numa base nova por ficheiro, migrada como superutilizador e usada como `eurolify_api`.

## Números (com data e como se contaram)

- `pnpm teste` com `EXIGIR_BASE=1` contra o PostgreSQL 18.6 local: api 57 passados (21 novos), mcp 30 — 04/10/2026.
- **Prova de que os testes apanham a falha:** com `ALTER ROLE eurolify_api BYPASSRLS`, 6 dos 21 falham. Reposto `NOBYPASSRLS`, confirmado `f` em `pg_roles`.
- Confirmado no PostgreSQL 18.6:
  - o `uuidv7()` existe;
  - sem contexto, a base dá `42704` (ligação nova) ou `22P02` (ligação reaproveitada) — nunca vazio.

## Como ter PostgreSQL 18 numa sessão de cloud

O `docker` está instalado, mas o daemon vem parado. `dockerd &` arranca-o. Depois, `docker run -d -e POSTGRES_PASSWORD=verificar -p 127.0.0.1:5432:5432 postgres:18.6@sha256:5a5a…` (o mesmo resumo do `verificar.yml`), e `BASE_DADOS_URL=postgres://postgres:verificar@127.0.0.1:5432/postgres`.

## O que ficou por verificar

- A imagem Docker com as migrações: construída só pelo CI (o trabalho `imagem`).
- Na VPS: os dois utilizadores da base e o `api.env` (próximo pedido ao script, ADR-0028).
- A morada e o número fiscal por país: hoje só se exige texto, e o número fiscal em maiúsculas e algarismos (**C**).
- A activação não pergunta ao motor de regras se os países estão verificados (o desenho §4 pede-o): fica para quando a API existir.
