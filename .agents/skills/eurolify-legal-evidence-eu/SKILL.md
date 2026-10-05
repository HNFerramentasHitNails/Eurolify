---
name: eurolify-legal-evidence-eu
description: "Regista e revê evidência de regras legais/fiscais da Eurolify com fonte, versão, âmbito, W/M/C, profissional e testes. Usa antes de codificar ou declarar conformidade; não confunde encontrar uma fonte com ler o ato ou validar a operação."
compatibility: "Requer eurolify-legal-briefing-eu e docs/03-regulamentar-ue.md."
metadata:
  version: "1.0.0"
---

# Evidência antes de ativação

Lê `.agents/skills/eurolify-legal-briefing-eu/references/evidence.md`; usa `templates/rule-record.yaml` nessa pasta para cada regra.

1. Mantém W/M/C com o significado do repositório; regista nível de leitura e versão sem inventar uma nova equivalência.
2. Associa cada obrigação a sujeito, produto, canal, país/território e data. Uma referência geral não cobre todas as condições.
3. Escreve a parte lida, alterações verificadas e lacunas nacionais; não marca fonte incompleta como texto integral conferido.
4. Regista parecer profissional apenas se existe, com identidade, âmbito e data; não simula aprovação.
5. Liga requisitos a dados, código, testes e evidência de execução, separando descoberta, implementação e uso real.
6. Invalida ou suspende a conclusão quando mudarem fonte, produto, país, papel, integração ou dados determinantes.

Não coloca segredos nem dados pessoais desnecessários na ficha. Prova contratual/fiscal e logs técnicos têm regras distintas de retenção e acesso. Informação sem fonte mantém-se pendente, não se converte em regra por aparecer num mockup.
