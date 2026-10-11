# Rasto de auditoria comum: o que mudou, quem, de onde, com que IA, quem autorizou

> **Versão de 10/10/2026.** O que o rasto tem de responder foi decidido pelo
> Diogo a 10/10/2026 (`docs/06`, DK). **Desenho aprovado** pelo Diogo a
> 10/10/2026 (*«aprovado»*), com as quatro propostas da §5. O código entra
> por domínio, em pedidos pequenos, pela ordem da §4.
>
> Skills seguidas: `observability-security` (registo de auditoria imutável),
> `eu-gdpr-privacy` (minimização, dados pessoais fora dos registos),
> `platform-architect` (linha do tempo de cada registo, uma regra num sítio),
> `headless-commerce` (identificador do pedido, MCP) e `eurolify-legal-evidence-eu`.

## 1. O que o rasto responde (decisão do Diogo, 10/10/2026)

| # | Pergunta | O que tem de ficar |
|---|---|---|
| R1 | **O que mudou** | o comerciante, o registo (entidade e identificador), os campos alterados e os valores antes e depois, **protegendo os dados sensíveis** |
| R2 | **Quem executou** | pessoa, aplicação ou automatismo, com o **identificador autenticado** |
| R3 | **De onde veio** | Hub, API, importação, integração ou MCP, com o **identificador do pedido** |
| R4 | **Participação de IA** | fornecedor, modelo e execução, quando disponíveis; distinguir **comprovado**, **declarado** e **desconhecido** |
| R5 | **Quem autorizou** | a pessoa que confirmou a acção, **separada** da IA ou da aplicação que a executou |
| R6 | **Quando e porquê** | data em UTC, motivo e ligação à operação de origem |

## 2. O que já existe (lido no código a 10/10/2026)

Contado com `grep -n "CREATE TABLE" apps/api/migracoes/*.sql` e a leitura de
cada tabela; `eurolify.quem` e `eurolify.origem` são as variáveis da
transacção que os gatilhos lêem.

| Domínio | Tabela do rasto | R1 | R2 | R3 | R4 | R5 | R6 |
|---|---|---|---|---|---|---|---|
| Comerciante | `transicao_estado` (0001; imutável pela 0008) | só o estado (`de`, `para`) | `quem` (texto) | — | — | — | `quando`, `motivo` |
| Catálogo | `alteracao_catalogo` (0033) | campos antes e depois, só os que mudaram | `quem` obrigatório | `origem` opcional (ex.: `importacao:imp_…`) | — | — | `em`, `transacao`; sem motivo |
| Clientes | `alteracao_cliente` (0037) | campos antes e depois, **com dados pessoais em claro** (ex.: e-mail, NIF) | `quem` obrigatório | `origem` opcional | — | — | `em`, `transacao`; sem motivo |
| Preços | `historico_preco` (0017) | o preço praticado | sim | — | — | — | sim |
| Contas de pessoas | `evento_conta` (0018) | o acto | sim | — | — | — | sim |
| Pagamentos | `transicao_pagamento` (0044) | o estado | `quem` | `origem` **obrigatória** | — | — | sim |
| Stock e encomendas | `transicao_encomenda` (0047) | o estado | `quem` | sem `origem` (conferido a 10/10/2026, `base/esquema.ts`); desde a 0053, `canal` e `pedido` | — | — | sim |
| Eventos para fora | `evento_saida` (0021) | o evento | só interno (CH: não sai nos webhooks) | — | — | — | sim |
| Documentos fiscais | `documento_rasto` (0050) | o passo e o estado | `quem` | — | — | — | `em`, `motivo` |

