#!/usr/bin/env bash
# Teste do fluxo «configurar» (docs/34 §13): o eurolify-trabalho e o
# eurolify-configurar validam os cinco valores do e-mail, escrevem o
# api-smtp.env (600, root) e nunca mostram nem registam a palavra-passe.
# Corre como root num contentor Ubuntu descartável (fluxo verificar), sem
# docker a sério: um docker e um eurolify-publicar de mentira simulam a API
# no ar e a recriação. Nunca correr numa máquina a sério.
set -Eeuo pipefail
[[ "${EUROLIFY_TESTE_DESCARTAVEL:-}" == 1 ]] || { echo "só numa máquina descartável (EUROLIFY_TESTE_DESCARTAVEL=1)" >&2; exit 2; }
repo="$(cd "$(dirname "$0")/../../.." && pwd)"

install -d /usr/local/lib/eurolify /usr/local/sbin /etc/eurolify /var/log/eurolify
install -m 644 "$repo/infra/vps/ficheiros/lib/comum.sh" /usr/local/lib/eurolify/comum.sh
install -m 700 "$repo/infra/vps/ficheiros/sbin/eurolify-configurar" /usr/local/sbin/eurolify-configurar
id eurolify-configurar >/dev/null 2>&1 || useradd -r eurolify-configurar
printf 'IMAGEM_REPO=ghcr.io/teste/eurolify\n' >/etc/eurolify/ensaio.conf
pasta=/var/lib/eurolify/pedidos/configurar
install -d "$pasta"
ficheiro=/etc/eurolify/api-smtp.env
registo=/var/log/eurolify/acoes.log
# shellcheck disable=SC2016 # o «$» e as plicas são parte da palavra-passe
SEGREDO='p4ss "com" $aspas;&|`e`'"'"'+=/'

dados() { # dados <anfitrião> <porta> <utilizador> <palavra-passe> <remetente>
  printf '%s\n%s\n%s\n%s\n%s' "$@" | base64 -w0
}

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
sem_texto() { ! grep -qF -- "$1" <<<"$2"; }
sem_no_registo() { ! grep -qF -- "$1" "$registo"; }
# O pedido completo, como a acção do GitHub o entrega.
pedido_de() { printf 'smtp %s run:77 github:1001' "$1"; }
# Nem o base64 nem um pedaço dele voltam na saída ou ficam no registo
# (revisão do #398, P2-2).
sem_dados() { # sem_dados <base64> <descrição>
  confere "o base64 não volta na saída: $2" sem_texto "${1:0:16}" "$saida"
  confere "o base64 não fica no registo: $2" sem_no_registo "${1:0:16}"
}

saida=""
codigo=0
pedir() { # pedir <pedido>: pelo eurolify-trabalho, como a chave do fluxo
  printf '%s\n12345678901\n' "$1" >"$pasta/pedido"
  bash "$repo/infra/vps/ficheiros/sbin/eurolify-trabalho" configurar || true
  codigo="$(head -n 1 "$pasta/resultado.12345678901")"
  saida="$(tail -n +2 "$pasta/resultado.12345678901")"
  rm -f "$pasta"/resultado.*
}

# 1. Um pedido certo escreve o ficheiro, 600 e de root, com os cinco valores.
certo="$(dados pro1.mail.ovh.net 587 avisos@eurolify.eu "$SEGREDO" avisos@eurolify.eu)"
pedir "$(pedido_de "$certo")"
confere "um pedido certo dá 0 ($codigo)" igual "$codigo" 0
sem_dados "$certo" "pedido certo"
confere "o api-smtp.env é 600 e de root" igual "$(stat -c '%a %U' "$ficheiro")" "600 root"
esperado="$(printf 'SMTP_ANFITRIAO=pro1.mail.ovh.net\nSMTP_PORTA=587\nSMTP_UTILIZADOR=avisos@eurolify.eu\nSMTP_PALAVRA_PASSE=%s\nSMTP_REMETENTE=avisos@eurolify.eu' "$SEGREDO")"
confere "o ficheiro tem os cinco valores, a palavra-passe inteira" igual "$(cat "$ficheiro")" "$esperado"
confere "sem a API no ar, diz que a próxima publicação a lê" contem "$saida" "Sem contentor eurolify-api"
confere "a palavra-passe não volta na saída" sem_texto p4ss "$saida"
confere "a palavra-passe não fica no registo" sem_no_registo p4ss
confere "o registo diz só «smtp» e a execução" grep -qF "'smtp' (77 github:1001) tratado, código 0" "$registo"
confere "o registo diz a conta de quem lançou" grep -qF "fluxo configurar, conta 1001" "$registo"

