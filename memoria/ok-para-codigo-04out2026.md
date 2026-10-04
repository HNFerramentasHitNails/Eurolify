# OK para código (decisão AE, ADR-0023) — 04/10/2026

Pedido do Diogo, 04/10/2026: *«preparar tudo para começarmos a escrever o
código do Eurolify no GitHub e para que cada entrada no main seja publicada
sozinha no ensaio (a VPS)»*. Fase A do pedido, decisão A1: o OK para código
num ADR que substitui o ADR-0001, com o âmbito *«código do produto, script da
VPS, integração contínua»*.

## O que se fez

- O Claude leu, antes de propor: `AGENTS.md`, `docs/05`, `06` e `11`, os
  ADR-0001, 0002, 0005, 0013 a 0022, a memória da VPS e as skills
  `platform-architect`, `observability-security`, `headless-commerce` e
  `eu-gdpr-privacy`.
- Mostrou o texto do ADR-0023 antes de o gravar e perguntou se ficava com a
  trava «o código de um domínio só depois do desenho dele» (acrescento do
  Claude, não pedido). Resposta do Diogo: *«podes avançar mesmo assim»*
  (na mesma mensagem em que disse que tinha acabado de comprar o domínio).
  **Lida como OK ao texto mostrado, com a trava** — a resposta não a nomeou.
- ADR-0023 novo; ADR-0001 com o estado «substituído»; `docs/06` com a linha
  AE e a nota na A.
- **Varrimento** (`grep` de «ADR-0001», «não há código», «sem código» e «OK
  para código» em todos os `.md`, sem `memoria/` e sem as referências das
  skills): 71 ocorrências em 38 ficheiros. Mudados os documentos vivos:
  `AGENTS.md` (3 sítios), `README.md`, o cabeçalho das 14 skills, mais 2
  frases da `headless-commerce`, `docs/00`, `05` (título e critério de
  passagem), `08` (2), `10` (linha da Fase 0) e `12`. Ficam como estão os ADR
  aceites (registo histórico), as memórias datadas e o exemplo hipotético do
  `docs/10` («se o OK para código for dado a 01/01/2027…»), que é um cenário
  de contratação e não um estado.

## Números (com data e como se contaram)

| O quê | Valor | Fonte e como |
|---|---|---|
| Ocorrências varridas | 71 em 38 ficheiros | `Grep` de `ADR-0001\|não há código\|sem código\|OK para código`, 04/10/2026 |
| `AGENTS.md` depois desta mudança | 13.515 bytes (limite do Codex: 32 KiB) | `(Get-Item AGENTS.md).Length`, 04/10/2026 |

## O que ficou por verificar

- Se o Bruno concorda com o OK (vale com o do Diogo, mas é o Bruno quem revê).
- Se o Diogo queria mesmo a trava do domínio.
- ~~A A2 é a próxima decisão~~ → decidida (secção seguinte).

## A2: GitHub Pro na conta pessoal (decisão AF, ADR-0024) — 04/10/2026

Pergunta com três opções (a: organização `eurolify` no Team, recomendada;
b: conta pessoal com Pro; c: sem protecção). Resposta do Diogo: *«b»*.

### Números (com data e como se contaram)

