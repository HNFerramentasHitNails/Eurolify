# ADR-0010 · As regras e as skills num sítio só, lido pelo Claude Code e pelo Codex

- **Estado:** aceite
- **Data:** 03/10/2026
- **Quem decidiu:** Diogo
- **Decisão em aberto de origem:** consequência do ADR-0008 (o Diogo e o Bruno desenvolvem com Claude Code e Codex)

## Contexto

Com o ADR-0008, o Eurolify passa a ser trabalhado por dois agentes. O Codex
**não lê o `CLAUDE.md`** nem `.claude/skills`: lê o `AGENTS.md` (até 32 KiB por
omissão) e as skills em `.agents/skills`
([AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md),
[skills](https://learn.chatgpt.com/docs/build-skills), 03/10/2026, **W**). Até
hoje, uma sessão de Codex trabalharia sem o ADR-0001, sem as regras da UE e sem
as regras fiscais.

## Opções consideradas

| Opção | A favor | Contra |
|---|---|---|
| **a) Um sítio só: `AGENTS.md`, importado pelo `CLAUDE.md`** | Uma regra escreve-se uma vez e os dois lêem-na | O `AGENTS.md` tem de caber em 32 KiB |
| b) Uma cópia do `CLAUDE.md` em `AGENTS.md` | Nada muda para o Claude Code | Dois sítios que vão divergir — o erro que as regras deste repositório evitam («uma regra, um sítio») |

Resposta do Diogo a 03/10/2026: *«a) um sítio só, AGENTS.md para os dois»*.

## Decisão

- **As regras vivem no `AGENTS.md`.** O `CLAUDE.md` tem só `@AGENTS.md` e uma
  nota a dizer que não se escrevem regras ali.
- **As 14 skills vivem em `.agents/skills/`.** Em `.claude/skills/` há uma
  ligação (symlink) por skill para lá. Skill nova = pasta nova em
  `.agents/skills/` + a ligação em `.claude/skills/`; nunca uma cópia.

## Porque funciona (documentação oficial, lida a 03/10/2026, **W**)

- **Claude Code:** um `CLAUDE.md` com `@AGENTS.md` inclui o `AGENTS.md` pela
  importação, e *«keeping the import never makes Claude read `AGENTS.md`
  twice»*; funciona também nas sessões que não lêem o `AGENTS.md` sozinhas
  ([memory](https://code.claude.com/docs/en/memory)). Cada entrada em
  `.claude/skills/` *«can be a symlink to a directory elsewhere on disk»*
  ([skills](https://code.claude.com/docs/en/skills)).
- **Codex:** *«Codex supports symlinked skill folders and follows the symlink
  target»* ([skills](https://learn.chatgpt.com/docs/build-skills)); procura
  skills em `.agents/skills` na raiz do repositório.

## Consequências

- O `AGENTS.md` tinha 10.248 bytes a 03/10/2026 — abaixo dos 32 KiB. Acima
  disso o Codex deixa de o ler até ao fim; a regra está escrita no próprio
  ficheiro.
- Os documentos e a skill `third-party-extensions` que diziam «regra 4 do
  `CLAUDE.md`» passaram a dizer `AGENTS.md`. As memórias datadas ficam como
  estavam.
- **O que pode partir:** um clone em Windows sem ligações simbólicas activas
  traz `.claude/skills/<nome>` como ficheiros de texto com o caminho, e o
  Claude Code deixa de ver as skills (conhecimento prévio, **C**). Em macOS e
  Linux as ligações funcionam. **O Bruno trabalha em macOS e o Diogo em
  Windows** (Diogo, 03/10/2026). O Git para Windows **não cria ligações por
  omissão**; activam-se com o Modo de Programador do Windows (Windows 10
  1703 ou mais recente) e clonando com `git clone -c core.symlinks=true <URL>`
  ([Git for Windows](https://gitforwindows.org/symbolic-links), lido a
  03/10/2026, **W**). O Codex não é afectado: lê `.agents/skills`, que são
  pastas a sério, e o `AGENTS.md`, que é um ficheiro a sério.
- Não é o OK para código (ADR-0001).

## O que ficou por verificar

- **Não vi numa sessão de Codex** que ele carrega o `AGENTS.md` e as 14
  skills; nem numa sessão nova de Claude Code que as skills chegam pelas
  ligações. O teste: abrir uma sessão de cada e perguntar «que regras e que
  skills tens deste repositório?».
- Se, no Windows do Diogo, o Claude Code vê as 14 skills depois de activar as ligações.
