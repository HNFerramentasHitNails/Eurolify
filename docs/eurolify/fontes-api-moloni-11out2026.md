# A API do Moloni — o que diz a documentação oficial (11/10/2026)

> **Fonte de pesquisa, não regra; testada só no §8.** Pedido do Diogo, 11/10/2026
> (*«sim, lê a API do Moloni»*), para a investigação do balcão (`docs/13` §7)
> e útil à parte 2 da fatia 10 (`docs/29`, Q5). Li as páginas abaixo em
> `moloni.pt/dev` (ferramenta de leitura de páginas, que resume o texto).
> **Não fiz nenhum pedido à API nem usei a sandbox.** Onde a página não diz,
> escreve-se «não diz»; nada se completa por lógica.
>
> **Actualização, 11/10/2026 à noite:** as 8 perguntas do §7 foram testadas
> a ler, na empresa de demonstração do Moloni, e a P4 com uma escrita na conta
> trial (com o OK do Diogo) — resultado no §8, e as
> linhas das §§ 2, 3 e 5 que o teste desmentiu estão corrigidas no sítio.

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
| Páginas | `qty` por omissão 50, **máximo 50**; `offset` por omissão 0; **conta documentos, não páginas** (testado a 11/10/2026, §8) |
| O que vem na lista | `document_id`, `document_type_id`, `document_set_id`, `number`, `date`, `entity_vat`, `entity_name`, valores (`gross_value`, `taxes_value`, `net_value`), `status` (inteiro), `document_set` (`document_set_id`, `name`). **Sem as linhas** |
| As linhas | Só no `getOne` do tipo (ex.: `simplifiedInvoices/getOne`): `products[]` com `product_id`, `reference`, `ean`, `name`, `qty`, `price`, `discount`, `exemption_reason`, `taxes[]`; e `payments[]` com `payment_method_id`, `date`, `value`. ~~Não traz armazém nas linhas~~ — **corrigido a 11/10/2026: traz `warehouse_id` em cada linha** (§8; o resumo da página tinha-o deixado de fora) |
| Estado | `status = 1` é **fechado** (`generateMBReference` exige-o); um documento fechado não se altera nem se apaga. O valor do rascunho não está escrito |
| Filtro por estado | ~~Não há no `getAll` nem no `getModifiedSince`~~ — **corrigido a 11/10/2026: o `documents/getAll` aceita `status`** (está na lista de parâmetros da página, e testado: com 0, 1 e 2 só vêm documentos desse estado). O `getModifiedSince` não o tem na página (relida a 11/10/2026) |

**Consequência:** ler uma venda custa **um pedido por cada 50 documentos
alterados mais um pedido por documento** (para as linhas). Uma loja com 200
vendas ao balcão num dia faria pelo menos 204 pedidos — conta feita sobre a
documentação, não medida.

## 3. Artigos e stock

| Ponto | O que a página diz |
|---|---|
| Procurar um artigo | `getByReference`, `getByEAN`, `getBySearch` (nome, referência ou EAN); «O campo reference deve ser único» (Products) |
| Stock no artigo | `products/getOne` traz `has_stock` (int), `stock` e `warehouses[]` com `stock` por armazém. ~~`stock` (int)~~ — **corrigido a 11/10/2026: vem com decimais (ex.: 238,25)**; o de topo **é a soma dos armazéns** (§8) |
| Artigos alterados | `products/getModifiedSince` com `lastmodified` em UTC (confirmado: o artigo vendido às 14:37:54 de Lisboa deixa de aparecer a partir das 13:37:58 UTC); **uma venda conta como alteração** (§8, P3) |
| Movimentos | `productStocks/getAll`: movimentos filtráveis por artigo, armazém e dia, com `qty`, `accumulated` (**o saldo do artigo depois do movimento**, §8 P5), `document_id` e o documento; sem `warehouse_id`, «todos os movimentos de todos os armazéns» |
| Escrever um movimento | `productStocks/insert` com `product_id`, `movement_date`, `qty` (float), `warehouse_id` (facultativo) e `notes`. A página não diz se `qty` negativo é saída; **testado a 11/10/2026 na conta trial: é** (−2 sobre +5 deixa 3; §8, P4) |
| Movimentos de documentos | Não se alteram nem apagam («não é possível actualizar», «não poderão ser apagados»). A página não diz que os documentos mexem no stock sozinhos; ~~inferência, não verificado~~ — **verificado a 11/10/2026: uma venda por documento (FS, FR) cria sozinha um movimento negativo com o `document_id`** (§8, P3) |

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
| A API lê as vendas feitas na app de POS? | **Sim, as vendas feitas num terminal de POS**: aparecem em `documents/getModifiedSince` com o `terminal_id` preenchido (§8, P1). Não separa por série: na demonstração usam a mesma série que o resto | **testado** na conta de demonstração a 11/10/2026; que esses terminais sejam a app de iPhone **não verificado** |
| O stock lê-se e escreve-se? | **Lê-se, sim**: stock por artigo e por armazém, e os movimentos com o saldo depois de cada um (§8). **Escreve-se, sim**: um movimento −2 sobre +5 deixa o stock em 3 (§8, P4) | testado a 11/10/2026 (leitura na demonstração, escrita na conta trial) |
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

