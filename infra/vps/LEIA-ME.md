# Preparação da VPS do ensaio (`infra/vps`)

O que a VPS tem sai daqui (ADR-0018: a migração para Paris é correr isto
noutra máquina). Decisões: ADR-0015, 0016, 0018, 0021, 0026 a 0030; guia
`docs/11-preparacao-da-vps.md`.

## O que o `preparar.sh` faz

| Passo | O quê | Decisão |
|---|---|---|
| 1 | pacotes: `docker.io`, `ufw`, `fail2ban`, `age`, `rclone`, `git`, `curl`, `openssh-server` | ADR-0025, 0026, 0027 |
| 2 | chaves de emergência de `chaves/pessoais/` no `ubuntu`: acrescenta, nunca apaga; avisa das que não conhece | ADR-0028 |
| 3 | `00-eurolify.conf`: SSH só por chave, sem root — **só se o `ubuntu` tiver pelo menos uma chave**; `sshd -t` antes de recarregar, e volta ao anterior se falhar | memória da VPS |
| 4 | `ufw`: entrada fechada, só a 22/tcp; avisa de regras que não conhece | ADR-0027 |
| 5 | `fail2ban` activo; jaula `sshd` com bloqueio de 1 h; `dbpurgeage = 14d` no `fail2ban.d` (é opção do `fail2ban.conf`) | ADR-0027 |
| 6 | journal e `ufw.log`: 14 dias | ADR-0018, 0027 |
| 7 | pastas e `/etc/eurolify/ensaio.conf` (sem segredos) | — |
| 8 | programas `eurolify-*` e unidades do `systemd` | ADR-0026, 0028 |
| 9 | Docker e a rede interna `eurolify` | ADR-0026 |
| 10 | PostgreSQL 18 num contentor, **sem porta publicada**; palavra-passe gerada na máquina | ADR-0025, `AGENTS.md` |
| 11 | utilizadores `eurolify-publicar`, `-aplicar`, `-medir`: sem sudo nem docker, casa de root; cada chave só corre `eurolify-pedido <fluxo>` | ADR-0026, 0028 |
| 12 | tarefas: cópia 03:00 UTC, reposição ao domingo 04:00, verificação 07:00 | ADR-0027, 0029 |

Pode correr-se várias vezes. Com `--mostrar` não muda nada. **Nunca apaga
sozinho** o que não conhece (chaves, regras, contentores): avisa.

## Como chega à máquina

- **Normalmente:** um pedido de alteração que mude `infra/vps/` entra no
  `main`; o fluxo `aplicar-script` pede à VPS o modo `mostrar` e depois
  `aplicar`. A VPS vai buscar o commit ao GitHub com a sua chave só de
  leitura e recusa um commit que não esteja no `main` **ou que seja anterior
  ao último aplicado** (guardado em `/var/lib/eurolify/ultimo-commit-aplicado`).
- Cada pedido de um fluxo leva um identificador, e a resposta vem só para
  ele (`resultado.<id>`): um pedido nunca lê a resposta de outro.
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
| `rclone.conf` | remoto `scaleway`, com uma chave de **leitura e escrita só no contentor das cópias**: a cópia escreve, a reposição lista e lê (corrigido na revisão do #10 — «só de escrita» não chegava) |
| `age.pub` / `age.key` | chaves das cópias (a privada também com o Diogo, ADR-0029) |
| `healthchecks.env` | `HC_COPIA=`, `HC_REPOSICAO=`, `HC_VERIFICACAO=` (endereços do Healthchecks.io) |

O `preparar.sh` avisa de cada um que falte; as tarefas que precisam dele
falham e avisam.

## Regras para quem mexer

- **Migrações compatíveis com a versão anterior:** se o `/health` falhar
  depois de uma publicação, volta-se à imagem anterior com o esquema já
  migrado. Acrescentar primeiro; tirar só numa publicação seguinte.

## O que ainda não está tratado (revisão do #10, P2)

- A reposição compara só o número de tabelas: uma cópia sem dados que reponha
  o esquema passa.
- O `auth.log`, o `fail2ban.log` e o `wtmp`/`btmp` podem guardar endereços IP
  mais de 14 dias (só o journal, o `ufw.log` e a base do `fail2ban` estão a
  14 dias) — ver na Fase D o que existe no Ubuntu 26.04.
- O `logrotate-ufw` substitui um ficheiro do pacote `ufw`: numa actualização o
  `dpkg` pode deixar um `.dpkg-dist` ao lado.

## O que se verifica no GitHub

O fluxo `verificar` corre o `shellcheck` em todos os programas e o
`preparar.sh --mostrar` num contentor Ubuntu 26.04 vazio — prova a sintaxe e
a lógica do «o que faria» numa máquina nova, sem tocar na VPS. Não prova os
passos a sério nem os ramos «já está»: esses só se vêem na VPS.
