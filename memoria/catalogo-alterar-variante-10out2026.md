# Alterar uma variante, pela API e pelo Hub (#301, #302, #306, #317) — 10/10/2026

## O que se fez

- Desenho no `docs/14` §7.1 («Alterar uma variante») e no `docs/22` §23
  (#302, squash `bcc86ce`), aprovado pelo Diogo a 10/10/2026: *«sim, aprovo o
  desenho, junta o #302»*, com a unidade de venda e o conteúdo só no
  rascunho.
- API (#306, squash `49dca9d`), no ensaio a 10/10/2026 às 13:50 UTC (a rota
  nova passou de 404 a 403 sem sessão no hub.eurolify.eu):
  - `PATCH /variants/{id}` (chave, `catalog:write`, `Idempotency-Key`) e
    `PATCH /hub/variants/{id}` (dono e gestor); `catalog.external_field`
    pelo Hub num artigo do sistema de gestão.
  - Migração `0048_catalogo_versao_da_variante` (era 0047; o #296 usou o
    número com o stock): `variante.versao`, decidida pelo gatilho (sobe uma
    vez por mudança, só com mudança); fora do rascunho, a unidade e o
    conteúdo dão `catalog.not_draft`, também na importação e no SQL à mão.
  - O GTIN e a origem mudam juntos (400 se vier um sem o outro).
  - A função da importação passou a `gravarCamposDaVariante`.
  - Revisão do agente (Opus 5.5) publicada no #306: 0 P0, 1 P1 (número da
    migração), 1 P2 (sem `noCatalogo`, sem prazo de espera), 4 P3; todos
    corrigidos, com prova pela falha.
- Hub (#317, squash `8f615ca`): a página `/artigos/{prd_…}/variantes/{var_…}`
  («Editar a variante») e «Editar» em cada variante activa da ficha. No
  ensaio desde as 17:39 UTC de 10/10/2026: o hub.eurolify.eu serve
  `index-gC3PNOV4.js`, igual ao build local do `8f615ca`.
  - A lógica do formulário em `apps/hub/src/variante.ts`: só os campos que
    mudam; depois de um conflito, o formulário parte do guardado e só fica o
    que a pessoa mexeu (`camposSobreOGuardado`).
  - Revisão do agente (Opus 5.5) publicada no #317: 0 P0, 1 P1 (guardar
    depois de um conflito apagava o que a outra pessoa mudara noutros
    campos), 3 P2, 5 P3; corrigidos, menos o P3-5, que não se confirmou (RLS
    forçado na `variante`, 0002).
  - Capturas na página de aprovação (versão 12), no ecrã «Editar uma
    variante»; aspecto aprovado pelo Diogo a 10/10/2026 («sim», à pergunta sobre os três ecrãs da página de aprovação, versão 12).
- **Mudança de comportamento:** uma linha de importação que muda a unidade ou
  o conteúdo de uma variante de um artigo activo ou arquivado passa a ser
  recusada com `catalog.not_draft` (antes entrava).

## Números (com data e como se contaram)

- 10/10/2026, API: `catalogo-variante-alterar.test.ts` 16/16 e 2 novos em
  `importacao.test.ts`; bateria inteira 1169/1169 em 68 ficheiros (vitest,
  PostgreSQL 18 local), depois da junção com o #296, o #298 e o #308.
- Provas pela falha (cada protecção tirada à vez): regra do rascunho na
  migração (3 testes falham), conferência da versão (3), recusa do externo no
  Hub (1), filtro do comerciante (1), versão decidida pelo gatilho (1),
  `noCatalogo` (1, fica à espera até ao limite), arquivada antes da versão (1).

- 10/10/2026, Hub: 137 testes (vitest); passagem (`capturas.mjs`) 500 «ok»,
  0 falhas (`grep -c '^ok'` no registo; eram 469). Na passagem, o «Gel
  Coral 41» com «peso em falta» publica-se depois de o peso ser gravado
  pelo ecrã. Prova pela falha do P1-1 no teste unitário.

## O que ficou por verificar

- No ensaio só se confirmou que a rota existe (403 sem sessão) e que o Hub
  serve o build novo; não se alterou uma variante real lá.
- Leitores de ecrã reais e o `beforeunload` real do navegador.
- Se alguém usa a importação para mudar unidades de artigos activos: não
  verifiquei (não há clientes reais no ensaio).
