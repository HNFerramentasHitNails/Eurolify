# Hub: as opções do artigo na ficha (#278, #279, #281) — 09/10/2026

## O que se fez

- Desenho no `docs/22` §20 (#279), aprovado pelo Diogo: *«sim, aprovo o
  desenho, junta o #279»*.
- Código no #281 (squash `4db6ffd`):
  - API: `GET /hub/products/{id}/options`, a mesma leitura do
    `GET /products/{id}/options`, com `variantes` (`var_…`, também as
    arquivadas) em cada valor, lidas de `variante_valor` na mesma transacção
    e com o filtro do comerciante escrito. A rota pela chave não muda.
  - Hub: uma coluna por opção entre o SKU e o estado («—» sem valor), a
    linha «Opções: …» por cima, nada num artigo sem opções, e «Não foi
    possível ler as opções» + a razão + «Tentar outra vez» quando falham.
  - A passagem (`capturas.mjs`) dá opções ao artigo 1 («Tamanho»: 15 ml,
    30 ml, Caixa de 12; «Acabamento»: Brilhante) antes de o activar.
- Revisão do agente publicada no #281: 0 P0, 0 P1, 0 P2, 8 P3. Corrigidos o
  P3-1 (SKU e peso sem partir), P3-2 (a razão da falha), P3-3 (`data-opcoes`
  para a passagem esperar o desenho) e P3-5 (verificação que não podia
  falhar); os outros ficaram, com a razão escrita no pedido.
- No ensaio: a corrida 38005027628 acabou bem às 23:40 UTC; o
  hub.eurolify.eu serve `index-BwR79n2G.js` (igual ao build local) e
  `GET /hub/products/…/options` sem sessão dá 401.
- Capturas na página de aprovação (versão 10). Falta o OK do aspecto.

## Números (com data e como se contaram)

- 09/10/2026, depois das correcções: API `hub-catalogo` 17 de 17 (vitest);
  Hub 124 testes; passagem 447 «ok» e 0 falhas (`grep -c '^ok'` no registo).
- Antes da junção do #280: a bateria da API, 1039 testes verdes.
- Prova pela falha: sem o `.where("comerciante_id", …)` em
  `variantesDosValores`, o teste do outro comerciante falha
  (`expected [ Array(1) ] to deeply equal []`). Medido por mim e pelo agente.

## O que ficou por verificar

- O ecrã com 3 ou 4 opções: um valor longo («Caixa de 12») ainda parte em
  duas linhas a 1280 px.
- O leitor de ecrã real, o Safari e o Firefox.
- O ciclo de páginas de `api.opcoesDoArtigo` não tem teste próprio (como o
  das imagens).
- A escrita das opções é o passo seguinte (#285, desenho no #286).
