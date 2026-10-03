# Eurolify — proposta para decidir

> **Projecto da Luckytarget Lda.** **Para:** Bruno e Cila · **De:** Diogo
> (preparado com Claude) · **Versão 0.3, 03/10/2026** · **Estado:** proposta. Nenhum código escrito; já
> decididas pelo Diogo a 03/10/2026: vender desde o início (D-1), de raiz
> (D-2), produto nativo para toda a UE (F) e alojamento numa VPS operada por
> nós, com o Claude a operá-la (D-3, revista: ADR-0015 e ADR-0016) — ver `06-decisoes-em-aberto.md`. Os pormenores estão nos outros documentos de `docs/`; este é o que
> se lê primeiro.
>
> O Eurolify é desenvolvido **dentro da Luckytarget**, com marca própria. Os
> sistemas que a empresa já usa (o Hub interno, a loja online, a plataforma de
> formação) serviram **só como fonte de regras e de casos medidos** — nenhuma
> marca existente é usada no Eurolify (decisão do Diogo, 03/10/2026).

## Em uma página

**O que é.** O Eurolify é uma plataforma de comércio electrónico feita na Europa,
para vender na Europa. Tem quatro peças que hoje se compram (ou constroem) em
separado:

1. **Um núcleo de loja acessível por API** — catálogo, preços por país,
   carrinho, checkout, encomendas, stock, pagamentos, envios, devoluções.
   Qualquer frontend se liga a ele: uma loja feita no Lovable, no Vercel, no
   Bolt ou no Emergent, uma app, um balcão.
2. **Um Hub de gestão**, como o Hub interno que a Luckytarget já usa: o sítio onde o comerciante trabalha
   todos os dias — encomendas, clientes, stock, armazém, faturação, devoluções —
   adaptável a cada negócio.
3. **As regras europeias de raiz**: IVA por país, validação de NIF, faturação
   legal em cada país, direitos do consumidor, segurança dos produtos, RGPD.
4. **Aberto a qualquer IA**: o comerciante liga o seu assistente (Claude,
   ChatGPT, Gemini, DeepSeek…) ao Eurolify, e os agentes de compras encontram e
   compram os produtos.

**Porque é preciso — um exemplo da casa.** A lista de isenções de IVA do
Shopify tem 74 opções e **nenhuma** é a isenção de exportação do art. 14.º do
CIVA; para não cobrar IVA a um cliente suíço, a loja actual teve de o pôr em
«não cobrar imposto», que é absoluto — e, à data, um cliente suíço que mandasse
entregar em Portugal deixava de pagar o IVA que devia (medido a 05/08/2026,
`desenho-ecossistema-bruno.md`). O Shopify é americano e trata a Europa como
mais um mercado; o Eurolify trata-a como casa.

**O que recomendo.**

- Construir o Eurolify **como produto** (vários comerciantes na mesma
  plataforma) e **vendê-lo desde a primeira versão** (decisão do Diogo,
  03/10/2026, ADR-0006 — a recomendação inicial era provar primeiro com um
  cliente zero).
- **Nativo para toda a UE desde a raiz** (decisão do Diogo, 03/10/2026): IVA
  dos 27 países e OSS, NIF e VIES, territórios especiais. O que entra país a
  país é a ligação ao software de faturação dos comerciantes de cada país.
- **Não emitir faturas com software próprio** no início: ligar ao software
  certificado de cada país (em Portugal, o Moloni), como o Hub interno já faz.
- **Nunca receber o dinheiro dos comerciantes**: cada um liga a sua conta na
  EuPago, na Stripe ou noutro prestador.
- O checkout e os momentos legais são **do Eurolify**, não de cada frontend.
- Herdar dos sistemas actuais **as regras**, não o código.

