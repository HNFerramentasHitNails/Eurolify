# Checkout alojado — modelo e lista da API

> **Estado: desenho aprovado; parte 1 no código** (issue #273; migração
> 0041; `docs/06`, DA). Diogo, 09/10/2026: *«sim, avança com o desenho da
> fatia 7»* e *«sim, aprovo; avança com o código da fatia 7»* (Q1 a Q6 como
> propostas). O que está programado e os desvios dizem-se na §13. É a fatia 7 do
> [`eurolify/implementation-plan.md`](eurolify/implementation-plan.md)
> («Checkout alojado: total, condições, perfil de faturação, consentimentos
> por linha»). Depende das fatias 3 a 6, que estão no `main`: o Catálogo
> (`docs/14`), os Preços e mercados (`docs/20`), os Clientes (`docs/23`) e o
> Motor de IVA (`docs/24`). O checkout é alojado pelo Eurolify
> ([ADR-0039](adr/0039-checkout-alojado-pelo-eurolify.md), `docs/06`, BG).
>
> Skills seguidas, como manda o `AGENTS.md` para o checkout:
> `consumer-rights-eu` (preço total, informação antes do botão final, botão
> com obrigação de pagar, versões aceites, confirmação em suporte duradouro,
> livre resolução), `eu-vat-oss-ioss` (o cliente sabe no checkout se paga IVA;
> a decisão gravada no momento; «a fatura é para outra pessoa»),
> `payments-psd2-sca` (o checkout escolhe o método antes de sair para o
> prestador; o dinheiro nunca passa pelo Eurolify), `eu-gdpr-privacy` (base
> legal por finalidade, minimização, retenção dos checkouts abandonados) e
> `headless-commerce` (API da Loja, chave pública, idempotência, cêntimos,
> erros). Também `eurolify-design` (no checkout, o comerciante muda cores,
> letra e logótipo, nunca o conteúdo legal nem a ordem) e `platform-architect`
> (fronteiras).
>
> 🔴 **Regra deste domínio:** o checkout **não decide** preço, IVA,
> disponibilidade nem textos legais: pede-os aos domínios donos e **guarda a
> cópia** do que o cliente viu e aceitou. **Na dúvida, não vende:** uma linha
> que o Motor de IVA bloqueia, um texto legal em falta para a língua ou um
> mercado sem método de entrega param o checkout com o motivo, nunca uma
> encomenda à sorte.
>
> Marcas como no `docs/20`, `docs/23` e `docs/24`: **regra** (com fonte),
> **proposta** (minha, por decidir) e **pergunta** (§10). Regras legais com
> **W/M/C** como no `docs/03`; as **C** não chegam a uma encomenda real sem o
> jurista (a porta para produção do plano).

## 1. O que entra nesta fatia

| Entra | Fonte |
|---|---|
| **carrinho** pela API da Loja (chave pública da loja), com as linhas e o mercado | `headless-commerce`, «As duas APIs» (a API da Loja pode «gerir o próprio carrinho, iniciar o checkout alojado»); `docs/19` (chave `publica`, âmbitos `storefront`) |
| **sessão de checkout** alojada: contacto, morada de entrega, perfil de faturação e finalidade, método de entrega, resumo, botão final | ADR-0039, decisão 2 |
| **o total**: preço do mercado (`docs/20`), IVA por linha do Motor (`docs/24`), portes, com a cópia de tudo | `consumer-rights-eu`, «Antes da compra» (preço total com impostos e portes); `eu-vat-oss-ioss`, regras 2 e 3 |
| **textos legais com versões** por loja × país × língua: condições gerais, informação pré-contratual, política de privacidade, livre resolução, aviso da garantia legal | `consumer-rights-eu`, «Textos legais por país e por comerciante» |
| **aceitação** das condições com a versão, o momento e a encomenda | `consumer-rights-eu`, «Na compra» |
| **a encomenda criada pelo botão final**, no estado `a_aguardar_pagamento`, com a cópia das linhas, das decisões de IVA, dos preços, das versões aceites e do perfil | `consumer-rights-eu` (prova contratual); `docs/20` R11; `docs/23` §2 (a encomenda guarda o `bpf_` e a cópia) — **pergunta Q1** sobre quem é dono |
| **portes** simples por mercado: tarifas fixas por método de entrega, com gratuitidade acima de um valor | **pergunta Q2** (não há domínio de Envios desenhado) |
| **a confirmação da encomenda** como documento guardado (o que foi comprado, os preços, as condições aceites) | `consumer-rights-eu`, «Depois da compra» — o envio por e-mail é a **pergunta Q4** |

| Fica fora desta fatia | Porquê |
|---|---|
| o pagamento (intenção, prestador, avisos, conciliação) | fatia 8 (`payments-psd2-sca`); o checkout só **escolhe o método** e entrega a encomenda à fatia 8 |
| reserva de stock, expedição, estados da encomenda depois do pagamento | fatia 9 (`order-fulfilment`) — **pergunta Q3** sobre o stock |
| documento fiscal | fatia 10: nasce da cópia guardada aqui (`eu-vat-oss-ioss`, regra 2) |
| o botão de livre resolução e o pedido de devolução | fatia 11 (pós-venda); aqui só a informação antes da compra e a ligação na confirmação |
| contas de cliente com palavra-passe (área de cliente) | proposta: na Fase 1 o checkout é **sem conta**, com o e-mail (§3.3) |
| consentimentos de marketing no checkout | a régua única e o registo com prova existem desde a parte 2a dos Clientes (`docs/23` §3.6 e §12, migração 0042), mas a loja ainda não tem caminho para registar (a rota pede `customers:write`); **proposta**: nenhuma caixa de marketing até a caixa e esse caminho estarem desenhados |
| conteúdo e serviço digital, cartões-oferta | desligados (ADR-0034); o Motor de IVA já os bloqueia (`natureza_bloqueada`) |
| API de checkout para frontends próprios | Fase 3 (ADR-0039, decisão 3) |
| o checkout no domínio próprio de cada loja (certificados) | ADR-0039, «Consequências»: por desenhar — **pergunta Q5** |

