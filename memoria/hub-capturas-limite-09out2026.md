# Passagem do Hub: o limite de 300 pedidos por minuto (#253) — 09/10/2026

Pedido do Diogo, 09/10/2026: *«sim, avança com a #253»*. Issue #253 (a
miniatura que às vezes não aparecia na passagem); correcção no #270.

## O que se fez

- **A causa**: a página da Ana (`rp`, contexto `recuperado`) fazia quase
  todos os seus pedidos ao Hub numa só janela do limite de 300 pedidos por
  minuto por endereço (`apps/api/src/base/limite.ts:26-29`, janela fixa).
  Com tão pouca folga, um pedido a mais (um repetido, uma corrida mais
  rápida) dava 429 real ao passo seguinte, a um passo diferente de cada
  vez: a miniatura do #253, as chaves quando o #262 acrescentou um passo.
- **A correcção (só na passagem)**: `enderecoNovo(pagina)` dá à página um
  `x-ip-de-teste` novo; a edição do artigo, o envio de imagens e as chaves
  começam com o seu endereço. Nenhum ecrã nem a API mudam.
- **O Hub comporta-se bem**: com um 429, a miniatura mostra «Pedidos a
  mais» e «Tentar outra vez» (`Artigo.tsx:1221-1233`).
- **A fila das imagens** (a suspeita do issue: 4 ao mesmo tempo, sem
  prazo): em sete passagens com o registo de cada pedido, todos os pedidos
  de miniatura acabaram. Não se mudou.

## Números (com data e como se contaram)

- 09/10/2026, uma passagem com o registo de cada pedido `/hub/` da página
  `rp` (evento `request` do Playwright): **310 pedidos entre 0,2 s e
  18,9 s**, todos na mesma janela; 254 antes do passo das imagens. Alguns
  são respostas fingidas pela passagem (`route`) e não chegam à API; não
  os separei, por isso o número real que a API contou é menor que 310.
- 09/10/2026, prova: com 50 pedidos `/hub/me` a mais antes das imagens,
  429 reais na ficha, nos preços, nas publicações e no histórico; com a
  correcção, a mesma injecção passa (439 «ok»).
- 09/10/2026: seis passagens com diagnóstico antes da correcção, 6/6 com
  439 «ok» (a falha original não voltou sozinha).

## O que ficou por verificar

- **Pergunta de produto** (revisão do #270, P3-1): o limite de 300 por
  minuto está marcado como proposta «a rever com medições»
  (`limite.ts:18`). Esta medição é de uma passagem automática, não de uma
  pessoa: não diz que o limite é baixo, mas é o primeiro número que há.
- Os outros trechos longos (revisão do #270, P3-2): a página `rp` até à
  edição (recuperar, conta, ficha) e os contextos sem `x-ip-de-teste` das
  capturas (8 larguras × 2 temas) não foram contados por trecho.
