# API do Moloni: as 8 perguntas testadas, só a ler (#355), 11/10/2026

## O que se fez

- **Pedido do Diogo, 11/10/2026:** *«testa a API do Moloni, as 8 perguntas do
  docs/eurolify/fontes-api-moloni-11out2026.md §7»*.
- Fluxo `password` com as variáveis `MOLONI_*` do ambiente; cliente de teste
  fora do repositório; o token nunca foi impresso. Primeiro **só leituras**,
  como mandam as regras dos testes (#358, por juntar à hora do teste).
- **Escrita na conta trial, com o OK do Diogo** (*«sim, avança com o teste na
  conta trial»*, 11/10/2026): artigo `TESTE-API-001` (product_id 242913638),
  `productStocks/insert` +5 e −2 → stock 3. Nenhum documento. **O artigo e os
  dois movimentos ficaram na conta trial**.
- **Artigo apagado** a pedido do Diogo (*«sim, apaga o artigo de teste»*,
  11/10/2026), depois de uma cópia do artigo e dos dois movimentos (fora do
  repositório). `products/delete` aceitou (`valid: 1`) apesar dos movimentos;
  **os dois movimentos continuam listados em `productStocks/getAll`, sem
  artigo** (`product` vazio).
- Conta trial depois: 2 artigos de exemplo, 2 movimentos órfãos, 0
  documentos.
- **Apagar os dois movimentos falhou** (pedido do Diogo, *«sim, apaga os dois
  movimentos»*, 11/10/2026; cópia guardada antes, fora do repositório).
  `productStocks/delete` pede `product_stock_id` (página `.../product-stocks/delete/`,
  lida a 11/10/2026); os movimentos vêm com `product_stock_id` 0 e só têm
  `stock_movement_id`. Com o `stock_movement_id` no lugar do outro, a
  resposta foi `valid: 0` e nada mudou. **Não tentei com 0** (podia apanhar
  outra coisa). Os dois movimentos continuam na conta trial.
- As credenciais abrem **duas empresas**: a conta trial do Diogo
  (`company_id` 401965, vazia) e a «Empresa Demonstração» do Moloni
  (`company_id` 5, partilhada por todos os programadores). Mediu-se na 5.
- Resultado e consequências: `docs/eurolify/fontes-api-moloni-11out2026.md`
  §8. Corrigidas no sítio duas linhas da leitura da documentação que o teste
  desmentiu (as linhas do documento **trazem** `warehouse_id`; o `stock` vem
  com decimais; o `documents/getAll` **filtra** por `status`).

## Números (com data e como se contaram)

- 1108 documentos na empresa 5 (`documents/count`, 11/10/2026 ~19h); 50 com
  `terminal_id`; `status` 0 = 40, 1 = 949, 2 = 119 (contagem dos 1108 lidos).
- Conta trial: 0 documentos, 0 terminais, 1 série, 1 armazém (mesma hora).
- Stock de topo = soma dos armazéns em 12 000 artigos lidos, 0 diferenças.
- Conta trial antes da escrita: 2 artigos de exemplo, 0 movimentos, 0
  documentos; depois do teste: 3 artigos, 2 movimentos, 0 documentos.
- 300 pedidos a `documents/count` sem nenhum recusado; pico ~1400/minuto
  durante 8,6 s (10 em paralelo); 0,41 s por pedido em série.

## O que ficou por verificar

- O que é o `status` 2 (119 documentos, 71 deles faturas). A documentação não
  o diz; o Diogo pediu, a 11/10/2026, que se pergunte ao Moloni — a sessão não
  tem e-mail; o texto foi preparado e **o Diogo enviou-o a `apoio@moloni.pt`
  a 11/10/2026**. Sem resposta ainda.
- Se os terminais da demonstração são a app «Moloni POS» de iPhone.
- Limites por hora ou por dia; o filtro por dia dos movimentos (`date` não
  limitou).
- ~~Se os documentos da demonstração e da conta trial seguem para a AT~~ — o
  Diogo disse, a 11/10/2026, que os das contas de teste não vão (dito por ele;
  a resposta do Moloni não foi vista na sessão).
- **DV (ADR-0044), 11/10/2026:** o balcão vende pelo POS do Hub e o Moloni só
  emite as faturas; ler vendas e stock do Moloni deixou de ser o plano.
