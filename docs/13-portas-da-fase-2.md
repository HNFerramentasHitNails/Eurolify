# Os módulos da Fase 2 pelas 8 portas

> **Versão de 03/10/2026.** As 8 portas estão na skill `platform-architect`
> («Antes de construir um módulo: as 8 portas»). Este documento aplica-as aos
> módulos da Fase 2 de [`05-fases-e-mvp.md`](05-fases-e-mvp.md), com o custo
> de [`10-estimativa-prazo-e-custo.md`](10-estimativa-prazo-e-custo.md)
> (pessoas-semana, **C**) e a prova de
> [`04-licoes-dos-sistemas-actuais.md`](04-licoes-dos-sistemas-actuais.md)
> (números medidos nos sistemas actuais, com a data de lá). **Não decide nada**:
> construir ou não, e mudar de fase, decide o Diogo ou o Bruno.
>
> ✅ **04/10/2026:** as três propostas de mudança de fase foram aceites pelo
> Diogo (decisão AD, [ADR-0022](adr/0022-tres-pecas-da-fase-2-para-a-fase-1.md)).
>
> ➕ **11/10/2026:** a gestão da empresa inteira entra a partir da Fase 2, em
> módulos ligáveis (decisão DR,
> [ADR-0042](adr/0042-gestao-da-empresa-em-modulos-da-fase-2.md)). Os módulos
> novos — camadas B a H do
> [`31-hub-de-gestao-da-empresa.md`](31-hub-de-gestao-da-empresa.md) §8 —
> passam por estas portas antes de serem desenhados; o `docs/31` §4 dá a
> natureza e o estado de cada um. **O primeiro, o balcão (POS), passou a
> 11/10/2026: §7.**

**Legenda:** ✅ passa · ◐ em parte · ❌ falha · ❔ não se sabe.

## 🔴 O que vale para todos: portas 3 e 4 sem prova

Nenhum comerciante foi ouvido (`05-fases-e-mvp.md`: «Conversas com 3 a 5
comerciantes — por fazer»). Por isso **a porta 3 (já se gasta dinheiro nisto)
e a porta 4 (chegamos a 50 compradores) dão «não se sabe» em todos os
módulos**. As saídas abaixo apoiam-se na experiência dos sistemas actuais
(porta 1) e nos prazos da lei — não na procura do mercado. As lojas do próprio
grupo contam como **um** comprador.

## Resumo

| Módulo (custo, pessoas-semana) | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | Saída |
|---|---|---|---|---|---|---|---|---|---|
| Armazém completo (8–14) | ✅ | ◐ | ❔ | ❔ | ❌ | ✅ | ◐ | ◐ | **estreitar** |
| Devoluções, nota de crédito, troca e carteira (6–10) | ✅ | ✅ | ❔ | ❔ | ❌ | ◐ | ✅ | ✅ | **estreitar e avançar com o núcleo** |
| Emissão por adaptador noutros países (6–12, dois países) | ◐ | ✅ | ✅ | ❔ | ◐ | ✅ | ❔ | ❔ | **investigar** |
| Relatório OSS com os quatro baldes (4–8, com ligações) | ✅ | ✅ | ❔ | ❔ | ✅ | ✅ | ✅ | ✅ | **avançar** |
| Automações e notificações configuráveis (parte de 8–12) | ❔ | ◐ | ❔ | ❔ | ❌ | ◐ | ❔ | ◐ | **estreitar** |
| Campos personalizados (parte de 8–12) | ❔ | ◐ | ❔ | ❔ | ❌ | ◐ | ◐ | ✅ | **investigar** |
| Balcão (POS), 11/10/2026 (não estimado) | ◐ | ◐ | ◐ | ❔ | ❌ | ◐ | ❌ | ◐ | **estreitar e investigar** (§7) |
| Compras e fornecedores, 11/10/2026 (não estimado) | ✅ | ◐ | ❔ | ❔ | ❌ | ◐ | ◐ | ◐ | **estreitar** (§8) |
| Apoio ao cliente, 11/10/2026 (não estimado) | ◐ | ◐ | ❔ | ❔ | ❌ | ◐ | ◐ | ◐ | **estreitar** (§9) |

