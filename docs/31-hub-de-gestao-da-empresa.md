# O Hub de gestão da empresa inteira — o que se aprende com o Hub actual

> **Versão de 11/10/2026.** Pedido do Diogo, 11/10/2026 (issue #355): *«retirar
> todo o conhecimento [da apresentação e da proposta comercial do Hub actual]
> de forma a que tenhamos algo parecido no Eurolify, mais que uma loja estilo
> Shopify, mas também uma plataforma completa para gerir toda a empresa»*.
>
> **Fontes:** a proposta comercial do Hub (35 páginas, ref. de 30/09/2026) e a
> apresentação do Hub (5 páginas), enviadas pelo Diogo nesta sessão. Citam-se
> como «proposta p. N» e «apresentação p. N». Os dois documentos não trazem
> marca nem nomes de clientes (os campos estão por preencher); aqui também
> não (`AGENTS.md`, «Marca própria»). O Hub actual serve **só como fonte de
> regras e de casos** — herda-se o desenho, não o código (`docs/00` §3).
>
> **Estado:** desenho de âmbito. ✅ **Âmbito decidido a 11/10/2026** pelo
> Diogo (opção a) do §10; decisão DR,
> [ADR-0042](adr/0042-gestao-da-empresa-em-modulos-da-fase-2.md)). Construir
> cada módulo continua a ser decisão do Diogo ou do Bruno. As regras fiscais e legais aqui
> citadas são as do Hub actual; nenhuma foi verificada outra vez nesta
> versão, e as que não têm linha no `docs/03` ficam **C**.

## 🔴 O que este pedido muda

O `docs/00-proposta.md` §2.2 dizia: *«O que não entra: assiduidade,
marketing editorial, streaming, gráfica — são de uma empresa, não de uma
loja.»* O pedido de 11/10/2026 foi no sentido contrário: o Eurolify passa a
ser **também** o sistema de gestão da empresa do comerciante. **Decidido a
11/10/2026** (§10, opção a), ADR-0042): em módulos ligáveis a partir da Fase
2; o `docs/00` §2.2, o `docs/05` e o `docs/13` já o dizem.

## 1. O Hub numa página

**O que é** (proposta p. 4 e 6; apresentação p. 1): um só sistema para a
empresa inteira — «da produção à fatura, da loja online às horas de cada
colaborador». Duas ideias o definem:

1. **Centraliza e distribui.** Clientes, artigos, stock, lotes e faturas
   vivem uma vez, no Hub; a loja, a academia e o software de faturação
   recebem cópias. O Hub é o **único** que fala com o software de faturação
   (proposta p. 6).
2. **Sequências de trabalho com princípio, meio e fim.** Cada acontecimento
   (uma compra, uma inscrição, um lote) percorre um caminho fixo até um
   resultado (um documento emitido, um produto em stock, um mês fechado). Em
   cada passo diz-se quem actua: **pessoa**, **o sistema sozinho**, um
   **controlo** que trava o erro, ou uma **ligação** a outro sistema
   (proposta p. 8).

**A dimensão** (proposta p. 4, «números da versão actual do Hub, contados no
próprio código e na base de dados a 30 de setembro de 2026» — contados pelo
autor do PDF, **não medidos por mim**): 32 módulos, mais de 400 ecrãs, mais de
220 funções no servidor, mais de 500 tabelas, mais de 70 tarefas automáticas.
Para comparar: o `docs/00` §7 regista, da memória dos sistemas actuais, 420
caminhos de ecrã e 225 funções no servidor a 30/09/2026.

**O Eurolify hoje, para a mesma régua** (lido a 11/10/2026 em `git ls-tree
origin/main`): 60 migrações (0001 a 0061, sem a 0056) e 15 pastas na API (`apps/api/src/`: base, catálogo, checkout, clientes, comerciante,
exportação, faturação, identidade, importação, IVA, pagamentos, pós-venda,
preços, regras, stock); no Hub, três módulos na entrada — Equipa, Artigos e
Chaves de API (`memoria/hub-entrada-modular-09out2026.md`). Não contei
tabelas nem ecrãs.

## 2. Os seis princípios — já são regras do Eurolify

Os seis princípios do Hub (proposta p. 7) e as doze regras de evolução
(proposta p. 31) são, quase palavra por palavra, regras que o Eurolify já tem
escritas. Não há nada a acrescentar; há a confirmar que se mantêm quando o
âmbito crescer.

