#!/usr/bin/env bash
# Gancho do executor, no início e no fim de cada trabalho
# (ACTIONS_RUNNER_HOOK_JOB_STARTED e ACTIONS_RUNNER_HOOK_JOB_COMPLETED).
# O executor corre um trabalho de cada vez e esta máquina é dedicada. Por isso:
#  - apaga todos os contentores: o fluxo `verificar` deixa o PostgreSQL a
#    correr e o trabalho seguinte falharia com o nome e a porta já ocupados
#    (nos executores do GitHub a máquina é deitada fora no fim);
#  - apaga o que um trabalho de deploy deixa no utilizador (chave SSH, entrada
#    no GHCR, credenciais do gh).
# Nunca falha: um gancho que falha deita abaixo o trabalho.
set +e
docker ps -aq 2>/dev/null | xargs -r docker rm -f >/dev/null 2>&1
casa="${HOME:-}"
if [[ -n "$casa" && "$casa" != "/" ]]; then
  rm -rf -- "$casa/.ssh" "$casa/.docker/config.json" "$casa/.config/gh"
fi
exit 0
