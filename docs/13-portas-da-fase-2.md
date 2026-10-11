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
| Tarefas sobre um registo, 11/10/2026 (não estimado) | ✅ | ◐ | ❔ | ❔ | ❌ | ✅ | ◐ | ✅ | **estreitar e avançar com o núcleo** (§10) |
| Painéis, 11/10/2026 (não estimado) | ◐ | ◐ | ❔ | ❔ | ❌ | ✅ | ✅ | ✅ | **estreitar** (§11) |
| Comercial (camada C), 11/10/2026 (não estimado) | ✅ | ◐ | ❔ | ❔ | ❌ | ◐ | ◐ | ✅ | **estreitar** (§12) |
| Financeiro (camada D), 11/10/2026 (não estimado) | ✅ | ◐ | ❔ | ❔ | ❌ | ◐ | ◐ | ◐ | **estreitar** (§13) |
| Organização (camada E), 11/10/2026 (não estimado) | ◐ | ❌ | ❔ | ❔ | ❌ | ◐ | ❌ | ◐ | **matar como módulo próprio**; duas peças vão para outros sítios (§14) |
| Fabrico (camada F), 11/10/2026 (não estimado) | ✅ | ◐ | ❔ | ❔ | ❌ | ✅ | ◐ | ◐ | **estreitar** (§15) |
| Formação (camada F), 11/10/2026 (não estimado) | ✅ | ◐ | ❔ | ❔ | ❌ | ◐ | ◐ | ◐ | **estreitar**, pela porta da fatia 12 (§16) |
| Marketing e gráfica (camada F), 11/10/2026 (não estimado) | ◐ | ❌ | ❔ | ❔ | ❌ | ◐ | ❌ | ◐ | **matar como módulo próprio**; duas peças vão para o Catálogo (§17) |
| Pessoas (camada G), 11/10/2026 (não estimado) | ◐ | ❌ | ❔ | ❔ | ❌ | ❌ | ❌ | ◐ | **matar como módulo próprio** (§18) |

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
     com as oito perguntas do §7 desse ficheiro. **Testado a 11/10/2026, só
     a ler** (§8 desse ficheiro): as vendas de um terminal de POS lêem-se, com
     `terminal_id`, e cada venda baixa sozinha o stock do Moloni; o token só
     é aceite no endereço; nenhum limite até ~1400 pedidos/minuto. Por
     verificar: o `status` 2 e se os terminais são a app de iPhone. Escrever
     um movimento de stock funciona (testado na conta trial, −2 sobre +5
     deixa 3);
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

## 10. Tarefas sobre um registo — o quarto módulo de gestão (11/10/2026)

Pedido do Diogo, 11/10/2026: *«passa o próximo módulo pelas 8 portas»*. É o
seguinte da camada B do `docs/31` §8. Skills abertas: `platform-architect`
(«Tarefas sobre um registo»), `observability-security` (tarefas que não
param em silêncio), `eu-gdpr-privacy`.

**O que o Hub actual faz** (sequências 08 e 15 do `docs/31`; proposta
comercial do Hub, p. 16 e 23): tarefas com responsável e prazo, recorrentes,
delegáveis; mudar o prazo ou cancelar pede autorização; um cronómetro mede o
tempo gasto; a tarefa de uma devolução fecha-se sozinha quando o caso acaba.

**O que o Eurolify já tem:**
- **o desenho**, na `platform-architect`: uma tarefa liga-se a um registo e tem
  uma pessoa, um prazo e um estado; as filas que pedem decisão humana criam
  tarefas, decididas uma a uma, nunca em lote; uma tarefa vencida avisa quem a
  tem e quem gere a equipa. **Sem código**: as tabelas `tarefa_*` do `main`
  são filas de trabalho automático (`docs/31` §3, sequência 09);
- **quatro filas que esperam por uma pessoa**, cada uma à sua maneira (procurei
  «fila», «dono» e «só uma pessoa» nos `docs/23`, `26`, `29` e `30`):
  - a fila de **diferenças dos pagamentos** (`docs/26` §3.6), a única com um
    campo `dono`;
  - a fila dos **documentos retidos, incertos e divergentes** (`docs/29`), que
    decide quem tem o papel (dono e gestor, Q7), sem dono por linha;
  - a fila de **candidatos a duplicado** de clientes (`docs/23`), sem dono;
  - a lista das **devoluções com o prazo do reembolso a acabar ou passado**
    (`docs/30` §14, `GET /returns?prazo_reembolso=`), sem dono.

| Porta | Resultado | Porquê |
|---|---|---|
| 1 Por dentro | ✅ | O que fica parado sem dono custou caro nos sistemas actuais: renovações que desistiram em silêncio, **14 de 22 subscrições paradas** (07/08/2026, lição 4.2 do `docs/04`); e as decisões fiscais têm de ser linha a linha, por uma pessoa (lições 1.5 e 2.10). O Hub actual tem tarefas em uso (proposta p. 23) |
| 2 Não resolvido | ◐ | As quatro filas existem, mas **sem um sítio comum** que diga «o que me espera hoje» e só uma tem dono. Um gestor de tarefas de fora não se liga aos registos do Eurolify nem respeita as permissões deles |
| 3 Gasto | ❔ | Nenhum comerciante ouvido |
| 4 Compradores | ❔ | — |
| 5 Alvo estreito | ❌ | Tarefas livres em qualquer registo, recorrentes, delegáveis, com cronómetro e projectos |
| 6 Encaixe | ✅ | Está no desenho da `platform-architect` e alimenta-se dos eventos e do rasto (decisão DK); não mexe em regras fiscais nem legais e reforça o «nunca em lote». Uma tarefa sobre um cliente é dado pessoal: entra na exportação e no apagamento do titular, e só a vê quem pode ver o registo |
| 7 Custo | ◐ | Uma tabela de tarefas e uma ligação por fila. O aviso por e-mail depende do envio de e-mails, que ainda não há; até lá, o aviso fica no Hub e como evento |
| 8 Valor depressa | ✅ | O primeiro documento retido ou a primeira diferença de pagamento ganha logo um dono e um prazo, sem configurar nada |

