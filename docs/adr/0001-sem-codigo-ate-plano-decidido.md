# ADR-0001 · Nenhum código até haver um plano decidido

- **Estado:** aceite
- **Data:** 03/10/2026
- **Quem decidiu:** Diogo
- **Decisão em aberto de origem:** — (decisão de processo)

## Contexto

O Lumavo é um projecto grande e com regras fiscais e legais em vários países.
Nos sistemas actuais, construir antes de mapear deu remendos que reapareciam
noutro sítio (ver `docs/04-licoes-dos-sistemas-actuais.md`).

Palavras do Diogo, a 03/10/2026: *«Não escrevas qualquer codigo até termos um
plano decidido.»* e *«Só avançamos para o código quando eu ou o bruno
decidirmos avançar.»*

## Decisão

1. Até haver OK **escrito** do Bruno ou do Diogo, este repositório tem só
   documentos: proposta, desenho, decisões, skills e memória.
2. Contam como código, e por isso esperam pelo OK: provas de conceito (incluindo
   a prova da Medusa em D-2), ficheiros de contrato da API (OpenAPI), esquemas
   de base de dados, configuração de alojamento e de integração contínua.
3. Não conta como código: tabelas de domínio, listas de operações e diagramas
   escritos nos documentos.

## Consequências

- Uma sessão de Claude neste repositório que receba um pedido de código
  **confirma primeiro** se este ADR já foi substituído.
- O OK para código regista-se num ADR novo que substitui este, com quem o deu
  e quando.

## O que ficou por verificar

Nada — é uma decisão de processo.
