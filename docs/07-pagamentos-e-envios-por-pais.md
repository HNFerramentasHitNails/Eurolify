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
> ⚠️ Regra 4 do `AGENTS.md` (dados na UE): um parceiro com empresa-mãe fora da
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
| **Wero (EPI)** | Bélgica (**C**) | Pagamento conta-a-conta dos bancos europeus. Comércio electrónico na Alemanha desde 17/11/2025; Bélgica, França, Luxemburgo e Países Baixos ao longo de 2026 (as datas por país divergem entre resumos de pesquisa — **não confirmadas**); o iDEAL passa a Wero entre 2026 e 2027; o Payconiq acaba a 30/09/2026; ~58 milhões de utilizadores (set/2026) | **W** ([Wero](https://wero-wallet.eu/news/wero-ecommerce-germany), [EPI](https://epicompany.eu/media-insights/successful-first-phase-marks-major-next-steps-in-ideal-to-wero-migration/), [Chronicle.lu](https://www.chronicle.lu/category/banking/63148-payconiq-payment-system-officially-transitions-to-wero-platform-in-luxembourg)) | Não se contrata directamente: chega pelo prestador (a Mollie e a Stripe já o listam; a Nexi integrou-o na Alemanha a 28/04/2026, [Nexi](https://www.nexigroup.com/content/dam/corp/downloads/media/press-release/2026/2026-04-28-pr-nexi-implements-Wero-for-ecommerce-in-germany.pdf)) |

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

Pesquisa feita a 03/10/2026 por um agente, com a fonte em cada linha.
**Conferi por amostragem**: a tabela europeia da Worldpay (11 países), a
ANACOM (Portugal), a BNetzA (Alemanha) e a CNMC (Espanha) — tudo bateu. O
resto não conferi um a um; onde a página foi lida por resumo automático, está
dito.

⚠️ **As percentagens não se comparam entre si**, porque medem coisas
diferentes:
- **[W]** % do **valor** gasto online (Worldpay, *Global Payments Report 2025*,
  dados de 2024, [PDF](https://offers.worldpayglobal.com/rs/850-JOA-856/images/GPR25.pdf)
  — tabela da p. 84 e páginas de cada país). «A2A» = pagamento conta-a-conta;
  «cash» inclui o pagamento contra-reembolso.
- **[S]** % do **número** de pagamentos online, sem contar o contra-reembolso
  (BCE, estudo SPACE 2024, Chart 11, [folha de dados](https://www.ecb.europa.eu/stats/ecb_surveys/space/shared/pdf/ecb.space2024_charts.en.xlsx)).
  Abreviaturas: cart. = cartões; e-pay = carteiras e apps (inclui o iDEAL);
  transf. = transferências; inst. = pagamentos imediatos.
- Estudos nacionais: % de **compradores que usam** (resposta múltipla) ou % de
  **encomendas**, conforme o estudo.
- **[CE21]** quota do operador postal histórico em encomendas e expresso,
  período 2017–2021 (Comissão Europeia / Copenhagen Economics,
  [estudo](https://op.europa.eu/en/publication-detail/-/publication/25f27acb-79d0-11ed-9887-01aa75ed71a1/language-en)) —
  **desactualizada** em vários países (ex.: CTT 54 % em CE21 e 43,5 % no
  2.º trimestre de 2024 pela ANACOM).
- **[LME]** Last Mile Experts, *Out-of-Home Delivery in Europe 2025*, versão de
  amostra, fim de 2024.

### 2.1 Pagamentos online

| País | Mais usados | Fonte |
|---|---|---|
| Alemanha | [W]: carteiras 35 % (PayPal usado por 68 %), A2A 26 %, pagar depois 20 % (Klarna, PayPal), crédito 10 %, débito 6 %. O giropay acabou em jul./2024; o Wero funciona online desde 17/11/2025. [S]: e-pay 45,9 %, débito directo 20,5 %, cart. 19,8 % | [W] p. 96–97; [S]; [EPI](https://wero-wallet.eu/news/wero-ecommerce-germany) |
| Áustria | [S]: cart. 37,9 %, e-pay 29,0 %, transf. 9,5 % + inst. 5,4 %, débito directo 8,4 %. Marcas: eps, Sofort, débito directo SEPA, PayPal (página PPRO **sem ano**) | [S]; [PPRO](https://www.ppro.com/countries/austria/) |
| Bélgica | [W]: débito/pré-pago 29 % (Bancontact é a rede de débito), A2A 23 %, carteiras 21 %, pagar depois 12 %, crédito 12 %. Payconiq substituído pelo Wero. [S]: cart. 51,0 %, e-pay 27,0 % | [W] p. 88–89; [S] |
| Bulgária | Contra-reembolso 50,30 %, cartões 38,20 %, banco/telemóvel 7,29 %, pagar depois 4,21 % (Associação Búlgara de E-commerce, 2024) | [BIA/BNR, 09/12/2025](https://www.bia-bg.com/news/view/35112/) (resumo) |
| Chéquia | 58 % pagaram pelo menos uma vez com cartão; 39 % à cobrança; 12 % em dinheiro (APEK, jan./2024, 1.078 inquiridos) | [APEK, 14/02/2024](https://www.apek.cz/clanky/ceska-e-commerce-v-lednu-2024-v-e-shopech-nakoupi) |
| Chipre | [S]: cart. 60,8 %, e-pay 16,5 %, inst. 7,7 %. Marcas: **sem fonte** | [S] |
| Croácia | [S]: cart. 50,8 %, e-pay 19,1 %, transf. 7,4 %. 66 % das compras com cartão (Valicon/Jeftinije.hr). À cobrança: sem fonte | [S]; [Lider, 08/02/2025](https://lidermedia.hr/tvrtke-i-trzista/istrazivanje-hrvatsko-online-trziste-postaje-sve-zrelije-i-konkurentnije-161415/) (resumo) |
| Dinamarca | [W]: carteiras 41 % (MobilePay usado por 60 %), débito 24 % (Dankort), crédito 15 %, pagar depois 11 %, A2A 7 % | [W] p. 90–91 |
| Eslováquia | 43 % das compras à cobrança; 27,6 % com cartão (lojas da Shoptet, 2024). [S]: cart. 55,7 %, e-pay 21,5 % | [SITA, 04/06/2025](https://sita.sk/vofinanciach/platba-na-dobierku-je-slovenskym-specifikom-skoro-polovicu-kupujucich-neodradi-ani-extra-poplatok/) (resumo); [S] |
| Eslovénia | ~65 % das compras com cartão (Valicon/Ceneje.si, 2024). [S]: cart. 54,5 %, e-pay 21,9 % | [IAB Slovenija, 02/02/2025](https://www.iab.si/post/spletna-trgovina-v-2024-klju%C4%8Dni-trendi-in-pri%C4%8Dakovanja-za-2025-poro%C4%8Dilo-e-commerce) (resumo); [S] |
| Espanha | [W]: carteiras 34 % (PayPal 41 %), débito 23 %, A2A 21 % (Bizum), crédito 16 %. [S]: cart. 50,8 %, e-pay 26,4 % | [W] p. 108–109; [S] |
| Estónia | [S]: cart. 41,5 %, transf. 21,9 % + inst. 7,9 %, e-pay 12,6 %. Marcas: conhecimento prévio, **não verificado** | [S] |
| Finlândia | [W]: A2A 34 % (banco online, Trustly), carteiras 26 % (PayPal, MobilePay), pagar depois 16 % (Klarna), débito 12 %. [S]: cart. 39,9 %, e-pay 22,7 %, transf. 20,5 % | [W] p. 92–93; [S] |
| França | [W]: carteiras 34 %, débito 26 % (Carte Bancaire), crédito 21 %, A2A 11 %, pagar depois 5 %. Wero desde out./2024. [S]: cart. 54,2 %, e-pay 27,1 % | [W] p. 94–95; [S] |
| Grécia | Compradores que usam (resposta múltipla): débito 85,2 %, contra-reembolso 62,8 %, crédito 48,7 %, Apple/Google Pay 29,3 %, PayPal 20,2 % (ELTRUN, 2024). [S]: cart. 53,3 %, e-pay 25,5 % | [Insider, 08/05/2025](https://www.insider.gr/tehnologia/364045/sta-182-dis-eyro-o-tziros-toy-ilektronikoy-emporioy-2024-pos-psonizoyn-oi-ellines) (resumo); [S] |
| Hungria | 59 % das encomendas pagas na entrega; 36 % pagas online (GKID-Mastercard, 2023 e 1.º trim. 2024) | [DKSZ, 14/05/2024](https://dksz.hu/gkid-mastercard-digitalis-kereskedelmi-korkep-2024-i) (resumo) |
| Irlanda | [W]: carteiras 40 % (PayPal 42 %), débito 33 %, crédito 18 %, A2A 4 %. [S]: cart. 49,0 %, e-pay 28,7 % | [W] p. 98–99; [S] |
| Itália | [W]: carteiras 40 % (PayPal 49 %, Bancomat Pay 8 %), débito/pré-pago 25 % (Postepay 18 %), crédito 19 %, A2A 8 % (MyBank, Satispay). [S]: cart. 51,3 %, e-pay 27,7 % | [W] p. 100–101; [S] |
| Letónia | [S]: cart. 44,8 %, e-pay 18,4 %, transf. 15,6 % + inst. 6,8 %. Marcas: **sem fonte** | [S] |
| Lituânia | [S]: cart. 48,7 %, e-pay 12,6 %, transf. 12,0 % + inst. 7,2 %, débito directo 10,4 %. Marcas: **sem fonte** | [S] |
| Luxemburgo | [S]: cart. 46,9 %, e-pay 27,2 %, transf. 11,7 %, inst. 7,7 %. Payconiq a migrar para o Wero em 2026 | [S] |
| Malta | [S]: cart. 52,8 %, e-pay 23,3 %, inst. 7,0 %. Marcas: **sem fonte** | [S] |
| Países Baixos | [W]: A2A 67 % (iDEAL usado por 86 %), carteiras 11 %, pagar depois 10 %. O iDEAL passa a Wero entre 2026 e 2027. [S]: e-pay 75,8 % | [W] p. 102–103 (conferido); [S] |
| Polónia | [W]: A2A 70 % (BLIK, Przelewy24), carteiras 12 %, débito 7 % | [W] p. 106–107 |
| Portugal | [S]: cart. 36,4 %, e-pay 32,7 %, inst. 10,4 %, transf. 7,5 %. O MB WAY passou a ser o meio mais usado nas compras online, com mais de 4 M de utilizadores; Multibanco ~3,8 M (Marktest) | [S]; [ECO, 14/03/2025](https://eco.sapo.pt/2025/03/14/mb-way-ja-e-a-forma-de-pagamento-mais-utilizada-pelos-portugueses-nas-compras-online-segundo-a-marktest/) (resumo) |
| Roménia | **Sem quota nacional.** Só um dado de uma empresa: na FAN Courier, 37 % das encomendas de 2024 pagas à cobrança | [Traficmedia, 17/01/2025](https://traficmedia.ro/fan-courier-incheie-2024-cu-o-crestere-cu-125-fata-de-anul-precedent-si-investitii-de-peste-55-de-milioane-de-euro/) (resumo) |
| Suécia | [W]: A2A 31 % (Swish, Trustly), pagar depois 23 % (Klarna usada por 52 %), carteiras 18 %, débito 17 % | [W] p. 110–111 |

### 2.2 Envios

| País | Operador postal, transportadores e cacifos | Fonte |
|---|---|---|
| Alemanha | Por volume: DHL **mais de 40 %**; Amazon 15–20 %; DPD, GLS, Hermes, UPS 5–15 % cada (os seis ≈ 98 %). ~17.000 cacifos | [BNetzA, 10/06/2025](https://data.bundesnetzagentur.de/Bundesnetzagentur/SharedDocs/Mediathek/Berichte/2024/2025_06_10_Paketmarktbericht_2024_FINAL_en.pdf) (conferido) |
| Áustria | Österreichische Post 60 % [CE21] e maior rede de pontos; myflexbox, a maior rede aberta (610 cacifos); DHL, DPD, GLS, Hermes, Amazon | [CE21]; [LME] p. 9–10 |
| Bélgica | Por volume, 2024: bpost 30–40 %; PostNL, DPD, UPS 10–20 % cada; GLS, Mondial Relay, Amazon 5–10 % | [BIPT, 25/11/2025](https://bipt.be/operateurs/postal/observatoire/parts-de-marche-segment-colis-et-express-volume) (resumo) |
| Bulgária | Econt, Speedy e DHL Express somam 79,7 % das receitas de courier (2024); quotas individuais e cacifos: não verificado | [24Plovdiv, 30/06/2025](https://www.24plovdiv.bg/novini/article/20815802) (resumo) |
| Chéquia | Česká pošta + Balíkovna ≈ 28 %; PPL, DPD e Packeta com quotas de dois dígitos; Packeta >130 M de encomendas em 2024 (todos os países); 46 % dos compradores usaram cacifos | [e15, 27/11/2024](https://www.e15.cz/byznys/balikovna-pred-privatizaci-ztraci-trzni-podil-prodejni-plan-pritom-pocital-s-kazdorocnim-rustem-1420379); [Packeta](https://blog.packeta.com/our-year-2024-summed-up-in-numbers-pressrelease/) (resumos) |
| Chipre | Transportadores e cacifos: **sem fonte** ([CE21] dá 1 % ao operador histórico, valor estranho) | [CE21] |
| Croácia | Hrvatska pošta 29 % [CE21]; 2.124 cacifos no fim de 2024 (HP, DPD, GLS, DHL, Overseas, M SAN, Box Now) | [CE21]; Lider (resumo) |
| Dinamarca | PostNord é o serviço universal; entrega em casa caiu para 37 % (2024). Quotas: **sem fonte** | Dansk Erhverv; [CE21] |
| Eslováquia | Slovenská pošta 28 % [CE21]. Packeta, SPS, DPD, GLS: conhecimento prévio, **não verificado** | [CE21] |
| Eslovénia | Pošta Slovenije entrega a maior parte, depois GLS, DPD, DHL (regulador AKOS, sem %) | [N1](https://n1info.si/novice/slovenija/analizirali-dostave-postnih-posiljk-v-sloveniji-kazejo-se-korenite-spremembe-na-trgu/) (resumo) |
| Espanha | 1.216,6 M de envios em 2024. Correos (com Correos Express) **17,5 %**; redes urgentes (CTT Express, GLS, MRW, Nacex, SEUR…) **39,0 %**; última milha, incluindo a Amazon, **33,0 %**. Entrega: casa 68,9 %, pontos 13,6 %, cacifos 3,8 % | [CNMC, 22/07/2025](https://www.cnmc.es/sites/default/files/6089770.pdf) (conferido) |
| Estónia | Omniva 34 % [CE21]; DPD com ~300 cacifos, 2.ª rede | [Omniva](https://www.omniva.ee/en/news/omnivas-parcel-volume-grew-by-19-last-year-international-business-reached-a-record-level/); [DPD](https://www.dpd.com/ee/en/2024/04/25/dpd-kasvatab-baltikumi-pakiautomaatide-vorgustiku-1100-ni/) (resumos) |
| Finlândia | Posti 50–60 % (estimativa [CE21]); ~3.000 pontos, ~1.850 cacifos (fim de 2024). Matkahuolto: não verificado | [Posti, 16/03/2025](https://www.posti.fi/en/latest-news-at-posti/news/traficom-report-year2024) (resumo) |
| França | 1,7 mil milhões de encomendas (2024): La Poste (Colissimo), Colis Privé, Mondial Relay; expresso: Chronopost, DPD. O regulador não publica quotas. 17.510 cacifos | [ARCEP, out./2025](https://www.arcep.fr/fileadmin/user_upload/observatoire/courrier-et-colis/2024/observatoire-courrier-colis-2024_oct2025.pdf); [LME] |
| Grécia | 5.300 cacifos (fim de 2024); seis empresas tratam 62 % sem serem identificadas; a ELTA absorveu a ELTA Courier (01/10/2024); 51,8 % dos compradores usam cacifos. ACS e BOX NOW: **não verificado** | [EETT, 2024](https://www.eett.gr/wp-content/uploads/2026/02/EETT_MARKET_REVIEW_2024.pdf) |
| Hungria | Magyar Posta 27 % [CE21]. Cacifos (1.º trim. 2026): Foxpost-Packeta 4.041, GLS 2.861, Sameday 1.096, Express One 905, Magyar Posta 698, DPD 323 | [NMHH, 12/05/2026](https://nmhh.hu/cikk/249762/Csomagautomatak_es_kezbesitesi_pontok_megoszlasa_a_leginkabb_igenybe_vett_postai_szolgaltatoknal) (resumo) |
| Irlanda | An Post, DPD, DHL, FedEx, UPS, Fastway, GLS: 140,73 M de encomendas em 2023; o regulador **não publica** quotas | [RTÉ, 07/11/2024](https://www.rte.ie/news/business/2024/1107/1479658-revenues-down-1-at-main-parcel-delivery-firms-last-year/) (resumo) |
| Itália | 2024 (AGCOM): Amazon 19,1 %, Poste Italiane 17,6 %, BRT 16,4 %, DHL 13,3 % (não diz se volume ou receita); 30.322 pontos únicos | [Supply Chain Italy, 19/05/2025](https://www.supplychainitaly.it/2025/05/19/poste-italiane-recupera-quota-nel-mercato-italiano-della-consegna-pacchi-176-nel-2024) (resumo); [LME] |
| Letónia | Latvijas Pasts; a Omniva cresceu 23 % em 2024; DPD com cacifos novos. Quotas: **sem fonte** | Omniva; DPD (resumos) |
| Lituânia | Receitas de 2024 em todo o mercado postal: Lietuvos paštas 24,5 %, DPD 19,8 %, Venipak 12,5 %, FedEx 11,0 %, DHL 10,1 %; 2.070 cacifos (Omniva 545, Lietuvos paštas 437, DPD 400) | [Versloidejos, 17/02/2025](https://versloidejos.lt/verslo-naujienos-is-lietuvos-ir-pasaulio/pastomatu-bumas-ir-siuntiniu-augimas-kaip-2024-m-pasikeite-pasto-rinka/) (resumo) |
| Luxemburgo | POST Luxembourg; outros: **sem fonte** | [CE21] |
| Malta | MaltaPost 31 % [CE21]; outros: **sem fonte** | [CE21] |
| Países Baixos | PostNL 60 % [CE21]; mais de 80 % entregue em casa; cacifos de 2.800 para 4.800 em 2024 | [ACM, 12/06/2025](https://www.acm.nl/nl/publicaties/acm-post-en-pakketmonitor-2024-meer-pakketten-minder-post-en-dalende-betrouwbaarheid) (resumo) |
| Polónia | 1.214,5 M de encomendas em 2024; recolha **em cacifo 53,5 %**, estafeta 41,8 %, ponto 4,6 %; ~51.800 cacifos; Allegro, DHL, DPD, InPost, Orlen Paczka, Poczta Polska; o regulador não publica quotas | [UKE, 16/09/2025](https://bip.uke.gov.pl/raporty/raport-przesylki-kurierskie-w-2024-roku,106.html) |
| Portugal | CTT **43,5 %** das encomendas (2.º trim. 2024); DPD Portugal com 112 M€ de receita em 2024; rede CTT com cacifos Locky aberta à Amazon (nov./2024) | [ANACOM, 10/09/2024](https://www.anacom-consumidor.pt/-/encomendas-representam-14-5-do-trafego-postal) (conferido); [JE](https://jornaleconomico.sapo.pt/noticias/dpd-portugal-com-crescimento-de-12-nas-receitas-em-2024-para-112-milhoes/); [CTT](https://www.ctt.pt/grupo-ctt/media/noticias/os-clientes-amazon-podem-agora-recolher-as-suas-encomendas-utilizando-toda-a-rede-dos-ctt-em-portugal) |
| Roménia | Receitas de 2025: FAN Courier 1.549 M lei, Sameday 1.439 M (comprou a Cargus, 03/08/2026 ⇒ 1.º com 2.057 M), Cargus 618 M, GLS 530 M, DPD 450 M; FAN Courier ~2.100 cacifos | [Economedia, 10/08/2026](https://economedia.ro/analiza-topul-companiilor-de-curierat-din-romania-2025.html) (resumo) |
| Suécia | Encomendas até 2 kg (2024): PostNord 55–60 %, Early Bird 30–35 %, Citymail 5–10 %; 8.242 cacifos em 18.778 pontos (2025) | [PTS, 17/04/2025](https://pts.se/contentassets/b15095eed1c94bc89fa6a95632d0c7d8/swedish-postal-market-2025.pdf) |

## 3. Por onde começar as parcerias — proposta (opinião)

O que os números dizem:

1. **Um prestador europeu que traga os métodos locais de uma vez.** O método
   que manda num país é muitas vezes local: iDEAL nos Países Baixos (A2A 67 %),
   BLIK e Przelewy24 na Polónia (A2A 70 %), Bancontact na Bélgica, Swish na
   Suécia, MobilePay na Dinamarca, MB WAY em Portugal, Bizum em Espanha. A
   **Mollie** lista todos (§1.1). Com a **EuPago** para Portugal, já escolhida
   para a plataforma de formação.
2. **PayPal e Klarna**, que pesam muito: PayPal usado por 68 % dos compradores
   online na Alemanha e 49 % em Itália; Klarna por 52 % na Suécia. Chegam pela
   Mollie; contrato directo só se o volume o pedir.
3. **⚠️ O pagamento na entrega é uma parceria de ENVIOS, não de pagamentos.**
   Pesa no Leste: Bulgária 50,3 % dos pagamentos, Hungria 59 % das encomendas,
   Eslováquia 43 %, Chéquia 39 % dos compradores, Roménia 37 % na FAN Courier.
   Quem cobra é a transportadora (Econt, Speedy, Packeta, FAN Courier,
   Sameday…). O Eurolify nunca toca no dinheiro, como nos outros pagamentos.
4. **Envios: uma plataforma que junta transportadoras** (Sendcloud, europeia)
   para começar em muitos países de uma vez, e **ligação directa** às redes que
   cobrem vários países (DHL, DPD, GLS) e ao operador nacional de cada país
   onde houver comerciantes (CTT em Portugal, Correos em Espanha…).
5. **Redes regionais que mandam onde estão:** InPost na Polónia (53,5 % das
   recolhas em cacifo), Packeta na Chéquia, Eslováquia e Hungria, Omniva nos
   Bálticos, Econt e Speedy na Bulgária, FAN Courier e Sameday na Roménia,
   BRT em Itália.
6. **Pela decisão L**, estes parceiros são convidados, na Fase 2, a escrever
   eles próprios a sua ligação ao Eurolify.

**O que não está medido:** por que ordem abrir os países (tamanho do mercado,
procura dos comerciantes). As parcerias seguem os comerciantes que entrarem.

## 4. Mudanças recentes que importam

- **giropay** (Alemanha) acabou em julho de 2024 ([W] p. 96).
- **Paylib** (França): fim previsto para 2025 ([W] p. 94) — não verifiquei se
  aconteceu.
- **Payconiq** (Bélgica e Luxemburgo) passa ao **Wero**; no Luxemburgo a
  plataforma Payconiq acaba a 30/09/2026 (§1.1).
- **Wero** no comércio online: Alemanha desde 17/11/2025; Bélgica, França,
  Luxemburgo e Países Baixos em 2026.
- **iDEAL → Wero** (Países Baixos): do início de 2026 ao fim de 2027.
- **Roménia:** a Sameday comprou a Cargus (03/08/2026).
- **Grécia:** a ELTA absorveu a ELTA Courier (01/10/2024).
- **Hungria:** Foxpost e Packeta aparecem como uma só rede no regulador.
- **InPost:** em compra por um consórcio com a FedEx (§1.2).

## O que ficou por verificar

- As sedes da Mollie, da Adyen, da Klarna e da EPI (escritas como **C**).
- A lista actual de métodos da Adyen e da EuPago.
- O relatório completo da Last Mile Experts e o PCMI não foram lidos (só a
  versão de amostra e resumos). O da Worldpay foi lido.
- **Marcas de pagamento** em Chipre, Malta, Letónia, Lituânia e Estónia: só a
  divisão por instrumento do BCE. Áustria: marcas de uma página sem ano.
  Roménia: um só dado de uma empresa. Croácia: falta o pagamento à cobrança.
- **Transportadores sem quota com nome:** Dinamarca, Eslováquia, Países
  Baixos, Grécia, Irlanda (o regulador não publica), Chipre, Luxemburgo,
  Malta. Sem contagem de cacifos: Bulgária, Irlanda, Eslovénia, Finlândia
  (Matkahuolto).
- **Descartado:** um site dizia que mais de 50 % das encomendas em Espanha,
  Portugal e Itália são pagas na entrega, sem fonte; a Worldpay contradiz (≤ 3 %
  em dinheiro, incluindo contra-reembolso). Não se usou.
- As linhas marcadas «resumo» foram lidas por resumo automático da página; os
  números não foram confirmados no original.
