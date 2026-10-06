#!/usr/bin/env bash
# Teste do eurolify-pedido, o comando fixo das chaves dos fluxos do GitHub
# (ADR-0026, ADR-0028; revisão do #110, P2-6, «teste próprio do eurolify-pedido»).
# Ex.: a chave do fluxo «publicar» manda «sha256:<64 hex>;reboot» e o pedido é
# recusado antes de chegar à pasta do serviço da máquina.
#
# Confere: o fluxo desconhecido (64); os pedidos fora do formato (65), sem
# deixar nada na pasta; a mesma expressão no eurolify-pedido e no
# eurolify-trabalho, fluxo a fluxo; o código e o texto da resposta passam ao
# GitHub; um código que não é número dá 70; as respostas antigas apagam-se.
# Não confere (esperas longas, não se mudam para o teste): a tranca ocupada
# (75, ao fim de 60 s) e a falta de resposta (69, ao fim de 120 s ou mais).
# Corre como root num contentor Ubuntu descartável.
set -Eeuo pipefail
[[ "${EUROLIFY_TESTE_DESCARTAVEL:-}" == 1 ]] || { echo "só numa máquina descartável (EUROLIFY_TESTE_DESCARTAVEL=1)" >&2; exit 2; }
repo="$(cd "$(dirname "$0")/../../.." && pwd)"
f="$repo/infra/vps/ficheiros"
pedido_sh="$f/bin/eurolify-pedido"
falhas=0
falhou() { echo "FALHOU: $*"; falhas=$((falhas + 1)); }

h64="$(printf 'a%.0s' {1..64})"
h40="$(printf 'b%.0s' {1..40})"
for fluxo in publicar aplicar medir operar; do
  install -d -m 700 "/var/lib/eurolify/pedidos/$fluxo"
done

# Corre o eurolify-pedido como o sshd o corre; devolve o código de saída. Com
# um limite de 20 s: um pedido aceite por engano ficava à espera de resposta
# (até 1900 s) e o teste parava em vez de falhar; assim dá 124 e falha.
pedir() { # pedir <fluxo> <pedido>
  local codigo=0
  SSH_ORIGINAL_COMMAND="$2" timeout 20 bash "$pedido_sh" "$1" >"$saida" 2>&1 || codigo=$?
  return "$codigo"
}
saida="$(mktemp)"

# 1. A mesma expressão nas duas camadas, fluxo a fluxo.
padrao_de() { # padrao_de <ficheiro> <fluxo>
  awk -v f="$2" '
    $0 ~ "^ *" f "\\)" { dentro = 1 }
    dentro && match($0, /padrao=\x27[^\x27]*\x27/) {
      print substr($0, RSTART + 8, RLENGTH - 9); exit
    }' "$1"
}
for fluxo in publicar aplicar medir operar; do
  a="$(padrao_de "$pedido_sh" "$fluxo")"
  b="$(padrao_de "$f/sbin/eurolify-trabalho" "$fluxo")"
  if [[ -n "$a" && "$a" == "$b" ]]; then
    echo "ok: $fluxo: a mesma expressão no eurolify-pedido e no eurolify-trabalho"
  else
    falhou "$fluxo: as expressões diferem ('$a' / '$b')"
  fi
done

# 2. Fluxo desconhecido. O «mcp» existe no serviço da máquina, mas não tem
# chave SSH: o eurolify-pedido não o aceita.
for fluxo in mcp "" "../publicar"; do
  codigo=0; pedir "$fluxo" "medir" || codigo=$?
  if [[ $codigo == 64 ]]; then echo "ok: fluxo '$fluxo' recusado (64)"; else falhou "fluxo '$fluxo' deu $codigo, não 64"; fi
done

# 3. Pedidos fora do formato: 65, e a pasta fica vazia.
nl=$'\n'
recusados=(
  "publicar|sha256:abc"
  "publicar|sha256:$h64;reboot"
  "publicar|sha256:$h64${nl}reboot"
  "publicar|SHA256:$h64"
  "aplicar|$h40 apagar"
  "aplicar|$h40 aplicar extra"
  "medir|x"
  "medir| "
  "operar|comerciante pt Europe/Lisbon Loja github:1;reboot"
  "operar|comerciante pt Europe/Lisbon Loja"
  "operar|chave 0 catalog:read eul_sk_abcde $h64 Nome github:1"
)
for caso in "${recusados[@]}"; do
  fluxo="${caso%%|*}"; texto="${caso#*|}"
  rm -f "/var/lib/eurolify/pedidos/$fluxo/pedido"
  codigo=0; pedir "$fluxo" "$texto" || codigo=$?
  if [[ $codigo != 65 ]]; then
    falhou "$fluxo: '${texto//$nl/\\n}' deu $codigo, não 65"
  elif [[ -e "/var/lib/eurolify/pedidos/$fluxo/pedido" ]]; then
    falhou "$fluxo: '${texto//$nl/\\n}' recusado, mas deixou o pedido na pasta"
  else
    echo "ok: $fluxo: '${texto//$nl/\\n}' recusado (65)"
  fi
done

# 4. Pedidos aceites: um serviço de mentira responde no lugar do da máquina.
responder() { # responder <fluxo> <primeira linha da resposta> <texto>
  local pasta="/var/lib/eurolify/pedidos/$1" i id
  for ((i = 0; i < 100; i++)); do [[ -f "$pasta/pedido" ]] && break; sleep 0.1; done
  [[ -f "$pasta/pedido" ]] || return 0
  sed -n 1p "$pasta/pedido" >"$pasta/.recebido"
  id="$(sed -n 2p "$pasta/pedido")"
  rm -f "$pasta/pedido"
  printf '%s\n%s\n' "$2" "$3" >"$pasta/.resposta"
  mv -f "$pasta/.resposta" "$pasta/resultado.$id"
}
aceite() { # aceite <descrição> <fluxo> <pedido> <resposta> <texto> <código esperado>
  local descricao="$1" fluxo="$2" texto="$3" codigo=0 pasta="/var/lib/eurolify/pedidos/$2"
  : >"$pasta/resultado.antigo"
  responder "$fluxo" "$4" "$5" &
  pedir "$fluxo" "$texto" || codigo=$?
  wait
  if [[ $codigo != "$6" ]]; then
    falhou "$descricao: deu $codigo, não $6 ($(tr '\n' ' ' <"$saida"))"
  elif [[ "$(cat "$pasta/.recebido")" != "$texto" ]]; then
    falhou "$descricao: o serviço recebeu '$(cat "$pasta/.recebido")'"
  elif [[ -n "$5" ]] && ! grep -qxF "$5" "$saida"; then
    falhou "$descricao: o texto da resposta não chegou ao GitHub"
  elif compgen -G "$pasta/resultado.*" >/dev/null; then
    falhou "$descricao: ficou uma resposta na pasta ($(ls "$pasta"))"
  else
    echo "ok: $descricao"
  fi
}
aceite "publicar: o código 0 e o texto passam ao GitHub" \
  publicar "sha256:$h64" 0 "Publicado: sha256:$h64." 0
aceite "aplicar: o código do serviço passa ao GitHub (3)" \
  aplicar "$h40 mostrar" 3 "falhou o passo 10b" 3
aceite "medir: o pedido vazio é aceite" medir "" 0 "medida" 0
aceite "operar: uma chave bem formada é aceite" \
  operar "chave 01234567-89ab-cdef-0123-456789abcdef catalog:read,keys:write eul_sk_abcde $h64 Nome github:42" 0 "" 0
aceite "um código que não é número dá 70" publicar "sha256:$h64" "ok" "" 70

rm -f "$saida"
((falhas == 0))
