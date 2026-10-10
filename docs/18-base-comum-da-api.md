# Base comum da API: erros, contrato, idempotência, eventos e limites

> **Versão de 05/10/2026 — desenho.** Responde aos pontos «ao abrir a primeira
> rota» da auditoria (`docs/16`, «Segurança e dados»), a pedido do Diogo
> (*«avança com os pontos ao abrir a primeira rota»*). Skills:
> `headless-commerce` (regras 1, 3, 5 e 6), `platform-architect` (regras 5 e
> 6), `observability-security`, `eu-gdpr-privacy` (regra 7). Já decidido:
> REST com OpenAPI 3.1 gerado pelo Fastify + TypeBox + `@fastify/swagger`
> 9.9.1 (ADR-0025); erros RFC 9457 e `Idempotency-Key` (`docs/02` §4.3).
>
> **Nota de 06/10/2026:** desde a fatia «identidade» (`docs/19`), a API tem
> também `GET /me`, `GET /keys`, `POST /keys` e `POST /keys/{id}/revoke`. As
> rotas de domínio (Comerciante, Catálogo) ainda esperam por elas. Quando este
> documento foi escrito, só havia `GET /health` e `GET /paises`.

## 1. O que entra quando

| Peça | Entra | Porquê |
|---|---|---|
| Erros num formato único (RFC 9457) | **já** (pedido A) | vale para as rotas que existem e para os erros do próprio Fastify (404, validação) |
| Contrato OpenAPI 3.1 gerado e publicado | **já** (pedido A) | «nada é exposto fora do contrato» (`headless-commerce`, regra 1); um teste falha se uma rota ficar fora |
| Tabelas da idempotência e dos eventos (outbox) | idempotência: **feita** na 0012 (#118), limpeza na 0013; eventos: **feita** na 0021 (§5) | o desenho está aqui; a idempotência liga-se às rotas de escrita, os eventos escrevem-nos gatilhos da base |
| `Idempotency-Key` nas rotas | com a primeira rota de escrita | precisa do comerciante de quem chama |
| Limites de pedidos | com a fatia «identidade» | são «por chave e por loja» (regra 6) |
| Publicador do outbox (webhooks) | com os webhooks | o evento grava-se já; publica-se depois |

## 2. Erros (RFC 9457)

Todo o erro sai com `Content-Type: application/problem+json` e este corpo
(campos do RFC 9457 mais as extensões do Eurolify):

| Campo | Tipo | Exemplo | Nota |
|---|---|---|---|
| `type` | URI relativo | `/erros/request.invalid` | a página de cada código publica-se com a documentação. Se o RFC 9457 aceita um URI relativo aqui **não verifiquei** (o texto não foi lido); se não aceitar, passa a absoluto quando houver domínio da API |
| `title` | texto | `Pedido inválido` | em português; igual para o mesmo código |
| `status` | inteiro | `400` | o mesmo do HTTP |
| `detail` | texto | `body/nome must NOT have fewer than 1 characters` | o que aconteceu neste pedido; só nos erros do Fastify e nos de domínio (`ErroApi`); qualquer outro erro dá 500 sem `detail`. **Nunca** dados pessoais, SQL nem pilha |
| `instance` | texto | `req-1k` | o identificador do pedido, o mesmo do registo |
| `codigo` | texto | `request.invalid` | **estável**: os clientes e as IA decidem por ele, nunca pelo texto |
| `mensagem` | `{pt, en}` | — | `headless-commerce`, regra 3 |
| `erros` | lista de `{campo, mensagem}` | `[{"campo": "/body/nome", …}]` | só na validação; `campo` é um ponteiro JSON (RFC 6901), com o nome do obrigatório em falta. **A `mensagem` de cada campo sai em inglês, do validador**; em PT e EN por campo fica por fazer |

Códigos de partida. Os de domínio (ex.: `merchant.invalid_transition`)
entram com as rotas de cada domínio, lançados como `ErroApi` (código,
estado e mensagem PT/EN); um erro que não seja do Fastify nem `ErroApi` dá
sempre 500, mesmo que traga um estado 4xx, para não passar texto de fora ao
cliente. O URL mal formado também sai neste formato (`frameworkErrors`). Ficam
fora do formato, por serem anteriores ao Fastify, os pedidos HTTP mal formados
e um erro dentro do próprio gestor de erros.

| Código | HTTP | Quando |
|---|---|---|
| `request.invalid` | 400 | o corpo, a consulta ou os cabeçalhos não cumprem o esquema |
| `route.not_found` | 404 | o caminho não existe, ou o método não existe nesse caminho (o Fastify 5.12.5 dá 404 e não 405; medido no teste `base-comum`, 05/10/2026) |
| `payload.too_large` | 413 | corpo acima do limite |
| `media_type.unsupported` | 415 | `Content-Type` que a rota não aceita |
| `idempotency.key_required` | 400 | escrita sem `Idempotency-Key` (com as rotas de escrita) |
| `idempotency.key_reused` | 422 | a mesma chave com outro corpo (**proposta**: o estado HTTP não tem fonte lida) |
| `idempotency.in_progress` | 409 | a mesma chave ainda a ser tratada (**proposta**, idem) |
| `idempotency.secret_not_repeated` | 409 | repetir um pedido cuja resposta tinha um segredo (o `POST /keys`): o segredo não se guarda nem se repete (`docs/19` §6.1) |
| `idempotency.response_not_kept` | 409 | repetir um pedido cuja resposta não se guarda (a exportação do titular, `POST /customers/{id}/export`): a idempotência guarda só o id do pedido (`dsr_…`), que vem na mensagem (`docs/23` §12, parte 2c) |
| `rate_limit.exceeded` | 429 | acima do limite (com a fatia «identidade») |
| `version.unsupported` | 400 | o cabeçalho `Eurolify-Versao` pede uma versão que não existe (§3) |
| `internal.error` | 500 | tudo o resto; o pormenor vai só para o registo, com o `instance` |

**Nunca um 200 com `ok: false`, nunca um erro engolido** (`headless-commerce`,
regra 3; lição 4.1).

## 2a. Listas (proposta, em código desde 07/10/2026)

Primeira lista: `GET /products` (`docs/14` §7.1). As seguintes seguem o
mesmo formato (`headless-commerce`, regra 4; lição 4.7: nenhuma lista
cortada em silêncio).

| Peça | Como |
|---|---|
| Resposta | `{ dados, total, ha_mais, cursor_seguinte }` |
| `total` | quantos passam no filtro, em todas as páginas (explícito, lição 4.7) |
| Ordem | pelo identificador (uuid v7, a ordem de criação); estável entre páginas. Excepções: a composição de um kit, os artigos de uma colecção e a fila de traduções (linha «Concorrência») |
| `limite` | 1 a 100; por omissão, 25. Fora disso, 400 |
| `cursor` | opaco (o último identificador da página, em base64url; na fila de traduções, o último trio tipo, recurso e campo). Não está ligado ao filtro: é só a posição a seguir à qual se lê, e o RLS continua a mostrar só o comerciante da chave. Um cursor que não é um identificador dá 400 (revisão do #150, P3-4) |
| Filtros | um campo desconhecido na consulta dá 400, nunca se ignora |
| Concorrência | o total e a página lêem-se na mesma transacção REPEATABLE READ e READ ONLY: batem certo entre si. Entre páginas, uma página nunca repete nem salta um registo que já existia antes da primeira (a ordem é pelo id, ou por posição e id quando a lista tem ordem própria). **Excepção:** a composição de um kit (`GET /variants/{id}/components`) e os artigos de uma colecção (`GET /collections/{id}/products`), que um `PUT` reescreve inteiros, só são estáveis enquanto ninguém os substitui (`docs/14` §7.1). **Outra excepção:** a fila de traduções (`GET /translations?locale=…`) não tem identificador próprio: a ordem é (tipo, recurso, campo) e o cursor é esse trio em JSON e base64url (revisão do #166, P3-3); um item sai da fila quando é traduzido, por isso entre páginas só não se repete nem salta o que continua por traduzir |
| Números na consulta | chegam como texto com um padrão (o `limite`): o validador não converte tipos (`app.ts`). Um SDK gerado do contrato vê-os como texto (revisão do #150, P3-6) |
| Listas fechadas | `enum` no contrato, recusadas com 400 fora da lista |
| Escala | a procura por parte do nome (`ilike`) e pelo SKU percorre os artigos do comerciante, sem índice próprio; os filtros `traducao_em_falta` (um `exists` sobre a vista dos originais) e `actualizado_desde` também não têm índice próprio (revisão do #173, P3-A). Chega ao tamanho de hoje; com milhares de artigos, um índice (trigram ou `lower(sku)`) entra antes de abrir a API (revisão do #150, P3-9) |

## 3. Contrato OpenAPI

| Regra | Como |
|---|---|
| Gerado dos esquemas | `@fastify/swagger` 9.9.1, modo dinâmico, `openapi: 3.1.0` (ADR-0025) |
| Publicado | `GET /openapi.json`, sem autenticação: é o que os construtores de frontends e as IA lêem (`docs/02` §4.3) |
| Nada fora do contrato | uma rota sem a resposta de sucesso **e** a de erro (`application/problem+json`) **não se regista** (gancho `onRoute` em `app.ts`); só o `/openapi.json` fica de fora; o teste confere o contrato publicado |
| Erro no contrato | um esquema `Problema` partilhado, referido em todas as respostas de erro |
| Versão por data | **em código** desde a primeira rota de domínio (07/10/2026, `app.ts`; `headless-commerce`, regra 7): a versão é um mês (`2026-10`). Quem chama pode pedir uma com o cabeçalho `Eurolify-Versao`; sem ele, recebe a mais recente. Uma que não existe dá 400 `version.unsupported`. Todas as respostas trazem `Eurolify-Versao` com a versão servida. Os 12 meses de suporte de cada versão e o anúncio das alterações desenham-se com a segunda versão (**proposta**) |
| IA declarada | **em código** desde 10/10/2026 (`app.ts`, `base/rasto.ts`; `docs/28` §3.3; #322): quem chama em nome de uma IA pode dizê-lo com o cabeçalho `Eurolify-IA: fornecedor=…; modelo=…; execucao=…` (cada valor com letras, números e `._:/-`, até 100). Fica no rasto de auditoria como **declarado**, nunca como comprovado. Mal formado ou repetido dá 400 `request.invalid`; sem ele, a IA fica desconhecida |

## 4. Idempotência (tabela `idempotencia`, migração 0012)

| Campo | Tipo | Nota |
|---|---|---|
| `comerciante_id` | uuid | RLS por comerciante, como as outras tabelas |
| `chave` | texto, 1–255 | o valor de `Idempotency-Key`; única por comerciante |
| `metodo`, `caminho` | texto | a mesma chave noutra rota é outro pedido → `idempotency.key_reused` |
| `resumo_corpo` | texto (sha256) | do corpo normalizado; outro resumo → `idempotency.key_reused` |
| `estado` | `em_curso`, `concluido` | um segundo pedido com `em_curso` → `idempotency.in_progress` |
| `resposta_status`, `resposta_corpo` | inteiro, jsonb | devolve-se a mesma resposta ao repetir |
| `criado_em`, `expira_em` | instantes | **proposta: 24 h**; uma tarefa diária apaga as expiradas e regista o que apagou |

- **Modelo (proposta):** a linha entra em `em_curso` **numa transacção
  própria, antes** da escrita (`INSERT … ON CONFLICT DO NOTHING`): se já existe
  `em_curso` → `idempotency.in_progress`; se existe `concluido` com o mesmo
  resumo → devolve-se a resposta guardada; com outro resumo →
  `idempotency.key_reused`. A escrita e a passagem a `concluido` vão na
  **mesma** transacção; se a escrita falhar, apaga-se a linha `em_curso` e o
  cliente pode repetir. Um `em_curso` órfão (processo morto) expira ao fim de
  um prazo curto, a decidir com a migração.
- O corpo guardado pode ter dados pessoais (ex.: uma morada): fica 24 h e
  está no `docs/17` §3.
- **Feito na 0012** (`src/base/idempotencia.ts`; `docs/19` §6.1), com as
  rotas das chaves:
  - o `em_curso` órfão conta ao fim de **60 s** (proposta);
  - a chave tem de 1 a 255 caracteres visíveis em ASCII;
  - o resumo é o sha256 do JSON com as chaves ordenadas;
  - uma resposta com segredo não se guarda: guarda-se sem ele e repetir dá
    `idempotency.secret_not_repeated`.
  - A ordem das recusas: outro método, caminho ou corpo → `key_reused`,
    mesmo com a linha ainda `em_curso`; o mesmo pedido em curso →
    `in_progress` (revisão do #118, P3-11).
- **A limpeza diária** (migração 0013; Diogo, 06/10/2026: *«avança com a
  tarefa diária da idempotência»*):
  - a função `idempotencia_apagar_expiradas()` apaga as linhas com
    `expira_em <= now()` e diz quantas;
  - o programa `eurolify-limpeza` da VPS chama-a às 05:00 UTC, depois da
    cópia das 03:00, e regista quantas apagou no `acoes.log` (também quando
    falha);
  - **com o papel `eurolify_limpeza`, não com o superutilizador** (revisão do
    #119, P2-2). O papel não é superutilizador e passa o RLS forçado
    (BYPASSRLS), que se aplica também ao dono não superutilizador (revisão do
    #118, P3-9). Só tem `SELECT`/`DELETE` na `idempotencia` e `EXECUTE` na
    função. Entra só pelo socket do contentor da base (`LOGIN` sem
    palavra-passe). Assim, código que o dono das tabelas ponha na função ou
    num gatilho corre com estes direitos, nunca como superutilizador. Um
    `SET ROLE` a partir do superutilizador não chegava, porque o código
    chamado pode fazer `RESET ROLE`. Cria-o o `preparar.sh` (passo 10b);
  - a verificação diária das 07:00 avisa se a última corrida falhou ou se há
    linhas expiradas há mais de um dia;
  - **por decidir** (Diogo ou Bruno; revisão do #119, P3-7): se uma limpeza
    automática de prazo de retenção fica fora da regra «antes de escrever na
    base, uma cópia» (`AGENTS.md`, «Operar a VPS», ponto 2). Na prática, cada
    linha apagada já estava na cópia das 03:00, salvo se essa cópia falhou;
  - apaga tudo de uma vez, sem lotes: serve para o ensaio. Em produção
    convém apagar aos bocados (revisão do #119, P3-8).

## 5. Eventos de domínio (tabela `evento_saida`, outbox, migração 0021)

| Campo | Tipo | Nota |
|---|---|---|
| `id` | uuid v7 | identificador do evento, para o receptor ser idempotente |
| `comerciante_id` | uuid | RLS por comerciante |
| `tipo` | texto | ex.: `merchant.activated`, `product.published` (`docs/02` §3) |
| `versao_esquema` | inteiro | do corpo do evento |
| `agregado_tipo`, `agregado_id` | texto, uuid | o registo a que diz respeito |
| `dados` | jsonb | **mínimo**: identificadores e o que mudou; o receptor pede o resto à API (`headless-commerce`, «Webhooks») |
| `criado_em` | instante | da base |
| `publicado_em`, `tentativas`, `ultimo_erro` | — | do publicador; **só ele** os muda |

- O evento grava-se **na mesma transacção** que a mudança (`platform-architect`,
  regra 5). Nunca «gravar e depois tentar avisar».
- **Em código** (migração 0021, 06/10/2026): quem escreve os eventos são os
  gatilhos das tabelas que mudam, com os direitos do dono. A API, o SQL à mão
  no contexto do comerciante e as cadeias de gatilhos não mudam o estado sem o
  evento. O limite é o do rasto da 0008: o dono pode desligar ou apagar um
  gatilho por DDL, e isso só entra por migração revista (revisão do #143,
  P3-2). Um dono **sem superutilizador nem `BYPASSRLS`** (o migrador da VPS)
  não muda o estado à mão sem `eurolify.comerciante`: o RLS forçado da
  tabela de origem chama `comerciante_actual()`, que dá erro sem o
  comerciante, e a mudança falha em vez de passar sem evento. Um
  superutilizador ignora o RLS: a mudança passa e o evento grava-se com o
  comerciante da linha (revisão do #143, ronda 2, P3-A). A API **não** tem privilégios na tabela, nem para
  ler nem para inserir: é mais fechado do que a proposta inicial («a API só
  faz `INSERT`»), porque um evento forjado seria aceite pelo publicador como
  verdadeiro.
- **O publicador** (com os webhooks; revisão do #143, P2-3):
  - terá um utilizador da base próprio, criado fora das migrações (o
    migrador não cria papéis), com `BYPASSRLS` como o `eurolify_limpeza`
    (§4), `SELECT` na tabela e `UPDATE` só em `publicado_em`, `tentativas` e
    `ultimo_erro`; o gatilho que recusa o resto fica como segunda barreira;
  - lê o conjunto `publicado_em IS NULL` (com `FOR UPDATE SKIP LOCKED`) e
    **nunca** usa «o último `criado_em` visto» como cursor: uma transacção
    pode ficar visível depois de outra com `criado_em` posterior, e esse
    evento ficava para trás;
  - garante a ordem **só dentro da mesma linha**: a mesma publicação (canal
    × mercado), o mesmo preço (lista × variante) ou o mesmo mercado, cujas
    escritas são em série. Dois eventos do mesmo agregado vindos de linhas
    diferentes (o mesmo artigo publicado em dois canais, a mesma variante em
    duas listas) podem chegar por qualquer ordem (revisão do #143, ronda 2,
    P3-B).
- **Eventos já escritos** (o contrato que os receptores vão ler; os
  identificadores vão em uuid, e os prefixos públicos — `prd_`, `prl_`… —
  põe-nos o publicador ao montar a mensagem, como a API nas respostas):

| Tipo | Agregado | `dados` |
|---|---|---|
| `product.published` | artigo | `artigo_id`, `publicacao_id`, `canal_id`, `mercado_id`, `quem`\*, `em` |
| `product.unpublished` | artigo | os mesmos, mais `motivo`: um destes cinco (CHECK da 0019 e da 0023): `retirada`, `artigo_arquivado`, `mercado_arquivado`, `canal_arquivado`, `verificacao_falhou` |
| `product.archived` | artigo | `artigo_id` |
| `price.changed` | variante | `lista_id`, `variante_id`, `montante_antigo` (nulo no primeiro preço e depois de uma saída), `montante_novo` (nulo se saiu), `gratuito`, `saiu`, `moeda`, `preco_inclui_iva`, `quem`\*, `em` |
| `market.activated`, `market.archived` | mercado | `mercado_id`, `loja_id` |

\* Guardado na base; **não sai** nos webhooks (`docs/06`, CH).

- `em` vai em UTC, com formato fixo (`2026-10-06T17:24:42.123456Z`),
  qualquer que seja o fuso da sessão que escreveu.
- **`quem` dentro do evento — decidido** (Diogo, 07/10/2026, opção a;
  `docs/06`, CH; revisão do #143, P2-4): fica guardado na base, onde é o
  rasto das transições, mas **o publicador nunca o envia** nos webhooks; quem
  recebe e precisar dele pede-o à API, que verifica as permissões. Como o
  evento não se altera, um pedido de apagamento não o pseudonimiza dentro da
  base: isso fica com o desenho do apagamento (`docs/17` §3).
- **Ainda não escritos:** os outros eventos entram com a parte que os
  escreve.
- Um evento não se altera nem se apaga (gatilho, como o rasto na 0008), nem
  os já publicados, nem os de um comerciante apagado. O prazo de guarda e a
  forma de apagar (um `DELETE` só do que está publicado e fora do prazo, ou
  partições) entram com o publicador, noutra migração (revisão do #143,
  P3-7).

## 6. Limites de pedidos (com a fatia «identidade»)

| Regra | Proposta |
|---|---|
| Por quê | por chave de API e por loja (`headless-commerce`, regra 6) |
| Cabeçalhos | o que resta e quando volta; o nome dos cabeçalhos segue o rascunho da IETF *RateLimit header fields*, que **não verifiquei** se já é RFC |
| Valores | **por decidir com medições**; nenhum número aqui é decisão |
| Hub | **por IP**, na API, antes da base: 20 pedidos por minuto nas rotas públicas e 300 em todas (propostas; `docs/21` §14); 429 `rate_limit.exceeded` com `Retry-After`. O IP só em memória, até dois minutos; atrás do proxy, a `PROXY_CONFIAVEL` (na VPS, o gateway da rede Docker) |
| Sem identidade | `/health`, `/paises` e `/openapi.json` ficam sem limite por cliente. Hoje a API não está exposta: só ouve em `127.0.0.1` (`servidor.ts`) e o nginx só encaminha o MCP (`infra/vps/ficheiros/nginx-mcp.conf`). O limite à frente da API desenha-se quando ela for publicada |
| Dados pessoais | contar por chave, não por endereço IP: o IP é dado pessoal (`eu-gdpr-privacy`, «Quando usar») e não deve ir para registos nem métricas (regra 7) |

## Outras notas

- `docs/02` §4.3 fala de duas APIs (Loja e Administração). Hoje há um só
  `/openapi.json`; quando entrar a de Administração, decide-se se cada uma tem
  o seu contrato publicado, para o público não ver as rotas internas.
- Um método que a rota não tem dá 404 e não 405 com `Allow` (RFC 9110). Fica
  assim por agora.
- O registo de cada pedido guarda o `url` com a consulta (`servidor.ts`): quando
  houver filtros com dados pessoais (ex.: e-mail), a consulta sai do registo.
- Os registos de erro guardam só o tipo, o código, a mensagem e a pilha do erro
  (`servidor.ts`), não o `detail` de um erro do PostgreSQL, que traz valores da
  linha. O identificador do pedido é um UUID.

## O que não foi verificado

- O estado do rascunho *RateLimit header fields* da IETF.
- Os 24 h da idempotência e o prazo dos eventos são propostas técnicas, sem
  medição.
