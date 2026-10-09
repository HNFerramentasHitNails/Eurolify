# Hub: os preços do artigo na ficha — 09/10/2026

Pedidos do Diogo, 09/10/2026: *«sim, avança com o desenho dos preços do
artigo»*, *«sim, aprovo o desenho dos preços»* e *«sim, avança com o código
dos preços do artigo»*. Issue #249; desenho em `docs/22` §17 (#250);
código no #252 (squash a1f0813).

## O que se fez

- **API (#252)**: uma leitura nova no domínio de Preços,
  `GET /products/{id}/prices` (`prices:read`), e `GET /hub/products/{id}/prices`
  com a mesma função (`precosDoArtigoApi`): as listas activas, por páginas,
  cada uma com o mercado (moeda, se inclui IVA) e os preços das variantes do
  artigo pela ordem da ficha, com a redução em vigor e o preço por unidade.
  As reduções em vigor saem de uma só função (`reducoesEmVigor`), também
  para `GET /price-lists/{id}/prices`. Sem migração.
- **Hub (#252)**: a secção «Preços» na ficha, para os quatro papéis, uma
  caixa por lista; o Hub não calcula IVA, a redução nem o preço por unidade.
- **Textos mudados em relação ao desenho** (revisão, P2-1 e P2-2): «o mais
  baixo dos 30 dias antes da redução» (em inglês dizia «os últimos 30
  dias») e «com quatro casas» (dizia «sem arredondar», mas o servidor
  arredonda na quarta). O fim da redução leva a hora. Escrito no §17.3.
- **Revisão Opus 5.5** (agente da sessão, ADR-0035): 0 P0, 0 P1, 3 P2 e 10
  P3, tratados no 395fdd7 menos o P3-9 (tecto de variantes), justificado.
- **Também no #252**: o teste de Clientes `clientes-vies.test.ts` (do #244)
  falhava 3 em 5 corridas por uma resposta «pedidos a mais» deixada pelo
  teste anterior; corrigido só no teste (0 em 10). Aviso no #244.
- **Sem alteração à VPS**: só a publicação normal pelo GitHub.

## Números (com data e como se contaram)

- 09/10/2026, local: API 1007/1007 (`vitest run`), dos quais 6 em
  `test/hub-precos.test.ts`; Hub 103/103; passagem 436/436 em duas corridas
  seguidas (`node scripts/capturas.mjs`, linhas «ok»).
- 09/10/2026, GitHub: `publicar` 37961549173 verde.
- 09/10/2026, ensaio, de fora (`curl` sem sessão a
  `/hub/products/{id}/prices`): 401 desde 16:53:27 UTC; `hub.eurolify.eu`
  serve `index-BuAaN9xk.js`, o mesmo nome da construção local do a1f0813.

## O que ficou por verificar

- Ver os preços com uma sessão real no ensaio (não há sessão minha lá).
- Um leitor de ecrã real; artigos com centenas de variantes.
- Um papel sem `prices:read` no Hub: não se testa enquanto os quatro papéis
  o tiverem.
- O aspecto e os dois textos mudados: falta o OK do Diogo ou do Bruno
  (página de aprovação).
