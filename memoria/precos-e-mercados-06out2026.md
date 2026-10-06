# Preços e mercados, parte 1 — 06/10/2026

## O que se fez

- **Desenho** (`docs/20`) aprovado pelo Diogo e juntado no #129; Q1–Q6 decididas (`docs/06`, BS a BX).
- **Código, parte 1** (#134, juntado como 3237e07; issue #127): migração `0017_precos_mercados.sql` (mercado, canal, canal_mercado, lista_precos, preco, historico_preco), `apps/api/src/precos/repositorio.ts` e 31 testes em `apps/api/test/precos.test.ts`, 7 deles com duas ligações em simultâneo.
  - A migração é a 0017 porque o #131 ocupou a 0015 e a 0016.
  - Duas rondas de revisão do agente (Sonnet 5.5), publicadas no #134: a 1.ª com 1 P1, 4 P2 e P3; a 2.ª sem P0/P1/P2. Ficaram por fazer o P3-7 (país da UE: **C**) e o P3-8 (paginação, eventos e estado do canal), para a parte 2.
  - O CI do ef85440 falhou por um «Unhandled Rejection» num teste de concorrência (os testes passavam); corrigido no 3ad6b3d.
- **Publicado no ensaio:** corrida 37474635285 do fluxo `publicar`, imagem `sha256:ab64a780c2c669ed7089d1b8a09280305774b3c63c6bf83b0b65b55b47f8fc8b`, 13:58 UTC.
  - O registo da corrida diz: «migrar: aplicadas 0017_precos_mercados.», «O /health da API responde.», «MCP: arrancou e responde.», «A API chega à base.»

## Números (com data e como se contaram)

- 06/10/2026, `pnpm teste` local contra o PostgreSQL 18.6 (a imagem do CI, por docker), no 30022a2: 489 testes a passar em 25 ficheiros.
  - `test/precos.test.ts` correu 8 vezes seguidas sem falhas.
- 06/10/2026, mutações na 0017 e no repositório, uma de cada vez, contadas pela linha «Tests» do vitest: todas as protecções tiradas fazem falhar pelo menos um teste.
  - Excepção: a hora do histórico num INSERT que espera por um DELETE (P3-B da 2.ª ronda), que nenhum teste consegue provocar.

## O que ficou por verificar

- Não li a base da VPS depois da publicação: o MCP da VPS continua a pedir nova ligação. A prova é só o registo do fluxo `publicar`.
- Não verifiquei os gatilhos com um dono das tabelas que não seja superutilizador: no CI e localmente, quem migra é o superutilizador.
- A paragem com motivo próprio quando a lista não se vê (P3-F) não tem teste.
- Parte 2 por fazer:
  - a redução com o preço de referência dos 30 dias (**C**, B7 ao jurista);
  - o preço por unidade (BW);
  - os eventos;
  - as rotas da API.
