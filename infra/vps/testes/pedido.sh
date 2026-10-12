#!/usr/bin/env bash
# Teste do eurolify-pedido, o comando fixo das chaves dos fluxos do GitHub
# (ADR-0026, ADR-0028; revisão do #110, P2-6, «teste próprio do eurolify-pedido»).
# Ex.: a chave do fluxo «publicar» manda «sha256:<64 hex>;reboot» e o pedido é
# recusado antes de chegar à pasta do serviço da máquina.
#
# Confere: o fluxo desconhecido (64); os pedidos fora do formato e os longos
# demais (65), sem deixar nada na pasta; a mesma expressão e o mesmo limite no
# eurolify-pedido e no eurolify-trabalho, fluxo a fluxo; que o «operar» espera
# mais do que a cópia e o serviço podem durar; de ponta a ponta, com o
# eurolify-trabalho verdadeiro e os programas de cada fluxo de mentira, que o
# pedido chega tal e qual, que o código e o texto voltam ao GitHub e que as
# respostas antigas se apagam; que um pedido só lê a sua própria resposta; e
# que uma resposta com um código que não é número dá 70. Corre como o
# utilizador de cada fluxo, numa pasta dele, como na VPS.
# Não confere (esperas longas, não se mudam para o teste): a tranca ocupada
# (75, ao fim de 60 s) e a falta de resposta (69, ao fim de 120 s ou mais).
# Corre como root num contentor Ubuntu descartável. Nunca correr numa máquina
# a sério.
set -Eeuo pipefail
[[ "${EUROLIFY_TESTE_DESCARTAVEL:-}" == 1 ]] || { echo "só numa máquina descartável (EUROLIFY_TESTE_DESCARTAVEL=1)" >&2; exit 2; }
repo="$(cd "$(dirname "$0")/../../.." && pwd)"
f="$repo/infra/vps/ficheiros"
pedido_sh="$f/bin/eurolify-pedido"
trabalho_sh="$f/sbin/eurolify-trabalho"
falhas=0
falhou() { echo "FALHOU: $*"; falhas=$((falhas + 1)); }

h64="$(printf 'a%.0s' {1..64})"
h40="$(printf 'b%.0s' {1..40})"
nl=$'\n'

# Os caminhos da máquina: o comum.sh, os programas de cada fluxo de mentira
# (dizem com que argumentos foram chamados e respondem o que o teste pedir) e,
# por fluxo, o utilizador e a pasta dele.
install -d /usr/local/lib/eurolify /usr/local/sbin /var/log/eurolify /var/tmp/teste-pedido
install -m 644 "$f/lib/comum.sh" /usr/local/lib/eurolify/comum.sh
for programa in publicar aplicar medir operador; do
  cat >"/usr/local/sbin/eurolify-$programa" <<'FIM'
#!/usr/bin/env bash
printf '%s\n' "$*" >/var/tmp/teste-pedido/chamado
cat /var/tmp/teste-pedido/texto
exit "$(cat /var/tmp/teste-pedido/codigo)"
FIM
  chmod 755 "/usr/local/sbin/eurolify-$programa"
done
for fluxo in publicar aplicar medir operar configurar; do
  id "eurolify-$fluxo" >/dev/null 2>&1 || useradd -r "eurolify-$fluxo"
  install -d -m 700 -o "eurolify-$fluxo" "/var/lib/eurolify/pedidos/$fluxo"
done

# Corre o eurolify-pedido como o sshd o corre, com o utilizador do fluxo.
# Com um limite de 20 s: um pedido aceite por engano ficava à espera de
# resposta (até 1900 s) e o teste parava em vez de falhar; assim dá 124.
saida="$(mktemp)"
chmod 644 "$saida"
pedir() { # pedir <fluxo> <pedido>
  local codigo=0 quem="eurolify-$1"
  id "$quem" >/dev/null 2>&1 || quem=eurolify-medir
  runuser -u "$quem" -- env SSH_ORIGINAL_COMMAND="$2" timeout 20 bash "$pedido_sh" "$1" >"$saida" 2>&1 || codigo=$?
  return "$codigo"
}

# 1. O que tem de ser igual nas duas camadas.
padrao_de() { # padrao_de <ficheiro> <fluxo>
  awk -v f="$2" '
    $0 ~ "^ *" f "\\)" { dentro = 1 }
    dentro && match($0, /padrao=\x27[^\x27]*\x27/) {
      print substr($0, RSTART + 8, RLENGTH - 9); exit
    }' "$1"
}
for fluxo in publicar aplicar medir operar configurar; do
  a="$(padrao_de "$pedido_sh" "$fluxo")"
  b="$(padrao_de "$trabalho_sh" "$fluxo")"
  if [[ -n "$a" && "$a" == "$b" ]]; then
    echo "ok: $fluxo: a mesma expressão no eurolify-pedido e no eurolify-trabalho"
  else
    falhou "$fluxo: as expressões diferem ('$a' / '$b')"
  fi
