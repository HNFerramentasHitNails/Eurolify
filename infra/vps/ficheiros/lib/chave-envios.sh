# shellcheck shell=bash
# A chave que cifra as credenciais das contas de transportadora (docs/36
# §17; ENVIOS_CHAVE, apps/api/src/servidor.ts). Instalado em
# /usr/local/lib/eurolify/chave-envios.sh e usado pelo preparar.sh (gerar e
# conferir) e pelo eurolify-publicar (só passa à API uma chave válida). Como
# a chave TOTP (chave-totp.sh): gera-se uma vez e nunca se reescreve. Nunca
# imprime nem regista a chave.

# chave_envios_valida <ficheiro>: 0 se é um ficheiro normal com exactamente
# as duas linhas que a API aceita (32 bytes em base64; a versão como em
# apps/api/src/pagamentos/cifra.ts) ou, durante a troca da chave (docs/36
# §25), essas e as duas da anterior, com outra versão (lerChavesEnvios em
# apps/api/src/envios/chave.ts). Uma linha repetida, um CRLF ou uma versão
# fora disso derrubavam a API ao arrancar.
chave_envios_valida() {
  local f="$1" n
  [[ -f "$f" && ! -L "$f" ]] || return 1
  n="$(wc -l <"$f")"
  [[ "$n" == 2 || "$n" == 4 ]] || return 1
  [[ "$(grep -c '^ENVIOS_CHAVE=' "$f")" == 1 ]] || return 1
  [[ "$(grep -c '^ENVIOS_CHAVE_VERSAO=' "$f")" == 1 ]] || return 1
  grep -Eq '^ENVIOS_CHAVE=[A-Za-z0-9+/]{43}=$' "$f" || return 1
  grep -Eq '^ENVIOS_CHAVE_VERSAO=[0-9A-Za-z_-]{1,20}$' "$f" || return 1
  [[ "$n" == 2 ]] && return 0
  [[ "$(grep -c '^ENVIOS_CHAVE_ANTERIOR=' "$f")" == 1 ]] || return 1
  [[ "$(grep -c '^ENVIOS_CHAVE_ANTERIOR_VERSAO=' "$f")" == 1 ]] || return 1
  grep -Eq '^ENVIOS_CHAVE_ANTERIOR=[A-Za-z0-9+/]{43}=$' "$f" || return 1
  grep -Eq '^ENVIOS_CHAVE_ANTERIOR_VERSAO=[0-9A-Za-z_-]{1,20}$' "$f" || return 1
  [[ "$(chave_envios_versao "$f")" != "$(chave_envios_versao_anterior "$f")" ]]
}

# A versão da chave actual e a da anterior (vazia sem troca a meio).
chave_envios_versao() { sed -n 's/^ENVIOS_CHAVE_VERSAO=//p' "$1"; }
chave_envios_versao_anterior() { sed -n 's/^ENVIOS_CHAVE_ANTERIOR_VERSAO=//p' "$1"; }

# escrever_chave_envios <ficheiro> <conteúdo>: substitui-o de uma vez (600,
# root), por um ficheiro ao lado que vai para o disco antes do `mv`.
escrever_chave_envios() {
  local f="$1" conteudo="$2" t
  t="$(mktemp "$(dirname "$f")/.api-envios.XXXXXX")" || return 1
  if ! printf '%s\n' "$conteudo" >"$t" ||
    ! chmod 600 "$t" || ! chown root:root "$t" || ! sync "$t" ||
    ! chave_envios_valida "$t" || ! mv -fT "$t" "$f"; then
    rm -f "$t"
    return 1
  fi
}

# trocar_chave_envios <ficheiro>: a troca da chave (docs/36 §25). A actual
# passa a anterior, com a versão dela, e nasce uma nova com a versão
# seguinte (a seguinte em número, ou a data e a hora se a actual não for um
# número). Recusa com uma troca já a meio: tira-se a anterior primeiro.
# Nunca imprime a chave.
trocar_chave_envios() {
  local f="$1" k v nova actual
  chave_envios_valida "$f" || return 1
  [[ -z "$(chave_envios_versao_anterior "$f")" ]] || return 1
  k="$(openssl rand -base64 32 2>/dev/null)" || return 1
  [[ "$k" =~ ^[A-Za-z0-9+/]{43}=$ ]] || return 1
  v="$(chave_envios_versao "$f")"
  if [[ "$v" =~ ^[0-9]{1,9}$ ]]; then
    nova=$((10#$v + 1))
  else
    nova="$(date -u +%Y%m%d%H%M%S)"
  fi
  [[ "$nova" != "$v" ]] || return 1
  actual="$(sed -n 's/^ENVIOS_CHAVE=//p' "$f")"
  escrever_chave_envios "$f" "$(printf 'ENVIOS_CHAVE=%s\nENVIOS_CHAVE_VERSAO=%s\nENVIOS_CHAVE_ANTERIOR=%s\nENVIOS_CHAVE_ANTERIOR_VERSAO=%s' \
    "$k" "$nova" "$actual" "$v")"
}

# tirar_chave_anterior_envios <ficheiro>: acaba a troca; fica só a actual.
# Quem chama confere antes que nenhuma conta está na anterior.
tirar_chave_anterior_envios() {
  local f="$1"
  chave_envios_valida "$f" || return 1
  [[ -n "$(chave_envios_versao_anterior "$f")" ]] || return 1
  escrever_chave_envios "$f" "$(grep -E '^ENVIOS_CHAVE(_VERSAO)?=' "$f")"
}

# gerar_chave_envios <ficheiro>: cria-o (600, root) com uma chave nova, só
# se ainda não existir; nunca o substitui. Falha sem deixar nada se o openssl
# falhar. O ficheiro nasce noutro nome, vai para o disco e liga-se com `ln`,
# que é atómico e não substitui: duas corridas ao mesmo tempo ficam com a
# mesma chave, a da primeira.
gerar_chave_envios() {
  local f="$1" k t
  k="$(openssl rand -base64 32 2>/dev/null)" || return 1
  [[ "$k" =~ ^[A-Za-z0-9+/]{43}=$ ]] || return 1
  t="$(mktemp "$(dirname "$f")/.api-envios.XXXXXX")" || return 1
  if ! printf 'ENVIOS_CHAVE=%s\nENVIOS_CHAVE_VERSAO=1\n' "$k" >"$t" ||
    ! chmod 600 "$t" || ! chown root:root "$t" || ! sync "$t"; then
    rm -f "$t"
    return 1
  fi
  if ! ln "$t" "$f" 2>/dev/null; then
    rm -f "$t"
    echo "   $f já existe (outra corrida?): fica o que lá está" >&2
    return 1
  fi
  rm -f "$t"
}
