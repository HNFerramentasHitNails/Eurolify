#!/usr/bin/env bash
# Preparação da VPS do ensaio do Eurolify (docs/11; ADR-0015, ADR-0018,
# ADR-0026 a ADR-0029). Pode correr-se várias vezes: cada passo vê o estado e
# só muda o que falta. Com --mostrar não muda nada: diz o que faria.
#
#   sudo bash infra/vps/preparar.sh --mostrar
#   sudo bash infra/vps/preparar.sh
#
# Normalmente corre pelo fluxo aplicar-script (ADR-0028). Só a primeira vez,
# antes de os utilizadores dos fluxos existirem, corre pela chave de
# emergência (ver infra/vps/LEIA-ME.md).
#
# Nunca apaga sozinho: chaves, regras da firewall ou contentores que não
# conhece ficam e aparecem como AVISO, para uma pessoa decidir.
set -Eeuo pipefail
umask 022

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
F="$AQUI/ficheiros"
# A configuração sem segredos lê-se logo à entrada: o passo da firewall já precisa dela.
# shellcheck source=ficheiros/ensaio.conf
source "$F/ensaio.conf"

MOSTRAR=0
case "${1:-}" in
  "") ;;
  --mostrar) MOSTRAR=1 ;;
  *)
    echo "uso: preparar.sh [--mostrar]" >&2
    exit 64
    ;;
esac
[[ $EUID -eq 0 ]] || {
  echo "Corre como root: sudo bash $0 ${1:-}" >&2
  exit 1
}

EUROLIFY_ORIGEM="${EUROLIFY_ORIGEM:-manual por ${SUDO_USER:-root}}"
# O fluxo aplicar-script já põe o commit na origem: não o repetir.
[[ "$EUROLIFY_ORIGEM" == *"commit "* ]] || EUROLIFY_ORIGEM+=", commit ${EUROLIFY_COMMIT:-desconhecido}"
export EUROLIFY_ORIGEM
FLUXOS=(publicar aplicar medir operar)
mudancas=0
avisos=0
mudou=0

passo() { printf '\n== %s\n' "$*"; }
ok() { echo "   já está: $*"; }
aviso() {
  echo "   AVISO: $*"
  avisos=$((avisos + 1))
}
tem() { command -v "$1" >/dev/null 2>&1; }

registar() {
  install -d -m 750 /var/log/eurolify
  printf '%s | %s | %s\n' "$(date -u +%FT%TZ)" "$EUROLIFY_ORIGEM" "$*" >>/var/log/eurolify/acoes.log
  logger -t eurolify -- "$EUROLIFY_ORIGEM: $*" 2>/dev/null || true
}

# fazer "descrição" comando argumentos...
fazer() {
  local descricao="$1"
  shift
  mudancas=$((mudancas + 1))
  if ((MOSTRAR)); then
    echo "   FARIA: $descricao"
    return 0
  fi
  echo "   a fazer: $descricao"
  "$@"
  registar "$descricao"
}

# instalar origem destino modo — põe mudou=1 se o ficheiro mudar.
instalar() {
  local origem="$1" destino="$2" modo="$3"
  mudou=0
  if [[ -f "$destino" ]] && cmp -s "$origem" "$destino" &&
    [[ "$(stat -c '%a %U' "$destino")" == "$modo root" ]]; then
    ok "$destino"
    return 0
  fi
  fazer "instalar $destino" install -D -o root -g root -m "$modo" "$origem" "$destino"
  mudou=1
}

# ---------------------------------------------------------------------------
passo "1. Pacotes"
pacotes=(docker.io ufw fail2ban age rclone git curl openssh-server nginx certbot python3-certbot-dns-ovh)
falta=()
for p in "${pacotes[@]}"; do
  estado="$(dpkg-query -W -f='${Status}' "$p" 2>/dev/null || true)"
  [[ "$estado" == "install ok installed" ]] || falta+=("$p")
