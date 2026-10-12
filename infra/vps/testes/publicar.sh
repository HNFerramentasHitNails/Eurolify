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
install -d /usr/local/lib/eurolify /etc/eurolify /var/log/eurolify /run/lock
install -m 644 "$f/lib/comum.sh" /usr/local/lib/eurolify/comum.sh
install -m 644 "$f/lib/chave-totp.sh" /usr/local/lib/eurolify/chave-totp.sh
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
  image) [[ -f "$FALSOS/fora-da-maquina" ]] && exit 1 || exit 0 ;; # a imagem já está na máquina?
  login | logout | pull) exit 0 ;;
  inspect)
    [[ " $* " == *" eurolify-api "* && -f "$FALSOS/no-ar" ]] || exit 1
    if [[ "$*" == *"{{.Created}}"* ]]; then echo "${CRIADO:-2099-01-01T00:00:00Z}"
    # As montagens da API no ar: sem-media faz de API de antes do #178.
    elif [[ "$*" == *"{{range .Mounts}}"* ]]; then [[ -f "$FALSOS/sem-media" ]] || echo "/media "
    else cat "$FALSOS/no-ar"; fi ;;
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
        elif [[ "$cmd" == test && "${args[*]}" == *servidor.js* ]]; then
          [[ ! -f "$FALSOS/sem-mcp-$n" ]] || exit 1
        elif [[ "$cmd" == test && "${args[*]}" == *hub/index.html* ]]; then
          [[ -f "$FALSOS/hub-$n" ]] || exit 1
        elif [[ "$cmd" == tar ]]; then
          # Os ecrãs do Hub da imagem n (hub-n); hub-tar-falha-n faz o tar falhar.
          [[ -f "$FALSOS/hub-$n" && ! -f "$FALSOS/hub-tar-falha-$n" ]] || exit 1
          d="$(mktemp -d)"
          echo "<p>hub $n</p>" >"$d/index.html"
          tar -C "$d" -cf - .
          rm -rf "$d"
        elif [[ "$cmd" == test && "${args[*]}" == *dist/migrar.js* ]]; then
          [[ ! -f "$FALSOS/erro-docker-$n" ]] || exit 125
          [[ ! -f "$FALSOS/sem-migrador-$n" ]] || exit 1
        fi
        exit 0
      fi
    done
    if [[ " $* " == *" node dist/migrar.js "* ]]; then
      # A falhar a meio, pode deixar migrações na base (MIGRAR_DEIXA).
      [[ -z "${MIGRAR_DEIXA:-}" ]] || echo "$MIGRAR_DEIXA" >>"$FALSOS/base"
      exit "${MIGRAR_FALHA:-0}"
    fi
    if [[ " $* " == *" -d "* ]]; then
      # Uma imagem que já não está na máquina não arranca (run-falha-n).
      [[ ! -f "$FALSOS/run-falha-$(n_de "${*: -1}")" ]] || exit 125
      echo "${*: -1}" >"$FALSOS/no-ar"
    fi ;;
esac
exit 0
FALSO
cat >"$falsos/curl" <<'FALSO'
#!/usr/bin/env bash
# A prova da base (chega_a_base) pede /me com uma chave inventada.
if [[ "$*" == */me* ]]; then echo "${CODIGO_ME:-401}"; exit 0; fi
# O estado do VIES (eurolify-medir).
if [[ "$*" == */check-status* ]]; then
  echo "$*" >"$FALSOS/curl-vies"
  [[ -z "${VIES_FALHA:-}" ]] || exit "$VIES_FALHA"
  corpo='{"vow":{"available":true},"countries":[]}'
  printf '%s\nHTTP %s em 0.2 s' "${VIES_CORPO:-$corpo}" "${VIES_HTTP:-200}"
  exit 0
fi
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
  rm -f "$falsos"/ls-* "$falsos"/sem-migrador-* "$falsos"/sem-mcp-* "$falsos"/run-falha-* "$falsos"/erro-docker-* "$falsos"/hub-* "$falsos/docker-chamado" /etc/eurolify/api-base.env /etc/eurolify/api-hub.env /etc/eurolify/api-totp.env /etc/eurolify/api-vies.env \
    "$falsos/fora-da-maquina" "$falsos/systemd-run-chamado" "$falsos/sem-media" /var/log/eurolify/acoes.log
  echo token >/etc/eurolify/ghcr.token
  cat >/var/log/eurolify/publicacoes.log <<REG
