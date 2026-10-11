# Fases e primeira versão (MVP)

> **Revista a 11/10/2026:** a gestão da empresa inteira entra no produto em
> módulos ligáveis a partir da Fase 2 (decisão do Diogo,
> [ADR-0042](adr/0042-gestao-da-empresa-em-modulos-da-fase-2.md)); a Fase 1
> não muda.

> **Versão de 03/10/2026 — proposta.** D-1, D-2 e D-3 foram decididas a
> 03/10/2026 (`06-decisoes-em-aberto.md`); a estimativa de prazo e custo da
> Fase 1 está em `10-estimativa-prazo-e-custo.md`; a D-13 foi decidida
> (ADR-0008: o Diogo e o Bruno desenvolvem, com Claude Code e Codex). O
> tempo de cada fase está no §9 desse documento (hipótese, corrigida às 8
> semanas); o critério de passagem continua a mandar, não o calendário. Cada fase tem um
> **critério de passagem** medível; não se passa à seguinte por calendário.

## Fase 0 — Decidir e desenhar (critério de passagem cumprido a 04/10/2026, ADR-0023)

| Entregável | Estado a 03/10/2026 |
|---|---|
| Proposta, arquitectura, mapa regulamentar, lições dos sistemas actuais | escrito (este repositório) |
| As skills de trabalho para as sessões de Claude Code e de Codex (14; mais 2 a 04/10/2026: produtos digitais e cartões-oferta) | escrito (`.agents/skills/`, com ligações em `.claude/skills/`; ADR-0010) |
| Decisões D-1, D-2, D-3 | **todas decididas** a 03/10/2026: D-1 vender desde o início (ADR-0006), D-2 de raiz (ADR-0002), D-3 europeu gerido, Scaleway (ADR-0003, ADR-0004) — **revista**: VPS operada por nós, com o Claude (ADR-0015, ADR-0016) |
| Escolher o alojamento (D-3) | **revisto** a 03/10/2026: VPS operada por nós (ADR-0015); fornecedor e plano por escolher (`11-preparacao-da-vps.md` §7) — antes, Scaleway (ADR-0004) |
| Conta da Scaleway e acesso só de leitura do Claude | ⚠️ **deixa de se usar** (ADR-0032, 04/10/2026: a OVH é o fornecedor único) · antes: **preparado** (ADR-0011): projecto `eurolify-ensaio`, chave do Diogo só de leitura, `scw` nas sessões. Falta a chave do Bruno e confirmar o portador da chave — **sem efeito** com a VPS (ADR-0015) |
| Preparação da VPS (ADR-0015, ADR-0016) | **por fazer** — guia em `11-preparacao-da-vps.md`; o script entra no `main` com as duas revisões (ADR-0013) |
| Contratos de adaptadores e pontos de extensão (requisito K) | por fazer — desenho em `08-extensoes-de-terceiros.md` |
| Prova de 2 semanas com a Medusa (D-2) | **cancelada** — a D-2 foi decidida a 03/10/2026: núcleo próprio, de raiz (ADR-0002) |
| Modelo de domínio (entidades, estados, quem é dono de quê) em tabelas | **Catálogo em desenho** ([`14-dominio-catalogo.md`](14-dominio-catalogo.md), #36, 04/10/2026); os outros domínios por fazer |
| Lista de recursos e operações da API (em tabela; o ficheiro OpenAPI só depois do OK) | **Catálogo em desenho** (`14-dominio-catalogo.md` §7); os outros domínios por fazer |
| Regras do motor de IVA validadas pelo contabilista | por fazer |
| Fluxos do consumidor (checkout, confirmação, livre resolução, garantia) validados por jurista | por fazer |
| Conversas com 3 a 5 comerciantes de fora (para D-14 e para a 1.ª versão) | por fazer |
| Modelo de receita (D-14) — a base é precisa antes da Fase 1, porque se vende desde o início; os preços, antes da peça 13 (ADR-0012) | **base decidida** (ADR-0007: mensalidade por escalões, sem taxa sobre as vendas); preços por decidir, depois das conversas com comerciantes |
| Contrato de serviço, acordo de tratamento de dados, limites de responsabilidade e seguro, com jurista | por fazer |
| Estimativa de prazo e custo (D-13) | **decidida** a 03/10/2026 (ADR-0008): desenvolvem o Diogo e o Bruno, com Claude Code e Codex; tempo por fases em `10-estimativa-prazo-e-custo.md` §9 (Fase 1: 18 a 33 meses a tempo inteiro, 32 a 60 a meio tempo — recalculado a 11/10/2026 com as peças 21 e 22 da decisão DS e as sete filas da peça 21, decisão DW; a 04/10/2026, com as três da decisão AD), corrigido às 8 semanas (§6). Falta pedir os orçamentos do contabilista, do jurista e do seguro |

**Critério de passagem** (mudado a 03/10/2026, ADR-0012): a D-13 decidida
(ADR-0008), a base da D-14 decidida (ADR-0007) e o OK escrito do Bruno ou do
Diogo para começar código (ADR-0001). Os preços da D-14 têm de estar decididos
antes de começar a peça 13 da Fase 1 (abertura a comerciantes).

✅ **Cumprido a 04/10/2026:** o OK para código é o
[ADR-0023](adr/0023-ok-para-codigo.md) (Diogo). Os entregáveis da tabela que
faltam continuam a fazer-se, e o código de um domínio espera pelo modelo e
pela lista da API dele escritos em tabela.

## Fase 1 — Núcleo e os primeiros comerciantes (vende-se desde o início)

**Âmbito — entra:**

- Catálogo com variantes, kits/coleções, traduções e os campos regulamentares
  (fabricante, pessoa responsável, avisos, INCI, lote) — se o comerciante já
  tiver um sistema de gestão, o catálogo continua a **nascer lá** e é espelhado
  para o Eurolify pela API, como hoje para o Shopify.
- **Toda a UE de raiz** (decisão F, 03/10/2026): taxas dos 27 países, OSS,
  NIF e VIES, territórios especiais; listas de preços B2B por etiqueta;
  quantidades mínimas; histórico de preços (30 dias); **relatório OSS com os
  quatro baldes**, em todos os planos (decisão AD, ADR-0022; veio da Fase 2).
- Carrinho e **checkout alojado**, com perfis de faturação, «a fatura é para
  outra pessoa/empresa», validação VIES com prova e o motor de IVA
  (PT, UE, fora da UE, Canárias/Ceuta/Melilla, Açores/Madeira).
- Pagamentos **EuPago** e **Stripe**, com a régua método → prestador → conta.
- Encomendas e stock (um armazém, reservas, disponível por canal), com **lotes
  na linha expedida e compostos** — é o que permite uma recolha (decisão AD,
  ADR-0022; veio da Fase 2).
- **Entrega das encomendas ao sistema de gestão do comerciante que já o
  tenha**, que continua a faturar no software certificado (D-10).
- **Emissão de faturas por adaptador em Portugal (Moloni)** para quem não tem
  sistema de gestão — passou da Fase 2 por causa da D-1 → a) (ADR-0006).
