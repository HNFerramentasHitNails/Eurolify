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
- **Não decidido:** o cenário de equipa.

## Números (com data e como se contaram)

- Esforço da Fase 1: **92–155 pessoas-semana**, **≈ 106–202** com imprevistos
  (+15 % / +30 %). Julgamento meu, peça a peça — **C**, sem medição.
- Conversão (**C**): 44 semanas produtivas por pessoa e ano; 2 pessoas rendem
  90 %, 3 rendem 80 %.
- Custo de uma pessoa: 45.000–65.000 € brutos/ano (**W**, resumos de guias
  2026) × 1,27 (TSU 23,75 % **W** + 3 % **C**) = 57.150–82.550 €/ano.
- B (2 sénior): 16,0–30,5 meses; ≈ 173.000–465.000 €. C (3 sénior):
  12,0–22,9 meses; ≈ 193.000–519.000 €. A conta está escrita no docs/10 §2–§4.
- Externos com preço: teste de intrusão 5.950–8.500 € cada (Budget Security,
  20/07/2026); acessibilidade 5.000–10.000 € (fonte fraca); marca UE 3 classes
  1.050 €; alojamento na construção 2.000–5.000 € (**C**).
- Custo fixo/mês depois de abrir: B ≈ 10.150–14.840 €, C ≈ 15.110–21.920 €.
  A 100 €/mês de margem média por comerciante (hipótese): B ≈ 100–150
  comerciantes, C ≈ 150–220.
- Referência medida no Hub interno (contado a 03/10/2026 no clone do `main`):
  1.ª migração 18/11/2025; 1.643 migrações; 229 pastas de funções (sem `_`);
  635.339 linhas TS/TSX em `src` e `supabase/functions`, das quais 67.268 no
  `types.ts` gerado ⇒ ≈ 568 mil sem ele (`wc -l`).
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
