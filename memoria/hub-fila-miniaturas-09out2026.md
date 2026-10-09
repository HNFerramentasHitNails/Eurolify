# Hub: a fila das miniaturas com prazo e cancelamento (#253, #280), 09/10/2026

## O que se fez

Pedido do Diogo, 09/10/2026: *«sim, avança com o #253»*. Pedido #280,
juntado a 09/10/2026 (`be91545`) com o OK do Diogo (*«sim, junta o #280»*).
Publicado no ensaio pelo fluxo `publicar` (corrida 38002390575, com sucesso
às 23:08 UTC). Não há aspecto novo: o erro com «Tentar outra vez» já
existia.

- **A causa da falha original do #253 é outra.** Outra sessão, no #270,
  encontrou-a no limite de 300 pedidos por minuto
  (`hub-capturas-limite-09out2026.md`). Este pedido corrige uma **fraqueza
  real** da fila, que a podia explicar e que se provou à parte:
  - os bytes das miniaturas passam por uma fila de 4 pedidos de cada vez
    (`apps/hub/src/api.ts`, `naFilaDasImagens`), sem prazo nem
    cancelamento;
  - 4 pedidos sem resposta numa visita à ficha ocupavam a fila para sempre;
  - nas visitas seguintes, as miniaturas ficavam em «A carregar…» até se
    recarregar a página.
- **A correcção:**
  - a `Miniatura` cancela o pedido ao sair do ecrã;
  - o prazo de 30 s conta o tempo **sem receber nada**, até à resposta e
    entre dois pedaços, para uma imagem até 10 MiB numa rede lenta não
    falhar (revisão, P2);
  - quem acaba passa o lugar directamente ao primeiro em espera, por isso
    nunca correm mais de 4 (revisão, P3);
  - quem é cancelado enquanto espera sai logo da fila.
- **Erro meu no teste, apanhado antes da prova.** No Playwright, deixar de
  interceptar (`unroute`) solta os pedidos que a rota ainda segura. A
  primeira versão do passo passava sem a correcção por isso. Agora os
  pedidos ficam presos até ao fim do passo.
- **Revisão do agente** (Sonnet 5.5, ADR-0035, publicada no #280): sem P0
  nem P1. O P2 e dois P3 foram tratados, os outros respondidos.

## Números (com data e como se contaram)

Contado a 09/10/2026, neste contentor (PostgreSQL 18.6 por Docker,
Chromium 1194), com `grep -c '^ok'` e `grep -c '^FALHOU'`. A base já
incluía o #270.

- **Sem a correcção:** 439 «ok» e 1 falha, o passo novo, com as miniaturas
  presas. Diagnóstico no navegador: 4 `fetch` pendentes, nenhum acabado.
- **Com a correcção:** 4 voltas sem falhas (440 e 441 «ok»).
- **Testes do Hub:** 120/120. 10 deles são de `test/fila-imagens.test.ts`:
  - o prazo, sem resposta, aos pedaços e parado a meio;
  - o cancelamento;
  - um 404 não passa a erro de rede;
  - presos cancelados soltam o quinto;
  - nunca mais de 4, e o contador volta a 0;
  - quem desiste sai da fila.

## O que ficou por verificar

- Só se testou no Chromium. Não foi verificado em Safari, Firefox ou rede
  móvel real.
- A última volta das capturas foi antes do #275 (canais e mercados com o
  mesmo nome), que entrou no `main` antes da junção. O `capturas.mjs` não
  corre no CI, e não o voltei a correr depois.
- O ensaio não foi aberto à mão. A correcção só se vê com a rede parada.
