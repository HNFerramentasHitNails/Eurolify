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
  # Numa condição (… || aviso) o set -e não vale: sem isto, uma falha ficava
  # registada como feita (revisão do #160, P3-4).
  "$@" || return $?
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
pacotes=(docker.io ufw fail2ban age rclone git curl openssl openssh-server nginx certbot python3-certbot-dns-ovh)
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
# As imagens dos artigos (docs/06, CQ): a API (utilizador node, uid 1000, no
# contentor) escreve aqui; mais ninguém além do root lê.
if [[ -d /var/lib/eurolify/media && "$(stat -c '%a %u %g' /var/lib/eurolify/media)" == "750 1000 1000" ]]; then
  ok "/var/lib/eurolify/media"
else
  fazer "pasta /var/lib/eurolify/media (750, da API)" \
    install -d -o 1000 -g 1000 -m 750 /var/lib/eurolify/media
fi
# Uma conta da máquina com o uid ou o gid 1000 leria as imagens (revisão do
# #178, P3-1): diz-se, para se decidir (um uid próprio para a API).
if getent passwd 1000 >/dev/null || getent group 1000 >/dev/null; then
  aviso "há uma conta ou um grupo com o número 1000 na máquina ($(getent passwd 1000 | cut -d: -f1)$(getent group 1000 | cut -d: -f1 | sed 's/^/ \/ grupo /')): pode ler as imagens da API"
fi
instalar "$F/ensaio.conf" /etc/eurolify/ensaio.conf 644
instalar "$F/github_known_hosts" /etc/eurolify/github_known_hosts 644

# ---------------------------------------------------------------------------
passo "8. Programas e unidades do Eurolify"
instalar "$F/lib/comum.sh" /usr/local/lib/eurolify/comum.sh 644
instalar "$F/lib/chave-totp.sh" /usr/local/lib/eurolify/chave-totp.sh 644
instalar "$F/bin/eurolify-pedido" /usr/local/bin/eurolify-pedido 755
for p in trabalho publicar aplicar medir copia reposicao verificacao limpeza operar operador; do
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
  fazer "criar /etc/eurolify/api.env (vazio; a ligação à base vai no api-base.env)" \
    install -o root -g root -m 600 /dev/null /etc/eurolify/api.env
fi
# A ligação da API à base vive num ficheiro só dela (api-base.env), que o
# passo 10b escreve inteiro: outra configuração da API vai no api.env, que o
# script nunca reescreve (revisão do #116, P2-3).
if [[ -f /etc/eurolify/api-base.env ]]; then
  if [[ "$(stat -c '%a %U' /etc/eurolify/api-base.env)" == "600 root" ]]; then
    ok "/etc/eurolify/api-base.env"
  else
    aviso "/etc/eurolify/api-base.env devia ser 600 e de root"
  fi
fi
# A chave que cifra os segredos TOTP das palavras-passe (docs/21 §8; docs/22
# §9.2): fora da base, num ficheiro só da API. Gera-se UMA vez e nunca se
# reescreve: trocá-la deixava ilegíveis os autenticadores já configurados
# (cada pessoa teria de os configurar outra vez). Sem ela, a API corre sem a
# palavra-passe. Pedido pelo Diogo, 08/10/2026 (pedido #177). Nas mensagens,
# nunca o conteúdo.
# shellcheck source=ficheiros/lib/chave-totp.sh
source "$F/lib/chave-totp.sh"
api_totp=/etc/eurolify/api-totp.env
TOTP_GERADA=0
if [[ -e "$api_totp" || -L "$api_totp" ]]; then
  if [[ ! -f "$api_totp" || -L "$api_totp" ]]; then
    aviso "$api_totp existe mas não é um ficheiro normal: não lhe toco; a API arranca sem a palavra-passe (LEIA-ME, «A chave dos segredos TOTP»)"
  elif [[ "$(stat -c '%a %U' "$api_totp")" != "600 root" ]]; then
    aviso "$api_totp devia ser 600 e de root"
  elif ! chave_totp_valida "$api_totp"; then
    aviso "$api_totp não tem o formato esperado: não o reescrevo, e a API arranca sem a palavra-passe até se corrigir à mão (LEIA-ME, «A chave dos segredos TOTP»)"
  else
    ok "$api_totp (a chave dos segredos TOTP)"
  fi
