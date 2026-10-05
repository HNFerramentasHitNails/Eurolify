---
name: eurolify-sector-compliance-eu
description: "Encaminha qualquer setor da Eurolify para regimes de produto, serviço, licença e transporte na UE. Usa para produtos novos ou regulados, incluindo saúde, alimentos, químicos e digitais; não trata a taxonomia como aprovação de todos os setores."
compatibility: "Requer eurolify-legal-briefing-eu e product-compliance-eu."
metadata:
  version: "1.0.0"
---

# Classificação e portas setoriais

Lê `.agents/skills/eurolify-legal-briefing-eu/references/sectors.md`.

1. Classifica com composição, uso pretendido, alegações, utilizador, componentes, origem e papel do operador; nome comercial não basta.
2. Liga todos os regimes simultâneos pertinentes, incluindo químicos, baterias, produto conectado, embalagem e transporte.
3. Confirma atos atuais, autorizações, responsável, idiomas, documentação e registos oficiais; nota mudanças que façam um revendedor assumir outro papel.
4. Produto/serviço com classificação incerta, licença em falta ou regra C continua bloqueado no país/canal relevante.
5. Traduz o requisito validado para campos, anexos, movimentos, retenção e teste de publicação/expedição.
6. Para um setor novo não listado, cria uma ficha de investigação e pede factos determinantes; não o aprova como “retalho geral”.

Usa `digital-products-eu` e `gift-cards-eu` sem alterar as portas atuais do projeto. Não aplica GPSR como substituto dos regimes específicos de alimentos, medicamentos ou outros produtos excluídos; não exige CE indiscriminadamente.

Saída: `regimes | papéis | requisitos/fonte | lacunas | especialista | bloqueios por país/canal | evidência/testes`.
