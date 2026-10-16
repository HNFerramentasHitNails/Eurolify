# SDK tipado em TypeScript — gerado do contrato, fino, sem lógica de negócio

> **Estado: desenho escrito sob a autorização geral do Diogo de 16/10/2026;
> à espera do OK dele no pedido.** Issue #474 (peça 12 da Fase 1, `docs/10`).
> O código vem no mesmo pedido, em `apps/sdk` (ADR-0023: o desenho está
> escrito em tabela antes do código). Skill seguida: `headless-commerce`
> («Regras do contrato», pontos 1, 3, 4 e 5; «Pacote para construtores de
> frontends»). Complementam-na `observability-security` (chaves) e
> `platform-architect` (um pacote, uma fronteira).
>
> Este desenho **não traz regra fiscal, legal nem de consumidor**: o SDK não
> decide nada disso, entrega o que a API decide. Por isso não há fontes
> W/M/C nem consulta ao `eur-lex`.

## 1. Para quem é, e para quem não é

| | Loja | Administração |
|---|---|---|
| Quem usa | frontends (Lovable, Vercel, Bolt, Emergent, apps) | servidores do comerciante, integrações, sistemas de gestão |
| Chave | pública, `eul_pk_…` (pode ir para o browser) ou nenhuma | de servidor, `eul_sk_…` (**nunca** num browser nem no repositório) |
| Função | `criarLoja({ url, chave? })` | `criarAdministracao({ url, chave })` |
| Rotas (medido a 16/10/2026) | 25 operações: `/store/carts…`, `/checkout/{token}/…`, `/store/orders/{token}/withdrawal`, `/health`, `/paises` | 250 operações com chave de servidor (catálogo, clientes, preços, IVA, stock, envios, documentos, devoluções…) |

- **O Hub não usa o SDK.** As rotas do Hub (sessão de uma pessoa, `/hub/…`)
  ficam de fora; o Hub é o primeiro cliente da API de Administração, mas fala
  pelo seu caminho (`docs/21`).
- **Ficam de fora** (25 de 300 operações, contadas a 16/10/2026):
  15 do Hub; 3 que não são para quem constrói uma loja (os avisos dos
  prestadores de pagamento e de transporte, `/webhooks/…`, e a volta da
  autorização do Moloni); 7 que devolvem **ficheiros** (PDF, CSV, ZIP,
  imagens, etiquetas). Os ficheiros pedem-se a `fetch` directamente até haver
  desenho para eles (§11).
- **O Loja e a Administração são dois clientes com tipos distintos**: pedir
  `/products` ao cliente da Loja **não compila**; é o que o contrato diz
  (`x-ambito`, §3), não uma lista nossa.

## 2. O que é, num parágrafo

Um pacote `@eurolify/sdk` (pasta `apps/sdk`, no `pnpm-workspace.yaml`
existente) com **três peças**: os tipos gerados do contrato OpenAPI da API;
um cliente fino de ~150 linhas por cima de `fetch`; e dois ajudantes
(paginação por cursor, chave de idempotência). **Zero dependências em
execução**; em desenvolvimento só `openapi-typescript` (MIT, a ferramenta
corrente para este fim; versão exacta no `package.json`).

## 3. Como se gera e como se mantém em dia

```text
API (TypeBox) ──app.swagger()──▶ apps/sdk/contrato/openapi.json   (copiado, no git)
                                        │  scripts/gerar.mjs (openapi-typescript)
                                        ▼
                      apps/sdk/src/gerado/{loja,administracao}.ts (não vai para o git)
                                        │  tsc
                                        ▼
                                  cliente tipado
```

1. **A fonte é a API.** O contrato sai do `app.swagger()` (o mesmo que o
   `/openapi.json` serve). A única mudança à API é uma linha no `onRoute`
   (`apps/api/src/app.ts`): cada rota passa a dizer no contrato o âmbito que
   pede (`x-ambito`, que já existia em `config.ambito` e não se via). É daí
   que o SDK separa Loja de Administração e deixa o Hub de fora — **o SDK não
   decide a quem a rota se destina**.
