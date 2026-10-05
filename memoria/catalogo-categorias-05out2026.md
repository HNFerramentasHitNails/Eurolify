# Catálogo (fatia 3), parte 3a: categorias e colecções — 05/10/2026

## O que se fez

- O Diogo pediu a parte 3 (*«sim, começa a parte 3 do Catálogo»*, 05/10/2026). Dividi-a em dois pedidos: 3a, categorias e colecções (este); 3b, traduções (falta saber qual é a língua de origem do catálogo, ver abaixo).
- Migração `0007_catalogo_categorias_colecoes.sql` (era a 0006; passou a 0007 porque o #96 juntou antes a `0006_catalogo_classificacao.sql`): tabelas `categoria`, `artigo_categoria`, `colecao` e `colecao_artigo`, com RLS forçado, chaves compostas por comerciante e GRANT por coluna (a API não escolhe ids, estados ao criar, versões nem datas; não apaga categorias nem colecções).
- Regras (proposta, `docs/14` §3.6 e §3.7): árvore sem ciclos; activa não fica dentro de arquivada; com subcategorias activas não se arquiva; artigo só entra em categoria activa (uma arquivada que já tinha fica); categorias e colecções arquivam-se, não se apagam; endereço amigável obrigatório, minúsculas sem acentos, único por comerciante (categorias e colecções à parte, também entre arquivadas). Uma fila por comerciante para as escritas nas categorias (`pg_advisory_xact_lock`, chave `eurolify.categoria:<comerciante>`).
- `src/catalogo/categorias.ts` (ficheiro novo; `noCatalogo` e `artigoNaVersao` passam a exportados do `repositorio.ts`): criar, ler, alterar, mover e arquivar/repor categorias; substituir as categorias de um artigo (sobe a versão do artigo); criar, alterar, arquivar colecções e substituir a lista ordenada (sobe a versão da colecção). Códigos novos: `catalog.category_cycle`, `category_archived`, `category_has_children`, `category_duplicate`, `slug_invalid`, `slug_duplicate`, `collection_product_duplicate`.
- A substituição da lista de uma colecção prende primeiro os artigos que entram (`FOR KEY SHARE`, por ordem de id), antes de apagar as linhas antigas: sem isso, apagar o rascunho de um artigo a meio da substituição fazia as duas transacções esperarem uma pela outra (provado por um teste com uma pausa só de teste, que cobre esse caso; duas substituições não chocam entre si, porque as duas só pedem `KEY SHARE`).

## Números (com data e como se contaram)

- 05/10/2026, depois da revisão (com o `main` do #96): 22 testes em `catalogo-categorias.test.ts`; api 289 passados. Esforço (40 rondas, PostgreSQL 18.6 local): criar 2 filhas de B e alterar B ao mesmo tempo, 120 de 120 sem erro; mover A para B e alterar B, 80 de 80. Com a fila tirada das escritas (mutação): 73 de 120 e 15 de 80 com `catalog.retry`. Mutações novas: fila tirada de alterar, mover ou arquivar (1 falha cada), `FOR UPDATE` da colecção (1), versão a subir sem mudança (1 e 1). Sem teste: a fila em `criarCategoria` (o trigger toma-a antes da chave estrangeira; fica por coerência).

- 05/10/2026, PostgreSQL 18.6 em Docker, `EXIGIR_BASE=1`: 16 testes em `catalogo-categorias.test.ts`; api 233 passados, mcp 52; `pnpm tipos`, `pnpm lint` e `pnpm construir` sem erros.
- Mutações (uma de cada vez): sem a fila das categorias (2 falhas), sem a procura do ciclo (2), sem «filhas activas» (1), sem «pai arquivado» (2), artigo em categoria arquivada (2), sem `FOR KEY SHARE` na colecção (1, o teste da pausa), sem RLS na categoria (1). A primeira versão do teste dos movimentos cruzados (duas categorias) passava sem a fila: o `FOR UPDATE` do repositório já choca com o bloqueio da chave estrangeira do outro movimento. Troquei-o por um ciclo de quatro, que só a fila apanha.

- **Revisão do #97 (agente, Sonnet 5.5, 05/10/2026):** 1 P1, 2 P2 e P3; o Diogo pediu tudo (*«sim, corrige o P1, os P2 e os P3 e manda rever»*). P1-1: escrever numa categoria B ao mesmo tempo que se cria uma filha de B dava muitas vezes `catalog.retry` (revisor: 57 de 120 e 25 de 80) — o repositório prendia a linha de B e só depois esperava pela fila, e a filha, já na fila, pedia a linha de B pela chave estrangeira; agora o repositório entra na fila primeiro (`filaDasCategorias`). P2-1: teste da corrida de versão (na colecção, onde o `FOR UPDATE` é a protecção; na categoria a fila já ordena). P2-2: testes do endereço e do nome da colecção. P3: posições negativas, endereço em falta, `criado_em` da colecção, a versão só sobe quando algo muda, colecção arquivada aceita lista (escrito no `docs/14`), `orderBy("id")` tirado (duas substituições não chocam), contagens da memória.
- Entretanto o #96 juntou a `0006_catalogo_classificacao.sql`; a migração destas tabelas passou a 0007 (merge do `main` no ramo).

## O que ficou por verificar

- A 2.ª revisão do agente (ADR-0035) — por fazer quando escrevi isto.
- A 0007 na VPS (chega com a publicação ao juntar o pedido).
- Endereços amigáveis em línguas com outro alfabeto: na língua de origem ficam transliterados (limitação escrita no `docs/14` §3.6); os endereços por língua são da parte 3b.
- Para a 3b: a língua de origem do catálogo ficou decidida (P13, `docs/06` AW; Diogo, 05/10/2026: *«sim, uma só língua de origem por comerciante»*): passa da loja para o comerciante com a 3b.
