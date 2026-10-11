# Tarefas das filas que pedem uma pessoa — modelo e lista da API

> **Estado: desenho aprovado** (issue #366; `docs/06`, DW). Diogo, 11/10/2026:
> *«começa o desenho da peça 21»* e *«sim, aprovo o desenho com as sete
> filas»* (Q1 como proposta). É a peça 21 da Fase 1 (`docs/10`, 2,5–5
> pessoas-semana desde a aprovação, **C**; eram 2–4 com quatro filas), que veio dos módulos de gestão pela decisão DS
> ([ADR-0043](adr/0043-saidas-das-portas-dos-modulos-de-gestao.md), ponto 4;
> `docs/13` §10). O código só depois de aprovado (ADR-0023).
>
> Skills seguidas: `platform-architect` («Tarefas sobre um registo»: uma
> pessoa, um prazo, um estado; as filas criam tarefas; vencida ⇒ aviso; cada
> dado com um dono; listas de valores num sítio), `observability-security`
> (permissões em quatro camadas, rasto imutável, tarefas automáticas que não
> param em silêncio), `eu-gdpr-privacy` (minimização; exportação e apagamento
> do titular) e `eurolify-engineering-execution` (isolamento, concorrência,
> migrações, testes que falham sem a protecção). O ecrã segue as skills de
> desenho do Hub antes do código dele (§8).
>
> 🔴 **Regra desta peça:** a tarefa diz **quem decide e até quando**; **nunca
> decide**. A decisão continua na rota de cada fila, um caso de cada vez,
> nunca em lote (`AGENTS.md`, «Não se erra em documentos fiscais», regra 5).
> Uma tarefa não se fecha à mão: sai da lista quando o caso sai da fila.

## 1. O que entra nesta peça

| O quê | Fonte |
|---|---|
| uma **lista comum «A decidir»** com os casos das filas que esperam por uma pessoa | `docs/13` §10, primeiro alvo |
| cada caso com **responsável, prazo e se está vencido** | `platform-architect`, «Tarefas sobre um registo» |
| **atribuir** (a mim ou a outra pessoa) e **mudar o prazo**, com motivo, no rasto | idem; `docs/28` |
| **aviso ao vencer**, uma vez, como evento e na lista | `docs/13` §10, porta 7; regra 7 da `platform-architect` |
| a verificação de hora a hora, que não pára em silêncio | `observability-security`, «Tarefas automáticas» |

**As filas.** A decisão DS nomeou quatro. Ao ler o código (§2) apareceram mais
**três filas que também esperam por uma pessoa** e que a Fase 1 já cria.
**Proposta:** entram as sete (Q1).

| Fila | Caso | Está na lista enquanto | Quem decide (âmbito; papéis, `papel_ambitos`, 0059) | Prazo por omissão (proposta, **não é lei**) |
|---|---|---|---|---|
| `pagamento` | diferença (`diferenca_pagamento`) | `aberta` | `payments:resolve` (só o dono) | 1 dia |
| `documento_fiscal` | pedido de documento (`documento_fiscal`) | `retido`, `divergente`, ou `incerto` entregue a uma pessoa (motivo `reconciliacao_manual`) | `invoices:write` (dono e gestor; libertar e corrigir só o dono) | 2 dias |
| `duplicado_cliente` | par candidato (`duplicado_cliente`) | `por_decidir` | `customers:merge` (dono e gestor) | 7 dias |
| `prazo_reembolso` | devolução de um pedido de livre resolução feito no prazo | não fechada nem cancelada e o reembolso ainda não `executado` (A1 do `docs/30` §14) | `refunds:write` (dono e gestor) | **o prazo legal** (`posvenda_reembolsar_ate()`, 0063) |
| *nova* `livre_resolucao` | pedido de livre resolução | `pendente` (no prazo, mas a devolução não abriu) ou `fora_de_prazo` | `returns:write` (dono, gestor, armazém e apoio) | `pendente`: **o prazo legal**, contado do pedido; `fora_de_prazo`: 2 dias |
| *nova* `problema` | problema sem mercadoria de volta | `aberto` | `refunds:write` (dono e gestor) | 2 dias |
| *nova* `reembolso` | reembolso | `incerto` ou `falhado` | `refunds:write` (dono e gestor) | 1 dia (e nunca depois do prazo legal, se vier de uma livre resolução) |

**Fora desta peça** (`docs/13` §10, «Ficam de fora»; a camada E saiu como
módulo pelo ADR-0043): tarefas livres sobre qualquer registo, recorrência,
delegação, cronómetro, projectos, notas na tarefa e o envio de e-mails (fatia
de Notificações).

## 2. O que já existe (lido no código a 11/10/2026)

Lido no `main` (`b858e83`) por um agente só de leitura e conferido à mão nos
pontos de que o desenho depende (os ficheiros abaixo, com as linhas).

| O quê | O que está no código | Onde |
|---|---|---|
| **responsável e prazo nas filas** | **nenhuma das sete tem.** O `docs/26` §3.6 desenhou um `dono` na diferença, mas a tabela não o tem; ficam só `resolvida_por` e `resolvida_em` | `0044_pagamentos.sql:380-399`; `0046`: `duplicado_cliente`, 161-185 |
| **quando o caso entrou na fila** | diferença `criada_em`; pedido `recebido_em`; devolução `criada_em`; problema `criado_em`. **Falta nos que podem voltar à fila:** o documento (só se tira do `documento_rasto`), o par de duplicados (reaberto por um sinal novo, 0046:232, e o `actualizado_em` também muda quando se junta um sinal a um par por decidir, 0046:234), o reembolso e — visto na revisão do #375 (P1-2) — o problema, que volta a `aberto` quando se anula o reembolso dele (`posvenda/repositorio.ts:1307-1313`; 0058:489-491) | `0044:393`; `0058:254, 325, 461, 521`; `0050:221-233` |
| **as tabelas `tarefa_*`** | são cinco e são **filas de trabalho automático** (`tarefa_pagamento`, `tarefa_encomenda`, `tarefa_documento`, `tarefa_reembolso`, `tarefa_prazo_reembolso`): nenhuma tem pessoa nem prazo; só os temporizadores as lêem. **O nome `tarefa_` fica para elas**; esta peça usa `atribuicao` | `0044:484`, `0047:504`, `0050:408`, `0061:334`, `0063:157`; `servidor.ts:139-194` |
| **o aviso do prazo do reembolso** | um temporizador de hora a hora no processo da API marca a devolução e o gatilho põe `refund.deadline_approaching` e `refund.deadline_passed` na `evento_saida` | `src/posvenda/prazo.ts:142-188`; `0063:123-150` |
| **para onde vão os eventos** | **para lado nenhum, por agora:** nenhum ficheiro do programa lê a `evento_saida` (procurei `evento_saida` nos `.ts` de `apps/`: só aparece nos testes). Não há envio de e-mails | `grep -rln evento_saida --include=*.ts apps/` |
| **um pedido de livre resolução `pendente` não tem aviso** | o prazo do reembolso conta-se do pedido, mas a função do prazo e a lista só olham para devoluções; um pedido `pendente` (no prazo, sem devolução aberta) **corre o prazo legal sem aviso nem lista** | `0063:37-51` (só `devolucao`); `0058:258-267`; `src/posvenda/repositorio.ts:1377-1379` |
| **isolamento** | `comerciante_id` em todas as linhas, `ENABLE` e `FORCE ROW LEVEL SECURITY`, política `comerciante_id = comerciante_actual()`, o papel `eurolify_api` sem `BYPASSRLS` | `0046:614-620`; `0001:11, 24-26` |
| **papéis e âmbitos** | `membro.papel` é dono, gestor, armazém ou apoio; os âmbitos de cada papel estão em `papel_ambitos()` (espelho em `papeis.ts`); uma chave só tem âmbitos que o papel tem. Cada rota declara um âmbito (a rota sem âmbito não arranca) e uma chave sem ele recebe `auth.forbidden`; `qualquer` deixa a rota decidir | `0018:81`; `0059:37-72`; `0057:203-222`; `app.ts:295-302`; `autenticacao.ts:197-199` |
| **as rotas das filas** | só por chave (API de Administração). A lista dos documentos mostra **no máximo 200** | `pagamentos/rotas.ts:776-842`; `faturacao/rotas.ts:348-391`; `clientes/rotas.ts:1602-1698`; `posvenda/rotas.ts:251-276, 378, 419-467, 705, 808, 984, 1016` |
| **o Hub** | **nenhum ecrã** das sete filas | procurei `payment-issues`, `customer-duplicates`, `/withdrawals`, `/problems`, `/refunds` e `/invoices` em `apps/hub`: nenhum ficheiro |

## 3. O desenho escolhido: a lista lê as filas; a tarefa só guarda quem e até quando

| Forma | A favor | Contra |
|---|---|---|
| **A. Uma tabela de tarefas com estado próprio**, criada e fechada por cada fila | Uma linha por tarefa, simples de listar | O estado do caso fica em dois sítios e pode divergir: uma tarefa aberta de um caso já decidido, ou um caso sem tarefa, que **não aparece na lista** — o «parado em silêncio» que a peça quer evitar. Obriga as sete filas a avisar a peça em cada mudança |
| **B. A lista lê os casos abertos de cada fila** e junta-lhes a atribuição, guardada à parte | O estado vive só na fila (`platform-architect`, regra 2). Um caso sem atribuição **aparece na mesma**, como «sem responsável». Nada a sincronizar | A lista junta sete filas numa consulta; mede-se o tempo com volume (§9) |

**Proposta: B.** Cada domínio expõe, como API interna, **uma função da base
que devolve os seus casos abertos** (`<dominio>_casos_a_decidir()`), com o
isolamento do comerciante do contexto. O domínio Tarefas só lê essas funções;
**nenhum domínio escreve na tabela do outro**. Nos três casos que podem voltar
à fila, o domínio dono acrescenta **uma coluna «na fila desde»**, mantida pelos
seus gatilhos (§4.1).

## 4. Modelo

### 4.1 Caso aberto (o que cada função devolve; não é uma tabela)

| Campo | O que é |
|---|---|
| `fila` | um dos sete valores da §1 — a lista vive na base, num sítio só (regra 8) |
| `caso` | o identificador do caso na fila |
| `entrou_em` | quando o caso entrou **nesta passagem** pela fila. Colunas novas, cada uma no seu domínio: `documento_fiscal.na_fila_desde`, `duplicado_cliente.por_decidir_desde`, `reembolso.na_fila_desde` (postas ao entrar e limpas ao sair, pelo gatilho do domínio; as linhas que já estão na fila tiram-na do rasto, ou da data de criação, na migração) |
| `motivo` | o motivo da fila, da lista de valores dela (ex.: `incerto`, `emissor_por_configurar`, `nif_particular`) — nunca dados pessoais |
| `prazo_legal` | só no `prazo_reembolso` e no `livre_resolucao` `pendente`: o último dia, de `posvenda_reembolsar_ate()` (0063), a mesma função que a pós-venda usa |
| `ligacao` | o registo a abrir (a encomenda, o cliente, o documento) |

### 4.2 Atribuição (`atribuicao`, prefixo `atr_`; a tabela nova)

| Campo | O que é | Fonte |
|---|---|---|
| `comerciante_id` | o inquilino; `ENABLE` e `FORCE ROW LEVEL SECURITY`, como na 0046 | `platform-architect`, regra 3 |
| `fila`, `caso`, `entrou_em` | a passagem a que se refere; **uma atribuição por passagem** (único) | R9 |
| `responsavel` | a pessoa (`per_`), ou vazio | R3 |
| `prazo` | `timestamptz`; vazio = o prazo por omissão (R4) | R4, R5 |
| `aviso_vencido_em` | quando saiu o aviso de vencido; um por prazo | R6 |
| `versao` | para duas pessoas ao mesmo tempo | R7 |
| `criada_em`, `actualizada_em` | — | — |

Cada mudança (atribuir, tirar, mudar o prazo) grava-se em
**`atribuicao_rasto`**, que só se acrescenta, com o contexto da transacção
(`docs/28` §3.1: quem, canal, pedido, motivo, quem autorizou, IA).

**Não há estado guardado.** «Aberta», «vencida» e «sem responsável»
calculam-se: aberta = o caso está na fila; vencida = aberta e o prazo passou.
Quando o caso sai da fila, a atribuição fica como histórico («quem tinha o
caso quando foi decidido») e deixa de aparecer na lista.

## 5. Regras

| # | Regra | Fonte |
|---|---|---|
| R1 | A tarefa **não decide nem fecha** o caso. Não há «marcar como feita»: o caso sai da lista quando sai da fila, pela rota da própria fila | `AGENTS.md`, fiscal, regra 5; `docs/13` §10 |
| R2 | **Vê** o caso quem pode ler a fila dele (`payments:read`, `invoices:read`, `customers:read`, `returns:read`, `refunds:read`); a lista nunca mostra um caso de uma fila que a pessoa não lê, e diz de que filas são os totais | `observability-security`, quatro camadas |
| R3 | **Pode ser responsável** só quem pode decidir a fila (§1), conferido **na base** pelo papel da pessoa (`papel_ambitos()`). Atribuir-se a si próprio pede essa permissão; atribuir a outra pessoa, tirar a atribuição ou mudar o prazo pede também `tasks:assign` (dono e gestor) | proposta |
| R4 | **Prazo por omissão** (§1): proposta de funcionamento, **não é lei**, num sítio só (uma função da base, como `posvenda_dias_de_aviso()`). O prazo legal para emitir uma fatura **não está escrito** nos documentos (§11) | proposta |
| R5 | **Mudar o prazo** pede motivo e fica no rasto; não pode ficar no passado. **Onde há prazo legal** (`prazo_reembolso`, `livre_resolucao` `pendente`, e o `reembolso` de uma livre resolução) só pode ficar **antes** dele | `docs/30` §14 (**C**, J4) |
| R6 | **Vencido ⇒ um aviso**, uma vez por prazo: o evento `task.overdue` e a marca na lista. Mudar o prazo para depois permite um aviso novo. No `prazo_reembolso` o aviso é o que já existe (`refund.deadline_approaching` e `refund.deadline_passed`): **não sai um segundo**. No `livre_resolucao` `pendente`, que hoje não tem aviso (§2), sai o `task.overdue` | `platform-architect`, regra 7; uma regra num sítio |
| R7 | **Duas pessoas ao mesmo tempo:** atribuir e mudar o prazo levam a `versao`; a segunda recebe `tasks.version_conflict` e relê | `eurolify-engineering-execution` |
| R8 | **Quem sai da equipa ou muda para um papel que não decide a fila** deixa de ser responsável dos casos abertos dela, na mesma transacção, com o rasto a dizê-lo; o caso volta a «sem responsável» e sai `task.unassigned` | proposta |
| R9 | **Uma passagem, uma atribuição.** Um caso que sai e volta à fila é uma passagem nova, sem responsável e com o prazo por omissão; a lista mostra quem o teve da última vez | proposta |
| R10 | A lista **nunca corta em silêncio**: paginação por cursor e o total por fila (lição 4.7: o «corte das 1.000» fez a pesquisa dizer «não existe» a 40 % das fichas). Não herda o máximo de 200 da lista dos documentos | `platform-architect`, anti-padrões |
| R11 | **Nenhuma IA nem o MCP atribuem**: o MCP de leitura (peça 12) pode listar o que está por decidir, com a regra R2 | ADR-0040; `docs/23` R10 |

## 6. Dados pessoais

- A atribuição guarda **só identificadores** (o caso, a pessoa da equipa), o
  prazo e o motivo da mudança de prazo. **Nenhum dado do cliente** (nem nome,
  nem NIF, nem e-mail): esses vêem-se no ecrã da fila, com as permissões dela.
  O texto do motivo é livre: o Hub diz para não escrever dados de clientes
  nele. Se mesmo assim os tiver, é um dos «textos livres» do grupo C
  do `docs/23` §15.1 (decisão DU): **a ligar ao apagamento** quando o caso
  for de um titular que o peça — por verificar no código da parte 1.
- **Exportação do titular:** a atribuição não tem dados do cliente; o caso
  exporta-se pelo domínio dele. **Proposta:** não entra na exportação.
- **Apagamento do titular:** pseudonimizar a ficha não muda a atribuição.
- **Pessoas da equipa:** quem sai da equipa fica no histórico das
  atribuições e no rasto, como nos outros rastos (`docs/28`).

## 7. Lista da API (Administração)

| Rota | Âmbito |
|---|---|
| `GET /tasks?fila=&responsavel=sem\|per_…&vencida=true&limite=&cursor=` — os casos abertos das filas que a chave lê: fila, caso, motivo, `entrou_em`, responsável, prazo, `vencida`, a ligação; o total por fila. O `responsavel=eu` fica para o ecrã (parte 2): uma chave não é uma pessoa | `qualquer`, e a rota filtra pelas filas que a chave lê (R2); sem nenhuma, ou com `fila=` de uma que não lê, `tasks.forbidden` (403) |
| `GET /tasks/{fila}/{caso}` — o caso aberto e o histórico das atribuições dele | o `read` da fila |
| `POST /tasks/{fila}/{caso}/assign` `{ responsavel: per_… \| null, versao }` | a decisão da fila (R3); a outra pessoa ou `null` pede também `tasks:assign` |
| `POST /tasks/{fila}/{caso}/deadline` `{ prazo, motivo, versao }` | a decisão da fila + `tasks:assign` |

Âmbito novo: `tasks:assign` (dono e gestor). As rotas usam `{fila}/{caso}` e
não o `atr_`, porque o caso sem atribuição também está na lista. A primeira
atribuição cria a `atr_`; a `versao` dela começa em 1 (sem atribuição, a rota
recebe `versao: 0`).

**Erros (novos):** `tasks.not_found` (o caso não está aberto, ou é de outro
comerciante), `tasks.forbidden` (a chave não lê ou não decide a fila, não tem
`tasks:assign`, ou é de um agente de IA), `tasks.version_conflict`,
`tasks.assignee_not_allowed`, `tasks.deadline_invalid` (no passado, ou depois
do prazo legal), `tasks.reason_required`, `tasks.retry`.

**Eventos** (na `evento_saida`; só identificadores, fila e prazo; nunca dados
pessoais): `task.assigned`, `task.unassigned`, `task.deadline_changed`,
`task.overdue`. **Enquanto nada lê a `evento_saida` (§2), o aviso só se vê na
lista** (`vencida=true`) e pela API.

## 8. O ecrã «A decidir» no Hub (parte 2)

Uma lista com as filas, o filtro «as minhas / sem responsável / vencidas», e
em cada linha a fila, o motivo, há quanto tempo está, o responsável, o prazo e
o caminho para o caso. **Nenhuma das sete filas tem ecrã no Hub** (§2): até
terem, a linha mostra o identificador e a ligação ao registo que já tem ecrã
(a encomenda, o cliente). O Hub fala com a API por sessão, e as rotas de
sessão não conferem âmbitos como as de chave (`autenticacao.ts:153-179`): a
parte 2 tem de dar ao ecrã as mesmas regras R2 e R3 pelo papel da pessoa. O
desenho do ecrã faz-se com as skills `eurolify-design`, `eurolify-hub-modular`
e `eurolify-hub-quality-gate` antes do código dele.

## 9. Por onde é que isto ainda pode sair errado

| Risco | O que o trava |
|---|---|
| um caso parado sem ninguém o ver | §3, forma B: aparece mesmo sem atribuição; R6 marca-o ao vencer |
| **um pedido de livre resolução `pendente` com o prazo legal a correr sem aviso** (existe hoje, §2) | entra como fila `livre_resolucao` com o prazo legal (R6) |
| a tarefa «feita» com o caso por decidir | R1: não há fecho à mão |
| alguém sem permissão fica responsável de um caso fiscal | R3, conferido na base; R8 quando perde a permissão |
| duas pessoas a atribuir o mesmo caso | R7 |
| um caso que volta à fila com o prazo antigo, já vencido | R9 e as colunas «na fila desde» |
| dois avisos pelo mesmo prazo do reembolso | R6 |
| a lista mostra um caso de outra fila ou de outro comerciante | R2 e o RLS; testes que tentam e têm de falhar |
| a lista corta e diz «nada por decidir» | R10 |
| a verificação de hora a hora pára | conta e avisa como as outras tarefas automáticas; um comerciante que falhe não pára os outros |
| o aviso «sai» mas ninguém o recebe | §7: até haver quem leia a `evento_saida`, o aviso é a lista; dizê-lo no ecrã |
| a lista fica lenta com muitas encomendas | medir antes de pré-calcular (`docs/13` §11, porta 7) |
| uma fila nova da Fase 1 fica fora | a lista de filas é um valor da base; uma fila nova acrescenta-se lá e com a sua função |

## 10. Pergunta para o Diogo ou o Bruno (respondida)

| # | Pergunta | Proposta |
|---|---|---|
| Q1 ✅ sim (Diogo, 11/10/2026) | **Aprovas o desenho com as sete filas** (as quatro da decisão DS mais o pedido de livre resolução pendente ou fora de prazo, o problema aberto e o reembolso incerto ou falhado), a lista que lê as filas, os prazos por omissão da §1 e atribuir a outros só pelo dono e pelo gestor? | sim |

As três filas a mais aumentam a peça: a estimativa de 2–4 pessoas-semana
contava quatro filas. Por julgamento (**C**), cada fila a mais é uma função e
os testes dela: ≈ +0,5–1 pessoa-semana no total. Corrigido no `docs/10` com a
aprovação: a peça 21 passa a 2,5–5.

## 11. Por verificar

- **O prazo para emitir uma fatura** depois de uma venda (em Portugal e nos
  outros países): procurei «5 dias úteis», «prazo de emissão» e «art. 36» nos
  `docs/29`, `24` e `03` e nas skills `eu-vat-oss-ioss` e
  `eurolify-tax-pos-invoicing-eu` e não está escrito; **não verifiquei**.
  Fica para o contabilista; até lá, os 2 dias do R4 são uma proposta de
  funcionamento.
- Se o `falhado` do reembolso espera sempre por uma pessoa (ou se há
  reenvio automático) e se um reembolso pode voltar ao `incerto` depois de
  sair: lido no `CHECK` (0058:512-522), não no percurso.
- O prazo legal do reembolso e o direito de reter (**C**, J4 do `docs/30`).
- A estimativa (**C**), até à medida das 8 semanas (`docs/10` §6).
- O tempo de resposta da lista com volume.
- O que está aplicado no ensaio: li o repositório, não a base do ensaio.

## 12. Como entra no código (quando aprovado)

- **Parte 1:** a migração (a lista de filas; a função de cada fila no seu
  domínio; as três colunas «na fila desde»; a atribuição e o rasto dela com o
  RLS; o âmbito `tasks:assign`; os prazos por omissão), as rotas da §7, a
  verificação de hora a hora com o aviso, e os testes: outro comerciante,
  chave sem a leitura de uma fila, responsável sem permissão recusado, duas
  pessoas ao mesmo tempo, quem sai da equipa ou muda de papel, um caso que
  volta à fila, o aviso uma vez, o prazo legal que não passa, o pedido
  pendente com aviso; mutações e a revisão do agente.
- **Parte 2:** o ecrã «A decidir» no Hub, desenhado primeiro.
- Cada parte num pedido, com os testes verdes e a revisão do agente antes de
  juntar (ADR-0031, ADR-0035).

## 13. Em código — parte 1 (11/10/2026; migração 0066; pedido #375)

| O quê | Onde |
|---|---|
| a régua das sete filas, com o âmbito que lê e o que decide (o espelho em TS conferido por um teste) | `tarefas_filas()`, migração 0066; `src/tarefas/filas.ts` |
| uma função por domínio com os casos abertos, que filtra também pelo comerciante | `pagamentos_casos_a_decidir()`, `documentos_casos_a_decidir()`, `clientes_casos_a_decidir()`, `posvenda_casos_a_decidir()` |
| «na fila desde» no documento, no par de duplicados, no reembolso e no problema, posto pelo gatilho do domínio; as linhas antigas usam o rasto ou a data | migração 0066 |
| a atribuição e o rasto dela (só se acrescenta; o contexto pelo `rasto_completar()`), com o RLS forçado; cada linha do rasto põe o evento | `atribuicao`, `atribuicao_rasto` |
| atribuir, mudar o prazo e marcar o aviso, com a tranca do caso e a versão; quem escreve vem de `eurolify.quem` | `tarefas_atribuir()`, `tarefas_mudar_prazo()`, `tarefas_marcar_vencida()` |
| quem sai da equipa (pela própria pessoa, pelo dono ou desactivado pelo operador) ou muda de papel larga os casos que já não decide | `membro_tarefas_largar()` |
| `GET /tasks`, `GET /tasks/{fila}/{caso}`, `POST …/assign`, `POST …/deadline` | `src/tarefas/rotas.ts` |
| a volta de hora a hora, nos comerciantes com equipa ou com uma chave activa | `src/tarefas/avisos.ts`; `servidor.ts` |
| 19 testes com o PostgreSQL 18.6; 20 protecções retiradas de propósito, uma a uma, contra o código final, e todas apanhadas; com a API a ignorar o RLS (`BYPASSRLS`), 5 falham | `test/tarefas-api.test.ts` |

**Desvios do desenho:**
- **Só por chave nesta parte.** Uma chave não é uma pessoa: `responsavel=eu` e
  «atribuir-me» ficam para o ecrã (parte 2); por chave, atribuir pede sempre
  `tasks:assign`, além de ler e decidir a fila.
- **Quatro filas podem voltar, não três:** o problema também (§2).
- **Uma chave de agente de IA não atribui nem muda prazos** (R11, imposto na
  rota; revisão do #375, P2-1). Lê a lista.
- **A volta também avisa os comerciantes só com chaves** (o aviso vai para a
  `evento_saida`, que um sistema lê sem pessoas; revisão do #375, P2-4).
- **O pedido pendente avisa quando o prazo legal já passou** (o prazo por
  omissão é o legal). Um aviso antes, como os 3 dias do prazo do reembolso,
  não está no desenho.
- **No evento, `prazo` vai vazio** quando é o por omissão; o `caso` vai sem o
  prefixo e o `responsavel` com `per_`.

**Revisão do #375** (Sonnet 5.5; 0 P0, 3 P1, 8 P2, 12 P3; publicada no
pedido):
- corrigidos: os 3 P1 (quem sai da equipa pelas funções verdadeiras; o
  problema que volta à fila; a permissão a um papel que pode não existir), os
  P2-1 a P2-4 e P2-7 e P2-8, e os P3-3, P3-5, P3-11 e P3-12;
- ficam, com a razão:
  - **P2-5** (a falha do gatilho R8 pode parar a saída de uma pessoa): a
    limpeza lê as mesmas funções que a lista. Largar em silêncio seria pior
    do que falhar com o erro à vista;
  - **P2-6** (o motivo livre no apagamento do titular): o código dos pedidos
    do titular (decisão DU) ainda não existe. Liga-se lá; até lá, o Hub diz
    para não escrever dados de clientes no motivo;
  - **P3-1** (gatilhos sem ALWAYS): regra da 0053;
  - **P3-4** (quem mudou, visto por quem só lê a fila): como no desenho;
  - **P3-6 e P3-7** (aviso do pedido pendente antes do prazo; aviso duplo raro
    num reembolso de livre resolução): decisões por tomar;
  - **P3-8** (alarme de volta parada): igual à volta do prazo do reembolso; a
    tratar com os alarmes de todas as voltas;
  - **P3-9** (recurso no reembolso antigo): só há dados de teste no ensaio;
  - **P2-3**, em parte: o documento passou a usar o índice novo; as escritas
    ainda recalculam a fila do caso — medir com volume antes de optimizar
    (§9).

