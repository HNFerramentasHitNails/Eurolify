# Hub: os nomes do canal e do mercado nas publicações — 09/10/2026

Pedidos do Diogo, 09/10/2026: *«sim, avança com os nomes do canal e do
mercado»*, *«sim, aprovo o desenho, junta o #259»*, *«sim, avança com o
código dos nomes»* e *«sim, junta como está»*. Issue #258; desenho em
`docs/22` §18 (#259); código no #261 (squash c8ce1e8).

## O que se fez

- **API (#261)**: `GET /hub/products/{id}/publications` junta a cada
  publicação `canal_nome` e `mercado_nome`, lidos por
  `nomesDeCanaisEMercados` (`precos/repositorio.ts`) em duas consultas na mesma transacção, no
  contexto do comerciante (RLS) e com o filtro `comerciante_id` escrito;
  sem publicações, não consulta. A rota pela chave
  (`GET /products/{id}/publications`, Catálogo, #77) não muda. Sem migração.
- **Hub (#261)**: a secção «Publicações» da ficha mostra os nomes; sem
  nome, o identificador, como antes.
- **Revisão Opus 5.5** (agente da sessão, ADR-0035): 0 P0, 0 P1, 1 P2 e 7
  P3. P3-1 a P3-5 e P3-7 tratados no f76ad86. O P3-4 (a linha da passagem
  com `^`: a 375 px o nome acessível começa pelo rótulo da coluna) era a
  causa da primeira passagem falhada. P3-6 e P2-1 ficam no `docs/22` §18.4.
- **P2-1** (dois canais ou mercados com o mesmo nome ficam iguais na
  ficha): o Diogo decidiu juntar como está; passo próprio.
- **Sem alteração à VPS**: só a publicação normal pelo GitHub.

## Números (com data e como se contaram)

- 09/10/2026, local: API 1008/1008 (`vitest run`, em 24473d4);
  `test/hub-catalogo.test.ts` 14/14 depois das correcções; Hub 103/103;
  passagem 437/437 em duas corridas seguidas no f76ad86 e 439/439 no
  `main` com o #260 (`node scripts/capturas.mjs`, linhas «ok»).
- 09/10/2026, prova pela falha: sem o `.where("comerciante_id", …)` na
  consulta dos canais, o teste novo falha (os canais de B aparecem).
- 09/10/2026, GitHub: `publicar` 37988193781 (c8ce1e8) e 37988203132
  (1437eee, o #260 a seguir) verdes.
- 09/10/2026, ensaio, de fora: `hub.eurolify.eu` serve `index-BDCvcN6c.js`
  desde 20:50:19 UTC, o mesmo nome da construção local do 1437eee, e o
  ficheiro contém `canal_nome`; `/hub/products/{id}/publications` sem
  sessão dá 401.

## O que ficou por verificar

- Ver os nomes com uma sessão real no ensaio (não há sessão minha lá).
- Se há comerciantes com dois canais ou mercados do mesmo nome (P2-1).
- O aspecto da ficha com os nomes: falta o OK do Diogo ou do Bruno
  (página de aprovação).
