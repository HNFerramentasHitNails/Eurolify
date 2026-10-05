# Catálogo (fatia 3), parte 2a: kits — 05/10/2026

## O que se fez

- O Diogo pediu a parte 2 (*«sim, começa a parte 2 do Catálogo»*). Partiu-se em dois pedidos: **2a, kits** (este) e **2b, opções e valores**, que precisa de uma decisão (um artigo sem opções pode ter várias variantes? O `docs/14` §3.2 diz «um artigo sem opções tem uma variante», mas a parte 1 deixa várias).
- Migração `0004_catalogo_kits.sql`: tabela `componente` (kit, componente, quantidade, posição), chaves compostas ao `(comerciante_id, id)` da variante (restrição nova `variante_comerciante_id_unico`), RLS forçado; trigger: sem ciclos (consulta recursiva), componente novo activo, kit arquivado não muda, bloqueio por comerciante (`pg_advisory_xact_lock`) para dois pedidos ao mesmo tempo não fecharem um círculo; apagar uma variante que é componente é recusado pela chave estrangeira `componente_em_uso`.
- `repositorio.ts`: `definirComponentes` (substitui a lista; confirma e prende os componentes antes, para o 23503 de `componente_em_uso` só poder vir de um apagar) e `componentesDoKit`. Códigos novos: `catalog.component_archived`, `component_duplicate`, `component_in_use`; `component_cycle` já estava no desenho.
- `docs/14` §3.4: as regras desta parte, marcadas **proposta**.

## Números (com data e como se contaram)

- 05/10/2026, PostgreSQL 18.6 em Docker, `EXIGIR_BASE=1`: 9 testes em `catalogo-kits.test.ts`, todos passados; `pnpm tipos` e `pnpm lint` sem erros.
- Mutações (uma de cada vez, na 0004): sem a verificação dos ciclos falham 2 testes; componente arquivado aceite, 1; kit arquivado a mudar, 1; sem o bloqueio por comerciante, 1 — **mas só depois de mudar o teste**: a primeira versão (A em B e B em A ao mesmo tempo) passava sem o bloqueio, porque a linha do kit presa pelo repositório já os punha em fila. O teste passou a um círculo de 4 (A→B e C→D, com B→C e D→A gravados), em que as duas escritas não tocam nas mesmas linhas.

## O que ficou por verificar

- A 0004 na VPS (corre na publicação depois de juntar). A restrição nova em `variante` precisa de que não haja `(comerciante_id, id)` repetidos, o que o `id` único já garante.
- Ciclos com mais de duas escritas ao mesmo tempo (o bloqueio por comerciante põe todas em fila; não medido com três).
- A parte 2b (opções) e a API HTTP.