**Saída: estreitar e avançar com o núcleo.**

- **Primeiro alvo:** as **tarefas das filas que já pedem uma pessoa** — as
  quatro de cima. Cada item ganha **dono, prazo e estado**, numa lista comum
  («a decidir»), e **avisa ao vencer** (no Hub e como evento; por e-mail
  quando houver). A decisão continua a fazer-se no ecrã de cada fila, uma a
  uma; a tarefa só diz quem e até quando. Um papel (quem decide filas: dono e
  gestor), um fluxo (decidir o que está retido ou em diferença).
- **Proposta, como a decisão AD (ADR-0022):** passar este alvo para a
  **Fase 1**. A Fase 1 já cria estas filas, e o critério de passagem dela (três
  meses sem documento fiscal errado) depende de alguém as decidir a tempo. A
  estimativa (`docs/10`) não o conta — fica por estimar.
- **Ficam de fora:** tarefas livres, recorrência, delegação, cronómetro e
  projectos (camada E).
- Este alvo **não precisa das conversas** com os comerciantes para se
  desenhar: a dor e o encaixe vêm das filas que o próprio Eurolify já criou.

Decidir se se avança, e se passa para a Fase 1, é do Diogo ou do Bruno.

## 11. Painéis — o quinto módulo de gestão, o último da camada B (11/10/2026)

Pedido do Diogo, 11/10/2026: *«passa o próximo módulo pelas 8 portas»*.
Skills abertas: `headless-commerce` (MCP e API de leitura),
`eurolify-finance-reconciliation-eu`, `eu-vat-oss-ioss` (valores com e sem
IVA), `observability-security` (isolamento).

**O que o Hub actual faz** (proposta comercial do Hub, p. 4, 18 e 24): painéis
de cada módulo com os números do dia e do mês; metas por comercial e por
equipa e painéis de vendas diários; para a direcção, «painéis, metas e o
registo de tudo o que muda».

**O que o Eurolify já tem** (lido no `main` a 11/10/2026): **nenhuma rota de
números**. Procurei rotas com `reports`, `relatorios`, `dashboard`, `stats` e
`resumo` em `apps/api/src` e não há. O `apps/mcp` do repositório é o MCP da
VPS (ADR-0033: medições e acções de operação), **não** o MCP de leitura para
os comerciantes, que está no âmbito da Fase 1 (`docs/05`) e responderia a
«quanto vendi ontem em Espanha?» (`docs/00` §2.4). O relatório OSS é a parte
3 da fatia 10, por fazer.

| Porta | Resultado | Porquê |
|---|---|---|
| 1 Por dentro | ◐ | O Hub actual tem painéis em uso (proposta p. 24). **Não há lição sobre a falta deles**; há sobre números errados: o «corte das 1.000» fez a pesquisa dizer «não existe» a **40 % das fichas** (12/08/2026, lição 4.7 do `docs/04`) — um painel que corta ou mistura em silêncio engana mais do que não ter painel |
| 2 Não resolvido | ◐ | O comerciante pode tirar números por exportação ou por uma ferramenta de análise de fora — mas a exportação de hoje só tem o catálogo (decisão CS) e não há nenhuma rota de números. **Falta** saber, no Eurolify, quanto se vendeu |
| 3 Gasto | ❔ | Nenhum comerciante ouvido |
| 4 Compradores | ❔ | — |
| 5 Alvo estreito | ❌ | «Painéis de cada módulo» são tantos painéis quantos módulos, mais metas por pessoa e por equipa |
| 6 Encaixe | ✅ | Só lê. Fica no comerciante pelo RLS. **Cuidado de desenho:** «vendas» são quatro números diferentes — encomendado, pago, faturado e devolvido — e cada um com e sem IVA; o painel diz sempre qual mostra e como foi contado (instruções da organização: «um número só vale acompanhado da pergunta a que responde e de como foi contado»). As comissões e as metas contam-se sobre o faturado, nunca sobre o encomendado (proposta p. 18) |
| 7 Custo | ✅ | Consultas de leitura sobre o que já existe; sem regras fiscais novas. O cuidado é o tempo de resposta quando houver muitas encomendas — medir antes de pré-calcular |
| 8 Valor depressa | ✅ | As vendas de ontem aparecem no primeiro dia, sem configurar nada |

**Saída: estreitar.**

- **Primeiro alvo:** **as vendas do dia e do mês**, por canal e por mercado:
  encomendado, pago, faturado e devolvido, cada um **com e sem IVA**, e cada
  número com a frase do que conta (ex.: «pago: encomendas com o pagamento
  capturado entre 00:00 e 23:59 de ontem, no fuso do comerciante»). Um papel
  (o dono e o gestor), um fluxo (ver como correu ontem e o mês).
- **Uma consulta só, dois clientes:** a mesma função da API serve o painel do
  Hub e o MCP de leitura da Fase 1 — o número que o ecrã mostra e o que a IA
  responde vêm do mesmo sítio (`AGENTS.md`, «Uma regra, um sítio»).
  **Proposta:** fazer a consulta na Fase 1, com o MCP de leitura; o ecrã do
  painel na Fase 2.
- **Ficam de fora:** os painéis de cada módulo, as metas e os painéis por
  comercial (camada C).

Decidir se se avança com esta saída é do Diogo ou do Bruno.

## 12. Comercial — a camada C, como um módulo (11/10/2026)