## 8. Resultado dos testes (11/10/2026)

Pedido do Diogo, 11/10/2026 (*«testa a API do Moloni, as 8 perguntas»*).
Só leituras, **excepto a P4**: na conta trial, com o OK do Diogo, um artigo de
teste e dois movimentos de stock; nenhum documento.
Cliente de teste à parte do repositório (Python, `urllib`), fluxo `password`
com as variáveis `MOLONI_*`; o token nunca foi impresso.

**Onde se mediu.** As credenciais dão acesso a duas empresas
(`companies/getAll`):

| Empresa | O que tem (contado a 11/10/2026, ~19h) | Uso |
|---|---|---|
| A conta trial do Diogo (`company_id` 401965) | 0 documentos (`documents/count`), 0 terminais, 1 série, 1 armazém | lida; vazia, não responde a nada |
| «Empresa Demonstração» do Moloni (`company_id` 5) | 1108 documentos, 8 terminais de POS, 12 000+ artigos | **onde se mediu**; partilhada por todos os programadores com acesso de Developer — os dados são deles, não nossos |

O código ATCUD dos documentos da demonstração começa por `AAAAAAAA`
(ex.: `AAAAAAAA2B-26`), o que **sugere** séries não comunicadas à AT; **não
verificado** — a pergunta ao Moloni (§7, regras) continua de pé.