- **Abertura a comerciantes desde o início (ADR-0006):** registo e
  configuração pelo próprio comerciante, contrato de serviço e acordo de
  tratamento de dados, faturação do Eurolify aos comerciantes, suporte e níveis
  de serviço, exportação completa dos dados (Data Act).
- Envios com **CTT** e mais uma transportadora ou agregador.
- **Botão de livre resolução**, área de cliente, confirmação com prova
  contratual, notificações em PT/ES/EN.
- **Devolução → estado do artigo → reembolso → nota de crédito**, a seguir ao
  botão de livre resolução (decisão AD, ADR-0022; veio da Fase 2). A troca e a
  carteira ficam na Fase 2.
- RGPD essencial: consentimentos numa régua só, exportação e apagamento com a
  retenção fiscal respeitada.
- API da Loja, API de Administração, webhooks, SDK TypeScript, **MCP de
  leitura**, pacote para construtores de frontends.
- **Os adaptadores do próprio Eurolify** (pagamentos, envios, faturação)
  escritos com os contratos de extensão, como se fossem de terceiros (requisito K).
- **Duas peças que vieram dos módulos de gestão** (decisão DS,
  [ADR-0043](adr/0043-saidas-das-portas-dos-modulos-de-gestao.md),
  11/10/2026; estimadas no mesmo dia, **C**: 2,5–5 e 1–2 pessoas-semana,
  `docs/10` §2; a 21 era 2–4 antes do desenho, decisão DW):
  - **as tarefas das filas que pedem uma pessoa** — dono, prazo, estado e
    aviso ao vencer nas filas da Fase 1 (diferenças dos pagamentos, documentos
    retidos, incertos e divergentes, candidatos a duplicado, prazo do
    reembolso e, pela decisão DW, pedidos de livre resolução pendentes ou
    fora de prazo, problemas abertos e reembolsos incertos ou falhados),
    decididas uma a uma no ecrã de cada fila (`docs/13` §10; desenho no
    `docs/33`);
  - **a consulta das vendas do dia e do mês** — encomendado, pago, faturado e
    devolvido, com e sem IVA, por canal e mercado, cada número com o que
    conta; serve o MCP de leitura (o ecrã do painel é da Fase 2; `docs/13`
    §11).