Pedido do Diogo, 11/10/2026: *«passa o próximo módulo pelas 8 portas»*. A
camada C do `docs/31` §8 passa como **um** módulo, como o «Comercial» do Hub
actual (proposta p. 24): leads e prospecção, chamadas do dia, saúde da
carteira, encomenda feita pela equipa, comissões e metas. Skills abertas:
`eu-gdpr-privacy`, `consumer-rights-eu`, `eurolify-b2b-channels-eu`,
`headless-commerce` (checkout alojado), `eurolify-contracts-operations-eu`
(emprego).

**O que o Hub actual faz** (sequência 10 do `docs/31`; proposta comercial do
Hub, p. 18; apresentação p. 4): leads distribuídos pelos comerciais;
prospecção por etapas (um lead perdido exige motivo; um seguimento tem dia e
hora); **Chamadas do Dia** — todas as madrugadas, a lista de cada comercial a
partir do ritmo de compra de cada cliente, só de quem tem telefone ou e-mail;
saúde da carteira por recência, frequência e valor (activo, em risco,
perdido); **Nova Encomenda** com os preços e descontos do cliente e uma
ligação de pagamento, que segue o mesmo caminho das vendas da loja;
comissões **sobre o faturado**, em cartões mensais; metas e painéis.

**O que o Eurolify já tem** (lido no `main` e nos desenhos a 11/10/2026):
fichas de cliente com etiquetas (migração 0037); listas de preços B2B por
etiqueta na Fase 1 (`docs/20` §3.6); o consentimento por contacto e por canal
(decisão DL); o carrinho e o checkout alojado — mas **o carrinho só nasce pela
API da Loja**, com a chave pública da loja (`POST /store/carts`, `docs/25`
§8.1): não há caminho para uma pessoa da equipa preparar uma encomenda para
um cliente. A relação comercial e os contratos são a fatia 14 (por fazer).

| Porta | Resultado | Porquê |
|---|---|---|
| 1 Por dentro | ✅ | Lição 3.1 do `docs/04`: a loja vendeu **2 coleções já prometidas a uma encomenda comercial**, com **216 de 1.259** artigos à venda nessa situação (16/09/2026) — a encomenda da equipa e a da loja não partilhavam a reserva. Lição 5.5: o preço vivia em **3 sítios**. O Hub actual tem o módulo em uso (proposta p. 18 e 24) |
| 2 Não resolvido | ◐ | Há programas de gestão de clientes (CRM) de fora — não verifiquei quais nem quanto custam —, mas não reservam stock nem usam os preços e o IVA do Eurolify. **No Eurolify falta** a encomenda feita pela equipa: hoje só o cliente cria um carrinho |
| 3 Gasto | ❔ | Nenhum comerciante ouvido; o guião tem a pergunta (`docs/32`, 13 e a nova 16c) |
| 4 Compradores | ❔ | — |
| 5 Alvo estreito | ❌ | Sete coisas: leads, etapas, chamadas do dia, carteira, encomenda da equipa, comissões, metas |
| 6 Encaixe | ◐ | **Encaixa** a encomenda da equipa: um carrinho preparado por uma pessoa da equipa, pago pelo cliente no **checkout alojado** (ADR-0039) — os preços, o IVA, a reserva no botão final (DE Q2) e os momentos legais são os mesmos da loja. **Não encaixa sem análise:** (a) as **chamadas do dia** e a **saúde da carteira** são perfis de compra usados para contactar pessoas — base legal, direito de oposição e as regras de contacto para vender, sobretudo a consumidores, são **C** (`eu-gdpr-privacy`; ePrivacy e lei de cada país; jurista); (b) as **comissões** são remuneração de trabalhadores (direito do trabalho e fiscal de cada país, **C**; `eurolify-contracts-operations-eu`) e contam-se sobre o documento emitido, que depende da fatia 10 |
| 7 Custo | ◐ | A encomenda da equipa é pequena: uma rota de Administração que cria um carrinho para um cliente e devolve a ligação do checkout. As chamadas do dia e a carteira pedem tarefas de noite e a análise legal; as comissões pedem regras por comerciante e validação profissional |
| 8 Valor depressa | ✅ | A primeira encomenda feita ao telefone sai paga pelo checkout, no primeiro dia |

**Saída: estreitar.**

- **Primeiro alvo:** a **encomenda feita pela equipa**. Uma pessoa da equipa
  (papel com âmbito próprio) prepara o carrinho para um cliente, com os
  preços da lista dele, e o Eurolify devolve **a ligação do checkout
  alojado**, que a pessoa envia ao cliente. O cliente vê o preço total, as
  condições e paga; a reserva acontece no botão final, como numa compra da
  loja; o rasto guarda **quem preparou** (o que, mais tarde, serve às
  comissões). Um papel (o comercial), um fluxo (uma venda por telefone ou
  mensagem).
- **Investigar antes de desenhar:** as chamadas do dia e a saúde da carteira
  (com o jurista: base legal e contacto para vender) e as comissões (com o
  jurista e o contabilista).
- **Ficam de fora:** leads, etapas de prospecção e metas, até as conversas do
  `docs/32` dizerem que pesam.

Decidir se se avança com esta saída é do Diogo ou do Bruno.

## 13. Financeiro — a camada D, como um módulo (11/10/2026)

Pedido do Diogo, 11/10/2026: *«passa o próximo módulo pelas 8 portas»*. A
camada D do `docs/31` §8 passa como **um** módulo, como o «Financeiro» do Hub
actual. Skills abertas: `eurolify-finance-reconciliation-eu`,
`payments-psd2-sca`, `eurolify-payment-readiness-eu`, `eu-vat-oss-ioss`,
`eu-localization` (moeda e câmbio), `eu-gdpr-privacy`.

