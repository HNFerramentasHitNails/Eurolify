---
name: eurolify-b2b-channels-eu
description: "Modela distribuidores, revendedores, agentes comerciais e franchising na Eurolify UE, com contratos, entidade vendedora, permissões e concorrência. Usa para canais profissionais; não considera o nome do cliente ou um NIF suficientes para classificar B2B."
compatibility: "Requer eurolify-legal-briefing-eu e skills de domínio pertinentes."
metadata:
  version: "1.0.0"
---

# Canais e contratos profissionais

Lê `.agents/skills/eurolify-legal-briefing-eu/references/channels-contracts.md`.

1. Distingue distribuidor/revendedor que compra e revende, agente, franchisado, operador logístico e consumidor.
2. Identifica quem contrata, vende, cobra, entrega, emite e responde por produto/garantia; um grupo de empresas não é uma entidade única.
3. Modela preço de compra, descontos, crédito, mínimos, comissões e royalties sem misturar fluxos. Condições fiscais continuam no domínio próprio.
4. Antes de restringir preço de revenda, território, canal online ou clientes, exige análise concorrencial do contrato e do caso.
5. Confirma regras nacionais de agência/franchising, informação pré-contratual, propriedade intelectual, duração, saída e indemnizações.
6. Desenha catálogo e permissões por entidade/loja/papel; testa que um franchisado não lê dados de outro só por partilhar marca.

Não usa “cliente profissional” para remover direitos de alguém que atua como consumidor. Não incorpora cláusulas de fixação de preços ou exclusividade como defaults técnicos.

Saída: tabela dos papéis e fluxos, decisões comerciais, cláusulas a rever, permissões, fontes e bloqueios.
