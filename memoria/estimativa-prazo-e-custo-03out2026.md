# Estimativa de prazo e custo da Fase 1 — D-13 (03/10/2026)

**Pedido do Diogo (03/10/2026):** *«faz a estimativa de prazo e custo»*.

## O que se fez

- `docs/10-estimativa-prazo-e-custo.md`: a Fase 1 partida em 17 peças com
  esforço em pessoas-semana, três cenários de equipa, custo por pessoa com
  fonte, serviços externos, como se corrige às 8 semanas, recomendação e a
  ligação à D-14 (custo fixo por mês e exemplo de ponto de equilíbrio).
- D-13 em `docs/06` passa a «estimada, falta escolher o cenário»; `docs/05`,
  `docs/00`, `docs/09` §5 e §7 e `README.md` actualizados.
- **Discordância dita uma vez:** fazer a Fase 1 só com o Diogo e o Bruno
  (cenário A) — o Lumavo é vendido com responsabilidade e precisa de quem
  reveja cada mudança. Recomendação: B (2 sénior, o 1.º líder técnico), medir
  às 8 semanas, decidir a 3.ª pessoa.
- ✅ **Decidido pelo Diogo a 03/10/2026: cenário A** — *«SERÁ EU E O BRUNO A
  DESENVOLVER COM O CLAUDE CODE E CODEX»* (ADR-0008, decisão O em `docs/06`).
  Registado em `docs/10`, `docs/06`, `docs/05`, `docs/00`, `docs/09` e no
  `CLAUDE.md` (quem trabalha aqui). O prazo mede-se às 8 semanas.
- **Achado ao registar:** o Codex **não lê o `CLAUDE.md` nem
  `.claude/skills`** — lê o `AGENTS.md` (até 32 KiB) e `.agents/skills`
  (documentação oficial, learn.chatgpt.com, 03/10/2026, **W**). Sem ajuste, o
  Codex trabalha sem as regras do repositório. **Por decidir** como ligar os
  dois a uma regra só; nada criado. O `CLAUDE.md` tem 9.336 bytes (cabe nos
  32 KiB).
- No ADR-0008 ficaram como consequência: dados pessoais reais nunca entram numa
  sessão de Claude Code ou de Codex (regra 4); o ADR-0005 vale para os dois
  agentes; a revisão cruzada fica como **proposta**.
  ✅ Decidida mais tarde a 03/10/2026 pelo Diogo (*«sim, fica assim»*,
  ADR-0013, decisão T): o código que um escreve, o outro revê, e o agente que
  não escreveu revê o diff; regra no `AGENTS.md`, secção Git.
- **Tempo por fases do cenário A** (pedido do Diogo: *«coloca só o tempo que
  eu e o Bruno usando a IA como o claude code e codex, por fases»*):
  `docs/10` §9. Hipótese **C**: cada um rende como um sénior com IA; duas
  dedicações (os dois a tempo inteiro, eficiência 90 %; cada um a meio tempo).
  Fases 2 e 3 estimadas peça a peça pela primeira vez (C).

## Números (com data e como se contaram)

> ⚠️ **04/10/2026:** a decisão AD (ADR-0022) passou três peças da Fase 2 para a
> Fase 1 (relatório OSS 2–4, núcleo das devoluções 4–7, lotes e compostos 3–5
> pessoas-semana, **C**, partidas das peças da Fase 2 de onde vieram). Os
> números dos cenários A, B e C abaixo foram corrigidos onde estão. No mesmo
> dia, o alojamento da construção e o custo fixo por mês depois de abrir
> passaram a ser contados na VPS da OVH.

- Esforço da Fase 1: **104,5–178 pessoas-semana**, **≈ 120–231** com imprevistos
  (+15 % / +30 %) — corrigido a 11/10/2026 com as peças 21 e 22 da decisão DS
  e, no mesmo dia, com as sete filas da 21 (decisão DV): 21 em 2,5–5 (era
  2–4), 22 em 1–2; antes, 104–177 e ≈ 120–230; antes das duas, 101–171 e ≈ 116–222; corrigido a 04/10/2026 com a
  decisão AD; eram 92–155 e ≈ 106–202. Julgamento meu, peça a peça — **C**, sem medição.
- Conversão (**C**): 44 semanas produtivas por pessoa e ano; 2 pessoas rendem
  90 %, 3 rendem 80 %.
- Custo de uma pessoa: 45.000–65.000 € brutos/ano (**W**, resumos de guias
  2026) × 1,27 (TSU 23,75 % **W** + 3 % **C**) = 57.150–82.550 €/ano.