# 2. O mesmo outra vez não muda nada.
antes="$(stat -c %Y "$ficheiro")"
sleep 1
pedir "$(pedido_de "$certo")"
confere "o mesmo pedido dá 0" igual "$codigo" 0
confere "o mesmo pedido não muda o ficheiro" contem "$saida" "o ficheiro não muda"
confere "o ficheiro não se reescreve" igual "$(stat -c %Y "$ficheiro")" "$antes"

# 3. Recusas: o ficheiro fica como estava.
recusa() { # recusa <pedido> <descrição>
  pedir "$1"
  sem_dados "${1#smtp }" "$2"
  confere "recusado (65): $2" igual "$codigo" 65
  confere "nada mudou: $2" igual "$(cat "$ficheiro")" "$esperado"
  confere "a palavra-passe recusada não volta na saída: $2" sem_texto segredo-recusado "$saida"
  confere "a palavra-passe recusada não fica no registo: $2" sem_no_registo segredo-recusado
}
recusa "$(pedido_de "$(dados pro1.mail.ovh.net 25 avisos@eurolify.eu segredo-recusado avisos@eurolify.eu)")" "porta 25"
recusa "$(pedido_de "$(dados 'pro1.mail.ovh.net;rm' 587 avisos@eurolify.eu segredo-recusado avisos@eurolify.eu)")" "anfitrião com «;»"
recusa "$(pedido_de "$(dados pro1.mail.ovh.net 587 'a@b.pt,c@d.pt' segredo-recusado avisos@eurolify.eu)")" "utilizador com vírgula"
recusa "$(pedido_de "$(dados pro1.mail.ovh.net 587 avisos@eurolify.eu segredo-recusado 'Avisos <avisos@eurolify.eu>')")" "remetente com nome"
recusa "$(pedido_de "$(dados pro1.mail.ovh.net 587 avisos@eurolify.eu "$(printf 'segredo-recusado\tx')" avisos@eurolify.eu)")" "palavra-passe com tabulação"
recusa "$(pedido_de "$(dados pro1.mail.ovh.net 587 avisos@eurolify.eu ' segredo-recusado' avisos@eurolify.eu)")" "palavra-passe com espaço à frente"
recusa "$(pedido_de "$(printf 'a\n587\nsegredo-recusado' | base64 -w0)")" "três linhas em vez de cinco"
recusa "$(pedido_de "$(printf 'a\nb\nc\nsegredo-recusado\nd\ne' | base64 -w0)")" "seis linhas (uma palavra-passe com mudança de linha)"
recusa "$(pedido_de abc)" "base64 com a forma certa que não se desfaz"
recusa "smtp $(dados pro1.mail.ovh.net 587 avisos@eurolify.eu segredo-recusado avisos@eurolify.eu)" "sem a execução e a conta"
# Fora do formato: o serviço recusa antes de chamar o eurolify-configurar.
recusa "smtp não-é-base64" "texto que não é base64"
recusa "outra coisa" "outra acção"

# 4. O pedido nunca vai como argumento (revisão do #398, P1-1): o programa
# recusa-o, e o serviço passa-o pela entrada (o caso 1 já o prova).
saida="$(/usr/local/sbin/eurolify-configurar "$(pedido_de "$certo")" </dev/null 2>&1)" && codigo=0 || codigo=$?
confere "o pedido como argumento é recusado (65)" igual "$codigo" 65
confere "o pedido como argumento: nada mudou" igual "$(cat "$ficheiro")" "$esperado"

# 5. Com a API no ar (um docker e um eurolify-publicar de mentira): a
# recriação só se diz feita se o contentor tem mesmo os valores
# (revisão do #398, P2-1).
resumo="sha256:$(printf 'a%.0s' {1..64})"
cat >/usr/local/bin/docker <<'FIM'
#!/usr/bin/env bash
# docker de mentira: inspect do eurolify-api, a partir de /tmp/api-*.
if [[ "$1 $2 $3" == "inspect -f {{.Config.Image}}" ]]; then cat /tmp/api-imagem; exit; fi
if [[ "$1 $2" == "inspect -f" && "$3" == *Config.Env* ]]; then cat /tmp/api-ambiente 2>/dev/null; exit; fi
exit 1
FIM
chmod 755 /usr/local/bin/docker
cat >/usr/local/sbin/eurolify-publicar <<'FIM'
#!/usr/bin/env bash
# eurolify-publicar de mentira: regista a chamada e, se /tmp/publicar-recria
# existir, «recria» a API com o api-smtp.env no ambiente.
printf '%s\n' "$*" >>/tmp/publicar-chamadas
[[ -f /tmp/publicar-recria ]] && { printf 'PATH=/x\n'; cat /etc/eurolify/api-smtp.env; } >/tmp/api-ambiente
exit "$(cat /tmp/publicar-codigo 2>/dev/null || echo 0)"
FIM
chmod 755 /usr/local/sbin/eurolify-publicar
printf 'ghcr.io/teste/eurolify@%s' "$resumo" >/tmp/api-imagem
printf 'PATH=/x\n' >/tmp/api-ambiente
: >/tmp/publicar-chamadas

