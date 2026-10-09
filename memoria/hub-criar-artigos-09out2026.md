# Hub: criar artigos — 09/10/2026

Pedidos do Diogo, 09/10/2026: *«sim, avança com o desenho da criação de
artigos»*, *«sim, aprovo o desenho, junta o #222»* (com a lista do que
fica de fora e o limite de 20 variantes) e *«sim, avança com o código da
criação de artigos»*. Issue #221; desenho em `docs/22` §14 (#222); código
no #223 (squash 1a437c0).

## O que se fez

- **Desenho (#222)**: só artigos físicos, em rascunho, com 1 a 20
  variantes. Ficam de fora serviço e bilhete (classificação), digital e
  cartão-oferta (desligados), a categoria fiscal, `onu`/`classe_adr` (C),
  as opções, acrescentar variantes a um artigo existente, imagens novas e
  preço.
- **API (#223)**: `POST /hub/products` com a mesma função do
  `POST /products` (`criacaoDoArtigo`, extraída sem mudar a resposta) e um
  corpo mais estreito. Sem `Idempotency-Key`: o SKU único (também nos
  arquivados) recusa um segundo artigo.
- **Hub (#223)**: «Criar artigo» na lista e o ecrã `/artigos/novo`. O ecrã
  confere o que é do formulário; a API decide o resto e o ecrã põe o erro
  no campo quando sabe qual é (procura os SKU depois de um 409). Uma
  resposta perdida procura o artigo (rascunho, mesmo nome, exactamente os
  SKU) e abre-o; nunca cria dois.
- **Revisão Opus 5.5** (agente da sessão, ADR-0035): 0 P0, 0 P1, 3 P2 e 10
  P3, todos corrigidos no #223.
- **Descoberto**: o foco mudado num pedido de animação podia correr antes
  de o React pôr o elemento no ecrã. Afectava o aviso da ficha (também ao
  voltar da edição: o P3-6 do #217 não funcionava), a contagem da lista e
  o SKU da variante nova (perdia-se a primeira tecla). Passou a
  `useLayoutEffect`; a passagem confere os três.
- **Pedido ao dono do catálogo (#77)**: o SKU/GTIN repetido no pormenor do
  erro.
- **Sem alteração à VPS**: só a publicação normal pelo GitHub.

## Números (com data e como se contaram)

- 09/10/2026, local, com o main do dia (já com o #215): API 936/936 testes
  em 51 ficheiros (`vitest run`); Hub 91/91; passagem 347/347 em duas
  corridas seguidas (`node scripts/capturas.mjs`, linhas «ok»).
- 09/10/2026, GitHub: `verificar` verde no 8cf859a; `publicar` (corrida
  37932179848) verde; imagem `sha256:1ab1138b…b528345c0`, «migrar: nada em
  falta».
- 09/10/2026, 12:51:35 UTC, de fora (`curl`): `hub.eurolify.eu` serve
  `assets/index-Bz2Np4qA.js`, o mesmo nome da construção local;
  `POST /hub/products` sem sessão dá 401; `/artigos/novo` dá 200.

## O que ficou por verificar

- Criar com uma sessão real no ensaio: não medi (não há sessão minha lá).
- Um leitor de ecrã real, 320 px e a captura com erros a 768 e 1280 px.
- Se um comerciante suspenso consegue criar pelo Hub (o gancho é o das
  outras escritas do Hub; não testado aqui).
- O aspecto do «Criar artigo»: falta o OK do Diogo ou do Bruno (página de
  aprovação).
