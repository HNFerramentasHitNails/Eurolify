# Catálogo, parte 4: publicação por canal × mercado — 06/10/2026

## O que se fez

- **Código** (#139, juntado como 8e29506; issue #77):
  - a migração `0019_catalogo_publicacao.sql` (era a 0018; o #141 ocupou-a);
  - `apps/api/src/catalogo/publicacao.ts`, com a verificação «pode publicar?» (C2), `publicar`, `retirarPublicacao` e `publicacoesDoArtigo`;
  - 36 testes em `apps/api/test/catalogo-publicacao.test.ts`, 10 deles com duas ligações em simultâneo.
- **Decisões do Diogo:**
  - opção (a) para a C2: a Conformidade e a media ficam como `nao_verificado`, com o fim escrito no `docs/14` §5 (`docs/06`, CF);
  - opção (a) para tirar um mercado de um canal: só é recusado com uma publicação publicada nesse par.
- **Quatro rondas de revisão do agente** (Sonnet 5.5), publicadas no #139. A 4.ª ficou sem P0, P1 nem P2.
- **Publicado no ensaio:** corrida 37500645084 do fluxo `publicar`, imagem `sha256:48d503feb3d3828695a75ab6d10d397083cfa06a41a236725f344cf5d092246b`, às 17:07 UTC. O registo da corrida diz:
  - «migrar: aplicadas 0019_catalogo_publicacao.»;
  - «O /health da API responde.»;
  - «MCP: arrancou e responde.»;
  - «A API chega à base.»
- **Coordenação:** o #142 (contas de pessoas B2, de outra sessão) também queria a 0019. Ficou avisado no pedido dele para renumerar.

## Números (com data e como se contaram)

- 06/10/2026, `pnpm teste` local contra o PostgreSQL 18.6 (a imagem do CI, por docker), com o main do #141 juntado: 554 testes a passar.
  - `test/catalogo-publicacao.test.ts` correu 5 vezes seguidas sem falhas.
- 06/10/2026, mutações na 0019 e no `publicacao.ts`, uma de cada vez, contadas pela linha «Tests» do vitest: cada protecção tirada faz falhar pelo menos um teste.
  - Excepção: tomar a lista de base no servidor, que é só ordem de bloqueios.

## O que ficou por verificar

- Não li a base da VPS depois da publicação: o MCP da VPS continua a pedir nova ligação. A prova é só o registo do fluxo `publicar`.
- Os gatilhos com um dono das tabelas que não seja superutilizador: quem migra, localmente e no CI, é o superutilizador.
- Por fazer (`docs/14` §8):
  - reverificar uma publicação quando mudam a classificação ou o nome, ou quando se arquiva a última variante à venda;
  - arquivar a loja (ainda sem rota);
  - as rotas da API.
