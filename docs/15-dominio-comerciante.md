# Domínio Comerciante — modelo e lista da API (fatia 2)

> **Versão de 04/10/2026** (issue #41). **As 7 perguntas da §9 foram
> decididas pelo Diogo a 04/10/2026** (*«sim, aceito as 7 propostas»*). Fatia 2 do
> [plano](eurolify/implementation-plan.md): a primeira com tabelas, isolamento
> por comerciante na base e migrações. Pelo ADR-0023, o código vem depois deste
> desenho; e entra só com a revisão de uma sessão nova **antes** de juntar
> (decisão do Diogo, 04/10/2026, mantém o ADR-0031).
>
> Skills seguidas: `platform-architect`, `observability-security`,
> `eu-gdpr-privacy`, `headless-commerce`, `eu-localization` (moradas),
> `eu-vat-oss-ioss` (identificação fiscal). Também o `eurolify-merchant-onboarding`
> do pacote complementar (lido do zip, não instalado — ADR-0034).
>
> Marcas: **regra** (com fonte), **proposta** (decide-se ao juntar),
> **pergunta** (§9; não se programa sem resposta).

## Estado do código (04/10/2026)

Feito: a migração `apps/api/migracoes/0001_comerciante.sql` (as seis tabelas,
RLS forçado, o `eurolify_api` sem `BYPASSRLS`, as transições de estado e as
condições de activação na base, o rasto escrito pela base num gatilho
`AFTER UPDATE`), o migrador (`apps/api/src/migrar.ts`), o acesso interno
(`apps/api/src/comerciante/repositorio.ts`), 40 testes contra o PostgreSQL
18.6 e 7 do migrador (`grep -c "  it("`, 04/10/2026). Por fazer: a API (fatia «identidade»), os dois utilizadores da base na
VPS (pedido ao script, ADR-0028), a validação da morada e do número fiscal por
país (**C**).

## 1. O que é e o que entra

O comerciante é o **inquilino**: tudo o resto (catálogo, encomendas, clientes)
pertence a um comerciante e só ele o vê (`docs/02` §5; `platform-architect`,
regra 3). Vende-se a comerciantes desde a Fase 1 (ADR-0006): registo e
configuração pelo próprio, contrato de serviço e acordo de tratamento de
dados, exportação completa.

| Entra nesta fatia | Fica para depois |
|---|---|
| comerciante, entidade legal, loja | contas de pessoas, autenticação (OAuth 2.1/OIDC) e papéis da equipa — **fatia «identidade»** (§9, P1) |
| estados do comerciante, com cada transição registada | faturação do Eurolify aos comerciantes (preços por decidir, ADR-0012) |
| aceitação do contrato de serviço e do acordo de tratamento, por versão | os textos desses contratos (jurista, `compliance-gaps.md` G11) |
| prova das verificações feitas (finalidade, origem, resultado, prazo de revisão) | verificação automática por adaptador (VIES, registos comerciais) |
| isolamento por comerciante imposto pela base (RLS) e os utilizadores da base | o Hub (ecrãs) |
| a base das migrações (Kysely, ADR-0025) | |

## 2. Fronteira

| Dado | Dono | Nota |
|---|---|---|
| comerciante, entidade legal, loja, estado, aceitações, provas de verificação | **Comerciante** | |
| registos fiscais da entidade (país-sede, OSS, IOSS, outros países) | **Motor de IVA** (`eu-vat-oss-ioss`, «Registos fiscais do comerciante»; P4) | a entidade legal só os referencia |
| mercados, moedas, listas de preços de cada loja | Preços e mercados | |
| pessoas da equipa, papéis, sessões | fatia «identidade» (P1) | |
| subscrição e faturação do Eurolify ao comerciante | por decidir (D-14) | o Eurolify é aí **responsável** pelo tratamento, não subcontratante (`eu-gdpr-privacy`) |

## 3. Modelo

Identificadores: `uuid` na base (`uuidv7()`, que o PostgreSQL 18 traz — **confirmado** no
PostgreSQL 18.6 a 04/10/2026), mostrados para fora com prefixo do tipo (`mer_…`, `ent_…`,
`sto_…`; `headless-commerce`, regra 2). Datas em UTC (`timestamptz`).
**Todas as tabelas têm `comerciante_id`**, com RLS (§5).

### 3.1 Comerciante (`mer_`)

| Campo | Tipo | Obrig. | Notas |
|---|---|---|---|
| `id` | uuid | sim | é também o `comerciante_id` das outras tabelas |
| `estado` | lista | sim | §4 |
| `nome` | texto | sim | nome comercial, para mostrar; **nunca serve para decidir identidade** (`AGENTS.md`, regra fiscal 6): dois comerciantes com o mesmo nome são dois |
| `lingua` | código (pt, es, en…) | sim | a do Hub e das comunicações do Eurolify |
| `lingua_origem` | código | sim | a língua em que o comerciante escreve o catálogo, **uma só para todo o catálogo** (`docs/14` §9, P13; Diogo, 05/10/2026: *«sim, uma só língua de origem por comerciante»*). Passa da loja para aqui com a parte 3b do Catálogo |
| `fuso` | IANA (ex.: `Europe/Lisbon`) | sim | para mostrar; guarda-se sempre UTC (`eu-localization`) |
| ~~`plano`~~ | — | — | **não entra nesta fatia** (P5): entra com a D-14 (ADR-0007, ADR-0012) |
| `criado_em`, `actualizado_em`, `versao` | | sim | `versao` sobe em cada alteração; escrita com versão antiga recusada |

### 3.2 Entidade legal (`ent_`)

Quem vende e fatura. Um comerciante tem uma ou várias (grupo com várias
empresas); **nunca partilham NIF, séries nem saldos** (pacote, onboarding,
regra 4).

| Campo | Tipo | Obrig. | Notas |
|---|---|---|---|
| `comerciante_id` | uuid | sim | |
| `denominacao` | texto | sim | firma, como no registo comercial |
| `forma_juridica` | texto | sim | empresário em nome individual, sociedade… (lista por país: **C**, P3) |
| `pais` | ISO 3166-1 | sim | um dos 27 (motor de regras, `CODIGOS_UE`) |
| `numero_fiscal` | texto | sim | **sem** o prefixo do país (o prefixo do VIES não é o ISO: `EL` na Grécia — `eu-vat-oss-ioss`); único por país **dentro do comerciante** |
| `morada_fiscal` | morada por país | sim | formato e código postal validados pelo país (`eu-localization`); região de uma lista, nunca texto livre |
| `estado` | activa, arquivada | sim | arquivar não apaga: os documentos fiscais ficam 10 anos (`eu-gdpr-privacy`). **Arquivada é final** (Diogo, 04/10/2026): não se desarquiva nem se altera, e nasce sempre activa (`legal_entity.archived_is_final`); cria-se outra entidade (§4) |

### 3.3 Loja (`sto_`)

| Campo | Tipo | Obrig. | Notas |
|---|---|---|---|
| `comerciante_id` | uuid | sim | |
| `entidade_legal_id` | uuid | sim | quem vende nesta loja (aparece ao cliente: `consumer-rights-eu`, identidade do vendedor) |
| `nome` | texto | sim | marca |
| ~~`lingua_origem`~~ | código | sim | **passa para o comerciante** (§3.1; `docs/14` §9, P13): o artigo é do comerciante, não da loja. Sai da loja com a parte 3b do Catálogo |
| `estado` | activa, arquivada | sim | |

### 3.4 Aceitação de um contrato

| Campo | Notas |
|---|---|
| `comerciante_id`, `tipo` | contrato de serviço, acordo de tratamento de dados (RGPD, art. 28.º — `eu-gdpr-privacy`) |
| `versao_texto` | versão do texto aceite; texto novo = versão nova, nunca editar a antiga (`platform-architect`) |
| `aceite_por`, `aceite_em` | pessoa (quando houver identidade, P1) e instante |
| — | **só se acrescenta**: retirar ou mudar é uma linha nova |

### 3.5 Prova de verificação

O que se verificou sobre o comerciante, **proporcional ao papel real**
(pacote, onboarding, regras 1 e 2): o resultado do prestador de pagamento não
aprova o fiscal nem o de produto.

| Campo | Notas |
|---|---|
| `comerciante_id`, `entidade_legal_id` | |
| `finalidade` | ex.: identificação fiscal, contrato, prestador de pagamento |
| `origem` | manual (quem), VIES (com a resposta guardada), documento |
| `resultado` | aceite, recusada, por rever |
| `verificado_em`, `rever_ate` | uma verificação caduca; caducada ⇒ volta a «prova pendente» só no que dela depende (**proposta**) |
| `documento` | ficheiro na UE, quando houver; nunca o documento inteiro nos registos técnicos |

### 3.6 Transição de estado

Uma linha por mudança de estado do comerciante: `de`, `para`, `motivo`,
`quem`, `quando`. **Só se acrescenta** (`observability-security`, registo de
auditoria). Alimenta a linha do tempo (`platform-architect`).

## 4. Estados do comerciante

Do pacote (onboarding, regra 3), com os nomes em português:

| Estado | Pode | Entra quando |
|---|---|---|
| `rascunho` | configurar | regista-se |
| `prova_pendente` | configurar | pediu activação e falta prova |
| `em_revisao` | configurar | a prova está entregue; uma pessoa revê |
| `aprovado_limitado` | vender **só em modo de ensaio, sem dinheiro real** (P2) | revisão aceite |
| `activo` | vender | contrato e acordo aceites na versão em vigor, provas válidas, e o motor de regras a permitir os domínios dos países onde vende |
| `suspenso` | ler e exportar; **as encomendas pendentes continuam a ser tratadas** (direitos dos clientes) | decisão com motivo |
| `fechado` | exportar durante o prazo da exportação; documentos fiscais guardados 10 anos | pedido do comerciante ou decisão com motivo |

Transições permitidas: `rascunho → prova_pendente → em_revisao →
aprovado_limitado → activo`; `rascunho → em_revisao` (quando o pedido de
activação já traz a prova); `em_revisao → prova_pendente` (recusada, com
motivo); qualquer um, excepto `fechado`, → `suspenso` ou `fechado`
(`fechado` não sai); `suspenso → ` o estado anterior. Quem pede a mudança diz
de que estado parte: se já mudou entretanto, a mudança é recusada
(`merchant.invalid_transition`), e mudar para o mesmo estado também (revisão
do #43, P2-1 do `0f63e36`). **Toda a transição tem motivo e quem**, e fica na tabela 3.6 —
escrita **pela base**, pelo gatilho da mudança de estado, com o motivo e quem
postos pela aplicação; a API não escreve no rasto (revisão do #43, P1-3).
A activação olha para a prova **mais recente** de cada entidade legal activa,
pela ordem de registo (P1-1); o país e o número fiscal de uma entidade não
mudam — arquiva-se e cria-se outra (P1-2). **Arquivada é final** (Diogo,
04/10/2026) e **congela a entidade inteira** (Diogo, 04/10/2026, «congela a
entidade inteira»): a base recusa desarquivar e qualquer outra alteração a uma
entidade arquivada, e uma entidade nasce sempre activa
(`legal_entity.archived_is_final`); o
número fiscal só é único entre as entidades activas, por isso voltar a usar um
número arquivado é criar outra entidade, com prova nova. Uma prova nova só se
regista numa entidade activa (`legal_entity.archived`; revisão do #43, P2-3
do `98ca4c1`). **Regra por fazer** (revisão do #43, P2-4 do `98ca4c1`): a
condição «cada entidade activa com a sua prova» só se verifica ao passar a
`activo`. Um comerciante já `activo` que arquive a única entidade provada e
crie outra sem prova continua `activo` e pode abrir lojas nela; tem de ser
verificada também ao criar uma entidade ou uma loja de um comerciante activo
(fatia «identidade»).
Ninguém se activa a si próprio: a passagem a `activo` é feita pelo servidor
quando as condições se verificam, ou por uma pessoa do Eurolify com rasto
(**proposta**).

## 5. Isolamento na base (RLS) — regra, não opção

`platform-architect` regra 3 e `observability-security` «Fechado por omissão»;
ADR-0025 (RLS por comerciante).

| Peça | Desenho (proposta) |
|---|---|
| Utilizador da base da API | `eurolify_api`: `NOSUPERUSER NOBYPASSRLS`, `SELECT/INSERT/UPDATE` nas tabelas do produto; **sem `DELETE`** nas tabelas «só se acrescenta», que desde a migração 0008 recusam também `UPDATE`, `DELETE` e `TRUNCATE` ao dono, por gatilho (desligá-lo exige ser dono e uma migração revista; um teste falha se faltar ou estiver desligado); e sem `EXECUTE` nas funções da base, salvo nas que chama. As funções nascem fechadas quando criadas pelo `eurolify_migrador`; uma migração corrida por outro utilizador tem de fechar as suas. *Nota de 05/10/2026:* no Catálogo há `DELETE` em artigo, variante e componentes (migrações 0002 e 0004), porque um **rascunho** que nunca esteve activo pode apagar-se (`docs/14`, «Apagar rascunho», `DELETE /products/{id}`) |
| Utilizador das migrações | `eurolify_migrador`: dono das tabelas; só corre na publicação (`dist/migrar.js`, já previsto em `eurolify-publicar:114-122`) |
| Políticas | `ENABLE` **e** `FORCE ROW LEVEL SECURITY` em todas as tabelas; `USING (comerciante_id = current_setting('eurolify.comerciante')::uuid)` e o mesmo em `WITH CHECK` |
| Contexto | cada pedido abre uma transacção e faz `SET LOCAL eurolify.comerciante = '<uuid>'`; sem isso a consulta dá **erro**, nunca vazio em silêncio: numa ligação nova o parâmetro não existe; numa ligação reaproveitada vale texto vazio, que falha a conversão para `uuid` (**confirmado** no PostgreSQL 18.6 a 04/10/2026: erros `42704` e `22P02`; há um teste para cada caso) |
| Criar um comerciante | a aplicação gera o `uuid`, faz `SET LOCAL` com ele e insere: a política deixa, sem nenhum utilizador que ignore o RLS |
| Trabalho da equipa do Eurolify (rever comerciantes) | **nenhum papel entre comerciantes** até haver o Hub (P6): a revisão faz-se por um comando auditado na API, dentro do contexto do comerciante revisto |
| Testes | o CI liga-se como `postgres` (superutilizador, que **ignora o RLS**): os testes de isolamento criam e usam o `eurolify_api`, e falham se a ligação tiver `BYPASSRLS` |
| VPS | **Passo 10b do `preparar.sh`** (#70), aplicado pelo GitHub (ADR-0028): cria o `eurolify_api` como a migração o criaria (`NOLOGIN`, sem palavra-passe, sem `BYPASSRLS`; o migrador não tem `CREATEROLE`) e o `eurolify_migrador` (`LOGIN`, sem superutilizador, `BYPASSRLS` nem `CREATEROLE`), **dono da base `eurolify`** (só o dono retira o `TEMPORARY` ao `PUBLIC`; a migração 0001 pára se não conseguir) e, por isso, do esquema `public`. **As palavras-passe nunca passam pelo repositório:** o script gera a do migrador com `openssl rand`, dá-a ao PostgreSQL por stdin (sem ir para o registo da base) e escreve ele próprio o `/etc/eurolify/migrar.env` (`600 root`), que só o contentor das migrações recebe (revisão do #43, P1-4 e P2-6 do `36e8778`). **O `api.env` continua vazio** e o `eurolify_api` sem acesso até a API usar a base (fatia «identidade»; fechado por omissão). A ligação escreve-se `CHAVE=valor`, sem aspas nem espaços. O contentor das migrações corre com as mesmas protecções da API (`--cap-drop ALL`, `no-new-privileges`, `--memory`). Sem a ligação, o `migrar.js` tolera a **falta** da variável até 31/10/2026 (data de fim confirmada pelo Diogo a 04/10/2026, `src/base/url-migracao.ts`); uma variável vazia é erro |

**Testes que têm de falhar** (`observability-security`): ler, alterar e criar
num comerciante com o contexto de outro; ler sem contexto; o `eurolify_api`
com `BYPASSRLS` ou superutilizador; uma tabela nova sem `FORCE ROW LEVEL
SECURITY` (teste que percorre o catálogo da base).

## 6. Migrações

| Peça | Desenho |
|---|---|
| Formato | SQL à mão, numerado (`0001_comerciante.sql`), pelo migrador do Kysely (ADR-0025). O Kysely 0.29.6 corre **todas as migrações em falta numa só transacção**, com um bloqueio consultivo: se a 0002 falhar, a 0001 também se desfaz (revisão do #43, P2-4) |
| Ordem | só para a frente; nunca se edita uma migração já no `main` |
| Compatibilidade | a publicação migra **antes** de trocar a versão e, se falhar, fica a anterior (`eurolify-publicar:109-122`): cada migração tem de funcionar com a versão anterior da API ainda a correr |
| Cópia | antes de migrar no ensaio, a cópia diária já existe (ADR-0027); a reposição foi provada só com a base vazia (memória da sessão de 04/10/2026) |
| Teste | o CI aplica todas as migrações numa base vazia e corre os testes de isolamento |

## 7. Eventos

`merchant.created`, `merchant.status_changed` (de, para), `legal_entity.created`,
`store.created` — nomes no passado, mínimo de dados (`platform-architect`).
Acrescentados à tabela de eventos da skill `platform-architect` e ao `docs/02` (P7).

## 8. Lista da API (Administração)

Só existe com autenticação (fatia «identidade», P1). Até lá, **nenhum endpoint
desta fatia fica exposto**: o código da fatia 2 é o esquema, o RLS, o acesso
interno e os testes.

Todas as escritas (`POST`, `PATCH`) levam `Idempotency-Key`; a mesma chave
com outro corpo dá erro (`headless-commerce`, regra 5; `platform-architect`,
regra 6; auditoria `docs/16`).

| Operação | Método e caminho | Quem | Notas |
|---|---|---|---|
| Registar comerciante | `POST /merchants` | pessoa autenticada sem comerciante | nasce em `rascunho` |
| Ver o próprio | `GET /merchants/me` | equipa do comerciante | |
| Alterar | `PATCH /merchants/me` | dono | com `versao` |
| Pedir activação | `POST /merchants/me/activation-requests` | dono | `rascunho → prova_pendente` ou `em_revisao` |
| Entidades legais | `GET`, `POST /legal-entities`, `PATCH /legal-entities/{id}`, `POST /legal-entities/{id}/archive` | dono | número fiscal único por país no comerciante |
| Lojas | `GET`, `POST /stores`, `PATCH /stores/{id}`, `POST /stores/{id}/archive` | dono, gestor | |
| Aceitar contrato | `POST /agreements` | dono | tipo e versão; só se acrescenta |
| Provas | `GET /verifications`, `POST /verifications` (documento) | dono | |
| Linha do tempo | `GET /merchants/me/timeline` | equipa | |
| Exportar tudo | `POST /exports` | dono | Data Act; o que existe em todos os domínios |
| Fechar | `POST /merchants/me/close` | dono | `fechado`; não apaga documentos fiscais |
| Rever (equipa do Eurolify) | `POST /admin/merchants/{id}/review` | equipa do Eurolify | P6 |

Erros (proposta): `merchant.invalid_transition`, `merchant.version_conflict`,
`legal_entity.tax_number_duplicate`, `legal_entity.country_not_supported`,
`agreement.version_unknown`.

## 9. Perguntas — decididas pelo Diogo, 04/10/2026

Todas aceites tal como propostas. A P1 decide só a forma: a identidade é uma
fatia própria com ADR, e um fornecedor de fora só entra se for na UE e com
acordo de tratamento — **qual** (construir ou fornecedor) decide-se nesse ADR.

| # | Pergunta | Decisão |
|---|---|---|
| P1 | Identidade: construímos o OAuth 2.1/OIDC ou usamos um fornecedor **na UE**? Decide quem é o «dono» e quando a API desta fatia abre | fatia própria a seguir a esta, com ADR; fornecedor só na UE e com acordo de tratamento (`AGENTS.md`, regra 4). **Desenho: `docs/19`** (issue #107, 06/10/2026) |
| P2 | O que pode um comerciante `aprovado_limitado`? | vender só em modo de ensaio, sem dinheiro real |
| P3 | Que verificação se exige para activar? (número fiscal pelo VIES, certidão do registo comercial…) | número fiscal com prova (manual ou VIES) e aceitação dos dois contratos; o resto, por país, **C** até jurista |
| P4 | Os registos fiscais (OSS, IOSS, outros países) ficam no Motor de IVA? | sim; a entidade legal referencia-os |
| P5 | O campo `plano` entra já, sem preços? | não: entra com a D-14 |
| P6 | A equipa do Eurolify revê comerciantes como, antes do Hub? | sem papel entre comerciantes até haver Hub; a revisão faz-se por um comando auditado na API |
| P7 | Acrescentar os quatro eventos (§7) à skill `platform-architect` e ao `docs/02`? | sim |

## 10. Por onde é que isto ainda pode sair errado

- **Um `SET LOCAL` esquecido** — com a política de §5 dá erro em vez de vazio;
  o risco que fica é um acesso feito com o utilizador errado (o teste de
  `BYPASSRLS` é a trava).
- **O CI testar como superutilizador** e tudo passar sem o RLS ter sido posto
  à prova — por isso os testes de isolamento usam o `eurolify_api`.
- **Uma migração incompatível com a versão anterior** — a publicação já migrou
  quando a troca falha.
- **O contexto é escolhido pela aplicação**: o `eurolify_api` pode pôr
  qualquer uuid no `SET LOCAL`. É a fatia «identidade» que tem de ligar o
  contexto à sessão autenticada — até lá, nenhum endpoint usa a base (revisão
  do #43).
- **A activação só é verificada na transição para `activo`** (revisão do #43,
  P2-2): depois de activo, uma prova que expira, uma nova prova recusada ou uma
  entidade arquivada não fazem o comerciante sair de `activo`. A janela abre
  uns milissegundos antes: a verificação lê as entidades, as provas e os
  contratos sem os trancar, e uma entidade nova ou uma prova recusada que
  entrem **ao mesmo tempo** que a activação passam as duas (terceira revisão
  do #43, P2-4; não medido). Quem reage a isso é um trabalho periódico ou a
  fatia de verificação — por fazer; até lá, não há comerciantes reais na base.
- **Tabelas temporárias com o nome das verdadeiras** desviavam o rasto ou a
  verificação de activação: as funções têm `search_path` fixo com `pg_temp` em
  último, os nomes vão com `public.` e o `PUBLIC` perde `TEMPORARY` na base
  (revisão do #43, P1-A).
- **Uma loja activa a vender por uma entidade arquivada** — a base recusa nos
  dois sentidos (`legal_entity.in_use`, `store.legal_entity_archived`; P1-B/C),
  também em concorrência (`FOR SHARE` na entidade), e uma entidade arquivada
  não volta a activa (`legal_entity.archived_is_final`, §4).
- **Bloqueio mútuo (deadlock) ao registar prova e arquivar na mesma
  transacção**: o `FOR SHARE` da prova (e o da loja) tranca a entidade; duas
  transacções que registem prova na mesma entidade e depois a arquivem dão
  `40P01` numa delas (medido na revisão do `3e43cbc`, P2-2). Hoje não acontece:
  cada função do repositório é uma transacção. Uma operação futura que faça as
  duas coisas tranca primeiro a entidade (`SELECT … FOR UPDATE`) ou repete a
  transacção em `40P01`.
- **A versão em vigor dos contratos** não existe ainda (`compliance-gaps.md`
  G11): a activação aceita qualquer versão aceite de cada tipo.
- **A API com a ligação do dono das tabelas** se a ligação do migrador for
  para o `api.env` — por isso vai no `migrar.env`, que só o contentor das
  migrações recebe (§5).
- **Decidir identidade pelo nome** num registo de comerciantes — o número
  fiscal é único por país dentro do comerciante, nunca entre comerciantes
  (dois comerciantes podem ter a mesma empresa? **não verificado**; fica para a
  P3).
