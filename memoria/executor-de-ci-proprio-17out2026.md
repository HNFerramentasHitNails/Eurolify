# Executor de CI próprio (17/10/2026)

Pedido do Diogo, 17/10/2026: *«prepara os testes numa máquina nossa»*, porque
o GitHub Actions da conta está bloqueado desde 14/10/2026
(`minutos-github-actions-16out2026.md`). Decisão proposta no ADR-0046, à espera
do OK do Diogo. Pedido #472.

## O que se fez

- Todos os fluxos (`.github/workflows/*.yml`, 18 trabalhos) escolhem o
  executor pela variável `EXECUTOR_CI`; sem ela, `ubuntu-24.04` como antes.
- `infra/ci-executor/`: `preparar.sh` (máquina Ubuntu 24.04 dedicada),
  `ficheiros/`, `LEIA-ME.md` (passos do Diogo e ameaças).
- O `shellcheck` do trabalho `script-vps` lê o script novo.

## Números (com data e como se contaram)

- 17/10/2026: 18 linhas `runs-on` nos 9 fluxos (`grep -c runs-on`); actionlint
  sem erros; `shellcheck` 0.9.0 sem avisos; `preparar.sh --mostrar` num
  `ubuntu:24.04` vazio: 22 acções que faria, 2 avisos, nada mudou (listas de
  ficheiros e de contas iguais antes e depois).

## O que ficou por verificar

- Versão e sha256 do executor: em branco em `executor.conf` (sem rede).
- O modo real do script, o registo e os ganchos: não corridos.
- Se o `startup_failure` da conta afecta também os fluxos num executor próprio.
- Preço e oferta da máquina (OVH: não verifiquei).
- Os segredos do ambiente `ensaio` passam pela máquina nos fluxos de deploy
  (ADR-0046, consequências).
