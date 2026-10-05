#!/usr/bin/env bash
# Teste do eurolify-trabalho no fluxo «mcp»: a conta de quem pede (revisão do
# #102, P2-2). Corre como root num contentor Ubuntu descartável (fluxo
# verificar, trabalho script-vps); instala o comum.sh e um eurolify-operar
# de mentira nos caminhos da máquina. Nunca correr numa máquina a sério.
set -Eeuo pipefail
[[ "${EUROLIFY_TESTE_DESCARTAVEL:-}" == 1 ]] || { echo "só numa máquina descartável (EUROLIFY_TESTE_DESCARTAVEL=1)" >&2; exit 2; }
repo="$(cd "$(dirname "$0")/../../.." && pwd)"

install -d /usr/local/lib/eurolify /usr/local/sbin
install -m 644 "$repo/infra/vps/ficheiros/lib/comum.sh" /usr/local/lib/eurolify/comum.sh
cat >/usr/local/sbin/eurolify-operar <<'FIM'
#!/usr/bin/env bash
source /usr/local/lib/eurolify/comum.sh
echo "operar $1"
registar "mcp: «$1» feito"
FIM
chmod 755 /usr/local/sbin/eurolify-operar
id eurolify-mcp >/dev/null 2>&1 || useradd -r eurolify-mcp
pasta=/var/lib/eurolify/pedidos/mcp
install -d "$pasta" /var/log/eurolify
registo=/var/log/eurolify/acoes.log

falhas=0
caso() { # caso <conta> <código esperado> <origem esperada no registo, ou vazio>
  local conta="$1" esperado="$2" origem="$3" codigo
  : >"$registo" 2>/dev/null || true
  printf 'medir\n12345678901\n%s\n' "$conta" >"$pasta/pedido"
  bash "$repo/infra/vps/ficheiros/sbin/eurolify-trabalho" mcp || true
  codigo="$(head -n 1 "$pasta/resultado.12345678901")"
  rm -f "$pasta"/resultado.*
  if [[ "$codigo" != "$esperado" ]]; then
    echo "FALHOU conta=«$conta»: código $codigo, esperado $esperado"; falhas=$((falhas + 1))
  elif [[ -n "$origem" ]] && ! grep -q "| $origem | mcp: «medir» feito" "$registo"; then
    echo "FALHOU conta=«$conta»: origem «$origem» não está no registo"; cat "$registo"; falhas=$((falhas + 1))
  elif [[ -z "$origem" ]] && grep -q "medir» feito" "$registo"; then
    echo "FALHOU conta=«$conta»: o pedido recusado chegou ao operar"; falhas=$((falhas + 1))
  else
    echo "ok conta=«$conta» → $codigo"
  fi
}

caso 1001 0 "mcp, conta 1001"
caso "" 0 "mcp, conta não indicada"
caso "ana" 65 ""
caso "1001;reboot" 65 ""
caso "123456789012345678901" 65 ""
((falhas == 0))
