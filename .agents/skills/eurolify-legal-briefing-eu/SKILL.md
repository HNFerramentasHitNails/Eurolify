---
name: eurolify-legal-briefing-eu
description: "Coordena análise jurídica da Eurolify para lojas online e físicas na UE, todos os setores e canais B2C/B2B. Usa ao definir obrigações ou prontidão legal; encaminha para skills especializadas e profissionais, sem substituir parecer jurídico nem autorizar atividades reguladas."
metadata:
  version: "1.0.0"
  verified_at: "2026-10-05"
---

# Coordenação jurídica europeia

Skill complementar, não um advogado habilitado nem uma certificação de conformidade. Preserva `AGENTS.md`, ADR e skills existentes. As regras são da UE e do Estado-membro pertinente; normas técnicas e comportamento da Shopify não são legislação.

## Percurso obrigatório

1. Identifica entidade vendedora, papel económico, comprador, produto/serviço, países/territórios e canal onde se conclui o contrato. Lê `references/scope-and-roles.md`.
2. Seleciona as skills existentes de consumidor, IVA, pagamentos, dados e produto, mais as complementares da tabela. Não carrega tudo: usa apenas os temas afetados.
3. Lê `references/evidence.md`. Para cada regra, regista fonte oficial, artigo, versão, alcance, datas, W/M/C e nível de leitura. Não presume que um resumo confirma todas as alterações nacionais.
4. Se faltam factos determinantes, pergunta antes de escrever o ponto afetado. Licença, fiscalidade, produtos de risco, concorrência e divergência nacional exigem o profissional competente.
5. Entrega uma matriz de requisitos, dados necessários, bloqueios, validações e testes. Não muda uma regra C para aprovada apenas por ter sido transformada em código.
6. Antes da ativação, usa `eurolify-country-readiness-eu` e a evidência de testes. Explica o que está verificado e o que não está, em linguagem de gestão.

## Encaminhamento

| Tema | Skill complementar |
|---|---|
| País, autoridades, transposição | `eurolify-country-readiness-eu` |
| Balcão, POS, click-and-collect | `eurolify-physical-retail-eu` |
| Faturas, recibos, caixa fiscal | `eurolify-tax-pos-invoicing-eu` |
| Distribuição, revenda, franchising | `eurolify-b2b-channels-eu` |
| Conciliação e controlo financeiro | `eurolify-finance-reconciliation-eu` |
| Conta e função de prestadores | `eurolify-payment-readiness-eu` |
| Transporte, perigosos, retornos | `eurolify-transport-logistics-eu` |
| SKU, GTIN, lote, DataMatrix, QR | `eurolify-identifiers-traceability-eu` |
| Qualquer setor ou produto novo | `eurolify-sector-compliance-eu` |
| Contratos, marca, trabalho, instalações | `eurolify-contracts-operations-eu` |
| Regras novas e futuras | `eurolify-regulatory-watch-eu` |
| Registo e prova de uma obrigação | `eurolify-legal-evidence-eu` |
| Cobertura de produto tipo Shopify | `eurolify-commerce-coverage-eu` |

## Recursos partilhados

As skills complementares remetem para esta pasta para evitar cópias divergentes. Lê `references/sources.jsonl` apenas para localizar a entrada de uma fonte necessária; não carrega o catálogo inteiro. Se a fonte falhar ou a atualização tiver uma lacuna, consulta `references/source-gaps.jsonl`. Para redigir uma ficha de regra usa `templates/rule-record.yaml`. Para conferir país, consulta apenas a sua entrada em `references/countries.json` e o método em `references/countries.md`.

Uma funcionalidade só pode ser apresentada como pronta para um país/setor se os requisitos aplicáveis, integrações, autorizações e testes estiverem demonstrados. “Todos os setores” é cobertura de encaminhamento, não licença universal para vender.
