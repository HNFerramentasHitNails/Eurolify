# Catálogo (fatia 3), parte 2a: kits — 05/10/2026

## O que se fez

- O Diogo pediu a parte 2 (*«sim, começa a parte 2 do Catálogo»*). Partiu-se em dois pedidos: **2a, kits** (este) e **2b, opções e valores**, que precisa de uma decisão (um artigo sem opções pode ter várias variantes? O `docs/14` §3.2 diz «um artigo sem opções tem uma variante», mas a parte 1 deixa várias).
- Migração `0004_catalogo_kits.sql`: tabela `componente` (kit, componente, quantidade, posição), chaves compostas ao `(comerciante_id, id)` da variante (restrição nova `variante_comerciante_id_unico`), RLS forçado; trigger: sem ciclos (consulta recursiva), componente novo activo, kit arquivado não muda, bloqueio por comerciante (`pg_advisory_xact_lock`) para dois pedidos ao mesmo tempo não fecharem um círculo; apagar uma variante que é componente é recusado pela chave estrangeira `componente_em_uso`.
- `repositorio.ts`: `definirComponentes` (muda só o que mudou; confirma que os componentes existem) e `componentesDoKit`. O código de `componente_em_uso` decide-o a operação (`traduzir(erro, { apagar: true })` só em `apagarRascunho`). Códigos novos: `catalog.component_archived`, `component_duplicate`, `component_in_use`; `component_cycle` já estava no desenho.
- `docs/14` §3.4: as regras desta parte, marcadas **proposta**.

- **Revisão do #81 (agente, 05/10/2026):** 1 P1 e 5 P2; o Diogo pediu tudo (*«sim, corrige o P1, os P2 e os P3 e manda rever»*). P1: um rascunho com o componente criado antes do kit não se apagava (a chave `componente_em_uso` disparava antes da cascata); a 0004 redefine `artigo_antes_de_apagar` para apagar primeiro a composição. Primeira tentativa minha marcava o apagar com um `set_config`, que a própria API podia imitar: trocada pela regra «a composição de um kit arquivado só se apaga com o artigo dele em rascunho». P2: `definirComponentes` toma o bloqueio do comerciante antes de prender linhas (substituições cruzadas davam impasse, 40P01) e muda só o que mudou (um componente arquivado que já estava fica); `componente_em_uso` é «em uso» só ao apagar (`traduzir` com `{ apagar: true }`), «não existe» ao inserir; testes por SQL directo para o RLS de `componente` e para a chave por comerciante; limitação do rascunho cujo componente está no kit de outro artigo escrita no `docs/14`. P3: bloqueio pela chave do comerciante do contexto; quantidade sem máximo, escrita.

- **2.ª revisão do #81 (agente, 05/10/2026):** sem P0 nem P1; o Diogo pediu os P2 e os P3. P2-1: apagar um rascunho e mudar um kit dele ao mesmo tempo dava impasse (4 em 30, medido pelo revisor); `artigo_antes_de_apagar` toma o bloqueio do comerciante antes de apagar. P2-2: teste do kit arquivado num artigo à venda. P2-3: teste de arquivar o kit ou um componente a meio de uma substituição (espera e recusa); o `forShare` dos componentes no repositório saiu (o do trigger chega e é o que o teste prova). P3: a chave do bloqueio no repositório na forma canónica do uuid; esvaziar um kit arquivado de um rascunho só ao apagar o rascunho (`pg_trigger_depth() > 1`); o teste do `traduzir` corre sem base. **P3-1 não se aplicava:** medido com dois clientes (05/10/2026): numa transacção com um bloqueio consultivo, um erro larga-o logo (1 antes, 0 depois, com a sessão ainda «idle in transaction (aborted)»), por isso uma linha de outro comerciante recusada pelo RLS não prende a fila dele; a chave voltou a ser a da linha e o teste que não provava nada saiu.

## Números (com data e como se contaram)

- 05/10/2026, PostgreSQL 18.6 em Docker, `EXIGIR_BASE=1`, 1.ª versão: 9 testes em `catalogo-kits.test.ts`, todos passados; `pnpm tipos` e `pnpm lint` sem erros.
- Mutações (uma de cada vez, na 0004): sem a verificação dos ciclos falham 2 testes; componente arquivado aceite, 1; kit arquivado a mudar, 1; sem o bloqueio por comerciante, 1 — **mas só depois de mudar o teste**: a primeira versão (A em B e B em A ao mesmo tempo) passava sem o bloqueio, porque a linha do kit presa pelo repositório já os punha em fila. O teste passou a um círculo de 4 (A→B e C→D, com B→C e D→A gravados), em que as duas escritas não tocam nas mesmas linhas.

- 05/10/2026, depois da revisão: 13 testes em `catalogo-kits.test.ts`. Mutações, uma de cada vez: sem apagar a composição primeiro (2 falham), apagar e reinserir tudo (1), sem o bloqueio no repositório (1, impasse), RLS `USING (true)` (1), chave estrangeira só pelo id (1), «em uso» sempre (1).

- 05/10/2026, depois da 2.ª revisão: 16 testes em `catalogo-kits.test.ts` (3 corridas seguidas sem erros); api 167 passados, mcp 30. Mutações: sem o bloqueio ao apagar (falha o teste do impasse, 30 rondas), sem `pg_trigger_depth` (1), sem o `forUpdate` do kit (1), sem o `FOR SHARE` do trigger (1), apagar livre num kit arquivado (2).

## O que ficou por verificar

- A 0004 na VPS (corre na publicação depois de juntar). A restrição nova em `variante` precisa de que não haja `(comerciante_id, id)` repetidos, o que o `id` único já garante.
- Ciclos com mais de duas escritas ao mesmo tempo (o bloqueio por comerciante põe todas em fila; medido com 2, em 5 rondas, não com 3).
- A parte 2b (opções) e a API HTTP.
