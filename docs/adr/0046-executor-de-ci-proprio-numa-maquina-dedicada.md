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

1. **Só os trabalhos sem segredos e com token só de leitura** escolhem o
   executor pela variável do repositório `EXECUTOR_CI`: o `verificar`, o
   `vigiar` (segredos, dependências, espelho), o `vigiar-dependencias` e o
   `espelhar-imagens/conferir`. A variável só vale num `pull_request` que não
   vem de um fork nem do `dependabot[bot]`; senão, `ubuntu-24.04`. Por isso o
   `verificar` chamado pelo `publicar` (push no `main`) também fica no GitHub.
   Sem a variável, tudo como antes; com `["self-hosted","linux","eurolify-ci"]`,
   os testes dos pedidos nossos correm na máquina nossa. Voltar atrás é apagar
   a variável. **Os fluxos do ambiente `ensaio` (publicar, aplicar, medir,
   operar, configurar) e os que escrevem no GHCR ou abrem avisos
   (`espelhar-imagens/copiar`, `vigiar` imagens e avisar) ficam fixos no
   executor do GitHub:** as chaves da VPS nunca passam pela máquina.
2. A máquina é **dedicada** (nunca a VPS), Ubuntu 24.04, na UE, preparada por
   `infra/ci-executor/preparar.sh` (modo `--mostrar`, idempotente, nunca apaga o
   que não conhece, registo das acções). Executor oficial `actions/runner` em
   versão fixa com sha256 conferido (em `executor.conf`, por pedido revisto) e
   sem actualização automática; pasta e `.env` do root; utilizador próprio sem
   sudo e sem SSH; só a porta 22; SSH só por chave;
   limpeza diária.
3. O utilizador do executor está no grupo `docker`, que **equivale a root nesta
   máquina**. Aceita-se **só** porque a máquina é dedicada e não tem segredos do
   repositório nem dados.
4. Obrigatório por o repositório ser público, **antes** de registar o executor:
   «Require approval for all external contributors» (Settings → Actions →
   General). Nunca se aprova a execução de um fork: um fork pode mudar o
   `runs-on` no próprio fluxo, por isso a aprovação é a barreira.
5. O token de registo escreve-se na hora, num pedido do script sem eco; nunca no
   repositório, no chat, num ficheiro ou numa variável de ambiente.

## Consequências

- Os pedidos voltam a poder ter os testes verdes, desde que o Diogo compre a
  máquina, a registe e crie a variável (`infra/ci-executor/LEIA-ME.md`).
- **Os fluxos do ambiente `ensaio` (publicar, aplicar, medir, operar,
  configurar) não passam pela máquina** (revisão do #472, P0-1): as chaves da
  VPS e os dados de SMTP ficam fora dela, que corre código de pedidos. **Pode
  partir:** enquanto o Actions do GitHub estiver bloqueado, esses fluxos também
  não correm, e publicar ou operar a VPS passa pela via de emergência
  (ADR-0020) até se decidir outra coisa. **Decisão do Diogo.**
- Um pedido de um fork só corre na máquina se alguém o aprovar: nunca se aprova.
- Um só executor: os trabalhos de um `verificar` correm em fila.
- Há uma máquina nova para manter e pagar; passa a ser mais uma coisa na lista
  de custos (`memoria/alojamento-e-custos-03out2026.md`).
- Os fluxos deixam de se poder testar no GitHub para saber se funcionam lá:
  só correm de verdade quando a máquina existir.

## O que ficou por verificar

- A versão fixa (2.338.0) e o sha256 foram calculados pela sessão principal
  (commit `fca03a29`); **por conferir** por uma segunda pessoa contra a página
  de lançamentos de `actions/runner`.
- Se o executor corre com a pasta do root, só com `_work` e `_diag` e os três
  ficheiros de credenciais do utilizador: não testado.
- O preço e a oferta da máquina (OVH: não verifiquei).
- O script em modo real (só foi corrido o `--mostrar`), o registo do executor
  e os ganchos (`ACTIONS_RUNNER_HOOK_JOB_*` pelo `.env`): não corridos.
- Se o bloqueio do Actions é da conta ou do repositório, e se o executor próprio
  o contorna (um executor próprio também precisa que o GitHub aceite o
  fluxo; **não verifiquei** que o `startup_failure` não afecte também estes).
- As opções exactas do GitHub para pedidos de fora.
