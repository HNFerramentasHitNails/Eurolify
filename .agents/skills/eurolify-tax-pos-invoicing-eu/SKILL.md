---
name: eurolify-tax-pos-invoicing-eu
description: "Complementa o IVA da Eurolify com faturação nacional, recibos, caixa/POS, séries, e-invoicing e prova fiscal. Usa ao ligar emissão por país ou balcão; não inventa regras fiscais, taxas, certificações ou aprovação dos 27 regimes."
compatibility: "Requer eurolify-legal-briefing-eu e eu-vat-oss-ioss."
metadata:
  version: "1.0.0"
---

# Faturação e caixa por país

Lê `.agents/skills/eurolify-legal-briefing-eu/references/retail-pos-tax.md` e `references/timeline.md` nessa pasta quando uma data de reforma for relevante.

1. Usa `eu-vat-oss-ioss`: não implementa outra determinação de IVA.
2. Identifica entidade emitente, estabelecimento, país/território, B2C/B2B, tipo de documento, adiantamento e regime.
3. Confirma fontes nacionais atuais para obrigatoriedade de software, séries, comunicação, assinatura, QR, e-invoicing, recibos e retenção. Um formato europeu não prova cumprimento nacional.
4. Define quem emite e a prova autoritativa, compatível com as decisões atuais do projeto. O número/documento vem do sistema autorizado; não o inventa.
5. Liga estados separados: encomenda, pagamento, documento solicitado, retido, emitido, corrigido. Timeout exige reconciliação, não nova emissão cega.
6. Testa rejeição, repetição, documentos parciais, erro de identidade e correção/nota de crédito; a prova é o documento efetivamente emitido.

Não dá uma data nacional como obrigatória a partir de um artigo comercial. ViDA exige acompanhamento, mas não é uma autorização para uma API de faturação universal. Correções e reenvios fiscais continuam sujeitos à fila e à decisão humana do projeto.
