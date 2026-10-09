# Hub: enviar imagens — 09/10/2026

Pedidos do Diogo, 09/10/2026: *«sim, avança com o desenho do envio de
imagens»*, *«sim, aprovo o desenho, junta o #230»* e *«sim, avança com o
código do envio de imagens»*. Issue #229; desenho em `docs/22` §15 (#230);
código no #235 (squash 26e28a4).

## O que se fez

- **API (#235)**: `POST /hub/media/uploads` (os bytes),
  `POST /hub/products/{id}/media` (ligar) e `DELETE /hub/media/{id}`
  (tirar, com `{}`), com as mesmas funções das rotas pela chave
  (`receberImagem`, `guardarImagem`, `ligacaoDaMedia`, `remocaoDaMedia`,
  extraídas sem mudar as respostas).
- **Excepção ao JSON do Hub**: só o envio aceita bytes de imagem (marca
  `hubImagem`), e só com a origem do Hub. A marca é lida nos **dois** sítios
  que chamam `conferirOrigem` (`app.ts`, limite por IP, e
  `autenticacao.ts`) — o primeiro só se encontrou porque o envio dava 415.
- **Limites**: 2 envios em simultâneo por comerciante, partilhados entre a
  chave e o Hub (contador por base); quem não tem `catalog:write` é recusado
  antes de se ler o corpo.
- **Hub**: «Acrescentar imagem» (pré-visualização, texto alternativo,
  «guardar sem texto» só marcado, pergunta num artigo à venda, progresso e
  «Cancelar», tipo lido nos primeiros bytes) e «Tirar a imagem» com
  confirmação. Uma resposta perdida ao ligar relê as imagens e só conta
  uma imagem nova com aquele ficheiro.
- **Revisão Opus 5.5** (agente da sessão, ADR-0035): 0 P0, 0 P1, 3 P2 e 14
  P3; corrigidos no 1957c36, menos o P3-12 (tecto global de memória),
  justificado no pedido.

## Alteração à VPS (regra 6 da VPS)

- **O quê**: `infra/vps/ficheiros/nginx-hub.conf` ganhou
  `location = /hub/media/uploads` com `client_max_body_size 10m`,
  `proxy_request_buffering off` e as mesmas travas da `/hub/`. O resto do
  site fica nos 64 KB.
- **Como entrou**: pelo GitHub (ADR-0028). Corrida `aplicar-script`
  37942675434 (09/10/2026, depois do squash 26e28a4): «2 alteração(ões)
  feita(s), 1 aviso(s)» — instalou
  `/etc/nginx/sites-available/eurolify-hub.conf` e recarregou o nginx. O
  aviso é o já conhecido do utilizador `ubuntu` (uid 1000), que consegue
  ler as imagens da API.
- **Como se desfaz**: um pedido que reverta o bloco no `nginx-hub.conf`;
  o `aplicar-script` repõe o ficheiro anterior.

## Números (com data e como se contaram)

- 09/10/2026, local: API 957/957 testes (`vitest run`), dos quais 8 em
  `test/hub-imagens.test.ts`; Hub 98/98; passagem 370/370 em duas corridas
  seguidas (`node scripts/capturas.mjs`, linhas «ok»).
- 09/10/2026, nginx local (ficheiro real, API fingida): 1 MB passa, 11 MB
  dá 413; 1 MB noutro caminho `/hub/` dá 413; caminho codificado dá 413;
  401 dado cedo chega em 0,01 s; 5 MB a 1 MB/s chegam inteiros; 0 ficheiros
  temporários.
- 09/10/2026, GitHub: `publicar` (corrida 37942676131) verde; imagem
  `sha256:98b07276…3ee97cf`, «migrar: nada em falta», «Hub: os ecrãs desta
  publicação estão no ar».
- 09/10/2026, ensaio, de fora (`curl` a 1 MB sem sessão em
  `/hub/media/uploads`): até 14:14 UTC 413 (nginx antigo); 14:15–14:20 404
  (nginx novo, API antiga); desde 14:20:32 401 (API nova). 11 MB → 413;
  1 MB noutro caminho `/hub/` → 413; caminho codificado → 413.
- 09/10/2026, de fora: `hub.eurolify.eu` serve `index-C9yrajAR.js`, o mesmo
  nome da construção local do 26e28a4.

## O que ficou por verificar

- Ficheiros temporários do nginx no ensaio (só medido localmente) e um
  envio a 100 kB/s; com http2 ou HTTP/1.0 o nginx pode voltar a guardar o
  corpo.
- Enviar com uma sessão real no ensaio: não medi (não há sessão minha lá).
- HEIC no iOS e um leitor de ecrã real.
- O aspecto do envio de imagens: falta o OK do Diogo ou do Bruno (página de
  aprovação).
