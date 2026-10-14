#!/usr/bin/env bash
# Teste da troca da chave dos envios pelo fluxo «configurar» (docs/36 §25.7):
# o eurolify-trabalho passa «chave-envios trocar|tirar-anterior» ao
# eurolify-configurar, que chama o eurolify-chave-envios. Troca só com a
# imagem que sabe trocar; tira a anterior só sem contas noutra versão; volta
# o ficheiro anterior se a API não se recriar com o novo; nunca mostra nem
# regista uma chave. Corre como root num contentor Ubuntu descartável (fluxo
# verificar), com um docker e um eurolify-publicar de mentira. Nunca correr
# numa máquina a sério.
set -Eeuo pipefail
[[ "${EUROLIFY_TESTE_DESCARTAVEL:-}" == 1 ]] || { echo "só numa máquina descartável (EUROLIFY_TESTE_DESCARTAVEL=1)" >&2; exit 2; }
repo="$(cd "$(dirname "$0")/../../.." && pwd)"
command -v openssl >/dev/null || { apt-get update -qq >/dev/null && apt-get install -y -qq openssl >/dev/null; }

install -d /usr/local/lib/eurolify /usr/local/sbin /usr/local/bin /etc/eurolify /var/log/eurolify
install -m 644 "$repo/infra/vps/ficheiros/lib/comum.sh" /usr/local/lib/eurolify/comum.sh
install -m 644 "$repo/infra/vps/ficheiros/lib/chave-envios.sh" /usr/local/lib/eurolify/chave-envios.sh
for p in configurar chave-envios; do
  install -m 700 "$repo/infra/vps/ficheiros/sbin/eurolify-$p" "/usr/local/sbin/eurolify-$p"
done
id eurolify-configurar >/dev/null 2>&1 || useradd -r eurolify-configurar
printf 'IMAGEM_REPO=ghcr.io/teste/eurolify\nBASE_NOME=eurolify\n' >/etc/eurolify/ensaio.conf
pasta=/var/lib/eurolify/pedidos/configurar
install -d "$pasta"
ficheiro=/etc/eurolify/api-envios.env
registo=/var/log/eurolify/acoes.log
# shellcheck source=../ficheiros/lib/chave-envios.sh
source /usr/local/lib/eurolify/chave-envios.sh

falhas=0
confere() { # confere <descrição> <comando...>: o comando tem de dar 0
  local descricao="$1"
  shift
  if "$@"; then
    echo "ok   $descricao"
  else
    echo "FALHOU $descricao"
    falhas=$((falhas + 1))
  fi
}
igual() { [ "$1" = "$2" ]; }
contem() { [[ "$1" == *"$2"* ]]; }
# Nenhuma das chaves (nem um pedaço) volta na saída ou fica no registo.
nao_na_saida() { ! grep -qF -- "$1" <<<"$saida"; }
nao_no_registo() { ! grep -qF -- "$1" "$registo"; }
sem_chaves() { # sem_chaves <descrição>
  local k
  while IFS= read -r k; do
    [[ -n "$k" ]] || continue
    confere "a chave não volta na saída: $1" nao_na_saida "${k:0:12}"
    confere "a chave não fica no registo: $1" nao_no_registo "${k:0:12}"
  done < <(sed -n 's/^ENVIOS_CHAVE\(_ANTERIOR\)\{0,1\}=//p' "$ficheiro" /etc/eurolify/api-envios.env.antes-* 2>/dev/null)
}
sem_anterior_na_api() { ! grep -q '^ENVIOS_CHAVE_ANTERIOR' /tmp/api-ambiente; }

saida=""
codigo=0
pedir() { # pedir <acção>: pelo eurolify-trabalho, como a chave do fluxo
  printf 'chave-envios %s run:77 github:1001\n12345678901\n' "$1" >"$pasta/pedido"
  bash "$repo/infra/vps/ficheiros/sbin/eurolify-trabalho" configurar || true
  codigo="$(head -n 1 "$pasta/resultado.12345678901")"
  saida="$(tail -n +2 "$pasta/resultado.12345678901")"
  rm -f "$pasta"/resultado.*
}

