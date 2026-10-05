---
name: eurolify-country-readiness-eu
description: "Verifica prontidão da Eurolify por Estado-membro, território, produto e canal. Usa antes de ativar mercados ou afirmar cobertura dos 27 países; não considera uma lista de autoridades ou uma regra UE como validação automática da lei nacional."
compatibility: "Requer eurolify-legal-briefing-eu e as skills regulamentares existentes."
metadata:
  version: "1.0.0"
---

# Prontidão por país

Lê `.agents/skills/eurolify-legal-briefing-eu/references/countries.md` e só a entrada relevante de `references/countries.json` nessa pasta. O diretório inicial contém contactos fiscais referenciados pela Comissão; todas as verificações nacionais operacionais começam pendentes.

1. Identifica estabelecimento, país/território de entrega, loja física, comprador e natureza da operação. Não usa apenas nacionalidade, IP ou prefixo de NIF.
2. Confirma legislação nacional, autoridade competente e requisitos por consumidor, impostos, caixa, produto, dados, resíduos, instalações e transportes afetados.
3. Verifica transposição, exceções, idioma, evidência e datas efetivas; distingue país de território de IVA.
4. Usa a ficha de evidência da coordenação jurídica, com responsável profissional quando necessário.
5. Define explicitamente o que pode operar e o que fica bloqueado. Prontidão para um tipo de produto/canal não aprova os restantes.
6. Testa configurações e integração fiscal/local antes de recomendar ativação.

Saída: `país/território | canal | setor | regras confirmadas | lacunas | profissional | integração/testes | bloqueios`.

Não marca um país como conforme por existir uma tradução, um método de pagamento, um contacto fiscal ou uma configuração no Hub. A pesquisa nacional faz-se quando a operação é definida; não inventa taxas ou prazos para completar tabelas.
