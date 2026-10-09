# Linha do tempo do artigo (C7) — 09/10/2026

## O que se fez

- **Desenho e código** no #208 (decisão `docs/06` CU), com a migração 0033.
- **Registo na base:** a tabela `alteracao_catalogo` só se acrescenta. Recebe uma entrada por cada linha mudada nas 13 tabelas do Catálogo, escrita por gatilhos, com quem, quando e os campos com o antes e o depois.
- **Sem `eurolify.quem` na transacção, a mudança é recusada.** A excepção é o arquivo em cadeia de uma publicação, que usa o `arquivado_por` (`catalogo:<motivo>`).
- **Rota** `GET /products/{id}/timeline`, com o âmbito novo `catalog:history` (dono e gestor).
- **O `escrever` do Catálogo** põe o quem em todas as escritas pela API; a importação põe a origem.
- **Revisão (Sonnet):** as traduções de opções e valores passaram a ficar no artigo, também num rascunho apagado em cascata. O número de transacção passou a ser opaco, e os gatilhos ficaram `ENABLE ALWAYS`.
- **Publicado no ensaio:** o registo diz «migrar: aplicadas 0033_catalogo_linha_do_tempo».

## Números (com data e como se contaram)

- **Testes da API, 09/10/2026:** 896 de 896, contados pelo vitest no meu ambiente (PostgreSQL 18.6, Node 22) depois da revisão. O teste da linha do tempo tem 9 casos.
- **Mutações:** 9 no total (5 na primeira ronda e 4 depois da revisão), todas apanhadas.

## O que ficou por verificar

- O espaço que o registo ocupa (uma importação de 5000 variantes) não foi medido.
- O prazo de guarda e a pseudonimização são C, como nos eventos (`docs/17`).
- Falta a rota da linha do tempo por categoria ou colecção.