**Ficam de fora das portas**, por não serem módulos de produto: o mecanismo de
módulos ligáveis (ver o fim), a migração da loja principal do grupo (um
projecto, com critério já escrito: «se a Fase 1 o justificar»), o programa
dos parceiros convidados (decisão L, já tomada), os ecrãs do Hub e os testes.
O **digital** e os **cartões-oferta** também não estão aqui: têm portas
próprias, nas fatias 12 e 13 de `eurolify/implementation-plan.md` e no §5 de
`eurolify/architecture.md` (ADR-0034).

---

## 1. Armazém completo — vários armazéns, separação, lotes, compostos, inventários

| Porta | Resultado | Porquê |
|---|---|---|
| 1 Por dentro | ✅ | A loja vendeu stock já prometido: 216 de 1.259 artigos (16/09/2026, lição 3.1); baixas a dobrar em 145 encomendas (3.2); componentes dos kits, 40 % das saídas, sem lote (3.4) |
| 2 Não resolvido | ◐ | A Fase 1 tem um armazém. Quem tem sistema de gestão gere lá o armazém (D-10); a falha é real para quem não tem |
| 3 Gasto | ❔ | O `docs/09` usa o Shopify Advanced (289–384 €) como referência do plano com vários armazéns — é uma comparação nossa, não prova de que alguém pague por isto |
| 4 Compradores | ❔ | — |
| 5 Alvo estreito | ❌ | São cinco coisas num módulo |
| 6 Encaixe | ✅ | Domínio Stock, com o stock a mudar só por movimento (lição 3.2) |
| 7 Custo | ◐ | A maior peça da Fase 2. Justifica-se nos lotes e compostos (dor medida); nos vários armazéns não se sabe |
| 8 Valor depressa | ◐ | Os lotes dão valor no primeiro envio; vários armazéns pedem configuração e transferências |

**Saída: estreitar.** Partir em dois:
- **Lotes na linha expedida e compostos** — é o que permite uma recolha
  (lição 3.4, `product-compliance-eu`). **Proposta:** passar para o núcleo da
  Fase 1.
- **Vários armazéns, separação e inventários** — investigar com os
  comerciantes antes de construir.

## 2. Devoluções ligadas à nota de crédito, estado do artigo, troca e carteira

| Porta | Resultado | Porquê |
|---|---|---|
| 1 Por dentro | ✅ | 91 notas de crédito em 90 dias, **0** devoluções registadas e 0 movimentos de devolução em 44.431 (15/09/2026, lição 3.5); NC parcial a riscar a fatura toda: 134 casos, 95.858,54 € (2.13) |
| 2 Não resolvido | ✅ | O botão de livre resolução entra na Fase 1, mas as «devoluções completas» ficam fora (`05-fases-e-mvp.md`): entre o botão e o reembolso não há fluxo |
| 3 Gasto | ❔ | Nos sistemas actuais gasta-se tempo (as 91 NC à mão); nos comerciantes de fora não se sabe |
| 4 Compradores | ❔ | — |
| 5 Alvo estreito | ❌ | Três coisas: devolução com NC, troca, carteira |
| 6 Encaixe | ◐ | Domínio Devoluções e RMA (`order-fulfilment`). A **carteira** tem tratamento fiscal por validar pelo contabilista (`eu-vat-oss-ioss`, **C**) |
| 7 Custo | ✅ | Proporcional à dor medida; o risco fiscal está coberto pela retenção e pelas filas |
| 8 Valor depressa | ✅ | A primeira devolução tratada já mostra valor |

**Saída: estreitar e avançar com o núcleo** — devolução → estado do artigo →
reembolso → nota de crédito. **Proposta:** passar este núcleo para a Fase 1,
porque o botão de livre resolução já lá está e o reembolso tem de se seguir
(prazo legal de 14 dias, **C** na `consumer-rights-eu`). A **troca** e a
**carteira** ficam na Fase 2; a carteira só depois de o contabilista validar.

