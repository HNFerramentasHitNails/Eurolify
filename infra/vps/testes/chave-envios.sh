#!/usr/bin/env bash
# Teste da chave dos envios (infra/vps/ficheiros/lib/chave-envios.sh;
# docs/36 §17): nasce 600 e de root com o formato que a API aceita, nunca se
# reescreve, e uma falha do openssl não deixa nada para trás. A validação
# recusa o que derrubava a API.
set -Eeuo pipefail
[[ "${EUROLIFY_TESTE_DESCARTAVEL:-}" == 1 ]] || { echo "só numa máquina descartável (EUROLIFY_TESTE_DESCARTAVEL=1)" >&2; exit 2; }
repo="$(cd "$(dirname "$0")/../../.." && pwd)"
# shellcheck source=../ficheiros/lib/chave-envios.sh
source "$repo/infra/vps/ficheiros/lib/chave-envios.sh"
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
f="$pasta/api-envios.env"
so_ela() { [[ "$(find "$pasta" -mindepth 1 | wc -l)" == "$1" ]]; }

confere sim "gera a chave quando falta" gerar_chave_envios "$f"
confere sim "600 e de root" test "$(stat -c '%a %U' "$f")" == "600 root"
confere sim "no formato que a API aceita" chave_envios_valida "$f"
confere sim "sem ficheiros temporários" so_ela 1
antes="$(cat "$f")"
confere nao "não gera outra por cima" gerar_chave_envios "$f"
confere sim "a chave fica a mesma" test "$(cat "$f")" == "$antes"
confere sim "e sem ficheiros temporários" so_ela 1

# O openssl falha ou devolve pouco: nada fica escrito.
rm -f "$f"
falsos="$(mktemp -d)"
printf '#!/usr/bin/env bash\nexit 1\n' >"$falsos/openssl"
chmod 755 "$falsos/openssl"
confere nao "com o openssl a falhar, não gera" env PATH="$falsos:$PATH" bash -c "source '$repo/infra/vps/ficheiros/lib/chave-envios.sh'; gerar_chave_envios '$f'"
confere sim "e não deixa nada" so_ela 0
printf '#!/usr/bin/env bash\necho curta\n' >"$falsos/openssl"
confere nao "com uma chave curta, não gera" env PATH="$falsos:$PATH" bash -c "source '$repo/infra/vps/ficheiros/lib/chave-envios.sh'; gerar_chave_envios '$f'"
confere sim "e não deixa nada" so_ela 0
rm -rf "$falsos"

# A validação.
k="$(openssl rand -base64 32)"
# shellcheck disable=SC2059 # de propósito: o formato é o caso de teste
escreve() { printf "$1" "$k" >"$f"; }
escreve 'ENVIOS_CHAVE=%s\nENVIOS_CHAVE_VERSAO=2026-10_a\n'
confere sim "aceita uma versão com letras, algarismos, - e _ (como a API)" chave_envios_valida "$f"
escreve 'ENVIOS_CHAVE=%s\nENVIOS_CHAVE_VERSAO=versao.com.pontos\n'
confere nao "recusa uma versão com pontos (a API recusa-a)" chave_envios_valida "$f"
escreve 'ENVIOS_CHAVE=%s\nENVIOS_CHAVE_VERSAO=123456789012345678901\n'
confere nao "recusa uma versão com mais de 20 caracteres" chave_envios_valida "$f"
printf 'ENVIOS_CHAVE=%s\nENVIOS_CHAVE=%s\nENVIOS_CHAVE_VERSAO=1\n' "$k" "$k" >"$f"
confere nao "recusa uma linha repetida" chave_envios_valida "$f"
escreve 'ENVIOS_CHAVE=%s\r\nENVIOS_CHAVE_VERSAO=1\r\n'
confere nao "recusa CRLF" chave_envios_valida "$f"
: >"$f"
confere nao "recusa um ficheiro vazio" chave_envios_valida "$f"
printf 'ENVIOS_CHAVE=\nENVIOS_CHAVE_VERSAO=1\n' >"$f"
confere nao "recusa a chave vazia" chave_envios_valida "$f"
printf 'ENVIOS_CHAVE=%s\nENVIOS_CHAVE_VERSAO=1\n' "${k:0:40}====" >"$f"
confere nao "recusa uma chave que não dá 32 bytes" chave_envios_valida "$f"
escreve 'ENVIOS_CHAVE=%s\nENVIOS_CHAVE_VERSAO=1\n'
ln -s "$f" "$pasta/ligacao"
confere nao "recusa uma ligação simbólica" chave_envios_valida "$pasta/ligacao"

