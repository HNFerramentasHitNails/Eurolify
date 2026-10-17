# Executor de CI próprio (17/10/2026)

Pedido do Diogo, 17/10/2026: *«prepara os testes numa máquina nossa»*, porque
o GitHub Actions da conta está bloqueado desde 14/10/2026
(`minutos-github-actions-16out2026.md`). Decisão proposta no ADR-0046, à espera
do OK do Diogo. Pedido #472.

## O que se fez

- Só os trabalhos sem segredos (`verificar`, `vigiar` segredos/dependências/
  espelho, `vigiar-dependencias`, `espelhar-imagens/conferir`) escolhem o
  executor pela variável `EXECUTOR_CI`, e só em pedidos que não vêm de fork nem
  do dependabot; o resto fica em `ubuntu-24.04` (revisão do #472).
- `infra/ci-executor/`: `preparar.sh` (máquina Ubuntu 24.04 dedicada),
  `ficheiros/`, `LEIA-ME.md` (passos do Diogo e ameaças).
- O `shellcheck` do trabalho `script-vps` lê o script novo.

## Números (com data e como se contaram)

- 17/10/2026: 18 linhas `runs-on` nos 9 fluxos (`grep -c runs-on`); actionlint
  sem erros; `shellcheck` 0.9.0 sem avisos; `preparar.sh --mostrar` num
  `ubuntu:24.04` vazio: 22 acções que faria, 2 avisos, nada mudou (listas de
  ficheiros e de contas iguais antes e depois).

## O que ficou por verificar

- Versão e sha256 do executor: 2.338.0 e o sha256 calculado por nós sobre o download (17/10/2026); por conferir com o publicado na página v2.338.0, que não abriu na sessão.
- O modo real do script, o registo, os ganchos e o executor com a pasta do
  root (só `_work`, `_diag` e as credenciais do utilizador): não corridos.
- Se o `startup_failure` da conta afecta também os fluxos num executor próprio.
- Preço e oferta da máquina (OVH: não verifiquei).
- Os fluxos do `ensaio` ficam no GitHub: com o Actions bloqueado não correm
  (ADR-0046, consequências).
