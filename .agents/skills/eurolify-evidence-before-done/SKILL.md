---
name: eurolify-evidence-before-done
description: "Conclui trabalho na Eurolify com evidência proporcional e revisão exigida, evitando verificações redundantes. Usa antes de dizer feito; não substitui CI, revisão independente ou validação profissional."
metadata:
  version: "1.0"
---

# Evidência antes de concluir

1. Mapeia requisitos para ficheiros e testes afetados. Aproveita evidência recente só quando commit, ambiente, comandos e alterações forem compatíveis.
2. Executa teste focado durante a edição e verificações exigidas pelo projeto antes de entrega. Teste incremental não dispensa a suite de gate definida em CI.
3. Preserva stdout/stderr relevantes e exit code; não filtra falhas, timeouts ou testes saltados como se fossem sucesso. Para logs longos, reporta resumo e caminho para leitura posterior.
4. Revê o diff e os caminhos que ainda possam falhar: isolamento, estados, fiscalidade, eventos repetidos e regressões conforme a alteração.
5. Obtém a revisão independente exigida pelo projeto. É a do `AGENTS.md` («Git») e do ADR-0035: um agente lançado da sessão (`eurolify-critical-review`), sem a conversa de quem escreveu, publicada no pedido tal como ele a devolveu, com os P0/P1 tratados. O revisor não aprova nem junta.
6. Entrega resumo curto de alteração, comandos/resultados, verificado, não verificado e pendências. Não repete a história do projeto nem afirma produção sem gate.

## Eficiência

Evita correr uma suite idêntica repetidamente sem alteração relevante, mas invalida a evidência quando muda código, configuração, ambiente ou dados do teste. Documentação, runtime e regras nacionais têm verificações distintas.

Não usa frase “tudo funciona” baseada só em tipos, lint, teste mockado ou resultado antigo.