## 3. Emissão de faturas por adaptador noutros países

| Porta | Resultado | Porquê |
|---|---|---|
| 1 Por dentro | ◐ | Conhecemos a emissão por software certificado em Portugal (Moloni, lições 2.6 e 2.9); Verifactu e Plateforme Agréée nunca os usámos |
| 2 Não resolvido | ✅ | O software certificado existe em cada país; falta o adaptador (D-4). Serve quem está estabelecido noutro país e não tem sistema de gestão (D-10) |
| 3 Gasto | ✅ | A lei obriga: Verifactu em Espanha a 01/01/2027 (sociedades), Plateforme Agréée em França 2026–2027, Alemanha 2027–2028 (`03-regulamentar-ue.md` §1, **W**) |
| 4 Compradores | ❔ | Nenhum comerciante estabelecido fora de Portugal identificado |
| 5 Alvo estreito | ◐ | O `docs/10` conta dois países; o alvo estreito é **um** país primeiro |
| 6 Encaixe | ✅ | O contrato de faturação só traduz uma decisão já tomada; não decide IVA (decisão K, `08-extensoes-de-terceiros.md`) |
| 7 Custo | ❔ | 6–12 pessoas-semana, mais um contabilista por país e a manutenção quando a lei muda; só compensa com comerciantes desse país |
| 8 Valor depressa | ❔ | Depende de o comerciante já ter conta no software certificado |

**Saída: investigar.** O primeiro país escolhe-se pelos comerciantes que
assinarem, não por nós. Se não houver nenhum, Espanha é a candidata pela data
mais próxima (Verifactu, 01/01/2027). O passo mais pequeno é a porta 4:
nomear comerciantes estabelecidos em Espanha.

## 4. Relatório OSS com os quatro baldes

| Porta | Resultado | Porquê |
|---|---|---|
| 1 Por dentro | ✅ | Ia-se declarar 1.346 € de IVA português no impresso errado (10/08/2026, lição 2.8); uma taxa «VAT PT» serviu Espanha durante meses (2.7) |
| 2 Não resolvido | ✅ | A decisão de IVA de cada linha, com o país de entrega, só existe no Eurolify. **Não verifiquei** se os softwares de faturação dão este relatório |
| 3 Gasto | ❔ | É provável que os comerciantes paguem ao contabilista para o fazer; não verificado |
| 4 Compradores | ❔ | — |
| 5 Alvo estreito | ✅ | Um relatório, um momento (o fecho do período), quem o usa (comerciante e contabilista) |
| 6 Encaixe | ✅ | Domínio fiscal; os dados já lá estão (`eu-vat-oss-ioss`) |
| 7 Custo | ✅ | 4–8 pessoas-semana com as ligações; é leitura, com fecho congelado |
| 8 Valor depressa | ✅ | No primeiro fecho, em minutos |

**Saída: avançar.** E as portas dizem mais: **não é um módulo, é núcleo.** O
Eurolify vende para toda a UE desde a Fase 1 (decisão F), por isso um
comerciante que vende a consumidores de outros países precisa do relatório no
primeiro período. **Proposta:** passá-lo para a Fase 1, em todos os planos
(o `docs/09` põe «relatórios OSS» no plano Europa).

## 5. Automações e notificações configuráveis

| Porta | Resultado | Porquê |
|---|---|---|
| 1 Por dentro | ❔ | Não há caso medido de falta de automações configuráveis; há casos de tarefas automáticas que pararam em silêncio (o recálculo diário, 15 dias), que é outra coisa |
| 2 Não resolvido | ◐ | Ligar a outro sistema já se faz pelos avisos (webhooks) da Fase 1 e pelas aplicações de terceiros (`08-extensoes-de-terceiros.md`) |
| 3 Gasto | ❔ | — |
| 4 Compradores | ❔ | — |
| 5 Alvo estreito | ❌ | «Automações configuráveis» serve tudo e todos |
| 6 Encaixe | ◐ | Só com limites: nunca acções fiscais em lote, nunca código de terceiros fora da caixa fechada (Fase 3) |
| 7 Custo | ❔ | Partilha 8–12 pessoas-semana com os campos e os módulos; cada automação age com permissões e pode parar em silêncio |
| 8 Valor depressa | ◐ | Uma automação pronta (ex.: avisar quando o stock baixa) dá valor em minutos; um construtor genérico não |

