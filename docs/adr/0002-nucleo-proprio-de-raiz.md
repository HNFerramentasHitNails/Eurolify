# ADR-0002 · O Eurolify é construído de raiz, sem partir de um motor aberto

- **Estado:** aceite
- **Data:** 03/10/2026
- **Quem decidiu:** Diogo
- **Decisão em aberto de origem:** D-2 (`docs/06-decisoes-em-aberto.md`)

## Contexto

A D-2 punha quatro opções: núcleo próprio (TypeScript + PostgreSQL), Medusa,
Saleor ou Vendure. A recomendação era o núcleo próprio, mas só depois de uma
prova de 2 semanas com a Medusa, para ver se ela aguentava os perfis fiscais e
o isolamento entre comerciantes com pouco esforço.

Palavras do Diogo, a 03/10/2026: *«O Lumavo vai ser criado desde a raiz.»*

## Opções consideradas

As da D-2, com as fontes lá escritas (resumos de pesquisa; o código dos
motores não foi lido).

## Decisão

O núcleo do Eurolify é próprio, escrito de raiz. **A prova de 2 semanas com a
Medusa deixa de se fazer.**

## Consequências

- Tudo o que é comum (carrinho, promoções, stock, pesquisa) é trabalho nosso:
  pesa na estimativa (D-13).
- O modelo de perfis fiscais, o motor de IVA e o isolamento entre comerciantes
  nascem desenhados para o Eurolify, sem adaptar um motor alheio.
- **Não é o OK para código.** O ADR-0001 continua em vigor: esta decisão diz
  *como* se vai construir, não *quando* se começa.

## O que ficou por verificar

- Sem a prova da Medusa, fica por medir quanto tempo se poupava no que é comum.
  Era essa a pergunta que a prova respondia.