**O que o Hub actual faz** (sequência 14 do `docs/31`; proposta comercial do
Hub, p. 22; apresentação p. 3): a fatura do fornecedor em PDF ou fotografia →
**leitura por IA** que propõe fornecedor, data, número, valores, taxas de IVA
e categoria → uma pessoa confirma, corrige ou rejeita → saldos dos meios de
pagamento e extractos bancários importados, cada movimento ligado ao que o
explica → duplicados assinalados de noite; apagar pede aprovação → documentos
por emitir → tesouraria, lucro por área, IVA e moeda estrangeira em euros.
*«Um valor provisório nunca entra nas contas como se fosse gasto.»*

**O que o Eurolify já tem** (lido no `main` e nos desenhos a 11/10/2026): a
conciliação **pagamento a pagamento** contra o prestador, com a fila de
diferenças (fatia 8, migração 0044, `docs/26` §3.6). O próprio `docs/26` §1
deixa para «uma fatia financeira futura» **a conciliação com o extracto do
banco e as liquidações do prestador**. Não há despesas.

| Porta | Resultado | Porquê |
|---|---|---|
| 1 Por dentro | ✅ | Lição 3.8 do `docs/04`: **0 de 85 ordens de compra** tinham data de pagamento (22–23/09/2026); lição 4.11: uma despesa de **14.505 USD guardada como euros** (23/09/2026). O Hub actual tem o módulo em uso (proposta p. 22) |
| 2 Não resolvido | ◐ | A contabilidade e o software de faturação do comerciante já tratam despesas e bancos (não verifiquei quais nem como); o Moloni tem faturas de fornecedor no menu da API (`eurolify/fontes-api-moloni-11out2026.md`). **No Eurolify falta** saber se o dinheiro das vendas chegou ao banco: o que o prestador liquidou, com que taxas e reembolsos, e em que depósito |
| 3 Gasto | ❔ | Nenhum comerciante ouvido |
| 4 Compradores | ❔ | — |
| 5 Alvo estreito | ❌ | Despesas com IA, bancos, conciliação, duplicados, documentos por emitir, tesouraria, lucro por área, IVA e câmbio |
| 6 Encaixe | ◐ | **Encaixa** a conciliação das vendas com as liquidações: é a continuação da fatia 8, e a skill já diz o que conciliar (bruto, desconto, imposto, envio, taxa, reembolso, estorno e líquido depositado, ponto 3). **Não encaixa sem decisões:** (a) **a leitura por IA** manda faturas de fornecedores a um modelo de IA — se o fornecedor do modelo estiver fora da UE e houver dados pessoais (um fornecedor empresário em nome individual, por exemplo), precisa de decisão escrita e acordo de transferência (`AGENTS.md`, «Regras da UE», regra 4); e a proposta da IA fica sempre por confirmar por uma pessoa (ADR-0040, no espírito); (b) **ligar às contas bancárias do comerciante por API** pode ser um serviço de pagamento regulado (informação sobre contas) — **não verifiquei, C**; um ficheiro de extracto carregado pelo comerciante não o é; (c) o **lucro por área** pede o custo do stock, que é regra do contabilista (§8, **C**); o Eurolify não faz lançamentos contabilísticos nem certifica contas (skill, último parágrafo) |
| 7 Custo | ◐ | A conciliação das liquidações é média: cada prestador tem o seu relatório; a EuPago primeiro (não verifiquei se a API dela dá as liquidações). Os bancos, a IA e a tesouraria são fundos |
| 8 Valor depressa | ◐ | A primeira liquidação conciliada mostra logo uma taxa ou um reembolso que não batia; mas pede o relatório do prestador ou o extracto carregado |

**Saída: estreitar.**

- **Primeiro alvo:** a **conciliação das liquidações** — o que a fatia 8
  deixou para depois (`docs/26` §1). O comerciante carrega o relatório de
  liquidações do prestador (ou o Eurolify lê-o pela API do prestador, se
  houver) e o extracto do banco; cada depósito liga-se aos pagamentos, taxas
  e reembolsos que o explicam, e o que não bate vai para a fila de diferenças
  que já existe, com motivo, dono e prova. Montantes sempre com a moeda (e a
  taxa e a data, se houver câmbio, lição 4.11). Um papel (o dono ou o
  financeiro), um fluxo (confirmar que o dinheiro das vendas chegou).
- **Investigar antes de desenhar:** as **despesas com leitura por IA** (onde
  corre o modelo e com que acordo — regra 4; a confirmação por uma pessoa) e
  a **ligação directa aos bancos** (se é serviço regulado, **C**).
- **Ficam de fora:** a tesouraria, o lucro por área, os documentos por emitir
  (já são da fatia 10) e o IVA de importação.

Decidir se se avança com esta saída é do Diogo ou do Bruno.

## 14. Organização — a camada E, como um módulo (11/10/2026)

Pedido do Diogo, 11/10/2026: *«passa o próximo módulo pelas 8 portas»*. A
camada E do `docs/31` §8 passa como **um** módulo: projectos, procedimentos e
objectivos, comunicação interna, e o que o Hub actual junta a isso (mapas
mentais, pool de ideias, planos de acção, relatórios diários, o assistente
interno). As tarefas sobre um registo já passaram no §10. Skills abertas:
`platform-architect`, `headless-commerce` (MCP), `eu-gdpr-privacy`,
`eurolify-contracts-operations-eu` (trabalhadores).

**O que o Hub actual faz** (sequência 15 do `docs/31`; proposta comercial do
Hub, p. 23 e 24): projectos com modelos, etapas, automações e quadro kanban —
por exemplo, o lançamento de uma colecção, com os passos de cada
departamento; procedimentos por departamento, objectivos e indicadores, mapas
mentais e pool de ideias; um **assistente interno com IA** que responde a
partir dos procedimentos e dos dados e **cria** artigos, tarefas ou pedidos de
ausência a conversar; chat interno, comunicação por destinatários e
calendário partilhado; a governação do sistema (histórico de alterações,
permissões por módulo e grupo, desempenho da base, janela de manutenção).

