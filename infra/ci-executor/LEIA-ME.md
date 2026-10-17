# Executor de testes próprio (`infra/ci-executor`)

Uma máquina nossa onde correm os fluxos do GitHub (testes, construção,
publicação), enquanto o Actions da conta estiver bloqueado (todas as execuções
acabam em segundos desde 14/10/2026). Decisão proposta: ADR-0046, **à espera do
OK do Diogo**. Memória: `memoria/executor-de-ci-proprio-17out2026.md`.

**Nunca na VPS do ensaio.** Os fluxos correm código dos pedidos com acesso ao
docker, que é root na máquina. A VPS do ensaio tem a base, as chaves e os
dados; esta máquina não tem nada disso. O `preparar.sh` recusa-se a correr onde
exista `/etc/eurolify`.

## Passos para o Diogo

1. **Comprar a máquina.** Pequena, num centro de dados da UE, **só para isto**,
   Ubuntu 24.04 (x86_64), com a tua chave SSH posta pelo fornecedor. Ponto de
   partida meu, **não medido**: 4 vCPU, 8 GB de RAM, 80 GB de disco (o
   `verificar` levou ≈ 14 min no executor do GitHub, `memoria/minutos-github-actions-16out2026.md`).
   A OVH, que já usamos, serve: **não verifiquei o preço** nem a oferta de hoje.
2. **Versão do executor (uma vez).** Em `ficheiros/executor.conf` faltam
   `RUNNER_VERSAO` e `RUNNER_SHA256`: a versão actual de `actions/runner`
   (página de lançamentos) e o sha256 do ficheiro `actions-runner-linux-x64-<versão>.tar.gz`
   (vem nas notas do lançamento). Não tive rede para os ler, por isso ficam em
   branco; preenchem-se por pedido de alteração (peço a uma sessão). Sem eles o
   script recusa instalar.
3. **Correr o script**, na máquina, ligado por SSH:
   ```
   git clone https://github.com/HNFerramentasHitNails/Eurolify.git
   cd Eurolify
   sudo bash infra/ci-executor/preparar.sh --mostrar   # só mostra, não muda nada
   ```
   Ler o que mostra; se estiver bem, o passo seguinte (4) corre o mesmo sem
   `--mostrar`. Pode correr-se quantas vezes for preciso: só faz o que falta.
   Se avisar que nenhuma conta tem chave SSH, não fecha a palavra-passe:
   acrescenta a tua chave e corre outra vez.
4. **Token de registo e registo.** No GitHub: *Settings → Actions → Runners →
   New self-hosted runner*. Copiar o token (vale uma hora, serve uma vez).
   **Nunca o enviar a ninguém nem pô-lo num ficheiro ou no chat.** Na máquina:
   ```
   sudo bash infra/ci-executor/preparar.sh
   ```
   O script pede o token e **não o mostra** ao escrever. (Alternativa:
   `sudo EUROLIFY_CI_TOKEN=… bash infra/ci-executor/preparar.sh`, que fica no
   histórico do terminal; apaga-o a seguir com `history -c`.) Depois, em
   *Settings → Actions → Runners*, o executor `eurolify-ci-…` aparece como
   *Idle*.
5. **Obrigatório, porque o repositório é público:** *Settings → Actions →
   General → «Fork pull request workflows from outside collaborators» →
   «Require approval for all external contributors»*. Sem isto, qualquer
   pessoa abre um pedido e corre código na nossa máquina. Confirmar também que
   «Run workflows from fork pull requests» não tem «Send write tokens» nem
   «Send secrets» marcados (não verifiquei os nomes exactos das opções hoje).
6. **Ligar os fluxos à máquina.** *Settings → Secrets and variables →
   Actions → Variables → New repository variable*: nome `EXECUTOR_CI`, valor
   `["self-hosted","linux","eurolify-ci"]` (com as aspas e os parênteses rectos).
   A partir daí, o próximo fluxo corre lá.
7. **Voltar aos executores do GitHub:** apagar a variável `EXECUTOR_CI`. Os
   fluxos voltam a usar `ubuntu-24.04`, sem mexer em código.

