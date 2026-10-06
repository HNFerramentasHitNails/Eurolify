# Identidade: criar e revogar chaves pela API, e a idempotência (#107) — 06/10/2026

## O que se fez

Pedido do Diogo, 06/10/2026: *«avança com o POST /keys e a revogação»*
(por fazer no #107, depois do #110 e do #116).

- **Desenho primeiro:** `docs/19` §6.1. A lacuna era que a idempotência
  guarda a resposta para a repetir, e a resposta do `POST /keys` traz o
  segredo, que o T5 proíbe na base.
  - **Decisão:** guarda-se a resposta sem o segredo. Repetir o pedido dá
    `idempotency.secret_not_repeated` (409), com o id da chave criada, e não
    cria outra.
  - Fica escrito como decisão técnica de rotina; não foi pergunta ao Diogo.
- **Migração 0012:**
  - `chave_criar_pela_api` e `chave_revogar_pela_api`: a base encontra quem
    pede pelo **resumo do segredo apresentado** (`chave_que_pede`, que a API
    não pode chamar sozinha);
  - exige uma chave válida, do comerciante do contexto e com `keys:write`;
  - T9: os âmbitos da nova estão todos nos de quem pede. A pública tem só
    `storefront` e qualquer gestora a cria (**proposta**: a regra literal
    impediria sempre a pública, porque `storefront` nunca está numa de
    servidor);
  - não se revoga a última com `keys:write` (`key.last_key_writer`);
  - uma tranca por comerciante (`pg_advisory_xact_lock`) em criar e revogar,
    com quem pede verificado de novo debaixo dela;
  - `criada_por` e `revogada_por` passam a `chave:key_<id>`;
  - a tabela `idempotencia`, com RLS forçado e as colunas que a API pode
    escrever limitadas.
- **Código:**
  - `src/base/idempotencia.ts`: reservar, escrever e concluir na mesma
    transacção; apagar se a escrita falhar; um órfão conta ao fim de 60 s;
  - as rotas `POST /keys` e `POST /keys/{id}/revoke`;
  - os códigos `idempotency.*` em `CODIGOS_BASE`;
  - o `resumo` no contexto da chave.
- **Documentos:** `docs/17` (T7 e a retenção de 24 h), `docs/18` §2 e §4,
  `docs/19` §3, §6 e §9.

## Números (com data e como se contaram)

Contra o PostgreSQL 18.6 local, com o resumo do `ensaio.conf`, a 06/10/2026:

| O quê | Resultado |
|---|---|
| Antes de mexer (`main` `fee7564`) | 388 testes passam na API |
| Depois | **407** na API (19 novos em `identidade-escrita.test.ts`) e 58 no MCP; `pnpm lint`, `tipos` e `construir` passam |
| Sem o T9 na 0012 | 2 testes falham (`T9…` e «uma escrita que falha liberta a chave») |
| Sem a tranca na revogação | 2 testes falham (as duas corridas de T11, 5 voltas cada) |
| Sem a regra da última | 2 testes falham |

## O que ficou por verificar

- A tarefa diária que apaga as linhas expiradas da `idempotencia`. Hoje, uma
  linha expirada só se substitui quando a mesma chave volta. Tem de existir
  antes de uma rota com dados pessoais usar a idempotência (`docs/17` §3).
- Os estados HTTP de `idempotency.key_reused` (422) e `in_progress` (409)
  continuam **proposta** do `docs/18`, sem fonte lida.
- Uma escrita que falha apaga o `em_curso` com o mesmo resumo. Se, nesse
  intervalo, outro pedido igual o tiver substituído por ser órfão (mais de
  60 s), apaga o dele, e esse dá `in_progress` em vez de escrever duas vezes.
  Visto ao ler, não medido.
- O ensaio na VPS: as chaves só servem lá quando o operador criar a primeira
  (falta a chave SSH do fluxo `operar`).
