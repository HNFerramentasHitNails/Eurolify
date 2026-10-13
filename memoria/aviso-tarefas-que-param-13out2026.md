# O aviso quando a fila do titular e a limpeza das sessões param — 13/10/2026

## O que se fez

Pedido do Diogo, 13/10/2026 (*«A»*, a pegar nos avisos das duas tarefas do
#233; desenho `docs/23` §15.11 aprovado com *«A»*, Q-T1). Pedido Eurolify#433.

- Migração `0088_tarefas_em_atraso.sql`: `titular_pendentes_em_atraso()` e
  `checkout_sessoes_em_atraso()`, só contagens, para o `eurolify_limpeza`.
  Cada comerciante conta-se no contexto dele: a `encomenda` e a
  `sessao_checkout` têm o RLS forçado também para o dono das funções.
- `eurolify-verificacao` (07:00): uma linha por tarefa com o número; uma
  falha diz só «a consulta falhou», sem a linha do `psql` (revisão do #428,
  P3-3).
- Testes: dois em `apps/api/test/checkout-api.test.ts` e o novo
  `infra/vps/testes/verificacao.sh`; ambos falham sem a protecção
  (verificado ao tirar o contexto por comerciante e ao pôr a linha do erro
  no aviso).
- Número 0088 porque a sessão dos envios reservou a 0087 (13/10/2026). O
  migrador do Kysely recusa uma migração que apareça antes de outra já
  aplicada: se este pedido entrar antes do da 0087, renumera-se um deles.

## Números (com data e como se contaram)

- Tarefas da API que correm sozinhas e não avisam se pararem: **12**, depois
  deste pedido (13/10/2026; 14 contadas em `servidor.ts` no desenho, menos
  estas duas).

## O que ficou por verificar

- O tempo das contagens com muitos comerciantes e sessões (sem `EXPLAIN`).
- O aviso a sério na VPS: só depois da publicação.
- Aviso falso possível numa janela de até uma hora por dia (§15.11).