2026-10-01T10:00:00Z | $(r 1) | anterior: nenhuma | migrou: 0001_a
2026-10-02T10:00:00Z | $(r 2) | anterior: $(img 1) | migrou: 0002_b
2026-10-03T10:00:00Z | $(r 3) | anterior: $(img 2) | migrou: 0003_c
REG
  [[ -z "${SEM_REGISTO:-}" ]] || rm -f /var/log/eurolify/publicacoes.log
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
  env "$@" bash "$f/sbin/eurolify-publicar" "$(r "$n")" ${OPCAO:+"$OPCAO"} >"$falsos/saida" 2>&1 || codigo=$?
  echo "== $descricao (código $codigo)"
}
migrou() { grep -q "node dist/migrar.js" "$falsos/docker-chamado"; }
arrancou() { grep -q -- "-d .*@$(r "$1")\$" "$falsos/docker-chamado"; }
no_registo() { grep -qF -- "$1" /var/log/eurolify/acoes.log 2>/dev/null; }
na_saida() { grep -qF -- "$1" "$falsos/saida"; }
linha_na_saida() { grep -qxF -- "$1" "$falsos/saida"; }
erro() { ((codigo != 0)); }
operar() { # operar <n> → 0 se pediu a publicação
  rm -f "$falsos/systemd-run-chamado"
  bash "$f/sbin/eurolify-operar" "publicar $(r "$1")" >"$falsos/saida" 2>&1 || true
  [[ -f "$falsos/systemd-run-chamado" ]]
}
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
confere sim "a API arranca com a pasta das imagens (docs/06, CQ)" grep -qE -- "run -d --name eurolify-api .*--mount type=bind,src=/var/lib/eurolify/media,dst=/media -e MEDIA_PASTA=/media .*@$(r 4)\$" "$falsos/docker-chamado"
confere sim "a pasta das imagens fica com o dono da API (revisão do #178, P1-2)" test "$(stat -c '%a %u %g' /var/lib/eurolify/media)" == "750 1000 1000"
confere sim "regista no publicacoes.log as migrações que aplicou" grep -qE "\| $(r 4) \| anterior: $(img 3) \| migrou: 0004_d\$" /var/log/eurolify/publicacoes.log

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
confere sim "regista a recusa" no_registo "que a publicação no ar não aplicou (0004_d)"

preparar
caso "voltar, publicar uma correcção e voltar outra vez (2.ª ordem)" 2
printf '0001_a.sql\n0002_b.sql\n0003_c.sql\n0004_d.sql\n' >"$falsos/ls-4"
caso "… publicar a 4" 4
confere sim "a 4 migra" migrou
printf '0001_a\n0002_b\n0003_c\n0004_d\n' >"$falsos/base"
rm -f "$falsos/docker-chamado"
caso "… voltar outra vez à 2" 2
confere nao "não arranca: a 3 aplicou a c, não a 4" arrancou 2
confere sim "regista a recusa" no_registo "que a publicação no ar não aplicou (0003_c)"

preparar
sed -i 's/ | migrou: 0003_c$//' /var/log/eurolify/publicacoes.log
caso "voltar quando a publicação no ar é de antes do «migrou»" 2
confere nao "não arranca" arrancou 2
confere sim "regista a recusa" no_registo "não registou as migrações que aplicou"

preparar
OPCAO=--emergencia caso "voltar mais atrás em emergência" 1
confere nao "não migra" migrou
confere sim "arranca" arrancou 1
confere sim "regista a emergência" no_registo "EMERGÊNCIA"

preparar
printf '0001_a.sql\n0004_d.sql\n' >"$falsos/ls-1"
OPCAO=--emergencia caso "emergência com a base e a imagem a divergir" 1
confere nao "não arranca" arrancou 1
confere sim "regista a recusa" no_registo "faltam-lhe outras (0004_d)"

preparar
touch "$falsos/erro-docker-4"
caso "o docker falha a ver se a imagem tem o migrador" 4
confere nao "não arranca" arrancou 4
confere sim "regista a recusa" no_registo "não se conseguiu ver se a imagem tem o migrador"

preparar
: >"$falsos/ls-4"
caso "imagem com o migrador e a pasta vazia" 4
confere nao "não diz que não comparou" na_saida "Não se comparou"
confere nao "não arranca (a base está à frente e não é a anterior)" arrancou 4

preparar
printf '0001_a.sql\n0002_b.sql\n0003_c.sql\n0004_d.sql\n' >"$falsos/ls-4"
caso "a migração falha" 4 MIGRAR_FALHA=1
confere nao "não arranca" arrancou 4
confere sim "fica no registo de acções" no_registo "terminou com erro (código 1)"

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
confere nao "não arranca (a base tem a e b, que a 3 não aplicou)" arrancou 2
confere sim "regista a recusa" no_registo "não aplicou (0001_a,0002_b)"

preparar
printf '0001_a.sql\n0002_b.sql\n0003_c.sql\n0004_d.sql\n' >"$falsos/ls-4"
caso "o /health falha depois de migrar" 4 CURL_FALHA=1
confere sim "migrou a nova" migrou
if [[ "$(cat "$falsos/no-ar")" == "$(img 3)" ]]; then echo "ok: volta à anterior"; else falhou "não voltou à anterior"; fi
if grep -qE "\| $(r 4) \| anterior: $(img 3) \| falhou \|" /var/log/eurolify/publicacoes.log; then
  echo "ok: a falhada fica marcada «falhou»"
else
  falhou "a falhada não ficou marcada"
fi
if [[ "$(grep -c "node dist/migrar.js" "$falsos/docker-chamado")" == 1 ]]; then
  echo "ok: a volta não migra"