| Princípio do Hub | Onde já vive no Eurolify |
|---|---|
| 01 Centraliza e distribui; só ele fala com a faturação | `AGENTS.md`, «Uma regra, um sítio»; ADR-0037 (faturas por software certificado, por adaptador); ADR-0041 (com sistema de gestão, emite o sistema dele) |
| 02 Uma regra, um sítio (IVA, preços, mínimos, permissões, estados no servidor) | `AGENTS.md`, «Uma regra, um sítio — e o sítio é a API» |
| 03 O documento fiscal nasce no software certificado; nunca em lote | `AGENTS.md`, «Não se erra em documentos fiscais», regra 5; `docs/29` (decisão DI) |
| 04 Nada sai em silêncio; «não encontrei» nunca é «feito» | `AGENTS.md`, «Não se erra…», regra 3; `observability-security` (tarefas que não param em silêncio) |
| 05 Identidade pelos dados, nunca pelo nome | `AGENTS.md`, regra 6; `docs/23` e a fila de duplicados (`memoria/clientes-duplicados-fusoes-10out2026.md`) |
| 06 Tudo deixa rasto | rasto de auditoria com seis perguntas (decisão DK, issue #322); linha do tempo do artigo (CU) |
| Regras de evolução: mapear antes de corrigir, medir a dimensão, cópia antes de escrever, testar sem deixar rasto, publicar em dois passos, fora das horas de trabalho, registar tudo (proposta p. 31) | `AGENTS.md` («Operar a VPS», regras 2 e 4; «Git»); instruções da organização; ADR-0028 |

**Diferença de fundo:** no Hub, estas regras vivem numa instância de uma
empresa e numa pessoa formada que as aprende (proposta p. 29–31). No
Eurolify têm de viver **no produto**, para todos os comerciantes ao mesmo
tempo: um comerciante não pode desligar a retenção fiscal nem o rasto
(decisão K: as regras fiscais e legais não são extensíveis).

## 3. As 15 sequências de trabalho, lado a lado

Legenda da coluna «Eurolify»: **no `main`** (código juntado, com a migração),
**desenhado** (documento aprovado, sem código), **por desenhar**. O estado
do código foi lido a 11/10/2026 nos nomes das migrações do `origin/main`; o
plano de fatias (`docs/eurolify/implementation-plan.md`) ainda diz «em
pedido» para as fatias 8, 9 e 10, que já estão no `main` (migrações 0044,
0047 e 0050) — está desactualizado.

### Vender e faturar

**01 · Da encomenda à fatura, um só caminho para todos os canais**
(proposta p. 9; apresentação p. 2). Loja, comercial, balcão e academia
entram pela mesma porta: entrada (cliente pelo e-mail, NIF ou telefone) →
fila do armazém → picking com leitor (EAN ou DataMatrix, kits abertos nos
componentes, lote pedido) → o stock baixa uma vez, pelo picado → rascunho da
fatura com as quantidades **picadas** → travas fiscais (NIF em falta, isenção
impossível) → emissão no software certificado, com número, PDF e NIF guardados
→ etiqueta e seguimento. *A fatura é do que saiu do armazém, não do que foi
encomendado.*

| | |
|---|---|
| Eurolify | Checkout (0041), pagamentos EuPago (0044), stock com livro de movimentos, lotes, kits e reserva (0047), documentos fiscais com retenção e prova (0050): **no `main`**. Moloni (parte 2 da fatia 10) e transportadoras (parte 2 da fatia 9): **desenhados, por programar**. Picking com leitor e «fatura do que foi picado»: **por confirmar no `docs/27` e no `docs/29`** — não verifiquei se o documento nasce das quantidades expedidas |
| Falta | O **comercial** (encomenda feita pela equipa, com ligação de pagamento) e o **balcão** (POS) como canais da mesma porta |
| Skills | `order-fulfilment`, `eu-vat-oss-ioss`, `payments-psd2-sca`, `eurolify-physical-retail-eu`, `eurolify-tax-pos-invoicing-eu`, `eurolify-identifiers-traceability-eu` |
| Cuidado UE | Uma venda ao balcão não é venda à distância: o direito de livre resolução não se copia (`eurolify-physical-retail-eu`). A caixa (`pos_fiscal`) **não é domínio do motor** até haver uma loja que precise (decisão DF) |

**02 · A identidade fiscal certa em cada documento** (proposta p. 10). Uma
ficha, vários perfis de faturação; NIF no formato de cada país (prefixo
excepto Portugal; dígito de controlo português); VIES todas as madrugadas;
a régua do IVA sempre pela mesma ordem; isenções com prova; fila das
Retidas com três fontes lado a lado; duplicados e fusões decididos por uma
pessoa.

| | |
|---|---|
| Eurolify | **Quase tudo no `main`:** fichas e perfis (0037), VIES com prova e revalidação de noite e isenção manual (0039, decisão CY), anexos da isenção (0055, DN), duplicados e fusões por uma pessoa (0046, DD), motor de IVA com a ordem de decisão (0040, CZ), retenção (0050) |
| Falta | A fila das Retidas **no Hub** com as três fontes lado a lado (não verifiquei se o `docs/29` já a desenha assim) |
| Skills | `eu-vat-oss-ioss`, `eu-gdpr-privacy` |

### Produto, compras e produção

**03 · Do catálogo à loja** (proposta p. 11). Ficha do artigo (tipo:
produto, formação ou serviço; mínimos de compra; stock mínimo); traduções
assinaladas como desactualizadas quando o original muda; artigo enviado à
loja em rascunho; «Activar na loja» só com o preço igual; lançamentos
agendados verificados de 5 em 5 minutos; conferência diária do stock com a
loja.

| | |
|---|---|
| Eurolify | **No `main`:** artigos, variantes, opções, kits, categorias e colecções, traduções com o original guardado e estado calculado, publicação por canal × mercado com verificação, reverificação, imagens, importação, exportação, linha do tempo (fatia 3). No Eurolify **a loja é o próprio Eurolify** — não há segunda cópia a conferir |
| Falta | Lançamentos agendados (publicar a uma hora certa, com aviso a quem agendou se falhar); quantidades mínimas de compra (estão no âmbito da Fase 1, `docs/05`; não verifiquei se já estão no `docs/20`); artigos de tipo formação e serviço (fatia 12, desligada) |
| Skills | `catalog-pim`, `consumer-rights-eu`, `digital-products-eu` |

**04 · Da necessidade à compra e à entrada em stock** (proposta p. 12).
Alertas de stock abaixo do mínimo e Pareto das vendas → ordem de compra com
estados (rascunho, encomendada, em trânsito, parcialmente recebida, recebida)
→ recepção na própria ordem → aviso de «saída sem entrada» → custo
recalculado todas as noites → inventário por localização, com motivo em cada
correcção. *Uma ordem de compra é uma intenção; a fatura do fornecedor é um
documento — a despesa nasce da fatura, nunca da encomenda.*

| | |
|---|---|
| Eurolify | Livro de movimentos e um armazém por loja (0047, DE Q1). **Por desenhar:** fornecedores, ordens de compra, recepção, custo médio, alertas, Pareto, inventário por localização |
| Porta | No `docs/13` §1, «vários armazéns, separação e inventários» saiu **investigar** com os comerciantes |
| Skills | `order-fulfilment`, `platform-architect`, `eurolify-finance-reconciliation-eu` |

**05 · Da fórmula ao produto acabado** (proposta p. 13). Fórmula com versões
(o fornecedor muda a fórmula, o artigo mantém-se), lista INCI, ficha técnica,
notificação CPNP; programação com passos (preparação, enchimento, limpeza),
responsáveis e Gantt; enchimento com lote — o lote do fabricante continua
com sufixo L1, L2, L3 por enchimento do mesmo pote, mostrado antes de gravar;
registo de fabricação (sai matéria-prima, entra produto acabado com lote);
discrepâncias entre previsto e produzido; histórico e capacidade por mês e
por ano.

| | |
|---|---|
| Eurolify | Lotes na linha expedida e compostos na Fase 1 (decisão AD). Fórmula com versão: está na `product-compliance-eu` (linha «Cosmético») e no `docs/03` (Reg. (CE) 1223/2009, **C**). **Por desenhar:** fabrico, programação, consumo de matéria-prima, discrepâncias, capacidade |
| Natureza | É **sectorial** (produção própria; o exemplo é cosmética). No Eurolify seria um módulo para quem fabrica, não para todos (porta 5) |
| Skills | `product-compliance-eu`, `eurolify-sector-compliance-eu`, `eurolify-identifiers-traceability-eu` |

**06 · Rótulo, caixa e rastreabilidade até ao cliente** (proposta p. 14).
Rótulo gerado a partir dos textos da família e dos dados do artigo
(ingredientes, conteúdo, lote, validade); versão e aprovação pelo
responsável técnico, com cópia do texto impresso; fila da gráfica só com
rótulos confirmados; DataMatrix com artigo, validade e lote; colecções
(caixas com várias peças) montadas como um picking, com número e DataMatrix
próprios; *«que clientes receberam o lote X?»* com resposta imediata.

| | |
|---|---|
| Eurolify | A pergunta do lote é a razão dos lotes na linha expedida (AD, `docs/27`). **Por desenhar:** rótulos com versão e aprovação, DataMatrix, montagem de colecções |
| Cuidado UE | GTIN, DataMatrix e GS1 **não são obrigatórios para todos os produtos**, e o Eurolify não inventa GTIN (`eurolify-identifiers-traceability-eu`). O conteúdo do rótulo de um cosmético é **C** (`docs/03`, linha «Cosméticos») |

### Formação

**07 · Da inscrição na academia à fatura, ao kit e à comissão** (proposta
p. 15). Inscrição paga avisa o Hub (sem duplicar se o aviso chegar duas
vezes) → IVA pelo artigo (formação isenta sai isenta; bilhete de evento leva
IVA) → prestações acompanhadas → kits de formação pedidos por turma, como
encomenda normal → cancelamento que viaja (anula a fatura e apaga o
rascunho; falhar fica registado como falha) → comissões dos formadores
quando a inscrição está 100 % faturada → fecho da turma com o valor a pagar
ao formador → leads e avaliações.

| | |
|---|---|
| Eurolify | **Desenhado, desligado:** fatia 12 (digital: conteúdo, serviço digital e **serviço humano prestado à distância**, `digital-products-eu`, tudo **C**). Avisos idempotentes: já são regra (`headless-commerce`, eventos com identificador único). **Por desenhar:** prestações, turmas, comissões de formadores |
| Cuidado UE | A isenção de IVA da formação e o IVA do bilhete de evento são **C** — não verifiquei, e há pesquisa por rever em `docs/eurolify/fontes-eventos-servicos-iva-05out2026.md`. Prestações podem cair em crédito ao consumidor — **não verifiquei**; abrir `payments-psd2-sca` e o jurista antes de desenhar |

### Depois da venda

**08 · Devoluções, notas de crédito, trocas e carteira de cliente**
(proposta p. 16). Pedido com motivo e tarefa atribuída → recepção no todo ou
em parte antes de mexer no stock → nota de crédito ligada à fatura → troca
ou crédito na carteira → carteira por créditos com validade e mínimo de
utilização, caducados todas as noites → usar o saldo na loja ou numa
encomenda da equipa → um carregamento gera sempre documento, e a mesma nota
de crédito nunca carrega a carteira duas vezes.

| | |
|---|---|
| Eurolify | **No `main`:** livre resolução, devolução com inspecção, reembolso manual e pelo MB WAY, nota de crédito (0058, 0061; DM, DP). **Fora da Fase 1:** troca e carteira (`docs/05`) |
| Cuidado UE | O tratamento fiscal da carteira é **C** e **choca** com a skill `gift-cards-eu` (memória `skills-digitais-e-cartoes-oferta-04out2026.md`); o choque está por decidir. Saldo de um cliente não é dinheiro guardado pelo Eurolify (ADR-0038) — confirmar com `payments-psd2-sca` |

**09 · Apoio ao cliente** (proposta p. 17). Formulário do site com assunto e
anexos → encaminhamento no servidor (quem quer comprar como profissional vira
lead; cliente conhecido vai para o comercial dele; novo entra no rodízio) →
pedido com número, responsável e histórico → «Resolver» com registo.

| | |
|---|---|
| Eurolify | **Por desenhar.** Encaixa nas «tarefas sobre um registo» da `platform-architect` (pessoa, prazo, estado; tarefa vencida avisa) — **sem código**: as tabelas `tarefa_*` do `main` (0044, 0047, 0050, 0061) são filas de trabalho automático, não tarefas de pessoas (lido em `0050_documentos_fiscais.sql`, «A tarefa (R11)») |
| Cuidado UE | Mensagens e anexos são dados pessoais: entram na exportação e no apagamento do titular (`eu-gdpr-privacy`) |

### Crescer

**10 · Prospecção, chamadas do dia, carteira e comissões** (proposta p. 18;
apresentação p. 4). Leads distribuídos → prospecção por etapas (lead perdido
exige motivo) → **Chamadas do Dia**: todas as madrugadas, a lista de cada
comercial a partir do ritmo de compra (quem já devia ter voltado; só quem
tem telefone ou e-mail) → saúde da carteira por recência, frequência e valor
(activo, em risco, perdido) → Nova Encomenda com os preços e descontos do
cliente e ligação de pagamento → comissões **sobre o faturado** (não sobre o
encomendado), em cartões mensais → metas e painéis.

| | |
|---|---|
| Eurolify | **Por desenhar.** As listas de preços B2B por etiqueta estão na Fase 1 (`docs/05`); a relação comercial na fatia 14 |
| Cuidado UE | Ligar a um contacto para vender e montar perfis de compra são tratamentos com base legal própria (`eu-gdpr-privacy`): **não verifiquei** qual, nem se a régua de consentimento de marketing (DL) cobre o telefone de um cliente profissional |

**11 · Marketing e gráfica, do pedido à publicação** (proposta p. 19).
Balcão de pedidos (descrição, prazo, destino) → fila por pessoa → aprovação a
dois vistos → calendário editorial por marca e conta → publicação nas redes,
com comentários e métricas de volta → resultados por rede (dizendo também o
que não se mede) → gráfica com fila própria.

| | |
|---|---|
| Eurolify | **Por desenhar.** Explicitamente **fora** no `docs/00` §2.2 |
| Natureza | Gestão interna de trabalho criativo; pouco ligado ao núcleo da loja (porta 6) |

**12 · Comunicação automática com os clientes** (proposta p. 20;
apresentação p. 5). Acontecimentos (carrinho abandonado, paga, expedida,
entregue, reembolso, crédito na carteira, lead novo, inscrição, formação
concluída) → percursos com textos aprovados → **só com consentimento** →
**modo de teste**: nada sai para clientes sem autorização → fila de saída,
execuções e resultados.

| | |
|---|---|
| Eurolify | Os acontecimentos já existem como eventos de domínio (0021, outbox); a régua `pode_receber_marketing` está na base (0042, 0052). **Por desenhar:** percursos, fila de saída, modo de teste. No `docs/13` §5, «Automações e notificações configuráveis» saiu **estreitar** |
| Cuidado UE | Mensagens transaccionais e de marketing têm bases diferentes (`eu-gdpr-privacy`, ePrivacy); um fornecedor de e-mail ou de WhatsApp de fora da UE só com decisão escrita e acordo (`AGENTS.md`, «Regras da UE», regra 4) |

### Gerir a empresa

**13 · Pessoas: assiduidade, ausências, férias e fecho do mês** (proposta
p. 21). Picagem **biométrica** (impressão digital) em tempo real →
resolução automática de picagens repetidas → justificações com comprovativo
em 5 dias úteis → ausências e férias aprovadas pela chefia → avisos no
telemóvel (ex.: dois dias sem picar) → fecho do mês com um botão e relatório
para a contabilidade. No módulo: fichas, horários, avaliações de desempenho,
**perfis comportamentais DISC**, comunicação interna, equipamentos.

| | |
|---|---|
| Eurolify | **Por desenhar.** Explicitamente **fora** no `docs/00` §2.2 («assiduidade») |
| 🔴 Cuidado UE | Dados biométricos para identificar uma pessoa são **categoria especial** no RGPD (art. 9.º); no trabalho, a lei de cada Estado-membro pode restringir — **não verifiquei** a lei portuguesa nem a de nenhum outro país. Perfis DISC e avaliações também pedem análise (finalidade, minimização, decisão automatizada). Horários, férias e o prazo de 5 dias são **direito do trabalho de cada país**, não regra do Eurolify: cada um configurável, nunca fixo — skill `eurolify-contracts-operations-eu` (emprego) e jurista. Nada disto entra com dados reais na VPS do Reino Unido (ADR-0018) |

**14 · Financeiro: da fatura do fornecedor à conciliação** (proposta p. 22;
apresentação p. 3). Fatura do fornecedor em PDF ou fotografia → **leitura
por IA** propõe fornecedor, data, número, valores, taxas de IVA e categoria
→ uma pessoa confirma, corrige ou rejeita → saldos dos meios de pagamento e
extractos bancários importados; cada movimento liga-se ao que explica →
duplicados assinalados de noite; apagar exige pedido e aprovação, com cópia →
documentos por emitir numa linha → tesouraria, lucro por área de negócio,
IVA (incluindo o de importação), moeda estrangeira em euros e o relatório
para a autoridade dos cosméticos. *Um valor provisório nunca entra nas contas
como se fosse gasto.*

| | |
|---|---|
| Eurolify | A conciliação das **vendas** está na fatia 8 (pagamentos, fila de diferenças, 0044). **Por desenhar:** despesas, fornecedores, extractos, tesouraria, lucro por área |
| Cuidado UE | A IA **só lê** na Fase 1 e nunca emite faturas nem reembolsa (ADR-0040). Ler uma fatura e propor um lançamento que uma pessoa confirma parece caber — **por confirmar** com o Diogo ou o Bruno. O Eurolify não certifica contabilidade nem movimenta fundos (`eurolify-finance-reconciliation-eu`). O relatório para a autoridade dos cosméticos é obrigação nacional por identificar — **C**, não verifiquei qual |

**15 · Organização: tarefas, projectos, conhecimento e governação**
(proposta p. 23). Tarefas com responsável, prazo, recorrência e cronómetro
(mudar o prazo pede autorização) → projectos com modelos, etapas,
automações e kanban (ex.: lançamento de uma colecção) → procedimentos por
departamento, OKR e KPI, mapas mentais, pool de ideias → **assistente
interno** com IA que responde a partir dos procedimentos e dos dados e
*cria* artigos, tarefas ou pedidos de ausência a conversar → chat interno e
calendário partilhado → governação: histórico de alterações ao sistema,
permissões por módulo e grupo, página de desempenho da base, janela de
manutenção anunciada.

| | |
|---|---|
| Eurolify | Permissões por papel e âmbito (`/hub/me`, 0034), rasto de auditoria (DK), linha do tempo (CU): **no `main`**. Tarefas sobre um registo: **desenhadas** na `platform-architect`, sem código. **Por desenhar:** projectos, conhecimento, chat, assistente |
| Choque | Um assistente que **cria** artigos e pedidos de ausência é escrita por IA: na Fase 1 a IA só lê, e a escrita com confirmação humana é da Fase 3 (ADR-0040) |

## 4. Os 32 módulos, um a um

Proposta p. 24. A coluna «Domínio Eurolify» diz onde caberia; «Natureza» diz
se serve **qualquer loja** (núcleo), **empresas com equipa** (gestão) ou
**um sector** (sectorial). As portas 3 e 4 dão «não se sabe» em todos —
nenhum comerciante de fora foi ouvido (`docs/13`, «O que vale para todos»).

| Grupo | Módulo do Hub | O que faz | Domínio Eurolify | Natureza | Estado |
|---|---|---|---|---|---|
| Vendas e clientes | Comercial | Clientes e perfis, encomendas, prospecção, Chamadas do Dia, carteira, comissões, devoluções, apoio | Clientes (no `main`) + Comercial (novo) | gestão | em parte |
| | POS | Venda ao balcão com PIN pessoal e leitor | Canal «balcão» (`eurolify-physical-retail-eu`) | núcleo | por desenhar; pelas 8 portas a 11/10/2026: **estreitar e investigar** — primeiro a ligação a um POS certificado (`docs/13` §7) |
| | Dashboards | Painéis do dia e do mês por módulo | Leitura sobre todos | núcleo | por desenhar |
| | Ecossistema | A fase de cada cliente no percurso da marca | Clientes | gestão | por desenhar |
| Operações | Armazém | Por processar, picking com leitor, lotes, Retidas, monitor da faturação, inventário, localizações, transportadoras | Stock e encomendas (0047) | núcleo | em parte |
| | Fabricação | Programação, produção, lotes, Gantt, compras, fornecedores, Pareto, alertas, discrepâncias | Compras (novo) + Fabrico (novo) | compras: gestão; fabrico: sectorial | por desenhar |
| | Gráfica | Pedidos, máquina, procedimentos, lançamentos, rótulos, colecções | Trabalho interno (novo) | sectorial | fora (`docs/00` §2.2) |
| | Administrativo | Documentos da empresa e dos cosméticos, contratos, tabelas de preços, lançamentos | Documentos da empresa (novo) + Conformidade | gestão | por desenhar |
| Formação | Pedagógico | Formações, turmas, kits, comissões, parceiros, manuais | Digital / serviço humano à distância (fatia 12) | sectorial | desenhado, desligado |
| | Academia | Cursos online com o progresso de cada pessoa | idem | sectorial | desenhado, desligado |
| | Eventos | Briefings, programas, patrocínios | idem | sectorial | por desenhar |
| Marketing | Marketing | Balcão de pedidos, fila, calendário, campanhas, publicações, resultados | Trabalho interno (novo) | gestão | fora (`docs/00` §2.2) |
| | Automações | Percursos com consentimento e modo de teste | Notificações (estreitar, `docs/13`) | núcleo | por desenhar |
| | Assistente de marketing | Bios, conteúdos, stories, planeamento, com IA | IA (ADR-0040) | gestão | por desenhar |
| | Streaming | Directos nas redes sem partilhar palavras-passe | — | gestão | fora (`docs/00` §2.2) |
| | Formulários | Inquéritos de satisfação e NPS, com envio automático | Notificações | núcleo | por desenhar |
| Pessoas | Gestão de RH | Colaboradores, assiduidade, horários, ausências, avaliações, comunicação, equipamentos | Pessoas (novo) | gestão | fora (`docs/00` §2.2) |
| | Portal do Colaborador | Picagens, ausências, férias, justificações | Pessoas (novo) | gestão | fora |
| | DISC | Perfis comportamentais da equipa | Pessoas (novo) | gestão | fora; RGPD a analisar |
| Financeiro | Financeiro | Despesas por IA, bancos, conciliação, por emitir, IVA, lucro por área, relatório da autoridade | Financeiro (novo) + Pagamentos (0044) | gestão | em parte (vendas) |
| Parceiros | Portal Revendedor | Preços, recursos, regras e objectivos | Canais (fatia 14) | gestão | por desenhar |
| | Portal Distribuidor | idem, com contratos | Canais (fatia 14) | gestão | por desenhar |
| | Portal Franqueado | A área de cada franqueado | Canais (fatia 14) | gestão | por desenhar |
| | Portal do Formador | Formações, turmas e números de cada formador | Digital (fatia 12) | sectorial | por desenhar |
| Organização | Gestão de Projectos | Modelos, etapas, automações, kanban, tarefas | Tarefas (desenhadas) + Projectos (novo) | gestão | em parte |
| | Conhecimento e Objectivos | Procedimentos, OKR e KPI por departamento | Conhecimento (novo) | gestão | por desenhar |
| | Mapas Mentais | Quadros livres, com importação | — | gestão | por desenhar |
| | Pool de Ideias | Propostas com votação | — | gestão | por desenhar |
| | Planos de Acção | Análise SWOT e planos | — | gestão | por desenhar |
| | Relatórios | Relatórios diários da equipa, com resumo automático | — | gestão | por desenhar |
| Sistema | Administração | Utilizadores, convites, grupos, módulos, catálogo, integrações, definições | Identidade e Comerciante (no `main`) | núcleo | em parte |
| | TI | Histórico de alterações, projectos por terminar, equipamentos, terminais, desempenho da base, mapa do sistema | Rasto (DK) + operação | núcleo | em parte |

Contagem (feita à mão sobre esta tabela, 11/10/2026): 32 módulos — 7 de
núcleo, 20 de gestão, 5 sectoriais (a Fabricação conta como gestão, pelas
compras; o fabrico dentro dela é sectorial). Pelo estado: 6 em parte no
Eurolify, 2 desenhados e desligados, 6 fora pelo `docs/00` §2.2 e 18 por
desenhar.

## 5. As integrações

Proposta p. 25–26; apresentação p. 2. No Hub, cada ligação passou por
**ensaio → casos reais → paralelo → produção**, com um interruptor para a
suspender (proposta p. 25). É o mesmo caminho que o Eurolify segue com a
EuPago em modo teste (decisão DB). No Eurolify, cada ligação é um
**adaptador** com os contratos de extensão (`docs/08`, requisito K).

| Ligação no Hub | No Eurolify | Cuidado |
|---|---|---|
| Loja Shopify (encomendas, clientes, consentimentos; saem artigos, preços, stock) | Desaparece para quem vende no Eurolify: a loja é o próprio Eurolify. Fica como **origem de migração** (`docs/09`, fonte 9) | — |
| Moloni (rascunhos, entidades, emitidos, NC, PDF; taxas de IVA vêm do Moloni) | Adaptador da fatia 10, parte 2. ⚠️ No Eurolify **o IVA decide-o o Eurolify** (ADR-0037), não o software de faturação | Controlos do Hub a herdar: a mesma venda nunca gera dois documentos; interruptor para suspender rascunhos; limite de pedidos por minuto; cliente procurado pelo NIF |
| Academia online (inscrições, prestações, cancelamentos, kits, turmas, leads) | Fatia 12, ou um adaptador para plataformas de formação | Segredo partilhado em cada aviso; aviso repetido não duplica (`headless-commerce`) |
| VIES | No `main` (0039) | — |
| Transportadora (etiqueta pelo Shopify) | Adaptador de envio (fatia 9, parte 2; CTT e mais uma, `docs/05`) | — |
| Meios de pagamento (Shopify Payments, Stripe, EuPago, IfThenPay) | Adaptadores de pagamento; EuPago no `main` | O Eurolify nunca recebe o dinheiro (ADR-0038) |
| Google Drive e Calendar, WhatsApp, redes sociais, Miro, terminal biométrico, e-mail, notificações no telemóvel | Adaptadores opcionais, cada um por decidir | 🔴 Serviços de fora da UE que recebam dados pessoais só entram com decisão escrita do Diogo ou do Bruno e acordo de transferência (`AGENTS.md`, «Regras da UE», regra 4). Não verifiquei onde cada um guarda os dados |
| «Feitas à medida» (WooCommerce, PrestaShop, Magento, InvoiceXpress, Vendus, PHC, Primavera, Sage, CTT, DPD, GLS, contabilidade, CRM; apresentação p. 2) | Lista de adaptadores possíveis; os de faturação ligam-se ao D-10 (com sistema de gestão, emite o sistema dele, ADR-0041) | Cada software de faturação de outro país entra com o contabilista desse país (`docs/00` §4) |

## 6. O que muda do Hub para o Eurolify

| No Hub | No Eurolify | Porquê |
|---|---|---|
| Uma empresa, uma instância dedicada | Vários comerciantes na mesma plataforma, isolados na base (RLS) | Decisão F; `docs/15` |
| As regras de uma empresa no código (o `docs/00` §3 regista «92 ficheiros do ecrã» com a marca e as regras de uma só empresa) | Regras no servidor, configuráveis por comerciante dentro do que a lei deixa; as fiscais e legais não se estendem | Decisão K |
| Os 32 módulos activam-se por empresa (proposta p. 24) | **Módulos ligáveis por comerciante**, cada um com dependências, permissões e dados próprios; desligar nunca apaga dados com obrigação legal (`platform-architect`) | A pequena loja vê o necessário (`eurolify-commerce-coverage-eu`, ponto 5) |
| Sectorial à medida (cosmética, formação) | Pacotes por sector, fora do núcleo, cada um pelas 8 portas | Porta 5 (alvo estreito) |
| Adaptação de 14 semanas por cliente (proposta p. 27–28) | Configuração pelo próprio comerciante; serviços de migração e configuração como fonte de receita à parte | `docs/09`, fonte 9; ADR-0006 |
| A IA cria artigos e tarefas a conversar | A IA só lê na Fase 1 | ADR-0040 |
| Integrações com Google, WhatsApp, Miro | Dados na UE, fornecedores de fora só com decisão escrita | `AGENTS.md`, regra 4 |

## 7. O modelo comercial do Hub, como referência

Proposta p. 27–35. **É o preço proposto a um cliente, não um preço pago nem
o preço do Eurolify** (que é a D-14, ADR-0007: mensalidade por escalões, sem
taxa sobre as vendas).

- **80.000 € + IVA**, preço fechado: licença perpétua, não exclusiva e
  intransmissível, para uso interno da empresa e das suas marcas, com direito
  a modificar o código da instância (sem revender); instância dedicada com a
  marca do cliente; adaptação das sequências; integrações com a loja, a
  faturação e a academia; outras ligações; migração de dados; paralelo e
  arranque; formação de 6 meses com três manuais; correcção de defeitos até
  ao fim do programa (p. 33–34).
- **Pagamentos:** 30 % na adjudicação (24.000 €), 40 % no arranque, semana 14
  (32.000 €), e 10 % no fim de cada um dos meses 4, 5 e 6 (8.000 € cada),
  por transferência a 15 dias (p. 33).
- **Plano:** diagnóstico (sem. 1–2) → instalação (2–4) → dados (3–7) →
  integrações (5–10) → adaptação (6–11) → testes e paralelo (11–13) →
  arranque (sem. 14); acompanhamento até ao mês 6. *Nenhuma sequência passa a
  produção sem ter sido demonstrada e aprovada por quem a faz* (p. 28).
- **Formação:** 26 sessões semanais de 2 horas (cerca de 52 horas), canal de
  dúvidas com resposta em 1 dia útil, cerca de 6 horas por semana da pessoa
  formada; no fim, ela opera, administra, diagnostica falhas pelas filas e
  registos e publica evoluções sem partir as integrações (p. 29–30).
- **Fora do preço:** subscrições de terceiros, equipamentos, funcionalidades
  novas, deslocações (p. 34).

**O que serve ao Eurolify:** um plano «Empresa» com módulos de gestão, e um
**serviço de arranque** (diagnóstico, migração, paralelo, formação) como o
desta proposta, cabem na fonte 9 do `docs/09` («Serviços: migração,
configuração, formação; instalação dedicada»). Não estimei o preço nem o
esforço de nenhum dos dois.

## 8. Proposta de ordem (âmbito aceite a 11/10/2026, ADR-0042)

Por camadas, da mais ligada ao núcleo à mais afastada. Cada módulo passa
pelas 8 portas e tem o seu desenho em tabela antes do código (ADR-0023).
**Não estimei prazos**: a Fase 1 já está estimada em 17 a 32 meses a tempo
inteiro (`docs/10` §9, hipótese **C**), e esta lista acrescenta trabalho a
essa conta.

| Camada | Módulos | Porquê nesta ordem |
|---|---|---|
| **A. Núcleo da loja** (Fase 1, em curso) | Catálogo, preços, clientes, IVA, checkout, pagamentos, stock, documentos fiscais, pós-venda | Já decidido e em código |
| **B. Operação** | Balcão (POS — pelas portas a 11/10/2026: primeiro a ligação a um POS certificado, `docs/13` §7), armazém completo (picking com leitor, localizações, inventário), compras e fornecedores, apoio ao cliente, tarefas sobre um registo, dashboards | Ligam directamente às encomendas e ao stock; porta 1 forte (lições do `docs/04` §3) |
| **C. Comercial** | Leads e prospecção, Chamadas do Dia, saúde da carteira, encomenda feita pela equipa com ligação de pagamento, comissões sobre o faturado, metas | Usa clientes, encomendas e documentos que já existem |
| **D. Financeiro** | Despesas com leitura por IA e decisão de uma pessoa, extractos e conciliação, tesouraria, lucro por área | Depende de pagamentos e documentos fiscais; IA dentro do ADR-0040 |
| **E. Organização** | Projectos, procedimentos e objectivos, comunicação interna | Não toca em regras fiscais; valor para equipas |
| **F. Sectoriais** | Fabrico com fórmulas, lotes de enchimento e rótulos; formação (fatia 12); marketing e gráfica | Cada um serve um tipo de comerciante (porta 5) |
| **G. Pessoas** | RH, assiduidade, férias, fecho do mês | O maior risco legal (biometria, direito do trabalho de cada país); só com o jurista |
| **H. Parceiros** | Portais de revendedor, distribuidor, franqueado, formador | Fatia 14; jurista de concorrência (`eurolify-b2b-channels-eu`) |

## 9. Choques com o que está decidido

1. **`docs/00` §2.2** excluía assiduidade, marketing editorial, streaming e
   gráfica. O pedido de 11/10/2026 inclui-os → decidido no §10 (ADR-0042).
2. **ADR-0040** (IA só lê na Fase 1): o assistente interno e o assistente de
   marketing do Hub escrevem. No Eurolify ficam a ler até à Fase 3, ou o
   ADR muda.
3. **Carteira de cliente**: fora da Fase 1 (`docs/05`) e com o choque entre
   `eu-vat-oss-ioss` e `gift-cards-eu` por decidir.
4. **Biometria** na assiduidade: categoria especial do RGPD; não entra sem o
   jurista e a análise de impacto (`eu-gdpr-privacy`).
5. **Fornecedores de fora da UE** (Google, WhatsApp, Miro, redes sociais):
   regra 4 das «Regras da UE».
6. **Âmbito e prazo**: o `docs/00` §7 já lista o âmbito como risco («uma
   plataforma destas tem centenas de peças»). Juntar os módulos de gestão sem
   fase própria alonga a Fase 1, que tem como critério de passagem três meses
   de vendas sem documento fiscal errado (`docs/05`).

## 10. A decisão pedida

**O Hub da empresa inteira entra no produto Eurolify?**

✅ **Decidido a 11/10/2026: a)** — Diogo, *«a, actualiza o docs/00 e o
docs/05»* (decisão DR, [ADR-0042](adr/0042-gestao-da-empresa-em-modulos-da-fase-2.md)).