## 2. Fronteira

| Dado | Dono | Como se liga |
|---|---|---|
| carrinho, sessão de checkout, aceitação, a cópia do que o cliente viu | **Checkout** | — |
| textos legais e as versões | **Checkout** (proposta: até haver um domínio de conteúdo legal) | a encomenda guarda o `lgv_` de cada versão aceite |
| artigo, variante, publicação por canal × mercado | **Catálogo** (`docs/14`) | o carrinho só aceita variantes **publicadas** no canal × mercado (a C2 já exige preço) |
| mercado, moeda, `preco_inclui_iva`, lista de preços, redução e preço de referência, preço por unidade | **Preços e mercados** (`docs/20`) | o checkout lê o preço no momento e guarda a cópia (R11 do `docs/20`) |
| decisão de IVA da linha (e dos portes) | **Motor de IVA** (`docs/24`) | a função `decidirIva`; a decisão e a evidência copiam-se para a linha |
| ficha, perfil de faturação, VIES, isenção manual | **Clientes** (`docs/23`) | o checkout cria ou reutiliza a ficha e o perfil pelo domínio Clientes, nunca escreve nas tabelas dele |
| métodos de pagamento por mercado; o pagamento | **Pagamentos** (fatia 8) | o checkout mostra os métodos activos e guarda o escolhido; a fatia 8 cria a intenção |
| métodos de entrega e tarifas | **Envios** (por desenhar) | **pergunta Q2** |
| encomenda depois do pagamento | **Encomendas** (fatia 9) | **pergunta Q1** |
| entidade legal que vende, loja, fuso | **Comerciante** (`docs/15`) | a identidade e os contactos do comerciante aparecem antes da compra (`consumer-rights-eu`) |

## 3. Modelo

Todas as tabelas com o comerciante e o **RLS forçado** (`docs/15` §5).
Montantes em cêntimos com a moeda (`headless-commerce`, regra 8). Prefixos
**proposta**.

### 3.1 Carrinho (`crt_`)

| Campo | Notas | Marca |
|---|---|---|
| `loja_id`, `canal_id`, `mercado_id` | o mercado decide-se pela escolha do visitante e, quando há, pelo **país de entrega**; **nunca pelo IP** | regra (`docs/20` R8; Reg. (UE) 2018/302, **C**) |
| `lingua` | uma das línguas do mercado | proposta |
| `estado` | `aberto`, `em_checkout`, `convertido`, `expirado` (§4.1) | proposta |
| `expira_em` | 30 dias sem mexer | proposta |
| `segredo` | o carrinho é de quem tem o identificador e o segredo (sem conta); o segredo guarda-se só como hash | proposta (`observability-security`) |
| `versao` | escrita optimista | proposta |

Sem dados pessoais no carrinho.

### 3.2 Linha do carrinho

| Campo | Notas | Marca |
|---|---|---|
| `variante_id`, `quantidade` | inteiro ≥ 1; respeita a quantidade mínima e o múltiplo da lista (`docs/20`) | regra (`docs/20`) |
| sem preço guardado | o preço calcula-se sempre que o carrinho se lê; só a encomenda guarda a cópia | regra (`docs/20` R1) |

### 3.3 Sessão de checkout (`chk_`)

Nasce de um carrinho (`POST /store/carts/{id}/checkout`) e vive no checkout
alojado. **Sem conta**: o cliente identifica-se pelo e-mail; a ficha
(`cus_`) só se cria no botão final.

| Campo | Notas | Marca |
|---|---|---|
| `carrinho_id` | a sessão congela as linhas do carrinho (o carrinho passa a `em_checkout`) | proposta |
| `email`, `nome`, `telefone` (opcional) | contacto para a confirmação; o telefone só se o método de entrega o pedir | regra (`eu-gdpr-privacy`, regra 2, minimização) |
| `entrega` | morada de entrega: país (ISO), código postal, linhas, localidade | regra (`docs/24`: o território decide-se pelo código postal da entrega) |
| `finalidade` | `consumo` (por omissão), `profissional`, `revenda` | regra (`consumer-rights-eu`, «por encomenda»; por omissão, consumidor) |
| `faturacao` | `particular` ou `empresa`; nome no documento; NIF (opcional no particular); morada fiscal; **«a fatura é para outra pessoa/empresa»** | regra (`eu-vat-oss-ioss`, «Perfis de faturação») |
| `metodo_entrega` | da lista do mercado (Q2) | proposta |
| `metodo_pagamento` | da lista do mercado (fatia 8) | regra (`payments-psd2-sca`: a escolha faz-se no checkout do Eurolify) |
| `estado` | `aberta`, `concluida`, `expirada`, `abandonada` (§4.2) | proposta |
| `expira_em` | 24 h sem mexer | proposta |
| `token` | o endereço da sessão; guarda-se só o hash | proposta |

