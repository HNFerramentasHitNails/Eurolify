# Tarefas das filas que pedem uma pessoa — modelo e lista da API

> **Estado: desenho, por aprovar** (issue #366). Pedido do Diogo, 11/10/2026:
> *«começa o desenho da peça 21»*. É a peça 21 da Fase 1 (`docs/10`, 2–4
> pessoas-semana, **C**), que veio dos módulos de gestão pela decisão DS
> ([ADR-0043](adr/0043-saidas-das-portas-dos-modulos-de-gestao.md), ponto 4;
> `docs/13` §10). O código só depois de aprovado (ADR-0023).
>
> Skills seguidas: `platform-architect` («Tarefas sobre um registo»: uma
> pessoa, um prazo, um estado; as filas criam tarefas; vencida ⇒ aviso; cada
> dado com um dono; listas de valores num sítio), `observability-security`
> (permissões em quatro camadas, rasto imutável, tarefas automáticas que não
> param em silêncio), `eu-gdpr-privacy` (minimização; a tarefa sobre um
> cliente entra na exportação e no apagamento do titular) e
> `eurolify-engineering-execution` (isolamento, concorrência, migrações,
> testes que falham sem a protecção). O ecrã segue as skills de desenho do Hub
> antes do código dele (§8).
>
> 🔴 **Regra desta peça:** a tarefa diz **quem decide e até quando**; **nunca
> decide**. A decisão continua no ecrã e na rota de cada fila, um caso de cada
> vez, nunca em lote (`AGENTS.md`, «Não se erra em documentos fiscais», regra
> 5). Uma tarefa não se fecha à mão: sai da lista quando o caso sai da fila.

## 1. O que entra nesta peça

| O quê | Fonte |
|---|---|
| uma **lista comum «A decidir»** com os casos das quatro filas que esperam por uma pessoa | `docs/13` §10, primeiro alvo |
| cada caso com **responsável, prazo e se está vencido** | `platform-architect`, «Tarefas sobre um registo» |
| **atribuir** (a mim ou a outra pessoa) e **mudar o prazo**, com motivo, no rasto | idem; `docs/28` |
| **aviso ao vencer**, uma vez: como evento e na lista; por e-mail quando houver envio de e-mails | `docs/13` §10, porta 7; regra 7 da `platform-architect` |
| a verificação de hora a hora, que não pára em silêncio | `observability-security`, «Tarefas automáticas» |

As quatro filas (`docs/13` §10, contadas a procurar «fila», «dono» e «só uma
pessoa» nos `docs/23`, `26`, `29` e `30`):

| Fila | Caso | Entra quando | Sai quando | Quem decide | Desenho |
|---|---|---|---|---|---|
| `pagamento` | diferença (`pdi_`) | abre uma diferença (incerto, aviso sem pagamento, montante ou moeda diferente…) | uma pessoa a resolve | `payments:resolve` (só o dono) | `docs/26` §3.6, §8.3 |
| `documento_fiscal` | pedido de documento (`inv_`) | fica `retido`, `incerto` para uma pessoa, ou `divergente` | sai desses estados (libertado, corrigido, reconciliado, resolvido) | `invoices:write` (dono e gestor; libertar e corrigir só o dono) | `docs/29` §4, §7.1, §12 |
| `duplicado_cliente` | par candidato (`dup_`) | o servidor sinaliza um par | uma pessoa descarta ou funde | `customers:merge` (dono e gestor) | `docs/23` §3.7, §13 |
| `prazo_reembolso` | devolução de livre resolução (`rma_`) | a devolução nasce de um pedido de livre resolução | o reembolso fica `executado`, ou a devolução fecha ou se cancela | `refunds:write` (dono e gestor) | `docs/30` §14 (A1) |

**Fora desta peça** (`docs/13` §10, «Ficam de fora»; camada E morta como
módulo pelo ADR-0043): tarefas livres sobre qualquer registo, recorrência,
delegação, cronómetro, projectos, notas na tarefa e o envio de e-mails (fatia
de Notificações).

## 2. O que já existe (lido no código a 11/10/2026)

*(a preencher com o mapa do código: as tabelas das quatro filas, o `dono` da
diferença, as tabelas `tarefa_*`, o aviso de hora a hora do prazo do
reembolso, o isolamento e os papéis.)*

## 3. O desenho escolhido: a lista lê as filas; a tarefa só guarda quem e até quando

Duas formas possíveis:

| Forma | A favor | Contra |
|---|---|---|
| **A. Uma tabela de tarefas com estado próprio**, criada e fechada por cada fila | Uma linha por tarefa, simples de listar | O estado do caso fica em dois sítios (na fila e na tarefa) e pode divergir: uma tarefa aberta de um caso já decidido, ou um caso sem tarefa, que **não aparece na lista** — o «parado em silêncio» que a peça quer evitar |
| **B. A lista lê os casos abertos de cada fila** e junta-lhes a atribuição (responsável e prazo), guardada à parte | O estado vive só na fila (`platform-architect`, regra 2: cada dado tem um dono). Um caso sem atribuição **aparece na mesma**, como «sem responsável». Nada a sincronizar | A lista junta quatro filas numa consulta; mede-se o tempo de resposta com volume (§9) |

**Proposta: B.** Cada fila expõe, como API interna do seu domínio, uma
função da base que devolve os seus casos abertos (identificador, quando
entrou na fila, motivo, a ligação ao registo). O domínio Tarefas não lê as
tabelas das filas: lê essas quatro funções. **Nenhum domínio escreve na tabela
do outro.**

## 4. Modelo

### 4.1 Caso aberto (o que cada fila devolve; não é uma tabela)

| Campo | O que é |
|---|---|
| `fila` | um de `pagamento`, `documento_fiscal`, `duplicado_cliente`, `prazo_reembolso` — a lista vive na base, num sítio só (regra 8) |
| `caso` | o identificador na fila (`pdi_`, `inv_`, `dup_`, `rma_`) |
| `entrou_em` | quando o caso entrou **nesta passagem** pela fila (um documento libertado que volta a ficar retido é uma passagem nova) |
| `motivo` | o motivo da fila, da lista de valores dela (ex.: `incerto`, `emissor_por_configurar`, `nif_particular`) — nunca dados pessoais |
| `prazo_legal` | só no `prazo_reembolso`: o último dia, da função que a pós-venda já usa (`posvenda_reembolsar_ate()`, 0063) |

### 4.2 Atribuição (`atr_`, a tabela nova)

| Campo | O que é | Fonte |
|---|---|---|
| `comerciante_id` | o inquilino; isolamento imposto pela base (RLS) | `platform-architect`, regra 3 |
| `fila`, `caso`, `entrou_em` | a passagem do caso a que se refere; **uma atribuição por passagem** (único) | — |
| `responsavel` | a pessoa (`per_`), ou vazio | — |
| `prazo` | `timestamptz`; vazio = o prazo por omissão da fila (§5, R4) | — |
| `aviso_vencido_em` | quando saiu o aviso de vencido; uma vez por prazo | R6 |
| `versao` | para duas pessoas a atribuir ao mesmo tempo | R7 |
| `criado_em`, `atualizado_em` | — | — |

Cada mudança (atribuir, tirar, mudar o prazo) fica no **rasto** comum, com o
contexto da transacção (`docs/28` §3.1: quem, canal, pedido, motivo, quem
autorizou, IA). Só se acrescenta.

**Não há estado guardado.** «Aberta», «vencida» e «sem responsável»
calculam-se: aberta = o caso está na fila; vencida = aberta e o prazo passou;
quando o caso sai da fila, a atribuição fica como histórico («quem tinha o
caso quando foi decidido») e deixa de aparecer na lista.

## 5. Regras

| # | Regra | Fonte |
|---|---|---|
| R1 | A tarefa **não decide nem fecha** o caso. Não há «marcar como feita»: o caso sai da lista quando sai da fila, pela rota da própria fila | `AGENTS.md`, fiscal, regra 5; `docs/13` §10 |
| R2 | **Vê** o caso quem pode ler a fila dele (`payments:read`, `invoices:read`, `customers:read`, `returns:read`); a lista nunca mostra um caso de uma fila que a pessoa não lê. Os números da lista dizem de que filas são | `observability-security`, quatro camadas |
| R3 | **Pode ser responsável** só quem pode decidir aquela fila (tabela da §1). Atribuir-se a si próprio pede essa permissão; atribuir a outra pessoa, ou tirar a atribuição, pede também `tasks:assign` (dono e gestor) | proposta |
| R4 | **Prazo por omissão** (proposta de funcionamento, **não é lei**): `pagamento` 1 dia depois de entrar; `documento_fiscal` 2 dias; `duplicado_cliente` 7 dias; `prazo_reembolso` **o prazo legal** (`prazo_legal`). O prazo para emitir uma fatura **não está escrito** nos documentos — fica para o contabilista (**C**, §11) | proposta |
| R5 | **Mudar o prazo** pede motivo e fica no rasto; não pode ficar no passado. No `prazo_reembolso` **não se muda**: é o prazo legal (**C**, J4 do `docs/30`) | `docs/30` §14 |
| R6 | **Vencido ⇒ um aviso**, uma vez por prazo: o evento `task.overdue` (para quem tem o caso e quem gere a equipa, pelos webhooks e, mais tarde, por e-mail) e a marca na lista. Mudar o prazo para depois volta a permitir um aviso. No `prazo_reembolso`, o aviso é o que já existe (`refund.deadline_approaching` e `refund.deadline_passed`, 0063): **não sai um segundo** | `platform-architect`, regra 7; uma regra num sítio |
| R7 | **Duas pessoas ao mesmo tempo:** atribuir e mudar o prazo levam a `versao`; a segunda recebe `tasks.version_conflict` e relê | `eurolify-engineering-execution` |
| R8 | **Quem sai da equipa ou perde a permissão** deixa de ser responsável dos casos abertos, na mesma transacção, com o rasto a dizê-lo; o caso volta a «sem responsável» e sai `task.unassigned` | proposta |
| R9 | **Uma passagem, uma atribuição.** Um caso que sai e volta à fila é uma passagem nova, sem responsável; a lista mostra quem o teve da última vez, para se reatribuir com um clique | proposta |
| R10 | A lista **nunca corta em silêncio**: paginação por cursor e o total por fila (lição 4.7: o «corte das 1.000» fez a pesquisa dizer «não existe» a 40 % das fichas) | `platform-architect`, anti-padrões |
| R11 | **Nenhuma IA nem o MCP atribuem**: o MCP de leitura (peça 12) pode listar «o que está por decidir», com as mesmas regras de R2 | ADR-0040; `docs/23` R10 |

## 6. Dados pessoais

- A atribuição guarda **só identificadores** (o caso, a pessoa da equipa) e o
  prazo; o motivo é um valor da lista da fila. **Nenhum dado do cliente** (nem
  nome, nem NIF, nem e-mail) — esses vêem-se no ecrã da fila, com as
  permissões dela.
- **Pedido do titular (exportação):** a atribuição não tem dados do cliente;
  o caso ao qual se liga é exportado pelo domínio dele (`docs/23` §… parte
  2c). **Proposta:** não entra na exportação.
- **Apagamento do titular:** uma ficha pseudonimizada não muda a atribuição
  (só tem o `dup_`); o par `dup_` segue a regra dos Clientes.
- **Dados da equipa:** o responsável é a pessoa da equipa do comerciante;
  quem sai da equipa fica no histórico das atribuições, como no rasto
  (`docs/28`).

## 7. Lista da API (Administração)

| Rota | Âmbito |
|---|---|
| `GET /tasks?fila=&responsavel=eu\|sem\|per_…&vencida=true&cursor=` — os casos abertos das filas que a pessoa lê, com o responsável, o prazo, `vencida`, o motivo e a ligação para o caso; o total por fila | o `read` de cada fila (R2) |
| `GET /tasks/{fila}/{caso}` — o caso aberto e o histórico das atribuições dele | idem |
| `POST /tasks/{fila}/{caso}/assign` `{ responsavel: per_… \| null, versao }` | a decisão da fila (R3); a outra pessoa ou `null` pede também `tasks:assign` |
| `POST /tasks/{fila}/{caso}/deadline` `{ prazo, motivo, versao }` | a decisão da fila + `tasks:assign` |

Âmbito novo: `tasks:assign` (dono e gestor). A rota usa `{fila}/{caso}` e não
um `atr_`, porque o caso sem atribuição também está na lista.

**Erros (novos):** `tasks.not_found` (o caso não está aberto, ou a pessoa não
lê a fila), `tasks.version_conflict`, `tasks.assignee_not_allowed` (a pessoa
não pode decidir a fila), `tasks.deadline_invalid` (no passado, ou no
`prazo_reembolso`), `tasks.reason_required`.

**Eventos** (na `evento_saida`; só identificadores, fila, prazo; nunca dados
pessoais): `task.assigned`, `task.unassigned`, `task.deadline_changed`,
`task.overdue`.

## 8. O ecrã «A decidir» no Hub (parte 2)

Uma lista com as quatro filas, o filtro «as minhas / sem responsável /
vencidas», e em cada linha a fila, o motivo, há quanto tempo está, o
responsável, o prazo e o botão para abrir o caso no ecrã da fila dele. **Os
ecrãs das filas ainda não existem no Hub** (a confirmar no §2) — a lista
abre-os quando existirem. O desenho do ecrã faz-se com as skills
`eurolify-design`, `eurolify-hub-modular` e `eurolify-hub-quality-gate`
antes do código dele.

## 9. Por onde é que isto ainda pode sair errado

| Risco | O que o trava |
|---|---|
| um caso parado sem ninguém o ver | §3, forma B: o caso aparece mesmo sem atribuição; R6 avisa ao vencer |
| a tarefa «feita» com o caso por decidir | R1: não há fecho à mão |
| alguém sem permissão fica responsável de um caso fiscal | R3, verificado na base; R8 quando perde a permissão |
| duas pessoas a atribuir o mesmo caso | R7 |
| dois avisos pelo mesmo prazo do reembolso | R6: no `prazo_reembolso` fica o aviso da pós-venda |
| a lista mostra um caso de outra fila ou de outro comerciante | R2 e o RLS; testes que tentam e têm de falhar |
| a lista corta e diz «nada por decidir» | R10 |
| a verificação de hora a hora pára | alerta se não correr (`observability-security`); um comerciante que falhe não pára os outros |
| a lista fica lenta com muitas encomendas | medir antes de pré-calcular (como no `docs/13` §11, porta 7) |
| uma fila nova da Fase 1 fica fora da lista | a lista de filas é um valor da base; uma fila nova acrescenta-se lá e na função dela |

## 10. Perguntas para o Diogo ou o Bruno

| # | Pergunta | Proposta |
|---|---|---|
| Q1 | Aprovas o desenho (a lista lê as filas, a tarefa só guarda quem e até quando; prazos por omissão de 1, 2 e 7 dias e o prazo legal no reembolso; atribuir a outros só dono e gestor)? | sim |

## 11. Por verificar

- **O prazo para emitir uma fatura** depois de uma venda (em Portugal e nos
  outros países): não está nos documentos; **não verifiquei**. Fica para o
  contabilista; até lá, os 2 dias do R4 são uma proposta de funcionamento.
- A estimativa (2–4 pessoas-semana, **C**), até à medida das 8 semanas
  (`docs/10` §6).
- O tempo de resposta da lista com volume.

## 12. Como entra no código (quando aprovado)

- **Parte 1:** a migração (a lista de filas, a função de cada fila, a
  atribuição com o RLS e o rasto, o âmbito `tasks:assign`), as rotas da §7, a
  verificação de hora a hora com o aviso, e os testes: outro comerciante,
  papel sem acesso a uma fila, responsável sem permissão recusado, duas
  pessoas ao mesmo tempo, quem sai da equipa, um caso que volta à fila, o
  aviso uma vez, o prazo do reembolso que não muda; mutações e a revisão do
  agente.
- **Parte 2:** o ecrã «A decidir» no Hub, desenhado primeiro.
- Cada parte num pedido, com os testes verdes e a revisão do agente antes de
  juntar (ADR-0031, ADR-0035).