done
if ((${#falta[@]})); then
  fazer "instalar pacotes: ${falta[*]}" \
    bash -c 'apt-get update -q && DEBIAN_FRONTEND=noninteractive apt-get install -y -q --no-install-recommends "$@"' _ "${falta[@]}"
else
  ok "${pacotes[*]}"
fi

# ---------------------------------------------------------------------------
# As chaves de emergência vêm ANTES do SSH só por chave: fechar a palavra-passe
# numa máquina sem nenhuma chave deixava toda a gente de fora (revisão do #10).
passo "2. Chaves de emergência do ubuntu (ADR-0028): só acrescenta, nunca apaga"
ak=/home/ubuntu/.ssh/authorized_keys
acrescentar_chave() {
  install -d -o ubuntu -g ubuntu -m 700 /home/ubuntu/.ssh
  # Se a última linha não acabar em mudança de linha, a chave nova colava-se à
  # anterior e estragava-a.
  if [[ -s "$ak" && -n "$(tail -c 1 "$ak")" ]]; then printf '\n' >>"$ak"; fi
  head -n 1 "$1" >>"$ak"
  chown ubuntu:ubuntu "$ak"
  chmod 600 "$ak"
}
chaves_no_repositorio=0
for pub in "$AQUI"/chaves/pessoais/*.pub; do
  [[ -s "$pub" ]] || continue
  chaves_no_repositorio=$((chaves_no_repositorio + 1))
  material="$(awk '{print $2}' "$pub")"
  if [[ -f "$ak" ]] && grep -qF -- "$material" "$ak"; then
    ok "chave $(basename "$pub")"
  else
    fazer "acrescentar a chave $(basename "$pub") ao ubuntu" acrescentar_chave "$pub"
  fi
done
if [[ -f "$ak" ]]; then
  while read -r _ material comentario; do
    [[ -n "${material:-}" ]] || continue
    grep -qF -- "$material" "$AQUI"/chaves/pessoais/*.pub 2>/dev/null ||
      aviso "chave no ubuntu que não está no repositório (não a apago): ${comentario:-sem comentário}"
  done < <(grep -vE '^\s*(#|$)' "$ak")
fi
chaves_no_ubuntu=0
if [[ -f "$ak" ]]; then
  chaves_no_ubuntu="$(grep -cE '^(ssh-|ecdsa-|sk-)' "$ak" || true)"
fi

# ---------------------------------------------------------------------------
passo "3. SSH só por chave, sem root (docs/11 §3.1; memória da VPS)"
sshd_eurolify=/etc/ssh/sshd_config.d/00-eurolify.conf
sshd_antes=/etc/ssh/00-eurolify.conf.antes # fora da pasta: o Include só lê *.conf
pode_fechar=0
if ((chaves_no_ubuntu > 0)) || ((MOSTRAR && chaves_no_repositorio > 0)); then
  pode_fechar=1
fi
mudou=0
if ((pode_fechar)); then
  ((MOSTRAR)) || { [[ -f "$sshd_eurolify" ]] && cp -p "$sshd_eurolify" "$sshd_antes"; } || true
  instalar "$F/sshd-00-eurolify.conf" "$sshd_eurolify" 644
else
  aviso "o ubuntu não tem nenhuma chave: NÃO fecho a entrada por palavra-passe (ficaríamos todos de fora)"
fi
if ((mudou && !MOSTRAR)); then
  if ! sshd -t; then
    # Nunca deixar o sshd com uma configuração inválida: volta a versão
    # anterior (ou nenhuma) e pára sem recarregar.
    if [[ -f "$sshd_antes" ]]; then mv -f "$sshd_antes" "$sshd_eurolify"; else rm -f "$sshd_eurolify"; fi
    registar "sshd -t falhou: 00-eurolify.conf reposto como estava; nada recarregado"
    echo "ERRO: sshd -t falhou; o ficheiro voltou ao que era e nada foi recarregado." >&2
    exit 1
  fi
  fazer "recarregar o ssh" systemctl reload ssh
fi
rm -f "$sshd_antes"
if tem sshd && ! ((MOSTRAR && mudou)); then
  efectivo="$(sshd -T 2>/dev/null | grep -E '^(passwordauthentication|kbdinteractiveauthentication|permitrootlogin) ' | sort | tr '\n' ' ')"
  [[ "$efectivo" == "kbdinteractiveauthentication no passwordauthentication no permitrootlogin no " ]] ||
    aviso "sshd -T não bate certo: $efectivo"
fi

# ---------------------------------------------------------------------------
passo "4. Firewall: entrada fechada; 22 e 443 abertas (ADR-0027, ADR-0033)"
ufw_verbose=""
tem ufw && ufw_verbose="$(ufw status verbose 2>&1 || true)"
if [[ "$ufw_verbose" == *"Status: active"* && "$ufw_verbose" == *"deny (incoming)"* ]] &&
  grep -qE '^22/tcp +ALLOW IN +Anywhere *$' <<<"$ufw_verbose"; then
  ok "ufw activo, entrada deny, 22/tcp aberta"
else
  fazer "ufw: entrada deny, saída allow, 22/tcp, ligar" bash -c \
    'ufw default deny incoming && ufw default allow outgoing && ufw allow 22/tcp && ufw --force enable'
fi
# A 443 para o MCP (ADR-0033). Aberta a todos, porque o login abre no browser
# de quem liga o connector (revisão do #30); o nginx deixa passar só o login,
# e o resto só ao intervalo da Anthropic (nginx-mcp.conf).
regra_443='^443/tcp( \(v6\))? +ALLOW IN +Anywhere( \(v6\))? *$'
if grep -qE '^443/tcp +ALLOW IN +Anywhere *$' <<<"$ufw_verbose"; then
  ok "443/tcp aberta (o nginx filtra)"
else
  fazer "ufw: 443/tcp (MCP, ADR-0033; o nginx filtra)" ufw allow 443/tcp
fi
if tem ufw; then
  # O formato longo (verbose) diz «ALLOW IN»; o curto diz só «ALLOW» e dava a
  # própria regra da 22 como desconhecida (visto na VPS a 04/10/2026).
  extra="$(ufw status verbose | grep -E ' (ALLOW|DENY|LIMIT|REJECT)( IN| OUT|) ' |
    grep -vE '^22/tcp( \(v6\))? +ALLOW IN +Anywhere( \(v6\))? *$' | grep -vE "$regra_443" || true)"
  [[ -z "$extra" ]] || aviso "regras da firewall que o script não conhece (não as apago): $extra"
fi

# ---------------------------------------------------------------------------
passo "5. fail2ban: bloqueio de 1 h, endereços 14 dias (ADR-0027)"
# Primeiro activo, depois a configuração: um reload com o serviço parado
# abortava o script a meio (revisão do #10).
if tem systemctl && systemctl is-active --quiet fail2ban 2>/dev/null; then
  ok "fail2ban activo"
else
  fazer "ligar o fail2ban" systemctl enable --now fail2ban
fi
f2b_mudou=0
instalar "$F/fail2ban-eurolify.local" /etc/fail2ban/jail.d/eurolify.local 644
((mudou)) && f2b_mudou=1
# O dbpurgeage é do fail2ban.conf ([Definition]), não das jaulas.
instalar "$F/fail2ban-definicao-eurolify.local" /etc/fail2ban/fail2ban.d/eurolify.local 644
((mudou)) && f2b_mudou=1
((f2b_mudou)) && fazer "reiniciar o fail2ban (a retenção da base só muda ao arrancar)" systemctl restart fail2ban

# ---------------------------------------------------------------------------
passo "6. Registos com endereços IP e contas: 14 dias (ADR-0018, ADR-0027)"
instalar "$F/journald-eurolify.conf" /etc/systemd/journald.conf.d/eurolify.conf 644
((mudou)) && fazer "reiniciar o systemd-journald" systemctl restart systemd-journald
instalar "$F/logrotate-ufw" /etc/logrotate.d/ufw 644
instalar "$F/logrotate-eurolify" /etc/logrotate.d/eurolify 644
if [[ -d /etc/rsyslog.d ]]; then
  instalar "$F/rsyslog-eurolify.conf" /etc/rsyslog.d/10-eurolify.conf 644
  ((mudou)) && fazer "reiniciar o rsyslog" systemctl restart rsyslog
fi

# ---------------------------------------------------------------------------
passo "7. Pastas e configuração sem segredos"
for d in /etc/eurolify:700 /var/lib/eurolify:755 /var/lib/eurolify/pedidos:755 \
  /var/lib/eurolify/trabalho:700 /var/lib/eurolify/copias:700 /var/log/eurolify:750; do
  caminho="${d%%:*}"
  modo="${d##*:}"
  if [[ -d "$caminho" && "$(stat -c '%a %U' "$caminho")" == "$modo root" ]]; then
    ok "$caminho"
  else
    fazer "pasta $caminho ($modo)" install -d -o root -g root -m "$modo" "$caminho"
  fi
done
instalar "$F/ensaio.conf" /etc/eurolify/ensaio.conf 644
instalar "$F/github_known_hosts" /etc/eurolify/github_known_hosts 644

# ---------------------------------------------------------------------------
passo "8. Programas e unidades do Eurolify"
instalar "$F/lib/comum.sh" /usr/local/lib/eurolify/comum.sh 644
instalar "$F/bin/eurolify-pedido" /usr/local/bin/eurolify-pedido 755
for p in trabalho publicar aplicar medir copia reposicao verificacao operar operador; do
  instalar "$F/sbin/eurolify-$p" "/usr/local/sbin/eurolify-$p" 700
done
unidades_mudaram=0
for u in "$F"/systemd/*; do
  instalar "$u" "/etc/systemd/system/$(basename "$u")" 644
  ((mudou)) && unidades_mudaram=1
done
((unidades_mudaram)) && fazer "systemctl daemon-reload" systemctl daemon-reload

# ---------------------------------------------------------------------------
passo "9. Docker e rede interna"
if tem systemctl && systemctl is-active --quiet docker 2>/dev/null; then
  ok "docker activo"
else
  fazer "ligar o docker" systemctl enable --now docker
fi
if tem docker && docker network inspect eurolify >/dev/null 2>&1; then
  ok "rede eurolify"
else
  fazer "criar a rede interna eurolify" docker network create eurolify
fi

# ---------------------------------------------------------------------------
passo "10. PostgreSQL 18, só na rede interna, sem porta publicada (AGENTS.md)"
if [[ -s /etc/eurolify/postgres.env ]]; then
  ok "/etc/eurolify/postgres.env"
else
  # shellcheck disable=SC2016 # de propósito: o $(openssl …) expande-se dentro do bash -c, ao fazer
  fazer "gerar a palavra-passe do PostgreSQL em /etc/eurolify/postgres.env" bash -c \
    'umask 077 && printf "POSTGRES_PASSWORD=%s\nPOSTGRES_DB=eurolify\n" "$(openssl rand -hex 32)" > /etc/eurolify/postgres.env'
fi
# Numa segunda corrida, ver também se continuam 600 e de root, como os
# segredos do passo 12 (revisão do #43, P2-4 do 36e8778).
if [[ -f /etc/eurolify/api.env ]]; then
  if [[ "$(stat -c '%a %U' /etc/eurolify/api.env)" == "600 root" ]]; then
    ok "/etc/eurolify/api.env"
  else
    aviso "/etc/eurolify/api.env devia ser 600 e de root"
  fi
else
  fazer "criar /etc/eurolify/api.env (vazio; a ligação da API à base entra quando a API usar a base)" \
    install -o root -g root -m 600 /dev/null /etc/eurolify/api.env
fi
# A ligação do migrador (dono das tabelas) vive num ficheiro à parte: só o
# contentor das migrações a recebe; a API nunca a vê (docs/15 §5). Escreve-se
# CHAVE=valor, sem aspas nem espaços: o Docker não os tira.
if [[ -f /etc/eurolify/migrar.env ]]; then
  if [[ "$(stat -c '%a %U' /etc/eurolify/migrar.env)" == "600 root" ]]; then
    ok "/etc/eurolify/migrar.env"
  else
    aviso "/etc/eurolify/migrar.env devia ser 600 e de root"
  fi
else
  fazer "criar /etc/eurolify/migrar.env (vazio; a ligação escreve-a o passo 10b)" \
    install -o root -g root -m 600 /dev/null /etc/eurolify/migrar.env
fi
imagem_pg="$(docker inspect -f '{{.Config.Image}}' eurolify-postgres 2>/dev/null || true)"
if [[ -z "$imagem_pg" ]]; then
  fazer "arrancar o contentor eurolify-postgres ($IMAGEM_POSTGRES)" \
    docker run -d --name eurolify-postgres \
    --restart unless-stopped \
    --network eurolify \
    --env-file /etc/eurolify/postgres.env \
    -v /var/lib/eurolify/postgres:/var/lib/postgresql \
    --memory 768m \
    --log-driver json-file --log-opt max-size=10m --log-opt max-file=3 \
    "$IMAGEM_POSTGRES" \
    -c shared_buffers=256MB -c max_connections=50
elif [[ "$imagem_pg" != "$IMAGEM_POSTGRES" ]]; then
  # Mudar a imagem da base é uma decisão (e uma cópia antes): o script não o faz.
  aviso "o eurolify-postgres corre $imagem_pg, o script pede $IMAGEM_POSTGRES — não mudo sozinho"
elif [[ "$(docker inspect -f '{{.State.Running}}' eurolify-postgres)" != true ]]; then
  fazer "arrancar o eurolify-postgres parado" docker start eurolify-postgres
else
  ok "eurolify-postgres a correr com a imagem certa"
fi
if tem docker && docker inspect eurolify-postgres >/dev/null 2>&1; then
  portas="$(docker port eurolify-postgres || true)"
  [[ -z "$portas" ]] || aviso "o eurolify-postgres tem portas publicadas: $portas"
fi

# ---------------------------------------------------------------------------
passo "10b. Utilizadores da base: o migrador (dono) e a API (sem acesso ainda) (docs/15 §5, #70)"
# O eurolify_migrador é dono da base e das tabelas e só o contentor das
# migrações recebe a ligação dele (migrar.env). O eurolify_api nasce aqui como a
# migração 0001 o criaria (o migrador não tem CREATEROLE), NOLOGIN e sem
# palavra-passe: só entra quando a API usar a base (fatia «identidade»;
# fechado por omissão). As palavras-passe gera-as este script e nunca passam
# pelo repositório, pelo chat nem pela linha de comandos (vão por stdin).
pg_valor() {
  docker exec eurolify-postgres psql -U postgres -d "$BASE_NOME" -v ON_ERROR_STOP=1 -qAtc "$1"
}
# Por omissão, o psql repete no stderr um pedaço da instrução que falhou, e
# esse stderr vai para o registo do fluxo aplicar-script no GitHub. Mascarar
# não chega (o psql corta o pedaço e o corte deixa parte da palavra-passe à
# vista: revisão do f1ede40, P1-1): com VERBOSITY=terse a mensagem sai sem a
# instrução, só com o erro e a posição. Mas um erro de sintaxe cita o token
# onde parou (`at or near "…"`), e esse token pode ser a própria palavra-passe:
# por isso o stderr só sai no fim, com qualquer sequência de 16 ou mais
# hexadecimais tapada (revisão do 09882b4, P2-A). Quem chama dá também
# `SET log_min_messages = 'panic'`, para a mensagem não ir para o registo da base.
pg_stdin() {
  local erro rc=0
  erro="$(docker exec -i eurolify-postgres psql -U postgres -d "$BASE_NOME" -v ON_ERROR_STOP=1 -v VERBOSITY=terse -qAt 2>&1 >/dev/null)" || rc=$?
  if ((rc != 0)); then
    sed -E 's/[0-9a-f]{16,}/***/g' <<<"$erro" >&2
    return "$rc"
  fi
}
# A ligação do migrar.env entra mesmo? Testa-se como a publicação a usa: de
# outro contentor, pela rede eurolify, com palavra-passe (dentro do contentor
# da base, 127.0.0.1 entra sem ela). A palavra-passe vai pelo ambiente do
# cliente docker, nunca pela linha de comandos (revisão do #71, P2-2).
# Escreve «entra», «recusada» (sem a linha esperada no ficheiro, ou a base
# recusa o migrador: renova-se) ou «erro: …» (o docker, a rede ou outra coisa
# falharam: avisa-se e não se renova; revisão do f1ede40, P2-1). A mensagem do
# erro não leva a palavra-passe: o psql e o docker não a escrevem.
# A linha tem de ser exactamente a que este script escreve (anfitrião, porta e
# base incluídos): uma linha editada à mão para outro sítio já não «entra» em
# falso (revisão do 09882b4, P2-C).
linha_do_migrador() {
  printf 'BASE_DADOS_URL_MIGRACAO=postgres://eurolify_migrador:%s@eurolify-postgres:5432/%s' "$1" "$BASE_NOME"
}
# A palavra-passe guardada no migrar.env (vazio se o ficheiro não tiver a forma
# esperada). O `sed` só leva o padrão na linha de comandos, nunca a palavra-passe.
senha_no_ficheiro() {
  sed -n 's#^BASE_DADOS_URL_MIGRACAO=postgres://eurolify_migrador:\([0-9a-f]\{64\}\)@.*#\1#p' /etc/eurolify/migrar.env 2>/dev/null | head -n 1 || true
}
# O ficheiro é só a linha que este script escreve? Compara-se dentro do bash
# (`$(<…)` e `[[ … ]]` não arrancam programas): a palavra-passe não vai para a
# linha de comandos de nenhum processo (revisão do 6892dae, P1). Só essa linha:
# outra a seguir seria a que o docker usava (revisão do 6892dae, P2-1).
ficheiro_e_so_a_linha() {
  local conteudo
  # Ver primeiro se se pode ler: em certas versões do bash (5.2), um `$(<…)` a
  # um ficheiro em falta, dentro de um `if`, pára o script com o `set -e`, e o
  # `|| return 1` não o apanha (revisão do b43c89e, P2-2).
  [[ -r /etc/eurolify/migrar.env ]] || return 1
  conteudo="$(</etc/eurolify/migrar.env)" 2>/dev/null || return 1
  [[ -n "$1" && "$conteudo" == "$(linha_do_migrador "$1")" ]]
}
estado_da_ligacao_do_migrador() {
  local senha saida
  senha="$(senha_no_ficheiro)"
  if ! ficheiro_e_so_a_linha "$senha"; then
    echo recusada
    return 0
  fi
  if saida="$(PGPASSWORD="$senha" docker run --rm --pull never --network eurolify -e PGPASSWORD "$IMAGEM_POSTGRES" \
    psql -h eurolify-postgres -U eurolify_migrador -d "$BASE_NOME" -qAtc 'SELECT 1' 2>&1 >/dev/null)"; then
    echo entra
  elif grep -qE 'password authentication failed|is not permitted to log in|too many connections for role' <<<"$saida"; then
    # A renovação também repõe LOGIN, o limite de ligações e a validade
    # (revisão do 09882b4, P2-B).
    echo recusada
  else
    echo "erro: $(head -n 1 <<<"$saida")"
  fi
}
pg_pronta() {
  local _
  for _ in $(seq 1 30); do
    docker exec eurolify-postgres pg_isready -q -U postgres -d "$BASE_NOME" 2>/dev/null && return 0
    sleep 2
  done
  return 1
}
criar_eurolify_api() {
  pg_valor "CREATE ROLE eurolify_api NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT"
}
# Palavra-passe nova no PostgreSQL primeiro, depois o ficheiro: se o ficheiro
# falhar, a corrida seguinte vê-o sem a ligação e repete.
# Global, não local: se o script morrer a meio, o trap de saída já corre fora
# da função e tem de o ver, para o ficheiro temporário com a palavra-passe não
# ficar para trás (revisão do #71, P2-4).
TEMPORARIO_MIGRAR=""
criar_migrador() {
  local senha existe
  trap 'rm -f "${TEMPORARIO_MIGRAR:-}"' EXIT
  senha="$(openssl rand -hex 32)"
  existe="$(pg_valor "SELECT count(*) FROM pg_roles WHERE rolname = 'eurolify_migrador'")"
  {
    # Uma instrução que falhe não vai para o registo do PostgreSQL com a senha.
    echo "SET log_min_error_statement = 'panic';"
    echo "SET log_min_messages = 'panic';"
    echo "SET log_statement = 'none';"
    if [[ "$existe" == 1 ]]; then
      printf "ALTER ROLE eurolify_migrador LOGIN CONNECTION LIMIT -1 VALID UNTIL 'infinity' PASSWORD '%s';\n" "$senha"
    else
      printf "CREATE ROLE eurolify_migrador LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD '%s';\n" "$senha"
    fi
  } | pg_stdin
  TEMPORARIO_MIGRAR="$(mktemp /etc/eurolify/.migrar.env.XXXXXX)"
  {
    linha_do_migrador "$senha"
    echo
  } >"$TEMPORARIO_MIGRAR"
  chown root:root "$TEMPORARIO_MIGRAR"
  chmod 600 "$TEMPORARIO_MIGRAR"
  mv -f "$TEMPORARIO_MIGRAR" /etc/eurolify/migrar.env
  TEMPORARIO_MIGRAR=""
  trap - EXIT
}
if ! docker inspect eurolify-postgres >/dev/null 2>&1; then
  if ((MOSTRAR)); then
    echo "   FARIA: criar o eurolify_api (NOLOGIN) e o eurolify_migrador, dono da base $BASE_NOME, e escrever /etc/eurolify/migrar.env"
    mudancas=$((mudancas + 1))
  else
    aviso "sem o contentor eurolify-postgres: os utilizadores da base ficam para a próxima corrida"
  fi
elif ! pg_pronta; then
  aviso "o eurolify-postgres não responde: os utilizadores da base ficam para a próxima corrida"
else
  if [[ "$(pg_valor "SELECT count(*) FROM pg_roles WHERE rolname = 'eurolify_api'")" == 0 ]]; then
    fazer "criar o papel eurolify_api (NOLOGIN, sem palavra-passe, sem BYPASSRLS)" criar_eurolify_api
  else
    ok "papel eurolify_api"
  fi
  # Em --mostrar só se lê o ficheiro: experimentar a ligação arranca um
  # contentor (revisão do f1ede40, P2-2).
  if [[ "$(pg_valor "SELECT count(*) FROM pg_roles WHERE rolname = 'eurolify_migrador'")" != 1 ]]; then
    ligacao="recusada"
  elif ((MOSTRAR)); then
    if ficheiro_e_so_a_linha "$(senha_no_ficheiro)"; then
      ligacao="no ficheiro"
    else
      ligacao="recusada"
    fi
  else
    ligacao="$(estado_da_ligacao_do_migrador)"
  fi
  case "$ligacao" in
    entra) ok "eurolify_migrador e a ligação dele em /etc/eurolify/migrar.env (entra)" ;;
    "no ficheiro") ok "eurolify_migrador e a ligação dele em /etc/eurolify/migrar.env (em --mostrar não se experimenta)" ;;
    recusada) fazer "criar o eurolify_migrador (ou renovar a palavra-passe) e escrever /etc/eurolify/migrar.env" criar_migrador ;;
    *) aviso "não consegui experimentar a ligação do migrador; não a renovo ($ligacao). Ver o docker, a rede eurolify e, na base, o CONNECT do eurolify_migrador" ;;
  esac
  # Só o dono da base retira o TEMPORARY ao PUBLIC; a migração 0001 pára se
  # não conseguir (docs/15 §5). O esquema public é do dono da base (pg_database_owner).
  if ((MOSTRAR)) && [[ "$(pg_valor "SELECT count(*) FROM pg_roles WHERE rolname = 'eurolify_migrador'")" == 0 ]]; then
    echo "   FARIA: passar a base $BASE_NOME para o eurolify_migrador"
    mudancas=$((mudancas + 1))
  elif [[ "$(pg_valor "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = '$BASE_NOME'")" != eurolify_migrador ]]; then
    fazer "passar a base $BASE_NOME para o eurolify_migrador" \
      pg_valor "ALTER DATABASE $BASE_NOME OWNER TO eurolify_migrador"
  else
    ok "a base $BASE_NOME é do eurolify_migrador"
  fi
  # Nenhum dos dois pode ignorar o RLS (docs/15 §5), e o eurolify_api não
  # entra enquanto a API não usar a base: se alguém lhes deu mais, avisa
  # (revisão do #71, P2-3).
  perigosos="$(pg_valor "SELECT string_agg(rolname, ', ') FROM pg_roles WHERE rolname IN ('eurolify_api', 'eurolify_migrador') AND (rolsuper OR rolbypassrls OR rolcreaterole)")"
  [[ -z "$perigosos" ]] || aviso "superutilizador, BYPASSRLS ou CREATEROLE em: $perigosos"
  [[ "$(pg_valor "SELECT count(*) FROM pg_roles WHERE rolname = 'eurolify_api' AND rolcanlogin")" == 0 ]] ||
    aviso "o eurolify_api pode entrar (LOGIN), mas a API ainda não usa a base (docs/15 §5)"
