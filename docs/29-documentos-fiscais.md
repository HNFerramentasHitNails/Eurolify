# Documentos fiscais — modelo e lista da API

> **Número:** até 10/10/2026 este documento foi o `docs/28`; passou a 29
> porque o 28 já era o rasto de auditoria (#332). A migração 0050 cita-o
> ainda como `docs/28` (linhas 1, 487 e 617): é este documento.

> **Estado: desenho aprovado; parte 1 no código** (issue #310; migração
> 0050; `docs/06`, DI). Diogo, 10/10/2026: *«sim, aprovo; avança com o
> código da fatia 10»* (Q1 a Q7 como propostas). O que está programado e os
> desvios dizem-se na §12. Fatia 10 do
> [`eurolify/implementation-plan.md`](eurolify/implementation-plan.md):
> «Documento fiscal por adaptador (Moloni) e prova do documento»). Diogo,
> 10/10/2026: *«sim, avança com o desenho da fatia 10»*. Depende do Motor de
> IVA (`docs/24`, a decisão por linha), do checkout (`docs/25`, a cópia
> guardada no botão final), dos pagamentos (`docs/26`, `order.paid` e o meio
> real) e das encomendas (`docs/27`).
>
> Skills seguidas: `eu-vat-oss-ioss` (regra zero, «Documentos — emissão,
> retenção e prova», NIF, arredondamentos, notas de crédito),
> `eurolify-tax-pos-invoicing-eu` (estados separados: pedido, retido,
> emitido, corrigido; timeout reconcilia, não reemite), `third-party-extensions`
> (o adaptador de faturação só **traduz** uma decisão já tomada; o nosso usa
> o mesmo contrato que um terceiro), `observability-security` (credenciais
> cifradas, registo de cada chamada, tarefas que não param em silêncio),
> `eu-gdpr-privacy` (o documento guarda dados pessoais 10 anos) e
> `headless-commerce` (idempotência, erros, eventos).
>
> Decisões que este desenho segue, sem as reabrir: **ADR-0037** (o documento é
> emitido pelo software certificado do comerciante, por adaptador; o Eurolify
> decide o IVA e guarda a prova) e **ADR-0041** (com sistema de gestão próprio,
> emite o sistema dele; uma venda nunca tem os dois emissores).
>
> 🔴 **Regra deste domínio** (`AGENTS.md`, «Não se erra em documentos
> fiscais»; lições 1.10, 2.5, 2.6, 2.9 e 2.10 do `docs/04`):
> 1. **Na dúvida, retém** — nunca emite à sorte. Um documento errado não se
>    apaga.
> 2. **O documento nasce da cópia do checkout**, nunca de um novo cálculo: se
>    foi cobrado IVA, o documento leva IVA.
> 3. **A prova é o documento emitido**, lido de volta do emissor; nunca o que
>    quisemos enviar.
> 4. **Nunca em lote**: uma correcção ou um reenvio é uma decisão de uma
>    pessoa, linha a linha.
> 5. **Um timeout não é «não emitido»**: reconcilia-se antes de tentar outra
>    vez.
>
> ⚠️ **Nada da API do Moloni está verificado nesta sessão.** O que se diz do
> Moloni vem das lições do Hub interno (`docs/04`, 2.6; `eu-vat-oss-ioss`,
> «No adaptador do Moloni») e marca-se **M**; o resto (pedidos, campos,
> autenticação) lê-se na documentação oficial antes da parte 2 (Q5).

## 1. O que entra nesta fatia