# 5a. O ficheiro igual, a API sem ele: lançar outra vez recria.
touch /tmp/publicar-recria
pedir "$(pedido_de "$certo")"
confere "API sem os valores: recria-se e diz que corre com eles (0)" igual "$codigo" 0
confere "API sem os valores: chamou o --so-recriar" grep -qxF "$resumo --so-recriar" /tmp/publicar-chamadas
confere "API sem os valores: a mensagem diz que se recriou" contem "$saida" "recriou-se e corre com a configuração"
sem_dados "$certo" "recriação"
# 5b. Outra vez: já corre com eles, não recria.
: >/tmp/publicar-chamadas
pedir "$(pedido_de "$certo")"
confere "API já com os valores: 0 sem recriar" igual "$codigo|$(wc -l </tmp/publicar-chamadas)" "0|0"
confere "API já com os valores: diz que já corre com eles" contem "$saida" "já corre com esta configuração"
# 5c. A recriação que não recria (outra publicação trocou a imagem): 1.
rm -f /tmp/publicar-recria
printf 'PATH=/x\n' >/tmp/api-ambiente
pedir "$(pedido_de "$certo")"
confere "recriação que não recria: 1" igual "$codigo" 1
confere "recriação que não recria: pede para lançar outra vez" contem "$saida" "Lance a acção outra vez"
# 5d. A recriação que falha: 1, sem culpar só a API.
echo 1 >/tmp/publicar-codigo
pedir "$(pedido_de "$certo")"
confere "recriação que falha: 1" igual "$codigo" 1
confere "recriação que falha: a API, o MCP ou o Hub" contem "$saida" "a API, o MCP ou o Hub"
rm -f /tmp/publicar-codigo
# 5e. Uma imagem de outro repositório não se recria.
: >/tmp/publicar-chamadas
printf 'ghcr.io/outro/eurolify@%s' "$resumo" >/tmp/api-imagem
pedir "$(pedido_de "$certo")"
confere "imagem de outro repositório: 1 sem recriar" igual "$codigo|$(wc -l </tmp/publicar-chamadas)" "1|0"
confere "nenhuma mensagem leva a palavra-passe" sem_no_registo p4ss

# 6. O e-mail de teste (docs/34 §13.1): «teste run:<n> github:<conta>», com o
# api-smtp.env que já está na máquina, num contentor de uma vez com a imagem
# no ar. O docker de mentira responde ao «run» a partir de /tmp/teste-*.
cat >/usr/local/bin/docker <<'FIM'
#!/usr/bin/env bash
# docker de mentira: inspect do eurolify-api, e o «run» do e-mail de teste.
if [[ "$1 $2 $3" == "inspect -f {{.Config.Image}}" ]]; then cat /tmp/api-imagem; exit; fi
if [[ "$1 $2" == "inspect -f" && "$3" == *Config.Env* ]]; then cat /tmp/api-ambiente 2>/dev/null; exit; fi
if [[ "$1" == run && " $* " == *" --entrypoint test "* ]]; then [[ -f /tmp/teste-imagem-tem ]]; exit; fi
if [[ "$1" == run && " $* " == *" node dist/testar-correio.js "* ]]; then
  printf '%s\n' "$*" >/tmp/teste-chamada
  cat /tmp/teste-saida
  exit "$(cat /tmp/teste-codigo)"
fi
exit 1
FIM
chmod 755 /usr/local/bin/docker
printf 'ghcr.io/teste/eurolify@%s' "$resumo" >/tmp/api-imagem
teste_pedido='teste run:88 github:1001'
# A API no ar com o ficheiro (as cinco linhas no ambiente do contentor).
{ printf 'PATH=/x\n'; cat "$ficheiro"; } >/tmp/api-ambiente

# 6a. A imagem no ar ainda sem o teste: 1, sem correr nada.
rm -f /tmp/teste-imagem-tem /tmp/teste-chamada
pedir "$teste_pedido"
confere "imagem sem o teste: 1" igual "$codigo" 1
confere "imagem sem o teste: pede para publicar" contem "$saida" "publicar primeiro"
confere "imagem sem o teste: não correu o envio" igual "$([[ -e /tmp/teste-chamada ]] && echo sim || echo nao)" nao

