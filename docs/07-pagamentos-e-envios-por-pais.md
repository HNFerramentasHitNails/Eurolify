# Pagamentos e envios na UE — o que se usa e com quem fazer parcerias

> **Versão de 03/10/2026.** Pedido do Diogo: *«Para os pagamentos e para os
> envios, lista os mais usados dentro da europa ou de cada pais da UE, para que
> possamos depois abrir parcerias.»*
>
> Cada linha diz **de onde veio** e com que certeza, como em
> `03-regulamentar-ue.md`: **W** = pesquisa web a 03/10/2026 (lido o resumo ou
> a página; relatórios pagos não lidos por inteiro); **M** = memória de trabalho
> dos sistemas actuais; **C** = conhecimento prévio, **não verificado**.
>
> ⚠️ Regra 4 do `CLAUDE.md` (dados na UE): um parceiro com empresa-mãe fora da
> UE que receba dados pessoais só entra com decisão escrita do Diogo ou do
> Bruno e o acordo de transferência. Está assinalado em cada um.

## 1. Parceiros que cobrem vários países — os primeiros a contactar

### 1.1 Pagamentos

| Parceiro | Entidade na UE | O que cobre (métodos europeus) | Verif. | Nota |
|---|---|---|---|---|
| **Mollie** | Países Baixos (**C**) | iDEAL \| Wero, Wero, Bancontact, BLIK, Przelewy24, EPS, MB Way, Multibanco, Bizum, Satispay, Swish, MobilePay, Vipps, Cartes Bancaires, PostePay, BANCOMAT Pay, Klarna, PayPal, Apple Pay, Google Pay, débito directo SEPA; não lista Trustly | **W** ([mollie.com/payments](https://www.mollie.com/payments)) | Empresa europeia; cobre os métodos de PT, ES, NL, BE, PL, AT, IT e dos nórdicos numa só ligação |
| **Adyen** | Países Baixos (**C**) | Métodos locais de toda a UE (guia por país) | **W** parcial ([guia](https://www.adyen.com/payment-methods-guides/europe), página sem data e com números antigos) | Empresa europeia; lista actual de métodos **não verificada** |
| **Stripe** | Stripe Payments Europe Ltd, **Irlanda** (**W**, [Stripe](https://support.stripe.com/questions/stripe-service-provider-in-ireland)) | Bancontact, BLIK, EPS, iDEAL \| Wero, Przelewy24, Multibanco, MB WAY, Satispay, MobilePay, Revolut Pay, Cartes Bancaires, SEPA, Klarna, PayPal; Swish só por convite; **Bizum não aparece** | **W** ([docs.stripe.com](https://docs.stripe.com/payments/payment-methods/overview)) | ⚠️ Empresa-mãe norte-americana ⇒ regra 4 |
| **EuPago** | Portugal (**M**) | MB WAY, Multibanco, cartão, Floa | **M** (`academy-piloto-eupago-desenho-29set2026.md`) | Escolhida para a plataforma de formação a 29/09/2026 |
| **PayPal** | PayPal (Europe) S.à r.l. et Cie, S.C.A., **Luxemburgo**, banco supervisionado pela CSSF (**W**, [PayPal](https://www.paypal.com/lu/webapps/mpp/about)) | Carteira PayPal | **W** | ⚠️ Empresa-mãe norte-americana ⇒ regra 4. Na Alemanha é o meio mais usado (ver §2) |
| **Klarna** | Suécia (**C**) | Pagar depois, prestações | **C** | 58 pagamentos e 28.305 € em 90 dias na plataforma de formação (29/09/2026, **M**) |
| **Wero (EPI)** | Bélgica (**C**) | Pagamento conta-a-conta dos bancos europeus. Comércio electrónico na Alemanha desde nov/2025; França e Bélgica desde jan/2026; Luxemburgo e Países Baixos em 2026; o iDEAL passa a Wero entre 2026 e 2027; o Payconiq acaba a 30/09/2026; ~58 milhões de utilizadores (set/2026) | **W** ([Wero](https://wero-wallet.eu/news/wero-ecommerce-germany), [EPI](https://epicompany.eu/media-insights/successful-first-phase-marks-major-next-steps-in-ideal-to-wero-migration/), [Chronicle.lu](https://www.chronicle.lu/category/banking/63148-payconiq-payment-system-officially-transitions-to-wero-platform-in-luxembourg)) | Não se contrata directamente: chega pelo prestador (a Mollie e a Stripe já o listam; a Nexi integrou-o na Alemanha a 28/04/2026, [Nexi](https://www.nexigroup.com/content/dam/corp/downloads/media/press-release/2026/2026-04-28-pr-nexi-implements-Wero-for-ecommerce-in-germany.pdf)) |

**Leitura (opinião):** a D-5 recomendava EuPago e Stripe. Com a regra 4, a
**Mollie** cobre a mesma lista — incluindo MB WAY, Multibanco e Bizum — sendo
europeia. Fica para decidir na D-5; a sede da Mollie e da Adyen ainda não foi
confirmada numa fonte.

### 1.2 Envios — redes que cobrem vários países

Pontos fora de casa (pontos de recolha + cacifos) por rede na Europa, **fim de
2024** (Last Mile Experts, *Out-of-Home Delivery in Europe 2025*, versão de
apresentação, [PDF](https://lastmileexperts.com/wp-content/uploads/2025/06/OOH-REPORT-2025-TEASER.pdf), **W**):

| Rede | Pontos de recolha | Cacifos | Total | Dono | Nota |
|---|---|---|---|---|---|
| **DHL / Deutsche Post** | 135.620 | 55.410 | 191.030 | Alemanha (**C**) | Maior rede |
| **DPD (Geopost)** | 101.460 | 40.560 | 142.020 | Grupo La Poste, França (**C**) | |
| **GLS** | 107.410 | 28.660 | 136.070 | IDS, controlada pelo EP Group (Křetínský, Chéquia) desde 30/04/2025 (**W**, [CEP Research](https://www.cep-research.com/2025/05/02/czech-is-in-the-post-at-royal-mail-gls/)) | |
| **InPost** | 44.520 | 46.990 | 91.510 | Em compra por um consórcio FedEx + Advent (37 % cada), A&R 16 %, PPF 10 %, €7,8 mil milhões; 80 % de aceitação a 18/09/2026 (**W**, [Baker McKenzie](https://www.bakermckenzie.com/en/newsroom/2026/02/fedex), resumo de pesquisa) | ⚠️ Passa a ter FedEx (EUA) no capital ⇒ regra 4 a ver |
| **UPS** | 74.070 | 12.780 | 86.850 | EUA (**C**) | ⚠️ regra 4 |

Os números são o que os operadores declaram, com pontos partilhados contados
mais do que uma vez (nota do próprio relatório).

**Plataformas que juntam várias transportadoras** (uma ligação, muitas
redes) — sedes por resumo de pesquisa a 03/10/2026 (**W**):

| Plataforma | Sede | Nota |
|---|---|---|
| **Sendcloud** | Eindhoven, Países Baixos | 160+ transportadoras na Europa (resumo de pesquisa) |
| **Packlink** | Madrid, Espanha | Empresa-mãe norte-americana (Auctane) — **C**, a confirmar |
| **Boxtal** | Paris, França | |
| **Eurosender** | Eslovénia e Reino Unido | Parcerias com DHL, DPD, GLS (resumo de pesquisa) |

## 2. País a país

*(a preencher com a pesquisa por país — ver abaixo)*

## O que ficou por verificar

- As sedes da Mollie, da Adyen, da Klarna e da EPI (escritas como **C**).
- A lista actual de métodos da Adyen e da EuPago.
- Os relatórios pagos (Last Mile Experts completo, Worldpay, PCMI) não foram
  lidos por inteiro: só versões de apresentação e resumos.
