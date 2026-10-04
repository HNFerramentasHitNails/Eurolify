---
name: eurolify-efficient-workflow
description: "Escolhe um fluxo e modelo proporcional para trabalho na Eurolify, reduzindo exploração repetida e delegação desnecessária. Usa para eficiência no Claude Code; não contorna revisões, permissões ou validação fiscal."
metadata:
  version: "1.1"
---

# Execução eficiente

Lê `references/model-policy.md` quando fores escolher ou mudar modelo, esforço ou subagente.

Opus 5.5 é o modelo forte aprovado para este fluxo. Não seleciones Fable para execução, escalonamento ou fallback; Haiku/Sonnet são alternativas delimitadas, sujeitas a qualidade e utilização observadas.

1. Cumpre as regras de arranque e revisão do repositório. Classifica a tarefa por ambiguidade, fronteiras afetadas, risco e evidência necessária, não por número de palavras.
2. Define objetivo, ficheiros prováveis, critérios de aceitação e comando de verificação. Para trabalho simples, evita um plano extenso ou delegação.
3. Usa `eurolify-repository-memory` para localizar contexto. Não abre toda a memória nem todas as skills; lê as obrigatórias para os domínios efetivamente afetados.
4. Recomenda modelo e justificação curtos. Para mudar a sessão principal, apresenta a opção suportada; nunca afirma que a recomendação já mudou o modelo. Usa um agente configurado só se disponível e autorizado.
5. Executa uma fatia delimitada. Delega apenas leitura volumosa ou tarefas independentes com resultado compacto; não lança vários escritores nos mesmos ficheiros.
6. Se falhar, distingue erro de ambiente/dados de raciocínio insuficiente. Usa diagnóstico antes de repetir. Após duas tentativas sem nova evidência, muda a abordagem ou escala justificadamente.
7. Usa `eurolify-evidence-before-done` para concluir. Mantém o gate de uma sessão independente quando o projeto o exigir; um subagente no mesmo trabalho não o substitui automaticamente.

## Saída curta

`Tarefa | risco | modelo escolhido/recomendado | contexto necessário | verificação | motivo de escalonamento`.

Não promete economia percentual. Minimiza utilização sujeita a qualidade, segurança e regras do projeto, não reduz tokens sacrificando esses requisitos.
