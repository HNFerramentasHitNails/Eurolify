# Pós-venda, parte 2: o reembolso do MB WAY pela EuPago (#328, #350), 11/10/2026

## O que se fez

- **Pedido do Diogo, 11/10/2026:** *«avança com a parte 2 da pós-venda»*. A Q2
  deixava o reembolso manual até se ler a documentação da EuPago.
- **Lida a documentação pública da EuPago** a 11/10/2026 (**W**; nada corrido
  contra a sandbox, sem credenciais de teste). Três novidades: o reembolso usa
  **OAuth** (`client_id`, `client_secret`), não a chave da cobrança; pede o
  **`trid`**, que só chega nos avisos; **não há chave de idempotência**.
  Desenho em `docs/30` §13.
- **Decisão do Diogo:** *«aprovado, com a A»* (`docs/06`, **DP**): o MB WAY
  reembolsa-se pela EuPago; o **Multibanco continua à mão** (a nota da
  EuPago só dispensa o IBAN no MB WAY e no cartão; o Eurolify não recebe
  IBANs).
- **Código (#350, migração 0061):**
  - o `trid` gravado uma vez no pagamento, do aviso assinado;
  - o reembolso ganha `a_pedir` (dura a chamada: dois pedidos ao mesmo tempo
    não saem os dois) e `a_confirmar` (aceite, à espera de a consulta dizer
    «reembolsado»); sem resposta fica `incerto` e só uma pessoa reconcilia;
  - um pedido aceite pelo prestador **nunca volta a pedir-se** (P1-1 da
    revisão): só passa a `executado`;
  - os tectos de R5 conferem-se outra vez ao voltar a `a_executar`;
  - `POST /refunds/{id}/execute` e `/reconcile`; a tarefa de minuto a
    minuto consulta os `a_confirmar`, passa a `incerto` os `a_pedir` com mais
    de 5 minutos e põe na fila os que passam 7 dias sem confirmação;
  - o aviso `Refund` acorda a consulta, junta prova a um `incerto`, ou vai à
    fila se o Eurolify não pediu nenhum reembolso.
- **A migração é a 0061:** começou como 0060; o #351 (rasto, a origem das
  tarefas) entrou primeiro com esse número. A fila dos reembolsos segue a
  regra dele (guarda a origem de quem pediu).
- **Revisão do agente** (`eurolify-critical-review`, Claude Sonnet 5.5,
  ADR-0035): 0 P0, 1 P1, 6 P2; tratados, com o que fica dos P3 explicado no
  pedido.
- **Juntado** a 11/10/2026 (`644a529`). **Publicado no ensaio:** corrida 38155543630, com sucesso às 16:38 UTC; o registo diz «migrar: aplicadas 0061_pos_venda_reembolso_prestador» e «O /health da API responde».

## Números (com data e como se contaram)

- 11/10/2026, neste contentor (PostgreSQL 18.6 da lista
  `infra/ci/imagens-base.txt`, Node 24.21), com o `main` do #351: `pnpm lint` e
  `pnpm tipos` limpos; **API 1352 de 1352**, Hub 161, MCP 58.
- `test/posvenda-api.test.ts`: 10 testes novos (5 + 5 da revisão).
- Mutações: 23, todas apanhadas.

## O que ficou por verificar

- **Na sandbox, antes do modo real (V7 a V12 do `docs/30` §13.4):** o pedido e
  a resposta; os outros estados da consulta e se o `Success` é dinheiro saído;
  se o `trid` do aviso é o que o reembolso pede; se o `rfd_…` aparece no
  extracto; se a NC pode sair sozinha com o «reembolsado» da consulta.
- **Por fazer:** o aviso do prazo do reembolso (R10) e a marca «selado por
  higiene» (R4).
- **Jurista e contabilista:** J1 a J5 e C1 a C4 continuam abertos.
- **Não li a base do ensaio** depois de publicar.
