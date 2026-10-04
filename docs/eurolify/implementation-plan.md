# Eurolify — plano de implementação por fatias

> **Versão de 04/10/2026.** Pedido do Diogo (ADR-0034). As fases são as de
> [`docs/05-fases-e-mvp.md`](../05-fases-e-mvp.md); este plano parte a Fase 1
> em **fatias verticais** (cada uma atravessa domínio, API, testes e
> auditoria) pela ordem do `eurolify-platform-orchestrator`: entrada do
> comerciante → catálogo → checkout → pagamento → stock → encomenda → fatura →
> pós-venda. Antes da primeira fatia de cada domínio, o desenho dele em tabela
> (ADR-0023). As lacunas legais de cada fatia estão em
> [`compliance-gaps.md`](compliance-gaps.md).
>
> **Estado:** `feito` (testes a passar), `em curso`, `bloqueado` (diz porquê),
> `por fazer`. **Nenhuma fatia vai para produção** sem a porta dela; a
> produção ainda nem existe (ADR-0027: só o ensaio).

## Fatias

| # | Fatia | Depende de | Desenho | Porta para entrar no `main` | Porta para produção | Responsável | Estado |
|---|---|---|---|---|---|---|---|
| 0 | Esqueleto, publicação, VPS | — | ADR-0025 a 0028 | testes verdes | — | Diogo | **feito** (antes deste plano) |
| 1 | **Motor de regras por país**: registo dos 27, decisão pura, `GET /paises` | — | `architecture.md` §4 | testes verdes + revisão de uma sessão nova (ADR-0030) | cada regra nacional com fonte lida e revisor | Diogo (pedido #37) | **feito** — 18 testes; tudo sai «revisão necessária» |
| 2 | Comerciante e entidade legal: registo, estados (rascunho → prova pendente → revisão → aprovado limitado → activo; suspenso, fechado), isolamento por comerciante na base (RLS) | 1 | **por fazer** (skill `merchant-onboarding` do pacote, não instalada) | idem + teste que tenta ler o vizinho | acordo de tratamento de dados e contrato de serviço (jurista) | — | por fazer |
| 3 | Catálogo: artigo, variante, tradução, publicação por canal × mercado | 2 | `docs/14` | idem | P1, P2, P4–P7 respondidas | — | **bloqueado**: perguntas do `docs/14` §9 |
| 4 | Preços e mercados: listas, mercados, histórico de 30 dias, listas B2B por relação | 1, 3 | **por fazer** (`architecture.md` §3 para o B2B) | idem | regra do preço de referência (**C**, jurista) | — | por fazer |
| 5 | Clientes e perfis de faturação; finalidade por encomenda (consumo, profissional, revenda) | 2 | **por fazer** | idem | VIES com prova; validação do contabilista | — | por fazer |
| 6 | Motor de IVA: categorias, taxas com vigência, territórios | 1, 5 | **por fazer** (`eu-vat-oss-ioss`) | idem | **contabilista valida**; domínio IVA verificado por país no registo | — | por fazer |
| 7 | Checkout alojado: total, condições, perfil de faturação, consentimentos por linha | 3–6 | **por fazer** | idem | jurista valida os fluxos; botão de livre resolução | — | por fazer |
| 8 | Pagamentos por adaptador (EuPago, Stripe), confirmação no servidor, conciliação | 7 | **por fazer** (`payments-psd2-sca`) | idem | conta do comerciante no prestador; nada passa pelo Eurolify | — | por fazer |
| 9 | Stock e encomendas: reservas, lotes na linha expedida, compostos | 3, 8 | **por fazer** (`order-fulfilment`) | idem | — | — | por fazer |
| 10 | Documento fiscal por adaptador (Moloni) e prova do documento | 6, 9 | **por fazer** | idem | contabilista; D-10 | — | por fazer |
| 11 | Pós-venda: livre resolução → devolução → reembolso → nota de crédito | 9, 10 | **por fazer** | idem | jurista | — | por fazer |
| 12 | **Digital** (conteúdo e serviço) | 3, 6, 7, 8 | **por fazer** (`digital-products-eu`) | idem | os 16 testes da skill; jurista e contabilista; fornecedor perante o IVA decidido | — | por fazer — **desenhado, desligado** até à porta (decisão do Diogo, ADR-0034) |
| 13 | **Cartões-oferta** (programa fechado por comerciante) | 3, 6, 8, 11 | **por fazer** (`gift-cards-eu`) | idem | os 21 testes; choque da carteira decidido; porta PSD2 se sair de um comerciante | — | por fazer — **desenhado, desligado** até à porta |
| 14 | Canais: relação comercial, versão do contrato, política do canal (tudo sensível desligado) | 2, 4, 5 | `architecture.md` §3 (proposta) | idem | jurista de concorrência | — | por fazer — fora da Fase 1 salvo as listas B2B (fatia 4) |

## A primeira fatia (feita neste pedido)

- **O que é:** `apps/api/src/regras/` — tipos, registo de partida (27 países,
  sete domínios obrigatórios e quatro condicionais, todos `por_verificar`,
  nenhum território, nenhuma regra), a função `decidir` e o `GET /paises`.
- **Porquê primeiro:** não depende de nenhuma pergunta em aberto, não inventa
  nenhuma regra, e todas as fatias seguintes (IVA, checkout, livre resolução,
  digital, vales) precisam de lhe perguntar antes de agir.
- **Testes** (`apps/api/test/regras.test.ts`, 18): 27 códigos únicos; `GR` e
  não `EL`; registo sem regras; nenhuma combinação permitida com o registo de
  partida; país fora da UE recusado (CH, GB, EL, minúsculas, vazio); momento
  inválido recusado; regra em vigor permite com a versão; domínio verificado
  sem regra pede revisão; proposta nunca decide; adoptada só a partir da data;
  revogada deixa de valer na data de fim; revogada sem data não conta;
  território não mapeado não herda; um domínio não aprova outro; um país não
  bloqueia outro; «não aplicável» não bloqueia; versão nova não reescreve
  decisão antiga; `GET /paises` com os 27 por verificar.
- **Como se correu** (04/10/2026, nesta sessão): `pnpm teste` (api: 20
  passaram, 1 saltou — o da base, sem PostgreSQL aqui), `pnpm tipos`, `pnpm
  lint`, `pnpm construir`: todos sem erros. Node 22 local; o projecto pede
  Node 24 (ADR-0025) — o GitHub corre com o 24.
- **O que falta para entrar no `main`:** a revisão do código por uma sessão
  nova do Claude Code, sem esta conversa (ADR-0030, ADR-0031).

## Próxima fatia proposta

A **2 (comerciante e entidade legal)**: é a primeira com tabelas, RLS e o
teste de isolamento, e não depende das perguntas do Catálogo. Antes dela, o
desenho em tabela (ADR-0023).