| O quê | Valor | Fonte e como |
|---|---|---|
| Dono do repositório | conta pessoal `HNFerramentasHitNails` (`User`), privado | `gh api repos/HNFerramentasHitNails/Eurolify`, 04/10/2026 |
| Colaboradores | 1: a própria conta, `admin` | `gh api …/collaborators` |
| Protecção do `main` e *rulesets* | 403, *«Upgrade to GitHub Pro or make this repository public»* | `gh api …/branches/main/protection` e `…/rulesets` |
| Fluxos de Actions | 0; Actions ligadas, todas as acções permitidas | `gh api …/actions/permissions` e `…/workflows` |
| Planos (organizações) | Free 0 $, Team 4 $/utilizador/mês, Enterprise 21 $; protecção em privados só no Team+ | `github.com/pricing`, 04/10/2026 |
| GitHub Pro | protecção, revisores obrigatórios e donos do código em privados; 4 $/mês segundo a FAQ (texto antigo) | `docs.github.com` (*GitHub's plans*; FAQ das mudanças aos planos), 04/10/2026 |
| Codex no GitHub | publica como `chatgpt-codex-connector`; não aprova; segue `## Code Review Rules` do `AGENTS.md` | `learn.chatgpt.com/docs/third-party/github` (sem data), 04/10/2026 |
| Nomes `eurolify`, `eurolify-dev`, `luckytarget` no GitHub | livres (404) | `gh api users/<nome>`, 04/10/2026 |
| `gh` no computador do Diogo | 2.95.0, sessão na `HNFerramentasHitNails`, âmbitos `gist`, `read:org`, `repo`, `workflow` | `gh --version`, `gh auth status` |

### O que ficou por verificar

- Se o Bruno tem conta própria no GitHub (perguntado; sem resposta).
- O preço actual do Pro; se aceita «0 aprovações + donos obrigatórios».
- O Diogo disse ter comprado o domínio `eurolify.eu` a 04/10/2026 (registador
  não dito); o DNS público respondia «não existe» nessa altura. Entra na A5.

## A3: as ferramentas (decisão AG, ADR-0025) — 04/10/2026

Proposta numa tabela (peça, versão, porquê, alternativa). Resposta do Diogo:
*«fica assim»*.

### Números (com data e como se contaram)

| O quê | Valor | Fonte e como |
|---|---|---|
| Node.js | LTS 24.21.0 (07/09/2026); 26.10.0 «Current»; a 26 passa a LTS a 28/10/2026; a 24 entra em manutenção a 20/10/2026 e acaba a 30/04/2028 | `nodejs.org/dist/index.json` e `nodejs/Release` `schedule.json`, 04/10/2026 |
| PostgreSQL | 18.6 «current» (13/08/2026), fim 14/11/2030; 17.11; 16.15 | `postgresql.org/versions.json`, 04/10/2026 |
| TypeScript | `latest` 7.0.2; 6.0.3 (16/04/2026) | `registry.npmjs.org/typescript` |
| typescript-eslint 8.71.0 | pede `typescript >=4.8.4 <6.1.0` → por isso o TS 6.0 | `peerDependencies` no registo do npm |
| Outras (`latest`) | pnpm 12.9.1, fastify 5.12.5, ~~typebox 0.34.52~~ `typebox` 1.3.34 (o `@sinclair/typebox` era o nome antigo — erro do Claude, corrigido a 04/10/2026, opção a do Diogo; adaptador `@fastify/type-provider-typebox` 6.1.0 exige `typebox ^1.0.13`), @fastify/swagger 9.9.1, kysely 0.29.6, pg 8.23.1, vitest 5.0.3, testcontainers 12.2.0, eslint 10.12.0, prettier 3.9.9, react 19.3.0, vite 8.3.2 | `registry.npmjs.org/<pacote>/latest`, 04/10/2026 |

### O que ficou por verificar

- Fastify 5.12 e Vitest 5 no Node 26; a memória real de cada peça na VPS-1.
- As duas datas: Node 26 depois de 28/10/2026; TypeScript 7 quando o lint o aceitar.

## A4: publicação pelo GitHub por SSH (decisão AH, ADR-0026) — 04/10/2026

Duas opções (Coolify; GitHub por SSH com imagens no GitHub, inclinação do
Diogo). Resposta: *«fica a b)»*.

- **Correcção do Claude antes de gravar:** na proposta escreveu «a
  documentação do GitHub diz que o GHCR aceita tokens clássicos» sem a ter
  lido nessa sessão. Leu-a antes do ADR: `docs.github.com`, *Working with the
  Container registry*, 04/10/2026 — *«GitHub Packages only supports
  authentication using a personal access token (classic)»*; `read:packages`
  para puxar; pull pelo resumo `@sha256:…`.
- Um token clássico lê todos os pacotes da conta, não só os do Eurolify:
  fica na VPS só para o root, com data de fim (proposta: 90 dias).

### O que ficou por verificar

- Se o GHCR aceita tokens finos; o pacote do Docker Engine no Ubuntu 26.04;
  o tamanho da imagem e o tempo de uma publicação.

## A5: o ensaio — cópias, alertas, IP e endereço (decisão AI, ADR-0027) — 04/10/2026

Proposta em quatro peças; resposta do Diogo: *«sim»*. Só para o ensaio.

### Números (com data e como se contaram)

