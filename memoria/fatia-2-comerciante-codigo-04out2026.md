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
- Na VPS: os dois utilizadores da base, o `api.env` (ligação da API) e o `migrar.env` (ligação do migrador, só o contentor das migrações o recebe; criado vazio pelo `preparar.sh` a partir do commit da sessão de revisão, 04/10/2026) — próximo pedido ao script, ADR-0028.
- A morada e o número fiscal por país: hoje só se exige texto, e o número fiscal em maiúsculas e algarismos (**C**).
- A activação não pergunta ao motor de regras se os países estão verificados (o desenho §4 pede-o): fica para quando a API existir.

## Revisão do #43 (15:18 UTC) e correcções

Sem P0. Com 4 P1 e 7 P2. Corrigidos na migração 0001, que ainda não estava no `main`:

- **P1-1:** a activação olha para a prova mais recente de cada entidade activa, pela ordem de registo. A coluna `registado_em` não pode ser escrita pela API (`GRANT INSERT` por coluna).
- **P1-2:** o país e o número fiscal de uma entidade não mudam (gatilho).
- **P1-3:** o rasto é escrito pela base (gatilho `SECURITY DEFINER`, com o motivo e quem vindos de `SET LOCAL`). A API só o lê, e `de`/`para` têm `CHECK`.
- **P1-4:** o `migrar.js` tolera só a falta da variável e só até 31/10/2026 (data confirmada pelo Diogo a 04/10/2026: *«confirmo 31/10/2026»*); uma variável vazia é erro. A ligação do migrador vai para um ficheiro próprio na VPS.
- **P2:** a data de criação já não muda; o prefixo do país é recusado; a restrição tem nome; o papel volta a `NOLOGIN` no fim dos testes; o desenho foi acertado (transição rascunho→em revisão, uma transacção para todas as migrações, riscos que ficam).

**Números** (04/10/2026): api com 66 passados, dos quais 26 do comerciante e 4 do migrador. Com `BYPASSRLS` falham 8 dos 26.

## Segunda revisão do #43 e concorrência (04/10/2026)

A segunda revisão encontrou 3 P1: tabelas temporárias a desviar o rasto, tabelas temporárias a enganar a activação, e uma entidade arquivada a vender por uma loja activa. A sessão de quem escreveu corrigiu os três no `31710f2`.

A sessão de revisão repetiu as sondas contra esse commit, e as três fecham. Encontrou depois uma corrida que ficava: duas transacções ao mesmo tempo, uma a arquivar a entidade e outra a abrir uma loja activa nela, passavam as duas (medido). A correcção é o `FOR SHARE` na linha da entidade, no gatilho da loja. Há um teste com as duas ordens, que falha com a função antiga.

**Números** (04/10/2026, PostgreSQL 18.6): api com 70 passados e mcp com 30, em 3 corridas seguidas.

## Arquivada é final (Diogo, 04/10/2026, «sim, arquivada é final»)

- **A decisão:** responde ao P2-3 da revisão 5406927138. A base recusa voltar uma entidade arquivada a activa (`legal_entity.archived_is_final`).
- **O número fiscal:** passou a ser único só entre as entidades **activas**, por um índice parcial com o mesmo nome da restrição antiga (`entidade_legal_nif_unico_por_pais`). Voltar a usar um número arquivado é criar outra entidade, com prova nova.
- **Testes:** 71 passados com `EXIGIR_BASE=1` contra o 18.6, a 04/10/2026.

## Terceira revisão do #43 e os 6 P2 (04/10/2026)

A terceira revisão (sessão nova, PostgreSQL 18.6) não encontrou P0 nem P1: confirmou que a corrida do arquivo está fechada no `d0ea931`, nas duas ordens. Encontrou 6 P2, corrigidos a pedido do Diogo (*«Corrige os 6 P2 no ramo e empurra»*):

