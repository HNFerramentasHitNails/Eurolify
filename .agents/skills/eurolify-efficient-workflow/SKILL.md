---
name: eurolify-efficient-workflow
description: "Escolhe um fluxo e modelo proporcional para trabalho na Eurolify, reduzindo exploração repetida e delegação desnecessária. Usa para eficiência no Claude Code; não contorna revisões, permissões ou validação fiscal."
metadata:
  version: "1.1"
---

# Execução eficiente

Lê `references/model-policy.md` quando fores escolher ou mudar modelo, esforço ou subagente.

Política de modelos da Eurolify (decisão do Diogo, 04/10/2026): Sonnet para a execução normal, Haiku para a pesquisa mecânica, Opus 5.5 para a análise e a revisão de risco. Não seleciones Fable para execução, escalonamento ou fallback. Se o Opus 5.5 der melhor resultado global observado numa tarefa, pode usar-se, dizendo porquê.

1. Cumpre as regras de arranque e revisão do repositório. Classifica a tarefa por ambiguidade, fronteiras afetadas, risco e evidência necessária, não por número de palavras.
2. Define objetivo, ficheiros prováveis, critérios de aceitação e comando de verificação. Para trabalho simples, evita um plano extenso ou delegação.
3. Usa `eurolify-repository-memory` para localizar contexto. Não abre toda a memória nem todas as skills; lê as obrigatórias para os domínios efetivamente afetados.
4. Recomenda modelo e justificação curtos. Para mudar a sessão principal, apresenta a opção suportada; nunca afirma que a recomendação já mudou o modelo. Usa um agente configurado só se disponível e autorizado.
5. Executa uma fatia delimitada. Delega apenas leitura volumosa ou tarefas independentes com resultado compacto; não lança vários escritores nos mesmos ficheiros. **Não põe vários agentes em paralelo sem perguntar** (`AGENTS.md`, «Agentes»); um agente dirigido a uma pergunta concreta pode ser usado.
6. Se falhar, distingue erro de ambiente/dados de raciocínio insuficiente. Usa diagnóstico antes de repetir. Após duas tentativas sem nova evidência, muda a abordagem ou escala justificadamente.
7. Usa `eurolify-evidence-before-done` para concluir. A revisão independente é a do `AGENTS.md` («Git») e do ADR-0035: um agente lançado da própria sessão, sem a conversa de quem escreveu, só de leitura, publicada no pedido com o modelo; sessões novas só a pedido do Diogo ou do Bruno.

## Saída curta

`Tarefa | risco | modelo escolhido/recomendado | contexto necessário | verificação | motivo de escalonamento`.

Não promete economia percentual. Minimiza utilização sujeita a qualidade, segurança e regras do projeto, não reduz tokens sacrificando esses requisitos.
