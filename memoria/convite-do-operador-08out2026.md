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

- 08/10/2026, revisão Opus 5.5 do #165: 0 P0, 0 P1, 1 P2, 7 P3. P2-1: os
  domínios reservados também no `lerPedido` (3 testes falham sem a
  protecção) e `infra/vps/testes/fluxo-operar.sh`, que corre o passo do
  fluxo tirado do YAML (13 ok; 5 falhas sem a protecção). Fim da rede: a
  31/03/2027 no máximo. P3-5: o segredo gerado aceita o convite na base e
  faz um dono. `identidade-operador.test.ts` passou a 36 testes.

- 08/10/2026: o Diogo criou a chave do fluxo `operar` no computador dele
  (Git Bash, ED25519 sem frase-passe, em `~/.eurolify-chaves`, a pasta
  criada outra vez e fechada com `icacls /inheritance:r`) e pôs a privada
  no segredo `VPS_CHAVE_OPERAR` do ambiente `ensaio` (dito por ele; não
  verificado daqui). A pública entrou em `infra/vps/chaves/fluxos/operar.pub`:
  `SHA256:wz3eusHxAkSkUSEvj9Aiwb1bMVLSY0zvhEt418EFyQE`, calculada da linha
  colada.

- 08/10/2026, primeiro uso no ensaio (registos do fluxo `operar` e do
  `medir`):
  - 09:16 e 09:19: acção `comerciante` duas vezes, código 0 nas duas — há
    **dois** comerciantes de teste; o da segunda é
    `mer_01a11acf-d2bb-758b-bad7-e4af11226519` («Loja de Ensaio»). A
    primeira execução aparecia como cancelada no GitHub e o registo dela
    já não se lê (404); o nome dela não foi verificado.
  - 09:24: convite com 42704, sem escrever (corrigido no #168, 0027).
  - 10:32 e 10:34: dois pedidos recusados à entrada da VPS, sem escrever:
    o comerciante com «;» no fim e a acção deixada em «comerciante» sem
    nome. Daí o fluxo passar a conferir os campos de cada acção e dizer o
    que falta (pedido seguinte; `infra/vps/testes/fluxo-operar.sh`, 22 ok).
  - 10:36: convite criado, `inv_01a11b16-52c7-7316-b46c-2da6b7ab9fe8`, com
    cópia da base antes.
  - O Diogo aceitou-o e entrou no Hub com uma passkey: «Entrou como Dono
    de Ensaio (dono@loja.test)», «Loja de Ensaio — Dono» (captura dele).
- O Diogo colou uma vez a ligação de um convite no chat; esse par foi
  deitado fora antes de ser usado (o convite só nasce com o resumo no fluxo).

## O que ficou por verificar

- A Equipa e os convites feitos a partir do Hub, na VPS (só a entrada foi
  vista).