| Opção | O que quer dizer |
|---|---|
| **a) Sim, como módulos ligáveis a partir da Fase 2** (recomendada) | O núcleo da Fase 1 não muda. As camadas B a H do §8 entram como módulos que cada comerciante liga, cada um pelas 8 portas e com o seu desenho. O `docs/00` §2.2 e o `docs/05` passam a dizê-lo |
| b) Sim, já na Fase 1 | Algumas camadas (B e C, por exemplo) entram antes da abertura a comerciantes; o prazo da Fase 1 cresce e tem de ser recalculado (D-13) |
| c) Não | Fica o `docs/00` §2.2: o Eurolify é loja e Hub da loja; a gestão da empresa fica para os sistemas que cada comerciante já tem |

**Porquê a a):** o que o Hub ensina sobre a loja (sequências 01 a 03, 08) já
está no núcleo; o resto é valor real — o Hub corre todos os dias numa
empresa (proposta p. 2) —, mas a prova é de **um** comprador (porta 4,
`docs/13`). Como módulos ligáveis, cada um entra quando houver comerciantes
que o peçam, sem atrasar o primeiro comerciante.

## 11. O que não foi verificado

- **Nenhum número do Hub foi medido por mim**: os 32 módulos, 400 ecrãs, 220
  funções, 500 tabelas e 70 tarefas são do PDF (proposta p. 4).
- **Nenhuma regra legal ou fiscal foi lida outra vez**: isenção da formação,
  IVA do bilhete de evento, biometria no trabalho, relatório da autoridade dos
  cosméticos, conteúdo do rótulo, prestações e crédito ao consumidor — tudo
  **C** até ser verificado.
- Não confirmei, no `docs/27` e no `docs/29`, se a fatura do Eurolify nasce
  das quantidades expedidas (sequência 01) nem se a fila das Retidas mostra as
  três fontes (sequência 02).
- Não verifiquei onde guardam os dados os serviços de fora (Google, WhatsApp,
  Miro, redes sociais, terminais biométricos).
- Os estados do Eurolify vêm dos nomes das migrações no `origin/main` e das
  memórias; não abri o código de cada domínio.
- Não estimei prazo nem custo de nenhum módulo novo.
- Não falei com nenhum comerciante (portas 3 e 4).
