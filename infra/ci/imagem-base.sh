#!/usr/bin/env bash
# Descarrega as imagens base pedidas (#268): primeiro a cópia do GHCR, pelo
# resumo; se faltar, do Docker Hub, com repetições. Escreve <nome>=<referência
# usada> por cada uma, para o $GITHUB_OUTPUT.
#
#   infra/ci/imagem-base.sh <dono-em-minúsculas> <nome>...
set -euo pipefail

lista="$(dirname "$0")/imagens-base.txt"
dono="$1"
shift

# Tenta `docker pull` até $2 vezes, com espera crescente.
descarregar() {
  local ref="$1" vezes="$2" tentativa
  for ((tentativa = 1; tentativa <= vezes; tentativa++)); do
    if docker pull --quiet "$ref" >&2; then
      return 0
    fi
    if ((tentativa < vezes)); then
      sleep $((tentativa * 10))
    fi
  done
  return 1
}

for nome in "$@"; do
  origem="$(awk -v n="$nome" '$1 == n { print $2 }' "$lista")"
  if [[ -z "$origem" ]]; then
    echo "imagem-base: «$nome» não está em $lista" >&2
    exit 1
  fi
  resumo="${origem##*@}"
  copia="ghcr.io/$dono/eurolify-base/$nome@$resumo"
  # Duas tentativas no GHCR: se a cópia não existe, repetir não a cria
  # (revisão do #269, P2-1).
  if descarregar "$copia" 2; then
    echo "$nome=$copia"
  elif descarregar "$origem" 5; then
    echo "::warning::imagem-base: sem a cópia do GHCR para $nome; veio do Docker Hub" >&2
    echo "$nome=$origem"
  else
    echo "imagem-base: não consegui descarregar $nome" >&2
    exit 1
  fi
done