**Desde o passo 2 (migração 0053, #334):** as oito tabelas do rasto acima,
menos o `evento_saida`, têm as colunas `canal`, `pedido`, `ia`,
`autorizado_por` e `motivo`, preenchidas por um só gatilho
(`rasto_completar()`) a partir de `contexto_do_rasto()`. As linhas de antes
ficam vazias («desconhecido»). Um motivo com mais de 500 caracteres corta-se,
não se recusa.

**Fora do rasto, de propósito:** `evento_saida` (são os eventos que saem, não
alterações), `movimento_stock`, `pedido_titular`, `consentimento`,
`validacao_vies` e `diferenca_pagamento` — são o próprio registo do domínio,
já com quem e quando, e só se acrescentam. Entram no rasto se um domínio o
pedir. As declarações de consentimento e os pares de duplicados têm, além
disso, uma linha na linha do tempo dos Clientes (`alteracao_cliente`, 0042 e
0046), que segue as regras do rasto.

**Já certo em todos:** só se acrescenta (os gatilhos recusam UPDATE, DELETE e
TRUNCATE, também ao dono) e o `quem` é obrigatório onde há gatilho.

**Falta:**
- R3 sem o identificador do pedido;
- R4 em lado nenhum;
- R5 em lado nenhum (hoje, uma chave usada por um agente de IA e a pessoa
  que mandou fazer confundem-se no mesmo `quem`);
- o motivo e a ligação à operação fora do Comerciante e dos Pagamentos;
- os dados pessoais em claro no rasto dos Clientes, contra a minimização
  (`eu-gdpr-privacy`).

## 3. O desenho

### 3.1 Um contexto por transacção, igual em todos os domínios

A API põe, no início de cada transacção que escreve, as variáveis abaixo
(`set_config(…, true)`, só nessa transacção, como já faz com o
`eurolify.quem`). Os gatilhos do rasto de cada domínio lêem-nas e gravam-nas
nas mesmas colunas. **Uma regra, um sítio:** uma função da base,
`contexto_do_rasto()`, devolve o contexto validado, e todos os gatilhos a
usam.

| Variável | Conteúdo | Exemplo |
|---|---|---|
| `eurolify.quem` (já existe) | o actor autenticado: `pessoa:per_…`, `chave:key_…`, `sistema:<tarefa>`, `operador:github:<n>` | `chave:key_01…` |
| `eurolify.canal` | `hub`, `api`, `importacao`, `integracao`, `mcp`, `sistema`, `operador` | `api` |
| `eurolify.pedido` | o identificador do pedido HTTP (o `instance` dos erros RFC 9457) ou da tarefa | `req-8f2…` |
| `eurolify.origem` (já existe) | a operação de origem, quando há: `importacao:imp_…`, `checkout:chk_…`, `fusao:fus_…` | `importacao:imp_42` |
| `eurolify.motivo` | o motivo, quando a operação o tem (obrigatório onde o domínio o exige, como hoje no Comerciante) | `pedido do titular` |
| `eurolify.autorizado_por` | a pessoa que confirmou: `pessoa:per_…`, ou vazio | `pessoa:per_…` |
| `eurolify.ia` | JSON: `{fornecedor, modelo, execucao, prova}`, ou vazio | ver §3.3 |

### 3.2 Quem executou e quem autorizou (R2, R5)

- **Quem executou** é sempre o autenticado: a sessão da pessoa no Hub, a chave
  na API, a tarefa no sistema. Nunca vem do corpo do pedido.
- **Quem autorizou** só se grava quando há prova de que uma pessoa confirmou.
  Exemplos: a confirmação em dois passos do MCP (ADR-0033); uma pessoa que
  aprova, no Hub, uma proposta feita por uma IA (como a revisão das traduções
  de IA, `docs/06` CO); a fusão de clientes decidida por uma pessoa. Quando a
  pessoa executa ela própria, fica igual ao `quem`.
- Uma chave de API **não** autoriza: se um agente usa uma chave, o rasto diz
  quem executou (a chave) e deixa «autorizado por» vazio, salvo prova.

### 3.3 A IA (R4)

| `prova` | Quando | O que se grava |
|---|---|---|
| `comprovado` | o próprio Eurolify chamou o modelo (ex.: uma tradução proposta por IA feita pelo Eurolify) | fornecedor, modelo e o identificador da execução que o fornecedor devolveu |
| `declarado` | quem chama diz que é uma IA, num cabeçalho próprio do pedido (`Eurolify-IA: fornecedor=…; modelo=…; execucao=…`) | o que foi declarado, tal como veio, **sem o dar por verdadeiro** |
| `desconhecido` | nada indica se houve IA | nada: o campo fica vazio, e o Hub mostra «desconhecido», nunca «sem IA» |

Uma chave pode ser marcada, ao criar, como «chave de um agente de IA». Os
pedidos dessa chave ficam com a IA `declarado` mesmo sem o cabeçalho, com
fornecedor e modelo desconhecidos se não vierem.

**Em código desde o passo 4, parte 1 (migração 0057, #322):** a coluna
`chave_api.agente_ia` (falsa nas chaves de antes; só na de servidor; não
muda), o campo `agente_ia` no `POST /keys`, no `POST /hub/keys`, nas listas e
no `GET /me`, e a autenticação a pôr `{"prova": "declarado"}` quando a chave
é de um agente e o pedido não traz o cabeçalho. Uma chave de um agente só
cria chaves de um agente (senão bastava criar uma chave sem marca para deixar
de aparecer como IA). O cabeçalho em si já estava desde o passo 1
(`base/rasto.ts`). **A IA `comprovado` fica por fazer:** o Eurolify não chama
nenhum modelo hoje (procurados os nomes de fornecedores no código da API a
10/10/2026, sem resultados).

### 3.4 Dados sensíveis no «antes e depois» (R1)

Os campos com dados pessoais, ou secretos, não guardam o valor em claro no
rasto. Guardam um marcador:
`{"alterado": true, "resumo_antes": "<8 hex>", "resumo_depois": "<8 hex>"}`.
O resumo é um HMAC-SHA-256 truncado, com uma chave da plataforma, e serve só
para ver se dois valores eram iguais.

A lista dos campos sensíveis é uma tabela da base, por domínio e campo, e não
uma lista no código de cada gatilho. Proposta inicial (**Q1**):
- Clientes: nome, e-mail, telefone, moradas, NIF, data de nascimento e notas.
- Contas de pessoas: e-mail e nome.
- Nenhum segredo (resumos de chaves, convites e sessões) entra, nem marcado.

Os valores que não são pessoais (preços, estados, SKU, nomes de artigos)
continuam em claro, como hoje.

**Em código desde o passo 3 (migração 0054, #322):** a lista é a tabela
`campo_sensivel` (por rasto, entidade e campo): a Q1, mais o país da morada e
do contribuinte do perfil, o contacto de uma declaração de consentimento e o
motivo escrito à mão de um par de duplicados (revisão do #340). A chave é
gerada dentro da base, só o dono a lê e não muda (`chave_do_rasto`); o
resumo leva o comerciante e o campo, para o mesmo valor não se ligar entre
comerciantes. Para não mudar o contrato da linha do tempo, a forma
`{antes, depois}` mantém-se e cada valor sensível passa a
`{"protegido": true, "resumo": "<8 hex>"}`; um valor que não existia (nulo,
lista vazia, texto vazio) fica como está. As Contas de pessoas não guardam
valores no rasto (só o acto): nada a marcar aí, por agora. A língua e o país
da ficha não são da Q1 e ficam em claro. Os perfis usados em documentos
também ficam com o marcador na linha do tempo (Diogo, 10/10/2026: *«sim»*,
à pergunta sobre a R9 do `docs/23`): a prova fiscal é a cópia no documento.

### 3.5 Quando e porquê (R6)

- **Quando:** `em timestamptz` (guardado em UTC; o Hub mostra-o na hora de
  quem vê, como já faz).
- **Porquê:** o motivo, obrigatório onde o domínio o exige.
- **Ligação:** a `origem` e a `transacao`, para juntar as linhas da mesma
  operação.

### 3.6 «Sem autorização de uma pessoa» (Q3, Q5)

**Regra (Diogo, 11/10/2026, Q5):** o aviso aparece em **toda** a alteração
sem uma pessoa registada como quem autorizou (`autorizado_por` vazio),
seja qual for a origem: um agente, uma chave sem marca, uma regra, uma
importação ou uma tarefa agendada (as linhas sem contexto: Q8, abaixo). Não
depende de a IA ser declarada: senão bastava não a declarar para a
alteração parecer autorizada.

Exemplo: «Preço de Verniz Gel Vermelho 15 ml: 12,90 € → 9,90 € —
12/10/2026 03:00 — sem autorização de uma pessoa (agente Preços)».

**Linhas sem contexto (Q8, Diogo, 11/10/2026):** uma linha sem `canal` —
de antes de 10/10/2026 (0053) ou escrita fora de um pedido — não diz «sem
autorização de uma pessoa» mas **«autorização desconhecida»**
(`sem_autorizacao_de_pessoa: null`): não se sabe se alguém autorizou e não
se afirma o que não se sabe (RGPD, art. 5.º, n.º 1, al. d), «exatidão», e
n.º 2, «tem de poder comprová-lo»; lidos a 11/10/2026 no texto oficial,
**W**). «Desconhecida» também nunca parece autorizada. Tudo o que entra por
um pedido à API ou ao Hub tem canal: uma chave ou um agente nunca cai aqui.
Ex.: «Preço de Verniz Gel Vermelho 15 ml: 12,90 € → 9,90 € — 09/10/2026 —
autorização desconhecida».

**Onde vive a regra:** na API (uma regra, um sítio). Cada entrada das linhas
do tempo ganha `sem_autorizacao_de_pessoa: true|false`, calculado no
servidor por `autorDoRasto()` (§4, parte 3); o Hub mostra-o, não o
recalcula.

### 3.7 O trabalho feito mais tarde, a pedido de alguém (Q6)

**Regra (Diogo, 11/10/2026, Q6):** uma tarefa diferida guarda o pedido de
origem e herda o estado de autorização dele. Se o pedido não teve
autorização de uma pessoa, a tarefa também mostra «sem autorização de uma
pessoa». No histórico, quem fez aparece como «sistema, a pedido do agente
X (pedido n.º …)», nunca só «sistema».

As tarefas diferidas hoje (lido a 11/10/2026): `tarefa_pagamento` (0044),
`tarefa_encomenda` (0047) e `tarefa_documento` (0050). Escrevem-nas
gatilhos da base, na transacção que as agenda; correm-nas o servidor
(`servidor.ts`, canal `sistema`, `pedido = tarefa:<nome>`).

**Como (proposta técnica):**
- Cada tabela de tarefas ganha a origem de quem a agendou: o pedido, quem
  pediu, quem autorizou e a IA. Põe-nos um só gatilho, ao inserir ou
  reagendar, a partir de `contexto_do_rasto()` — o código não os escolhe.
  Se quem agenda já é uma tarefa com origem, passa a origem dela (uma cadeia
  de tarefas não perde o pedido inicial).
- Ao correr uma tarefa, o servidor põe o contexto: canal `sistema`, pedido
  `tarefa:<nome>`, e a origem guardada — `autorizado_por` e `ia` **herdados**
  e o pedido e quem pediu numa variável nova (`eurolify.a_pedido_de`).
- As tabelas do rasto ganham a coluna `a_pedido_de` (`{pedido, quem}`),
  preenchida pelo gatilho comum (`rasto_completar()`), e as linhas do tempo
  devolvem-na.
- Uma tarefa sem pedido de origem (agendada antes desta mudança, ou por algo
  que não é um pedido, como o aviso de um prestador de pagamentos) mostra
  «sistema, tarefa <nome>, sem pedido de origem registado» — nunca só
  «sistema» — e o aviso «sem autorização de uma pessoa».

Fontes da regra, lidas a 11/10/2026 no texto oficial (Serviço das
Publicações da UE, a fonte do EUR-Lex, `publications.europa.eu/resource/celex/…`):
- **Dir. 98/6/CE, art. 6.º-A** (versão consolidada de 28/05/2022): «Qualquer
  anúncio de redução de preço indica o preço anteriormente praticado» (n.º 1),
  o mais baixo de um período «não […] inferior a 30 dias» (n.º 2); os
  Estados-Membros podem mudar o período nos n.ºs 3 a 5. **W** para o texto da
  UE; a transposição portuguesa e a de cada país **não verifiquei** (**C**,
  jurista, como no `docs/03`). Que o histórico tenha de dizer *quem* mudou e
  a pedido de quem é inferência nossa (**M**): o artigo pede o preço, e o
  rasto completo é o que permite prová-lo.
- **RGPD, art. 5.º, n.º 2**: o responsável «tem de poder comprová-lo»
  («responsabilidade»). **W**.

### 3.8 O histórico de um preço, em dois níveis (Q7)

**Regra (Diogo, 11/10/2026, Q7):**
- Com `prices:read` continua a ver-se o histórico: o preço, a data, o
  **tipo de autor** (pessoa, agente, chave, sistema a pedido de alguém) e o
  aviso «sem autorização de uma pessoa». Não identifica ninguém.
- **Quem** mudou e **quem** autorizou passam a pedir um âmbito próprio,
  `prices:history`, dado aos mesmos papéis que o `catalog:history` do
  Catálogo (o dono e o gestor).
- O histórico de preços não se edita: é a prova do preço anterior para o
  art. 6.º-A (o `historico_preco` já só se acrescenta, 0017).
- Em código (parte 3, #349): com `prices:read` vêm também o `canal` e a
  `ia` (fornecedor, modelo, execução). Não identificam pessoas, mas vão além
  do texto da Q7 (**M**, aplicação nossa; revisão do #349, P3-2). O «sistema,
  a pedido de alguém» só existe com a parte 4.
- **Condição para os webhooks:** o evento `price.changed` leva `quem`
  (0021). Hoje os eventos não saem para fora (§2, `evento_saida`); quando
  saírem, um subscritor só com `prices:read` não pode receber o `quem`
  (revisão do #349, P3-1).

Fontes, lidas a 11/10/2026 no texto oficial do RGPD (Reg. (UE) 2016/679,
`publications.europa.eu/resource/celex/32016R0679`), **W**:
- art. 5.º, n.º 1, al. c): dados «limitados ao que é necessário» («minimização
  dos dados»);
- art. 25.º, n.º 2: «por defeito, só sejam tratados os dados pessoais que
  forem necessários para cada finalidade», o que vale também para a sua
  «acessibilidade»;
- art. 32.º, n.º 1, al. b) e n.º 2: a confidencialidade e o risco de «acesso
  não autorizados»; n.º 4: quem age sob a autoridade do responsável só trata
  dados segundo as instruções dele.

Que *quem mudou um preço* deva ficar atrás de um âmbito próprio é a nossa
aplicação destes artigos (**M**), decidida pelo Diogo (Q7).

## 4. Como entra no código (por esta ordem, cada passo com a revisão de um agente)

1. A função `contexto_do_rasto()` e as variáveis, lidas pela API num só sítio
   (o pedido autenticado), com testes.
2. As colunas novas nas tabelas do rasto que já existem (Catálogo, Clientes,
   Pagamentos, Encomendas, Comerciante), sem passado inventado: as linhas
   antigas ficam com «desconhecido».
3. Os dados sensíveis marcados (§3.4), começando pelos Clientes, e os
   valores em claro que já estão no rasto passados a marcador (**Q2**).
4. O cabeçalho `Eurolify-IA`, a marca «chave de um agente de IA» e o Hub a
   mostrar o rasto com as seis respostas.

**Passo 4 em código, por partes:**
- **parte 1** (#342, migração 0057): a marca «chave de um agente de IA» (§3.3);
- **parte 2** (#345): as linhas do tempo da API trazem, além de `quem`, `em` e `campos`, os campos `canal`, `pedido`, `ia`, `autorizado_por` e `motivo`, pelo mesmo esquema e função (`base/rasto-resposta.ts`), em: o artigo (`GET /products/{id}/timeline` e `GET /hub/products/{id}/timeline`), a ficha de cliente (`GET /customers/{id}/timeline`), a encomenda (`GET /orders/{id}/timeline`), as transições de um pagamento (`GET /payments/{id}`) e o rasto de um documento (`GET /invoices/{id}`). A `ia` vem sempre, com `prova` `comprovado`, `declarado` ou **`desconhecido`** (nunca «sem IA»; com `desconhecido`, o resto da IA vem vazio). `canal` vazio é desconhecido: uma linha de antes da 0053, **ou uma escrita sem o contexto do rasto** (ex.: uma tarefa chamada fora do servidor); então tudo o resto é desconhecido. `autorizado_por` vazio com `canal` preenchido: nenhuma pessoa do comerciante confirmou (uma chave, o operador e as tarefas nunca autorizam; uma sessão do Hub com IA declarada também não). A lista dos canais é uma só (`CANAIS`, `base/rasto.ts`), conferida por teste com a da base. A exportação do titular já levava estas colunas (lê a tabela inteira). **Fica de fora:** o histórico de um preço (`GET /price-lists/{id}/prices/{variante}/history`) não mostra hoje quem mudou, e a rota pede só `prices:read`; acrescentar quem autorizou mudaria quem vê quem — decidir o âmbito antes (como o `catalog:history` do Catálogo). O estado do comerciante (`transicao_estado`) e as contas de pessoas (`evento_conta`) não têm rota de leitura;
- **parte 3** (#322, migração 0059): cada entrada das linhas do tempo ganha `tipo_de_autor` (pessoa, agente, chave, sistema, operador, desconhecido) e `sem_autorizacao_de_pessoa`, calculados na API (`autorDoRasto()`, §3.6). O histórico de um preço (`GET /price-lists/{id}/prices/{variante}/history`) passa a dar a todos com `prices:read` o tipo de autor, o aviso, o canal e a IA; `quem`, `autorizado_por`, `pedido` e `motivo` só vêm com `prices:history` (dono e gestor), e sem ele **não vêm** (nunca vazios a fingir que ninguém) (§3.8). O «sistema, a pedido de…» das tarefas fica para a parte 4;
- **parte 4** (#322, migração 0060): as tarefas de pagamentos, encomendas e documentos guardam a `origem` de quem as agendou (`{a_pedido_de: {pedido, quem}, autorizado_por, ia}`), posta por um gatilho a partir do contexto; ao correr, a API põe o contexto da tarefa com a origem **herdada** (`contextoDaTarefa()`, `base/rasto.ts`). As tabelas do rasto ganham `a_pedido_de`, e as linhas do tempo devolvem-no com `a_pedido_de_tipo` (ex.: `sistema` a pedido de `agente`). Regras: só há origem com um pedido (um `quem` sem pedido não é origem); ao reagendar sem origem no contexto, fica a que havia; ao reagendar a partir de outro pedido, fica a desse pedido (a de quem agendou por último). No histórico de preços, `a_pedido_de` só com `prices:history`; `a_pedido_de_tipo` para todos;
- **parte 5**: o Hub a mostrar as seis respostas (desenho e aspecto a aprovar pelo Diogo).

## 5. Perguntas para o Diogo ou o Bruno

| # | Pergunta | Proposta |
|---|---|---|
| Q1 | A lista dos campos sensíveis da §3.4 serve para começar? | ✅ **Decidido** (Diogo, 10/10/2026): sim, a da §3.4 |
| Q2 | Os valores pessoais que **já** estão em claro no rasto dos Clientes (ensaio, só dados de teste) ficam ou passam a marcador? | ✅ **Decidido** (Diogo, 10/10/2026): passam a marcador numa migração, porque o rasto só se acrescenta, excepto nessa migração revista (o ensaio não tem dados reais, ADR-0019) |
| Q3 | Uma acção de uma IA sem nenhuma pessoa a autorizar (ex.: um agente com chave a mudar preços) é aceite, ou exige sempre «autorizado por»? | ✅ **Decidido** (Diogo, 10/10/2026): aceite na Fase 1, como hoje, mas o Hub mostra-a como «sem autorização de uma pessoa». Exigir passa a ser uma regra por âmbito, decidida depois |
| Q4 | Quanto tempo se guarda o rasto? | ✅ **Decidido** (Diogo, 10/10/2026): por decidir com o jurista e o contabilista (**C**; os 10 anos fiscais, `eu-gdpr-privacy`); até lá, não se apaga |
| Q5 | O aviso «sem autorização de uma pessoa» aparece em todas as alterações sem pessoa a autorizar, ou só com IA declarada? | ✅ **Decidido** (Diogo, 11/10/2026): em **todas**, seja qual for a origem (agente, regra, importação, tarefa agendada); a lei não liga este aviso à IA — o art. 50.º do Regulamento IA trata de quem fala com uma IA ou recebe conteúdo gerado, não de alterações internas (`docs/03`, **W**). §3.6 |
| Q6 | O trabalho feito mais tarde a pedido de um agente aparece ligado ao pedido dele? | ✅ **Decidido** (Diogo, 11/10/2026): sim; a tarefa guarda o pedido de origem e herda a autorização; aparece «sistema, a pedido do agente X (pedido n.º …)», nunca só «sistema». §3.7 |
| Q7 | Que âmbito pede o histórico de preços com as seis respostas? | ✅ **Decidido** (Diogo, 11/10/2026): dois níveis — `prices:read` vê o tipo de autor e o aviso; quem mudou e quem autorizou pedem `prices:history` (os papéis do `catalog:history`). §3.8 |
| Q8 | Uma linha sem contexto (de antes de 10/10/2026, ou escrita fora de um pedido) diz «sem autorização de uma pessoa» ou «autorização desconhecida»? | ✅ **Decidido** (Diogo, 11/10/2026: *«confirmo»*, à proposta com base no RGPD, art. 5.º): «autorização desconhecida» (`sem_autorizacao_de_pessoa: null`). §3.6 |

## 6. O que não foi verificado

- **Confirmar um palpite pela API (passo 3):** quem puder escrever fichas de
  um comerciante pode pôr um valor candidato numa ficha e comparar o resumo
  com o de outra ficha do mesmo comerciante («o e-mail antigo era este?»).
  Cada tentativa fica no rasto, e não dá o valor, só confirma palpites. Pôr a
  ficha no resumo fechava isto, mas perdia-se a comparação entre fichas
  (útil nos duplicados). Fica como está até alguém decidir o contrário.

- O `transicao_encomenda` (0047) e o `historico_preco` (0017) foram lidos só
  pelo nome das colunas; se têm `origem`, falta conferir.
- ~~A forma exacta do identificador do pedido~~ conferida a 10/10/2026: o
  servidor gera-o com `randomUUID()` (`servidor.ts`) e os erros põem-no no
  `instance` (`base/erros.ts`); é o mesmo `pedido` do rasto.
- **O `motivo` nas linhas do Catálogo e dos Clientes vem da transacção**
  (`eurolify.motivo`, 0053): uma escrita de outro domínio na mesma
  transacção (pagamentos, documentos, stock põem um motivo) passava-o
  também a essas linhas, sem passar pela lista dos campos sensíveis (§3.4).
  Procurado a 10/10/2026 (revisão do #345, P3-1): nenhuma transacção põe um
  motivo e escreve também em `alteracao_cliente` ou `alteracao_catalogo`;
  não se seguiu cada caminho.
- Se o HMAC truncado a 8 hexadecimais chega para não deixar adivinhar valores
  curtos (ex.: um código postal). Para um valor de poucas hipóteses, mesmo com
  a chave secreta, um resumo igual diz que o valor não mudou. Fica para a
  revisão de segurança.
