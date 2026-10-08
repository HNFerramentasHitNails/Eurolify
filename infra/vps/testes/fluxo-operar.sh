#!/usr/bin/env bash
# Teste do passo «Montar o pedido» do fluxo operar (.github/workflows/operar.yml;
# revisão do #165, P2-1): corre o próprio bloco do fluxo, tirado do YAML, e
# confere que o convite só aceita e-mails de domínios reservados para testes
# (ADR-0019) e que nenhuma entrada leva um segredo. Se alguém estragar ou
# tirar a protecção do fluxo, isto falha.
set -Eeuo pipefail
[[ "${EUROLIFY_TESTE_DESCARTAVEL:-}" == 1 ]] || { echo "só numa máquina descartável (EUROLIFY_TESTE_DESCARTAVEL=1)" >&2; exit 2; }
repo="$(cd "$(dirname "$0")/../../.." && pwd)"
falhas=0
falhou() { echo "FALHOU: $*"; falhas=$((falhas + 1)); }

pasta="$(mktemp -d)"
# O bloco «run: |» do passo «Montar o pedido», sem a indentação do YAML.
awk '
  /- name: Montar o pedido/ { passo = 1; next }
  passo && /^ *run: \|$/ { match($0, /^ */); base = RLENGTH; dentro = 1; next }
  dentro {
    if ($0 ~ /^ *$/) { print ""; next }
    match($0, /^ */)
    if (RLENGTH <= base) exit
    print substr($0, base + 3)
  }
' "$repo/.github/workflows/operar.yml" >"$pasta/montar.sh"
grep -q 'pedido="convite ' "$pasta/montar.sh" || { echo "FALHOU: não se encontrou o passo no fluxo"; exit 1; }

# O executor do GitHub tem o openssl; o Ubuntu vazio do teste não.
printf '#!/usr/bin/env bash\necho 0123456789abcdef0123456789abcdef\n' >"$pasta/openssl"
chmod 755 "$pasta/openssl"

uuid=0199b1c2-3d4e-7f00-8a9b-0c1d2e3f4a5b
resumo="$(printf 'a%.0s' {1..64})"
montar() { # montar <ACCAO> <EMAIL> [RESUMO] — escreve o pedido em $pasta/pedido
  : >"$pasta/saida"
  env -i PATH="$pasta:$PATH" GITHUB_OUTPUT="$pasta/saida" GITHUB_ACTOR_ID=1001 \
    ACCAO="$1" NOME="" LINGUA=pt FUSO=Europe/Lisbon COMERCIANTE="mer_$uuid" \
    AMBITOS="" PREFIXO="" RESUMO="${3:-$resumo}" EMAIL="$2" \
    bash "$pasta/montar.sh" >/dev/null 2>&1
}
aceita() { # aceita <e-mail> <e-mail gravado>
  local esperado
  esperado="$(printf '%s' "$2" | basenc --base64url -w0 | tr -d '=')"
  if montar convite "$1" && grep -qx "convite $uuid $esperado dono $resumo github:1001" "$pasta/saida"; then
    echo "ok: aceita $1"
  else
    falhou "não aceitou $1"
  fi
}
recusa() { # recusa <e-mail> [resumo]
  if montar convite "$1" "${2:-}"; then falhou "aceitou «$1» ${2:+com o resumo $2}"; else echo "ok: recusa «$1» ${2:+com $2}"; fi
}

aceita dono@loja.test dono@loja.test
aceita Dono@Loja.Test dono@loja.test
aceita ana@example.com ana@example.com
aceita rui@sub.example.org rui@sub.example.org
aceita ivo@x.invalid ivo@x.invalid
recusa dono@gmail.com
recusa dono@notexample.com
recusa dono@loja.test.evil.com
recusa dono@test
recusa "dono @loja.test"
recusa ""
recusa dono@loja.test "euc_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG"
if montar chave "" "eul_sk_abcdefghij"; then falhou "aceitou um segredo de chave"; else echo "ok: recusa um segredo de chave"; fi

rm -rf "$pasta"
((falhas == 0))