| O quê | Fonte |
|---|---|
| **quem emite, por entidade legal**: o Eurolify por adaptador, ou o sistema de gestão do comerciante; copiado para a encomenda no botão final (Q6) | ADR-0041, «Consequências» |
| **a ligação ao emissor** (`isx_`): adaptador, modo teste ou real, credenciais cifradas, série e o mapa das taxas (país, taxa) para as do emissor | ADR-0037; `eu-vat-oss-ioss`, regra 7 |
| **o pedido de documento** (`inv_`): nasce de `order.paid`, com a cópia da encomenda; uma fatura por encomenda | skill, «O rascunho só nasce depois de o pagamento estar confirmado» |
| **as verificações antes de emitir** e a **retenção** com motivo e saídas humanas | skill, «Retém em vez de emitir quando» |
| **a emissão em dois passos**: rascunho no emissor, conferir, fechar | skill («o rascunho leva o identificador da entidade»), **M** |
| **a prova**: o documento lido de volta (número, NIF, taxas, totais do cabeçalho, PDF) e a comparação com o pedido | lições 2.6 e 2.9 |
| **o incerto e a reconciliação** quando o emissor não responde | `eurolify-tax-pos-invoicing-eu`, 5 |
| **a fila** dos retidos, incertos e divergentes, com decisão linha a linha | lição 2.10 |
| **a nota de carimbo** nas observações («destino ES · IVA 21 %») | skill, «Nota de carimbo» |
| **o perfil «usado em documento»** (`docs/23`, R4) | `docs/23` §3, Q3 |
| **um adaptador de ensaio** (parte 1) que se comporta como um emissor e só existe em modo teste | `third-party-extensions`, regra 1 (teste de conformidade do contrato) |

**Fora desta fatia:**

| O quê | Onde |
|---|---|
| o adaptador **Moloni** real | parte 2 desta fatia (Q5) |
| notas de crédito e reembolsos | fatia 11 (pós-venda); o modelo deixa-as previstas (§3.6) |
| o relatório OSS com os quatro baldes e o fecho mensal | parte 3 desta fatia (lê as provas, nunca os pedidos) |
| adaptadores de outros países (Verifactu, Plateforme Agréée, KSeF…) | um por regime, cada um com o seu contabilista (ADR-0037) |
| caixa, POS, recibos de balcão | `eurolify-tax-pos-invoicing-eu`, fatia própria |
| o cliente descarregar a fatura na loja | com a área do cliente; nesta fatia a API de Administração dá o PDF |
| emitir para encomendas de comerciantes com sistema próprio | nunca (ADR-0041); o Eurolify só lhes entrega a encomenda |

## 2. Fronteira

| Decide | Quem |
|---|---|
| o IVA de cada linha, o motivo e a evidência | Motor de IVA (`docs/24`), no checkout; aqui **só se lê** |
| o NIF, o nome, a morada fiscal | o perfil copiado na encomenda (`docs/23`, `docs/25`) |
| o número, a série, o ATCUD, o QR, a assinatura | **o software certificado** (`docs/03` §1, **C** + **M**) |
| se sai, fica retido ou vai para a fila | este domínio, por regras escritas (§5) |
| libertar, corrigir, dar por resolvido | **uma pessoa**, com o âmbito próprio (§7) |

## 3. Modelo

### 3.1 Quem emite (na entidade legal e na encomenda)

| Campo | Regra | Fonte |
|---|---|---|
| `emissor` na entidade legal | `eurolify` (pelo adaptador), `sistema_proprio` (ADR-0041) ou `por_configurar` (por omissão) | ADR-0041 |
| `emissor` na encomenda | **copiado** no botão final e imutável; mudar a entidade depois só vale para encomendas novas | ADR-0041 («uma venda nunca pode ter os dois»); Q6 |

Uma encomenda com `sistema_proprio` **nunca** tem pedido de documento: a base
recusa-o (gatilho), não só o código. Uma encomenda `por_configurar` paga fica
retida com o motivo `emissor_por_configurar` — não se perde, e não sai.

### 3.2 Ligação ao emissor (`isx_`)

| Campo | Regra | Fonte |
|---|---|---|
| `entidade_legal` | uma ligação activa por entidade | — |
| `adaptador` | `ensaio` (parte 1, só modo teste) ou `moloni` (parte 2) | Q5 |
| `modo` | `teste` ou `real`; **no ensaio só `teste`** (ADR-0019: nenhum dado real); um pagamento de teste nunca gera documento real (`docs/26`, R9) | ADR-0019 |
| `credenciais` | cifradas com AES-256-GCM, chave fora da base, como as contas de pagamento (`docs/26` §3.1); nunca saem pela API | `observability-security` |
| `serie` | a série do emissor onde saem os documentos (por loja, se o contabilista o pedir — V3) | **C** |
| `taxas` | o mapa (país, percentagem) → taxa do emissor; uma taxa do emissor **nunca** serve dois países | skill, regra 7; lição 2.7 |
| `isencoes` | o mapa (código do motivo, ex.: `M05`, `M16`) → isenção do emissor | `docs/24`, Q4 |
| `testada_em`, `estado` | `por_testar`, `pronta`, `com_erro`; só uma ligação `pronta` emite | — |

