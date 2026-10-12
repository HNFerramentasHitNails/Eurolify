#!/usr/bin/env bash
# Teste do fluxo «configurar» (docs/34 §13): o eurolify-trabalho e o
# eurolify-configurar validam os cinco valores do e-mail, escrevem o
# api-smtp.env (600, root) e nunca mostram nem registam a palavra-passe.
# Corre como root num contentor Ubuntu descartável (fluxo verificar), sem
# docker (sem contentor da API). Nunca correr numa máquina a sério.
set -Eeuo pipefail
[[ "${EUROLIFY_TESTE_DESCARTAVEL:-}" == 1 ]] || { echo "só numa máquina descartável (EUROLIFY_TESTE_DESCARTAVEL=1)" >&2; exit 2; }
repo="$(cd "$(dirname "$0")/../../.." && pwd)"

install -d /usr/local/lib/eurolify /usr/local/sbin /etc/eurolify /var/log/eurolify
install -m 644 "$repo/infra/vps/ficheiros/lib/comum.sh" /usr/local/lib/eurolify/comum.sh
install -m 700 "$repo/infra/vps/ficheiros/sbin/eurolify-configurar" /usr/local/sbin/eurolify-configurar
id eurolify-configurar >/dev/null 2>&1 || useradd -r eurolify-configurar
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
pedir "smtp $(dados pro1.mail.ovh.net 587 avisos@eurolify.eu "$SEGREDO" avisos@eurolify.eu)"
confere "um pedido certo dá 0 ($codigo)" igual "$codigo" 0
confere "o api-smtp.env é 600 e de root" igual "$(stat -c '%a %U' "$ficheiro")" "600 root"
esperado="$(printf 'SMTP_ANFITRIAO=pro1.mail.ovh.net\nSMTP_PORTA=587\nSMTP_UTILIZADOR=avisos@eurolify.eu\nSMTP_PALAVRA_PASSE=%s\nSMTP_REMETENTE=avisos@eurolify.eu' "$SEGREDO")"
confere "o ficheiro tem os cinco valores, a palavra-passe inteira" igual "$(cat "$ficheiro")" "$esperado"
confere "sem a API no ar, diz que a próxima publicação a lê" contem "$saida" "Sem contentor eurolify-api"
confere "a palavra-passe não volta na saída" sem_texto p4ss "$saida"
confere "a palavra-passe não fica no registo" sem_no_registo p4ss
confere "o registo diz só «smtp»" grep -qF "'smtp' tratado, código 0" "$registo"

# 2. O mesmo outra vez não muda nada.
antes="$(stat -c %Y "$ficheiro")"
sleep 1
pedir "smtp $(dados pro1.mail.ovh.net 587 avisos@eurolify.eu "$SEGREDO" avisos@eurolify.eu)"
confere "o mesmo pedido dá 0" igual "$codigo" 0
confere "o mesmo pedido não muda nada" contem "$saida" "nada mudou"
confere "o ficheiro não se reescreve" igual "$(stat -c %Y "$ficheiro")" "$antes"

# 3. Recusas: o ficheiro fica como estava.
recusa() { # recusa <pedido> <descrição>
  pedir "$1"
  confere "recusado (65): $2" igual "$codigo" 65
  confere "nada mudou: $2" igual "$(cat "$ficheiro")" "$esperado"
  confere "a palavra-passe recusada não volta na saída: $2" sem_texto segredo-recusado "$saida"
  confere "a palavra-passe recusada não fica no registo: $2" sem_no_registo segredo-recusado
}
recusa "smtp $(dados pro1.mail.ovh.net 25 avisos@eurolify.eu segredo-recusado avisos@eurolify.eu)" "porta 25"
recusa "smtp $(dados 'pro1.mail.ovh.net;rm' 587 avisos@eurolify.eu segredo-recusado avisos@eurolify.eu)" "anfitrião com «;»"
recusa "smtp $(dados pro1.mail.ovh.net 587 'a@b.pt,c@d.pt' segredo-recusado avisos@eurolify.eu)" "utilizador com vírgula"
recusa "smtp $(dados pro1.mail.ovh.net 587 avisos@eurolify.eu segredo-recusado 'Avisos <avisos@eurolify.eu>')" "remetente com nome"
recusa "smtp $(dados pro1.mail.ovh.net 587 avisos@eurolify.eu "$(printf 'segredo-recusado\tx')" avisos@eurolify.eu)" "palavra-passe com tabulação"
recusa "smtp $(dados pro1.mail.ovh.net 587 avisos@eurolify.eu ' segredo-recusado' avisos@eurolify.eu)" "palavra-passe com espaço à frente"
recusa "smtp $(printf 'a\n587\nsegredo-recusado' | base64 -w0)" "três linhas em vez de cinco"
recusa "smtp $(printf 'a\nb\nc\nsegredo-recusado\nd\ne' | base64 -w0)" "seis linhas (uma palavra-passe com mudança de linha)"
# Fora do formato: o serviço recusa antes de chamar o eurolify-configurar.
recusa "smtp não-é-base64" "texto que não é base64"
recusa "outra coisa" "outra acção"

echo
if ((falhas > 0)); then
  echo "$falhas verificação(ões) falharam"
  exit 1
fi
echo "todas as verificações passaram"
