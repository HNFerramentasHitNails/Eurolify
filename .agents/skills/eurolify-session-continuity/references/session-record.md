# Próxima tarefa e registo da sessão

## Escolher o que fazer

Ordem de decisão:

1. Pedido atual do utilizador, dentro das regras e autorizações.
2. Bloqueio de segurança, perda de dados, pagamento ou documento fiscal.
3. Dependência já aprovada que desbloqueia a próxima capacidade.
4. Tarefa aprovada disponível e não ocupada por outro autor.
5. Se nada estiver autorizado/priorizado, proposta curta de próximo passo.

Um pedido novo não elimina obrigações de revisão, fontes ou autorização. Uma preferência do agente não substitui uma decisão humana.

## Etapas distintas

- **Desenhado:** comportamento e regras descritos; não prova que foi programado.
- **Programado:** alteração existe; não prova que funciona.
- **Testado:** casos executados com resultado; não cobre casos não testados.
- **Revisto:** revisão exigida concluída; não prova prontidão de produção.
- **Integrado:** entrou na versão partilhada; não implica publicação.
- **Pronto para uso:** gates aplicáveis e autorização cumpridos.

Cada declaração deve incluir âmbito e evidência. Não usar percentagem de avanço sem lista de entregáveis e método aprovado.

## Checkpoint curto

Usar o local de continuidade já existente no projeto. **Na Eurolify, esse local é a descrição do pedido de alteração e o *issue* da tarefa** (ADR-0031: «o histórico é a descrição dos pedidos»); não se cria um ficheiro de continuidade à parte.

```text
Data e autor:
Repositório / branch / commit observado:
Objetivo:
Resultado para o negócio:
Alterações e fontes:
Verificação: comando, ambiente, resultado, testes saltados
Estado: local | em revisão | integrado | publicado
Decisões: aprovadas | propostas | pendentes, com autor/fonte
Bloqueios e riscos:
Próximo passo e condição de início:
```

Guardar o detalhe técnico suficiente para a próxima sessão o reproduzir, sem copiar logs integrais. Atualizar o ponto atual e remeter para PR/ADR/histórico em vez de acumular transcrições.

## Recuperação

Após interrupção, comparar o checkpoint com a versão partilhada e trabalho recente. Se alguém alterou o mesmo módulo, reavaliar dependências antes de aplicar a alteração anterior.

O resumo para o gestor pode dizer: “A preparação ficou guardada; falta a confirmação. Vou retomar essa verificação.” O registo técnico contém o caminho e o comando real.

## Autoridade

Preservar as regras da Eurolify: decisões vigentes, documentação do domínio antes de código quando exigida, processo de revisão e integração. Não atribuir competência diferente ao Bruno ou ao Diogo por conhecimentos de programação.