- Hub do Eurolify mínimo: definições, encomendas, registo de integrações e de
  webhooks, auditoria.

**Âmbito — fica de fora:** emissão de faturas pelo próprio Eurolify (emite o
software certificado de cada comerciante), emissão por adaptador fora de
Portugal (entra país a país), troca e carteira, vários armazéns,
marketplace, escrita por IA, protocolos de comércio por agentes, extensões
abertas a qualquer programador, e **os módulos de gestão da empresa** (a
partir da Fase 2, ADR-0042), salvo as duas peças da decisão DS que entram
acima (as tarefas das filas e a consulta das vendas).

**Antes do primeiro comerciante de fora:** o motor de IVA validado pelo
contabilista, os fluxos do consumidor validados por jurista, o contrato com
limites de responsabilidade e o seguro, e o modelo de receita (D-14).

**As lojas do próprio grupo:** uma loja **pequena e contida** primeiro,
em paralelo com o Shopify, **nunca a loja principal primeiro**. O piloto de
pagamentos EuPago e Stripe já desenhado para a plataforma de formação
(29/09/2026) segue o seu caminho; o Eurolify reaproveita o desenho dele.

**Critério de passagem:** 3 meses de vendas reais, em todos os comerciantes,
sem um documento fiscal errado com origem no Eurolify; pagamentos 100 % conciliados; os testes de
isolamento entre inquilinos sempre verdes; o botão de livre resolução usado e
tratado de ponta a ponta pelo menos uma vez — até ao reembolso e à nota de
crédito (decisão AD).

## Fase 2 — O Hub do Eurolify e mais países

> Os módulos desta fase passaram pelas 8 portas a 03/10/2026:
> [`13-portas-da-fase-2.md`](13-portas-da-fase-2.md). Três peças passaram para
> a Fase 1 a 04/10/2026 (decisão AD, ADR-0022): o relatório OSS, o núcleo das
> devoluções e os lotes com os compostos.
>
> O **digital** (conteúdo e serviço) e os **cartões-oferta** estão desenhados
> e **desligados até à sua porta** (decisão do Diogo, ADR-0034): as condições
> estão nas fatias 12 e 13 de [`eurolify/implementation-plan.md`](eurolify/implementation-plan.md)
> e no §5 de [`eurolify/architecture.md`](eurolify/architecture.md), não neste
> documento.

- Armazém completo: vários armazéns, picking, inventários (os lotes e os
  compostos passaram para a Fase 1, decisão AD).
- **Troca e carteira** nas devoluções (a carteira com validação do
  contabilista); o núcleo das devoluções passou para a Fase 1 (decisão AD).
- **Emissão de faturas por adaptador nos outros países** (Verifactu em
  Espanha, Plateforme Agréée em França…), conforme D-4 — o Moloni já entrou na
  Fase 1.
- Ligações ao software de faturação dos comerciantes estabelecidos noutros
  países, país a país (o relatório OSS passou para a Fase 1, decisão AD).
- Automações e notificações configuráveis; campos personalizados; módulos
  ligáveis por comerciante.
- Migração da loja principal do grupo, se a Fase 1 o justificar.
- **Montra do Eurolify** (kit de loja e temas por comerciante, `eurolify-design`)
  — decidido pelo Diogo a 05/10/2026 (*«Fase 2»*, auditoria `docs/16`). O
  checkout alojado e os momentos legais não mudam de fase com esta decisão.