else
  # O 10c recria a API para a ler; no --mostrar, diz que o faria (P3-3).
  if fazer "gerar a chave dos segredos TOTP em $api_totp" gerar_chave_totp "$api_totp"; then
    TOTP_GERADA=1
  else
    aviso "não se gerou a chave dos segredos TOTP: a API corre sem a palavra-passe"
  fi
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
passo "10b. Utilizadores da base: o migrador (dono), a API, a limpeza e o operador (docs/15 §5, #70, #107)"
# O eurolify_migrador é dono da base e das tabelas e só o contentor das
# migrações recebe a ligação dele (migrar.env). O eurolify_api nasce aqui como a
# migração 0001 o criaria (o migrador não tem CREATEROLE) e entra com a ligação
# do api-base.env, que só o contentor da API recebe (docs/19 §6, #107). Os dois
# seguem o mesmo caminho: palavra-passe gerada na máquina, dada ao PostgreSQL
# por stdin, e um ficheiro 600 de root com uma só linha. As palavras-passe
# nunca passam pelo repositório, pelo chat nem pela linha de comandos.
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
# As funções seguintes recebem «ficheiro variável papel»: o migrar.env com
# BASE_DADOS_URL_MIGRACAO e o eurolify_migrador, ou o api-base.env com
# BASE_DADOS_URL e o eurolify_api. Os papéis e as variáveis vêm deste script,
# nunca de fora.
#
# A linha tem de ser exactamente a que este script escreve (anfitrião, porta e
# base incluídos): uma linha editada à mão para outro sítio já não «entra» em
# falso (revisão do 09882b4, P2-C).
linha_de_ligacao() {
  printf '%s=postgres://%s:%s@eurolify-postgres:5432/%s' "$1" "$2" "$3" "$BASE_NOME"
}
# A palavra-passe guardada no ficheiro (vazio se o ficheiro não tiver a forma
# esperada). O `sed` só leva o padrão na linha de comandos, nunca a palavra-passe.
senha_no_ficheiro() {
  sed -n "s#^$2=postgres://$3:\\([0-9a-f]\\{64\\}\\)@.*#\\1#p" "$1" 2>/dev/null | head -n 1 || true
}
# O ficheiro é só a linha que este script escreve? Compara-se dentro do bash
# (`$(<…)` e `[[ … ]]` não arrancam programas): a palavra-passe não vai para a
# linha de comandos de nenhum processo (revisão do 6892dae, P1). Só essa linha:
# outra a seguir seria a que o docker usava (revisão do 6892dae, P2-1).
ficheiro_e_so_a_linha() {
  local ficheiro="$1" variavel="$2" papel="$3" senha="$4" conteudo
  # Ver primeiro se se pode ler: em certas versões do bash (5.2), um `$(<…)` a
  # um ficheiro em falta, dentro de um `if`, pára o script com o `set -e`, e o
  # `|| return 1` não o apanha (revisão do b43c89e, P2-2).
  [[ -r "$ficheiro" ]] || return 1
  conteudo="$(<"$ficheiro")" 2>/dev/null || return 1
  [[ -n "$senha" && "$conteudo" == "$(linha_de_ligacao "$variavel" "$papel" "$senha")" ]]
}
# A ligação do ficheiro entra mesmo? Testa-se como a publicação a usa: de
# outro contentor, pela rede eurolify, com palavra-passe (dentro do contentor
# da base, 127.0.0.1 entra sem ela). A palavra-passe vai pelo ambiente do
# cliente docker, nunca pela linha de comandos (revisão do #71, P2-2).
# Escreve «entra», «recusada» (sem a linha esperada no ficheiro, ou a base
# recusa o papel: renova-se) ou «erro: …» (o docker, a rede ou outra coisa
# falharam: avisa-se e não se renova; revisão do f1ede40, P2-1). A mensagem do
# erro não leva a palavra-passe: o psql e o docker não a escrevem.
estado_da_ligacao() {
  local ficheiro="$1" variavel="$2" papel="$3" senha saida
  senha="$(senha_no_ficheiro "$ficheiro" "$variavel" "$papel")"
  if ! ficheiro_e_so_a_linha "$ficheiro" "$variavel" "$papel" "$senha"; then
    echo recusada
    return 0
  fi
  if saida="$(PGPASSWORD="$senha" docker run --rm --pull never --network eurolify -e PGPASSWORD "$IMAGEM_POSTGRES" \
    psql -h eurolify-postgres -U "$papel" -d "$BASE_NOME" -qAtc 'SELECT 1' 2>&1 >/dev/null)"; then
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
TEMPORARIO_LIGACAO=""
criar_ligacao() {
  local ficheiro="$1" variavel="$2" papel="$3" senha existe
  trap 'rm -f "${TEMPORARIO_LIGACAO:-}"' EXIT
  senha="$(openssl rand -hex 32)"
  existe="$(pg_valor "SELECT count(*) FROM pg_roles WHERE rolname = '$papel'")"
  {
    # Uma instrução que falhe não vai para o registo do PostgreSQL com a senha.
    echo "SET log_min_error_statement = 'panic';"
    echo "SET log_min_messages = 'panic';"
    echo "SET log_statement = 'none';"
    if [[ "$existe" == 1 ]]; then
      printf "ALTER ROLE %s LOGIN CONNECTION LIMIT -1 VALID UNTIL 'infinity' PASSWORD '%s';\n" "$papel" "$senha"
    else
      printf "CREATE ROLE %s LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD '%s';\n" "$papel" "$senha"
    fi
  } | pg_stdin
  TEMPORARIO_LIGACAO="$(mktemp "$(dirname "$ficheiro")/.$(basename "$ficheiro").XXXXXX")"
  {
    linha_de_ligacao "$variavel" "$papel" "$senha"
    echo
  } >"$TEMPORARIO_LIGACAO"
  chown root:root "$TEMPORARIO_LIGACAO"
  chmod 600 "$TEMPORARIO_LIGACAO"
  mv -f "$TEMPORARIO_LIGACAO" "$ficheiro"
  TEMPORARIO_LIGACAO=""
  trap - EXIT
}
# Garante o papel com LOGIN e a ligação dele no ficheiro; devolve a ligação a
# seguir na variável global LIGACAO_RENOVADA (1 se escreveu ou escreveria).
LIGACAO_RENOVADA=0
tratar_ligacao() {
  local ficheiro="$1" variavel="$2" papel="$3" ligacao
  LIGACAO_RENOVADA=0
  # Em --mostrar só se lê o ficheiro: experimentar a ligação arranca um
  # contentor (revisão do f1ede40, P2-2).
  if [[ "$(pg_valor "SELECT count(*) FROM pg_roles WHERE rolname = '$papel' AND rolcanlogin")" != 1 ]]; then
    ligacao="recusada"
  elif ((MOSTRAR)); then
    if ficheiro_e_so_a_linha "$ficheiro" "$variavel" "$papel" "$(senha_no_ficheiro "$ficheiro" "$variavel" "$papel")"; then
      ligacao="no ficheiro"
    else
      ligacao="recusada"
    fi
  else
    ligacao="$(estado_da_ligacao "$ficheiro" "$variavel" "$papel")"
  fi
  case "$ligacao" in
    entra) ok "$papel e a ligação dele em $ficheiro (entra)" ;;
    "no ficheiro") ok "$papel e a ligação dele em $ficheiro (em --mostrar não se experimenta)" ;;
    recusada)
      LIGACAO_RENOVADA=1
      fazer "dar LOGIN ao $papel (ou criá-lo, ou renovar a palavra-passe) e escrever $ficheiro" \
        criar_ligacao "$ficheiro" "$variavel" "$papel"
      ;;
    *) aviso "não consegui experimentar a ligação do $papel; não a renovo ($ligacao). Ver o docker, a rede eurolify e, na base, o CONNECT do $papel" ;;
  esac
}
API_ENV_RENOVADO=0
if ! docker inspect eurolify-postgres >/dev/null 2>&1; then
  if ((MOSTRAR)); then
    echo "   FARIA: criar o eurolify_migrador, dono da base $BASE_NOME, e o eurolify_api, e escrever /etc/eurolify/migrar.env e /etc/eurolify/api-base.env"
    mudancas=$((mudancas + 1))
    API_ENV_RENOVADO=1
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
  tratar_ligacao /etc/eurolify/migrar.env BASE_DADOS_URL_MIGRACAO eurolify_migrador
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
  # A API entra com o eurolify_api, nunca com o dono das tabelas: o RLS forçado
  # aplica-se a ela e o que pode fazer é o que as migrações lhe dão (docs/15 §5).
  tratar_ligacao /etc/eurolify/api-base.env BASE_DADOS_URL eurolify_api
  API_ENV_RENOVADO=$LIGACAO_RENOVADA
  # O papel da limpeza diária da idempotência (migração 0013; revisão do #119,
  # P2-2): entra só pelo socket do contentor (LOGIN sem palavra-passe: de fora,
  # o PostgreSQL pede palavra-passe e ele não tem), não é superutilizador,
  # passa o RLS forçado (BYPASSRLS) e só toca na idempotência. O migrador não
  # o pode criar (nem dar BYPASSRLS); a migração dá-lhe os privilégios se ele
  # já existir, e aqui dão-se se ela correu antes dele.
  if [[ "$(pg_valor "SELECT count(*) FROM pg_roles WHERE rolname = 'eurolify_limpeza'")" == 0 ]]; then
    fazer "criar o papel eurolify_limpeza (LOGIN sem palavra-passe, BYPASSRLS, sem superutilizador)" \
      pg_valor "CREATE ROLE eurolify_limpeza LOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT"
  else
    ok "papel eurolify_limpeza"
  fi
  # Os privilégios na mesma corrida que cria o papel: se a migração 0013
  # correu antes dele, não os deu. Em --mostrar, sem o papel, diz o que faria.
  if ((MOSTRAR)) && [[ "$(pg_valor "SELECT count(*) FROM pg_roles WHERE rolname = 'eurolify_limpeza'")" == 0 ]]; then
    if [[ "$(pg_valor "SELECT to_regclass('public.idempotencia') IS NOT NULL")" == t ]]; then
      echo "   FARIA: dar ao eurolify_limpeza os privilégios na idempotencia e nas funções da limpeza e dos prazos"
      mudancas=$((mudancas + 1))
    fi
  else
    if [[ "$(pg_valor "SELECT to_regclass('public.idempotencia') IS NOT NULL")" == t ]]; then
      if [[ "$(pg_valor "SELECT has_table_privilege('eurolify_limpeza', 'public.idempotencia', 'SELECT') AND has_table_privilege('eurolify_limpeza', 'public.idempotencia', 'DELETE')")" == t ]]; then
        ok "eurolify_limpeza lê e apaga na idempotencia"
      else
        fazer "dar SELECT e DELETE na idempotencia ao eurolify_limpeza" \
          pg_valor "GRANT SELECT, DELETE ON public.idempotencia TO eurolify_limpeza"
      fi
    fi
    if [[ "$(pg_valor "SELECT to_regprocedure('public.idempotencia_apagar_expiradas()') IS NOT NULL")" == t ]]; then
      if [[ "$(pg_valor "SELECT has_function_privilege('eurolify_limpeza', 'public.idempotencia_apagar_expiradas()', 'EXECUTE')")" == t ]]; then
        ok "eurolify_limpeza chama idempotencia_apagar_expiradas()"
      else
        fazer "dar EXECUTE em idempotencia_apagar_expiradas() ao eurolify_limpeza" \
          pg_valor "GRANT EXECUTE ON FUNCTION public.idempotencia_apagar_expiradas() TO eurolify_limpeza"
      fi
    fi
    # Os prazos das contas de pessoas (migração 0026; docs/21 §13): só o
    # EXECUTE das duas funções, nenhuma tabela das contas. A contagem dos
    # ficheiros de imagem sem uso (0035), para a verificação diária (revisão
    # do #215, P2-3).
    for f in 'contas_aplicar_prazos()' 'contas_prazos_em_atraso()' 'ficheiros_sem_uso_em_atraso()'; do
      if [[ "$(pg_valor "SELECT to_regprocedure('public.$f') IS NOT NULL")" == t ]]; then
        if [[ "$(pg_valor "SELECT has_function_privilege('eurolify_limpeza', 'public.$f', 'EXECUTE')")" == t ]]; then
          ok "eurolify_limpeza chama $f"
        else
          fazer "dar EXECUTE em $f ao eurolify_limpeza" \
            pg_valor "GRANT EXECUTE ON FUNCTION public.$f TO eurolify_limpeza"
        fi
      fi
    done
    [[ "$(pg_valor "SELECT count(*) FROM pg_authid WHERE rolname = 'eurolify_limpeza' AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolpassword IS NOT NULL)")" == 0 ]] ||
      aviso "o eurolify_limpeza tem superutilizador, CREATEROLE, CREATEDB ou palavra-passe: devia entrar só pelo contentor e só tocar na idempotência e nas funções dos prazos"
  fi
  # O papel do comando do operador (migração 0043; revisão do #110, P3-8;
  # #107): entra com palavra-passe pela rede, como a API, mas só chama as três
  # portas do operador (criar um comerciante, uma chave de servidor e o
  # convite do primeiro dono). Antes, o comando corria com o dono das tabelas
  # (migrar.env). A ligação vai para o operador.env, que só o contentor do
  # eurolify-operador recebe. A migração dá o EXECUTE se o papel já existir;
  # aqui dá-se se ela correu antes dele.
  tratar_ligacao /etc/eurolify/operador.env BASE_DADOS_URL_OPERADOR eurolify_operador
  operador_existe="$(pg_valor "SELECT count(*) FROM pg_roles WHERE rolname = 'eurolify_operador'")"
  if ((!MOSTRAR)) && [[ "$operador_existe" == 0 ]]; then
    aviso "sem o papel eurolify_operador: o EXECUTE nas portas do operador fica para a próxima corrida"
  fi
  for f in 'comerciante_criar_pelo_operador(text,text,text,text,text)' \
    'chave_criar(text,uuid,text,text[],text,text,text,timestamp with time zone)' \
    'convite_criar_pelo_operador(uuid,text,text,text,text)'; do
    if [[ "$(pg_valor "SELECT to_regprocedure('public.$f') IS NOT NULL")" != t ]]; then
      continue
    fi
    if [[ "$operador_existe" == 0 ]]; then
      if ((MOSTRAR)); then
        echo "   FARIA: dar EXECUTE em $f ao eurolify_operador"
        mudancas=$((mudancas + 1))
      fi
    elif [[ "$(pg_valor "SELECT has_function_privilege('eurolify_operador', 'public.$f', 'EXECUTE')")" == t ]]; then
      ok "eurolify_operador chama $f"
    else
      fazer "dar EXECUTE em $f ao eurolify_operador" \
        pg_valor "GRANT EXECUTE ON FUNCTION public.$f TO eurolify_operador"
    fi
  done
  # O operador só chama as três portas: se alguém lhe deu uma tabela ou outra
  # função, avisa (revisão do #293, P3-3).
  if [[ "$operador_existe" == 1 ]]; then
    a_mais="$(pg_valor "SELECT string_agg(x, ', ') FROM (SELECT c.relname AS x FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm', 'p') AND (has_table_privilege('eurolify_operador', c.oid, 'SELECT') OR has_table_privilege('eurolify_operador', c.oid, 'INSERT') OR has_table_privilege('eurolify_operador', c.oid, 'UPDATE') OR has_table_privilege('eurolify_operador', c.oid, 'DELETE')) UNION ALL SELECT p.proname || '()' FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND has_function_privilege('eurolify_operador', p.oid, 'EXECUTE') AND p.proname NOT IN ('comerciante_criar_pelo_operador', 'chave_criar', 'convite_criar_pelo_operador')) t")"
    [[ -z "$a_mais" ]] || aviso "o eurolify_operador tem mais do que as três portas do operador: $a_mais"
  fi
  # Nenhum dos três pode ignorar o RLS (docs/15 §5): se alguém lhes deu mais,
  # avisa (revisão do #71, P2-3).
  perigosos="$(pg_valor "SELECT string_agg(rolname, ', ') FROM pg_roles WHERE rolname IN ('eurolify_api', 'eurolify_migrador', 'eurolify_operador') AND (rolsuper OR rolbypassrls OR rolcreaterole)")"
  [[ -z "$perigosos" ]] || aviso "superutilizador, BYPASSRLS ou CREATEROLE em: $perigosos"
fi

# ---------------------------------------------------------------------------
passo "10c. A API corre com a sua configuração: api.env, api-base.env, api-hub.env e api-totp.env (docs/19 §6, #107)"
# O docker só lê o --env-file quando cria o contentor: uma ligação nova só
# chega à API quando o contentor for recriado. Quem o recria é o
# eurolify-publicar --so-recriar, com a imagem que já está no ar (passo 8 já o
# instalou): espera por outra publicação em curso, não troca de imagem,
# verifica o /health e que a API chega à base (revisão do #116, P2-1).
# Sem um número válido de um dos lados, não se compara (revisão do #116, P3-1).
# Em nanossegundos, como o eurolify-publicar (revisão do #162, P3-E).
configuracao_mais_recente_que_a_api() {
  local criado ficheiro mudado montagens
  criado="$(docker inspect -f '{{.Created}}' eurolify-api 2>/dev/null)" || return 1
  # A API no ar sem a pasta das imagens (criada antes do #178) também se
  # recria, como no eurolify-publicar: sem isto, a pasta só chegava na
  # publicação seguinte (o que aconteceu ao aplicar o #178, 08/10/2026). Um
  # inspect que falha não recria.
  montagens="$(docker inspect -f '{{range .Mounts}}{{.Destination}} {{end}}' eurolify-api 2>/dev/null)" || return 1
  [[ " $montagens " == *" /media "* ]] || return 0
  criado="$(date -d "$criado" +%s%N 2>/dev/null)" || return 1
  [[ "$criado" =~ ^[0-9]+$ ]] || return 1
  for ficheiro in /etc/eurolify/api.env /etc/eurolify/api-base.env /etc/eurolify/api-hub.env /etc/eurolify/api-totp.env; do
    mudado="$(stat -c %.9Y "$ficheiro" 2>/dev/null)" || continue
    mudado="${mudado/./}"
    [[ "$mudado" =~ ^[0-9]+$ ]] && ((mudado > criado)) && return 0
  done
  return 1
}
# Uma falha aqui avisa, fica no registo e não pára o resto do script; a
# publicação diz porquê (revisão do #116, P3-2).
recriar_api() {
  /usr/local/sbin/eurolify-publicar "$1" --so-recriar && return 0
  registar "falhou recriar o contentor eurolify-api ($1) com a configuração nova"
  aviso "a API não ficou bem com a configuração nova (ver acima)"
}
imagem_api="$(docker inspect -f '{{.Config.Image}}' eurolify-api 2>/dev/null || true)"
if [[ -z "$imagem_api" ]]; then
  ok "sem contentor eurolify-api: a primeira publicação já o cria com a ligação"
elif ((API_ENV_RENOVADO || TOTP_GERADA)) || configuracao_mais_recente_que_a_api; then
  resumo_api="${imagem_api##*@}"
  # O eurolify-publicar só recria a imagem do IMAGEM_REPO desta máquina: com
  # outro repositório, dizia «não recrio» e saía bem (revisão do #180, P3-1).
  if [[ -n "$imagem_api" && "${imagem_api%@*}" != "$IMAGEM_REPO" ]]; then
    aviso "o eurolify-api corre $imagem_api, de outro repositório que não $IMAGEM_REPO: não o recrio (a próxima publicação recria-o)"
  elif [[ "$resumo_api" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    fazer "recriar o contentor eurolify-api ($resumo_api) para ler a configuração" recriar_api "$resumo_api"
  else
    aviso "o eurolify-api corre $imagem_api, sem resumo: não o recrio (a próxima publicação recria-o)"
  fi
else
  ok "o eurolify-api foi criado depois da última mudança da sua configuração (e, se as montagens se leram, tem a pasta das imagens)"
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
passo "12. Tarefas: cópia, reposição, verificação, limpeza (ADR-0027, ADR-0029, docs/18 §4)"
for t in copia reposicao verificacao limpeza; do
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
# O site do Hub ligado sem o seu certificado faria falhar o nginx -t deste
# passo, e quem ficava desligado era o MCP (revisão do #160, P3-2).
if [[ -L /etc/nginx/sites-enabled/eurolify-hub.conf && ! -s "/etc/letsencrypt/live/$HUB_DOMINIO/fullchain.pem" ]]; then
  fazer "desligar o site do Hub (sem certificado)" rm -f /etc/nginx/sites-enabled/eurolify-hub.conf
  # Recarrega já: o passo 14 já não vê a ligação e não recarregaria
  # (revisão do #162, P3-D).
  if ((!MOSTRAR)) && nginx -t 2>/dev/null; then
    fazer "recarregar o nginx" systemctl reload-or-restart nginx
  fi
fi
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
    -d "$MCP_DOMINIO" ||
    aviso "o certificado de $MCP_DOMINIO não foi emitido: o MCP fica desligado (revisão do #162, P3-C)"
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
passo "14. Hub de gestão: certificado, nginx e a configuração da API (docs/22 §7)"
# Como o MCP: certificado pelo desafio DNS da OVH (a porta 80 não abre); o
# site só se liga com ele. A API só recebe a HUB_ORIGEM com o site ligado, e
# com ela a PROXY_CONFIAVEL: o gateway da rede Docker eurolify, que é o
# endereço de onde o nginx chega ao contentor (revisão do #154, P1-1). O
# gateway lê-se aqui em cada corrida, por isso não precisa de ficar fixo.
if [[ -d /var/lib/eurolify/hub ]]; then
  ok "/var/lib/eurolify/hub"
else
  fazer "criar /var/lib/eurolify/hub (os ecrãs do Hub, que o eurolify-publicar copia)" \
    install -d -o root -g root -m 755 /var/lib/eurolify/hub
fi
certificado_hub="/etc/letsencrypt/live/$HUB_DOMINIO/fullchain.pem"
hub_previsto=0 # no --mostrar: o certificado seria pedido nesta corrida
if [[ -s "$certificado_hub" ]]; then
  ok "certificado de $HUB_DOMINIO"
elif [[ ! -s /etc/eurolify/ovh-dns.ini ]]; then
  aviso "falta /etc/eurolify/ovh-dns.ini (chave da API da OVH): sem certificado, o Hub fica desligado"
elif ! getent ahostsv4 "$HUB_DOMINIO" >/dev/null 2>&1; then
  aviso "$HUB_DOMINIO ainda não resolve (falta o registo A na zona da OVH): o Hub fica desligado"
else
  hub_previsto=1
  # Uma falha não pára o resto do script: o Hub fica desligado (revisão do
  # #160, P3-4).
  fazer "pedir o certificado de $HUB_DOMINIO (Let's Encrypt, desafio DNS da OVH)" \
    certbot certonly --non-interactive --agree-tos --register-unsafely-without-email \
    --dns-ovh --dns-ovh-credentials /etc/eurolify/ovh-dns.ini --dns-ovh-propagation-seconds 60 \
    -d "$HUB_DOMINIO" ||
    aviso "o certificado de $HUB_DOMINIO não foi emitido: o Hub fica desligado"
fi
instalar "$F/nginx-hub.conf" /etc/nginx/sites-available/eurolify-hub.conf 644
nginx_hub_mudou=$mudou
site_hub=/etc/nginx/sites-enabled/eurolify-hub.conf
hub_ligado=0
if [[ -s "$certificado_hub" ]] || ((MOSTRAR && hub_previsto)); then
  if [[ -L "$site_hub" ]]; then
    ok "site do Hub ligado"
  else
    fazer "ligar o site do Hub no nginx" ln -s /etc/nginx/sites-available/eurolify-hub.conf "$site_hub"
    nginx_hub_mudou=1
  fi
  hub_ligado=1
  if ((nginx_hub_mudou && !MOSTRAR)); then
    if saida_nginx="$(nginx -t 2>&1)"; then
      fazer "recarregar o nginx" systemctl reload-or-restart nginx
    else
      rm -f "$site_hub"
      hub_ligado=0
      printf '%s\n' "$saida_nginx" | tail -n 3 | sed 's/^/      /'
      aviso "nginx -t falhou: o site do Hub foi desligado outra vez e nada foi recarregado"
    fi
  fi
  [[ -f /var/lib/eurolify/hub/actual/index.html ]] || ((MOSTRAR)) ||
    aviso "ainda não há ecrãs do Hub em /var/lib/eurolify/hub/actual (a próxima publicação põe-nos)"
elif [[ -L "$site_hub" ]]; then
  fazer "desligar o site do Hub (sem certificado)" rm -f "$site_hub"
  # Sem recarregar, o nginx em execução continuava a servir o Hub (P3-2).
  if ((!MOSTRAR)) && nginx -t 2>/dev/null; then
    fazer "recarregar o nginx" systemctl reload-or-restart nginx
  fi
else
  aviso "sem certificado: o site do Hub fica desligado"
fi

# A configuração do Hub na API: só com o site ligado; sem ele, o ficheiro fica
# vazio (não se apaga: o eurolify-publicar vê a mudança pela data e recria a API).
api_hub=/etc/eurolify/api-hub.env
hub_desejado=""
if ((hub_ligado)); then
  gateway="$(docker network inspect eurolify -f '{{range .IPAM.Config}}{{.Gateway}}{{end}}' 2>/dev/null || true)"
  if [[ "$gateway" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; then
    hub_desejado="$(printf 'HUB_ORIGEM=https://%s\nPROXY_CONFIAVEL=%s' "$HUB_DOMINIO" "$gateway")"
  elif ((MOSTRAR)); then
    hub_desejado="HUB_ORIGEM=https://$HUB_DOMINIO (com o gateway da rede eurolify)"
  else
    aviso "não se leu o gateway da rede eurolify: a API fica sem o Hub"
  fi
fi
# Escreve o ficheiro inteiro, 600 e de root, e troca-o de uma vez.
escrever_api_hub() {
  (
    umask 077
    if [[ -n "$1" ]]; then printf '%s\n' "$1"; fi >"$api_hub.novo"
  )
  chown root:root "$api_hub.novo"
  mv -f "$api_hub.novo" "$api_hub"
}
hub_actual_env="$(cat "$api_hub" 2>/dev/null || true)"
hub_env_mudou=0
# Nas mensagens e no registo, só um texto fixo, nunca o conteúdo (revisão do
# #160, P3-1).
if [[ -n "$hub_desejado" ]]; then texto_hub="com HUB_ORIGEM e PROXY_CONFIAVEL"; else texto_hub="vazio: Hub desligado"; fi
if [[ -f "$api_hub" && "$hub_actual_env" == "$hub_desejado" ]]; then
  ok "$api_hub ($texto_hub)"
else
  fazer "escrever $api_hub ($texto_hub)" escrever_api_hub "$hub_desejado"
  hub_env_mudou=1
fi
if ((hub_env_mudou && !MOSTRAR)); then
  imagem_api="$(docker inspect -f '{{.Config.Image}}' eurolify-api 2>/dev/null || true)"
  resumo_api="${imagem_api##*@}"
  # O eurolify-publicar só recria a imagem do IMAGEM_REPO desta máquina: com
  # outro repositório, dizia «não recrio» e saía bem (revisão do #180, P3-1).
  if [[ -n "$imagem_api" && "${imagem_api%@*}" != "$IMAGEM_REPO" ]]; then
    aviso "o eurolify-api corre $imagem_api, de outro repositório que não $IMAGEM_REPO: não o recrio (a próxima publicação recria-o)"
  elif [[ "$resumo_api" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    fazer "recriar o contentor eurolify-api ($resumo_api) com a configuração do Hub" recriar_api "$resumo_api"
  else
    ok "sem contentor eurolify-api com resumo: a próxima publicação já lê a configuração do Hub"
  fi
fi

# Com o Hub ligado, uma medição pelo próprio nginx: os ecrãs abrem e a API do
# Hub responde (sem sessão, 401).
if ((hub_ligado && !MOSTRAR)) && [[ -n "$hub_desejado" ]]; then
  pagina="$(curl -sS -m 5 -o /dev/null -w '%{http_code}' --resolve "$HUB_DOMINIO:443:127.0.0.1" "https://$HUB_DOMINIO/entrar" 2>/dev/null || true)"
  eu="$(curl -sS -m 5 -o /dev/null -w '%{http_code}' --resolve "$HUB_DOMINIO:443:127.0.0.1" "https://$HUB_DOMINIO/hub/me" 2>/dev/null || true)"
  if [[ "$pagina" == 200 && "$eu" == 401 ]]; then
    ok "o Hub abre (/entrar 200) e a API do Hub responde (/hub/me 401 sem sessão)"
  else
    aviso "o Hub não respondeu como devia: /entrar ${pagina:-nada} (esperava 200), /hub/me ${eu:-nada} (esperava 401)"
  fi
fi

# ---------------------------------------------------------------------------
passo "Resumo"
if ((MOSTRAR)); then
  echo "   modo --mostrar: $mudancas alteração(ões) por fazer, $avisos aviso(s). Nada foi mudado."
else
  echo "   $mudancas alteração(ões) feita(s), $avisos aviso(s)."
  registar "preparar.sh terminou: $mudancas alteração(ões), $avisos aviso(s)"
fi
