# Pacote de eficiência (6 skills) instalado (04/10/2026)

Pedidos do Diogo, 04/10/2026: dois zips «Eurolify — Skills de Eficiência,
Modelos e Memória para Claude Code» (o segundo, versão 1.2 do pacote, sha256
começa por `caa8da830a313e3e`), com a ordem de auditar `memoria/` e `docs/` só
em leitura, propor um índice por tema e uma fonte por decisão, e depois
*«instala as skills do pacote no repositório»* e *«faz tudo por mim»*.

## O que se fez

- **Auditoria só de leitura** (`main` em `d64861d`) com o `audit_memory.py`
  do pacote: 80 ficheiros `.md` em `memoria/` e `docs/`, 666 105 bytes,
  **0 ficheiros iguais**; 1 parágrafo repetido (o aviso «passou para a VPS»
  em 3 memórias da Scaleway, de propósito). A duplicação real era a mesma
  decisão no ADR, no `docs/06` e numa memória, e já tinha divergido (a T, a
  AA e a AF do `docs/06` não diziam o que os ADR diziam).
- Daí três pedidos, cada um com o seu *issue*: o índice por tema e as 3
  linhas com mais de 300 caracteres (#52, *issue* #51); o `docs/06` com uma
  linha curta por ADR (#54, #53); um bloco de estado no topo das 4 memórias
  com mais de 10 KB (#56, #55).
- **Instaladas as 6 skills** em `.agents/skills/`, com a ligação em
  `.claude/skills/` (ADR-0010) e uma linha cada na tabela do `AGENTS.md`:
  `eurolify-session-continuity`, `eurolify-manager-communication`,
  `eurolify-efficient-workflow`, `eurolify-repository-memory`,
  `eurolify-fault-first-debugging`, `eurolify-evidence-before-done`. Cada uma
  tem um `ORIGEM.md` com as alterações: a ligação ao repositório no GitHub
  saiu (nome de uma marca existente), as memórias seguem o formato do
  `AGENTS.md`, a continuidade de sessão é a descrição do pedido e o *issue*
  (ADR-0031), e duas palavras passaram a português de Portugal.
- **Política de modelos, decisão do Diogo (04/10/2026):** Sonnet para a
  execução normal, Haiku para a pesquisa mecânica, Opus 5.5 para a análise e
  a revisão de risco; **o Fable não se usa**, nem como recurso; não se troca
  o Opus 5.5 em silêncio. Está na skill `eurolify-efficient-workflow`.
- **Instalados também, a pedido do Diogo** (*«instala também os agentes e o
  estilo de gestão»*): os 3 subagentes em `.claude/agents/`
  (`eurolify-scout`, Haiku, só leitura; `eurolify-builder`, Sonnet;
  `eurolify-critical-review`, `claude-opus-5-5`, só leitura) e o estilo
  `eurolify-gestao` em `.claude/output-styles/`. Só o Claude Code os lê; o
  Codex não. Ao estilo acrescentei que as regras de «Como responder» do
  `AGENTS.md` valem acima dele; os agentes ficaram como no pacote. O
  `eurolify-critical-review` **não substitui** a revisão por sessão nova do
  ADR-0030. O estilo **está ligado por omissão para os dois**, em
  `.claude/settings.json` (`"outputStyle": "eurolify-gestao"`, do
  `templates/settings-management.json` do pacote): decisão do Diogo
  (04/10/2026), *«Ligar para mim e para o bruno!»*, que substitui a anterior
  do mesmo dia (*«cada um liga o estilo quando quiser»*). Quem não o quiser
  numa sessão muda com `/output-style`.
- **Não instalado:** o texto proposto para o `AGENTS.md`
  (`templates/AGENTS-management-fragment.md`), por ser uma regra nova.

## Números (com data e como se contaram)

| O quê | Valor | Como |
|---|---|---|
| Carregado sempre por sessão | ≈ 17,2 KB automáticos (`CLAUDE.md` + `AGENTS.md`), 9 451 caracteres de descrições das 16 skills, 57,9 KB de leitura obrigatória (`README`, `docs/00`, `docs/06`, `MEMORY.md`) | `wc -c` e Python, 04/10/2026, antes dos pedidos acima; bytes, não tokens |
| `docs/06` com o #54 | 31 416 → 23 948 bytes | `wc -c` no ramo, 04/10/2026 |
| Testes do `audit_memory.py` | 7, a passar | `python3 test_audit_memory.py`, no zip e depois de instalado |
| `AGENTS.md` com as 6 linhas | 17 926 bytes (limite 32 KiB) | `wc -c`, 04/10/2026 |
| Modelo da sessão | `claude-opus-5-5` configurado e servido | `get_session`, 04/10/2026 |

## O que ficou por verificar

- **Nenhuma poupança medida.** Não se comparou a utilização nem a qualidade
  antes e depois; os números acima são bytes.
- Que o Sonnet e o Haiku respondem de facto nesta conta: aparecem como opção
  da ferramenta de agentes, não foram experimentados.
- As 6 skills apareceram na lista de skills da sessão do Claude Code logo a
  seguir a serem copiadas; **não se testou numa sessão de Codex**.
- Os subagentes e o estilo **não foram experimentados**: não se viu `/agents`
  nem `/output-style` com eles. Que o identificador `claude-opus-5-5` é aceite
  no campo `model` de um subagente não foi verificado.
- O resto do texto das skills ficou em português com o Acordo Ortográfico
  («atual», «arquitetura»); não foi reescrito.