### 3.4 Texto legal (`lgt_`) e versão (`lgv_`)

| Campo | Notas | Marca |
|---|---|---|
| `tipo` | `condicoes_gerais`, `informacao_pre_contratual`, `privacidade`, `livre_resolucao`, `garantia_legal` | regra (`consumer-rights-eu`: condições, livre resolução e excepções, garantia legal) |
| `pais`, `lingua`, `tipo_cliente` | modelos por país × língua × tipo de cliente | regra (`consumer-rights-eu`, «Textos legais») |
| versão: `texto`, `publicada_em`, `publicada_por` | **só se acrescenta**: mudança de texto ⇒ versão nova, nunca editar a antiga | regra (idem) |
| `validado_por_jurista` | sim/não, com nome e data; sem validação, a versão fica marcada **C** e a porta para produção não abre | regra (`consumer-rights-eu`, «Validação: jurista») |

O Eurolify dá **modelos** por omissão por país e língua; o comerciante
preenche os dados dele; o jurista dele valida (`consumer-rights-eu`). **Não
escrevo os textos dos modelos neste desenho:** ficam para o jurista
(**C**). Sem uma versão publicada de cada tipo para o país e a língua da
sessão, o checkout **não abre** (`checkout.legal_text_missing`).

### 3.5 Encomenda criada pelo botão final (`ord_`) — Q1

A encomenda nasce aqui no estado `a_aguardar_pagamento` e guarda, **copiado**:

| O quê | Porquê |
|---|---|
| cada linha: variante, quantidade, preço unitário, lista, redução e preço de referência, preço por unidade | `docs/20` R11 |
| cada linha: a **decisão de IVA** inteira (resultado, taxa, motivo, regra, versão das regras, evidência), base, IVA e total | `eu-vat-oss-ioss`, regras 2 e 3; `docs/24` §2 |
| os portes com a decisão de IVA deles | `consumer-rights-eu` (preço total com portes) |
| os totais (base, IVA por taxa, total) e a moeda | `consumer-rights-eu` |
| a finalidade, o `cus_`, o `bpf_` **e a cópia do perfil** (nome no documento, NIF, morada fiscal) | `docs/23` §2 e R4 |
| a morada de entrega | `order-fulfilment` |
| o `lgv_` de cada texto aceite, o momento e o texto do botão final | `consumer-rights-eu`, «Na compra» |
| o método de pagamento e o de entrega escolhidos | `payments-psd2-sca` |

Nada disto se recalcula depois: o documento fiscal nasce desta cópia
(`eu-vat-oss-ioss`, regra 2).

### 3.6 Portes (Q2) — se ficarem nesta fatia

| Campo | Notas | Marca |
|---|---|---|
| `metodo_entrega` (`shm_`) | por mercado: nome por língua, prazo indicado, se pede telefone | proposta |
| `tarifa` | montante fixo por encomenda; `gratis_a_partir_de` opcional | proposta |
| IVA dos portes | o Motor de IVA decide-os como uma linha; que taxa levam os portes de bens com taxas diferentes **não verifiquei — C** (pergunta nova ao contabilista, V12) | regra: «na dúvida, não vende» |

## 4. Estados

### 4.1 Carrinho

```
aberto → em_checkout → convertido
   │          │
   └→ expirado ← (sessão expirada devolve o carrinho a aberto)
```

### 4.2 Sessão de checkout

```
aberta → concluida   (botão final: cria a encomenda)
   ├→ expirada        (24 h sem mexer)
   └→ abandonada      (o cliente voltou à loja; o carrinho fica aberto)
```

### 4.3 Encomenda (só o que esta fatia cria)

`a_aguardar_pagamento` → (fatia 8) `paga` | `cancelada_sem_pagamento`. Os
estados seguintes são da fatia 9.

## 5. O percurso do cliente