done
# O limite de tamanho de cada fluxo com pedidos longos, nas duas camadas.
maximo_de() { # maximo_de <fluxo>: o maximo= do bloco do fluxo no eurolify-pedido
  awk -v f="$1" '
    $0 ~ "^ *" f "\\)" { dentro = 1 }
    dentro && match($0, /^ *maximo=[0-9]+/) {
      sub(/^ *maximo=/, ""); print; exit
    }
    dentro && /;;/ { exit }' "$pedido_sh"
}
for fluxo in operar configurar; do
  maximo="$(maximo_de "$fluxo")"
  limite="$(grep -oE "$fluxo \]\] && limite=[0-9]+" "$trabalho_sh" | grep -oE '[0-9]+$')"
  if [[ -n "$maximo" && "$maximo" == "$limite" ]]; then
    echo "ok: $fluxo: o mesmo limite de tamanho nas duas camadas ($maximo)"
  else
    falhou "$fluxo: limites diferentes ('$maximo' / '$limite')"
  fi
done
copia="$(grep -oE '^TimeoutStartSec=[0-9]+' "$f/systemd/eurolify-copia.service" | cut -d= -f2)"
servico="$(grep -oE '^TimeoutStartSec=[0-9]+' "$f/systemd/eurolify-pedido@.service" | cut -d= -f2)"
# O operar espera pela cópia; o configurar pela recriação da API, que pode
# esperar por uma publicação (revisão do #398, P3-1).
for fluxo in operar configurar; do
  espera="$(awk -v f="$fluxo" '$0 ~ "^ *" f "\\)" { d = 1 } d && /espera=/ { sub(/.*espera=/, ""); print; exit }' "$pedido_sh")"
  if [[ -n "$espera" && -n "$copia" && -n "$servico" ]] && ((espera > copia && espera > servico)); then
    echo "ok: $fluxo: espera mais ($espera s) do que a cópia ($copia s) e o serviço ($servico s)"
  else
    falhou "$fluxo: espera $espera s, cópia $copia s, serviço $servico s (revisão do #110, P2-2)"
  fi
done

# 2. Fluxo desconhecido. O «mcp» existe no serviço da máquina, mas não tem
# chave SSH: o eurolify-pedido não o aceita.
for fluxo in mcp "" "../publicar"; do
  codigo=0; pedir "$fluxo" "medir" || codigo=$?
  if [[ $codigo == 64 ]]; then echo "ok: fluxo '$fluxo' recusado (64)"; else falhou "fluxo '$fluxo' deu $codigo, não 64"; fi
done

# 3. Pedidos fora do formato ou longos demais: 65, e a pasta fica vazia. O
# fuso do «comerciante» não tem tamanho máximo na expressão: só o limite o
# trava.
fuso_longo="Europe/$(printf 'L%.0s' {1..600})"
recusados=(
  "publicar|sha256:abc"
  "publicar|sha256:$h64;reboot"
  "publicar|sha256:$h64${nl}reboot"
  "publicar|SHA256:$h64"
  "aplicar|$h40 apagar"
  "aplicar|$h40 aplicar extra"
  "medir|x"
  "medir| "
  "operar|comerciante pt Europe/Lisbon Loja run:1 github:1;reboot"
  "operar|comerciante pt Europe/Lisbon Loja"
  # Tudo certo menos o número da execução (#107; revisão do #293, P3-2).
  "operar|comerciante pt Europe/Lisbon Loja github:1"
  "operar|chave 0 catalog:read eul_sk_abcde $h64 Nome github:1"
  "operar|comerciante pt $fuso_longo Loja run:1 github:1"
  # O configurar (revisão do #398, P3-2): sem a execução, com «;», com uma
  # mudança de linha, e longo demais.
  "configurar|smtp YWJj"
  "configurar|smtp YWJj run:1 github:1;reboot"
  "configurar|smtp YWJj${nl}run:1 github:1"
  "configurar|smtp $(printf 'A%.0s' {1..1500}) run:1 github:1"
)
for caso in "${recusados[@]}"; do
  fluxo="${caso%%|*}"; texto="${caso#*|}"; mostrar="${texto//$nl/\\n}"
  rm -f "/var/lib/eurolify/pedidos/$fluxo/pedido"
  codigo=0; pedir "$fluxo" "$texto" || codigo=$?
  if [[ $codigo != 65 ]]; then
    falhou "$fluxo: '${mostrar:0:80}' deu $codigo, não 65"
  elif [[ -e "/var/lib/eurolify/pedidos/$fluxo/pedido" ]]; then
    falhou "$fluxo: '${mostrar:0:80}' recusado, mas deixou o pedido na pasta"
  else
    echo "ok: $fluxo: '${mostrar:0:80}' recusado (65)"
  fi