2. **Um teste da API falha se a cópia divergir** (`apps/api/test/contrato-sdk.test.ts`):
   compara o contrato que a API publica agora com `apps/sdk/contrato/openapi.json`.
   Mexeu numa rota ou num esquema? O teste falha e diz o comando:
   `ACTUALIZAR_CONTRATO=1 pnpm --filter @eurolify/api exec vitest run test/contrato-sdk.test.ts`
   e junta-se o ficheiro. Não precisa de base de dados.
3. **Os tipos refazem-se sempre** (`pnpm tipos`, `pnpm teste`, `pnpm construir`
   correm `gerar` primeiro). Não há tipos gerados no git que possam ficar
   para trás. Um teste do SDK (`test/contrato.test.ts`) confere que cada
   caminho do contrato está nos tipos gerados e que cada operação está
   exactamente num de três sítios: Loja, Administração ou fora (com a razão).
4. **O compilador faz o resto**: se uma rota desaparece ou muda de forma, o
   código de quem usa o SDK deixa de compilar.
5. **A versão por data** (`Eurolify-Versao`, 12 meses de suporte) vai no
   cabeçalho se se disser `versao` ao criar o cliente. O SDK **não a fixa por
   si** nesta fase (§11): quem a quer fixa-a.

## 4. O cliente

```ts
const loja = criarLoja({ url: "https://api.eurolify.eu", chave: "eul_pk_…" });
const carrinho = await loja.post("/store/carts", {
  corpo: { canal, mercado, lingua: "pt" },
  idempotencia: novaChaveDeIdempotencia(),
});
carrinho.dados.id; // tipado; "dados" é o corpo como o servidor o mandou
```

- Métodos `get`, `post`, `put`, `patch`, `delete`, com o **caminho tal como
  está no contrato** (`"/products/{id}"`) e um objecto com só o que o contrato
  dessa rota pede: `caminho`, `consulta`, `cabecalhos`, `corpo`,
  `idempotencia`. O que o contrato exige é obrigatório nos tipos.
- Devolve `{ dados, estado, cabecalhos }`. **Os dados não se tocam**: nenhum
  campo é recalculado, arredondado, traduzido ou preenchido.
- Tempo máximo por pedido: 30 s por omissão (`limiteMs`); `sinal`
  (`AbortSignal`) para cancelar.
- `fetch` injectável (`fetch` nas opções): é como os testes correm sem rede.

## 5. Autenticação

| Regra | Como |
|---|---|
| A chave vai em `Authorization: Bearer …` (docs/19) | o SDK só a copia para o cabeçalho; não a guarda, não a regista |
| **A chave de servidor não entra na Loja** | `criarLoja` recusa `eul_sk_…` com `ErroDoSdk`; `criarAdministracao` só aceita `eul_sk_…` |
| O segredo do carrinho (`X-Cart-Secret`) | passa-se em `cabecalhos`, como o contrato o declara; o SDK não o guarda |
| O token do checkout | é argumento de caminho; o SDK não o guarda |
| OAuth 2.1 / âmbitos para aplicações de terceiros | **não existe ainda na API** (`headless-commerce`, tabela das duas APIs); o SDK segue a API quando existir |

## 6. Erros normalizados

- Toda a resposta que não é 2xx lança **`ErroDaApi`**, com o que a API manda
  (RFC 9457): `estado`, `codigo` estável (ex.: `inventory.insufficient`),
  `problema` completo (mensagem PT/EN, `erros[]` por campo), `pedido` (o
  `instance`, que quem pede ajuda diz) e `esperarSegundos` (do `Retry-After`,
  nos 429).
- Decide-se **pelo `codigo`**, nunca pela mensagem.
- Uma resposta de erro que **não** é um problema (um 502 de um proxy, HTML)
  também é `ErroDaApi`, com o `codigo` `sdk.resposta_inesperada` e
  `problema` indefinido: nunca é tratada como sucesso nem engolida.
- Sem resposta (rede, tempo esgotado, cancelado): **`ErroDeRede`**, com a
  causa. Numa escrita, **não se sabe se o servidor a fez** (§7).
