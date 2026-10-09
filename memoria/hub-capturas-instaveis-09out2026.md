# Capturas do Hub: os dois passos que falhavam às vezes, 09/10/2026

## O que se fez

Pedido do Diogo, 09/10/2026 (*«sim, avança com a correção dos passos
instáveis»*). Issue #246, pedido #247 (juntado a 09/10/2026, `720f1b8`, com o
OK do Diogo: *«sim, junta o #247»*). Só mudou `apps/hub/scripts/capturas.mjs`;
o Hub não mudou.

- **«imagens: só com o teclado…» (#235): o defeito era do teste.**
  - Contava as imagens logo que a linha aparecia. A `Miniatura`
    (`apps/hub/src/ecras/Artigo.tsx`) mostra «A carregar…» até chegarem os
    bytes, e só depois põe o `<img>`.
  - Correcção: o teste espera pela imagem até 10 s. Se não vier, a
    verificação falha e diz «a imagem não apareceu».
- **«Mover para depois» (#217): o defeito estava no Hub antigo, e o #223 já o
  tinha corrigido.**
  - O foco ia para o aviso num `requestAnimationFrame`. Esse pedido de
    animação podia correr antes de o React pôr o aviso no ecrã, e o foco
    perdia-se.
  - O #223 passou o foco para um `useLayoutEffect`. A falha registada em
    `hub-entrada-modular-09out2026.md` foi corrida com o código anterior
    (`f87b0b5`).
- **Revisão do agente** (Sonnet 5.5, ADR-0035, publicada no #247): 0 P0,
  0 P1. Os P3 do script foram tratados:
  - a falha das imagens diz o motivo;
  - a leitura do foco depois de escolher o ficheiro espera até 5 s.
- Os dois P2 de produto em `Artigo.tsx` passaram ao #251:
  - respostas fora de ordem ao recarregar as imagens;
  - foco depois de uma falha.
  Os dois foram reproduzidos e corrigidos no #260
  (`hub-ficha-ordem-e-foco-09out2026.md`).
- Uma falha rara ficou sem causa, no #253: a miniatura não apareceu em 10 s,
  1 vez em 28 voltas.

## Números (com data e como se contaram)

Contado a 09/10/2026, neste contentor (PostgreSQL 18.6 por Docker,
Chromium 1194), com `grep -c '^ok'` e `grep -c '^FALHOU'` no registo de cada
volta. Uma volta completa demora cerca de 110 s e tem 427 verificações «ok».

- **Voltas com o programa actual:** 27 de 28 sem falhas.
  - 8 normais e 8 com diagnóstico;
  - 2 com a página lenta (processador 6× mais lento pelo CDP, e atrasos ao
    acaso até 300 ms nas rotas das imagens);
  - 3 finais e 1 extra. A falha foi na extra («a imagem não apareceu»).
- **Prova do passo das imagens**, com os bytes das miniaturas atrasados 1,5 s:
  - sem a correcção: 426 «ok» e 1 falha;
  - com a correcção: 427 «ok» e 0 falhas.
- **Corrida das imagens:** nas 6 primeiras voltas com diagnóstico, em 2 havia
  0 imagens desenhadas no momento da contagem antiga.
- **Prova do «Mover para depois»:** com o foco antigo reposto (só no
  contentor, sem commit) e a página lenta, a 2.ª volta falhou. O foco ficou em
  «Acrescentar imagem», e não no aviso «Imagem acrescentada.». Com o código
  actual, nas mesmas condições, 0 falhas em 2 voltas.

## O que ficou por verificar

- A causa da miniatura que não apareceu em 10 s (#253). A pista é a fila dos
  bytes das imagens, com 4 pedidos de cada vez e sem prazo
  (`apps/hub/src/api.ts:438-452`).
- Ficou afastado o limite de 300 pedidos por minuto
  (`apps/api/src/base/limite.ts:26-29`): nas voltas com diagnóstico, todas as
  recusas 429 eram fingidas pelo próprio teste.
- Os dois P2 do #251: reproduzidos e corrigidos depois, no #260.
- Só se correu no Chromium, e só neste contentor. No CI do GitHub, o
  `capturas.mjs` não corre.