fi

# ---------------------------------------------------------------------------
passo "11. Utilizadores dos fluxos: sem sudo, sem docker, só um comando (ADR-0026, ADR-0028)"
for fluxo in "${FLUXOS[@]}"; do
  u="eurolify-$fluxo"
  # A casa é de root e não tem nada do utilizador (nem .bashrc): o utilizador
  # do fluxo não escreve em lado nenhum além da pasta dos pedidos.
  casa="/var/lib/eurolify/casa/$u"
  if id "$u" >/dev/null 2>&1; then
    ok "utilizador $u"
  else
    fazer "criar o utilizador $u (sem palavra-passe, casa de root)" bash -c \
      "useradd --system --no-create-home --home-dir '$casa' --shell /bin/bash '$u' && passwd -l '$u' >/dev/null"
  fi
  if [[ -d "$casa" && "$(stat -c '%a %U' "$casa")" == "755 root" ]]; then
    ok "$casa (de root)"
  else
    fazer "casa $casa de root (755)" install -d -o root -g root -m 755 "$casa"
  fi
  if id "$u" >/dev/null 2>&1; then
    grupos=" $(id -nG "$u") "
    for g in sudo docker adm; do
      if [[ "$grupos" == *" $g "* ]]; then
        fazer "tirar $u do grupo $g" gpasswd -d "$u" "$g"
      fi
    done
  fi

  pasta="/var/lib/eurolify/pedidos/$fluxo"
  if [[ -d "$pasta" && "$(stat -c '%a %U' "$pasta")" == "700 $u" ]]; then
    ok "$pasta"
  else
    fazer "pasta $pasta (700, $u)" install -d -o "$u" -g "$u" -m 700 "$pasta"
  fi

  pub="$AQUI/chaves/fluxos/$fluxo.pub"
  if [[ ! -s "$pub" ]]; then
    aviso "falta $pub: o fluxo $fluxo ainda não entra (Fase D)"
  else
    linha="restrict,command=\"/usr/local/bin/eurolify-pedido $fluxo\" $(head -n 1 "$pub")"
    temp="$(mktemp)"
    printf '%s\n' "$linha" >"$temp"
    # O authorized_keys é de root: o utilizador do fluxo não o pode mudar.
    if [[ -d "$casa/.ssh" && "$(stat -c '%U' "$casa/.ssh")" == root ]]; then :; else
      fazer "pasta $casa/.ssh de root" install -d -o root -g root -m 755 "$casa/.ssh"
    fi
    instalar "$temp" "$casa/.ssh/authorized_keys" 644
    rm -f "$temp"
  fi

  if tem systemctl && systemctl is-enabled --quiet "eurolify-pedido@$fluxo.path" 2>/dev/null &&
    systemctl is-active --quiet "eurolify-pedido@$fluxo.path" 2>/dev/null; then
    ok "eurolify-pedido@$fluxo.path"
  else
    fazer "ligar eurolify-pedido@$fluxo.path" systemctl enable --now "eurolify-pedido@$fluxo.path"
  fi
