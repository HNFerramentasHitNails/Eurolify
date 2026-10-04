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

export EUROLIFY_ORIGEM="${EUROLIFY_ORIGEM:-manual por ${SUDO_USER:-root}}, commit ${EUROLIFY_COMMIT:-desconhecido}"
FLUXOS=(publicar aplicar medir)
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
pacotes=(docker.io ufw fail2ban age rclone git curl openssh-server)
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
passo "4. Firewall: entrada fechada, só a porta 22 (ADR-0027)"
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
  extra="$(ufw status | grep -E 'ALLOW|DENY|LIMIT|REJECT' | grep -vE '^22/tcp( \(v6\))? +ALLOW IN +Anywhere( \(v6\))? *$' || true)"
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
passo "6. Registos com endereços IP: 14 dias (ADR-0018, ADR-0027)"
instalar "$F/journald-eurolify.conf" /etc/systemd/journald.conf.d/eurolify.conf 644
((mudou)) && fazer "reiniciar o systemd-journald" systemctl restart systemd-journald
instalar "$F/logrotate-ufw" /etc/logrotate.d/ufw 644

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
# shellcheck source=ficheiros/ensaio.conf
source "$F/ensaio.conf"

# ---------------------------------------------------------------------------
passo "8. Programas e unidades do Eurolify"
instalar "$F/lib/comum.sh" /usr/local/lib/eurolify/comum.sh 644
instalar "$F/bin/eurolify-pedido" /usr/local/bin/eurolify-pedido 755
for p in trabalho publicar aplicar medir copia reposicao verificacao; do
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
if [[ -f /etc/eurolify/api.env ]]; then
  ok "/etc/eurolify/api.env"
else
  fazer "criar /etc/eurolify/api.env (vazio; a ligação à base entra com o primeiro domínio)" \
    install -o root -g root -m 600 /dev/null /etc/eurolify/api.env
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
passo "Resumo"
if ((MOSTRAR)); then
  echo "   modo --mostrar: $mudancas alteração(ões) por fazer, $avisos aviso(s). Nada foi mudado."
else
  echo "   $mudancas alteração(ões) feita(s), $avisos aviso(s)."
  registar "preparar.sh terminou: $mudancas alteração(ões), $avisos aviso(s)"
fi