### 3.3 Pedido de documento (`inv_`)

| Campo | Regra | Fonte |
|---|---|---|
| `encomenda` | **um pedido de fatura por encomenda** (único na base) | lição 4.4 |
| `tipo` | `fatura` nesta fatia (o tipo exacto no emissor — fatura ou fatura-recibo — é do contabilista, V1); `nota_credito` fica para a fatia 11 | **C** |
| `conteudo` | a cópia do que vai sair, montada **só** da encomenda: entidade, perfil copiado (NIF, nome do documento, morada, país do contribuinte), linhas com a decisão de IVA, portes como linha própria, totais, moeda, meio de pagamento real (`docs/26`), a nota de carimbo | regra 2; lição 3.6 |
| `impressao` | o resumo (SHA-256) do `conteudo`: o que se confere antes de fechar e o que a prova tem de repetir | — |
| `modo` | copiado do pagamento: `teste` só vai a uma ligação `teste` | `docs/26`, R9 |
| `estado` | §4.1 | — |
| `motivos` | os motivos de retenção (lista fechada, §5) | skill |
| `referencia` | a nossa referência no emissor (`inv_…`), escrita no documento para o reencontrar | §4.2 |
| `emissor_id` | o identificador do rascunho ou do documento no emissor | — |
| `versao` | para a fila (decisões concorrentes) | — |

Correcções antes de emitir (Q4) **não mexem na encomenda**: guardam uma
**versão nova do conteúdo** no pedido, com quem, quando e o motivo, e o
conteúdo antigo fica (só se acrescenta).

### 3.4 Prova do documento (`ivp_`)

| Campo | Regra | Fonte |
|---|---|---|
| `pedido` | uma prova por documento emitido | — |
| `numero`, `serie`, `data`, `atcud` | **como o emissor os devolve**; nunca os inventamos | `eurolify-tax-pos-invoicing-eu`, 4 |
| `nif`, `nome`, `pais` | **lidos do documento**, não do pedido (o NIF que sai é o da entidade do emissor) | lição 2.6; skill, **M** |
| `linhas` | descrição, quantidade, base, taxa ou motivo de isenção, IVA | — |
| `totais` | base, IVA e total **do cabeçalho**, como o emissor os devolve | lição 2.9 |
| `pdf` | o ficheiro do documento, guardado no armazenamento do Eurolify | regra 3 |
| `em_bruto` | a resposta do emissor tal como chegou | lição 4.3 |
| `divergencias` | a comparação com o pedido, campo a campo (§5, R7) | regra 3 |

A prova só se acrescenta: não se edita nem se apaga (gatilho, como o livro do
stock).

### 3.5 Rasto do pedido

Cada passo fica numa tabela que só se acrescenta: criado, retido (motivos),
libertado (quem, porquê), conteúdo corrigido, rascunho criado, conferido,
fechado, incerto, reconciliado, divergente, resolvido. Cada chamada ao emissor
fica no registo de entregas do comerciante (`docs/08` §4), sem credenciais.

### 3.6 Previsto para a fatia 11

A nota de crédito é outro pedido (`tipo = nota_credito`) que **referencia o
documento original e repete o tratamento fiscal dele** (taxa e motivo de
então); o estado da fatura calcula-se pelo saldo (lição 2.13). Nada disto se
programa nesta fatia; o modelo não o impede.

## 4. Estados

### 4.1 Pedido

```
a_verificar ─┬─▶ retido ──(pessoa liberta ou corrige)──▶ a_verificar
             └─▶ pronto ─▶ rascunho ─┬─▶ emitido ─┬─▶ (prova igual)       ✔
                                     │            └─▶ divergente ──(pessoa)──▶ resolvido
                                     ├─▶ retido (o rascunho não bate; apaga-se o rascunho)
                                     └─▶ incerto ──(reconciliação)──▶ emitido | pronto
```

