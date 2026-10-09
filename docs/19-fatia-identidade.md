# Fatia «identidade»: quem chama a API e em nome de que comerciante

> **Versão de 06/10/2026 — desenho; parte A decidida** (Diogo, 06/10/2026: *«sim, começa pela parte A»*); parte B decidida: construir na API (ADR-0036). Pedido do Diogo: *«avança
> com o desenho da fatia identidade»* (issue #107). Responde à P1 do `docs/15`
> §9 e desbloqueia a API de domínio, a `Idempotency-Key` e os limites de
> pedidos (`docs/18` §1). Skills: `headless-commerce` (autenticação, âmbitos,
> chaves), `observability-security` (permissões em quatro camadas, segredos,
> auditoria), `eu-gdpr-privacy` (dados das pessoas), `platform-architect`.
>
> **Já decidido:** a API de Administração usa OAuth 2.1/OIDC (quando houver
> aplicações de terceiros; até lá, as pessoas usam a sessão do Hub — decisão
> CC, `docs/21`) com âmbitos e
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
| Pessoa da equipa do comerciante | sessão própria do Hub, com papel no comerciante (`docs/21`; o OIDC só com aplicações de terceiros, decisão CC) | **B** | o dono a alterar a morada da entidade legal |
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
  `chave_listar`**; `chave_criar` e `chave_revogar` ficam com o dono das
  tabelas (o comando do operador; revisão do #110, P2-1). Desde a migração
  0012 a API cria e revoga pelas suas próprias funções, que verificam quem
  pede e o T9 na base (§6.1). O RLS por comerciante não pode ser **forçado** nesta tabela,
  porque a procura da chave atravessa comerciantes antes de haver contexto e
  as políticas da 0001 dão erro sem ele; por isso fica ligado sem `FORCE`, e a
  API não tem nenhum privilégio na tabela.
- Uma chave pública nunca recebe um âmbito de escrita de Administração; a base
  recusa-o (CHECK), não só a aplicação.

## 4. Âmbitos

> Os nomes abaixo são os **finais** (escolha técnica de rotina, 06/10/2026;
> já usados em `apps/api/src/identidade/chaves.ts`).

| Âmbito | Dá | Fonte |
|---|---|---|
| `merchant:read` | ver o comerciante, entidades legais, lojas | `docs/15` §8 |
| `merchant:write` | alterá-los, pedir activação, aceitar contratos | idem |
| `catalog:read`, `catalog:write`, `catalog:publish`, `catalog:import` | o Catálogo | `docs/14` §7 (já propostos) |
| `catalog:history` | a linha do tempo do artigo, com quem fez (migração 0033) | `docs/14` §3.12; `docs/06`, CU |
| `prices:read`, `prices:write` | Preços e mercados: mercados, canais, listas, preços e reduções (migração 0036) | `docs/20` §10.1; `docs/06`, CW |
| `customers:read`, `customers:write` | Clientes: fichas, perfis de faturação, etiquetas e a linha do tempo (migração 0037) | `docs/23` §7; `docs/06`, CX |
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
| 5 | Cada transacção abre com `SET LOCAL eurolify.comerciante` tirado do passo 3, por uma só função (`comComerciante`, em `src/comerciante/repositorio.ts`). Nas chaves (0012), quem escreve é `chave:key_…`, calculado pela base a partir do segredo; o `eurolify.quem` com `chave:key_…` fica para as rotas de domínio que escrevem |

- A chave **nunca** vai para o registo: o serializador do pedido não regista
  cabeçalhos (`src/base/registo.ts`, usado pelo `servidor.ts` e pelo teste, que
  falha se os cabeçalhos entrarem). Uma chave posta por engano no URL
  (`?key=…`) iria para o registo com o `url`: não é um modo aceite — a chave vai
  só no `Authorization`.
- `eurolify.quem` passará a ser `chave:key_…` em vez de texto livre; na parte
  B, `pessoa:per_…`.
- **Decidido para as chaves** (Diogo, 06/10/2026, revisão do #118, P2-3):
  - a chave de um comerciante `suspenso` ou `fechado` **não cria chaves**
    (`key.merchant_inactive`, 403), mas **revoga**, para poder fechar
    acessos;
  - ler continua a resolver, como o `docs/15` §4 deixa (`suspenso` lê,
    `fechado` exporta).
- **Decidido** (Diogo, 06/10/2026, revisão do #118, P2-4: *«sim, concordo,
  nunca dura mais»*): uma chave **nunca cria outra que dure mais do que ela**.
  Uma chave com prazo só cria chaves com prazo igual ou anterior ao seu; uma
  sem prazo, ou com prazo mais longo, é recusada (`key.expiry_beyond_creator`,
  422), também a pública. Imposto na base: migração 0014, no #124 (T12).
- **Decidido** (Diogo, 06/10/2026, revisão do #124, P2-1: *«sim, concordo, não
  pode revogar»*): uma chave com prazo **só revoga chaves que expirem no mesmo
  instante ou antes dela**; não revoga uma sem prazo nem uma que dure mais.
  Assim uma chave temporária não deixa o comerciante sem gestora permanente.
  Migração 0015 (`key.revoke_beyond_creator`, 403; T14 no §9).
- **Decidido** (Diogo, 06/10/2026: *«sim, concordo, deixa de funcionar»*):
  a chave pública de uma loja **arquivada** deixa de funcionar — não se cria
  nenhuma para ela e as que existem deixam de resolver (401 `auth.invalid`,
  como uma revogada) a partir do momento em que a loja é arquivada. O registo
  das chaves fica, para se saber quem teve acesso e quando. **Se a loja
  voltar a activa, as antigas não voltam** (Diogo, 06/10/2026: *«fica a
  a)»*): ao arquivar, ficam revogadas com `revogada_por =
  'loja_arquivada:sto_<id>'`; cria-se uma nova. Criar uma chave para uma loja
  arquivada → `key.store_archived` (422), pela API e pelo operador. Migração
  0016 (T13 no §9).
- **Decidido** (Diogo, 06/10/2026: *«sim, concordo, recusa as escritas»*):
  um comerciante `suspenso` ou `fechado` **não escreve** pelas rotas de
  domínio — recusa `merchant.inactive` (403), imposta na base. Excepções:
  tratar as encomendas pendentes (só `suspenso`, `docs/15` §4), revogar
  chaves e pedir a exportação. Entra em cada domínio quando ele abrir rotas que
  escrevem (a 06/10/2026 só há as duas `POST` de `identidade/rotas.ts`).

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
| Criar chave | `POST /keys` | `keys:write` | devolve o segredo **uma vez**; uma chave não cria outra com mais âmbitos do que tem, uma chave com prazo só cria chaves com prazo até ao seu, e não se cria nenhuma para uma loja arquivada — **feito** (§6.1) |
| Revogar chave | `POST /keys/{id}/revoke` | `keys:write` | imediato; não se revoga a si própria se for a última com `keys:write`, e uma chave com prazo só revoga chaves com prazo até ao seu — **feito** (§6.1) |
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
  gerada na máquina, escrita no `api-base.env`, que só o contentor da API
  recebe. Cada publicação verifica que a API chega à base (uma chave
  inventada tem de dar 401, não 500). As chaves passam a servir lá quando o operador
  criar uma (com a chave SSH do fluxo, abaixo).
- Na máquina há dois nomes parecidos: `eurolify-operar` é o utilizador do
  fluxo (e o programa das acções do MCP); `eurolify-operador` é o programa
  deste comando.

A chave SSH do fluxo foi criada pelo Diogo a 08/10/2026 (ED25519,
`SHA256:wz3eusHxAkSkUSEvj9Aiwb1bMVLSY0zvhEt418EFyQE`): a pública em
`infra/vps/chaves/fluxos/operar.pub`, a privada no segredo
`VPS_CHAVE_OPERAR` do ambiente `ensaio`, como as dos outros fluxos.

Os prefixos `mer_` (comerciante) e `sto_` (loja) são **proposta**: o
`docs/15` ainda não os tinha.

### 6.0 O convite do operador (pedido do Diogo, 08/10/2026)

*«sim, avança com a acção convite do operador»* (issue #156). Sem ela, o Hub
publicado abre mas ninguém entra: o primeiro dono de um comerciante só nasce
de um convite, e o único convite sem conta é o do operador (`docs/21` §7,
ponto 5; função `convite_criar_pelo_operador` da migração 0018).

1. No próprio computador, `node apps/api/scripts/gerar-convite.mjs` mostra a
   **ligação** (`https://hub.eurolify.eu/convite#euc_…`, com o segredo; dá-se
   a quem vai ser dono e não se guarda) e o **resumo**. O segredo nunca passa
   pelo GitHub nem pela VPS — como o `gerar-chave.mjs`.
2. No GitHub, o fluxo `operar` com a acção `convite` (comerciante, e-mail,
   resumo) devolve o `inv_…`. Na VPS, como as outras acções: cópia da base
   antes de escrever, contentor de uma vez com a imagem no ar.
3. Quem recebe abre a ligação, cria a conta com uma passkey e fica **dono**.

| Regra | Porquê |
|---|---|
| Só o papel **dono** | é o primeiro dono ou a recuperação (§7, ponto 5); os outros papéis convida-os um dono no Hub |
| O e-mail vai em base64url no pedido e é validado em três sítios (fluxo, `lerPedido`, base) | sem espaços nem caracteres de controlo na linha; a base é a última palavra |
| **No ensaio, só e-mails de domínios reservados para testes** (`.test`, `.example`, `.invalid`, `example.com`, `example.net`, `example.org`): o fluxo e o `lerPedido` recusam outros (`infra/vps/testes/fluxo-operar.sh` corre o passo do fluxo; revisão do #165, P2-1). **Rede temporária: fim na migração para Paris, no máximo a 31/03/2027** (ADR-0019); então decide-se o que a substitui | ADR-0019: a VPS do ensaio está no Reino Unido e não recebe dados pessoais; as entradas de um fluxo lançado à mão ficam no histórico do GitHub. O Hub não envia e-mails: um endereço fictício basta para entrar |
| O convite vale **7 dias** e uma vez (a base) | decisão do Diogo, 07/10/2026 (`docs/22` §2) |
| Quem lançou fica como `operador:github:<número>` no convite e no rasto (`evento_conta`) | o mesmo das chaves |
| A recuperação de um comerciante real (§7, ponto 5: prova escrita do representante legal) **não** está tratada aqui | só ensaio; o como se confere é **C**, para o jurista |

**Se se escrever um e-mail real** (ou colar a ligação com `euc_`), o fluxo
recusa, mas a entrada fica guardada nessa execução do GitHub: **apaga-se a
execução** (revisão do #165, P3-1). A ligação colada deixa de servir: gera-se
outra.

**Limite, como nas chaves:** o operador pode criar um convite de dono para
qualquer comerciante, mesmo um que já tem dono, sem os avisar. Só no ensaio.
Antes de dados reais, separa-se o «primeiro dono» (recusado se já houver
dono) da recuperação com prova (`docs/21` §7, ponto 5, **C**) (revisão do
#165, P3-6).

**Para a acção chegar à máquina:** a imagem tem de estar publicada (sem ela,
o `eurolify-operador` recusa antes da cópia: «publicar primeiro») e o script
aplicado (as três camadas conhecem o formato do convite).

**A chave SSH do fluxo** (acima) entrou a 08/10/2026.

### 6.1 Criar e revogar pela API (pedido do Diogo, 06/10/2026)

*«avança com o POST /keys e a revogação»* (#107). Entra com a
`Idempotency-Key` do `docs/18` §4, que todas as escritas pedem, e com a
migração 0012.

| Operação | Corpo | Resposta |
|---|---|---|
| `POST /keys` | `tipo` (`servidor`, `publica`); `nome` (1–100); `ambitos` (só na de servidor; a pública tem a lista fixa `storefront`); `loja` (`sto_…`, só na pública); `expira_em` (opcional, no futuro) | **201** com a chave e o `segredo`, que só aparece aqui |
| `POST /keys/{id}/revoke` | nenhum | **200** com a chave revogada (sem segredo) |

As duas exigem o âmbito `keys:write` e o cabeçalho `Idempotency-Key`.

**As regras vivem na base** (migração 0012), em duas funções novas, as únicas
que a API ganha para escrever chaves:

- `chave_criar_pela_api(p_segredo_quem, …)` e
  `chave_revogar_pela_api(p_segredo_quem, p_id)`. **A base recebe o segredo
  apresentado e calcula ela o resumo**: não aceita um id nem um resumo que a
  aplicação escolhesse.
  - Uma falha da aplicação não consegue criar nem revogar em nome de outra
    chave sem ter o segredo dela.
  - O resumo não chega: o das chaves do operador passa pelas entradas do
    fluxo `operar` no GitHub (revisão do #118, P2-2).
  - O segredo não se guarda nem vai para o registo da base: o PostgreSQL não
    regista parâmetros por omissão (`log_statement = none`,
    `log_parameter_max_length_on_error = 0`).
  - **Não verifiquei** a configuração de registo da base na VPS: a imagem é a
    oficial, com os valores por omissão e só `-c shared_buffers` e
    `-c max_connections`.

  A chave que pede tem de:
  - ser válida (não revogada, não expirada);
  - ser do comerciante do contexto;
  - ter `keys:write`.

  Senão → `auth.forbidden` (403). Para **criar**, o comerciante não pode
  estar `suspenso` nem `fechado` → `key.merchant_inactive` (403); revogar
  continua (§5). Uma chave com prazo só cria chaves com prazo igual ou
  anterior ao seu → `key.expiry_beyond_creator` (422; migração 0014).
- **A ordem das recusas ao criar** (a primeira que falha é a que se
  devolve): `auth.forbidden` → `key.merchant_inactive` → `key.invalid_expiry`
  → `key.expiry_beyond_creator` → `key.scope_escalation` (só na de
  servidor) → `key.store_archived` (só na pública, 0016) →
  `key.store_not_found`. Ex.: uma chave temporária que peça uma chave sem
  prazo e com âmbitos a mais recebe o 422 do prazo; corrigido o prazo,
  recebe o 403 dos âmbitos.
- **A ordem das recusas ao revogar:** `auth.forbidden` → `key.not_found` →
  `key.already_revoked` → `key.revoke_beyond_creator` (0015) →
  `key.last_key_writer`.
- **A T13 conta com o isolamento READ COMMITTED** (o da API: nenhuma
  transacção pede outro). No caso «quem cria primeiro», o arquivo espera pelo
  FOR SHARE e, ao continuar, vê a chave nova já gravada e revoga-a; em
  REPEATABLE READ não a veria. Uma rota que mude o isolamento tem de rever
  isto (revisão do #131, P3-1).
- **T9, na base:**
  - numa chave de **servidor**, os âmbitos novos têm de estar todos nos de
    quem pede; senão → `key.scope_escalation` (403);
  - uma chave **pública** tem só `storefront` (leitura da Loja, lista fixa),
    e qualquer chave com `keys:write` a pode criar (**proposta**: `storefront`
    nunca está numa chave de servidor, por isso a regra literal impediria
    sempre criar uma pública).
- `criada_por` e `revogada_por` passam a `chave:key_<id>` (§5).
- **Revogar a última:**
  - nenhuma revogação pela API deixa o comerciante sem uma chave válida com
    `keys:write` → `key.last_key_writer` (409). Na prática é a própria: quem
    pede é sempre uma gestora válida;
  - **uma chave com prazo só revoga chaves com prazo até ao seu** (T14,
    migração 0015, decisão BQ) → `key.revoke_beyond_creator` (403). Assim
    uma gestora temporária já não revoga a permanente — antes da 0015
    podia, e desde a 0014 já não podia criar outra de substituição, o que
    deixava o comerciante sem gestora quando ela expirasse. O comando do
    operador continua sem estas regras (porta de emergência; revisão do
    #118, P3-7);
  - a verificação corre com uma tranca por comerciante
    (`pg_advisory_xact_lock`), e quem pede volta a ser verificado debaixo da
    tranca: duas chaves que se revoguem ao mesmo tempo não deixam o
    comerciante sem nenhuma.
- Uma chave de outro comerciante, ou que não existe → `key.not_found` (404).
  Uma já revogada → `key.already_revoked` (409).

**Idempotência** (tabela `idempotencia`, `docs/18` §4, com RLS forçado):

- sem o cabeçalho → `idempotency.key_required` (400);
- valor de 1 a 255 caracteres visíveis em ASCII;
- uma por comerciante;
- o resumo do corpo é o sha256 do JSON com as chaves ordenadas.
- **O segredo não se repete:** a resposta guardada do `POST /keys` não leva o
  segredo (T5: nunca na base). Repetir o pedido com a mesma chave de
  idempotência dá `idempotency.secret_not_repeated` (409), que diz qual a
  chave criada, para a revogar e criar outra. Não se cria uma segunda chave.
- **Prazos:**
  - guarda 24 h (**proposta** do `docs/18`);
  - um `em_curso` com mais de 60 s conta como órfão e pode ser substituído
    (**proposta**);
  - uma linha expirada é substituída quando a mesma chave volta;
  - a tarefa diária que apaga as expiradas é a migração 0013 com o
    `eurolify-limpeza` na VPS (`docs/18` §4).
- Nada pessoal na resposta guardada destas duas rotas (o nome da chave e
  `chave:key_…`).

Com isto, as rotas do `docs/15` §8 (Comerciante) e do `docs/14` §7 (Catálogo)
podem abrir, cada uma com o seu âmbito, e a `Idempotency-Key` e os limites do
`docs/18` passam a ter a quem se prender (o comerciante e a chave).

## 7. Parte B — as pessoas (P1, decidida: a), ADR-0036)

> ✅ **Decidido** (Diogo, 06/10/2026, [ADR-0036](adr/0036-contas-de-pessoas-construidas-na-api.md)):
> **a) construir na API**, com passkeys como forma principal e TOTP como
> alternativa, e uma revisão de segurança própria. A tabela fica como registo.

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
  tratamentos, a retenção e o apagamento escritos antes do código: desenho no
  [`docs/21`](21-contas-de-pessoas.md) §5 (por aprovar).

## 9. Testes que o código tem de trazer

| # | Teste |
|---|---|
| T1 | sem `Authorization` → 401 `auth.required`; com chave inventada, revogada ou expirada → 401 `auth.invalid`, com o mesmo corpo nas três |
| T2 | a chave de A não lê nem escreve nada de B (o mesmo teste de isolamento do Comerciante, agora pela API) |
| T3 | `eurolify.comerciante` é sempre o da chave: um `comerciante_id` no corpo ou no caminho é ignorado |
| T4 | uma rota sem o âmbito → 403; uma rota sem âmbito declarado não arranca |
| T5 | o segredo só aparece na resposta da criação; nunca no registo, na lista nem na base (só o resumo) |
| T6 | uma chave pública não consegue âmbitos de Administração (recusa na base) |
| T7 | o `eurolify_api` não lê a tabela `chave_api`; só chama `chave_resolver`, `chave_listar` e, desde a 0012, `chave_criar_pela_api` e `chave_revogar_pela_api` |
| T8 | revogar é imediato: o pedido seguinte com a chave dá 401 |
| T9 | uma chave não cria outra com mais âmbitos do que tem — **com o `POST /keys`**, imposto na base |
| T10 | a mesma `Idempotency-Key`: repetir dá a mesma resposta sem escrever outra vez (o `POST /keys` dá `idempotency.secret_not_repeated`); outro corpo → `idempotency.key_reused`; ao mesmo tempo → `idempotency.in_progress` |
| T11 | uma chave não se revoga a si própria se for a última com `keys:write`, nem ao mesmo tempo que outra |
| T12 | uma chave com prazo não cria outra sem prazo nem com prazo mais longo (também a pública, pela rota e pela função na base); prazo igual ou anterior passa (0014) |
| T13 | uma loja arquivada: criar-lhe uma chave pública é recusado (pela API e pelo operador); as que existiam dão 401 `auth.invalid` logo a seguir ao arquivo e ficam revogadas com o motivo; se a loja voltar a activa, não voltam (0016) |
| T14 | uma chave com prazo não revoga uma chave sem prazo nem uma que expire depois dela (pela rota e pela função na base); uma que expire antes ou no mesmo instante, sim (0015) |

Na parte A entram T1, T2, T4 a T8; o T3 só pelo caminho e pela consulta.
Com o `POST /keys` (0012) entram o T9, o T10 e o T11, e com a 0014 o T12
(`test/identidade-escrita.test.ts`); o T3 pelo corpo fica com as rotas de
domínio, porque o corpo do `POST /keys` não tem comerciante.

## 10. O que fica por decidir

- ~~Começar pela parte A~~ — **decidido** (Diogo, 06/10/2026: *«sim, começa
  pela parte A»*).
- ~~A P1 (§7)~~ — **a)** (ADR-0036).
- ~~Os nomes finais dos âmbitos~~ — os do §4 (rotina, 06/10/2026).
- ~~Se `keys:write` precisa de dois passos~~ — **decidido: não na API**
  (Diogo, 06/10/2026: *«sim, concordo, sem dois passos na API»*). A protecção
  fica na base (T9, T12, comerciante inactivo). No Hub (parte B), criar uma
  chave pedirá à pessoa que se autentique outra vez nesse momento.

## O que não foi verificado

- As opções da parte B (§7): nenhum projecto nem fornecedor foi lido.
- Se o sha256 sem sal é a escolha recomendada para chaves aleatórias de 256
  bits: é raciocínio, sem fonte lida.
- O consumo de memória de qualquer servidor de identidade na VPS.

> **Nota (07/10/2026, B3c das contas de pessoas, `docs/21` §12):** pelo Hub,
> com a sessão de uma pessoa, a API ganhou também `chave_criar_pela_sessao` e
> `chave_revogar_pela_sessao` (migração 0025), só para o papel com
> `keys:write` e com autenticação recente. Pelo Hub, a regra «a última chave
> que gere chaves não se revoga» não se aplica: o dono cria outra quando
> quiser. As chaves de uma pessoa que sai revogam-se em cadeia.
