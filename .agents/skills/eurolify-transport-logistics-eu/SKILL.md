---
name: eurolify-transport-logistics-eu
description: "Desenha logística e transporte UE para a Eurolify: transportadoras, lotes, cadeia de frio, perigosos, devoluções e recolhas. Usa ao habilitar envio de um produto ou rota; não deduz admissibilidade a partir de uma etiqueta ou API de transportadora."
compatibility: "Requer eurolify-legal-briefing-eu, order-fulfilment e product-compliance-eu."
metadata:
  version: "1.0.0"
---

# Transporte e logística

Lê `.agents/skills/eurolify-legal-briefing-eu/references/transport.md`.

1. Classifica produto, papel do expedidor, origem/destino/territórios, modo e transportadora. Consulta o setor quando houver riscos.
2. Confirma restrições de transporte, documentos, embalagem, idioma, temperatura e licenças. Rota de ida aprovada não aprova a devolução.
3. Para perigosos, exige classificação e profissional competente; não deriva número ONU, classe ou isenção por palavras da descrição.
4. Liga unidades, lotes/séries, reservas, expedições, prova de entrega e incidentes. Estados da transportadora não decidem sozinhos reembolso ou emissão fiscal.
5. Se houver entrada de país terceiro, verifica apenas regras UE pertinentes de importação, aduana e produto, sem transplantar regras estrangeiras para o núcleo.
6. Testa embalagem recusada, transporte parcial, perda, frio interrompido, lote recolhido, repetição de etiqueta e retorno perigoso.

Não aplica ADR de estrada a transporte aéreo/marítimo. Condições contratuais ou comerciais não anulam direitos obrigatórios. Informação pré-contratual de entrega e risco da operação usa `consumer-rights-eu`.
