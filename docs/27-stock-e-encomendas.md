# Stock e encomendas — modelo e lista da API

> **Estado: desenho, por aprovar** (issue #295). Diogo,
> 10/10/2026: *«sim, avança com o desenho da fatia 9»*. É a fatia 9 do
> [`eurolify/implementation-plan.md`](eurolify/implementation-plan.md)
> («Stock e encomendas: reservas, lotes na linha expedida, compostos»).
> Depende do Catálogo (`docs/14`, com os kits) e dos Pagamentos (`docs/26`,
> #288): a encomenda nasce no botão final (`docs/25`) e passa a `paga` com a
> prova do prestador; é aqui que segue para a preparação, a expedição e a
> entrega.
>
> Skills seguidas: `order-fulfilment` (o stock só muda por movimento, vende-se
> o disponível, reserva com prazo, kits derivados, lote na linha expedida,
> estados só para a frente, expedições, portes como linha própria),
> `eurolify-transport-logistics-eu` (o serviço vendido é o da etiqueta;
> unidades, lotes, expedições e prova de entrega ligados), `product-compliance-eu`
> (lotes para poder recolher), `eurolify-identifiers-traceability-eu` (SKU,
> GTIN, lote, série), `consumer-rights-eu` (prazo de entrega e livre
> resolução), `eu-gdpr-privacy` (o armazém vê só o que precisa para expedir) e
> `headless-commerce` (idempotência, cêntimos, erros, eventos).
>
> 🔴 **Regra deste domínio** (lições 3.1 a 3.4 do `docs/04`):
> 1. **O stock só muda por movimento**, no mesmo passo que o saldo; a base
>    garante-o, não o código.
> 2. **Vende-se o disponível** (físico menos o reservado de todos os canais),
>    nunca o físico.
> 3. **Um kit não tem stock próprio**: o disponível dele vem dos componentes, e
>    vendê-lo reserva e baixa os componentes.
> 4. **O lote vai na linha expedida** de cada componente, para se saber a quem
>    avisar numa recolha.

## 1. O que entra nesta fatia

| O quê | Fonte |
|---|---|
| **armazém** (`whs_`): um por loja nesta fase (Q1) | `order-fulfilment`, regra 7 (vários armazéns na Fase 2) |
| **saldo por variante e armazém**: físico e reservado; o disponível calcula-se | regras 1 e 2 |
| **livro de movimentos** (`stm_`), só se acrescenta: entrada, reserva, libertação, saída (expedição), ajuste de inventário; com origem, quem, quando, antes e depois | regra 1; lição 3.2 |
| **lotes** (`lot_`): número, validade, na entrada e na saída; obrigatórios nas variantes que os exigem (Q4) | regra 5; `product-compliance-eu`, «Lotes, alertas e recolhas» |
| **política de stock por variante**: controla, não controla (serviços), vende sem stock (por encomenda) | regra 6 |
| **kits**: disponível derivado dos componentes; reserva e saída dos componentes | regra 4; `docs/14` §3.4 |
| **reserva no botão final** e libertação ao cancelar ou expirar; o resumo do checkout deixa de vender o que não há (fecha a Q3 do `docs/25`) | regra 3 (Q2) |
| **estados da encomenda depois de paga**: em preparação, expedida (parcial ou total), entregue, concluída | `order-fulfilment`, «Encomenda — estados» |
| **expedições** (`shp_`) com linhas (variante, quantidade, lote), transportadora, serviço e seguimento, escritos à mão nesta parte (Q5) | `order-fulfilment`, «Expedição» |
| **a vista do armazém**: o que expedir, sem perfil de faturação, NIF nem e-mail (fecha a P2-10 da revisão do #276) | `eu-gdpr-privacy` (minimização) |

**Fora desta fatia:**

| O quê | Onde |
|---|---|
| devoluções (RMA), reembolsos e notas de crédito | fatia 11 (pós-venda) |
| cancelar uma encomenda **paga** (há dinheiro para devolver) | fatia 11; nesta fatia uma encomenda paga não se cancela pela API |
| adaptadores de transportadora (cotação, etiqueta, seguimento automático, pontos de recolha) | parte 2 desta fatia (Q5) |
| vários armazéns e a regra de escolha | Fase 2 (`order-fulfilment`, regra 7) |
| encomendas de outros canais (marketplaces, balcão) com identificador externo | fatia de Canais; a encomenda já guarda a origem (§3.6) |
| mercadorias perigosas e cadeia de frio | `eurolify-transport-logistics-eu`, com o setor; nesta fatia nenhum serviço de transporte é recusado por tipo de artigo (**por fazer**) |
| o documento fiscal | fatia 10 (ouve os eventos desta) |

## 2. Fronteira

| O quê | Dono | Como fala com o Stock |
|---|---|---|
| a variante, a composição dos kits, o tipo de artigo | **Catálogo** | o Stock lê-os; o Catálogo nunca guarda quantidades |
| a encomenda e as linhas (cópias do checkout) | **Encomendas** (esta fatia; o núcleo nasceu na 0041) | as linhas são as do botão final; não mudam |
| a passagem a `paga` | **Pagamentos** (0044) | o Stock não depende dela: a reserva nasce antes |
| o disponível que o checkout e a API da Loja mostram | **Stock** | o checkout pergunta; nunca calcula |
| o documento fiscal | fatia 10 | ouve `order.paid` e `shipment.dispatched` |
| a devolução | fatia 11 | entra no Stock por movimento de devolução |

## 3. Modelo

### 3.1 Armazém (`whs_`)

| Campo | Regra |
|---|---|
| `loja` | um armazém por loja nesta fase (Q1); criado com a loja ou pela API |
| `nome`, `morada` | a morada de onde sai a mercadoria (vai na expedição) |
| `estado` | `activo` ou `arquivado`; com stock não se arquiva |

### 3.2 Saldo (`variante` × `armazém`)

| Campo | Regra |
|---|---|
| `fisico` | o que está na prateleira; inteiro ≥ 0 (regra 6: negativo é erro) |
| `reservado` | prometido a encomendas por expedir; 0 ≤ reservado ≤ físico, salvo «vende sem stock» |
| `disponivel` | calcula-se: físico − reservado; nunca se guarda |

A tabela do saldo **só a escrevem os gatilhos do livro de movimentos** (a API
não tem `UPDATE` nela): não há saldo sem movimento.

### 3.3 Movimento (`stm_`, só se acrescenta)

| Campo | Regra |
|---|---|
| `tipo` | `entrada`, `reserva`, `libertacao`, `saida`, `ajuste`, `devolucao` (fatia 11) |
| `variante`, `armazem`, `lote` | lote obrigatório na entrada e na saída das variantes que o exigem |
| `quantidade` | inteiro > 0; o sentido vem do tipo (num ajuste, `+` ou `−`) |
| `fisico_antes`, `fisico_depois`, `reservado_antes`, `reservado_depois` | escritos pelo gatilho, na mesma transacção |
| `origem` | `encomenda` (com o `ord_`), `expedicao` (`shp_`), `inventario`, `importacao`, `sistema_externo` |
| `motivo` | obrigatório num ajuste |
| `quem`, `em` | `eurolify.quem` e o relógio da base |

### 3.4 Lote (`lot_`)

| Campo | Regra |
|---|---|
| `variante`, `numero` | único por variante |
| `validade` | opcional |
| `versao_formula` | quando a Conformidade existir (`docs/14` §3, `formula_versao_id`) |
| saldo por lote | físico por variante, armazém e lote, também só por movimento |

A saída escolhe o lote que expira primeiro (proposta, **FEFO**), e a pessoa
pode escolher outro na expedição.

### 3.5 Política de stock (por variante)

| Valor | O que faz | Por omissão |
|---|---|---|
| `controla` | reserva e baixa; sem disponível, não se vende | artigos físicos |
| `nao_controla` | nunca reserva nem baixa | serviços, conteúdo digital |
| `vende_sem_stock` | reserva mesmo sem disponível (o reservado pode passar o físico); a encomenda fica `a_aguardar_stock` na preparação | nunca por omissão; o comerciante liga-a por variante |

Um kit não tem política própria: segue a dos componentes.

### 3.6 Encomenda (o que esta fatia acrescenta)

| Campo | Regra | Fonte |
|---|---|---|
| `origem`, `referencia_externa` | `checkout` nesta fatia; único por comerciante, origem e referência («uma encomenda nunca entra por duas vias») | `order-fulfilment` |
| `armazem` | escolhido no botão final (o da loja, Q1) | — |
| transições | cada uma com quem, quando e o motivo; só para a frente; correcção = nova transição | `order-fulfilment` |

Os três papéis (quem compra, quem é faturado, quem recebe) já estão na
encomenda (`contacto`, `perfil_copia`, `entrega`, da 0041); os portes já são
uma linha própria (`portes`), nunca um artigo.

### 3.7 Expedição (`shp_`)

| Campo | Regra |
|---|---|
| `encomenda`, `armazem` | — |
| linhas | variante, quantidade e **lote**; um kit expede-se pelos componentes, com o lote de cada um |
| `metodo_entrega` | **copiado** do da encomenda: o serviço da etiqueta é o vendido (lição 3.7) |
| `transportadora`, `servico`, `seguimento` | texto nesta parte (Q5); o adaptador escreve-os na parte 2 |
| `estado` | `criada` → `expedida` → `entregue` \| `devolvida_ao_remetente` \| `perdida` |
| `expedida_em`, `entregue_em` | do relógio da base; a entrega com a prova que houver (texto nesta parte) |

## 4. Estados

### 4.1 Encomenda

```
a_aguardar_pagamento → paga → em_preparacao → expedida_parcial → expedida → entregue → concluida
        │                        │                                                      
        └→ cancelada_sem_pagamento (0044)    a_aguardar_stock (vende sem stock) → em_preparacao
```

- `paga → em_preparacao`: quando o armazém começa (pela API) ou logo ao pagar
  (proposta: logo ao pagar).
- `em_preparacao → expedida_parcial | expedida`: pelas expedições; `expedida`
  quando todas as linhas saíram.
- `expedida → entregue`: quando todas as expedições estão entregues.
- `entregue → concluida`: 14 dias depois da entrega sem pedido de livre
  resolução (o prazo dos bens, `consumer-rights-eu`, linha 112; a contagem
  certa por país é **C**) — Q6.
- Cancelar uma encomenda paga fica para a fatia 11 (há dinheiro a devolver).

### 4.2 Reserva

| Momento | Movimento |
|---|---|
| botão final | `reserva` de cada linha (e dos componentes de cada kit); sem disponível, o botão final recusa |
| a encomenda cancela sem pagamento (24 h, 0044) | `libertacao` |
| a expedição sai | `libertacao` da reserva e `saida` do físico, no mesmo passo |

## 5. Regras

| # | Regra | Fonte |
|---|---|---|
| R1 | Saldo e movimento na mesma transacção, escritos pelo gatilho; a API não escreve o saldo | `order-fulfilment`, regra 1; lição 3.2 |
| R2 | O disponível mostrado e o que o botão final confere é físico − reservado de todos os canais | regra 2; lição 3.1 |
| R3 | O físico nunca fica negativo; o reservado só passa o físico em `vende_sem_stock` | regra 6 |
| R4 | O disponível de um kit é o mínimo, por componente, de disponível ÷ quantidade (arredondado para baixo); um componente arquivado ou sem stock dá 0 | regra 4; `docs/14` §3.4 (C6) |
| R5 | Uma variante que exige lote não entra nem sai sem lote | regra 5; lição 3.4 |
| R6 | A expedição leva o serviço da encomenda; mudar de serviço é uma decisão de uma pessoa, com motivo | `docs/04`, lição 3.7 |
| R7 | Duas pessoas a reservar a última unidade: uma ganha, a outra recebe «sem stock» (bloqueio na linha do saldo) | regra 2 |
| R8 | Um ajuste de inventário leva motivo; nada se ajusta em lote sem uma pessoa | `AGENTS.md` («nunca em lote»); regra 1 |
| R9 | Um sistema de gestão do comerciante só mexe no stock por movimentos (`origem: sistema_externo`), nunca escrevendo o saldo | Q3 |

## 6. Dados pessoais

- **O armazém** vê a encomenda pela vista de expedição: linhas, quantidades,
  morada de entrega, nome e telefone de quem recebe, método de entrega. **Não**
  vê o perfil de faturação, o NIF, o e-mail nem os preços (fecha a P2-10 do
  #276). Âmbito novo `fulfilment:read` / `fulfilment:write`.
- **A expedição** guarda a morada copiada da encomenda (é a prova do que foi
  enviado); a retenção segue a da encomenda (porta P2-3 do `docs/25`).
- **Os movimentos** não guardam dados de clientes: só o `ord_`/`shp_`.

## 7. Lista da API

### 7.1 API da Loja e checkout

| Rota | O quê |
|---|---|
| `GET /store/products/...` e o carrinho | passam a dizer o **disponível** por variante (quantidade ou «esgotado», Q7) |
| resumo do checkout | bloqueio `sem_stock` por linha quando não há disponível |
| botão final | reserva; sem disponível, `checkout.out_of_stock` (422) |

### 7.2 API de Administração

| Rota | Âmbito |
|---|---|
| `GET /warehouses`, `POST /warehouses`, `PATCH /warehouses/{id}` | `inventory:read` / `inventory:write` |
| `GET /inventory?variante=&armazem=` (físico, reservado, disponível, por lote) | `inventory:read` |
| `POST /inventory/receipts` (entrada, com lote) | `inventory:write` |
| `POST /inventory/adjustments` (ajuste com motivo) | `inventory:write` |
| `GET /inventory/movements` (o livro, filtrável) | `inventory:read` |
| `GET /lots`, `POST /lots` | `inventory:read` / `inventory:write` |
| `PATCH /variants/{id}/stock-policy` | `inventory:write` |
| `GET /fulfilment/orders` (a vista do armazém) | `fulfilment:read` |
| `POST /orders/{id}/shipments`, `PATCH /shipments/{id}` (expedida, entregue, seguimento) | `fulfilment:write` |
| `GET /orders/{id}/timeline` (as transições) | `orders:read` |

Âmbitos novos: `inventory:read`, `inventory:write`, `fulfilment:read`,
`fulfilment:write`. Papéis (proposta): dono e gestor todos; armazém
`inventory:*` e `fulfilment:*`; apoio `inventory:read` e `fulfilment:read`.

### 7.3 Erros (novos)

`inventory.insufficient`, `inventory.lot_required`, `inventory.negative`,
`checkout.out_of_stock`, `orders.invalid_transition`,
`shipments.line_not_in_order`, `shipments.quantity_exceeded`.

### 7.4 Eventos

`inventory.received`, `inventory.reserved`, `inventory.released`,
`inventory.adjusted`, `order.preparing`, `shipment.created`,
`shipment.dispatched`, `shipment.delivered`, `order.shipped`,
`order.delivered`, `order.completed`. Só identificadores e quantidades; nunca
a morada.

## 8. Por onde é que isto ainda pode sair errado

| Risco | O que o trava |
|---|---|
| baixas a dobrar (lição 3.2) | R1: só o gatilho escreve o saldo; a saída é da expedição, uma vez por linha expedida |
| vender o prometido (lição 3.1) | R2 e R7 |
| kit vendido sem componentes (lição 3.3) | R4; a reserva é dos componentes |
| recolha sem saber a quem avisar (lição 3.4) | R5; o lote de cada componente na linha expedida |
| serviço errado na etiqueta (lição 3.7) | R6 |
| reserva que fica presa | libertação ao cancelar (24 h) e um relatório de reservas antigas |
| o sistema de gestão e o Eurolify a discordar | R9 e Q3 |
| a mesma encomenda duas vezes | origem e referência externa únicas (§3.6) |

## 9. Perguntas para o Diogo ou o Bruno

| # | Pergunta | Proposta |
|---|---|---|
| Q1 | **Quantos armazéns?** | **um por loja** nesta fase; vários armazéns e a regra de escolha na Fase 2 |
| Q2 | **Quando se reserva o stock?** | **no botão final**, e liberta-se se a encomenda cancelar sem pagamento (24 h); pôr no carrinho não reserva |
| Q3 | **Quem manda no stock quando o comerciante tem um sistema de gestão?** (como a empresa hoje) | **o Eurolify tem o livro**; o sistema dele envia entradas e ajustes pela API (`sistema_externo`), nunca o saldo directo |
| Q4 | **Que variantes exigem lote?** | as que o comerciante marca; **por omissão, as de categorias com recolha** (cosméticos, químicos) quando a Conformidade as tiver; até lá, marca-se à mão |
| Q5 | **Transportadoras nesta parte?** | **à mão** (transportadora, serviço e número de seguimento escritos); os adaptadores (CTT, DPD ou um agregador) numa parte 2 |
| Q6 | **Quando fica «concluída»?** | **14 dias depois de entregue** sem pedido de livre resolução (**C**: a contagem por país fica para o jurista) |
| Q7 | **A loja mostra a quantidade disponível ou só «esgotado»?** | só **disponível/esgotado** por omissão; o comerciante pode ligar a quantidade |

## 10. Para o jurista e o contabilista (bloqueiam a produção, não o código)

- O prazo de livre resolução dos bens e a forma de contar por país (Q6, **C**).
- A data do documento fiscal: no pagamento ou na expedição (`docs/26` §13),
  para a fatia 10.
- Mercadorias perigosas e cadeia de frio: a classificação é de um
  profissional (`eurolify-transport-logistics-eu`, 3).

## 11. Como entra no código (quando aprovado)

- **Parte 1:**
  - migração: armazém, saldo, movimentos, lotes, política de stock, expedições, transições da encomenda e âmbitos;
  - os gatilhos que fazem do livro a única porta;
  - o disponível dos kits;
  - a reserva no botão final e a libertação ao cancelar;
  - a vista do armazém;
  - testes de concorrência (a última unidade), dos kits, dos lotes e das baixas a dobrar; mutações e a revisão do agente.
- **Parte 2:** os adaptadores de transportadora.
- Cada parte num pedido, com os testes verdes e a revisão do agente antes de juntar (ADR-0031, ADR-0035).
