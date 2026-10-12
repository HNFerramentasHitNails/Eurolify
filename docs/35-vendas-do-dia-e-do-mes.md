# Vendas do dia e do mês: uma consulta, quatro números

> **Versão de 12/10/2026 — desenho aprovado** pelo Diogo a 12/10/2026
> (*«aprovado»*), com as três propostas da §6 (`docs/06`, DY). Peça 22 da Fase 1
> (issue #367; decisão DS, ADR-0043, ponto 4; `docs/13` §11). Os números
> dependem de domínios ainda a crescer (encomendas, pagamentos, documentos
> fiscais, pós-venda).
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
| **Faturado** | quanto faturei? | as faturas emitidas pelo Eurolify; as notas de crédito vêm à parte em `creditado` | o `em` da passagem a `emitido` (`documento_rasto`, `0050:333-363`) | `documento_prova.totais.{base, iva, total}`: o que o emissor devolveu, como o domínio conta (`faturacao/repositorio.ts:2377-2391`); a moeda vem do conteúdo (revisão do #383, P1-1) |
| **Devolvido** | quanto devolvi? | os reembolsos executados, de qualquer origem (devolução, problema, cancelamento) | `reembolso.executado_em` (`0058:515-526`) | `reembolso.montante`; sem IVA pela nota de crédito do reembolso, quando a há (§3) |

As comissões e as metas, quando vierem, contam sobre o **faturado**, nunca
sobre o encomendado (`docs/13` §11, porta 6).

## 2. O período e o fuso

| Pedido | Período | Exemplo |
|---|---|---|
| `dia=AAAA-MM-DD` | das 00:00 às 24:00 desse dia, **no fuso do comerciante** (`comerciante.fuso`, `0001:38-39`) | `dia=2026-10-11` em `Europe/Lisbon`: de `2026-10-11T00:00+01:00` a `2026-10-12T00:00+01:00` |
| `mes=AAAA-MM` | do dia 1 às 00:00 ao dia 1 do mês seguinte, no mesmo fuso | `mes=2026-10` |

- A resposta traz `periodo.de` e `periodo.ate` em UTC (ISO 8601 com `Z`;
  o mesmo instante) e o nome do fuso (revisão do #383, P3-1). Um dia da mudança de hora tem 23 ou 25 horas; conta-se pelo
  relógio local, não por 24 horas.
- Um período que ainda não acabou (hoje, este mês) vem com
  `periodo.completo: false` e `periodo.ate` = o momento da consulta.
- Um período no futuro: 400 `request.invalid`. Sem limite para trás (§6, Q3).

## 3. Com e sem IVA, sem recalcular

O IVA nunca se recalcula aqui: lê-se o que o domínio guardou.

| Número | Com IVA | Sem IVA | Quando não se sabe |
|---|---|---|---|
| Encomendado | `total` | `total_base` | — |
| Pago | `pagamento.montante` | o `total_base` da encomenda, **só na primeira captura dela e quando o montante capturado é igual ao `total`** (é a regra para a encomenda passar a paga, `0044:434-445`) | um segundo pagamento capturado da mesma encomenda (um duplicado) conta no com IVA e entra em `sem_iva_por_conhecer`: a base da venda não conta duas vezes (revisão do #383, P2-1) |
| Faturado | `totais.total` da prova | `totais.base` da prova | — |
| Devolvido | `reembolso.montante` | a base da prova da nota de crédito ligada ao reembolso (`documento_fiscal.reembolso_id`, `0058:733-747`), emitida, divergente ou resolvida | sem nota de crédito saída (ainda não, ou comerciante com sistema próprio), o reembolso conta no com IVA e entra em `sem_iva_por_conhecer` |

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
| Erros | RFC 9457: `request.invalid` (dia e mês juntos, nenhum, data inválida, futuro), `auth.forbidden` sem o âmbito numa chave; no Hub, `member.role_escalation` sem o papel, como as outras rotas do Hub (revisão do #383, P3-3) |

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
`0050:27`; ADR-0041): o Eurolify não fatura essas encomendas. Quando há
encomendas do período com esse emissor (o que a encomenda copiou no botão
final, não o de hoje), a frase do faturado diz que o Eurolify não conta essas
faturas (revisão do #383, P3-5).

## 6. Perguntas para o Diogo ou o Bruno

| # | Pergunta | Proposta |
|---|---|---|
| Q1 | Quem vê as vendas? | ✅ **Decidido** (Diogo, 12/10/2026): um âmbito novo `sales:read`, no dono e no gestor (como o `docs/13` §11: «um papel, o dono e o gestor»). Ler os quatro números junta encomendas, pagamentos, faturas e reembolsos; não chega ter um deles |
| Q2 | O encomendado conta as encomendas que depois se cancelaram? | ✅ **Decidido** (Diogo, 12/10/2026): sim, conta tudo o que se pediu, com `das_quais_canceladas` à parte. Assim o encomendado de ontem não muda quando alguém cancela hoje |
| Q3 | Até quando para trás se pode pedir? | ✅ **Decidido** (Diogo, 12/10/2026): sem limite na rota; a medição (§7) diz se é preciso um |

## 7. Desempenho: medir antes de pré-calcular

Os índices por comerciante e instante entraram com o código (migração 0068).
**Medido a 12/10/2026** (`test/medicao-vendas.test.ts`, corre só com
`MEDIR=1`; os números saem dele, salvo onde se diz):

| O quê | Valor |
|---|---|
| A base | PostgreSQL 18.6 local, com as definições de omissão (`shared_buffers` 128 MB, `work_mem` 4 MB), 4 CPU e 15 GB; **não é a VPS** |
| Os dados | 3 comerciantes × 100 000 encomendas (300 000), espalhadas por 13 meses: ~80 % pagas (~240 000 pagamentos, três transições cada), as faturas e ~4 % reembolsadas (5 % das pagas) com nota de crédito (~237 000 documentos, três passos de rasto cada; ~11 800 reembolsos); `VACUUM ANALYZE` depois de encher |
| Um dia (~250 encomendas) | mediana **24 ms** e **27 ms** (duas corridas de 5 voltas; máximos 26 e 28 ms); a primeira volta, 65 e 55 ms |
| Um mês (~7 600 encomendas) | mediana **520 ms** e **438 ms** (máximos 631 e 482 ms); a primeira volta, 569 e 517 ms |
| Um mês com o PostgreSQL acabado de reiniciar | **742 ms** na primeira consulta; o mesmo mês a seguir 428 ms, outro mês 449 ms, um dia 22 ms. Medido à mão (não sai do teste), e só a memória do PostgreSQL estava vazia: a do sistema operativo não se conseguiu esvaziar no contentor |
| Sem os índices da 0068 | dia, mediana 194 e 166 ms; mês, 879 e 725 ms (medidos depois, já com a cache quente: a diferença, se tanto, está por baixo) |

Na primeira medição, sem o `VACUUM`, a primeira volta do mês chegou a
5,4 s (a primeira leitura depois de uma carga em massa grava os *hint bits* e
ainda não há mapa de visibilidade).

Onde está o tempo do mês (`EXPLAIN ANALYZE` à mão, na primeira medição; não
sai do teste): o encomendado leva 6 ms; o pago (112 ms) e o faturado (131 ms)
cruzam com todos os pagamentos e todas as provas do comerciante (cerca de
80 000). Reescrever essas ligações como procuras pela chave não mudou o plano.

**Decisão técnica:** não se pré-calcula. Um mês com 7 600 encomendas responde
entre meio segundo e três quartos de segundo, também com a cache do
PostgreSQL vazia, o que chega para o MCP de leitura e para o painel. Volta-se
a medir quando um comerciante passar das 100 000 encomendas por ano. **Na
VPS, nunca com este teste** (muda a palavra-passe do papel da API da
instância): só a ler, com `EXPLAIN ANALYZE` pelo fluxo de medir.

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
