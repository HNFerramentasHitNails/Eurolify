# Perfis guardados por obrigação fiscal só para o dono — 13/10/2026

## O que se fez

Decisão do Diogo, 13/10/2026 (*«A»*; `docs/06` EL; `docs/23` §15.12), ao
P3-6 que ficou na §15.10: depois de um pedido de apagamento, só quem tem
`customers:billing` (o dono) lê o nome, o NIF e a morada dos perfis que
ficam por obrigação fiscal.

- Regra num sítio: `fichaPseudonimizada()` em `clientes/repositorio.ts`
  (a ficha ou aquela em que foi fundida, subindo por `fundido_em`, está
  `pseudonimizado`). Sem coluna nova nem migração.
- Seis rotas (G1 a G6): o perfil e a lista (campo novo
  `guardado_por_obrigacao_fiscal`), as provas do VIES, as isenções (nota e
  motivos), os nomes dos anexos, a procura por NIF e a simulação do IVA (403).
- Fonte: RGPD, art. 25.º, n.º 2, e art. 17.º, n.º 3, b) (`eur-lex`,
  02016R0679-20160504, obtido_em 2026-10-12). A necessidade é leitura nossa:
  **C** (jurista).

## Números (com data e como se contaram)

- Sítios por onde o gestor e o apoio liam estes dados: **6** rotas
  (13/10/2026), procurados por um agente só de leitura nas rotas de
  `clientes/`, `iva/`, `checkout/`, `faturacao/` e `identidade/hub-*`, e
  conferidos à mão nas seis.

## O que ficou por verificar

- As cópias na encomenda (`perfil_copia`), o documento fiscal e o relatório
  OSS continuam legíveis por `orders:read`, `invoices:read` e `tax:read`: são
  outra decisão, em aberto.
- O tempo da subida por `fundido_em` com muitas fusões (sem `EXPLAIN`).
- A idempotência guarda respostas de 24 h. Só as escritas de perfil
  (`customers:billing`, só o dono) devolvem um perfil; por leitura, uma
  resposta guardada não chega a quem não tem esse âmbito (não testado).
