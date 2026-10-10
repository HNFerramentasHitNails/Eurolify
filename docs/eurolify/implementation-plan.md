# Eurolify — plano de implementação por fatias

> **Versão de 04/10/2026.** Pedido do Diogo (ADR-0034). As fases são as de
> [`docs/05-fases-e-mvp.md`](../05-fases-e-mvp.md); este plano parte a Fase 1
> em **fatias verticais** (cada uma atravessa domínio, API, testes e
> auditoria) pela ordem do `eurolify-platform-orchestrator` (skill do pacote
> de 04/10, lida a partir do zip e **não instalada** — ADR-0034): entrada do
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
| 1 | **Motor de regras por país**: registo dos 27, decisão pura, `GET /paises` | — | `architecture.md` §4 | testes verdes + revisão de uma sessão nova (ADR-0030; desde o ADR-0035, também um agente lançado da sessão) | cada regra nacional com fonte lida e revisor | Diogo (#37; correcções da revisão: issue #39) | **feito** — 65 testes; nada sai «permitido»; entrou no `main` antes da revisão — P0 e P1 corrigidos depois (issue #39); o P1 da revisão do #40 na issue #46; propostas num domínio por verificar e os P2 da 2.ª revisão do #47 no #49 |
| 2 | Comerciante e entidade legal: registo, estados (rascunho → prova pendente → revisão → aprovado limitado → activo; suspenso, fechado), isolamento por comerciante na base (RLS) | 1 | [`docs/15`](../15-dominio-comerciante.md) (issue #41), decidido | testes verdes + teste que tenta ler o vizinho + revisão **antes** de juntar (sessão nova, ADR-0030, ou agente da sessão, ADR-0035) | os dois utilizadores da base na VPS; contrato e acordo de tratamento (jurista) | Diogo | **feito** (#43, #69, #73) — esquema, RLS, migrador, 40 testes contra o PostgreSQL 18.6 (e 7 do migrador); aplicado na VPS a 04/10/2026 (#71, #70); sem API até à fatia «identidade» |
| 3 | Catálogo: artigo, variante, tradução, publicação por canal × mercado | 2 | `docs/14` | idem | P1, P2, P4–P7 respondidas | Diogo | **em curso** (issue #77) — partes 1 a 4 no `main` (a 4 com a Conformidade por verificar, `docs/06`, CF; a media verifica-se desde 08/10/2026, CR); os eventos de domínio no `main` (outbox, migração 0021, #143); a reverificação das publicações no `main` (migração 0023, #146, `docs/06`, CJ); as consultas da API em pedido; as imagens no `main` (#176) e na verificação (CR); a exportação e a importação no `main` (CS, CT); a linha do tempo em pedido (migração 0033, `docs/06`, CU) |
| 4 | Preços e mercados: listas, mercados, histórico de 30 dias, listas B2B por relação | 1, 3 | [`docs/20`](../20-dominio-precos-e-mercados.md) (aprovado a 06/10/2026; `architecture.md` §3 para o B2B) | idem | regra do preço de referência (**C**, jurista) | Diogo | **parte 1 no código e no ensaio** (#134, migração 0017); **parte 2 em pedido** (migração 0036, `docs/20` §10, `docs/06` CW): rotas, redução, preço por unidade, eventos `promotion.*`; a API da Loja espera pelo Motor de IVA (issue #127) |
| 5 | Clientes e perfis de faturação; finalidade por encomenda (consumo, profissional, revenda) | 2 | [`docs/23`](../23-dominio-clientes.md) (issue #233), aprovado a 09/10/2026 (`docs/06`, CX) | idem | VIES com prova; validação do contabilista | Diogo | **parte 1 no código** (#234, migração 0037): fichas, perfis com a régua do NIF, etiquetas, linha do tempo, eventos; **parte 3 no código** (#244, migração 0039): VIES com prova e isenção manual; parte 2 (consentimentos, duplicados, titulares) e os anexos da isenção por fazer |
| 6 | Motor de IVA: categorias, taxas com vigência, territórios | 1, 5 | [`docs/24`](../24-motor-de-iva.md) (issue #255), aprovado a 09/10/2026 (`docs/06`, CZ) | idem | **contabilista valida**; domínio IVA verificado por país no registo | Diogo | **no código** (#256, migração 0040; publicado no ensaio a 09/10/2026): tabelas, regime, decisão e simulação; as taxas dos outros 26 países por carregar (TEDB + contabilista) |
| 7 | Checkout alojado: total, condições, perfil de faturação, consentimentos por linha | 3–6 | [`docs/25`](../25-checkout.md) (issue #273), aprovado a 09/10/2026 (`docs/06`, DA) | idem | jurista valida os fluxos; botão de livre resolução; envio da confirmação (Q4) | Diogo | **parte 1 no código** (#276, migração 0041): carrinho, sessão, textos legais, métodos de entrega, resumo e botão final (só físicos); parte 2 (páginas, limpezas, confirmação por e-mail) por fazer |
| 8 | Pagamentos por adaptador (EuPago, Stripe), confirmação no servidor, conciliação | 7 | [`docs/26`](../26-pagamentos.md), aprovado a 09/10/2026 (`docs/06`, DB) | idem | conta do comerciante no prestador; nada passa pelo Eurolify; documentação da EuPago lida (V1–V6); regra 4 para a Stripe | Diogo | **parte 1 em pedido** (migração 0044): contas EuPago em modo teste, régua método → conta, pagamento com a máquina de estados, avisos assinados, incerto e fila de diferenças, encomenda paga ou cancelada; parte 2 (Stripe) depois da regra 4 |
| 9 | Stock e encomendas: reservas, lotes na linha expedida, compostos | 3, 8 | [`docs/27`](../27-stock-e-encomendas.md), aprovado a 10/10/2026 (`docs/06`, DE) | idem | prazo de livre resolução por país (jurista); data do documento fiscal (contabilista) | Diogo | **parte 1 em pedido** (migração 0047): livro de movimentos, lotes, kits, reserva no botão final, expedições à mão, vista do armazém; parte 2 (transportadoras) por fazer |
| 10 | Documento fiscal por adaptador (Moloni) e prova do documento | 6, 9 | [`docs/28`](../28-documentos-fiscais.md) (issue #310), **por aprovar** | idem | contabilista (V1 a V10 do `docs/28`); ADR-0037 e ADR-0041 | Diogo | **desenho em pedido** |
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
- **Testes** (`apps/api/test/regras.test.ts`, 33 a 04/10/2026, contados com
  `grep -c "it("`): 27 códigos únicos; `GR` e não `EL`; registo sem regras,
  coerente e congelado; nenhuma combinação permitida com o registo de partida
  (11 domínios, juntos e um a um); código de país inválido e país fora da UE;
  momentos que não são ISO 8601 com fuso, e datas impossíveis; lista de
  domínios vazia recusada; domínio desconhecido recusado; regra em vigor
  permite com a versão; proposta, adoptada, revogada (com e sem data);
  território não mapeado, território mapeado com e sem regra própria; só
  domínios «não aplicáveis» não permitem; um domínio não aprova outro; um país
  não bloqueia outro; validação do registo (8 casos de incoerência) e a
  aplicação a recusar arrancar; `GET /paises` sem quem reviu nem quando.
- **Como se correu** (04/10/2026, nesta sessão, Node 22 local; o projecto pede
  Node 24, ADR-0025, e o GitHub corre com o 24): `pnpm teste` (api: 35
  passaram, 1 saltou — o da base, sem PostgreSQL aqui), também com o servidor
  nos fusos de Paris, Kiritimati e Los Angeles; `pnpm tipos`, `pnpm lint`,
  `pnpm construir` sem erros.
- **Revisão:** o #37 entrou no `main` às 14:34 UTC, **antes** de a revisão
  estar publicada (14:36 UTC). A revisão
  ([#37](https://github.com/HNFerramentasHitNails/Eurolify/pull/37#pullrequestreview-5406682412))
  achou 1 P0 (lista de domínios vazia saía «permitido»), 2 P1 (datas sem fuso
  e registo incoerente em silêncio) e 9 P2; corrigidos no #40 (issue #39).
  O #40 também entrou (14:51 UTC) antes da revisão dele (14:58 UTC,
  [#40](https://github.com/HNFerramentasHitNails/Eurolify/pull/40#pullrequestreview-5406771672)):
  1 P1 (um estado de revisão desconhecido era tratado como «verificado») e 6
  P2, corrigidos no #47 (issue #46) — 48 testes no motor a 04/10/2026
  (`grep -c "  it("`). O #45 corrigiu a mesma revisão noutro ramo; o que ele
  tinha e o #47 não (a mesma `id` em dois sítios, `-00:00`) veio num pedido
  à parte — 58 testes. Os dois P2 da última revisão do #47 e a decisão do
  Diogo sobre propostas num domínio por verificar vieram no #49 — 65 testes
  no motor a 04/10/2026 (`grep -c "  it("`).

## Próxima fatia proposta

A fatia 2 está feita e a 3 (Catálogo) está em curso (#77; a classificação do
artigo entrou no #96). A seguir, pela ordem da tabela, a **4 (Preços e
mercados)**, que a publicação do Catálogo (parte 4 do #77) pede — antes dela,
o desenho em tabela (ADR-0023). Actualizado a 05/10/2026 (auditoria `docs/16`).
