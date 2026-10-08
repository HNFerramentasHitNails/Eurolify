# API do Catálogo, parte 3: as variantes — 07/10/2026

## O que se fez

- **Código** (#159, juntado como edd5f1a; issue #77). O Diogo pediu-o a 07/10/2026, respondendo «sim» à proposta das rotas das variantes.
  - Com `catalog:read`:
    - `GET /products/{id}/variants`, por páginas no formato do `docs/18` §2a;
    - `GET /variants/{id}`;
    - `GET /variants?sku=…` ou `?gtin=…`: o SKU sem distinguir maiúsculas; o GTIN com os zeros à esquerda ignorados; exactamente um dos dois.
  - Com `catalog:write`, com a `Idempotency-Key`:
    - `POST /products/{id}/variants`, com `valores`, um `ovl_…` por opção;
    - `POST /variants/{id}/archive`.
- **Decisão do Diogo** (07/10/2026, «sim, fica como no artigo»; `docs/06`, CN): arquivar uma variante já arquivada devolve-a sem mudar nada. Continua final.
- **Repositório:**
  - `arquivarVariante` lê a variante com `FOR NO KEY UPDATE` e não mexe numa já arquivada;
  - `criarVarianteComValores` toma o artigo (`FOR KEY SHARE`) e a fila dele antes do INSERT.
- **Duas rondas de revisão do agente** (Sonnet 5.5), publicadas no #159:
  - 1.ª ronda: 3 P2 e 9 P3;
  - 2.ª ronda: 1 P2, um teste que passava sem a protecção, e 3 P3.
  - Ficaram todos tratados. O revisor retirou um P3 da 1.ª ronda.
- **Publicado no ensaio:** corrida 37654760333 do fluxo `publicar` (main edd5f1a), imagem `sha256:28572fdda09e3015e18cb9f741179a8468215034420d37355034ed20f53d3f24`, às 16:52 UTC. O registo diz:
  - «migrar: nada em falta.»;
  - «O /health da API responde.»;
  - «MCP: arrancou e responde.»;
  - «A API chega à base.»

## Números (com data e como se contaram)

- 07/10/2026, `pnpm teste` local contra o PostgreSQL 18.6 (por docker), com o main do #158: api 746 testes, hub 34, mcp 58, todos a passar. 11 deles estão em `test/catalogo-api-variantes.test.ts`.
- 07/10/2026, mutações (uma de cada vez, com os ficheiros repostos), contadas pela linha «Tests» do vitest: **16 de 16** apanhadas (7 na escrita, 8 na 1.ª ronda, 1 na 2.ª).
- CI do pedido (corridas 37654288660 e 37654288398, sobre a16028a): verde.

## O que ficou por verificar

- Não há teste do impasse entre criar uma variante e apagar o rascunho ao mesmo tempo. A ordem foi lida no código.
- A colação da base na VPS não foi verificada. O cursor e a ordem usam a mesma comparação.
- **Por decidir** (Diogo ou Bruno): o tecto de variantes por artigo. A ficha do artigo traz todas as variantes (`docs/14` §7.1).
- Por fazer: `PATCH /variants/{id}`. Não há função nem `versao`, por isso desenha-se antes do código.
