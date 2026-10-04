# Modelo de receita do Eurolify — estudo (D-14)

> **Versão de 03/10/2026 — estudo; base decidida (ADR-0007), preços por decidir.** Pedido do Diogo: *«estuda o
> modelo de receita do lumavo»*. Com a D-1 decidida (vender desde o início,
> ADR-0006), o modelo é preciso **antes da Fase 1** — a base; os preços, só
> antes da peça 13 (ADR-0012, 03/10/2026).
>
> Marcas de certeza como em `03-regulamentar-ue.md`: **W** pesquisa web a
> 03/10/2026; **M** memória dos sistemas actuais; **C** conhecimento prévio,
> não verificado. **Não há preços finais aqui**: dependem das conversas com
> comerciantes e da estimativa de custos (D-13).

## 1. O ponto de partida

- **O Eurolify não recebe o dinheiro dos comerciantes** (D-5, skill
  `payments-psd2-sca`). Por isso não pode ganhar como o Shopify ganha a maior
  parte: em 2025, **76 % da receita do Shopify veio de «merchant solutions»**
  (sobretudo pagamentos) e **24 % de assinaturas** (US$ 2.752 M de US$ 11,6 mil
  milhões; relatório anual 10-K de 2025 — **W**, resumo de pesquisa,
  [SEC](https://www.sec.gov/Archives/edgar/data/1594805/000159480526000007/shop-20251231.htm)).
- ⇒ **O Eurolify depende mais da mensalidade e do valor da conformidade
  europeia**, e só chega ao dinheiro dos pagamentos através do prestador.
- **O que o Eurolify tem que se pode cobrar:** IVA dos 27 países e OSS, faturação
  ligada ao software certificado de cada país, retenção em vez de fatura
  errada, qualquer frontend, o Hub de gestão, IA, dados na UE.

## 2. O que a concorrência cobra

| Plataforma | Mensalidade | Sobre as vendas | Verif. |
|---|---|---|---|
| **Shopify** (página portuguesa) | Basic 27 € (19 € no plano anual); Grow 74 € (56 €); Advanced 384 € (289 €); Plus desde 2.100 € | Cartões com o Shopify Payments: 1,8 % + 0,30 € no Basic até 1,35 % + 0,30 € no Plus. **Com outro prestador, taxa extra de 2 % / 1 % / 0,6 % / 0,2 %** | **W** ([shopify.com/pt/precos](https://www.shopify.com/pt/precos)) |
| **Shopware** | Community: grátis (núcleo MIT, alojado pelo próprio). Rise desde 600 €/mês; Evolve desde 2.400 €/mês; Beyond por proposta — **«com base no volume de vendas (GMV) e outros factores»** | Sobe com o volume de vendas; a tabela de escalões não é pública | **W** ([shopware.com/en/pricing](https://www.shopware.com/en/pricing/)) |
| **PrestaShop** | Classic grátis (alojado pelo próprio); Hosted 24 € sem IVA no plano anual, 29 € sem compromisso | — | **W** (resumo de pesquisa; [prestashop.com](https://prestashop.com/prestashop-offers/)) |
| **WooCommerce** | Extensão grátis; paga-se o alojamento e as extensões | — | **C** |
| **Loja de aplicações do Shopify** | — | 0 % nos primeiros US$ 1 M de receita **na vida** do programador, 15 % depois (desde 01/01/2025) | **W** ([shopify.dev](https://shopify.dev/changelog/update-to-shopifys-app-developer-revenue-share)) |

**Leitura:** a taxa extra do Shopify sobre as vendas existe para empurrar o
comerciante para o Shopify Payments. O Eurolify não tem pagamentos próprios para
onde empurrar.

## 3. As fontes de receita possíveis

| # | Fonte | Como funciona | A favor | Contra / risco | Quando |
|---|---|---|---|---|---|
| 1 | **Mensalidade por plano** | O comerciante paga um valor fixo por mês, por plano | Previsível para os dois lados | Um valor fixo cobra igual a quem vende 10 mil e a quem vende 1 milhão | Fase 1 |
| 2 | **Escalões de vendas anuais** | A mensalidade sobe com o volume de vendas do ano, por escalões | O preço acompanha o tamanho, sem cobrar em cada venda (é o modelo do Shopware) | Exige medir o volume de vendas | Fase 1 |
| 3 | **Taxa sobre cada venda (%)** | Uma percentagem de cada encomenda | Cresce com o comerciante | **Soma-se à taxa do prestador de pagamento** — o comerciante paga duas vezes; não há pagamentos próprios para justificar | Não recomendada |
| 4 | **Partilha com o prestador de pagamento** | Pela Mollie Connect: a plataforma fixa a sua margem (revenda) ou uma taxa por pagamento, e a Mollie liquida-a no saldo da plataforma; ou o programa de parceiros (10 % a 20 % das taxas da Mollie, segundo um resumo de pesquisa) | O Eurolify nunca toca no dinheiro do comerciante: quem liquida é a Mollie | **Tem de ser às claras**: o comerciante vê quanto paga ao prestador e quanto fica para o Eurolify. Enquadramento legal a confirmar com jurista. Stripe e PayPal passam pela regra dos dados na UE | Fase 1 |
| 5 | **Módulos pagos** | Faturação noutro país de estabelecimento, vários armazéns, B2B avançado, IA acima de um limite | Cobra o que custa: cada país é um adaptador e um contabilista desse país | Demasiados módulos complicam a escolha | Fase 1–2 |
| 6 | **Consumo de IA** | Incluído até um tecto; acima, paga-se o consumo | Os créditos de IA esgotam (lição 6.3 de `docs/04`, 15/09/2026) | — | Fase 1 |
| 7 | **Loja de extensões** | Comissão sobre extensões pagas de terceiros | Receita que cresce com o ecossistema | Só existe na Fase 3 | Fase 3 |
| 8 | **Envios** | Partilha com a plataforma de transportadoras ou com as transportadoras | — | **Não verificado** que existam programas destes | A ver |
| 9 | **Serviços** | Migração (do Shopify para o Eurolify), configuração, formação; instalação dedicada | A migração é o que faz um comerciante mudar | Serviços não escalam como software | Fase 1 |
| — | **Cobrar a saída** | — | — | **Proibido** a partir de 12/01/2027 (Data Act) | Nunca |

Fontes da linha 4: [Mollie Connect](https://help.mollie.com/hc/en-us/articles/213472669-How-does-the-Application-fees-feature-work-)
(exemplo da própria Mollie: o cliente paga 10,00 €, a plataforma fica com
1,50 €, a Mollie liquida o resto ao comerciante — **W**, resumo) e
[revenda](https://docs.mollie.com/docs/connect-platforms-resell-pricing)
(exemplo: compra a 0,25 € + 1,80 %, revende a 0,50 € + 3,00 % — **W**).

## 4. Proposta — opinião, para decidir

1. **Base: mensalidade por plano, com escalões de vendas anuais.** Sem taxa
   sobre cada venda. ✅ **Decidido pelo Diogo a 03/10/2026** (ADR-0007).
2. **Receita de pagamentos só pelo prestador, e às claras** (Mollie Connect,
   com a margem visível ao comerciante).
3. **Módulos pagos por país de faturação**, porque cada país tem um custo real
   (adaptador e validação de um contabilista desse país).
4. **Serviço de migração desde o primeiro dia**, para tirar comerciantes do
   Shopify.
5. **Comissão da loja de extensões na Fase 3.**
6. **Nunca custos de saída**; os direitos de mudança escritos no contrato.

**Planos — estrutura, sem preço** (o preço decide-se depois de falar com 3 a 5
comerciantes e da D-13):

| Plano | Para quem | Inclui | Referência na concorrência |
|---|---|---|---|
| **Início** | Uma loja que vende no seu país e para o resto da UE | Checkout alojado, IVA dos 27 e OSS com o relatório dos quatro baldes (decisão AD), faturação no país do comerciante, um armazém | Shopify Basic 19–27 €; PrestaShop Hosted 24–29 € |
| **Europa** | Quem vende para vários países e a empresas | + listas de preços B2B, Hub completo, mais utilizadores (o relatório OSS passou para todos os planos, decisão AD) | Shopify Grow 56–74 € |
| **Profissional** | Vários armazéns, faturação em vários países | + vários armazéns, módulos de faturação por país, nível de serviço | Shopify Advanced 289–384 € |
| **Empresa** | Grandes volumes | Instalação dedicada, contrato próprio | Shopware Rise desde 600 €; Shopify Plus desde 2.100 € |

## 5. Como se sabe se compensa

- **Receita por comerciante** = mensalidade + módulos + partilha de pagamentos
  + serviços.
- **Custo por comerciante**: a infraestrutura pesa pouco — nas configurações
  estudadas, ≈ 18 €/mês no início e ≈ 70 €/mês numa base para muitos
  comerciantes, na VPS da OVH (`10-estimativa-prazo-e-custo.md` §8,
  recalculado a 04/10/2026; na Scaleway gerida eram ≈ 234 e ≈ 710 €/mês,
  `memoria/alojamento-e-custos-03out2026.md`) —, mais suporte e IA.
- **Ponto de equilíbrio** = custos fixos por mês (equipa, contabilistas e
  juristas por país, seguro) ÷ margem por comerciante.
- **Os custos fixos estão estimados na D-13** (`10-estimativa-prazo-e-custo.md`
  §8, 03/10/2026; recalculados a 04/10/2026 com a VPS e com o GitHub Pro, que levou o mínimo de
  ≈ 9.940 a ≈ 9.950 €): ≈ 9.950–14.230 €/mês
  com 2 programadores e ≈ 14.910–21.310 €/mês com 3, sem contabilista,
  jurista, seguro nem suporte (com a Scaleway eram ≈ 10.150–14.870 € e
  ≈ 15.110–21.950 €). Exemplo de conta (hipótese, não é preço): a 100 € de
  margem média por comerciante e por mês, são precisos ≈ 100–140 comerciantes
  (≈ 150–210 com 3 programadores; eram ≈ 100–150 e ≈ 150–220). **Decidido a seguir o cenário A** (ADR-0008, sem contratar):
  sai em dinheiro só o alojamento e as subscrições, mas o tempo do Diogo e do
  Bruno não está contado — sem lhe pôr valor, o ponto de equilíbrio não se
  calcula.

## 6. Regras europeias e fiscais da receita do próprio Eurolify

| Tema | O que obriga | Verif. |
|---|---|---|
| Faturas do Eurolify aos comerciantes | A Luckytarget fatura em software certificado, como qualquer comerciante (D-4) | **C** |
| IVA das mensalidades | Comerciante português: IVA português. Comerciante de outro país da UE com NIF válido no VIES: sem IVA, autoliquidação pelo cliente (art. 44.º e 196.º da Directiva IVA). Sem NIF válido: a ver com contabilista | **W** ([EUR-Lex](https://eur-lex.europa.eu/LexUriServ/LexUriServ.do?uri=OJ:L:2008:044:0011:0022:EN:PDF), resumo) + contabilista |
| Comissões recebidas (Mollie, loja de extensões) | Tratamento de IVA a confirmar | **C** — contabilista |
| Mudar de fornecedor (Data Act) | Sem custos de saída a partir de 12/01/2027; aviso máximo de 2 meses; transição até 30 dias; os direitos de mudança escritos no contrato (art. 25.º e 29.º) | **W** ([DLA Piper](https://www.dlapiper.com/en-us/insights/publications/law-in-tech/2026/cloud-exit-under-the-eu-data-act), [Latham](https://www.lw.com/en/insights/eu-data-act-significant-new-switching-requirements-due-to-take-effect-for-data-processing-services), resumos) |
| DAC7 na loja de extensões | A DAC7 cobre venda de bens, serviços pessoais e aluguer de imóveis e transportes; vender extensões não parece estar incluído | **C** — confirmar |

## 7. O que falta para decidir a D-14

1. Falar com 3 a 5 comerciantes: quanto pagam hoje (plataforma + extensões de
   faturação + contabilista) e o que pagariam por não errar faturas.
2. ~~A estimativa de custos (D-13).~~ Feita a 03/10/2026 (`10-estimativa-prazo-e-custo.md`); equipa decidida (ADR-0008). Falta pôr um valor ao tempo do Diogo e do Bruno.
3. Confirmar com a Mollie as condições reais (Connect e programa de parceiros).
4. Contabilista: IVA das mensalidades e das comissões.
5. Jurista: margem sobre pagamentos às claras; contrato com o Data Act.

## O que ficou por verificar

- A repartição da receita do Shopify foi lida num resumo do relatório anual,
  não no documento.
- Os escalões de volume do Shopware não são públicos (a página só diz que o
  preço depende do volume de vendas).
- As percentagens do programa de parceiros da Mollie (10 % a 20 %) vêm de um
  resumo de pesquisa; a página do programa deu erro 404.
- Que existam programas de partilha de receita com transportadoras.
- O enquadramento legal de uma margem da plataforma sobre os pagamentos.
