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
# IPv6: ou tem «::», ou pelo menos três «:» — para não apanhar horas
# (12:34:56). A forma com «::» trata-se primeiro, inteira (revisão do #10, P2).
filtrar_ip() {
  sed -E \
    -e 's/([0-9a-fA-F]{1,4}(:[0-9a-fA-F]{1,4}){0,6})?::([0-9a-fA-F]{1,4}(:[0-9a-fA-F]{1,4}){0,6})?/<ip6>/g' \
    -e 's/([0-9a-fA-F]{1,4}:){3,7}[0-9a-fA-F]{1,4}/<ip6>/g' \
    -e 's/\b([0-9]{1,3}\.){3}[0-9]{1,3}\b/<ip>/g'
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

# Migrações da base e de uma imagem (tarefa #113). Só passam nomes com a forma
# das do migrador (apps/api/src/base/migracoes.ts), sem «.sql», ordenados em C:
# um nome estranho não chega ao registo nem ao MCP (revisão do #115, P3-2).
NOME_MIGRACAO='^[0-9]{4}_[a-z0-9_]+$'
so_migracoes() { { grep -E "$NOME_MIGRACAO" || true; } | LC_ALL=C sort; }

# As da pasta da imagem (o Dockerfile põe-nas em /app/apps/api/migracoes).
# Se a imagem tem o migrador (dist/migrar.js): 0 sim, 1 não, 2 não se sabe
# (erro do docker, código 125 ou mais; revisão do #115, 4.ª, P3-1).
# Contentores sem rede nem capacidades, e só com a imagem que já está na
# máquina (não a vão buscar).
tem_migrador() {
  local rc=0
  docker run --rm --pull=never --network none --cap-drop ALL --entrypoint test "$1" -f dist/migrar.js >/dev/null 2>&1 || rc=$?
  case "$rc" in
    0) return 0 ;;
    1) return 1 ;;
    *) return 2 ;;
  esac
}

# Falha se não se lê (uma pasta vazia lê-se: lista vazia).
migracoes_da_imagem() {
  docker run --rm --pull=never --network none --cap-drop ALL --entrypoint ls "$1" /app/apps/api/migracoes 2>/dev/null |
    sed -n 's/\.sql$//p' | so_migracoes
}

# As da base (tabela do migrador). Falha se a base não responde; sem a
# tabela, lista vazia. Precisa do BASE_NOME (carregar_config).
migracoes_da_base() {
  local existe
  existe="$(docker exec eurolify-postgres psql -U postgres -d "$BASE_NOME" -Atc \
    "select to_regclass('public.kysely_migration') is not null" 2>/dev/null)" || return 1
  [[ "$existe" == t ]] || return 0
  docker exec eurolify-postgres psql -U postgres -d "$BASE_NOME" -Atc \
    "select name from public.kysely_migration" 2>/dev/null | so_migracoes
}

# As linhas da lista $1 que não estão na lista $2 (uma por linha).
so_na_primeira() {
  LC_ALL=C comm -23 <(printf '%s\n' "$1") <(printf '%s\n' "$2") | sed '/^$/d'
}
virgulas() { printf '%s\n' "$1" | sed '/^$/d' | paste -sd, -; }

# O publicacoes.log tem uma linha por publicação: «data | resumo | anterior:
# imagem | migrou: a,b» (o «migrou» desde a 4.ª revisão do #115: as migrações
# que essa publicação aplicou; «?» se não se soube; linhas antigas não o têm).
ultima_publicacao_de() {
  grep -F -- "| $1 |" /var/log/eurolify/publicacoes.log 2>/dev/null | tail -n 1
}
# A imagem que estava no ar antes da última publicação do resumo dado. Vazio
# se não há.
anterior_de() {
  ultima_publicacao_de "$1" | sed -n 's/^.* | anterior: \([^ |]*\).*$/\1/p'
}
# As migrações que a última publicação do resumo dado aplicou, uma por linha.
# Falha se a linha não as tem ou se ficaram por saber («?»).
migrou_de() {
  local linha
  linha="$(ultima_publicacao_de "$1")" || return 1
  [[ "$linha" == *" | migrou: "* ]] || return 1
  linha="${linha##* | migrou: }"
  [[ "$linha" != "?" ]] || return 1
  printf '%s\n' "$linha" | tr ',' '\n' | so_migracoes
}
