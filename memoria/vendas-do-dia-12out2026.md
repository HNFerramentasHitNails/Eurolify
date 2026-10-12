# Vendas do dia e do mês (peça 22, #367) — 12/10/2026

## O que se fez

- Desenho `docs/35`, aprovado pelo Diogo a 12/10/2026 (*«aprovado»*, decisão
  DY, pedido #380): uma consulta, quatro números (encomendado, pago,
  faturado, devolvido), com e sem IVA, por moeda, canal e mercado, no fuso
  do comerciante, com a frase do que conta.
- Código: `GET /sales/summary` (âmbito novo `sales:read`, dono e gestor) e
  `GET /hub/sales/summary` (só com o Hub ligado), a mesma função
  (`src/vendas/`); migração 0068 (o âmbito e quatro índices por comerciante
  e instante).
- O IVA lê-se do que o domínio guardou: o pago sem IVA é o da encomenda só
  quando o capturado é igual ao total; o devolvido sem IVA é o da nota de
  crédito emitida do reembolso. O resto fica em `sem_iva_por_conhecer`.
- Um período em curso vai até agora (`completo: false`).

## Números (com data e como se contaram)

- Testes da peça: 13 em `test/vendas.test.ts` (12/10/2026, depois da revisão
  do #383), com dados postos directamente na base para marcar as horas exactas.
- **Medição** (12/10/2026, `test/medicao-vendas.test.ts` com `MEDIR=1`; base
  local PostgreSQL 18.6 com as definições de omissão, não a VPS): 3 × 100 000
  encomendas em 13 meses. Um dia: 23–24 ms (mediana de 5). Um mês (~7 600
  encomendas): 399–508 ms (mediana de 5; 5,4 s numa primeira volta logo após
  encher). Sem os índices da 0068: dia 94 ms, mês 823 ms. O pago e o faturado
  levam ~110–130 ms cada no mês. Decisão técnica: não se pré-calcula.

## O que ficou por verificar

- O tempo na VPS com dados reais: a medição foi numa base local.
- O ecrã do painel (Fase 2) e a ferramenta do MCP (peça 12) usam esta rota;
  nenhum dos dois existe ainda.
- Só há modo de teste; quando houver modo real, os dois nunca se somam
  (ponto a desenhar com o modo real).