**Saída: estreitar.** Começar com 2 ou 3 avisos fixos escolhidos pelos
comerciantes (por exemplo, stock baixo ou documento retido), com as regras das
tarefas automáticas da `observability-security`. O construtor genérico fica
para as funções de terceiros da Fase 3.

## 6. Campos personalizados

| Porta | Resultado | Porquê |
|---|---|---|
| 1 Por dentro | ❔ | Nenhum caso medido |
| 2 Não resolvido | ◐ | Os atributos personalizados dos artigos já estão no catálogo (`catalog-pim`); os campos próprios entram também pelas extensões (`third-party-extensions`) |
| 3 Gasto | ❔ | — |
| 4 Compradores | ❔ | — |
| 5 Alvo estreito | ❌ | «Campos personalizados» em todos os registos |
| 6 Encaixe | ◐ | Um campo com dados pessoais entra no registo de tratamentos, na exportação e no apagamento (`eu-gdpr-privacy`); um campo sensível tem a lista de quem o vê (`observability-security`) |
| 7 Custo | ◐ | Cada campo tem de passar pela API, exportações, linha do tempo e permissões |
| 8 Valor depressa | ✅ | Cria-se um campo em minutos |

**Saída: investigar.** Perguntar aos comerciantes em que registos lhes faltam
campos (clientes? encomendas?) antes de construir.

## 7. Balcão (POS) — o primeiro módulo de gestão da empresa (11/10/2026)

Pedido do Diogo, 11/10/2026: *«passa o primeiro módulo pelas 8 portas»*. É o
primeiro da camada B do [`31-hub-de-gestao-da-empresa.md`](31-hub-de-gestao-da-empresa.md)
§8 (decisão DR, ADR-0042), e já estava na Fase 2 (decidido a 05/10/2026, Q3
do `docs/16`). Skills abertas: `eurolify-physical-retail-eu`,
`eurolify-tax-pos-invoicing-eu`, `eurolify-legal-briefing-eu`
(`references/retail-pos-tax.md`), `eu-vat-oss-ioss`, `consumer-rights-eu`.

**O que o Hub actual faz** (proposta comercial do Hub, p. 9 e 24): venda ao
balcão com PIN pessoal e leitor de código de barras, com as regras de preço e
de faturação da encomenda feita pela equipa; a venda segue o mesmo caminho
até ao documento fiscal que as da loja online (sequência 01 do `docs/31`).

