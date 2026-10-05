# Catálogo (fatia 3), parte 3a: categorias e colecções — 05/10/2026

## O que se fez

- O Diogo pediu a parte 3 (*«sim, começa a parte 3 do Catálogo»*, 05/10/2026). Dividi-a em dois pedidos: 3a, categorias e colecções (este); 3b, traduções (falta saber qual é a língua de origem do catálogo, ver abaixo).
- Migração `0006_catalogo_categorias_colecoes.sql`: tabelas `categoria`, `artigo_categoria`, `colecao` e `colecao_artigo`, com RLS forçado, chaves compostas por comerciante e GRANT por coluna (a API não escolhe ids, estados ao criar, versões nem datas; não apaga categorias nem colecções).
- Regras (proposta, `docs/14` §3.6 e §3.7): árvore sem ciclos; activa não fica dentro de arquivada; com subcategorias activas não se arquiva; artigo só entra em categoria activa (uma arquivada que já tinha fica); categorias e colecções arquivam-se, não se apagam; endereço amigável obrigatório, minúsculas sem acentos, único por comerciante (categorias e colecções à parte, também entre arquivadas). Uma fila por comerciante para as escritas nas categorias (`pg_advisory_xact_lock`, chave `eurolify.categoria:<comerciante>`).
- `src/catalogo/categorias.ts` (ficheiro novo; `noCatalogo` e `artigoNaVersao` passam a exportados do `repositorio.ts`): criar, ler, alterar, mover e arquivar/repor categorias; substituir as categorias de um artigo (sobe a versão do artigo); criar, alterar, arquivar colecções e substituir a lista ordenada (sobe a versão da colecção). Códigos novos: `catalog.category_cycle`, `category_archived`, `category_has_children`, `category_duplicate`, `slug_invalid`, `slug_duplicate`, `collection_product_duplicate`.
- A substituição da lista de uma colecção prende primeiro os artigos que entram (`FOR KEY SHARE`, por ordem de id), antes de apagar as linhas antigas: sem isso, apagar o rascunho de um artigo a meio da substituição fazia as duas transacções esperarem uma pela outra (provado por um teste com uma pausa só de teste).

## Números (com data e como se contaram)

- 05/10/2026, PostgreSQL 18.6 em Docker, `EXIGIR_BASE=1`: 16 testes em `catalogo-categorias.test.ts`; api 233 passados, mcp 52; `pnpm tipos`, `pnpm lint` e `pnpm construir` sem erros.
- Mutações (uma de cada vez): sem a fila das categorias (2 falhas), sem a procura do ciclo (2), sem «filhas activas» (1), sem «pai arquivado» (2), artigo em categoria arquivada (1), sem `FOR KEY SHARE` na colecção (1, o teste da pausa), sem RLS na categoria (1). A primeira versão do teste dos movimentos cruzados (duas categorias) passava sem a fila: o `FOR UPDATE` do repositório já choca com o bloqueio da chave estrangeira do outro movimento. Troquei-o por um ciclo de quatro, que só a fila apanha.

## O que ficou por verificar

- A revisão do agente (ADR-0035) — por fazer quando escrevi isto.
- A 0006 na VPS (chega com a publicação ao juntar o pedido).
- Endereços amigáveis em línguas com outro alfabeto: na língua de origem ficam transliterados (limitação escrita no `docs/14` §3.6); os endereços por língua são da parte 3b.
- Para a 3b: a língua de origem do catálogo ficou decidida (P13, `docs/06` AW; Diogo, 05/10/2026: *«sim, uma só língua de origem por comerciante»*): passa da loja para o comerciante com a 3b.
