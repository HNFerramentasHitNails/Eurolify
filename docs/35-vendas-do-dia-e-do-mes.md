# Vendas do dia e do mês: uma consulta, quatro números

> **Versão de 12/10/2026 — proposta, por aprovar.** Peça 22 da Fase 1
> (issue #367; decisão DS, ADR-0043, ponto 4; `docs/13` §11). O código só
> entra depois de o Diogo ou o Bruno aprovarem este desenho (ADR-0023), e os
> números dependem de domínios ainda a crescer (encomendas, pagamentos,
> documentos fiscais, pós-venda).
>
> Skills seguidas: `headless-commerce` (rota, contrato, dinheiro em
> cêntimos), `eurolify-finance-reconciliation-eu` (separar vendas,
> recebimentos, documentos e reembolsos; fonte de cada valor),
> `eu-vat-oss-ioss` (com e sem IVA, nunca recalculado),
> `observability-security` (isolamento, âmbito novo) e
> `eurolify-engineering-execution` (testes, índices, medir antes de
> pré-calcular).

## 1. O que responde

Exemplo: o Diogo pergunta ao assistente «quanto vendi ontem em Espanha?». O
assistente pede `GET /sales/summary?dia=2026-10-11` e responde com os quatro
números do mercado de Espanha, cada um com a frase do que conta. O painel do
Hub (Fase 2) usa a mesma rota: o número do ecrã e o da IA vêm do mesmo sítio
(«Uma regra, um sítio»).

**«Vendas» são quatro números diferentes, nunca somados nem trocados:**

| Número | Pergunta a que responde | O que conta | Quando conta | De onde sai |
|---|---|---|---|---|
| **Encomendado** | quanto me pediram? | as encomendas criadas no botão final, **em qualquer estado**, incluindo as que depois se cancelaram (vêm à parte em `das_quais_canceladas`) | `encomenda.criada_em` dentro do período | `encomenda.total`, `total_base`, `total_iva` (`0041_checkout.sql:334-336`) |
| **Pago** | quanto recebi? | os pagamentos que passaram a `capturado` | o `em` da transição para `capturado` (`transicao_pagamento`, `0044:313-326`) | `pagamento.montante`; sem IVA pela encomenda paga (§3) |
| **Faturado** | quanto faturei? | as faturas emitidas pelo Eurolify; as notas de crédito vêm à parte em `creditado` | o `em` da passagem a `emitido` (`documento_rasto`, `0050:333-363`) | `documento_conteudo.conteudo.totais.{base, iva, total}` da última versão (`faturacao/repositorio.ts:822-826`) |
| **Devolvido** | quanto devolvi? | os reembolsos executados, de qualquer origem (devolução, problema, cancelamento) | `reembolso.executado_em` (`0058:515-526`) | `reembolso.montante`; sem IVA pela nota de crédito do reembolso, quando a há (§3) |

As comissões e as metas, quando vierem, contam sobre o **faturado**, nunca
sobre o encomendado (`docs/13` §11, porta 6).

## 2. O período e o fuso

| Pedido | Período | Exemplo |
|---|---|---|
| `dia=AAAA-MM-DD` | das 00:00 às 24:00 desse dia, **no fuso do comerciante** (`comerciante.fuso`, `0001:38-39`) | `dia=2026-10-11` em `Europe/Lisbon`: de `2026-10-11T00:00+01:00` a `2026-10-12T00:00+01:00` |
| `mes=AAAA-MM` | do dia 1 às 00:00 ao dia 1 do mês seguinte, no mesmo fuso | `mes=2026-10` |

- A resposta traz `periodo.de` e `periodo.ate` com o desvio do fuso, e o
  nome do fuso. Um dia da mudança de hora tem 23 ou 25 horas; conta-se pelo
  relógio local, não por 24 horas.
- Um período que ainda não acabou (hoje, este mês) vem com
  `periodo.completo: false` e `periodo.ate` = o momento da consulta.
- Um período no futuro: 400 `request.invalid`. Mais de 13 meses para trás:
  por decidir (§6, Q3).

## 3. Com e sem IVA, sem recalcular

O IVA nunca se recalcula aqui: lê-se o que o domínio guardou.

| Número | Com IVA | Sem IVA | Quando não se sabe |
|---|---|---|---|
| Encomendado | `total` | `total_base` | — |
| Pago | `pagamento.montante` | o `total_base` da encomenda, **só quando o montante capturado é igual ao `total` dela** (é a regra para a encomenda passar a paga, `0044:434-445`) | se forem diferentes, o pagamento conta no com IVA e entra em `sem_iva_por_conhecer` |
| Faturado | `totais.total` | `totais.base` | — |
| Devolvido | `reembolso.montante` | a base da nota de crédito ligada ao reembolso (`documento_fiscal.reembolso_id`, `0058:733-747`) | sem nota de crédito emitida (ainda não, ou comerciante com sistema próprio), o reembolso conta no com IVA e entra em `sem_iva_por_conhecer` |

Cada número traz `quantidade` (encomendas, pagamentos, documentos ou
reembolsos contados) e, quando há, `sem_iva_por_conhecer` com quantos ficaram
de fora do sem IVA e o montante com IVA deles. **Nunca se estima.**

## 4. Moeda, canal e mercado

- **Nunca se somam moedas.** Um comerciante com o mercado de Portugal em EUR e
  outro em PLN recebe dois blocos, um por moeda. Não há total geral em várias
  moedas (o câmbio não é desta peça).
- Por **canal** e por **mercado** da encomenda (`encomenda.canal_id`,
  `encomenda.mercado_id`, `0041:321-322`). O pagamento, a fatura e o
  reembolso contam no canal e no mercado da encomenda deles.
- Filtros opcionais: `canal=chn_…`, `mercado=mkt_…`.

## 5. A rota

| | |
|---|---|
| Rota | `GET /sales/summary` (API de Administração) e `GET /hub/sales/summary` (sessão do Hub, mesma função) |
| Parâmetros | `dia` **ou** `mes` (um dos dois, obrigatório); `canal`, `mercado` (opcionais) |
| Âmbito | **novo `sales:read`** (§6, Q1): dono e gestor; não o armazém nem o apoio |
| Resposta | `periodo {de, ate, fuso, completo}` e `moedas[]`, cada uma com `moeda`, `total` e `por_canal_e_mercado[]` (`canal`, `mercado`, os quatro números) |
| Cada número | `{com_iva, sem_iva, quantidade, o_que_conta: {pt, en}, sem_iva_por_conhecer?: {quantidade, com_iva}}`; encomendado com `das_quais_canceladas`; faturado com `creditado` |
| Dinheiro | inteiros em cêntimos com a moeda ao lado (regra 8 da `headless-commerce`) |
| Isolamento | corre em `comComerciante`, só leitura (RLS); um teste tenta ler as vendas de outro comerciante e tem de dar zero |
| Erros | RFC 9457: `request.invalid` (dia e mês juntos, nenhum, data inválida, futuro), `auth.forbidden` sem o âmbito |

Exemplo de um número:

```json
"pago": {
  "com_iva": 12300, "sem_iva": 10000, "quantidade": 2,
  "o_que_conta": {
    "pt": "Pagamentos capturados entre 11/10/2026 00:00 e 12/10/2026 00:00 (Europe/Lisbon).",
    "en": "Payments captured between …"
  }
}
```

**O modo de teste:** hoje só há pagamentos e documentos em modo `teste`
(`0044:161`, `0050:156`), e a encomenda não guarda o modo. Até haver modo real,
a resposta diz `modo: "teste"`; quando houver, os dois nunca se somam
(ponto a desenhar com o modo real).

**O comerciante com sistema próprio** (`emissor_fiscal = 'sistema_proprio'`,
`0050:27`; ADR-0041): o Eurolify não fatura por ele, por isso o faturado vem
vazio com a frase «as faturas são emitidas pelo seu sistema; o Eurolify não as
conta».

## 6. Perguntas para o Diogo ou o Bruno

| # | Pergunta | Proposta |
|---|---|---|
| Q1 | Quem vê as vendas? | Um âmbito novo `sales:read`, no dono e no gestor (como o `docs/13` §11: «um papel, o dono e o gestor»). Ler os quatro números junta encomendas, pagamentos, faturas e reembolsos; não chega ter um deles |
| Q2 | O encomendado conta as encomendas que depois se cancelaram? | Sim, conta tudo o que se pediu, com `das_quais_canceladas` à parte. Assim o encomendado de ontem não muda quando alguém cancela hoje |
| Q3 | Até quando para trás se pode pedir? | Sem limite na rota; a medição (§7) diz se é preciso um |

## 7. Desempenho: medir antes de pré-calcular

Não há índice por comerciante e instante em nenhuma destas tabelas
(procurei `CREATE INDEX` nas migrações). Proposta:

- índices novos, numa migração: `encomenda (comerciante_id, criada_em)`,
  `reembolso (comerciante_id, executado_em)`, e um sobre as transições para
  `capturado` e as passagens a `emitido`;
- **medir** a consulta com 100 000 encomendas de teste antes de decidir
  pré-calcular por dia (`docs/13` §11, porta 7). Sem medida, não há tabela de
  totais.

## 8. Testes que impedem o lançamento

- Vendas conhecidas num dia: os quatro números batem com a soma à mão, com e
  sem IVA.
- Um comerciante nunca vê os números de outro (RLS e a rota).
- Um dia de mudança de hora (23 e 25 horas) no fuso do comerciante.
- Duas moedas: dois blocos, nunca somados.
- Uma encomenda cancelada: conta no encomendado e em `das_quais_canceladas`;
  não no pago.
- Um reembolso sem nota de crédito: no com IVA, e em `sem_iva_por_conhecer`.
- Uma encomenda de ontem paga hoje: encomendada ontem, paga hoje.
- Um comerciante com sistema próprio: faturado vazio com a frase certa.

## 9. Fica de fora

O ecrã do painel (Fase 2), a ferramenta do MCP de leitura (peça 12), os
painéis de cada módulo, as metas e os painéis por comercial (camada C), o
câmbio entre moedas, e o relatório OSS (fatia 10, parte 3).

## 10. O que não foi verificado

- Se o `GET /invoices` limita a 200 resultados (não li o repositório).
- O tempo de resposta real (sem medida, §7).
- A frase em inglês de cada número: escrevo-a com o código, revista pelo
  Diogo ou pelo Bruno.
