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
  artigos sem `eurolify.quem` falhava. Só a ligação de preparação dos
  artigos de ensaio leva `eurolify.quem=capturas:base` (opção da ligação);
  a API que a passagem arranca fica sem ele, para uma escrita sem «quem»
  continuar a falhar (revisão do #219, P2-3).
- Revisão do agente (Sonnet 5.5, ADR-0035), publicada no #219: 0 P0, 0 P1,
  6 P2 e 9 P3; os P2 tratados e os P3 tratados ou respondidos.

## Números (com data e como se contaram)

Em 09/10/2026, neste contentor (Node 22.22.0; PostgreSQL 18.6 por Docker;
Chromium 1194 do Playwright):

- Testes do Hub (`pnpm --filter @eurolify/hub run teste`): 91 passaram:
  53 que já havia no `main` e 38 novos (15 em `modulos.test.ts`, 23 de
  contraste), contados com `vitest --reporter=verbose` por ficheiro. Ao estragar as regras dos módulos e o tom do
  fundo de propósito, falharam 7.
- `capturas.mjs`: 307 verificações «ok», 0 falhas, 94 capturas; no `main`
  com a correcção do `eurolify.quem`, 181 e 68. Contadas com `grep -c '^ok'`
  no registo e `ls | wc -l` na pasta.
- Colunas medidas: 2 a 320, 375 e 390 px; 4 a 768 e 820; 5 a 1024, 1280 e
  1440 (a página tem 960 px no máximo, por isso a grelha fica em 928 px e
  nunca chega às 6 colunas).

## O que ficou por verificar

Safari e Firefox (só o Chromium correu); aparelhos reais; leitor de ecrã;
zoom de 400 % e texto a 200 %; teclado virtual e rotação; desempenho
antes/depois; um navegador sem `backdrop-filter` (a base opaca foi vista com
o modo opaco, não num navegador antigo). O aspecto não foi aprovado: as
capturas vão ao Diogo ou ao Bruno (regra 1 da `eurolify-design`).
