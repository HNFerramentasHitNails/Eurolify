#!/usr/bin/env bash
# Teste do eurolify-publicar (tarefa #113 e revisão do #115): antes de migrar,
# compara as migrações da imagem com as da base. Base à frente e nada em
# falta → não migra e regista o aviso; à frente e com falta → recusa; de
# resto migra. E a volta automática quando o /health falha não migra. Corre
# como root num contentor Ubuntu descartável, com docker, curl e sleep de
# mentira.
set -Eeuo pipefail
[[ "${EUROLIFY_TESTE_DESCARTAVEL:-}" == 1 ]] || { echo "só numa máquina descartável (EUROLIFY_TESTE_DESCARTAVEL=1)" >&2; exit 2; }
repo="$(cd "$(dirname "$0")/../../.." && pwd)"
f="$repo/infra/vps/ficheiros"
falhas=0
falhou() { echo "FALHOU: $*"; falhas=$((falhas + 1)); }

repo_img="ghcr.io/eurolify/eurolify-api"
no_ar="$repo_img@sha256:$(printf '%064d' 1)"
nova="sha256:$(printf '%064d' 2)"
install -d /usr/local/lib/eurolify /etc/eurolify /var/log/eurolify
install -m 644 "$f/lib/comum.sh" /usr/local/lib/eurolify/comum.sh
printf 'IMAGEM_REPO=%s\nGHCR_UTILIZADOR=ensaio\nBASE_NOME=eurolify\n' "$repo_img" >/etc/eurolify/ensaio.conf
echo token >/etc/eurolify/ghcr.token
: >/etc/eurolify/migrar.env
: >/etc/eurolify/api.env

falsos="$(mktemp -d)"
# docker de mentira: a lista de migrações da imagem vem de $FALSOS/imagem
# (sem o ficheiro, o ls falha); as da base, de $FALSOS/base; TABELA=f faz de
# base sem a tabela do migrador; BASE_EM_BAIXO=1 faz o psql falhar.
cat >"$falsos/docker" <<'FALSO'
#!/usr/bin/env bash
echo "docker $*" >>"$FALSOS/docker-chamado"
case "$1" in
  inspect) cat "$FALSOS/no-ar" ;;
  exec)
    [[ "${BASE_EM_BAIXO:-0}" == 0 ]] || exit 2
    if [[ "$*" == *to_regclass* ]]; then echo "${TABELA:-t}"; else cat "$FALSOS/base"; fi ;;
  run)
    if [[ " $* " == *" --entrypoint ls "* ]]; then
      [[ -f "$FALSOS/imagem" ]] || exit 2
      sed 's/$/.sql/' "$FALSOS/imagem"
    elif [[ " $* " == *" -d "* ]]; then
      echo "${*: -1}" >"$FALSOS/no-ar"
    fi ;;
esac
exit 0
FALSO
cat >"$falsos/curl" <<'FALSO'
#!/usr/bin/env bash
exit "${CURL_FALHA:-0}"
FALSO
printf '#!/usr/bin/env bash\nexit 0\n' >"$falsos/sleep"
chmod 755 "$falsos/docker" "$falsos/curl" "$falsos/sleep"
export PATH="$falsos:$PATH" FALSOS="$falsos"

# caso <descrição> <migracoes da imagem|-> <migracoes da base> [VAR=valor…]
# Listas separadas por espaços; «-» = a imagem sem a pasta das migrações.
caso() {
  local descricao="$1" imagem="$2" base="$3"; shift 3
  rm -f "$falsos/docker-chamado" "$falsos/imagem" /var/log/eurolify/acoes.log
  echo "$no_ar" >"$falsos/no-ar"
  [[ "$imagem" == - ]] || tr ' ' '\n' <<<"$imagem" >"$falsos/imagem"
  tr ' ' '\n' <<<"$base" >"$falsos/base"
  codigo=0
  env "$@" bash "$f/sbin/eurolify-publicar" "$nova" >"$falsos/saida" 2>&1 || codigo=$?
  echo "== $descricao (código $codigo)"
}
migrou() { grep -q "node dist/migrar.js" "$falsos/docker-chamado"; }
arrancou_a_nova() { grep -q -- "-d .*@$nova\$" "$falsos/docker-chamado"; }
no_registo() { grep -qF -- "$1" /var/log/eurolify/acoes.log 2>/dev/null; }
confere() { # confere <sim|nao> <o que se espera> <condição…>
  local espera="$1" texto="$2"; shift 2
  local obtido=nao
  if "$@"; then obtido=sim; fi
  if [[ "$obtido" == "$espera" ]]; then echo "ok: $texto"; else falhou "$texto"; fi
}

caso "imagem nova, com uma migração que falta à base" "0001_a 0002_b 0003_c" "0001_a 0002_b"
confere sim "migra" migrou
confere sim "arranca" arrancou_a_nova
confere nao "não avisa" no_registo AVISO

caso "a base tem as mesmas migrações que a imagem" "0001_a 0002_b" "0001_a 0002_b"
confere sim "migra (o migrador não faz nada)" migrou
confere nao "não avisa" no_registo AVISO

caso "voltar atrás: a base tem uma que a imagem não conhece" "0001_a 0002_b" "0001_a 0002_b 0003_c"
confere nao "não migra" migrou
confere sim "arranca" arrancou_a_nova
confere sim "regista o aviso com a lista" no_registo "não conhece (0003_c)"

caso "base e imagem divergem" "0001_a 0002_b 0004_d" "0001_a 0002_b 0003_c"
confere nao "não migra" migrou
confere nao "não arranca" arrancou_a_nova
if ((codigo != 0)); then echo "ok: termina com erro"; else falhou "terminou sem erro"; fi
confere sim "regista a recusa" no_registo "recusada"

caso "base nova, sem a tabela do migrador" "0001_a" "" TABELA=f
confere sim "migra" migrou

caso "não se lê a lista da imagem" - "0001_a 0002_b 0003_c"
confere sim "migra como antes (o migrador decide)" migrou

caso "não se lê a base" "0001_a 0002_b" "" BASE_EM_BAIXO=1
confere sim "migra como antes (o migrador decide)" migrou

caso "o /health falha depois de migrar" "0001_a 0002_b 0003_c" "0001_a 0002_b" CURL_FALHA=1
confere sim "migrou a nova" migrou
if grep -q -- "-d .*@$nova\$" "$falsos/docker-chamado" && [[ "$(cat "$falsos/no-ar")" == "$no_ar" ]]; then
  echo "ok: volta à anterior"
else
  falhou "não voltou à anterior"
fi
if [[ "$(grep -c "node dist/migrar.js" "$falsos/docker-chamado")" == 1 ]]; then
  echo "ok: a volta não migra"
else
  falhou "a volta migrou"
fi

rm -rf "$falsos"
((falhas == 0))
