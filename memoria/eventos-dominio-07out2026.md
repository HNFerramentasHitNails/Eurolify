# Eventos de domínio na outbox (0021) — 07/10/2026

## O que se fez

- **Código** (#143, juntado como c46e471; issue #77, parte 5):
  - a migração `0021_eventos_saida.sql` (era a 0020; o #142 ocupou-a): a tabela `evento_saida` e os gatilhos que escrevem os eventos;
  - a API sem nenhum privilégio na tabela; um evento não se altera nem se apaga;
  - eventos escritos: `product.published`, `product.unpublished`, `product.archived`, `price.changed`, `market.activated` e `market.archived`. O contrato de cada um está no `docs/18` §5.
- **Decisão do Diogo** (07/10/2026, opção a; `docs/06`, CH): `quem` fica guardado como rasto interno e nunca sai nos webhooks; quem recebe pede-o à API.
- **Duas rondas de revisão do agente** (Sonnet 5.5), publicadas no #143. A 2.ª ficou sem P0, P1 nem P2; os P3 foram tratados.
- **Publicado no ensaio:** corrida 37591885738 do fluxo `publicar`, imagem `sha256:411e340302c3fb9ca87e94380fc0a9ece652685fef8be92110f768b9686bf1f5`, às 08:12 UTC. O registo da corrida diz:
  - «migrar: aplicadas 0021_eventos_saida.»;
  - «O /health da API responde.»;
  - «MCP: arrancou e responde.»;
  - «A API chega à base.»

## Números (com data e como se contaram)

- 06/10/2026, `pnpm teste` local contra o PostgreSQL 18.6 (a imagem do CI, por docker), no 84c21ff: API 600 testes, MCP 58, todos a passar. 17 deles estão em `test/eventos.test.ts` e 1 em `test/seguranca-base.test.ts` (o migrador sem poderes).
- 07/10/2026, CI do #143 no 9a671aa e do `publicar` no c46e471: verde.
- 06/10/2026, mutações na 0021, uma de cada vez, contadas pela linha «Tests» do vitest: cada protecção tirada faz falhar pelo menos um teste. Entre elas: os gatilhos dos eventos, a imutabilidade, o TRUNCATE, os privilégios da API, a política do RLS e o UTC do `em`.

## O que ficou por verificar

- Não li a base da VPS depois da publicação: o MCP da VPS continua a pedir nova autorização. A prova é só o registo do fluxo `publicar`.
- O custo dos gatilhos numa alteração de muitos preços de uma vez.
- A tabela cresce sem limpeza até haver o publicador; o prazo de guarda e a forma de apagar entram com ele.
- Por fazer:
  - reverificar as publicações quando os eventos chegam (`docs/14` §8; precisa de uma decisão sobre o que acontece a uma publicação que deixa de passar);
  - o publicador e os webhooks, com o seu papel na base e sem enviar `quem` (CH);
  - os outros eventos da lista.
