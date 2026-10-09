# CI: descargas do Docker Hub com conta (#266) — 09/10/2026

## O que se fez

- **Porquê:** no #256, as verificações obrigatórias `imagem` e `script-vps` falharam duas vezes seguidas. O Docker Hub recusou as descargas anónimas das imagens base com `429 Too Many Requests` e `toomanyrequests: You have reached your unauthenticated pull rate limit`. As imagens eram `node:24.21.0-trixie-slim` e `ubuntu:26.04`. O limite anónimo é partilhado pelos executores do GitHub.
- **Decisão do Diogo (09/10/2026):** uma conta Docker Hub grátis, com uma chave só de leitura. O Diogo criou a conta e os dois segredos do repositório, `DOCKERHUB_UTILIZADOR` e `DOCKERHUB_TOKEN`. São segredos do repositório e não do ambiente `ensaio`, porque as verificações dos pedidos não correm nele.
- **Fluxos alterados** (`docker login` com a chave pela entrada padrão, até 5 tentativas):
  - `verificar.yml`: as tarefas `codigo`, `script-vps` e `imagem` entram no Docker Hub antes de descarregar.
  - `publicar.yml`: a tarefa `imagem` entra também, e o fluxo passa os dois segredos ao `verificar` que chama.
  - Sem os segredos, as tarefas continuam sem conta, como antes. A entrada tem `continue-on-error`: se o Docker Hub falhar a entrada ou a chave expirar, as tarefas continuam sem conta.
- **Correcções da revisão do #267:**
  - A entrada passou para antes do `setup-buildx`, porque este descarrega `moby/buildkit` do Docker Hub.
  - O PostgreSQL da tarefa `codigo` deixou de ser um serviço e passou a arrancar num passo (`docker run`) depois da entrada. No #267 falhou com 429 sem conta.
  - O primeiro CI do #267 mostrou que a entrada pode falhar do lado do Docker Hub: `500 Internal Server Error` na tarefa `imagem`.
  - No segundo CI (46968ba), a `codigo` entrou («Login Succeeded!») e passou, mas a `imagem` e a `script-vps` receberam outra vez o 500 e caíram no 429 sem conta. Por isso a entrada passou a ter até 5 tentativas, com 10, 20, 30 e 40 s de espera entre elas, em vez da `docker/login-action`, que tenta uma vez só.
- **Dependabot:** o repositório não tem `.github/dependabot.yml` (procurado com `ls`, 09/10/2026), por isso não há pedidos do Dependabot sem segredos. Se um dia houver, correm sem conta.
- **Se houver suspeita de fuga da chave:** revoga-se primeiro no Docker Hub e investiga-se depois. A chave só dá descargas de imagens públicas.

## Números (com data e como se contaram)

- Preços (página docker.com/pricing, 09/10/2026):
  - Personal: grátis. A página de preços diz 100 descargas por hora com conta. A documentação (docs.docker.com/docker-hub/usage/, 09/10/2026) diz 200 por 6 horas com conta, e 100 por 6 horas por endereço IP sem conta. As duas fontes não batem certo; vale a mais baixa até se medir.
  - Pro: 9 a 11 $ por utilizador e por mês.
  - Team: 15 a 16 $ por utilizador e por mês.
  - Business: 24 $ por utilizador e por mês.
  - A página não diz a moeda.
- Imagens que cada pedido de alteração descarrega do Docker Hub, todas agora com conta (contadas no `verificar.yml` e no `Dockerfile`, 09/10/2026):
  - `postgres:18.6`, na tarefa `codigo`;
  - `ubuntu:26.04`, na tarefa `script-vps`, uma vez por teste e mais uma vez para o `--mostrar`;
  - `moby/buildkit` e `node:24.21.0-trixie-slim`, na tarefa `imagem`.

## O que ficou por verificar

- As descargas da conta vêem-se em https://hub.docker.com/usage/pulls (por mês, com um CSV enviado por e-mail), e a última utilização da chave em app.docker.com → Account settings → Personal access tokens. O Docker Hub não mostra os erros do lado dele; esses só aparecem nos registos do GitHub.

- A data de expiração da chave: fica com o Diogo, que a criou; **não verifiquei**. Quando expirar, as tarefas falham na entrada no Docker Hub, porque o segredo existe mas é inválido.
- Se a condição de uso do plano grátis permite uma conta usada por uma empresa: **não verifiquei**.
- A Docker é uma empresa de fora da UE. Só recebe pedidos de descarga de imagens públicas, sem dados pessoais.