done

# ---------------------------------------------------------------------------
passo "12. Tarefas: cópia, reposição, verificação (ADR-0027, ADR-0029)"
for t in copia reposicao verificacao; do
  if tem systemctl && systemctl is-enabled --quiet "eurolify-$t.timer" 2>/dev/null &&
    systemctl is-active --quiet "eurolify-$t.timer" 2>/dev/null; then
    ok "eurolify-$t.timer"
  else
    fazer "ligar eurolify-$t.timer" systemctl enable --now "eurolify-$t.timer"
  fi
done
for s in ghcr.token ghcr.expira deploy_key rclone.conf age.pub age.key healthchecks.env; do
  if [[ -s "/etc/eurolify/$s" ]]; then
    [[ "$(stat -c '%a %U' "/etc/eurolify/$s")" == "600 root" ]] ||
      aviso "/etc/eurolify/$s devia ser 600 e de root"
  else
    aviso "falta o segredo /etc/eurolify/$s (posto pelo Diogo na Fase D, nunca pelo repositório)"
  fi
done

# ---------------------------------------------------------------------------
passo "13. MCP da VPS: utilizador, pedidos, certificado e nginx (ADR-0033)"
# O utilizador do contentor do MCP: sem casa, sem consola, sem chave SSH. Só
# escreve na pasta dos seus pedidos.
if id eurolify-mcp >/dev/null 2>&1; then
  ok "utilizador eurolify-mcp"
