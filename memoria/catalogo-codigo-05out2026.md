# Catálogo (fatia 3): código — 05/10/2026

## O que se fez

- O Diogo aceitou as propostas do `docs/14` §9 (*«sim, aceito as propostas do §9»*, #76, `docs/06` AR) e pediu o código (*«sim, começa o código do Catálogo»*). Issue #77, com as partes previstas.
- **Parte 1 — artigos e variantes na base** (migração `0002_catalogo_artigos.sql`):
  - `artigo`: tipo, estado (rascunho → activo → arquivado → activo), nome, descrição, marca, código da categoria fiscal, origem (Eurolify ou externo com referência), `ja_esteve_activo`, versão;
  - `variante`: SKU obrigatório e único por comerciante, também contra as arquivadas (C3, P7); GTIN com dígito de controlo e origem, único (C4); unidade de venda obrigatória; conteúdo para o preço por unidade; peso e medidas; ONU e classe ADR; arquivada é final; o artigo e o SKU não mudam;
  - digital e cartão-oferta recusados (`catalog.type_disabled`; P3, ADR-0034);
  - activar exige uma variante activa (`FOR SHARE` contra quem arquiva ao mesmo tempo); um artigo arquivado não recebe variantes; só se apaga um rascunho que nunca esteve activo (e as variantes com ele);
  - RLS forçado como na 0001; `eurolify_api` com SELECT, INSERT, UPDATE e DELETE (os triggers só deixam apagar rascunhos).
- `apps/api/src/catalogo/repositorio.ts`: criar, ler, alterar com a versão lida (`catalog.version_conflict`), mudar o estado, apagar o rascunho, criar e arquivar variantes, procurar por SKU; erros com código (`catalog.*`).
- Os ficheiros de testes passam a correr um de cada vez (`apps/api/vitest.config.ts`): os da base mexem no papel `eurolify_api`, que é da instância.
- **Proposta desta parte:** as listas de unidades de venda (`unidade`, `par`, `caixa`, `embalagem`, `conjunto`) e de unidades do conteúdo (`mg`, `g`, `kg`, `ml`, `cl`, `l`, `mm`, `cm`, `m`, `m2`, `m3`).

## Números (com data e como se contaram)

- 05/10/2026, PostgreSQL 18.6 em Docker, `EXIGIR_BASE=1`, Node 22.22: api com 133 passados (18 novos em `catalogo.test.ts`, `grep -c "  it("`), mcp com 30; 5 corridas seguidas sem erros; `pnpm tipos`, `pnpm lint` e `pnpm construir` sem erros.
- Mutações (uma de cada vez, na migração): sem o dígito de controlo, com os tipos desligados ligados, sem o SKU único, com a variante arquivada a mudar, a activar sem variantes — cada uma faz falhar 1 teste. Sem a guarda do artigo ao apagar, os testes passam: a guarda das variantes dá o mesmo erro (segunda barreira).
- Os GTIN dos testes têm o dígito de controlo calculado à mão (pesos 3 e 1 da direita); não verifiquei em que secção das especificações GS1 está o algoritmo.

## O que ficou por verificar

- A migração 0002 na VPS: corre na publicação seguinte a juntar, como o `eurolify_migrador`.
- As partes 2 a 5 (#77): opções, kits, traduções, categorias, colecções, publicação, media, importação, eventos e linha do tempo.
- A API HTTP do Catálogo (com a fatia «identidade»).
