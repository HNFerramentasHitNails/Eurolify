# Hub: a entrada por módulos em Glassmorphism, 09/10/2026

## O que se fez

Pedido do Diogo, 09/10/2026 («avança»), issue #218, pedido #219. Desenho em
`docs/hub-modular-glassmorphism.md`, secção «Primeira implementação».

- A página `/` do Hub passou de uma lista de ligações por comerciante a uma
  grelha de módulos: Equipa (basta ser membro), Artigos (`catalog:read`) e
  Chaves de API (`keys:write`), pelos âmbitos do `/hub/me` (#212). Um só
  registo (`apps/hub/src/modulos.ts`) serve a grelha e a pesquisa.
- O comerciante activo vai no endereço (`/?comerciante=mer_…`); com vários,
  escolhe-se e nunca se escolhe o primeiro sozinho; um do endereço que não
  está no `/hub/me` não abre módulos. O «Voltar» de Equipa, Artigos e Chaves
  passou a levar o comerciante.
- A pesquisa só filtra módulos (sem acentos e maiúsculas, com termos fixos
  por língua). Nada se guarda no navegador.
- Vidro só no campo de pesquisa e nas superfícies dos ícones, com
  `@supports`; sai com «Superfícies opacas» (só na memória da página),
  `prefers-reduced-transparency` e cores forçadas. Tokens novos em
  `tokens.css` (propostos; a identidade continua por decidir, D-12).
- `LigacaoInterna` (em `contexto.tsx`): o clique simples navega sem
  recarregar; Ctrl/Cmd, Shift, Alt e o botão do meio ficam com o navegador.
  As ligações antigas dos outros ecrãs continuam a apanhar todos os cliques.
- O `capturas.mjs` estava partido desde a migração 0033 (#208): criar
  artigos sem `eurolify.quem` falhava. Ficou a correcção do #217, que é a
  mesma: só a ligação de preparação leva `eurolify.quem=passagem:preparar`
  (opção da ligação); a API que a passagem arranca fica sem ele, para uma
  escrita sem «quem» continuar a falhar (revisão do #219, P2-3).
- Revisão do agente (Sonnet 5.5, ADR-0035), publicada no #219: 0 P0, 0 P1,
  6 P2 e 9 P3; os P2 tratados e os P3 tratados ou respondidos.
- Aspecto aprovado pelo Diogo a 09/10/2026, sobre 7 capturas antes e depois
  (*«sim, dou o OK ao aspecto, junta»*, comentário no #219). Vale para estes
  tokens provisórios; a identidade continua por decidir (D-12).
- Juntado no `main` a 09/10/2026 (`f87b0b5`), depois de juntar o #217 ao
  ramo (conflitos em `App.tsx`, `contexto.tsx`, `estilos.css` e
  `capturas.mjs`; ficaram as duas partes). Publicado no ensaio pelo fluxo
  `publicar` (corrida 37926284275, acabou com sucesso às 11:56 UTC) e visto
  pelo Diogo no ensaio no mesmo dia: captura do ecrã num computador, em
  escuro, com o dono de ensaio, a «Loja de Ensaio» escolhida sozinha e os
  três módulos.

## Números (com data e como se contaram)

Em 09/10/2026, neste contentor (Node 22.22.0; PostgreSQL 18.6 por Docker;
Chromium 1194 do Playwright):

- Testes do Hub (`pnpm --filter @eurolify/hub run teste`): 91 passaram:
  53 que já havia no `main` e 38 novos (15 em `modulos.test.ts`, 23 de
  contraste), contados com `vitest --reporter=verbose` por ficheiro. Ao estragar as
  regras dos módulos e o tom do fundo de propósito, falharam 7.
- `capturas.mjs`: 307 verificações «ok», 0 falhas, 94 capturas; no `main`
  com a correcção do `eurolify.quem`, 181 e 68. Depois de juntar o #217 ao
  ramo: 324 «ok» e 0 falhas na segunda volta (o `main` sozinho, 198); a
  primeira volta parou no passo «Mover para depois» do #217
  (`waitForFunction` do foco), num ecrã que este trabalho não muda — causa
  não verificada. Contadas com `grep -c '^ok'` no registo e `ls | wc -l`
  na pasta.
- Colunas medidas: 2 a 320, 375 e 390 px; 4 a 768 e 820; 5 a 1024, 1280 e
  1440 (a página tem 960 px no máximo, por isso a grelha fica em 928 px e
  nunca chega às 6 colunas).

## Zoom e tamanho de letra, medidos a 09/10/2026

Pedido do Diogo (*«sim, avança com a medição»*). Só medição, sem mudar
código: uma cópia do `capturas.mjs` fora do repositório, sobre o `main` em
`4c58880`, Chromium 1194. O zoom do navegador num ecrã de 1280 × 1024 dá a
mesma área útil que um ecrã de 640 × 512 px a 200 % e de 320 × 256 px a
400 %; foi assim que se mediu (com a densidade de píxeis 2 e 4).

- **Entrada e escolha do comerciante, a 200 % e 400 %, claro e escuro:**
  sem deslocação horizontal, nada fora do ecrã, nada cortado; as 11
  paragens do Tab ficam todas visíveis; a pesquisa sem resultados também
  não desloca (24 verificações «ok», 0 falhas).
- **Equipa, Artigos e Conta, nas mesmas condições:** sem deslocação
  horizontal (largura da página igual à do ecrã). A medição marcou «cortado»
  o `thead` das tabelas, mas é o padrão de propósito dos cartões no
  telemóvel (`estilos.css`, `@media (max-width: 640px)`: o cabeçalho fica
  escondido à vista e lido pelos leitores de ecrã) — não é falha.
- **Tamanho de letra do navegador** (definição «tamanho da letra» a 32 px,
  pelo protocolo do Chromium, `Page.setFontSizes`): o navegador passou a 32
  px, mas a página continuou em 16 px (`html`), 24 px (`h1`) e 14 px
  (rótulos), porque as letras estão em píxeis fixos (`tokens.css:39-41`).
  Quem aumenta só a letra nas definições do navegador não a vê maior no Hub;
  o zoom funciona. Mudar isto toca em todo o Hub e é decisão de aspecto.

## O que ficou por verificar

Safari e Firefox (só o Chromium correu); aparelhos reais; leitor de ecrã;
zoom real num aparelho (o de 200 % e 400 % foi medido por emulação no
Chromium, ver acima); letra maior pelas definições do navegador (não
aumenta: ver acima); teclado virtual e rotação; desempenho
antes/depois; um navegador sem `backdrop-filter` (a base opaca foi vista com
o modo opaco, não num navegador antigo); a instabilidade do passo «Mover
para depois» do `capturas.mjs` (#217).
