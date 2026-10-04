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
- Por criar pelo Diogo: a chave da Scaleway só de escrita no contentor; a
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
