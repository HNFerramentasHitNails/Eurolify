# Envios: trocar a chave das credenciais sem as pedir outra vez (14/10/2026)

Pedido do Diogo, 14/10/2026: *«sim, aprovo; avança com o código»*. Issue
#393; desenho no `docs/36` §25; migração 0103.

## O que se fez

- `ENVIOS_CHAVE_ANTERIOR` e `ENVIOS_CHAVE_ANTERIOR_VERSAO`: durante a troca,
  as contas cifradas com a anterior leem-se (credenciais e segredo dos
  avisos); a volta dos envios (5 em 5 minutos) passa até 100 por volta para a
  `ENVIOS_CHAVE`, sem mudar o estado da conta.
- O registo da volta diz `contasRecifradas` e `contasPorRecifrar`. Com zero,
  tira-se a anterior.
- A migração 0103 muda o gatilho da conta (com outra versão da chave, uma
  cifra nova não a devolve a rascunho) e cria `envios_contas_por_recifrar`.
- Desvios ao proposto ao Diogo: não se passa a conta no momento em que é
  usada (só na volta); o número das que faltam sai no registo, não num ecrã
  do Hub (não há Hub do dono da plataforma).

## Números (com data e como se contaram)

- 14/10/2026, base local: `test/envios-chave.test.ts` 5 de 5 verdes; os
  testes dos envios, `comerciante` e `seguranca-base` juntos: 17 ficheiros,
  193 testes verdes.

## O que ficou por verificar

- O passo na VPS (gerar a chave nova, guardar a anterior, publicar) não está
  feito: pedido à parte em `infra/vps` (ADR-0028).
- A chave dos pagamentos e a da faturação têm o mesmo problema.
- A suite completa da API e a revisão do agente: no pedido.