- **`a_verificar`**: corre as verificações (§5). Falha alguma → `retido`.
- **`pronto`**: pode ir ao emissor. Sem ligação `pronta`, fica `retido`.
- **`rascunho`**: criado no emissor; lê-se de volta e confere-se (entidade,
  NIF, taxas, totais). Não bate → apaga-se o rascunho e `retido`.
- **`emitido`**: fechado no emissor e **lido de volta** (a prova).
- **`incerto`**: o emissor não respondeu a tempo depois de um pedido que
  **pode** ter criado ou fechado alguma coisa.
- **`divergente`**: emitido, mas a prova não bate com o pedido. Um documento
  emitido não se apaga: vai para a fila e uma pessoa decide (na fatia 11, a
  nota de crédito).
- **`resolvido`**: uma pessoa olhou para a divergência e decidiu, com motivo.

### 4.2 Incerto e reconciliação

1. Antes de chamar o emissor, o pedido muda de estado e escreve a nossa
   `referencia` no documento (campo de referência do emissor, **por
   verificar** no Moloni — Q5).
2. Timeout ou erro de rede → `incerto`. **Não se repete o pedido.**
3. A reconciliação **procura no emissor pela referência**: encontrou → lê de
   volta e segue para `emitido` (ou continua a partir do rascunho);
   confirmou que não existe → `pronto`.
4. Se o emissor não deixa procurar pela referência, ou a resposta é ambígua,
   **fica na fila** e uma pessoa decide (com o ecrã do emissor à frente).

## 5. Regras

| # | Regra | Fonte |
|---|---|---|
| R1 | O pedido só nasce de `order.paid`, numa encomenda com `emissor = eurolify`; com `sistema_proprio` a base recusa | skill; ADR-0041 |
| R2 | O conteúdo monta-se **só** da encomenda e do pagamento; nenhuma taxa, NIF ou montante é recalculado | regra 2; lição 2.5 |
| R3 | **Retém** com motivo (lista fechada): `emissor_por_configurar`, `ligacao_sem_teste`, `nif_recusado` (a régua do `docs/23` recusa hoje o número copiado), `perfil_de_outra_ficha`, `isencao_sem_prova` (isenta por VIES sem a prova `vvc_` na evidência, ou isenção manual sem código), `taxa_sem_mapa` (falta o par país-taxa no emissor), `isencao_sem_mapa`, `taxa_por_verificar` (modo real com uma taxa `verificado = false`, Q3), `territorio_por_decidir`, `moeda_nao_suportada`, `totais_nao_batem` (a soma das linhas não dá os totais da encomenda), `entidade_do_emissor_diferente` (o NIF da entidade no emissor não é o do perfil) | skill, «Retém em vez de emitir»; lições 1.10, 2.3, 2.7 |
| R4 | **Nunca sai como consumidor final** a quem deu um NIF | lição 1.10 |
| R5 | A entidade no emissor procura-se **pelo número sem prefixo**; antes de emitir confere-se que o NIF dela é o do perfil (o emissor não deixa mudar o NIF de uma entidade com documentos) | skill, «NIF» e «No adaptador do Moloni», **M** |
| R6 | Emissão em dois passos: rascunho → ler e conferir → fechar. Conferir é igual campo a campo à `impressao` | skill, **M** |
| R7 | Depois de fechar, lê-se de volta e compara-se: NIF, país, taxas por linha, motivos de isenção, totais do cabeçalho. Diferença → `divergente`, nunca se «acerta» sozinho | lição 2.6 |
| R8 | Totais: guardam-se os do cabeçalho do documento; uma diferença de arredondamento entre o pedido e o cabeçalho é divergência até o contabilista dizer a regra (V6) | lição 2.9; skill, **C** |
| R9 | Libertar um retido à mão **vale como validação** daquele motivo para aquele pedido (senão volta à fila em ciclo); fica quem e porquê | skill |
| R10 | Nenhuma acção em lote: libertar, corrigir, reconciliar e resolver são **um pedido de cada vez** (a API não aceita listas) | lição 2.10 |
| R11 | Uma tarefa automática (de minuto a minuto, dentro da API, como a dos pagamentos) leva os `pronto` ao emissor **um a um**; falha de uma não pára as outras; uma tarefa parada dá alarme (o prazo do alarme, proposto: 15 minutos) | `observability-security`; Q1 |
| R12 | Ao emitir, o perfil fica `usado_em_documento` (`docs/23`, R4), também numa ficha fundida (a excepção pedida no `docs/23` §12) | `docs/23` |
| R13 | A nota de carimbo vai nas observações, imutável: «destino PT · IVA 23 %», «destino BE · isento (M16)» | skill |
| R14 | Um pedido de `teste` nunca vai a uma ligação `real`, e o adaptador de ensaio recusa o modo real | `docs/26`, R9; ADR-0019 |
| R15 | Mudar a ligação (credenciais, série, mapas) com pedidos em `rascunho` ou `incerto` é recusado | — |

