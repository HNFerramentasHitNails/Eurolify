# Pagamentos — modelo e lista da API

> **Estado: desenho aprovado; parte 1 no código** (issue #287; migração
> 0042; `docs/06`, DB). Diogo, 09/10/2026: *«sim, avança com o desenho da
> fatia 8»* e *«sim, aprovo; avança com o código da fatia 8»* (Q1 a Q6 como
> propostas). O que está programado e os desvios dizem-se na §15. É a fatia 8 do
> [`eurolify/implementation-plan.md`](eurolify/implementation-plan.md)
> («Pagamentos por adaptador (EuPago, Stripe), confirmação no servidor,
> conciliação»). Depende da fatia 7, cuja parte 1 está no `main` (`docs/25`,
> #276): o botão final cria a encomenda `a_aguardar_pagamento`, e é aqui que
> ela passa a `paga` ou `cancelada_sem_pagamento`.
>
> Skills seguidas: `payments-psd2-sca` (as duas fronteiras, a régua
> método → prestador → conta, a máquina de estados, os avisos, o `incerto`),
> `eurolify-payment-readiness-eu` (entidade, prestador e conta antes de
> activar; testar conta errada, assinatura inválida, incerto, duplicado),
> `eurolify-finance-reconciliation-eu` (referência autoritativa, diferenças
> numa fila com motivo e dono, nada se reescreve), `third-party-extensions`
> e `docs/08` §4 (o contrato de pagamento é o mesmo para nós e para
> terceiros), `consumer-rights-eu` (o checkout e a confirmação),
> `eu-gdpr-privacy` (o que o prestador recebe, retenção dos avisos em bruto),
> `observability-security` (credenciais, assinaturas, registos) e
> `headless-commerce` (idempotência, cêntimos, erros, eventos).
>
> 🔴 **As duas fronteiras** ([ADR-0038](adr/0038-o-eurolify-nunca-recebe-o-dinheiro.md),
> skill `payments-psd2-sca`):
> 1. **O Eurolify nunca recebe nem guarda o dinheiro.** O cliente paga para a
>    conta do comerciante no prestador; o Eurolify recebe só os avisos.
> 2. **O Eurolify nunca toca em dados de cartão.** O cartão e a autenticação
>    forte (3DS2) ficam nas páginas do prestador.
>
> 🔴 **Regra deste domínio:** um pagamento só se dá por pago com **prova do
> prestador** (um aviso com assinatura válida ou uma consulta à API dele),
> nunca porque o ecrã do cliente o disse. Na dúvida, fica `incerto` e decide
> uma pessoa: **nunca se cobra outra vez nem se dá por falhado às cegas**.

## 1. O que entra nesta fatia

| O quê | Fonte |
|---|---|
| **contas de pagamento** do comerciante (prestador, modo teste ou real, credenciais cifradas, segredo dos avisos) | ADR-0038, ponto 1; `payments-psd2-sca` |
| **a régua** método → prestador → conta, por mercado, que o comerciante muda sem código | `payments-psd2-sca` («tabela no servidor»); D-5 |
| **os métodos no checkout**: a lista vem da régua, e o checkout deixa de aceitar um código livre (fecha o desvio do `docs/25` §13) | `docs/25` §13 |
| **o pagamento** (`pay_`) com a máquina de estados da skill, a referência nossa igual à do prestador e cada transição com origem e evento em bruto | `payments-psd2-sca`; `docs/08` §4 |
| **os avisos dos prestadores**: assinatura antes de ler, evento em bruto gravado antes de responder, idempotência pelo identificador do evento, 5xx quando falha | `payments-psd2-sca`, «Avisos», 1 a 5 |
| **a consulta ao prestador** (manual e pela tarefa dos pendentes) e a **expiração** dos que não avisam (Multibanco) | `payments-psd2-sca`, máquina de estados |
| **a fila de diferenças** (incerto, aviso que não casa, montante ou moeda diferentes) com motivo, dono e prova | `eurolify-finance-reconciliation-eu`, 5 |
| **a encomenda paga ou cancelada sem pagamento**, pela transição que a 0041 já deixa | `docs/25` §4.3 |
| **o adaptador EuPago** (MB WAY e Multibanco), primeiro em modo teste | ADR-0038, ponto 2; Q1 |

**Fora desta fatia:**

| O quê | Onde |
|---|---|
| reembolsos (ligados à nota de crédito e à devolução) | fatia 11 (pós-venda); o contrato já os prevê (§9) |
| disputas e as provas | fatia 11; o estado `em_disputa` fica na máquina |
| captura diferida à expedição | fatia 9 (precisa da expedição); aqui captura-se já (Q4) |
| conciliação com o extracto do banco e as liquidações do prestador | fatia financeira futura (`eurolify-finance-reconciliation-eu`); aqui só pagamento a pagamento contra o prestador |
| o meio de pagamento no documento fiscal | fatia 10; esta fatia guarda o método real para lá chegar certo |
| Stripe (cartão, Klarna, Apple Pay, Google Pay) | parte 2, depois da decisão da regra 4 (Q2) |
| a mensalidade do Eurolify | à parte (ADR-0038, ponto 4; ADR-0007) |

## 2. Fronteira

| O quê | Dono | Como fala com os Pagamentos |
|---|---|---|
| a encomenda e o total | **Checkout/Encomendas** (fatias 7 e 9) | o pagamento copia o total e a moeda da encomenda; nunca os recalcula |
| os métodos activos de um mercado | **Pagamentos** (a régua) | o checkout pergunta; mostra só os activos e com conta pronta |
| a passagem da encomenda a `paga` | **Pagamentos** | na mesma transacção da transição do pagamento para `capturado` |
| o stock, a expedição | fatia 9 | ouve `order.paid` |
| o documento fiscal | fatia 10 | ouve `order.paid`; lê o método real do pagamento |
| o prestador | **adaptador** (`docs/08`, tipo «Meio de pagamento») | contrato da §9; o núcleo não conhece os campos de nenhum prestador |

## 3. Modelo

### 3.1 Conta de pagamento (`pac_`)

| Campo | Regra | Fonte |
|---|---|---|
| `prestador` | `eupago` nesta fatia; `stripe` na parte 2 | ADR-0038; Q2 |
| `nome` | o que o comerciante lhe chama (ex.: «Produtos») | `payments-psd2-sca` (uma conta por aquilo que se vende) |
| `modo` | `teste` ou `real`. **No ensaio só `teste`** (ADR-0019: nenhum dado real) | ADR-0019; skill («um pagamento de testes nunca gera documento fiscal») |
| `credenciais` | cifradas na base com AES-256-GCM, a chave fora da base (segredo do ambiente, versão da chave guardada), como o segundo factor (`identidade/palavra-passe.ts`) | `observability-security`; Q3 |
| `segredo_aviso` | o segredo para conferir a assinatura dos avisos desta conta, cifrado da mesma forma | skill, «Avisos», 1 |
| `estado` | `rascunho` → `pronta` → `arquivada`. Fica `pronta` só depois de uma chamada de teste ao prestador correr bem | `eurolify-payment-readiness-eu`, 4 |
| `entidade_prestador` | quem é o prestador perante o regulador (nome, país, registo) e quando se confirmou | `eurolify-payment-readiness-eu`, 3; `docs/08` §7 (registo da EBA, **W**) |

As credenciais **nunca saem** pela API (só «definidas em», «por quem»). Mudar
as credenciais é um acto à parte, com âmbito próprio e registo (§8.3).

### 3.2 Método por mercado — a régua (`pmm_`)

| Campo | Regra |
|---|---|
| `mercado` | do mesmo comerciante e da mesma loja (chave composta, como na 0041) |
| `metodo` | da lista fechada do núcleo: `mb_way`, `multibanco` nesta fatia; `cartao`, `klarna`, `apple_pay`, `google_pay` na parte 2 |
| `conta` | uma conta `pronta` cujo prestador sabe o método (o adaptador declara-os) |
| `ordem`, `estado` | a ordem no checkout; `activo` ou `arquivado` |
| `prazo` | quanto tempo o cliente tem para pagar (MB WAY minutos; Multibanco dias), proposta por método, **C** até se ler a documentação do prestador (V2) |

Um método só aparece no checkout com a conta `pronta`. Um mercado sem métodos
activos não chega ao botão final (o resumo diz o bloqueio, como os textos
legais: **na dúvida, não vende**).

### 3.3 Pagamento (`pay_`)

| Campo | Regra | Fonte |
|---|---|---|
| `encomenda` | uma encomenda pode ter **vários pagamentos** (uma tentativa falhada, outro método), mas **só um vivo** de cada vez (índice único parcial) | skill; §6, R3 |
| `conta`, `prestador`, `metodo`, `modo` | **copiados** da régua no momento: mudar a régua depois não muda o pagamento | skill (o meio que vai para o documento fiscal tem de ser o real) |
| `montante`, `moeda` | copiados da encomenda (`total`, `moeda`); nunca vêm do pedido | regra da API |
| `referencia` | a nossa, única, a mesma que vai ao prestador (`identifier`) | skill, «Conciliação» |
| `referencia_prestador` | a dele, quando a dá | skill |
| `instrucoes` | o que o cliente precisa (Multibanco: entidade, referência, montante, prazo; MB WAY: «aprove na aplicação»; parte 2: o endereço da página do prestador). Sem dados de cartão, nunca | fronteira 2 |
| `estado` | a máquina da §4.1 | skill |
| `expira_em` | do `prazo` da régua, pelo relógio da base | revisão do #276, P3-6 |

### 3.4 Transição (`pat_`, só se acrescenta)

`pagamento`, `de`, `para`, `origem` (`aviso`, `consulta`, `pessoa`,
`sistema`), `aviso` (quando veio de um), `quem`, `em`, `motivo`. Um gatilho
recusa o que a máquina não deixa. **Uma transição impossível é erro
registado** (vai para a fila da §3.6), nunca se ignora (skill).

### 3.5 Aviso do prestador (`pwh_`)

`conta`, `id_evento` (o do prestador; **único por conta**: a idempotência),
`corpo` em bruto, `assinatura_valida`, `recebido_em`, `processado_em`,
`resultado` (`aplicado`, `repetido`, `sem_pagamento`, `erro`). O corpo pode
trazer dados pessoais (telefone do MB WAY, e-mail): **retenção** na §7.

### 3.6 Diferença (`pdi_`) — a fila

`pagamento` (se houver), `aviso` (se houver), `motivo` (`incerto`,
`aviso_sem_pagamento`, `montante_diferente`, `moeda_diferente`,
`transicao_impossivel`, `pago_depois_de_cancelada`), `prova`, `estado`
(`aberta` → `resolvida`), `dono`, `resolucao` (texto e quem). **Só uma pessoa
a resolve**; o sistema nunca a fecha sozinho (`AGENTS.md`, fiscal, regra 5;
skill `eurolify-finance-reconciliation-eu`, 5).

## 4. Estados

### 4.1 Pagamento (a máquina da skill)

```
criado → a_aguardar_cliente → autorizado → capturado
             │                    │
             ├→ falhado           └→ anulado
             ├→ expirado
             └→ incerto → (autorizado | capturado | falhado)   (só por consulta ou por uma pessoa)
capturado → (reembolsado_parcial | reembolsado)                (fatia 11)
capturado → em_disputa → (ganha | perdida)                     (fatia 11)
```

- **MB WAY e Multibanco não têm autorização à parte** (o dinheiro sai quando o
  cliente aprova ou paga): passam de `a_aguardar_cliente` a `capturado`
  (proposta; V1).
- `incerto`: o prestador não respondeu a tempo ou a resposta não se lê. Sai
  só pela consulta ao prestador ou por uma pessoa, e abre sempre uma
  diferença.
- Só para a frente; nenhum estado final volta atrás.

### 4.2 Encomenda (o que esta fatia muda)

`a_aguardar_pagamento` → `paga`: na transacção em que um pagamento dela passa
a `capturado` com o montante e a moeda iguais aos da encomenda. Montante ou
moeda diferentes: **não paga**, abre `montante_diferente` (decide uma pessoa).

`a_aguardar_pagamento` → `cancelada_sem_pagamento`: pela tarefa, quando o
último pagamento acabou (`falhado`, `expirado`, `anulado`) **e** passou o
prazo para tentar outro método (proposta: 24 h depois do botão final, **C**,
Q5). Um aviso de pagamento que chega **depois** de cancelada não a reabre:
abre `pago_depois_de_cancelada` e decide uma pessoa (o dinheiro está na conta
do comerciante; o reembolso é da fatia 11).

## 5. O percurso

| Passo | O que acontece | Fonte |
|---|---|---|
| 1. Escolher o método | o checkout lista os métodos activos do mercado (régua) e guarda o escolhido; o resumo mostra-o | `payments-psd2-sca` (a escolha faz-se no checkout do Eurolify) |
| 2. Botão final | cria a encomenda (fatia 7), como hoje | `docs/25` §5 |
| 3. Pagar | `POST /checkout/{token}/payment` cria o pagamento e chama o adaptador; devolve as `instrucoes` | skill |
| 4. Esperar | o ecrã pergunta o estado (`GET /checkout/{token}/payment`); o que conta é o aviso ou a consulta | regra deste domínio |
| 5. Aviso | conferir a assinatura → gravar em bruto → responder; aplicar a transição; `capturado` ⇒ encomenda `paga` e `order.paid` | skill, «Avisos» |
| 6. Falhou ou expirou | o cliente pode tentar outro método na mesma encomenda, dentro do prazo (Q5) | §4.2 |
| 7. Sem aviso | a tarefa dos pendentes consulta o prestador e marca `expirado` o que passou do prazo | skill (o link que expira pode não avisar — **não confirmado**) |

## 6. Regras

| # | Regra | Fonte |
|---|---|---|
| R1 | O montante e a moeda vêm da encomenda, nunca do pedido nem do ecrã | regra da API (`AGENTS.md`, «Uma regra, um sítio») |
| R2 | Só um pagamento vivo por encomenda; criar outro com um vivo dá 409 | evita cobrar duas vezes |
| R3 | A chamada ao prestador leva a nossa `referencia` e uma chave de idempotência; repetir não cria outra cobrança | `docs/08` §4 («chave de idempotência») |
| R4 | Tempo esgotado ou resposta ilegível depois de pedir a cobrança ⇒ `incerto`, nunca repetir às cegas | skill; `eurolify-payment-readiness-eu` |
| R5 | Aviso sem assinatura válida: grava-se (para investigar), responde-se 401 e não se aplica | skill, «Avisos», 1 |
| R6 | Aviso repetido (mesmo `id_evento` na conta): 200 sem aplicar outra vez | skill, «Avisos», 3 |
| R7 | Falhou o processamento ⇒ 5xx, para o prestador reenviar | skill, «Avisos», 4 |
| R8 | A versão da API de cada prestador fica fixada no adaptador e coberta por testes | skill, «Avisos», 5 |
| R9 | Um pagamento de teste nunca chega a um documento fiscal; o modo vai com o pagamento e com o evento | skill, «Ambiente de testes» |
| R10 | Nenhum caminho passa dinheiro por uma conta do Eurolify; uma conta de pagamento é sempre do comerciante | ADR-0038 |
| R11 | Sem encargos por método de pagamento nesta fatia (o total é o da encomenda). Se um dia houver, a regra europeia sobre encargos tem de entrar com fonte | **C** — não verifiquei a regra; não se inventa |

## 7. Dados pessoais

- **O que vai ao prestador:** o mínimo de cada método — o montante, a nossa
  referência e, no MB WAY, o telefone (o prestador precisa dele para pedir a
  aprovação). O nome e o e-mail só se o método os exigir (V3).
- **O prestador é subcontratante ou responsável?** Por verificar com o
  jurista (**C**), por prestador. Um prestador com empresa-mãe fora da UE
  (Stripe) só entra com decisão escrita e acordo de transferência (regra 4 do
  `AGENTS.md`; Q2).
- **Avisos em bruto:** guardam-se para prova e investigação. Retenção
  proposta: o mesmo prazo das encomendas a que pertencem; os que não casam com
  nenhum pagamento, 90 dias (**C**, `eu-gdpr-privacy`; entra na porta da
  retenção do `docs/25` §13, P2-3).
- **Nos registos:** nunca o corpo dos avisos, as credenciais, o telefone nem
  as instruções; só identificadores e o resultado.

## 8. Lista da API

### 8.1 Checkout alojado (pelo token)

| Rota | O quê |
|---|---|
| `GET /checkout/{token}/payment-methods` | os métodos activos do mercado da sessão (código, nome na língua, ordem) |
| `PUT /checkout/{token}/payment-method` | já existe; passa a aceitar só um método da lista |
| `POST /checkout/{token}/payment` | depois do botão final: cria o pagamento do método escolhido e devolve as `instrucoes` (201); com um vivo, devolve esse (o clique repetido) |
| `GET /checkout/{token}/payment` | o estado do pagamento vivo ou do último, e o da encomenda |

### 8.2 Avisos dos prestadores (sem chave; pela assinatura)

| Rota | O quê |
|---|---|
| `POST /webhooks/payments/{conta}` | um endereço por conta (`pac_`), com o segredo dessa conta; regras R5 a R7 |

### 8.3 API de Administração

| Rota | Âmbito |
|---|---|
| `GET /payment-accounts`, `POST /payment-accounts`, `PATCH /payment-accounts/{id}`, `POST /payment-accounts/{id}/archive` | `payments:read` / `payments:write` |
| `PUT /payment-accounts/{id}/credentials` (escreve; nunca devolve) e `POST /payment-accounts/{id}/test` (a chamada de teste que a põe `pronta`) | `payments:accounts` (só o dono, Q3) |
| `GET /payment-methods`, `POST /payment-methods`, `PATCH /payment-methods/{id}`, `POST /payment-methods/{id}/archive` | `payments:read` / `payments:write` |
| `GET /payments`, `GET /payments/{id}` (com as transições) | `payments:read` |
| `POST /payments/{id}/check` (consulta ao prestador) | `payments:write` |
| `GET /payment-issues`, `POST /payment-issues/{id}/resolve` (só uma pessoa, com o texto da resolução) | `payments:read` / `payments:write` |

Âmbitos novos: `payments:read`, `payments:write`, `payments:accounts`.
Papéis (proposta): dono os três; gestor `read` e `write`; apoio `read`;
armazém nenhum.

### 8.4 Erros (novos)

`payments.no_method`, `payments.method_unavailable`, `payments.live_exists`,
`payments.provider_unavailable` (503; o pagamento fica `incerto` se a cobrança
pode ter saído), `payments.account_not_ready`, `payments.signature_invalid`,
`payments.invalid_transition`, `payments.order_not_payable`.

### 8.5 Eventos

| Evento | Quando |
|---|---|
| `payment.created` | pagamento criado |
| `payment.captured` | `capturado` (com o modo) |
| `payment.failed`, `payment.expired` | estados finais sem dinheiro |
| `payment.uncertain` | `incerto` (abre uma diferença) |
| `order.paid` | a encomenda passou a `paga` |
| `order.cancelled` | a encomenda passou a `cancelada_sem_pagamento` |

Só identificadores, montante, moeda e modo; nunca o telefone, as instruções
nem o corpo do aviso (como na 0041).

## 9. O contrato do adaptador (`docs/08` §4)

O mesmo para o adaptador EuPago, para o Stripe e para um prestador de
terceiros:

| Operação | Entrada | Saída |
|---|---|---|
| `metodos()` | — | os métodos que o adaptador sabe |
| `testar(credenciais)` | — | conta válida ou o erro dele |
| `cobrar(pedido)` | referência, montante, moeda, método, dados mínimos do método, chave de idempotência | `a_aguardar_cliente` com instruções, ou `falhado`, ou erro de rede (⇒ `incerto`) |
| `consultar(referencia)` | — | o estado no prestador |
| `lerAviso(cabecalhos, corpo, segredo)` | — | assinatura válida? e o evento normalizado (id, referência, novo estado, montante, moeda) |
| `anular`, `capturar`, `reembolsar` | — | previstas no contrato; usadas nas fatias 9 e 11 |

O núcleo só conhece este contrato; os campos de cada prestador ficam dentro
do adaptador (R8).

## 10. Por onde é que isto ainda pode sair errado

| Risco | O que o trava |
|---|---|
| cobrar duas vezes (clique duplo, reenvio, tempo esgotado) | R2, R3, R4; índice único do pagamento vivo; `incerto` sem repetir |
| dar por pago sem dinheiro (ecrã, aviso falso) | só aviso assinado ou consulta; R5; montante e moeda conferidos (§4.2) |
| perder um pagamento (aviso que falhou e respondemos 200) | R7: 5xx; evento em bruto gravado antes; a tarefa dos pendentes consulta |
| pago depois de cancelada | não reabre; diferença `pago_depois_de_cancelada`; decide uma pessoa |
| mudança na API do prestador | R8: versão fixada e testes do adaptador |
| credenciais roubadas da base | cifradas com chave fora da base; nunca saem pela API nem pelos registos |
| um pagamento de teste a gerar documento | R9; o modo vai em toda a cadeia |
| o método errado no documento fiscal | o pagamento copia o método real; a fatia 10 lê-o dali |

## 11. Perguntas para o Diogo ou o Bruno

| # | Pergunta | Proposta |
|---|---|---|
| Q1 | **Por onde começar?** | **EuPago, MB WAY e Multibanco, em modo teste** na parte 1: é o prestador já escolhido (ADR-0038), português, e cobre os dois métodos mais usados em Portugal (`docs/07`, linha 118, **W**) |
| Q2 | **Stripe e a regra 4.** A Stripe Europe é irlandesa, mas a empresa-mãe é norte-americana (`docs/07` §1.1, **W**): a regra 4 do `AGENTS.md` pede decisão escrita e acordo de transferência antes de dados pessoais lá entrarem | a Stripe fica para a parte 2, depois dessa decisão; a Mollie (europeia, `docs/07` §1.1) fica como alternativa para os mesmos métodos |
| Q3 | **Quem liga a conta do prestador?** | só o **dono** (`payments:accounts`), como os perfis de faturação; a chave de cifra num segredo do ambiente `ensaio` (`PAGAMENTOS_CHAVE`), com versão, como a do segundo factor |
| Q4 | **Quando se captura?** | **já**, no pagamento (MB WAY e Multibanco não têm outra forma); a captura à expedição fica para o cartão, com a fatia 9 |
| Q5 | **Quanto tempo tem o cliente** para pagar ou tentar outro método antes de a encomenda ser cancelada? | **24 horas** depois do botão final; o Multibanco com o prazo da referência dentro dessas 24 h (**C**, V2) |
| Q6 | **Onde correm as tarefas** (pendentes, expiração, cancelamento)? | um comando da API (`node dist/tarefas.js`) chamado por um temporizador `systemd` na VPS, como a limpeza e a cópia (`infra/vps/ficheiros/systemd/`), de 5 em 5 minutos; entra pelo GitHub (ADR-0028) |

## 12. Por verificar antes do código (bloqueiam o adaptador, não o modelo)

Lido na documentação pública da EuPago a 09/10/2026 (**W**,
[docs.eupago.pt](https://docs.eupago.pt/reference)); **nada foi corrido contra
a sandbox**, porque não há credenciais de teste.

| # | O quê | O que se leu | O que falta |
|---|---|---|---|
| V1 | Estados e avisos | Avisos 2.0 com `status` `Paid`, `Refund`, `Error`, `Cancel`, `Expired` ([avisos 2.0](https://docs.eupago.pt/reference/realtime-webhooks-20)); o MB WAY tem uma variante com autorização e captura à parte, que não se usa | a consulta (`multibanco/info`) só documenta o estado `pendente`: os outros valores estão por confirmar |
| V2 | Prazos | MB WAY: 5 minutos para aprovar, até 99 999 € ([MB WAY](https://docs.eupago.pt/reference/mbway)); Multibanco: prazo por data (`data_fim`, AAAA-MM-DD), de 1 € a 99 999 € ([Multibanco](https://docs.eupago.pt/reference/multibanco)) | se o fim do prazo avisa (a skill diz «não confirmado»); a referência paga-se até ao fim do dia do prazo |
| V3 | Dados pessoais | MB WAY: telemóvel e indicativo (obrigatórios); nome e e-mail opcionais, que não se enviam. Multibanco: nenhum | — |
| V4 | Assinatura | `X-Signature`, HMAC-SHA256 em base64, com a chave do canal; a página não diz sobre o que se calcula | o corpo em bruto é a hipótese do código (**C**), a confirmar na sandbox; a cifra dos avisos (AES-256-CBC) não se suporta e tem de ficar desligada no canal |
| V5 | Sandbox | `https://sandbox.eupago.pt`; para produção troca-se «sandbox» por «clientes» ([API](https://docs.eupago.pt/reference/api-eupago)) | como se obtêm credenciais de teste |
| V6 | Registo da EuPago | — | **não verifiquei** (Banco de Portugal / EBA) |

## 13. Para o jurista e o contabilista (bloqueiam a produção, não o código)

- O papel de cada prestador no RGPD (subcontratante ou responsável) e o
  acordo com ele (`eu-gdpr-privacy`).
- A regra europeia sobre encargos por meio de pagamento, se um dia houver
  (R11, **C**).
- Floa e Klarna são crédito ao consumidor: classificação própria antes de os
  activar (`eurolify-payment-readiness-eu`, 5). Ficam fora desta fatia.
- O contabilista: que data conta para a venda (o botão final ou o
  pagamento) e como a taxa do prestador entra (despesa à parte, skill
  «Conciliação»), para a fatia 10.

## 14. Como entra no código (quando aprovado)

- **Parte 1:**
  - migração com as seis tabelas, os gatilhos da máquina, o RLS forçado, os âmbitos e os eventos;
  - a régua no checkout (o fim do código livre);
  - o adaptador EuPago em modo teste, depois de lidas as V1 a V5;
  - os avisos, a consulta, a tarefa e a fila;
  - testes contra um prestador simulado (aviso repetido, assinatura inválida, tempo esgotado ⇒ `incerto`, montante diferente, pago depois de cancelada, dois pagamentos vivos), mutações e a revisão do agente.
- **Parte 2:** a Stripe (depois da Q2), o cartão com 3DS2 nas páginas dela e a captura diferida com a fatia 9.
- Cada parte num pedido, com o desenho, os testes verdes e a revisão do agente antes de juntar (ADR-0031, ADR-0035).

## 15. Em código — parte 1 (10/10/2026; migração 0042; `docs/06`, DB)

| O quê | Onde |
|---|---|
| tabelas `conta_pagamento`, `metodo_pagamento` (a régua), `pagamento`, `aviso_pagamento`, `transicao_pagamento` (só se acrescenta) e `diferenca_pagamento`, com o RLS forçado; duas internas (`conta_pagamento_aviso`, a porta dos avisos, e `tarefa_pagamento`) | migração 0042 |
| a máquina de estados na base (`pagamento_transicao_valida`), só para a frente; do `incerto` só por consulta ou por uma pessoa; um pagamento vivo por encomenda; as cópias não mudam | migração 0042 |
| a encomenda `paga` só com um pagamento capturado do mesmo montante e moeda; `cancelada_sem_pagamento` só sem pagamento vivo nem capturado | migração 0042 (gatilho na encomenda) |
| eventos `payment.*`, `order.paid`, `order.cancelled`, pelos gatilhos; a transição grava a origem, quem, o aviso e o motivo | migração 0042 |
| âmbitos `payments:read`, `payments:write`, `payments:accounts` nos papéis (dono os três; gestor ler e escrever; apoio ler; armazém nenhum) | migração 0042; `src/identidade/` |
| as credenciais cifradas com AES-256-GCM (`PAGAMENTOS_CHAVE`), com a conta e o campo como dado associado | `src/pagamentos/cifra.ts` |
| o adaptador EuPago (MB WAY e Multibanco, sandbox) e o contrato | `src/pagamentos/eupago.ts`, `adaptador.ts` |
| o pagamento pelo token, os avisos, a consulta, as tarefas, a fila e a Administração — a lista da §8 | `src/pagamentos/` |
| o checkout só aceita métodos da régua; o MB WAY pede telemóvel português; um método que deixou de estar disponível bloqueia o botão final | `src/checkout/repositorio.ts` |
| 13 testes pela API com a EuPago falsa (o adaptador verdadeiro, a rede trocada); 15 mutações nas protecções, todas apanhadas (uma sobreviveu à primeira — o aviso de outra conta do mesmo comerciante — e ganhou um teste) | `test/pagamentos-api.test.ts`, `test/eupago-falso.ts` |

**Desvios do desenho:**
- **Só o modo teste existe** (a base recusa `real`): abrir o modo real é uma
  migração com decisão escrita (ADR-0019).
- **As tarefas correm dentro da API**, de minuto a minuto, como a fila do
  VIES (`src/clientes/vies-fila.ts`), e não num temporizador `systemd`
  (proposta da Q6). Assim não há mais nada para instalar na VPS, e só correm
  com a `PAGAMENTOS_CHAVE` definida.
- **O identificador do evento** de um aviso é `trid` mais `status`: a EuPago
  não documenta um identificador próprio do evento.
- **A consulta à EuPago** só reconhece `pendente`. O que ela não diz
  claramente não muda nada; numa tarefa depois do prazo, um MB WAY passa a
  `expirado` (5 minutos para aprovar, **W**) e um Multibanco passa a
  `incerto`, para uma pessoa decidir.
- **Um aviso que chega antes de gravarmos a resposta da cobrança** responde
  503, e a EuPago reenvia daqui a 2 minutos (**W**).
- **Resolver uma diferença** faz-se nesta parte pela chave do comerciante
  (`payments:write`), com o texto da resolução; um processo automático nunca
  o faz (a base recusa). O ecrã no Hub, pela sessão de uma pessoa, fica para
  depois.
- **Um pagamento depois de falhado ou expirado** pode usar outro método da
  régua (`POST /checkout/{token}/payment` com `metodo`), dentro das 24 h.
- **Por fazer:** a Stripe (parte 2, depois da Q2); a confirmação contra a
  sandbox da EuPago (V1, V4, V5); a retenção dos avisos em bruto (§7, entra
  na porta P2-3 do `docs/25`); o ecrã da fila no Hub.