- B (2 sénior): 17,6–33,7 meses; ≈ 187.000–506.000 €. C (3 sénior):
  13,2–25,3 meses; ≈ 208.000–565.000 €. A conta está escrita no docs/10 §2–§4.
  *Corrigido a 04/10/2026 com a decisão AD: eram B 16,0–30,5 meses e
  ≈ 173.000–465.000 €, C 12,0–22,9 meses e ≈ 193.000–519.000 €.*
- Externos com preço: teste de intrusão 5.950–8.500 € cada (Budget Security,
  20/07/2026); acessibilidade 5.000–10.000 € (fonte fraca); marca UE 3 classes
  1.050 €; alojamento na construção 2.000–5.000 € (**C**). *Corrigido a
  04/10/2026 para a VPS da OVH: ≈ 120–1.360 € conforme o cenário (conta no
  `docs/10` §5); os serviços externos passam de ≈ 14.000–33.000 € a
  ≈ 12.000–29.000 €, e os totais de B e C a ≈ 187.000–506.000 € e
  ≈ 208.000–565.000 € (com a decisão AD eram ≈ 189.000–510.000 € e
  ≈ 210.000–569.000 €).*
- Custo fixo/mês depois de abrir: B ≈ 10.150–14.870 €, C ≈ 15.110–21.950 € (corrigido a 03/10/2026: o alojamento passou a ≈ 234–710 €, ver `alojamento-e-custos-03out2026.md`).
  A 100 €/mês de margem média por comerciante (hipótese): B ≈ 100–150
  comerciantes, C ≈ 150–220. *Corrigido a 04/10/2026 com a VPS da OVH
  (alojamento ≈ 18–70 €/mês, `docs/10` §8): B ≈ 9.950–14.230 €, C
  ≈ 14.910–21.310 €; ≈ 100–140 e ≈ 150–210 comerciantes; no cenário A sai
  ≈ 18–70 € + US$ 444–804 por mês.* *Corrigido no mesmo dia com o GitHub Pro
  (US$ 4/mês, ADR-0024): o mínimo do B era ≈ 9.940 € e o A era US$ 440–800; na
  construção soma ≈ 70–135 € no B e ≈ 53–101 € no C, sem mexer nos totais ao
  milhar (`docs/10` §3, §4 e §8).*
- Referência medida no Hub interno (contado a 03/10/2026 no clone do `main`):
  1.ª migração 18/11/2025; 1.643 migrações; 229 pastas de funções (sem `_`);
  635.339 linhas TS/TSX em `src` e `supabase/functions`, das quais 67.268 no
  `types.ts` gerado ⇒ ≈ 568 mil sem ele (`wc -l`).
- Tempo do A (meses; tempo inteiro / meio tempo): Fase 0 1–3 / 1,5–3;
  Fase 1 18–33 / 32–60 (+3 do critério); Fase 2 7–15 / 13–26 (+3); Fase 3
  7–14 / 12–25; até ao fim da Fase 3 ≈ 39–71 / 65–120 (11/10/2026, com as
  peças 21 e 22 e as sete filas da 21, DV; com quatro filas 17–33 / 31–60 e
  38–71 / 64–120; antes das duas 17–32 / 31–58 e 38–70 / 64–118). Esforço: F1 116–221 (era 115–220; antes, 112–212)
  pessoas-semana com imprevistos e sem o desenho final, F2 43–74 (49–96 com
  imprevistos), F3 40–69 (46–90). *Corrigido a 04/10/2026 com a decisão AD:
  eram F1 15–29 / 28–52 (101–192) e F2 9–18 / 16–32 (52–90, 60–117); o total
  não mudou porque o trabalho mudou de fase.* Conta: meses = esforço ÷ 6,6
  (dois a tempo inteiro: 2 × 90 % × 44/12) ou ÷ 3,67 (meio tempo cada),
  arredondado ao mês.
- SIFIDE II: 32,5 % de base + 50 % incremental; vigora até 31/12/2026 (**W**,
  resumo).

## O que ficou por verificar

- O esforço por peça — a maior incerteza; corrige-se às 8 semanas (docs/10 §6).
- Salários: guias Hays e Michael Page 2026 não lidos; o PDF de TI da Michael
  Page descarregado não tem ano nem programadores (não usado).
- Seguro de acidentes de trabalho e subsídio de refeição (3 %); se o bruto
  anual inclui 14 meses; tempo de contratação (1–3 meses, **C**).
- Página da EUIPO deu 403; câmbio do dólar não aplicado (1 US$ = 1 €).
- Contabilista, jurista, seguro, recrutamento e suporte: sem número —
  orçamentos a pedir.
- Se o SIFIDE II é renovado para 2027.
- Limites de uso do Codex por plano; se o Codex e o Claude Code seguem ligações
  simbólicas nas pastas de skills.
