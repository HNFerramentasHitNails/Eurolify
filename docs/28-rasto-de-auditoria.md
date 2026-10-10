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
| Stock e encomendas | `transicao_encomenda` (0047) | o estado | `quem` | por verificar | — | — | sim |
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

## 5. Perguntas para o Diogo ou o Bruno

| # | Pergunta | Proposta |
|---|---|---|
| Q1 | A lista dos campos sensíveis da §3.4 serve para começar? | ✅ **Decidido** (Diogo, 10/10/2026): sim, a da §3.4 |
| Q2 | Os valores pessoais que **já** estão em claro no rasto dos Clientes (ensaio, só dados de teste) ficam ou passam a marcador? | ✅ **Decidido** (Diogo, 10/10/2026): passam a marcador numa migração, porque o rasto só se acrescenta, excepto nessa migração revista (o ensaio não tem dados reais, ADR-0019) |
| Q3 | Uma acção de uma IA sem nenhuma pessoa a autorizar (ex.: um agente com chave a mudar preços) é aceite, ou exige sempre «autorizado por»? | ✅ **Decidido** (Diogo, 10/10/2026): aceite na Fase 1, como hoje, mas o Hub mostra-a como «sem autorização de uma pessoa». Exigir passa a ser uma regra por âmbito, decidida depois |
| Q4 | Quanto tempo se guarda o rasto? | ✅ **Decidido** (Diogo, 10/10/2026): por decidir com o jurista e o contabilista (**C**; os 10 anos fiscais, `eu-gdpr-privacy`); até lá, não se apaga |

## 6. O que não foi verificado

- **Confirmar um palpite pela API (passo 3):** quem puder escrever fichas de
  um comerciante pode pôr um valor candidato numa ficha e comparar o resumo
  com o de outra ficha do mesmo comerciante («o e-mail antigo era este?»).
  Cada tentativa fica no rasto, e não dá o valor, só confirma palpites. Pôr a
  ficha no resumo fechava isto, mas perdia-se a comparação entre fichas
  (útil nos duplicados). Fica como está até alguém decidir o contrário.

- O `transicao_encomenda` (0047) e o `historico_preco` (0017) foram lidos só
  pelo nome das colunas; se têm `origem`, falta conferir.
- A forma exacta do identificador do pedido no Fastify (o `instance` dos erros
  sai de `request.id`; não li se é o mesmo em todas as rotas).
- Se o HMAC truncado a 8 hexadecimais chega para não deixar adivinhar valores
  curtos (ex.: um código postal). Para um valor de poucas hipóteses, mesmo com
  a chave secreta, um resumo igual diz que o valor não mudou. Fica para a
  revisão de segurança.
