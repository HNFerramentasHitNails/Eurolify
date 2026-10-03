# Fases e primeira versão (MVP)

> **Versão de 03/10/2026 — proposta.** D-1, D-2 e D-3 foram decididas a
> 03/10/2026 (`06-decisoes-em-aberto.md`); a estimativa de prazo e custo da
> Fase 1 está em `10-estimativa-prazo-e-custo.md`; a D-13 foi decidida
> (ADR-0008: o Diogo e o Bruno desenvolvem, com Claude Code e Codex). O
> tempo de cada fase está no §9 desse documento (hipótese, corrigida às 8
> semanas); o critério de passagem continua a mandar, não o calendário. Cada fase tem um
> **critério de passagem** medível; não se passa à seguinte por calendário.

## Fase 0 — Decidir e desenhar (agora; sem código)

| Entregável | Estado a 03/10/2026 |
|---|---|
| Proposta, arquitectura, mapa regulamentar, lições dos sistemas actuais | escrito (este repositório) |
| As 14 skills de trabalho para as sessões de Claude Code e de Codex | escrito (`.agents/skills/`, com ligações em `.claude/skills/`; ADR-0010) |
| Decisões D-1, D-2, D-3 | **todas decididas** a 03/10/2026: D-1 vender desde o início (ADR-0006), D-2 de raiz (ADR-0002), D-3 europeu gerido, Scaleway (ADR-0003, ADR-0004) — **revista**: VPS operada por nós, com o Claude (ADR-0015, ADR-0016) |
| Escolher o alojamento (D-3) | **revisto** a 03/10/2026: VPS operada por nós (ADR-0015); fornecedor e plano por escolher (`11-preparacao-da-vps.md` §7) — antes, Scaleway (ADR-0004) |
| Conta da Scaleway e acesso só de leitura do Claude | **preparado** (ADR-0011): projecto `eurolify-ensaio`, chave do Diogo só de leitura, `scw` nas sessões. Falta a chave do Bruno e confirmar o portador da chave — **sem efeito** com a VPS (ADR-0015) |
| Preparação da VPS (ADR-0015, ADR-0016) | **por fazer** — guia em `11-preparacao-da-vps.md`; o script entra no `main` com as duas revisões (ADR-0013) |
| Contratos de adaptadores e pontos de extensão (requisito K) | por fazer — desenho em `08-extensoes-de-terceiros.md` |
| Prova de 2 semanas com a Medusa (D-2) | **cancelada** — a D-2 foi decidida a 03/10/2026: núcleo próprio, de raiz (ADR-0002) |
| Modelo de domínio (entidades, estados, quem é dono de quê) em tabelas | por fazer |
| Lista de recursos e operações da API (em tabela; o ficheiro OpenAPI só depois do OK) | por fazer |
| Regras do motor de IVA validadas pelo contabilista | por fazer |
| Fluxos do consumidor (checkout, confirmação, livre resolução, garantia) validados por jurista | por fazer |
| Conversas com 3 a 5 comerciantes de fora (para D-14 e para a 1.ª versão) | por fazer |
| Modelo de receita (D-14) — a base é precisa antes da Fase 1, porque se vende desde o início; os preços, antes da peça 13 (ADR-0012) | **base decidida** (ADR-0007: mensalidade por escalões, sem taxa sobre as vendas); preços por decidir, depois das conversas com comerciantes |
| Contrato de serviço, acordo de tratamento de dados, limites de responsabilidade e seguro, com jurista | por fazer |
| Estimativa de prazo e custo (D-13) | **decidida** a 03/10/2026 (ADR-0008): desenvolvem o Diogo e o Bruno, com Claude Code e Codex; tempo por fases em `10-estimativa-prazo-e-custo.md` §9 (Fase 1: 15 a 29 meses a tempo inteiro, 28 a 52 a meio tempo), corrigido às 8 semanas (§6). Falta pedir os orçamentos do contabilista, do jurista e do seguro |

**Critério de passagem** (mudado a 03/10/2026, ADR-0012): a D-13 decidida
(ADR-0008), a base da D-14 decidida (ADR-0007) e o OK escrito do Bruno ou do
Diogo para começar código (ADR-0001). Os preços da D-14 têm de estar decididos
antes de começar a peça 13 da Fase 1 (abertura a comerciantes).

## Fase 1 — Núcleo e os primeiros comerciantes (vende-se desde o início)

**Âmbito — entra:**

- Catálogo com variantes, kits/coleções, traduções e os campos regulamentares
  (fabricante, pessoa responsável, avisos, INCI, lote) — se o comerciante já
  tiver um sistema de gestão, o catálogo continua a **nascer lá** e é espelhado
  para o Eurolify pela API, como hoje para o Shopify.
- **Toda a UE de raiz** (decisão F, 03/10/2026): taxas dos 27 países, OSS,
  NIF e VIES, territórios especiais; listas de preços B2B por etiqueta;
  quantidades mínimas; histórico de preços (30 dias).
- Carrinho e **checkout alojado**, com perfis de faturação, «a fatura é para
  outra pessoa/empresa», validação VIES com prova e o motor de IVA
  (PT, UE, fora da UE, Canárias/Ceuta/Melilla, Açores/Madeira).
- Pagamentos **EuPago** e **Stripe**, com a régua método → prestador → conta.
- Encomendas e stock (um armazém, reservas, disponível por canal).
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
- RGPD essencial: consentimentos numa régua só, exportação e apagamento com a
  retenção fiscal respeitada.
- API da Loja, API de Administração, webhooks, SDK TypeScript, **MCP de
  leitura**, pacote para construtores de frontends.
- **Os adaptadores do próprio Eurolify** (pagamentos, envios, faturação)
  escritos com os contratos de extensão, como se fossem de terceiros (requisito K).
- Hub do Eurolify mínimo: definições, encomendas, registo de integrações e de
  webhooks, auditoria.

**Âmbito — fica de fora:** emissão de faturas pelo próprio Eurolify (emite o
software certificado de cada comerciante), emissão por adaptador fora de
Portugal (entra país a país), devoluções completas, carteira, vários armazéns,
marketplace, escrita por IA, protocolos de comércio por agentes, extensões
abertas a qualquer programador.

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
tratado de ponta a ponta pelo menos uma vez.

## Fase 2 — O Hub do Eurolify e mais países

- Armazém completo: vários armazéns, picking, lotes, compostos, inventários.
- **Devoluções ligadas à nota de crédito**, com o estado do artigo; troca e
  carteira (com validação do contabilista).
- **Emissão de faturas por adaptador nos outros países** (Verifactu em
  Espanha, Plateforme Agréée em França…), conforme D-4 — o Moloni já entrou na
  Fase 1.
- Relatório OSS com os quatro baldes; ligações ao software de faturação dos
  comerciantes estabelecidos noutros países, país a país.
- Automações e notificações configuráveis; campos personalizados; módulos
  ligáveis por comerciante.
- Migração da loja principal do grupo, se a Fase 1 o justificar.
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
