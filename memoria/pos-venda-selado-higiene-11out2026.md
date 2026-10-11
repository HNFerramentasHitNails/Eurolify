# Pós-venda: a marca «selado por higiene» (R4; #328, #363), 11/10/2026

## O que se fez

- **Pedido do Diogo, 11/10/2026:** *«avança com o selado por higiene»*.
  Desenho em `docs/30` §15; **aprovado** (*«aprovado»*, Q10; `docs/06`, DT).
- **Fonte:** Directiva 2011/83/UE, art. 16.º, e) e art. 6.º, n.º 1, k), texto
  original lido no Serviço das Publicações da UE (**W**); a versão
  consolidada não verifiquei. Que artigos cabem é **C** (J2).
- **Código (#363, migração 0065):**
  - a marca no **artigo**, só num físico, posta pelo `PATCH` (API e Hub);
  - **copiada para a linha da encomenda** no botão final; a base confere que
    é a marca do artigo nesse instante (`checkout.total_changed`);
  - mostrada por linha no resumo, na encomenda, na confirmação e no botão de
    livre resolução; entra na impressão do resumo só quando existe;
  - numa linha marcada que volta **aberta** de uma livre resolução, uma
    pessoa decide **reembolsar** ou **aplicar a excepção**; sem a decisão a
    devolução não se decide nem se fecha; a excepção não entra num reembolso.
- **A API da Loja não tem leitura de artigos** (procurado nas rotas
  `/store/…`, 11/10/2026): a marca chega ao cliente pelo resumo, pela
  confirmação e pelo botão de livre resolução.
- **A migração é a 0065:** a 0064 é a do #364 (rasto), que entrou primeiro.
- **Revisão do agente** (`eurolify-critical-review`, Claude Sonnet 5.5): 0
  P0, 1 P1, 6 P2, 11 P3; tratados ou declarados no `docs/30` §15.4.
- **Juntado** a 11/10/2026 (`327faaa`). **Publicado no ensaio:** corrida 38172144192 (`migrar: aplicadas 0065_pos_venda_selado_por_higiene`; API, MCP e Hub a responder).

## Números (com data e como se contaram)

- 11/10/2026, neste contentor (PostgreSQL 18.6 da lista
  `infra/ci/imagens-base.txt`, Node 24.21), com o `main` do #364: `pnpm lint`
  e `pnpm tipos` limpos; **API 1369 de 1369**.
- 3 testes novos em `test/posvenda-api.test.ts`.
- Mutações: 25, 24 apanhadas; uma equivalente (a verificação «reembolsar
  fora do reembolso» no código, que a base faz com o mesmo erro).

## O que ficou por verificar

- **O texto legal ao cliente por país** (**C**, J5, com a parte 2 do
  checkout): até lá o sistema não confere que o texto de livre resolução
  aceite fala do selo.
- **Quem decide:** a devolução não tem rasto; uma chave (que pode ser de uma
  IA) pode aplicar a excepção sem o aviso «sem autorização de uma pessoa».
- **Por fazer:** a marca na criação, na exportação e na importação do
  catálogo; o ecrã do Hub; kits (vale a marca do kit, não a dos componentes).
- **Concorrência:** analisada pelo agente, não corrida com dois pedidos.
- **Não li a base do ensaio** depois de publicar.
