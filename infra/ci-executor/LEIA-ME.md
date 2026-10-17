# Executor de testes próprio (`infra/ci-executor`)

Uma máquina nossa onde correm os **testes** dos pedidos de alteração (os
trabalhos sem segredos: `verificar`, `vigiar`, `vigiar-dependencias`,
`espelhar-imagens/conferir`), enquanto o Actions da conta estiver bloqueado
(todas as execuções acabam em segundos desde 14/10/2026). A **publicação e os
fluxos que falam com a VPS ficam sempre nos executores do GitHub**, tal como o
`verificar` que o `publicar` chama depois de um pedido juntado. Decisão
proposta: ADR-0046, **à espera do OK do Diogo**. Memória:
`memoria/executor-de-ci-proprio-17out2026.md`.

**Nunca na VPS do ensaio.** Os fluxos correm código dos pedidos com acesso ao
docker, que é root na máquina. A VPS do ensaio tem a base, as chaves e os
dados; esta máquina não tem nada disso. O `preparar.sh` recusa-se a correr onde
exista `/etc/eurolify`, `/var/lib/eurolify` ou os programas `eurolify-*` da VPS.

## Passos para o Diogo

0. **Antes de comprar nada: ver porque falha.** No GitHub, abrir uma execução
   falhada (aba *Actions*, uma qualquer desde 14/10) e ler a mensagem. Se disser
   que é um bloqueio da conta (faturação, limite de gastos), **o executor
   próprio pode não resolver**: um fluxo precisa de ser aceite pelo GitHub antes
   de chegar à nossa máquina. Nesse caso, parar e resolver primeiro a conta.
1. **Comprar a máquina.** Pequena, num centro de dados da UE, **só para isto**,
   Ubuntu 24.04 (x86_64), com a tua chave SSH posta pelo fornecedor. Ponto de
   partida meu, **não medido**: 4 vCPU, 8 GB de RAM, 80 GB de disco (o
   `verificar` levou ≈ 14 min no executor do GitHub, `memoria/minutos-github-actions-16out2026.md`).
   A OVH, que já usamos, serve: **não verifiquei o preço** nem a oferta de hoje.
2. **Correr o script em modo «só mostrar»**, na máquina, ligado por SSH. A
   versão do executor (2.338.0) e o sha256 já estão fixos em
   `ficheiros/executor.conf`:
   ```
   git clone https://github.com/HNFerramentasHitNails/Eurolify.git
   cd Eurolify
   sudo bash infra/ci-executor/preparar.sh --mostrar   # não muda nada
   ```
   Ler o que mostra. Pode correr-se quantas vezes for preciso: só faz o que
   falta. Se avisar que nenhuma conta tem chave SSH, não fecha a palavra-passe:
   acrescenta a tua chave e corre outra vez.
3. **Antes de registar o executor: pedidos de fora.** *Settings → Actions →
   General → «Fork pull request workflows from outside collaborators» →
   «Require approval for all external contributors»*. É obrigatório porque o
   repositório é público. Confirmar também que as execuções vindas de forks não
   recebem «write tokens» nem segredos (não verifiquei os nomes exactos das
   opções hoje). **Nunca se aprova a execução de um pedido vindo de um fork
   enquanto houver executor próprio:** um fork pode alterar o `runs-on` no
   próprio fluxo e apontar à nossa máquina, por isso a **aprovação é a
   barreira** (a condição dos nossos fluxos só protege os ficheiros que não
   foram alterados).
4. **Registar o executor.** No GitHub: *Settings → Actions → Runners → New
   self-hosted runner*; copiar o token (vale uma hora, serve uma vez). **Nunca
   o enviar a ninguém nem pô-lo num ficheiro ou no chat.** Na máquina, num
   terminal:
   ```
   sudo bash infra/ci-executor/preparar.sh
   ```
   O script pede o token e **não o mostra** ao escrever (só assim; não há
   variável de ambiente). Depois, em *Settings → Actions → Runners*, o
   executor `eurolify-ci-…` aparece como *Idle*.
5. **Ligar os testes à máquina.** *Settings → Secrets and variables → Actions →
   Variables → New repository variable*: nome `EXECUTOR_CI`, valor
   `["self-hosted","linux","eurolify-ci"]` (com as aspas e os parênteses
   rectos). A partir daí, os testes dos pedidos **nossos** (não de forks, não do
   dependabot) correm lá.
6. **Voltar aos executores do GitHub:** apagar a variável `EXECUTOR_CI`. Os
   fluxos voltam a usar `ubuntu-24.04`, sem mexer em código.

Depois de tudo isto, os pedidos que estão à espera precisam de uma nova
execução (fechar e reabrir, ou um novo commit).

## O que a máquina faz sozinha

- Só a porta 22 aberta; SSH só por chave; o utilizador do executor
  (`eurolify-ci`) não entra por SSH e **não tem sudo**.