## 6. Dados pessoais

- O pedido e a prova guardam o perfil copiado (NIF, nome, morada fiscal) e o
  PDF: dados pessoais **guardados 10 anos civis** em Portugal (art. 52.º do
  CIVA, citado no `docs/03` §4, **C** até o contabilista confirmar).
  Um pedido de apagamento **não apaga** documentos fiscais
  (`eu-gdpr-privacy`, «Retenção»): minimiza-se o resto da ficha.
- O emissor é **subcontratante do comerciante** (o comerciante escolhe-o e
  liga-o); o Eurolify passa-lhe só o necessário ao documento. O acordo e o
  país de tratamento do emissor confirmam-se antes do modo real (Q5).
- Nos registos: nunca as credenciais nem o PDF; o NIF só mascarado.
- Âmbito novo `invoices:read`: quem não o tem não vê pedidos, provas nem PDF.

## 7. Lista da API

### 7.1 Administração

| Rota | Âmbito |
|---|---|
| `PUT /legal-entities/{id}/invoicing` (`emissor`: eurolify, sistema próprio) | `invoices:accounts` |
| `POST /invoicing-connections`, `GET`, `PATCH /invoicing-connections/{id}` (adaptador, modo, série, mapas) | `invoices:accounts` |
| `PUT /invoicing-connections/{id}/credentials`, `POST /invoicing-connections/{id}/test` | `invoices:accounts` |
| `GET /invoices?estado=&encomenda=` (com o motivo e o total) | `invoices:read` |
| `GET /invoices/{id}` (conteúdo, versões, prova, divergências, rasto) | `invoices:read` |
| `GET /invoices/{id}/pdf` | `invoices:read` |
| `POST /invoices/{id}/release` (motivo obrigatório; um motivo de retenção de cada vez) | `invoices:write` |
| `POST /invoices/{id}/correct` (versão nova do conteúdo antes de emitir: NIF, nome, morada; motivo obrigatório; Q4) | `invoices:write` |
| `POST /invoices/{id}/reconcile` (encontrado no emissor com o número X, ou confirmado que não existe) | `invoices:write` |
| `POST /invoices/{id}/resolve` (divergência vista e decidida, com motivo) | `invoices:write` |
| `GET /orders/{id}` passa a dizer o estado do documento | `orders:read` |

Âmbitos novos: `invoices:read`, `invoices:write`, `invoices:accounts`.
Papéis (proposta, Q7): dono todos; gestor `invoices:read` e `invoices:write`;
apoio `invoices:read`; armazém nenhum.

### 7.2 Erros (novos)

`invoices.not_found`, `invoices.invalid_transition`, `invoices.version_conflict`,
`invoices.issuer_not_ready`, `invoices.issuer_error`, `invoices.uncertain`,
`invoices.invalid_field`, `invoices.retry`.

### 7.3 Eventos

`invoice.requested`, `invoice.held`, `invoice.issued`, `invoice.uncertain`,
`invoice.discrepancy`, `invoice.resolved`. Só identificadores e estado; nunca
o NIF nem o PDF.

### 7.4 O contrato do adaptador (o mesmo para nós e para terceiros)

