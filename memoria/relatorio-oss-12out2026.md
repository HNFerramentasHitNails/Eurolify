# Relatório OSS (#310, parte 3), 12/10/2026

## O que se fez

- **Desenho** em `docs/37`, aprovado pelo Diogo a 12/10/2026 (*«sim, aprovo o
  desenho com as propostas Q-O1 a Q-O5»*; `docs/06`, **EF** — nasceu docs/36 e
  ED, renumerado porque os Envios chegaram primeiro ao `main`).
- **Código** no #392, juntado a 12/10/2026 (commit `9fde4252`). A migração é a
  **0078** (passou pela 0071, 0072 e 0075 a cada junção do `main`). Rotas:
  - `GET /tax-reports/oss`;
  - `POST /tax-reports/oss/close`;
  - `POST /tax-reports/oss/classifications`;
  - `GET /tax-reports/oss/records`.
- **Três revisões** por agente da sessão (Opus 5.5), publicadas no #392:
  - 1.ª: P1 de fórmulas no CSV, de linhas casadas pela contagem e de emitidas
    fora contadas duas vezes;
  - 2.ª: dois P1 decididos pelo Diogo — **P1-B**, não se fecha um período
    anterior ao último fechado, e o que chega com data anterior é alteração;
    **P1-A**, o dono classifica uma vez o documento que o relatório não
    classifica sozinho, com a taxa e os valores da prova;
  - 3.ª: sem P0 nem P1; os P2 foram corrigidos (par balde/país coerente, data
    entre o pedido e hoje, limiar).

## Números (com data e como se contaram)

- Suite local a 12/10/2026, já com o #402: 1509 testes a passar e 1 de fora
  (`npx vitest run`). O fluxo `verificar` ficou verde no `759a0dde`.
- Testes do relatório: 10 sem base (`test/oss.test.ts`) e 6 pela API (bloco
  «relatório OSS» de `test/documentos-api.test.ts`).
- 13/10/2026 (#430, P3-6 e P3-8): 12 sem base e 7 pela API (contados pelos
  `it`). O CSV tem quatro colunas novas no fim (`classificado`,
  `data_decidida`, `classificado_por`, `classificado_em`). O identificador da
  pessoa fica no CSV (Diogo, 13/10/2026); não verificado com jurista.

## O que ficou por verificar

- **C (contabilista):** a taxa da fatura emitida numa linha classificada à mão;
  o período pela data do documento; GR ou EL; o limiar com vendas tributadas
  na origem (art. 59.º-C não lido no `eur-lex`).
- **Por fazer:** o P3-7 da 3.ª revisão (prova sem linhas e sem data bloqueia
  o fecho; precisa de decisão de negócio); o ecrã no Hub; os registos de
  serviços; outras moedas.
- **Lição:** a cada junção do `main`, confirmar os números livres das
  migrações e das letras do `docs/06` (houve três colisões no mesmo dia).