else
  falhou "a volta migrou"
fi


preparar
touch "$falsos/sem-migrador-2"
caso "imagem sem migrador e a base não responde" 2 BASE_EM_BAIXO=1
confere nao "não arranca" arrancou 2
confere sim "regista a recusa" no_registo "imagem sem migrador e a base não respondeu"

preparar
caso "publicar a imagem que já está no ar" 3
confere nao "não migra" migrou
confere sim "nada a fazer" na_saida "Nada a fazer"

# A mesma regra «a API sem a pasta das imagens recria-se» vive no
# eurolify-publicar e no passo 10c do preparar.sh (ao aplicar o #178, o passo
# 10c não a tinha e a API não se recriou). A função do passo 10c corre aqui,
# com o docker de mentira (revisão do #180, P2-1).
preparar
eval "$(sed -n '/^configuracao_mais_recente_que_a_api()/,/^}/p' "$repo/infra/vps/preparar.sh")"
confere sim "10c: a API sem a pasta das imagens recria-se" bash -c "$(declare -f configuracao_mais_recente_que_a_api); touch '$falsos/sem-media'; configuracao_mais_recente_que_a_api"
rm -f "$falsos/sem-media"
confere nao "10c: com a pasta e a configuração antiga, não" bash -c "$(declare -f configuracao_mais_recente_que_a_api); configuracao_mais_recente_que_a_api"
confere nao "10c: um docker inspect que falha não recria" bash -c "$(declare -f configuracao_mais_recente_que_a_api); rm -f '$falsos/no-ar'; touch '$falsos/sem-media'; configuracao_mais_recente_que_a_api"
img 3 >"$falsos/no-ar"

preparar
touch "$falsos/sem-media"
caso "a imagem que já está no ar, numa API de antes da pasta das imagens" 3
confere sim "recria a API (revisão do #178, P1-1)" arrancou 3
confere sim "com a pasta das imagens" grep -qE -- "--mount type=bind,src=/var/lib/eurolify/media,dst=/media" "$falsos/docker-chamado"

SEM_REGISTO=1 preparar
caso "voltar atrás sem o registo das publicações" 2
confere nao "não arranca" arrancou 2
SEM_REGISTO=1 preparar
printf '0001_a.sql\n0002_b.sql\n0003_c.sql\n0004_d.sql\n' >"$falsos/ls-4"
caso "imagem nova sem o registo das publicações" 4
confere sim "migra" migrou
confere sim "arranca" arrancou 4

preparar
caso "voltar à anterior e depois avançar outra vez" 2
confere sim "voltou à 2" arrancou 2
rm -f "$falsos/docker-chamado"
caso "… e avançar para a 3" 3
confere sim "a 3 arranca" arrancou 3
confere sim "a 3 migra (o migrador não faz nada)" migrou
confere sim "a 3 herda a migração que aplicou da outra vez" grep -qE "\| $(r 3) \| anterior: $(img 2) \| migrou: 0003_c\$" /var/log/eurolify/publicacoes.log
rm -f "$falsos/docker-chamado"
caso "… e voltar outra vez à 2" 2
confere sim "a 2 arranca outra vez" arrancou 2
rm -f "$falsos/docker-chamado"
caso "… e avançar outra vez para a 3" 3
caso "… e voltar à 2 uma terceira vez" 2
confere sim "o MCP continua a alternar" arrancou 2

preparar
printf '0001_a.sql\n0002_b.sql\n0003_c.sql\n0004_d.sql\n' >"$falsos/ls-4"
caso "o /health da 4 falha (a d fica na base) …" 4 CURL_FALHA=1
confere sim "o registo de acções diz a migração que ficou" no_registo "migrou: 0004_d"
printf '0001_a\n0002_b\n0003_c\n0004_d\n' >"$falsos/base"
rm -f "$falsos/docker-chamado"
caso "… e depois voltar à 2 pelo MCP" 2
confere nao "não arranca: a d não é da 3" arrancou 2

preparar
OPCAO=--emergencia caso "emergência marcada no publicacoes.log" 1
confere sim "a linha diz «emergência»" grep -qE "\| $(r 1) \| anterior: $(img 3) \| emergência \| migrou: \$" /var/log/eurolify/publicacoes.log

preparar
OPCAO=--so-recriar caso "--so-recriar com a imagem no ar" 3
confere nao "não migra" migrou
confere nao "não escreve no publicacoes.log" grep -qF "| $(r 3) | anterior: $(img 3)" /var/log/eurolify/publicacoes.log
OPCAO=--so-recriar caso "--so-recriar com outra imagem" 4
confere nao "não arranca" arrancou 4
confere nao "termina sem erro" erro

preparar
cp "$falsos/ls-3" "$falsos/ls-4"
touch "$falsos/fora-da-maquina"
caso "imagem que não está na máquina" 4
confere sim "abre a sessão no GHCR" grep -q "docker login ghcr.io" "$falsos/docker-chamado"
confere sim "e fecha-a" grep -q "docker logout ghcr.io" "$falsos/docker-chamado"