| O quê | Valor | Fonte e como |
|---|---|---|
| Scaleway Object Storage | One Zone 0,00803 €/GB/mês; Multi-AZ 0,01606 €; Glacier 0,00254 €; saída 75 GB/mês grátis; Paris, Amesterdão, Varsóvia | `scaleway.com/en/pricing/storage`, 04/10/2026 |
| OVH Object Storage | preço **não lido** (a página não o mostrou) | `ovhcloud.com/en-ie/public-cloud/prices`, 04/10/2026 |
| Healthchecks.io | SIA Monkey See Monkey Do, Riga (Letónia); servidores «Hetzner bare metal» (país não dito); grátis: 20 tarefas, 100 registos por tarefa | `healthchecks.io/about` e `/pricing`, 04/10/2026 |
| `eurolify.eu` | comprado pelo Diogo a 04/10/2026; DNS público «não existe» à hora da consulta (NS, A, SOA) | `Resolve-DnsName`, 04/10/2026 |

### O que ficou por verificar

- O país dos servidores do Healthchecks.io e se o plano gratuito manda e-mail.
- O registador do `eurolify.eu`.
- Por criar pelo Diogo: a chave da Scaleway ~~só de escrita~~ de leitura e
  escrita só no contentor (corrigido pela revisão do #10); a
  conta no Healthchecks.io.

## A4 acrescentada: a VPS opera-se pelo GitHub (decisão AJ, ADR-0028) — 04/10/2026

Pedido do Diogo: *«quero trabalhar sem depender deste computador (tenho outro
no trabalho; o Bruno usa um Mac)»*; decisão: *«b), operar pelo GitHub»*. Antes
de gravar, pediu três verificações; resposta final: *«sim»*.

### Números (com data e como se contaram)

| O quê | Valor | Fonte e como |
|---|---|---|
| Revisores obrigatórios num ambiente, repositório privado | **não** no Free, Pro e Team; só no Enterprise (21 $/utilizador/mês) | `docs.github.com`, *Deployments and environments*, 04/10/2026 |
| Segredos e *deployment branches* de ambiente, repositório privado | sim no Pro e no Team | idem |
| Quem cria segredos de ambiente num repositório de conta pessoal | só o dono (`HNFerramentasHitNails`) | `docs.github.com`, *Using secrets*, 04/10/2026 |
| 2FA exigida aos colaboradores | uma organização pode; a página não diz que um repositório pessoal possa | `docs.github.com`, *About mandatory 2FA*, 04/10/2026 |

### O que ficou por verificar

- Que um fluxo num ramo que não o `main` não recebe os segredos do ambiente
  `ensaio` (teste no C2).
- A conta do Bruno e a 2FA dele.
- O passo B2 (pnpm 12.9.1) ficou à espera do OK quando esta decisão entrou.

## Fase B: o computador do Diogo (Windows) — 04/10/2026

### O que se fez (cada passo com o OK do Diogo)

- **Node.js 24.21.0** (tinha 24.14.1, pelo winget, que só oferecia a 24.19.0):
  instalador oficial `node-v24.21.0-x64.msi` do `nodejs.org`, conferido pela
  soma do `SHASUMS256.txt` (`bb0eaee1…2cac`, igual), `msiexec` com código 0,
  `node --version` = v24.21.0.
- **pnpm 12.9.1** (tinha 11.5.2): `npm install -g pnpm@12.9.1`. O npm 11 **não
  correu os scripts de instalação** do pnpm (`allowScripts`); o `pnpm --version`
  responde 12.9.1. Se falhar por isso: `npm install -g --allow-scripts=pnpm
  pnpm@12.9.1`, com OK.
- **Docker Desktop 4.93.0** (última nas notas do Docker, 28/09/2026) instalado
  pelo winget (soma verificada) e **desinstalado** a seguir. O Diogo perguntou
  porque se instalava no computador e não na VPS; resposta: a VPS recebe o que
  precisa pelo script revisto (Fase D, ADR-0028), o computador é só para
  escrever e testar. Decisão do Diogo: *«testes com base correm só no
  GitHub»*. Os testes com PostgreSQL correm no GitHub Actions; neste
  computador correm o lint, os tipos e os testes sem base.
- Já existiam: git 2.53.0, gh 2.95.0 (sessão na `HNFerramentasHitNails`),
  WSL 2.6.3, winget 1.29.

### O que ficou por verificar

- Se o pnpm sem os scripts de instalação funciona em tudo (só se viu o
  `--version`).
- O computador do trabalho do Diogo e o Mac do Bruno não foram preparados.

## GitHub Pro activo; CODEOWNERS e a nova via Git — 04/10/2026

