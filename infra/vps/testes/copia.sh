#!/usr/bin/env bash
# Teste do eurolify-copia (revisão do #178): a cópia da base e a das imagens
# dos artigos, cifradas e enviadas; uma falha a meio não deixa cópias
# cortadas; o tar que encontra um ficheiro a mudar é só aviso; sem a pasta
# das imagens, a base copia-se e diz-se. Corre como root num contentor
# Ubuntu descartável, com docker, age, rclone e curl de mentira.
set -Eeuo pipefail
[[ "${EUROLIFY_TESTE_DESCARTAVEL:-}" == 1 ]] || { echo "só numa máquina descartável (EUROLIFY_TESTE_DESCARTAVEL=1)" >&2; exit 2; }
repo="$(cd "$(dirname "$0")/../../.." && pwd)"
f="$repo/infra/vps/ficheiros"
falhas=0
falhou() { echo "FALHOU: $*"; falhas=$((falhas + 1)); }
confere() { # confere <sim|nao> <o que se espera> <condição…>
  local espera="$1" texto="$2" obtido=nao
  shift 2
  if "$@"; then obtido=sim; fi
  if [[ "$obtido" == "$espera" ]]; then echo "ok: $texto"; else falhou "$texto"; fi
}

install -d /usr/local/lib/eurolify /etc/eurolify /var/log/eurolify
install -m 644 "$f/lib/comum.sh" /usr/local/lib/eurolify/comum.sh
printf 'BASE_NOME=eurolify\nS3_DESTINO=ovh:copias/ensaio\n' >/etc/eurolify/ensaio.conf
echo "age1chavepublica" >/etc/eurolify/age.pub
echo "[ovh]" >/etc/eurolify/rclone.conf
echo "HC_COPIA=http://hc/copia" >/etc/eurolify/healthchecks.env

