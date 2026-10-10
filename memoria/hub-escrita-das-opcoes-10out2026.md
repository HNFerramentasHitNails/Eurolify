# Escrever as opções do artigo, pela API e pelo Hub (#285, #286, #290, #297) — 10/10/2026

## O que se fez

- Desenho no `docs/14` §7.1 («A escrita das opções») e no `docs/22` §21
  (#286), aprovado pelo Diogo a 09/10/2026: *«sim, aprovo o desenho, junta o
  #286»*, com a `versao` da opção.
- API (#290, squash `4f45f41`), no ensaio a 10/10/2026 às 11:37 UTC (corrida
  38048711824):
  - `PATCH`/`DELETE` da opção e do valor, `PUT` da ordem das opções e dos
    valores, `PUT /variants/{id}/values` (rascunho); as mesmas pelo `/hub/`,
    mais criar uma opção e acrescentar um valor; `catalog.external_field`
    num artigo do sistema de gestão.
  - Migração `0043_catalogo_versao_da_opcao` (era 0042; o #289 usou o
    número entretanto): a `versao` sobe com o nome e com cada linha de valor
    mudada; a opção nasce na 1 com os valores com que é criada.
  - Código novo `catalog.order_mismatch` (409); `criarOpcao` passa a usar a
    maior posição + 1 (apagar uma opção repetia posições).
  - Revisão do agente publicada no #290: 0 P0, 0 P1, 3 P2 (corrigidos, com
    prova pela falha), 6 P3.
- Hub (#297, squash `bc7637a`): a página `/artigos/{prd_…}/opcoes` e a
  ligação na ficha. Revisão do agente publicada no #297: 0 P0, 0 P1, 5 P2
  (corrigidos), 7 P3.
- No ensaio: o hub.eurolify.eu serve `index--bROh6FN.js` (igual ao build
  local do `bc7637a`) desde as 12:18 UTC de 10/10/2026. Capturas na página
  de aprovação (versão 11), no ecrã «Editar as opções do artigo».

- Aspecto do ecrã aprovado pelo Diogo a 10/10/2026 («sim», à pergunta
  sobre os três ecrãs da página de aprovação, versão 12).

## Números (com data e como se contaram)

- 10/10/2026, API: `catalogo-opcoes-escrita.test.ts` 17/17; bateria inteira
  1098/1098 depois da junção com o #289 e o #291 (vitest).
- 10/10/2026, Hub: 127 testes; passagem (`capturas.mjs`) 469 «ok», 0 falhas
  (`grep -c '^ok'` no registo).
- Provas pela falha: sem os filtros do comerciante (`opcoes-escrita.ts`), com
  a versão conferida antes da fila, com o gatilho sem `DELETE` e com a
  posição pela contagem, um teste falha em cada caso; no Hub, apagar todas
  as escolhas depois de gravar uma variante pára a passagem.

## O que ficou por verificar

- O conflito de versão na passagem usa um `fetch` do mesmo navegador (como
  a edição do artigo), não duas sessões.
- O «sem permissão» do ecrã só está provado pela API (403 nas rotas).
- Testes da linha do tempo para o texto, o apagar e a ordem (só o nome está
  provado; a 0033 já guarda as tabelas).
- Leitor de ecrã real, Safari e Firefox; páginas com muitas opções.
