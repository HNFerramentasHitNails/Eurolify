# Hub: escolher o tema, 09/10/2026

## O que se fez

Pedido do Diogo, 09/10/2026 (*«sim, avança com a escolha do tema»*), depois
de ver que o Hub só seguia o tema do aparelho. Issue #226, pedido #227.
Desenho em `docs/22` §4 («Escolher o tema») e §5.

- Lista «Tema» no cabeçalho, ao lado da língua: «Tema automático» (por
  omissão, segue o `prefers-color-scheme`), «Tema claro» e «Tema escuro».
- `apps/hub/src/tema.ts`: lê, guarda e aplica. Guarda no navegador
  (`eurolify-hub-tema`) só «claro» ou «escuro»; «automático» apaga a chave.
  Põe `data-tema` e `color-scheme` no `<html>`; aplica-se em `main.tsx`
  antes do primeiro ecrã (sem guião na página: a CSP do Hub não deixa).
- `tokens.css`: o bloco escuro passa a `:root:not([data-tema="claro"])`
  dentro do `@media` e repete-se em `:root[data-tema="escuro"]`; um teste
  confere que as duas cópias são iguais. Para quem fica em automático, as
  cores não mudaram (`git diff origin/main -- apps/hub/src/tokens.css`: só o
  seletor e a cópia).
- Os controlos do cabeçalho passam à linha seguinte nos ecrãs estreitos.
- Revisão do agente (Sonnet 5.5, ADR-0035), publicada no #227: 0 P0, 0 P1,
  2 P2 e 3 P3; tratados ou respondidos.
- Aspecto aprovado pelo Diogo a 09/10/2026, sobre 3 capturas (*«sim, dou o
  OK ao aspecto, junta»*, comentário no #227).
- Juntado no `main` a 09/10/2026 (`a007e91`), depois de juntar ao ramo o #223
  (criar artigos) e o #228, sem conflitos. Publicado no ensaio pelo fluxo
  `publicar` (corrida 37936300166, acabou com sucesso às 13:26 UTC) e
  verificado pelo Diogo no ensaio no mesmo dia (*«verificado»*).

## Números (com data e como se contaram)

Em 09/10/2026, neste contentor (Node 22.22.0; PostgreSQL 18.6 por Docker;
Chromium 1194): testes do Hub 98/98 (`pnpm --filter @eurolify/hub run
teste`), 7 deles em `tema.test.ts`; `capturas.mjs` 337 verificações «ok», 0
falhas (13 do tema), contadas com `grep -c '^ok'` no registo; com o #223
juntado ao ramo, 360 «ok» e 0 falhas (13 do tema). Ao fazer
«automático» gravar em vez de apagar, 1 teste falhou; ao mudar um token numa
das cópias do escuro, outro falhou.

## O que ficou por verificar

O instante em que o navegador pode pintar o fundo com o tema do aparelho
antes de o código do Hub arrancar (não medido); Safari e Firefox; aparelhos
reais.
