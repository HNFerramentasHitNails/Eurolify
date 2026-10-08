# shellcheck shell=bash
# A chave que cifra os segredos TOTP das palavras-passe (docs/21 §8; docs/22
# §9.2; pedido #177). Instalado em /usr/local/lib/eurolify/chave-totp.sh e
# usado pelo preparar.sh (gerar e conferir) e pelo eurolify-publicar (só
# passa à API uma chave válida). Nunca imprime nem regista a chave.

# chave_totp_valida <ficheiro>: 0 se é um ficheiro normal com exactamente as
# duas linhas que a API aceita (32 bytes em base64; versão de 1 a 1000, como
# apps/api/src/identidade/palavra-passe.ts). Uma linha repetida, um CRLF ou
# uma versão fora disso derrubavam a API ao arrancar (revisão do #177, P2-2 e
# P3-5 da VPS).
chave_totp_valida() {
  local f="$1"
  [[ -f "$f" && ! -L "$f" ]] || return 1
  [[ "$(wc -l <"$f")" == 2 ]] || return 1
  [[ "$(grep -c '^TOTP_CHAVE=' "$f")" == 1 ]] || return 1
  [[ "$(grep -c '^TOTP_CHAVE_VERSAO=' "$f")" == 1 ]] || return 1
  grep -Eq '^TOTP_CHAVE=[A-Za-z0-9+/]{43}=$' "$f" || return 1
  grep -Eq '^TOTP_CHAVE_VERSAO=([1-9][0-9]{0,2}|1000)$' "$f"
}

# gerar_chave_totp <ficheiro>: cria-o (600, root) com uma chave nova, só se
# ainda não existir; nunca o substitui. Falha sem deixar nada se o openssl
# falhar (revisão do #177, P2-1 da VPS). O ficheiro nasce noutro nome, vai
# para o disco e liga-se com `ln`, que é atómico e não substitui: duas
# corridas ao mesmo tempo ficam com a mesma chave, a da primeira (P3-1).
gerar_chave_totp() {
  local f="$1" k t
  k="$(openssl rand -base64 32 2>/dev/null)" || return 1
  [[ "$k" =~ ^[A-Za-z0-9+/]{43}=$ ]] || return 1
  t="$(mktemp "$(dirname "$f")/.api-totp.XXXXXX")" || return 1
  if ! printf 'TOTP_CHAVE=%s\nTOTP_CHAVE_VERSAO=1\n' "$k" >"$t" ||
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