- `fail2ban` e actualizações de segurança automáticas (sem reinício
  automático).
- Executor oficial `actions/runner`, versão fixa e sha256 conferido, sem
  actualização automática (`--disableupdate`); um trabalho de cada vez;
  serviço `systemd`. A pasta do executor e o `.env` são do root; o utilizador
  só escreve em `_work` e `_diag` (e nos três ficheiros de credenciais do
  registo). **Não testado:** se o executor precisar de escrever noutro sítio,
  vai falhar e vê-se no registo do serviço; o mínimo que se acrescentar
  documenta-se aqui.
- Antes e depois de cada trabalho apaga os contentores (o `verificar` deixa o
  PostgreSQL de teste a correr) e o que um trabalho deixa no utilizador (chave
  SSH, credenciais do GHCR e do `gh`).
- Todos os dias às 04:30 (com atraso aleatório até 15 min): limpa contentores
  parados, imagens, volumes e redes docker sem uso, pastas de trabalho com mais
  de 3 dias e registos do executor com mais de 14 dias. Com um trabalho a
  correr, não faz nada.
- Cada acção do script fica em `/var/log/eurolify-ci/acoes.log`.
- **Nunca apaga o que não conhece**: chaves, regras da firewall ou contas
  desconhecidas aparecem como AVISO.

Um só executor significa fila: os quatro trabalhos do `verificar` correm um a
seguir ao outro (≈ soma dos tempos).

## Actualizar o executor, ou refazer a máquina

Com `--disableupdate`, o GitHub pode um dia recusar uma versão antiga: muda-se
`RUNNER_VERSAO` e `RUNNER_SHA256` em `executor.conf` por pedido revisto.
**«Refazer a máquina»** quer dizer: *Settings → Actions → Runners → Remove* (o
executor antigo), **reinstalar o sistema** da máquina no fornecedor e voltar
aos passos 2 e 4. Refaz-se também se se suspeitar de um pedido mau.

## Ameaças e o que mitiga cada uma

| Ameaça | O que a mitiga | O que fica |
|---|---|---|
| Alguém de fora abre um pedido e corre código na máquina | Passo 3 (aprovação para todos os de fora, **feito antes do registo**); a condição do `runs-on` só usa a máquina em pedidos que não vêm de fork nem do dependabot | A condição não chega: um fork altera o `runs-on` no seu fluxo. Só a aprovação protege. **Nunca aprovar execuções de forks.** |
| Um pedido nosso (ou uma dependência nova) com código malicioso | Revisão do pedido antes de juntar (ADR-0031); a máquina não tem segredos; sem sudo; só trabalhos sem segredos e com token só de leitura correm lá | Código mau corre como `eurolify-ci`, que está no grupo docker (root nesta máquina). Refazer a máquina se houver suspeita. |
| O grupo `docker` é root na máquina | Máquina dedicada, sem dados nem chaves; só a 22 aberta | Aceite só por ser dedicada. |
| Segredos da VPS (ambiente `ensaio`) passarem pela máquina | **Não passam:** `publicar`, `aplicar-script`, `medir`, `operar` e `configurar` estão fixos no executor do GitHub, tal como o `verificar` chamado pelo `publicar` | Se o GitHub continuar bloqueado, esses fluxos não correm; decide o Diogo (ADR-0046). |
| Descarregar um executor adulterado | Versão fixa e sha256 conferido pelo script; transferência só por HTTPS | O sha256 foi calculado por nós a partir do ficheiro da página de lançamentos. |
| Executor alterado por um trabalho | Pasta e `.env` do root; sem actualização automática | Ver acima: não testado com o executor real. |
| Palavra-passe do SSH adivinhada | SSH só por chave; `fail2ban`; `DenyUsers eurolify-ci` | — |
| Token de registo apanhado | Vale uma hora, serve uma vez; nunca num ficheiro, no chat, no repositório ou numa variável de ambiente | Fica visível nos argumentos do processo durante o registo (a máquina não tem outros utilizadores). |
| Portas abertas pelo docker (que passa por fora do `ufw`) | Os fluxos só publicam em `127.0.0.1` | Um fluxo novo que publique para fora ficaria exposto: rever nos pedidos. |
| Disco cheio | Limpeza diária; ganchos | Sem alerta: ver o disco de vez em quando (`df -h`). |
| Máquina desactualizada | `unattended-upgrades` | Nunca reinicia sozinha: reiniciar fora do horário de trabalho. |

## Se algo correr mal

- O executor aparece *Offline*: na máquina, `systemctl status 'actions.runner.*'`.
- Um trabalho falha com «nome já em uso» (contentor `postgres`): os ganchos não
  correram; `docker rm -f $(docker ps -aq)` na máquina.
- Desligar de vez: *Settings → Actions → Runners → Remove*, apagar a variável
  `EXECUTOR_CI` e apagar a máquina no fornecedor.
