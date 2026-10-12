# Acrescentar uma variante a um artigo existente (#321, #324, #326, #331) — 10/10/2026

## O que se fez

- Desenho no `docs/22` §24 (#324, squash `a20a050`), aprovado pelo Diogo a
  10/10/2026 («aprovado»).
- API (#326, squash `6644d12`): `POST /hub/products/{id}/variants`, com a
  mesma escrita da rota pela chave (`criacaoDaVariante` em
  `apps/api/src/catalogo/rotas.ts`); dono e gestor (`catalog:write`);
  `catalog.external_field` num artigo do sistema de gestão.
  - `escreverNoHub` põe `lock_timeout` de 5 s em **todas** as escritas do
    Hub: com o artigo preso, 503 `catalog.retry` em vez de esperar sem
    limite (revisão, P2-1).
  - Revisão do agente (Opus 5.5) publicada no #326: 0 P0, 0 P1, 1 P2, 4 P3.
  - No ensaio: a 10/10/2026 às 19:16 UTC, `POST
    https://hub.eurolify.eu/hub/products/prd_…/variants` sem sessão dá 403
    (uma rota inexistente dá 404).
- Hub (#331, squash `bf311f6`): a página `/artigos/{prd_…}/variantes/nova`
  («Acrescentar variante») e a ligação na ficha, para quem tem
  `catalog:write`, fora dos artigos do sistema de gestão.
  - Os campos da variante passaram para `CamposDaVariante.tsx`, partilhado
    com «Editar a variante».
  - Sem `Idempotency-Key`: depois de uma resposta perdida, só se dá por
    criada uma variante **nova** (não lida ao abrir), activa e igual ao
    corpo enviado, valores das opções incluídos (`varianteIgualAoCorpo`).
  - O aviso na ficha diz o SKU («Variante ENS-041-B criada.»); o SKU vai em
    `skuCriado` porque o `sku` da consulta é o filtro da lista. Num artigo à
    venda, «fica fora das lojas…»; sem as publicações, «não conseguimos
    confirmar…».
  - Revisão do agente (Opus 5.5) publicada no #331: 0 P0, 1 P1 (a resposta
    perdida dava como criada uma variante que já existia), 3 P2, 6 P3;
    corrigidos, menos a marca visível de obrigatório no SKU (o Hub não tem
    padrão para isso).
  - Aspecto aprovado pelo Diogo a 10/10/2026 («aprovado», página de
    aprovação, versão 13). A captura a 375 px claro dessa versão estava
    partida (sem comprimento, largura e altura; defeito da captura, não do
    ecrã, revisão P2-3); as seis capturas do ecrã foram trocadas pelas da
    passagem final na versão 14.
  - No ensaio desde as 19:30 UTC de 10/10/2026: o hub.eurolify.eu serve
    `index-DKtmK6o8.js`, igual ao build local do `bf311f6`.

## Números (com data e como se contaram)

- 10/10/2026, API (#326): 1206 testes verdes em 71 ficheiros (vitest,
  PostgreSQL 18 local), depois de juntar o #312.
- 10/10/2026, Hub (#331): 140 testes (vitest, 17 ficheiros); passagem
  (`capturas.mjs`) 517 «ok», 0 falhas (`grep -c '^ok'` no registo; eram
  514 antes das correcções da revisão, 500 antes do ecrã).
- Das três passagens depois das correcções, duas falharam uma vez cada em
  ecrãs que o #331 não toca: «opções: um conflito…» (a passagem passou a
  esperar pelo nome relido) e «imagens: … a resposta perdida ao ligar…»
  (tempo esgotado; causa não encontrada, não se repetiu).

## O que ficou por verificar

- No ensaio não se criou uma variante real; só a rota (403 sem sessão) e o
  build servido.
- Risco que fica: outra pessoa cria exactamente a mesma variante no mesmo
  instante em que a resposta se perde — o ecrã dá-a como sua.
- Leitores de ecrã reais; capturas a 768 px depois das correcções.
- A causa da falha isolada da passagem das imagens.