preparar
rm -f /etc/eurolify/ghcr.token
cp "$falsos/ls-3" "$falsos/ls-4"
caso "falta o token do GHCR" 4
confere sim "fica no registo de acções" no_registo "terminou com erro (código 1)"

preparar
mv /etc/eurolify/ensaio.conf /etc/eurolify/ensaio.conf.fora
caso "falta a configuração da máquina" 4
mv /etc/eurolify/ensaio.conf.fora /etc/eurolify/ensaio.conf
confere sim "fica no registo de acções" no_registo "terminou com erro (código 1)"

# #120, P2: uma publicação que falha o /health deixa linha «falhou», e a
# mesma imagem repetida herda as migrações dela.
preparar
printf '0001_a.sql\n0002_b.sql\n0003_c.sql\n0004_d.sql\n' >"$falsos/ls-4"
caso "a 4 falha o /health (a d fica na base) …" 4 CURL_FALHA=1
confere sim "fica a linha «falhou» com a d" grep -qE "\| $(r 4) \| anterior: $(img 3) \| falhou \| migrou: 0004_d\$" /var/log/eurolify/publicacoes.log
printf '0001_a\n0002_b\n0003_c\n0004_d\n' >"$falsos/base"
caso "… repete-se a 4 e responde" 4
confere sim "a 4 herda a d" grep -qE "\| $(r 4) \| anterior: $(img 3) \| migrou: 0004_d\$" /var/log/eurolify/publicacoes.log
rm -f "$falsos/docker-chamado"
caso "… e volta-se à 3 pelo MCP" 3
confere sim "a 3 arranca" arrancou 3
confere nao "sem correr o migrador" migrou

# #122, P2-1: duas falhas seguidas não perdem a herança.
preparar
printf '0001_a.sql\n0002_b.sql\n0003_c.sql\n0004_d.sql\n' >"$falsos/ls-4"
caso "a 4 falha o /health depois de aplicar a d …" 4 CURL_FALHA=1
printf '0001_a\n0002_b\n0003_c\n0004_d\n' >"$falsos/base"
printf '0001_a.sql\n0002_b.sql\n0003_c.sql\n0004_d.sql\n0005_e.sql\n' >"$falsos/ls-4"
caso "… repete-se a 4 e a migração falha sem deixar nada" 4 MIGRAR_FALHA=1
confere sim "a linha «falhou» guarda a d herdada" grep -qE "\| $(r 4) \| anterior: $(img 3) \| falhou \| migrou: 0004_d\$" /var/log/eurolify/publicacoes.log
caso "… repete-se a 4 e corre bem" 4
confere sim "a 4 herda a d e aplica a e" grep -qE "\| $(r 4) \| anterior: $(img 3) \| migrou: 0004_d,0005_e\$" /var/log/eurolify/publicacoes.log
printf '0001_a\n0002_b\n0003_c\n0004_d\n0005_e\n' >"$falsos/base"
rm -f "$falsos/docker-chamado"
caso "… e volta-se à 3 pelo MCP" 3
confere sim "a 3 arranca" arrancou 3

# Falhar e publicar outra imagem a seguir: a migração da falhada não é desta.
preparar
printf '0001_a.sql\n0002_b.sql\n0003_c.sql\n0004_d.sql\n' >"$falsos/ls-4"
caso "a 4 falha o /health (a d fica na base) …" 4 CURL_FALHA=1
printf '0001_a\n0002_b\n0003_c\n0004_d\n' >"$falsos/base"
printf '0001_a.sql\n0002_b.sql\n0003_c.sql\n0004_d.sql\n0005_e.sql\n' >"$falsos/ls-5"
caso "… publica-se a 5" 5
confere sim "a 5 regista só a e" grep -qE "\| $(r 5) \| anterior: $(img 3) \| migrou: 0005_e\$" /var/log/eurolify/publicacoes.log
printf '0001_a\n0002_b\n0003_c\n0004_d\n0005_e\n' >"$falsos/base"
rm -f "$falsos/docker-chamado"
caso "… e volta-se à 3" 3
confere nao "não arranca (a d não é da 5)" arrancou 3
confere sim "regista a recusa" no_registo "que a publicação no ar não aplicou (0004_d)"

# A volta que falha o /health deixa a sua linha «falhou» e repõe a que estava.
preparar
caso "voltar à 2 e o /health falha" 2 CURL_FALHA=1
confere sim "fica a linha «falhou» da 2" grep -qE "\| $(r 2) \| anterior: $(img 3) \| falhou \| migrou: \$" /var/log/eurolify/publicacoes.log
if [[ "$(cat "$falsos/no-ar")" == "$(img 3)" ]]; then echo "ok: a 3 volta ao ar"; else falhou "a 3 não voltou ao ar"; fi
confere sim "e o MCP continua a poder pedir a 2" operar 2

# Emergência que falha: marcada nas duas coisas.
preparar
OPCAO=--emergencia caso "emergência que falha o /health" 1 CURL_FALHA=1
confere sim "a linha diz «emergência» e «falhou»" grep -qE "\| $(r 1) \| anterior: $(img 3) \| emergência \| falhou \| migrou: \$" /var/log/eurolify/publicacoes.log

