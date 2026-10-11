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
> módulos ligáveis (decisão DQ,
> [ADR-0042](adr/0042-gestao-da-empresa-em-modulos-da-fase-2.md)). Os módulos
> novos — camadas B a H do
> [`31-hub-de-gestao-da-empresa.md`](31-hub-de-gestao-da-empresa.md) §8 —
> **ainda não passaram por estas portas**; o `docs/31` §4 dá só a natureza e o
> estado de cada um. Cada um passa aqui antes de ser desenhado.

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
Com a decisão DQ (11/10/2026), os módulos de gestão da empresa juntam-se aos
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
