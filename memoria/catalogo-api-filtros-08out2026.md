# API do Catálogo: filtros da procura de artigos — 08/10/2026

## O que se fez

- **Código** (#173, juntado como 3750569; issue #77). Pedido do Diogo, 08/10/2026: «sim, avança com os filtros».
- **`GET /products` com filtros novos**, que se juntam entre si e com os que já havia:
  - `categoria=cat_…`: só os artigos dessa categoria, sem os das subcategorias; uma categoria inexistente dá 404;
  - `traducao_em_falta=es`: o nome ou a descrição em falta ou desactualizados; a língua de origem dá 422;
  - `actualizado_desde=…`: inclusive, ao microssegundo, com o fuso obrigatório; o ano 0000 dá 400.
- **Uma regra, um sítio:** a condição «por traduzir» passou para `porTraduzir` (`consultas.ts`), usada pela fila de traduções e pelo filtro.
- **Ficam de fora:**
  - «sem foto», que entra com a media;
  - «sem SKU», que não existe, porque o SKU é obrigatório (C3).
- **`actualizado_desde` não serve, sozinho, para sincronizar** (escrito na `docs/14` §7.1):
  - a data é a do início da transacção;
  - quem sincroniza recua a marca e aceita repetidos;
  - uma sincronização segura fica, como proposta, para os eventos de saída (0021).
- **A data do artigo** muda ao alterar, classificar, activar, arquivar ou repor o artigo e ao mudar as categorias dele. Não muda com variantes, opções, composição, traduções nem publicações. Está testado em parte.
- **Duas rondas de revisão do agente** (Claude Sonnet 5.5), publicadas no #173 com o tratamento:
  - 1.ª ronda: 1 P2 e 6 P3;
  - 2.ª ronda: só P3.
- **Publicado no ensaio:** corrida 37769390846 do fluxo `publicar` (main 3750569), imagem `sha256:348e8e22d6c60f036d130f01da7777ee5e4f7265f628a9dd976f346de90aca0e`, acabou às 11:25 UTC. O registo diz:
  - «migrar: nada em falta.»;
  - «O /health da API responde.»;
  - «MCP: arrancou e responde.»;
  - «Hub: os ecrãs desta publicação estão no ar.»;
  - «A API chega à base.»

## Números (com data e como se contaram)

- 08/10/2026, `pnpm teste` local contra o PostgreSQL 18.6 (por docker): API 811, MCP 58, Hub 34, todos a passar.
- `test/catalogo-api-filtros.test.ts`: 5 testes.
- Mutações (uma de cada vez, ficheiros repostos, contadas pela linha «Tests» do vitest): 9 feitas, 8 apanhadas, 1 equivalente.
  - A equivalente é «original que ficou vazio»: a base recusa traduzir um original vazio.
  - Uma das mutações (o «inclusive») mostrou um defeito real: a data passava por um `Date` e perdia os microssegundos. Ficou corrigido antes de juntar.
- CI do pedido sobre 2dc516f: verde.

## O que ficou por verificar

- Sem índice próprio para os filtros novos (nota «Escala» do `docs/18`). Sem `EXPLAIN`.
- O filtro da tradução olha só para os campos do próprio artigo, não para os das opções e dos valores.
- Pela API, não está testado que activar, arquivar e repor mudam a data. Passam pelo mesmo trigger da 0002.
- O filtro explícito por `comerciante_id` não se prova pela API, porque o RLS esconde na mesma.
- O MCP da VPS continua sem autorização nesta sessão.
