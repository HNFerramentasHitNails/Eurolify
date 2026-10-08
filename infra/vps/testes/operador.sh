#!/usr/bin/env bash
# Teste do eurolify-operador (docs/19 §6) e das três camadas do fluxo «operar»
# (revisão do #110, P2-6): o formato é o mesmo no eurolify-pedido, no
# eurolify-trabalho e no eurolify-operador; sem cópia desta execução não se
# escreve; uma imagem sem o comando é recusada antes da cópia. Corre como root
# num contentor Ubuntu descartável, com systemctl e docker de mentira.
set -Eeuo pipefail
[[ "${EUROLIFY_TESTE_DESCARTAVEL:-}" == 1 ]] || { echo "só numa máquina descartável (EUROLIFY_TESTE_DESCARTAVEL=1)" >&2; exit 2; }
repo="$(cd "$(dirname "$0")/../../.." && pwd)"
f="$repo/infra/vps/ficheiros"
falhas=0
falhou() { echo "FALHOU: $*"; falhas=$((falhas + 1)); }

# 1. A mesma expressão nas três camadas.
padrao_de() { grep -m1 -oE "padrao='\^\(comerciante [^']+'" "$1" | sed "s/^padrao=//"; }
a="$(padrao_de "$f/bin/eurolify-pedido")"
b="$(padrao_de "$f/sbin/eurolify-trabalho")"
c="$(padrao_de "$f/sbin/eurolify-operador")"
if [[ -n "$a" && "$a" == "$b" && "$b" == "$c" ]]; then
  echo "ok: a mesma expressão nas três camadas"
else
  falhou "as expressões do fluxo operar não são iguais nas três camadas"
fi

# 2. O eurolify-operador com systemctl e docker de mentira.
falsos="$(mktemp -d)"
install -d /usr/local/lib/eurolify /etc/eurolify /var/log/eurolify
install -m 644 "$f/lib/comum.sh" /usr/local/lib/eurolify/comum.sh
[[ -f /etc/eurolify/migrar.env ]] || : >/etc/eurolify/migrar.env
cat >"$falsos/docker" <<'FIM'
#!/usr/bin/env bash
echo "docker $*" >>"$FALSOS/docker-chamado"
case "$1" in
  inspect) echo "ghcr.io/eurolify/api@sha256:abc" ;;
  run)
    if [[ " $* " == *" --entrypoint test "* ]]; then exit "${SEM_COMANDO:-0}"; fi
    if [[ " $* " == *" --entrypoint grep "* ]]; then exit "${SEM_CONVITE:-0}"; fi
    echo '{"comerciante":"mer_x"}' ;;
esac
FIM
cat >"$falsos/systemctl" <<'FIM'
#!/usr/bin/env bash
case "$1" in
  start) echo copia >>"$FALSOS/copia-chamada"; exit "${COPIA_FALHA:-0}" ;;
  show)
    case "$*" in
      *Result*) if [[ "${COPIA_FALHA:-0}" == 0 ]]; then echo success; else echo exit-code; fi ;;
      *ExecMainExitTimestamp*)
        if [[ "${COPIA_ANTIGA:-0}" == 1 ]]; then date -d '-1 day' '+%a %Y-%m-%d %H:%M:%S %Z'
        else date -d '+1 sec' '+%a %Y-%m-%d %H:%M:%S %Z'; fi ;;
    esac ;;
esac
FIM
chmod 755 "$falsos/docker" "$falsos/systemctl"
export PATH="$falsos:$PATH" FALSOS="$falsos"
nome="$(printf '%s' 'Loja de Ensaio' | basenc --base64url -w0 | tr -d '=')"
pedido="comerciante pt Europe/Lisbon $nome github:1001"

escreveu() { grep -q "node dist/operador.js" "$falsos/docker-chamado" 2>/dev/null; }
caso() { # caso <descrição> <escreve: sim|nao> [VAR=valor…]
  local descricao="$1" espera="$2"; shift 2
  rm -f "$falsos/docker-chamado" "$falsos/copia-chamada"
  env "$@" bash "$f/sbin/eurolify-operador" "$pedido" >/dev/null 2>&1 || true
  if escreveu; then
    if [[ "$espera" == sim ]]; then echo "ok: $descricao"; else falhou "$descricao: escreveu"; fi
  else
    if [[ "$espera" == nao ]]; then echo "ok: $descricao"; else falhou "$descricao: não escreveu"; fi
  fi
}
caso "com cópia desta execução, escreve" sim
caso "a cópia falha: não escreve" nao COPIA_FALHA=1
caso "só há a cópia de ontem: não escreve" nao COPIA_ANTIGA=1
caso "a imagem não tem o comando: não escreve" nao SEM_COMANDO=1
if [[ ! -f "$falsos/copia-chamada" ]]; then
  echo "ok: sem o comando, nem chega a fazer a cópia"
else
  falhou "sem o comando, fez a cópia na mesma"
fi
if bash "$f/sbin/eurolify-operador" "$pedido;reboot" >/dev/null 2>&1; then
  falhou "aceitou um pedido fora do formato"
else
  echo "ok: recusa um pedido fora do formato"
fi
# O convite do primeiro dono (docs/19 §6.0) passa pelo mesmo caminho.
email="$(printf '%s' 'dono@loja.test' | basenc --base64url -w0 | tr -d '=')"
pedido="convite 0199b1c2-3d4e-7f00-8a9b-0c1d2e3f4a5b $email dono $(printf 'a%.0s' {1..64}) github:1001"
caso "um convite com cópia desta execução, escreve" sim
caso "um convite sem cópia: não escreve" nao COPIA_FALHA=1
rm -f "$falsos/copia-chamada"
caso "uma imagem sem o convite: não escreve" nao SEM_CONVITE=1
if [[ ! -f "$falsos/copia-chamada" ]]; then
  echo "ok: sem o convite na imagem, nem chega a fazer a cópia"
else
  falhou "sem o convite na imagem, fez a cópia na mesma"
fi
if bash "$f/sbin/eurolify-operador" "${pedido/dono a/gestor a}" >/dev/null 2>&1; then
  falhou "aceitou um convite que não é de dono"
else
  echo "ok: recusa um convite que não é de dono"
fi
if grep -q "$email" /var/log/eurolify/acoes.log; then falhou "o e-mail foi para o registo"; else echo "ok: o e-mail não vai para o registo"; fi
if grep -q "github:1001" /var/log/eurolify/acoes.log; then echo "ok: quem lançou fica no registo"; else falhou "o número da conta não ficou no registo"; fi
if grep -q "$nome" /var/log/eurolify/acoes.log; then falhou "o nome foi para o registo"; else echo "ok: o nome não vai para o registo"; fi
rm -f "$falsos/docker" "$falsos/systemctl" "$falsos/docker-chamado" "$falsos/copia-chamada"
rmdir "$falsos"
((falhas == 0))