| Operação | Recebe | Devolve |
|---|---|---|
| `testar(credenciais)` | — | ligação válida, ou o erro do emissor |
| `procurarEntidade(nif_sem_prefixo)` | — | a entidade e o NIF dela, ou «não existe» (que é um resultado, não um erro silencioso) |
| `criarRascunho(conteudo, referencia)` | o conteúdo já decidido e mapeado | o identificador do rascunho |
| `lerDocumento(id)` | — | o documento como o emissor o tem (rascunho ou fechado) |
| `fechar(id)` | — | o documento fechado (número, série, data) |
| `apagarRascunho(id)` | — | só rascunhos; um documento fechado nunca |
| `procurarPorReferencia(referencia)` | — | o documento, ou «não existe», ou «não sei» |
| `pdf(id)` | — | o ficheiro |

Todas com tempo limite, erros num formato único e versão por data
(`docs/08` §4). O adaptador **não decide** nada fiscal: recebe a decisão e
traduz.

## 8. Por onde é que isto ainda pode sair errado

| Risco | O que o trava |
|---|---|
| duas faturas para a mesma venda (dois emissores) | R1; o emissor copiado na encomenda; a base recusa o pedido com `sistema_proprio` |
| duas faturas por um timeout | §4.2: incerto → reconciliar pela referência; nunca repetir às cegas |
| sai com o NIF de outra pessoa (lição 2.6) | R5 e R7: a entidade confere-se antes e o documento lê-se depois |
| sai como consumidor final a quem deu NIF (lição 1.10) | R3 `nif_recusado`, R4 |
| isenta sem prova (lição 2.3) | R3 `isencao_sem_prova` |
| uma taxa do emissor a servir dois países (lição 2.7) | §3.2 `taxas` com chave (país, taxa); R3 `taxa_sem_mapa` |
| cêntimos perdidos (lição 2.9) | R8 |
| correcções em massa (lição 2.10) | R10; a API não aceita listas |
| retido que volta sempre (ciclo) | R9 |
| a tarefa pára e ninguém sabe | R11 (alarme) |
| documento de teste no emissor real | R14 |
| o PDF sem assinatura qualificada a partir de 01/01/2027 | é do emissor certificado (`docs/03` §1, **W**); confirmar com o contabilista (V8) |

## 9. Perguntas para o Diogo ou o Bruno

| # | Pergunta | Proposta |
|---|---|---|
| Q1 | **A primeira emissão é automática?** | **Sim**: ao confirmar o pagamento, a tarefa emite uma a uma, com as verificações e a retenção; **correcções, reenvios e reconciliações são sempre de uma pessoa** |
| Q2 | **Quando nasce o documento?** | **ao confirmar o pagamento** (a regra da skill: o rascunho só depois do pagamento); se o contabilista disser que é à expedição (V2), muda-se o momento, não o resto |
| Q3 | **Em modo real, uma taxa ainda não verificada pelo contabilista retém o documento?** | **Sim**, retém (`taxa_por_verificar`); em modo teste deixa sair, marcado |
| Q4 | **O que se pode corrigir num retido, antes de emitir?** | **o NIF, o nome do documento e a morada fiscal**, numa versão nova do conteúdo, com motivo; **nunca** taxas, isenções nem montantes (isso foi o que o cliente pagou — corrige-se na fatia 11) e **nunca** «consumidor final» a quem deu NIF |
| Q5 | **E o Moloni?** | **parte 1 com um adaptador de ensaio** (contrato, estados, retenção, prova, reconciliação, tudo testado); **parte 2 o Moloni**, depois de ler a documentação oficial da API e com uma conta de teste do Moloni |
| Q6 | **Onde se escolhe quem emite?** | **na entidade legal** (é ela que emite), copiado para a encomenda no botão final; mudar só vale para encomendas novas |
| Q7 | **Quem decide a fila?** | **dono e gestor** (`invoices:write`); **ligar o emissor e as credenciais só o dono** (`invoices:accounts`), como as contas de pagamento |

## 10. Para o contabilista (bloqueiam a produção, não o código)