- **Loja física (POS, caixa, recolha em loja), distribuidores, revendedores e
  franchising** — decidido pelo Diogo a 05/10/2026 (*«Fase 2, só as listas B2B
  ficam na Fase 1»*, Q3 do `docs/16`); as listas de preços B2B por etiqueta
  ficam na Fase 1. Estes módulos **ainda não passaram pelas 8 portas** do
  `13-portas-da-fase-2.md`. Skills: `eurolify-physical-retail-eu`,
  `eurolify-b2b-channels-eu`, `eurolify-contracts-operations-eu`.
- **Módulos de gestão da empresa inteira** — decidido pelo Diogo a 11/10/2026
  ([ADR-0042](adr/0042-gestao-da-empresa-em-modulos-da-fase-2.md)), a partir
  do Hub interno actual ([`31-hub-de-gestao-da-empresa.md`](31-hub-de-gestao-da-empresa.md)).
  Entram **a partir desta fase**, em módulos que cada comerciante liga, pelas
  camadas do `docs/31` §8:
  - **B. Operação:** balcão (POS), armazém completo, compras e fornecedores,
    apoio ao cliente, tarefas sobre um registo, painéis;
  - **C. Comercial:** leads e prospecção, chamadas do dia pelo ritmo de compra,
    saúde da carteira, encomenda feita pela equipa com ligação de pagamento,
    comissões sobre o faturado, metas;
  - **D. Financeiro:** despesas com leitura por IA e decisão de uma pessoa,
    extractos e conciliação, tesouraria, lucro por área;
  - ~~**E. Organização:** projectos, procedimentos e objectivos, comunicação
    interna~~ — **não entra como módulo** (DS, ADR-0043): os lançamentos
    agendados vão para o Catálogo; o assistente interno é o MCP de leitura;
  - **F. Por sector:** fabrico (fórmulas, lotes de enchimento, rótulos),
    formação (fatia 12); ~~marketing e gráfica~~ — **não entra como módulo**
    (DS): os feeds do catálogo e as avaliações de quem comprou vão para o
    Catálogo;
  - ~~**G. Pessoas:** RH, assiduidade, férias, fecho do mês~~ — **não entra
    como módulo** (DS): fica a equipa e os papéis do Hub; um programa de RH
    liga-se por extensão; **nenhuma biometria** sem o jurista;
  - **H. Parceiros:** portais de revendedor, distribuidor, franqueado e
    formador (fatia 14).

  **Os primeiros alvos de cada módulo** são os do `docs/13` §7 a §19,
  aprovados a 11/10/2026 (decisão DS).

  O balcão, o armazém completo, as automações e os parceiros já estavam nesta
  fase (bullets acima); o ADR-0042 junta-lhes o resto. Cada módulo passa pelas
  8 portas antes do desenho (`13-portas-da-fase-2.md`) e tem o modelo e a lista
  da API em tabela antes do código (ADR-0023). Os assistentes de IA que
  escrevem esperam pela Fase 3 (ADR-0040). **Não estão estimados** (`docs/10`)
  e **não contam para o critério de passagem** desta fase.
- **Primeiros parceiros convidados a escrever eles próprios o seu adaptador**
  (decidido pelo Diogo a 03/10/2026, decisão L): prestadores e transportadoras da lista de parcerias
  (`07-pagamentos-e-envios-por-pais.md`), com os contratos que o Eurolify já usa.

**Critério de passagem (proposta):** comerciantes estabelecidos em pelo menos
dois países a vender há 3 meses sem documento fiscal errado com origem no
Eurolify; a loja principal do grupo migrada sem perda de clientes nem de
consentimentos.

## Fase 3 — Extensões abertas e comércio por agentes

Extensões de terceiros abertas a qualquer programador e loja de extensões
(`08-extensoes-de-terceiros.md`), MCP com escrita sob confirmação, UCP/ACP,
API de checkout com verificação de conformidade. (O registo de comerciantes,
os contratos, a faturação do Eurolify, o suporte e a exportação completa
passaram à Fase 1 — ADR-0006.)

## Fase 4 — Marketplace (só com requisitos concretos)

Vendedores terceiros, verificação de empresas, pagamentos repartidos pelo
produto de plataformas do prestador, obrigações do DSA e da DAC7, comissões.
**Não se activa nada disto sem um caso de negócio escrito.**
