# API do Catálogo, parte 2: as escritas — 07/10/2026

## O que se fez

- **Código** (#153, juntado como 0f8c012; issue #77). Pedido do Diogo, 07/10/2026: «sim, avança com as escritas da API do Catálogo».
  - Com `catalog:write`:
    - `POST /products`, `PATCH /products/{id}` e `PUT /products/{id}/classification`;
    - `POST /products/{id}/activate`, `/archive` e `/restore`;
    - `DELETE /products/{id}`.
  - Com `catalog:publish`: `POST /products/{id}/publications` e `POST /publications/{id}/archive`.
- **Idempotência** (`docs/18` §4): todas as escritas pedem a `Idempotency-Key`.
  - A escrita e a resposta guardada vão na mesma transacção. Para isso, `noCatalogo` (`catalogo/erros.ts`) corre dentro de uma transacção já aberta, mas só se ela for do mesmo comerciante.
  - Os erros que surgem no fim da transacção (COMMIT) também se traduzem para os códigos do Catálogo (`noCatalogoApi`).
- **Quem escreve** fica registado como a chave, no formato `chave:key_<id>`.
- **Estados:** `activate`, `archive` e `restore` partem do seu estado (`mudarEstadoArtigo(…, de)`).
  - Se o artigo já está no estado pedido, a resposta é 200 e a versão não muda (§4.1).
  - Uma versão antiga dá `version_conflict` antes de qualquer outra recusa.
- **Defeito apanhado pelos testes antes de entrar:** sem a verificação do estado de partida, um `restore` sobre um rascunho activava-o.
- **Duas rondas de revisão do agente** (Sonnet 5.5), publicadas no #153:
  - 1.ª ronda: 4 P2 e 7 P3;
  - 2.ª ronda: 6 P3 e nenhum P2.
  - Ficaram todos tratados. Um ponto da 1.ª ronda (o 204 com `Type.Null()`) foi medido no `/openapi.json` e não se confirmou, e o revisor retirou-o na 2.ª.
- **Publicado no ensaio:** corrida 37637224998 do fluxo `publicar` (main 0f8c012), imagem `sha256:62d1c2121a8f1475dfd77e21962556323e8b8f83b7830d9b6f24cdddb0574cb6`, às 14:34 UTC. O registo da corrida diz:
  - «migrar: nada em falta.» (as escritas não trouxeram migração);
  - «O /health da API responde.»;
  - «MCP: arrancou e responde.»;
  - «A API chega à base.»
  - Os testes do `main`, já com o #154, passaram na mesma corrida.
- **`docs/14` §7.1:** descreve as escritas e as faltas conhecidas:
  - o «quem» só fica registado na classificação e na publicação (C7);
  - a categoria fiscal ainda não é confirmada no Motor de IVA (**C**). É uma rede temporária, com fim quando o Motor de IVA existir ou antes de haver produção, o que vier primeiro (decisão do Diogo, 07/10/2026: «sim, confirmo esse prazo»; `docs/06`, CM).

## Números (com data e como se contaram)

- 07/10/2026, `pnpm teste` local contra o PostgreSQL 18.6 (por docker), com o main a0202b1: API 721 testes, MCP 58, todos a passar. 27 deles estão em `test/catalogo-api-escritas.test.ts`.
- 07/10/2026, mutações (uma de cada vez, com os ficheiros repostos), contadas pela linha «Tests» do vitest: **18 de 18** apanhadas.
  - Algumas das protecções estragadas:
    - a verificação do comerciante na transacção aberta;
    - o estado de partida;
    - o «mesmo estado»;
    - a escrita numa transacção separada da resposta guardada;
    - o `lock_timeout` na transacção aberta;
    - a tradução dos erros do COMMIT;
    - a guarda em `traduzir`;
    - a normalização de `{}`;
    - o `Location`;
    - a medida 0;
    - a data inválida;
    - o ONU sem padrão.
- CI do pedido (corridas 37634444406 e 37634444688, sobre ac496ba): verde.

## O que ficou por verificar

- O main recebeu o #154 (outra sessão) às 14:10 UTC, antes de se juntar. A bateria local correu sobre a0202b1, sem o #154. O CI do pedido e o `publicar` do main correram com ele.
- Não há teste de duas escritas simultâneas com chaves diferentes no mesmo artigo. Ficam protegidas pela `versao` e pelo `FOR UPDATE`.
- `catalog.no_variants` não se alcança pela API: o esquema exige pelo menos uma variante e não há rota para arquivar variantes.
- A API não está exposta: na VPS só ouve em `127.0.0.1`.
- O registo da publicação mostra um aviso do docker na VPS: as credenciais do registo de imagens ficam em `/root/.docker/config.json` sem cifra. Vem de antes deste pedido; procurei «config.json» em `memoria/` (07/10/2026) e só aparece aqui, por isso não está registado noutro sítio. Por tratar.
- O MCP da VPS continua sem autorização nesta sessão. O Diogo reconectou-o, mas os conectores só se lêem no arranque de uma sessão.
- Por fazer:
  - as rotas de variantes, opções, composição, traduções e media;
  - os outros filtros e o `expand`;
  - a API da Loja e o MCP de leitura.