- **P2-1:** medido — a migração corrida por um utilizador que não é dono da base deixa o `eurolify_api` com `TEMPORARY` e só um `WARNING`, que o migrador não mostra. A migração passa a verificar `has_database_privilege(…, 'TEMP')` e a falhar alto. Na VPS, o `eurolify_migrador` tem de ser dono da base `eurolify` (docs/15 §5; fica para o pedido ao script).
- **P2-2:** o teste das tabelas temporárias aceita agora os dois contratos a sério, para a activação chegar à prova de verificação (`falta a prova do número fiscal`).
- **P2-3:** feito em paralelo pela sessão de quem escreveu, com a decisão do Diogo («sim, arquivada é final»): `98ca4c1`, `legal_entity.archived_is_final` e o índice parcial (secção acima). A versão desta sessão (um gatilho igual com outro nome de erro) foi retirada na junção.
- **P2-4:** a janela concorrente da verificação de activação ficou escrita no §10 do docs/15 (não medida).
- **P2-5:** `comerciante_actual()` sem `SET search_path` (volta a poder ser expandida em linha); função e tipo com `pg_catalog.`.
- **P2-6:** a citação do `preparar.sh:278` no §5 acertada.

**Números** (04/10/2026, PostgreSQL 18.6, `EXIGIR_BASE=1`): api com 71 passados (um teste novo, o do terminal) e mcp com 30; `pnpm lint` e `pnpm tipos` sem erros. Medido à parte: a migração corrida por um utilizador não dono pára com `ERROR: migracao 0001: …`, e nenhuma tabela fica (uma transacção); corrida pelo dono, `has_database_privilege('eurolify_api', …, 'TEMP') = f`.

## Os 13 P2 das revisões do `98ca4c1` e do `0f63e36` (04/10/2026, à noite)

O Diogo pediu a esta sessão que pegasse no #43 (*«sim, pega no #43 daqui»*): junção do `main` (`0bcea0b`) e os P2 das duas revisões das 19:08 e 19:13 UTC.

- **Feito:**
  - comentário da tabela `entidade_legal` no sítio certo;
  - uma prova nova só numa entidade activa (`legal_entity.archived`, gatilho com `FOR SHARE`);
  - o teste local `mudarEstado` renomeado e um teste que mostra porque «arquivada é final» importa;
  - `mudarEstado` leva o estado de partida (`de`): se já mudou, ou se é igual ao destino, `merchant.invalid_transition`;
  - o URL do migrador sem espaços e só `postgres://`/`postgresql://`, sem mostrar o valor;
  - o `preparar.sh` avisa se o `api.env` ou o `migrar.env` não são `600 root`;
  - o contentor do migrador com `--cap-drop ALL`, `no-new-privileges` e `--memory 512m`;
  - docs/15: estado do código, `fechado` não sai, regra por fazer (comerciante activo que troca a entidade provada), palavras-passe geradas pelo script da VPS, citações de linhas.
- **Decidido pelo Diogo** (*«congela a entidade inteira»*, 04/10/2026), P2-2 do `98ca4c1`: uma entidade arquivada não muda em nada, e nenhuma nasce arquivada (`legal_entity.archived_is_final`); teste novo, que falha com a migração anterior.
- **Na descrição do pedido:** quem tem uma base de desenvolvimento deste ramo tem de a recriar, porque a 0001 foi alterada no sítio (P2-6 do `98ca4c1`).

**Números** (04/10/2026, PostgreSQL 18.6 em Docker, `EXIGIR_BASE=1`, Node 22.22; com a decisão acima, 112 e `comerciante.test.ts` com 37): api com 111 passados, mcp com 30; `comerciante.test.ts` 36 e `url-migracao.test.ts` 7 (`grep -c "  it("`). Com o código anterior, 5 dos testes novos falham; os outros 3 guardam o que já estava certo. `pnpm tipos`, `pnpm lint`, `pnpm construir` e o `shellcheck` como o CI sem erros.

**Por verificar:** Node 24; o `preparar.sh` na VPS; o migrador com `--memory 512m` numa migração real.
