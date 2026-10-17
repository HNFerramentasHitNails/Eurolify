#!/usr/bin/env bash
# Preparação da máquina do executor de CI do Eurolify (ADR-0046; docs/11 para a
# VPS, de que isto copia o estilo). Pode correr-se várias vezes: cada passo vê o
# estado e só muda o que falta. Com --mostrar não muda nada: diz o que faria.
#
#   sudo bash infra/ci-executor/preparar.sh --mostrar
#   sudo bash infra/ci-executor/preparar.sh
#
# SÓ NUMA MÁQUINA DEDICADA, Ubuntu 24.04. Nunca na VPS do ensaio: os fluxos
# correm código dos pedidos com acesso ao docker, que é root na máquina; a VPS
# tem a base, as chaves e os dados (infra/ci-executor/LEIA-ME.md).
#
# O token de registo do executor NUNCA vem para o repositório, para o chat nem
# para um ficheiro, nem numa variável de ambiente (ficava no histórico):
# escreve-se quando o script o pede, sem aparecer no ecrã.
#
# Nunca apaga sozinho: chaves, regras da firewall, contas ou executores que não
# conhece ficam e aparecem como AVISO, para uma pessoa decidir.
set -Eeuo pipefail
umask 022

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
F="$AQUI/ficheiros"
# shellcheck source=ficheiros/executor.conf
source "$F/executor.conf"

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
EXECUTOR="$PASTA/executor"
NOME_EXECUTOR="${EUROLIFY_CI_NOME:-eurolify-ci-$(hostname -s)}"
TOKEN_REGISTO=""
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
  install -d -m 750 /var/log/eurolify-ci
  printf '%s | %s | %s\n' "$(date -u +%FT%TZ)" "$EUROLIFY_ORIGEM" "$*" >>/var/log/eurolify-ci/acoes.log
  logger -t eurolify-ci -- "$EUROLIFY_ORIGEM: $*" 2>/dev/null || true
}

