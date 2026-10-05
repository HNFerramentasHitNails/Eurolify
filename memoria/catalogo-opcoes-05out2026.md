# Catálogo (fatia 3), parte 2b: opções e valores — 05/10/2026

## O que se fez

- O Diogo pediu as opções (*«sim, começa as opções do Catálogo»*), com a P10 já decidida (*«sim, um artigo sem opções pode ter várias variantes»*, #82, `docs/06` AU).
- Migração `0005_catalogo_opcoes.sql`: tabelas `opcao`, `valor_opcao` e `variante_valor` com RLS forçado e chaves compostas por comerciante e artigo (restrição nova `variante_artigo_id_unico`); nomes e valores únicos sem distinguir maiúsculas.
- Regras (proposta, `docs/14` §3.3): opções só num rascunho; valores novos sempre; valores de uma variante só mudam num rascunho; com opções, cada variante activa completa e sem combinação repetida entre as activas (arquivadas não contam). Num rascunho, a completude exige-se ao activar (trigger `artigo_combinacoes_ao_activar`); num artigo que já não é rascunho, no fim da transacção (triggers de restrição adiados em `variante_valor` e em `variante`). Uma fila por artigo (`pg_advisory_xact_lock`) para que duas transacções ao mesmo tempo não gravem a mesma combinação.
- `repositorio.ts`: `criarOpcao`, `acrescentarValor`, `opcoesDoArtigo`, `definirValoresDaVariante`, `criarVarianteComValores`, `valoresDaVariante`. Códigos novos: `catalog.options_incomplete`, `option_duplicate`, `option_value_duplicate`, `option_repeated`; `option_combination_duplicate` já estava no desenho.
- Acertos P3 da 3.ª revisão do #81 (kits): o comentário da 0004 sobre o bloqueio (não prende a fila de outro, mas pode esperar por ela por SQL directo) fica corrigido no `docs/14` §3.4, porque a 0004 já está aplicada; reflow de uma linha do §3.4. O revisor mediu ciclos com 4 escritas ao mesmo tempo (20 rondas, sem impasses).

- **Revisão do #83 (agente, 05/10/2026):** 1 P1 e 5 P2; o Diogo decidiu a P11 e pediu tudo (Diogo, 05/10/2026: *«não, bloqueia fora do rascunho»*; *«corrige tudo e manda rever»*). P1: apagar uma opção num rascunho podia deixar duas variantes completas e iguais e o artigo activava-se — agora o apagar de uma opção marca a verificação no fim e activar também verifica os repetidos. P2-1: a verificação no fim corria por linha (512 variantes: 220 s, medido pelo revisor); agora corre uma vez por artigo e por transacção, com uma marca numa tabela interna (`combinacoes_por_verificar`) que só funções com os direitos do dono escrevem e tiram — o revisor propunha uma marca em `set_config`, que a própria API poderia pôr para saltar a verificação. P2-2: `artigo_antes_de_apagar` entra na fila do artigo antes de prender as variantes; 40P01 e 40001 viram `catalog.retry`. P2-3: a fila leva o comerciante do contexto; as funções deixam de ser públicas; a chave primária de `variante_valor` leva o comerciante. P2-4/P11: textos fixos fora do rascunho. P2-5: testes por SQL directo. P3: valores de uma arquivada não se tiram (salvo em cascata), opção sem valores recusada, nota sobre READ COMMITTED, índice.

## Números (com data e como se contaram)

- 05/10/2026, PostgreSQL 18.6 em Docker, `EXIGIR_BASE=1`: 10 testes em `catalogo-opcoes.test.ts`; api 177 passados, mcp 30; `pnpm tipos`, `pnpm lint` e `pnpm construir` sem erros.
- Mutações (uma de cada vez, na 0005): activar sem verificar (1 falha), sem a regra dos repetidos (2), sem a completude no fim (1), sem a fila do artigo (1, o teste de duas variantes ao mesmo tempo), opção num artigo à venda (1), valores a mudar à venda (1), RLS aberto (1).

- 05/10/2026, depois da revisão: 21 testes em `catalogo-opcoes.test.ts`. Tempos do COMMIT de uma transacção (2 opções, PostgreSQL 18.6 local): 256 variantes, 0,45 s com a marca e 1,0 s sem ela; 576 variantes, 1,0 s e 4,4 s. Como um limite de tempo não prova a marca, o teste conta as verificações (uma por artigo, pelo aviso `RAISE DEBUG`). Mutações: sem a verificação ao apagar uma opção (1 falha), sem a marca (1), a API a poder tirar a marca (1), a fila sem o comerciante do contexto (1), a chave primária sem comerciante (1), mudar textos à venda (1), tirar valores de uma arquivada (1). Sem teste: o «sem repetidos» ao activar (só se alcança se a verificação no fim falhar) e a fila em `artigo_antes_de_apagar` (o impasse precisa de um intervalo que não se força num teste).

## O que ficou por verificar

- A 0005 na VPS (corre na publicação depois de juntar).
- Apagar e renomear opções e valores pelo repositório (a base deixa num rascunho; não há função nem teste).
- O custo das verificações no fim da transacção com muitas variantes por artigo (correm por linha mudada).
- Traduções dos nomes e valores (parte 3) e a API HTTP.
