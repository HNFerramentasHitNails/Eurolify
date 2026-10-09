# CI: descargas do Docker Hub com conta (#266) — 09/10/2026

## O que se fez

- **Porquê:** no #256, as verificações obrigatórias `imagem` e `script-vps` falharam duas vezes seguidas. O Docker Hub recusou as descargas anónimas das imagens base com `429 Too Many Requests` e `toomanyrequests: You have reached your unauthenticated pull rate limit`. As imagens eram `node:24.21.0-trixie-slim` e `ubuntu:26.04`. O limite anónimo é partilhado pelos executores do GitHub.
- **Decisão do Diogo (09/10/2026):** uma conta Docker Hub grátis, com uma chave só de leitura. O Diogo criou a conta e os dois segredos do repositório, `DOCKERHUB_UTILIZADOR` e `DOCKERHUB_TOKEN`. São segredos do repositório e não do ambiente `ensaio`, porque as verificações dos pedidos não correm nele.
- **Fluxos alterados** (`docker/login-action`, a mesma versão fixada que o `publicar.yml` já usava):
  - `verificar.yml`: as tarefas `script-vps` e `imagem` entram no Docker Hub antes de descarregar.
  - `publicar.yml`: a tarefa `imagem` entra também, e o fluxo passa os dois segredos ao `verificar` que chama.
  - Sem os segredos, as tarefas continuam sem conta, como antes.
- **Fora disto:** o PostgreSQL da tarefa `codigo` é um serviço, e o GitHub descarrega-o antes dos passos. Não tem conta, porque as credenciais de um serviço não se podem pôr condicionais. Se também falhar por 429, trata-se à parte.

## Números (com data e como se contaram)

- Preços (página docker.com/pricing, 09/10/2026):
  - Personal: grátis, 100 descargas por hora com conta.
  - Pro: 9 a 11 $ por utilizador e por mês.
  - Team: 15 a 16 $ por utilizador e por mês.
  - Business: 24 $ por utilizador e por mês.
  - A página não diz a moeda.
- Descargas do Docker Hub por pedido de alteração: 2 imagens nas tarefas com conta, contadas no `verificar.yml`.

## O que ficou por verificar

- A data de expiração da chave: fica com o Diogo, que a criou; **não verifiquei**. Quando expirar, as tarefas falham na entrada no Docker Hub, porque o segredo existe mas é inválido.
- Se a condição de uso do plano grátis permite uma conta usada por uma empresa: **não verifiquei**.
- A Docker é uma empresa de fora da UE. Só recebe pedidos de descarga de imagens públicas, sem dados pessoais.
