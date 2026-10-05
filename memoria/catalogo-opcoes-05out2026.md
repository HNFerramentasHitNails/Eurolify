# Catálogo (fatia 3), parte 2b: opções e valores — 05/10/2026

## O que se fez

- O Diogo pediu as opções (*«sim, começa as opções do Catálogo»*), com a P10 já decidida (*«sim, um artigo sem opções pode ter várias variantes»*, #82, `docs/06` AU).
- Migração `0005_catalogo_opcoes.sql`: tabelas `opcao`, `valor_opcao` e `variante_valor` com RLS forçado e chaves compostas por comerciante e artigo (restrição nova `variante_artigo_id_unico`); nomes e valores únicos sem distinguir maiúsculas.
- Regras (proposta, `docs/14` §3.3): opções só num rascunho; valores novos sempre; valores de uma variante só mudam num rascunho; com opções, cada variante activa completa e sem combinação repetida entre as activas (arquivadas não contam). Num rascunho, a completude exige-se ao activar (trigger `artigo_combinacoes_ao_activar`); num artigo que já não é rascunho, no fim da transacção (triggers de restrição adiados em `variante_valor` e em `variante`). Uma fila por artigo (`pg_advisory_xact_lock`) para que duas transacções ao mesmo tempo não gravem a mesma combinação.
- `repositorio.ts`: `criarOpcao`, `acrescentarValor`, `opcoesDoArtigo`, `definirValoresDaVariante`, `criarVarianteComValores`, `valoresDaVariante`. Códigos novos: `catalog.options_incomplete`, `option_duplicate`, `option_value_duplicate`, `option_repeated`; `option_combination_duplicate` já estava no desenho.
- Acertos P3 da 3.ª revisão do #81 (kits): o comentário da 0004 sobre o bloqueio (não prende a fila de outro, mas pode esperar por ela por SQL directo) fica corrigido no `docs/14` §3.4, porque a 0004 já está aplicada; reflow de uma linha do §3.4. O revisor mediu ciclos com 4 escritas ao mesmo tempo (20 rondas, sem impasses).

## Números (com data e como se contaram)

- 05/10/2026, PostgreSQL 18.6 em Docker, `EXIGIR_BASE=1`: 10 testes em `catalogo-opcoes.test.ts`; api 177 passados, mcp 30; `pnpm tipos`, `pnpm lint` e `pnpm construir` sem erros.
- Mutações (uma de cada vez, na 0005): activar sem verificar (1 falha), sem a regra dos repetidos (2), sem a completude no fim (1), sem a fila do artigo (1, o teste de duas variantes ao mesmo tempo), opção num artigo à venda (1), valores a mudar à venda (1), RLS aberto (1).

## O que ficou por verificar

- A 0005 na VPS (corre na publicação depois de juntar).
- Apagar e renomear opções e valores pelo repositório (a base deixa num rascunho; não há função nem teste).
- O custo das verificações no fim da transacção com muitas variantes por artigo (correm por linha mudada).
- Traduções dos nomes e valores (parte 3) e a API HTTP.