- Um 2xx cujo corpo não é JSON: `ErroDoSdk` (a API nunca devia fazê-lo; é um
  erro nosso a dizer-se alto, não um dado em branco).
- **Nunca** um erro devolvido como valor com `ok: false`, e **nunca** um erro
  mascarado por uma mensagem genérica (o defeito do `supabase.functions.invoke`
  de que a skill fala).

## 7. Idempotência

- Toda a escrita que o contrato marca com `Idempotency-Key` exige
  **`idempotencia` nos tipos** (não compila sem ela). O SDK **não gera uma
  chave por omissão**: uma chave gerada em silêncio a cada tentativa anula
  o fim da chave (o pedido repetido criava outra coisa).
- `novaChaveDeIdempotencia()` dá um UUID. A regra de uso: **uma chave por
  intenção** (um clique em «Encomendar» = uma chave, guardada), reutilizada
  em cada nova tentativa do mesmo pedido.
- **O SDK não repete pedidos sozinho**, nem os de leitura. Quem quer
  repetir (um `ErroDeRede` ou um 503) repete com a **mesma** chave; a API
  devolve o resultado guardado (`docs/18` §4). A mesma chave com outro corpo
  dá `idempotency.key_reused` e chega como `ErroDaApi`.
- As rotas do checkout por `token` não levam `Idempotency-Key` no contrato
  (a idempotência delas, se existe, é do servidor; **não verifiquei** como):
  o SDK não a inventa.

## 8. Paginação por cursor

- As listas da API têm `dados`, `total`, `ha_mais` e `cursor_seguinte`
  (`docs/18` §2a). `paginas(pedir)` e `itens(pedir)` seguem os cursores:

  ```ts
  for await (const artigo of itens((mais) =>
    admin.get("/products", { consulta: { limite: "100", ...mais } }),
  )) { … }
  ```
- **Nunca corta em silêncio** (lição 4.7): se `ha_mais` é verdadeiro e o
  cursor falta, ou se um cursor se repete, ou se passa o tecto de páginas,
  lança `ErroDoSdk` em vez de devolver uma lista incompleta.
- O cursor é opaco; o SDK não o abre nem o constrói.

## 9. O que o SDK nunca faz

1. **Calcular ou arredondar preço, IVA, portes, descontos ou totais**; somar
   linhas; converter moeda. O dinheiro vem em cêntimos inteiros e volta
   assim.
2. **Validar** NIF, IVA intracomunitário, moradas, GTIN ou qualquer regra de
   negócio: as validações de forma que a API já faz (padrões do contrato)
   não se repetem no SDK; quem decide é o servidor e o erro vem normalizado.
3. **Decidir disponibilidade, elegibilidade, promoções, estados** nem os
   deduzir: o estado é o que a API mandou.
4. **Mostrar ou compor textos legais** (condições, livre resolução): são do
   checkout alojado (D-7); o SDK só entrega o que o servidor devolve e
   redirecciona para lá.
5. **Imitar o checkout**: o contrato do checkout está nos tipos porque o
   Eurolify o serve, mas a decisão de IVA, VIES, pagamento e confirmação é do
   servidor.
6. **Repetir pedidos, guardar em cache, guardar chaves, tokens ou segredos**,
   nem escrever nada em disco ou em `localStorage`.
7. **Agir em lote** (`headless-commerce`, anti-padrões; `AGENTS.md`, «Nunca em
   lote»): não há `apagarTudo` nem `reenviarFaturas`; cada operação é uma
   chamada à rota que o contrato tem.
8. **Esconder uma rota fiscal**: as correcções e reenvios de documentos são
   chamadas explícitas com o mesmo papel e a mesma chave que na API; a fila
   e a decisão humana continuam a ser da API.

## 10. Por onde é que isto ainda pode sair errado

