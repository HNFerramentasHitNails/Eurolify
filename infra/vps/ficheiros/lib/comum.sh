# shellcheck shell=bash
# Funções comuns dos programas do Eurolify na VPS (infra/vps).
# Instalado em /usr/local/lib/eurolify/comum.sh.

EUROLIFY_CONF=/etc/eurolify/ensaio.conf
EUROLIFY_REGISTO=/var/log/eurolify/acoes.log

# Cada acção fica registada na máquina: quem, o quê, quando (ADR-0016, ponto 4).
registar() {
  local origem="${EUROLIFY_ORIGEM:-${SUDO_USER:-root}}"
  install -d -m 750 /var/log/eurolify
  printf '%s | %s | %s\n' "$(date -u +%FT%TZ)" "$origem" "$*" >>"$EUROLIFY_REGISTO"
  logger -t eurolify -- "$origem: $*" || true
}

falhar() {
  echo "ERRO: $*" >&2
  exit 1
}

carregar_config() {
  [[ -r "$EUROLIFY_CONF" ]] || falhar "falta $EUROLIFY_CONF (corre o preparar.sh)"
  # shellcheck source=/dev/null
  source "$EUROLIFY_CONF"
}

# Tira endereços IPv4 e IPv6 de uma saída (ADR-0018: são dados pessoais).
# O IPv6 exige pelo menos três «:» para não apanhar horas (12:34:56).
filtrar_ip() {
  sed -E \
    -e 's/\b([0-9]{1,3}\.){3}[0-9]{1,3}\b/<ip>/g' \
    -e 's/\b([0-9a-fA-F]{1,4}:){3,7}[0-9a-fA-F]{0,4}\b/<ip6>/g' \
    -e 's/\b[0-9a-fA-F]{0,4}::([0-9a-fA-F]{1,4}:?){1,6}\b/<ip6>/g'
}

# Aviso ao Healthchecks.io (ADR-0027). healthchecks.env traz HC_<NOME>=<url>.
# Uso: hc <NOME> ok|falhou [texto]
hc() {
  local nome="$1" estado="$2" texto="${3:-}" url
  [[ -r /etc/eurolify/healthchecks.env ]] || {
    echo "aviso: sem /etc/eurolify/healthchecks.env; o alerta $nome não segue" >&2
    return 0
  }
  # shellcheck source=/dev/null
  source /etc/eurolify/healthchecks.env
  local var="HC_${nome}"
  url="${!var:-}"
  [[ -n "$url" ]] || {
    echo "aviso: falta $var em healthchecks.env" >&2
    return 0
  }
  [[ "$estado" == ok ]] || url="$url/fail"
  curl -fsS -m 10 --retry 3 --data-raw "$(printf '%s' "$texto" | filtrar_ip | head -c 10000)" "$url" >/dev/null ||
    echo "aviso: o Healthchecks.io não respondeu ($nome)" >&2
}
