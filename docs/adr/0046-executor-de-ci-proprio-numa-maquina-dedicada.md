# ADR-0046 · Executor de CI próprio, numa máquina dedicada

- **Estado:** proposto, à espera do OK do Diogo
- **Data:** 17/10/2026
- **Quem decidiu:** por decidir (pedido do Diogo, 17/10/2026: *«prepara os
  testes numa máquina nossa»*)
- **Decisão em aberto de origem:** tarefa #471, pedido #472
  (`memoria/minutos-github-actions-16out2026.md`)

## Contexto

- Desde 14/10/2026 às 15:16 UTC todas as execuções do GitHub Actions da conta
  acabam em segundos sem máquina atribuída (`startup_failure`), mesmo com o
  repositório público (16/10/2026) e o pagamento feito (informação do Diogo e
  `memoria/minutos-github-actions-16out2026.md`). Sem os fluxos, nenhum pedido
  tem os testes verdes e nada entra no `main` (ADR-0024, ADR-0031).
- Os fluxos assumem o executor do GitHub: `gh`, `shellcheck`, `docker` com
  `buildx`, `jq`, `curl`, `skopeo` e `ssh` (lidos nos `.github/workflows/*.yml`,
  17/10/2026); o `node` e o `pnpm` vêm das acções `setup-node` e
  `pnpm/action-setup`.
- A VPS do ensaio guarda a base, as chaves e os dados (ADR-0015, ADR-0026,
  ADR-0027, ADR-0028).

## Opções consideradas

| Opção | A favor | Contra |
|---|---|---|
| **A. Executor do GitHub, pago** | Nada a manter; máquina nova em cada trabalho | Está bloqueado e não sabemos quando volta; depende da conta (não verifiquei a causa) |
| **B. Executor próprio na VPS do ensaio** — **recusada** | Sem máquina nova | Os fluxos correm código dos pedidos com o docker (root). Um pedido mau lê a base, as chaves e os dados da VPS; num repositório público é pior |
| **C. Executor próprio numa máquina dedicada** — **proposta** | Os testes voltam a correr já; nada de valor na máquina; troca-se por uma variável | Custo mensal da máquina (não verifiquei o preço); fica a manter; um só executor faz fila |

## Decisão (proposta)

1. Os fluxos escolhem o executor pela variável do repositório `EXECUTOR_CI`:
   `runs-on: ${{ fromJSON(vars.EXECUTOR_CI || '"ubuntu-24.04"') }}`. Sem a
   variável, tudo como antes; com `["self-hosted","linux","eurolify-ci"]`, corre
   na máquina nossa. Voltar atrás é apagar a variável.
2. A máquina é **dedicada** (nunca a VPS), Ubuntu 24.04, na UE, preparada por
   `infra/ci-executor/preparar.sh` (modo `--mostrar`, idempotente, nunca apaga o
   que não conhece, registo das acções). Executor oficial `actions/runner` em
   versão fixa com sha256 conferido (em `executor.conf`, por pedido revisto);
   utilizador próprio sem sudo e sem SSH; só a porta 22; SSH só por chave;
   limpeza diária.
3. O utilizador do executor está no grupo `docker`, que **equivale a root nesta
   máquina**. Aceita-se **só** porque a máquina é dedicada e não tem segredos do
   repositório nem dados.
4. Obrigatório por o repositório ser público: «Require approval for all external
   contributors» (Settings → Actions → General).
5. O token de registo passa-se na hora, nunca no repositório, no chat ou num
   ficheiro.

## Consequências

- Os pedidos voltam a poder ter os testes verdes, desde que o Diogo compre a
  máquina, a registe e crie a variável (`infra/ci-executor/LEIA-ME.md`).
- **Os fluxos com o ambiente `ensaio` (publicar, aplicar, medir, operar,
  configurar) também passam pela máquina** quando a variável existe: as chaves
  da VPS e os dados de SMTP passam por ela nesses trabalhos. Correm só no
  `main`, a chave apaga-se no fim e os ganchos limpam `~/.ssh` antes e depois,
  mas uma máquina já corrompida por um pedido anterior podia apanhá-las. **Pode
  partir:** se isto não se aceitar, a alternativa é uma segunda variável só para
  os fluxos do `ensaio` (e esses esperarem pelo GitHub), ou refazer a máquina
  antes de cada deploy. **Decisão do Diogo.**
- Um só executor: os trabalhos de um `verificar` correm em fila.
- Há uma máquina nova para manter e pagar; passa a ser mais uma coisa na lista
  de custos (`memoria/alojamento-e-custos-03out2026.md`).
- Os fluxos deixam de se poder testar no GitHub para saber se funcionam lá:
  só correm de verdade quando a máquina existir.

## O que ficou por verificar

- A versão do executor e o sha256 (sem rede quando se escreveu).
- O preço e a oferta da máquina (OVH: não verifiquei).
- O script em modo real (só foi corrido o `--mostrar`), o registo do executor
  e os ganchos (`ACTIONS_RUNNER_HOOK_JOB_*` pelo `.env`): não corridos.
- Se o bloqueio do Actions é da conta ou do repositório, e se o executor próprio
  o contorna (um executor próprio também precisa que o GitHub aceite o
  fluxo; **não verifiquei** que o `startup_failure` não afecte também estes).
- As opções exactas do GitHub para pedidos de fora.
