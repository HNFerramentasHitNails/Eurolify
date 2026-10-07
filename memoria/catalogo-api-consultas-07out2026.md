# API do Catálogo, parte 1: as consultas — 07/10/2026

## O que se fez

- **Código** (#150, juntado como 2ec205e; issue #77): as primeiras rotas de um domínio, com uma chave de servidor com `catalog:read`:
  - `GET /products`, com filtros e lista por cursor com o total explícito (`docs/18` §2a);
  - `GET /products/{id}`;
  - `GET /products/{id}/publications`;
  - `POST /products/{id}/publications/check`, o «pode publicar?», sem escrever.
- **Tudo só de leitura:** as consultas correm em REPEATABLE READ e READ ONLY (opção `soLeitura` em `comComerciante` e `noCatalogo`).
- **Erros:** os do Catálogo têm um estado HTTP numa tabela fechada (`rotas.ts`, **proposta**).
- **Versão da API por data:** o cabeçalho `Eurolify-Versao` (`2026-10`) e o erro `version.unsupported` (`docs/18` §3).
- **Decisão do Diogo** (07/10/2026, «sim, fica a (a)»; `docs/06`, CL): quem publicou, arquivou ou classificou não sai nas consultas.
  - A letra CK foi também usada pelo #149, de outra sessão; a desta decisão passou a CL na 2.ª revisão.
- **Duas rondas de revisão do agente** (Sonnet 5.5), publicadas no #150. A 2.ª ficou sem P0 nem P1; o P2 dela era a letra repetida.
- **Publicado no ensaio:** corrida 37619755261 do fluxo `publicar`, imagem `sha256:d91cb9a138f8c4b1c8ac8bb02a959bf5755576238af2ef7b563400ea31e3aa19`, às 12:20 UTC. O registo da corrida diz:
  - «migrar: nada em falta.»;
  - «O /health da API responde.»;
  - «MCP: arrancou e responde.»;
  - «A API chega à base.»

## Números (com data e como se contaram)

- 07/10/2026, `pnpm teste` local contra o PostgreSQL 18.6 (a imagem do CI, por docker), com o main do #149: API 681 testes, MCP 58, todos a passar. 17 deles estão em `test/catalogo-api.test.ts`.
- 07/10/2026, mutações (uma de cada vez, com os ficheiros repostos), contadas pela linha «Tests» do vitest. Cada uma faz falhar pelo menos um teste:
  - o total contado só na página;
  - os curingas por escapar;
  - o 404 passado a 422;
  - as publicações sem confirmar o artigo;
  - a página sem a linha a mais;
  - o cursor sem validar;
  - a verificação guardada sem normalizar;
  - o padrão de controlo tirado;
  - a transacção sem READ ONLY;
  - o `catalog.retry` sem `Retry-After`.

## O que ficou por verificar

- A API não está exposta: na VPS só ouve em `127.0.0.1`. Nenhum pedido de fora chegou a estas rotas.
- Não li a base nem a API da VPS, porque o MCP da VPS continua a pedir nova autorização. A prova da publicação é só o registo do fluxo.
- A procura por nome e por SKU não tem índice próprio (`docs/18` §2a): entra antes de abrir a API para fora.
- Por fazer:
  - as escritas pela API, com a `Idempotency-Key`;
  - os outros filtros e o `expand`;
  - a API da Loja e o MCP de leitura.
