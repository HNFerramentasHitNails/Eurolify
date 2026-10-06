# ADR-0038 · O Eurolify nunca recebe o dinheiro das vendas dos comerciantes

- **Estado:** aceite
- **Data:** 06/10/2026
- **Quem decidiu:** Diogo
- **Decisão em aberto de origem:** D-5 (`docs/06-decisoes-em-aberto.md`)

## Contexto

- A recomendação estava no `docs/06` (D-5) e na proposta (`docs/00`, «O que
  recomendo») desde 03/10/2026, sem confirmação escrita.
- Guardar fundos de terceiros exige licença de instituição de pagamento
  (skill `payments-psd2-sca`).

## Decisão

Diogo, 06/10/2026: *«sim, concordo, nunca recebe o dinheiro»*.

1. Cada comerciante liga a **sua** conta num prestador de pagamentos; o
   dinheiro vai do cliente para essa conta. O Eurolify recebe só os avisos do
   prestador e nunca guarda fundos de terceiros.
2. Primeiros prestadores: **EuPago** (MB WAY, Multibanco, cartão, Floa) e
   **Stripe** (cartão, Klarna, Apple Pay e Google Pay), com a régua «método →
   prestador → conta» numa tabela do servidor (`docs/06`, D-5).
3. Um marketplace, se um dia existir, só com o produto de plataformas do
   prestador (ex.: Stripe Connect, Mollie Connect), skill `marketplace-dsa`.
4. A mensalidade do Eurolify (ADR-0007) cobra-se à parte, nunca descontada
   das vendas.

## Consequências

- Os adaptadores de pagamento seguem a skill `payments-psd2-sca` e o contrato
  do `docs/08`; a prontidão de cada comerciante, a
  `eurolify-payment-readiness-eu`.
- A margem sobre pagamentos (A5, `docs/12`, linhas 147–156) continua pergunta para
  o jurista; esta decisão não a decide.
