# ADR-0008 · O Eurolify é desenvolvido pelo Diogo e pelo Bruno, com Claude Code e Codex

- **Estado:** aceite · a revisão do código ficou decidida no
  [ADR-0013](0013-revisao-do-codigo.md)
- **Data:** 03/10/2026
- **Quem decidiu:** Diogo
- **Decisão em aberto de origem:** D-13 (`docs/06-decisoes-em-aberto.md`)

## Contexto

A estimativa da Fase 1 (`docs/10-estimativa-prazo-e-custo.md`, 03/10/2026)
pôs três cenários de equipa: **A** — só o Diogo e o Bruno com Claude Code;
**B** — 2 programadores sénior contratados (16 a 30 meses, ≈ 173.000–465.000 €);
**C** — 3 sénior (12 a 23 meses, ≈ 193.000–519.000 €). *(04/10/2026, com a
decisão AD, ADR-0022, e o alojamento da construção na OVH: B 18 a 34 meses,
≈ 187.000–506.000 €; C 13 a 25 meses, ≈ 208.000–565.000 €.)* A recomendação era a B,
com o primeiro contratado como líder técnico.

Resposta do Diogo a 03/10/2026: *«SERÁ EU E O BRUNO A DESENVOLVER COM O CLAUDE
CODE E CODEX»*.

## Decisão

A Fase 1 é desenvolvida **pelo Diogo e pelo Bruno**, com **Claude Code**
(Anthropic) e **Codex** (OpenAI). Não se contratam programadores. A
recomendação B não foi seguida; a discordância ficou escrita uma vez em
`docs/10` §5.

## Consequências

- **Prazo** (`docs/10` §9, pedido do Diogo a 03/10/2026; hipótese **C**: cada
  um rende como um programador sénior com IA): Fase 1 em **15 a 29 meses** os
  dois a tempo inteiro, **28 a 52** cada um a meio tempo; até ao fim da Fase 3,
  ≈ 38 a 70 meses ou ≈ 64 a 118. *(04/10/2026: com as três peças que a decisão
  AD, ADR-0022, passou para a Fase 1, a Fase 1 é 17 a 32 e 31 a 58 meses; o
  total até ao fim da Fase 3 não muda.)* Corrige-se às 8 semanas (`docs/10` §6).
- **Custo:** as subscrições (Claude Max US$ 200/mês por pessoa; o Codex vem com
  os planos do ChatGPT — Plus US$ 20, Pro desde US$ 100, Business US$ 20–25 por
  utilizador, página oficial a 03/10/2026, **W**), os serviços externos com
  preço (≈ 14.000–33.000 €, `docs/10` §5; ≈ 12.000–29.000 € desde 04/10/2026,
  com o alojamento na OVH) e os orçamentos a pedir
  (contabilista, jurista, seguro). **O tempo do Diogo e do Bruno não está
  contado.**
- **O Codex não lê o `CLAUDE.md` nem `.claude/skills`.** Lê o `AGENTS.md` (até
  32 KiB por omissão) e as skills em `.agents/skills` (documentação oficial,
  [AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md) e
  [skills](https://learn.chatgpt.com/docs/build-skills), 03/10/2026, **W**).
  Sem ajuste, **o Codex trabalha sem as regras deste repositório** — incluindo
  o ADR-0001 e as regras da UE. ✅ **Decidido a 03/10/2026:** as regras
  passam para o `AGENTS.md`, que o `CLAUDE.md` importa, e as skills para
  `.agents/skills`, com ligações em `.claude/skills` (ADR-0010).
- **Dados na UE (regra 4 do `CLAUDE.md`, hoje no `AGENTS.md` — ADR-0010):** a Anthropic e a OpenAI são empresas
  de fora da UE. Os dois agentes trabalham com código e dados de ensaio
  inventados; **dados pessoais reais nunca entram numa sessão de nenhum dos
  dois** sem a decisão escrita e o acordo de transferência da regra 4.
- **O ADR-0005 vale para os dois agentes:** publica-se só pelo GitHub; o MCP da
  Scaleway, se o Codex o usar, também é só de leitura.
- **Quem revê:** sem programador contratado, ninguém revê por ofício o que
  entra no `main`. ✅ **Decidido a 03/10/2026 pelo Diogo** (ADR-0013), tal
  como estava proposto: o que um escreve, o outro revê antes
  de entrar; e o agente que não escreveu revê o diff (o Codex revê o que o
  Claude escreveu e o contrário). Os testes de isolamento entre inquilinos e o
  teste de intrusão externo antes do primeiro comerciante de fora continuam
  obrigatórios (`docs/05`, `docs/10` §5).
- **Não é o OK para código** (ADR-0001).

## O que ficou por verificar

- Os limites de uso do Codex em cada plano do ChatGPT e qual plano o Diogo e o
  Bruno vão usar.
- Se o Codex segue ligações simbólicas nas pastas de skills, e se o Claude
  Code as segue em `.claude/skills` — as duas documentações dizem que sim
  (03/10/2026, ADR-0010); falta ver numa sessão de cada um.
- A velocidade real do Diogo e do Bruno — às 8 semanas.
