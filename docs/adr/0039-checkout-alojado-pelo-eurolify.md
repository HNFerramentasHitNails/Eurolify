# ADR-0039 · O checkout é alojado pelo Eurolify

- **Estado:** aceite · uma API de checkout para frontends próprios só na Fase 3, com verificação
- **Data:** 06/10/2026
- **Quem decidiu:** Diogo
- **Decisão em aberto de origem:** D-7 (`docs/06-decisoes-em-aberto.md`)

## Contexto

- O `AGENTS.md` («Uma regra, um sítio») já diz que os momentos legais —
  checkout, confirmação, livre resolução, documento fiscal — são servidos pelo
  Eurolify. A D-7 recomendava o checkout alojado desde 03/10/2026, sem
  confirmação escrita.
- Os frontends dos comerciantes podem ser gerados por IA (Lovable, Bolt,
  Vercel, Emergent).

## Opções consideradas

| Opção | A favor | Contra |
|---|---|---|
| **a) Alojado pelo Eurolify**, com o aspecto e no domínio da loja | IVA, condições, livre resolução e confirmação num sítio só, testado | menos liberdade de desenho para o frontend |
| b) Cada frontend faz o seu, pela API | liberdade total | cada frontend pode errar um momento legal; a regra fica em vários sítios |

## Decisão

Diogo, 06/10/2026: *«sim, concordo, fica a a)»*.

1. O checkout é servido pelo Eurolify, com o tema da loja e no domínio dela;
   o frontend leva o cliente até ele com o carrinho.
2. Lá vivem o preço total e o IVA, a aceitação das condições, a informação e
   o botão de livre resolução, o pagamento e a confirmação (skills
   `consumer-rights-eu`, `eu-vat-oss-ioss`, `payments-psd2-sca`,
   `eu-gdpr-privacy`).
3. Uma API de checkout para frontends próprios só na Fase 3, com verificação.

## Consequências

- O desenho do checkout segue a skill `eurolify-design` (checkout alojado e
  momentos legais) e o kit de tema por comerciante.
- O domínio da loja no checkout precisa de certificados por comerciante:
  por desenhar.
