# API do Catálogo, parte 6: categorias e colecções — 08/10/2026

## O que se fez

- **Código** (#170, juntado como abc3468; issue #77). Pedido do Diogo, 08/10/2026: «sim, junta o #169 e avança com as categorias».
- **Com `catalog:read`:**
  - `GET /categories` e `GET /collections`: por ordem de criação, filtro `estado`, por páginas; cada colecção traz `total_artigos`;
  - `GET /categories/{id}` e `GET /collections/{id}`;
  - `GET /collections/{id}/products`: pela ordem da colecção, com o estado de cada artigo;
  - `GET /products/{id}/categories`: com a versão do artigo.
- **Com `catalog:write`**, com a `Idempotency-Key`:
  - criar, alterar, arquivar e repor categorias e colecções;
  - `POST /categories/{id}/move`;
  - `PUT /products/{id}/categories` (até 100);
  - `PUT /collections/{id}/products` (até 1000).
- **Regras:** as da 0007 e do repositório (`categorias.ts`). Sem migração nova e sem `DELETE`, porque categorias e colecções arquivam-se.
- **Mudança no repositório** (revisão, P2-1): a lista repetida recusa-se depois do «não existe» e da versão.
- **Duas rondas de revisão do agente** (Claude Sonnet 5.5), publicadas no #170 com o tratamento:
  - 1.ª ronda: 4 P2 e 7 P3;
  - 2.ª ronda: sem P0, P1 nem P2.
- **Publicado no ensaio:** corrida 37764221512 do fluxo `publicar` (main abc3468), imagem `sha256:09554a44f526896eb5ad47683e24da57e1e3d40a6f59b4fff4c7bc4489b36f4d`, acabou às 10:38 UTC. O registo diz:
  - «migrar: nada em falta.»;
  - «O /health da API responde.»;
  - «MCP: arrancou e responde.»;
  - «Hub: os ecrãs desta publicação estão no ar.»;
  - «A API chega à base.»

## Números (com data e como se contaram)

- 08/10/2026, `pnpm teste` local contra o PostgreSQL 18.6 (por docker), já com o #168 do main: API 806, MCP 58, Hub 34, todos a passar.
- `test/catalogo-api-categorias.test.ts`: 12 testes.
- Mutações (uma de cada vez, ficheiros repostos, contadas pela linha «Tests» do vitest):
  - 1.ª ronda: 10 feitas, 8 apanhadas à primeira. As 2 que passaram eram as contagens de artigos por colecção; com uma segunda colecção no teste, passaram a ser apanhadas.
  - Depois da revisão: 5 feitas, 5 apanhadas.
- CI do pedido sobre eee1b75: verde.

## O que ficou por verificar

- **Por decidir (Diogo ou Bruno):** os limites de 100 categorias por artigo e de 1000 artigos por colecção num `PUT`, que são **proposta**.
- Quem muda uma categoria ou uma colecção não fica registado (C7): as tabelas da 0007 não têm a coluna.
- A lista de categorias não filtra pelo pai nem devolve a árvore montada.
- No mesmo commit do main correram duas vezes o fluxo `operar` (37764367827 falhou, 37764595476 passou, às 10:34 e 10:36 UTC). Foram lançadas à mão com a conta do repositório, não por esta sessão; não vi o que fizeram.
- O MCP da VPS continua sem autorização nesta sessão.
