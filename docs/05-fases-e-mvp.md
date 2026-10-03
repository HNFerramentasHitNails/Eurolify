# Fases e primeira versão (MVP)

> **Versão de 03/10/2026 — proposta.** Sem datas nem custos: dependem das
> decisões D-1, D-2 e D-3 (`06-decisoes-em-aberto.md`). Cada fase tem um
> **critério de passagem** medível; não se passa à seguinte por calendário.

## Fase 0 — Decidir e desenhar (agora; sem código)

| Entregável | Estado a 03/10/2026 |
|---|---|
| Proposta, arquitectura, mapa regulamentar, lições dos sistemas actuais | escrito (este repositório) |
| As 12 skills de trabalho para as sessões de Claude | escrito (`.claude/skills/`) |
| Decisões D-1, D-2, D-3 | **por decidir** |
| Prova de 2 semanas com a Medusa (D-2) | **precisa do OK** do Bruno ou do Diogo — é código, ainda que de ensaio (ADR-0001) |
| Modelo de domínio (entidades, estados, quem é dono de quê) em tabelas | por fazer |
| Lista de recursos e operações da API (em tabela; o ficheiro OpenAPI só depois do OK) | por fazer |
| Regras do motor de IVA validadas pelo contabilista | por fazer |
| Fluxos do consumidor (checkout, confirmação, livre resolução, garantia) validados por jurista | por fazer |
| Conversas com 3 a 5 comerciantes de fora (para D-1 e D-14) | por fazer |
| Estimativa de prazo e custo (D-13) | por fazer, depois de D-1 a D-3 |

**Critério de passagem:** D-1 a D-3 e D-13 decididas e registadas em ADR; o OK
escrito do Bruno ou do Diogo para começar código (ADR-0001).

## Fase 1 — Núcleo e cliente zero

**Âmbito — entra:**

- Catálogo com variantes, kits/coleções, traduções e os campos regulamentares
  (fabricante, pessoa responsável, avisos, INCI, lote) — se o cliente zero já
  tiver um sistema de gestão, o catálogo continua a **nascer lá** e é espelhado
  para o Lumavo pela API, como hoje para o Shopify.
- Mercados **Portugal e Espanha**, em euros; listas de preços B2B por etiqueta;
  quantidades mínimas; histórico de preços (30 dias).
- Carrinho e **checkout alojado**, com perfis de faturação, «a fatura é para
  outra pessoa/empresa», validação VIES com prova e o motor de IVA
  (PT, UE, fora da UE, Canárias/Ceuta/Melilla, Açores/Madeira).
- Pagamentos **EuPago** e **Stripe**, com a régua método → prestador → conta.
- Encomendas e stock (um armazém, reservas, disponível por canal).
- **Entrega das encomendas ao sistema de gestão do cliente zero**, que continua
  a faturar no software certificado (D-10).
- Envios com **CTT** e mais uma transportadora ou agregador.
- **Botão de livre resolução**, área de cliente, confirmação com prova
  contratual, notificações em PT/ES/EN.
- RGPD essencial: consentimentos numa régua só, exportação e apagamento com a
  retenção fiscal respeitada.
- API da Loja, API de Administração, webhooks, SDK TypeScript, **MCP de
  leitura**, pacote para construtores de frontends.
- Hub do Lumavo mínimo: definições, encomendas, registo de integrações e de
  webhooks, auditoria.

**Âmbito — fica de fora:** emissão de faturas pelo Lumavo (emite o sistema do
cliente zero),
devoluções completas, carteira, vários armazéns, outros países, marketplace,
escrita por IA, protocolos de comércio por agentes, faturação do próprio
Lumavo.

**A primeira loja real (por decidir em D-1):** uma loja **pequena e contida**,
em paralelo com o Shopify, **nunca a loja principal primeiro**. O piloto de
pagamentos EuPago e Stripe já desenhado para a plataforma de formação
(29/09/2026) segue o seu caminho; o Lumavo reaproveita o desenho dele.

**Critério de passagem:** 3 meses de vendas reais sem um documento fiscal
errado com origem no Lumavo; pagamentos 100 % conciliados; os testes de
isolamento entre inquilinos sempre verdes; o botão de livre resolução usado e
tratado de ponta a ponta pelo menos uma vez.

## Fase 2 — O Hub do Lumavo e mais países

- Armazém completo: vários armazéns, picking, lotes, compostos, inventários.
- **Devoluções ligadas à nota de crédito**, com o estado do artigo; troca e
  carteira (com validação do contabilista).
- **Emissão de faturas por adaptador** para comerciantes que não têm um Hub:
  Moloni primeiro; depois por país (Verifactu em Espanha, Plateforme Agréée em
  França…), conforme D-4.
- Relatório OSS com os quatro baldes; mais mercados por procura.
- Automações e notificações configuráveis; campos personalizados; módulos
  ligáveis por comerciante.
- Migração da loja principal do cliente zero, se a Fase 1 o justificar.

**Critério de passagem:** um segundo comerciante, de fora, a vender há 3
meses; a loja principal do cliente zero migrada sem perda de clientes nem de
consentimentos.

## Fase 3 — Abrir a outros comerciantes

Onboarding, contratos (incluindo o acordo de tratamento de dados), faturação do
Lumavo, extensões de terceiros, MCP com escrita sob confirmação, UCP/ACP,
API de checkout com verificação de conformidade, exportação completa (Data
Act), níveis de serviço e suporte.

## Fase 4 — Marketplace (só com requisitos concretos)

Vendedores terceiros, verificação de empresas, pagamentos repartidos pelo
produto de plataformas do prestador, obrigações do DSA e da DAC7, comissões.
**Não se activa nada disto sem um caso de negócio escrito.**
