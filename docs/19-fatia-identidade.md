# Fatia «identidade»: quem chama a API e em nome de que comerciante

> **Versão de 06/10/2026 — desenho; parte A decidida** (Diogo, 06/10/2026: *«sim, começa pela parte A»*); parte B por decidir (P1). Pedido do Diogo: *«avança
> com o desenho da fatia identidade»* (issue #107). Responde à P1 do `docs/15`
> §9 e desbloqueia a API de domínio, a `Idempotency-Key` e os limites de
> pedidos (`docs/18` §1). Skills: `headless-commerce` (autenticação, âmbitos,
> chaves), `observability-security` (permissões em quatro camadas, segredos,
> auditoria), `eu-gdpr-privacy` (dados das pessoas), `platform-architect`.
>
> **Já decidido:** a API de Administração usa OAuth 2.1/OIDC com âmbitos e
> chaves de servidor para integrações; a da Loja, uma chave pública por loja
> (`docs/02` §4.1–4.2; `headless-commerce`, tabela das duas APIs). Um
> fornecedor de fora só entra **se for na UE** e com acordo de tratamento
> (`docs/15` §9, P1; `AGENTS.md`, «Regras da UE», regra 4). A equipa do
> Eurolify não tem papel entre comerciantes até haver Hub (P6).

## 1. A proposta numa frase

Fazer a fatia em **duas partes**. A **parte A** é já: chaves (de servidor e
pública), âmbitos, e o contexto do comerciante na base ligado à chave
autenticada. Chega para as integrações, as IA e o Hub de ensaio chamarem a API.
A **parte B** são as pessoas (contas, início de sessão, papéis da equipa), que
dependem da P1 (§7).

## 2. Quem chama a API

| Actor | Como se identifica | Parte | Exemplo |
|---|---|---|---|
| Integração ou IA de um comerciante | **chave de servidor** (`Authorization: Bearer eul_sk_…`) com âmbitos | A | o software de gestão de um comerciante a ler artigos |
| Frontend de uma loja | **chave pública** da loja (`eul_pk_…`), só leitura do catálogo e escrita no carrinho do visitante | A (a chave); as rotas da Loja entram com o Checkout | uma loja feita no Lovable |
| Pessoa da equipa do comerciante | sessão OIDC, com papel no comerciante | **B** | o dono a alterar a morada da entidade legal |
| Operador do Eurolify (Diogo, Bruno) | **comando auditado**, fora da API pública (P6) | A | criar um comerciante de ensaio e a primeira chave dele |
| Visitante ou cliente final da loja | sessão do visitante (carrinho) e conta de cliente | com o Checkout e o domínio Clientes | — |

## 3. Chaves (tabela `chave_api`, parte A)

| Campo | Tipo | Nota |
|---|---|---|
| `id` | uuid v7 | publica-se como `key_…` (identificador opaco com prefixo, `headless-commerce`, regra 2) |
| `comerciante_id` | uuid | isolamento pelas funções da base (ver abaixo); RLS ligado sem `FORCE`, como segunda barreira |
| `tipo` | `servidor`, `publica` | |
| `loja_id` | uuid | **obrigatório na pública, proibido na de servidor** |
| `nome` | texto, 1–100 | para o comerciante a reconhecer («Software de gestão») |
| `ambitos` | lista de texto | só os da lista de §4; a pública tem uma lista fixa, que não se escolhe |
| `prefixo` | texto, 12 | o início visível da chave (`eul_sk_ab2c…`), para a reconhecer sem a guardar |
| `resumo` | texto (sha256 do segredo) | **o segredo nunca se guarda**; mostra-se uma vez, ao criar |
| `criada_por`, `criada_em` | texto, instante | quem: o operador (parte A) ou a pessoa (parte B) |
| `expira_em` | instante, opcional | |
| `revogada_em`, `revogada_por` | instante, texto | revogar é imediato e não tem volta |
| `ultimo_uso_em` | instante | actualizado no máximo uma vez por minuto, para não escrever a cada pedido |

- **Formato do segredo:** `eul_sk_` ou `eul_pk_` mais 32 bytes aleatórios
  (`crypto.randomBytes`) em base32 sem preenchimento. Com 256 bits de acaso, um
  sha256 sem sal chega para o resumo, porque não há dicionário a tentar
  (**proposta**; não há fonte lida no repositório para esta escolha).
- **A API não lê a tabela.** A procura da chave faz-se numa função
  `SECURITY DEFINER` (`chave_resolver(resumo)`), que devolve só o comerciante, a
  loja, os âmbitos e o id, e só a uma chave válida (não revogada, não expirada).
  A tabela fica fechada ao `eurolify_api`, para uma falha da aplicação não
  listar as chaves de todos.
- Rasto: a própria linha é o rasto. Uma chave **não se altera nem se apaga**
  (gatilho); só se revoga uma vez (`revogada_por`, `revogada_em` da base) e se
  marca o último uso. Quem e quando ficam na linha para sempre.
- **Feito na migração 0010** (pedido da parte A): a tabela, o gatilho, e as
  quatro funções `chave_resolver`, `chave_listar`, `chave_criar` e
  `chave_revogar`. **A API só tem `EXECUTE` em `chave_resolver` e
  `chave_listar`**; criar e revogar ficam com o dono das tabelas (o comando do
  operador) até o `POST /keys` entrar com a verificação do T9 na base (revisão
  do #110, P2-1). O RLS por comerciante não pode ser **forçado** nesta tabela,
  porque a procura da chave atravessa comerciantes antes de haver contexto e
  as políticas da 0001 dão erro sem ele; por isso fica ligado sem `FORCE`, e a
  API não tem nenhum privilégio na tabela.
- Uma chave pública nunca recebe um âmbito de escrita de Administração; a base
  recusa-o (CHECK), não só a aplicação.

## 4. Âmbitos (proposta)

| Âmbito | Dá | Fonte |
|---|---|---|
| `merchant:read` | ver o comerciante, entidades legais, lojas | `docs/15` §8 |
| `merchant:write` | alterá-los, pedir activação, aceitar contratos | idem |
| `catalog:read`, `catalog:write`, `catalog:publish`, `catalog:import` | o Catálogo | `docs/14` §7 (já propostos) |
| `keys:write` | criar e revogar chaves | este documento |
| `storefront` | a lista fixa da chave pública | `docs/02` §4.1 |

- Cada rota declara o âmbito que pede, no esquema dela; o contrato OpenAPI
  mostra-o. **Uma rota sem âmbito declarado não arranca**, como a guarda do
  contrato do `docs/18` §3.
- Ler não dá escrever: `catalog:write` não inclui `catalog:read`.

## 5. Do pedido à base: o contexto do comerciante

Fecha, **do lado da aplicação**, o risco do `docs/15` §10: *«o eurolify_api pode
pôr qualquer uuid no SET LOCAL»*. Na base o risco continua: nada liga o
`SET LOCAL` à chave resolvida, e o isolamento depende de as rotas tirarem o
comerciante da chave (passo 3). Uma função da base que abra o contexto a partir
do resumo ajudava, mas não impedia um `set_config` directo (revisão do #110,
P2-2).

| Passo | O quê |
|---|---|
| 1 | Um gancho do Fastify lê `Authorization: Bearer …`; sem ele → `auth.required` (401) |
| 2 | Calcula o resumo e chama `chave_resolver`; desconhecida, revogada ou expirada → `auth.invalid` (401), **sempre o mesmo erro**, para não dizer qual das três |
| 3 | Guarda no pedido `{comerciante, loja, chave, ambitos}`; **o código das rotas nunca recebe o `comerciante_id` do corpo nem do caminho** |
| 4 | A rota confere o âmbito; sem ele → `auth.forbidden` (403) |
| 5 | Cada transacção abre com `SET LOCAL eurolify.comerciante` tirado do passo 3, por uma só função (`comComerciante`, em `src/comerciante/repositorio.ts`). **Por fazer:** `eurolify.quem = 'chave:key_…'`, com as rotas que escrevem |

- A chave **nunca** vai para o registo: o serializador do pedido não regista
  cabeçalhos (`src/base/registo.ts`, usado pelo `servidor.ts` e pelo teste, que
  falha se os cabeçalhos entrarem). Uma chave posta por engano no URL
  (`?key=…`) iria para o registo com o `url`: não é um modo aceite — a chave vai
  só no `Authorization`.
- `eurolify.quem` passará a ser `chave:key_…` em vez de texto livre; na parte
  B, `pessoa:per_…`.
- **Por decidir antes das rotas que escrevem:** se a chave de um comerciante
  `suspenso` ou `fechado`, ou a pública de uma loja arquivada, continua a
  resolver. Hoje continua (o `docs/15` §4 deixa `suspenso` ler e `fechado`
  exportar).

Erros novos (no formato do `docs/18` §2):

| Código | HTTP | Quando |
|---|---|---|
| `auth.required` | 401 | sem `Authorization` |
| `auth.invalid` | 401 | chave desconhecida, revogada ou expirada |
| `auth.forbidden` | 403 | a chave não tem o âmbito da rota |

## 6. Lista da API (parte A)

| Operação | Método e caminho | Âmbito | Notas |
|---|---|---|---|
| Quem sou | `GET /me` | qualquer | o comerciante (`mer_…`), a loja (`sto_…`, se pública), os âmbitos e o prefixo da chave — **feito**. Aceita a chave pública, que está no frontend: o id do comerciante e da loja ficam públicos (o uuid v7 traz a data de criação). É de propósito: a montra precisa de saber de que loja é |
| Listar chaves | `GET /keys` | `keys:write` | nunca devolve o segredo nem o resumo — **feito** |
| Criar chave | `POST /keys` | `keys:write` | devolve o segredo **uma vez**; uma chave não cria outra com mais âmbitos do que tem |
| Revogar chave | `POST /keys/{id}/revoke` | `keys:write` | imediato; não se revoga a si própria se for a última com `keys:write` |
| Comando do operador | fora da API pública: fluxo `operar` do GitHub | — | **feito** (ver abaixo) |

**Comando do operador** (Diogo, 06/10/2026: *«avança com o comando do
operador»*). Pelo GitHub e não pelo MCP, porque o MCP não muda a base
(ADR-0033; `AGENTS.md`, «Operar a VPS», regra 9):

1. No próprio computador, `node apps/api/scripts/gerar-chave.mjs` mostra o
   **segredo** (guarda-se num cofre; não se mostra outra vez) e o **prefixo** e o
   **resumo**. O segredo nunca passa pelo GitHub nem pela VPS.
2. No GitHub, o fluxo `operar` (lançado à mão; só o `main` chega ao ambiente
   `ensaio`) com a acção `comerciante` (nome, língua, fuso) devolve o `mer_…`; com
   a acção `chave` (comerciante, âmbitos, prefixo, resumo, nome) devolve o `key_…`.
3. Na VPS, o utilizador `eurolify-operar` só tem um comando fixo
   (`eurolify-pedido operar`); o serviço da máquina valida o pedido outra vez,
   **faz uma cópia da base antes de escrever** (`AGENTS.md`, regra 2) e corre
   `node dist/operador.js` num contentor de uma vez, com a imagem da API que
   está no ar e a ligação do dono das tabelas, como as migrações. Quem lançou
   fica na chave como `operador:github:<número da conta>`.

Limites, tal como está (revisão do #110):

- **Só dados de ensaio.** A VPS do ensaio está no Reino Unido e não recebe
  dados pessoais reais (ADR-0018/0019); o nome também fica no histórico do
  GitHub (as entradas de um fluxo lançado à mão ficam visíveis a quem pode
  ver o repositório). Nomes fictícios, nunca o de um cliente ou de uma pessoa.
- **Não é só a primeira chave.** O comando cria quantas chaves de servidor se
  pedirem, com qualquer âmbito de servidor, para qualquer comerciante; o
  travão é quem pode lançar o fluxo (escrita no repositório e o ambiente
  `ensaio`). A regra «uma chave não cria outra com mais âmbitos» (T9) é para o
  `POST /keys`, não para o operador.
- **Repetir a acção `comerciante` cria outro comerciante** (não há chave de
  idempotência neste comando): antes de repetir um pedido que pareceu falhar,
  ver no registo da máquina se já foi feito.
- **Um agente (Claude ou Codex) só lança este fluxo com a confirmação
  explícita** do Diogo ou do Bruno para esse pedido (`AGENTS.md`, «Operar a
  VPS», regra 1): escreve na base.
- **A API na VPS liga-se à base desde o #107** (passos 10b e 10c do
  `preparar.sh`, 06/10/2026): o `eurolify_api` entra com uma palavra-passe
  gerada na máquina, escrita no `api.env`, que só o contentor da API recebe.
  Cada publicação verifica que a API chega à base (uma chave inventada tem
  de dar 401, não 500). As chaves passam a servir lá quando o operador
  criar uma (falta a chave SSH do fluxo, abaixo).
- Na máquina há dois nomes parecidos: `eurolify-operar` é o utilizador do
  fluxo (e o programa das acções do MCP); `eurolify-operador` é o programa
  deste comando.

Falta, para o fluxo entrar: o Diogo ou o Bruno criar a chave SSH do fluxo
(a pública em `infra/vps/chaves/fluxos/operar.pub`, a privada no segredo
`VPS_CHAVE_OPERAR` do ambiente `ensaio`), como as dos outros fluxos.

Criar e revogar pela API entram no pedido seguinte, com a `Idempotency-Key`
(`docs/18` §4), que todas as escritas pedem. Os prefixos `mer_` (comerciante) e
`sto_` (loja) são **proposta**: o `docs/15` ainda não os tinha.

Com isto, as rotas do `docs/15` §8 (Comerciante) e do `docs/14` §7 (Catálogo)
podem abrir, cada uma com o seu âmbito, e a `Idempotency-Key` e os limites do
`docs/18` passam a ter a quem se prender (o comerciante e a chave).

## 7. Parte B — as pessoas (P1, por decidir)

O que a parte B tem de dar: conta de pessoa, início de sessão forte, papéis
por comerciante (dono, gestor, armazém, apoio — `observability-security`,
«Permissões em quatro camadas»), convites, saída de quem deixa a equipa.

| Opção | A favor | Contra | Por verificar |
|---|---|---|---|
| **a) Construir** o OIDC com uma biblioteca, na API | tudo na nossa base, na VPS; nenhum subcontratante novo | segurança do início de sessão (palavras-passe, recuperação, segundo factor) é nossa; mais código para rever | que biblioteca e com que licença |
| **b) Servidor de identidade de código aberto alojado na VPS** (há vários; exemplos a avaliar: Keycloak, Ory, Zitadel, authentik) | os dados ficam na VPS; o início de sessão é de um projecto com mais uso | mais uma peça a operar e a actualizar; memória numa VPS de 3,7 GiB (ADR-0021) | **nada verificado**: licença, memória, actividade de cada projecto, onde ficam os dados |
| c) Fornecedor na UE, gerido | menos a operar | subcontratante novo, acordo de tratamento, dados fora da nossa máquina; tem de ser **na UE** (`AGENTS.md`, regra 4) | quais existem na UE e onde guardam os dados — **não verifiquei** |

