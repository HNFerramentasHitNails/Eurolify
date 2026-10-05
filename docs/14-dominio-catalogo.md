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
> 24 testes contra o PostgreSQL 18.6; a migração `0003_sku_sem_maiusculas.sql` aplica a P9), sem API até à fatia «identidade». As
> listas de unidades de venda (`unidade`, `par`, `caixa`, `embalagem`,
> `conjunto`) e de unidades do conteúdo (`mg` a `m3`) e o formato do SKU
> (1 a 64 caracteres: letras sem acentos, algarismos e `. _ / -`, a começar por
> letra ou algarismo) são **proposta** desta parte, tal como: activar exige
> pelo menos uma variante activa (§4.1); o código da categoria fiscal escreve-se
> em minúsculas, algarismos e `_` (a começar por letra); as datas de criação e
> de alteração são postas pela base, não por quem escreve; e o peso de uma
> variante física só se exige na verificação «pode publicar?» (C2), não ao
> criar nem ao activar.
>
> Parte 2a — composição dos kits (migração `0004_catalogo_kits.sql`, 16 testes):
> ver §3.4, com as regras **proposta** desta parte.
>
> Parte 2b — opções e valores (migração `0005_catalogo_opcoes.sql`, 27 testes):
> ver §3.3, com as regras **proposta** desta parte.
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
| `classificacao` | família setorial, natureza para o consumidor, natureza para o IVA, quem e quando (§3.10, «Classificação do artigo») | sim para publicar | sem ela o artigo não se publica (C2; Q2 do `docs/16`, Diogo, 05/10/2026) |
| `categoria_fiscal` | código da lista do Motor de IVA | sim para publicar | ex.: normal, reduzida, isenta por natureza (`eu-vat-oss-ioss`) |
| `operador_economico_id` | referência à Conformidade | conforme o mercado | fabricante e, se o fabricante é de fora da UE, a pessoa responsável na UE (GPSR, **W**, `docs/03` linha 81) |
| `avisos` | texto traduzível | conforme o mercado | avisos e instruções **na língua do país** onde se vende (GPSR, **W**) |
| `categorias` | lista de `cat_…` | não | |
| `seo` | por língua: endereço amigável, título, descrição | não | o endereço amigável é único por loja e língua (**proposta**) |
| `origem` | eurolify ou sistema externo (+ identificador lá) | sim | quando a ficha nasce no sistema de gestão do comerciante (`catalog-pim`, «Primeira regra»); o que se pode editar no Hub: decidido na §9 (P5) — os campos que vêm de lá ficam só de leitura |
| `criado_em`, `actualizado_em`, `versao` | | sim | `versao` sobe a cada alteração; a escrita com versão antiga é recusada (**proposta**) |

### 3.2 Variante (`var_`)

A unidade vendável. Um artigo sem opções pode ter **várias variantes**, distinguidas pelo SKU (Diogo, 05/10/2026: *«sim, um artigo sem opções pode ter várias variantes»*); a regra da combinação de opções só vale quando o artigo tem opções (P10).

