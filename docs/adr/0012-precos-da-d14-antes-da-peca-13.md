# ADR-0012 · Os preços da D-14 são precisos antes da peça 13, não antes do código

- **Estado:** aceite
- **Data:** 03/10/2026
- **Quem decidiu:** Diogo
- **Decisão em aberto de origem:** D-14 (`docs/06-decisoes-em-aberto.md`);
  muda o critério de passagem da Fase 0 (`docs/05-fases-e-mvp.md`) e o que o
  [ADR-0006](0006-vender-desde-o-inicio.md) dizia: *«o modelo de receita (D-14)
  passa a ser preciso antes da Fase 1»*

## Contexto

O critério de passagem da Fase 0 dizia: *«D-13 e D-14 decididas e registadas
em ADR; o OK escrito do Bruno ou do Diogo para começar código»*. A 03/10/2026:

- a D-13 está decidida (ADR-0008);
- da D-14 está decidida só a base (ADR-0007: mensalidade por escalões de
  vendas anuais, sem taxa sobre cada venda). Os preços esperam pelas conversas
  com 3 a 5 comerciantes, que ainda não aconteceram (`docs/05`, Fase 0).

Os preços só entram na **peça 13** da Fase 1: a abertura a comerciantes, com
o registo, o contrato aceite e a faturação do Eurolify por escalões (6 a 10
pessoas-semana, `docs/10` §2, **C**). Antes dela vêm as peças 2 a 12:
fundações, catálogo, IVA, checkout, pagamentos e as restantes.

Pergunta feita ao Diogo a 03/10/2026: *«Aceitas que os preços da D-14 passem a
ser exigidos só antes da peça 13, e não antes da primeira linha de código?»*
Resposta: *«sim, aceito»*.

## Opções consideradas

| Opção | A favor | Contra |
|---|---|---|
| a) Preços decididos antes da primeira linha de código | Nada se constrói sem saber quanto se cobra | As conversas com comerciantes passam a travar todo o código, incluindo a fundação, que não depende dos preços |
| **b) Preços decididos antes da peça 13** | O código começa com a base da receita, que chega para desenhar os planos e os escalões | Se a peça 13 chegar sem preços, a abertura a comerciantes pára |

## Decisão

1. **O critério de passagem da Fase 0 passa a ser:** a D-13 decidida
   (ADR-0008), a base da D-14 decidida (ADR-0007) e o OK escrito do Bruno ou do
   Diogo para começar código (ADR-0001).
2. **Os preços da D-14** (e as outras fontes de receita por decidir) têm de
   estar decididos e registados em ADR **antes de começar a peça 13**.

## Consequências

- Para começar o código falta **só o OK escrito** (um ADR novo que substitua o
  ADR-0001).
- As conversas com 3 a 5 comerciantes deixam de travar o código, mas continuam
  a ser precisas: dão os preços e o âmbito da primeira versão (`docs/05`).
- O tempo da Fase 0 no `docs/10` §9 (1 a 3 meses a tempo inteiro) contava com
  os preços. **Não foi recalculado.**
- **O que pode partir:** chegar à peça 13 sem preços pára a abertura a
  comerciantes. E se os valores dos escalões ficarem escritos no código antes
  de haver preços, mudá-los obriga a publicar código. Proposta minha, por
  decidir: guardá-los como dados configuráveis.
- Não é o OK para código (ADR-0001).

## O que ficou por verificar

- Quanto encurta a Fase 0 sem esperar pelos preços: não medido.
