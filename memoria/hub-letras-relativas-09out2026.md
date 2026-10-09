# Hub: letras em tamanhos relativos, 09/10/2026

## O que se fez

Pedido do Diogo, 09/10/2026 (*«sim, avança com as letras em tamanhos
relativos»*), depois da medição em `hub-entrada-modular-09out2026.md`: com a
letra do navegador a 32 px, o Hub ficava em 16 px. Issue #237, pedido #241.
Desenho em `docs/22` §4.

- `--letra-base`, `--letra-pequena` e `--letra-titulo` em rem (1, 0,875 e
  1,5): 16, 14 e 24 px com a letra por omissão.
- Os pontos em que as tabelas passam a cartões em em (40em e 60em; 640 e
  960 px por omissão). Sem isto, as Chaves de API a 1280 px com a letra a
  32 px ficavam com 1563 px de largura.
- As colunas da grelha da entrada em rem (30, 40, 55 e 65rem; 480, 640, 880
  e 1040 px por omissão), para os rótulos não partirem palavras com letra
  grande (revisão do #241, P2-1).
- A grelha dos códigos de recuperação com `min(20ch, 100%)`: só com as
  letras em rem, a 375 px com a letra a 32 px, ficava com 401 px (medido
  numa página à parte com o CSS construído); com a correcção, 375 px.
- Revisão do agente (Sonnet 5.5, ADR-0035), publicada no #241: 0 P0, 0 P1,
  2 P2 e 2 P3, todos tratados.
- Aspecto aprovado pelo Diogo a 09/10/2026, sobre 4 capturas com a letra
  a 32 px (antes; Entrada a 1280 e 375 px; Chaves a 1280 px): *«sim, dou o
  OK ao aspecto, junta»* (comentário no #241).
- Juntado no `main` a 09/10/2026 (`47ca64e`). Publicado no ensaio pelo
  fluxo `publicar` (corrida 37947042839, acabou com sucesso às 14:55 UTC:
  «O /health da API responde», «Hub: os ecrãs desta publicação estão no
  ar») e verificado pelo Diogo no ensaio no mesmo dia (*«verificado»*).

## Números (com data e como se contaram)

Em 09/10/2026, neste contentor (Node 22.22.0; PostgreSQL 18.6 por Docker;
Chromium 1194): testes do Hub 103/103; `capturas.mjs` 415 verificações «ok»
e 0 falhas, 45 delas da letra a 32 px (cinco páginas a 375, 768 e 1280 px:
a página segue a letra, as tabelas passam a cartões, nenhum rótulo parte
palavras, sem deslocação), contadas com `grep -c '^ok'`. Com a letra por
omissão, das 114 capturas comparadas píxel a píxel com as do `main`, 63
iguais e 51 do mesmo tamanho, diferentes só em dados que mudam a cada volta
(prefixos de chaves, códigos de recuperação, QR) e em poucos píxeis de
suavização da letra.

## O que ficou por verificar

Safari e Firefox (o `Page.setFontSizes` só existe no Chromium); aparelhos
reais; os cartões estreitos com letra grande (o de entrar, 440 px) só se
viram quebrar, não se mediram. Um passo do `capturas.mjs` do #235
(«imagens: só com o teclado, a imagem fica principal…») falhou uma vez em
quatro voltas deste ramo e passou nas outras. Causa verificada e corrigida
no #247 (`hub-capturas-instaveis-09out2026.md`).
