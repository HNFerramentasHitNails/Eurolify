---
name: eurolify-commerce-coverage-eu
description: "Mapeia cobertura funcional tipo Shopify para a Eurolify exclusivamente UE, da pequena loja a organizações com vários canais. Usa para lacunas de backoffice e prontidão comercial; não considera funcionalidades Shopify como leis ou prova de conformidade."
compatibility: "Requer eurolify-legal-briefing-eu e skills de arquitetura/design existentes."
metadata:
  version: "1.0.0"
---

# Cobertura de comércio, não cópia jurídica

> Estado: **desenho** — o código está autorizado (ADR-0023), mas o de cada domínio só depois do desenho dele em tabela. Esta skill mapeia percursos; não dá nenhum por feito.

Lê `.agents/skills/eurolify-legal-briefing-eu/references/shopify-coverage.md`.

1. Separa site institucional, montra do comerciante, checkout/conta, Hub e administração da plataforma.
2. Mapeia a função requerida para os contratos/domínios Eurolify e para os papéis do comerciante; não constrói apenas um menu.
3. Usa Shopify como referência funcional documentada e condicionada por plano/país; não presume que tudo está incluído ou conforme.
4. Para cada função, liga percurso completo, autorizações, requisitos nacionais/setoriais, estados de erro e testes.
5. Define configurações progressivas: pequena loja vê o necessário, organização maior tem entidades, locais e permissões; controles obrigatórios não desaparecem em “modo simples”.
6. Entrega cobertura: `desenhado | implementado | testado | revisto | em uso | país/setor/canal | falta`.

Não declara que 73 ecrãs demonstrativos equivalem a 73 funcionalidades prontas. Não replica serviços financeiros próprios de outro fornecedor nem exige que a Eurolify passe a custodiar fundos.
