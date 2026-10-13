# Documentos fiscais — modelo e lista da API

> **Número:** até 10/10/2026 este documento foi o `docs/28`; passou a 29
> porque o 28 já era o rasto de auditoria (#332). A migração 0050 cita-o
> ainda como `docs/28` (linhas 1, 487 e 617): é este documento.

> **Estado: desenho aprovado; parte 1 no código; parte 2 (Moloni) desenhada
> na §13 e aprovada (DZ, 12/10/2026)** (issue #310; migração
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
> *11/10/2026:* a documentação foi lida (só leitura, nenhum pedido) em
> [`eurolify/fontes-api-moloni-11out2026.md`](eurolify/fontes-api-moloni-11out2026.md)
> — autenticação, documentos, stock e o que falta testar na sandbox (§6 e §7
> desse ficheiro).

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

## 13. Parte 2 — o adaptador Moloni (desenho, 12/10/2026)

> **Estado: aprovado** (`docs/06`, DZ). Diogo, 12/10/2026: *«sim, aprovo o
> desenho com as propostas M1 a M8»*. Pedido inicial, 12/10/2026: *«sim, avança com o
> adaptador Moloni»* (issue #310, parte 2). Só desenho: nenhum código antes
> de aprovado (ADR-0023). Fontes: a documentação oficial lida a 12/10/2026
> (páginas e o que dizem em
> [`eurolify/fontes-api-moloni-11out2026.md`](eurolify/fontes-api-moloni-11out2026.md)
> §9) e os testes de 11/10/2026 (§8 desse ficheiro). **Nenhum pedido de
> emissão foi feito ao Moloni**: as credenciais `MOLONI_*` não estavam no
> ambiente desta sessão. O que a documentação não diz escreve-se «não diz» e
> fica para medir na conta trial (§13.7), com o OK de cada escrita.

### 13.1 O que a documentação obriga e o contrato da §7.4 não previa

| # | O Moloni exige | Consequência |
|---|---|---|
| A1 | **Cada linha leva um `product_id`** de um artigo que existe no Moloni (`invoices/insert`, `products[].product_id` obrigatório) | é preciso casar cada linha com um artigo do Moloni (§13.3, M2) |
| A2 | **O documento leva um `customer_id`** (obrigatório); criar um cliente pede 11 campos obrigatórios, entre eles `number` (máx. 20), `language_id`, `maturity_date_id`, `payment_method_id`, `country_id` (`customers/insert`) | a ligação guarda os valores por omissão do comerciante (§13.2) |
| A3 | **Fechar é um `invoices/update` com o documento inteiro** e `status = 1` (a página marca como obrigatórios a data, a série, o cliente e as linhas); um documento fechado não se actualiza nem se apaga | `fechar(id)` relê o rascunho e reenvia os mesmos campos com `status = 1`; a conferência da §4.1 já foi feita sobre esse rascunho |
| A4 | **O token muda**: `access_token` 1 hora, `refresh_token` 14 dias, e cada renovação devolve **os dois novos** (Autenticação) | as credenciais da ligação passam a mudar sem uma pessoa; o contrato precisa de as devolver para se guardarem cifradas (§13.4) |
| A5 | **A nota de crédito** (`creditNotes/insert`) pede, sem `rappel`, `associated_documents` e, em cada linha, `related_id` = o `document_product_id` da linha da fatura; o `getOne` da fatura **não lista** esse campo na página | a NC pelo Moloni fica por medir (§13.6, M7) |
| A6 | **O ATCUD não aparece** nos campos de resposta do `getOne` (Invoices nem Documents) | a prova guarda o ATCUD só se vier na resposta; senão fica vazio e guarda-se o `em_bruto` (§13.5) |
| A7 | **O PDF** pede-se com `documents/getPDFLink` (devolve um `url`; só documentos fora de rascunho; `signed` facultativo) | `pdf(id)` pede a ligação com `signed = 1` e descarrega o ficheiro |
| A8 | **O preço** é unitário e sem imposto (`price` float); o IVA vem do `tax_id` da linha; descontos em percentagem | a linha vai com `price = base / quantidade` e sem desconto; o arredondamento do Moloni **não está escrito** (M4) |
| A9 | **A referência**: `our_reference` (texto) no documento; o `documents/getAll` filtra por `our_reference` | `procurarPorReferencia` usa-o (§13.5); o tamanho máximo **não diz** |

### 13.2 A ligação (`isx_`) com `adaptador = moloni`

| Campo | O que guarda | Fonte |
|---|---|---|
| `credenciais` (cifradas) | `company_id`, `access_token`, `refresh_token`, quando expiram | Autenticação |
| `serie` | o `document_set_id` | `documentSets/getAll` |
| `taxas` | (país, taxa) → `tax_id` (já existe, §3.2) | `taxes/getAll` |
| `isencoes` | código do motivo → `exemption_reason` do Moloni (ex.: `M16`) (já existe) | `taxExemptions/getAll` |
| `config` (novo) | `language_id`, `maturity_date_id`, `payment_method_id` por meio de pagamento do Eurolify, o artigo dos portes, a categoria e a unidade dos artigos que o Eurolify cria (M2) | `customers/insert`, `products/insert` |

O Hub mostra as listas do Moloni (séries, taxas, isenções, métodos) para o
dono escolher; **nada se escolhe por nome** (`AGENTS.md`, «Não se erra…»,
regra 6): guarda-se o id.

### 13.3 As operações do contrato no Moloni

| Contrato (§7.4) | Pedidos ao Moloni |
|---|---|
| `testar` | `companies/getAll` e confirma que o `company_id` está na lista |
| `procurarEntidade(nif)` | `customers/getByVat`; mais de um cliente com o mesmo número → **não escolhe** (retém `entidade_do_emissor_diferente`, uma pessoa decide) |
| `criarRascunho` | por linha: o artigo (M2); o cliente (M3); `invoices/insert` com `status = 0`, `our_reference = inv_…`, `notes` = a nota de carimbo |
| `lerDocumento` | `documents/getOne` |
| `fechar` | `invoices/getOne` do rascunho → `invoices/update` com os mesmos campos e `status = 1` → `documents/getOne` |
| `apagarRascunho` | `invoices/delete` (o Moloni recusa um fechado) |
| `procurarPorReferencia` | `documents/getAll` com `our_reference`: 0 → «não existe»; 1 → lê-o; mais de 1 → «não sei» |
| `pdf` | `documents/getPDFLink` com `signed = 1` → descarrega o `url` |

O mapa de volta (`DocumentoNoEmissor`): `entity_vat` → `nif`; `entity_name` →
`nome`; `entity_country` → `pais`; `number` e `document_set.name` → número e
série; `status` 0 → rascunho, 1 → fechado, **outro valor → erro** (o `status`
2 continua por perceber, §8 das fontes: nunca se trata como fechado);
`products[]` → linhas (base = `price × qty`, taxa = `taxes[].value`, IVA =
`taxes[].total_value`); totais do cabeçalho = `net_value`, `taxes_value`,
`gross_value` **como vêm** (lição 2.9). Que campo é a base e qual o total no
cabeçalho mede-se na conta trial (§13.7) antes de se confiar no mapa.

### 13.4 Tokens

- **Ligar**: o dono entra no Moloni pelo fluxo `authorization_code` (a página
  recomenda-o; não se guarda a palavra-passe do comerciante); o Eurolify
  troca o código pelos dois tokens e guarda-os cifrados.
- **Renovar**: antes de cada chamada, se o `access_token` expira em menos de
  5 minutos; e uma tarefa renova as ligações cujo `refresh_token` tem mais de
  7 dias (só pela idade). **O par novo grava-se antes de se usar**, com a
  ligação trancada para duas voltas não gastarem o mesmo par. *Corrigido a
  12/10/2026 (revisão do #384, P2-1):* cada renovação gasta o par anterior,
  por isso, se a gravação falhar depois de o Moloni renovar, ou a resposta se
  perder, o par antigo **já não serve** — a ligação passa a `com_erro` e o
  dono liga outra vez. (Que o Moloni invalida o par antigo está por medir.)
- **Morreu** (14 dias sem renovar, ou `invalid_grant`): a ligação passa a
  `com_erro`, os pedidos ficam `pronto` sem sair e o dono é avisado (tarefa da
  fila, `docs/33`). Nada se emite com credenciais por confirmar.
- O contrato ganha **uma saída**: cada operação pode devolver credenciais
  novas, que o repositório cifra e guarda **sem** pôr a ligação `por_testar`
  (renovar um token não é mudar a ligação, R15).
- **O token vai sempre no endereço** (teste P7 das fontes): o cliente HTTP
  tapa `access_token`, `refresh_token`, `client_secret` e `code` em tudo o que
  regista, e os erros não levam o endereço.

### 13.5 Prova, incerto e erros

- **Prova**: o `getOne` depois de fechar; o PDF assinado; o `em_bruto` inteiro
  (é aí que fica o ATCUD, se o Moloni o devolver, e o `rsa_hash`).
- **Incerto** (§4.2): um `insert` ou `update` sem resposta é `ErroDeRede`;
  reconcilia-se pelo `our_reference`. Um rascunho encontrado continua a partir
  dele; um fechado prova-se.
- **Erros de dados** (lista de códigos «código campo», Controlo de Erros) →
  `ErroDoEmissor` com os códigos, sem os valores; com `human_errors=true` para
  a mensagem ir para a fila legível.
- **Limites**: não estão escritos e não se encontraram até ~1400 pedidos por
  minuto (§8 das fontes); o Eurolify limita-se a si próprio a **60 pedidos por
  minuto por ligação** (proposta) e emite um a um (R11).

### 13.6 Perguntas para o Diogo ou o Bruno

| # | Pergunta | Proposta |
|---|---|---|
| M1 | **De quem é a conta de Developer do Moloni** (o `client_id` e o endereço de resposta que todos os comerciantes autorizam)? | **da Luckytarget, em nome do Eurolify**, com o endereço de resposta na API (`/invoicing-connections/moloni/callback`); a conta de developer de hoje serve só os testes |
| M2 | **Uma linha cujo artigo não existe no Moloni** | **procura pela referência exacta = SKU** (`getByReference`, `exact = 1`); se não existe, **o Eurolify cria-o** (tipo produto, **sem gestão de stock**, a categoria e a unidade da ligação) e o rasto diz-o; mais de um com a mesma referência → retém. Os portes saem no artigo de portes escolhido na ligação. **Nunca** se casa pelo nome |
| M3 | **O cliente** | **procura pelo NIF** (M3a: mais de um → retém); se não existe, cria-o com os valores da ligação e o `number` = o id da ficha do Eurolify; **sem NIF**, o cliente «Consumidor final» que a ligação indica (o NIF desse cliente confere-se: tem de ser o de consumidor final) — **C**, V9 |
| M4 | **Preço e arredondamento** | `price = base / quantidade` com as casas que o Moloni aceitar (**medir**); uma diferença de cêntimos no cabeçalho é divergência (R8) até o contabilista dizer a regra (V6) |
| M5 | **Fatura ou fatura-recibo** | **fatura** (`invoices`) até ao V1 do contabilista; a fatura-recibo é outro endpoint (`invoiceReceipts`) com o mesmo mapa |
| M6 | **Moeda** | **só euros** nesta parte; outra moeda retém (`moeda_nao_suportada`), V7 |
| M7 | **Notas de crédito pelo Moloni** | **ficam fora desta parte** até se medir o `related_id` (A5); uma NC para uma fatura do Moloni fica retida com um motivo próprio e a pessoa trata-a no Moloni |
| M8 | **Modo real** | **continua fechado** (§12): o Moloni só liga em modo `teste` a uma conta de teste; abrir o real é outra decisão escrita, depois do contabilista |

### 13.7 Por medir na conta trial (cada escrita com o OK do Diogo ou do Bruno)

1. Um rascunho com uma linha a 23 % e outra isenta (M16): o que volta no
   `getOne` (base, IVA e total por linha e no cabeçalho; ATCUD; `rsa_hash`).
2. Fechar com o `update` completo: o número, a data e se o rascunho muda.
3. O `our_reference`: tamanho, e se o `getAll` o encontra logo a seguir.
4. Um preço com dízima infinita (10,00 € / 3): que casas guarda e que total dá.
5. O `getByVat` com e sem prefixo para um NIF de outro país da UE.
6. A NC com `related_id` (A5), para a decisão M7.

### 13.8 Como entra no código (depois de aprovado)

- `src/faturacao/moloni.ts`: o adaptador, o cliente HTTP (tokens tapados,
  tempo limite, limite por minuto) e o mapa de volta;
- migração: `config` na ligação, `moloni` no adaptador, a renovação dos tokens
  sem perder o teste;
- o fluxo de ligação (`authorization_code`) e a tarefa diária de renovação;
- testes: o **mesmo teste de conformidade do contrato** que corre contra o
  emissor de ensaio corre contra um Moloni simulado com as respostas da
  documentação e das medições; um teste por cada linha de A1 a A9 e por M2 e
  M3; mutações; a revisão do agente; e a prova na conta trial (§13.7) antes de
  dizer que funciona.

## 14. Em código — parte 2 (12/10/2026; migração 0069; DZ)

| O quê | Onde |
|---|---|
| o adaptador: as oito operações da §13.3, o mapa de volta, o cliente (M3), o artigo pela referência = SKU e criado sem stock (M2), a NC e outra moeda recusadas (M6, M7), o estado 2 nunca lido como fechado | `src/faturacao/moloni.ts` |
| o cliente HTTP: o token só no endereço e tapado nos erros, corpo em formulário (a forma por omissão da API), tempo limite de 15 s, 60 pedidos por minuto por empresa | `src/faturacao/moloni.ts` |
| `config` e `sessao` na ligação: a configuração só aceita ids e obriga a testar outra vez; a sessão guarda os tokens renovados, cifrados, **sem** pôr a ligação por testar nem mudar a versão; credenciais novas apagam a sessão | migração 0069 |
| a renovação com a ligação trancada (duas voltas nunca gastam o mesmo par), gravada antes de se usar; uma autorização morta põe a ligação `com_erro` e o pedido fica retido (`ligacao_sem_teste`) | `src/faturacao/repositorio.ts` |
| a tarefa das renovações, de seis em seis horas, com alarme se parar 26 horas; o Moloni liga-se no servidor só com `MOLONI_CLIENT_ID`, `MOLONI_CLIENT_SECRET` e `MOLONI_EMPRESAS_TESTE` | `src/faturacao/repositorio.ts`, `src/servidor.ts`, migração 0069 |
| o motivo `nota_credito_sem_adaptador` (M7) | `src/faturacao/repositorio.ts` |
| 23 testes do adaptador contra um Moloni simulado; 6 pela API com a base; 1 da NC retida na pós-venda | `test/moloni.test.ts`, `test/moloni-falso.ts`, `test/documentos-api.test.ts`, `test/posvenda-api.test.ts` |

**Desvios do desenho:**
- **O nome sem NIF** (R7): sem NIF, o documento sai no cliente «Consumidor
  final» do Moloni, com o nome dele. A conferência do nome passa a fazer-se só
  quando há NIF; sem NIF, confere-se que o documento não leva NIF nenhum.
  Sem esta mudança, nenhuma venda a um consumidor sem NIF saía pelo Moloni (o
  rascunho ficava sempre retido).
- **O número do cliente** criado no Moloni (`number`, máx. 20) é o NIF, não o
  id da ficha (M3 dizia o id da ficha): o id do Eurolify tem 36 caracteres.
- **Sem morada fiscal completa** (rua, localidade e país), o cliente não se
  cria e o passo falha até uma pessoa: nada se inventa.
- **Mais de um artigo ou cliente** com a mesma referência ou NIF, ao criar o
  rascunho, é uma falha do passo (chega a uma pessoa ao fim de 5), não uma
  retenção com motivo próprio; com mais de um cliente na procura da R5, o
  pedido fica retido (`entidade_do_emissor_diferente`), como o desenho diz.
- **O aviso ao dono** quando a autorização morre ainda não é uma tarefa da
  fila (`docs/33`): vê-se na ligação (`com_erro`) e no registo do servidor.

**Correcções da revisão do #384** (Sonnet 5.5; 0 P0, 2 P1, 8 P2, 10 P3):
- **P1-1, a procura pela referência:** «não existe» só com a lista do Moloni
  vazia; cada candidato confere-se no documento inteiro (`getOne`), e mais de
  um, ou nenhum dos que vieram, é «não sei». Um «não existe» errado reemitia
  a fatura. Testado com as linhas sem `our_reference` e com o filtro
  ignorado, e o fecho sem resposta reconciliado numa só fatura.
- **P1-2, o M8 em código:** o Moloni só liga às empresas da lista
  `MOLONI_EMPRESAS_TESTE` (as contas de teste); outra empresa é recusada em
  todas as operações, sem pedido nenhum. Sem a lista, o Moloni não liga no
  servidor.
- **P2-1:** a tarefa só renova pela idade do par; o §13.4 corrigido acima.
- **P2-2:** só `invalid_grant` põe a ligação com erro; um segredo do servidor
  errado ou a rede são falhas que passam; uma ligação já com erro não sobe a
  versão a cada volta.
- **P2-3:** o teste da ligação lê a versão antes das credenciais.
- **P2-4:** o cliente «Consumidor final» da ligação confere-se (NIF de
  consumidor final no Moloni) antes de cada documento sem NIF; um documento
  sem NIF no Moloni nunca se lê como consumidor final.
- **P2-5:** o cliente cria-se no país da morada; o país do contribuinte lê-se
  do NIF como saiu (prefixo fora de Portugal; sem prefixo, Portugal).
- **P2-6:** o fecho leva a data de hoje (**C**, a regra é do contabilista).
- **P2-7:** o preço unitário vai com 6 casas.
- **P3:** um nome ou país diferentes no rascunho retêm como
  `entidade_do_emissor_diferente`; o PDF só se descarrega de `*.moloni.pt` e
  tem de começar por `%PDF-`; os segredos em JSON tapam-se; o gatilho da
  configuração deixou de depender da ordem de avaliação; a tarefa corre um
  minuto depois do arranque.
- **Ficam como estão (P3), e porquê:** a 0069 não junta ligações Moloni
  anteriores porque a API as recusava (`criarLigacao` lançava
  «o adaptador Moloni ainda não existe») — não há nenhuma; o rascunho relê-se
  ao fechar sem nova conferência (janela de segundos, e a prova seguinte
  marca a divergência); a reserva de 5 minutos e o ATCUD vazio sem aviso
  ficam para a parte 2b. Testes ainda em falta: um rascunho divergente pelo
  Moloni (coberto pelo emissor de ensaio na parte 1) e o `issuer_busy` com a
  configuração (o gatilho é o mesmo da série).

**Por fazer:**
- **parte 2b:** a ligação pelo `authorization_code` (o endereço de resposta e
  a troca do código) e o ecrã no Hub — hoje as credenciais entram pela API;
- **a prova na conta trial** (§13.7), com as credenciais no ambiente e o OK de
  cada escrita: até lá, **nada disto está verificado contra o Moloni real**;
- a NC pelo Moloni (M7), depois da medição; o aviso ao dono pela fila.

## 15. A saída «emitida fora do Eurolify» (desenho, 12/10/2026)

> **Estado: aprovado** (`docs/06`, EA). Diogo, 12/10/2026: *«sim, aprovo o
> desenho com as propostas Q-F1 a Q-F3»*. Pedido inicial, 12/10/2026: *«avança
> com a saída «emitida fora do Eurolify»»*. Vem da revisão do #312 (P2-1, §12: «se a
> entidade escolher o sistema próprio, fica retida — falta a acção»). Só
> desenho; nenhum código antes de aprovado (ADR-0023).

### 15.1 O caso

Uma encomenda paga **antes** de a entidade escolher quem emite fica com
`emissor = por_configurar` (copiado no botão final e imutável, §3.1). O pedido
de fatura nasce e fica retido com `emissor_por_configurar`. Se a entidade
escolher depois o **sistema próprio** (ADR-0041), o pedido não pode sair pelo
Eurolify — quem emite é o sistema dela — e **não há saída**: fica na fila «A
decidir» para sempre. Medido no código a 12/10/2026 (`repositorio.ts`,
`verificar`): o motivo fica, e nenhuma acção o tira (libertar não o aceita,
R9; corrigir não toca no emissor).

Encontrado ao ler o código para este desenho: se essa encomenda for
reembolsada, `nota_credito_pedir` (migração 0058) vê que há um pedido de
fatura e **pede a nota de crédito**, que fica retida com
`original_por_emitir` também para sempre.

### 15.2 A proposta

| # | Regra | Porquê |
|---|---|---|
| F1 | Uma acção de uma pessoa, `POST /invoices/{id}/issued-elsewhere`, leva o pedido para um estado final novo, **`fora`** («emitida fora do Eurolify») | ADR-0041: uma venda nunca tem os dois emissores; o pedido do Eurolify tem de acabar sem sair |
| F2 | Só vale para uma **fatura retida** com `emissor_por_configurar`, numa encomenda com `emissor = por_configurar`, cuja entidade **já escolheu** `sistema_proprio`. Em qualquer outro caso, recusa (`invoices.invalid_transition`) | o caso exacto da §15.1; com a entidade ainda por configurar, a resposta é configurar, não fechar |
| F3 | Leva **motivo** (obrigatório) e o **número do documento no sistema próprio** (obrigatório, texto até 60). O número é **declarado por uma pessoa**: fica no rasto como declaração, **não é prova** (a prova é o documento, `AGENTS.md`, «Não se erra…», regra 4) | quem consultar a encomenda sabe onde está a fatura; ninguém o confunde com uma prova lida do emissor |
| F4 | `fora` é final: não volta atrás, não tem prova, nem `emissor_id`; sai da fila «A decidir» | §4.1; `documento_na_fila` só conta retidos, divergentes e incertos manuais |
| F5 | Uma **nota de crédito** pedida para essa fatura (retida com `original_por_emitir`) passa **também** a `fora`, com o rasto a dizê-lo; e, a partir daí, um reembolso dessa encomenda **não pede** NC (`nota_credito_pedir` devolve nada; o reembolso diz `sem_nota_credito: sistema_proprio`) | é o sistema próprio que emite a NC, como já acontece nas encomendas com `sistema_proprio` (docs/30, revisão do #329, P2-8) |
| F6 | Um evento novo, **`invoice.issued_elsewhere`**, só com identificadores e estado (§7.3) | quem integra sabe que o Eurolify não emite esta |
| F7 | **Nunca em lote** (R10): um pedido de cada vez | lição 2.10 |

### 15.3 Perguntas para o Diogo ou o Bruno

| # | Pergunta | Proposta |
|---|---|---|
| Q-F1 | **Quem pode marcar «emitida fora»?** | **só o dono** (`invoices:accounts`, o âmbito de escolher quem emite): é a mesma decisão — quem emite esta venda |
| Q-F2 | **O número do documento no sistema próprio é obrigatório?** | **sim**, declarado (F3); sem ele, a encomenda fica sem rasto de onde está a fatura |
| Q-F3 | **E o relatório OSS (parte 3)?** | as vendas `fora` **não entram** nos baldes (o relatório lê só provas, §11), mas o relatório **conta-as e lista-as à parte** («N vendas faturadas no sistema próprio»), para o comerciante as juntar ao OSS dele — a confirmar com o contabilista quando a parte 3 se desenhar (**C**) |

### 15.4 Como entra no código (depois de aprovado)

- migração: o estado `fora` no CHECK e nas transições (`retido → fora`), o
  número declarado, `nota_credito_pedir` sem NC para uma fatura `fora`, o
  evento;
- `src/faturacao/`: a acção, as verificações de F2, a NC em F5, a leitura do
  pedido com o número declarado;
- `src/posvenda/`: `sem_nota_credito: sistema_proprio` também neste caso;
- testes: o caminho inteiro (paga antes de escolher → sistema próprio → fora),
  cada recusa de F2, a NC já pedida (F5) e o reembolso depois (sem NC), o
  âmbito (Q-F1), a fila «A decidir» sem o caso; mutações; a revisão do
  agente.

## 16. Em código — a saída «emitida fora» (12/10/2026; migração 0070; EA)

| O quê | Onde |
|---|---|
| o estado `fora` e o número declarado (`fora_numero`, obrigatório só em `fora`); `retido → fora` só no caso exacto da F2, conferido **na base** e na API; `fora` é final e não muda | migração 0070 |
| a NC que esperava pela fatura (em verificação ou retida) passa a `fora` com ela; uma NC nova para uma fatura `fora` é recusada na base, e `nota_credito_pedir` deixa de a pedir (F5) | migração 0070; `src/faturacao/repositorio.ts` (`emitidaFora`) |
| o evento `invoice.issued_elsewhere` e o número declarado no rasto | migração 0070 |
| `POST /invoices/{id}/issued-elsewhere` (`invoices:accounts`, só o dono; Q-F1) com motivo e número (Q-F2); a leitura do pedido diz `emitida_fora: {numero_declarado, prova: false}` | `src/faturacao/rotas.ts` |
| o reembolso diz `sem_nota_credito: sistema_proprio` também neste caso | `src/posvenda/repositorio.ts` |
| 2 testes pela API e 1 na pós-venda | `test/documentos-api.test.ts`, `test/posvenda-api.test.ts` |

**Correcções da revisão do #386** (Sonnet 5.5; 0 P0, 0 P1, 5 P2, 6 P3):
- **P2-1, a corrida com um reembolso:** pedir ou criar a NC tranca a fatura
  (`FOR SHARE`), por isso quem a está a marcar `fora` termina primeiro e a NC
  não nasce; e uma NC que tenha ficado presa a uma fatura `fora` tem saída
  pela mesma acção, com o número que a pessoa declarar para ela.
- **P2-2:** a NC que sai com a fatura **não tem número declarado** (o da
  fatura não é o dela); a leitura diz `numero_declarado: null`.
- **P2-3 a P2-5, testes:** a NC criada directamente na base para uma fatura
  `fora` é recusada; uma NC de uma fatura do Eurolify não sai `fora` (API e
  base); a escolha da entidade conferida na base; versão desactualizada,
  documento reservado, número sem quebras de linha; o número no rasto; o
  tipo no evento; a NC fora da fila.
- **P3:** a escolha da entidade lê-se trancada; a base exige que nunca tenha
  ido ao emissor (sem identificador e sem prova); o evento diz o tipo
  (fatura ou NC); a guarda de uma encomenda inexistente.
- **Fica como está (P3):** números declarados repetidos não se avisam — é
  uma declaração, e a fila do sistema próprio é a dele.

**Por fazer:** o relatório OSS (parte 3) com a lista à parte (Q-F3, **C**);
o ecrã no Hub.

## 17. Parte 2b — ligar o Moloni pela autorização dele (12/10/2026)

> **Estado:** desenho de execução do §13.4 e da M1 (aprovados, `docs/06`,
> DZ). Pedido do Diogo, 12/10/2026: *«sim, avança com a parte 2b»*. Só a API;
> o botão no Hub fica para depois.

**O que diz o Moloni** (página «Autenticação», `moloni.pt/dev/autenticacao/`,
lida a 12/10/2026, **M**):
1. o utilizador abre
   `https://www.moloni.pt/ac/root/oauth/?response_type=code&client_id=…&redirect_uri=…`,
   entra e aceita;
2. o Moloni devolve-o ao `redirect_uri` com `?code=…`;
3. o código troca-se por `GET https://api.moloni.pt/v1/grant/?grant_type=authorization_code&client_id=…&redirect_uri=…&client_secret=…&code=…`;
   a resposta traz `access_token` (1 hora), `refresh_token` (14 dias) e
   `expires_in`.

**A página não fala de `state`** (o valor que liga a resposta ao pedido e
impede que alguém faça ligar a conta dele). Não se conta com ele: a troca do
código **nunca** se faz no endereço público, só num pedido do dono
autenticado, com o valor que o Eurolify lhe deu ao pedir a autorização. Se o
Moloni devolver o `state`, passa adiante; se não, a pessoa leva o código.
**Por medir na conta trial:** se o `state` volta, e se o `redirect_uri` tem de
ser igual ao registado.

| Rota | Quem | O que faz |
|---|---|---|
| `POST /invoicing-connections/{id}/authorize` | o dono (`invoices:accounts`) | Para uma ligação `moloni`: recebe a `empresa` (o `company_id`; a lista de teste, M8, confere-se na troca, antes de chamar o Moloni), cria um pedido de autorização com um valor aleatório (guardado só o resumo SHA-256), válido **10 minutos**, e devolve o endereço do Moloni (com `state`), o valor e quando expira. Sem `MOLONI_REDIRECT_URI` configurado, recusa |
| `GET /invoicing-connections/moloni/callback` | público (o navegador vindo do Moloni) | **Não troca nada.** Com `MOLONI_RETORNO_URL`, reencaminha para lá com o `code` (e o `state`, se vier); sem ele, mostra uma página que diz para voltar ao Eurolify com o código. O código só se aceita com letras, números e `._-`, e a página não se guarda em cache |
| `POST /invoicing-connections/{id}/authorize/complete` | o dono (`invoices:accounts`) | Recebe o `code` e o `state` que o Eurolify deu. Confere que o pedido é desta ligação, não expirou e não foi usado, e **marca-o usado antes de chamar o Moloni** (um código nunca se troca duas vezes). Troca o código, confere que a autorização dá acesso à empresa (como o teste da ligação) e só então grava os tokens como credenciais cifradas. A ligação fica `por_testar` |

- **Uma autorização gasta-se uma vez:** se a troca falhar depois de marcada,
  pede-se outra.
- **A empresa** vem do pedido e confere-se no fim. Se a autorização não lhe
  der acesso, não se grava nada.
- **As credenciais novas apagam a sessão anterior** (gatilho da 0069), e a
  renovação passa a correr pelo `refresh_token` novo (§13.4).
- **Fora desta parte:** o botão no Hub; a escolha da empresa numa lista;
  e o modo real (M8).

**Em código (12/10/2026; migração 0081):**

| O quê | Onde |
|---|---|
| `autorizacao_faturacao`: o resumo do valor, a empresa, 10 minutos, usada uma vez (a base recusa voltar atrás e apagar); RLS forçado | migração 0081 |
| `urlAutorizacao` e `trocarCodigo` no contrato do adaptador; no Moloni, com `MOLONI_REDIRECT_URI` | `src/faturacao/adaptador.ts`, `src/faturacao/moloni.ts`, `src/servidor.ts` |
| `pedirAutorizacao` e `concluirAutorizacao` (marca usada antes de trocar; grava só depois de conferir a empresa) | `src/faturacao/repositorio.ts` |
| as três rotas; a página do endereço de resposta (sem nada de fora, sem cache, o texto escapado) e o reencaminhamento com `MOLONI_RETORNO_URL` | `src/faturacao/rotas.ts` |
| testes: o adaptador (`test/moloni.test.ts`) e o caminho todo pela API contra o Moloni simulado (`test/documentos-api.test.ts`) | — |

**Revisão do #407** (agente da sessão, Opus 5.5; 0 P0, 1 P1, 3 P2, 5 P3):
- **P1-1, corrigido:** o `code` e o `state` deixam de ficar no registo da API.
- **P2-2, corrigido:** o reencaminhamento para o Hub leva o código no
  fragmento (`#code=…`), que não sai do navegador.
- **P2-3, corrigido:** com documentos a meio no emissor, a autorização é
  recusada (`invoices.issuer_busy`) antes de se gastar.
- **P3-1 a P3-3, corrigidos:** a ligação volta a conferir-se antes de gravar,
  as credenciais novas fazem caducar as autorizações pendentes, a M8 confere-se
  ao pedir, e um `MOLONI_RETORNO_URL` que não seja `https` impede o arranque.
- **P2-1, fica para antes do modo real:** o código não fica preso ao pedido.
  Quem obtiver o código de outro comerciante e tiver uma chave de dono pode
  ligá-lo à empresa de teste dele. Hoje só há empresas de teste (M8). Quando
  se medir se o `state` volta, o endereço de resposta passa a guardar o código
  no pedido e o dono conclui só com o valor; e a mesma empresa não se liga em
  dois comerciantes.
- **P3-4 e P3-5, ficam:** a tabela não tem retenção, e quem conclui pode ser
  outra chave de dono do mesmo comerciante.

**Por fazer:** o botão e o ecrã no Hub; registar `MOLONI_REDIRECT_URI` na
conta de Developer e no ambiente `ensaio`; medir na conta trial se o `state`
volta e se o `redirect_uri` tem de coincidir.

## 18. O aviso ao dono quando a ligação fica com erro (desenho, 13/10/2026)

Pedido do Diogo, 13/10/2026 (*«sim, avança com o desenho do aviso ao
dono»*). É o ponto que o §14 deixou aberto: «o aviso ao dono quando a
autorização morre ainda não é uma tarefa da fila». **Aprovado pelo Diogo a
13/10/2026**, com a Q1 em A (*«sim, aprovo o desenho com a Q1 em A»*;
`docs/06`, EJ).

Skills: `platform-architect` (tarefas sobre um registo; uma regra num sítio),
`observability-security` (tarefas automáticas que não param em silêncio),
`eu-vat-oss-ioss` (na dúvida, retém), `eu-gdpr-privacy` (o e-mail à
equipa, `docs/17` T10), `eurolify-design` (o ecrã «A decidir»).

Ex.: no sábado, o Moloni recusa renovar os tokens da «Loja Exemplo» (a
autorização foi retirada na conta do Moloni). Na segunda de manhã há 12
faturas retidas e o dono não sabe porquê.

### 18.1 O que acontece hoje (lido no código a 13/10/2026)

| O quê | O que o código faz | Onde |
|---|---|---|
| **quem põe a ligação «com erro»** | a renovação recusada pelo emissor, em dois sítios: antes de emitir e na tarefa que mantém os tokens (`motivo = manter`); e o teste da ligação, quando falha | `src/faturacao/repositorio.ts`: `ligacaoComErro` (404), chamado em 2284 e 2747; `testarLigacao` (428) |
| **as faturas que chegam depois** | ficam retidas, uma a uma, com o motivo `ligacao_sem_teste`, e cada uma entra na fila `documento_fiscal` do «A decidir» com o prazo de 2 dias | `repositorio.ts` 1598 e 2334-2342; `docs/33` §1 |
| **a causa** | não está em fila nenhuma: a lista das filas tem sete, e nenhuma é a ligação | migração 0066, linha 274 |
| **sem faturas por emitir** | se o erro vem da tarefa que mantém os tokens e não há faturas, **nada aparece** em lado nenhum, até à primeira fatura | idem |
| **o e-mail** | só sai um `task.overdue` por fatura retida, ao fim dos 2 dias: 12 faturas são 12 e-mails, e nenhum diz a causa | `docs/34` §12 |
| **depois de ligar outra vez** | cada fatura retida volta a verificar-se **uma a uma**, por uma pessoa (`reverificar`) | `repositorio.ts` 2888 |

### 18.2 O que entra

| # | O quê | Proposta | Fonte |
|---|---|---|---|
| L1 | **Uma fila nova, `ligacao_faturacao`**, a oitava do «A decidir». **Caso** = uma ligação **activa** com o estado `com_erro`. Sai da fila quando a ligação deixa de estar com erro (ligar outra vez, testar com sucesso) ou é desligada. A tarefa nunca decide (`docs/33` R1) | `docs/33` §3 (forma B: a lista lê a fila) |
| L2 | **O motivo**, um código: `renovacao_recusada` (o emissor recusou renovar: a autorização morreu) ou `teste_falhou` (o teste da ligação falhou). Nunca a frase do emissor no motivo | `docs/33` §4.1 (motivo sem dados) |
| L3 | **Quem lê:** `invoices:read` (dono, gestor e apoio, como o ecrã Faturação). **Quem decide e pode ser responsável:** `invoices:accounts` (só o dono), porque só ele liga a conta | `docs/33` R2, R3; `docs/22` §30 |
| L4 | **Prazo por omissão: 1 dia** (proposta, **não é lei**): enquanto dura, as faturas não saem | `docs/33` R4 |
| L5 | **Na fila desde:** uma coluna nova na ligação (`com_erro_desde`), posta pelo gatilho da base quando o estado passa a `com_erro` e limpa quando sai. Uma passagem nova é uma atribuição nova (`docs/33` R9) | `docs/33` §4.1 |
| L6 | **O caso no Hub:** abre o ecrã «Faturação» do comerciante (`/faturacao`), onde já estão «Ligar outra vez» e «Testar». A linha diz a entidade, o software, o motivo em linguagem comum e **quantas faturas estão retidas por `ligacao_sem_teste`** nessa entidade | `docs/22` §28 e §30 |
| L7 | **O e-mail** (Q1): ver abaixo | `docs/34` |
| L8 | **Testes que impedem o lançamento:** a renovação recusada põe o caso na fila (na emissão e na tarefa, com e sem faturas); o teste falhado também; ligar e testar com sucesso tira-o; desligar tira-o; o gestor e o apoio vêem, mas só o dono pode ser responsável; outro comerciante não vê; o motivo nunca traz a frase do emissor; a lista das oito filas é a mesma na base, na API e no Hub | `eurolify-engineering-execution` |

### 18.3 Decidido (Q1): avisar logo, ou só ao fim do prazo?

✅ **Q1: A** (Diogo, 13/10/2026, *«sim, aprovo o desenho com a Q1 em A»*).

- **A (proposta):** **um e-mail logo** aos donos, quando a ligação passa a
  `com_erro` **pela renovação** (`renovacao_recusada`). Um por passagem. Diz a
  entidade, o software, o motivo (código), quantas faturas estão retidas e o
  endereço do ecrã «Faturação». Nunca diz a frase do emissor nem dados de
  clientes. Ao fim do dia, se ninguém resolveu, sai também o `task.overdue`
  normal. Um teste falhado não manda e-mail: foi o próprio dono que o fez e
  está a ver o resultado no ecrã.
  - **A favor:** o dono sabe no próprio dia, não ao fim de 24 horas.
  - **Contra:** um tipo de notificação novo (`invoicing.connection_error`),
    com os seus textos nas três línguas.
- **B:** **só a fila**, e o `task.overdue` ao fim do dia, como as outras
  filas.
  - **A favor:** nada novo nas notificações.
  - **Contra:** no exemplo, o dono só sabe no domingo à tarde, e só pelo
    e-mail do caso vencido.

### 18.4 Fica de fora, e porquê

| O quê | Porquê |
|---|---|
| **Verificar outra vez, de uma vez, as faturas retidas por `ligacao_sem_teste`** quando a ligação volta a ficar pronta | É um reenvio em lote. Uma pessoa decide (`AGENTS.md`, «Não se erra em documentos fiscais», regra 5). Continua uma a uma, como hoje; se fizer falta, é uma decisão à parte |
| **Calar os `task.overdue` das faturas retidas** enquanto a ligação está com erro | Cada fatura continua a ser um caso. Juntá-las muda o `docs/33` e o `docs/34`; fica para medir primeiro quantos e-mails saem de facto |
| **Avisar antes** de a autorização morrer (o Moloni avisa?) | Não verifiquei se o Moloni avisa antes de retirar uma autorização (§13.7, por medir) |

### 18.5 Por onde é que isto ainda pode sair errado

| Risco | O que o evita |
|---|---|
| Uma ligação que oscila (fica com erro, volta, fica outra vez) | um caso e, na A, um e-mail por passagem; mede-se no ensaio |
| O aviso ir para ninguém (nenhum dono activo) | a mesma regra do `docs/34` §12: quem decide a fila, activo; sem ninguém, a notificação fica `cancelada` e vê-se em `GET /notifications` |
| O dono resolver sem verificar as faturas retidas | a linha do caso diz quantas estão retidas; elas continuam na fila `documento_fiscal` até alguém as verificar |