**O que o Eurolify já tem:** a governação, em boa parte — o rasto de auditoria
com as seis perguntas (decisão DK), as permissões por papel e âmbito
(`/hub/me`, migração 0034), as linhas do tempo. O MCP de leitura para o
assistente **do próprio comerciante** está na Fase 1 (`docs/05`; `docs/00`
§2.4: «o comerciante liga o seu assistente»). Não há projectos, procedimentos
nem chat; e **não há lançamentos agendados** no Catálogo (procurei
«lançamento» e «agendad» no `docs/14`).

| Porta | Resultado | Porquê |
|---|---|---|
| 1 Por dentro | ◐ | O Hub actual tem os módulos em uso (proposta p. 23 e 24). As lições medidas são do **assistente interno**: **185 mil tokens por conversa**, 70 % no catálogo enviado inteiro (15/09/2026, lição 6.1), e o assistente **em baixo por falta de créditos** (15/09/2026, lição 6.3). Para projectos, procedimentos e chat não há lição nem número |
| 2 Não resolvido | ❌ | **Já existe e pode usar-se ou ligar-se.** Projectos, quadros, documentos de procedimentos, chat e calendário são ferramentas de uso geral que qualquer empresa já tem (não verifiquei quais usam os comerciantes); o assistente interno é o que o MCP de leitura da Fase 1 dá ao assistente que o comerciante já usa. O que fica sem resposta lá fora — um projecto ligado aos artigos e às datas de publicação — é uma peça do Catálogo, não um módulo |
| 3 Gasto | ❔ | Nenhum comerciante ouvido |
| 4 Compradores | ❔ | — |
| 5 Alvo estreito | ❌ | Nove coisas num módulo |
| 6 Encaixe | ◐ | A governação encaixa e já existe. **Não encaixa:** um assistente que **escreve** (cria artigos, tarefas, ausências) — na Fase 1 a IA só lê (ADR-0040); um **chat interno** guarda comunicações dos trabalhadores do comerciante, com obrigações de dados pessoais e de trabalho por país (**C**; `eu-gdpr-privacy`, `eurolify-contracts-operations-eu`) |
| 7 Custo | ❌ | Chat, quadros e documentos são produtos inteiros, a concorrer com ferramentas dedicadas, para uma dor sem número |
| 8 Valor depressa | ◐ | Um modelo de projecto pede configuração; o lançamento agendado de uma colecção dá valor no primeiro lançamento |

**Saída: matar como módulo próprio** (falha a porta 2: já existe e pode
usar-se ou ligar-se; e a 7). Duas peças têm valor e mudam de sítio:

- **Lançamentos agendados → Catálogo.** Publicar uma colecção a uma hora
  certa, com aviso a quem agendou se algo falhar (sequência 03 do `docs/31`,
  passo 5; proposta p. 11). É uma lacuna do Catálogo (`docs/31` §3, «Falta»),
  e passa pelas portas como peça do Catálogo, não como projecto.
- **Assistente interno → MCP de leitura** (Fase 1). O comerciante faz as
  perguntas ao assistente dele; a escrita com confirmação humana é da Fase 3
  (ADR-0040). As lições 6.1 e 6.3 já dizem como: a ferramenta devolve um
  índice e não o catálogo inteiro, e há um tecto de gasto com aviso.
- **A governação** já está no rasto e nas permissões; a janela de manutenção
  anunciada e a página de desempenho são da operação da plataforma, não do
  comerciante.
- **Ligar em vez de construir:** um calendário ou uma ferramenta de projectos
  de fora entram, se houver procura, como **extensão de terceiros**
  (`docs/08`), com a regra dos dados na UE (regra 4).

Matar ou não é do Diogo ou do Bruno; a decisão DR põe a camada E no produto,
e estas portas dizem que, como módulo próprio, ela não se paga.

## 15. Fabrico — o primeiro módulo da camada F (11/10/2026)

Pedido do Diogo, 11/10/2026: *«passa o próximo módulo pelas 8 portas»*. A
camada F do `docs/31` §8 junta três sectores diferentes (fabrico, formação,
marketing e gráfica), por isso passam um a um. Este é o **fabrico**:
sequências 05 e 06 do `docs/31`. Skills abertas: `product-compliance-eu`,
`eurolify-sector-compliance-eu`, `eurolify-identifiers-traceability-eu`,
`order-fulfilment` (lotes e movimentos).

**O que o Hub actual faz** (proposta comercial do Hub, p. 13 e 14): fórmula
com versões, lista INCI, ficha técnica e notificação CPNP por artigo;
programação da produção com passos, responsáveis e Gantt; **enchimento com
lote** — o lote do fabricante continua, com um sufixo por enchimento do mesmo
pote, mostrado antes de gravar; registo de fabricação (sai a matéria-prima,
entra o produto acabado com lote); discrepâncias entre previsto e produzido;
capacidade por mês e ano; rótulo gerado com versão e aprovação do responsável
técnico; DataMatrix com artigo, validade e lote; montagem de colecções como um
picking; *«que clientes receberam o lote X?»* com resposta imediata.

**O que o Eurolify já tem** (lido no `main` e nos desenhos a 11/10/2026):
lotes na entrada e na linha expedida e kits pelos componentes (migrações 0004
e 0047; decisão AD). **Não há fórmulas nem produção**: procurei «formula»,
«fabric» e «producao» nas migrações e não há. A skill `product-compliance-eu`
já desenha as fórmulas («Fórmulas com versões — o caso que o prova»): o artigo
aponta para uma versão de fórmula com o seu INCI, o lote sabe que versão leva,
e uma substância proibida numa data dá a consulta imediata de artigos, lotes,
stock e encomendas por expedir.

