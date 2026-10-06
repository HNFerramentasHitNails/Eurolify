# ADR-0037 · As faturas emitem-se pelo software certificado de cada país

- **Estado:** aceite · revê-se com números de clientes (opção b)
- **Data:** 06/10/2026
- **Quem decidiu:** Diogo
- **Decisão em aberto de origem:** D-4 (`docs/06-decisoes-em-aberto.md`)

## Contexto

- A recomendação estava no `docs/06` (D-4) e na proposta (`docs/00`, «O que
  recomendo»: *«Não emitir faturas com software próprio no início»*) desde
  03/10/2026, sem confirmação escrita.
- O Hub interno da empresa já emite pelo Moloni (`docs/00`).

## Opções consideradas

| Opção | O que quer dizer |
|---|---|
| **a) Adaptadores a software certificado de cada país** | Em Portugal o Moloni (e outros); em Espanha um software Verifactu; em França uma Plateforme Agréée. O Eurolify decide o IVA e guarda a prova; o documento legal é do software certificado |
| b) Certificar o próprio Eurolify | Controlo total; custo, prazo e responsabilidade legal por país |

## Decisão

Diogo, 06/10/2026: *«sim, concordo, fica a a)»*.

1. Nas Fases 1 a 3, o documento fiscal é emitido pelo software certificado
   do comerciante, ligado ao Eurolify por um adaptador (`docs/08`, skill
   `third-party-extensions`).
2. O Eurolify decide o IVA (skill `eu-vat-oss-ioss`) e guarda **o documento
   emitido como prova** — a prova é o documento, nunca o nosso registo
   (`AGENTS.md`, «Não se erra em documentos fiscais», 4).
3. A b) reavalia-se com números de clientes.

## Consequências

- Cada país de faturação tem o seu adaptador, com calendário próprio e a
  regra validada pelo contabilista desse país (`docs/06`, D-6).
- Não decide a D-10 (um cliente com sistema de gestão próprio).
