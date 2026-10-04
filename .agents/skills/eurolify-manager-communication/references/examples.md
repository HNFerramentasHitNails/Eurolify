# Tradução para gestão e decisões

Todos os exemplos são fictícios. Ajustar o estado ao que foi realmente feito e verificado; não copiar como relatório factual.

## Trocar mecanismo por consequência

| Termo técnico | Explicação de gestão |
|---|---|
| Isolamento entre tenants | Cada comerciante só pode ver os seus próprios dados |
| Idempotência | O mesmo aviso recebido duas vezes não deve repetir a operação |
| API | Ligação que permite a outros programas usar a plataforma |
| Migração da base | Alteração na forma de guardar dados; precisa de ser feita sem perder os existentes |
| Pull request | Alteração proposta para revisão antes de entrar na versão partilhada |
| Testes de regressão | Confirmar que a alteração não estragou o que já funcionava |
| RLS | Proteção dos dados de cada comerciante no local onde ficam guardados |
| Outbox | Guardar um aviso por enviar para o recuperar se a ligação falhar |

Estas são traduções de comunicação, não especificações técnicas completas. Se a consequência variar com o desenho, explicar o caso real em vez de reutilizar uma equivalência cega.

## Dizer o que se sabe

Em vez de “a funcionalidade está concluída”, dizer: “O comportamento foi programado e passou nos testes disponíveis; falta a revisão e a confirmação no ambiente de ensaio.”

Em vez de “todos os países estão suportados”, dizer: “O desenho inclui os 27 países; as regras nacionais que ainda não foram verificadas continuam a impedir a utilização nesses casos.”

Em vez de “não há problema”, dizer: “Não encontrei falha nos casos testados. Ainda não confirmei o comportamento com duas compras simultâneas.”

## Uma decisão

Estrutura:

```text
O que precisamos de decidir:
O que recomendo e porquê:
Alternativa e consequência:
Qual é a decisão?
```

Evitar perguntas como “Preferes OAuth ou JWT?” sem traduzir necessidade, risco e opções reais. Se a escolha já estiver aprovada no projeto, não reabrir uma decisão só porque começou nova sessão.

## Intervenções durante a execução

Atualizar quando muda a etapa ou surge risco: “A primeira verificação passou. Agora vou confirmar que os dados de uma loja não aparecem noutra.”

Não narrar cada comando nem repetir “estou a trabalhar” sem informação nova. Se não houver decisão pendente, continuar dentro da autorização em vez de terminar com uma pergunta artificial.