done

# 4. De ponta a ponta: o eurolify-trabalho verdadeiro responde, como o
# eurolify-pedido@<fluxo>.path o lançaria. Com «alheia», antes de o tratar
# deixa na pasta a resposta de outro pedido, com o código 9.
servir() { # servir <fluxo> [alheia]
  local pasta="/var/lib/eurolify/pedidos/$1" i
  for ((i = 0; i < 100; i++)); do [[ -f "$pasta/pedido" ]] && break; sleep 0.1; done
  [[ -f "$pasta/pedido" ]] || return 0
  if [[ "${2:-}" == alheia ]]; then
    printf '9\nresposta de outro pedido\n' >"$pasta/resultado.11111111111"
    chown "eurolify-$1:" "$pasta/resultado.11111111111"
  fi
  bash "$trabalho_sh" "$1" >/dev/null 2>&1 || true
}
aceite() { # aceite <descrição> <fluxo> <pedido> <código> <texto> <chamado com> [alheia]
  local descricao="$1" fluxo="$2" texto="$3" codigo=0 pasta="/var/lib/eurolify/pedidos/$2"
  rm -f /var/tmp/teste-pedido/chamado
  printf '%s\n' "$4" >/var/tmp/teste-pedido/codigo
  printf '%s' "$5" >/var/tmp/teste-pedido/texto
  : >"$pasta/resultado.antigo"
  servir "$fluxo" "${7:-}" &
  pedir "$fluxo" "$texto" || codigo=$?
  wait
  if [[ $codigo != "$4" ]]; then
    falhou "$descricao: deu $codigo, não $4 ($(tr '\n' ' ' <"$saida"))"
  elif [[ "$(cat /var/tmp/teste-pedido/chamado 2>/dev/null)" != "$6" ]]; then
    falhou "$descricao: o programa do fluxo foi chamado com '$(cat /var/tmp/teste-pedido/chamado 2>/dev/null)'"
  elif [[ -n "$5" ]] && ! grep -qxF "$5" "$saida"; then
    falhou "$descricao: o texto da resposta não chegou ao GitHub"
  elif [[ -e "$pasta/resultado.antigo" ]]; then
    falhou "$descricao: a resposta antiga não foi apagada"
  elif [[ "${7:-}" == alheia && ! -f "$pasta/resultado.11111111111" ]]; then
    falhou "$descricao: apagou a resposta de outro pedido"
  else
    rm -f "$pasta/resultado.11111111111"
    if compgen -G "$pasta/resultado.*" >/dev/null; then
      falhou "$descricao: ficou uma resposta na pasta ($(ls "$pasta"))"
    else
      echo "ok: $descricao"
    fi
  fi
  rm -f "$pasta/resultado.11111111111"
}
aceite "publicar: o código 0 e o texto passam ao GitHub" \
  publicar "sha256:$h64" 0 "Publicado: sha256:$h64." "sha256:$h64"
aceite "aplicar: o código do programa passa ao GitHub (3)" \
  aplicar "$h40 mostrar" 3 "falhou o passo 10b" "$h40 mostrar"
aceite "medir: o pedido vazio é aceite" medir "" 0 "medida" ""
chave="chave 01234567-89ab-cdef-0123-456789abcdef catalog:read,keys:write eul_sk_abcde $h64 Nome github:42"
aceite "operar: uma chave bem formada chega ao eurolify-operador" operar "$chave" 0 "" "$chave"
aceite "um pedido só lê a sua resposta, não a de outro que ficou na pasta" \
  publicar "sha256:$h64" 4 "a minha resposta" "sha256:$h64" alheia

# 5. Uma resposta com um código que não é número dá 70. O eurolify-trabalho
# escreve sempre um número: este caso escreve a resposta à mão.
pasta=/var/lib/eurolify/pedidos/publicar
(
  for ((i = 0; i < 100; i++)); do [[ -f "$pasta/pedido" ]] && break; sleep 0.1; done
  id="$(sed -n 2p "$pasta/pedido")"
  rm -f "$pasta/pedido"
  printf 'ok\n' >"$pasta/resultado.$id"
  chown eurolify-publicar: "$pasta/resultado.$id"
) &
codigo=0; pedir publicar "sha256:$h64" || codigo=$?
wait
if [[ $codigo == 70 ]]; then echo "ok: um código que não é número dá 70"; else falhou "um código que não é número deu $codigo, não 70"; fi

rm -f "$saida"
((falhas == 0))
