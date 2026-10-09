# Hub: a lista de artigos do catálogo — 08 e 09/10/2026

Pedido do Diogo, 08/10/2026: *«sim, aprovo o desenho, junta o #200 e avança
com o código»* e *«sim, avança com a saída A»*. Issue #199; desenho em
`docs/22` §11.

## O que se fez

- **Desenho (#200, d82a9bf)**: o Hub lê o catálogo pela mesma API
  (`docs/14`, regra C1; `docs/21` §5).
- **Descoberto ao começar o código**: no ensaio o nginx do Hub só passa à
  API os caminhos `/hub/` (`infra/vps/ficheiros/nginx-hub.conf`, trava da
  revisão do #160). **Saída A (Diogo)**: a mesma lista responde em
  `GET /hub/products`, com a mesma função do `GET /products`
  (`listaDeArtigos`, em `apps/api/src/catalogo/rotas.ts`); a VPS não mudou.
- **Código (#201, 03ffcb4)**: a rota em `apps/api/src/identidade/
  hub-catalogo.ts` (sessão + comerciante, `catalog:read`, só leitura,
  `cache-control: private, no-store`); o ecrã `/artigos` (contagem, nome,
  tipo, estado, marca, alterado em; filtros por estado, nome e SKU em dois
  campos — a API junta os filtros; «Mostrar mais» de 25; cartões no
  telemóvel; «vem do sistema de gestão»). A lista das linhas tocadas no
  catálogo ficou no #77.
- Revisão Opus 5.5: 0 P0, 0 P1, 2 P2 (o desenho dizia que não se mexia no
  catálogo; a função sem dizer quem mais a chama), 12 P3; tratados, menos
  os aceites abaixo.
- **Interrupção do GitHub Actions (08/10, 17:40 UTC, a 09/10, 08:29 UTC)**:
  todos os trabalhos falhavam em 2 a 3 s sem máquina (`runner_id` 0, sem
  passos nem mensagem), também os da outra sessão (#197). O Diogo aumentou
  o limite e depois resolveu na faturação da conta; a causa exacta não a
  verifiquei. A publicação foi a do #197, que levou as duas coisas.

## Números (com data e como se contaram)

- API: 864 testes em 864, 46 ficheiros (08/10/2026); `hub-catalogo.test.ts`
  7 testes, e os 7 falham sem o registo da rota.
- `capturas.mjs`: 155 verificações em 155, 5 corridas seguidas (08/10).
- Publicado no ensaio: corrida 37903811653 (tentativa 3), 09/10 08:35 UTC,
  «migrar: aplicadas 0032_importacoes» (a migração é do #197, da outra
  sessão) e «Hub: os ecrãs desta publicação estão no ar». Medido de fora às
  08:35: `/artigos` 200; `/hub/products` sem sessão 401
  (`auth.session_required`); o código servido (`index-DCSp3AYe.js`) tem
  «Ver artigos» e o mesmo nome que a construção local do `main` (40ac0c9).

## O que ficou por verificar

- Que os parâmetros (`?texto=`, `?cursor=`) passam pelo nginx do ensaio:
  sem sessão a API recusa antes de ler a consulta (revisão do #201, P3-2).
- A lista com uma sessão real no ensaio (não há conta de teste lá).
- Aceites e escritos na §11.2: «Alterado em» no fuso do navegador; o «de M»
  não se relê no «Mostrar mais».
- Fica de fora: preço e publicação na lista, a ficha, criar e editar,
  colunas à escolha, filtros guardados.
- O aspecto do ecrã `/artigos`: para o OK do Diogo ou do Bruno (os outros
  9 ecrãs já o têm, ver abaixo).

## O aspecto aprovado (08/10/2026)

Na página de aprovação (https://claude.ai/artifact/AQk53xNmRUGqeCBurFCtvK,
privada, só da conta dona — a do Diogo), os 9 ecrãs que estavam no ensaio
foram todos aprovados, sem notas, a 08/10/2026 entre as 16:31 e as 16:32
UTC: entrar, comerciantes, equipa, convite, conta, palavra-passe, chaves,
recuperar e códigos de recuperação (lido com o `ArtifactData`, 09/10/2026).
A lista de artigos ainda não estava na página.