| # | Pergunta |
|---|---|
| V1 | Numa venda online paga antes do envio: **fatura** ou **fatura-recibo**? |
| V2 | **Quando** se emite: no pagamento ou na expedição? E o prazo legal de emissão (**não verifiquei** o artigo do CIVA) |
| V3 | Uma série por loja ou por canal, ou uma só? |
| V4 | Que **códigos de isenção** do documento correspondem a cada motivo do Motor de IVA (`M05`, `M07`, `M16`…) |
| V5 | A **nota de carimbo** nas observações tem algum problema legal? |
| V6 | Arredondamento: por linha ou por documento, no emissor |
| V7 | Venda em **outra moeda** que não o euro: o documento sai em euros, na moeda, ou nas duas? |
| V8 | O PDF com assinatura qualificada a partir de 01/01/2027: o emissor trata, ou o comerciante tem de fazer alguma coisa? |
| V9 | Cliente sem NIF (consumidor final): há limite de valor ou dados obrigatórios? |
| V10 | Retenção: 10 anos civis (art. 52.º CIVA, `docs/03` §4, **C**) também para o PDF guardado no Eurolify? |

## 11. Como entra no código (quando aprovado)

- **Parte 1:**
  - migração: emissor na entidade e na encomenda, ligações, pedidos, conteúdos (versões), provas, rasto, âmbitos;
  - os gatilhos: pedido recusado com `sistema_proprio`, prova e rasto só se acrescentam;
  - as verificações e a retenção (um teste por motivo de R3);
  - a máquina de estados com o adaptador de ensaio, incluindo o timeout, a reconciliação e a divergência;
  - a fila e as acções de uma pessoa;
  - testes: dois emissores, timeout sem duplicado, NIF da entidade diferente, consumidor final recusado, isenção sem prova, taxa sem mapa, divergência de cêntimos; mutações e a revisão do agente.
- **Parte 2:** o adaptador Moloni (Q5), com o teste de conformidade do contrato a passar.
- **Parte 3:** o relatório OSS (quatro baldes, pelo país de entrega, das provas) e o fecho mensal.
- Cada parte num pedido, com os testes verdes e a revisão do agente antes de juntar (ADR-0031, ADR-0035).

## 12. Em código — parte 1 (10/10/2026; migração 0050; `docs/06`, DI)

| O quê | Onde |
|---|---|
| `emissor_fiscal` na entidade legal e na encomenda (copiado no botão final, imutável); a base recusa um pedido numa encomenda com `sistema_proprio` | migração 0050 |
| `ligacao_faturacao` (só modo teste; credenciais cifradas com `FATURACAO_CHAVE`; mapas de taxas e isenções; mudar obriga a testar outra vez; com documentos a meio, recusa) | migração 0050; `src/faturacao/repositorio.ts` |
| `documento_fiscal` nasce quando a encomenda fica paga (gatilho), com os estados da §4.1 garantidos pela base; `documento_conteudo` (versões), `documento_prova` e `documento_rasto` só se acrescentam; eventos `invoice.*` | migração 0050 |
| as verificações e os 12 motivos de retenção (R3), os NIF de consumidor final (R4), a entidade conferida no emissor (R5), o rascunho conferido antes de fechar (R6), a prova lida e comparada (R7), libertar só o que uma pessoa sabe (R9) | `src/faturacao/repositorio.ts` |
| o incerto: nunca se repete; reconcilia-se pela referência um minuto depois; ao fim de 3 tentativas sem saber, fica para uma pessoa | `src/faturacao/repositorio.ts` |
| o contrato do adaptador e o **emissor de ensaio** (em memória, só nos testes) | `src/faturacao/adaptador.ts` |
| a API da §7.1 e `POST /invoices/{id}/recheck`; o `GET /orders/{id}` passa a dizer o emissor e o estado do documento | `src/faturacao/rotas.ts`; `src/checkout/rotas.ts` |
| âmbitos `invoices:read`, `invoices:write`, `invoices:accounts` (Q7) | migração 0050; `src/identidade/` |
| a tarefa de minuto a minuto, com alarme se parar 15 minutos | `src/faturacao/repositorio.ts`, `src/servidor.ts` |
| 17 testes pela API e 9 das verificações sem base | `test/documentos-api.test.ts`, `test/documentos-verificar.test.ts` |