# A migração falha sem se ter comparado: «migrou: ?».
preparar
cp "$falsos/ls-3" "$falsos/ls-4"
caso "a migração falha com a base sem resposta" 4 BASE_EM_BAIXO=1 MIGRAR_FALHA=1
confere sim "a linha «falhou» fica com «?»" grep -qE "\| $(r 4) \| anterior: $(img 3) \| falhou \| migrou: \?\$" /var/log/eurolify/publicacoes.log

# A anterior já não arranca depois de a nova falhar: a linha «falhou» fica na mesma.
preparar
printf '0001_a.sql\n0002_b.sql\n0003_c.sql\n0004_d.sql\n' >"$falsos/ls-4"
touch "$falsos/run-falha-3"
caso "a 4 falha o /health e a 3 já não arranca" 4 CURL_FALHA=1
confere sim "fica a linha «falhou» da 4 com a d" grep -qE "\| $(r 4) \| anterior: $(img 3) \| falhou \| migrou: 0004_d\$" /var/log/eurolify/publicacoes.log
confere sim "regista que a anterior não arrancou" no_registo "não se conseguiu arrancar a anterior"

# 2.ª revisão do #122, P2-1: a imagem nova nem arranca.
preparar
printf '0001_a.sql\n0002_b.sql\n0003_c.sql\n0004_d.sql\n' >"$falsos/ls-4"
touch "$falsos/run-falha-4"
caso "a 4 não arranca (docker run falha)" 4
confere sim "termina com erro" erro
confere sim "diz que a nova não arrancou" na_saida "A imagem nova não arrancou"
confere sim "fica a linha «falhou» da 4 com a d" grep -qE "\| $(r 4) \| anterior: $(img 3) \| falhou \| migrou: 0004_d\$" /var/log/eurolify/publicacoes.log
confere sim "arranca outra vez a 3" arrancou 3

# 2.ª revisão do #122, P3-1: não se consegue escrever no publicacoes.log.
preparar
printf '0001_a.sql\n0002_b.sql\n0003_c.sql\n0004_d.sql\n' >"$falsos/ls-4"
mv /var/log/eurolify/publicacoes.log /var/log/eurolify/publicacoes.log.guardado
mkdir /var/log/eurolify/publicacoes.log
caso "o /health da 4 falha e o publicacoes.log não aceita escrita" 4 CURL_FALHA=1
rmdir /var/log/eurolify/publicacoes.log
mv /var/log/eurolify/publicacoes.log.guardado /var/log/eurolify/publicacoes.log
if [[ "$(cat "$falsos/no-ar")" == "$(img 3)" ]]; then echo "ok: a 3 volta ao ar na mesma"; else falhou "a 3 não voltou ao ar"; fi

# 3.ª revisão do #122, P3-B: a publicação corre bem e o publicacoes.log não aceita escrita.
preparar
printf '0001_a.sql\n0002_b.sql\n0003_c.sql\n0004_d.sql\n' >"$falsos/ls-4"
mv /var/log/eurolify/publicacoes.log /var/log/eurolify/publicacoes.log.guardado
mkdir /var/log/eurolify/publicacoes.log
caso "a 4 fica no ar e o publicacoes.log não aceita escrita" 4
rmdir /var/log/eurolify/publicacoes.log
mv /var/log/eurolify/publicacoes.log.guardado /var/log/eurolify/publicacoes.log
confere sim "a 4 fica no ar" arrancou 4
confere sim "termina com erro" erro
confere sim "diz que não escreveu a linha" na_saida "não se escreveu a linha da publicação"
confere sim "regista na mesma a publicação" no_registo "publicado $(r 4)"

# 3.ª revisão do #122, P3-D: sem publicação anterior, diz que a API ficou em baixo.
preparar
rm -f "$falsos/no-ar"
cp "$falsos/ls-3" "$falsos/ls-4"
caso "primeira publicação e o /health falha" 4 CURL_FALHA=1
confere sim "diz que a API está em baixo" na_saida "não havia publicação anterior para repor"

# 2.ª revisão do #122, P3-3: herança de uma linha boa e a migração falha a meio.
preparar
caso "voltar à 2 …" 2
caso "… avançar para a 3 e a migração falha sem deixar nada" 3 MIGRAR_FALHA=1
confere sim "a linha «falhou» da 3 guarda a c herdada" grep -qE "\| $(r 3) \| anterior: $(img 2) \| falhou \| migrou: 0003_c\$" /var/log/eurolify/publicacoes.log

# #120, P3-1: a migração falha a meio e deixa migrações na base.
preparar
printf '0001_a.sql\n0002_b.sql\n0003_c.sql\n0004_d.sql\n0005_e.sql\n' >"$falsos/ls-4"
caso "a migração falha depois de aplicar a d" 4 MIGRAR_FALHA=1 MIGRAR_DEIXA=0004_d
confere nao "não arranca" arrancou 4
confere sim "regista o que ficou na base" no_registo "ficaram na base: 0004_d"
confere sim "e deixa a linha «falhou»" grep -qE "\| $(r 4) \| anterior: $(img 3) \| falhou \| migrou: 0004_d\$" /var/log/eurolify/publicacoes.log

