#!/usr/bin/env bash
# Teste do eurolify-publicar (tarefa #113): uma imagem nova corre as migrações;
# uma que já esteve no ar (está no publicacoes.log) não as corre, porque o
# migrador dela recusava a base com migrações que vieram depois; e avisa se não
# é a publicação imediatamente anterior. Corre como root num contentor Ubuntu
# descartável, com docker e curl de mentira.
set -Eeuo pipefail
[[ "${EUROLIFY_TESTE_DESCARTAVEL:-}" == 1 ]] || { echo "só numa máquina descartável (EUROLIFY_TESTE_DESCARTAVEL=1)" >&2; exit 2; }
repo="$(cd "$(dirname "$0")/../../.." && pwd)"
f="$repo/infra/vps/ficheiros"
falhas=0
falhou() { echo "FALHOU: $*"; falhas=$((falhas + 1)); }

repo_img="ghcr.io/eurolify/eurolify-api"
r() { printf 'sha256:%064d' "$1"; } # resumo de ensaio: r 1 → sha256:000…001
install -d /usr/local/lib/eurolify /etc/eurolify /var/log/eurolify
install -m 644 "$f/lib/comum.sh" /usr/local/lib/eurolify/comum.sh
printf 'IMAGEM_REPO=%s\nGHCR_UTILIZADOR=ensaio\n' "$repo_img" >/etc/eurolify/ensaio.conf
echo token >/etc/eurolify/ghcr.token
: >/etc/eurolify/migrar.env
: >/etc/eurolify/api.env

falsos="$(mktemp -d)"
cat >"$falsos/docker" <<'FALSO'
#!/usr/bin/env bash
echo "docker $*" >>"$FALSOS/docker-chamado"
case "$1" in
  inspect) cat "$FALSOS/no-ar" ;;
  run) if [[ " $* " == *" -d "* ]]; then echo "${*: -1}" >"$FALSOS/no-ar"; fi ;;
esac
exit 0
FALSO
printf '#!/usr/bin/env bash\nexit 0\n' >"$falsos/curl"
chmod 755 "$falsos/docker" "$falsos/curl"
export PATH="$falsos:$PATH" FALSOS="$falsos"

# Antes de cada caso: três publicações já no ar, 1, depois 2, depois 3 (a
# actual). Cada publicação acrescenta uma linha; por isso recomeça-se.
publicar() { # publicar <n> → saída em $falsos/saida
  cat >/var/log/eurolify/publicacoes.log <<REG
2026-10-01T10:00:00Z | $(r 1) | anterior: nenhuma
2026-10-02T10:00:00Z | $(r 2) | anterior: $repo_img@$(r 1)
2026-10-03T10:00:00Z | $(r 3) | anterior: $repo_img@$(r 2)
REG
  [[ -z "${TIRAR_LINHA:-}" ]] || sed -i "${TIRAR_LINHA}d" /var/log/eurolify/publicacoes.log
  echo "$repo_img@$(r 3)" >"$falsos/no-ar"
  rm -f "$falsos/docker-chamado"
  bash "$f/sbin/eurolify-publicar" "$(r "$1")" >"$falsos/saida" 2>&1 || falhou "a publicação de $1 falhou: $(cat "$falsos/saida")"
}
migrou() { grep -q "node dist/migrar.js" "$falsos/docker-chamado"; }
avisou() { grep -q "AVISO: não é a publicação imediatamente anterior" "$falsos/saida"; }

publicar 4
if migrou; then echo "ok: uma imagem nova corre as migrações"; else falhou "uma imagem nova não migrou"; fi

publicar 2
if migrou; then falhou "voltar à anterior correu as migrações dela"; else echo "ok: voltar à anterior não migra"; fi
if avisou; then falhou "avisou ao voltar à imediatamente anterior"; else echo "ok: a imediatamente anterior não avisa"; fi

publicar 1
if migrou; then falhou "voltar a uma mais antiga correu as migrações dela"; else echo "ok: voltar a uma mais antiga não migra"; fi
if avisou; then echo "ok: avisa que não é a imediatamente anterior"; else falhou "não avisou numa mais antiga"; fi

# Um resumo que só aparece como «anterior» noutra linha não conta como publicado.
TIRAR_LINHA=1 publicar 1
if migrou; then echo "ok: só conta a coluna do resumo, não a do «anterior»"; else falhou "contou o «anterior» como publicado"; fi

rm -rf "$falsos"
((falhas == 0))
