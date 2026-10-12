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
- **Ponta a ponta** (12/10/2026, #387): um caso em `test/posvenda-api.test.ts`
  pelo circuito real — checkout, captura, fatura do emissor de ensaio,
  devolução de 1 unidade, reembolso e NC — confere os quatro números do dia
  (29,59 € encomendado, pago e faturado; 12,30 € / 10,00 € creditado e
  devolvido). Falha se o devolvido sem IVA deixar de vir da NC.
- **Medição** (12/10/2026, `test/medicao-vendas.test.ts` com `MEDIR=1`; base
  local PostgreSQL 18.6 com as definições de omissão, não a VPS; 3 × 100 000
  encomendas em 13 meses, `VACUUM ANALYZE` depois de encher; duas corridas de
  5 voltas). Um dia: mediana 24 e 27 ms. Um mês (~7 600 encomendas): mediana
  520 e 438 ms; primeira volta 569 e 517 ms; com o PostgreSQL acabado de
  reiniciar, 742 ms (medido à mão, só a cache do PostgreSQL vazia). Sem os
  índices da 0068: dia 194 e 166 ms, mês 879 e 725 ms. Sem o VACUUM, a
  primeira volta do mês chegou a 5,4 s. Decisão técnica: não se pré-calcula.

## O que ficou por verificar

- O tempo na VPS com dados reais: a medição foi numa base local.
- O ecrã do painel (Fase 2) e a ferramenta do MCP (peça 12) usam esta rota;
  nenhum dos dois existe ainda.
- Só há modo de teste; quando houver modo real, os dois nunca se somam
  (ponto a desenhar com o modo real).
