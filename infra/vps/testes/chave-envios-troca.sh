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

install -d /usr/local/lib/eurolify /usr/local/sbin /usr/local/bin /etc/eurolify /var/log/eurolify /run/lock
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
# conta as contas de uma versão (/tmp/contas-<versão>, 0 por omissão) ou das
# outras (/tmp/contas-outras).
resumo="sha256:$(printf 'a%.0s' {1..64})"
cat >/usr/local/bin/docker <<'FIM'
#!/usr/bin/env bash
if [[ "$1 $2 $3" == "inspect -f {{.Config.Image}}" ]]; then cat /tmp/api-imagem; exit; fi
if [[ "$1 $2" == "inspect -f" && "$3" == *Config.Env* ]]; then cat /tmp/api-ambiente 2>/dev/null; exit; fi
if [[ "$1" == run && "$*" == *ENVIOS_CHAVE_ANTERIOR* ]]; then [[ -f /tmp/imagem-sabe ]]; exit; fi
if [[ "$1" == exec && "$*" == *psql* ]]; then
  sql="${*: -1}"
  if [[ "$sql" == *"not in"* ]]; then cat /tmp/contas-outras 2>/dev/null || echo 0; exit; fi
  [[ "$sql" =~ chave_versao\ =\ \'([0-9A-Za-z_-]+)\' ]] || exit 1
  cat "/tmp/contas-${BASH_REMATCH[1]}" 2>/dev/null || echo 0
  exit
fi
exit 1
FIM
chmod 755 /usr/local/bin/docker
# O /health de mentira (em baixo com /tmp/api-em-baixo) e um sleep que não
# espera.
printf '#!/usr/bin/env bash\n[[ ! -f /tmp/api-em-baixo ]]\n' >/usr/local/bin/curl
printf '#!/usr/bin/env bash\nexit 0\n' >/usr/local/bin/sleep
chmod 755 /usr/local/bin/curl /usr/local/bin/sleep
# O eurolify-publicar de mentira, com a regra do verdadeiro (api_env_mudou):
# só recria se o api-envios.env é mais novo do que o contentor. Com
# /tmp/publicar-falha não recria e sai com 1; com /tmp/publicar-mcp-falha
# recria mas sai com 1 (só o MCP ou o Hub falharam).
cat >/usr/local/sbin/eurolify-publicar <<'FIM'
#!/usr/bin/env bash
printf '%s\n' "$*" >>/tmp/publicar-chamadas
[[ -f /tmp/publicar-falha ]] && exit 1
if [[ /etc/eurolify/api-envios.env -nt /tmp/api-criado ]]; then
  { printf 'PATH=/x\n'; cat /etc/eurolify/api-envios.env; } >/tmp/api-ambiente
  touch /tmp/api-criado
fi
[[ -f /tmp/publicar-mcp-falha ]] && exit 1
exit 0
FIM
chmod 755 /usr/local/sbin/eurolify-publicar
printf 'ghcr.io/teste/eurolify@%s' "$resumo" >/tmp/api-imagem
gerar_chave_envios "$ficheiro"
{ printf 'PATH=/x\n'; cat "$ficheiro"; } >/tmp/api-ambiente
touch /tmp/api-criado
k1="$(sed -n 's/^ENVIOS_CHAVE=//p' "$ficheiro")"
inicial="$(cat "$ficheiro")"
anda() { touch -d '-5 seconds' /tmp/api-criado; } # o contentor é mais velho
limpar_copias() { rm -f /etc/eurolify/api-envios.env.antes-* /etc/eurolify/api-envios.env.descartado-*; }

# 1. Uma imagem que não sabe trocar: recusado, nada muda.
pedir trocar
confere "imagem antiga: recusado (65) ($codigo)" igual "$codigo" 65
confere "imagem antiga: diz porquê" contem "$saida" "ainda não sabe trocar"
confere "imagem antiga: o ficheiro fica" igual "$(cat "$ficheiro")" "$inicial"

# 2. Uma publicação em curso: recusado, nada muda.
touch /tmp/imagem-sabe
exec 7>/run/lock/eurolify-publicar.lock
flock 7
pedir trocar
flock -u 7
exec 7>&-
confere "publicação em curso: recusado (65)" igual "$codigo" 65
confere "publicação em curso: diz porquê" contem "$saida" "publicação em curso"
confere "publicação em curso: o ficheiro fica" igual "$(cat "$ficheiro")" "$inicial"

# 3. A versão nova já está na base (outra chave com o mesmo número): recusado.
echo 4 >/tmp/contas-2
pedir trocar
confere "versão nova na base: recusado (65)" igual "$codigo" 65
confere "versão nova na base: diz quantas" contem "$saida" "já há 4 contas marcadas com a versão 2"
rm -f /tmp/contas-2

# 4. Trocar: a nova na versão 2, a anterior na 1; a API recria-se com as duas.
anda
pedir trocar
confere "trocar dá 0 ($codigo)" igual "$codigo" 0
confere "trocar: versão 2 e anterior 1" igual "$(chave_envios_versao "$ficheiro") $(chave_envios_versao_anterior "$ficheiro")" "2 1"
confere "trocar: a anterior é a que estava" igual "$(sed -n 's/^ENVIOS_CHAVE_ANTERIOR=//p' "$ficheiro")" "$k1"
confere "trocar: 600 e de root" igual "$(stat -c '%a %U' "$ficheiro")" "600 root"
confere "trocar: há a cópia do ficheiro de antes" igual "$(cat /etc/eurolify/api-envios.env.antes-*)" "$inicial"
confere "trocar: a cópia é 600 e de root" igual "$(stat -c '%a %U' /etc/eurolify/api-envios.env.antes-*)" "600 root"
confere "trocar: a API recriou-se com --so-recriar" grep -qF -- "$resumo --so-recriar" /tmp/publicar-chamadas
confere "trocar: a API corre com a anterior" grep -q '^ENVIOS_CHAVE_ANTERIOR=' /tmp/api-ambiente
confere "trocar: lembra a cópia fora da máquina" contem "$saida" "fora da máquina"
confere "trocar: o registo diz a versão e a execução" grep -qF "chave-envios: trocada para a versão 2 (run:77)" "$registo"
sem_chaves "trocar"
depois_de_trocar="$(cat "$ficheiro")"
limpar_copias

# 5. Trocar outra vez com a troca a meio: recusado.
pedir trocar
confere "troca a meio: recusado (65)" igual "$codigo" 65
confere "troca a meio: o ficheiro fica" igual "$(cat "$ficheiro")" "$depois_de_trocar"

# 6. Tirar a anterior com contas nela: recusado, e diz quantas.
echo 3 >/tmp/contas-1
pedir tirar-anterior
confere "contas na anterior: recusado (65)" igual "$codigo" 65
confere "contas na anterior: diz quantas" contem "$saida" "ainda há 3 contas na versão anterior (1)"
confere "contas na anterior: o ficheiro fica" igual "$(cat "$ficheiro")" "$depois_de_trocar"
rm -f /tmp/contas-1

# 7. A API não se recria com o ficheiro novo: volta o anterior, com a data
# de agora (a recriação a sério compara as datas), e a API com ele; o novo
# fica guardado.
anda
touch /tmp/publicar-falha
pedir tirar-anterior
rm -f /tmp/publicar-falha
confere "recriação falhada: dá erro" igual "$codigo" 1
confere "recriação falhada: volta o ficheiro de antes" igual "$(cat "$ficheiro")" "$depois_de_trocar"
confere "recriação falhada: diz que voltou" contem "$saida" "voltou o anterior"
tem_descartado() { compgen -G "/etc/eurolify/api-envios.env.descartado-*" >/dev/null; }
confere "recriação falhada: o novo ficou guardado" tem_descartado
limpar_copias

# 8. A recriação falha depois de uma troca, sem contas na chave nova: volta
# o ficheiro de antes (a chave nova ainda não cifrou nada).
anda
printf 'ENVIOS_CHAVE=%s\nENVIOS_CHAVE_VERSAO=1\n' "$k1" >"$ficheiro"
chmod 600 "$ficheiro"
{ printf 'PATH=/x\n'; cat "$ficheiro"; } >/tmp/api-ambiente
anda
touch /tmp/publicar-falha
pedir trocar
rm -f /tmp/publicar-falha
confere "troca sem recriação: dá erro" igual "$codigo" 1
confere "troca sem recriação, sem contas na nova: volta o anterior" contem "$saida" "voltou o anterior"
confere "e o ficheiro é o de antes (versão 1, sem anterior)" igual "$(cat "$ficheiro")" "$(printf 'ENVIOS_CHAVE=%s\nENVIOS_CHAVE_VERSAO=1' "$k1")"
limpar_copias

# 9. O MCP ou o Hub falham na recriação, mas a API corre com o ficheiro: feito.
anda
touch /tmp/publicar-mcp-falha
pedir trocar
rm -f /tmp/publicar-mcp-falha
confere "MCP falhou, API bem: dá 0 ($codigo)" igual "$codigo" 0
confere "MCP falhou, API bem: avisa" contem "$saida" "o MCP ou o Hub não ficaram bem"
confere "MCP falhou, API bem: o ficheiro novo fica" igual "$(chave_envios_versao "$ficheiro")" 2
limpar_copias

# 10. A API corre com o ficheiro novo mas não responde, e já há contas na
# versão nova: não se volta atrás.
anda
printf 'ENVIOS_CHAVE=%s\nENVIOS_CHAVE_VERSAO=7\n' "$k1" >"$ficheiro"
chmod 600 "$ficheiro"
anda
touch /tmp/api-em-baixo
echo 0 >/tmp/contas-8
pedir trocar
confere "troca, API em baixo, sem contas na 8: volta" contem "$saida" "voltou o anterior"
confere "e diz que a API não está no ar" contem "$saida" "API em baixo"
limpar_copias
anda
printf 'ENVIOS_CHAVE=%s\nENVIOS_CHAVE_VERSAO=7\n' "$k1" >"$ficheiro"
chmod 600 "$ficheiro"
anda
# Com contas já na 8 depois de escrever: a contagem antes da troca também
# as via e recusava; simula-se a volta a correr entre as duas com um docker
# que passa a responder 5 depois da primeira pergunta.
cat >/usr/local/bin/docker-original <<<"$(cat /usr/local/bin/docker)"
chmod 755 /usr/local/bin/docker-original
cat >/usr/local/bin/docker <<'FIM'
#!/usr/bin/env bash
if [[ "$1" == exec && "$*" == *"chave_versao = '8'"* ]]; then
  if [[ -f /tmp/ja-perguntou ]]; then echo 5; else touch /tmp/ja-perguntou; echo 0; fi
  exit
fi
exec /usr/local/bin/docker-original "$@"
FIM
chmod 755 /usr/local/bin/docker
pedir trocar
confere "troca, API em baixo, contas na nova: dá erro" igual "$codigo" 1
confere "troca, API em baixo, contas na nova: o ficheiro novo fica" igual "$(chave_envios_versao "$ficheiro")" 8
confere "e diz porquê" contem "$saida" "já há contas cifradas com a chave nova (5)"
rm -f /tmp/api-em-baixo /tmp/ja-perguntou
mv -f /usr/local/bin/docker-original /usr/local/bin/docker
limpar_copias

# 11. Tirar a anterior sem contas nela: fica só a actual; as de uma terceira
# versão só se avisam.
{ printf 'PATH=/x\n'; cat "$ficheiro"; } >/tmp/api-ambiente
anda
echo 2 >/tmp/contas-outras
pedir tirar-anterior
confere "tirar dá 0 ($codigo)" igual "$codigo" 0
confere "tirar: avisa das contas numa terceira versão" contem "$saida" "2 contas estão noutra versão"
confere "tirar: duas linhas, versão 8" igual "$(wc -l <"$ficheiro") $(chave_envios_versao "$ficheiro")" "2 8"
confere "tirar: a API já não tem a anterior" sem_anterior_na_api
sem_chaves "tirar"
rm -f /tmp/contas-outras
limpar_copias

# 12. Tirar outra vez: não há anterior.
pedir tirar-anterior
confere "sem anterior: recusado (65)" igual "$codigo" 65

# 13. Fora do formato: o serviço recusa antes.
printf 'chave-envios apagar run:77 github:1001\n12345678901\n' >"$pasta/pedido"
bash "$repo/infra/vps/ficheiros/sbin/eurolify-trabalho" configurar || true
confere "outra acção: recusada (65)" igual "$(head -n 1 "$pasta/resultado.12345678901")" 65
rm -f "$pasta"/resultado.*

((falhas == 0))
