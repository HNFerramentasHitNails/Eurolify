---
name: eurolify-finance-reconciliation-eu
description: "Desenha controlo financeiro e conciliação da Eurolify: vendas, recebimentos, taxas, reembolsos, caixa e exportação contabilística. Usa para diferenças financeiras e movimentos; não é consultoria de investimento nem certifica contabilidade ou movimenta fundos."
compatibility: "Requer eurolify-legal-briefing-eu, pagamentos e IVA existentes."
metadata:
  version: "1.0.0"
---

# Controlo financeiro

Lê `.agents/skills/eurolify-legal-briefing-eu/references/finance-payments.md`.

1. Define entidade, período, moeda, regime aprovado e fonte de cada valor; separa vendas, caixa, recebimentos, liquidação PSP e documentos.
2. Mantém movimentos e referências autoritativas, com reversões em vez de reescrever história. Define o modelo contabilístico com o contabilista, sem inventar contas nacionais.
3. Concilia bruto, desconto, imposto, envio, comissão/taxa, reembolso, chargeback e líquido depositado. Adiantamento não é presumido receita final.
4. Distingue relatório operacional de demonstração financeira, e saldo comercial de dinheiro disponível.
5. Usa idempotência e reconciliação para repetidos ou incertos; diferença vai para fila com motivo, dono e evidência.
6. Testa pagamentos parciais, várias liquidações, arredondamento aprovado, crédito de loja, devolução e fecho de caixa.

Não faz lançamentos contabilísticos reais, reembolsos ou ajustes fiscais por iniciativa própria. Usa `gift-cards-eu` para cartões-oferta; não classifica automaticamente a venda do cartão como receita nem presume que saldo é isento de regulação.
