---
name: eurolify-identifiers-traceability-eu
description: "Distingue SKU, GTIN, lote, série, DataMatrix, QR, UDI e passaporte na Eurolify, com rastreabilidade por setor. Usa para leitura, impressão ou movimentos identificados; não inventa GTIN nem torna GS1/DataMatrix obrigatórios para todos os produtos."
compatibility: "Requer eurolify-legal-briefing-eu, catalog-pim e order-fulfilment."
metadata:
  version: "1.0.0"
---

# Identificação e rastreabilidade

Lê `.agents/skills/eurolify-legal-briefing-eu/references/traceability.md`. Para obrigações do produto, usa `eurolify-sector-compliance-eu`.

1. Determina se se identifica variante, embalagem, lote, unidade individual, entidade ou unidade logística. Identificador e portador não são a mesma coisa.
2. Reutiliza as regras de SKU do Catálogo e as decisões atuais; não muda unicidade, reutilização ou comparação sem autorização.
3. Confirma origem/autorização de GTIN e outros identificadores. Guarda texto original, zeros iniciais, esquema, emissor e mapeamento; nunca gera GTIN a partir do SKU.
4. Define separadamente Data Matrix, GS1 DataMatrix, QR/Digital Link, UDI e DPP. Escolhe conforme norma/contrato e lei setorial verificados.
5. Modela receção, transformação quando aplicável, divisão/agregação, reserva, saída, devolução, quarentena e recolha; preserva quem, quando, localização e referências.
6. Testa scanner real, FNC1/separadores, lote variável, duplicados, série desconhecida, embalagem superior, validade e recolha. Uma imagem de código legível não prova rastreabilidade.

Se o código estiver ambíguo, mal formado ou não corresponder ao produto, bloqueia e pede revisão; não escolhe a correspondência “mais parecida”. Não coloca dados pessoais em códigos públicos nem transforma validade em autorização de venda.