# «migrou: ?» quando não se comparou; voltar a seguir é recusado.
preparar
cp "$falsos/ls-3" "$falsos/ls-4"
caso "publicar sem se conseguir ler a base" 4 BASE_EM_BAIXO=1
confere sim "a linha fica com «migrou: ?»" grep -qE "\| $(r 4) \| anterior: $(img 3) \| migrou: \?\$" /var/log/eurolify/publicacoes.log
printf '0001_a\n0002_b\n0003_c\n0004_d\n' >"$falsos/base"
rm -f "$falsos/docker-chamado"
caso "… e voltar à 3" 3
confere nao "não arranca" arrancou 3
confere sim "regista a recusa" no_registo "não registou as migrações que aplicou"

# A herança só leva as migrações que ainda estão na base.
preparar
caso "voltar à 2 …" 2
sed -i "s#| $(r 3) | anterior: $(img 2) | migrou: 0003_c\$#| $(r 3) | anterior: $(img 2) | migrou: 0003_c,0009_z#" /var/log/eurolify/publicacoes.log
caso "… e avançar para a 3, com uma herdada que já não está na base" 3
confere sim "herda só a c" grep -qE "\| $(r 3) \| anterior: $(img 2) \| migrou: 0003_c\$" /var/log/eurolify/publicacoes.log

# Uma recusa com a sessão do GHCR aberta fecha-a.
preparar
touch "$falsos/fora-da-maquina"
caso "recusa depois de ir buscar a imagem" 1
confere sim "recusa" erro
confere sim "fecha a sessão no GHCR" grep -q "docker logout ghcr.io" "$falsos/docker-chamado"

# --so-recriar: a configuração mudou depois de a API arrancar.
preparar
printf 'BASE_DADOS_URL=postgres://x\n' >/etc/eurolify/api-base.env
OPCAO=--so-recriar caso "--so-recriar com a ligação nova" 3 CRIADO=2000-01-01T00:00:00Z
confere sim "recria a API" arrancou 3
confere sim "prova a ligação à base" na_saida "A API chega à base."
confere nao "não escreve no publicacoes.log" grep -qF "| $(r 3) | anterior: $(img 3)" /var/log/eurolify/publicacoes.log
OPCAO=--so-recriar caso "--so-recriar e a API não chega à base" 3 CRIADO=2000-01-01T00:00:00Z CODIGO_ME=500
confere sim "termina com erro" erro
confere sim "regista-o" no_registo "não chega à base"
# A configuração mudou no mesmo segundo em que a API foi criada, meio segundo
# depois (revisão do #162, P3-F): em segundos inteiros não contava.
preparar
printf 'HUB_ORIGEM=https://x\n' >/etc/eurolify/api-hub.env
touch -d @2000000000.5 /etc/eurolify/api-hub.env
OPCAO=--so-recriar caso "--so-recriar com a configuração do mesmo segundo" 3 CRIADO=2033-05-18T03:33:20Z
confere sim "recria a API" arrancou 3
# A chave dos segredos TOTP (docs/22 §9.2; pedido #177): uma chave nova
# recria a API, e a API recebe-a.
preparar
printf 'TOTP_CHAVE=%s\nTOTP_CHAVE_VERSAO=1\n' "$(printf 'a%.0s' {1..43})=" >/etc/eurolify/api-totp.env
touch -d @2000000000.5 /etc/eurolify/api-totp.env
OPCAO=--so-recriar caso "--so-recriar com a chave TOTP nova" 3 CRIADO=2033-05-18T03:33:20Z
confere sim "recria a API" arrancou 3
confere sim "passa a chave TOTP à API" grep -q -- "--env-file /etc/eurolify/api-totp.env" "$falsos/docker-chamado"
preparar
caso "publicar sem a chave TOTP" 4
confere sim "publica" arrancou 4
confere nao "não passa a chave que não existe" grep -q -- "api-totp.env" "$falsos/docker-chamado"
# Uma chave estragada não chega à API: derrubava-a ao arrancar (revisão do
# #177, P2-2 da VPS).
preparar
printf 'TOTP_CHAVE=x\nTOTP_CHAVE_VERSAO=1\n' >/etc/eurolify/api-totp.env
caso "publicar com a chave TOTP estragada" 4
confere sim "publica" arrancou 4
confere nao "não passa a chave estragada" grep -q -- "api-totp.env" "$falsos/docker-chamado"
confere sim "avisa" na_saida "a API arranca sem a palavra-passe"
confere sim "regista-o" no_registo "chave TOTP inválida"
# O endereço do VIES (docs/23 §13): o api-vies.env novo recria a API, e a API
# recebe-o; sem ele, não se passa.
preparar
printf 'VIES_URL=https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number\n' >/etc/eurolify/api-vies.env
touch -d @2000000000.5 /etc/eurolify/api-vies.env
OPCAO=--so-recriar caso "--so-recriar com o endereço do VIES" 3 CRIADO=2033-05-18T03:33:20Z
confere sim "recria a API" arrancou 3
confere sim "passa o endereço do VIES à API" grep -q -- "--env-file /etc/eurolify/api-vies.env" "$falsos/docker-chamado"
preparar
caso "publicar sem o endereço do VIES" 4
confere nao "não passa o ficheiro que não existe" grep -q -- "api-vies.env" "$falsos/docker-chamado"

