# A API do Moloni — o que diz a documentação oficial (11/10/2026)

> **Fonte de pesquisa, não regra, e não testada.** Pedido do Diogo, 11/10/2026
> (*«sim, lê a API do Moloni»*), para a investigação do balcão (`docs/13` §7)
> e útil à parte 2 da fatia 10 (`docs/29`, Q5). Li as páginas abaixo em
> `moloni.pt/dev` (ferramenta de leitura de páginas, que resume o texto).
> **Não fiz nenhum pedido à API nem usei a sandbox.** Onde a página não diz,
> escreve-se «não diz»; nada se completa por lógica.

## Páginas lidas

| Página | Endereço |
|---|---|
| Introdução (menu completo) | `https://www.moloni.pt/dev/` |
| Autenticação | `https://www.moloni.pt/dev/autenticacao/` |
| Utilização | `https://www.moloni.pt/dev/utilizacao/` |
| Controlo de erros | `https://www.moloni.pt/dev/controlo-de-erros/` |
| Sandbox | `https://www.moloni.pt/dev/sandbox/` |
| ChangeLog (só o índice das versões) | `https://www.moloni.pt/changelog/api` |
| Documents (lista de métodos) | `https://www.moloni.pt/dev/documents/documents/` |
| Documents · getModifiedSince | `https://www.moloni.pt/dev/documents/documents/getmodifiedsince/` |
| Simplified Invoices (lista, getAll, getOne) | `https://www.moloni.pt/dev/documents/simplified-invoices/` e subpáginas `getall/`, `getone/` |
| Products (lista, getOne, getModifiedSince) | `https://www.moloni.pt/dev/products/products/` e subpáginas `getone/`, `getmodifiedsince/` |
| Product Stocks (lista, getAll, insert) | `https://www.moloni.pt/dev/products/product-stocks/` e subpáginas `getall/`, `insert/` |
| Document Sets · getAll | `https://www.moloni.pt/dev/settings/document-sets/getall/` |
| App «Moloni POS» na App Store | `https://apps.apple.com/pt/app/moloni-pos/id1484656052` |

Não li: Invoice Receipts, Receipts, Credit Notes, Customers, Warehouses,
getPDFLink e as subpáginas das versões do ChangeLog.

## 1. Como se liga

| Ponto | O que a página diz |
|---|---|
| Conta | É preciso **activar uma conta de Developer** no Moloni, com um Developer ID, uma URI de resposta e um Client Secret (Autenticação) |
| Fluxo para aplicações web | `authorization_code`: o comerciante entra no Moloni e aceita (`https://www.moloni.pt/ac/root/oauth/`); o código troca-se em `GET https://api.moloni.pt/v1/grant/` por `access_token` e `refresh_token` |
| Fluxo para aplicações nativas | `password`, com o utilizador e a palavra-passe do Moloni; a página recomenda que a palavra-passe **não seja guardada** |
| Validades | `access_token` **1 hora** (`expires_in: 3600`); `refresh_token` **14 dias**. Renovar devolve um par novo. Passados os 14 dias, o utilizador autentica-se outra vez |
| Onde vai o token | **Na query string** de todos os pedidos (`?access_token=…`) (Utilização) |
| Formato | Pedidos `POST`; corpo em `x-www-urlencoded` por omissão, JSON com `json=true`; respostas em JSON (Introdução, Utilização) |
| Erros | Tabela de 17 códigos de dados (ex.: 8 «número de contribuinte português válido», 11 «O Documento não pode ser enviado para a Autoridade Tributária (AT)», 16 sobre o art. 36.º, n.º 15, do CIVA); erros de autenticação com HTTP 400 (Controlo de erros) |
| Limites de pedidos | **Não diz.** Procurei «limite», «429», «pedidos por minuto/hora» na Introdução, na Utilização, no Controlo de erros e na Sandbox |
| Avisos (webhooks) | **Não diz.** Procurei «webhook», «hook», «notificação», «callback» na Introdução, na Utilização e no índice do ChangeLog; não aparecem no menu |
| Sandbox | Uma «conta de demonstração», pelo Moloni API Explorer; o acesso pede-se a `apoio@moloni.pt`. A página não diz se os documentos de lá têm validade fiscal |

