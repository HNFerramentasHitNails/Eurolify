# Catálogo: reverificar as publicações (0023) — 07/10/2026

## O que se fez

- **Decisão do Diogo** (07/10/2026, «sim, avança com a (a)»; `docs/06`, CJ): uma publicação publicada que deixa de passar na verificação C2 sai de venda sozinha, com o motivo `verificacao_falhou` e os impedimentos guardados.
- **Código** (#146, juntado como baade4a; issue #77):
  - a migração `0023_publicacao_reverificada.sql`, que acrescenta o motivo novo;
  - `reverificarPublicacoes` em `apps/api/src/catalogo/publicacao.ts`, chamada por cinco operações, cada uma só quando a mudança conta (`docs/14` §4.2): `alterarArtigo` (o nome), `classificarArtigo`, `arquivarVariante`, `apagarTraducao` (a do nome) e `alterarMercado` (uma língua que entra);
  - módulos novos, para não haver importações circulares: `catalogo/erros.ts`, `precos/erros.ts` e `precos/verificacao.ts`.
- **Duas rondas de revisão do agente** (Sonnet 5.5), publicadas no #146. A 2.ª ficou sem P0, P1 nem P2.
- **Coordenação:** o #144 (outra sessão) usava a 0021 e a decisão CH, já ocupadas. Ficou avisado e juntou como 0022 e CI.
- **Publicado no ensaio:** corrida 37601413981 do fluxo `publicar`, imagem `sha256:8e882d0caa41e86c6ae2f6c2347d3b511e46b2407d56efcb1741438e6e2d18ba`, às 09:37 UTC. O registo da corrida diz:
  - «migrar: aplicadas 0023_publicacao_reverificada.»;
  - «O /health da API responde.»;
  - «MCP: arrancou e responde.»;
  - «A API chega à base.»

## Números (com data e como se contaram)

- 07/10/2026, `pnpm teste` local contra o PostgreSQL 18.6 (a imagem do CI, por docker), com o main do #144: API 633 testes e MCP 58, todos a passar. 15 deles estão em `test/catalogo-reverificacao.test.ts`, quatro dos quais com duas transacções ao mesmo tempo.
- 07/10/2026, a duração de `alterarMercado` ao acrescentar uma língua, num mercado em que nenhum artigo tem o nome traduzido (todas as publicações são arquivadas):
  - 100 publicações: 0,84 s;
  - 300 publicações: 2,2 s;
  - cerca de 7 a 8 ms por publicação, o que dá entre 600 e 700 publicações para chegar aos 5 s do `lock_timeout`.
- **Como se mediu:**
  - um ficheiro de teste temporário, `test/medir-tmp.test.ts`, copiado de `catalogo-reverificacao.test.ts`;
  - publicava N artigos com a função `publicado` e media com `performance.now()` só a chamada a `alterarMercado(..., { linguas: ["pt", "es"] })`;
  - correu com `N_MEDIR=100` e `N_MEDIR=300`, numa máquina de 4 núcleos com o PostgreSQL local, e foi apagado a seguir.
- 07/10/2026, mutações (uma de cada vez, com os ficheiros repostos): cada protecção tirada faz falhar pelo menos um teste. Foram estas:
  - a reverificação em cada uma das cinco operações;
  - o FOR UPDATE das publicações;
  - o filtro «só as publicadas»;
  - as condições «só quando conta».

## O que ficou por verificar

- Não li a base da VPS: o MCP da VPS continua a pedir nova autorização. A prova é só o registo do fluxo `publicar`.
- A duração na VPS; só se mediu localmente.
- Por fazer:
  - um mercado com mais de algumas centenas de publicações precisa de lotes ou de uma tarefa de fundo (por desenhar);
  - a Conformidade e a media entram na reverificação quando existirem (CF);
  - o SQL à mão não reverifica.