A escolha sai num ADR. Em qualquer opção, os papéis e a ligação pessoa ×
comerciante ficam **na nossa base**, com RLS, e o contexto do §5 passa a vir da
sessão em vez da chave.

## 8. Dados pessoais

- Parte A: só `criada_por` e `revogada_por` (`operador:github:<número>`; na
  parte B, a pessoa). Está no `docs/17` §1 (T7).
- Parte B: contas de pessoas (e-mail, nome, segundo factor), com o registo de
  tratamentos, a retenção e o apagamento escritos antes do código.

## 9. Testes que o código tem de trazer

| # | Teste |
|---|---|
| T1 | sem `Authorization` → 401 `auth.required`; com chave inventada, revogada ou expirada → 401 `auth.invalid`, com o mesmo corpo nas três |
| T2 | a chave de A não lê nem escreve nada de B (o mesmo teste de isolamento do Comerciante, agora pela API) |
| T3 | `eurolify.comerciante` é sempre o da chave: um `comerciante_id` no corpo ou no caminho é ignorado |
| T4 | uma rota sem o âmbito → 403; uma rota sem âmbito declarado não arranca |
| T5 | o segredo só aparece na resposta da criação; nunca no registo, na lista nem na base (só o resumo) |
| T6 | uma chave pública não consegue âmbitos de Administração (recusa na base) |
| T7 | o `eurolify_api` não lê a tabela `chave_api`; só chama `chave_resolver` e `chave_listar` |
| T8 | revogar é imediato: o pedido seguinte com a chave dá 401 |
| T9 | uma chave não cria outra com mais âmbitos do que tem — **com o `POST /keys`**, imposto na base |

Na parte A entram T1, T2, T4 a T8; o T3 só pelo caminho e pela consulta (não
há rotas com corpo); o T9 entra com o `POST /keys`.

## 10. O que fica por decidir

- ~~Começar pela parte A~~ — **decidido** (Diogo, 06/10/2026: *«sim, começa
  pela parte A»*).
- A P1 (§7): opção a), b) ou c).
- Os nomes finais dos âmbitos e se `keys:write` precisa de dois passos, como as
  acções do MCP.

## O que não foi verificado

- As opções da parte B (§7): nenhum projecto nem fornecedor foi lido.
- Se o sha256 sem sal é a escolha recomendada para chaves aleatórias de 256
  bits: é raciocínio, sem fonte lida.
- O consumo de memória de qualquer servidor de identidade na VPS.
