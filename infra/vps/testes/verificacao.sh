#!/usr/bin/env bash
# Teste da verificação diária (eurolify-verificacao), só a parte das duas
# tarefas da API que limpam dados pessoais (docs/23 §15.11; migração 0088):
# a fila do titular e as sessões de checkout; e a do aviso do prazo legal dos
# pedidos do titular (docs/23 §15.15; migração 0096); e a da limpeza dos pedidos
# de autorização da faturação (docs/29 §20; migração 0100) e dos avisos de
# pagamento sem pagamento (docs/26 §16; migração 0105). Corre como root num contentor
# Ubuntu descartável (fluxo verificar), sem docker a sério: um docker de
# mentira responde às consultas do psql. Nunca correr numa máquina a sério.
set -Eeuo pipefail
[[ "${EUROLIFY_TESTE_DESCARTAVEL:-}" == 1 ]] || { echo "só numa máquina descartável (EUROLIFY_TESTE_DESCARTAVEL=1)" >&2; exit 2; }
repo="$(cd "$(dirname "$0")/../../.." && pwd)"

install -d /usr/local/lib/eurolify /etc/eurolify /var/log/eurolify
install -m 644 "$repo/infra/vps/ficheiros/lib/comum.sh" /usr/local/lib/eurolify/comum.sh
printf 'BASE_NOME=eurolify\n' >/etc/eurolify/ensaio.conf

# Os comandos da máquina, de mentira. O docker responde às consultas pelo que
# está em /tmp/falso: «<função>» com o número, «falha» ou «texto»; sem o
# ficheiro, a função não existe (migração por publicar).
falsos=/tmp/falsos
install -d "$falsos" /tmp/falso
cat >"$falsos/docker" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  inspect)
    [[ "$*" == *State.Running* ]] && echo true
    exit 0 ;;
  exec)
    sql="${*: -1}"
    for f in titular_pendentes_em_atraso checkout_sessoes_em_atraso clientes_pedidos_sem_aviso_em_atraso \
      faturacao_autorizacoes_em_atraso pagamentos_avisos_em_atraso; do
      [[ "$sql" == *"$f"* ]] || continue
      estado="$(cat "/tmp/falso/$f" 2>/dev/null || echo ausente)"
      if [[ "$sql" == *to_regprocedure* ]]; then
        [[ "$estado" == ausente ]] && echo f || echo t
        exit 0
      fi
      case "$estado" in
        falha) echo 'ERROR:  valor "ana@exemplo.pt" inválido' >&2; exit 1 ;;
        texto) echo "não sei"; exit 0 ;;
        *) echo "$estado"; exit 0 ;;
      esac
    done
    # As outras consultas da verificação: nada atrasado.
    [[ "$sql" == *to_reg* ]] && echo f || echo 0
    exit 0 ;;
