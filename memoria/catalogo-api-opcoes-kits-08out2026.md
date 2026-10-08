# API do Catálogo, parte 4: as opções e a composição dos kits — 08/10/2026

## O que se fez

- **Código** (#161, juntado a 08/10/2026 como 643fef9; issue #77). Pedido do Diogo, 07/10/2026: «sim, avança com as opções e os kits».
  - Com `catalog:read`:
    - `GET /products/{id}/options`, por páginas;
    - `GET /options/{id}`;
    - `GET /variants/{id}/components`, por páginas, com o estado de cada componente.
  - Com `catalog:write` e a `Idempotency-Key`:
    - `POST /products/{id}/options`, só num rascunho;
    - `POST /options/{id}/values`;
    - `PUT /variants/{id}/components`, que substitui a composição inteira, até 100 componentes, sem `versao`.
- **Repositório:** `acrescentarValor` toma a linha do artigo (KEY SHARE) e a fila dele antes de dar a posição (`max+1`), pela ordem de `criarOpcao`.
- **`docs/14` §3.3, §3.4 e §7.1, e `docs/18` §2a:**
  - a excepção de paginação da composição;
  - a falta de tecto de valores por opção, por decidir pelo Diogo ou pelo Bruno.
- **Duas rondas de revisão do agente** (Sonnet 5.5), publicadas no #161:
  - 1.ª ronda: 3 P2 e 6 P3;
  - 2.ª ronda: 3 P3 novos.
  - Ficaram todos tratados. A única excepção é uma decisão de produto que fica em aberto: aparar os textos e recusar caracteres invisíveis.
- **Publicado no ensaio:** corrida 37748056462 do fluxo `publicar` (main 643fef9), imagem `sha256:4268a05eea8442e51ccaca061892674a3e8092dd891fb99e9036c99eab37aae7`, a 08/10/2026 às 08:14 UTC. O registo diz:
  - «migrar: nada em falta.»;
  - «O /health da API responde.»;
  - «MCP: arrancou e responde.»;
  - «Hub: os ecrãs desta publicação estão no ar.»;
  - «A API chega à base.»

## Números (com data e como se contaram)

- 07/10/2026, `pnpm teste` local contra o PostgreSQL 18.6 (por docker), com o main do #162: api com 756 testes, hub com 34, mcp com 58, todos a passar. 10 deles estão em `test/catalogo-api-opcoes-kits.test.ts`.
- 07/10/2026, mutações (uma de cada vez, com os ficheiros repostos), contadas pela linha «Tests» do vitest: **10 de 10** apanhadas. A do teste em paralelo falhou em 3 corridas de 3.
- CI do pedido, sobre dc10a11: verde.

## O que ficou por verificar

- A ausência de impasse entre `acrescentarValor` e apagar o rascunho foi lida no código, não medida.
- A colação da base na VPS não foi verificada.
- **Por decidir** (Diogo ou Bruno):
  - o tecto de valores por opção, junto com o tecto das variantes;
  - aparar os nomes e os valores e recusar caracteres invisíveis.
- **Por fazer**, porque não há ainda função para isso; desenha-se antes do código:
  - mudar o nome de uma opção ou de um valor;
  - apagar uma opção;
  - reordenar.