| Passo | O que o servidor faz | Fonte |
|---|---|---|
| 1. Frontend → `POST /store/carts/{id}/checkout` | congela as linhas; confere que cada variante continua publicada e com preço; devolve o endereço do checkout alojado | ADR-0039, decisão 1 |
| 2. Contacto e entrega | o país de entrega pode **mudar o mercado** (R8 do `docs/20`); se o mercado mudar, as linhas recalculam-se e o cliente vê-o | `docs/20` R8 |
| 3. Faturação e finalidade | «Compro como: particular / empresa (profissional ou revenda)»; NIF com a régua dos Clientes; **«a fatura é para outra pessoa/empresa»**; se profissional de outro país da UE, o VIES do perfil (o Motor bloqueia `b2b_sem_vies` e o cliente pode passar a consumidor) | `eu-vat-oss-ioss`; `docs/24` (P1-3 da revisão do #256) |
| 4. Entrega e pagamento | métodos do mercado; portes | Q2; fatia 8 |
| 5. Resumo, **imediatamente antes do botão final** | as características principais de cada linha, o **preço total** com IVA e portes, o IVA de cada linha, os prazos de entrega, a identidade do comerciante, a informação sobre a livre resolução e as excepções, o aviso da garantia legal, o selo de durabilidade quando o produtor o dá | `consumer-rights-eu`, «Na compra» (art. 8.º, n.º 2, e art. 6.º, n.º 1, da Dir. 2011/83/UE, **W · texto lido** segundo a skill) |
| 6. Aceitação | caixa das condições gerais (não marcada) com a ligação à versão; a política de privacidade **informa**, não se «aceita» (a base é o contrato, não o consentimento) | `consumer-rights-eu`; `eu-gdpr-privacy`, regra 1 |
| 7. **Botão final** | texto inequívoco de obrigação de pagar por língua (pt: «Encomendar com obrigação de pagar» — **C**, confirmar por língua); recalcula tudo: **se algum montante mudou desde o passo 5, não cria a encomenda** e volta ao resumo com o que mudou | `consumer-rights-eu`; `eu-vat-oss-ioss`, regra 3 |
| 8. Encomenda | cria a ficha e o perfil (ou reutiliza pelo identificador do perfil, **nunca pelo nome**), a encomenda `a_aguardar_pagamento` com as cópias, e entrega à fatia 8 | `AGENTS.md`, fiscal, regra 6 |
| 9. Confirmação | o documento de confirmação (§3.5 em forma legível) fica guardado na encomenda e disponível por ligação; o envio em suporte duradouro é a Q4 | `consumer-rights-eu`, «Depois da compra» |

## 6. Regras

| # | Regra | Fonte |
|---|---|---|
| R1 | O checkout não calcula preço nem IVA: pede-os aos domínios donos e guarda a cópia | `AGENTS.md`, «Uma regra, um sítio» |
| R2 | Uma linha bloqueada pelo Motor de IVA bloqueia o checkout, com o motivo dito ao cliente em linguagem simples (sem códigos internos) | `docs/24`; `eu-vat-oss-ioss`, «Regra zero» |
| R3 | O total que o cliente viu no resumo é o que fica na encomenda; se mudou, volta ao resumo | `eu-vat-oss-ioss`, regra 3; `consumer-rights-eu` |
| R4 | Por omissão, o comprador é consumidor; «profissional» é uma escolha explícita por encomenda; ter NIF não basta | `consumer-rights-eu`, «Consumidor ou profissional» |
| R5 | Cada texto aceite guarda-se pela versão (`lgv_`), com o momento; nunca se edita uma versão publicada | `consumer-rights-eu`, «Textos legais» |
| R6 | Sem versão publicada de um texto legal para o país e a língua, o checkout não abre | proposta («na dúvida, não vende») |
| R7 | O botão final e a informação imediatamente antes dele são servidos pelo Eurolify, na ordem fixa; o tema só muda cores, letra e logótipo | `eurolify-design`; ADR-0039 |
| R8 | A identidade do cliente nunca se decide pelo nome; uma ficha existente só se reutiliza por um identificador que o cliente prova ter (Fase 1: nenhum — cada checkout sem conta cria ficha nova, e os duplicados tratam-se na parte 2 dos Clientes) | `AGENTS.md`, fiscal, regra 6; `docs/23` §3.7 |
| R9 | Nenhuma caixa de marketing pré-marcada; na Fase 1, nenhuma caixa de marketing (parte 2 dos Clientes) | `eu-gdpr-privacy`, regras 3 a 5 |
| R10 | Não se recusa a loja nem se mudam condições por nacionalidade ou residência dentro da UE; não obriga a entregar em todo o lado | Reg. (UE) 2018/302 (**C**, `consumer-rights-eu`, «Geobloqueio») |
| R11 | O mercado nunca se decide pelo IP | `docs/20` R8 |
| R12 | Escritas com `Idempotency-Key`; o botão final repetido não cria duas encomendas | `headless-commerce`, regra 5 |
| R13 | Um checkout abandonado não serve para marketing sem consentimento | `eu-gdpr-privacy`, regra 1 |

## 7. Dados pessoais

| Tratamento | Base legal | Retenção (proposta) | Papel |
|---|---|---|---|
| contacto, entrega e faturação de uma encomenda | execução do contrato; obrigação legal (fiscal) | a da encomenda e do documento fiscal (10 anos civis no documento em PT — `eu-gdpr-privacy`, «Retenção») | Eurolify subcontratante do comerciante |
| sessão de checkout que não chegou a encomenda | diligências pré-contratuais a pedido do titular (**C**, jurista) | apagar os dados pessoais da sessão **7 dias** depois de expirada ou abandonada | idem |
| carrinho | — (sem dados pessoais) | 30 dias sem mexer | idem |

Entra no registo de tratamentos (`docs/17`) e na exportação do titular. Nos
registos técnicos, só identificadores (`eu-gdpr-privacy`, regra 7).

## 8. Lista da API

### 8.1 API da Loja (chave pública da loja; âmbitos `storefront`)

| Operação | Método e caminho | Notas |
|---|---|---|
| Criar carrinho | `POST /store/carts` | `mercado`, `canal`, `lingua`; devolve o `crt_` e o segredo |
| Ver carrinho | `GET /store/carts/{id}` | linhas com o preço **a mostrar** (do `docs/20` §7.2, com o IVA do mercado por omissão) e o total provisório, marcado como provisório até haver morada |
| Linhas | `POST /store/carts/{id}/lines`, `PATCH …/lines/{linha}`, `DELETE …/lines/{linha}` | só variantes publicadas no canal × mercado; quantidade mínima e múltiplo |
| Iniciar checkout | `POST /store/carts/{id}/checkout` | devolve o endereço do checkout alojado (`chk_`) |

### 8.2 Checkout alojado (servido pelo Eurolify; sessão pelo token)

| Operação | Método e caminho | Notas |
|---|---|---|
| Página | `GET /checkout/{token}` | HTML do servidor, com o tema da loja |
| Contacto e entrega | `PUT /checkout/{token}/contact`, `PUT …/delivery` | o país pode mudar o mercado (§5, passo 2) |
| Faturação | `PUT /checkout/{token}/billing` | finalidade, tipo, NIF, «a fatura é para outra pessoa» |
| Métodos | `PUT /checkout/{token}/delivery-method`, `PUT …/payment-method` | da lista do mercado |
| Resumo | `GET /checkout/{token}/summary` | o total, o IVA por linha e por taxa, a informação pré-contratual com as versões dos textos |
| Botão final | `POST /checkout/{token}/place` | `Idempotency-Key`; as versões aceites; recalcula e recusa com `checkout.total_changed` se mudou; cria a `ord_` |
| Confirmação | `GET /checkout/{token}/confirmation` | o documento de confirmação |

### 8.3 API de Administração

| Operação | Método e caminho | Âmbito |
|---|---|---|
| Textos legais | `GET /legal-texts`, `POST /legal-texts`, `POST /legal-texts/{id}/versions`, `POST /legal-texts/{id}/versions/{v}/publish` | `legal:read` / `legal:write` (dono) — proposta |
| Métodos de entrega e tarifas (Q2) | `GET/POST/PATCH /shipping-methods` | `shipping:read` / `shipping:write` — proposta |
| Checkouts abertos e abandonados | `GET /checkouts?estado=` | `orders:read` — proposta |
| Encomendas criadas | `GET /orders`, `GET /orders/{id}` (só leitura nesta fatia) | `orders:read` — proposta |

### 8.4 Erros (novos)

`checkout.legal_text_missing`, `checkout.vat_blocked` (com o motivo do Motor),
`checkout.total_changed`, `checkout.variant_unavailable`,
`checkout.no_delivery_method`, `checkout.expired`, `cart.min_quantity`,
`cart.limit_reached` (429, com `Retry-After`: a loja está no tecto de carrinhos
com linhas e este endereço já criou muitos; §14).

### 8.5 Eventos

| Evento | Quando |
|---|---|
| `checkout.started` | sessão criada |
| `order.created` | botão final (encomenda `a_aguardar_pagamento`) — `order-fulfilment` |
| `legal_text.published` | versão nova publicada |

## 9. Por onde é que isto ainda pode sair errado

| Risco | O que o evita |
|---|---|
| O cliente paga um total diferente do que viu | R3: recálculo no botão final; se mudou, volta ao resumo |
| Um frontend mostra um preço e o checkout outro | R1; o frontend só redirecciona (ADR-0039) |
| Um consumidor com NIF compra sem IVA | R4; o Motor só isenta com finalidade profissional **e** VIES válido (`docs/24`) |
| Uma encomenda sem a versão das condições | R5; o botão final recusa sem as versões |
| Um texto legal mudado depois de aceite | R5: só se acrescenta |
| Duas encomendas por um duplo clique | R12 |
| Vender sem stock | **Q3** |
| Dados pessoais de checkouts abandonados guardados para sempre | §7: 7 dias |
| A confirmação não chega ao cliente | **Q4**; sem envio, a porta para produção não abre |
| Uma isenção errada | é do Motor de IVA (`docs/24`); o checkout só mostra e copia |

## 10. Perguntas para o Diogo ou o Bruno

| # | Pergunta | Proposta |
|---|---|---|
| Q1 | **Quem cria a encomenda?** A fatia 9 (Encomendas) ainda não existe, mas o botão final tem de criar alguma coisa com as cópias | o checkout cria o **núcleo da encomenda** (`ord_`, estado `a_aguardar_pagamento`, linhas e cópias, §3.5) numa tabela do domínio Encomendas; a fatia 9 acrescenta os estados seguintes, o stock e a expedição |
| Q2 | **Portes:** não há domínio de Envios desenhado | nesta fatia, **métodos de entrega por mercado com tarifa fixa** e gratuitidade acima de um valor (§3.6); as transportadoras e as etiquetas ficam para a fatia 9 |
| Q3 | **Stock:** a reserva é da fatia 9 | nesta fatia **não se confere stock**; até à fatia 9 o checkout não sai do ensaio (já não sai sem a fatia 8) |
| Q4 | **Confirmação em suporte duradouro:** precisa de envio de e-mail, e não há fornecedor escolhido | nesta fatia, gerar e guardar o documento de confirmação e mostrá-lo no fim do checkout; o **envio por e-mail** fica para a fatia de Notificações, com um fornecedor na UE escolhido por vocês; **sem envio, a porta para produção não abre** |
| Q5 | **Endereço do checkout:** o domínio da loja precisa de certificados por comerciante | na Fase 1, `https://checkout.eurolify.eu/{loja}/…`; o domínio próprio de cada loja depois |
| Q6 | **Checkout sem conta** na Fase 1 (só e-mail), cada compra com ficha nova | sim; contas de cliente e fusão de duplicados com a parte 2 dos Clientes |

## 11. Para o jurista e o contabilista (bloqueiam a produção, não o código)

| # | Pergunta | Quem |
|---|---|---|
| J1 | Os textos dos modelos por país e língua (condições gerais, informação pré-contratual, livre resolução e excepções — cosmética selada, `consumer-rights-eu` —, garantia legal) | jurista |
| J2 | O texto do botão final em cada língua | jurista |
| J3 | O prazo e a forma da confirmação em suporte duradouro | jurista |
| J4 | A base legal para guardar 7 dias uma sessão abandonada | jurista / encarregado de protecção de dados |
| V12 | A taxa de IVA dos portes numa encomenda com bens de taxas diferentes | contabilista |

## 12. Como entra no código (quando aprovado)

| Parte | O quê |
|---|---|
| 1 | migração: carrinho, sessão de checkout, textos legais e versões, núcleo da encomenda (Q1), métodos de entrega (Q2); âmbitos; API da Loja do carrinho e API de Administração dos textos legais |
| 2 | o checkout alojado: páginas do servidor, o percurso da §5, o resumo e o botão final, a confirmação guardada |
| 3 | os testes de ponta a ponta no ensaio: um consumidor em Lisboa, uma empresa francesa com VIES, um checkout bloqueado pelo Motor, um total que muda entre o resumo e o botão final, um duplo clique |

## 13. Em código — parte 1 (09/10/2026; migração 0041; `docs/06`, DA)

| O quê | Onde |
|---|---|
| tabelas `texto_legal` e `versao_texto_legal` (só se acrescenta; publicada não muda), `metodo_entrega` (Q2), `carrinho`, `linha_carrinho`, `sessao_checkout`, `encomenda` e `linha_encomenda` (Q1: as cópias não mudam, só o estado para a frente), todas com o RLS forçado | migração 0041 |
| eventos `checkout.started`, `order.created`, `legal_text.published`, pelos gatilhos | migração 0041 |
| âmbitos `legal:read`, `legal:write`, `shipping:read`, `shipping:write`, `orders:read`, nos papéis (o armazém sem `orders:read`: a encomenda traz o perfil de faturação; a vista do que expedir vem com a expedição) | migração 0041; `src/identidade/` |
| o preço para vender (lista de base activa, redução em vigor, preço por unidade) | `src/precos/repositorio.ts`, `precosParaVenda` |
| o carrinho pela API da Loja (chave pública da loja e o segredo do carrinho em `X-Cart-Secret`), o checkout alojado pelo token (JSON) e a Administração dos textos legais, métodos de entrega, checkouts e encomendas — a lista da §8 | `src/checkout/` |
| o resumo e o botão final (§5): o preço, o IVA de cada linha e dos portes pelo Motor de IVA, os textos a aceitar, o que falta e o que bloqueia; recálculo no botão final e recusa se mudou (R3); as versões aceites têm de ser as do resumo (R5); a ficha, o perfil e a encomenda com a cópia | `src/checkout/repositorio.ts` |
| 21 testes pela API (o percurso inteiro com o IVA e os portes, o total que muda, as condições, os textos em falta, a Madeira bloqueada pelo Motor, portes grátis, quantidade mínima, país não servido, profissional sem NIF, o carrinho e as chaves entre lojas e comerciantes, a sessão expirada e abandonada, o que não se vende; e, da revisão: o segredo que não se repete, dois cliques em paralelo, categorias misturadas, o telefone pedido, a leitura dos textos, a confirmação aos 30 dias, a base a garantir os totais, o token fora dos registos, o limite por IP da loja, a mudança de mercado pelo país); 22 mutações na parte 1, 20 apanhadas e 2 equivalentes (a base recusa igual), mais 7 nas correcções da revisão, todas apanhadas | `test/checkout-api.test.ts` |

**Desvios do desenho:**
- **Só artigos físicos** se vendem nesta fatia: a natureza para o IVA ainda
  não está no artigo (`docs/24` §13), e um físico é um bem (`docs/24`
  §3.2). Serviços, bilhetes e o resto ficam `checkout.variant_unavailable`
  até ela existir (na dúvida, não vende).
- **O token da sessão** vive numa tabela interna (`token_checkout`, RLS sem
  forçar, como a `chave_api` da 0010): as tabelas com o RLS forçado não se
  lêem sem comerciante, nem pela função do dono.
- **O botão final é idempotente pela sessão**, não pela `Idempotency-Key`
  (o checkout alojado não tem chave): repetir numa sessão concluída devolve
  a mesma encomenda.
- **O método de pagamento** é um código livre (`^[a-z_]{2,40}$`) até a
  fatia 8 dizer os métodos de cada mercado.
- **Textos a aceitar** (proposta): o consumidor aceita os cinco tipos; o
  profissional, as condições gerais e a privacidade.
- **O texto do botão final** só existe em português e inglês (**C**, J2);
  noutra língua não há botão.
- **O checkout alojado é JSON nesta parte**; as páginas do servidor com o
  tema da loja são a parte 2. O caminho devolvido é `/checkout/{token}`; o
  domínio (`checkout.eurolify.eu`, Q5) é configuração da publicação.
- **O total do carrinho** na API da Loja é provisório e sem o IVA decidido
  (só a soma dos preços); o IVA e os portes decidem-se no checkout, com a
  morada.
- **Um profissional de outro país da UE** fica bloqueado (`b2b_sem_vies`):
  o checkout sem conta não tem perfil com VIES. Pode comprar como
  consumidor.
- **Por fazer na parte 2:** as páginas do checkout, a limpeza dos carrinhos
  expirados (**feita**, §14) e o envio da confirmação (Q4, com o fornecedor de e-mail). Os
  dados das sessões já se limpam: ao criar a encomenda e 7 dias depois de a
  sessão expirar ou ser abandonada (`docs/23` §15.4 e §15.10, migração
  0077).

**Correcções da revisão do #276** (agente, Sonnet 5.5; 09/10/2026):
- **O segredo do carrinho e o token** não ficam na tabela da idempotência;
  repetir o pedido com a mesma chave dá `idempotency.secret_not_repeated`
  (como as chaves de API).
- **O R3 compara com o que o cliente viu:** o resumo devolve a `impressao`
  (SHA-256 do total, das linhas, dos portes e das versões) e o botão final
  tem de a trazer; outro resumo pedido entretanto não conta. O resumo já
  não escreve na base.
- **O token sai dos registos** (`/checkout/[token]`); **a confirmação pelo
  token só nos 30 dias** depois da encomenda (proposta, **C**).
- **Limite por IP nas rotas da loja e do checkout:** 300 pedidos por minuto
  (proposta). Falta um limite por chave e um tecto de carrinhos abertos.
- **Os portes:** o IVA dos portes segue a categoria das linhas quando é uma
  só. Com categorias diferentes, o checkout bloqueia
  (`portes_categorias_misturadas`) até a V12 do contabilista dizer a regra.
- **Os textos aceites lêem-se:** pelo cliente em
  `GET /checkout/{token}/legal/{versao}` (só as versões do resumo dele) e
  pelo comerciante em `GET /legal-texts/{id}/versions/{versao}`. O resumo
  SHA-256 de cada texto fica na encomenda (`aceitacoes`), e a hora da
  aceitação vem do relógio da base.
- **A base garante a encomenda:** as linhas só entram na transacção que a
  cria; no fim dela, a soma das linhas mais os portes tem de dar os totais.
  As chaves estrangeiras prendem a loja da sessão ao carrinho, o perfil ao
  cliente e o método de entrega ao mercado da sessão.
- **A ordem dos bloqueios** é sempre carrinho e depois sessão, e a expiração
  conta pelo relógio da base. O telefone pedido pelo método de entrega entra
  no que falta.

**Portas abertas da revisão** (nenhum dado real entra antes delas; ADR-0019):
- **P2-6, o portão de produção.** Hoje o checkout aceita as decisões de IVA
  por verificar e os textos sem validação do jurista (**C**); só há o
  ensaio. Antes do primeiro cliente real, um portão por ambiente tem de
  recusar `evidencia.verificado=false` e `validado_por_jurista=false`.
- **P2-3, a retenção.** Os gatilhos não deixam apagar nem anonimizar a sessão
  e a encomenda. Antes de dados reais é preciso uma função auditada que
  anonimize o que passou o prazo, e também as fichas de cliente órfãs
  (P3-10).
- **P3-7, o arredondamento.** O IVA arredonda-se por linha. O documento
  fiscal (fatia futura) tem de dizer como agrupa por taxa sem mudar o total
  pago.
- **P3-8:** os motivos de bloqueio do IVA saem com o código interno, e as
  respostas 200 ainda não descrevem o contrato. Fica para a parte 2, com as
  páginas.
- **P3-9:** o NIF só se valida no botão final; validá-lo já em `/billing`
  fica para a parte 2.
- **P3-4 já estava garantido:** um país só pode estar num mercado activo da
  loja (migração 0017), por isso a escolha do mercado pelo país não é
  ambígua.

## 14. Limpeza dos carrinhos e tecto (parte 2; issue #479; migração 0109)

Fecha dois pontos que a §13 deixou abertos: «a limpeza dos carrinhos
expirados» e, da revisão do #276, a P2-9 («falta um limite por chave e um
tecto de carrinhos abertos»). Nenhuma regra fiscal ou legal nova: é higiene
e defesa. Os números abaixo são **valores nossos, a medir** (`docs/18` §6:
nenhum número é decisão); mudam-se numa constante, não numa regra.

