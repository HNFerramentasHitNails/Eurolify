# Domínio Catálogo — modelo e lista da API

> **Versão de 05/10/2026** (issue #36). É o primeiro dos desenhos que o
> [ADR-0023](adr/0023-ok-para-codigo.md) pede antes do código de um domínio:
> o modelo em tabela (§3) e a lista da API em tabela (§7)
> ([`05-fases-e-mvp.md`](05-fases-e-mvp.md), Fase 0). **As perguntas da §9
> estão decididas** (P3 a 04/10/2026; as outras pelo Diogo a 05/10/2026, que
> aceitou as propostas; `docs/06`, AR): o código do Catálogo pode começar.
>
> **Estado do código** (issue #77): parte 1 — artigos e variantes na base
> (migração `0002_catalogo_artigos.sql`, `apps/api/src/catalogo/repositorio.ts`,
> 18 testes contra o PostgreSQL 18.6), sem API até à fatia «identidade». As
> listas de unidades de venda (`unidade`, `par`, `caixa`, `embalagem`,
> `conjunto`) e de unidades do conteúdo (`mg` a `m3`) são **proposta** desta
> parte.
>
> Skills seguidas: `catalog-pim`, `platform-architect`, `headless-commerce`,
> `product-compliance-eu`, `eu-localization`, `eu-vat-oss-ioss` (categoria
> fiscal) e `consumer-rights-eu` (preço por unidade). Arquitectura de base:
> [`02-arquitectura.md`](02-arquitectura.md) §3. Ferramentas: ADR-0025
> (PostgreSQL 18 com RLS por comerciante, Fastify + TypeBox, OpenAPI 3.1 a
> partir dos esquemas).
>
> Marcas de cada linha: **regra** (vem de uma skill, de um documento ou de um
> ADR, com a fonte); **proposta** (é desenho deste documento, decide-se ao
> juntar); **pergunta** (está na §9, não se programa sem resposta).

## 1. O que entra na Fase 1

A Fase 1 pede um «catálogo com variantes, kits/coleções, traduções e os campos
regulamentares (fabricante, pessoa responsável, avisos, INCI, lote)». Quando o
comerciante já tem um sistema de gestão, o catálogo continua a nascer lá e é
espelhado para o Eurolify pela API (`05-fases-e-mvp.md`, Fase 1, âmbito).

| Entra na Fase 1 | Fica para depois |
|---|---|
| artigos, variantes, opções, kits e coleções (composição) | atributos definidos pelo comerciante — são «campos e objectos próprios» das extensões (`08-extensoes-de-terceiros.md`); decidido na §9 (P4) |
| media com texto alternativo por língua | colecções **por regra** (só manuais na Fase 1, **proposta**) |
| categorias (árvore) e colecções manuais | feeds para Google, Meta e comparadores |
| traduções por campo, com estado | tradução automática por IA (proposta, revista por uma pessoa: `eu-localization`) |
| publicação por canal × mercado, com a verificação «pode publicar?» | |
| atributos regulamentares do artigo e da variante | documentos de prova, recolhas, fórmulas: são do domínio Conformidade (§2) |
| importação com modo de ensaio, exportação completa | |
| SEO por língua (endereço amigável, título, descrição) | mapa do site e dados estruturados: o frontend gera-os a partir da API da Loja |
| linha do tempo de cada artigo | |

## 2. Fronteira — o que é do Catálogo e o que não é

Regra: **cada dado tem um dono**, e um domínio só lê outro pela API interna ou
pelos eventos dele, nunca pelas tabelas (`platform-architect`, regra 2).

| Dado | Dono | Como o Catálogo o usa |
|---|---|---|
| artigo, variante, opção, composição, media, categoria, colecção, tradução, publicação, SEO | **Catálogo** | — |
| atributos regulamentares do artigo (valores declarados pelo comerciante) | **Catálogo** (`02-arquitectura.md`, linha do Catálogo) | guarda o valor, quem o preencheu e quando |
| operador económico, pessoa responsável na UE, documentos de prova e validade, alertas e recolhas | **Conformidade de produto** (`02-arquitectura.md`) | o artigo aponta para o operador; pergunta à Conformidade «falta algum atributo obrigatório neste mercado?» |
| fórmula com versão (INCI) | Conformidade de produto (decidido na §9, P2) | a variante aponta para a versão da fórmula |
| preço, lista de preços, histórico de 30 dias, promoções | **Preços e mercados** | a publicação pergunta «há preço neste mercado, e não é 0,00 € sem ser gratuito?» |
| mercado (país + moeda + línguas) e canal | **Preços e mercados** (`02-arquitectura.md`: «mercados (país + moeda + língua + canal)»; decidido na §9, P1) | a publicação guarda o canal e o mercado pelos identificadores |
| stock, disponível, reservas, lotes | **Stock** (`order-fulfilment`) | nenhum; a disponibilidade de um kit calcula-a o Stock a partir da composição do Catálogo |
| categoria fiscal (a lista e o que significa) | **Motor de IVA** (`eu-vat-oss-ioss`) | o artigo guarda o **código** da categoria; a taxa nunca vive no Catálogo |
| restrições de transporte (mercadorias perigosas) | **Envios** | o artigo guarda o número ONU e a classe; os Envios recusam serviços incompatíveis (`product-compliance-eu`) |

## 3. Modelo — entidades e campos

Em **todas** as tabelas: `comerciante_id`, com o isolamento imposto pela base
(RLS) e testes que tentam ler o vizinho e têm de falhar (`platform-architect`,
regra 3; ADR-0025). Identificadores opacos com prefixo do tipo
(`headless-commerce`, regra 2). Datas em UTC. Pesos em gramas e medidas em
milímetros, inteiros (**proposta**, na linha da regra do dinheiro em inteiros).

### 3.1 Artigo (`prd_`)

O produto comercial. «Activo» não quer dizer «à venda»: o que diz se está à
venda é a publicação (§3.9). Nos sistemas actuais o Hub dava 1.312 activos
quando a loja tinha 1.043 à venda (13/09/2026, `catalog-pim`, regra 1).

| Campo | Tipo | Obrig. | Notas |
|---|---|---|---|
| `id` | `prd_…` | sim | |
| `tipo` | lista | sim | físico, serviço, digital, bilhete, cartão-oferta (`catalog-pim`); digital e cartão-oferta desenhados e desligados até às portas deles (P3, ADR-0034) |
| `estado` | lista | sim | rascunho, activo, arquivado (§4.1) |
| `nome`, `descricao` | texto traduzível | nome sim | na língua de origem do comerciante; as outras em Tradução (§3.8) |
| `marca` | texto | não | |
| `categoria_fiscal` | código da lista do Motor de IVA | sim para publicar | ex.: normal, reduzida, isenta por natureza (`eu-vat-oss-ioss`) |
| `operador_economico_id` | referência à Conformidade | conforme o mercado | fabricante e, se o fabricante é de fora da UE, a pessoa responsável na UE (GPSR, **W**, `docs/03` linha 81) |
| `avisos` | texto traduzível | conforme o mercado | avisos e instruções **na língua do país** onde se vende (GPSR, **W**) |
| `categorias` | lista de `cat_…` | não | |
| `seo` | por língua: endereço amigável, título, descrição | não | o endereço amigável é único por loja e língua (**proposta**) |
| `origem` | eurolify ou sistema externo (+ identificador lá) | sim | quando a ficha nasce no sistema de gestão do comerciante (`catalog-pim`, «Primeira regra»); o que se pode editar no Hub: decidido na §9 (P5) — os campos que vêm de lá ficam só de leitura |
| `criado_em`, `actualizado_em`, `versao` | | sim | `versao` sobe a cada alteração; a escrita com versão antiga é recusada (**proposta**) |

### 3.2 Variante (`var_`)

A unidade vendável. Um artigo sem opções tem uma variante.

| Campo | Tipo | Obrig. | Notas |
|---|---|---|---|
| `id` | `var_…` | sim | |
| `artigo_id` | `prd_…` | sim | |
| `sku` | texto | **sim** | **único por comerciante** (`catalog-pim`, regra 3: no Hub, artigo sem SKU travava a fatura, 11/09 e 17/09/2026). Um SKU arquivado **não se reutiliza** (**proposta**) |
| `gtin` | texto | não | dígito de controlo validado; único por comerciante (**proposta**: no Hub havia 18 códigos repetidos, `catalog-pim`, regra 4) |
| `gtin_origem` | lista | sim se há `gtin` | GS1 do comerciante, do fornecedor ou interno (`catalog-pim`, regra 4) |
| `valores_das_opcoes` | lista de `ovl_…` | conforme o artigo | uma combinação não se repete dentro do artigo |
| `unidade_de_venda` | código da lista do Eurolify | **sim** | unidade, caixa, par… (`catalog-pim`, regra 3: no Hub, artigo sem unidade travava a fatura) |
| `conteudo_quantidade`, `conteudo_unidade` | inteiro + kg, l, m, m², m³ (e submúltiplos) | conforme o país | para o **preço por unidade** (Dir. 98/6/CE, arts. 2.º, 3.º e 5.º, **W**, `docs/03` linha 61: «o artigo guarda quantidade e unidade»); cada país pode dispensar produtos (art. 5.º) |
| `peso_g`, `comprimento_mm`, `largura_mm`, `altura_mm` | inteiros | físico: peso sim | para os Envios |
| `formula_versao_id` | referência à Conformidade | cosmético: sim | o lote sabe que versão leva (`product-compliance-eu`, «Fórmulas com versões»); decidido na §9 (P2) |
| `onu`, `classe_adr` | texto | não | mercadorias perigosas (ADR/IATA, **C**, `product-compliance-eu`) |
| `estado` | lista | sim | activa, arquivada. Arquivar uma variante **não arquiva o artigo** nem retira as outras (`catalog-pim`, regra 6: no Hub, arquivar um refill tirou 4 produtos do site, 27–28/08/2026) |
| `posicao` | inteiro | sim | ordem no artigo |

### 3.3 Opção (`opt_`) e valor da opção (`ovl_`)

| Entidade | Campos | Notas |
|---|---|---|
| Opção | `artigo_id`, `nome` (traduzível), `posicao` | ex.: «Cor», «Tamanho» |
| Valor da opção | `opcao_id`, `valor` (traduzível), `posicao` | ex.: «Vermelho 12» |

### 3.4 Composição — kits e coleções (`cmp_`)

Uma variante pode ser composta: tem componentes, que são outras variantes.

| Campo | Notas |
|---|---|
| `variante_id` | o kit |
| `componente_variante_id` | uma variante do mesmo comerciante; **não pode ser o próprio kit nem conter o kit** (sem ciclos, **proposta**) |
| `quantidade` | inteiro > 0 |

A **disponibilidade deriva dos componentes**, calculada pelo Stock (no Hub, 72
de 72 compostos batiam com os componentes, 16/09/2026, `catalog-pim`). O
lote de cada componente vai na linha expedida (`product-compliance-eu`; ADR-0022).

### 3.5 Media (`med_`)

| Campo | Notas |
|---|---|
| `artigo_id`, `variante_id` (opcional) | uma imagem pode ser de uma variante |
| `tipo` | imagem, vídeo |
| `ficheiro` | no armazenamento do Eurolify, na UE (`AGENTS.md`, «Os dados ficam na UE») |
| `texto_alternativo` | traduzível; **obrigatório para publicar** (**proposta**; o texto alternativo por língua vem da `catalog-pim`, «acessibilidade») |
| `posicao`, `principal` | uma só principal por artigo |

### 3.6 Categoria (`cat_`)

Árvore de navegação: `pai_id`, `nome` e `endereco_amigavel` traduzíveis,
`posicao`. Sem ciclos. Arquivar uma categoria não arquiva os artigos.

### 3.7 Colecção (`col_`)

Lista **manual** de artigos, com ordem: `nome` e `descricao` traduzíveis,
`artigos` (lista ordenada). As colecções por regra ficam para depois (§1).

### 3.8 Tradução

Uma linha por **recurso × campo × língua** (`catalog-pim`, regra 5;
`eu-localization`).

| Campo | Notas |
|---|---|
| `recurso_id`, `campo`, `lingua` | ex.: `prd_…`, `descricao`, `es` |
| `texto` | |
| `estado` | completa, desactualizada, em falta (§4.3) |
| `versao_do_original` | a `versao` do recurso quando foi traduzido; mudar o original marca a tradução **desactualizada** e avisa |
| `origem` | pessoa ou proposta de IA. Uma proposta de IA **não se publica** em textos legais nem em avisos de segurança sem revisão de uma pessoa (`eu-localization`) |
| `traduzido_por`, `traduzido_em` | |

As traduções **vivem no Eurolify**, nunca numa app de terceiros (`catalog-pim`,
regra 5).

### 3.9 Publicação (`pub_`)

Diz se um artigo está à venda num **canal** e num **mercado**
(`catalog-pim`, regra 1).

| Campo | Notas |
|---|---|
| `artigo_id`, `canal_id`, `mercado_id` | únicos em conjunto |
| `estado` | rascunho, publicado, arquivado (§4.2) |
| `variantes_fora` | variantes do artigo que não se vendem nesta publicação; tirar uma **não retira** o artigo (`catalog-pim`, regra 6) |
| `publicado_por`, `publicado_em`, `arquivado_por`, `arquivado_em` | |
| `ultima_verificacao` | o resultado da última verificação «pode publicar?» (§5, regra C2) |

### 3.10 Atributos regulamentares

Guardados no artigo (ou na variante, quando variam com ela), com **valor,
quem o preencheu e quando** (`product-compliance-eu`). Os grupos da Fase 1 são
os de `05-fases-e-mvp.md`: fabricante e pessoa responsável (pelo operador
económico), avisos, INCI (pela versão da fórmula) e lote (no Stock). Os
outros grupos da skill (CLP, embalagens, baterias, REEE, transporte,
alegações ambientais) entram como campos do artigo quando o mercado os pedir:
a lista de campos **por categoria regulamentar** tem de ser validada por um
técnico regulamentar antes de chegar a um ecrã (`product-compliance-eu`,
«Antes de dizer está feito»).

O **documento de prova** de cada atributo (ficheiro, emissor, validade) é da
Conformidade. **O Eurolify nunca afirma que um produto está conforme**
(`product-compliance-eu`, «Primeira regra»).

### 3.11 Importação (`imp_`) e exportação (`exp_`)

| Entidade | Campos | Notas |
|---|---|---|
| Importação | ficheiro, formato, `modo` (ensaio ou aplicar), `estado` (recebida, analisada, aplicada, falhou), relatório | o **ensaio** diz quantos criaria, alteraria e recusaria, e porquê; só depois se aplica. **Nunca apaga** o que não veio no ficheiro. Importar duas vezes o mesmo ficheiro não duplica nada: a chave é o SKU (`catalog-pim`, «Importação») |
| Exportação | formato aberto (CSV e JSON, **proposta**), `estado`, ficheiro | exportação **completa**: é também a saída do Data Act (`catalog-pim`) |

### 3.12 Linha do tempo

Cada artigo tem a linha do tempo da `platform-architect`: mudanças de estado e
dos campos (quem, quando, antes → depois), notas da equipa, anexos. Alimenta-se
dos eventos (§6) e do registo de auditoria; **não é outra fonte de verdade**.

## 4. Estados

### 4.1 Artigo

| De | Para | Quem / quando | Efeito |
|---|---|---|---|
| — | rascunho | criar | não se pode publicar |
| rascunho | activo | activar; exige SKU e unidade em todas as variantes | pode publicar-se |
| activo | arquivado | arquivar | **todas as publicações passam a arquivado**, com o motivo «artigo arquivado» |
| arquivado | activo | repor | as publicações **não voltam sozinhas**: publicam-se outra vez, com nova verificação (**proposta**) |

Não se apaga um artigo que já esteve activo: arquiva-se (o rasto alimenta
preços, IVA e conformidade, `catalog-pim`, regra 7). Apagar só um rascunho que
nunca foi activo (**proposta**).

### 4.2 Publicação

| De | Para | Condição |
|---|---|---|
| — | rascunho | criar a publicação num canal × mercado |
| rascunho | publicado | a verificação «pode publicar?» (§5, regra C2) não tem impedimentos |
| publicado | arquivado | retirar; ou artigo arquivado; ou bloqueio vindo da Conformidade (ex.: recolha, substância proibida) |
| arquivado | publicado | nova verificação |

### 4.3 Tradução

| Estado | Quando |
|---|---|
| em falta | a língua é do mercado e não há texto |
| completa | há texto e `versao_do_original` = versão actual |
| desactualizada | o original mudou depois da tradução |

## 5. Regras do domínio

| # | Regra | Fonte |
|---|---|---|
| C1 | **A ficha vive num sítio só.** Campo novo de artigo nasce no domínio, na API de Administração e na ficha do Hub no mesmo passo; o Hub usa a API como qualquer cliente | `catalog-pim`, «Primeira regra»; `headless-commerce` |
| C2 | **«Pode publicar?» é uma pergunta ao servidor**, que responde sim ou a lista de impedimentos com código: sem SKU, sem unidade, sem categoria fiscal, sem preço no mercado ou a 0,00 € sem ser gratuito (pergunta a Preços), atributo obrigatório em falta no mercado (pergunta à Conformidade), nome ou avisos sem tradução numa língua do mercado, media sem texto alternativo | `catalog-pim`, regra 2 e «Antes de dizer está feito»; o gel a 0,00 € seis meses e meio com 149 unidades |
| C3 | SKU obrigatório e único por comerciante; unidade de venda obrigatória | `catalog-pim`, regra 3 |
| C4 | Código de barras com origem guardada | `catalog-pim`, regra 4 |
| C5 | Mudar o original marca as traduções desactualizadas e avisa | `catalog-pim`, regra 5 |
| C6 | Arquivar uma variante ou uma publicação não derruba o resto | `catalog-pim`, regra 6 |
| C7 | Todas as alterações com rasto: quem, quando, antes e depois | `catalog-pim`, regra 7 |
| C8 | As listas (tipos, estados, unidades, origens do GTIN) vivem num sítio, do Eurolify, e o comerciante não as muda | `platform-architect`, regra 8 e «classe 2» |
| C9 | Escritas de fora com `Idempotency-Key`; a mesma chave com outro corpo dá erro | `headless-commerce`, regra 5; `platform-architect`, regra 6 |
| C10 | O evento grava-se na mesma transacção que a mudança (outbox) | `platform-architect`, regra 5 |
| C11 | Nenhuma taxa de IVA nem preço no Catálogo; nenhum «certificado» sem documento | `eu-vat-oss-ioss`; `product-compliance-eu` |

## 6. Eventos

Nome no passado, identificador único, versão do formato, comerciante, momento
em UTC e o **mínimo de dados** (o resto pede-se pela API) (`platform-architect`).

| Evento | Quando | Dados |
|---|---|---|
| `product.created` | artigo criado | `prd_…` |
| `product.updated` | artigo, variante, opção, composição, media ou atributo alterado | `prd_…`, campos alterados (só os nomes) |
| `product.published` | publicação passou a publicado | `prd_…`, `pub_…`, canal, mercado |
| `product.unpublished` | publicação passou a arquivado | `prd_…`, `pub_…`, motivo — decidido na §9 (P6) |
| `product.archived` | artigo arquivado | `prd_…` — decidido na §9 (P6) |

Quem consome: Preços (preço por mercado), Stock (composição dos kits), Pesquisa
e frontends (por webhook), linha do tempo.

## 7. Lista da API

Versão por data (ex.: `2027-01`) (`headless-commerce`, regra 7). Listas por
cursor, com indicação de que há mais e **o total explícito** (regra 4; lição
4.7). Erros RFC 9457 com código estável (regra 3). Todas as escritas com
`Idempotency-Key`. Âmbitos OAuth (**proposta**): `catalog:read`,
`catalog:write`, `catalog:publish`, `catalog:import`.

### 7.1 API de Administração

| Operação | Método e caminho | Âmbito | Notas |
|---|---|---|---|
| Procurar artigos | `GET /products` | read | filtros: estado, tipo, categoria, texto, SKU, sem foto, sem SKU, tradução em falta numa língua, actualizado desde |
| Ver artigo | `GET /products/{id}` | read | `expand=variants,options,media,translations,publications` |
| Criar artigo | `POST /products` | write | nasce em rascunho; pode trazer as variantes |
| Alterar artigo | `PATCH /products/{id}` | write | com a `versao`; recusa versão antiga |
| Activar | `POST /products/{id}/activate` | write | exige C3 |
| Arquivar | `POST /products/{id}/archive` | write | arquiva as publicações |
| Repor | `POST /products/{id}/restore` | write | volta a activo, sem republicar |
| Apagar rascunho | `DELETE /products/{id}` | write | só rascunho que nunca foi activo |
| Linha do tempo | `GET /products/{id}/timeline` | read | |
| Variantes | `GET /products/{id}/variants`, `POST /products/{id}/variants`, `PATCH /variants/{id}` | read / write | SKU único (C3) |
| Arquivar variante | `POST /variants/{id}/archive` | write | não toca no artigo (C6) |
| Procurar por SKU ou GTIN | `GET /variants?sku=…` · `GET /variants?gtin=…` | read | |
| Opções | `POST /products/{id}/options`, `PATCH /options/{id}`, valores idem | write | |
| Composição do kit | `PUT /variants/{id}/components` | write | substitui a lista inteira; recusa ciclos |
| Carregar media | `POST /media/uploads` → `POST /products/{id}/media` | write | endereço de envio assinado e depois a ligação ao artigo |
| Alterar ou tirar media | `PATCH /media/{id}`, `DELETE /media/{id}` | write | texto alternativo, posição, principal |
| Categorias | `GET`, `POST /categories`, `PATCH /categories/{id}`, `POST /categories/{id}/move` | read / write | recusa ciclos |
| Colecções | `GET`, `POST /collections`, `PATCH /collections/{id}`, `PUT /collections/{id}/products` | read / write | lista manual, ordenada |
| Traduções | `GET /translations?resource=…&locale=…`, `PUT /translations/{resource}/{field}/{locale}` | read / write | |
| Fila de traduções | `GET /translations?state=outdated,missing&locale=…` | read | o que falta traduzir |
| Verificar publicação | `POST /products/{id}/publications/check` | read | **não escreve**: devolve os impedimentos por canal × mercado (C2) |
| Publicar | `POST /products/{id}/publications` | publish | corre a verificação; recusa com `catalog.publish_blocked` e a lista |
| Retirar | `POST /publications/{id}/archive` | publish | |
| Ver publicações | `GET /products/{id}/publications` | read | |
| Atributos regulamentares | `PUT /products/{id}/regulatory`, `PUT /variants/{id}/regulatory` | write | valor, quem e quando |
| Importar | `POST /imports` (ensaio por omissão), `GET /imports/{id}`, `POST /imports/{id}/apply` | import | o relatório do ensaio vem antes de escrever |
| Exportar | `POST /exports`, `GET /exports/{id}` | read | exportação completa |

Erros com código estável (**proposta**): `catalog.sku_required`,
`catalog.sku_duplicate`, `catalog.gtin_invalid`, `catalog.gtin_duplicate`,
`catalog.unit_required`, `catalog.option_combination_duplicate`,
`catalog.component_cycle`, `catalog.version_conflict`,
`catalog.publish_blocked`, `catalog.not_draft`, `catalog.import_invalid`.

### 7.2 API da Loja

Chave pública por loja; **só lê o que está publicado** no mercado pedido
(`headless-commerce`). O preço e a disponibilidade vêm de Preços e de Stock na
mesma resposta, pela API interna deles; o Catálogo não os guarda.

| Operação | Método e caminho | Notas |
|---|---|---|
| Listar artigos | `GET /store/products?market=…&locale=…` | só publicados; filtros por categoria, colecção, texto |
| Ver artigo | `GET /store/products/{endereco-amigavel}?market=…&locale=…` | inclui o que a lei pede **antes da compra** no mercado: operador económico, avisos na língua, identificação (GPSR, **W**) |
| Categorias | `GET /store/categories?locale=…` | |
| Colecção | `GET /store/collections/{endereco-amigavel}/products?market=…` | |

### 7.3 MCP de leitura (Fase 1)

Ferramentas geradas do mesmo contrato, só leitura, respostas pequenas e
paginadas (`headless-commerce`, «Servidor MCP»).

| Ferramenta | Responde a |
|---|---|
| `eurolify_procurar_artigos` | «que artigos estão sem foto?», «que artigos têm o SKU X?» |
| `eurolify_artigo` | a ficha de um artigo, com variantes |
| `eurolify_porque_nao_esta_a_venda` | a verificação de publicação de um artigo num mercado (C2) |
| `eurolify_traducoes_em_falta` | a fila de traduções de uma língua |

## 8. Por onde é que isto ainda pode sair errado

- **Duas fichas.** Um comerciante com sistema de gestão edita o artigo no Hub
  do Eurolify e a ficha de lá não sabe. A P5 decidiu que os campos que vêm de
  lá ficam só de leitura no Hub: o risco fica se a API não o impuser (um teste).
- **Uma verificação de publicação feita só uma vez.** O preço passa a 0,00 €
  depois de publicado, ou um documento da Conformidade caduca. A verificação
  tem de correr também quando Preços ou Conformidade avisam (eventos), e não
  só ao publicar (**proposta**; os eventos da P6 já estão decididos).
- **Listas cortadas.** A procura de artigos sem total explícito repete a lição
  4.7.
- **SKU reutilizado.** A P7 decidiu que o SKU de uma variante arquivada não
  volta a ser usado; se a base não o impuser (um teste), uma encomenda antiga
  pode apontar para outro produto.
- **A lista de campos regulamentares por categoria** não está validada por um
  técnico (**C** até lá).

## 9. Perguntas para o Diogo ou o Bruno

| # | Pergunta | Proposta e decisão |
|---|---|---|
| P1 | Quem é dono do **canal**? O `02-arquitectura.md` põe o canal dentro do mercado, mas a `catalog-pim` publica por canal × mercado e a `eu-localization` define o mercado sem canal | ✅ **Decidido: canal e mercado são ambos de Preços e mercados; a publicação usa os dois** (Diogo, 05/10/2026 (*«sim, aceito as propostas do §9»*)) |
| P2 | De quem é a **fórmula com versão** (INCI)? Não aparece no `02-arquitectura.md` | ✅ **Decidido: Conformidade de produto, ao lado dos documentos e das recolhas; a variante aponta para ela** (Diogo, 05/10/2026 (*«sim, aceito as propostas do §9»*)) |
| P3 | Que **tipos de artigo** entram na Fase 1? | ✅ **Decidido pelo Diogo, 04/10/2026 (ADR-0034):** digital e cartão-oferta **desenham-se** com `digital-products-eu` e `gift-cards-eu` e **ficam desligados** até às portas deles; físico e serviço seguem sem esperar por eles |
| P4 | Atributos definidos pelo comerciante na Fase 1? | ✅ **Decidido: não: entram com os «campos e objectos próprios» das extensões (`docs/08`)** (Diogo, 05/10/2026 (*«sim, aceito as propostas do §9»*)) |
| P5 | Comerciante com sistema de gestão: o que pode ser editado no Hub do Eurolify? | ✅ **Decidido: os campos que vêm de lá ficam só de leitura no Hub; as traduções, a media e a publicação editam-se no Eurolify** (Diogo, 05/10/2026 (*«sim, aceito as propostas do §9»*)) |
| P6 | Acrescentar `product.unpublished` e `product.archived` à lista de eventos (skill `platform-architect` e `02-arquitectura.md`)? | ✅ **Decidido: sim — sem eles, Preços, Stock e frontends não sabem que um artigo deixou de estar à venda** (Diogo, 05/10/2026 (*«sim, aceito as propostas do §9»*)) |
| P7 | Um SKU de uma variante arquivada pode voltar a ser usado? | ✅ **Decidido: não** (Diogo, 05/10/2026 (*«sim, aceito as propostas do §9»*)) |
