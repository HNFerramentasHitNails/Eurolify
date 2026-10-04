# ADR-0022 · Três peças da Fase 2 passam para a Fase 1

- **Estado:** aceite
- **Data:** 04/10/2026
- **Quem decidiu:** Diogo (*«sim, passa as três para a Fase 1»*)
- **Decisão em aberto de origem:** as três propostas de
  `docs/13-portas-da-fase-2.md` (os módulos da Fase 2 pelas 8 portas)

## Contexto

A 03/10/2026, os módulos da Fase 2 passaram pelas 8 portas da skill
`platform-architect` (`docs/13-portas-da-fase-2.md`). Três peças mostraram que
não são módulos, mas núcleo de que a Fase 1 precisa:

1. **Relatório OSS com os quatro baldes.** O Eurolify vende para toda a UE
   desde a Fase 1 (decisão F); um comerciante que vende a consumidores de
   outros países precisa do relatório no primeiro período. Nos sistemas
   actuais ia-se declarar 1.346 € de IVA português no impresso errado
   (10/08/2026, lição 2.8 de `docs/04`).
2. **Devolução → estado do artigo → reembolso → nota de crédito.** O botão de
   livre resolução já está na Fase 1, mas as «devoluções completas» ficavam
   fora; o reembolso tem de se seguir (14 dias, **C** na skill
   `consumer-rights-eu`). Nos sistemas actuais: 91 notas de crédito em 90
   dias e 0 devoluções registadas (15/09/2026, lição 3.5).
3. **Lotes na linha expedida e compostos.** É o que permite uma recolha; nos
   sistemas actuais, os componentes dos kits — 40 % das saídas — saíam sem
   lote (lição 3.4; skill `product-compliance-eu`).

Nenhum comerciante foi ouvido: as portas 3 e 4 ficaram «não se sabe» em todos
os módulos (`docs/13`).

## Opções consideradas

| Opção | A favor | Contra |
|---|---|---|
| Deixar as três na Fase 2 | A Fase 1 não cresce | Comerciantes da Fase 1 sem relatório OSS, sem fluxo depois do botão de livre resolução e sem lote para recolhas |
| **Passar as três para a Fase 1** | Fecha as três falhas antes do primeiro comerciante de fora | A Fase 1 cresce, e a estimativa ainda não o conta |

## Decisão

**O relatório OSS com os quatro baldes, o fluxo devolução → estado do
artigo → reembolso → nota de crédito, e os lotes na linha expedida com os
compostos passam para a Fase 1.** Ficam na Fase 2: a troca e a carteira (a
carteira só depois de o contabilista validar), os vários armazéns, a
separação e os inventários, e as ligações ao software de faturação dos
comerciantes estabelecidos noutros países. O relatório OSS entra em todos os
planos.

Não é o OK para código (ADR-0001).

## Consequências

- **A Fase 1 cresce, e a estimativa não o conta.** Os números do
  `docs/10-estimativa-prazo-e-custo.md` (Fase 1: 92–155 pessoas-semana, 15 a
  29 meses os dois a tempo inteiro) e do ADR-0008 são **sem estas três
  peças**; as peças entram no `docs/10` como «por estimar». A Fase 2 encolhe
  na mesma medida, também por estimar.
  *Actualização de 04/10/2026, a pedido do Diogo:* estimadas no `docs/10`
  (**C**) — relatório OSS 2–4, núcleo das devoluções 4–7, lotes e compostos
  3–5 pessoas-semana. A Fase 1 passa a 17 a 32 meses os dois a tempo inteiro
  (31 a 58 a meio tempo), a Fase 2 a 7 a 15 (13 a 26); o total até ao fim da
  Fase 3 fica em ≈ 38 a 70 meses.
- O critério de passagem da Fase 1 já pedia o botão de livre resolução
  «tratado de ponta a ponta»; com esta decisão, ponta a ponta inclui o
  reembolso e a nota de crédito.
- O relatório OSS sai do plano Europa e entra em todos (`docs/09`).
- A troca e a carteira continuam a precisar da validação do contabilista
  (`eu-vat-oss-ioss`).

## O que ficou por verificar

- ~~Quanto custam as três peças e quanto tiram à Fase 2: **não estimado**.~~
  Estimado a 04/10/2026 (ver acima), por julgamento (**C**).
- Se os softwares de faturação dos comerciantes já dão o relatório OSS com os
  quatro baldes.
- O prazo legal do reembolso continua **C**.
