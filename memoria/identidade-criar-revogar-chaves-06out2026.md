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
  - `chave_criar_pela_api` e `chave_revogar_pela_api`: a base recebe o
    **segredo** de quem pede e calcula ela o resumo (`chave_que_pede`, que a
    API não pode chamar sozinha). Na primeira versão recebia o resumo, mas o
    das chaves do operador passa pelo GitHub (revisão, P2-2);
  - exige uma chave válida, do comerciante do contexto e com `keys:write`;
  - T9: os âmbitos da nova estão todos nos de quem pede. A pública tem só
    `storefront` e qualquer gestora a cria (**proposta**: a regra literal
    impediria sempre a pública, porque `storefront` nunca está numa de
    servidor);
  - nenhuma revogação pela API deixa o comerciante sem uma gestora válida
    (`key.last_key_writer`);
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
| Depois da revisão e do P2-3 | **413** na API e 58 no MCP; `lint`, `tipos` e `construir` passam |
| Depois da 0014 e da revisão do #124 (ramo do #124) | **419** na API e 58 no MCP; `lint`, `tipos` e `construir` passam |

## Revisão do agente (Claude Opus 5.5, ADR-0035), publicada no #118

Encontrou 0 P0, 0 P1, 5 P2 e 11 P3. Tratados na mesma sessão:
- **P2-1:** o validador recusa campos a mais e tipos errados
  (`removeAdditional` e `coerceTypes` desligados no `criarApp`). Antes, apagava
  em silêncio um `expires_at` mal escrito e criava a chave sem expiração.
- **P2-2:** a base recebe o segredo, não o resumo.
- **P2-5:** o teste do pedido lento cuja reserva órfã foi substituída. Sem a
  protecção, criava uma segunda chave.
- **P3:** o padrão do uuid, o segundo intercalar, o cabeçalho repetido, o
  contrato a dizer «obrigatório», a regra da última em qualquer revogação, o
  teste das revogações cruzadas aceita 401 ou 403, e os testes novos (256
  caracteres, os privilégios por coluna, a mesma chave noutro alvo, a chave
  expirada). Nos documentos: T7, o passo 5, a ordem das recusas e o RLS
  forçado na tarefa de limpeza.

**P2-3, decidido pelo Diogo (06/10/2026, «Não cria; revoga»):**
- a chave de um comerciante `suspenso` ou `fechado` não cria chaves
  (`key.merchant_inactive`), mas revoga;
- fica na `chave_criar_pela_api`, com teste. Tirada a regra, o teste falha.

**P2-4, decidido pelo Diogo (06/10/2026, «sim, concordo, nunca dura mais»):**
uma chave nunca cria outra que dure mais do que ela (`docs/19` §5, T12);
programada noutra sessão no #124 (migração 0014, `key.expiry_beyond_creator`).
Revisão do #124 (Claude Opus 5.5): 0 P0/P1, 1 P2 e 7 P3; os P3 tratados no
#124; o P2-1 decidido pelo Diogo («não pode revogar», `docs/19` §5, T14), por
programar.

**Loja arquivada, decidido pelo Diogo (06/10/2026, «sim, concordo, deixa de
funcionar»):** a chave pública dela não se cria e as que existem deixam de
resolver; o registo fica (`docs/19` §5, T13). Por programar.

| Protecção tirada | Testes que falham |
|---|---|
| Desfazer a escrita cuja reserva foi substituída | 1 (o do pedido lento) |
| O validador estrito (P2-1) | 1 (o das recusas) |
| A base aceitar o resumo (P2-2) | 1 (o da função na base) |
| Sem a regra da 0014 (06/10/2026) | 1 (o da chave com prazo) |
| `>` trocado por `>=` na 0014 (06/10/2026) | 1 (o da chave com prazo: o caso do prazo igual) |

**0014 aplicada na VPS** (06/10/2026, 11:33 UTC, fluxo `publicar`, execução
37456691422, `176e13a`): o registo diz «migrar: aplicadas 0014_chave_com_prazo.»
e «A API chega à base.» Não li a função na base (o conector do MCP da VPS
pedia autorização). Registado no #107.

## O que ficou por verificar

- ~~A tarefa diária que apaga as linhas expiradas da `idempotencia`~~ — feita
  na 0013 (#119), com o `eurolify-limpeza` na VPS
  (`memoria/idempotencia-limpeza-06out2026.md`).
- Os estados HTTP de `idempotency.key_reused` (422) e `in_progress` (409)
  continuam **proposta** do `docs/18`, sem fonte lida.
- Uma escrita que falha apaga o `em_curso` com o mesmo resumo. Se, nesse
  intervalo, outro pedido igual o tiver substituído por ser órfão (mais de
  60 s), apaga o dele, e esse dá `in_progress` em vez de escrever duas vezes.
  Visto ao ler, não medido.
- O ensaio na VPS: as chaves só servem lá quando o operador criar a primeira
  (falta a chave SSH do fluxo `operar`).

## T14, migração 0015 (06/10/2026, decisão BQ)

- Uma chave com prazo só revoga chaves que expirem no mesmo instante ou antes
  dela → `key.revoke_beyond_creator` (403). `CREATE OR REPLACE` da
  `chave_revogar_pela_api`, com a mesma assinatura e os mesmos privilégios.
- O teste antigo «T11: uma gestora temporária pode revogar a permanente»
  passou a T14: a temporária já não revoga a permanente nem uma mais longa;
  revoga uma no mesmo instante ou antes.
- Medido a 06/10/2026, PostgreSQL 18.6 instalado na sessão (pacote pgdg):
  439 testes da API passam; sem a regra, 1 falha (o T14); com `>=` em vez de
  `>`, 1 falha (o caso do mesmo instante).

## T13, migração 0016 (06/10/2026, decisão AY)

- Ao arquivar uma loja, as chaves dela ficam revogadas
  (`loja_arquivada:sto_<id>`), por um gatilho SECURITY DEFINER na loja (a
  API não tem privilégios na `chave_api`); se a loja voltar a activa, não
  voltam (Diogo: «fica a a)»). Criar uma para uma loja arquivada →
  `key.store_archived` (422), no gatilho da chave, com FOR SHARE na loja.
- Correcção: na pergunta ao Diogo escrevi que a loja arquivada «não volta
  atrás (docs/15 linha 90)». Essa regra é da entidade legal; a loja pode
  voltar a activa (docs/15 §3.3; `loja_antes_de_gravar` não o impede). Dito
  ao Diogo, que decidiu a a).
- Medido a 06/10/2026, PostgreSQL 18.6 na sessão: 440 testes da API passam;
  sem o gatilho da loja, 1 falha; sem a recusa na criação, 1 falha.