| Porta | Resultado | Porquê |
|---|---|---|
| 1 Por dentro | ✅ | **O TPO** foi proibido nos cosméticos a **01/09/2025, sem período de escoamento** (Reg. (UE) 2025/877, `docs/03`, **W**): o que estava em stock deixou de se poder vender de um dia para o outro. No Hub actual, o fornecedor troca fórmulas e os SKU mantêm-se (skill, mesma secção). Lição 3.4 do `docs/04`: os componentes dos kits, **40 % das saídas**, saíam sem lote |
| 2 Não resolvido | ◐ | Há programas de gestão de produção de fora (não verifiquei quais nem quanto custam). **No Eurolify falta** a versão da fórmula no artigo e no lote — e serve também quem **não fabrica**: um revendedor cujo fornecedor muda a fórmula de um artigo com o mesmo SKU |
| 3 Gasto | ❔ | Nenhum comerciante ouvido |
| 4 Compradores | ❔ | — |
| 5 Alvo estreito | ❌ | Fórmulas, programação, enchimento, registo de fabricação, discrepâncias, capacidade, rótulos, DataMatrix, colecções |
| 6 Encaixe | ✅ | A versão da fórmula está desenhada na `product-compliance-eu`; o registo de fabrico cabe no livro de movimentos (saída dos lotes de matéria-prima, entrada do lote acabado ligado a eles). **Cuidados:** a notificação CPNP, a pessoa responsável e a avaliação de segurança são do comerciante — o Eurolify guarda a prova, nunca diz que um produto está «conforme» (skill); o conteúdo do rótulo de um cosmético é **C** (`docs/03`, linha «Cosméticos»); GTIN e DataMatrix não são obrigatórios para todos os produtos (`eurolify-identifiers-traceability-eu`) |
| 7 Custo | ◐ | A versão da fórmula é pequena e ligada ao Catálogo e aos lotes. O registo de fabrico é médio. A programação, o Gantt e a capacidade são um programa de produção inteiro |
| 8 Valor depressa | ◐ | A consulta «que lotes e que encomendas levam esta versão» dá valor no primeiro aviso de uma substância; pede que o comerciante tenha carregado as fórmulas |

**Saída: estreitar.**

- **Primeiro alvo:** a **versão da fórmula** no artigo e no lote, como a
  skill já desenha — com o INCI e a data de cada versão; o lote diz que versão
  leva; e, quando uma substância passa a proibida numa data, a consulta dos
  artigos, lotes, stock e encomendas por expedir afectados, com o bloqueio da
  venda **decidido por uma pessoa**. Serve quem fabrica e quem revende. Um
  sector (cosméticos), um papel (o responsável técnico), um fluxo (a fórmula
  muda ou uma substância é proibida).
- **Depois, se houver procura:** o **registo de fabrico mínimo** — consumir
  lotes de matéria-prima e dar entrada ao lote do produto acabado, ligado aos
  de origem, pelo livro de movimentos. A regra do nome do lote (o sufixo por
  enchimento) é configuração do comerciante.
- **Investigar:** os rótulos com versão e aprovação e o DataMatrix (conteúdo
  do rótulo **C**; identificadores pela skill).
- **Ficam de fora:** a programação, o Gantt, as discrepâncias e a capacidade.

Decidir se se avança com esta saída é do Diogo ou do Bruno.

## 16. Formação — o segundo sector da camada F (11/10/2026)

Pedido do Diogo, 11/10/2026: *«passa o próximo módulo pelas 8 portas»*. É a
**formação**: sequência 07 do `docs/31`, os módulos «Pedagógico», «Academia»,
«Eventos» e «Portal do Formador» do Hub actual. Skills abertas:
`digital-products-eu`, `consumer-rights-eu`, `eu-vat-oss-ioss`,
`payments-psd2-sca` (prestações), `eurolify-contracts-operations-eu`
(formadores).

**O que o Hub actual faz** (proposta comercial do Hub, p. 15): a inscrição
paga na academia avisa o Hub, que encontra ou cria a ficha do aluno, liga o
perfil de faturação e regista a venda, sem duplicar se o aviso chegar duas
vezes → o IVA vem do artigo (uma formação isenta sai isenta; um bilhete de
evento leva IVA) → prestações acompanhadas → kits de formação pedidos por
turma, como encomenda normal → cancelamento que viaja (anula a fatura e apaga
o rascunho; o que falha fica como falha) → comissões dos formadores quando a
inscrição está 100 % faturada → fecho da turma com o valor a pagar ao
formador → leads e avaliações.

**O que o Eurolify já tem:** a **fatia 12 (digital: conteúdo e serviço)**
desenhada e **desligada até à sua porta** (ADR-0034;
`eurolify/implementation-plan.md`: «os 16 testes da skill; jurista e
contabilista; fornecedor perante o IVA decidido»). A skill
`digital-products-eu` distingue o **serviço humano prestado à distância**
(formação ao vivo) do conteúdo digital. O `docs/03` já tem cinco regras
destes serviços, todas **W** por citação de pesquisa, texto não aberto (lugar
da prestação de eventos e ensino; o ensino ao vivo por vídeo não é serviço
electrónico; o bilhete como documento em PT; sem livre resolução nas
actividades de lazer com data; o serviço começado dentro do prazo). A isenção
de IVA da formação só aparece como o código `M07` (art. 9.º) no `docs/24`,
**C**. Os kits já existem (migração 0004).

