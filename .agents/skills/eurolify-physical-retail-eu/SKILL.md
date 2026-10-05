---
name: eurolify-physical-retail-eu
description: "Desenha loja física e operação omnicanal UE: POS, caixa, recolha, devoluções, acessibilidade e dados. Usa para balcão e click-and-collect; não copia automaticamente direitos da venda à distância nem substitui verificação fiscal nacional."
compatibility: "Requer eurolify-legal-briefing-eu e consumer-rights-eu."
metadata:
  version: "1.0.0"
---

# Retalho físico e omnicanal

> Estado: **desenho** — o código está autorizado (ADR-0023), mas o de cada domínio só depois do desenho dele em tabela. A fase da loja física, dos distribuidores e do franchising está **por decidir** (`docs/16-auditoria-das-skills.md`, Q3); só as listas de preços B2B estão na Fase 1 (`docs/05`).

Lê `.agents/skills/eurolify-legal-briefing-eu/references/retail-pos-tax.md`.

1. Determina onde e quando o contrato foi concluído: balcão, online com recolha ou mera reserva. Local de entrega não basta.
2. Separa livre resolução, falta de conformidade, garantia comercial e devolução voluntária. Reutiliza `consumer-rights-eu`, sem sobrepor políticas.
3. Identifica entidade, loja, caixa, operador, preço final, unidade de medida, pagamento e documento nacional.
4. Usa `eurolify-tax-pos-invoicing-eu` para emissão e `eurolify-payment-readiness-eu` para terminal. Não oferece emissão offline sem desenho e validação do regime local.
5. Desenha sincronização de stock, reservas, movimentos de caixa, recolha e devolução noutro estabelecimento; não dá duas vezes o mesmo crédito.
6. Testa rutura de ligação, fecho de caixa, conflito, recibo recusado, trocas parciais e permissões.

Inclui acessibilidade de serviço/terminal/instalação conforme o caso, avisos legais e políticas visíveis também no balcão. Para funcionários, câmaras ou licenças do estabelecimento, usa `eurolify-contracts-operations-eu` e `eu-gdpr-privacy`.

Não transforma um recibo de cartão em fatura nem uma devolução voluntária em redução dos direitos legais.