# O docker de mentira: a imagem e o ambiente do eurolify-api em /tmp/api-*;
# «run … grep» diz se a imagem sabe trocar (/tmp/imagem-sabe); «exec … psql»
# devolve /tmp/contas-noutra-versao.
resumo="sha256:$(printf 'a%.0s' {1..64})"
cat >/usr/local/bin/docker <<'FIM'
#!/usr/bin/env bash
if [[ "$1 $2 $3" == "inspect -f {{.Config.Image}}" ]]; then cat /tmp/api-imagem; exit; fi
if [[ "$1 $2" == "inspect -f" && "$3" == *Config.Env* ]]; then cat /tmp/api-ambiente 2>/dev/null; exit; fi
if [[ "$1" == run && "$*" == *ENVIOS_CHAVE_ANTERIOR* ]]; then [[ -f /tmp/imagem-sabe ]]; exit; fi
if [[ "$1" == exec && "$*" == *psql* ]]; then cat /tmp/contas-noutra-versao; exit; fi
exit 1
FIM
chmod 755 /usr/local/bin/docker
# O eurolify-publicar de mentira: «recria» a API com o api-envios.env no
# ambiente, ou falha com /tmp/publicar-falha.
cat >/usr/local/sbin/eurolify-publicar <<'FIM'
#!/usr/bin/env bash
printf '%s\n' "$*" >>/tmp/publicar-chamadas
[[ -f /tmp/publicar-falha ]] && exit 1
{ printf 'PATH=/x\n'; cat /etc/eurolify/api-envios.env; } >/tmp/api-ambiente
FIM
chmod 755 /usr/local/sbin/eurolify-publicar
printf 'ghcr.io/teste/eurolify@%s' "$resumo" >/tmp/api-imagem
gerar_chave_envios "$ficheiro"
{ printf 'PATH=/x\n'; cat "$ficheiro"; } >/tmp/api-ambiente
echo 0 >/tmp/contas-noutra-versao
k1="$(sed -n 's/^ENVIOS_CHAVE=//p' "$ficheiro")"
inicial="$(cat "$ficheiro")"

# 1. Uma imagem que não sabe trocar: recusado, nada muda.
pedir trocar
confere "imagem antiga: recusado (65) ($codigo)" igual "$codigo" 65
confere "imagem antiga: diz porquê" contem "$saida" "ainda não sabe trocar"
confere "imagem antiga: o ficheiro fica" igual "$(cat "$ficheiro")" "$inicial"

# 2. Trocar: a nova na versão 2, a anterior na 1; a API recria-se com as duas.
touch /tmp/imagem-sabe
pedir trocar
confere "trocar dá 0 ($codigo)" igual "$codigo" 0
confere "trocar: versão 2 e anterior 1" igual "$(chave_envios_versao "$ficheiro") $(chave_envios_versao_anterior "$ficheiro")" "2 1"
confere "trocar: a anterior é a que estava" igual "$(sed -n 's/^ENVIOS_CHAVE_ANTERIOR=//p' "$ficheiro")" "$k1"
confere "trocar: 600 e de root" igual "$(stat -c '%a %U' "$ficheiro")" "600 root"
confere "trocar: há a cópia do ficheiro de antes" igual "$(cat /etc/eurolify/api-envios.env.antes-*)" "$inicial"
confere "trocar: a API recriou-se com --so-recriar" grep -qF -- "$resumo --so-recriar" /tmp/publicar-chamadas
confere "trocar: a API corre com a anterior" grep -q '^ENVIOS_CHAVE_ANTERIOR=' /tmp/api-ambiente
confere "trocar: lembra a cópia fora da máquina" contem "$saida" "fora da máquina"
confere "trocar: o registo diz a versão e a execução" grep -qF "chave-envios: trocada para a versão 2 (run:77)" "$registo"
sem_chaves "trocar"
depois_de_trocar="$(cat "$ficheiro")"

# 3. Trocar outra vez com a troca a meio: recusado.
pedir trocar
confere "troca a meio: recusado (65)" igual "$codigo" 65
confere "troca a meio: o ficheiro fica" igual "$(cat "$ficheiro")" "$depois_de_trocar"

# 4. Tirar a anterior com contas noutra versão: recusado, e diz quantas.
echo 3 >/tmp/contas-noutra-versao
pedir tirar-anterior
confere "contas por passar: recusado (65)" igual "$codigo" 65
confere "contas por passar: diz quantas" contem "$saida" "ainda há 3 contas"
confere "contas por passar: o ficheiro fica" igual "$(cat "$ficheiro")" "$depois_de_trocar"

# 5. A API não se recria com o ficheiro novo: volta o anterior.
echo 0 >/tmp/contas-noutra-versao
touch /tmp/publicar-falha
pedir tirar-anterior
confere "recriação falhada: dá erro" igual "$codigo" 1
confere "recriação falhada: volta o ficheiro de antes" igual "$(cat "$ficheiro")" "$depois_de_trocar"
confere "recriação falhada: diz que voltou" contem "$saida" "voltou o anterior"
rm -f /tmp/publicar-falha
{ printf 'PATH=/x\n'; cat "$ficheiro"; } >/tmp/api-ambiente

# 6. Tirar a anterior sem contas noutra versão: fica só a actual.
pedir tirar-anterior
confere "tirar dá 0 ($codigo)" igual "$codigo" 0
confere "tirar: duas linhas, versão 2" igual "$(wc -l <"$ficheiro") $(chave_envios_versao "$ficheiro")" "2 2"
confere "tirar: a API já não tem a anterior" sem_anterior_na_api
sem_chaves "tirar"

# 7. Tirar outra vez: não há anterior.
pedir tirar-anterior
confere "sem anterior: recusado (65)" igual "$codigo" 65

# 8. Fora do formato: o serviço recusa antes.
printf 'chave-envios apagar run:77 github:1001\n12345678901\n' >"$pasta/pedido"
bash "$repo/infra/vps/ficheiros/sbin/eurolify-trabalho" configurar || true
confere "outra acção: recusada (65)" igual "$(head -n 1 "$pasta/resultado.12345678901")" 65
rm -f "$pasta"/resultado.*

((falhas == 0))