else
  fazer "criar o utilizador eurolify-mcp (sem casa nem consola)" \
    useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin eurolify-mcp
fi
pasta_mcp=/var/lib/eurolify/pedidos/mcp
if [[ -d "$pasta_mcp" && "$(stat -c '%a %U' "$pasta_mcp")" == "700 eurolify-mcp" ]]; then
  ok "$pasta_mcp"
else
  fazer "pasta $pasta_mcp (700, eurolify-mcp)" install -d -o eurolify-mcp -g eurolify-mcp -m 700 "$pasta_mcp"
fi
if tem systemctl && systemctl is-enabled --quiet eurolify-pedido@mcp.path 2>/dev/null &&
  systemctl is-active --quiet eurolify-pedido@mcp.path 2>/dev/null; then
  ok "eurolify-pedido@mcp.path"
else
  fazer "ligar eurolify-pedido@mcp.path" systemctl enable --now eurolify-pedido@mcp.path
fi

# Certificado pelo desafio DNS com a API da OVH: a porta 80 não abre.
instalar "$F/certbot-deploy-nginx" /etc/letsencrypt/renewal-hooks/deploy/eurolify-nginx 755
certificado="/etc/letsencrypt/live/$MCP_DOMINIO/fullchain.pem"
certificado_previsto=0 # no --mostrar: o certificado seria pedido nesta corrida
if [[ -s "$certificado" ]]; then
  ok "certificado de $MCP_DOMINIO"
