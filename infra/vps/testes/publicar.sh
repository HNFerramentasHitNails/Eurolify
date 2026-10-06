#!/usr/bin/env bash
# Teste do eurolify-publicar e da acção «publicar» do eurolify-operar (tarefa
# #113; revisões do #115). Antes de migrar compara-se a base com a imagem: se
# a base tem migrações que a imagem não conhece, só se volta à publicação
# imediatamente anterior à que está no ar, e só se a que está no ar as
# conhece; de resto migra-se como sempre. Corre como root num contentor Ubuntu
# descartável, com docker, curl, sleep e systemd-run de mentira.
set -Eeuo pipefail
[[ "${EUROLIFY_TESTE_DESCARTAVEL:-}" == 1 ]] || { echo "só numa máquina descartável (EUROLIFY_TESTE_DESCARTAVEL=1)" >&2; exit 2; }
repo="$(cd "$(dirname "$0")/../../.." && pwd)"
f="$repo/infra/vps/ficheiros"
falhas=0
falhou() { echo "FALHOU: $*"; falhas=$((falhas + 1)); }

repo_img="ghcr.io/eurolify/eurolify-api"
r() { printf 'sha256:%064d' "$1"; } # resumo da imagem n
img() { echo "$repo_img@$(r "$1")"; }
install -d /usr/local/lib/eurolify /etc/eurolify /var/log/eurolify
install -m 644 "$f/lib/comum.sh" /usr/local/lib/eurolify/comum.sh
printf 'IMAGEM_REPO=%s\nGHCR_UTILIZADOR=ensaio\nBASE_NOME=eurolify\n' "$repo_img" >/etc/eurolify/ensaio.conf
echo token >/etc/eurolify/ghcr.token
: >/etc/eurolify/migrar.env
: >/etc/eurolify/api.env

