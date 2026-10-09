# Hub: editar o artigo — 09/10/2026

Pedidos do Diogo, 09/10/2026: *«sim, avança com o desenho da edição do
artigo»*, *«sim, aceito a lista, junta o #211»*, *«sim, avança com os
âmbitos no /hub/me»*, *«sim, aceito, só o dono e o gestor»* (o
`catalog:history` do #208) e *«sim, avança com o código da edição do
artigo»*. Issue #210; desenho em `docs/22` §13 (#211); âmbitos no #212;
código no #217 (squash 4d9e0f3).

## O que se fez

- **Desenho (#211)**: §13, com a lista da P5 decidida pelo Diogo: num
  artigo com `origem: externo`, o Hub não muda o nome, a descrição, a
  marca, a categoria fiscal, o estado nem as variantes; as imagens
  editam-se. A regra vale só nas rotas `/hub/`; a chave continua a
  escrever.
- **Âmbitos (#212, migração 0034 `identidade_eu_ambitos`)**: o `/hub/me`
  dá, por comerciante, os âmbitos do papel lidos de `papel_ambitos`; um
  âmbito que esta versão da API não conhece fica de fora
  (`ambitosConhecidos`). Só o dono e o gestor têm `catalog:write`.
- **Código (#217)**:
  - API (`apps/api/src/identidade/hub-catalogo.ts`): `PATCH
    /hub/products/{id}` (nome, descrição, marca; a categoria fiscal dá
    400), `POST /hub/products/{id}/activate|archive|restore`, `POST
    /hub/variants/{id}/archive`, `PATCH /hub/media/{id}`. Chamam as
    funções extraídas das rotas pela chave (`alteracaoDoArtigo`,
    `mudancaDeEstado`, `arquivoDaVariante`, `alteracaoDaMedia`), numa
    transacção do comerciante com `pessoa:per_…` como «quem» da linha do
    tempo (#208). P5 com `catalog.external_field` (409, código novo).
  - Hub: «Editar», o estado, as imagens (texto alternativo, principal,
    ordem por botões) e arquivar variante na ficha; o ecrã
    `/artigos/{id}/editar` com a versão lida, conflito sem gravar, guarda
    de saída (navegação do Hub, «voltar» do navegador, «Sair», fechar o
    separador); o foco vai para o aviso depois de cada acção.
  - Revisão Opus 5.5 (agente da sessão, ADR-0035): 0 P0, 1 P1 (a
    categoria fiscal pelo Hub, corrigido), 6 P2 e 9 P3; tratados ou
    justificados no comentário de resposta do #217.
- **Descoberto**: desde o #208 a passagem no navegador falhava com
  `catalog.change_without_who` na preparação; corrigido no #217 com o
  «quem» só nas ligações da preparação (aviso no #77).
- **Sem alteração à VPS**: só a publicação normal pelo GitHub.

## Números (com data e como se contaram)

- 09/10/2026, local: API 906/906 testes em 49 ficheiros (`vitest run`);
  passagem 198/198 (`node scripts/capturas.mjs`, linhas «ok»).
- 09/10/2026, GitHub: `verificar` verde no 059e34e; `publicar` (corrida
  37924531910) verde; imagem `sha256:da177e7c…9c15ac6d`, «migrar: nada em
  falta» (a 0034 já tinha entrado com o #212).
- 09/10/2026, 11:39:57–11:40:05 UTC, de fora (`curl`): `hub.eurolify.eu`
  serve `assets/index-OKIfEoy0.js`, o mesmo nome da construção local; os
  quatro caminhos de escrita dão 401 sem sessão e `/hub/naoexiste` dá 404.

## O que ficou por verificar

- A edição com uma sessão real no ensaio: não medi (não há sessão minha
  nem artigos lá).
- Um leitor de ecrã real e a largura de 320 px.
- P2-6(a) da revisão: nenhum percurso prova o impedimento a partir da
  publicação real do artigo.
- Mudar a ordem das imagens são duas escritas; a rota atómica fica para o
  dono do catálogo (#77).
- O aspecto dos ecrãs de edição: falta o OK do Diogo ou do Bruno (página
  de aprovação).