| Porta | Resultado | Porquê |
|---|---|---|
| 1 Por dentro | ◐ | O Hub actual tem o módulo POS em uso (proposta p. 9 e 24): a empresa vende ao balcão. **Não há nenhum caso medido** — procurei «balcão», «POS», «caixa» e «ponto de venda» no `docs/04` e em `memoria/` e não encontrei nenhuma lição nem número sobre o balcão |
| 2 Não resolvido | ◐ | **O POS em si já está resolvido por software certificado**: o próprio Moloni, que o Eurolify vai ligar na fatia 10, tem uma app de POS ([App Store](https://apps.apple.com/pt/app/moloni-pos/id1484656052), descrita como gratuita; condições não lidas), e há POS certificados à venda ([Vendus, planos](https://www.vendus.pt/planos-precos/): 9 €/mês no Base e 22 €/mês no Pro, sem IVA, lidos por pesquisa a 11/10/2026, página ao vivo não aberta). **O que fica por resolver** é a ligação: o mesmo stock, os mesmos preços e a mesma ficha de cliente entre a loja do Eurolify e o balcão, sem vender o que já foi prometido (a lição 3.1 do `docs/04`, medida na loja online, é o mesmo risco) |
| 3 Gasto | ◐ | Os comerciantes com loja física já pagam um POS (preços acima). Não se sabe se alguém paga por ligar o POS ao stock da loja online — nenhum comerciante ouvido |
| 4 Compradores | ❔ | As lojas do próprio grupo contam como um |
| 5 Alvo estreito | ❌ | «POS» para todos junta venda, caixa (abertura, fecho, diferenças), terminal de pagamento, modo sem rede, vários estabelecimentos, recolha de encomendas online e devoluções noutro canal (`eurolify-physical-retail-eu`, pontos 3 a 6) |
| 6 Encaixe | ◐ | **Encaixa** no que existe: catálogo, preços por canal, livro de movimentos e reserva (`docs/27`; um armazém por loja, DE Q1), clientes e perfis. **Não encaixa sem decisões novas:** (a) em Portugal, as faturas só se emitem por software certificado (`docs/03`, linha «Software de faturação certificado pela AT», **C**+**M**) e o Eurolify não o é — um POS do Eurolify teria de emitir pelo adaptador do Moloni, em linha, a cada venda; (b) o modo sem rede «é uma capacidade a aprovar por regime» (`references/retail-pos-tax.md`); (c) a caixa (`pos_fiscal`) não é domínio do motor de regras até haver uma loja que precise (decisão DF); (d) um PIN pessoal é um factor mais fraco do que a passkey ou a palavra-passe com TOTP das contas (`docs/21`, decisão CA); (e) uma venda ao balcão não tem livre resolução por mudança de opinião (`references/retail-pos-tax.md`, fonte Your Europe), por isso não pode reaproveitar o checkout alojado, que é de venda à distância (ADR-0039) |
| 7 Custo | ❌ | Um POS próprio pede caixa e turnos, leitor, impressora de talões, terminal de pagamento por prestador (`eurolify-payment-readiness-eu`), contingência sem rede, permissões finas (vender, desconto manual, abrir caixa, cancelar, reembolsar), acessibilidade dos terminais (`references/retail-pos-tax.md`) e a validação fiscal de cada país — para concorrer com um POS certificado de 9 €/mês |
| 8 Valor depressa | ◐ | Ligar um POS que o comerciante já tem ao stock do Eurolify pode dar valor no primeiro dia; um POS próprio só depois de configurar caixa, terminal e emissão |

**Saída: estreitar e investigar.**

- **Estreitar:** o primeiro alvo **não é um POS do Eurolify**. É a
  **ligação do balcão**: um POS certificado que o comerciante já usa lê do
  Eurolify os artigos, os preços do canal «balcão» e o disponível, e devolve
  cada venda como encomenda desse canal, que baixa o stock pelo livro de
  movimentos. **Quem emite o documento é o POS** — o mesmo princípio da D-10
  (ADR-0041: com sistema de gestão, emite o sistema dele); o Eurolify guarda a
  prova do documento que saiu. Um tipo de comerciante (loja online com um
  balcão, em Portugal), um papel (quem vende ao balcão), um fluxo (venda
  paga ao balcão).
- **Investigar, antes de desenhar** — o passo mais pequeno:
  1. ~~ler a documentação da API do Moloni~~ **feito a 11/10/2026**
     ([`eurolify/fontes-api-moloni-11out2026.md`](eurolify/fontes-api-moloni-11out2026.md),
     14 páginas lidas, nenhum pedido feito). Pela documentação: lêem-se os
     documentos alterados desde uma data (`documents/getModifiedSince`, 50
     por pedido) e as linhas de cada um (`getOne`); o stock lê-se por artigo e
     por armazém e escrevem-se movimentos (`productStocks/insert`); **não há
     avisos** (o Eurolify pergunta de tempos a tempos) nem limites escritos;
     o token dura 1 hora e a renovação 14 dias. **Que a app de POS aparece
     nesses documentos é provável e não verificado** — o passo seguinte é
     um teste na sandbox (conta de demonstração, pedida a `apoio@moloni.pt`),
     com as oito perguntas do §7 desse ficheiro;
  2. falar com 5 comerciantes com loja física e online: que POS usam, e se o
     stock desencontrado lhes custa vendas (portas 3 e 4).
- **O POS próprio** (caixa, terminal, sem rede) fica para quando a ligação
  provar procura e o jurista e o contabilista disserem o que a emissão ao
  balcão exige em cada país (**C**).

Decidir se se avança com esta saída é do Diogo ou do Bruno.

## 8. Compras e fornecedores — o segundo módulo de gestão (11/10/2026)

Pedido do Diogo, 11/10/2026: *«passa o próximo módulo pelas 8 portas»*. É o
seguinte da camada B do `docs/31` §8 que ainda não tinha passado (o armazém
completo passou no §1). Skills abertas: `order-fulfilment`,
`eurolify-finance-reconciliation-eu`, `eurolify-identifiers-traceability-eu`,
`product-compliance-eu` (lotes).

**O que o Hub actual faz** (sequência 04 do `docs/31`; proposta comercial do
Hub, p. 12): alertas de stock abaixo do mínimo e Pareto das vendas → ordem de
compra com fornecedor, artigos, quantidades, datas e cinco estados (rascunho,
encomendada, em trânsito, parcialmente recebida, recebida) → recepção na
própria ordem → aviso de «saída sem entrada» → custo recalculado todas as
noites → inventário por localização. *«Uma ordem de compra é uma intenção; a
fatura do fornecedor é um documento»*: a despesa nasce da fatura, nunca da
ordem.

**O que o Eurolify já tem** (lido no `main` a 11/10/2026): a entrada de
stock `POST /inventory/receipts`, com o lote nas variantes que o exigem e a
origem, que muda o saldo pelo livro de movimentos (`src/stock/rotas.ts`;
`docs/27` §7, R5). **Não há fornecedores**: procurei «fornecedor» e
«supplier» em `apps/api/src` e `apps/api/migracoes` e só aparecem o
fornecedor da IA no rasto e a origem do GTIN.

| Porta | Resultado | Porquê |
|---|---|---|
| 1 Por dentro | ✅ | Lição 3.8 do `docs/04`: **0 de 85 ordens de compra tinham data de pagamento**, e havia dólares lidos como euros (22–23/09/2026) — compras e contabilidade misturadas. O Hub actual tem o módulo em uso (proposta p. 12 e 24) |
| 2 Não resolvido | ◐ | **Em parte resolvido fora:** o Moloni tem Fornecedores, encomendas a fornecedor («Supplier Purchase Order») e faturas de fornecedor no menu da API (`eurolify/fontes-api-moloni-11out2026.md`; não abri essas páginas), e os sistemas de gestão também. **No Eurolify falta** saber de quem veio uma entrada e com que documento do fornecedor: a entrada de hoje tem quantidade, lote e origem, mas não o fornecedor |
| 3 Gasto | ❔ | Nenhum comerciante ouvido; o guião tem a pergunta (`docs/32`, pergunta 13 e a nova 16a) |
| 4 Compradores | ❔ | — |
| 5 Alvo estreito | ❌ | São sete coisas: alertas, Pareto, ordem de compra com cinco estados, recepção, «saída sem entrada», custo, inventário |
| 6 Encaixe | ◐ | **Encaixa** a recepção: é uma entrada no livro de movimentos com o lote, onde o lote do fornecedor nasce (R5). **Não encaixa sem decisões:** (a) o **custo** e a valorização do stock são regras contabilísticas (o método de custeio é do contabilista, **C**; `eurolify-finance-reconciliation-eu`: o Eurolify não certifica contabilidade); (b) a **despesa** é do financeiro (camada D) e nasce da fatura, não da ordem (lição 3.8); (c) um fornecedor identifica-se pelo NIF com o país, nunca pelo nome (`AGENTS.md`, «Não se erra…», regra 6) |
| 7 Custo | ◐ | A recepção com fornecedor é pequena (um registo novo e dois campos na entrada). A ordem de compra com estados, o custo médio e o Pareto são fundos e repetem o que o software de gestão já faz |
| 8 Valor depressa | ◐ | Um aviso de stock abaixo do mínimo dá valor no primeiro dia (é um dos avisos fixos propostos no §5); a ordem de compra só depois de carregar fornecedores e mínimos |

**Saída: estreitar.**

- **Primeiro alvo:** a **recepção com fornecedor**. A entrada de stock que já
  existe passa a dizer de que fornecedor veio (com o NIF e o país) e o número
  do documento dele (guia ou fatura), com o lote do fornecedor. É o que
  responde, numa recolha, «de que lote do fornecedor veio este?»
  (`product-compliance-eu`). Junta-se o **aviso de stock abaixo do mínimo**,
  como um dos avisos fixos do §5. Um tipo de comerciante (quem compra para
  revender, sem sistema de gestão), um papel (o armazém), um fluxo (receber
  mercadoria).
- **Ficam de fora**, até haver prova: a ordem de compra com estados (o Moloni
  e os sistemas de gestão já a têm — investigar nas conversas), o Pareto, o
  custo e a valorização (contabilista, **C**) e a despesa (camada D, da
  fatura do fornecedor).
- Antes de desenhar: as conversas do `docs/32`.

Decidir se se avança com esta saída é do Diogo ou do Bruno.

## 9. Apoio ao cliente — o terceiro módulo de gestão (11/10/2026)

Pedido do Diogo, 11/10/2026: *«passa o próximo módulo pelas 8 portas»*. É o
seguinte da camada B do `docs/31` §8. Skills abertas: `consumer-rights-eu`,
`eu-gdpr-privacy`, `observability-security`, `platform-architect` (tarefas
sobre um registo), `order-fulfilment` (devoluções).

**O que o Hub actual faz** (sequência 09 do `docs/31`; proposta comercial do
Hub, p. 17): formulário do site com assunto e anexos → encaminhamento no
servidor (quem quer comprar como profissional vira lead; um cliente conhecido
vai para o comercial da carteira dele; um novo entra no rodízio da equipa) →
pedido com número, responsável e histórico; dali abre-se um problema da
encomenda ou uma devolução → «Resolver», com o registo do que se fez. *«A
regra de para quem vai este pedido vive numa só função, no servidor.»*

**O que o Eurolify já tem** (lido no `main` a 11/10/2026): o papel `apoio`
nas contas (migração 0018); o apoio regista um pedido de livre resolução que
chegou por outra via, com a prova (`POST /withdrawals`, `docs/30` §7), e abre
devoluções com a origem `apoio` (`docs/30` §3). **Não há pedidos de apoio**
nem tarefas de pessoas: as tabelas `tarefa_*` são filas automáticas
(`docs/31` §3, sequência 09). **Não há envio de e-mails** (`docs/30` §14.1).

| Porta | Resultado | Porquê |
|---|---|---|
| 1 Por dentro | ◐ | O Hub actual tem o módulo em uso (proposta p. 17 e 24). **Nenhum caso medido**: procurei «apoio», «reclama», «caixa de correio» e «ticket» no `docs/04` e não há lição nem número |
| 2 Não resolvido | ◐ | O comerciante resolve hoje por e-mail ou por uma ferramenta de apoio de fora (não verifiquei quais nem quanto custam). **O que falta no Eurolify** é o pedido ligado à encomenda e à ficha do cliente, com responsável e estado, de onde se abre a devolução ou se regista a livre resolução sem copiar dados |
| 3 Gasto | ❔ | Nenhum comerciante ouvido; o guião tem a pergunta (`docs/32`, 16b) |
| 4 Compradores | ❔ | — |
| 5 Alvo estreito | ❌ | Formulário público com anexos, encaminhamento para comerciais e leads (que dependem da camada C, que não existe), rodízio, prazos de resposta, respostas por e-mail |
| 6 Encaixe | ◐ | **Encaixa** nas encomendas, nos clientes e nas «tarefas sobre um registo» desenhadas na `platform-architect` (pessoa, prazo, estado; tarefa vencida avisa). **Cuidados:** (a) mensagens e anexos são dados pessoais — entram na exportação e no apagamento do titular, com prazo de retenção a definir (`eu-gdpr-privacy`); (b) o pedido de apoio **não substitui** a informação RAL nem o Livro de Reclamações electrónico das lojas portuguesas (`docs/03`, linha «RAL e Livro de Reclamações», **C**); (c) uma livre resolução que chegue por uma mensagem de apoio regista-se pelo caminho que já existe, por uma pessoa — o sistema não decide sozinho que uma mensagem é uma livre resolução |
| 7 Custo | ◐ | Um formulário público pede limites contra abuso e cuidado com anexos (`observability-security`); responder ao cliente pede um fornecedor de e-mail, que ainda não há e que tem de ficar na UE (`AGENTS.md`, «Regras da UE», regra 4) |
| 8 Valor depressa | ◐ | Um pedido aberto a partir da encomenda dá valor no primeiro dia; o encaminhamento por carteira só depois de haver comerciais e carteiras |

**Saída: estreitar.**

- **Primeiro alvo:** o **pedido de apoio sobre uma encomenda**, aberto pelo
  cliente na página da encomenda (o mesmo acesso que o botão de livre
  resolução já usa, `/store/orders/{token}`), não num formulário público. Tem
  número, assunto, estado, responsável e linha do tempo, e dele a equipa abre
  uma devolução ou regista uma livre resolução. Um tipo de comerciante (quem
  vende online), um papel (o apoio), um fluxo (dúvida sobre uma encomenda).
- **Depende de:** o envio de e-mails (para responder e confirmar), que ainda
  não existe e é decisão própria (fornecedor na UE).
- **Ficam de fora:** o formulário público com anexos, o encaminhamento para
  comerciais, leads e rodízio (camada C) e os prazos de resposta.
- Antes de desenhar: as conversas do `docs/32`.

Decidir se se avança com esta saída é do Diogo ou do Bruno.

---

## O mecanismo de módulos ligáveis

Não passa pelas portas: é a infra-estrutura dos módulos
(`platform-architect`, «Módulos ligáveis por comerciante»). Pela regra «um
adaptador é uma hipótese, dois tornam a costura real» (do guia de arquitectura
do repositório `mart337i/odoo-skills`, memória
`odoo-skills-avaliado-03out2026.md`), **só compensa construir
o mecanismo quando houver pelo menos dois módulos pagos que passem as
portas**. Hoje, pelo resultado acima, os candidatos são a emissão noutros
países (por país) e os vários armazéns — ambos ainda por investigar.
Com a decisão DR (11/10/2026), os módulos de gestão da empresa juntam-se aos
candidatos, quando passarem as portas.

## O que isto pede ao Diogo ou ao Bruno

1. **Três propostas de mudança de fase** — ✅ **aceites a 04/10/2026** (decisão
   AD, ADR-0022):
   - relatório OSS → núcleo da Fase 1;
   - devolução → reembolso → nota de crédito (sem troca nem carteira) → Fase 1;
   - lotes na linha expedida e compostos → Fase 1.

   Cada uma **aumenta a Fase 1**. Estimadas a 04/10/2026 no `docs/10` (**C**):
   relatório OSS 2–4, núcleo das devoluções 4–7, lotes e compostos 3–5
   pessoas-semana; a Fase 1 passa de 15–29 para 17–32 meses os dois a tempo
   inteiro, a Fase 2 de 9–18 para 7–15.
2. **As conversas com os comerciantes** são o passo que desbloqueia as portas 3
   e 4 em todos os módulos. Perguntas mínimas por módulo:
   - quanto pagam hoje (plataforma, extensões, contabilista) e por quê;
   - quantos armazéns têm e como separam as encomendas;
   - como tratam hoje uma devolução, do pedido à nota de crédito;
   - em que país estão estabelecidos e que software de faturação usam;
   - que avisos automáticos lhes poupariam tempo;
   - que campos lhes faltam e em que registos.

## O que não foi verificado

- Os custos são os do `docs/10`, estimados por julgamento (**C**).
- Os números dos sistemas actuais vêm das memórias de lá, com a data delas; não
  foram medidos outra vez.
- Se os softwares de faturação dão o relatório OSS com os quatro baldes.
- Nenhum comerciante foi ouvido.
