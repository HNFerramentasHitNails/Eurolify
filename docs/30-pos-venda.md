# Pós-venda — modelo e lista da API

> **Estado: desenho aprovado** (issue #328; `docs/06`, DM; Diogo, 10/10/2026:
> *«aprovado»*, Q1 a Q7 como propostas; fatia 11 do
> [`eurolify/implementation-plan.md`](eurolify/implementation-plan.md):
> «Pós-venda: livre resolução → devolução → reembolso → nota de crédito»).
> Diogo, 10/10/2026: *«aprovado»* (avançar com o desenho da fatia 11). Veio da
> Fase 2 para a Fase 1 pela decisão AD (ADR-0022, ponto 2). Depende das
> encomendas e do stock (`docs/27`), dos pagamentos (`docs/26`) e dos
> documentos fiscais (`docs/29`, que já deixou a nota de crédito prevista, §3.6).
>
> Número: era o `docs/29` até 10/10/2026; passou a 30 quando os documentos
> fiscais ficaram com o 29 (#332). A migração passou de 0051 a 0054 (a 0051
> e a 0053 são do rasto, #327 e #334; a 0052 dos consentimentos, #330) e
> depois a 0058 (a 0054 é do rasto, #340; a 0055 dos anexos da isenção, #338;
> a 0057 da chave de um agente de IA, #342).
>
> Skills seguidas: `consumer-rights-eu` (botão de livre resolução, prazo,
> excepções, reembolso, nota de crédito; consumidor ou profissional por
> encomenda), `order-fulfilment` (RMA: «volta mercadoria? ⇒ devolução; não
> volta? ⇒ problema»; estado do artigo; só o aceite volta a stock),
> `payments-psd2-sca` (reembolso ligado à nota de crédito e à devolução, pelo
> mesmo meio por omissão; nunca se repete), `eu-vat-oss-ioss` (a nota de
> crédito referencia o original e repete o tratamento fiscal dele; NC parcial
> não risca a fatura; reembolso ≠ nota de crédito; nunca em lote),
> `eurolify-transport-logistics-eu` (a rota de volta não se aprova pela de ida),
> `eu-gdpr-privacy` (o IBAN de um reembolso manual) e `headless-commerce`.
>
> 🔴 **Regra deste domínio** (lições 2.12, 2.13 e 3.5 do `docs/04`):
> 1. **Devolução = volta mercadoria; problema = não volta.** Cada um tem o seu
>    registo; nenhum reembolso nasce sem um dos dois.
> 2. **Só o que foi aceite na inspecção volta a stock**, por movimento; uma
>    cosmética aberta não volta.
> 3. **Reembolso e nota de crédito são dois registos, ligados.** Uma NC
>    parcial não risca a fatura toda: o estado da fatura calcula-se pelo saldo.
> 4. **O botão de livre resolução é servido pelo Eurolify**, durante todo o
>    prazo, com confirmação de recepção — nenhum frontend o pode esquecer.
>
> ⚠️ **As regras de prazo, excepções, portes e reembolso são C** (`docs/03`
> §2, linha 71: «**C**, jurista»): o desenho dá as peças e os prazos ficam
> configuráveis por país até o jurista validar. **Não verifiquei** se a EuPago
> reembolsa por API (o aviso 2.0 tem o estado `Refund`, `docs/26` V1; a forma
> de pedir um reembolso não está lida).

## 1. O que entra nesta fatia

| O quê | Fonte |
|---|---|
| **pedido de livre resolução** (`wdr_`) pelo botão: o consumidor identifica a encomenda e as linhas; o Eurolify confirma a recepção com data e hora | `consumer-rights-eu`, «Botão de livre resolução» (art. 11.º-A da Dir. 2011/83/UE, **W**) |
| **devolução** (`rma_`): origem (livre resolução, apoio, comercial), linhas, motivo, recepção, inspecção com o estado do artigo, decisão | `order-fulfilment`, «Devoluções (RMA)» |
| **problema** (`prb_`): sem mercadoria de volta (chegou partido, faltou uma peça, atraso); decisão de reembolso total ou parcial | regra 1; lição 3.5 |
| **movimento de stock `devolucao`** (com o lote da saída original) só para o aceite | regra 2; `docs/27` R1 e R5 |
| **reembolso** (`rfd_`): ligado à devolução ou ao problema e à nota de crédito; pelo mesmo meio (adaptador) ou manual (transferência registada por uma pessoa, com prova) | `payments-psd2-sca`, «Captura, reembolso, disputa»; Q2 |
| **nota de crédito**: um pedido de documento `nota_credito` no domínio da fatia 10, que referencia a fatura e repete o tratamento fiscal dela, linha a linha | `eu-vat-oss-ioss`, «Notas de crédito»; `docs/29` §3.6 |
| **saldo da fatura** (faturado − creditado) e o estado da encomenda depois de devolvida | regra 3; lição 2.13 |
| **cancelar uma encomenda paga ainda não expedida** (deixado pela fatia 9) | `docs/27` §1, «Fora desta fatia»; Q7 |

**Fora desta fatia:**

| O quê | Onde |
|---|---|
| troca e carteira (crédito em vez de reembolso) | Fase 2 (`docs/05`; ADR-0022); a carteira com o contabilista (`eu-vat-oss-ioss`, Dir. (UE) 2016/1065, **C**) |
| garantia legal (reparação, substituição, redução do preço; +12 meses com reparação) | fatia própria (`consumer-rights-eu`, «Garantia legal e reparação») |
| etiqueta de devolução pela transportadora | parte 2 da fatia 9 (adaptadores); aqui a transportadora e o seguimento da volta escrevem-se à mão |
| o envio da confirmação por e-mail | fatia de Notificações (como a confirmação da encomenda, `docs/25` Q4): aqui guarda-se o documento e devolve-se ao cliente |
| disputas e estornos do prestador | `payments-psd2-sca`, «Disputas»; fatia própria |
| conteúdos digitais e serviços | `digital-products-eu` (fatia 12, desligada) |

## 2. Fronteira

| Decide | Quem |
|---|---|
| se há direito de livre resolução (consumidor, prazo, excepção) | este domínio, por regras configuráveis por país (**C**) |
| o que voltou e em que estado | a pessoa do armazém, na inspecção (`returns:write`) |
| reembolsar, quanto e como | uma pessoa com `refunds:write` (Q6) |
| o tratamento fiscal da nota de crédito | **o da fatura original** (copiado, nunca recalculado) |
| emitir a nota de crédito | o software certificado, pelo pipeline da fatia 10 (retenção, dois passos, prova) |
| devolver o dinheiro | o prestador (pelo adaptador) ou o comerciante (transferência manual, registada) |

## 3. Modelo

### 3.1 Pedido de livre resolução (`wdr_`)

| Campo | Regra | Fonte |
|---|---|---|
| `encomenda`, `linhas` (linha, quantidade) | só linhas entregues ou por entregar da encomenda; quantidade ≤ expedida − já pedida | — |
| `origem` | `botao` (o cliente) ou `apoio` (uma pessoa regista um pedido que chegou por outra via, com a prova) | `order-fulfilment`, «Pedido» |
| `recebido_em` | do relógio da base; é a data da comunicação | `consumer-rights-eu` (confirmação com data e hora) |
| `prazo_ate` | a data-limite calculada (entregue + dias do país; **14 dias por omissão, C**) e gravada | `docs/03` §2, linha 71 |
| `dentro_do_prazo` | sim/não no momento; **fora do prazo o pedido regista-se na mesma** e vai para uma pessoa (o Eurolify não recusa um direito por um cálculo que é **C**) | regra «na dúvida» do projecto |
| `confirmacao` | o documento de confirmação de recepção (encomenda, linhas, data e hora), guardado e devolvido ao cliente | art. 11.º-A (**W**) |
| `contacto` | o e-mail com que o cliente se identificou (o da encomenda) | `eu-gdpr-privacy` (minimização) |

Só para encomendas com `finalidade = consumo` (Q1). Uma encomenda de
profissional não mostra o botão; uma devolução comercial regista-se pelo
apoio.

### 3.2 Devolução (`rma_`)

| Campo | Regra | Fonte |
|---|---|---|
| `encomenda`, `origem` | `livre_resolucao` (com o `wdr_`), `apoio`, `comercial` | `order-fulfilment` |
| `linhas` | linha da encomenda, quantidade pedida, recebida, aceite (volta a stock), não aceite; **estado do artigo** (`revendavel`, `aberto`, `danificado`, `em_falta`) | regra 2 |
| `transportadora`, `seguimento` | à mão nesta fase | Fora desta fatia |
| `armazem` | o da loja (um por loja, `docs/27` Q1) | — |
| `estado` | §4.2 | — |

### 3.3 Problema (`prb_`)

| Campo | Regra |
|---|---|
| `encomenda`, `linhas` (opcional), `tipo` | `chegou_danificado`, `em_falta`, `atraso`, `outro` |
| `descricao`, `prova` | texto e anexos (fotografia do cliente) |
| `estado` | aberto → decidido (reembolso, nada) → fechado |

### 3.4 Reembolso (`rfd_`)

| Campo | Regra | Fonte |
|---|---|---|
| `origem` | a devolução ou o problema (obrigatório: regra 1), ou o cancelamento (Q7) | regra 1 |
| `pagamento` | o pagamento capturado da encomenda | `docs/26` |
| `linhas` | linha, quantidade, montante (o que foi pago por ela, com IVA); os portes como linha própria (Q4) | lição 3.6 |
| `montante` | a soma; **nunca acima do que foi pago menos o já reembolsado** (a base garante) | `payments-psd2-sca` |
| `via` | `prestador` (o adaptador `reembolsar`, quando o método o permite) ou `manual` (uma pessoa regista a transferência e a prova) | Q2 |
| `iban` | só no manual, cifrado como as credenciais, mostrado mascarado; apaga-se ao fim do prazo de conciliação (**C**) | `eu-gdpr-privacy` |
| `estado` | §4.3 | `payments-psd2-sca` |
| `nota_credito` | o `inv_…` da nota de crédito que lhe corresponde, quando a fatura foi emitida pelo Eurolify | regra 3 |

### 3.5 Nota de crédito (no domínio dos documentos fiscais)

- É um `documento_fiscal` com `tipo = nota_credito` e `original` = a fatura
  (`inv_…`), que tem de estar `emitido` (ou `resolvido`).
- O **conteúdo copia as linhas da fatura** (taxa, motivo de isenção, regra,
  evidência) na proporção das quantidades creditadas; nunca recalcula
  (`eu-vat-oss-ioss`, «repete o tratamento fiscal dele, mesmo que as taxas
  tenham mudado»). Os portes creditam-se como linha própria.
- Passa pelo mesmo pipeline: verificações (mais: `original_por_emitir`,
  `credito_acima_do_saldo`), rascunho, conferir, fechar, prova lida de volta.
- **Saldo da fatura** = total da fatura − soma das notas de crédito emitidas;
  a base recusa uma NC acima do saldo; a fatura fica `creditada_parcial` ou
  `creditada` pelo saldo, nunca por «tem NC» (lição 2.13).
- Com **sistema próprio** (ADR-0041), não há NC no Eurolify: o evento
  `refund.completed` leva as linhas para o sistema do comerciante emitir.

## 4. Estados

### 4.1 Pedido de livre resolução

`recebido` → `aceite` (abre a devolução) | `fora_de_prazo` (uma pessoa decide:
aceitar ou responder ao cliente) | `cancelado_pelo_cliente`.

### 4.2 Devolução

```
pedida ─▶ a_aguardar ─▶ recebida ─▶ inspeccionada ─▶ decidida ─▶ fechada
   └──────────────┴──────────────▶ cancelada
```

- **recebida:** o armazém regista o que chegou (quantidade por linha).
- **inspeccionada:** o estado de cada linha; o aceite gera o movimento
  `devolucao` no livro do stock (com o lote da saída original); o não aceite
  não mexe no stock.
- **decidida:** uma pessoa decide o reembolso (linhas e montante) — abre o
  `rfd_` e, se a fatura foi emitida pelo Eurolify, o pedido de NC.

### 4.3 Reembolso

```
a_decidir ─▶ a_executar ─┬─▶ executado
                         ├─▶ incerto ──(reconciliação)──▶ executado | a_executar
                         └─▶ falhado ──(pessoa)──▶ a_executar | manual
```

- Pelo prestador, como os pagamentos: a nossa referência vai na chamada;
  timeout → `incerto`, nunca se repete às cegas (`docs/26`, R3 e R4).
- Manual: uma pessoa regista a transferência (data, montante, prova); fica
  `executado` com a prova.

### 4.4 A encomenda e a fatura depois

- A encomenda ganha `devolvida_parcial` e `devolvida` (pela soma das linhas
  aceites e reembolsadas), só para a frente; `concluida` não volta atrás, mas
  um pedido de livre resolução dentro do prazo é aceite mesmo assim (a
  conclusão aos 14 dias é um estado de operação, `docs/27` §12).
- A fatura ganha o saldo (§3.5).

## 5. Regras

| # | Regra | Fonte |
|---|---|---|
| R1 | Nenhum reembolso sem devolução, problema ou cancelamento (a base garante) | regra 1 |
| R2 | O botão de livre resolução é uma rota da API da Loja, servida pelo Eurolify, disponível enquanto houver linhas dentro do prazo; o pedido fica registado mesmo fora do prazo, para uma pessoa | `consumer-rights-eu` |
| R3 | O prazo, as excepções (selados por higiene) e quem paga a volta são **por país**, configuráveis, com fonte; por omissão 14 dias a contar da entrega (**C**) | `docs/03` §2 |
| R4 | Só o aceite na inspecção volta a stock, por movimento `devolucao`, com o lote da saída; uma linha `aberto` de um artigo marcado «selado por higiene» não volta | regra 2; `product-compliance-eu` |
| R5 | Reembolso ≤ pago − já reembolsado, por linha e no total | `payments-psd2-sca` |
| R6 | Reembolso pelo mesmo meio por omissão; outro meio só com o pedido do cliente registado (**C**) | `consumer-rights-eu`, «Reembolso» |
| R7 | O reembolso nunca se repete: referência nossa, incerto reconciliado | `docs/26` R3, R4 |
| R8 | A NC copia o tratamento fiscal da fatura e não passa o saldo dela | regra 3 |
| R9 | Nenhuma acção em lote: decidir, reembolsar, emitir NC — um de cada vez | lição 2.10 |
| R10 | Um prazo de reembolso (14 dias, **C**) conta-se do pedido; a decisão mostra quantos dias faltam e a tarefa avisa antes de acabar | `consumer-rights-eu` |
| R11 | Cancelar uma encomenda paga não expedida liberta as reservas, reembolsa tudo e, com fatura emitida, pede a NC total | Q7 |

## 6. Dados pessoais

- O pedido de livre resolução guarda o e-mail com que o cliente se
  identificou e a confirmação; a devolução não guarda dados novos do cliente.
- O **IBAN** de um reembolso manual é dado pessoal: cifrado, mascarado nas
  leituras, só com `refunds:write`, apagado depois do prazo de conciliação
  (**C**, contabilista).
- As fotografias de um problema podem ter dados pessoais: guardam-se como
  anexos da encomenda, com a retenção dela.

## 7. Lista da API

### 7.1 API da Loja (o botão)

| Rota | O quê |
|---|---|
| `GET /store/orders/{token}/withdrawal` | as linhas que ainda se podem devolver e o prazo de cada uma (o token é o da confirmação da encomenda) |
| `POST /store/orders/{token}/withdrawal` | o pedido (linhas, quantidades); devolve a confirmação de recepção com data e hora |

### 7.2 API de Administração

| Rota | Âmbito |
|---|---|
| `GET /withdrawals`, `GET /withdrawals/{id}`, `POST /withdrawals` (registo pelo apoio), `POST /withdrawals/{id}/decide` (fora do prazo) | `returns:read` / `returns:write` |
| `GET /returns`, `POST /returns`, `GET /returns/{id}`, `POST /returns/{id}/receive`, `POST /returns/{id}/inspect`, `POST /returns/{id}/cancel` | `returns:read` / `returns:write` |
| `POST /problems`, `GET /problems/{id}` | `returns:write` / `returns:read` |
| `POST /returns/{id}/decide`, `POST /problems/{id}/decide` (abre o reembolso e a NC) | `refunds:write` |
| `GET /refunds`, `GET /refunds/{id}`, `POST /refunds/{id}/execute`, `POST /refunds/{id}/manual` (regista a transferência), `POST /refunds/{id}/reconcile` | `refunds:read` / `refunds:write` |
| `POST /orders/{id}/cancel` (paga, não expedida) | `refunds:write` |
| `GET /invoices/{id}` passa a mostrar as NC e o saldo | `invoices:read` |

Âmbitos novos: `returns:read`, `returns:write`, `refunds:read`,
`refunds:write`. Papéis (proposta, Q6): dono todos; gestor todos; armazém
`returns:read` e `returns:write`; apoio `returns:read`, `returns:write` e
`refunds:read`.

### 7.3 Eventos

`withdrawal.requested`, `return.created`, `return.received`,
`return.inspected`, `return.decided`, `problem.created`, `refund.created`,
`refund.completed`, `refund.failed`, `order.returned`,
`order.partially_returned`; os `invoice.*` da NC. Só identificadores e
montantes; nunca o IBAN.

### 7.4 O contrato do adaptador de pagamento

`reembolsar(credenciais, pagamento, montante, referencia)` (já previsto,
`docs/26` §9) e `consultarReembolso(referencia)`. O adaptador diz se o método
reembolsa por API; se não, o reembolso é manual.

## 8. Por onde é que isto ainda pode sair errado

| Risco | O que o trava |
|---|---|
| NC sem devolução registada (91 em 90 dias, lição 3.5) | R1 |
| cosmética aberta de volta ao stock | R4 |
| NC parcial a riscar a fatura (lição 2.13) | saldo pela soma (§3.5) |
| reembolso a dobrar | R5 e R7 |
| reembolso mais do que pago | R5 (a base garante) |
| NC com a taxa de hoje em vez da da fatura | R8 |
| botão esquecido num frontend | R2: servido pela API da Loja; o link vai na confirmação |
| prazo de reembolso ultrapassado sem ninguém ver | R10 |
| correcções em massa | R9 |

## 9. Perguntas para o Diogo ou o Bruno

| # | Pergunta | Proposta |
|---|---|---|
| Q1 | **Livre resolução para profissionais?** | **não** pelo botão (o direito é do consumidor); uma devolução comercial regista-se pelo apoio |
| Q2 | **Como se reembolsa o Multibanco e o MB WAY?** | **manual nesta parte** (o comerciante transfere e regista a prova; o IBAN pede-se ao cliente), até lermos a documentação da EuPago sobre reembolsos; o adaptador entra quando estiver verificado |
| Q3 | **Quando se reembolsa uma devolução?** | **depois de recebida e inspeccionada** (ou com a prova de envio do cliente, se chegar primeiro), dentro do prazo do país (**C**); um problema sem mercadoria, logo depois da decisão |
| Q4 | **Os portes?** | na livre resolução, **reembolsa-se a entrega inicial** e a volta paga-a o cliente, salvo se o comerciante oferecer (**C**, jurista); num problema, decide a pessoa |
| Q5 | **O que volta a stock?** | **só o `revendavel`**; `aberto` de um artigo selado por higiene e `danificado` não voltam (fica registado na devolução, sem movimento) |
| Q6 | **Quem faz o quê?** | o **armazém** recebe e inspecciona; **dono e gestor** decidem reembolsos e cancelamentos; o **apoio** regista pedidos e vê reembolsos |
| Q7 | **Cancelar uma encomenda paga ainda não expedida?** | **sim**, por uma pessoa com `refunds:write`: liberta as reservas, reembolsa tudo e pede a NC total se a fatura saiu; o cliente usa o botão de livre resolução |

## 10. Para o jurista e o contabilista (bloqueiam a produção, não o código)

| # | Pergunta |
|---|---|
| J1 | Prazo de livre resolução por país e os casos especiais (encomenda em várias entregas, bens feitos por medida) |
| J2 | Excepções aplicáveis à cosmética e aos químicos (selados por higiene) e como se informa o cliente |
| J3 | Quem paga a volta e o reembolso dos portes iniciais |
| J4 | Prazo do reembolso e o direito de reter até receber o bem ou a prova de envio |
| J5 | O botão de livre resolução: requisitos da transposição em Portugal (e nos outros países) |
| C1 | A NC antes ou depois do reembolso; o prazo para a emitir |
| C2 | Uma encomenda reembolsada por inteiro antes de a fatura sair: emite-se fatura e NC, ou nenhuma? (Até à resposta: **retém** a fatura, com o motivo `encomenda_reembolsada`) |
| C3 | O reembolso manual: que prova de transferência se guarda, e por quanto tempo o IBAN |
| C4 | O relatório OSS: as NC entram com sinal negativo no período da NC ou da fatura (`eu-vat-oss-ioss`, «OSS e IOSS») |

## 11. Como entra no código (quando aprovado)

- **Parte 1:**
  - migração: pedido de livre resolução, devolução, problema, reembolso, o movimento `devolucao`, os estados novos da encomenda, a NC no domínio dos documentos (com o saldo) e os âmbitos;
  - o botão na API da Loja, com a confirmação de recepção;
  - a devolução até à inspecção e ao stock;
  - a decisão, o reembolso manual e a NC pelo pipeline da fatia 10;
  - o cancelamento de uma encomenda paga não expedida;
  - testes: prazo e fora do prazo, devolução parcial, cosmética aberta não volta, reembolso acima do pago recusado, reembolso nunca a dobrar, NC com a taxa da fatura e acima do saldo recusada, NC parcial e saldo; mutações e a revisão do agente.
- **Parte 2:** o reembolso pelo adaptador (EuPago, depois de lida a documentação).
- Cada parte num pedido, com os testes verdes e a revisão do agente antes de juntar (ADR-0031, ADR-0035).

## 12. Em código — parte 1 (10/10/2026; migração 0058; `docs/06`, DM)

| O quê | Onde |
|---|---|
| `pedido_livre_resolucao` e as linhas, `devolucao` e as linhas, `problema`, `reembolso` e as linhas, com os estados da §4 garantidos pela base, RLS forçado e eventos `withdrawal.*`, `return.*`, `problem.*`, `refund.*` | migração 0058 |
| o movimento `devolucao` no livro do stock (aumenta o físico, com o lote da saída, pela composição congelada da linha) | migração 0058; `src/posvenda/repositorio.ts` |
| a encomenda `cancelada` (paga, sem expedição; liberta as reservas) e `devolvida_parcial` / `devolvida` (pelo reembolsado nas devoluções, só depois de entregue) | migração 0058 |
| R1 e R5 na base: um reembolso só nasce de uma devolução, de um problema ou do cancelamento, e ao sair do rascunho a soma das linhas é o montante, nenhuma linha passa o que se pagou por ela e o total não passa o pagamento | migração 0058 |
| a NC no domínio dos documentos: `nota_credito_pedir` ao decidir o reembolso (só se a encomenda tem fatura do Eurolify), as linhas e a proporção base/IVA da fatura (R8), os motivos `original_por_emitir`, `credito_acima_do_saldo` e `encomenda_reembolsada` (C2), a fatura com as NC e o saldo | migração 0058; `src/faturacao/` |
| o botão (`GET`/`POST /store/orders/{token}/withdrawal`) com a confirmação de recepção, e a API de Administração da §7.2 | `src/posvenda/rotas.ts` |
| âmbitos `returns:read`, `returns:write`, `refunds:read`, `refunds:write` e os papéis da Q6 | migração 0058; `src/identidade/` |
| 16 testes pela API | `test/posvenda-api.test.ts` |

**Desvios do desenho:**
- **Estados do pedido** (§4.1): `aceite`, `fora_de_prazo` (uma pessoa aceita
  ou recusa, com motivo), `pendente` (dentro do prazo, mas a devolução não
  abriu: a loja sem armazém, ou outra devolução ganhou as linhas; decide uma
  pessoa) e `recusado`. O «cancelado pelo cliente» faz-se
  cancelando a devolução que o pedido abriu (antes de inspeccionada).
- **Estados do reembolso** (§4.3): o `a_decidir` chama-se `rascunho` e só
  existe dentro da transacção que cria as linhas; a API entrega-o já
  `a_executar`. O manual regista-se de `a_executar` ou de `falhado`.
- **O token da confirmação** lê-se 30 dias (fatia 7); a rota do botão passa
  esse prazo, porque o direito conta da entrega, e não devolve dados
  pessoais (só linhas, quantidades e prazos).
- **O botão repetido** (duplo clique) não cria outro pedido: o segundo é
  recusado com `returns.quantity_exceeded`, porque as linhas já estão pedidas.
- **Os portes** (Q4): a pessoa que decide escolhe `incluir_portes`; não é
  automático.
- **R4 «selado por higiene»**: não há ainda a marca no artigo; aplica-se a Q5
  a tudo (só o `revendavel` aceite volta a stock).
- **R6 e R7**: nesta parte o reembolso é só manual (Q2); o mesmo meio e a
  referência no prestador ficam para a parte 2, com `/execute` e `/reconcile`.
- **O botão só serve linhas já expedidas.** Antes de expedir, o cliente
  desiste pelo apoio e a loja cancela a encomenda (Q7). Se o direito vale
  desde a celebração do contrato é **C** (jurista, J1).
- **O prazo é da encomenda** e conta da última entrega: enquanto falta
  entregar alguma coisa, ainda não começou (o mais favorável ao consumidor;
  **C**, J1).
- **O reembolso de uma devolução** vai até ao que voltou (`recebida`), não só
  ao aceite em stock: um artigo aberto que voltou pode ter de se reembolsar
  (**C**, J2).
- **Q3 «ou com a prova de envio do cliente»**: não programado; reembolsa-se
  depois de recebida e inspeccionada.
- **A fatura não ganha os estados `creditada`/`creditada_parcial`**: mostra as
  NC e o `saldo`. «A base recusa uma NC acima do saldo» é uma retenção
  (`credito_acima_do_saldo`), que só conta as NC já emitidas.
- **O IBAN não se guarda** (a §3.4 dizia «cifrado»): a prova é a data e a
  referência da transferência.
- **R10**: a devolução mostra `reembolsar_ate` e `dias_para_reembolsar`
  (14 dias do pedido, **C**); **por fazer** a tarefa que avisa antes do fim.
- **Encomenda devolvida** só a partir de `entregue` ou `concluida`: uma
  expedição ainda a caminho não fica presa a um estado de devolução.
- **Com sistema próprio** não há fatura no Eurolify, logo não há NC: é o
  sistema do comerciante que a emite (D-10).
- **Por fazer:** o reembolso pelo adaptador (parte 2), o aviso do prazo do
  reembolso (R10), a marca «selado por higiene», o jurista (J1 a J5) e o
  contabilista (C1 a C4).

**Correcções da revisão do #329** (Sonnet 5.5; 0 P0, 4 P1, 11 P2, 11 P3):
- **Linhas repetidas** (P1-1): a decisão recusa a mesma linha duas vezes; a
  base garante, por linha, a quantidade comprada e, numa devolução, o que
  voltou.
- **A NC sai pela ligação da fatura** (P1-2), nunca pela que estiver activa;
  se essa ligação estiver desligada, a NC fica retida.
- **Contra uma fatura divergente não sai NC** (P1-3): espera que uma pessoa a
  resolva, e resolver acorda as NC.
- **A NC só sai depois do dinheiro** (P1-4): motivo `reembolso_por_executar`
  até o reembolso ficar executado (a ordem final é a C1 do contabilista). Um
  reembolso `a_executar` ou `falhado` **anula-se** com motivo
  (`POST /refunds/{id}/cancel`): a devolução volta a `inspeccionada` e o
  problema a `aberto`, para decidir outra vez; a NC dele fica retida para
  sempre (`reembolso_cancelado`). O de um cancelamento não se anula.
- **O pedido fica sempre registado** (P2-1): `pendente` quando a devolução não
  abre. **Prazo pela última entrega** (P2-3). **Fechar sem reembolso**, com
  motivo (`POST /returns/{id}/close`, `POST /problems/{id}/close`; P2-5).
- **NC acordada sem corridas** (P2-4): a fatura lê-se com `FOR SHARE` ao
  verificar a NC. **Executado ou anulado, o reembolso não muda** (P2-6).
  **Stock por ordem da variante** em toda a inspecção (P2-7).
- **Sem NC, diz porquê** (`sem_nota_credito`: `sistema_proprio` ou
  `sem_fatura`), e os eventos do reembolso levam o montante e as linhas
  (P2-8). **O botão vai na confirmação** (`livre_resolucao`, só consumidores;
  P2-9). **O mesmo pedido à espera de uma pessoa não se grava outra vez**
  (P2-10).
- **Testes** (P2-11): ligação trocada, fatura divergente, NC acima do saldo,
  anular, linhas repetidas, fechar sem reembolso, prova imutável, sistema
  próprio, prazo com duas entregas, pedido pendente e dois pedidos ao mesmo
  tempo. R8 (a taxa da fatura): a NC não lê taxas, copia as linhas da fatura;
  a mutação que troca a proporção pela do pedido é apanhada.
- **P3 tratados:** a base confere a origem do reembolso (desta encomenda, no
  ponto certo) e que cada linha é da encomenda (P3-3); erros da faturação e
  dos pagamentos traduzidos (P3-11); o tecto de âmbitos por chave passou a
  60 (P3-14); eventos `problem.decided`, `problem.closed`,
  `problem.reopened` (P3-16).
- **P3 que ficam**, com a razão: a NC em voo não conta no saldo (P3-1;
  reembolsos já limitados ao pago); arredondamento de 1 cêntimo falha em
  segurança para `divergente` (P3-2); portes sem tecto próprio na base, só o
  do pagamento (P3-5); cancelar com um reembolso parcial já feito não passa
  (P3-6; devolve-se); o lote atribui-se pela ordem da saída (P3-7); o pedido
  não recebido não se liberta (P3-8); o armazém vê o e-mail do pedido de
  livre resolução (P3-10; o papel decide-o, a rever com o Hub); o movimento
  `devolucao` sai como `inventory.adjusted` (P3-12; muda-se com o stock);
  `prova` livre (P3-13); `falhado/incerto → a_executar` sem rever os tectos
  (P3-15; parte 2); listas sem paginação (P3-17); `meio_pagamento` (P3-18).


## 13. Parte 2 — o reembolso pela EuPago (desenho, 11/10/2026)

Pedido do Diogo, 11/10/2026: *«avança com a parte 2 da pós-venda»*.
**Aprovado pelo Diogo a 11/10/2026, com a Q8 em A** (*«aprovado, com a A»*;
`docs/06`, DP). A §11
diz «o reembolso pelo adaptador (EuPago, depois de lida a documentação)», e a
Q2 deixava o Multibanco e o MB WAY manuais **até** a lermos. Lida a
11/10/2026; o aviso do prazo (R10) e a marca «selado por higiene» (R4) ficam
para pedidos seus, depois deste.

### 13.1 O que se leu na documentação da EuPago

Lido em [docs.eupago.pt](https://docs.eupago.pt/reference) a 11/10/2026
(**W**: só a documentação pública; **nada corrido contra a sandbox**, porque
continua a não haver credenciais de teste, como em `docs/26` §12).

| # | Página | O que diz |
|---|---|---|
| E1 | [Refund](https://docs.eupago.pt/reference/refund) | `POST /api/management/v1.02/refund/{trid}`; corpo `amount` (obrigatório, em euros), `reason`, `iban`, `bic`; «aceita reembolsos parciais e totais»; resposta 201 `{"transactionStatus": "Success", "refundId": "9627"}`; recusas 400 `Rejected` com `IBAN_INVALID` ou `BAD_REQUEST` («Service don't have direct refund») e 401 `TOKEN_INVALID` |
| E2 | idem, nota | «Para o MB WAY e o cartão, não é obrigatório preencher o IBAN e o BIC; só são precisos se o prestador recusar o reembolso» |
| E3 | [Refund Information](https://docs.eupago.pt/reference/refund-information) | `GET /api/management/v1.02/refund/{refundId}`, com o `refundId` da resposta do E1; devolve `refundList.status`, com o exemplo `reembolsado`; 400 `REFUND_INVALID` |
| E4 | [Generate Bearer Token](https://docs.eupago.pt/reference/generate-bearer-token) | as duas rotas acima usam **OAuth**, não a chave da API: `POST /api/auth/token` com `client_id`, `client_secret` e `grant_type: client_credentials`; devolve `access_token` e `expires_in` (uma data, sem fuso) |
| E5 | [Avisos 2.0](https://docs.eupago.pt/reference/realtime-webhooks-20) | um aviso com o estado `Refund` (configurável como `REFUNDED`), com o `trid` (inteiro) e o montante |
| E6 | [MB WAY](https://docs.eupago.pt/reference/mbway) | a criação devolve um `transactionID` em hexadecimal, que não é o `trid` inteiro que o E1 pede |

Não se encontrou na documentação: uma chave de idempotência para o
reembolso; os outros valores de `refundList.status`; se o `Success` do E1
quer dizer que o dinheiro saiu ou só que o pedido foi aceite.

### 13.2 O que isto muda (propostas)

| # | O quê | Proposta | Fonte |
|---|---|---|---|
| P1 | **Credenciais** | a conta passa a guardar também o `client_id` e o `client_secret` (OAuth), cifrados no mesmo campo que a chave (AES-256-GCM, `PAGAMENTOS_CHAVE`); só o dono os põe. O token pede-se a cada reembolso e não se guarda (os reembolsos são um de cada vez, R9). Uma conta sem eles reembolsa só à mão | E4; `docs/26` Q3 |
| P2 | **O `trid`** | guarda-se no pagamento quando um aviso assinado o dá como pago (o `trid` vem no aviso, E5); a migração preenche os que já existem a partir dos avisos guardados. Um pagamento dado como pago só por consulta não tem `trid`: reembolsa-se à mão | E1, E5, E6 |
| P3 | **Quais métodos** | **MB WAY** pelo prestador (E2: sem IBAN). **Multibanco: ver a Q8** | E2 |
| P4 | **Executar** (`POST /refunds/{id}/execute`, `refunds:write`) | só um reembolso `a_executar` de um pagamento EuPago com `trid` e uma conta com as credenciais OAuth. Antes da chamada, grava-se o pedido (quem, quando) e o reembolso passa a `via = prestador`; a nossa referência (`rfd_…`) vai no `reason`, porque a EuPago não tem chave de idempotência | E1; R7 |
| P5 | **Resposta** | 201 `Success` com `refundId` → estado novo **`a_confirmar`**, com o `refundId`: o pedido foi aceite, falta saber se o dinheiro saiu. `Rejected` → `falhado`, com o código (ex.: `BAD_REQUEST` = o serviço não reembolsa directamente → uma pessoa regista-o à mão). Tempo esgotado, 5xx ou resposta que não se lê → `incerto`, **nunca se repete sozinho** | E1; `docs/26` R3, R4 |
| P6 | **Confirmar** | uma tarefa de minuto a minuto (como a dos pagamentos) consulta o E3 para cada `a_confirmar`: `reembolsado` → `executado` (e a NC acorda); outro valor fica como está; ao fim de 7 dias sem `reembolsado`, abre uma diferença para uma pessoa. Um aviso `Refund` assinado acorda a consulta dos reembolsos `a_confirmar` desse pagamento, mas sozinho não marca nada (com reembolsos parciais, não diz qual foi) | E3, E5 |
| P7 | **Reconciliar** (`POST /refunds/{id}/reconcile`, `refunds:write`) | para o `incerto` (não há `refundId`, por isso nada se consulta): uma pessoa vê no back-office da EuPago e diz `executado` (com o identificador do reembolso como prova) ou `nao_saiu` (volta a `a_executar`, e pode executar outra vez). Uma de cada vez, com motivo | R7, R9 |
| P8 | **Tectos ao voltar a `a_executar`** | a base volta a conferir R5 (o pago menos o já reembolsado) quando um `falhado` ou um `incerto` volta a `a_executar` (era a P3-15 da revisão do #329) | R5 |
| P9 | **Eventos** | `refund.requested` (a_confirmar) e os que já existem (`refund.completed`, `refund.failed`, `refund.uncertain`); só identificadores e montantes | §7.3 |

### 13.3 Pergunta para o Diogo ou o Bruno

| # | Pergunta | Proposta |
|---|---|---|
| Q8 ✅ **A** (Diogo, 11/10/2026) | **O Multibanco pela EuPago?** A nota E2 só dispensa o IBAN no MB WAY e no cartão: lida ao contrário, um Multibanco precisa do IBAN do cliente (**M**: dedução da nota, não está escrito). | **A — o Multibanco continua à mão** (o comerciante transfere e regista a prova, como na parte 1): o Eurolify não recebe IBANs, a C3 do contabilista continua por responder e não há sandbox para confirmar. B seria a pessoa escrever o IBAN ao executar, enviado à EuPago sem se guardar |

### 13.4 Por verificar (bloqueiam o modo real, não o código)

| # | O quê |
|---|---|
| V7 | o pedido e a resposta do E1 na sandbox, com credenciais OAuth de teste |
| V8 | os valores de `refundList.status` além de `reembolsado` (E3) e se o `Success` do E1 quer dizer «dinheiro saído» |
| V9 | o fuso do `expires_in` do token (E4); não se usa, porque o token não se guarda |
| V10 | se o `trid` do aviso (E5) é o que o E1 pede, num pagamento real de teste |