# A acção «publicar» do MCP (eurolify-operar): só a anterior da que está no ar.
preparar
echo "== MCP"
confere sim "aceita a imediatamente anterior" operar 2
confere nao "recusa uma mais antiga" operar 1
confere sim "diz qual se pode pedir" na_saida "imediatamente anterior"
confere nao "recusa uma que nunca esteve no ar" operar 9
echo "2026-10-04T10:00:00Z | $(r 8) | anterior: $(img 3) | falhou | migrou: " >>/var/log/eurolify/publicacoes.log
confere nao "recusa uma que só tem linha «falhou»" operar 8
confere sim "e diz que nunca ficou no ar" na_saida "nunca ficou no ar"
touch "$falsos/sem-mcp-2"
confere nao "recusa a anterior se ela não tiver o MCP" operar 2
confere sim "e di-lo" na_saida "não tem o MCP"
rm -f "$falsos/sem-mcp-2"
bash "$f/sbin/eurolify-publicar" "$(r 2)" >/dev/null 2>&1 || falhou "a volta à 2 falhou"
confere sim "depois de voltar à 2, aceita a 3 (de onde se veio)" operar 3
confere nao "e recusa a 1" operar 1
sed -i 's|^IMAGEM_REPO=.*|IMAGEM_REPO=ghcr.io/outro/eurolify-api|' /etc/eurolify/ensaio.conf
confere nao "com outro repositório de imagens, recusa (a referência inteira)" operar 3
sed -i "s|^IMAGEM_REPO=.*|IMAGEM_REPO=$repo_img|" /etc/eurolify/ensaio.conf
preparar
img 7 >"$falsos/no-ar"
confere nao "com a versão no ar fora do registo, recusa" operar 2
confere sim "e di-lo" na_saida "sem registo da que está no ar"
rm -f /var/log/eurolify/publicacoes.log
confere nao "sem o registo, recusa" operar 2

# Os ecrãs do Hub (docs/22 §7): copiam-se da imagem para a pasta do nginx,
# voltam atrás com a API, e uma falha não desfaz a publicação.
hub_actual() { readlink /var/lib/eurolify/hub/actual 2>/dev/null || true; }
sem_erro() { ((codigo == 0)); }
legivel() { [[ "$(stat -c %a /var/lib/eurolify/hub/actual/index.html)" == 644 ]]; }
copias() { find /var/lib/eurolify/hub -mindepth 1 -maxdepth 1 -type d -name '[0-9a-f]*' | wc -l; }
tres_copias() { [[ "$(copias)" == 3 ]]; }
hub_e() { [[ "$(hub_actual)" == "/var/lib/eurolify/hub/$(printf '%064d' "$1")" ]] && grep -q "hub $1" /var/lib/eurolify/hub/actual/index.html; }
rm -rf /var/lib/eurolify/hub
preparar
cp "$falsos/ls-3" "$falsos/ls-4"
touch "$falsos/hub-4"
caso "imagem nova com os ecrãs do Hub" 4
confere sim "arranca" arrancou 4
confere sim "os ecrãs da 4 ficam no ar" hub_e 4
confere sim "e sem erro" sem_erro
confere sim "a pasta é legível pelo nginx" legivel
img 4 >"$falsos/no-ar"
rm -f "$falsos/docker-chamado"
caso "a mesma imagem outra vez" 4
confere sim "nada a fazer" na_saida "Nada a fazer"
confere nao "não volta a copiar" grep -q -- "--entrypoint tar" "$falsos/docker-chamado"
rm -f /var/lib/eurolify/hub/actual
caso "a mesma imagem sem os ecrãs no ar" 4
confere sim "copia os ecrãs" hub_e 4
confere sim "sem erro" sem_erro

preparar
cp "$falsos/ls-3" "$falsos/ls-5"
touch "$falsos/hub-5" "$falsos/hub-tar-falha-5"
caso "os ecrãs não se copiam" 5
confere sim "a API fica publicada" arrancou 5
confere sim "termina com erro" erro
confere sim "regista" no_registo "os ecrãs do Hub não ficaram no ar"
confere sim "fica o que estava" hub_e 4

preparar
cp "$falsos/ls-3" "$falsos/ls-6"
touch "$falsos/hub-6" "$falsos/hub-3"
caso "o /health falha: volta à anterior com os ecrãs dela" 6 CURL_FALHA=7
confere sim "volta à 3" arrancou 3
confere sim "com os ecrãs da 3" hub_e 3

preparar
for n in 7 8 9; do
  cp "$falsos/ls-3" "$falsos/ls-$n"
  touch "$falsos/hub-$n"
  caso "publicar a $n" "$n"
  img "$n" >"$falsos/no-ar"