# fazer "descrição" comando argumentos... (a descrição nunca leva segredos)
fazer() {
  local descricao="$1"
  shift
  mudancas=$((mudancas + 1))
  if ((MOSTRAR)); then
    echo "   FARIA: $descricao"
    return 0
  fi
  echo "   a fazer: $descricao"
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
passo "0. Esta máquina serve? (dedicada, Ubuntu 24.04, x86_64)"
# shellcheck disable=SC1091
versao_so="$(. /etc/os-release && echo "${ID:-?} ${VERSION_ID:-?}")"
[[ "$versao_so" == "ubuntu 24.04" ]] || aviso "o sistema é «$versao_so»; este script foi escrito para ubuntu 24.04"
[[ "$(uname -m)" == "x86_64" ]] || {
  echo "ERRO: o script instala o executor linux-x64; esta máquina é $(uname -m)." >&2
  exit 1
}
# A VPS do ensaio tem a base, as chaves e os dados: aqui nunca.
if [[ -e /etc/eurolify || -e /usr/local/sbin/eurolify-trabalho || -e /var/lib/eurolify ]]; then
  echo "ERRO: isto parece a VPS do ensaio (há /etc/eurolify). O executor de CI corre código dos" >&2
  echo "pedidos com acesso ao docker (root): só numa máquina dedicada (ADR-0046)." >&2
  exit 1
fi
ok "máquina sem sinais da VPS do ensaio"

# ---------------------------------------------------------------------------
passo "1. Pacotes"
pacotes=(docker.io docker-buildx git curl jq shellcheck gh skopeo ufw fail2ban unattended-upgrades
  openssh-server openssh-client openssl ca-certificates build-essential python3 unzip tar)
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
if tem systemctl && systemctl is-active --quiet docker 2>/dev/null; then
  ok "docker activo"
else
  fazer "ligar o docker" systemctl enable --now docker
fi

# ---------------------------------------------------------------------------
passo "2. Utilizador do executor: sem sudo, sem SSH, no grupo docker"
# O grupo docker equivale a root nesta máquina (quem corre `docker run -v /:/x`
# lê e escreve tudo). Aceita-se SÓ porque a máquina é dedicada e não guarda
# nenhum segredo do repositório (ADR-0046). Os trabalhos precisam do docker
# (PostgreSQL de teste, imagens, buildx).
if id "$UTILIZADOR" >/dev/null 2>&1; then
  ok "utilizador $UTILIZADOR"
else
  fazer "criar o utilizador $UTILIZADOR (sem palavra-passe)" \
    useradd --create-home --shell /bin/bash --comment "Executor de CI do Eurolify" "$UTILIZADOR"
fi
if id -nG "$UTILIZADOR" 2>/dev/null | tr ' ' '\n' | grep -qx docker; then
  ok "$UTILIZADOR no grupo docker"
else
  fazer "pôr $UTILIZADOR no grupo docker" usermod -aG docker "$UTILIZADOR"
fi
if id -nG "$UTILIZADOR" 2>/dev/null | tr ' ' '\n' | grep -qxE 'sudo|admin|root'; then
  aviso "$UTILIZADOR está num grupo de administração (sudo/admin/root): não o tiro, decide uma pessoa"
fi
if [[ -f /etc/sudoers ]] && grep -rqsE "^[^#]*\b$UTILIZADOR\b" /etc/sudoers /etc/sudoers.d 2>/dev/null; then
  aviso "$UTILIZADOR aparece no sudoers: não o tiro, decide uma pessoa"
fi
if [[ -s /home/$UTILIZADOR/.ssh/authorized_keys ]]; then
  aviso "$UTILIZADOR tem chaves SSH em /home/$UTILIZADOR/.ssh/authorized_keys (o sshd recusa-o, mas não as apago)"
fi

# ---------------------------------------------------------------------------
passo "3. SSH só por chave; o executor nunca entra por SSH"
# Só fecha a palavra-passe se alguma conta já tiver uma chave: senão ficávamos
# todos de fora (lição do infra/vps/preparar.sh).
chaves=0
for f in /root/.ssh/authorized_keys /home/*/.ssh/authorized_keys; do
  [[ -f "$f" && "$f" != "/home/$UTILIZADOR/.ssh/authorized_keys" ]] || continue
  chaves=$((chaves + $(grep -cE '^(ssh-|ecdsa-|sk-)' "$f" || true)))
done
sshd_conf=/etc/ssh/sshd_config.d/00-eurolify-ci.conf
sshd_antes=/etc/ssh/00-eurolify-ci.conf.antes # fora da pasta: o Include só lê *.conf
mudou=0
if ((chaves > 0)); then
  ((MOSTRAR)) || { [[ -f "$sshd_conf" ]] && cp -p "$sshd_conf" "$sshd_antes"; } || true
  instalar "$F/sshd-00-eurolify-ci.conf" "$sshd_conf" 644
else
  aviso "nenhuma conta tem chave SSH: NÃO fecho a entrada por palavra-passe (ficaríamos todos de fora); acrescenta a tua chave e corre outra vez"
fi
if ((mudou && !MOSTRAR)); then
  if ! sshd -t; then
    if [[ -f "$sshd_antes" ]]; then mv -f "$sshd_antes" "$sshd_conf"; else rm -f "$sshd_conf"; fi
    registar "sshd -t falhou: 00-eurolify-ci.conf reposto como estava; nada recarregado"
    echo "ERRO: sshd -t falhou; o ficheiro voltou ao que era e nada foi recarregado." >&2
    exit 1
  fi
  fazer "recarregar o ssh" systemctl reload ssh
fi
((MOSTRAR)) || rm -f "$sshd_antes"
if tem sshd && ! ((MOSTRAR && mudou)) && ((chaves > 0)); then
  efectivo="$(sshd -T 2>/dev/null | grep -E '^(passwordauthentication|kbdinteractiveauthentication) ' | sort | tr '\n' ' ')"
  [[ "$efectivo" == "kbdinteractiveauthentication no passwordauthentication no " ]] ||
    aviso "sshd -T não bate certo: $efectivo"
fi

# ---------------------------------------------------------------------------
passo "4. Firewall: entrada fechada, só a 22/tcp"
# O docker publica portas por fora do ufw. Os fluxos só publicam em 127.0.0.1
# (verificar.yml, PostgreSQL de teste); nada aqui abre portas para fora.
ufw_verbose=""
tem ufw && ufw_verbose="$(ufw status verbose 2>&1 || true)"
if [[ "$ufw_verbose" == *"Status: active"* && "$ufw_verbose" == *"deny (incoming)"* ]] &&
  grep -qE '^22/tcp +ALLOW IN +Anywhere *$' <<<"$ufw_verbose"; then
  ok "ufw activo, entrada deny, 22/tcp aberta"
else
  fazer "ufw: entrada deny, saída allow, 22/tcp, ligar" bash -c \
    'ufw default deny incoming && ufw default allow outgoing && ufw allow 22/tcp && ufw --force enable'
fi
if tem ufw; then
  extra="$(ufw status verbose | grep -E ' (ALLOW|DENY|LIMIT|REJECT)( IN| OUT|) ' |
    grep -vE '^22/tcp( \(v6\))? +ALLOW IN +Anywhere( \(v6\))? *$' || true)"
  [[ -z "$extra" ]] || aviso "regras da firewall que o script não conhece (não as apago): $extra"
fi

# ---------------------------------------------------------------------------
passo "5. fail2ban e actualizações de segurança automáticas"
if tem systemctl && systemctl is-active --quiet fail2ban 2>/dev/null; then
  ok "fail2ban activo"
else
  fazer "ligar o fail2ban" systemctl enable --now fail2ban
fi
instalar "$F/fail2ban-eurolify-ci.local" /etc/fail2ban/jail.d/eurolify-ci.local 644
((mudou)) && fazer "reiniciar o fail2ban" systemctl restart fail2ban
instalar "$F/apt-auto-upgrades" /etc/apt/apt.conf.d/52eurolify-ci-auto 644

# ---------------------------------------------------------------------------
passo "6. Pastas, configuração sem segredos, ganchos e limpeza diária"
for d in "$PASTA:755" "$PASTA/ganchos:755" /etc/eurolify-ci:755 /var/log/eurolify-ci:750; do
  caminho="${d%%:*}"
  modo="${d##*:}"
  if [[ -d "$caminho" && "$(stat -c '%a %U' "$caminho")" == "$modo root" ]]; then
    ok "$caminho"
  else
    fazer "pasta $caminho ($modo)" install -d -o root -g root -m "$modo" "$caminho"
  fi
done
instalar "$F/executor.conf" /etc/eurolify-ci/executor.conf 644
# Os ganchos são do root: o utilizador do executor corre-os mas não os altera.
instalar "$F/ganchos/limpar-trabalho.sh" "$PASTA/ganchos/limpar-trabalho.sh" 755
instalar "$F/sbin/eurolify-ci-limpeza" /usr/local/sbin/eurolify-ci-limpeza 700
unidades_mudaram=0
for u in "$F"/systemd/*; do
  instalar "$u" "/etc/systemd/system/$(basename "$u")" 644
  ((mudou)) && unidades_mudaram=1
done
((unidades_mudaram)) && fazer "systemctl daemon-reload" systemctl daemon-reload
if tem systemctl && systemctl is-enabled --quiet eurolify-ci-limpeza.timer 2>/dev/null; then
  ok "eurolify-ci-limpeza.timer"
else
  fazer "ligar o eurolify-ci-limpeza.timer (diário, 04:30)" systemctl enable --now eurolify-ci-limpeza.timer
fi

# ---------------------------------------------------------------------------
passo "7. Executor oficial (actions/runner), versão fixa e sha256 conferido"
if [[ -z "$RUNNER_VERSAO" || -z "$RUNNER_SHA256" ]]; then
  if ((MOSTRAR)); then
    aviso "RUNNER_VERSAO e RUNNER_SHA256 estão vazios em ficheiros/executor.conf: o passo real recusa instalar (preencher por pedido de alteração, ver LEIA-ME.md)"
  else
    echo "ERRO: RUNNER_VERSAO e RUNNER_SHA256 estão vazios em infra/ci-executor/ficheiros/executor.conf." >&2
    echo "      Preenchem-se por pedido de alteração (LEIA-ME.md, passo «versão do executor»)." >&2
    echo "      Os passos 0 a 6 ficaram feitos; corre outra vez depois de preencher." >&2
    exit 1
  fi
elif [[ ! "$RUNNER_VERSAO" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ || ! "$RUNNER_SHA256" =~ ^[0-9a-f]{64}$ ]]; then
  echo "ERRO: RUNNER_VERSAO (n.n.n) ou RUNNER_SHA256 (64 hexadecimais em minúsculas) mal escritos em executor.conf." >&2
  exit 1
fi

transferir_e_extrair() {
  local ficheiro tmp
  ficheiro="actions-runner-linux-x64-${RUNNER_VERSAO}.tar.gz"
  tmp="$(mktemp -d)"
  # shellcheck disable=SC2064 # $tmp expande-se já, de propósito
  trap "rm -rf '$tmp'" RETURN
  curl -fsSL --proto '=https' --tlsv1.2 --retry 3 -o "$tmp/$ficheiro" \
    "https://github.com/actions/runner/releases/download/v${RUNNER_VERSAO}/$ficheiro"
  if ! echo "$RUNNER_SHA256  $tmp/$ficheiro" | sha256sum -c --quiet -; then
    echo "ERRO: o sha256 do $ficheiro não bate com o de executor.conf; nada foi instalado." >&2
    return 1
  fi
  # A pasta do executor é do root: o utilizador do executor não altera os
  # programas nem o .env (nem os ganchos). Só escreve em _work e _diag.
  install -d -o root -g root -m 755 "$EXECUTOR"
  tar -xzf "$tmp/$ficheiro" -C "$EXECUTOR" --no-same-owner
  install -d -o "$UTILIZADOR" -g "$UTILIZADOR" -m 750 "$EXECUTOR/_work" "$EXECUTOR/_diag"
  printf '%s\n' "$RUNNER_VERSAO" >"$EXECUTOR/.versao-eurolify"
}
if [[ -x "$EXECUTOR/config.sh" ]]; then
  instalada="$(cat "$EXECUTOR/.versao-eurolify" 2>/dev/null || echo desconhecida)"
  ok "executor $instalada em $EXECUTOR"
  # Com --disableupdate o executor não se actualiza: a versão muda-se aqui,
  # por pedido revisto, e a máquina refaz-se (LEIA-ME.md).
  [[ -z "$RUNNER_VERSAO" || "$instalada" == "$RUNNER_VERSAO" ]] ||
    aviso "o executor instalado é a $instalada e o executor.conf fixa a $RUNNER_VERSAO: não mexo (refazer a máquina, LEIA-ME.md)"
elif [[ -n "$RUNNER_VERSAO" && -n "$RUNNER_SHA256" ]]; then
  fazer "descarregar e instalar o executor $RUNNER_VERSAO (sha256 conferido) em $EXECUTOR" transferir_e_extrair
fi
if [[ -x "$EXECUTOR/bin/installdependencies.sh" && ! -f "$EXECUTOR/.dependencias-eurolify" ]]; then
  # shellcheck disable=SC2016 # de propósito: expande-se dentro do bash -c
  fazer "instalar as dependências do executor (installdependencies.sh)" bash -c \
    'cd "$1" && DEBIAN_FRONTEND=noninteractive ./bin/installdependencies.sh && touch .dependencias-eurolify' _ "$EXECUTOR"
elif ((MOSTRAR)) && [[ ! -x "$EXECUTOR/config.sh" ]]; then
  fazer "instalar as dependências do executor (installdependencies.sh)" true
fi

# ---------------------------------------------------------------------------
passo "8. Registo no repositório e serviço systemd"
registar_executor() {
  # O token vai nos argumentos só durante este comando (vale uma hora e serve
  # uma vez); a máquina não tem outros utilizadores. Não fica em ficheiro.
  # Regista-se como root para a pasta ficar do root (o config.sh recusa o root
  # sem esta variável); só os três ficheiros de credenciais passam ao
  # utilizador, que tem de os ler quando corre o serviço.
  (cd "$EXECUTOR" && RUNNER_ALLOW_RUNASROOT=1 ./config.sh --unattended --disableupdate \
    --url "$REPOSITORIO_URL" --token "$TOKEN_REGISTO" --labels "$ETIQUETA" \
    --name "$NOME_EXECUTOR" --work _work)
  local f
  for f in .runner .credentials .credentials_rsaparams; do
    [[ ! -f "$EXECUTOR/$f" ]] || chown "$UTILIZADOR:$UTILIZADOR" "$EXECUTOR/$f"
  done
}
if [[ -f "$EXECUTOR/.runner" ]]; then
  ok "executor já registado ($(grep -o '"agentName": *"[^"]*"' "$EXECUTOR/.runner" | head -n 1))"
elif ((MOSTRAR)); then
  fazer "registar o executor «$NOME_EXECUTOR» (etiqueta $ETIQUETA) em $REPOSITORIO_URL com o token que se passar na hora" true
else
  if [[ -t 0 ]]; then
    read -rsp "   Token de registo (Settings > Actions > Runners > New self-hosted runner; não aparece no ecrã): " TOKEN_REGISTO
    echo
  fi
  if [[ -z "$TOKEN_REGISTO" ]]; then
    aviso "sem token de registo: o executor não ficou registado. Corre num terminal e escreve-o quando o script pedir (LEIA-ME.md)"
  elif [[ ! -x "$EXECUTOR/config.sh" ]]; then
    aviso "o executor não está instalado: não consigo registar"
  else
    fazer "registar o executor «$NOME_EXECUTOR» (etiqueta $ETIQUETA) em $REPOSITORIO_URL" registar_executor
  fi
fi
unset TOKEN_REGISTO

# Os ganchos entram pelo .env do executor (lido ao arrancar o serviço).
env_executor="$EXECUTOR/.env"
env_mudou=0
if [[ -f "$EXECUTOR/.runner" ]]; then
  for linha in \
    "ACTIONS_RUNNER_HOOK_JOB_STARTED=$PASTA/ganchos/limpar-trabalho.sh" \
    "ACTIONS_RUNNER_HOOK_JOB_COMPLETED=$PASTA/ganchos/limpar-trabalho.sh"; do
    if grep -qxF -- "$linha" "$env_executor" 2>/dev/null; then
      ok "$env_executor: ${linha%%=*}"
    else
      env_mudou=1
      # O .env é do root (644): o utilizador do executor não o altera.
      # shellcheck disable=SC2016 # de propósito: expande-se dentro do bash -c
      fazer "acrescentar ${linha%%=*} ao $env_executor" bash -c \
        'printf "%s\n" "$1" >>"$2" && chown root:root "$2" && chmod 644 "$2"' _ "$linha" "$env_executor"
    fi
  done
  unidade=""
  [[ -s "$EXECUTOR/.service" ]] && unidade="$(cat "$EXECUTOR/.service")"
  if [[ -z "$unidade" ]]; then
    # shellcheck disable=SC2016 # de propósito: expande-se dentro do bash -c
    fazer "instalar e ligar o serviço systemd do executor" bash -c \
      'cd "$1" && ./svc.sh install "$2" && ./svc.sh start' _ "$EXECUTOR" "$UTILIZADOR"
  elif systemctl is-active --quiet "$unidade" 2>/dev/null; then
    ok "serviço $unidade activo"
    ((env_mudou)) && fazer "reiniciar $unidade (ganchos novos)" systemctl restart "$unidade"
  else
    fazer "ligar o serviço $unidade" systemctl enable --now "$unidade"
  fi
else
  echo "   (o serviço e os ganchos ficam para quando o executor estiver registado)"
fi

# ---------------------------------------------------------------------------
passo "Resumo"
if ((MOSTRAR)); then
  echo "   Modo --mostrar: nada foi alterado. Acções que faria: $mudancas. Avisos: $avisos."
else
  echo "   Acções feitas: $mudancas. Avisos: $avisos. Registo: /var/log/eurolify-ci/acoes.log"
fi
echo "   Falta (se ainda não fizeste): ver infra/ci-executor/LEIA-ME.md, passos de Settings > Actions."
