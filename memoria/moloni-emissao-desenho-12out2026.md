# Moloni: a emissão lida na documentação e desenhada (#310, parte 2), 12/10/2026

## O que se fez

- **Pedido do Diogo, 12/10/2026:** *«sim, avança com o adaptador Moloni»*.
- Lidas em bruto 33 páginas de `moloni.pt/dev` (faturas, documentos, PDF,
  notas de crédito, clientes, artigos, taxas, isenções, séries, autenticação,
  erros): `docs/eurolify/fontes-api-moloni-11out2026.md` §9.
- Desenho da parte 2 em `docs/29` §13: o mapa contrato → Moloni, os tokens,
  as perguntas M1 a M8 e o que medir na conta trial. **Nenhum código.**

## Números (com data e como se contaram)

- 33 páginas descarregadas a 12/10/2026 (`curl` de cada endereço, texto
  extraído do HTML); 0 pedidos à API.

## O que ficou por verificar

- As credenciais `MOLONI_*` **não estavam** no ambiente desta sessão
  (verificado a 12/10/2026, as quatro em falta): nada medido na conta trial.
- O ATCUD e o `document_product_id` não aparecem nas páginas do `getOne`;
  casas decimais do `price`; tamanho do `our_reference` (`docs/29` §13.7).
