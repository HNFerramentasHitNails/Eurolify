# API do Catálogo, parte 5: as traduções — 08/10/2026

## O que se fez

- **Código** (#166, juntado como 35c5061; issue #77). Pedido do Diogo, 08/10/2026: «sim, avança com as traduções».
  - Com `catalog:read`: `GET /translations`, com dois usos, exactamente um de cada vez:
    - com `resource` (`prd_`, `opt_`, `ovl_`, `cat_`, `col_`): as traduções desse recurso, com o estado, opcionalmente só de uma `locale`;
    - com `locale`: a fila do que falta traduzir (`em_falta`, `desactualizada`), por páginas, com cursor (tipo, recurso, campo).
  - Com `catalog:write`, com a `Idempotency-Key`: `PUT` e `DELETE /translations/{recurso}/{campo}/{lingua}`.
- **Decisões novas** (`docs/06`):
  - **CO**: rever uma proposta de IA não se faz pela API de chaves; faz-se no Hub, com a sessão de uma pessoa (Diogo: «sim, fica a (a)»).
  - **CP**: por chave, a tradução fica sempre `origem: ia`, e o corpo não leva a origem (Diogo: «sim, fica sempre IA»).
- **Regras no código:**
  - Uma só regra do estado (`estadoDaTraducao`, `consultas.ts`). A fila antiga de `traducoes.ts` saiu.
  - O limite do texto verifica-se antes da base, contado em caracteres como a base:
    - nome e valor: 200;
    - descrição: 20 000;
    - endereço amigável: 100 (`slug_invalid`).
  - O `DELETE` regista quem apagou no arquivo da publicação.
  - Ler as traduções na língua de origem dá 422.
  - `reverTraducao` (para o Hub) recebe o texto que a pessoa viu e prende a linha.
- **Três rondas de revisão do agente** (Claude Sonnet 5.5), todas publicadas no #166 com o tratamento:
  - 1.ª ronda: 1 P1 (resolvido pela CO), 5 P2 e 6 P3;
  - 2.ª ronda: 1 P2 (resolvido pela CP) e 5 P3;
  - 3.ª ronda: só P3.
- **Publicado no ensaio:** corrida 37759661985 do fluxo `publicar` (main 35c5061), imagem `sha256:4f6f2af0f2dadc4eb5725f2ef02073bcd2ccb80185231b7ef2d25bfb8fa1dfc4`, acabou às 09:57 UTC. O registo diz:
  - «migrar: nada em falta.»;
  - «O /health da API responde.»;
  - «MCP: arrancou e responde.»;
  - «Hub: os ecrãs desta publicação estão no ar.»;
  - «A API chega à base.»

## Números (com data e como se contaram)

- 08/10/2026, `pnpm teste` local contra o PostgreSQL 18.6 (por docker), sobre c67fb0e: API 786, MCP 58, Hub 34, todos a passar.
  - Depois disso, o af5464a só acrescentou um teste de concorrência e mudou comentários. Esse teste passou sozinho; a bateria inteira correu no CI.
- `test/catalogo-api-traducoes.test.ts`: 14 testes.
- Mutações (uma de cada vez, ficheiros repostos, contadas pela linha «Tests» do vitest):
  - 1.ª ronda: 6 feitas, 5 apanhadas, 1 redundante (a chave estrangeira recusa na mesma).
  - 2.ª ronda: 10 feitas, 9 apanhadas, 1 equivalente (a base recusa traduzir um original vazio).
  - 3.ª ronda: 3 feitas, 3 apanhadas.
  - Depois da 3.ª revisão: 1 feita (sem o `FOR UPDATE` da revisão), apanhada.
- CI do pedido sobre af5464a: verde (`codigo`, `script-vps`, `imagem`, `segredos`).

## O que ficou por verificar

- **Por decidir (Diogo ou Bruno):**
  - se uma tradução por chave pode substituir sem aviso uma de pessoa ou uma já revista; o revisor propõe 409;
  - se quem traduziu fica fora das respostas (hoje fica, como **proposta**).
- **O Hub ainda não grava traduções de pessoa nem revê.** Tudo o que entra pela API fica `ia`. Essas rotas têm de existir antes de alguma coisa ler `origem` ou `revista`. Não há *issue* nem data.
- A língua só se confere pelo formato: `zz` dá uma fila inteira «em falta».
- A ordem da fila depende da colação da base na VPS, que não verifiquei.
- As categorias e as colecções traduzem-se, mas ainda não têm rotas próprias de leitura.
- O aviso das credenciais do docker sem cifra (`/root/.docker/config.json`) continua no registo da publicação, por tratar (ver `catalogo-api-escritas-07out2026.md`).
- O MCP da VPS continua sem autorização nesta sessão.