**Princípio (revisão do #482): uma protecção contra abuso nunca fecha a loja
aos clientes dela.** A chave pública está no browser e qualquer pessoa a lê;
por isso nenhum contador é partilhado por todos os visitantes e, no tecto,
só se recusa o endereço que está a abusar.

**A vida do carrinho.**
- Um carrinho **sem linhas** expira em **24 h** (por omissão na base, 0109).
- Ao pôr uma linha passa a **30 dias desde essa mudança** (cada linha posta ou
  mudada renova os 30 dias; resolve também o «30 dias sem mexer» do §3.1, que
  antes contava desde a criação); se tirar a última, volta às 24 h.
- Os carrinhos que já existiam antes da 0109 ficam como estão (30 dias desde a
  criação): o RLS forçado impede o dono de os alterar sem contexto e ainda não
  há dados reais (ADR-0019). Não contam para o tecto se não tiverem linhas.

**O que se apaga e quando.** Um carrinho só se apaga se, ao mesmo tempo:
1. está `aberto` (nunca `em_checkout` nem `convertido`; o estado `expirado`
   existe no desenho mas **nenhum código o escreve**, o prazo conta-se pelo
   relógio: se um dia for escrito, a limpeza não lhe toca e não falha);
2. expirou há mais de **7 dias** (`expira_em`; a folga evita a corrida com
   quem ainda o está a usar no limite do prazo);
3. **nunca teve uma sessão de checkout**, seja qual for o estado dela. A
   sessão aponta para o carrinho (chave estrangeira sem cascata, 0041) e as
   sessões não se apagam (P2-3): é a própria base que recusa apagar o que uma
   sessão ou uma encomenda ainda liga.

**Rede temporária, com data de fim.** Os carrinhos que chegaram a ter sessão
**ficam** (sem dados pessoais: a sessão perde-os aos 7 dias, 0077) até a
função de retenção da P2-3 existir. A P2-3 tem de estar feita **antes de
qualquer dado real e, o mais tardar, a 31/03/2027** (fim do ensaio, ADR-0019;
data proposta aqui, a confirmar pelo Diogo ou pelo Bruno), e passa a tratar
também estes carrinhos.

Apagam-se as linhas do carrinho com ele (cascata da 0041). Em lotes de 500 por
comerciante, até 20 lotes por volta, como a limpeza das sessões.

**Quando corre.** Na **mesma volta horária** da limpeza das sessões
(`checkout/limpeza-sessoes.ts`, já agendada no arranque): não há agendamento
novo nem se mexe no arranque da API. A volta devolve também `carrinhos`; os
registos dizem «checkout: carrinhos expirados apagados» e, se falhar,
«checkout: a limpeza das sessões falhou» ou «checkout: a limpeza dos carrinhos
falhou» (cada falha traz a `tarefa`). A função é do dono da base
(`SECURITY DEFINER`), só apaga no comerciante do contexto e a API não ganha
`DELETE` sobre o carrinho.

**Dados pessoais.** O carrinho não tem e-mail, nome nem morada (§3.1, §7);
tem o segredo só em resumo SHA-256. O IP de quem pede só serve de chave dos
contadores em memória e nunca se regista nem se guarda. O e-mail da sessão não
se toca aqui (migração 0077).

**Isolamento entre comerciantes.** A função exige o comerciante do contexto
(RLS forçada da 0041) e filtra por ele; a volta percorre, um a um, os
comerciantes com chave pública (`chave_api`, a única porta que cria
carrinhos), e um que falhe não pára os outros. O tecto e os limites contam por
loja.

**O tecto e os limites (P2-9) e o efeito de cada um.**

| Protecção | Valor (nosso, a medir) | Efeito quando se atinge |
|---|---|---|
| Carrinhos novos (`POST /store/carts`) por **IP e por loja** | 20 por minuto | só esse IP recebe 429 `rate_limit.exceeded` com `Retry-After`; os outros visitantes e a outra chave da loja não notam (o contador é por IP e loja, não por chave) |
| Tecto de carrinhos **com linhas**, abertos e não expirados, por loja | 20 000 | a loja **continua a vender**; regista-se o alarme `checkout.cart_ceiling` (1 por hora e loja) e só se recusa o IP que já criou mais de 15 carrinhos nessa loja na última hora (429 `cart.limit_reached` com `Retry-After`) |

Os carrinhos sem linhas não contam para o tecto (valem 24 h e são limitados
pelo contador por IP). Não há contador por chave partilhado: um que valesse
para toda a loja deixava um só IP, ou poucos, gastá-lo e fechar a loja. O
limite geral por IP do `app.ts` (300 pedidos por minuto) continua a valer para
todas as rotas da loja e do checkout alojado e conta tudo, incluindo leituras
(não verifiquei se há outras rotas do âmbito `storefront` fora do checkout).

**O alarme.** Hoje é um registo estruturado da API
(`{evento: "checkout.cart_ceiling", loja, carrinhos}` com a mensagem «checkout:
a loja chegou ao tecto de carrinhos com linhas»). **Falta:** a verificação
diária da VPS (`infra/vps/ficheiros/sbin/eurolify-verificacao`) ler este
evento; as outras verificações lêem funções da base com o papel de limpeza, e
o carrinho tem RLS forçada, por isso exige função e permissão novas
(`infra/vps` e `preparar.sh`), que não entram neste pedido. Até lá, o alarme só
se vê nos registos da API (`docker logs eurolify-api`).

**Por onde é que isto ainda pode sair errado.**
- Os contadores estão em memória: com mais de uma instância da API, o limite
  real é o número de instâncias vezes o valor. Hoje é uma VPS, uma API. Ao
  reiniciar a API, voltam a zero.
- Um IP partilhado (escritório, rede móvel) conta como um só: 20 carrinhos
  novos por minuto nessa loja chegam a um uso normal, mas é um palpite a medir.
- Quem tem muitos IPs (rede de máquinas) passa o contador por IP: enche o
  tecto, o alarme dispara e **a loja não fecha**, mas a base cresce até alguém
  agir (apagar à mão, bloquear os IP no proxy). Nada disto é automático.
- Acima do tecto, um cliente verdadeiro que já criou mais de 15 carrinhos na
  última hora nessa loja também espera (improvável; o alarme avisa antes).
- O tecto conta até 20 000 linhas com `LIMIT` e índice
  `(comerciante, loja, expira_em)`; o custo com a loja cheia não foi medido.
- Um carrinho expirado há menos de 7 dias não conta para o tecto mas ainda
  ocupa a base até à limpeza.
- A volta horária falhada deixa acumular; a falha fica nos registos, sem
  alarme na VPS (como o do tecto).
- Os carrinhos que chegaram a ter sessão não se apagam até à P2-3 (acima).

**Não verifiquei:** a carga real (quantos carrinhos com linhas tem uma loja
normal; os números são palpites a medir); o tempo da volta com milhões de
carrinhos; duas instâncias da API a limpar ao mesmo tempo (o `SKIP LOCKED`
deve bastar, só testado com ligações em bloqueio); o ramo
`merchant.context_required` da função, que não se alcança (sem contexto o
`comerciante_actual()` falha antes, no cast para uuid).
