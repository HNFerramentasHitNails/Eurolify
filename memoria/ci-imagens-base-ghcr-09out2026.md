# CI: imagens base copiadas para o GHCR (#268) — 09/10/2026

## O que se fez

- **Porquê:** a 09/10/2026 o CI falhou várias vezes por causa do Docker Hub (memória `ci-imagens-espelho-09out2026.md`, do #263):
  - sem conta, com 429;
  - com conta, com 500 e com tempos esgotados no `auth.docker.io`.

  Diogo, 09/10/2026: «sim, abre o pedido para copiar para o GitHub».
- **A lista:** `infra/ci/imagens-base.txt` tem as quatro imagens de que dependemos (`postgres`, `ubuntu`, `node` e `moby/buildkit`). Cada uma está presa pelo resumo `sha256`.
- **A cópia:** o fluxo `espelhar-imagens.yml` copia-as para `ghcr.io/<dono>/eurolify-base/<nome>:<etiqueta>`, com `skopeo copy --all --preserve-digests`, e confirma que o resumo é o mesmo. Num pedido, só confere que cada resumo existe na origem (Docker Hub ou espelho), sem escrever no GHCR. A cópia faz-se no `main`, depois da revisão, ou à mão (`workflow_dispatch`) (revisão do #269, P2-1). As cópias de 09/10/2026 foram feitas ainda a partir do pedido, antes desta mudança.
- **A origem da cópia:** primeiro o Docker Hub. Se falhar, o espelho da Google, `mirror.gcr.io` (decisão do Diogo, 09/10/2026: «sim, usa o espelho da Google se falhar»). O resumo é o mesmo nos dois, e a cópia confirma-o. O espelho só recebe pedidos de descarga de imagens públicas, sem dados pessoais. É da Google, de fora da UE.
- **O #263 entrou antes deste pedido** e pôs o `verificar` e o `Dockerfile` a descarregar directamente do `mirror.gcr.io`, que é uma cache e não garante que uma imagem fique. O Diogo decidiu refazer este pedido a partir do `main` (09/10/2026: «sim, refaz o #269 a partir do main»): as cópias do GHCR primeiro e o espelho como recurso. A parte da conta do Docker Hub (#267) saiu, porque o #267 fechou sem juntar.
- **O uso:** `infra/ci/imagem-base.sh` descarrega a cópia do GHCR pelo resumo. Se ela faltar, tenta o `mirror.gcr.io` e, por fim, o Docker Hub, com repetições, e deixa um aviso a dizer de onde veio. Usam-no:
  - as tarefas `codigo`, `script-vps` e `imagem` do `verificar`;
  - a `imagem` do `publicar`.

  O `node` entra no `Dockerfile` pelo `NODE_IMAGEM`, e o `buildkit` pelo `driver-opts` do buildx.
- **O PostgreSQL da `codigo`** passou de `services:` (no #263, com o health-check `pg_isready`) para um passo `docker run`, à espera do `pg_isready` por TCP durante até 60 s.
- **O `node`** continua no `Dockerfile` com o `mirror.gcr.io` por omissão. Os fluxos trocam-no pela cópia do GHCR com `NODE_IMAGEM`. A tarefa `script-vps` confirma que o resumo do `node` na lista é o do `Dockerfile` (revisão do #269, P3-1).
- **O BuildKit volta a descarregar o `node`** do registo escolhido para construir. O `docker pull` prévio só escolhe a origem que responde; não garante a descarga do BuildKit (revisão do #269, P3-2, aceite).
- **Mudar de versão** é mudar uma linha da lista num pedido revisto. No caso do `node`, muda-se também o `NODE_IMAGEM` do `Dockerfile`, para os dois resumos baterem. O Docker Hub só é preciso nesse momento.

## Números (com data e como se contaram)

- Quatro imagens base, contadas na lista e no registo do CI do #267 a 09/10/2026. De onde veio cada resumo:
  - `postgres`: o que já estava no `verificar.yml` e em `infra/vps/ficheiros/ensaio.conf`;
  - `ubuntu`: o que já estava no `verificar.yml`, na tarefa `script-vps`;
  - `node`: o `NODE_IMAGEM` do `Dockerfile`;
  - `moby/buildkit:buildx-stable-1`: `sha256:cec9f139…`, lido no registo do `docker pull` da tarefa `imagem` do CI do #267 (as tarefas 114028640293 e 114036691676).
- A 09/10/2026, entre as 21h45 e as 21h48 UTC, a cópia falhou duas vezes:
  - na primeira, o skopeo 1.13 recusou a origem com etiqueta e resumo juntos (corrigido);
  - na segunda, o `auth.docker.io` respondeu `504 Gateway Timeout`.

  A cópia passou a tentar até 6 vezes, com esperas até 2 minutos.

## O que ficou por verificar

- Se o `mirror.gcr.io` serve o `moby/buildkit` (fora de `library/`), pela referência só com o resumo: o #270, de outra sessão, já usa `mirror.gcr.io/moby/buildkit:v0.33.1@sha256:cec9f139…` (o mesmo resumo) no `main`, por isso o espelho tem-no. O caminho deste script (sem a etiqueta) não foi exercitado.

- Se o pacote criado no GHCR pelo `GITHUB_TOKEN` fica ligado ao repositório e é privado, como o repositório: **não verifiquei**. A prova é o primeiro CI que descarregar a cópia. Se o registo mostrar o aviso «sem a cópia do GHCR», o Diogo ou o Bruno ligam cada pacote ao repositório em github.com → o pacote → «Package settings» → «Manage Actions access», com leitura.
- Se o GHCR tem limites de descarga para os fluxos do próprio repositório: **não verifiquei**.
- A VPS fica de fora: `infra/vps/ficheiros/ensaio.conf` descarrega o `postgres` do Docker Hub (memória do #263).
- **Primeira cópia**, a 09/10/2026, às 21h49 UTC (corrida 37995660677): as quatro imagens foram copiadas do Docker Hub, sem conta, porque a entrada deu 504 no incidente «Hub Registry Authenticated Actions Failing», visto na página de estado do Docker. O resumo foi confirmado nas quatro.
- A etiqueta `buildx-stable-1` muda no Docker Hub; a nossa cópia fica presa ao resumo copiado até se mudar a lista.
