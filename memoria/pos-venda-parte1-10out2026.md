# Pós-venda, parte 1 (fatia 11, #328, #329), 10/10/2026

## O que se fez

- **Desenho:** `docs/30-pos-venda.md` (era o `docs/29`, que passou aos
  documentos fiscais, #332), aprovado pelo Diogo a 10/10/2026 com as sete
  propostas (`docs/06`, **DM**; *«aprovado»*, depois *«avança»* para o código).
- **Código da parte 1** (#329), migração **0058** (`0058_pos_venda.sql`):
  - pedido de livre resolução, devolução, problema e reembolso (com linhas),
    com RLS forçado e os estados e tectos garantidos pela base;
  - **botão de livre resolução** na API da Loja
    (`GET`/`POST /store/orders/{token}/withdrawal`), só para consumidores (Q1);
    fora do prazo ou sem devolução possível, o pedido fica registado para uma
    pessoa (`fora_de_prazo`, `pendente`);
  - devolução com recepção e inspecção; só o revendável volta a stock (Q5),
    pelo lote da saída (movimento `devolucao`);
  - reembolso decidido por uma pessoa depois da inspecção (Q3), manual com
    prova (Q2), anulável antes de o dinheiro sair, nunca acima do pago nem a
    dobrar;
  - nota de crédito pelo circuito da fatia 10, pela ligação da fatura e com a
    proporção base/IVA dela, **só depois do reembolso executado**;
  - cancelar uma encomenda paga não expedida (Q7): liberta as reservas,
    reembolsa tudo e pede a NC;
  - a encomenda ganhou `cancelada`, `devolvida_parcial` e `devolvida`;
    âmbitos `returns:*` e `refunds:*`; o tecto de âmbitos por chave passou de
    40 para 60.
- **Revisão do agente** (Claude Sonnet 5.5, ADR-0035): 0 P0, 4 P1, 11 P2,
  11 P3; os P1 corrigidos com teste e mutação apanhada; tratamento publicado
  no pedido.
- **Continuado noutra sessão** (a que o escreveu ficou sem crédito): o `main`
  juntado quatro vezes e a migração renumerada de 0054 para **0058** — a 0054
  entrou com o rasto (#340), a 0055 com os anexos da isenção (#338) e a 0057
  com a chave de um agente de IA (#342), que se juntou primeiro. O migrador
  recusa uma migração com número abaixo de uma já aplicada
  (`src/base/migracoes.ts`, `Migrator` sem `allowUnorderedMigrations`).
- **A letra DM** ficou com a pós-venda (registada às 18:32 UTC, `80a4771`); os
  anexos, que também a tinham usado, passaram a DN.
- **Juntado** a 10/10/2026 (`1b538e2`). **Publicado no ensaio:** corrida 38093050863, com sucesso às 23:03 UTC; o registo diz «migrar: aplicadas 0058_pos_venda» e «O /health da API responde».

## Números (com data e como se contaram)

- 10/10/2026, neste contentor (PostgreSQL 18.6 da lista
  `infra/ci/imagens-base.txt`, Node 24.21), com o `main` em `5266f9e`:
  `pnpm lint` e `pnpm tipos` limpos; **API 1314 de 1314**, Hub 140, MCP 58.
  Depois do #341 (só Hub): lint, tipos e Hub 161 de 161.
- `test/posvenda-api.test.ts`: 16 testes.
- Mutações: 23 na primeira ronda e 15 dirigidas às correcções da revisão,
  todas apanhadas (contadas pela sessão original).

## O que ficou por verificar

- **Parte 2 por fazer:** o reembolso pelo prestador (EuPago, depois de lida a
  documentação), `/execute` e `/reconcile`; o aviso antes de acabar o prazo do
  reembolso (R10); a marca «selado por higiene».
- **C:** jurista (J1 a J5) e contabilista (C1 a C4). O código fixa o lado
  seguro: 14 dias da última entrega; NC só depois do reembolso executado.
- **Não li a base do ensaio** depois de publicar.
