---
name: eurolify-session-continuity
description: "Retoma e conduz cada sessão Eurolify pelo estado verificado, prioridades e passagem de trabalho. Usa no arranque, interrupção ou fecho; não assume que memórias antigas representam o código atual nem altera prioridades sem decisão."
metadata:
  version: "1.0"
---

# Continuidade de sessão

Lê `references/session-record.md` ao escolher a próxima tarefa ou preparar passagem. Usa `eurolify-manager-communication` para a conversa e `eurolify-repository-memory` para leitura seletiva.

1. Cumpre o arranque obrigatório do projeto. Verifica versão partilhada, trabalho recente, tarefas abertas e alterações de outras pessoas; não pressupõe que o checkpoint é atual.
2. Recupera índice e memórias do tema. Confronta “feito” com alteração integrada, testes e decisões; assinala discrepâncias, sem reescrever história.
3. Explica brevemente o estado ao gestor: feito, em curso, falta e impedimentos reais. Recomenda o próximo passo pelo âmbito aprovado, dependências e risco, não apenas pelo ficheiro mais recente.
4. Define um resultado observável para a sessão. Se já está autorizado e cabe no plano, avança; se exige mudar negócio, âmbito ou decisão vigente, pede essa decisão antes.
5. Ativa apenas as skills relevantes ao domínio. Usa Opus 5.5 no trabalho exigente; não usa Fable. O trabalho técnico e os gates continuam completos, mesmo que a explicação seja curta.
6. Atualiza o gestor nas mudanças de etapa, descobertas ou bloqueios. Se for interrompido, regista o ponto seguro, o que ficou por testar e o que não deve ser executado ainda.
7. Ao fechar, apresenta o resultado real e deixa um checkpoint curto com fontes, estado partilhado/local, verificação e próximo passo. Não afirma que foi integrado se ainda está só local ou em revisão.

## Invariantes

Não começa do zero se existe continuidade válida. Não trabalha duas vezes na mesma tarefa sem verificar o outro autor. Não reabre decisões sem motivo. Não pergunta dados já documentados antes de procurar.

Em falta de acesso ou evidência: dizer o que não foi possível confirmar e propor o passo de recuperação; não inventar o estado para manter o ritmo.
