# Hub: o histórico do artigo — 09/10/2026

Pedidos do Diogo, 09/10/2026: *«sim, avança com o desenho do histórico do
artigo»*, *«sim, aprovo o desenho, junta o #240»* e *«sim, avança com o
código do histórico do artigo»*. Issue #239; desenho em `docs/22` §16
(#240); código no #242 (squash e554e19); correcção de um teste do MCP que
travou a publicação no #245 (squash 606880e).

## O que se fez

- **API (#242)**: `GET /hub/products/{id}/timeline` com a mesma função da
  rota pela chave (`linhaDoTempoDeArtigo`, extraída sem mudar a resposta),
  mais o `autor` de cada entrada, decidido no servidor.
- **Base (migração 0038)**: `autores_da_linha_do_tempo`, função fechada.
  A API não lê a `pessoa` (0018); os nomes só saem por ela, só de quem é ou
  foi membro do comerciante, só as chaves dele, e só para quem tem
  `catalog:history` (o dono e o gestor). Uma pessoa pseudonimizada aparece
  como «Pessoa pseudonimizada» (o que fica guardado, 0026).
- **Hub (#242)**: a ligação «Histórico» na ficha (só com `catalog:history`)
  e a página `/artigos/{prd}/historico`: as alterações da mais recente para
  a mais antiga, 25 de cada vez, as entradas seguidas da mesma transacção
  juntas, quem fez, a parte (a variante pelo SKU, a tradução pelo campo e
  língua, a publicação pelo canal e mercado) e o antes → depois em
  linguagem comum; «Ver tudo» nos textos longos.
- **Revisão Opus 5.5** (agente da sessão, ADR-0035): 0 P0, 0 P1, 5 P2 e 9
  P3, tratados no 13ccf78; o P3-7 (junção só de entradas seguidas) e o
  P3-8 (rascunho apagado fora) ficaram escritos no desenho.
- **O publicar do e554e19 falhou** (corrida 37951234474) num teste do MCP
  que não era deste trabalho: o serviço fingido escrevia a resposta
  directamente e, num executor lento, a fila lia o ficheiro vazio.
  Reproduzido com um atraso de 50 ms; corrigido no #245 (o teste grava como
  o serviço verdadeiro, `mv -fT`). Revisão: 0 P0–P2, 2 P3.
- **Alteração à VPS**: só a publicação normal pelo GitHub, que aplicou a
  migração 0038 na base do ensaio (cria uma função; não muda dados).

## Números (com data e como se contaram)

- 09/10/2026, local: API 981/981 (`vitest run`), dos quais 7 em
  `test/hub-historico.test.ts`; Hub 98/98; passagem 382/382 em duas
  corridas seguidas e 427/427 depois de juntar o `main` com as letras
  relativas (#241) (`node scripts/capturas.mjs`, linhas «ok»); MCP 58/58.
- 09/10/2026, GitHub: `publicar` 37954340840 verde; imagem
  `sha256:0b88e350…fa1593f`; «migrar: aplicadas
  0038_hub_autores_da_linha_do_tempo».
- 09/10/2026, ensaio, de fora (`curl` sem sessão a
  `/hub/products/{id}/timeline`): 404 até à publicação; 401 desde 15:54:00
  UTC. `hub.eurolify.eu` serve `index-BEvaL2p0.js`, o mesmo nome da
  construção local do 606880e.

## O que ficou por verificar

- Ver o histórico com uma sessão real no ensaio (não há sessão minha lá).
- Um leitor de ecrã real; um histórico com milhares de entradas.
- O fuso horário: o comerciante tem `fuso`, mas o ecrã mostra a hora do
  dispositivo, como os outros ecrãs do Hub — decisão à parte.
- Se `/var/lib/eurolify/trabalho` e a pasta dos pedidos estão no mesmo
  sistema de ficheiros na VPS (o `mv -fT` do serviço só é atómico assim;
  revisão do #245, P3-2): não medi.
- O aspecto do histórico: falta o OK do Diogo ou do Bruno (página de
  aprovação).
