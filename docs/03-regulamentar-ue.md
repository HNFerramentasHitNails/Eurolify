# Mapa regulamentar europeu do Lumavo

> **Versão de 03/10/2026.** Desenho, não aconselhamento jurídico nem fiscal.
> Cada linha diz **de onde veio** e **com que grau de certeza**. Nada disto
> dispensa a validação de um contabilista e de um jurista em cada país onde o
> Lumavo for vendido — ver a coluna «Quem valida».

## Como ler a coluna «Verificação»

| Marca | Significa |
|---|---|
| **W** | Confirmado numa pesquisa web a 03/10/2026. Lido o **resumo** dos resultados e o título das fontes; **o texto legal não foi lido** nesta sessão. |
| **M** | Vem da memória de trabalho dos sistemas actuais (repo `bruno-88/claude`), medido ou decidido lá, com data. |
| **C** | Conhecimento prévio, bem estabelecido, **não verificado nesta sessão**. Confirmar antes de construir. |

⚠️ **Regra:** uma linha **C** não entra num ecrã, num texto legal nem numa
decisão de IVA sem passar a **W** (com o texto legal lido) ou ser validada por
um profissional.

---

## 1. Impostos e faturação

| Tema | Instrumento | Desde | O que obriga o Lumavo a ter | Verif. | Quem valida |
|---|---|---|---|---|---|
| IVA nas vendas à distância na UE (OSS) | Pacote IVA do comércio electrónico, Dir. (UE) 2017/2455 e 2019/1995 | 01/07/2021 | Taxa do **país de destino** em B2C acima do limiar de 10.000 € anuais na UE; relatório OSS separado do nacional, da exportação e das isentas | **C** + **M** (os sistemas actuais já declaram OSS — `oss-iva-por-pais-10ago2026.md`) | contabilista |
| Importações de baixo valor (IOSS) | idem | 01/07/2021 | Só relevante se um comerciante vender a partir de fora da UE (≤150 €) | **C** | contabilista |
| Fim da isenção aduaneira <150 € | reforma aduaneira da UE | 01/07/2026 | Direito fixo de 3 € **por artigo/categoria pautal** nas importações de baixo valor; transitório até 2028 | **W** ([Avalara](https://www.avalara.com/blog/en/europe/2025/11/eu-end-150-customs-duty-exemption-2026.html), [Baker Tilly](https://bakertillysee.com/insights/major-eu-customs-update-e3-duty-on-low-value-e-commerce-imports-starting-july-2026/)) | despachante |
| IVA na era digital (ViDA) | pacote ViDA, adoptado pelo Conselho a 11/03/2025 | faseado | Fatura electrónica estruturada nas operações **intracomunitárias** a partir de **01/07/2030**; regra do fornecedor presumido para plataformas de alojamento e transporte (opcional 01/07/2028, obrigatória 01/01/2030) | **W** ([vatupdate](https://www.vatupdate.com/2025/03/13/council-adopted-the-vat-in-the-digital-age-vida-package-on-march-11-2025/), [KPMG](https://kpmg.com/ch/en/insights/taxes/vat-digital-age.html)) | contabilista |
| Fornecedor presumido em bens (marketplaces) | art. 14.º-A da Directiva IVA | 01/07/2021 | Se um dia houver marketplace: em certas vendas a plataforma passa a ser o vendedor para efeitos de IVA | **C** | contabilista |
| Software de faturação **certificado pela AT** | Portaria 363/2010 e legislação conexa | em vigor | O Lumavo **não emite faturas portuguesas** sem ser software certificado ⇒ liga-se a quem é (Moloni, etc.) | **C** + **M** (é por isso que o Hub fala com o Moloni) | contabilista |
| ATCUD e código QR | legislação portuguesa | em vigor | Obrigatórios em todas as faturas — tratados pelo software certificado | **W** ([centralgest](https://www.centralgest.com/noticia/797/assinatura-digital-nas-faturas-adiada-para-2027)) | contabilista |
| PDF como fatura electrónica (PT) | regime transitório | até 31/12/2026 | A partir de **01/01/2027** um PDF só vale como fatura electrónica com **assinatura electrónica qualificada** (ou formato estruturado). O Orçamento de 2027 ainda pode mudar isto | **W** ([centralgestcloud](https://www.centralgestcloud.com/blog/artigo/244/assinatura-digital-qualificada-adiada-para-2027), [InvoiceXpress](https://invoicexpress.com/blog/assinatura-digital-faturas-eletronicas/)) | contabilista |
| Conservação de documentos (PT) | art. 52.º do CIVA | em vigor | **10 anos civis**; em suporte electrónico com integridade e acesso em linha. Choca com o «direito ao apagamento» do RGPD ⇒ ver §4 | **W** ([Portal das Finanças](https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/civa/Pages/iva52.aspx)) | contabilista |
| Espanha — Verifactu | RD 1007/2023, adiado pelo RDL 15/2025 | 01/01/2027 (sociedades) · 01/07/2027 (restantes) | Software de faturação conforme Verifactu para comerciantes espanhóis | **W** ([afilco](https://www.afilcoasesores.com/verifactu-retraso-2027-nuevos-plazos/), [exactly.es](https://www.exactly.es/verifactu-delayed-2027-rdl-15-2025/)) | asesor fiscal ES |
| França — fatura electrónica | reforma francesa | **receber**: todas desde 01/09/2026 · **emitir**: grandes e médias 01/09/2026, PME e micro 01/09/2027 | Emissão por uma **Plateforme Agréée** (ex-PDP) e e-reporting | **W** ([service-public](https://entreprendre.service-public.gouv.fr/actualites/A15683?lang=en), [cleartax](https://www.cleartax.com/fr/en/e-invoicing-france)) | expert-comptable FR |
| Bélgica — B2B electrónico | lei belga | 01/01/2026 (e-reporting 2028) | Fatura estruturada nas operações B2B domésticas | **W** ([Comissão Europeia](https://ec.europa.eu/digital-building-blocks/sites/spaces/DIGITAL/pages/467108877/eInvoicing+in+Belgium)) | contabilista BE |
| Alemanha — B2B electrónico | lei alemã | receber desde 01/01/2025 · emitir: >800.000 € a 01/01/2027, todos a 01/01/2028 | Fatura estruturada (XRechnung/ZUGFeRD) | **W** ([vatupdate](https://www.vatupdate.com/2026/09/14/germanys-e-invoicing-mandate-key-deadlines-for-2025-2027-and-2028/), [Avalara](https://www.avalara.com/blog/en/europe/2026/09/germany-e-invoicing.html)) | Steuerberater |
| Polónia — KSeF | lei polaca | 01/02/2026 (grandes) · 01/04/2026 (restantes) · 01/01/2027 (micro) | Emissão pelo sistema nacional KSeF | **W** ([EY](https://www.ey.com/en_gl/technical/tax-alerts/poland-announces-new-timeline-for-mandatory-e-invoicing), [Sovos](https://sovos.com/blog/vat/poland-e-invoicing-via-ksef/)) | contabilista PL |
| Itália — SDI | lei italiana | B2B e B2C desde 2019 | Emissão pelo Sistema di Interscambio | **C** | commercialista IT |
| Canárias, Ceuta e Melilla | Directiva IVA (territórios excluídos) | em vigor | São Espanha mas **fora do território de IVA da UE**: venda de bens = exportação (M05), sem VIES | **M** (`canarias-ceuta-melilla-extra-ue-28set2026.md`, executado nos sistemas actuais a 28/09/2026) | contabilista |
| Açores e Madeira | CIVA | em vigor | Taxas próprias (16 % e 22 % na taxa normal, medido nos sistemas actuais). Se uma venda do continente leva a taxa regional **ficou por responder ao contabilista** | **M** (`oss-iva-por-pais-10ago2026.md`) | contabilista |

## 2. Consumidor

| Tema | Instrumento | Desde | O que obriga | Verif. | Quem valida |
|---|---|---|---|---|---|
| Informação pré-contratual e livre resolução de 14 dias | Dir. 2011/83/UE (em PT, DL 24/2014) | em vigor | Preço total com impostos e portes, prazos, identidade do vendedor, 14 dias; excepções (ex.: produtos selados por higiene, abertos depois da entrega) | **C** | jurista |
| **Botão de livre resolução** | Dir. (UE) 2023/2673 (novo art. 11.º-A da Dir. 2011/83/UE) | **19/06/2026** | Uma **função online** fácil de encontrar, visível e disponível durante todo o prazo, em **todos** os contratos à distância com direito de resolução celebrados por interface online, com confirmação de recepção | **W** ([EUR-Lex](https://eur-lex.europa.eu/eli/dir/2023/2673/oj/eng), [William Fry](https://www.williamfry.com/knowledge/world-consumer-rights-day-part-3-mandatory-withdrawal-button-coming-june-2026/), [Heuking](https://www.heuking.de/en/news-events/newsletter-articles/detail/new-cancellation-button-what-companies-must-implement-by-june-19-2026.html)) | jurista |
| Reduções de preço — preço mais baixo dos 30 dias | Dir. 98/6/CE art. 6.º-A, introduzido pela Dir. (UE) 2019/2161 (Omnibus) | 28/05/2022 | Guardar o **histórico de preços** por mercado para mostrar o preço de referência certo numa promoção | **C** | jurista |
| Alegações ambientais e garantia legal | Dir. (UE) 2024/825 (EmpCo) | **27/09/2026** | Proibidas alegações genéricas («eco», «verde») sem prova; **aviso harmonizado da garantia legal** no ponto de venda | **W** ([Comissão Europeia](https://transition-pathways.europa.eu/retail/news/updated-qa-directive-empowering-consumers-green-transition), [Freshfields](https://www.freshfields.com/en/our-thinking/blogs/sustainability/empco-goes-live-what-businesses-need-to-know-as-the-new-rules-take-effect-102o3sq)) | jurista |
| Plataforma europeia de litígios (ODR) | Reg. (UE) 2024/3228 revogou o Reg. ODR | **encerrada a 20/07/2025** | **Não** pôr a ligação à ODR (induz em erro). A RAL nacional continua | **W** ([Comissão Europeia](https://consumer-redress.ec.europa.eu/site-relocation_en), [iubenda](https://www.iubenda.com/en/blog/discontinuation-of-the-european-online-dispute-resolution-odr-platform/)) | jurista |
| RAL e Livro de Reclamações electrónico (PT) | Lei 144/2015; DL 156/2005 alterado | em vigor | Informação RAL e ligação ao Livro de Reclamações nas lojas portuguesas B2C | **C** | jurista |
| Geobloqueio | Reg. (UE) 2018/302 | 03/12/2018 | Não recusar acesso à loja por nacionalidade/residência; não obriga a entregar em todo o lado | **C** | jurista |
| *Digital Fairness Act* (equidade digital) | proposta da Comissão | **ainda não apresentada** (esperada no 4.º trimestre de 2026) | Vigiar: padrões enganadores, subscrições, personalização | **W** ([AKD](https://www.akd.eu/insights/the-digital-fairness-act-what-to-expect-from-the-forthcoming-eu-legislative-proposal-on-strengthening-consumer-protection-rules-for-the-digital-age)) | — |

> ⚠️ Muitas vendas dos sistemas actuais são **B2B** (profissionais), o que afasta parte destas
> obrigações (`ai-act-compliance.md`, auditoria jurídica de abril/2026). O Lumavo
> tem de saber, **por encomenda**, se o comprador é consumidor ou profissional —
> e não deduzi-lo só por haver NIF.

## 3. Produto

| Tema | Instrumento | Desde | O que obriga | Verif. | Quem valida |
|---|---|---|---|---|---|
| Segurança geral dos produtos | Reg. (UE) 2023/988 (GPSR) | 13/12/2024 | Na oferta online, **antes da compra**: fabricante e contacto, **pessoa responsável na UE** quando o fabricante é de fora, identificação do produto (tipo, lote/série, foto), avisos na língua do país; recolhas | **W** ([EUR-Lex](https://eur-lex.europa.eu/eli/reg/2023/988/oj/eng); o art. 19.º não foi lido por inteiro) | jurista |
| Cosméticos | Reg. (CE) 1223/2009 | em vigor | Pessoa responsável, notificação CPNP, INCI, rotulagem | **C** + **M** (rótulos e CPNP no Hub, `hub-rotulos-cpnp-e-permissoes-18ago2026.md`) | técnico regulamentar |
| Substâncias proibidas — TPO | Reg. (UE) 2025/877 | **01/09/2025**, sem período de escoamento | Exemplo de porque a **fórmula tem versões**: um gel com TPO deixou de poder ser vendido de um dia para o outro | **W** ([Comissão Europeia](https://single-market-economy.ec.europa.eu/sectors/cosmetics/tpo-nail-products-questions-answers_en)) | técnico regulamentar |
| Químicos — rótulo na venda online | Reg. (UE) 2024/2865 (CLP revisto) | adiado para **01/01/2028** pelo Reg. (UE) 2025/2439 | Na venda à distância, **todos** os elementos do rótulo CLP visíveis na oferta (não chega um PDF da ficha de segurança) | **W** ([CMS](https://cms.law/en/aut/legal-updates/updated-eu-chemicals-labelling-and-packaging-clp-regulation), [ChemLinked](https://chemical.chemlinked.com/news/chemical-news/eu-extends-clp-compliance-deadlines-for-new-labeling-rules-to-2028)) | técnico regulamentar |
| Embalagens (PPWR) | Reg. (UE) 2025/40 | **12/08/2026** | Registo de responsabilidade alargada do produtor **por país** onde se vende, vendedores à distância incluídos; marketplaces verificam o registo. ⚠️ As fontes de consultoria dizem que o limite de 40 % de espaço vazio já se aplica — **não confio: confirmar no texto** | **W** parcial ([ppwratlas](https://ppwratlas.com/), [complir](https://www.complir.io/resources/guides/extended-producer-responsibility-eu-guide)) | jurista / entidade gestora |
| Mercadorias perigosas no transporte | ADR / IATA | em vigor | Marcar artigos que não podem seguir por avião ou certas transportadoras (vernizes, solventes) | **C** + **M** (a etiqueta dos CTT saiu Via Aérea com Via Marítima cobrada, `etiqueta-ctt-aerea-em-vez-de-maritima-17set2026.md`) | transportadora |
| Acessibilidade | Dir. (UE) 2019/882 (EAA) | 28/06/2025 | Loja e checkout acessíveis; **microempresas de serviços** (<10 pessoas e ≤2 M€) isentas — o Lumavo deve dar acessibilidade por omissão a todos | **W** ([accessible.org](https://accessible.org/eaa-ecommerce-services-requirements/), [Travers Smith](https://www.traverssmith.com/knowledge/knowledge-container/a-new-milestone-for-accessibility-the-european-accessibility-act-now-applies/)) | jurista |

## 4. Dados, plataformas e IA

| Tema | Instrumento | Desde | O que obriga | Verif. | Quem valida |
|---|---|---|---|---|---|
| Protecção de dados | Reg. (UE) 2016/679 (RGPD) | 25/05/2018 | Base legal por finalidade, minimização, registo de tratamentos, pedidos dos titulares, subcontratantes, transferências internacionais. **Apagar ≠ destruir faturas:** a fatura fica 10 anos (art. 52.º CIVA) e pseudonimiza-se o resto | **C** | encarregado de dados / jurista |
| Cookies | Dir. 2002/58/CE (ePrivacy), art. 5.º(3) | em vigor | Consentimento antes de cookies não essenciais (o píxel da Meta antes do consentimento foi um achado de uma auditoria jurídica de 2026) | **C** + **M** (`ai-act-compliance.md`) | jurista |
| Mudança de fornecedor de nuvem/SaaS | Reg. (UE) 2023/2854 (Data Act) | aplicável 12/09/2025 | O comerciante tem direito a **sair com os dados**; a partir de **12/01/2027** não se pode cobrar pela saída | **W** ([Comissão Europeia](https://digital-strategy.ec.europa.eu/en/factpages/data-act-explained), [Pinsent Masons](https://www.pinsentmasons.com/out-law/guides/switching-porting-rules-eu-data-act)) | jurista |
| Serviços digitais (DSA) | Reg. (UE) 2022/2065 | 17/02/2024 | Só pesa se houver **marketplace**. Micro e pequenas plataformas estão fora das secções 3 e 4 (incluindo a rastreabilidade dos vendedores, art. 30.º), salvo plataforma muito grande | **W** ([CMS DigitalLaws](https://www.cms-digitallaws.com/en/dsa/article-19/), [DSA Library](https://dsa-library.com/article/30/)) | jurista |
| Comunicação de vendedores por plataformas | Dir. (UE) 2021/514 (DAC7) | 01/01/2023 | Só com marketplace: reportar rendimentos dos vendedores à AT | **C** | contabilista |
| Inteligência artificial | Reg. (UE) 2024/1689 (AI Act) | faseado | Literacia em IA (art. 4.º) desde 02/02/2025; transparência quando alguém fala com uma IA (art. 50.º) — **data a confirmar**. Um assistente de loja não é «alto risco» | **M** (`ai-act-compliance.md`) + **C** | jurista |
| Cibersegurança | Dir. (UE) 2022/2555 (NIS2) | transposição nacional | A avaliar quando o Lumavo for média empresa (mercados online e fornecedores de nuvem estão nos anexos) | **C** | jurista |

## 5. Pagamentos

| Tema | Instrumento | Desde | O que obriga | Verif. | Quem valida |
|---|---|---|---|---|---|
| Serviços de pagamento e autenticação forte | Dir. (UE) 2015/2366 (PSD2) + Reg. Del. (UE) 2018/389 | 2019 | Autenticação forte (3DS2) feita pelo prestador de pagamento; **guardar fundos de terceiros exige licença** ⇒ o Lumavo nunca recebe o dinheiro dos comerciantes | **C** | jurista |
| PSD3 / PSR | propostas da Comissão | acordo político a 27/11/2025; adopção formal esperada no 2.º semestre de 2026 | Fraude, transparência de preços, responsabilidade em fraude por usurpação; vigiar | **W** ([Taylor Wessing](https://www.taylorwessing.com/en/insights-and-events/insights/2025/11/eu-lawmakers-strike-a-deal-on-payments-reforms), [Parlamento Europeu](https://www.europarl.europa.eu/legislative-train/theme-an-economy-that-works-for-people/file-revision-of-eu-rules-on-payment-services)) | jurista |
| PCI DSS | norma da indústria (não é lei) | — | Nunca tocar em dados de cartão: páginas de pagamento alojadas pelo prestador | **C** | — |

## 6. Protocolos de comércio por agentes de IA (não é lei, é mercado)

| Protocolo | De quem | Estado | Verif. |
|---|---|---|---|
| **MCP** (Model Context Protocol) | Anthropic, adoptado por outros | o padrão de facto para ligar uma IA a ferramentas | **C** |
| **UCP** (Universal Commerce Protocol) | Google + Shopify, anunciado a 11/01/2026 na NRF; Apache 2.0 | carrinho, catálogo e identidade acrescentados em 2026; compatível com MCP, A2A e AP2 | **W** ([Shopify](https://www.shopify.com/news/ai-commerce-at-scale), [UCP](https://universalcommerceprotocol.fr/en/google-shopify-ucp/)) |
| **ACP** (Agentic Commerce Protocol) | OpenAI + Stripe | checkout dentro de uma conversa | **W** (resumo de pesquisa) |
| **AP2** (Agent Payments Protocol) | Google | autorização de pagamentos por agentes | **W** (resumo de pesquisa) |

⚠️ O UCP nasceu da **Shopify**: é o concorrente directo a escrever as regras
do comércio por agentes. Razão para o Lumavo falar estes protocolos em vez de
inventar um próprio.

---

## O que ficou por verificar nesta versão

- **Nenhum texto legal foi lido por inteiro** — só resumos de pesquisa e títulos.
- O espaço vazio de 40 % do PPWR: fontes de consultoria dizem que já se aplica;
  desconfio, confirmar no regulamento.
- A data de aplicação do art. 50.º do AI Act.
- Itália (SDI) e os regimes de faturação dos restantes países da UE.
- Se o formulário de livre resolução da loja online actual cumpre o
  art. 11.º-A — existe, não foi avaliado.
