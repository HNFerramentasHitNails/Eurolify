# Preparação da VPS do ensaio (`infra/vps`)

O que a VPS tem sai daqui (ADR-0018: a migração para Paris é correr isto
noutra máquina). Decisões: ADR-0015, 0016, 0018, 0021, 0026 a 0029; guia
`docs/11-preparacao-da-vps.md`.

## O que o `preparar.sh` faz

| Passo | O quê | Decisão |
|---|---|---|
| 1 | pacotes: `docker.io`, `ufw`, `fail2ban`, `age`, `rclone`, `git`, `curl`, `openssh-server` | ADR-0025, 0026, 0027 |
| 2 | `00-eurolify.conf`: SSH só por chave, sem root; `sshd -t` antes de recarregar, e volta atrás se falhar | memória da VPS |
| 3 | `ufw`: entrada fechada, só a 22/tcp; avisa de regras que não conhece | ADR-0027 |
| 4 | `fail2ban`: bloqueio 1 h, endereços 14 dias | ADR-0027 |
| 5 | journal e `ufw.log`: 14 dias | ADR-0018, 0027 |
| 6 | pastas e `/etc/eurolify/ensaio.conf` (sem segredos) | — |
| 7 | programas `eurolify-*` e unidades do `systemd` | ADR-0026, 0028 |
| 8 | Docker e a rede interna `eurolify` | ADR-0026 |
| 9 | PostgreSQL 18 num contentor, **sem porta publicada**; palavra-passe gerada na máquina | ADR-0025, `AGENTS.md` |
| 10 | utilizadores `eurolify-publicar`, `-aplicar`, `-medir`: sem sudo nem docker; cada chave só corre `eurolify-pedido <fluxo>` | ADR-0026, 0028 |
| 11 | tarefas: cópia 03:00 UTC, reposição ao domingo 04:00, verificação 07:00 | ADR-0027, 0029 |
| 12 | chaves de emergência em `chaves/pessoais/` no `ubuntu`: acrescenta, nunca apaga | ADR-0028 |

Pode correr-se várias vezes. Com `--mostrar` não muda nada. **Nunca apaga
sozinho** o que não conhece (chaves, regras, contentores): avisa.

## Como chega à máquina

- **Normalmente:** um pedido de alteração revisto que mude `infra/vps/` entra
  no `main`; o fluxo `aplicar-script` pede à VPS o modo `mostrar` e depois
  `aplicar`. A VPS vai buscar o commit ao GitHub com a sua chave só de
  leitura e recusa um commit que não esteja no `main`.
- **A primeira vez** (os utilizadores dos fluxos ainda não existem), pela
  chave de emergência do Diogo, do computador dele — passo a passo, com OK:

  ```
  git -C <clone> archive origin/main infra/vps | ssh eurolify-ensaio "rm -rf ~/eurolify-infra && mkdir ~/eurolify-infra && tar -x -C ~/eurolify-infra"
  ssh eurolify-ensaio "sudo bash ~/eurolify-infra/infra/vps/preparar.sh --mostrar"
  ssh eurolify-ensaio "sudo bash ~/eurolify-infra/infra/vps/preparar.sh"
  ```

## Segredos (Fase D) — em `/etc/eurolify/`, 600, root; nunca no repositório

| Ficheiro | O quê |
|---|---|
| `ghcr.token` | token clássico do GitHub com `read:packages` (ADR-0026) |
| `ghcr.expira` | data de fim desse token, `AAAA-MM-DD` |
| `deploy_key` | chave só de leitura do repositório (*deploy key*) |
| `rclone.conf` | remoto `scaleway`, com a chave que só escreve no contentor das cópias |
| `age.pub` / `age.key` | chaves das cópias (a privada também com o Diogo, ADR-0029) |
| `healthchecks.env` | `HC_COPIA=`, `HC_REPOSICAO=`, `HC_VERIFICACAO=` (endereços do Healthchecks.io) |

O `preparar.sh` avisa de cada um que falte; as tarefas que precisam dele
falham e avisam.

## O que se verifica no GitHub

O fluxo `verificar` corre o `shellcheck` em todos os programas e o
`preparar.sh --mostrar` num contentor Ubuntu 26.04 vazio — prova a sintaxe e
a lógica do «o que faria» numa máquina nova, sem tocar na VPS. Não prova os
passos a sério: esses só se vêem na VPS.