Depois de tudo isto, os pedidos que estão à espera precisam de uma nova
execução (fechar e reabrir, ou um novo commit).

## O que a máquina faz sozinha

- Só a porta 22 aberta; SSH só por chave; o utilizador do executor
  (`eurolify-ci`) não entra por SSH e **não tem sudo**.
- `fail2ban` e actualizações de segurança automáticas (sem reinício
  automático).
- Executor oficial `actions/runner`, versão fixa e sha256 conferido; um
  trabalho de cada vez; serviço `systemd`.
- Antes e depois de cada trabalho apaga os contentores (o `verificar` deixa o
  PostgreSQL de teste a correr) e o que um trabalho de deploy deixa no
  utilizador (chave SSH, credenciais do GHCR e do `gh`).
- Todos os dias às 04:30 (com atraso aleatório até 15 min): limpa contentores
  parados, imagens, volumes e redes docker sem uso, pastas de trabalho com mais
  de 3 dias e registos do executor com mais de 14 dias. Com um trabalho a
  correr, não faz nada.
- Cada acção do script fica em `/var/log/eurolify-ci/acoes.log`.
- **Nunca apaga o que não conhece**: chaves, regras da firewall ou contas
  desconhecidas aparecem como AVISO.

Um só executor significa fila: os quatro trabalhos do `verificar` correm um a
seguir ao outro (≈ soma dos tempos). Mais executores só com decisão tua.

## Ameaças e o que mitiga cada uma

| Ameaça | O que a mitiga | O que fica |
|---|---|---|
| Alguém de fora abre um pedido e corre código na máquina | Passo 5 (aprovação para todos os de fora); repositório só com colaboradores nossos a escrever | Se o passo 5 não for feito, **é a maior falha**. |
| Um pedido nosso (ou uma dependência nova) com código malicioso | Revisão do pedido antes de juntar (ADR-0031); a máquina não tem segredos nossos; sem sudo | Código mau corre como `eurolify-ci`, que está no grupo docker. |
| O grupo `docker` é root na máquina | Máquina dedicada, sem dados nem chaves; só a 22 aberta | Quem corrompe a máquina pode deixar lá algo que apanha os segredos dos fluxos de deploy (ver abaixo). |
| Segredos do ambiente `ensaio` (chaves da VPS) passam pela máquina nos fluxos de deploy | Esses fluxos só correm no `main`; a chave escreve-se no passo e apaga-se no fim; os ganchos apagam `~/.ssh` antes e depois de cada trabalho | **Risco aceite à espera do OK (ADR-0046):** uma máquina já corrompida por um pedido anterior pode apanhá-las. Se não se aceitar, os fluxos de deploy ficam no GitHub quando o Actions voltar, ou refaz-se a máquina antes de cada deploy. |
| Descarregar um executor adulterado | Versão fixa e sha256 conferido pelo script | O sha256 vem da mesma página do GitHub; o executor actualiza-se sozinho depois. |
| Palavra-passe do SSH adivinhada | SSH só por chave; `fail2ban`; `DenyUsers eurolify-ci` | — |
| Token de registo apanhado | Vale uma hora, serve uma vez; nunca num ficheiro, no chat ou no repositório; passa só na hora | Fica visível nos argumentos do processo durante o registo (a máquina não tem outros utilizadores). |
| Portas abertas pelo docker (que passa por fora do `ufw`) | Os fluxos só publicam em `127.0.0.1` | Um fluxo novo que publique para fora ficaria exposto: rever nos pedidos. |
| Disco cheio | Limpeza diária; ganchos | Sem alerta: ver o disco de vez em quando (`df -h`). |
| Máquina desactualizada | `unattended-upgrades` | Nunca reinicia sozinha: reiniciar fora do horário de trabalho. |

## Se algo correr mal

- O executor aparece *Offline*: na máquina, `systemctl status 'actions.runner.*'`.
- Um trabalho falha com «nome já em uso» (contentor `postgres`): os ganchos não
  correram; `docker rm -f $(docker ps -aq)` na máquina.
- Desligar de vez: *Settings → Actions → Runners → Remove*, apagar a variável
  `EXECUTOR_CI` e apagar a máquina no fornecedor.
