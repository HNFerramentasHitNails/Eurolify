# Testes do GitHub: as imagens do espelho mirror.gcr.io — 09/10/2026

Decisão do Diogo, 09/10/2026: *«sim, avança com a opção 3»* — descarregar
as mesmas imagens de outra origem pública, sem conta nem chave (as outras
opções eram esperar ou uma conta no Docker Hub). Pedido #263.

## O que se fez

- **O problema**: o Docker Hub recusava as descargas sem conta
  (`toomanyrequests: You have reached your unauthenticated pull rate
  limit`). Os passos `codigo`, `script-vps` e `imagem` do `verificar`
  paravam antes de algum teste: corridas 37989700509 (duas vezes),
  37991232782, 37991373117 e 37992053661, a 09/10/2026.
- **A mudança** (`.github/workflows/verificar.yml`, `Dockerfile`): o
  `postgres:18.6`, o `ubuntu:26.04` e a base `node:24.21.0-trixie-slim`
  passam a `mirror.gcr.io/library/...`, **com o mesmo resumo SHA-256**: o
  Docker confere o conteúdo pelo resumo, por isso o espelho pode recusar
  mas não trocar a imagem.
- **O que é o `mirror.gcr.io`** (fonte: Google, «Pull cached Docker Hub
  images», `docs.cloud.google.com/artifact-registry/docs/pull-cached-dockerhub-images`,
  actualizada a 07/10/2026, lida a 09/10/2026): uma cache gerida pela
  Google das imagens públicas do Docker Hub **mais pedidas**; acrescenta as
  mais pedidas e tira as que deixam de o ser, e não garante que uma imagem
  fique. A recuperação para o Docker Hub só existe com o espelho
  configurado no daemon; com o endereço directo, como aqui, uma imagem que
  lá não esteja **falha**.
- **A VPS fica de fora de propósito** (revisão do #263, P3-1):
  `infra/vps/ficheiros/ensaio.conf:13` continua `postgres:18.6@sha256:…`
  do Docker Hub. Mudar só a cadeia daria o aviso «não mudo sozinho» do
  `preparar.sh` (linhas 359-373) a cada corrida. Numa máquina nova (a
  migração para Paris, ADR-0018) a descarga pode levar o mesmo 429:
  trata-se nesse passo.
- **O BuildKit do `setup-buildx-action`** (revisão do #263, P2-1): a
  hipótese do revisor estava certa e eu tinha-a posto de lado cedo de mais.
  A publicação do #263 (corrida 37993770813, 09/10/2026, 21:35 UTC) falhou
  a descarregar `moby/buildkit:buildx-stable-1` do Docker Hub (tempo
  esgotado no `auth.docker.io`); o ensaio ficou com a versão anterior.
  Preparado no #270: `driver-opts: image=mirror.gcr.io/moby/buildkit:v0.33.1@sha256:cec9f139…`
  nos dois fluxos; a prova é a primeira publicação depois de o juntar
  (revisão do #270, P3-3). A v0.33.1 e a `buildx-stable-1` deram o mesmo
  resumo no espelho a 09/10/2026 (`curl` ao
  `/v2/moby/buildkit/manifests/<etiqueta>`, HTTP 200 e
  `docker-content-digest: sha256:cec9f139…` nas duas e no próprio resumo;
  revisão do #270, P3-4). Nas corridas do
  `verificar` antes disso o BuildKit veio de algum lado sem falhar; não
  verifiquei de onde.
- **A conta do Docker Hub** (a opção 2, feita noutra sessão: issue #266,
  pedido #267, segredos `DOCKERHUB_UTILIZADOR` e `DOCKERHUB_TOKEN`): o
  Diogo decidiu ficar com o espelho (09/10/2026, *«sim, fica o #263, fecha
  o #267»*). O #267 foi fechado sem juntar; a conta e os segredos ficam
  para a VPS nova, onde o espelho não chega. A data de expiração da chave
  não verifiquei.
- **Os dados ficam na UE**: o espelho só serve imagens públicas aos
  executores do GitHub; não recebe dados pessoais nem fala com a VPS.

## Números (com data e como se contaram)

- 09/10/2026: os manifestos dos três resumos existem no espelho (`curl` ao
  `/v2/library/<imagem>/manifests/<resumo>`, HTTP 200 nos três). No
  `public.ecr.aws`, dois dos três deram 429.
- 09/10/2026, corrida 37992414036 (1134a42): `imagem` e `script-vps`
  verdes com o espelho.
- 09/10/2026, primeira publicação com o BuildKit do espelho: `publicar`
  37996645550 (26bf049, o #270) verde às 22:10 UTC; depois, 37999525392
  (d7cb370) também.

- **A vigilância** (revisão do #270, P2-1): o fluxo `vigiar` tem a tarefa
  `espelho`, que todas as manhãs (e em cada entrada no `main`) confere,
  pelo resumo, cada imagem `mirror.gcr.io/…@sha256:` escrita nos fluxos e
  no `Dockerfile`; se uma sair do espelho, a corrida falha e abre o issue
  «vigiar: a corrida da manhã falhou». Provado a 09/10/2026: as quatro
  deram 200; um resumo inventado deu 404 e saída 1.
- **Actualizar as versões** (revisão do #270, P3-5): com os resumos
  fixos, nada se actualiza sozinho (não há Dependabot). Quem mexer nos
  fluxos revê as quatro versões; o aviso de segurança de uma delas é
  motivo para um pedido próprio.

## O que ficou por verificar

- **Ao mudar um resumo**, confirmar primeiro que o novo existe no espelho
  (o `curl` acima); se não existir, a corrida falha.
- A VPS numa máquina nova (P3-1).