**Desvios do desenho:**
- **`POST /invoices/{id}/recheck`** (verificar outra vez um retido) não estava
  na lista da §7.1: é a saída dos motivos que se resolvem na configuração
  (ligação, mapas, quem emite), que não se libertam.
- **Libertáveis** (R9): só `nif_recusado`, `isencao_sem_prova` e
  `perfil_de_outra_ficha`; os outros resolvem-se na configuração ou corrigindo.
  O NIF de consumidor final dado como NIF, e a empresa sem NIF, ficam num
  motivo à parte, `nif_consumidor_final`, que **nunca se liberta** (R4, Q4):
  são 13 motivos.
- **Um rascunho que não bate** retém com `entidade_do_emissor_diferente`
  (se for o NIF) ou `totais_nao_batem` (o resto), e o rascunho apaga-se.
- **O perfil fica usado** só quando o NIF que saiu é o dele (uma correcção
  do NIF no pedido não marca o perfil da encomenda).
- **O PDF** guarda-se na base, com a prova; se o emissor não o der, a prova
  fica sem ele (`tem_pdf` falso na leitura do pedido).
- **No servidor** não há adaptador ligado: o de ensaio só existe nos testes;
  sem `FATURACAO_CHAVE`, a tarefa não corre. Nenhum documento sai.
- **O modo real** não existe (só `teste`, como os pagamentos): abri-lo é uma
  migração com decisão escrita; a retenção `taxa_por_verificar` (Q3) está
  programada e testada sem base, mas só se aplica em modo real.
- **Por fazer:** o Moloni (parte 2), o relatório OSS (parte 3), a nota de
  crédito (fatia 11) e o contabilista (V1 a V10).

**Correcções da revisão do #312** (Sonnet 5.5; 0 P0, 5 P1, 12 P2):
- **Reserva antes de chamar o emissor** (P1-3): `reservado_ate` com prazo de
  5 minutos e compare-and-set da versão e do estado; outra volta ou uma
  pessoa que chegue a meio pára.
- **Falhas seguidas** (P1-2): ficam no rasto, recuam (2, 4, 8… até 60
  minutos) e, ao fim de 5, vão para uma pessoa (`incerto` com
  `reconciliacao_manual`); não tapam a fila do comerciante.
- **Fechado sem prova** (P1-1): um rascunho que já está fechado no emissor
  prova-se em vez de se fechar outra vez; um documento sem número não é
  prova; a recusa ao fechar não se repete às cegas.
- **Mapas** (P1-4): uma taxa ou isenção do emissor só serve um par.
- **Correcções** (P1-5, P2-5): corrigir limpa as validações anteriores,
  recusa o NIF de consumidor final e não muda o país do contribuinte (sem NIF
  antes, só um NIF do país da entidade).
- **Corrigir e libertar são do dono** (P2-4; Diogo, 10/10/2026:
  *«aprovado»*): corrigir pede também `customers:billing`; libertar pede
  `customers:exemptions`, como nos clientes. O gestor vê a fila, verifica outra
  vez, reconcilia e resolve divergências.
- **Emissor decidido depois** (P2-1): uma encomenda paga antes de se escolher
  quem emite segue quando a entidade passa a emitir pelo Eurolify, com o
  rasto a dizê-lo. **Por fazer:** se a entidade escolher o sistema próprio,
  fica retida — falta a acção «emitida fora do Eurolify».
- **E ainda:** a reconciliação repõe a volta seguinte (P2-2); procura-se
  sempre pela referência antes de criar (P2-9); país, nome e série
  comparam-se (P2-8); uma ligação desligada pára um pronto e os mapas
  verificam-se outra vez (P2-6); o teste da ligação só vale para a versão
  testada (P2-7); as credenciais trocam-se com documentos a meio (P2-11); a
  confirmação pública não mostra o estado fiscal (P2-10).
- **Ficam como estão (P3):** os eventos `invoice.issued` e
  `invoice.discrepancy` saem os dois num divergente (o segundo corrige o
  primeiro); `GET /invoices` mostra os 200 mais recentes (paginação com a
  fila no Hub); o `quem` do conteúdo e do rasto vem da aplicação; a prova de
  saída da exportação é do contabilista (V11 do `docs/24`, **C**).