elif [[ ! -s /etc/eurolify/ovh-dns.ini ]]; then
  aviso "falta /etc/eurolify/ovh-dns.ini (chave da API da OVH): sem certificado, o MCP não abre"
elif ! getent ahostsv4 "$MCP_DOMINIO" >/dev/null 2>&1; then
  aviso "$MCP_DOMINIO ainda não resolve: sem certificado, o MCP não abre"
else
  certificado_previsto=1
  fazer "pedir o certificado de $MCP_DOMINIO (Let's Encrypt, desafio DNS da OVH)" \
    certbot certonly --non-interactive --agree-tos --register-unsafely-without-email \
    --dns-ovh --dns-ovh-credentials /etc/eurolify/ovh-dns.ini --dns-ovh-propagation-seconds 60 \
    -d "$MCP_DOMINIO"
fi

# nginx: só o site do MCP. O site por omissão do pacote (porta 80) sai.
if [[ -L /etc/nginx/sites-enabled/default ]]; then
  fazer "desligar o site por omissão do nginx" rm -f /etc/nginx/sites-enabled/default
else
  ok "site por omissão do nginx desligado"
fi
instalar "$F/nginx-mcp.conf" /etc/nginx/sites-available/eurolify-mcp.conf 644
nginx_mudou=$mudou
site=/etc/nginx/sites-enabled/eurolify-mcp.conf
if [[ -s "$certificado" ]] || ((MOSTRAR && certificado_previsto)); then
  if [[ -L "$site" ]]; then
    ok "site do MCP ligado"
  else
    fazer "ligar o site do MCP no nginx" ln -s /etc/nginx/sites-available/eurolify-mcp.conf "$site"
    nginx_mudou=1
  fi
  if ((nginx_mudou && !MOSTRAR)); then
    if nginx -t 2>/dev/null; then
      fazer "recarregar o nginx" systemctl reload-or-restart nginx
    else
      rm -f "$site"
      aviso "nginx -t falhou: o site do MCP foi desligado outra vez e nada foi recarregado"
    fi
  fi
else
  aviso "sem certificado: o site do MCP fica desligado"
fi
if tem systemctl && systemctl is-active --quiet nginx 2>/dev/null; then
  ok "nginx activo"
else
  fazer "ligar o nginx" systemctl enable --now nginx
fi
for s in github-oauth.env ovh-dns.ini ovh-dns.expira; do
  if [[ -s "/etc/eurolify/$s" ]]; then
    [[ "$(stat -c '%a %U' "/etc/eurolify/$s")" == "600 root" ]] ||
      aviso "/etc/eurolify/$s devia ser 600 e de root"
  else
    aviso "falta o segredo /etc/eurolify/$s (MCP, ADR-0033)"
  fi
done

# ---------------------------------------------------------------------------
passo "Resumo"
if ((MOSTRAR)); then
  echo "   modo --mostrar: $mudancas alteração(ões) por fazer, $avisos aviso(s). Nada foi mudado."
else
  echo "   $mudancas alteração(ões) feita(s), $avisos aviso(s)."
  registar "preparar.sh terminou: $mudancas alteração(ões), $avisos aviso(s)"
fi