| Porta | Resultado | Porquê |
|---|---|---|
| 1 Por dentro | ✅ | A plataforma de formação do grupo é um dos sistemas actuais: o preço vivia em **3 sítios**, um deles a plataforma de formação (lição 5.5 do `docs/04`); a pesquisa da academia dizia «não existe» a **40 % das fichas** pelo corte das 1.000 (12/08/2026, lição 4.7); a Klarna representou **58 pagamentos e 28.305 €** em 90 dias na plataforma de formação (lição 5.4) |
| 2 Não resolvido | ◐ | As plataformas de cursos já existem (não verifiquei quais nem quanto custam) e o próprio grupo usa uma. **O que falta** é vender a inscrição com o IVA, a livre resolução e o documento fiscal certos, e o kit na mesma encomenda — o que a fatia 12 desenha |
| 3 Gasto | ❔ | Fora do grupo, nenhum comerciante ouvido |
| 4 Compradores | ❔ | As lojas do grupo contam como um |
| 5 Alvo estreito | ❌ | Inscrições, plataforma de cursos, prestações, kits por turma, cancelamentos, comissões dos formadores, fecho da turma, leads e avaliações |
| 6 Encaixe | ◐ | **Encaixa** na fatia 12 e nos kits. **Cuidados:** (a) as regras são todas **W** ou **C** — a isenção da formação, o IVA do bilhete, o lugar da prestação e a livre resolução de cada caso precisam do contabilista e do jurista (a porta da fatia 12); (b) **um documento emitido não se apaga**: no Eurolify, cancelar uma inscrição já faturada dá uma nota de crédito pela fila, por uma pessoa (`docs/29`), não «anula a fatura» como no Hub actual; (c) **as prestações** podem ser crédito ao consumidor — não verifiquei, **C**; (d) **as comissões dos formadores** são remuneração (**C**, como no §12) |
| 7 Custo | ◐ | A inscrição numa formação com data, com o kit, é média e já está desenhada na fatia 12. A plataforma de cursos com progresso, as prestações e as comissões são fundas |
| 8 Valor depressa | ◐ | A primeira inscrição vendida com o kit dá valor no primeiro dia, depois de a porta da fatia 12 abrir |

**Saída: estreitar, pela porta da fatia 12.**

- **Primeiro alvo:** **a inscrição numa formação com data** (presencial ou ao
  vivo por vídeo) vendida como serviço, com o kit físico na mesma encomenda
  quando houver. É uma parte da fatia 12: as mesmas regras, os mesmos testes da
  skill e a mesma porta (contabilista e jurista). Um sector (quem dá formação),
  um papel (quem vende as inscrições), um fluxo (inscrever e pagar).
- **O cancelamento** de uma inscrição faturada segue a pós-venda que já existe
  (nota de crédito pela fila, `docs/29` e `docs/30`), nunca o apagar da fatura.
- **Ficam de fora:** a plataforma de cursos (as aulas, o progresso — o
  comerciante usa a sua, ligada por adaptador como no Hub actual), as
  prestações (**C**), as comissões e o fecho da turma (**C**), e as leads e
  avaliações (camada C).

Decidir se se avança, e quando abre a porta da fatia 12, é do Diogo ou do
Bruno.

## 17. Marketing e gráfica — o terceiro sector da camada F (11/10/2026)

Pedido do Diogo, 11/10/2026: *«passa o próximo módulo pelas 8 portas»*. É a
sequência 11 do `docs/31` e os módulos «Marketing», «Assistente de
marketing», «Streaming», «Formulários» e «Gráfica» do Hub actual (proposta
comercial do Hub, p. 24). A comunicação automática com os clientes (sequência
12) já passou no §5, como automações e notificações. Skills abertas:
`consumer-rights-eu`, `catalog-pim`, `eu-gdpr-privacy`, `eurolify-design`.

**O que o Hub actual faz** (proposta p. 19 e 24): balcão de pedidos de peças
(post, rótulo, folheto) com prazo e destino → fila e calendário por pessoa →
aprovação a dois vistos → calendário editorial por marca e conta →
publicação nas redes sociais, com os comentários e as métricas de volta →
resultados por rede, dizendo também o que não se mede → a gráfica com fila,
máquina, procedimentos e produção; bios e conteúdos com IA; directos nas
redes sem partilhar palavras-passe; inquéritos de satisfação e NPS com envio
automático.

**O que o Eurolify já tem:** a régua do consentimento de marketing por
contacto e canal (migrações 0042 e 0052, decisão DL). Os **feeds para Google,
Meta e comparadores** estão no Catálogo como «fica para depois» (`docs/14` §1).
A regra das **avaliações** está na `consumer-rights-eu` (**W**, texto lido): se
a loja as mostra, diz como garante que vêm de quem comprou; no Eurolify, uma
avaliação liga-se a uma encomenda entregue e nenhuma se esconde por ser
negativa.

| Porta | Resultado | Porquê |
|---|---|---|
| 1 Por dentro | ◐ | O Hub actual tem os módulos em uso (proposta p. 19 e 24). Procurei «marketing», «redes sociais» e «publica» no `docs/04`: nenhuma lição medida sobre marketing |
| 2 Não resolvido | ❌ | **Já existe e pode usar-se ou ligar-se.** Gerir pedidos de peças, calendários editoriais, publicação nas redes e métricas são ferramentas de uso geral, e a fila interna da equipa criativa é gestão de projectos (camada E, que falhou a mesma porta no §14). O que só o Eurolify pode dar é o que está **ligado à loja**: os feeds do catálogo publicado e as avaliações de quem comprou |
| 3 Gasto | ❔ | Nenhum comerciante ouvido |
| 4 Compradores | ❔ | — |
| 5 Alvo estreito | ❌ | Pedidos, filas, aprovações, calendário, redes, métricas, gráfica, IA, directos, inquéritos |
| 6 Encaixe | ◐ | Os feeds e as avaliações encaixam no Catálogo e na pós-venda. **Não encaixa sem cuidados:** (a) **textos de marketing gerados por IA** arriscam alegações ambientais genéricas («eco», «verde»), proibidas sem prova desde **27/09/2026** (Dir. (UE) 2024/825, `docs/03`); (b) os **comentários e as métricas** das redes trazem dados pessoais de quem comenta, vindos de plataformas de fora da UE (`AGENTS.md`, «Regras da UE», regra 4); (c) os inquéritos precisam da régua do consentimento e do envio de e-mails, que não existe |
| 7 Custo | ❌ | Cada rede social é uma integração que muda com frequência, para um trabalho que as ferramentas dedicadas já fazem |
| 8 Valor depressa | ◐ | Um feed do catálogo para o Google dá valor no primeiro dia; o calendário editorial pede configuração |

