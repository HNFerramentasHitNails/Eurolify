# Catálogo: importação com ensaio — 09/10/2026

## O que se fez

- **Desenho e decisão CT** (`docs/06`). Diogo, 08/10/2026: «sim, avança com o desenho da importação» e «sim, aprovo; avança com o código da importação».
- **#197, juntado a 09/10/2026 como 40ac0c9:**
  - **migração 0032:** a tabela `importacao`; os estados só vão de `analisada` para `aplicada`, uma vez, em 24 h; o ficheiro não se guarda, só o plano e o relatório;
  - **`POST /imports`, o ensaio:** recebe um CSV de uma linha por variante, ou o `catalogo.json` da exportação. Faz as escritas a sério em pontos de retorno, desfeitos no fim, e força as combinações de opções no fim de cada artigo;
  - **`POST /imports/{id}/apply`:** grava o plano, tudo ou nada; dá 409 `import.stale` se algo mudou desde o ensaio;
  - **identidade:** a variante é o SKU; o artigo é o `prd_` deste comerciante ou o dos SKU que já existem; nunca pelo nome;
  - **o que fica intocado:** os artigos externos (P5), as variantes arquivadas, e nada se apaga nem se esvazia;
  - **limites:** os esquemas da API (`CamposDoArtigo`, `NovaVariante`), 10 MB, 5000 linhas, 100 variantes num artigo novo, UTF-8 estrito;
  - **coordenação:** a migração ficou com o número 0032 porque o #196 do Bruno tinha a 0031; deixei aviso no pedido dele.
- **Revisão do agente (Claude Sonnet 5.5), 2 rondas, publicadas no pedido com o tratamento:**
  - 1.ª ronda: dois P1, o limite e o relatório sem tecto, e dois grupos que davam o mesmo artigo;
  - 2.ª ronda: um P2, o carácter nulo e o par de substituição partido;
  - a primeira tentativa da 2.ª ronda falhou com um erro de acesso ao serviço e repetiu-se.
- **Um teste das imagens falha às vezes no CI** (`catalogo-api-media.test.ts`, linha 752, 500 em vez de 429): falhou 2 vezes em 4 neste ramo e passou ao repetir. Não encontrei a causa; está registado no #197.
- **A faturação do GitHub parou as Actions** desde 08/10/2026 às 17:40 UTC. As publicações do #201 e do #197 não correram até o Diogo tratar da faturação a 09/10/2026.
- **Publicado no ensaio:** execução 37903811653, repetida, com «migrar: aplicadas 0032_importacoes», imagem `sha256:266223d2bb30b6f8c6b4f4119e5fbe59798922d86b25c60adbb68c489ca6664b` e «A API chega à base». Leva também o #201.

## Números (com data e como se contaram)

- 08–09/10/2026, `pnpm teste` local contra o PostgreSQL 18.6, na versão final: API 876, MCP 58, Hub 53.
- `importacao.test.ts`: 19 testes (13 na escrita inicial, 6 nas revisões).
- Mutações, uma de cada vez, com os ficheiros repostos:
  - escrita inicial: 12 de 13;
  - 1.ª ronda: 9 de 9;
  - 2.ª ronda: 3 de 3, contando o teste do `prd_` em maiúsculas, que foi corrigido para a apanhar.

## O que ficou por verificar

- **Não medi** o tempo de um ensaio ou de uma aplicação com 5000 variantes. O ensaio prende os artigos que toca até ao fim.
- **Não há teste:**
  - de duas aplicações ao mesmo tempo (429);
  - do `lock_timeout` da aplicação.
- **Não verifiquei** que eventos saem em cada criação ou alteração.
- **Sem prazo de retenção** das importações guardadas.
- **Fica para depois:** estado, publicação, classificação, opções, kits, traduções, categorias, colecções, imagens e preços; e esvaziar campos.
- As rotas no ensaio não foram chamadas (o MCP da VPS continua sem autorização nesta sessão).
