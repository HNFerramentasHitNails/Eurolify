---
name: eurolify-payment-readiness-eu
description: "Verifica entidade, prestador, conta e âmbito regulado antes de ativar pagamentos online/POS na Eurolify. Usa para onboarding, marketplaces, saldos ou pagamentos locais; complementa payments-psd2-sca, sem conceder licença ou guardar fundos de comerciantes."
compatibility: "Requer eurolify-legal-briefing-eu e payments-psd2-sca."
metadata:
  version: "1.0.0"
---

# Prontidão de pagamento

Lê `.agents/skills/eurolify-legal-briefing-eu/references/finance-payments.md`.

1. Usa `payments-psd2-sca` para SCA e desenho dos estados.
2. Distingue fornecedor técnico, comerciante, PSP, intermediário/plataforma e beneficiário. Não introduz custódia, escrow ou divisão de fundos sem desenho e autorização.
3. Confirma entidade e permissões no registo nacional competente; usa EBA como ponto de pesquisa, não como garantia jurídica.
4. Confirma contrato, países/moedas, conta do comerciante, métodos, terminal, devoluções e atividades excluídas pelo prestador.
5. Se há crédito ao consumidor, BNPL, carteira, cartão multi-comerciante ou rede limitada, encaminha para revisão especializada; o nome do produto não resolve a classificação.
6. Testa conta incorreta, assinatura inválida, pagamento incerto, duplicado, reembolso parcial e reconciliação.

Nunca recolhe dados completos de cartão no Hub ou logs. Normas industriais não são leis da UE e um checkout alojado não prova conformidade total. PSD3/PSR só substituem obrigações atuais quando o ato final e a aplicação tiverem sido confirmados.
