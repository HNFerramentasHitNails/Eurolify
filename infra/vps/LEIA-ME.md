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
| 4 | `ufw`: entrada fechada, só a 22/tcp e a 443/tcp (MCP); avisa de regras que não conhece | ADR-0027, 0033 |
| 5 | `fail2ban` activo; jaula `sshd` com bloqueio de 1 h; `dbpurgeage = 14d` no `fail2ban.d` (é opção do `fail2ban.conf`) | ADR-0027 |
| 6 | journal (um ficheiro por dia), `ufw.log` e `acoes.log`: 14 dias; as linhas com a conta dos operadores não vão para o `/var/log/syslog` | ADR-0018 (nota de 05/10/2026), 0027 |
| 7 | pastas e `/etc/eurolify/ensaio.conf` (sem segredos) | — |
| 8 | programas `eurolify-*` e unidades do `systemd` | ADR-0026, 0028 |
| 9 | Docker e a rede interna `eurolify` | ADR-0026 |
| 10 | PostgreSQL 18 num contentor, **sem porta publicada**; palavra-passe gerada na máquina | ADR-0025, `AGENTS.md` |
| 10b | Utilizadores da base: `eurolify_migrador` (dono da base e das tabelas, ligação em `migrar.env`) e `eurolify_api` (a API, ligação em `api-base.env`, um ficheiro só dela; o `api.env` fica para o resto da configuração e o script não o reescreve); cada um com palavra-passe gerada na máquina, renovada se a ligação do ficheiro deixar de entrar ; e `eurolify_limpeza` (a limpeza diária da idempotência: `LOGIN` sem palavra-passe, só pelo socket do contentor, sem superutilizador, `BYPASSRLS`, só a `idempotencia` e o `EXECUTE` das duas funções dos prazos das contas, sem nenhuma tabela das contas; os privilégios dão-nos as migrações 0013 e 0026 ou, se correram antes, este passo) | `docs/15` §5, #70, #107, #119 |
| 10c | Se o `api.env` ou o `api-base.env` mudaram depois de o contentor `eurolify-api` ser criado, recria-o com a mesma imagem (`eurolify-publicar --so-recriar`: espera por outra publicação em curso e não troca de imagem), que verifica o `/health` e que a API chega à base | `docs/19` §6, #107 |
| 11 | utilizadores `eurolify-publicar`, `-aplicar`, `-medir`, `-operar`: sem sudo nem docker, casa de root; cada chave só corre `eurolify-pedido <fluxo>`. O `operar` (comando do operador, `docs/19` §6): o utilizador, a pasta e o serviço criam-se já; só falta a chave, `chaves/fluxos/operar.pub` (sem ela, o `preparar.sh` avisa e ninguém entra). Não confundir com o programa `eurolify-operar` (acções do MCP); o do comando é o `eurolify-operador` | ADR-0026, 0028; `docs/19` |
| 12 | tarefas: cópia 03:00 UTC, reposição ao domingo 04:00, limpeza 05:00 (`eurolify-limpeza`: a idempotência e os prazos das contas de pessoas, `docs/21` §13; a verificação avisa se houver linhas com o prazo passado há mais de um dia), verificação 07:00 | ADR-0027, 0029; `docs/18` §4 |
| 13 | MCP da VPS: utilizador `eurolify-mcp` e a pasta dos pedidos; certificado de `mcp.eurolify.eu` (Let's Encrypt, desafio DNS da OVH, sem abrir a 80); `nginx` só com o site do MCP, ligado depois de haver certificado e de o `nginx -t` passar: o login aberto a todos, o resto só para `160.79.104.0/21` | ADR-0033 |

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
| `rclone.conf` | remoto `ovh` (OVH Object Storage, Standard, **Paris, três zonas** — ADR-0032; modelo abaixo), com um utilizador S3 de **leitura e escrita**: a cópia escreve e apaga as de mais de 14 dias, a reposição lista e lê (corrigido na revisão do #10 — «só de escrita» não chegava). O ideal é o utilizador só ver o contentor das cópias; **se a OVH o deixa limitar a um contentor ou só ao projecto inteiro, não está verificado** |
| `age.pub` / `age.key` | chaves das cópias (a privada também com o Diogo, ADR-0029) |
| `healthchecks.env` | `HC_COPIA=`, `HC_REPOSICAO=`, `HC_VERIFICACAO=` (endereços do Healthchecks.io) |
| `github-oauth.env` | `GITHUB_CLIENT_ID=`, `GITHUB_CLIENT_SECRET=` da aplicação OAuth do GitHub (login no MCP, ADR-0033), **sem aspas** (o `docker --env-file` guarda-as como parte do valor) |
| `ovh-dns.ini` | chave da API da OVH só para a zona `eurolify.eu`, no formato do `certbot` (`dns_ovh_endpoint`, `…_application_key`, `…_application_secret`, `…_consumer_key`) |
| `ovh-dns.expira` | data de troca dessa chave, `AAAA-MM-DD` (a chave actual não expira; troca-se a 2027-03-31) |

O `preparar.sh` avisa de cada um que falte; as tarefas que precisam dele
falham e avisam.

### O `rclone.conf` (modelo, sem segredos)

O que está na VPS desde 04/10/2026 (contentor `eurolify-ensaio-copias` em
**Paris, três zonas**, `eu-west-par` — onde o Diogo o criou; achado a listar
os endereços S3 da OVH a partir da VPS):

```ini
[ovh]
type = s3
provider = Other
env_auth = false
access_key_id = <do utilizador S3 da OVH>
secret_access_key = <do utilizador S3 da OVH>
region = eu-west-par
endpoint = s3.eu-west-par.io.cloud.ovh.net
acl = private
```

- **`provider = Other`, não `OVHcloud`:** o `rclone` do Ubuntu 26.04 é a
  1.60.1 e não conhece o fornecedor `OVHcloud` (aviso *«s3 provider
  "OVHcloud" not known»*); com `Other` lista e escreve. A documentação actual
  do rclone (`rclone.org/s3`, lida a 04/10/2026) dá `OVHcloud`.
- Sem o `endpoint`, o `rclone` vai para a AWS e a cópia falha. Para outra
  região: `s3.<região>.io.cloud.ovh.net` (ex.: `gra` em Gravelines).

Os 14 dias na OVH são garantidos pelo `eurolify-copia` (`rclone delete
--min-age 14d`); uma regra de expiração no contentor (*lifecycle*,
`Expiration` com `Days`, que a documentação da OVH descreve) é uma segunda
trava, não a única.

## Regras para quem mexer

- **Migrações compatíveis com a versão anterior:** se o `/health` falhar
  depois de uma publicação, volta-se à imagem anterior com o esquema já
  migrado. Acrescentar primeiro; tirar só numa publicação seguinte. Desde o
  #107 (06/10/2026) a versão anterior também abre a base: tirar uma coluna ou
  uma tabela exige que a versão anterior já não a use.
- **Uma publicação de cada vez:** o `eurolify-publicar` tranca
  `/run/lock/eurolify-publicar.lock` (espera até 15 min), venha do fluxo
  publicar, do MCP ou do passo 10c. O cadeado vale para a comparação das
  migrações, a migração e a troca do contentor.
- **Voltar a uma publicação** (MCP da VPS, ADR-0033): só à publicação
  imediatamente anterior à que está no ar (decisão do Diogo, 06/10/2026, opção
  A da 2.ª revisão do #115). Depois de uma volta, a «anterior» é a publicação
  de onde se veio: o MCP só alterna entre as duas. Antes de migrar, o
  `eurolify-publicar` compara as migrações da imagem com as da base (tabela
  `kysely_migration`). Se a base tem migrações que a imagem não conhece, não
  corre o migrador (o de uma imagem antiga recusava a base; tarefa #113) e só
  segue se for essa anterior e se as migrações a mais forem todas das que a
  publicação no ar aplicou; se também lhe falta alguma, recusa. As migrações
  são escritas para a versão anterior no código, e depois de voltas e
  correcções a anterior no registo pode não ser essa (4.ª revisão do #115,
  P2-2). Em qualquer outro caso migra como sempre; se não conseguir comparar,
  di-lo, e o migrador decide (uma imagem sem migrador que não se consegue
  comparar é recusada). O MCP aceita o pedido e a publicação, em segundo
  plano, ainda o pode recusar: vê-se no `estado_do_ensaio`.
- **O `publicacoes.log`:** uma linha por publicação, «data | resumo |
  anterior: imagem [| emergência] [| falhou] | migrou: a,b». O `migrou:` são
  as migrações que essa publicação aplicou («?» se não se soube); ao avançar
  outra vez para uma imagem com a mesma anterior, herda as que ela aplicou da
  outra vez e ainda estão na base. Uma tentativa que falhou (a migração a
  meio, a imagem que nem arranca ou o /health) também deixa linha, marcada
  «falhou», com as migrações que ficaram na base: repetida a mesma imagem,
  herda-as (#120). Uma falha a escrever no `publicacoes.log` ou no
  `acoes.log` não impede a reposição da anterior nem a actualização do MCP;
  fica dito na saída. As linhas de
  antes desta regra não têm o `migrou:`: até à primeira publicação depois
  dela, uma volta com a base à frente é recusada. Qualquer saída com erro
  depois de validar o resumo fica também no `acoes.log`.
- **O `estado_do_ensaio`** mostra sempre as migrações da base que a versão no
  ar não conhece (secção «migrações»). Para isso lança até dois contentores
  descartáveis da imagem no ar, só para ler a lista (sem rede, sem
  capacidades, sem a ir buscar), além de uma leitura da base: não escreve
  nada.
- **Voltar mais atrás (emergência):** por SSH, com a chave pessoal (ADR-0020),
  `sudo EUROLIFY_ORIGEM="emergencia:<nome>" /usr/local/sbin/eurolify-publicar
  <resumo> --emergencia`, com um resumo do `publicacoes.log`. Passa pelo
  cadeado, não corre o migrador quando a base está à frente da imagem (se não
  conseguir comparar, corre-o, e é o migrador que recusa uma base que não
  conhece), recusa se a base e a imagem divergem, e fica no `acoes.log` como
  «EMERGÊNCIA» e marcada na linha do `publicacoes.log` («| emergência»). A
  compatibilidade dessa versão com a base é de quem a pede; o uso fica numa
  memória (`AGENTS.md`, «Operar a VPS», regra 9).

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

## O MCP da VPS (ADR-0033)

- `https://mcp.eurolify.eu`. A 443 está aberta a todos na firewall, porque o
  login abre no browser de quem liga o *connector*; o `nginx` deixa passar a
  todos só o `/authorize` e o regresso do GitHub (com limite de pedidos), e o
  resto — o `/mcp`, os tokens, o registo — só a `160.79.104.0/21` (a
  Anthropic). Se a Anthropic mudar o intervalo, muda-se no `nginx-mcp.conf`.
- Login pelo GitHub; só entram as contas de `MCP_CONTAS` no `ensaio.conf`,
  **pelo número** da conta (um nome pode mudar e ficar livre para outro). Só
  se registam clientes que devolvem ao Claude (`claude.ai`/`claude.com`).
  Tokens em memória: reiniciar o contentor (publicar, voltar atrás, reiniciar
  a VPS) obriga a voltar a ligar o *connector*.
- Uma falha do MCP numa publicação **não** desfaz a da API: avisa, tira o
  contentor do MCP e o pedido sai com erro.
- Corre da mesma imagem que a API, no contentor `eurolify-mcp`, com o
  utilizador `eurolify-mcp`, disco só de leitura, sem capacidades, sem
  `docker`, sem `sudo` e sem chaves; só vê `/var/lib/eurolify/pedidos/mcp`.
- Cada ferramenta é um pedido ao `eurolify-trabalho` (fluxo `mcp`), que o
  valida contra a lista fixa e o passa ao `eurolify-operar`:
  `medir`, `publicacoes`, `copia`, `reposicao`, `reiniciar-api`,
  `publicar sha256:…` (só resumos que já estiveram no ar e que têm o MCP),
  `actualizar` e `reiniciar-vps` (estes dois recusados em dias úteis das 08:00
  às 20:00 em Lisboa; o reinício volta a ver o horário depois da cópia).
  Cópia, reposição, publicação, actualização e reinício correm em segundo
  plano; o resultado vê-se no `medir`. Nenhuma muda configuração (ADR-0028).
- A verificação diária avisa 14 dias antes da troca da chave da OVH e 20 dias
  antes de o certificado expirar (o `certbot` renova aos 30).
