# Hub, ficha do artigo: respostas fora de ordem e foco depois de uma falha, 09/10/2026

## O que se fez

Pedido do Diogo, 09/10/2026: *«sim, avança com o #251»*. Issue #251 (os dois
P2 que a revisão do #247 tinha achado só a ler o código), pedido #260.

- O pedido foi juntado ao `main` a 09/10/2026 (`1437eee`). O aspecto foi
  aprovado pelo Diogo sobre a captura `artigo-falha-com-foco.png`:
  *«sim, dou o OK ao aspecto, junta»*.
- Foi publicado no ensaio pelo fluxo `publicar` (corrida 37988203132, acabou
  com sucesso às 20:50 UTC). O registo diz: «O /health da API responde» e
  «Hub: os ecrãs desta publicação estão no ar».
- **Respostas fora de ordem** (`apps/hub/src/ecras/Artigo.tsx`). A ficha, as
  imagens e as publicações passam a usar só a resposta do último pedido, com
  um contador por parte (o padrão de `Equipa.tsx`). «Activar/Arquivar/Repor»
  também sobe o contador da ficha.
  - **Antes:** uma lista pedida antes de outra gravação, e que chegasse
    depois dela, repunha o texto alternativo acabado de gravar.
- **Foco depois de uma falha.** Quando uma acção falha, o foco vai para um
  bloco `div.falha-accao` (`tabIndex=-1`) com o erro e o aviso «ordem a
  meio». O anúncio continua a vir dos `role=alert` de dentro.
  - **Antes:** o botão usado ficava desactivado durante a acção, e o foco ia
    para o `<body>`.
- **Dois passos novos no `capturas.mjs`.** Num, a primeira releitura fica
  retida até a segunda estar no ecrã, sem depender de tempos. No outro, um
  PATCH fingido devolve 500 e o passo confere o próprio elemento com o foco.
- **Revisão do agente** (Sonnet 5.5, ADR-0035, publicada no #260): sem P0.
  - O P1 foi tratado: o passo do foco passava sem a correcção, porque o
    `body` também contém o erro.
  - O P2-1 foi tratado: o passo da lista dependia de tempos.
  - O P2-2 não se aplica: o `pedir` não repete pedidos.
  - Os P3 foram respondidos.
- Os outros ecrãs com o mesmo padrão ficaram no #262: `PrecosDoArtigo.tsx`,
  que é de outra sessão, e mais quatro que o agente não leu. Foram medidos
  e o problema não se confirmou (ver abaixo); o Diogo mandou fechar o #262
  a 09/10/2026 (*«sim, fecha o #262»*).

## Os outros cinco ecrãs (#262), medidos a 09/10/2026

Pedido do Diogo: *«sim, avança com a medição do #262»*. Não se mudou
código.

- **Por leitura** (`main` em `f715c8b`), cada ecrã só carrega ao abrir e com
  «Tentar outra vez»:
  - Preços, Histórico, Editar e Novo recomeçam por artigo e comerciante
    (`key` em `App.tsx`);
  - o Início só lê o `/hub/me`;
  - o «Tentar outra vez» só aparece depois de a leitura acabar e sai ao
    primeiro clique;
  - a releitura do 409 em Editar e as procuras de Novo são esperadas
    (`await`).

  Nenhum destes ecrãs tem acções que recarreguem sem esperar, como a ficha
  tinha.
- **No navegador** (uma cópia do `capturas.mjs` fora do repositório,
  PostgreSQL 18.6 e Chromium 1194): em Preços, Histórico, Editar, Novo e
  Início deu sempre o mesmo resultado.
  - Ao abrir: 1 pedido.
  - Primeira leitura com um 500 fingido e duplo clique em «Tentar outra
    vez», com a resposta atrasada 1 s: 2 pedidos (1 falhado + 1
    repetição), e o erro saiu. Duas leituras em paralelo dariam 3.
  - A volta completa: 439 «ok» e 0 falhas.
- **Se um destes ecrãs ganhar uma acção que recarregue sem esperar**, usa-se
  o contador do `Equipa.tsx:72` e do `Artigo.tsx`.

## Números (com data e como se contaram)

Contado a 09/10/2026, neste contentor (PostgreSQL 18.6 por Docker,
Chromium 1194), com `grep -c '^ok'` e `grep -c '^FALHOU'` no registo de cada
volta:

- **Com o `Artigo.tsx` do `main` e os passos novos:** 436 «ok» e 2 falhas,
  exactamente os dois passos novos. Numa, a lista antiga repõe o texto. Na
  outra, o foco fica em `<body>`.
- **Com a correcção:** 5 voltas com 438 «ok» e 0 falhas.
- **Testes do Hub** (`pnpm --filter @eurolify/hub run teste`): 103/103.
  `tsc`, `eslint` e `prettier` sem erros.

## O que ficou por verificar

- Um leitor de ecrã real.
- Uma falha numa secção mais abaixo faz deslocar a página até ao erro, que
  fica por cima de «Descrição». Isto foi aceite com o aspecto, mas não se
  mediu num aparelho.
- O caso do 404: o bloco focado desaparece quando a ficha passa a «não
  existe», e o foco vai para o `body`. A mensagem é um `role=alert`.
- Só se correu no Chromium. No CI, o `capturas.mjs` não corre.
- O ensaio não foi aberto à mão. A correcção só se vê com uma falha ou com a
  rede lenta.