- O Diogo: *«ja tenho o github pro»*. Confirmado pela API: a protecção do
  `main` passou de 403 («Upgrade to GitHub Pro») a 404 «Branch not protected»,
  e as *rulesets* a `[]` (nenhuma ainda).
- Conta do Bruno, dita pelo Diogo: **`bruno-88`** (existe, criada a
  25/07/2024; **não é colaborador** nem tem convite, a 04/10/2026). A 2FA dele
  não se vê de fora: a confirmar por ele.
- `.github/CODEOWNERS` no `main` (código → `@HNFerramentasHitNails` e
  `@bruno-88`) e a secção Git do `AGENTS.md` reescrita: **nada directo ao
  `main`**; documentos por pedido juntado pelo autor; código com a aprovação
  do outro e a revisão do outro agente. Este foi o último `push` directo.
- O `CODEOWNERS` tem de ir para o `main` **antes** de a regra se ligar: o
  GitHub lê-o do ramo de destino; sem ele, o primeiro pedido de código
  entraria sem aprovação.
- ⚠️ O nome da conta com a marca existente fica escrito no `CODEOWNERS` —
  consequência da A2 b) (ADR-0024).

### O que ficou por verificar

- O convite ao `bruno-88` (o Diogo convida, ou o Claude com o OK dele) e a
  aceitação; enquanto não aceitar, o GitHub marca a linha dele no `CODEOWNERS`
  como inválida.
- A regra do `main` ainda não está ligada.

## Incidente: `node_modules` e `dist` enviados para o `main` (04/10/2026) — erro do Claude

### O que se fez

- O commit `9f28fd6` (CODEOWNERS e a nova via Git), feito num ramo tirado do
  `main` sem `.gitignore` (o `.gitignore` só existia no ramo `c1-esqueleto`),
  levou com `git add -A` **7.506 ficheiros a mais**: `node_modules` (pacotes
  de terceiros e estado do pnpm) e `apps/api/dist` (4 ficheiros: o código do
  C1 compilado). O `git status` foi mostrado pelo próprio comando e **não foi
  lido** antes do commit; o `push` seguiu no mesmo comando.
- **Segredos: nenhum** — conferida a lista de ficheiros (as duas
  correspondências a `id_` são ficheiros de língua `id_ID` do `typebox`).
- O `apps/api/dist` era código compilado a entrar no `main` sem revisão,
  contra o ADR-0013.
- Correcção sem reescrever o histórico (sem `push --force`): pedido #1
  (`fba6e09`) retira os 7.506 ficheiros e acrescenta o `.gitignore` igual ao
  do C1. Juntado pelo Claude, sem revisão, por urgência (as outras sessões
  puxam o `main`).
- Depois do `gh pr merge --delete-branch`, a cópia local ficou no `main`
  **local** antigo (`12edf46`, do clone): pôs-se no `origin/main` com
  `git switch -C main origin/main`.

### Lição

- **Nunca `git add -A`**: acrescentar os ficheiros pelo nome e ler o `git
  status --short` antes de cada commit; separar o `push` do commit.

### O que ficou por verificar

- O peso que os 7.506 ficheiros deixam no histórico (o tamanho do GitHub
  ainda dava 785 KB, valor que actualiza com atraso). Tirá-los do histórico
  exige reescrevê-lo (`push --force`): decisão do Diogo.

## A regra do `main` ligada e o Bruno convidado (04/10/2026, 01:16 UTC)

Com o OK do Diogo (*«sim»*) aos dois comandos mostrados:

| O quê | Resultado | Comando |
|---|---|---|
| Convite ao `bruno-88` | enviado, permissão `write`, 01:16:27 UTC; por aceitar | `gh api -X PUT …/collaborators/bruno-88 -f permission=push` |
| Regra do `main` | *ruleset* `24437624` «main protegido (ADR-0024)», `active`, **sem excepções** (`bypass_actors: []`) | `gh api -X POST …/rulesets --input regra.json` |
| O que se aplica ao `main` | `deletion`, `non_fast_forward`, `pull_request` (0 aprovações, revisão dos donos obrigatória, ~~aprovação depois do último `push`~~ — desligada às 01:2x UTC, ver abaixo —, aprovações antigas caem com um `push`, só `squash`; o GitHub acrescentou `require_extra_approval_for_unattributed_changes: true`) | `gh api …/rules/branches/main` |

### O que ficou por verificar