**Consequências para o desenho:**

- **O token vai no endereço.** Tudo o que regista endereços (o nginx, os
  registos da API, os erros) tem de o tapar — regra dos segredos fora dos
  registos (`observability-security`).
- **14 dias sem renovar e a ligação morre.** A renovação tem de ser uma tarefa
  automática que avisa se parar (`AGENTS.md`, «Não se erra…», regra 3).
- O fluxo `password` guardaria a palavra-passe do comerciante: **usa-se o
  `authorization_code`**.
- Sem avisos do Moloni, o Eurolify tem de **perguntar** de tempos a tempos
  (ver §2). Sem limites escritos, o Eurolify limita-se a si próprio — o Hub
  actual faz o mesmo (proposta comercial do Hub, p. 25: «Limite de pedidos
  por minuto»).

## 2. Ler as vendas (documentos)

| Ponto | O que a página diz |
|---|---|
| Tipos de documento | 24 no menu, entre eles Simplified Invoices, Invoice Receipts, Invoices, Receipts, Credit Notes (Introdução) |
| O que mudou desde uma data | `documents/getModifiedSince` com `company_id` e `lastmodified` (obrigatórios): «Devolve os documentos que foram alterados ou criados desde uma determinada data e hora». Filtra também por `document_set_id`, `customer_id`, `number`, `date`, `year` |
| Páginas | `qty` por omissão 50, **máximo 50**; `offset` por omissão 0 (o que conta não está explicado) |
| O que vem na lista | `document_id`, `document_type_id`, `document_set_id`, `number`, `date`, `entity_vat`, `entity_name`, valores (`gross_value`, `taxes_value`, `net_value`), `status` (inteiro), `document_set` (`document_set_id`, `name`). **Sem as linhas** |
| As linhas | Só no `getOne` do tipo (ex.: `simplifiedInvoices/getOne`): `products[]` com `product_id`, `reference`, `ean`, `name`, `qty`, `price`, `discount`, `exemption_reason`, `taxes[]`; e `payments[]` com `payment_method_id`, `date`, `value`. **Não traz armazém** nas linhas |
| Estado | `status = 1` é **fechado** (`generateMBReference` exige-o); um documento fechado não se altera nem se apaga. O valor do rascunho não está escrito |
| Filtro por estado | **Não há** no `getAll` nem no `getModifiedSince`; o estado só vem na resposta |

**Consequência:** ler uma venda custa **um pedido por cada 50 documentos
alterados mais um pedido por documento** (para as linhas). Uma loja com 200
vendas ao balcão num dia faria pelo menos 204 pedidos — conta feita sobre a
documentação, não medida.

## 3. Artigos e stock

| Ponto | O que a página diz |
|---|---|
| Procurar um artigo | `getByReference`, `getByEAN`, `getBySearch` (nome, referência ou EAN); «O campo reference deve ser único» (Products) |
| Stock no artigo | `products/getOne` traz `has_stock` (int), `stock` (**int**) e `warehouses[]` com `stock` (**float**) por armazém. A página não diz se o de topo é a soma |
| Artigos alterados | `products/getModifiedSince` com `lastmodified` em UTC; a página não diz se uma venda conta como alteração |
| Movimentos | `productStocks/getAll`: movimentos filtráveis por artigo, armazém e dia, com `qty`, `accumulated` (sem definição), `document_id` e o documento; sem `warehouse_id`, «todos os movimentos de todos os armazéns» |
| Escrever um movimento | `productStocks/insert` com `product_id`, `movement_date`, `qty` (float), `warehouse_id` (facultativo) e `notes`. A página não diz se `qty` negativo é saída |
| Movimentos de documentos | Não se alteram nem apagam («não é possível actualizar», «não poderão ser apagados»). A página não diz que os documentos mexem no stock sozinhos; os movimentos trazem o `document_id`, o que o sugere — **inferência, não verificado** |

