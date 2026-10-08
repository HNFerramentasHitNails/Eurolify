#!/usr/bin/env bash
# Teste da chave dos segredos TOTP (infra/vps/ficheiros/lib/chave-totp.sh;
# docs/22 §9.2; revisão do #177, P2-4 da VPS): nasce 600 e de root com o
# formato que a API aceita, nunca se reescreve, e uma falha do openssl não
# deixa nada para trás. A validação recusa o que derrubava a API.
set -Eeuo pipefail
[[ "${EUROLIFY_TESTE_DESCARTAVEL:-}" == 1 ]] || { echo "só numa máquina descartável (EUROLIFY_TESTE_DESCARTAVEL=1)" >&2; exit 2; }
repo="$(cd "$(dirname "$0")/../../.." && pwd)"
# shellcheck source=../ficheiros/lib/chave-totp.sh
source "$repo/infra/vps/ficheiros/lib/chave-totp.sh"
command -v openssl >/dev/null || { apt-get update -qq >/dev/null && apt-get install -y -qq openssl >/dev/null; }
falhas=0
falhou() { echo "FALHOU: $*"; falhas=$((falhas + 1)); }
confere() { # confere <sim|nao> <texto> <condição…>
  local espera="$1" texto="$2" obtido=nao
  shift 2
  if "$@"; then obtido=sim; fi
  if [[ "$obtido" == "$espera" ]]; then echo "ok: $texto"; else falhou "$texto"; fi
}
pasta="$(mktemp -d)"
chmod 700 "$pasta"
f="$pasta/api-totp.env"
so_ela() { [[ "$(find "$pasta" -mindepth 1 | wc -l)" == "$1" ]]; }

confere sim "gera a chave quando falta" gerar_chave_totp "$f"
confere sim "600 e de root" test "$(stat -c '%a %U' "$f")" == "600 root"
confere sim "no formato que a API aceita" chave_totp_valida "$f"
confere sim "sem ficheiros temporários" so_ela 1
antes="$(cat "$f")"
confere nao "não gera outra por cima" gerar_chave_totp "$f"
confere sim "a chave fica a mesma" test "$(cat "$f")" == "$antes"
confere sim "e sem ficheiros temporários" so_ela 1

# O openssl falha ou devolve pouco: nada fica escrito.
rm -f "$f"
falsos="$(mktemp -d)"
printf '#!/usr/bin/env bash\nexit 1\n' >"$falsos/openssl"
chmod 755 "$falsos/openssl"
confere nao "com o openssl a falhar, não gera" env PATH="$falsos:$PATH" bash -c "source '$repo/infra/vps/ficheiros/lib/chave-totp.sh'; gerar_chave_totp '$f'"
confere sim "e não deixa nada" so_ela 0
printf '#!/usr/bin/env bash\necho curta\n' >"$falsos/openssl"
confere nao "com uma chave curta, não gera" env PATH="$falsos:$PATH" bash -c "source '$repo/infra/vps/ficheiros/lib/chave-totp.sh'; gerar_chave_totp '$f'"
confere sim "e não deixa nada" so_ela 0
rm -rf "$falsos"

# A validação.
k="$(openssl rand -base64 32)"
# shellcheck disable=SC2059 # de propósito: o formato é o caso de teste
escreve() { printf "$1" "$k" >"$f"; }
escreve 'TOTP_CHAVE=%s\nTOTP_CHAVE_VERSAO=1000\n'
confere sim "aceita a versão 1000" chave_totp_valida "$f"
escreve 'TOTP_CHAVE=%s\nTOTP_CHAVE_VERSAO=1001\n'
confere nao "recusa a versão 1001 (a API só aceita até 1000)" chave_totp_valida "$f"
escreve 'TOTP_CHAVE=%s\nTOTP_CHAVE_VERSAO=0\n'
confere nao "recusa a versão 0" chave_totp_valida "$f"
printf 'TOTP_CHAVE=%s\nTOTP_CHAVE=%s\nTOTP_CHAVE_VERSAO=1\n' "$k" "$k" >"$f"
confere nao "recusa uma linha repetida" chave_totp_valida "$f"
escreve 'TOTP_CHAVE=%s\r\nTOTP_CHAVE_VERSAO=1\r\n'
confere nao "recusa CRLF" chave_totp_valida "$f"
: >"$f"
confere nao "recusa um ficheiro vazio" chave_totp_valida "$f"
printf 'TOTP_CHAVE=\nTOTP_CHAVE_VERSAO=1\n' >"$f"
confere nao "recusa a chave vazia" chave_totp_valida "$f"
printf 'TOTP_CHAVE=%s\nTOTP_CHAVE_VERSAO=1\n' "${k:0:40}====" >"$f"
confere nao "recusa uma chave que não dá 32 bytes" chave_totp_valida "$f"
escreve 'TOTP_CHAVE=%s\nTOTP_CHAVE_VERSAO=1\n'
ln -s "$f" "$pasta/ligacao"
confere nao "recusa uma ligação simbólica" chave_totp_valida "$pasta/ligacao"

rm -rf "$pasta"
((falhas == 0))