**O que se pede agora:** decidir D-1, D-2 e D-3
(`06-decisoes-em-aberto.md`). Sem elas não há estimativa de prazo nem de custo,
e esta proposta **não traz nenhuma** — seria inventá-la.
*Estado a 03/10/2026:* as três decididas — D-1 vender desde o início
(ADR-0006), D-2 de raiz (ADR-0002), D-3 europeu gerido na Scaleway (ADR-0003,
ADR-0004), revista no mesmo dia: VPS operada por nós (ADR-0015, ADR-0016). Depois: a base da receita decidida (ADR-0007) e a estimativa de
prazo e custo feita (`10-estimativa-prazo-e-custo.md`) e a equipa decidida:
o Diogo e o Bruno desenvolvem, com Claude Code e Codex (D-13, ADR-0008).

---

## 1. O problema, visto dos sistemas actuais

Os sistemas que a Luckytarget já usa pagam, todos os meses, o custo de vender na
Europa com uma plataforma que não foi feita para isso. Medido na memória de
trabalho desses sistemas (repo `bruno-88/claude`):

| O que se viu | Quando | O que custou |
|---|---|---|
| O NIF do campo de IVA intra-UE só chegava ao Hub interno **escrito num texto** de um evento da encomenda | 05/08/2026 | Faturas intracomunitárias a decidir por dedução |
| 7 faturas intracomunitárias isentas **sem NIF** | 21/04 → 30/07/2026 | 3.773,09 € em documentos que não podiam sair assim |
| Para vender noutros países, foi preciso construir um **duplicador de lojas Shopify** | lido a 03/10/2026 | Uma loja por país, para manter sincronizada |
| A loja vendeu stock que o Hub interno já tinha prometido a outra encomenda | 16/09/2026 | 216 de 1.259 artigos à venda nessa situação |
| O preço de um artigo vivia em 3 sítios (Hub interno, plataforma de formação, Shopify) | 29/09/2026 | Três sítios para manter iguais |
| A plataforma de formação já está a desenhar a **saída do Shopify** para a EuPago e a Stripe | 29/09/2026 | — é o primeiro passo do que o Eurolify propõe |

E as regras novas não param: o **botão de livre resolução** passou a ser
obrigatório a 19/06/2026, as **embalagens** (PPWR) a 12/08/2026, as regras
contra **alegações ambientais** a 27/09/2026; a fatura electrónica tornou-se
obrigatória na Bélgica e na Polónia em 2026, chega a França (desde 09/2026),
à Alemanha (2027–2028) e a Espanha (Verifactu, 2027); em Portugal o PDF sem
assinatura qualificada deixa de valer como fatura electrónica a 01/01/2027.
Cada loja tem de se adaptar a tudo isto sozinha. Fontes e datas em
[`03-regulamentar-ue.md`](03-regulamentar-ue.md).

## 2. As quatro peças, com mais detalhe

### 2.1 O núcleo por API — a sugestão para «qualquer frontend»

O pedido foi «funcionar com API, ou outra alternativa». **A API é a escolha
certa**, e proponho completá-la com três coisas:

| Peça | Para quem | Porquê |
|---|---|---|
| **API REST com contrato OpenAPI** | qualquer frontend, qualquer integração | É o que o Lovable, o Bolt e os modelos de IA leem melhor para gerar o código que fala com o Eurolify |
| **Checkout alojado pelo Eurolify**, com o aspecto da loja | todos | Um frontend gerado por IA não deve decidir IVA nem mostrar o botão de livre resolução à sua maneira: **a regra vive no servidor** (a lição mais cara dos sistemas actuais) |
| **Avisos automáticos (webhooks) e SDK** | integrações e sistemas de gestão | Quem precisa de saber de uma encomenda é avisado, sem perguntar de 5 em 5 minutos |
| **Pacote para construtores** | Lovable, Vercel, Bolt, Emergent | Instruções prontas a colar para a IA gerar uma loja ligada ao Eurolify |

### 2.2 O Hub do Eurolify

O conceito do Hub interno actual — um sítio que sabe tudo o que se passa e
distribui —
aplicado a qualquer comerciante: catálogo, encomendas, clientes com **vários
perfis de faturação**, stock e armazém, devoluções ligadas às notas de crédito,
faturação, relatórios de IVA (OSS), privacidade. Módulos que cada comerciante
liga ou desliga, campos próprios e automações.

