# ADR-0006 · O Eurolify vende-se a outros comerciantes desde o início

- **Estado:** aceite
- **Data:** 03/10/2026
- **Quem decidiu:** Diogo
- **Decisão em aberto de origem:** D-1 (`docs/06-decisoes-em-aberto.md`)

## Contexto

A D-1 perguntava quando o Eurolify abre a outros comerciantes. A decisão F
(Diogo, 03/10/2026) já tinha dito que é um produto para vender a todos os tipos
de comerciantes da UE, o que excluiu a opção c) (uso interno). Ficava a escolha
entre a) vender desde o início e b) provar com um cliente zero e abrir na
Fase 3. A recomendação escrita era a b).

Resposta do Diogo a 03/10/2026, na página da D-1 da apresentação: *«a) Vender a
outros desde o início»*.

## Opções consideradas

| Opção | A favor | Contra |
|---|---|---|
| **a) Vender desde o início** | Receita e comerciantes reais mais cedo; o produto é desenhado para vender desde o primeiro dia | Faturas de outras empresas em risco antes de o Eurolify estar provado; mais trabalho na 1.ª versão (registo de comerciantes, contratos, faturação do Eurolify, suporte) |
| b) Cliente zero e abrir na Fase 3 | Prova com uma loja real antes de pôr faturas de terceiros em risco | Mais tempo até vender |

## Decisão

O Eurolify vende-se a outros comerciantes **desde a primeira versão** (Fase 1).
A recomendação b) não foi seguida.

## Consequências

- **Entram na Fase 1** (antes estavam na Fase 3): registo e configuração pelo
  próprio comerciante, contrato de serviço e acordo de tratamento de dados,
  faturação do Eurolify aos comerciantes, suporte e níveis de serviço,
  exportação completa dos dados.
- **A emissão de faturas por adaptador em Portugal (Moloni) passa à Fase 1**:
  um comerciante sem sistema de gestão precisa de faturar desde o primeiro dia.
  Os outros países continuam país a país (D-4).
- **O modelo de receita (D-14) passa a ser preciso antes da Fase 1.**
- **O risco fiscal fica maior.** Antes do primeiro comerciante de fora têm de
  estar feitos: o motor de IVA validado pelo contabilista, os fluxos do
  consumidor validados por jurista, o contrato com limites de responsabilidade e
  um seguro (a ver com o jurista — **C**), e a retenção em vez de emissão
  errada (`docs/04` regra 1.10).
- As lojas do próprio grupo continuam a entrar com cuidado: uma loja pequena
  primeiro, nunca a loja principal primeiro.
- **Não é o OK para código** (ADR-0001).

## O que ficou por verificar

- O seguro de responsabilidade civil profissional para uma plataforma destas:
  existência, cobertura e custo — não estudado.
- O que o contrato de serviço pode limitar perante comerciantes e perante os
  consumidores deles — por ver com jurista.
