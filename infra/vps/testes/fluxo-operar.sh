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

# Cada acção confere os campos dela e diz o que falta (os dois enganos do
# primeiro ensaio, 08/10/2026).
correr() { # correr <ACCAO> <NOME> <COMERCIANTE> <RESUMO> <EMAIL> [PREFIXO] [AMBITOS] [FUSO] — saída em $pasta/erro
  : >"$pasta/saida"
  env -i PATH="$pasta:$PATH" GITHUB_OUTPUT="$pasta/saida" GITHUB_ACTOR_ID=1001 \
    ACCAO="$1" NOME="$2" LINGUA=pt FUSO="${8:-Europe/Lisbon}" COMERCIANTE="$3" \
    AMBITOS="${7:-catalog:read}" PREFIXO="${6:-eul_sk_abcde}" RESUMO="$4" EMAIL="$5" \
    bash "$pasta/montar.sh" >/dev/null 2>"$pasta/erro"
}
recusa_com() { # recusa_com <descrição> <texto esperado na mensagem> <argumentos do correr…>
  local descricao="$1" texto="$2"; shift 2
  if correr "$@"; then
    falhou "$descricao: aceitou"
  elif grep -qF -- "$texto" "$pasta/erro"; then
    echo "ok: $descricao"
  else
    falhou "$descricao: a mensagem não diz «$texto» ($(cat "$pasta/erro"))"
  fi
}
recusa_com "comerciante sem nome (a acção ficou em «comerciante»)" "falta o nome do comerciante" comerciante "" "" "" ""
recusa_com "convite com «;» no fim do comerciante" "o comerciante é o mer_" convite "" "mer_$uuid;" "$resumo" dono@loja.test
recusa_com "convite sem comerciante" "o comerciante é o mer_" convite "" "" "$resumo" dono@loja.test
recusa_com "convite com o resumo cortado" "o resumo tem de ser" convite "" "mer_$uuid" "${resumo:0:60}" dono@loja.test
recusa_com "convite sem e-mail" "falta o e-mail" convite "" "mer_$uuid" "$resumo" ""
recusa_com "chave sem nome" "falta o nome da chave" chave "" "mer_$uuid" "$resumo" ""
recusa_com "chave com o prefixo errado" "o prefixo" chave "Gestão" "mer_$uuid" "$resumo" "" eul_pk_abcde
# Os segredos em campos que de outro modo passariam, com o resto válido
# (revisão do #172, P2-1): sem o filtro, estes casos eram aceites.
recusa_com "segredo de chave no nome de uma chave completa" "SEGREDO de chave" chave "eul_sk_abcdefghij" "mer_$uuid" "$resumo" ""
recusa_com "segredo de convite no e-mail de um convite completo" "SEGREDO de um convite" convite "" "mer_$uuid" "$resumo" "euc_x@loja.test"
recusa_com "segredo no comerciante" "SEGREDO de chave" convite "" "eul_sk_abcdefghij" "$resumo" dono@loja.test
if grep -qF eul_sk_abcdefghij "$pasta/erro"; then falhou "o segredo foi repetido na mensagem"; else echo "ok: o segredo não é repetido na mensagem"; fi
recusa_com "comerciante só com espaços no nome" "falta o nome do comerciante" comerciante "   " "" "" ""
recusa_com "nome com tabulação" "caracteres de controlo" comerciante "$(printf 'Loja\tA')" "" "" ""
recusa_com "nome com mais de 100 caracteres" "no máximo 100" comerciante "$(printf 'a%.0s' {1..101})" "" "" ""
recusa_com "âmbito desconhecido" "âmbito desconhecido" chave "Gestão" "mer_$uuid" "$resumo" "" eul_sk_abcde "catalog:raed"
recusa_com "âmbito storefront numa chave de servidor" "âmbito desconhecido" chave "Gestão" "mer_$uuid" "$resumo" "" eul_sk_abcde "storefront"
recusa_com "fuso com «;»" "fuso horário" comerciante "Loja" "" "" "" "" "" "Europe/Lisbon;rm"
if correr comerciante "Loja de Ensaio" "" "" "" && grep -q "^comerciante pt Europe/Lisbon " "$pasta/saida"; then
  echo "ok: aceita um comerciante com nome"
else
  falhou "não aceitou um comerciante com nome"
fi
if correr chave "Gestão" "mer_$uuid" "$resumo" "" && grep -q "^chave $uuid catalog:read eul_sk_abcde $resumo " "$pasta/saida"; then
  echo "ok: aceita uma chave completa"
else
  falhou "não aceitou uma chave completa"
fi

rm -rf "$pasta"
((falhas == 0))