| Campo | Tipo | Obrig. | Notas |
|---|---|---|---|
| `id` | `var_…` | sim | |
| `artigo_id` | `prd_…` | sim | |
| `sku` | texto | **sim** | **único por comerciante** (`catalog-pim`, regra 3: no Hub, artigo sem SKU travava a fatura, 11/09 e 17/09/2026). Não distingue maiúsculas: `GEL-001` e `gel-001` são o mesmo (P9). Um SKU arquivado **não se reutiliza** (P7); **excepção:** o SKU de uma variante apagada de um artigo rascunho volta a ficar livre, porque nunca se vendeu (P8) |
| `gtin` | texto | não | dígito de controlo validado; único por comerciante (**proposta**: no Hub havia 18 códigos repetidos, `catalog-pim`, regra 4). O mesmo código noutro tamanho, com zeros à esquerda, conta como repetido; só zeros não é um GTIN (**proposta**, revisão do #78) |
| `gtin_origem` | lista | sim se há `gtin` | GS1 do comerciante, do fornecedor ou interno (`catalog-pim`, regra 4) |
| `valores_das_opcoes` | lista de `ovl_…` | conforme o artigo | quando o artigo tem opções, uma combinação não se repete dentro do artigo (P10) |
| `unidade_de_venda` | código da lista do Eurolify | **sim** | unidade, caixa, par… (`catalog-pim`, regra 3: no Hub, artigo sem unidade travava a fatura) |
| `conteudo_quantidade`, `conteudo_unidade` | inteiro + kg, l, m, m², m³ (e submúltiplos; a lista proposta da parte 1 do código tem `mg`, `g`, `kg`, `ml`, `cl`, `l`, `mm`, `cm`, `m`, `m2`, `m3` — **sem** submúltiplos de área, como `cm2`, por decidir com a lista) | conforme o país | para o **preço por unidade** (Dir. 98/6/CE, arts. 2.º, 3.º e 5.º, **W**, `docs/03` linha 61: «o artigo guarda quantidade e unidade»); cada país pode dispensar produtos (art. 5.º) |
| `peso_g`, `comprimento_mm`, `largura_mm`, `altura_mm` | inteiros | físico: peso sim, **para publicar** (a verificação C2; a base aceita a variante sem peso enquanto não se publica, **proposta**) | para os Envios |
| `formula_versao_id` | referência à Conformidade | cosmético: sim | o lote sabe que versão leva (`product-compliance-eu`, «Fórmulas com versões»); decidido na §9 (P2) |
| `onu`, `classe_adr` | texto | não | mercadorias perigosas (ADR/IATA, **C**, `product-compliance-eu`) |
| `estado` | lista | sim | activa, arquivada. Arquivar uma variante **não arquiva o artigo** nem retira as outras (`catalog-pim`, regra 6: no Hub, arquivar um refill tirou 4 produtos do site, 27–28/08/2026) |
| `posicao` | inteiro | sim | ordem no artigo |

### 3.3 Opção (`opt_`) e valor da opção (`ovl_`)

| Entidade | Campos | Notas |
|---|---|---|
| Opção | `artigo_id`, `nome` (traduzível), `posicao` | ex.: «Cor», «Tamanho» |
| Valor da opção | `opcao_id`, `valor` (traduzível), `posicao` | ex.: «Vermelho 12» |

Regras da parte 2b do código (**proposta**, salvo as que já estavam aqui e no
§3.2):

- um artigo **sem opções** pode ter várias variantes (P10, decidido);
- com opções, cada variante **activa** leva **um valor de cada opção**, e duas
  variantes activas do mesmo artigo **não têm a mesma combinação** (§3.2). Uma
  variante arquivada não conta: a combinação dela volta a ficar livre;
- as opções só se criam e apagam enquanto o artigo é **rascunho**; valores
  novos acrescentam-se sempre; uma opção nasce com pelo menos um valor (num
  rascunho, apagar depois todos os valores de uma opção é possível e só
  impede de completar as variantes até haver um valor novo);
- o **texto** de uma opção ou de um valor só muda num rascunho (P12, decidido
  (Diogo, 05/10/2026: *«não, bloqueia fora do rascunho»*)); a ordem muda sempre;
- apagar uma opção num rascunho verifica as combinações (não pode deixar duas
  variantes iguais);
- os valores de uma variante dão-se ao criá-la; depois só mudam num rascunho
  (depois de vendida, a variante não muda de identidade);
- num rascunho a combinação pode estar incompleta; activar ou repor o artigo
  exige-a completa; num artigo que já não é rascunho verifica-se no fim de cada
  transacção (uma variante nova entra já com todos os valores);
- nomes de opção únicos no artigo, valores únicos na opção, sem distinguir
  maiúsculas (como o SKU, P9); até 100 caracteres;
- as verificações das combinações correm uma vez por artigo e por transacção,
  numa fila por artigo e por comerciante, e assumem o isolamento READ
  COMMITTED da API (em REPEATABLE READ, duas transacções ao mesmo tempo podiam
  não se ver). Ordem dos bloqueios: a linha do artigo, a fila do comerciante
  (kits), a fila do artigo (opções). O repositório segue-a: criar uma opção
  toma a linha do artigo antes da fila, e dar valores toma a fila antes de
  prender linhas (os triggers só a tomam depois de prender a linha que
  mudam). Por SQL directo, fora do repositório, a ordem pode inverter-se (por
  exemplo, apagar uma variante de um rascunho contra dar-lhe valores); se duas
  transacções esperarem uma pela outra, o erro é `catalog.retry` e nada fica
  gravado. A tabela interna das marcas limpa-se ao marcar, com melhor esforço:
  uma transacção longa em qualquer base do servidor atrasa a limpeza, sem dano.

### 3.4 Composição — kits e coleções (`cmp_`)

Uma variante pode ser composta: tem componentes, que são outras variantes.

| Campo | Notas |
|---|---|
| `variante_id` | o kit |
| `componente_variante_id` | uma variante do mesmo comerciante; **não pode ser o próprio kit nem conter o kit** (sem ciclos, **proposta**) |
| `quantidade` | inteiro > 0 |

Regras da parte 2a do código (**proposta**, salvo a dos ciclos, que já estava
aqui):

- sem ciclos, a nenhum nível; um kit dentro de outro kit é permitido;
- um componente **novo** tem de ser uma variante **activa**; arquivar depois
  um componente é permitido (C6) — o kit fica e o Stock dá-o sem
  disponibilidade; ao mudar a lista, um componente arquivado que já estava no
  kit pode ficar (só os que entram de novo têm de estar activos);
- a composição de uma variante **arquivada** não muda (arquivada é final);
- uma variante que é componente de um kit **não se apaga** (só se apagam
  variantes de rascunhos); apagar o rascunho do kit leva a composição, com o
  kit e os componentes no mesmo artigo por qualquer ordem, e também com o kit
  arquivado (P8). Fora de apagar o rascunho, a composição de um kit arquivado
  não muda, nem num rascunho (nem esvaziá-la). **Limitação conhecida:** o
  rascunho de um artigo cuja variante está no kit de **outro** artigo só se
  apaga depois de a tirar desse kit (um rascunho não se arquiva);
- a quantidade de um componente é um inteiro > 0, **sem limite máximo** (se o
  Stock precisar de um, decide-se lá);
- a lista substitui-se inteira, pela ordem dada; lista vazia = deixa de ser kit;
- um componente pode ser de qualquer artigo do mesmo comerciante, também do
  próprio artigo do kit;
- as escritas de kits de um comerciante ficam numa fila (bloqueio por
  comerciante). Uma escrita por SQL directo com o comerciante de **outro** é
  recusada pelo RLS, mas antes pode esperar pela fila dele (cerca de 600 ms,
  medido na revisão do #81); não a prende, porque o erro larga os bloqueios.
  Pelo repositório não se chega lá. (O comentário da 0004 diz só «não prende a
  fila»; a 0004 já está aplicada e não se reescreve.)

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

#### Classificação do artigo

Decisão do Diogo, 05/10/2026 (*«podemos classificar já»*, Q2 do
`docs/16-auditoria-das-skills.md`): o `bilhete` e o `servico` não ficam
desligados; **classificam-se**, e **sem classificação nenhum artigo se
publica** (`eurolify-sector-compliance-eu`, ponto 4; `digital-products-eu`,
«Primeira regra»). Vale para todos os tipos, não só para estes dois.

Quem classifica é o **comerciante** (ou quem ele autorizar), na ficha; o
Eurolify guarda **valor, quem e quando** e não decide por ele. As três
classificações guardam-se **à parte** e **uma não se deduz da outra**
(`digital-products-eu`, «Primeira regra»).

| Campo | Valores | Notas |
|---|---|---|
| `familia_setorial` | as 27 famílias de `eurolify-legal-briefing-eu/references/sectors.md` (tabela «Famílias», contada a 05/10/2026) + `por_classificar`, que é a 28.ª linha dela («qualquer família não classificada») | um artigo pode ter **mais de uma** família (ex.: um kit de manicure com lâmpada: cosmética + electrónica); `por_classificar` nunca vale «retalho geral» (`sectors.md`, introdução) |
| `natureza_consumidor` | `bem`, `servico_presencial`, `servico_humano_a_distancia`, `acesso_com_data`, `conteudo_digital`, `servico_digital`, `vale` | os três do digital são os da `digital-products-eu`; `acesso_com_data` é a entrada num evento, sessão ou actividade com **data ou período marcado**; `vale` é do cartão-oferta |
| `natureza_iva` | lista do Motor de IVA (por desenhar) + `por_classificar` | separada da do consumidor; um serviço humano à distância **não** é por isso serviço electrónico (`digital-products-eu`) |
| `data_prestacao` | data/hora de início e fim, com fuso | obrigatória no `acesso_com_data` e no `servico_presencial` com data marcada; é o que distingue um bilhete de um vale |
| `local_prestacao` | país (e território) onde o serviço é prestado ou o evento acontece | obrigatório no `servico_presencial` e no `acesso_com_data` |
| `classificado_por`, `classificado_em` | | entram na linha do tempo (C7); mudar a classificação de um artigo publicado **volta a verificar** a publicação (C2) |

**Que natureza cada tipo admite** (as outras combinações são recusadas pelo
servidor):

| Tipo | Naturezas admitidas |
|---|---|
| `fisico` | `bem` |
| `servico` | `servico_presencial`, `servico_humano_a_distancia` |
| `bilhete` | `acesso_com_data` |
| `digital` (desligado, P3) | `conteudo_digital`, `servico_digital` |
| `cartao_oferta` (desligado, P3) | `vale` |

**Bloqueia a publicação** (novos impedimentos da C2):
`classificacao_em_falta` (família `por_classificar` ou natureza em falta);
`natureza_incompativel` (fora da tabela acima); `data_ou_local_em_falta`;
`familia_restrita` — as famílias que a `sectors.md` manda bloquear por
omissão ou que exigem autorização (medicamentos, dispositivos médicos,
biocidas e fitofármacos, álcool e tabaco, armas, explosivos e jogo, saúde e
profissões reguladas — lista **proposta**, a confirmar pelo Diogo ou pelo Bruno) **não se publicam** até haver o desenho e a validação
profissional delas (`eurolify-sector-compliance-eu`, pontos 4 e 6).

**O que a classificação ainda não decide — tudo C, não verifiquei** (o
EUR-Lex não abriu nesta sessão, 05/10/2026). Nada disto chega a um ecrã ou a
uma decisão de IVA sem passar a W com o texto lido ou ser validado:

| Pergunta | Para quem |
|---|---|
| Um `acesso_com_data` de lazer está fora da livre resolução (excepção da Dir. 2011/83/UE para actividades de lazer com data marcada)? Que alínea, e com que redacção em cada país? | jurista |
| Um `servico_presencial` ou `servico_humano_a_distancia` começado dentro do prazo: que pedido expresso e que pagamento proporcional se pedem ao consumidor? | jurista |
| Onde se tributa a entrada num evento e um serviço humano à distância (lugar da prestação), para consumidor e para empresa? | contabilista |
| O bilhete comprado para outra pessoa: quem é o consumidor e quem é faturado (lição 1.2 do `docs/04`) | jurista + contabilista |

Até haver resposta: o `bilhete` e o `servico` publicam-se **sem nenhuma
excepção à livre resolução** e o IVA deles espera pelo Motor de IVA e pelo
contabilista — não se aplica nenhuma excepção nem regra especial por conta
própria («Nunca inventar», `AGENTS.md`).

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
| rascunho | activo | activar; exige SKU e unidade em todas as variantes e **pelo menos uma variante activa** (**proposta**) | pode publicar-se |
| activo | arquivado | arquivar | **todas as publicações passam a arquivado**, com o motivo «artigo arquivado» |
| arquivado | activo | repor; exige, como activar, **pelo menos uma variante activa** (**proposta**) | as publicações **não voltam sozinhas**: publicam-se outra vez, com nova verificação (**proposta**) |

Não se apaga um artigo que já esteve activo: arquiva-se (o rasto alimenta
preços, IVA e conformidade, `catalog-pim`, regra 7). Apagar só um rascunho que
nunca foi activo (**proposta**).

Depois de activo, arquivar a última variante activa **é permitido** (C6): o
artigo fica activo sem variantes activas e não se pode publicar até ter uma
(**proposta**). Pedir o estado em que o artigo já está não muda nada, nem a
versão.

Um artigo arquivado **pode receber variantes novas**, e repõe-se como os
outros (decisão do Diogo, 05/10/2026, revisão do #78, opção a). Sem isto, um
artigo com todas as variantes arquivadas ficava preso: não voltava a activo
(sem variante activa) e não recebia uma nova.

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
| C2 | **«Pode publicar?» é uma pergunta ao servidor**, que responde sim ou a lista de impedimentos com código: sem SKU, sem unidade, sem categoria fiscal, sem preço no mercado ou a 0,00 € sem ser gratuito (pergunta a Preços), atributo obrigatório em falta no mercado (pergunta à Conformidade), classificação em falta ou incompatível, ou família restrita (§3.10, «Classificação do artigo»), nome ou avisos sem tradução numa língua do mercado, media sem texto alternativo | `catalog-pim`, regra 2 e «Antes de dizer está feito»; o gel a 0,00 € seis meses e meio com 149 unidades |
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

Erros com código estável (**proposta**): `catalog.not_found` (também quando
o artigo é de outro comerciante), `catalog.sku_required`, `catalog.sku_invalid`,
`catalog.sku_duplicate`, `catalog.gtin_invalid`, `catalog.gtin_duplicate`,
`catalog.unit_required`, `catalog.option_combination_duplicate`,
`catalog.component_cycle`, `catalog.version_conflict`,
`catalog.publish_blocked`, `catalog.not_draft`, `catalog.import_invalid`.
Da parte 1 do código (também **proposta**): `catalog.invalid_transition`,
`catalog.type_disabled`, `catalog.immutable_identity`, `catalog.immutable_type`,
`catalog.no_variants`, `catalog.variant_archived_is_final`,
`catalog.name_required`, `catalog.origin_ref_required`,
`catalog.gtin_origin_required` (GTIN e origem vêm juntos),
`catalog.content_incomplete` (quantidade e unidade do conteúdo vêm juntas) e
`catalog.invalid_field` (outro valor recusado, por exemplo uma unidade que não
está na lista). Da parte 2a (também **proposta**): `catalog.component_archived`,
`catalog.component_duplicate` e `catalog.component_in_use` (apagar uma variante
que é componente de um kit). Da parte 2b (também **proposta**):
`catalog.options_incomplete`, `catalog.option_duplicate` (nome de opção
repetido no artigo), `catalog.option_value_duplicate` e `catalog.option_repeated`
(dois valores da mesma opção numa variante), `catalog.option_values_required` e
`catalog.retry` (duas transacções esperaram uma pela outra; nada ficou
gravado, tenta-se outra vez); `catalog.option_combination_duplicate` já estava
aqui.

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
  pode apontar para outro produto. A excepção da P8 (variante apagada de um
  rascunho) só é segura enquanto um rascunho não puder ter encomendas,
  reservas nem documentos: quando esses domínios existirem, têm de o garantir.
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
| P8 | Apagar uma variante de um artigo **rascunho** — também uma variante já **arquivada** — liberta o SKU dela para outra variante? (Um rascunho nunca esteve activo, por isso a variante nunca se vendeu) | ✅ **Decidido: sim, nos dois casos** (Diogo, 05/10/2026: *«sim, o SKU de um rascunho apagado pode voltar»*). É o que o código da parte 1 já faz (#78) |
| P9 | `GEL-001` e `gel-001` são o **mesmo SKU**? | ✅ **Decidido: sim, o mesmo SKU** (Diogo, 05/10/2026: *«sim, mesmo SKU»*). Guarda-se como foi escrito; a unicidade e a procura não distinguem maiúsculas (migração 0003) |
| P10 | Um artigo **sem opções** pode ter várias variantes? (O §3.2 dizia que tinha uma; o código da parte 1 deixa várias, como `GEL-001` e `GEL-REFILL`) | ✅ **Decidido: sim** (Diogo, 05/10/2026: *«sim, um artigo sem opções pode ter várias variantes»*). A regra «a combinação não se repete» só vale para artigos com opções |
| P11 | O `bilhete` e o `servico` à distância ficam desligados até terem classificação, ou classificam-se já? (Q2 do `docs/16`) | ✅ **Decidido: classificam-se já** (Diogo, 05/10/2026: *«podemos classificar já»*); sem classificação nenhum artigo se publica — §3.10, «Classificação do artigo» |
| P12 | Num artigo já à venda, pode mudar-se o **texto** de uma opção ou de um valor (ex.: corrigir «Vermleho»)? | ✅ **Decidido: não** (Diogo, 05/10/2026: *«não, bloqueia fora do rascunho»*). Só num rascunho; a ordem muda sempre. Se fizer falta corrigir gralhas, abre-se depois com o registo de quem mudou o quê (C7) |