| # | Pergunta | Resposta | Como se mediu |
|---|---|---|---|
| 1 | Uma venda no POS aparece em `getModifiedSince`? Tipo, série, `status`? | **Sim.** Os documentos de um terminal vêm com `terminal_id` preenchido; existe `terminals/getAll` com o nome e a configuração de cada terminal. Tipos vistos: FS, FR, NC, NE, CM, VSP; **série partilhada** com documentos feitos fora do POS (`M2026`); `status` 1 (um VSP com 0) | 1108 documentos lidos por `getAll`: 50 com terminal (FS 22, FR 18, NC 5, NE 2, CM 2, VSP 1). `getModifiedSince` desde 10/10 00:00 devolveu os 6 de terminal desse período, os mesmos 6 do `getAll`. **Não se sabe** se os terminais são a app de iPhone ou outro POS do Moloni |
| 2 | `status` do rascunho e outros valores | **0** = rascunho (todos os 40 com `number` −1, sem número); **1** = fechado (949); **2** aparece em 119 (FT 71, PF 36, FR 4, RE 3, NC 3, OR 1, DP 1) e **o que significa não está verificado** (anulado? convertido?). As FT com 2 têm número, assinatura (`rsa_hash`) e nenhum documento associado (ex.: FT 1031968472, série FT2026, n.º 64, de 10/10/2026). A documentação não lista os valores (páginas `getAll`/`getOne` de Documents e Invoices, relidas a 11/10/2026): **pergunta enviada pelo Diogo ao Moloni a 11/10/2026, sem resposta ainda** | contagem dos 1108 documentos por `status` e `number` |
| 3 | Uma venda mexe no stock sozinha? Altera o `lastmodified` do artigo? | **Sim e sim.** A FS 1032164099 (terminal 170790, 14:37:54 de Lisboa) criou o movimento −2 com o `document_id` dela; o artigo `00012` aparece em `products/getModifiedSince` desde 13:37:50 UTC e deixa de aparecer desde 13:37:58 UTC | `productStocks/getAll` do artigo (18 movimentos, todos de FS/FR); `getModifiedSince` com 16 horas de corte diferentes. A coincidência ao segundo é forte, mas é correlação: outra alteração no mesmo segundo não está excluída |
| 4 | `productStocks/insert` com `qty` negativo é saída? | **Sim.** Na conta trial, com o OK do Diogo (*«sim, avança com o teste na conta trial»*): artigo de teste `TESTE-API-001` criado com stock 0; `insert` +5 → stock 5; `insert` −2 → **stock 3**, no armazém e no total. A resposta do `insert` devolve `qty` 2 com `direction` 1 (saída) e `acc` 3; a lista devolve −2. Nenhum documento criado (`documents/count` = 0 antes e depois). Já se via o mesmo nos movimentos da demonstração (artigo `26011035`: −1 leva 79 a 78) | escrita na conta trial, 11/10/2026 ~19h45; estado antes guardado (2 artigos de exemplo, 0 movimentos, 0 documentos) |
| 5 | `accumulated`; o `stock` de topo é a soma dos armazéns? | `accumulated` = **o saldo do artigo depois do movimento** (cada linha = anterior + `qty`; o último = `stock`). **O topo é a soma**: em 12 000 artigos lidos, 0 diferenças (ex.: `26000404`: 26 − 5 + 0 − 1 = 20). Há saldos **negativos** por armazém. Nos movimentos, `warehouse_id` vem **0** mesmo quando o stock está num armazém concreto (confirmado na conta trial: o `insert` com o armazém 512914 lista-se com 0); nas linhas do documento vem preenchido | `products/getModifiedSince` desde 01/09 (12 000 artigos, parei aí; há mais) |
| 6 | O `offset` conta linhas ou páginas? | **Documentos**: `offset` 1 devolve a lista começada no 2.º. `qty` acima de 50 é cortado para 50 (pedidos 200, vieram 50) | três pedidos com `offset` 0, 1 e 10 |
| 7 | O token aceita-se no cabeçalho `Authorization`? | **Não.** `Authorization: Bearer …` e o token cru dão 401 «Invalid access token»; no corpo JSON, 401; no corpo de formulário, o pedido passa mas **sem identidade** (`companies/getAll` devolve lista vazia). **Só funciona na query string** — tapar o token nos registos é obrigatório (§1) | cinco variantes contra `documents/count` e `companies/getAll` |
| 8 | Limite de pedidos na prática | **Nenhum encontrado até ~1400 pedidos/minuto durante 9 segundos.** 100 seguidos (40,6 s, 0,41 s cada) e 200 com 10 em paralelo (8,6 s): todos 200. **Sem cabeçalhos de limite** (nem `X-RateLimit`, nem `Retry-After`). Um limite por hora ou por dia **não foi medido**; não forcei mais numa conta partilhada | 300 pedidos a `documents/count` |

**O que isto muda no desenho:**

- **O balcão é legível**: as vendas do POS chegam com `terminal_id` e as
  linhas trazem artigo, referência e armazém. Separar «balcão» de «resto»
  faz-se pelo `terminal_id`, **não pela série**.
- **O stock do Moloni mexe sozinho com cada venda.** Se o Eurolify escrever
  também um movimento por cada venda do balcão, a venda conta duas vezes.
  O livro continua a ser do Eurolify (§5): o Eurolify **lê** a saída que o
  Moloni já fez e só escreve no Moloni as diferenças que nascem fora dele
  (ex.: a reserva da loja online). Proposta, por decidir com o desenho.
- **O `status` 2 tem de se perceber antes de contar vendas**: 71 faturas
  com ele não podem entrar como vendas sem saber se estão anuladas.
- **Apagar um artigo não apaga os movimentos dele**: na conta trial, depois
  de `products/delete` do artigo de teste, os dois movimentos continuam em
  `productStocks/getAll` sem artigo. Quem lê movimentos tem de aceitar um
  movimento sem artigo e não o casar por mais nada (`AGENTS.md`, «Não se
  erra…», regra 6).
- **E esses movimentos não se apagam pela API**: o `productStocks/delete`
  pede `product_stock_id`, que nos movimentos vem 0; com o
  `stock_movement_id` responde `valid: 0` (11/10/2026). Um movimento escrito
  por engano fica no Moloni: a correcção é um movimento ao contrário, nunca
  um apagar (o que, de resto, é a regra do livro do Eurolify).
- **O token vai sempre no endereço**: a regra de o tapar nos registos (§1)
  deixa de ser precaução e passa a obrigatória.

**O que ficou por verificar:** o significado do `status` 2; se os
terminais vistos são a app «Moloni POS»; limites por hora ou por dia; o nome
do filtro por dia do `productStocks/getAll` — o `date` que usei **não
limitou** (11 dias × 1000 movimentos = o tecto que pus); se os documentos da
demonstração têm validade fiscal.
