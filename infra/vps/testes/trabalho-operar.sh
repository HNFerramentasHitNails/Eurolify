#!/usr/bin/env bash
# Teste do eurolify-trabalho no fluxo «operar» (comando do operador,
# docs/19 §6): o formato do pedido na máquina. Corre como root num contentor
# Ubuntu descartável (fluxo verificar); um eurolify-operador de mentira
# regista o que recebe. Nunca correr numa máquina a sério.
set -Eeuo pipefail
[[ "${EUROLIFY_TESTE_DESCARTAVEL:-}" == 1 ]] || { echo "só numa máquina descartável (EUROLIFY_TESTE_DESCARTAVEL=1)" >&2; exit 2; }
repo="$(cd "$(dirname "$0")/../../.." && pwd)"

install -d /usr/local/lib/eurolify /usr/local/sbin
install -m 644 "$repo/infra/vps/ficheiros/lib/comum.sh" /usr/local/lib/eurolify/comum.sh
cat >/usr/local/sbin/eurolify-operador <<'FIM'
#!/usr/bin/env bash
echo "operador recebeu: ${1%% *}"
printf '%s\n' "$1" >>/tmp/operador-recebeu
FIM
chmod 755 /usr/local/sbin/eurolify-operador
id eurolify-operar >/dev/null 2>&1 || useradd -r eurolify-operar
pasta=/var/lib/eurolify/pedidos/operar
install -d "$pasta" /var/log/eurolify
: >/tmp/operador-recebeu

nome="$(printf '%s' 'Loja de Ensaio' | basenc --base64url -w0 | tr -d '=')"
uuid=0199b1c2-3d4e-7f00-8a9b-0c1d2e3f4a5b
resumo="$(printf 'a%.0s' {1..64})"

falhas=0
caso() { # caso <pedido> <código esperado>
  local pedido="$1" esperado="$2" codigo
  printf '%s\n12345678901\n' "$pedido" >"$pasta/pedido"
  bash "$repo/infra/vps/ficheiros/sbin/eurolify-trabalho" operar || true
  codigo="$(head -n 1 "$pasta/resultado.12345678901")"
  rm -f "$pasta"/resultado.*
  if [[ "$codigo" != "$esperado" ]]; then
    echo "FALHOU «${pedido:0:60}»: código $codigo, esperado $esperado"
    falhas=$((falhas + 1))
  else
    echo "ok «${pedido:0:40}…» → $codigo"
  fi
}

caso "comerciante pt Europe/Lisbon $nome github:1001" 0
caso "chave $uuid keys:write,catalog:read eul_sk_abcde $resumo $nome github:1001" 0
caso "comerciante pt Europe/Lisbon $nome github:1001;reboot" 65
caso "comerciante pt Europe/Lisbon Loja de Ensaio github:1001" 65
caso "chave $uuid keys:write eul_sk_abcde eul_sk_segredo $nome github:1001" 65
caso "chave $uuid keys:write eul_pk_abcde $resumo $nome github:1001" 65
caso "apagar tudo" 65
# Só os dois válidos chegaram ao operador, e o registo não leva o nome.
[[ "$(wc -l </tmp/operador-recebeu)" -eq 2 ]] || { echo "FALHOU: o operador recebeu $(wc -l </tmp/operador-recebeu) pedidos, não 2"; falhas=$((falhas + 1)); }
if grep -q "$nome" /var/log/eurolify/acoes.log; then
  echo "FALHOU: o nome do comerciante foi para o registo"; falhas=$((falhas + 1))
fi
((falhas == 0))