falsos="$(mktemp -d)"
# docker de mentira. A saída do «ls» da pasta das migrações da imagem n vem
# de $FALSOS/ls-n (sem o ficheiro, o ls falha); $FALSOS/sem-migrador-n faz de
# imagem sem dist/migrar.js. As migrações da base vêm de $FALSOS/base;
# TABELA=f faz de base sem a tabela do migrador; BASE_EM_BAIXO=1 faz o psql
# falhar.
cat >"$falsos/docker" <<'FALSO'
#!/usr/bin/env bash
echo "docker $*" >>"$FALSOS/docker-chamado"
n_de() { local x="${1##*:}"; echo $((10#$x)); }
case "$1" in
  inspect) cat "$FALSOS/no-ar" ;;
  exec)
    [[ "${BASE_EM_BAIXO:-0}" == 0 ]] || exit 2
    if [[ "$*" == *to_regclass* ]]; then echo "${TABELA:-t}"; else cat "$FALSOS/base"; fi ;;
  run)
    args=("$@")
    for ((i = 0; i < ${#args[@]}; i++)); do
      if [[ "${args[i]}" == --entrypoint ]]; then
        cmd="${args[i + 1]}" n="$(n_de "${args[i + 2]}")"
        if [[ "$cmd" == ls ]]; then
          [[ -f "$FALSOS/ls-$n" ]] || exit 2
          cat "$FALSOS/ls-$n"
        elif [[ "$cmd" == test && "${args[*]}" == *dist/migrar.js* ]]; then
          [[ ! -f "$FALSOS/sem-migrador-$n" ]] || exit 1
        fi
        exit 0
      fi
    done
    if [[ " $* " == *" -d "* ]]; then echo "${*: -1}" >"$FALSOS/no-ar"; fi ;;
esac
exit 0
FALSO
cat >"$falsos/curl" <<'FALSO'
#!/usr/bin/env bash
exit "${CURL_FALHA:-0}"
FALSO
printf '#!/usr/bin/env bash\nexit 0\n' >"$falsos/sleep"
cat >"$falsos/systemd-run" <<'FALSO'
#!/usr/bin/env bash
echo "systemd-run $*" >>"$FALSOS/systemd-run-chamado"
FALSO
chmod 755 "$falsos/docker" "$falsos/curl" "$falsos/sleep" "$falsos/systemd-run"
export PATH="$falsos:$PATH" FALSOS="$falsos"

# Antes de cada caso: publicadas 1, depois 2, depois 3, que está no ar.
# As imagens conhecem: 1 → a; 2 → a b; 3 → a b c.
preparar() {
  rm -f "$falsos"/ls-* "$falsos"/sem-migrador-* "$falsos/docker-chamado" "$falsos/systemd-run-chamado" /var/log/eurolify/acoes.log
  cat >/var/log/eurolify/publicacoes.log <<REG
2026-10-01T10:00:00Z | $(r 1) | anterior: nenhuma
2026-10-02T10:00:00Z | $(r 2) | anterior: $(img 1)
2026-10-03T10:00:00Z | $(r 3) | anterior: $(img 2)
REG
  img 3 >"$falsos/no-ar"
  printf '0001_a.sql\n' >"$falsos/ls-1"
  printf '0001_a.sql\n0002_b.sql\n' >"$falsos/ls-2"
  printf '0001_a.sql\n0002_b.sql\n0003_c.sql\n' >"$falsos/ls-3"
  printf '0001_a\n0002_b\n0003_c\n' >"$falsos/base"
}
# caso <descrição> <n da imagem a publicar> [VAR=valor…]
caso() {
  local descricao="$1" n="$2"; shift 2
  codigo=0
  env "$@" bash "$f/sbin/eurolify-publicar" "$(r "$n")" >"$falsos/saida" 2>&1 || codigo=$?
  echo "== $descricao (código $codigo)"
}
migrou() { grep -q "node dist/migrar.js" "$falsos/docker-chamado"; }
arrancou() { grep -q -- "-d .*@$(r "$1")\$" "$falsos/docker-chamado"; }
no_registo() { grep -qF -- "$1" /var/log/eurolify/acoes.log 2>/dev/null; }
na_saida() { grep -qF -- "$1" "$falsos/saida"; }
linha_na_saida() { grep -qxF -- "$1" "$falsos/saida"; }
erro() { ((codigo != 0)); }
confere() { # confere <sim|nao> <o que se espera> <condição…>
  local espera="$1" texto="$2" obtido=nao
  shift 2
  if "$@"; then obtido=sim; fi
  if [[ "$obtido" == "$espera" ]]; then echo "ok: $texto"; else falhou "$texto"; fi
}

preparar
printf '0001_a.sql\n0002_b.sql\n0003_c.sql\n0004_d.sql\n' >"$falsos/ls-4"
caso "imagem nova, com uma migração que falta à base" 4
confere sim "migra" migrou
confere sim "arranca" arrancou 4

preparar
cp "$falsos/ls-3" "$falsos/ls-4"
caso "a base tem as mesmas migrações que a imagem" 4
confere sim "migra (o migrador não faz nada)" migrou

preparar
caso "voltar à imediatamente anterior" 2
confere nao "não migra" migrou
confere sim "arranca" arrancou 2
confere sim "regista a volta com a lista" no_registo "não conhece (0003_c)"

preparar
printf '0003_c\n0001_a\n0002_b\n' >"$falsos/base"
caso "voltar à imediatamente anterior, com a base fora de ordem" 2
confere nao "não migra" migrou
confere sim "arranca" arrancou 2

preparar
caso "voltar mais atrás (decisão A)" 1
confere nao "não migra" migrou
confere nao "não arranca" arrancou 1
confere sim "termina com erro" erro
confere sim "regista a recusa" no_registo "não é a publicação imediatamente anterior"

preparar
printf '0001_a\n0002_b\n0003_c\n0004_d\n' >"$falsos/base"
caso "voltar à anterior com a base à frente da que está no ar" 2
confere nao "não arranca" arrancou 2
confere sim "regista a recusa" no_registo "nem a versão no ar conhece (0004_d)"

preparar
printf '0001_a.sql\n0002_b.sql\n0004_d.sql\n' >"$falsos/ls-4"
caso "base e imagem divergem" 4
confere nao "não migra" migrou
confere nao "não arranca" arrancou 4
confere sim "regista a recusa" no_registo "faltam-lhe outras (0004_d)"

preparar
printf '0001_a.sql\n0002_b.sql\nLEIA-ME.md\nantigas\n0003_Mau.sql\n' >"$falsos/ls-4"
printf '0001_a\n0002_b\nx | injectado\n' >"$falsos/base"
caso "nomes fora da forma, na imagem e na base" 4
confere sim "ignora-os e migra" migrou
confere nao "não chegam ao registo" no_registo "injectado"

preparar
cp "$falsos/ls-1" "$falsos/ls-4"
caso "base nova, sem a tabela do migrador" 4 TABELA=f
confere sim "migra" migrou

preparar
caso "não se lê a lista da imagem" 4
confere sim "migra como sempre (o migrador decide)" migrou
confere sim "diz que não comparou" na_saida "Não se comparou"

preparar
cp "$falsos/ls-3" "$falsos/ls-4"
caso "a base não responde" 4 BASE_EM_BAIXO=1
confere sim "migra como sempre (o migrador decide)" migrou
confere sim "diz que não comparou" na_saida "Não se comparou"

preparar
touch "$falsos/sem-migrador-2"
caso "voltar à anterior, que não tem o migrador" 2
confere nao "não migra" migrou
confere sim "arranca (a que está no ar conhece as da base)" arrancou 2
confere sim "regista a volta" no_registo "volta a $(r 2)"

preparar
printf '0001_a.sql\n0002_b.sql\n0003_c.sql\n0004_d.sql\n' >"$falsos/ls-4"
caso "o /health falha depois de migrar" 4 CURL_FALHA=1
confere sim "migrou a nova" migrou
if [[ "$(cat "$falsos/no-ar")" == "$(img 3)" ]]; then echo "ok: volta à anterior"; else falhou "não voltou à anterior"; fi
if [[ "$(grep -c "node dist/migrar.js" "$falsos/docker-chamado")" == 1 ]]; then
  echo "ok: a volta não migra"
else
  falhou "a volta migrou"
fi

# A acção «publicar» do MCP (eurolify-operar): só a anterior da que está no ar.
operar() { # operar <n> → 0 se pediu a publicação
  rm -f "$falsos/systemd-run-chamado"
  bash "$f/sbin/eurolify-operar" "publicar $(r "$1")" >"$falsos/saida" 2>&1 || true
  [[ -f "$falsos/systemd-run-chamado" ]]
}
preparar
echo "== MCP"
confere sim "aceita a imediatamente anterior" operar 2
confere nao "recusa uma mais antiga" operar 1
confere sim "diz qual se pode pedir" na_saida "imediatamente anterior"
confere nao "recusa uma que nunca esteve no ar" operar 9

# O estado_do_ensaio (eurolify-medir) mostra sempre a base à frente da versão
# no ar (revisão do #115, P2-2).
preparar
img 2 >"$falsos/no-ar"
echo "== estado_do_ensaio"
bash "$f/sbin/eurolify-medir" >"$falsos/saida" 2>/dev/null || true
confere sim "mostra as migrações da base que a versão no ar não conhece" linha_na_saida "na base e não na versão no ar: 0003_c"
img 3 >"$falsos/no-ar"
bash "$f/sbin/eurolify-medir" >"$falsos/saida" 2>/dev/null || true
confere sim "e «nenhuma» quando estão iguais" linha_na_saida "na base e não na versão no ar: nenhuma"

rm -rf "$falsos"
((falhas == 0))