**Saída: matar como módulo próprio** (falha a porta 2: já existe e pode
usar-se ou ligar-se; e a 7). Duas peças têm valor e vão para o Catálogo:

- **Os feeds do catálogo publicado** (Google, Meta, comparadores) — já no
  `docs/14` como «fica para depois»; geram-se do que está publicado em cada
  canal e mercado, com o preço total e a redução com o preço de referência dos
  30 dias (`consumer-rights-eu`). Um feed tem só dados do produto, não dados
  pessoais.
- **As avaliações de quem comprou**, ligadas a uma encomenda entregue, com a
  regra mostrada na loja (`consumer-rights-eu`, **W**). O pedido de avaliação
  depois da entrega é um dos avisos fixos do §5, quando houver envio de
  e-mails.
- **Ficam de fora:** os pedidos e as filas da equipa criativa, o calendário
  editorial, a publicação nas redes, as métricas, a gráfica, os textos com IA
  e os directos. Um comerciante que queira ligar uma ferramenta de redes
  sociais fá-lo por **extensão de terceiros** (`docs/08`), com a regra dos
  dados na UE.

Matar ou não é do Diogo ou do Bruno; a decisão DR põe este sector no produto,
e estas portas dizem que, como módulo próprio, não se paga.

## 18. Pessoas — a camada G, como um módulo (11/10/2026)

Pedido do Diogo, 11/10/2026: *«passa o próximo módulo pelas 8 portas»*. A
camada G do `docs/31` §8 passa como **um** módulo: «Gestão de RH», «Portal do
Colaborador» e «DISC» do Hub actual. Skills abertas: `eu-gdpr-privacy`,
`eurolify-contracts-operations-eu` (emprego), `observability-security`.

**O que o Hub actual faz** (sequência 13 do `docs/31`; proposta comercial do
Hub, p. 21 e 24): picagem **biométrica** (impressão digital) num terminal, em
tempo real → picagens repetidas arrumadas sozinhas, o resto vai à caixa «A
tratar hoje» → justificações com comprovativo em 5 dias úteis → ausências e
férias pedidas no portal e aprovadas pela chefia → avisos (ex.: dois dias sem
picar) → fecho do mês num botão, trancado, com o relatório para a
contabilidade. No módulo: fichas, horários, avaliações de desempenho,
**perfis comportamentais DISC**, comunicação interna, equipamentos.

**O que o Eurolify já tem:** as **contas de pessoas da equipa do comerciante**
(quem entra no Hub, com que papel: dono, gestor, armazém, apoio — migrações
0018 a 0026, tratamento T8 do `docs/17`). Não há fichas de trabalhadores,
horários nem picagens. Procurei «assiduid», «picag», «férias», «biom»,
«colaborador» e «recursos humanos» no `docs/04`, no `docs/03` e no `docs/17`:
**nenhuma lição e nenhuma regra escrita**; nas skills, só a linha da
`eurolify-contracts-operations-eu` que manda verificar o emprego e a
vigilância país a país.

| Porta | Resultado | Porquê |
|---|---|---|
| 1 Por dentro | ◐ | O Hub actual tem o módulo em uso (proposta p. 21). Nenhuma lição medida |
| 2 Não resolvido | ❌ | **Já existe e pode usar-se ou ligar-se.** Assiduidade, férias e o relatório para o processamento de salários são feitos por programas de RH e pelo contabilista (não verifiquei quais) |
| 3 Gasto | ❔ | Nenhum comerciante ouvido |
| 4 Compradores | ❔ | — |
| 5 Alvo estreito | ❌ | Picagens, justificações, férias, avisos, fecho do mês, fichas, horários, avaliações, perfis, comunicação, equipamentos |
| 6 Encaixe | ❌ | **Fora do comércio, e com o maior risco legal do Hub:** (a) os dados biométricos usados para identificar uma pessoa são categoria especial do RGPD — **não verifiquei** o artigo nem a lei de nenhum Estado-membro sobre biometria no trabalho, **C**; (b) horários, registo dos tempos, férias, justificações e o prazo de 5 dias são **direito do trabalho de cada um dos 27 países**, e a contratação colectiva (`eurolify-contracts-operations-eu`, ponto 5), **C**; (c) avaliações e perfis comportamentais pedem análise de finalidade e de decisões automatizadas, **C**; (d) seria um tratamento novo de dados de trabalhadores, que o `docs/17` não tem; (e) **nenhum dado real** entra no ensaio do Reino Unido (ADR-0018) |
| 7 Custo | ❌ | Regras de trabalho por país e a protecção de dados biométricos, para uma dor sem número e já resolvida por programas dedicados |
| 8 Valor depressa | ◐ | A primeira picagem dá valor no primeiro dia, mas só depois de configurar horários, locais e terminais |

**Saída: matar como módulo próprio** (falham as portas 2, 6 e 7).

- **Fica o que já existe:** a equipa do comerciante e os papéis no Hub (T8).
- **Ligar em vez de construir:** um programa de RH ou de assiduidade que o
  comerciante já use liga-se, se houver procura, por **extensão de terceiros**
  (`docs/08`), com a regra dos dados na UE (regra 4).
- **Nada de biometria no Eurolify** sem o jurista e uma avaliação de impacto,
  mesmo por extensão.
- O ponto «G. Pessoas» do `docs/05` (Fase 2, «só com o jurista») fica como
  está até o Diogo ou o Bruno decidirem esta saída.

Matar ou não é do Diogo ou do Bruno; a decisão DR põe a camada G no produto,
e estas portas dizem que, como módulo próprio, não se paga e é o maior risco.

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
