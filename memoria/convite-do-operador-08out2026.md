# Convite do operador para o primeiro dono (#156) — 08/10/2026

## O que se fez

Pedido do Diogo, 08/10/2026 (*«sim, avança com a acção convite do
operador»*). Desenho no `docs/19` §6.0.

- `apps/api/scripts/gerar-convite.mjs`: no computador do operador, dá a
  ligação `https://hub.eurolify.eu/convite#euc_…` e o resumo.
- Fluxo `operar` com a acção `convite`: comerciante, e-mail e resumo. Só o
  papel **dono**. O fluxo recusa e-mails fora dos domínios reservados para
  testes (`.test`, `.example`, `.invalid`, `example.com/net/org`) e
  qualquer entrada com `euc_`.
- O pedido (`convite <uuid> <e-mail base64url> dono <resumo> <quem>`) é
  validado nas três camadas da máquina, no `lerPedido` e na base
  (`convite_criar_pelo_operador`, migração 0018).

## Números (com data e como se contaram)

- 08/10/2026, `vitest run test/identidade-operador.test.ts` com PostgreSQL
  18.6 local: 32 testes passam (o convite gravado com o resumo, `dono`,
  `operador:github:1001`, 7 dias e o evento `convite_criado`; o comerciante
  que não existe não escreve).
- 08/10/2026, `infra/vps/testes/operador.sh` (13 ok) e
  `trabalho-operar.sh` (11 casos ok): o convite passa nas três camadas, o
  papel que não é dono e o e-mail fora de base64url são recusados, o e-mail
  não vai para o registo.

## O que ficou por verificar

- **O fluxo `operar` nunca correu na VPS**: falta a chave SSH
  (`infra/vps/chaves/fluxos/operar.pub` e o segredo `VPS_CHAVE_OPERAR` do
  ambiente `ensaio`), a criar pelo Diogo ou pelo Bruno. O `preparar.sh`
  avisa disso em cada corrida (registo de 07/10/2026).
- Entrar de facto no Hub do ensaio com a ligação gerada: depois da chave.
