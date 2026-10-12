# Domínio Preços e mercados — modelo e lista da API

> **Estado: desenho aprovado** (Diogo, 06/10/2026: *«sim, aprovo; junta o
> #129 e começa o código»*); as seis perguntas da §9 decididas (BS a BX do
> `docs/06`); as marcadas **proposta** passam a regra deste desenho (issue
> #127). É o passo 4
> do [`eurolify/implementation-plan.md`](eurolify/implementation-plan.md) e é
> preciso antes da parte 4 do Catálogo (#77): a publicação por canal × mercado
> e a verificação «pode publicar?» (C2 do [`docs/14`](14-dominio-catalogo.md)
> §5). Com o desenho aprovado e as perguntas da §9 decididas, o código deste
> domínio pode começar (`AGENTS.md`, ponto 3; ADR-0023).
>
> Skills seguidas: `eu-localization` (mercado, moedas, línguas, montantes),
> `consumer-rights-eu` (preço total, preço por unidade, redução com o preço
> mais baixo dos 30 dias, preço personalizado), `eu-vat-oss-ioss` (o IVA é do
> Motor de IVA, não daqui; arredondamentos), `catalog-pim` (nada a 0,00 € sem
> ser gratuito; publicação por canal × mercado), `eurolify-b2b-channels-eu`
> (listas B2B por etiqueta na Fase 1), `platform-architect` (fronteiras e
> eventos) e `headless-commerce` (dinheiro em cêntimos, idempotência, erros).
> Arquitectura: [`02-arquitectura.md`](02-arquitectura.md) §3 (Preços e
> mercados: listas de preços, mercados e canais, histórico de 30 dias,
> promoções, quantidades mínimas, preços B2B por etiqueta; eventos
> `price.changed` e `promotion.started`).
>
> Marcas de cada linha, como no `docs/14`: **regra** (vem de uma skill, de um
> documento ou de um ADR, com a fonte); **proposta** (desenho deste documento,
> decide-se ao aprovar); **pergunta** (está na §9, não se programa sem
> resposta). Regras legais com **W/M/C** como no
> [`03-regulamentar-ue.md`](03-regulamentar-ue.md); as **C** não chegam a um
> ecrã sem verificação ou validação profissional.

## 1. O que entra na Fase 1

| Entra | Fonte |
|---|---|
| **mercado** (países + moeda + línguas) e **canal**, de cada loja | `docs/02` §3; `docs/14` §9, P1 (decidido: canal e mercado são deste domínio); `docs/15` §2 (mercados, moedas e listas de preços de cada loja) |
| **lista de preços** de cada mercado (a de base) e **listas B2B por etiqueta** | `docs/05`, Fase 1 («listas de preços B2B por etiqueta»); Diogo, 05/10/2026 (*«Fase 2, só as listas B2B ficam na Fase 1»*, Q3 do `docs/16`) |
| **preço** por variante e lista, em cêntimos e com moeda; **gratuito** explícito | `headless-commerce`, regra 8; `catalog-pim`, regra 2 |
| **quantidades mínimas** (e múltiplos) por variante e lista | `docs/05`, Fase 1 |
| **histórico de preços** imutável e o **preço de referência** de uma redução (o mais baixo dos 30 dias anteriores) | `docs/05`, Fase 1; `consumer-rights-eu`; `docs/03` linha 65 (**C**) |
| **preço por unidade** calculado no servidor | `consumer-rights-eu`; `docs/03` linha 66 (**W** · texto lido) |
| a pergunta da C2: «há preço neste mercado, e não é 0,00 € sem ser gratuito?» | `docs/14` §5, C2; `catalog-pim`, regra 2 |

| Fica fora da Fase 1 (ou por decidir) | Porquê |
|---|---|
| códigos de desconto, regras de carrinho («leve 3 pague 2») | **decidido: ficam para depois**, com o domínio Carrinho; na Fase 1 só a redução anunciada (§3.6) (Diogo, 06/10/2026; §9, Q3; `docs/06`, BU) |
| conversão automática de moeda entre mercados | **decidido: sem conversão na Fase 1** (Diogo, 06/10/2026; §9, Q2; `docs/06`, BT); quando entrar, guarda a taxa, a fonte e a data de cada conversão (`eu-localization`) |
| preço de compra e preço recomendado de revenda, listas por relação comercial (distribuidor, revendedor, franchisado) | Fase 2 (`docs/eurolify/architecture.md` §3; Diogo, 05/10/2026) |
| preço na loja física (POS) | Fase 2 (`docs/05`) |
| preços personalizados por decisão automatizada | o Eurolify não personaliza por omissão (`consumer-rights-eu`); se uma extensão o fizer, o aviso vem do servidor (§5, R9) |

## 2. Fronteira — o que é deste domínio e o que não é

| Dado | Dono | Como se liga |
|---|---|---|
| mercado, canal, lista de preços, preço, histórico, quantidades mínimas, redução anunciada | **Preços e mercados** | — |
| loja (`sto_`), comerciante (`mer_`), língua de origem do catálogo | **Comerciante** (`docs/15`) | o mercado e o canal pertencem a uma loja; as línguas do mercado contam com a língua de origem do comerciante |
| artigo, variante, quantidade e unidade do conteúdo, publicação | **Catálogo** (`docs/14`) | o preço é de uma variante; a publicação guarda o `canal_id` e o `mercado_id` e pergunta a C2 a este domínio |
| IVA: taxa, se o preço mostrado o inclui, totais, arredondamento do documento | **Motor de IVA** (`eu-vat-oss-ioss`; `docs/02`: Preços «precisa de: imposto») | este domínio guarda o preço **como o comerciante o escreveu** (com ou sem IVA, §3.3) e pede ao Motor de IVA o valor a mostrar; **nunca calcula IVA** |
| etiqueta do cliente (para as listas B2B), se compra como profissional | **Clientes e identidade fiscal** (`docs/02`) | a lista B2B aponta para uma etiqueta pelo identificador; quem tem a etiqueta, e em que encomenda, é de lá |
| métodos de pagamento e de entrega por mercado, textos legais por país | **Pagamentos**, **Envios**, consumidor (`eu-localization`, «Mercado») | ligam-se ao mercado pelo identificador; não vivem aqui |
| carrinho, quantidade pedida, preço congelado na encomenda | **Carrinho** e **Encomendas** | pedem o preço a este domínio e guardam a cópia que o cliente viu |

## 3. Modelo — entidades e campos

Montantes em **cêntimos (inteiro) + moeda ISO 4217**, nunca vírgula flutuante
(`headless-commerce`, regra 8; `eu-localization`). Datas em UTC. Todas as
tabelas com o comerciante e o RLS forçado, como as do Catálogo (`docs/15` §5,
regra).

### 3.1 Mercado (`mkt_`)

A unidade de venda de uma loja (`eu-localization`, «Mercado»: país ou grupo de
países + moeda + línguas + lista de preços + pagamentos + entregas + textos
legais + registos fiscais). Os quatro últimos são de outros domínios e ligam-se
ao mercado (§2).

| Campo | Tipo / valores | Obrigatório | Regra e fonte |
|---|---|---|---|
| `id`, `loja_id` | | sim | um mercado é de uma loja (`docs/15` §2) |
| `nome` | texto (1–100) | sim | para o Hub; ex.: «Portugal», «Espanha e Portugal» (**proposta**) |
| `paises` | lista de códigos ISO 3166-1 alfa-2 | sim, de 1 a 50, sem repetidos | **país em código ISO em todo o lado** (`eu-localization`); a base confere só o formato, não se o país existe nem se é da UE (**C**, por verificar). Numa loja, **um país só está num mercado activo** (decidido, Diogo, 06/10/2026; §9, Q4; `docs/06`, BV) |
| `moeda` | código ISO 4217 | sim | uma moeda por mercado (**proposta**); que moedas usa cada país da UE: **não verifiquei — C** |
| `linguas` | lista de códigos de duas letras | sim, de 1 a 30, sem repetidas | línguas por mercado (`eu-localization`); a lista de cada mercado deixa de esperar por este domínio (`docs/14` §3.8, «as línguas de cada mercado») |
| `lingua_principal` | uma das `linguas` | sim | a língua por omissão do mercado (**proposta**) |
| `preco_inclui_iva` | `sim`, `nao` | sim | o comerciante escolhe entre preço com IVA igual em todos os países (absorve a diferença) ou sem IVA igual (o final muda) — **decisão comercial com efeito fiscal, mostrada claramente** (`eu-localization`, «Preço por mercado»); **por omissão `sim`** (decidido, Diogo, 06/10/2026: *«sim, com IVA por omissão»*; §9, Q1) |
| lista de base | — | sim para activar | não é um campo: é a única lista `base` activa do mercado (§3.3; índice único na migração 0017). Activar sem ela é recusado (`prices.base_list_required`) |
| `estado` | `rascunho`, `activo`, `arquivado` | sim | §4.1 |
| `versao`, `criado_em`, `actualizado_em` | | sim | concorrência optimista, como no Catálogo |

A `moeda` e o `preco_inclui_iva` **não mudam depois de haver preços** em alguma
lista do mercado, **nem depois de os ter havido**: conta o histórico, e um
preço tirado também foi escrito nessa moeda (`prices.market_has_prices`). Os
montantes guardados foram escritos nessa moeda e com ou sem IVA, e mudá-los
mudaria em silêncio o que cada montante quer dizer (código, migração 0017;
revisão do #134, P2-1). Para mudar de moeda, cria-se outro mercado.

### 3.2 Canal (`chn_`)

Por onde uma loja vende (`docs/14` §9, P1). Na Fase 1, só canais **online**
(API, frontends, checkout alojado); a loja física é da Fase 2 (`docs/05`).

| Campo | Tipo / valores | Obrigatório | Regra e fonte |
|---|---|---|---|
| `id`, `loja_id` | | sim | |
| `nome` | texto (1–100) | sim | ex.: «Loja online», «App» (**proposta**) |
| `tipo` | `online` (Fase 1); `pos`, `marketplace` só na Fase 2 | sim | **proposta** |
| `mercados` | lista de `mkt_` da mesma loja | não | em que mercados este canal vende; a publicação do Catálogo é por canal × mercado e só aceita pares deste conjunto (**proposta**). Um mercado de outra loja é recusado como «não existe» |
| `estado` | `activo`, `arquivado` | sim | **um canal nasce activo** (código, migração 0017): sem mercados não há par canal × mercado, por isso não publica nada; não precisa de rascunho |

### 3.3 Lista de preços (`prl_`)

| Campo | Tipo / valores | Obrigatório | Regra e fonte |
|---|---|---|---|
| `id`, `mercado_id` | | sim | uma lista é de um mercado e herda a moeda, o `preco_inclui_iva` e a loja dele (**proposta**; a loja não se repete na lista) |
| `nome` | texto (1–100) | sim | ex.: «Base PT», «Profissionais PT» |
| `tipo` | `base`, `b2b` | sim | a `base` é a do mercado (uma por mercado); a `b2b` aplica-se a quem tem a etiqueta (§3.6) |
| `etiqueta_id` | identificador da etiqueta de cliente | só `b2b` | a etiqueta é de Clientes (§2); **por etiqueta, não por relação comercial** (Fase 1; `docs/eurolify/architecture.md` §3.4) |
| `prioridade` | inteiro | só `b2b` | quando um cliente tem duas etiquetas com lista no mesmo mercado, ganha a de prioridade mais alta; de 0 a 1000; empate recusado ao gravar, entre as listas B2B activas do mercado (**proposta**). Uma etiqueta também só está numa lista B2B activa de cada mercado (**proposta**) |
| `estado` | `activa`, `arquivada` | sim | |

### 3.4 Preço (`prc_`)

O preço de uma variante numa lista. **Mudar um preço cria uma linha nova no
histórico** (§3.5); a linha corrente é a última.

| Campo | Tipo / valores | Obrigatório | Regra e fonte |
|---|---|---|---|
| `lista_id`, `variante_id` | | sim | únicos em conjunto (um preço corrente por variante e lista) |
| `montante` | inteiro de 0 a 100 000 000 000 (cêntimos, até mil milhões na moeda) | sim | na moeda da lista; **inclui ou não IVA conforme o `preco_inclui_iva` do mercado** — o valor mostrado ao cliente vem do Motor de IVA (§2) |
| `gratuito` | `sim`, `nao` | sim | **nada se vende a 0,00 € sem ser explicitamente gratuito**: `montante = 0` exige `gratuito = sim`, e `gratuito = sim` exige `montante = 0` (`catalog-pim`, regra 2: um gel esteve seis meses e meio a 0,00 € com 149 unidades vendidas) |
| `quantidade_minima` | inteiro de 1 a 1 000 000 | sim (1 por omissão) | `docs/05`, Fase 1; o Carrinho recusa menos (**proposta**) |
| `multiplo` | inteiro de 1 a 1 000 000 | sim (1 por omissão) | vende-se em múltiplos (ex.: caixas de 6) (**proposta**) |
| `reducao` | ver §3.6 | não | redução anunciada (preço riscado); **parte 2 do código** |
| `definido_por`, `definido_em` | | sim | postos pela base a partir de quem pede (`eurolify.quem`), como no Catálogo; sem ele, a base recusa |

### 3.5 Histórico de preços

Uma linha por cada mudança de preço corrente, **nunca alterada nem apagada**
(como o rasto do Comerciante, migração 0008: gatilho que recusa UPDATE, DELETE
e TRUNCATE, também ao dono das tabelas — **proposta**, seguindo a regra de
auditoria da `observability-security`).

| Campo | Notas |
|---|---|
| `lista_id`, `variante_id` | |
| `montante`, `gratuito` | o que ficou em vigor (vazio numa saída) |
| `moeda`, `preco_inclui_iva` | os do mercado no momento da linha, para cada linha ser prova por si (R2; revisão do #134, P2-1) |
| `saiu` | `sim` quando o preço foi tirado da lista ou a variante apagada (então `definido_por = catalogo:variante apagada`) |
| `reducao_ref` | parte 2 do código, com a redução (§3.6) |
| `em_vigor_desde` | data posta pela base depois de gravar, com a linha do preço já tomada ou inserida (não a hora a que a transacção começou), para a ordem das linhas ser a das escritas; o fim é o `em_vigor_desde` da linha seguinte |
| `definido_por` | quem mudou |

Só o `montante` e o `gratuito` contam como mudança de preço: mudar a
quantidade mínima ou o múltiplo não escreve linha, nem muda o `definido_por`
e o `definido_em` do preço (código, migração 0017). A linha escreve-a a base,
num gatilho; a API não tem permissão de escrever no histórico.

É daqui que sai o **preço de referência** de uma redução (§3.6) e a resposta a
«que preço tinha esta variante neste mercado no dia X» (**proposta**: provar
o que se mostrou, como a regra 4 de «Não se erra em documentos fiscais» do
`AGENTS.md` pede para os documentos).

### 3.6 Redução anunciada (preço riscado)

Quando o comerciante anuncia uma redução, a loja mostra, ao lado do preço
reduzido, o **preço anterior**. Esse preço anterior é **o mais baixo praticado
nos 30 dias anteriores à redução** (Dir. 98/6/CE, art. 6.º-A, introduzido pela
Dir. (UE) 2019/2161 — **C**, `docs/03` linha 65; `consumer-rights-eu`).

| Campo | Notas |
|---|---|
| `inicio`, `fim` | a redução tem início e, se o comerciante quiser, fim (**proposta**) |
| `preco_referencia` | **calculado pelo servidor** a partir do histórico (§3.5), nunca escrito à mão; guardado com a redução para ficar a prova do que se mostrou (**proposta**) |

As excepções e os pormenores do art. 6.º-A (produtos perecíveis, produtos há
menos de 30 dias à venda, reduções progressivas, o período noutros Estados-
-membros) **não foram lidos — C**: vão para o jurista
([`12-perguntas-para-o-jurista.md`](12-perguntas-para-o-jurista.md)) antes de a
redução chegar a um ecrã. Até lá, o servidor **recusa** uma redução quando o
histórico da variante nessa lista tem menos de 30 dias (**proposta**, a mais
segura: não se mostra um preço de referência que não se sabe calcular).

### 3.7 Preço por unidade

Ao lado do preço de venda, o preço final por quilograma, litro, metro, metro
quadrado ou metro cúbico, também em todo o anúncio que mostre o preço (Dir.
98/6/CE, arts. 2.º e 3.º — **W** · texto lido, `docs/03` linha 66). Exemplo
da `consumer-rights-eu`: um frasco de 15 ml a 9,90 € mostra 660,00 €/l.

- **Calculado pelo servidor** a partir do preço mostrado (já com o IVA que o
  Motor de IVA der) e da `conteudo_quantidade` e `conteudo_unidade` da
  variante (`docs/14` §3.2): `mg`, `g`, `kg` → por kg; `ml`, `cl`, `l` → por
  l; `mm`, `cm`, `m` → por m; `m2` → por m²; `m3` → por m³ (**proposta**,
  sobre a lista proposta do Catálogo).
- Cada país pode dispensar produtos em que o preço por unidade não seja útil
  ou confunda (art. 5.º) ⇒ a regra é **por país**. Que dispensas tem cada
  país: **não verifiquei — C**. Até haver a lista validada, o servidor
  calcula-o **sempre** que a variante tem quantidade e unidade, e a loja
  **mostra-o sempre** (decidido, Diogo, 06/10/2026; §9, Q5; `docs/06`, BW).
- O **arredondamento** do preço por unidade (casas decimais, regra): **não
  verifiquei — C** (a `eu-vat-oss-ioss` deixa os arredondamentos «por país e
  por emissor — C»).

## 4. Estados

### 4.1 Mercado

| De | Para | Condição |
|---|---|---|
| rascunho | activo | tem países, moeda, línguas e a lista de base com o mesmo mercado; nenhum dos países está noutro mercado activo da loja (§3.1, Q4 decidida) |
| activo | arquivado | as publicações do Catálogo nesse mercado passam a arquivado, na mesma transacção (um gatilho da migração 0019; o evento do §6 é para os outros domínios) |
| arquivado | activo | volta sem republicar (como o artigo no `docs/14` §4.1) |

### 4.2 Lista e preço

Uma lista arquivada deixa de se aplicar e não recebe preços
(`prices.list_archived`); os preços ficam no histórico. **A lista de base de
um mercado activo não se arquiva** (`prices.base_list_in_use`): arquiva-se o
mercado primeiro, ou cria-se outra de base depois de arquivar num mercado em
rascunho. Repor uma lista de base quando o mercado já tem outra activa é
recusado (`prices.base_list_duplicate`). Um
preço não tem estados: muda-se (linha nova no histórico) ou tira-se da lista
(a variante deixa de ter preço nessa lista, e a C2 diz-o).

Com a publicação do Catálogo (migração 0019, #77; **proposta**):
- o preço de uma variante à venda numa publicação publicada não sai da lista
  de base do mercado (`prices.published_variant`); retira-se primeiro a
  publicação;
- tirar de um canal um mercado onde há uma publicação **publicada** é
  recusado (`prices.channel_market_in_use`); as retiradas ficam, como
  registo (decisão do Diogo, 06/10/2026, revisão do #139, P2-2, opção a);
- arquivar o mercado ou o canal arquiva as publicações deles.

## 5. Regras do domínio

| # | Regra | Fonte |
|---|---|---|
| R1 | **O preço decide-se no servidor**; frontends e IAs mostram-no, nunca o recalculam | `AGENTS.md`, «Uma regra, um sítio»; `docs/02` §2, ponto 1 |
| R2 | Montantes em cêntimos + moeda ISO 4217; nunca vírgula flutuante; nunca um montante sem moeda | `headless-commerce`, regra 8; `eu-localization` (a despesa de 14.505 USD guardada como euros) |
| R3 | **Nenhuma conversão de moeda nem IVA sem guardar a taxa ou a regra usada e a data** | `eu-localization`, regra de ouro |
| R4 | `montante = 0` só com `gratuito = sim`; a C2 recusa publicar uma variante sem preço na lista de base do mercado, ou a 0,00 € sem ser gratuita | `catalog-pim`, regra 2; `docs/14` §5, C2 |
| R5 | O histórico não se altera nem se apaga; corrige-se com uma linha nova | `observability-security` (registo de auditoria); como a 0008 |
| R6 | O preço de referência de uma redução vem do histórico, calculado pelo servidor; sem 30 dias de histórico, não há redução (até o jurista responder) | Dir. 98/6/CE, art. 6.º-A (**C**); **proposta** para o caso sem histórico |
| R7 | O preço por unidade é calculado pelo servidor e mostrado sempre que a variante tem quantidade e unidade (Q5, decidida) | Dir. 98/6/CE, arts. 2.º, 3.º e 5.º (**W**); a dispensa por país é **C** |
| R8 | O mercado de um visitante decide-se pelo **país de entrega** quando o há; antes disso, pela escolha dele, **nunca pelo IP** | `eu-localization`, «Mercado»; Reg. (UE) 2018/302 (geobloqueio, **C**, `consumer-rights-eu`) |
| R9 | Se um preço for personalizado com base numa decisão automatizada (por uma extensão), a resposta da API traz o aviso, e a loja mostra-o | Dir. 2011/83/UE, art. 6.º, n.º 1, alínea e-A) (**W** · texto lido, `docs/03` linha 67) |
| R10 | Uma lista B2B só se aplica a quem tem a etiqueta e compra como profissional nessa encomenda; **ter NIF não faz de alguém profissional**, e a lista B2B nunca tira direitos de consumidor | `consumer-rights-eu`, «Consumidor ou profissional»; `eurolify-b2b-channels-eu` |
| R11 | O preço que o cliente viu fica congelado na encomenda (cópia), com a lista, a redução e o preço de referência usados | `consumer-rights-eu` (prova contratual); **proposta** quanto à cópia |

## 6. Eventos

Com outbox, como os do Catálogo (`platform-architect`).

**Em código** (migração 0021, `docs/18` §5):
- já se escrevem `price.changed` (uma por linha nova no histórico, com o
  montante antigo e o novo, a moeda, o «preço inclui IVA», se saiu, e quem),
  `market.activated` e `market.archived` — os campos exactos de cada um (o
  contrato) estão na tabela do `docs/18` §5;
- `promotion.*` entra com a redução (parte 2).

| Evento | Quando | Leva |
|---|---|---|
| `price.changed` | um preço corrente mudou (linha nova no histórico) | `prl_`, `var_`, montante antigo e novo, moeda |
| `promotion.started` | uma redução entrou em vigor | `prl_`, `var_`, preço reduzido, preço de referência, fim |
| `promotion.ended` | uma redução acabou (chegou ao fim ou foi tirada) | `prl_`, `var_` — já estava na lista da skill `platform-architect` |
| `market.activated`, `market.archived` | o mercado mudou de estado | `mkt_` — para os domínios que precisam de saber que um mercado mudou de estado (o Catálogo já arquiva as publicações na mesma transacção, 0019; §4.1); acrescentados ao `docs/02` e à skill `platform-architect` (decidido, Diogo, 06/10/2026; §9, Q6; `docs/06`, BX) |

## 7. Lista da API

Versão por data (`headless-commerce`, regra 7). Listas por cursor, com o
total explícito. Erros RFC 9457 com código estável (`docs/18`). Todas as
escritas com `Idempotency-Key`. Âmbitos: `prices:read` e `prices:write`,
também para os mercados e os canais (§10.1; `docs/06`, CW).

### 7.1 API de Administração

| Operação | Método e caminho | Âmbito | Notas |
|---|---|---|---|
| Mercados | `GET /markets`, `POST /markets`, `PATCH /markets/{id}` | markets:read / write | nasce em rascunho |
| Activar / arquivar mercado | `POST /markets/{id}/activate`, `POST /markets/{id}/archive` | markets:write | §4.1 |
| Canais | `GET /channels`, `POST /channels`, `PATCH /channels/{id}` | markets:read / write | |
| Listas de preços | `GET /price-lists`, `POST /price-lists`, `PATCH /price-lists/{id}` | prices:read / write | |
| Preços de uma lista | `GET /price-lists/{id}/prices`, `PUT /price-lists/{id}/prices/{variantId}` | prices:read / write | o `PUT` cria a linha nova no histórico; recusa R4 |
| Tirar um preço | `DELETE /price-lists/{id}/prices/{variantId}` | prices:write | fica no histórico |
| Histórico | `GET /price-lists/{id}/prices/{variantId}/history` | prices:read (quem mudou e quem autorizou: prices:history, `docs/28` §3.8) | |
| Redução | `PUT /price-lists/{id}/prices/{variantId}/reduction`, `DELETE …/reduction` | prices:write | o servidor calcula o preço de referência (R6) |
| Verificar preço para publicar | `GET /markets/{id}/price-check?variants=…` | prices:read | **não escreve**: devolve, por variante, `com_preco`, `gratuito` e o impedimento (é o que a C2 do Catálogo usa por dentro) |

### 7.2 API da Loja

| Operação | Método e caminho | Notas |
|---|---|---|
| Mercados da loja | `GET /store/markets` | países, moeda, línguas — para o visitante escolher (R8) |
| Preço de variantes | `GET /store/prices?market=…&variants=…` | o preço **a mostrar** (com o IVA do Motor de IVA), o preço por unidade, a redução e o preço de referência, a quantidade mínima e o múltiplo; o aviso de preço personalizado quando houver (R9) |

### 7.3 MCP de leitura (Fase 1)

| Ferramenta | O que dá |
|---|---|
| `eurolify_preco_da_variante` | o preço de uma variante num mercado, com o histórico dos últimos 30 dias |
| `eurolify_sem_preco` | as variantes publicadas ou por publicar sem preço num mercado, ou a 0,00 € sem serem gratuitas |

## 8. Por onde é que isto ainda pode sair errado

| Risco | O que o evita |
|---|---|
| Um frontend mostra um preço diferente do que se cobra | R1: o preço e o IVA vêm do servidor; a encomenda guarda a cópia (R11) |
| Um preço a 0,00 € por engano (o gel dos seis meses e meio) | R4 na base e na C2 |
| Um preço de referência inventado numa promoção | R6: calculado do histórico, nunca escrito à mão; sem histórico, não há redução |
| O mesmo país em dois mercados da loja, e o cliente vê dois preços | um país só num mercado activo (§3.1, Q4) |
| Um montante sem moeda, ou convertido sem taxa | R2 e R3; sem conversão automática na Fase 1 (Q2, decidida) |
| Um preço com IVA guardado como sem IVA (ou o contrário) | o `preco_inclui_iva` é do mercado e mostrado claramente; o Motor de IVA é quem calcula o valor a mostrar |
| Uma lista B2B aplicada a um consumidor com NIF | R10: decide a declaração na encomenda, não o NIF |
| Uma regra legal **C** chega a um ecrã sem validação | o art. 6.º-A, as dispensas do preço por unidade e o arredondamento ficam marcados **C** e vão para o jurista; o servidor fica no lado seguro (recusa a redução, calcula o preço por unidade sempre) |

## 9. Perguntas para o Diogo ou o Bruno

| # | Pergunta | Proposta |
|---|---|---|
| Q1 | Por omissão, um mercado novo tem os preços **com IVA** (o cliente vê o mesmo preço em todos os países e o comerciante absorve a diferença) ou **sem IVA** (o preço final muda com o país)? | ✅ **Decidido: com IVA por omissão**; o comerciante pode mudar por mercado (Diogo, 06/10/2026: *«sim, com IVA por omissão»*; `docs/06`, BS) |
| Q2 | Na Fase 1, cada mercado tem os preços escritos à mão na sua moeda, ou o Eurolify converte de uma moeda para outra? | ✅ **Decidido: sem conversão na Fase 1**; cada lista escreve os seus preços, e a conversão (com taxa, fonte e data, R3) fica para depois (Diogo, 06/10/2026: *«sim, sem conversão na Fase 1»*; `docs/06`, BT) |
| Q3 | Códigos de desconto e regras de carrinho entram na Fase 1? | ✅ **Decidido: ficam para depois**; na Fase 1 só a redução anunciada (preço riscado, §3.6), e os códigos e as regras de carrinho chegam com o domínio Carrinho (Diogo, 06/10/2026: *«sim, ficam para depois»*; `docs/06`, BU) |
| Q4 | Numa loja, o mesmo país pode estar em dois mercados activos? | ✅ **Decidido: não**; um país, um mercado activo por loja, para o mesmo cliente nunca ver dois preços (Diogo, 06/10/2026: *«sim, um país só num mercado activo»*; `docs/06`, BV) |
| Q5 | O preço por unidade mostra-se sempre que a variante tem quantidade e unidade, até haver a lista das dispensas por país validada? | ✅ **Decidido: sim**; mostrar a mais não viola a regra, esconder sem saber pode violar (Diogo, 06/10/2026: *«sim, mostra sempre o preço por unidade»*; `docs/06`, BW) |
| Q6 | Acrescentar `market.activated` e `market.archived` à lista de eventos do `docs/02`? | ✅ **Decidido: sim**; o Catálogo precisa deles para arquivar as publicações de um mercado arquivado (Diogo, 06/10/2026: *«sim, acrescenta os eventos ao docs/02»*; `docs/06`, BX) |

## 10. Parte 2 — a API, a redução e o preço por unidade (desenho de 09/10/2026)

Diogo, 09/10/2026: *«sim, avança com o desenho da segunda parte de Preços»*
(issue #127). A parte 1 (migração 0017) tem o modelo e as funções do
repositório, sem rotas. Esta parte põe a API de Administração (§7.1), a
redução anunciada (§3.6), o preço por unidade (§3.7) e os eventos
`promotion.*` (§6). Tudo **proposta** até ao OK, salvo o que já estava
decidido (Q1–Q6).

Ex.: o «Gel UV 15 ml» custa 9,90 € na lista «Base PT» desde 01/09/2026. A
09/10/2026 o comerciante anuncia uma redução para 7,90 € até 31/10/2026. O
servidor procura o preço mais baixo praticado entre 09/09/2026 e 08/10/2026
(9,90 €), guarda-o como preço de referência, e a API devolve 7,90 €, o
preço de referência 9,90 € e o preço por unidade 526,67 €/l (a casa
decimal é **C**, abaixo).

### 10.1 A API (§7.1)

- **Âmbitos:** dois novos, `prices:read` e `prices:write` (os mercados, os
  canais, as listas, os preços e as reduções; em vez dos quatro do §7, para
  não ter permissões que andam sempre juntas). Nos papéis (`docs/21` §5):
  o `dono` e o `gestor` têm os dois; o `armazém` e o `apoio`, só
  `prices:read` (o preço de venda não é preço de custo, que esses papéis não
  vêem). Entram no `CHECK` das chaves e na `papel_ambitos`, como o
  `catalog:history` (0033). **Esta é a decisão pedida.**
- **As rotas** são as do §7.1, com a mesma base comum das do Catálogo
  (`docs/18`: idempotência, versões, erros RFC 9457, listas por cursor). O
  `GET /markets/{id}/price-check` fica de fora: a C2 do Catálogo já o faz
  por dentro, e não há quem o peça de fora.
- **Quem fez:** cada escrita pela API põe `eurolify.quem` (`chave:key_…`) na
  transacção, como o `escrever` do Catálogo. Fecha a falta da revisão do
  #208 (P1-2): arquivar um mercado ou um canal passa a dizer quem foi, e o
  `catalogo:mercado_arquivado` fica só para o SQL à mão.
- **A versão:** mercados, canais e listas levam a `versao` lida, como os
  artigos; o preço não tem versão (um `PUT` substitui, e o histórico guarda
  tudo).
  **Actualização (10/10/2026, `docs/22` §25, #335):** a base já tinha a
  `versao` do preço (0017, sobe em cada escrita; recomeça em 1 quando o
  preço sai e volta). **Todas as respostas de preço** (as leituras da lista
  e do artigo, o `PUT` do preço e as reduções, pela chave e pelo Hub) passam
  a mostrá-la (revisão do #339, P3-1). As escritas pelo Hub mandam a versão
  e o `definido_em` lidos (409 `prices.version_conflict`); as rotas pela
  chave continuam sem os pedir.

### 10.2 A redução anunciada (§3.6)

| Campo | Notas |
|---|---|
| `id` (`red_`) | |
| `lista_id`, `variante_id` | uma redução de cada vez por variante e lista |
| `montante` | o preço reduzido, em cêntimos; **maior que 0 e menor que o preço de referência**; uma redução para 0,00 € não existe (o gratuito é o preço, R4) |
| `preco_referencia` | **calculado pelo servidor** ao criar e guardado (R6); nunca escrito por quem pede |
| `inicio` | o instante em que é criada (**proposta**: sem reduções marcadas para o futuro na parte 2; o preço de referência calcula-se no momento em que a redução começa, e uma marcada para daqui a uma semana teria de se calcular nesse dia) |
| `fim` | opcional; depois do início; sem ele, dura até se tirar |
| `terminada_em`, `terminada_por` | quando se tira antes do fim (`DELETE …/reduction`) |
| `criada_por` | de `eurolify.quem` |

Regras:

- **O preço de referência** é o montante mais baixo **praticado** na
  variante e lista nos 30 dias antes do início: o preço do histórico (§3.5)
  em vigor em cada momento desse intervalo, ou o preço de uma redução
  anterior, quando estava em vigor. **Sem 30 dias de histórico seguidos**
  (o primeiro preço depois do início do intervalo, ou o preço a ter saído
  da lista em algum momento dele), **recusa-se** com
  `prices.reduction_without_history` (R6, até o jurista responder; as
  excepções do art. 6.º-A são **C**, `docs/12`, B, ponto 7).
- **Um preço reduzido igual ou acima do de referência** recusa-se
  (`prices.reduction_not_lower`): não é uma redução.
- **Enquanto há uma redução em vigor, o preço da lista não muda**
  (`prices.reduction_active`): tira-se primeiro a redução. Mudar o preço por
  baixo de uma redução deixava a redução e o preço de referência sem
  sentido.
- **Nada se apaga:** a redução tirada ou acabada fica, como prova do que se
  mostrou (R11); o histórico de uma variante e lista inclui as reduções.
- **A publicação** (C2) não olha para a redução: o preço da lista é o que
  conta para «tem preço».
- **Eventos:** `promotion.started` ao criar; `promotion.ended` ao tirar.
  Uma redução que acaba sozinha no `fim` **não** escreve evento (não há
  tarefa que o faça; o `promotion.started` leva o `fim`, e quem o recebe
  sabe quando acaba).

### 10.3 O preço por unidade (§3.7)

- **Calculado pelo servidor** em cada leitura de um preço (a lista, o
  histórico, a ficha), a partir do preço em vigor (o reduzido, se houver) e
  da `conteudo_quantidade` e `conteudo_unidade` da variante: `mg`, `g`, `kg`
  → por kg; `ml`, `cl`, `l` → por l; `mm`, `cm`, `m` → por m; `m2` → por m²;
  `m3` → por m³ (R7; Q5).
- **Com IVA ou sem IVA, como o mercado** (`preco_inclui_iva`), e a resposta
  diz qual. O valor que o consumidor vê, com o IVA do país, só sai com o
  Motor de IVA (fatia 6) e com a API da Loja (§7.2), que **não entram nesta
  parte**.
- **O arredondamento** é **C** (§3.7): a API devolve o valor com quatro
  casas decimais, em texto (ex.: `"526.6667"`), e a regra de arredondar para
  mostrar fica para quando houver fonte. Sem quantidade ou unidade na
  variante, vem vazio.

### 10.4 Fora desta parte

- A API da Loja (§7.2) e o MCP de leitura (§7.3): pedem o Motor de IVA.
- Reduções marcadas para o futuro, reduções progressivas e o que o art.
  6.º-A diz de produtos perecíveis ou novos: **C**, à espera do jurista.
- Códigos de desconto e regras de carrinho (Q3, decidido: depois).
- Listas B2B por etiqueta: a etiqueta é de Clientes (`docs/23` §3.5; migração
  0037), com chave estrangeira; as rotas aceitam e devolvem `ctg_…`. As
  etiquetas que as listas já referiam nasceram na 0037.

### 10.5 Por onde é que isto ainda pode sair errado

| Risco | O que o evita |
|---|---|
| Um preço de referência mais alto do que o praticado (o «falso desconto») | calculado do histórico e das reduções anteriores, nunca escrito à mão; sem 30 dias seguidos, recusa |
| Uma redução «encadeada» que esconde a subida anterior | o preço de referência conta também com as reduções anteriores (o mais baixo praticado); as regras finas das reduções progressivas são **C** |
| O preço muda por baixo de uma redução | `prices.reduction_active` |
| Uma chave com `catalog:write` muda preços | os âmbitos são outros; o teste das rotas verifica-o em cada caminho |
| O preço por unidade arredondado de uma forma que um país não aceita | devolve-se o valor sem arredondar para mostrar (quatro casas); a regra é **C** |

### 10.6 Em código (09/10/2026; migração 0036; `docs/06`, CW)

- `migracoes/0036_precos_reducao_e_ambitos.sql`: a tabela `reducao`, a função
  `preco_referencia`, os gatilhos (o preço de referência e as recusas, o
  preço que não muda por baixo de uma redução, os eventos `promotion.*`) e os
  âmbitos `prices:read` e `prices:write` nas chaves e nos papéis.
- `precos/rotas.ts`: as rotas, com o `escrever` do Catálogo (a
  Idempotency-Key e o `eurolify.quem` da chave na mesma transacção);
  `precos/repositorio.ts` corre na transacção do pedido (`noDominio`), e tem
  as listas, as reduções e o preço por unidade.
- **Diferenças do §7.1:** os mercados de um canal mudam-se com
  `PUT /channels/{id}/markets` (não com um `PATCH` do canal), e os canais e as
  listas arquivam-se e repõem-se com `POST …/archive` e `…/restore`; o nome de
  um canal ou de uma lista ainda não se muda pela API (não houve pedido).
- **A variante de um rascunho apagada** com uma redução em vigor termina a
  redução, com quem apagou.
- **Os testes** (`precos-api.test.ts`) correm numa base sem o «quem» por
  omissão: cada escrita prova que traz o seu.
- **Revisão do #224** (09/10/2026):
  - **«30 dias» são 720 horas**, qualquer que seja o fuso da sessão e a mudança
    da hora; o que a lei conta como «30 dias» é **C**.
  - **«30 dias seguidos de preço» não é «30 dias à venda»** (P2-4): conta o
    histórico do preço na lista, mesmo com o mercado em rascunho ou sem
    publicação. É a leitura mais simples do art. 6.º-A, que **não lemos**;
    está na pergunta ao jurista (`docs/12`, B, ponto 7).
  - **Os mercados de um canal** mudam-se com a versão lida do canal, e a
    versão sobe (P2-3).
  - **Arquivar a lista ou o mercado** não termina as reduções em vigor, nem
    escreve `promotion.ended` (P3-5): ao repor, a redução está como estava (o
    preço não pôde mudar entretanto).
  - **O histórico** (`GET …/history`) não vem por páginas (P3-8): fica para
    quando houver integrações a mudar preços muitas vezes.
- **Os preços de um artigo** (09/10/2026, `docs/22` §17; #249, #252):
  `GET /products/{id}/prices` (`prices:read`) dá as listas activas, cada uma
  com o mercado e os preços das variantes do artigo (o mesmo esquema de
  `GET /price-lists/{id}/prices`). Chamadores: a API pela chave e
  `GET /hub/products/{id}/prices` (a ficha do Hub). As reduções em vigor saem
  de uma só função (`reducoesEmVigor`) para as duas leituras.
  - **O teste das rotas encontrou dois problemas que vinham da parte 1:**
    criar uma lista no mercado de outro comerciante respondia «já há uma
    lista de base» (dizia que o mercado existia), e pôr um preço numa lista
    de outro dava 500. Os dois dão agora 404 (a 0036 refaz o gatilho das
    listas; `definirPreco` confere a lista antes de escrever).
