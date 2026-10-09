# Preços, parte 2: API, redução anunciada e preço por unidade — 09/10/2026

## O que se fez

- **Desenho** em `docs/20` §10 e **código** no #224 (decisão `docs/06` CW), com a migração 0036. Issue #127 fechado.
- **Rotas de Administração:** mercados, canais, listas, preços, histórico e reduções, com os âmbitos novos `prices:read` e `prices:write` (dono e gestor os dois; armazém e apoio só a leitura).
- **Redução:**
  - o preço de referência é o mais baixo praticado nas 720 h antes, contando o histórico e as reduções anteriores;
  - recusa-se sem 30 dias seguidos de preço, quando não fica abaixo da referência, ou com outra em vigor;
  - o preço não muda nem sai por baixo de uma redução;
  - eventos `promotion.started` e `promotion.ended`.
- **Preço por unidade** com quatro casas (o arredondamento para mostrar é C).
- **Quem fez:** arquivar um mercado pela API passa a deixar a chave como quem fez (fecha a P1-2 da revisão do #208).
- **O teste das rotas encontrou dois problemas** da parte 1, corrigidos:
  - criar uma lista no mercado de outro comerciante dizia que o mercado existia;
  - pôr um preço numa lista de outro dava 500.
- **Publicado no ensaio:** o registo diz «migrar: aplicadas 0036_precos_reducao_e_ambitos».

## Números (com data e como se contaram)

- **Testes da API, 09/10/2026:** 949 de 949, contados pelo vitest no meu ambiente, depois de juntar o `main`. O teste de Preços tem 13 casos.
- **Mutações:** 8, todas apanhadas.

## O que ficou por verificar

- As regras C do art. 6.º-A, que esperam pelo jurista (`docs/12`, B, ponto 7):
  - as excepções e as reduções progressivas;
  - «30 dias» como 720 h;
  - o preço praticado mesmo sem estar à venda.
- A API da Loja e o MCP esperam pelo Motor de IVA.
- O histórico ainda não vem por páginas.
