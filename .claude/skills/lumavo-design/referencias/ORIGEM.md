# Origem das referências de design

Juntadas a 03/10/2026, a pedido do Diogo (*«Junta estas skills para o design do
lumavo»*), a partir de três endereços. Lidas em cópias só de leitura; **nenhum
programa foi copiado nem corrido**.

**Alteração feita a todos os ficheiros:** só o nome — `SKILL.md` passou a
`<nome>.md`, para não serem carregados como skills soltas (cada skill carregada
ocupa contexto em todas as sessões). **O conteúdo está igual ao original.** As
regras do Lumavo estão na `SKILL.md` acima desta pasta.

| Origem | Commit (data) | Licença | O que se trouxe |
|---|---|---|---|
| [`travisvn/awesome-claude-skills`](https://github.com/travisvn/awesome-claude-skills) | `1da55aa` (28/04/2026) | sem ficheiro de licença | **nada**: é uma lista de ligações. Dela saíram as escolhas de `anthropics/skills` abaixo |
| [`anthropics/skills`](https://github.com/anthropics/skills) | `8a1541c` (28/09/2026) | Apache 2.0 (`anthropic/LICENSE.txt`) | `frontend-design` → `anthropic/frontend-design.md` |
| [`vercel-labs/agent-skills`](https://github.com/vercel-labs/agent-skills) | `063bee9` (28/08/2026) | MIT (README) | a skill `web-design-guidelines` **não** se copiou: vai buscar as regras a um endereço cada vez que corre. Em vez disso guardou-se a cópia das regras, abaixo |
| [`vercel-labs/web-interface-guidelines`](https://github.com/vercel-labs/web-interface-guidelines) | `e3d624b` (17/08/2026) | MIT (`vercel/LICENSE`) | `command.md` → `vercel/web-interface-guidelines.md` |
| [`owl-listener/designer-skills`](https://github.com/owl-listener/designer-skills) | `9a6930c` (05/09/2026) | MIT (`designer-skills/LICENSE`) | 36 das 111 skills, nas pastas `designer-skills/<colecção>/` |

## Porque é que a regra da Vercel ficou copiada e não ligada

A `web-design-guidelines` manda ir buscar as regras a
`raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md`
**cada vez que corre**: o que a sessão obedece pode mudar sem ninguém ver, e é
uma porta para instruções de fora. Fica a cópia datada; para a actualizar,
compara-se com a versão nova e regista-se a data aqui.

## O que ficou de fora, e porquê

| De | Ficou de fora | Porquê |
|---|---|---|
| `anthropics/skills` | `canvas-design`, `algorithmic-art`, `theme-factory`, `slack-gif-creator` | arte e apresentações, não desenho de produto |
| `anthropics/skills` | `brand-guidelines` | é a marca da Anthropic |
| `anthropics/skills` | `web-artifacts-builder`, `webapp-testing` | trazem programas; servem quando houver código (ADR-0001) — `webapp-testing` é candidata nessa altura |
| `anthropics/skills` | `mcp-builder` | não é design, mas é **candidata forte** para o MCP do Lumavo (D-9) quando houver código |
| `vercel-labs/agent-skills` | `react-best-practices`, `composition-patterns`, `react-view-transitions`, `react-native-skills` | regras de código React; candidatas quando houver código |
| `vercel-labs/agent-skills` | `writing-guidelines` | manual de escrita da Vercel, em inglês; o Lumavo tem as suas regras de escrita |
| `vercel-labs/agent-skills` | `vercel-optimize`, `deploy-to-vercel`, `vercel-cli-with-tokens` | operação na Vercel; o alojamento está por decidir (D-3) |
| `owl-listener/designer-skills` | 75 das 111 | repetem as escolhidas (as «leis» de Fitts, Hick, Miller…, as críticas visuais) ou servem equipas de design grandes (operações, liderança, apresentações). As 111 continuam no repositório de origem |
| `owl-listener/designer-skills` | os comandos (`/plugin`) e os scripts do repositório | ferramentas do próprio repositório, não do design |

## Verificado

- Procurei nos 41 ficheiros copiados pedidos à rede (`http`, `curl`, `fetch`,
  `npx`, `pip install`) e instruções escondidas («ignore previous», «system
  prompt»): só aparecem um nome de atributo HTML (`fetchpriority`) e a palavra
  «fetch» como exemplo numa máquina de estados. Nada que corra.
- Nenhum dos ficheiros copiados se chama `SKILL.md`.
