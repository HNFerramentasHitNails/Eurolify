# shellcheck shell=bash
# A chave que cifra as credenciais das contas de transportadora (docs/36
# §17; ENVIOS_CHAVE, apps/api/src/servidor.ts). Instalado em
# /usr/local/lib/eurolify/chave-envios.sh e usado pelo preparar.sh (gerar e
# conferir) e pelo eurolify-publicar (só passa à API uma chave válida). Como
# a chave TOTP (chave-totp.sh): gera-se uma vez e nunca se reescreve. Nunca
# imprime nem regista a chave.

# chave_envios_valida <ficheiro>: 0 se é um ficheiro normal com exactamente
# as duas linhas que a API aceita (32 bytes em base64; a versão como em
# apps/api/src/pagamentos/cifra.ts). Uma linha repetida, um CRLF ou uma
# versão fora disso derrubavam a API ao arrancar.
chave_envios_valida() {
  local f="$1"
  [[ -f "$f" && ! -L "$f" ]] || return 1
  [[ "$(wc -l <"$f")" == 2 ]] || return 1
  [[ "$(grep -c '^ENVIOS_CHAVE=' "$f")" == 1 ]] || return 1
  [[ "$(grep -c '^ENVIOS_CHAVE_VERSAO=' "$f")" == 1 ]] || return 1
  grep -Eq '^ENVIOS_CHAVE=[A-Za-z0-9+/]{43}=$' "$f" || return 1
  grep -Eq '^ENVIOS_CHAVE_VERSAO=[0-9A-Za-z_-]{1,20}$' "$f"
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
