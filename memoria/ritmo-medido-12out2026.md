# Ritmo medido da Fase 1 — medição provisória (12/10/2026)

Pedido do Diogo, 12/10/2026: *«sim, corrige já o docs/10 com esta medição»*
(#390). A medição completa está em `docs/10` §6.1.

## O que se fez

- `docs/10` §6.1: o avanço de cada peça da Fase 1 a partir do desenho e do
  código, com a previsão revista. O §1, o §9 e a lista do que ficou por
  verificar passaram a apontar para ela; os números da hipótese ficam como
  registo.
- Uma nota no `docs/05` (linha da D-13) e no `docs/31`, onde a estimativa está
  citada. O ADR-0008 e o ADR-0043 guardam os números da data deles e não se
  reescrevem.

## Números (com data e como se contaram)

- 12/10/2026, no `main`: 338 commits entre 04/10 e 12/10, contados com
  `git log --date=short`, por dia; 69 migrações; 109 ficheiros `*.test.ts`.
- Avanço da Fase 1: ≈ 42 de ≈ 135 pessoas-semana (ponto médio do §2, sem a
  peça 1 e sem imprevistos), ≈ 31 %. **C**: é o meu julgamento peça a peça.
- O ritmo: ≈ 32 pessoas-semana estimadas por semana de calendário, mais de
  10 vezes a hipótese 1 do §9 (**C**).
- A previsão (**C**): o código da Fase 1 completo entre dezembro de 2026 e
  fevereiro de 2027, contando o que falta 3 a 4 vezes mais devagar; a Fase 1
  passada entre junho e setembro de 2027.

## Decisão no mesmo dia (EC, ADR-0045)

O Diogo decidiu tratar o contabilista, o jurista e o seguro **no fim do
desenvolvimento** e usar sempre o repositório `eur-lex` como fonte das regras.
O §6.1 passou a dizer que o primeiro comerciante de fora vem depois das
validações, cujo prazo não está estimado. No mesmo dia: os 3 meses de vendas
do critério da Fase 1 contam **só com a loja piloto do grupo** (*«só com a
loja piloto do grupo»*), por isso a Fase 1 passada (junho a setembro de 2027,
**C**) não depende das validações.

## O que ficou por verificar

- As horas e a dedicação de cada um. Os commits vêm todos da conta
  partilhada, por isso não se separa o trabalho do Diogo do do Bruno.
- Se as «partes 1» já cobrem os casos difíceis de cada domínio.
- O abrandamento de 3 a 4 vezes é uma hipótese.
- A medição das 8 semanas (≈ 29/11/2026) refaz tudo isto.