**O que não entra:** assiduidade, marketing editorial, streaming, gráfica —
são de uma empresa, não de uma loja.

### 2.3 As regras europeias de raiz

- **IVA:** a ordem de decisão que o Bruno escreveu para os sistemas actuais
  (primeiro o tipo
  de artigo, depois as excepções, depois o destino, e a entrega em Portugal a
  anular VIES e exportação mas nunca a isenção manual), por país, com a **prova
  guardada no momento da decisão**.
- **Identidade fiscal:** um cliente, vários perfis; NIF com o prefixo do país
  excepto Portugal; validação VIES diária; duplicados decididos por pessoas,
  nunca pelo nome.
- **Faturação:** ligada ao software certificado de cada país; o que tiver um
  problema fica **retido** com o motivo, nunca sai errado.
- **Consumidor:** preço total visível, botão de livre resolução, aviso da
  garantia, histórico de preços para as promoções, páginas legais por país.
- **Produto:** fabricante, pessoa responsável, avisos na língua do país, lotes
  para recolhas, fórmulas com versões (o TPO deixou de poder ser vendido de um
  dia para o outro a 01/09/2025), registos de embalagem por país.
- **Dados:** RGPD com uma régua só de consentimento; sair do Eurolify com os
  dados todos, sem custo.

### 2.4 Aberto a qualquer IA

- **MCP** — a «tomada» que os assistentes de IA usam para se ligarem a
  ferramentas. Na primeira versão só para **consultar** («quanto vendi ontem
  em Espanha?»); mais tarde para preparar trabalho, **sempre com confirmação de
  uma pessoa**. Uma IA nunca emite faturas, reembolsa ou funde clientes.
- **O mesmo contrato OpenAPI** serve os modelos que não falam MCP.
- **Comércio por agentes** (UCP, da Google e da própria Shopify; ACP, da
  OpenAI e da Stripe): numa fase posterior, para um agente de compras poder
  comprar na loja.

## 3. O que o Eurolify **não** é

- **Não é um banco** nem guarda dinheiro de ninguém.
- **Não emite faturas por si** nas primeiras fases.
- **Não é marketplace** — só com um caso de negócio escrito.
- **Não é o Hub interno reembalado.** O Hub interno tem a marca e as regras de
  uma só empresa escritas em 92 ficheiros do ecrã e nunca foi instalado de raiz
  (`proposta-venda-do-hub-30set2026.md`). O Eurolify herda as regras; o Hub
  interno continua e pode ser o primeiro sistema a falar com a API do Eurolify.
- **Não substitui o contabilista nem o jurista.** Tudo o que é fiscal e legal
  tem validação profissional escrita em `03-regulamentar-ue.md`.

## 4. Onde discordo do pedido, e porquê

1. ~~**«Funcionar nativamente com todos os mercados europeus» desde o
   início.**~~ **Fechado a 03/10/2026:** o Diogo pediu-o pela segunda vez e
   ficou decidido — o Eurolify é nativo para toda a UE (`06-decisoes-em-aberto.md`,
   decisão F e D-6). A recomendação «Portugal e Espanha primeiro» saiu. O que
   continua a ter calendário por país é a ligação ao software de faturação
   certificado de quem está estabelecido nesse país (França por uma plataforma
   aprovada, Itália pelo SDI, Polónia pelo KSeF), validada pelo contabilista
   desse país.
2. **«Um hub totalmente funcional como o actual».** Sim ao conceito, não à
   cópia — ver §3.
3. **Uma alternativa ao Shopify para toda a gente.** Já há alternativas
   europeias (o Shopware na Alemanha, o PrestaShop em França). O que o Eurolify
   tem de diferente tem de ser claro: **API para qualquer frontend + Hub de
   gestão + faturação e IVA europeus de raiz + IA**. Sem os primeiros
   comerciantes reais, é uma lista de desejos.
4. **A API sozinha não chega.** O checkout e os momentos legais têm de ser do
   Eurolify — ver §2.1.

## 5. Como um comerciante com sistemas próprios passa a usar o Eurolify