# A troca da chave (docs/36 §25.7): a anterior com outra versão.
k2="$(openssl rand -base64 32)"
printf 'ENVIOS_CHAVE=%s\nENVIOS_CHAVE_VERSAO=2\nENVIOS_CHAVE_ANTERIOR=%s\nENVIOS_CHAVE_ANTERIOR_VERSAO=1\n' "$k2" "$k" >"$f"
confere sim "aceita a troca a meio (a anterior com outra versão)" chave_envios_valida "$f"
printf 'ENVIOS_CHAVE=%s\nENVIOS_CHAVE_VERSAO=1\nENVIOS_CHAVE_ANTERIOR=%s\nENVIOS_CHAVE_ANTERIOR_VERSAO=1\n' "$k2" "$k" >"$f"
confere nao "recusa a anterior com a mesma versão (a API não arranca)" chave_envios_valida "$f"
printf 'ENVIOS_CHAVE=%s\nENVIOS_CHAVE_VERSAO=2\nENVIOS_CHAVE_ANTERIOR=%s\n' "$k2" "$k" >"$f"
confere nao "recusa a anterior sem a versão" chave_envios_valida "$f"
printf 'ENVIOS_CHAVE=%s\nENVIOS_CHAVE_VERSAO=2\nENVIOS_CHAVE_ANTERIOR=curta\nENVIOS_CHAVE_ANTERIOR_VERSAO=1\n' "$k2" >"$f"
confere nao "recusa uma anterior que não dá 32 bytes" chave_envios_valida "$f"

rm -f "$f" "$pasta/ligacao"
gerar_chave_envios "$f"
k1="$(sed -n 's/^ENVIOS_CHAVE=//p' "$f")"
confere sim "trocar: a partir da versão 1" trocar_chave_envios "$f"
confere sim "trocar: o ficheiro fica válido, 600 e de root" chave_envios_valida "$f"
confere sim "trocar: 600 e de root" test "$(stat -c '%a %U' "$f")" == "600 root"
confere sim "trocar: a nova é a versão 2" test "$(chave_envios_versao "$f")" == 2
confere sim "trocar: a anterior é a versão 1" test "$(chave_envios_versao_anterior "$f")" == 1
confere sim "trocar: a anterior é a chave que estava" test "$(sed -n 's/^ENVIOS_CHAVE_ANTERIOR=//p' "$f")" == "$k1"
confere sim "trocar: a nova é outra" test "$(sed -n 's/^ENVIOS_CHAVE=//p' "$f")" != "$k1"
confere sim "trocar: sem ficheiros temporários" so_ela 1
antes="$(cat "$f")"
confere nao "trocar outra vez com a troca a meio: recusa" trocar_chave_envios "$f"
confere sim "e o ficheiro fica como estava" test "$(cat "$f")" == "$antes"
k_nova="$(sed -n 's/^ENVIOS_CHAVE=//p' "$f")"
confere sim "tirar a anterior" tirar_chave_anterior_envios "$f"
confere sim "tirar: fica só a actual, válida" chave_envios_valida "$f"
confere sim "tirar: duas linhas" test "$(wc -l <"$f")" == 2
confere sim "tirar: a actual é a nova" test "$(sed -n 's/^ENVIOS_CHAVE=//p' "$f")" == "$k_nova"
confere sim "tirar: versão 2" test "$(chave_envios_versao "$f")" == 2
confere nao "tirar sem anterior: recusa" tirar_chave_anterior_envios "$f"
printf 'ENVIOS_CHAVE=%s\nENVIOS_CHAVE_VERSAO=2026-10_a\n' "$k" >"$f"
confere sim "trocar uma versão que não é número: a nova é a data" trocar_chave_envios "$f"
confere sim "e o ficheiro fica válido" chave_envios_valida "$f"
confere sim "a nova versão são 14 algarismos" grep -Eq '^ENVIOS_CHAVE_VERSAO=[0-9]{14}$' "$f"
falsos="$(mktemp -d)"
printf '#!/usr/bin/env bash\nexit 1\n' >"$falsos/openssl"
chmod 755 "$falsos/openssl"
printf 'ENVIOS_CHAVE=%s\nENVIOS_CHAVE_VERSAO=1\n' "$k" >"$f"
antes="$(cat "$f")"
confere nao "trocar com o openssl a falhar: recusa" env PATH="$falsos:$PATH" bash -c "source '$repo/infra/vps/ficheiros/lib/chave-envios.sh'; trocar_chave_envios '$f'"
confere sim "e o ficheiro fica como estava" test "$(cat "$f")" == "$antes"
rm -rf "$falsos"

rm -rf "$pasta"
((falhas == 0))
