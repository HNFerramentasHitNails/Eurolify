# CI: imagens base copiadas para o GHCR (#268) — 09/10/2026

## O que se fez

- **Porquê:** a 09/10/2026 o CI falhou várias vezes por causa do Docker Hub (memória `ci-docker-hub-conta-09out2026.md`):
  - sem conta, com 429;
  - com conta, com 500 e com tempos esgotados no `auth.docker.io`.

  Diogo, 09/10/2026: «sim, abre o pedido para copiar para o GitHub».
- **A lista:** `infra/ci/imagens-base.txt` tem as quatro imagens de que dependemos (`postgres`, `ubuntu`, `node` e `moby/buildkit`). Cada uma está presa pelo resumo `sha256`.
- **A cópia:** o fluxo `espelhar-imagens.yml` copia-as para `ghcr.io/<dono>/eurolify-base/<nome>:<etiqueta>`, com `skopeo copy --all --preserve-digests`, e confirma que o resumo é o mesmo. Corre quando a lista ou o fluxo mudam (no pedido e no `main`) e à mão.
- **O uso:** `infra/ci/imagem-base.sh` descarrega a cópia do GHCR pelo resumo. Se ela faltar, vai ao Docker Hub com repetições e deixa um aviso. Usam-no:
  - as tarefas `codigo`, `script-vps` e `imagem` do `verificar`;
  - a `imagem` do `publicar`.

  O `node` entra no `Dockerfile` pelo `NODE_IMAGEM`, e o `buildkit` pelo `driver-opts` do buildx.
- **Mudar de versão** é mudar uma linha da lista num pedido revisto. No caso do `node`, muda-se também o `NODE_IMAGEM` do `Dockerfile`, para os dois resumos baterem. O Docker Hub só é preciso nesse momento.

## Números (com data e como se contaram)

- Quatro imagens base, contadas na lista e no registo do CI do #267 a 09/10/2026. O `moby/buildkit:buildx-stable-1` tinha o resumo `sha256:cec9f139…`, lido no registo do `docker pull` da tarefa `imagem` desse CI.

## O que ficou por verificar

- Se o pacote criado no GHCR pelo `GITHUB_TOKEN` fica ligado ao repositório e é privado, como o repositório: **não verifiquei**. A prova é o primeiro CI que descarregar a cópia.
- Se o GHCR tem limites de descarga para os fluxos do próprio repositório: **não verifiquei**.
- Se a VPS descarrega alguma coisa do Docker Hub ao publicar (a imagem da API vem do GHCR): **não verifiquei**.
- A etiqueta `buildx-stable-1` muda no Docker Hub; a nossa cópia fica presa ao resumo copiado até se mudar a lista.
