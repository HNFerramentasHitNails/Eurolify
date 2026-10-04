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
