---
name: eurolify-repository-memory
description: "Organiza memória e documentação GitHub da Eurolify para leitura progressiva, fontes únicas e checkpoints curtos. Usa para reduzir contexto repetido; não apaga histórico, altera decisões ou varre outros repositórios sem âmbito."
metadata:
  version: "1.0"
---

# Memória externa do repositório

Lê `references/memory-contract.md` antes de reorganizar ou escrever memórias. Para diagnóstico de tamanho/duplicados, executa `scripts/audit_memory.py` com repositório e diretórios explícitos; é só leitura. Após alterar o script, executa `scripts/test_audit_memory.py`.

1. Identifica o repositório, branch/commit, regras de arranque, índice e convenções. Na Eurolify, preserva `AGENTS.md`, o import de `CLAUDE.md`, `memoria/MEMORY.md` e ADR vigentes.
2. Audita primeiro sem modificar. Mostra tamanho, ficheiros extensos, duplicados exatos e conflitos aparentes; não apresenta bytes como tokens medidos.
3. Procura por tema e lê intervalos do ficheiro relevante. Um título ou resumo não prova o conteúdo; abre a fonte antes de afirmar. Evita `cat` de toda a árvore ou despejar logs na conversa.
4. Separa regra operacional, decisão, facto com data, hipótese, estado transitório e referência. Cada uma aponta para a fonte apropriada; resumos derivados não substituem originais.
5. Propõe índice curto por tema e source-of-truth. Não move, elimina ou reescreve histórias/decisões sem autorização; regras obrigatórias existentes continuam a ser lidas até revisão aprovada.
6. Para novas memórias, guarda apenas descoberta durável, decisão ou checkpoint útil com evidência. Atualiza uma entrada temática quando apropriado, evitando duplicar transcrições em documentos e skills.
7. No fim, produz handoff curto: commit/branch, feito, comandos/resultados, pendências, próximo passo e caminhos. Não carrega o checkpoint completo em todas as sessões.

## Invariantes

Não guardar segredos, dados pessoais desnecessários ou saídas integrais de ferramentas. Não omitir conflito de fontes. Não alterar ADR por resumo automático. Não anunciar organização concluída se só foi preparado um plano.