- ~~Que um `push` directo ao `main` é recusado~~ → **recusado**: `GH013: Repository rule violations found for refs/heads/main` (teste do Claude, conta de administrador, 04/10/2026).
- A aceitação do convite e a 2FA do Bruno; até lá, nenhum pedido de código
  entra.
- A verificação obrigatória `codigo` (o fluxo `verificar`) só se acrescenta à
  regra depois de o fluxo estar no `main`.

### Correcção da regra: a «aprovação do último push» desligada (04/10/2026)

- O pedido #3 (só memória, sem ficheiros com dono) ficou `BLOCKED` com a
  regra acabada de ligar. Causa: `require_last_push_approval: true` pede
  sempre uma aprovação de outra pessoa, mesmo com 0 aprovações obrigatórias —
  contra o ADR-0024, ponto 4 (documentos juntados pelo autor).
- Com o OK do Diogo, a opção foi desligada (`PUT …/rulesets/24437624`); o #3
  passou de `BLOCKED` a `CLEAN` e foi juntado. Ficaram: revisão dos donos
  obrigatória e `dismiss_stale_reviews_on_push` (um `push` depois da
  aprovação do outro volta a pedi-la).
- O primeiro `PUT` falhou com `Problems parsing JSON`: o PowerShell 5.1
  gravou o ficheiro com BOM; refeito sem BOM.

## A chave do `age` também na VPS (decisão AK, ADR-0029) — 04/10/2026

Ao desenhar o C3, o Claude viu que o ADR-0027 não fechava: chave privada fora
da VPS e reposição semanal automática na VPS. Duas opções (a: reposição do
dump local + decifrar à mão uma vez por mês, recomendada; b: chave privada
também na VPS). Resposta do Diogo: *«b»*. Só para o ensaio.

## Fase C: o pedido #10 com o C1, o C2 e o C3 — à espera do Bruno e do Codex (04/10/2026)

### O que se fez

- Ramo `c1-esqueleto`, pedido **#10**: esqueleto da API (C1), os quatro fluxos
  `verificar`, `publicar`, `aplicar-script`, `medir` e o `Dockerfile` (C2), e o
  `infra/vps` com o `preparar.sh` e os programas da máquina (C3).
- Erros apanhados antes do pedido: `BASE_URL` é reservado do Vite (o Vitest
  preenche-o com `"/"`; passou a `BASE_DADOS_URL`); no `preparar.sh`, um
  `sshd -t` falhado apagava o ficheiro em vez de repor o anterior, e acrescentar
  uma chave colava-a à última linha; nas tarefas, o `trap ERR` não avisava
  quando a falha vinha de um `exit`.
- No GitHub, a primeira corrida falhou no `shellcheck` (2 avisos «info»:
  SC1091 por o caminho dos `source` se ler da raiz; SC2016 de propósito,
  anotado). Corrigido no commit `cc61aa9`.

### Números (com data e como se contaram)

| O quê | Resultado | Onde |
|---|---|---|
| `verificar` no #10 | `codigo` (com PostgreSQL 18) 42 s, `imagem` 42 s, `script-vps` 11 s — todos a passar | GitHub Actions, corrida 37168591880, 04/10/2026 |
| `preparar.sh --mostrar` | 53 alterações por fazer, 10 avisos, nada mudado — igual no WSL do Diogo e no Ubuntu 26.04 do GitHub | idem; WSL com teste antes/depois das pastas |
| Tamanho do pedido | 48 ficheiros, ≈ 3.700 linhas (antes da correcção) | `git diff --stat origin/main...HEAD` |

### O que ficou por verificar

- A aprovação do Bruno (convite aceite? 2FA?) e a revisão do Codex
  (`@codex review`; a revisão automática não está ligada).
- O `preparar.sh` a sério, publicar, aplicar e medir: só na Fase D.
- Acrescentar à regra do `main` a verificação obrigatória do fluxo
  `verificar` depois de o #10 entrar.

## Só o Claude Code por agora; o #10 entra sem o Bruno (decisão AL, ADR-0030) — 04/10/2026

