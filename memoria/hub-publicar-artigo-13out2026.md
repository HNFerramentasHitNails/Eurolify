# Hub: publicar um artigo (13/10/2026; issue #378, pedido #421)

## O que se fez

- **API** (`docs/22` §27.7): `GET /hub/sales-pairs`, `POST /hub/products/{id}/publications/check`, `POST /hub/products/{id}/publications` e `POST /hub/publications/{id}/archive`, com as mesmas funções da chave. A `versao` lida confere-se dentro de `publicar` e `retirarPublicacao` (`src/catalogo/publicacao.ts`): `null` só numa publicação que nasce no pedido.
- **Hub**: a página `/artigos/{prd}/publicacoes/{chn}/{mkt}` (`PublicarArtigo.tsx`, lógica em `publicar.ts`) e as acções na secção «Publicações» da ficha (`Artigo.tsx`). O ecrã foi escrito por um agente construtor e revisto aqui.
- **Decisão EJ** (Diogo, 13/10/2026: «A»): numa publicação que não está à venda, nenhuma variante vem marcada (`docs/06`).
- A marca «nova» (pedido #427): pela data de criação da variante, que a API já dava, contra a da última publicação; só no Hub.
- Aspecto e os quatro textos novos aprovados pelo Diogo (13/10/2026, «A»).
- Revisão do agente (Sonnet 5.5): 0 P0, 0 P1, 4 P2 e 10 P3, tratados no pedido.

## Números (com data e como se contaram)

- 13/10/2026, com a base local: `test/hub-publicar.test.ts`, 8 de 8; os testes do catálogo e do contrato, 172 de 172 (antes da revisão).
- Hub: 263 testes antes de juntar o main; 276 depois.
- Capturas (script `capturas.mjs`, base descartável): 662 verificações, 22 da passagem de publicar, antes da decisão EJ.

## O que ficou por verificar

- Uma variante criada com o ecrã aberto, num par sem publicação publicada, entra se a pessoa não recarregar (o servidor grava as `variantes_fora` do ecrã; passa pela verificação do preço e do peso). **Tratado a 13/10/2026:** o ecrã manda as `variantes_vistas` e uma activa que lá não esteja dá 409 (`docs/22` §27.2; teste em `hub-publicar.test.ts`).
- Safari e um telemóvel real.