1. O **sistema de gestão que já fatura continua a faturar** e a ser o único que
   fala com o software de faturação; o Eurolify entrega-lhe as encomendas como o
   Shopify faz hoje (D-10).
2. O **catálogo continua a nascer nesse sistema** e é espelhado para o Eurolify
   pela API.
3. Nas lojas do próprio grupo, a primeira é **pequena e contida**, a correr em
   paralelo com o Shopify.
4. A loja principal do grupo só muda depois de a primeira ter três meses de
   vendas sem um documento fiscal errado.
5. O piloto de pagamentos já desenhado para a plataforma de formação (EuPago e
   Stripe, 29/09/2026) segue o seu caminho; o Eurolify reaproveita o desenho.

## 6. Fases

| Fase | O quê | Passa quando |
|---|---|---|
| **0** | Decidir e desenhar — **agora, sem código** | estimativa (D-13) e base da receita (D-14) decididas, OK escrito para código; os preços, antes da peça 13 da Fase 1 (ADR-0012) |
| **1** | Núcleo nativo para a UE, **à venda desde o início** | 3 meses de vendas reais, em todos os comerciantes, sem documento fiscal errado com origem no Eurolify |
| **2** | O Hub do Eurolify + faturação noutros países + parceiros | comerciantes de pelo menos dois países a vender há 3 meses (proposta) |
| **3** | Extensões abertas e comércio por agentes | — |
| **4** | Marketplace, só com caso de negócio | — |

Pormenor em [`05-fases-e-mvp.md`](05-fases-e-mvp.md).

## 7. Riscos

| Risco | Porque é sério | Como se reduz |
|---|---|---|
| **Responsabilidade fiscal por faturas de outras empresas** | Um erro do Eurolify vira uma nota de crédito e um telefonema de um cliente de outro comerciante | Faturação por software certificado; retenção em vez de emissão errada; contrato com limites e seguro; motor de IVA validado pelo contabilista **antes do primeiro comerciante de fora** (vende-se desde o início, ADR-0006) |
| **Âmbito** | Uma plataforma destas tem centenas de peças; o Hub interno actual já tem 420 caminhos de ecrã e 225 funções no servidor (30/09/2026) | Fases com critério de passagem; a faturação de cada país ligada um país de cada vez; fora tudo o que não é de uma loja |
| **Migrar uma loja que já vende** | A loja actual tem 5.262 clientes no Shopify (contados a 29/09/2026, `consentimento-de-marketing-no-hub-29set2026.md`), consentimentos, encomendas a meio | Loja pequena primeiro; corrida em paralelo; consentimentos migrados pela régua única |
| **Concorrência** | Shopify, Shopware, PrestaShop, WooCommerce, motores abertos | Diferença clara (§4.3) e os primeiros comerciantes reais |
| **Equipa e créditos de IA** | Os sistemas actuais já esgotaram créditos de IA (15/09/2026) e o limite semanal de Claude (registado a 29/09/2026) | Estimativa honesta na Fase 0 (D-13); orçamento de IA |
| **Regras a mudar** | PSD3, Digital Fairness Act, ViDA estão a caminho | Mapa regulamentar com datas e revisão trimestral |

## 8. O que não foi verificado nesta proposta

- **Nenhum texto legal foi lido por inteiro**; as datas vêm de pesquisas web a
  03/10/2026 (resumos e títulos das fontes) e estão marcadas como tal.
- Prazos e custos: estimados a 03/10/2026 em `10-estimativa-prazo-e-custo.md`
  (D-13), com o esforço de cada peça por julgamento, sem medição.
- **A marca:** o nome passou a **Eurolify** (antes «Lumavo», que estava ocupado; ADR-0009). Os domínios `.com` e `.eu` estavam livres a 03/10/2026; **a pesquisa de marcas no TMview não foi feita** — tem de ser à mão (D-12).
- As licenças e capacidades da Medusa, Saleor e Vendure vêm de resumos de
  pesquisa; o código não foi lido (D-2).
- Os números dos sistemas actuais vêm da memória de trabalho, com a data de cada um;
  **não foram medidos outra vez**.
- **Não falei com nenhum comerciante** de fora.