# 6a2. A API não corre com o ficheiro (a recriação de um «configurar»
# falhou): 1, sem enviar (revisão do #410, P2-1).
touch /tmp/teste-imagem-tem
printf 'PATH=/x\n' >/tmp/api-ambiente
pedir "$teste_pedido"
confere "API sem o ficheiro: 1" igual "$codigo" 1
confere "API sem o ficheiro: pede o «configurar»" contem "$saida" "lance a acção com «configurar» primeiro"
confere "API sem o ficheiro: não correu o envio" igual "$([[ -e /tmp/teste-chamada ]] && echo sim || echo nao)" nao
{ printf 'PATH=/x\n'; cat "$ficheiro"; } >/tmp/api-ambiente

# 6b. Aceite: 0, a linha do resultado, e o contentor só com o api-smtp.env.
touch /tmp/teste-imagem-tem
printf '{"enviado":true,"id":"<abc-1.2@eurolify.eu>"}\n' >/tmp/teste-saida
echo 0 >/tmp/teste-codigo
antes="$(stat -c %Y "$ficheiro")"
pedir "$teste_pedido"
confere "teste aceite: 0 ($codigo)" igual "$codigo" 0
confere "teste aceite: mostra o resultado" contem "$saida" '{"enviado":true,"id":"<abc-1.2@eurolify.eu>"}'
confere "teste aceite: com o api-smtp.env e a execução" \
  contem "$(cat /tmp/teste-chamada)" "--env-file $ficheiro"
confere "teste aceite: a execução vai ao programa" contem "$(cat /tmp/teste-chamada)" "dist/testar-correio.js run:88"
confere "teste aceite: a palavra-passe não vai na linha de comandos" sem_texto p4ss "$(cat /tmp/teste-chamada)"
# As protecções do contentor (revisão do #410, P3-2).
for opcao in "--cap-drop ALL" "--security-opt no-new-privileges" "--read-only" \
  "--tmpfs /tmp" "--memory 256m" "--pids-limit 64" "--pull=never" "--rm"; do
  confere "teste aceite: o contentor com $opcao" contem "$(cat /tmp/teste-chamada)" " $opcao "
done
confere "teste aceite: o ficheiro não muda" igual "$(stat -c %Y "$ficheiro")" "$antes"
confere "teste aceite: o registo diz «teste» e a execução" grep -qF "'teste' (88 github:1001) tratado, código 0" "$registo"

# 6c. Recusado pelo servidor: 1, com o código, e uma saída fora da forma não
# passa (o programa nunca escreve os valores, mas a máquina não confia).
printf '{"enviado":false,"codigo":"smtp_535","culpa":"servidor"}\n' >/tmp/teste-saida
echo 1 >/tmp/teste-codigo
pedir "$teste_pedido"
confere "teste recusado: 1" igual "$codigo" 1
confere "teste recusado: mostra o código" contem "$saida" '"codigo":"smtp_535"'
printf 'SMTP_PALAVRA_PASSE=%s\n' "$SEGREDO" >/tmp/teste-saida
pedir "$teste_pedido"
confere "saída fora da forma: 1" igual "$codigo" 1
confere "saída fora da forma: não a mostra" sem_texto p4ss "$saida"
confere "saída fora da forma: diz que não se leu" contem "$saida" "sem resultado legível"
# Um 0 sem resultado legível não é «aceite» (revisão do #410, P3-4).
echo 0 >/tmp/teste-codigo
pedir "$teste_pedido"
confere "0 sem resultado legível: 1" igual "$codigo" 1
confere "0 sem resultado legível: não diz aceite" sem_texto "aceite pelo servidor" "$saida"
# Pelo serviço, um «teste» fora da forma é recusado antes do programa
# (revisão do #410, P3-3).
rm -f /tmp/teste-chamada
pedir "teste run:88"
confere "teste sem a conta: recusado pelo serviço (65)" igual "$codigo" 65
confere "teste sem a conta: não correu o envio" igual "$([[ -e /tmp/teste-chamada ]] && echo sim || echo nao)" nao

# 6d. Sem a API no ar, ou sem configuração: 1 e 65, sem correr nada.
rm -f /tmp/teste-chamada
: >/tmp/api-imagem
pedir "$teste_pedido"
confere "sem a API no ar: 1" igual "$codigo" 1
confere "sem a API no ar: não correu o envio" igual "$([[ -e /tmp/teste-chamada ]] && echo sim || echo nao)" nao
printf 'ghcr.io/teste/eurolify@%s' "$resumo" >/tmp/api-imagem
mv "$ficheiro" /tmp/api-smtp.guardado
pedir "$teste_pedido"
confere "sem configuração: recusado (65)" igual "$codigo" 65
confere "sem configuração: não correu o envio" igual "$([[ -e /tmp/teste-chamada ]] && echo sim || echo nao)" nao
mv /tmp/api-smtp.guardado "$ficheiro"
confere "o teste nunca deixa a palavra-passe no registo" sem_no_registo p4ss

echo
if ((falhas > 0)); then
  echo "$falhas verificação(ões) falharam"
  exit 1
fi
echo "todas as verificações passaram"