falsos="$(mktemp -d)"
export FALSOS="$falsos"
# docker: só o pg_dump (a falhar, com FALHA_DUMP). age: escreve no -o o que
# lê, tal e qual; FALHA_AGE=<texto> fá-lo falhar a meio quando o -o contém
# esse texto (dump ou media). rclone: copyto copia para $FALSOS/s3. curl: regista o
# aviso ao Healthchecks.io. tar: o verdadeiro, ou o código TAR_CODIGO depois
# de escrever (faz de «um ficheiro mudou»).
cat >"$falsos/docker" <<'FALSO'
#!/usr/bin/env bash
[[ "$1" == exec ]] && { echo "dump da base"; exit "${FALHA_DUMP:-0}"; }
exit 0
FALSO
cat >"$falsos/age" <<'FALSO'
#!/usr/bin/env bash
saida=""
while (($#)); do [[ "$1" == -o ]] && saida="$2"; shift; done
# «Cifra» sem mudar nada: o teste lê o que foi enviado.
if [[ -n "${FALHA_AGE:-}" && "$saida" == *"${FALHA_AGE}"* ]]; then cat >/dev/null; printf 'meio' >"$saida"; exit 1; fi
cat >"$saida"
FALSO
cat >"$falsos/rclone" <<'FALSO'
#!/usr/bin/env bash
echo "rclone $*" >>"$FALSOS/rclone-chamado"
args=("$@")
for ((i = 0; i < ${#args[@]}; i++)); do
  if [[ "${args[i]}" == copyto ]]; then
    install -d "$FALSOS/s3"
    cp "${args[i + 1]}" "$FALSOS/s3/$(basename "${args[i + 2]}")"
  fi
done
FALSO
cat >"$falsos/curl" <<'FALSO'
#!/usr/bin/env bash
echo "curl $*" >>"$FALSOS/hc"
FALSO
cat >"$falsos/tar" <<'FALSO'
#!/usr/bin/env bash
/usr/bin/tar "$@"
codigo=$?
((codigo == 0)) || exit "$codigo"
exit "${TAR_CODIGO:-0}"
FALSO
chmod +x "$falsos"/*
export PATH="$falsos:$PATH"

copias=/var/lib/eurolify/copias
media=/var/lib/eurolify/media
limpar() {
  rm -rf "$copias" "$falsos/s3" "$falsos/rclone-chamado" "$falsos/hc" /var/log/eurolify/acoes.log
  rm -rf "$media"
  install -d -m 750 "$media/$(printf '%08d-0000-7000-8000-000000000001' 1)"
  echo "imagem" >"$media/00000001-0000-7000-8000-000000000001/$(printf 'a%.0s' {1..64})"
  echo "a meio" >"$media/00000001-0000-7000-8000-000000000001/x.tmp"
  # Uma exportação (docs/14 §3.11): refaz-se e dura 7 dias, não vai na cópia.
  install -d -m 750 "$media/.exportacoes/00000001-0000-7000-8000-000000000001"
  echo "zip" >"$media/.exportacoes/00000001-0000-7000-8000-000000000001/exportacao.zip"
}
correr() { # correr <descrição> [VAR=valor…]
  local descricao="$1"
  shift
  codigo=0
  env "$@" bash "$f/sbin/eurolify-copia" >"$falsos/saida" 2>&1 || codigo=$?
  echo "== $descricao (código $codigo)"
}
no_s3() { compgen -G "$falsos/s3/$1" >/dev/null; }
na_maquina() { compgen -G "$copias/$1" >/dev/null; }
no_registo() { grep -qF -- "$1" /var/log/eurolify/acoes.log 2>/dev/null; }
hc_falhou() { grep -q "/fail" "$falsos/hc" 2>/dev/null; }
hc_ok() { [[ -f "$falsos/hc" ]] && ! hc_falhou; }

limpar
correr "cópia normal, com imagens"
confere sim "sai bem" test "$codigo" == 0
confere sim "a base vai para a OVH" no_s3 'eurolify-*.dump.age'
confere sim "as imagens vão para a OVH" no_s3 'eurolify-media-*.tar.age'
confere nao "nada fica a meio (.tmp)" na_maquina '*.tmp'
confere sim "o aviso diz ok" hc_ok
confere sim "o registo nomeia as imagens" no_registo "imagens eurolify-media-"
confere sim "apaga na OVH as imagens com mais de 14 dias" grep -q "delete --min-age 14d --include eurolify-media-\*.tar.age" "$falsos/rclone-chamado"
confere sim "apaga na OVH as bases com mais de 14 dias" grep -q "delete --min-age 14d --include eurolify-\*.dump.age" "$falsos/rclone-chamado"
enviado() { /usr/bin/tar -tf "$(compgen -G "$falsos/s3/eurolify-media-*.tar.age")"; }
confere sim "a imagem vai no arquivo enviado" bash -c "$(declare -f enviado); falsos=$falsos; enviado | grep -q aaaa"
confere nao "o ficheiro a meio da API (.tmp) fica de fora" bash -c "$(declare -f enviado); falsos=$falsos; enviado | grep -q x.tmp"
confere nao "as exportações ficam de fora" bash -c "$(declare -f enviado); falsos=$falsos; enviado | grep -q exportac"

limpar
correr "o age falha a meio da base" FALHA_AGE=dump
confere sim "sai com erro" test "$codigo" != 0
confere nao "não fica a cópia cortada com o nome certo" na_maquina 'eurolify-*.dump.age'
confere nao "nem o .tmp" na_maquina '*.tmp'
confere nao "nada vai para a OVH" test -d "$falsos/s3"
confere sim "o aviso diz falhou" hc_falhou

limpar
correr "o pg_dump falha (o age acaba bem sobre o que recebeu)" FALHA_DUMP=1
confere sim "sai com erro (pipefail)" test "$codigo" != 0
confere nao "nada vai para a OVH" test -d "$falsos/s3"
confere nao "nem fica cópia nem .tmp" na_maquina 'eurolify-*'
confere sim "o aviso diz falhou" hc_falhou

limpar
correr "o age falha a meio das imagens" FALHA_AGE=media
confere sim "sai com erro" test "$codigo" != 0
confere sim "a base já foi" no_s3 'eurolify-*.dump.age'
confere nao "as imagens não vão" no_s3 'eurolify-media-*.tar.age'
confere nao "nem fica o .tmp" na_maquina '*.tmp'
confere sim "diz que foi o age" grep -q "o age falhou ao cifrar as imagens" "$falsos/saida"

limpar
install -d -m 700 "$copias"
touch -d '3 days ago' "$copias/eurolify-velho.dump.age.tmp"
correr "um .tmp de uma cópia morta à força, com 3 dias"
confere nao "sai do disco" test -e "$copias/eurolify-velho.dump.age.tmp"

limpar
correr "um ficheiro mudou durante o tar (código 1)" TAR_CODIGO=1
confere sim "sai bem" test "$codigo" == 0
confere sim "as imagens vão na mesma" no_s3 'eurolify-media-*.tar.age'
confere sim "fica o aviso no registo" no_registo "uma imagem mudou durante a cópia"

limpar
correr "o tar falha a sério (código 2)" TAR_CODIGO=2
confere sim "sai com erro" test "$codigo" != 0
confere sim "a base já foi" no_s3 'eurolify-*.dump.age'
confere nao "as imagens não vão" no_s3 'eurolify-media-*.tar.age'
confere nao "nem fica o .tmp" na_maquina '*.tmp'
confere sim "o aviso diz falhou" hc_falhou

limpar
rm -rf "$media"
correr "sem a pasta das imagens"
confere sim "sai bem" test "$codigo" == 0
confere sim "a base vai para a OVH" no_s3 'eurolify-*.dump.age'
confere sim "diz no registo que as imagens não se copiaram" no_registo "as imagens não se copiaram"
confere sim "e no aviso" grep -q "sem a pasta das imagens" "$falsos/hc"

echo
if ((falhas)); then echo "$falhas falha(s)"; exit 1; fi
echo "tudo bem"
