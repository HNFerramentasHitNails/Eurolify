# Avisos das tarefas vencidas por e-mail (#372, decisão EB) — 12/10/2026

## O que se fez

- Desenho em `docs/34` §12 (pedido #388). Diogo, 12/10/2026, sobre a Q12:
  *«A, aprovado»*. Ficou como decisão EB em `docs/06`.
- **A quem vai o e-mail:** à pessoa responsável pelo caso. Sem responsável,
  vai a quem decide a fila e tem `tasks:assign` (o dono e o gestor; na fila
  `pagamento`, só o dono).
- **O prazo do reembolso fica de fora:** já tem os seus e-mails desde a
  migração 0067.
- **Código, na migração 0071:**
  - o tipo de notificação `task.overdue`;
  - o gatilho na linha `vencida` do rasto da atribuição;
  - a regra de quem recebe, aplicada ao gravar e outra vez no envio;
  - `tarefas_aviso_espera()`: no envio, confere que o caso continua aberto,
    vencido e sem prazo novo;
  - os textos em PT, ES e EN, sem dados do cliente.
- **O `docs/17` T10 foi alargado:** inclui agora o armazém e o apoio quando
  são responsáveis por um pedido de livre resolução.

## Números (com data e como se contaram)

- **Testes:** 5 em `test/notificacoes-tarefas.test.ts` (12/10/2026, base
  local PostgreSQL 18.6).
- **Mutações:** 9 desvios postos à mão na migração 0071, um de cada vez.
  - 7 foram apanhados pelos testes.
  - 2 são equivalentes entre si, ambos em `tarefas_aviso_espera()`: tirar a
    condição «vencido» ou tirar a condição «sem prazo novo depois do aviso».
    Os testes não os distinguem, porque o caso só deixa de estar vencido
    quando alguém muda o prazo, e essa mudança fica no rasto.

## O que ficou por verificar

- **Nenhum e-mail sai ainda:** faltam a conta, as variáveis SMTP na VPS e o
  DNS (#372, Diogo ou Bruno).
- O e-mail aponta para a lista da API, porque o ecrã «A decidir» do Hub
  (peça 21, parte 2) ainda não existe.
- O motivo de uma mudança de prazo nunca entra no e-mail. Ligar esse motivo
  ao apagamento de dados do titular continua por fazer (`docs/33` §6).
