# Hub: canais e mercados com o mesmo nome nas publicações — 09/10/2026

Pedidos do Diogo, 09/10/2026: *«sim, avança com o desenho dos canais com o
mesmo nome»*, *«sim, aprovo o desenho, junta o #272»*, *«sim, avança com o
código dos canais com o mesmo nome»* e *«sim, acrescenta o «Loja:» para
leitores de ecrã»*. Issue #271 (vem do P2-1 da revisão do #261); desenho em
`docs/22` §19 (#272); código no #275 (squash d7cb370).

## O que se fez

- **API (#275)**: `GET /hub/products/{id}/publications` junta `loja_nome`,
  a loja do canal (que é a da publicação: migração 0019, linhas 85–87),
  pela mesma leitura dos nomes (`nomesDeCanaisEMercados`, `JOIN loja` pela
  chave composta). A rota pela chave não muda. Sem migração.
- **Hub (#275)**: `src/publicacoes.ts` decide, coluna a coluna: o nome se
  não se repete; com a loja por baixo se outro canal (mercado) com o mesmo
  nome é de uma loja com outro nome; com o identificador por baixo se nem
  a loja distingue; o identificador sem nome. A comparação ignora os
  espaços nas pontas. Antes da loja, «Loja:» só para leitores de ecrã.
- **Revisão Opus 5.5** (agente da sessão, ADR-0035): 0 P0, 0 P1, 2 P2 e 6
  P3, todos tratados. O P2-1 trouxe o teste com duas lojas do mesmo
  comerciante (o caso real do #271); o P2-2, a nota de que o isolamento da
  loja vem do canal já filtrado (o filtro escrito na loja é segunda guarda).
- **Sem alteração à VPS**: só a publicação normal pelo GitHub.

## Números (com data e como se contaram)

- 09/10/2026, local: API 1036/1036 (`vitest run`, antes das correcções);
  `test/hub-catalogo.test.ts` 15/15 depois delas; Hub 110/110; passagem
  440/440 em duas corridas no e7d262d (`node scripts/capturas.mjs`).
- 09/10/2026, prova pela falha: dando a todas as linhas a loja da
  primeira, o teste das duas lojas falha.
- 09/10/2026, GitHub: `publicar` 37999525392 (d7cb370) verde.
- 09/10/2026, ensaio, de fora: `hub.eurolify.eu` serve
  `index-DRYyAdGz.js` desde 22:36:28 UTC (o nome da construção local do
  d7cb370), o ficheiro contém `loja_nome`; o caminho sem sessão dá 401.

## O que ficou por verificar

- Ver as publicações com uma sessão real no ensaio (não há sessão minha
  lá) e um leitor de ecrã real com o «Loja:».
- Se há comerciantes com dois canais do mesmo nome (dados reais).
- O aspecto: falta o OK do Diogo ou do Bruno (página de aprovação).
