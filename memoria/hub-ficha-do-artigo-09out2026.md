# Hub: a ficha do artigo, só para consulta — 09/10/2026

Pedido do Diogo, 09/10/2026: *«sim, avança com o desenho da ficha do
artigo»* e *«sim, aprovo o desenho, junta o #205 e avança com o código»*.
Issue #204; desenho em `docs/22` §12 (#205); código no #206.

## O que se fez

- **Desenho (#205, d25f1c3)**: a ficha lê-se por quatro caminhos `/hub/…`,
  cada um com a mesma função da rota pela chave (a saída A da §11.1).
- **Código (#206, 6a9fa65)**:
  - API: `GET /hub/products/{id}`, `/hub/products/{id}/media`,
    `/hub/media/{id}/file` e `/hub/products/{id}/publications`, em
    `apps/api/src/identidade/hub-catalogo.ts`. As funções saíram de
    `catalogo/rotas.ts` e `rotas-media.ts` (`fichaDeArtigo`,
    `publicacoesDeArtigo`, `imagensDeArtigo`, `enviarBytesDaMedia`); a
    lista dos segundos chamadores ficou no #77.
  - Ecrã `/artigos/{prd_…}?comerciante=mer_…`: cabeçalho, descrição,
    variantes, imagens (bytes por `fetch` com o cabeçalho do comerciante,
    no máximo 4 de cada vez, mostrados por `blob:`), publicações; cada
    parte carrega e falha sozinha. A lista guarda os filtros no endereço.
  - Revisão Opus 5.5 (agente da sessão, ADR-0035): 0 P0, 0 P1, 4 P2 e 8 a
    10 P3; tratados ou justificados no #206. O P2-2 (transbordo a 768 px)
    mediu-se e não se confirmou; os cartões ficaram na mesma.
- **Alteração à VPS (ADR-0028, regra 6 do AGENTS.md)**: a política de
  segurança dos ecrãs do Hub em `infra/vps/ficheiros/nginx-hub.conf` passou
  de `img-src 'self' data:` a `img-src 'self' data: blob:`. Sem isto o
  navegador bloqueava as imagens da ficha. Aplicada pelo fluxo
  `aplicar-script` (corrida 37911414358): «instalar
  /etc/nginx/sites-available/eurolify-hub.conf» e «recarregar o nginx», 2
  alterações, às 09:28 UTC. Nenhuma outra mudança na máquina.
- **Descoberto**: a passagem no navegador (`apps/hub/scripts/capturas.mjs`)
  não enviava a política do nginx, por isso não apanhou o bloqueio. Passou
  a enviá-la, lida do próprio ficheiro: sem o `blob:`, falha nas imagens.

## Números (com data e como se contaram)

- 09/10/2026, local: API 887/887 testes em 47 ficheiros (`vitest run`);
  Hub 53/53; passagem 181/181 (`node scripts/capturas.mjs`, contadas as
  linhas «ok»).
- 09/10/2026, GitHub: `publicar` (corrida 37911414660) verde; publicação
  às 09:34:36 UTC, imagem `sha256:fc346092…be5b1`, «migrar: nada em falta».
- 09/10/2026, 09:34:47 UTC, de fora (`curl`): `hub.eurolify.eu` serve
  `assets/index-CVCY236E.js`, o mesmo nome da construção local; a política
  traz `img-src 'self' data: blob:`; os quatro caminhos novos dão 401 sem
  sessão e um caminho `/hub/` inexistente dá 404 (as rotas existem).

## O que ficou por verificar

- A ficha com uma sessão real no ensaio, e se o nginx passa os bytes de
  `/hub/media/{id}/file` com o tipo da imagem: não medi (não há artigos
  nem sessão minha no ensaio).
- O aspecto da ficha e da lista de artigos: falta o OK do Diogo ou do
  Bruno; vão para a página de aprovação.
- O aviso de sempre do `aplicar-script` (a conta `ubuntu`, uid 1000, lê as
  imagens) continua; está em `catalogo-imagens-08out2026.md`.
- O texto «impede a publicação» aparece em todas as imagens sem texto; pela
  API só impede se a imagem for do artigo ou de uma variante à venda
  (revisão do #206, P3-7). Fica para o desenho seguinte.
