# Funções das contas sem o contexto do comerciante na VPS (#168) — 08/10/2026

## O que se fez

- 08/10/2026, 09:24: o primeiro convite pelo fluxo `operar` falhou na VPS com
  `42704 unrecognized configuration parameter "eurolify.comerciante"`, depois
  da cópia da base e sem escrever.
- Causa: as funções SECURITY DEFINER correm como o dono das tabelas; na VPS
  ele não é superutilizador nem salta o RLS, e a tabela `comerciante` (FORCE
  RLS) lê `comerciante_actual()`. Os testes criavam a base com um
  superutilizador, que salta o RLS: o erro nunca aparecia. Também falhavam
  na VPS aceitar um convite (`convite_em_aberto` → `comerciante_escreve`) e o
  `/hub/me` (`pessoa_eu`).
- Correcção (pedido #168): o comando do operador cria o convite em
  `comComerciante`; migração 0027 com `comerciante_resumo(id)` (contexto
  desse comerciante só durante a leitura, repõe o anterior; a cláusula SET
  da função não serve, um dono sem superutilizador não a pode pôr), usada por
  `comerciante_escreve` e `pessoa_eu`; `test/base-de-teste.ts` cria a base
  com um dono como o da VPS.

- Verificado na VPS, depois do #168 (publicado às 10:28, `migrar: aplicadas 0027`):
  o convite foi aceite e o `/hub/me` mostrou a «Loja de Ensaio» (10:36,
  captura do Diogo).

## Números (com data e como se contaram)

- 08/10/2026, `vitest run` da API com a base de teste com dono como o da
  VPS, antes da 0027: 109 de 773 falham em 8 ficheiros, 104 com o mesmo
  `42704`. Depois da 0027 e de acertar 2 testes: 777 de 777 (4 novos em
  `identidade-contexto.test.ts`).
- Mutação: sem a reposição do contexto na `comerciante_resumo`, 2 dos 4
  testes novos falham.
- Revisão Opus 5.5 do #168: 0 P0, 1 P1, 0 P2, 6 P3. P1-1 reproduzido numa
  instância do PostgreSQL vazia (como a do CI): «permission denied to create
  role» — a base de teste passou a criar o `eurolify_api` e o
  `eurolify_limpeza` antes de migrar, como o `preparar.sh` (passo 10b).
  Depois: 794 de 794 na instância vazia (API), Hub 34, MCP 58. Os 777 de
  antes vinham de uma instância onde os papéis já existiam.

## O que ficou por verificar

- O resto do Hub na VPS (equipa, convites pelo Hub, chaves) não foi
  exercitado.
- Depois de uma chamada sem contexto antes, a sessão fica com
  `eurolify.comerciante` vazio (não ausente): leituras protegidas falham com
  22P02 em vez de 42704. Coberto por teste; nenhum código conhecido distingue
  os dois.
- O `apps/hub/scripts/capturas.mjs` (manual) ainda cria a base com um
  superutilizador.