## 4. A app «Moloni POS»

Da página da App Store (lida a 11/10/2026): «pode emitir documentos no seu
Ponto de Venda (POS)»; «Sincronize em tempo real com a sua conta Moloni»;
«Documentos, clientes, artigos e terminais ilimitados»; gratuita, parte de
«um conjunto de apps móveis, totalmente gratuitas»; versão 1.0.270 de 29/09
(o ano não aparece). **Não diz** que tipos de documento emite, se trabalha
sem rede, nem se os documentos ficam com uma série própria. A documentação da
API **não fala** da app (procurei «POS», «ponto de venda» e «terminal» na
Introdução, na Sandbox e nas Document Sets; as séries não têm nenhum campo de
POS ou de ATCUD).

## 5. O que responde às perguntas do balcão (`docs/13` §7)

| Pergunta | Resposta | Grau |
|---|---|---|
| A API lê as vendas feitas na app de POS? | **Provavelmente sim**: a app sincroniza com a conta Moloni, e a API lê todos os documentos da empresa alterados desde uma data, com as linhas. Se a app usar uma série própria, o `document_set_id` separa-as | **não verificado** — só um teste na sandbox o prova |
| O stock lê-se e escreve-se? | **Sim**, pela documentação: stock por artigo e por armazém no `getOne`; movimentos para ler e para inserir | documentado, não testado |
| O Moloni avisa quando há uma venda? | **Não encontrei avisos.** O Eurolify pergunta com `getModifiedSince` de tempos a tempos | documentado pela ausência, nas páginas listadas |
| Como se casa o artigo do Moloni com o do Eurolify? | Pela **referência** (única no Moloni) = o **SKU** do Eurolify; o EAN como segunda verificação; nunca pelo nome (`AGENTS.md`, «Não se erra…», regra 6) | proposta |

**Quem manda no stock:** já está decidido. Com um sistema de gestão, **o livro
é do Eurolify** e o outro sistema só envia movimentos, nunca o saldo
(`docs/06`, DE Q3; `docs/27`, R9). Na ligação do balcão, cada venda lida do
Moloni entra no Eurolify como movimento (ou encomenda do canal «balcão»), e o
stock que o Moloni mostra ao balcão tem de vir do Eurolify. **Isto pede ao
Eurolify que escreva no stock do Moloni**, para a app não vender o que a loja
online já reservou. O atraso entre uma venda ao balcão e a loja online saber
dela é o intervalo das perguntas — **não medido**.

## 6. O que serve à fatia 10 (`docs/29`, Q5)

- O mesmo fluxo de autenticação (`authorization_code`, 1 hora / 14 dias,
  token no endereço) vale para emitir documentos.
- Os campos da prova estão no `getOne`: `number`, `document_set_id`,
  `entity_vat`, `status`, `rsa_hash`, `hash_control`. O PDF pede-se pelo
  `getPDFLink` (não lido).
- O código 16 de erro confirma a regra do art. 36.º, n.º 15, do CIVA sobre a
  identificação do cliente com nome diferente de «Consumidor Final» (texto da
  página cortado; a regra fiscal em si continua **C** no `docs/03`).

## 7. Por verificar na sandbox

1. Uma venda na app de POS aparece em `documents/getModifiedSince`? Com que
   tipo, série e `status`?
2. O `status` do rascunho, e se há outros valores.
3. Uma venda por documento mexe no stock do Moloni sozinha? Uma venda
   altera o `lastmodified` do artigo?
4. `productStocks/insert` com `qty` negativo é uma saída?
5. O que é o `accumulated`, e se o `stock` de topo é a soma dos armazéns.
6. O `offset` conta linhas ou páginas.
7. O token aceita-se no cabeçalho `Authorization` (para não ir no endereço)?
8. Que limite de pedidos o Moloni aplica na prática.
