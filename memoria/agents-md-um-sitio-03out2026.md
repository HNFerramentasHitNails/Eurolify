# As regras e as skills num sítio só para o Claude Code e o Codex (03/10/2026)

**Decisão do Diogo (03/10/2026):** *«a) um sítio só, AGENTS.md para os dois»*
— ADR-0010, decisão Q em `docs/06`.

## O que se fez

- `CLAUDE.md` → `AGENTS.md` (com `git mv`, o histórico segue o ficheiro). O
  `CLAUDE.md` novo tem só `@AGENTS.md` e uma nota.
- O `AGENTS.md` ganhou duas regras: regras novas só ali, abaixo de 32 KiB; e
  skill nova = pasta em `.agents/skills/` + ligação em `.claude/skills/`.
- `.claude/skills/*` → `.agents/skills/*` (14 pastas); em `.claude/skills/`
  ficou uma ligação simbólica por skill (`../../.agents/skills/<nome>`).
  Conferido: as 14 ligações abrem o `SKILL.md` de destino.
- Varrimento de «`CLAUDE.md`» fora da memória: passaram a `AGENTS.md` o
  README, o `docs/05`, o `docs/06` (linhas 11, 19, 21, 27 e a O), o `docs/07`
  (linha 12), o `docs/08` (linhas 36 e 93), o ADR-0008 e a skill
  `third-party-extensions`. Ficaram as referências ao `CLAUDE.md` **do Hub**
  e dos outros repositórios (são outros ficheiros).
- Apresentação: a página 52 deixou de dizer «por decidir».

## Números (com data e como se contaram)

- `AGENTS.md`: 10.248 bytes a 03/10/2026 (`wc -c`), contra o limite de 32 KiB
  do Codex.
- 14 skills em `.agents/skills`, 14 ligações em `.claude/skills` (`ls | wc -l`).

## O que ficou por verificar

- Uma sessão de **Codex** a ler o `AGENTS.md` e as 14 skills; uma sessão
  **nova** de Claude Code a ver as skills pelas ligações. Só a documentação
  oficial diz que funciona.
- Clones em Windows sem ligações simbólicas activas (**C**). **O Diogo
  trabalha em Windows e o Bruno em macOS** (Diogo, 03/10/2026). O Git para
  Windows não cria ligações por omissão; activam-se com o Modo de Programador
  e `git clone -c core.symlinks=true` (gitforwindows.org, 03/10/2026). Falta
  o Diogo confirmar no Windows dele que o Claude Code vê as 14 skills.
