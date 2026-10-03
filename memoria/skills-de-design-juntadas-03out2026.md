# As skills de design juntadas numa só: `lumavo-design` (03/10/2026)

**Pedido do Diogo (03/10/2026):** *«https://github.com/travisvn/awesome-claude-skills
https://github.com/vercel-labs/agent-skills/ https://github.com/owl-listener/designer-skills
Junta estas skills para o design do lumavo»*

## O que se fez

- Uma skill nova, **`.claude/skills/lumavo-design/SKILL.md`**, em português, com
  as regras de design do Lumavo (três superfícies, tokens por comerciante,
  acessibilidade, PT/ES/EN, estados, ver antes de dizer feito, aspecto decidido
  por Bruno e Cila) e um índice por etapa.
- Dentro dela, **38 referências de terceiros** em `referencias/`, sem mudar o
  conteúdo, só o nome do ficheiro: 1 da Anthropic (`frontend-design`, Apache
  2.0), a lista de regras de interface da Vercel (MIT, cópia de 17/08/2026) e 36
  das 111 do `designer-skills` (MIT). Origem, commits, licenças e o que ficou de
  fora em `referencias/ORIGEM.md`.

## Porque uma skill só e não 38

Cada skill solta aparece em todas as sessões (nome e descrição) e ocupa
contexto — o que já esgotou créditos nos sistemas actuais (15/09 e 29/09/2026).
Com uma skill e referências, a sessão carrega **uma** entrada e lê só o ficheiro
da etapa. É também a regra de 15/09/2026 nos sistemas actuais: não importar
colecções de skills em bloco (`repos-de-skills-de-marketing-15set2026.md`,
repo `claude`).

## Decisões tomadas por mim (dizê-las, para se poderem desfazer)

- **A skill da Vercel não foi copiada**: ia buscar as regras a um endereço a cada
  utilização. Ficou a cópia datada das regras (`e3d624b`).
- **Ficaram de fora** as que trazem programas (`web-artifacts-builder`,
  `webapp-testing`) e as de código React — candidatas quando houver código
  (ADR-0001) — e a `mcp-builder`, que não é design mas é candidata forte para o
  MCP (D-9).
- **75 das 111 do `designer-skills` ficaram de fora** por repetirem as
  escolhidas ou servirem equipas grandes. A lista exacta está em `ORIGEM.md`.
- O `awesome-claude-skills` é **uma lista de ligações**, sem skills nem ficheiro
  de licença: só serviu para chegar às da Anthropic.

## Verificado

- Os 38 caminhos citados na `SKILL.md` existem (comprovado por script).
- Nos 41 ficheiros copiados não há pedidos à rede nem instruções escondidas
  (procura por `http`, `curl`, `fetch`, `npx`, `pip install`, «ignore previous»,
  «system prompt»).

## O que ficou por verificar

- **Não se usou nenhuma** destas referências num ecrã real — ainda não há ecrãs.
- A qualidade das 36 do `designer-skills`: li uma por inteiro (`design-token`) e
  as outras pelo nome e pela descrição. São textos curtos e genéricos (os 36
  somam ~80 KB).
- A norma de acessibilidade exacta que a EAA exige ao comércio electrónico
  (EN 301 549 / WCAG) está marcada **C** na skill.