esac
exit 0
EOF
cat >"$falsos/systemctl" <<'EOF'
#!/usr/bin/env bash
[[ "$1" == is-failed ]] && exit 1
exit 0
EOF
printf '#!/usr/bin/env bash\necho "Status: active"\n' >"$falsos/ufw"
printf '#!/usr/bin/env bash\nexit 0\n' >"$falsos/curl"
chmod 755 "$falsos"/*

falhas=0
confere() { # confere <descrição> <comando...>: o comando tem de dar 0
  local descricao="$1"
  shift
  if "$@"; then
    echo "ok   $descricao"
  else
    echo "FALHOU $descricao"
    falhas=$((falhas + 1))
  fi
}
contem() { [[ "$1" == *"$2"* ]]; }
sem_texto() { [[ "$1" != *"$2"* ]]; }

saida=""
verificar() { # verificar <titular> <checkout> [<avisos>] [<autorizações>] [<pagamentos>]: «-» é a função que não existe
  rm -f /tmp/falso/*
  [[ "$1" == - ]] || printf '%s' "$1" >/tmp/falso/titular_pendentes_em_atraso
  [[ "$2" == - ]] || printf '%s' "$2" >/tmp/falso/checkout_sessoes_em_atraso
  [[ "${3:--}" == - ]] || printf '%s' "$3" >/tmp/falso/clientes_pedidos_sem_aviso_em_atraso
  [[ "${4:--}" == - ]] || printf '%s' "$4" >/tmp/falso/faturacao_autorizacoes_em_atraso
  [[ "${5:--}" == - ]] || printf '%s' "$5" >/tmp/falso/pagamentos_avisos_em_atraso
  saida="$(PATH="$falsos:$PATH" bash "$repo/infra/vps/ficheiros/sbin/eurolify-verificacao" 2>&1 || true)"
}

# 1. Nada atrasado: nenhuma linha das duas tarefas.
verificar 0 0
confere "sem atraso, a fila do titular não aparece" sem_texto "$saida" "titular"
confere "sem atraso, as sessões não aparecem" sem_texto "$saida" "checkout"

# 2. Com atraso: uma linha com o número e a tarefa.
verificar 2 5
confere "a fila do titular parada avisa com o número" contem "$saida" \
  "2 encomenda(s) de pedidos de apagamento por limpar há mais de um dia: a fila do titular (clientes/titular-fila.ts) não está a correr"
confere "a limpeza das sessões parada avisa com o número" contem "$saida" \
  "5 sessão(ões) de checkout com dados pessoais por limpar há mais de um dia: a limpeza das sessões (checkout/limpeza-sessoes.ts) não está a correr"

# 3. Sem as funções (0088 por publicar): não avisa.
verificar - -
confere "sem a função, a fila do titular não aparece" sem_texto "$saida" "titular"
confere "sem a função, as sessões não aparecem" sem_texto "$saida" "checkout"

# 4. Uma consulta que falha avisa só com a categoria, nunca com a linha do
# erro do psql (revisão do #428, P3-3).
verificar falha falha
confere "a falha da fila do titular avisa" contem "$saida" "não consegui contar a fila do titular: a consulta falhou"
confere "a falha das sessões avisa" contem "$saida" "não consegui contar as sessões de checkout: a consulta falhou"
confere "a linha do erro do psql não sai" sem_texto "$saida" "ana@exemplo.pt"

# 5. Uma resposta que não é número avisa.
verificar texto 0
confere "uma contagem que não é número avisa" contem "$saida" "a contagem (a fila do titular) não é um número"

# 6. Os avisos do prazo legal dos pedidos do titular (0096): sem atraso, nada;
# com atraso, a linha com o número e a tarefa.
verificar 0 0 0
confere "sem atraso, os avisos do titular não aparecem" sem_texto "$saida" "sem aviso"
verificar 0 0 3
confere "a tarefa dos avisos parada avisa com o número" contem "$saida" \
  "3 pedido(s) do titular com o prazo legal passado há mais de um dia sem aviso: a tarefa dos avisos (clientes/aviso-prazo.ts) não está a correr"
confere "com atraso só nos avisos, a fila do titular não aparece" sem_texto "$saida" "encomenda(s)"
verificar 0 0 falha
confere "a falha da contagem dos avisos avisa só a categoria" contem "$saida" \
  "não consegui contar os pedidos do titular por avisar: a consulta falhou"

# 7. Os pedidos de autorização da faturação (0100): sem atraso, nada; com
# atraso, a linha com o número e a limpeza; sem a função, nada.
verificar 0 0 0 0
confere "sem atraso, as autorizações não aparecem" sem_texto "$saida" "autorização"
verificar 0 0 0 2
confere "a limpeza das autorizações parada avisa com o número" contem "$saida" \
  "2 pedido(s) de autorização da faturação por apagar há mais de um dia: a limpeza diária (eurolify-limpeza) não os está a apagar"
verificar 0 0 0 -
confere "sem a função (0100 por publicar), as autorizações não aparecem" sem_texto "$saida" "autorização"

# 8. Os avisos de pagamento sem pagamento (0105): sem atraso, nada; com
# atraso, a linha com o número e a limpeza; uma falha só com a categoria;
# sem a função, nada.
verificar 0 0 0 0 0
confere "sem atraso, os avisos de pagamento não aparecem" sem_texto "$saida" "aviso(s) de pagamento"
verificar 0 0 0 0 4
confere "a limpeza dos avisos parada avisa com o número" contem "$saida" \
  "4 aviso(s) de pagamento sem pagamento por passar a resumo há mais de um dia: a limpeza diária (eurolify-limpeza) não os está a tratar"
confere "com atraso só nos avisos de pagamento, as autorizações não aparecem" sem_texto "$saida" "autorização"
verificar 0 0 0 0 falha
confere "a falha da contagem dos avisos de pagamento avisa só a categoria" contem "$saida" \
  "não consegui contar os avisos de pagamento por resumir: a consulta falhou"
confere "a linha do erro do psql não sai (avisos de pagamento)" sem_texto "$saida" "ana@exemplo.pt"
verificar 0 0 0 0 -
confere "sem a função (0105 por publicar), os avisos de pagamento não aparecem" sem_texto "$saida" "aviso(s) de pagamento"

if ((falhas)); then
  echo "$falhas verificação(ões) falharam"
  exit 1
fi
echo "Todas as verificações passaram."