done
confere sim "ficam só as 3 cópias mais recentes" tres_copias
confere sim "a actual é a 9" hub_e 9

# Uma troca que falha não diz que os ecrãs estão no ar (revisão do #160,
# P2-1): «actual» é uma pasta com ficheiros, onde o mv -T não escreve.
preparar
rm -f /var/lib/eurolify/hub/actual
mkdir -p /var/lib/eurolify/hub/actual
echo "outra coisa" >/var/lib/eurolify/hub/actual/index.html
cp "$falsos/ls-3" "$falsos/ls-10"
touch "$falsos/hub-10"
caso "a ligação dos ecrãs não se troca" 10
confere sim "a API fica publicada" arrancou 10
confere sim "termina com erro" erro
confere nao "não diz que estão no ar" na_saida "estão no ar"
confere sim "regista" no_registo "os ecrãs do Hub não ficaram no ar"
rm -rf /var/lib/eurolify/hub

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
rm -f "$falsos/ls-3"
bash "$f/sbin/eurolify-medir" >"$falsos/saida" 2>/dev/null || true
confere sim "diz quando não lê a lista da versão no ar" linha_na_saida "não se leu a lista de migrações da versão no ar"
img 1 >"$falsos/no-ar"
touch "$falsos/sem-migrador-1"
bash "$f/sbin/eurolify-medir" >"$falsos/saida" 2>/dev/null || true
confere sim "uma versão no ar sem migrador mostra a base à frente" linha_na_saida "na base e não na versão no ar: 0001_a,0002_b,0003_c"
img 3 >"$falsos/no-ar"
BASE_EM_BAIXO=1 bash "$f/sbin/eurolify-medir" >"$falsos/saida" 2>/dev/null || true
confere sim "diz quando a base não responde" linha_na_saida "a base não respondeu"
rm -f "$falsos/no-ar"
bash "$f/sbin/eurolify-medir" >"$falsos/saida" 2>/dev/null || true
confere sim "diz quando a API não está no ar" linha_na_saida "sem a API no ar"

# A saída para o VIES (docs/23 §13; revisão do #244, P2-5; do #377).
bash "$f/sbin/eurolify-medir" >"$falsos/saida" 2>/dev/null || true
confere sim "o VIES responde e está disponível" linha_na_saida "VIES: disponível"
confere sim "com o código e o tempo, a partir da máquina" linha_na_saida "a partir da máquina (não do contentor da API): HTTP 200 em 0.2 s"
confere nao "sem o corpo da resposta" na_saida '"vow"'
confere sim "com 10 s no máximo" grep -q -- "-m 10 " "$falsos/curl-vies"
confere sim "sem o VIES_URL no api.env" linha_na_saida "VIES_URL na configuração da API: não (a consulta está desligada)"
VIES_CORPO='{"vow" : {"available" : true}}' bash "$f/sbin/eurolify-medir" >"$falsos/saida" 2>/dev/null || true
confere sim "o JSON com espaços também conta" linha_na_saida "VIES: disponível"
VIES_CORPO='{"vow":{"available":false}}' bash "$f/sbin/eurolify-medir" >"$falsos/saida" 2>/dev/null || true
confere sim "o VIES responde sem estar disponível" linha_na_saida "VIES: responde, mas não diz que está disponível"
VIES_HTTP=503 bash "$f/sbin/eurolify-medir" >"$falsos/saida" 2>/dev/null || true
confere sim "um 503 não é «disponível»" linha_na_saida "VIES: responde, mas não diz que está disponível"
confere sim "e mostra o 503" linha_na_saida "a partir da máquina (não do contentor da API): HTTP 503 em 0.2 s"
VIES_FALHA=28 bash "$f/sbin/eurolify-medir" >"$falsos/saida" 2>/dev/null || true
confere sim "sem resposta, com o código do curl" linha_na_saida "VIES: sem resposta (código do curl 28)"
echo "VIES_URL=https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number" >/etc/eurolify/api.env
bash "$f/sbin/eurolify-medir" >"$falsos/saida" 2>/dev/null || true
confere sim "com o VIES_URL no api.env" linha_na_saida "VIES_URL na configuração da API: sim (a API só o lê quando é recriada)"
echo "VIES_URL=   " >/etc/eurolify/api.env
bash "$f/sbin/eurolify-medir" >"$falsos/saida" 2>/dev/null || true
confere sim "um VIES_URL só com espaços não conta" linha_na_saida "VIES_URL na configuração da API: não (a consulta está desligada)"
: >/etc/eurolify/api.env
echo "VIES_URL=https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number" >/etc/eurolify/api-vies.env
bash "$f/sbin/eurolify-medir" >"$falsos/saida" 2>/dev/null || true
confere sim "com o VIES_URL no api-vies.env" linha_na_saida "VIES_URL na configuração da API: sim (a API só o lê quando é recriada)"
rm -f /etc/eurolify/api-vies.env

rm -rf "$falsos"
((falhas == 0))