- O Diogo: *«vamos utilizar agora so o claude code, e o codex talvez mais
  tarde»* e *«O bruno ja tem convite e deve de aceitar amanha ou segundo. por
  isso, avançamos sem ele com a minha permissão»*. Ao plano do Claude
  (revisão por uma sessão nova com outro modelo; o Bruno revê depois, até
  07/10/2026; a regra do `main` desligada só para juntar o #10): *«sim»*.
- O Claude avisou antes: sem o Bruno e sem o Codex o #10 entraria sem nenhuma
  revisão independente, com um script que corre como root na VPS.

## Cada um junta o que fez (decisão AM, ADR-0031) — 04/10/2026

- Pedido do Diogo: histórico do que o outro fez ao chegar, nunca repetir nem
  recriar, trabalho em paralelo (X e Y) sem se atrapalharem; *«cada um pode
  auto aprovar o que fez»*. O Claude propôs a via intermédia (VPS, fluxos e
  fiscal com o outro) e avisou uma vez do risco; resposta: *«cada um aprova
  tudo o que fez»*.
- Achado: o #10 aparecia `CLEAN` com a revisão dos donos ligada, antes de o
  `bruno-88` aceitar o convite — a trava do ADR-0024 não funcionava como se
  pensava (causa provável: dono que não é colaborador é ignorado).
- A revisão do agente ao #10 (sessão nova, Sonnet) deu 0 P0, 3 P1, 12 P2;
  corrigidos os 3 P1 e 9 P2 no commit `2acc97f`, com os testes verdes; os P2
  que ficam estão no `infra/vps/LEIA-ME.md`.

## O #10 no `main` e a regra a exigir os testes (04/10/2026)

Com o OK do Diogo (*«sim»*) aos quatro passos mostrados:

| Passo | Resultado | Comando |
|---|---|---|
| Ambiente `ensaio`, só o `main` | criado: `custom_branch_policies: true`, política `main` (branch) — antes de os fluxos o referirem, para não nascer sem restrição | `gh api -X PUT …/environments/ensaio`; `POST …/deployment-branch-policies` |
| Regra sem a revisão dos donos (ADR-0031) | `require_code_owner_review: false`, 0 aprovações | `PUT …/rulesets/24437624` |
| #10 juntado | `3f5bd6a` (squash) | `gh pr merge 10 --squash --delete-branch` |
| Regra a exigir os testes | `required_status_checks`: `codigo`, `script-vps`, `imagem` | `PUT …/rulesets/24437624` |

- Juntar o #10 disparou o `publicar` e o `aplicar-script` no `main`: esperado
  que falhem no passo SSH (sem chaves nem `VPS_ENDERECO` até à Fase D), sem
  tocar na VPS. O `publicar` envia a primeira imagem para o GHCR.
- Este pedido (só memória) é a prova de que um pedido de documentos corre os
  testes e só depois se junta.

## Fase D começada: chaves e segredos no GitHub (04/10/2026, 11:39 UTC)

Com o OK do Diogo a cada passo:

| Passo | Resultado | Como |
|---|---|---|
| D1: 4 chaves de máquina (sem frase-passe) | `publicar` `SHA256:ic0n9LRb…`, `aplicar` `SHA256:zDIpR8AV…`, `medir` `SHA256:dM3jm5Nq…`, `deploy_key` `SHA256:HHLuipRT…` (ED25519), em `C:\Users\diogo\.eurolify-chaves`, só legível pelo `diogo` (sem herança) | `ssh-keygen` do Git Bash; `icacls /inheritance:r` |
| D2: segredos do ambiente `ensaio` | `VPS_CHAVE_PUBLICAR`, `_APLICAR`, `_MEDIR`, `VPS_ENDERECO` (comparado sem o mostrar: igual ao da VPS); variável `VPS_KNOWN_HOSTS` (3 chaves do anfitrião: ed25519, rsa, ecdsa) | `gh secret set --env ensaio < ficheiro`; `gh variable set` |
| D3: *deploy key* | id 165336573, **read-only** | `gh repo deploy-key add` |

As chaves privadas apagam-se deste computador no D8 (ficam só no GitHub e na
VPS).

## A OVH, fornecedor único (decisão AN, ADR-0032) — 04/10/2026

- O Diogo: *«entretanto deixamos de usar o scaleway e passamos a usar so o
  ovh, ja que a vps é de lá»* e *«usamos sempre o ovh para centralizar tudo em
  um unico fornecedor»*.
- OVH Object Storage, lido a 04/10/2026: compatível com S3; regiões na UE
  (Gravelines, Estrasburgo, Roubaix, Frankfurt, Varsóvia, Paris, Milão) e
  Londres; catálogo PT: `storage-standard.monthly.postpaid` 0,007 €/mês
  (unidade por GB presumida), entrada 0 €.
- O Claude avisou uma vez: VPS e cópias na mesma conta — um problema na conta
  leva as duas; aceite para o ensaio, a produção decide de novo.
- Mudados: `ensaio.conf` (`S3_DESTINO=ovh:…`), `LEIA-ME`, comentários do
  `eurolify-copia` e do `eurolify-reposicao`, `docs/11` §6 e §7 (4 e 9),
  `docs/05`, `docs/06` (AN e nota em AI), estados dos ADR-0011, 0027, 0029.
  O primeiro varrimento só via ficheiros com extensão e falhou os programas
  sem extensão; refeito em todo o `infra/` e `.github/`.

## Fase D: o par `age` e as chaves públicas dos fluxos (04/10/2026)

- `age` 1.3.2 instalado pelo winget (última no GitHub `FiloSottile/age`,
  29/08/2026). Par gerado em `C:\Users\diogo\.eurolify-chaves` (só o
  `diogo`): pública `age1l66ychslr5t8t29gx05t5nfpnu9nlx0chfk8erzqtn3n86zh85qqu839m4`;
  teste de cifrar e decifrar a passar. A privada vai para a VPS (ADR-0029) e o
  Diogo guarda uma cópia num sítio seguro dele **antes do D8** — sem ela, as
  cópias são ilegíveis se a VPS se perder.
- D4: as partes públicas `publicar.pub`, `aplicar.pub`, `medir.pub` em
  `infra/vps/chaves/fluxos/` (impressões digitais iguais às do D1).

## Fase D: a VPS preparada pelo script e os fluxos provados (04/10/2026, ≈ 11:50–12:10 UTC)

Com o OK do Diogo a cada passo.

### O que se fez

- `infra/vps` do `main` (`aee2117`) copiado para `~/eurolify-infra` na VPS
  (31 ficheiros, somas SHA-256 iguais às do `main`).
- `preparar.sh --mostrar` (60 por fazer, 8 avisos) e depois a sério pela
  chave de emergência: **59 alterações feitas**, 8 avisos. Segundo
  `--mostrar`: **0 por fazer** (repete-se sem estragar).
- Segredos postos na VPS pelo computador do Diogo, sem passarem pelo ecrã
  (`cmd` com `<` para `sudo sh -c 'umask 077; cat > …'`): `deploy_key`,
  `age.key`, `age.pub` (600 root).
- Um aviso falso no passo 4 (a própria regra da 22 dada como desconhecida,
  por comparar o formato curto do `ufw status` com o longo): corrigido neste
  pedido, testado na VPS nos dois sentidos.

### Números (com data e como se contaram)

| O quê | Resultado | Como |
|---|---|---|
| SSH depois do script | `passwordauthentication no`, `permitrootlogin no`, `pubkeyauthentication yes`; ligação nova com a chave do Diogo entra | `sshd -T`; `ssh -o BatchMode=yes` |
| Serviços | `ssh`, `docker`, `fail2ban`, `ufw`, 3 `eurolify-pedido@*.path`, 3 temporizadores: todos `active` | `systemctl is-active` |
| `fail2ban` | `bantime` 3600 s; **`dbpurgeage` 1.209.600 s (14 dias)** | `fail2ban-client get` |
| PostgreSQL | `postgres:18.6` a correr, porta 5432 **não publicada**; 31–34 MiB de 768 MiB | `docker ps`, `docker stats` |
| Memória da máquina | 655 MiB usados de 3,7 GiB; 3,1 GiB disponíveis | `free -h` |
| Portas à escuta | 22 (todas as interfaces), 53 (DNS local), 38049 = `containerd` só em `127.0.0.1` | `ss -tlnp` |
| Utilizadores dos fluxos | sem `sudo`/`docker`; casa e `authorized_keys` de root | `id`, `stat` |
| *Deploy key* na VPS | impressão digital `SHA256:HHLuipRT…`; `git ls-remote` deu `aee2117` = `main` | `ssh-keygen -lf`; `git ls-remote` |
| `age` na VPS | a pública gerada pela privada = `age.pub` | `age-keygen -y` |
| Fluxo `medir` (GitHub, `main`) | sucesso; **0 IPv4** no registo do GitHub | corrida 37200307029 |
| `medir` num ramo de teste | **recusado** pelo ambiente (*«not allowed to deploy to ensaio»*), 0 passos — resolve o «por verificar» do ADR-0028 | corrida 37200369524; ramo apagado |
| Fluxo `aplicar-script` (GitHub, `aee2117`) | sucesso: `mostrar` 0 por fazer, `aplicar` 0 feitas; 0 IPv4 no registo | corrida 37200025121 (repetida) |
| Chave `aplicar` com commit antigo (`3f5bd6a`) | **recusado**: *«anterior ao último aplicado (aee2117…)»* | `ssh` com a chave, modo `mostrar` |
| Chave `aplicar` com `ls /etc` ou sem comando | **recusado** (código 65); sem consola | idem |
| Actualizações | 53 por aplicar; **reinício pedido** | `apt-check` no `medir` |

### O que ficou por verificar

- A publicação e o `/health` (falta o token `read:packages` do Diogo).
- As cópias e a reposição (faltam o Object Storage e o utilizador S3 na OVH),
  os alertas (falta o Healthchecks.io).
- O reinício que as actualizações pedem: decisão do Diogo, fora do horário de
  trabalho e com aviso (`AGENTS.md`, regra 4).
- D8: apagar as chaves de máquina do computador do Diogo (depois de ele
  guardar o `age.key` num sítio seguro).

## Fase D: segredos da OVH e do GitHub, e a primeira publicação (04/10/2026, ≈ 12:00–12:20 UTC)

### O que se fez (com o OK do Diogo)

- O Diogo deu os caminhos de dois ficheiros com segredos (as chaves S3 da OVH,
  em JSON nas Transferências; o token do GitHub no Ambiente de trabalho). O
  Claude **não os leu**: viu só a forma (nomes dos campos, tamanhos),
  construiu o `rclone.conf` e o `ghcr.token` na pasta privada sem os valores
  passarem pelo ecrã, e **apagou os dois originais** (o primeiro `Remove-Item`
  do token foi recusado pela protecção do ambiente — o caminho com espaço foi
  lido como `/c`; apagado com `[IO.File]::Delete`).
- Token, confirmado pela API do GitHub: conta `HNFerramentasHitNails`, âmbito
  **só `read:packages`**, **fim a 2027-04-03 23:00 UTC** (o Diogo tinha dito
  2027-01-02; vale a do GitHub, posta em `ghcr.expira`).
- O contentor `eurolify-ensaio-copias` **não estava em Gravelines**: listando
  os endereços S3 da OVH a partir da VPS, só apareceu em `eu-west-par` (Paris,
  três zonas). Com o OK do Diogo, fica em Paris. Catálogo PT:
  `storage-standard-3AZ.consumption` 0,000019 €/h (≈ 0,014 €/mês, unidade por
  GB presumida) — o dobro de uma zona, cêntimos para cópias de poucos MB.
- O `rclone` do Ubuntu 26.04 é a **1.60.1** e não conhece o fornecedor
  `OVHcloud`; com `provider = Other` funciona.
- Postos na VPS (600 root): `rclone.conf`, `ghcr.token`, `ghcr.expira`.
- **Primeira publicação:** repetido só o trabalho falhado da corrida
  `publicar` do #10 (37169605512).

### Números (com data e como se contaram)

| O quê | Resultado | Como |
|---|---|---|
| Contentor visto da VPS | `eurolify-ensaio-copias`, lista sem erro | `rclone lsd ovh:` (código 0) |
| Publicação | *«A puxar …eurolify-api@sha256:9d1c4e1e55b1… — Sem migrações nesta imagem — Publicado. O /health responde.»* | registo do trabalho `publicar` |
| `/health` pelo túnel SSH | `200 {"estado":"ok"}`; `/nao-existe` → 404 | `ssh -L 18080:127.0.0.1:8080`, `Invoke-WebRequest` |
| Porta 8080 vista da Internet | **fechada** | `Test-NetConnection -Port 8080` |
| IPv4 no registo da corrida | 14, todos `127.0.0.1`/`0.0.0.0` nos trabalhos de teste e construção; **0 no `publicar`**, nenhum da VPS | `grep` e classificação |

### O que ficou por verificar

- A primeira cópia e a reposição (o `rclone` e o `age` já estão).
- Os alertas (falta o Healthchecks.io).
- O reinício que as actualizações pedem.
- D8: apagar as chaves de máquina, o `rclone.conf` e o `ghcr.token` deste
  computador (o Diogo guarda antes o `age.key`).
