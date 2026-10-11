# API do Moloni: as 8 perguntas testadas, só a ler (#355), 11/10/2026

## O que se fez

- **Pedido do Diogo, 11/10/2026:** *«testa a API do Moloni, as 8 perguntas do
  docs/eurolify/fontes-api-moloni-11out2026.md §7»*.
- Fluxo `password` com as variáveis `MOLONI_*` do ambiente; cliente de teste
  fora do repositório; o token nunca foi impresso. **Só leituras** — nenhuma
  escrita, como mandam as regras dos testes (#358, por juntar à hora do teste).
- As credenciais abrem **duas empresas**: a conta trial do Diogo
  (`company_id` 401965, vazia) e a «Empresa Demonstração» do Moloni
  (`company_id` 5, partilhada por todos os programadores). Mediu-se na 5.
- Resultado e consequências: `docs/eurolify/fontes-api-moloni-11out2026.md`
  §8. Corrigidas no sítio duas linhas da leitura da documentação que o teste
  desmentiu (as linhas do documento **trazem** `warehouse_id`; o `stock` vem
  com decimais).

## Números (com data e como se contaram)

- 1108 documentos na empresa 5 (`documents/count`, 11/10/2026 ~19h); 50 com
  `terminal_id`; `status` 0 = 40, 1 = 949, 2 = 119 (contagem dos 1108 lidos).
- Conta trial: 0 documentos, 0 terminais, 1 série, 1 armazém (mesma hora).
- Stock de topo = soma dos armazéns em 12 000 artigos lidos, 0 diferenças.
- 300 pedidos a `documents/count` sem nenhum recusado; pico ~1400/minuto
  durante 8,6 s (10 em paralelo); 0,41 s por pedido em série.

## O que ficou por verificar

- O que é o `status` 2 (119 documentos, 71 deles faturas).
- Um `productStocks/insert` nosso com `qty` negativo (precisa de OK).
- Se os terminais da demonstração são a app «Moloni POS» de iPhone.
- Limites por hora ou por dia; o filtro por dia dos movimentos (`date` não
  limitou).
- Se os documentos da demonstração e da conta trial seguem para a AT.