| # | Risco | O que o desenho faz |
|---|---|---|
| R1 | O contrato real tem **mais rotas** do que o copiado (as do Hub só existem com `HUB_ORIGEM`) | essas são todas `sessao*` e ficam de fora do SDK; o teste de repartição obriga a que toda a operação nova tenha `x-ambito` e caia num dos três sítios |
| R2 | Alguém regista uma rota sem `x-ambito` | o `onRoute` já recusa uma rota sem `config.ambito` (docs/19 §4); o teste da API confere o `x-ambito` em todas |
| R3 | O contrato mente (esquema fraco): hoje `GET /checkout/{token}` devolve `{ [chave]: unknown }` | o SDK só tem os tipos que o contrato dá. **Pendência da API**, não do SDK: dar esquemas completos ao checkout (medido a 16/10/2026 nos tipos gerados da Loja) |
| R4 | `Idempotency-Key` está `required: false` no contrato, embora a skill a queira obrigatória | o SDK exige-a pela presença do cabeçalho no contrato; **pendência da API**: marcá-la obrigatória no contrato |
| R5 | Uma repetição automática duplica uma escrita | o SDK não repete; a chave é do chamador |
| R6 | A chave de servidor num frontend | `criarLoja` recusa; o resto é higiene do chamador (o SDK não a pode impedir num `fetch` à mão) |
| R7 | Um frontend gerado por IA recalcula o IVA «por conveniência» | o SDK não tem função para isso; a lista do que não faz (§9) vai para o `llms.txt` e o texto do construtor (pendência, fora deste pedido) |
| R8 | Os tipos gerados ficam para trás | não são guardados: refazem-se em cada `tipos`/`teste`/`construir` |
| R9 | `openapi-typescript` 7.13.0 declara compatibilidade com TypeScript 5.x e o repositório usa 6.0.3 | a geração e a compilação passaram (medido a 16/10/2026); aviso de pares do `pnpm install` ficou. Se a ferramenta partir com uma versão futura do TypeScript, os tipos deixam de gerar e o `tipos` falha alto |
| R10 | Resposta com corpo muito grande ou lento | tempo máximo por pedido; sem *streaming* nem ficheiros nesta fase |
| R11 | Uma regra da API muda de sítio | o SDK não lia nenhuma; a varredura (`AGENTS.md`) não o lista |

## 11. O que fica por fazer (fora deste pedido)

- **Publicar** o pacote (npm, ou instalar pelo GitHub): hoje é `private` no
  espaço de trabalho. Publicar é decisão do Diogo ou do Bruno (nome, conta,
  licença).
- **Ficheiros** (etiquetas, PDF de fatura, CSV do OSS, imagens): outra
  interface, com `Blob`/*stream*.
- **`llms.txt`, texto para colar no construtor e loja de exemplo** (skill
  `headless-commerce`, «Pacote para construtores de frontends»): peça à parte,
  que usa este SDK.
- **Fixar a versão da API por data** no SDK (hoje só `2026-10` existe).
- **Retentativas** com recuo, se o Diogo as quiser; teriam de reutilizar a
  chave de idempotência.
- **Contrato com o Hub ligado** para cobrir também as rotas `sessao*` (sem
  efeito no SDK).

## 12. O que não foi verificado

- Nada foi corrido contra uma API real, só contra um `fetch` de teste e
  contra o contrato; uma API a sério, com chave verdadeira, não foi
  exercitada.
- O comportamento num browser (CORS, `AbortSignal.any`, `crypto.randomUUID`
  em contextos não seguros) não foi medido; **não verifiquei** as
  versões mínimas de navegador nem dos construtores (Lovable, Bolt…).
- A publicação do pacote e o consumo a partir de fora do espaço de trabalho.
- Que a data do 12 meses de suporte da versão por data seja a do contrato
  (`docs/18`); o SDK não a lê.

## 13. Como se testa

- **`apps/sdk`** (`pnpm --filter @eurolify/sdk teste`): o cliente contra um
  `fetch` injectado (URL, cabeçalhos, chaves, corpo, 204, erros, rede,
  paginação) e as provas de tipos (`@ts-expect-error` que o `pnpm tipos`
  confere: sem `idempotencia` não compila; `/products` na Loja não compila);
  a repartição do contrato e os tipos gerados.
- **`apps/api`**: `test/contrato-sdk.test.ts` — o contrato copiado é o que a
  API publica e todas as rotas têm `x-ambito`.
