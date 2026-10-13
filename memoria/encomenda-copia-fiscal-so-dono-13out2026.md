# A cópia fiscal da encomenda só para o dono — 13/10/2026

## O que se fez

Decisão do Diogo, 13/10/2026 (*«A»*; `docs/06` EN; `docs/23` §15.13), a
seguir à EM (`perfis-guardados-so-dono-13out2026.md`): depois de um pedido de
apagamento, `perfil_copia` (nome, NIF e morada fiscal da encomenda) só sai a
quem tem `customers:billing`.

- `lerEncomenda` (`checkout/repositorio.ts`) lê `fichaPseudonimizada` e
  `paraEncomenda` (`checkout/rotas.ts`) põe `perfil_copia: null` sem
  `customers:billing`, em `GET /orders/{id}` e na confirmação pública pelo
  token; campo novo `guardado_por_obrigacao_fiscal`.
- A fatura, o PDF e o relatório OSS ficam como estão (a decisão).
- Teste em `checkout-api.test.ts`: falha sem a regra (verificado).

## Números (com data e como se contaram)

- Rotas que devolvem `perfil_copia`: **2** (13/10/2026), por `grep -rn
  perfil_copia apps/api/src` (só `paraEncomenda`, usada nas duas).

## O que ficou por verificar

- O contacto e a entrega de uma encomenda em curso continuam visíveis a quem
  lê encomendas até ela acabar (é o desenho da §15.10).
