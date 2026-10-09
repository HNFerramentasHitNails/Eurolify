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
  e acrescentar um valor tomam a linha do artigo (KEY SHARE) antes da fila
  (revisão do #161, 2.ª, P3-N3), e dar valores a uma variante toma a fila
  antes de prender linhas (os triggers só a tomam depois de prender a linha que
  mudam). Por SQL directo, fora do repositório, a ordem pode inverter-se (por
  exemplo, apagar uma variante de um rascunho contra dar-lhe valores, ou
  apagar uma opção contra acrescentar-lhe um valor — a futura função de apagar
  opções tem de tomar a fila do artigo antes de prender a linha); se duas
  transacções esperarem uma pela outra, o erro é `catalog.retry` e nada fica
  gravado. A tabela interna das marcas limpa-se ao marcar, com melhor esforço:
  uma transacção longa em qualquer base do servidor atrasa a limpeza, sem dano.

### 3.4 Composição — kits e coleções (`cmp_`)

Uma variante pode ser composta: tem componentes, que são outras variantes.
Numa colecção, cada componente leva a sua fórmula (`catalog-pim`: uma
colecção pode levar várias fórmulas; a fórmula é da Conformidade, P2).

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
  não muda, nem num rascunho (nem esvaziá-la; esvaziar uma composição que
já está vazia não muda nada, por isso não se recusa). **Limitação conhecida:** o
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
| `texto_alternativo` | traduzível; **obrigatório para publicar** (decidido: Diogo, 08/10/2026, `docs/06`, CR; o texto alternativo por língua vem da `catalog-pim`, «acessibilidade») |
| `posicao`, `principal` | uma só principal por artigo |

**A media em código** (08/10/2026; pedido do Diogo: «sim, fica a (a); avança
com as imagens»; `docs/06`, CQ). As marcadas **proposta** são desta parte:

- **Onde:** os ficheiros guardam-se numa pasta do disco (`MEDIA_PASTA`), uma
  subpasta por comerciante, com o nome igual ao resumo SHA-256 do conteúdo.
  O mesmo ficheiro enviado duas vezes fica uma vez. O acesso passa por uma
  interface (`Armazenamento`): mudar para um serviço europeu de ficheiros é
  outra implementação, sem mudar as rotas. Sem `MEDIA_PASTA`, as rotas da
  media não existem.
- **O que entra:** só imagens JPEG, PNG e WebP (**proposta**), confirmadas
  pelos primeiros bytes do ficheiro, que têm de bater com o `Content-Type`
  do envio; até 10 MB cada (**proposta**). Sem SVG (pode levar código), sem
  vídeo por agora.
- **Limites** (revisão do #176, **proposta**): 1 GiB de imagens por
  comerciante. A ordem do envio conta (2.ª revisão do #176, P1-N1): primeiro
  a chave de idempotência (uma chave já usada não escreve no disco), depois
  o registo, numa fila por comerciante, que confere o espaço (acima dele,
  `catalog.media_quota_exceeded`, 409, **proposta**: não se resolve a
  tentar outra vez, ao contrário do 409 da versão), e só então os bytes no
  disco; se a gravação falhar, o registo desfaz-se. A gravação corre com a fila do
  comerciante tomada e uma ligação à base aberta (3.ª revisão do #176,
  P2-2): um segundo envio do mesmo comerciante espera por ela até 5 s
  (`lock_timeout`) e depois dá 503 `catalog.retry`; a reserva da chave de
  idempotência dura 60 s, e uma gravação mais lenta do que isso pode deixar
  outro pedido tomar a chave (a transacção desfaz-se e o ficheiro fica sem
  registo, fora do espaço); as ligações à base são 10 (`ligacao.ts`), e com
  2 envios por comerciante, cinco comerciantes a enviar ao mesmo tempo
  ocupam-nas todas enquanto gravam. Num disco lento, grava-se o temporário
  antes da fila e faz-se só a mudança de nome dentro dela. Duas faltas
  conhecidas (4.ª revisão do #176): o pool de ligações não tem tempo máximo
  de espera, por isso com as 10 ligações ocupadas os pedidos de todos os
  comerciantes esperam sem limite; e um cliente que mande o corpo devagar,
  sem cortar, ocupa um lugar de envio até ao tempo do Node (300 s por
  omissão), e com a chave de um comerciante bloqueia os envios dele. No máximo 2 envios do mesmo
  comerciante ao mesmo tempo (o terceiro dá 429 antes de se ler o corpo:
  cada envio ocupa até 10 MB de memória). O ficheiro escreve-se ao lado,
  assegura-se no disco (`fsync`) e só depois muda de nome; um ficheiro com
  o nome certo e outro tamanho (uma escrita cortada) escreve-se outra vez.
- **Como:** `POST /media/uploads` recebe os bytes e devolve o ficheiro
  (`fil_` e o resumo); `POST /products/{id}/media` liga-o ao artigo (e, se
  se quiser, a uma variante dele), com o texto alternativo e a posição;
  `PATCH /media/{id}` muda o texto alternativo, a posição ou a principal;
  `DELETE /media/{id}` tira-a do artigo; `GET /products/{id}/media` lista
  e `GET /media/{id}/file` devolve os bytes. Marcar uma como principal tira
  a marca à que a tinha.

**Em código** (09/10/2026; migração 0035; issue #179; `docs/06`, CV):
`catalogo/sem-metadados.ts` (os metadados), `catalogo/limpeza-ficheiros.ts`
(a limpeza, agendada em `servidor.ts`), o aviso na `eurolify-verificacao`, e
as imagens de teste em `apps/api/test/imagens/` (geradas por `gerar.py`,
inventadas).

**Faltas conhecidas da media** (08/10/2026; a 2.ª e a 3.ª resolvidas a
09/10/2026, acima):

- O texto alternativo é só o da língua de origem: as traduções dele entram
  depois. O «obrigatório para publicar» verifica-se desde 08/10/2026 (C2;
  `docs/06`, CR) só nessa língua; num mercado com outra língua e com
  imagens, a verificação diz `nao_verificado: traducao_do_texto_alternativo`.
- **Os metadados das fotografias** saem ao receber desde 09/10/2026 (abaixo,
  #179). As próprias imagens podem mostrar pessoas (um rosto é um dado
  pessoal): isso não se resolve tirando metadados, e fica com o comerciante e
  com a pergunta ao jurista (abaixo). Os ficheiros que já estavam no ensaio
  antes disso são imagens de teste e ficam como estavam.
- **Um ficheiro que deixa de estar ligado a qualquer artigo** sai ao fim de 7
  dias desde 09/10/2026 (abaixo, #179), e o espaço volta. Um ficheiro
  gravado sem registo só fica se o COMMIT falhar depois da gravação; esse
  não conta para o espaço e a limpeza não o vê (fica para depois).
- **Na VPS do ensaio (Reino Unido, ADR-0018) só entram imagens de teste,
  sem dados pessoais** (ADR-0019; `docs/06`, CQ).
- Quem enviou ou ligou a imagem fica na linha do tempo (§3.12, migração 0033).
- Sem dimensões nem miniaturas: a montra recebe a imagem como foi enviada.

#### Metadados, pessoas nas imagens e ficheiros sem uso (issue #179)

**Desenho de 09/10/2026** (Diogo: *«sim, avança com o desenho da #179»*;
aprovado: *«sim, aprovo; avança com o código da #179»*; `docs/06`, CV). Os 7
dias e os 500 ficheiros por volta são **proposta**. Prazo do issue: antes da
primeira imagem real, e o mais tardar a 31/03/2027 (ADR-0019).

**1. Tirar os metadados ao receber.** Ex.: uma fotografia do «Gel UV» tirada
com um telemóvel traz, no EXIF, a latitude e a longitude da casa de quem a
tirou, a data e o modelo do aparelho. Guarda-se sem nada disso.

- **Como:** o próprio Eurolify percorre o ficheiro e deixa de fora os
  blocos de metadados, **sem voltar a codificar a imagem** (a imagem fica
  igual, pixel a pixel; não há perda de qualidade). Sem biblioteca de fora:
  como o ZIP da exportação (§3.11), são poucas regras de formato, e evita-se
  uma dependência nativa na VPS. A alternativa, uma biblioteca que volta a
  codificar a imagem (ex.: `sharp`, sobre a `libvips`), fica para quando
  houver miniaturas.
- **O que sai e o que fica, por formato:**

  | Formato | Sai | Fica |
  |---|---|---|
  | JPEG | APP1 (EXIF e XMP), APP13 (IPTC), os outros APPn que não são precisos para mostrar a imagem, comentários (COM) | APP0 (JFIF), APP2 só com o perfil de cor (ICC), APP14 (Adobe, conversão de cor), as tabelas e a imagem; a **orientação** do EXIF passa para um EXIF novo, só com ela |
  | PNG | `tEXt`, `zTXt`, `iTXt`, `eXIf`, `tIME` | os blocos da imagem e da cor (`IHDR`, `PLTE`, `IDAT`, `IEND`, `tRNS`, `iCCP`, `sRGB`, `gAMA`, `cHRM`, `sBIT`, `pHYs`, `bKGD`) |
  | WebP | `EXIF`, `XMP ` (e a marca deles no `VP8X`) | a imagem, a animação, a transparência e o perfil de cor (`ICCP`) |

- **A orientação** fica no JPEG porque, sem ela, uma fotografia tirada com o
  telemóvel ao alto aparecia deitada. É o único campo que passa, num EXIF
  novo escrito pelo Eurolify. No WebP não passa (**não verifiquei** quantos
  navegadores a aplicam no WebP).
- **Um ficheiro que não se consegue percorrer até ao fim** (cortado, com um
  bloco de tamanho errado, um bloco crítico desconhecido no PNG) **recusa-se**
  com 400 `request.invalid`, como os bytes que não são imagem: nunca se
  guarda uma imagem que não se conseguiu limpar.
- **O resumo** (`fil_`, o nome no disco, o espaço contado) passa a ser o dos
  bytes **já limpos**: o mesmo ficheiro enviado uma vez com GPS e outra sem
  ele fica um ficheiro só. A idempotência do envio continua a contar com os
  bytes recebidos.
- **Os ficheiros que já estão no ensaio** não se limpam: são imagens de
  teste, sem dados pessoais (ADR-0019; `docs/06`, CQ). Se alguma vez lá
  entrar uma imagem real, apaga-se.
- **Teste:** uma fotografia com GPS enviada pela API sai de
  `GET /media/{id}/file` sem o GPS e com a orientação; um PNG com texto e
  um WebP com EXIF saem sem eles; um ficheiro cortado dá 400. Os blocos da
  imagem ficam iguais byte a byte (o varrimento do JPEG, os IDAT do PNG), e
  ficam o perfil de cor, a conversão CMYK (Adobe), os reinícios, a
  transparência e as molduras de uma animação. Os pixels comparam-se
  descodificando a imagem antes e depois **quando a máquina tem o Python
  com o Pillow** (no ambiente de quem escreveu, sim; no CI, o teste diz se
  correu); sem ele, só fica a prova pelos blocos.
- **O que ainda passa** (revisão do #215, P3-4): o perfil de cor (ICC, até
  64 KB por segmento), as paletas sugeridas do PNG (`sPLT`) e os dados de
  cada moldura de uma animação. Não são metadados de quem tirou a
  fotografia, mas não se escreve «sem metadados nenhuns».
- **A orientação** do PNG (`eXIf`) e do WebP sai com o resto (P3-5): uma
  fotografia de telemóvel convertida para PNG ou WebP com a orientação só
  no EXIF pode aparecer rodada. **Não verifiquei** quantos navegadores a
  aplicam nesses formatos.

**2. Pessoas nas imagens.** Tirar os metadados não resolve uma imagem que
mostra uma pessoa (um rosto, uma mão com uma tatuagem, um modelo a usar o
artigo): a imagem em si é um dado pessoal dessa pessoa. O desenho:

- **Quem decide é o comerciante.** As imagens são do catálogo dele; o
  Eurolify guarda-as e mostra-as por conta dele (subcontratante, como em T2
  do `docs/17`). A autorização da pessoa que aparece (o modelo, um
  funcionário) é do comerciante. Ver se basta o acordo de tratamento de dados
  (`acordo_tratamento_dados`) ou se os termos do serviço precisam de uma
  cláusula própria sobre imagens com pessoas é uma pergunta para o jurista
  (`docs/12`, B, ponto 8), **C**.
- **O que o Eurolify faz:** guarda na UE (`AGENTS.md`), tira os metadados
  (acima), apaga quando o comerciante tira a imagem (abaixo, ficheiros sem
  uso) e quando a conta acaba (`docs/17` §3, por desenhar), e a imagem não
  vai para nenhum serviço de fora (nem para reconhecer rostos, nem para
  treinar nada).
- **O que não faz:** não detecta rostos nem decide se uma imagem pode ser
  publicada. Uma regra destas sem fonte seria inventada.
- **Registo:** uma linha nova no `docs/17` (T9, imagens do catálogo).

**3. Ficheiros sem uso.** Ex.: o comerciante envia três fotografias do
«Gel UV», liga duas ao artigo e apaga uma delas mais tarde. A que nunca
foi ligada e a que foi desligada saem do disco ao fim de **7 dias** sem uso
(**proposta**), e o espaço volta.

- **Sem uso** é um `ficheiro` sem nenhuma `media` que o use, em nenhum
  artigo. Uma tabela interna, `ficheiro_sem_uso`, diz desde quando: os
  gatilhos põem a linha ao gravar o ficheiro e quando a última `media` dele
  sai, e tiram-na quando uma `media` o liga. A API não lhe toca. Fica à parte
  da `ficheiro` (que tem o RLS forçado) para a função que diz que
  comerciantes têm ficheiros a apagar os ver a todos, só com os
  identificadores.
- **Enviar outra vez** os mesmos bytes de um ficheiro sem uso volta a contar
  os 7 dias (quem o envia vai ligá-lo); corre na mesma fila que a limpeza,
  por isso ou a limpeza já o apagou e o envio grava de novo, ou o envio
  renovou e a limpeza não o apaga.
- **Os 7 dias** dão tempo para ligar a imagem depois de a enviar e para
  voltar atrás num engano. Não há forma de recuperar uma media apagada; os 7
  dias são só para o ficheiro.
- **Quem apaga:** a própria API, uma vez por dia (ao arrancar e depois de 24
  em 24 horas), e não o script `eurolify-limpeza` da VPS. Só a API pode
  tomar a fila dos envios de cada comerciante (o bloqueio
  `eurolify.ficheiro:<comerciante>` de `registarFicheiro`), e é isso que
  impede apagar um ficheiro que está a ser enviado outra vez no mesmo
  momento. Para cada comerciante com ficheiros sem uso há mais de 7 dias, e
  até 500 por vez: toma a fila, apaga a linha (só se continuar sem
  `media`; a chave estrangeira da `media` recusa o resto), apaga o ficheiro
  do disco e confirma. Se o disco falhar, a transacção desfaz-se e o
  ficheiro fica para o dia seguinte. Se a confirmação falhar depois de o
  disco apagar, fica uma linha sem ficheiro, ainda sem uso: o dia seguinte
  apaga-a; até lá, um envio dos mesmos bytes volta a escrevê-lo (o ficheiro
  com o nome certo que falta escreve-se outra vez).
- **Vários comerciantes:** a lista dos que têm ficheiros a apagar vem de uma
  função da base com os direitos do dono, que só devolve os
  identificadores; o resto corre no contexto de cada um (RLS).
- **Não fica em silêncio** (`observability-security`): cada volta deixa no
  registo quantos ficheiros apagou e de quantos comerciantes; a verificação
  diária das 07:00 (`eurolify-verificacao`) avisa se houver ficheiros sem
  uso há mais de 9 dias (a limpeza parou).
- **As cópias:** um ficheiro apagado continua nas cópias da VPS até elas
  rodarem (14 dias, `docs/11`).
- **Fora:** os ficheiros gravados sem linha (só se o COMMIT do envio falhar,
  acima). São raros; uma volta que compare o disco com a tabela fica para
  depois.
- **Teste:** um ficheiro sem uso há 8 dias sai do disco e da tabela e o
  espaço volta; um com 6 dias fica; um ligado a uma media fica; um envio dos
  mesmos bytes ao mesmo tempo que a limpeza acaba com o ficheiro no disco e
  a linha na tabela (as duas, ou nenhuma).

### 3.6 Categoria (`cat_`)

Árvore de navegação: `pai_id`, `nome` e `endereco_amigavel` traduzíveis,
`posicao`. Sem ciclos. Arquivar uma categoria não arquiva os artigos.

Regras da parte 3a do código (migração 0007; as marcadas **proposta** são
dela):

- uma categoria nasce activa; arquivar e repor são livres; arquivar não tira
  os artigos da categoria;
- uma categoria activa não fica dentro de uma arquivada, e uma categoria com
  subcategorias activas não se arquiva: arquiva-se de baixo para cima e
  repõe-se de cima para baixo (**proposta**: na loja, a subcategoria ficava
  sem caminho);
- um artigo só entra numa categoria activa; uma arquivada que o artigo já
  tinha fica quando se muda o resto da lista (**proposta**, como os
  componentes dos kits, §3.4);
- mudar as categorias de um artigo é uma escrita do artigo: leva a versão
  lida e sobe-a (só se a lista mudou);
- categorias e colecções **não se apagam**: arquivam-se (**proposta**, o rasto
  da `catalog-pim`, regra 7);
- o endereço amigável é obrigatório, até 100 caracteres, em minúsculas
  **sem acentos**, algarismos e hífenes (ex.: `unhas-de-gel`), e único por
  comerciante entre as categorias e, à parte, entre as colecções, também as
  arquivadas (**proposta**: um endereço antigo não passa a mostrar outra
  coisa). Limitação: numa língua com outro alfabeto (grego, búlgaro) o
  endereço da língua de origem fica transliterado; os endereços por língua
  são da parte 3b (traduções);
- as escritas nas categorias de um comerciante passam por uma fila só delas
  (o ciclo e as subcategorias activas olham para várias linhas). O
  repositório entra na fila **antes** de prender a linha da categoria; ao
  contrário, uma escrita de B e a criação de uma filha de B esperavam uma
  pela outra (a chave estrangeira da filha pede a linha de B; revisão do #97,
  P1-1);
- a versão de uma categoria ou de uma colecção só sobe quando algo muda: um
  valor igual ao actual, ou o pai que já tinha, não conta;
- substituir as categorias de um artigo ou os artigos de uma colecção não
  entra na fila: prende a linha do artigo (ou da colecção); os artigos de
  uma colecção levam `KEY SHARE`, e uma categoria nova leva `FOR SHARE` (lê
  o estado e espera por quem a esteja a arquivar; parte 3b, 2.ª revisão do
  #97, P3-A). Nenhum destes choca com a fila, que só as escritas nas
  categorias tomam;
- os ids comparam-se em minúsculas (o mesmo uuid em maiúsculas é o mesmo id),
  e alterar ignora campos fora da lista; a validação do corpo dos pedidos fica
  na camada da API, quando existir (2.ª revisão do #97, P3-B e P3-C).

### 3.7 Colecção (`col_`)

Lista **manual** de artigos, com ordem: `nome` e `descricao` traduzíveis,
`artigos` (lista ordenada). As colecções por regra ficam para depois (§1).

Na parte 3a do código (migração 0007): `endereco_amigavel` com as regras da
categoria (§3.6), estado activa ou arquivada, versão. A lista substitui-se
inteira, pela ordem dada, sem repetidos, e sobe a versão da colecção (só se a
lista ou a ordem mudaram). Qualquer artigo pode entrar, em qualquer estado: a
loja só mostra os publicados (§7.2). A lista de uma colecção arquivada também
se muda (**proposta**: prepara-se antes de a repor). Apagar o rascunho de um artigo tira-o das
categorias e das colecções.

### 3.8 Tradução

Uma linha por **recurso × campo × língua** (`catalog-pim`, regra 5;
`eu-localization`). O original está na **língua de origem do comerciante**,
uma só para todo o catálogo (P13); não há tradução para a própria língua de
origem.

| Campo | Notas |
|---|---|
| `recurso_id`, `campo`, `lingua` | ex.: `prd_…`, `descricao`, `es` |
| `texto` | |
| `estado` | completa, desactualizada, em falta (§4.3) — **calculado**, não guardado (abaixo) |
| `original` | o texto do original quando se traduziu, posto pela base (**proposta**, em vez de `versao_do_original`, abaixo) |
| `origem` | pessoa ou proposta de IA. Uma proposta de IA **não se publica** em textos legais nem em avisos de segurança sem revisão de uma pessoa (`eu-localization`) |
| `traduzido_por`, `traduzido_em` | |
| `revisto_por`, `revisto_em` | só numa proposta de IA: a pessoa que a reviu (**proposta**) |

As traduções **vivem no Eurolify**, nunca numa app de terceiros (`catalog-pim`,
regra 5).

Na parte 3b do código (migração 0009; as marcadas **proposta** são dela):

| Recurso | Campos traduzíveis |
|---|---|
| artigo | `nome`, `descricao` |
| opção | `nome` |
| valor da opção | `valor` |
| categoria | `nome`, `endereco_amigavel` |
| colecção | `nome`, `descricao`, `endereco_amigavel` |

(Os `avisos` do artigo e o texto alternativo da media entram com esses campos.)

- **Desactualizada por campo, não pela versão do recurso (proposta).** A
  `versao` do artigo sobe com qualquer mudança (estado, categorias): com ela,
  activar um artigo marcava todas as traduções como desactualizadas. A base
  guarda, com a tradução, o texto do original nesse momento; a tradução está
  **completa** se o original ainda é esse texto, **desactualizada** se mudou
  (ou se o original ficou vazio) e **em falta** se não há tradução nessa
  língua para um campo com original. O estado calcula-se ao ler, por isso
  nunca fica para trás. O «avisa» da C5 chega com os eventos (parte 5);
  até lá, a fila de traduções (§7.1) mostra-o.
- Não se traduz para a língua de origem do comerciante, nem um campo sem
  original (ex.: um artigo sem descrição).
- A **língua de origem passa da loja para o comerciante** (P13). Os
  comerciantes que já existem ficam com a da primeira loja ou, sem loja, com
  a `lingua` do Hub; um comerciante novo, se não a disser, fica com a do Hub
  (**proposta**; é a base que o põe). Depois de o comerciante ter catálogo
  (um artigo, uma categoria ou uma colecção), a língua de origem **não muda**
  (**proposta**: os originais e as traduções ficavam trocados); criar o
  primeiro artigo, categoria ou colecção espera por quem a esteja a mudar, e
  vice-versa (revisão do #105, P1-1).
- A migração 0009 **pára** se um comerciante tiver lojas em línguas diferentes
  (aplicada na VPS a 06/10/2026 sem parar; o passo abaixo só serve a uma
  base que ainda não a tenha):
  uma pessoa decide a língua de origem dele antes (revisão do #105, P3-A).
  A mensagem da paragem diz os ids. O passo da pessoa, com o Diogo ou o
  Bruno a decidir a língua: por um pedido de alteração revisto (ADR-0028),
  uma migração própria que corra antes da 0009 (o migrador ordena pelo nome:
  por exemplo `0009_acertar_linguas_das_lojas.sql`), que põe a
  `loja.lingua_origem` das lojas desse comerciante na língua decidida (com
  `set_config('eurolify.comerciante', <id>, true)`, por causa do RLS
  forçado), com a cópia antes (AGENTS.md, «Operar a VPS», regra 2).
- **Ordem dos bloqueios com o comerciante:** criar catálogo prende a linha do
  comerciante (`FOR SHARE`). Numa mesma transacção, **o comerciante altera-se
  antes de se criar catálogo, nunca depois**: duas transacções que criam
  artigos e depois alteram o comerciante esperam uma pela outra (medido na
  2.ª revisão do #105, P2-1). Hoje nenhum código o faz; vale para as
  importações (§3.11) quando existirem.
- A `loja.lingua_origem` ficou, sem obrigação e sem uso, para a versão
  anterior da aplicação poder voltar (`infra/vps/LEIA-ME.md`, migrações
  compatíveis; revisão do #105, P2-4) e **saiu na migração 0011** (tarefa
  #109, 06/10/2026), antes da data de fim de 31/10/2026.
- As línguas são códigos de duas letras minúsculas, como a `lingua` do
  comerciante (**proposta**; a lista das línguas de cada mercado é de Preços
  e mercados, `eu-localization`).
- Quem traduz vem da sessão (`eurolify.quem`, como na classificação); a data
  é da base. Traduzir outra vez substitui o texto, a origem e quem, e apaga a
  revisão. Só uma proposta de IA se revê; quem a traduziu não a revê; uma
  revisão não se repete (se o original mudou, traduz-se ou confirma-se outra
  vez; revisão do #105, P2-1 e P2-2). Estas regras vivem na base e no
  repositório; pela API de chaves não se revê (`docs/06`, CO).
- Quem traduz diz o **original que viu**; se já não é o de agora, a tradução
  é recusada com `catalog.version_conflict` (como a escrita do artigo com a
  versão antiga; revisão do #105, P2-3). Esta comparação vive no
  repositório (a base não sabe o que o chamador viu): só o repositório
  escreve traduções; quem tivesse as credenciais da base podia confirmar
  uma tradução sem a comparação (2.ª revisão do #105, P3-6).
- **Pessoa ou IA** (`eu-localization`: a tradução por IA é proposta, revista
  por uma pessoa): a base não sabe quem é pessoa. A `origem` e o «é uma
  pessoa» de quem revê vêm da **conta que chama** (pessoa ou agente), nunca
  do corpo do pedido, e um agente não revê (revisão do #105, P2-2). Na API
  de chaves (#166): o que se traduz fica sempre `ia` e não se revê; as
  traduções de pessoa e as revisões entram pelo Hub (`docs/06`, CO e CP).
- Limites (**proposta**): nomes e valores traduzidos até 200 caracteres,
  descrições até 20 000.
- O texto anterior de cada tradução (C7, «antes e depois») fica na linha do
  tempo desde a migração 0033 (§3.12): traduzir outra vez ou apagar deixa o
  texto antes e depois (revisão do #105, P3-F).
- O endereço amigável traduzido segue o formato do original (§3.6) e é único
  por comerciante e por língua, entre as categorias e, à parte, entre as
  colecções.
- Apagar o recurso apaga as traduções dele.

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
| `motivo_arquivo` | retirada, artigo arquivado, mercado arquivado, canal arquivado (código, migração 0019) ou verificação falhada (`verificacao_falhou`, migração 0023; `docs/06`, CJ) |

**Em código** (migração `0019_catalogo_publicacao.sql` e
`apps/api/src/catalogo/publicacao.ts`, 06/10/2026, #77):

- **Onde pode existir.** Uma publicação nasce num par canal × mercado em
  que o canal vende, e nunca para um artigo em rascunho: um rascunho
  apaga-se, e uma publicação não (revisão do #139, P2-5). Tirar de um canal
  um mercado é recusado só enquanto houver uma publicação **publicada**
  nesse par (`prices.channel_market_in_use`). As retiradas e os rascunhos
  ficam, como registo (decisão do Diogo, 06/10/2026, revisão do #139, P2-2,
  opção a).
- **Publicar.** Publicar corre a verificação (C2) no servidor e guarda-a na
  publicação. Antes de verificar, toma, por esta ordem, o artigo e a fila
  dele (a da 0005), o mercado, o canal, a tradução do nome, a lista de base,
  as variantes, os preços e a linha da publicação, para que ninguém os mude
  a meio: quem os muda espera, e a verificação guardada é a verdadeira
  para esse pedido (revisões do #139, 1.ª a 3.ª). É sempre a do **último
  pedido**: uma publicada com a verificação guardada com impedimentos não
  é anomalia, é um pedido recusado (abaixo; revisão do #146, 2.ª ronda,
  P3-A). Quem cria uma variante entra na mesma fila
  antes de mexer nas publicações: uma variante criada ao mesmo tempo que a
  primeira publicação espera por ela e nasce fora, ou a publicação espera e
  vê-a.
  - Sem impedimentos, passa a publicada.
  - Com impedimentos, fica como estava; a resposta diz `publicada: false` e
    traz a lista (a rota da API devolve-a como recusa, com a lista).
  - Retirar só vale para uma publicação publicada.
- **O que a base repete no instante de publicar.** A base repete o que não
  pode falhar nunca: artigo, mercado e canal activos; o canal vende no
  mercado; a última verificação sem impedimentos; pelo menos uma variante à
  venda; preço na lista de base de cada variante à venda; e peso, num artigo
  físico. Nem SQL escrito à mão pela API passa sem isto.
- **Depois de publicado**, a base não deixa:
  - tirar o preço de uma variante à venda (abaixo);
  - apagar o peso de uma variante à venda num artigo físico, nem a categoria
    fiscal do artigo (`catalog.published_in_use`; revisão do #139, P2-6).

  A classificação, o nome, a tradução do nome, a última variante à venda,
  as línguas do mercado e o texto alternativo das imagens voltam a
  verificar-se quando mudam («Reverificação», abaixo; 0023; CR).
- **Propostas desta parte** (para o Diogo ou o Bruno confirmarem):
  - o preço de uma variante à venda numa publicação publicada **não sai** da
    lista de base (`prices.published_variant`); retira-se primeiro a
    publicação;
  - uma variante nova de um artigo já publicado **nasce fora** das
    publicações publicadas, para não se vender sem verificação;
  - publicar outra vez uma publicação que tem impedimentos não lhe muda o
    estado nem as variantes à venda: uma publicada continua à venda com o
    que tinha (ex.: pôr à venda uma variante sem preço é recusado e a
    variante fica fora). A verificação guardada é a do **pedido recusado**,
    não a do que está à venda; quem a lê vê os impedimentos do pedido
    (revisão do #146, P2-1). O que está à venda passou na última verificação
    que o pôs à venda, e a reverificação tira-o se deixar de passar.
- **Reverificação** (decisão do Diogo, 07/10/2026, opção a; `docs/06`, CJ;
  migração 0023; `reverificarPublicacoes`). Cada operação que muda o que a
  verificação lê, e que a base não trava, volta a verificar as publicações
  publicadas na mesma transacção; a que deixa de passar sai de venda
  (`arquivado`, motivo `verificacao_falhou`, a verificação guardada), e o
  `arquivado_por` é quem mudou. Desde a linha do tempo (0033), uma mudança
  no artigo e nas suas tabelas traz sempre quem; o
  `catalogo:verificacao_falhou` e o `catalogo:<motivo>` dos arquivos em
  cadeia ficam só para o que vem de Preços sem quem (mercado ou canal
  arquivado, língua nova no mercado), e a linha do tempo usa-os como quem
  (revisão do #208, P1-2). O evento
  `product.unpublished` leva o motivo. Ex.: tirar a classificação de
  retalho ao «Gel» e pô-lo em álcool e tabaco tira-o de venda em todos os
  canais. As sete operações (varridas a 07/10/2026 contra a lista de
  impedimentos de `verificarNa`, e a 08/10/2026 com a media, CR):

  | Operação | Quando reverifica | O que pode partir |
  |---|---|---|
  | `alterarArtigo` | só quando muda o nome | o nome novo desactualiza as traduções |
  | `classificarArtigo` | quando a classificação muda | classificação incompatível ou família restrita |
  | `arquivarVariante` | sempre | a última variante à venda |
  | `apagarTraducao` | só a do nome de um artigo | a tradução do nome em falta |
  | `alterarMercado` (Preços) | só quando entra uma língua | uma língua nova sem o nome traduzido |
  | `criarMedia` | só quando a imagem nova não tem texto alternativo | uma imagem do artigo, ou de uma variante à venda, sem texto alternativo |
  | `alterarMedia` | só quando se tira o texto alternativo | idem |

  Só a mudança que conta reverifica (revisão do #146, P2-2 e P3-1): mudar
  a descrição, a marca, o nome do mercado ou tirar uma língua não tira de
  venda uma publicação que já falhasse por outra razão. Quando corre, reverifica
  todas as publicações publicadas do artigo ou do mercado, não só as que a
  mudança toca (ex.: arquivar uma variante que já estava fora, ou apagar o
  nome numa língua que o mercado não usa); uma publicada que já falhasse
  por outra razão sai nesse momento (revisão do #146, 2.ª ronda, P3-D).

  O resto está travado na base (preço, peso e categoria fiscal de uma
  publicação publicada; o par canal × mercado; a língua de origem depois de
  haver catálogo) ou arquiva em cadeia (artigo, mercado, canal). Duas
  mudanças que juntas partem a mesma publicação tomam ambas a linha dela
  (FOR UPDATE): a segunda verifica depois da primeira e vê as duas. Limite:
  SQL à mão que mude um destes campos não reverifica, como a C2 não corre em
  SQL à mão.
  **Duração** (medida a 07/10/2026, no PostgreSQL 18.6 local por docker, 4
  núcleos; uma língua nova num mercado em que nenhum artigo tem o nome
  traduzido, todos arquivados): 100 publicações, 0,84 s; 300 publicações,
  2,2 s (cerca de 7 ms cada). Mediu-se com um teste temporário que
  publica N artigos e cronometra `alterarMercado`; o método fica na
  memória do #146. Durante esse tempo o mercado e as publicações
  dele ficam tomados: quem quiser publicar ou mudar o mercado espera, e ao
  fim de 5 s recebe `catalog.retry` ou `prices.retry`. Pela conta (7 a 8 ms
  por publicação), entre 600 e 700 publicações chegam aos 5 s. **Não medido na VPS.** Uma língua nova
  num mercado com muitos artigos pode tirar muitos de venda de uma vez: é o
  efeito decidido (CJ). Se um mercado passar das centenas de publicações,
  esta operação passa a lotes ou a uma tarefa de fundo (por desenhar).
  Se a própria verificação der erro (hoje só com SQL à mão: uma variante
  apagada que ficou em `variantes_fora`), a operação que reverificava falha
  toda, com esse erro; `alterarMercado` pode então devolver um erro do
  Catálogo (revisão do #146, P3-3).
- **Em cadeia.** Arquivar o artigo, o mercado ou o canal arquiva as
  publicações publicadas, com o motivo, na mesma transacção (um gatilho, não
  um evento). Arquivar a **loja** ainda não tem rota (0016) e não arquiva as
  publicações dos canais e mercados dela: trata-se quando a rota existir.
- **Uma operação do Catálogo espera no máximo 5 s** por outra que tenha o
  que precisa tomado; depois recebe `catalog.retry`. Vale para todas as
  operações do Catálogo, também as leituras. As rotas da API tratam o
  `catalog.retry` como repetível.
- **Os gatilhos correm com o RLS de quem escreve.** Uma ligação de
  administração sem o comerciante posto (`eurolify.comerciante`) não vê as
  publicações. Por isso não arquiva em cadeia nem é travada pelas regras do
  peso e da categoria fiscal. Escreve-se sempre no contexto do comerciante
  (2.ª revisão do #139, P3-F).

### 3.10 Atributos regulamentares

Guardados no artigo (ou na variante, quando variam com ela), com **valor,
quem o preencheu e quando** (`product-compliance-eu`). Os grupos da Fase 1 são
os de `05-fases-e-mvp.md`: fabricante e pessoa responsável (pelo operador
económico), avisos, INCI (pela versão da fórmula) e lote (no Stock). A
**identificação do produto** que o GPSR pede na oferta online — tipo,
lote/série, foto (`docs/03` §3, **W**) — sai do tipo e das variantes, do lote
no Stock e da media (§3.5); um campo próprio de série fica para quando o
Stock a guardar. Os
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
| `familia_setorial` | as 28 famílias de `eurolify-legal-briefing-eu/references/sectors.md` (tabela «Famílias», contada a 05/10/2026; «educação e formação» separou-se de «saúde e profissões reguladas», Diogo, 05/10/2026: *«separa a educação numa família própria»*) + `por_classificar`, que é a última linha dela («qualquer família não classificada») | um artigo pode ter **mais de uma** família (ex.: um kit de manicure com lâmpada: cosmética + electrónica); `por_classificar` nunca vale «retalho geral» (`sectors.md`, introdução) |
| `natureza_consumidor` | `bem`, `servico_presencial`, `servico_humano_a_distancia`, `acesso_com_data`, `conteudo_digital`, `servico_digital`, `vale` | os três do digital são os da `digital-products-eu`; `acesso_com_data` é a entrada num evento, sessão ou actividade com **data ou período marcado**; `vale` é do cartão-oferta |
| `natureza_iva` | lista do Motor de IVA (por desenhar) + `por_classificar` | separada da do consumidor; um serviço humano à distância **não** é por isso serviço electrónico (`digital-products-eu`) |
| `data_prestacao` | data/hora de início e fim, com fuso | obrigatória no `acesso_com_data`, possível nos serviços; é o que distingue um bilhete de um vale. Guarda-se o **instante** (a hora local a mostrar, ex.: Ponta Delgada, ainda não se guarda — por decidir, revisão do #96, P2-4) |
| `local_prestacao` | país (e território) onde o serviço é prestado ou o evento acontece | obrigatório no `servico_presencial` e no `acesso_com_data` presencial; **proibido** no que é virtual ou à distância (o lugar do IVA é onde está o cliente) |
| `modo` | `presencial`, `virtual` | obrigatório no `acesso_com_data` e no `servico_humano_a_distancia` (que é `virtual`); no `servico_presencial` é `presencial`; muda o lugar da prestação para o IVA (Dir. 2006/112/CE arts. 53.º e 54.º, **W**, `docs/03` §1) |
| `lazer_com_data` | `nao` (por omissão), `sim` | o comerciante declara que é uma actividade de **lazer** com data marcada; **só com `sim` e a regra validada pelo jurista** é que se aplica a excepção à livre resolução (§ abaixo) |
| `classificado_por`, `classificado_em` | | postos pela base (o «quem» vem da transacção, como no Comerciante; até à fatia de identidade é texto declarado, sem ligação a um utilizador); entram na linha do tempo (C7); mudar a classificação de um artigo publicado **volta a verificar** a publicação (C2) e tira-a de venda se deixar de passar (0023; `docs/06`, CJ; §4.2, «Reverificação») |

**Em código** (migração `0006_catalogo_classificacao.sql`, 05/10/2026): as
famílias, a natureza para o consumidor, o modo, a data e o local, o lazer com
data e quem/quando, com as combinações abaixo recusadas pela base; os
impedimentos para publicar em `apps/api/src/catalogo/classificacao.ts`, à
espera da verificação C2 (parte 4 do #77). A `natureza_iva` espera pelo Motor
de IVA. O mesmo artigo com o tipo mudado não existe (o tipo não muda, §4.1).

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
profissões reguladas, sem a educação — lista **decidida** pelo Diogo, 05/10/2026: *«sim, aceito a lista»*) **não se publicam** até haver o desenho e a validação
profissional delas (`eurolify-sector-compliance-eu`, pontos 4 e 6).

**O que a lei diz e o que ainda falta** — pesquisa de 05/10/2026, citações
literais em `docs/eurolify/fontes-eventos-servicos-iva-05out2026.md`, marcadas
**W** no `docs/03` (texto legal não aberto nesta sessão). Nada disto chega a
um ecrã nem a uma decisão de IVA sem a validação indicada:

| Tema | O que diz (W) | O que o Eurolify faz | Falta |
|---|---|---|---|
| Lazer com data | Sem livre resolução em serviços de lazer com data marcada (Dir. 2011/83/UE art. 16.º, l); DL 24/2014 art. 17.º, 1, k)); o bilhete cabe aí (C-96/21) | **Nunca** `tem data ⇒ sem livre resolução`: só com `lazer_com_data = sim`, declarado e com rasto; por omissão o bilhete tem livre resolução | jurista valida a regra e as condições do intermediário (C-96/21, dispositivo) |
| Serviço começado no prazo | Pedido expresso + reconhecimento; perde-se só com o serviço **integralmente** prestado; proporcional se resolver antes (arts. 8.º, 8; 14.º, 3 e 4; 16.º, a); DL 24/2014 arts. 15.º e 17.º) | guarda à parte o pedido, o reconhecimento (com o texto mostrado e a data) e a prova da execução; nunca dá o direito por perdido só porque começou | jurista; o cálculo do proporcional é do domínio Encomendas |
| Lugar do IVA | Presencial: onde o evento acontece; virtual B2C: onde o cliente está (arts. 53.º, 54.º) | guarda `modo` e `local_prestacao`; quem decide é o Motor de IVA | contabilista; transposição portuguesa e taxas por verificar |
| Ensino ao vivo por vídeo | Não é serviço electrónico (Reg. Exec. 282/2011 art. 7.º, 3, j)) | `servico_humano_a_distancia` nunca vira «electrónico» por ir pela Internet | contabilista, para a consultoria por vídeo (sem alínea própria) |
| Bilhete para outra pessoa | Não há regra escrita: consumidor é quem contrata (art. 2.º, 1)); a fatura vai ao adquirente (Dir. 2006/112 art. 226.º, 5); CIVA art. 36.º) | **fora do Catálogo**: Encomendas e Clientes guardam à parte contratante, pagador, participante e dados de faturação; nunca copiar o participante para a fatura | jurista + contabilista |
| Bilhete em vez de fatura (PT) | O bilhete pode cumprir a fatura nas entradas em espectáculos e na lista do CIVA art. 40.º, 5, a) — **não** inclui expressamente workshops | nada automático; decide o domínio dos documentos fiscais | contabilista |

### 3.11 Importação (`imp_`) e exportação (`exp_`)

| Entidade | Campos | Notas |
|---|---|---|
| Importação | ficheiro, formato, `modo` (ensaio ou aplicar), `estado` (recebida, analisada, aplicada, falhou), relatório | o **ensaio** diz quantos criaria, alteraria e recusaria, e porquê; só depois se aplica. **Nunca apaga** o que não veio no ficheiro. Importar duas vezes o mesmo ficheiro não duplica nada: a chave é o SKU (`catalog-pim`, «Importação») |
| Exportação | formato aberto (CSV e JSON, **proposta**), `estado`, ficheiro | exportação **completa**: é também a saída do Data Act (`catalog-pim`); desenho abaixo |

#### Exportação do catálogo (decidido: Diogo, 08/10/2026, `docs/06`, CS; migração 0030; issue #77)

**Para quê.** O comerciante leva o catálogo inteiro para fora do Eurolify num
formato aberto, sem pedir a ninguém: para guardar, para mudar de fornecedor
(Regulamento (UE) 2023/2854, o Data Act, `docs/03` linha 118, **W**, lido só
em resumos; o que ele exige ao Eurolify está nas perguntas do jurista,
`docs/12`) e, depois, como o formato da importação. Ex.: a loja com 300
artigos pede a exportação e recebe um ZIP com os 300 artigos, as variantes,
as traduções e as imagens.

**Um recurso só para os dois documentos.** O `docs/15` §7 já tem
`POST /exports` («exportar tudo», todos os domínios, só o dono). Para não
haver dois `POST /exports`, a exportação é um recurso comum com a lista dos
domínios: `{"dominios": ["catalogo"]}`. Nesta parte só existe `catalogo`;
os outros domínios (Preços, Comerciante, e os que vierem) entram no mesmo
recurso quando tiverem a sua parte, e «exportar tudo» é pedir todos. O
âmbito pedido é o de leitura de cada domínio pedido (`catalog:read` para o
catálogo): a exportação não mostra nada que a API de leitura não mostre.

**O que leva.** Tudo o que o comerciante pôs no catálogo, em **todos os
estados** (rascunho, activo e arquivado):

| Ficheiro no ZIP | Uma linha por | Campos |
|---|---|---|
| `catalogo.json` | o catálogo inteiro (abaixo) | o mesmo que os CSV, em árvore; é **o ficheiro completo** |
| `artigos.csv` | artigo | `id` (`prd_…`), `tipo`, `estado`, `nome`, `descricao`, `marca`, `categoria_fiscal`, `origem`, `origem_ref`, `ja_esteve_activo`, a classificação (`familias`, `natureza_consumidor`, `modo`, prestação e local), `criado_em`, `actualizado_em`, `versao` |
| `variantes.csv` | variante | `id`, `artigo`, `sku`, `gtin`, `gtin_origem`, unidade e conteúdo, peso e dimensões, `onu`, `classe_adr`, `estado`, `posicao`, os valores das opções |
| `opcoes.csv`, `valores.csv` | opção, valor | `id`, `artigo` (`opcao`), `nome` (`valor`), `posicao` |
| `componentes.csv` | componente de um kit | `kit` (a variante do kit), `componente` (variante), `quantidade`, `posicao` |
| `categorias.csv`, `colecoes.csv` | categoria, colecção | `id`, `pai` (só na categoria), `nome`, `descricao` (só na colecção), `endereco_amigavel`, `posicao`, `estado` |
| `artigos_categorias.csv`, `colecoes_artigos.csv` | ligação | os dois ids (e a `posicao` na colecção) |
| `traducoes.csv` | tradução | `recurso` (o id com prefixo), `campo`, `lingua`, `texto`, `original`, `origem` (pessoa ou IA), `revista`, `traduzido_em`; o estado (em dia ou desactualizada) calculado |
| `media.csv` | imagem | `id`, `artigo`, `variante`, `ficheiro` (caminho no ZIP), `tipo`, `bytes`, `texto_alternativo`, `posicao`, `principal` |
| `imagens/<resumo>` | ficheiro de imagem | os bytes tal como foram enviados, pelo resumo SHA-256 (uma vez cada, mesmo ligada a vários artigos) |
| `publicacoes.csv` | publicação | `id`, `artigo`, `loja` (`sto_…`), `canal`, `mercado`, `estado`, `variantes_fora`, `ultima_verificacao` (JSON), `verificado_em`, `publicado_em`, `arquivado_em`, `motivo_arquivo` |

- **Ids como na API** (com o prefixo), para se cruzarem os ficheiros e
  para a importação os reconhecer. As lojas, os canais e os mercados
  (`sto_`, `chn_`, `mkt_`) vão só pelo id: são do Comerciante e de Preços,
  e entram quando esses domínios tiverem a sua parte (revisão do #189,
  P2-2).
- **Não leva quem fez** (`publicado_por`, `arquivado_por`,
  `classificado_por`, `traduzido_por`, `revisto_por`): são pessoas da equipa
  e a API de leitura também não os dá (`docs/06`, CL). Voltam quando houver
  linha do tempo e um âmbito próprio.
- **Não leva preços nem stock**: são de Preços e mercados e de Encomendas;
  entram quando esses domínios tiverem a sua parte na exportação.
- **Formato dos CSV:** RFC 4180, vírgula, UTF-8 com a marca de ordem dos
  bytes (para a folha de cálculo ler os acentos; **não verifiquei** como o
  Excel em português abre a vírgula), datas em ISO 8601 UTC, listas como
  JSON na célula. **Um texto que comece por `=`, `+`, `-`, `@`, tabulação
  ou retorno leva um apóstrofo à frente** (injecção de fórmulas numa folha
  de cálculo, OWASP); o `catalogo.json` leva o texto sem mudanças e é ele
  que faz fé. Um SKU como «-001» sai «'-001» no CSV: a importação lê o
  JSON, ou tira o apóstrofo que o CSV pôs (fica para o desenho dela).
- **`catalogo.json`** leva `formato: "eurolify.catalogo/1"`, `gerado_em`,
  o comerciante (`id`, `lingua_origem`) e as listas acima, aninhadas por
  artigo (variantes, opções, componentes, media, traduções, publicações).
  Mudar o formato é `eurolify.catalogo/2`, nunca mudar o 1.

**Como se pede e se descarrega:**

| Operação | Método e caminho | Âmbito | Notas |
|---|---|---|---|
| Pedir | `POST /exports` com `{"dominios": ["catalogo"]}` | o de leitura de cada domínio | com `Idempotency-Key`; faz o ZIP **dentro do pedido** e responde 201 com a exportação `pronta`; se falhar, responde com o erro e não fica linha (`export.too_large`, 422, acima do que o ZIP sem ZIP64 aguenta: 65 534 ficheiros ou 4 GiB). Com 3 por expirar, 409 `export.limit_reached`. Uma chave já usada responde logo, sem refazer o ZIP (a chave confere-se antes do trabalho; revisão do #189, P2-4) |
| Ver | `GET /exports/{id}` | o mesmo | estado, domínios, tamanho, resumo SHA-256 do ZIP, `criada_em`, `expira_em` |
| Listar | `GET /exports` | o mesmo | as do comerciante, das mais novas para as mais velhas (docs/18 §2a) |
| Descarregar | `GET /exports/{id}/file` | o mesmo | o ZIP, com `Content-Disposition`; sem a base aberta enquanto se envia; depois de `expira_em`, 410 `export.expired`; de outro comerciante, 404 `export.not_found` |

- **Fotografia de um momento:** os dados lêem-se numa transacção só de
  leitura (REPEATABLE READ, como as consultas, `noCatalogo` com
  `soLeitura`), escrevem-se para um ficheiro temporário no armazenamento
  e a base fecha antes de o ZIP sair. Uma escrita a meio não fica metade
  dentro.
- **Uma exportação de cada vez por comerciante** (a segunda ao mesmo tempo
  dá 429, com `Retry-After: 5`; contada no processo da API, que é um só
  na VPS); o ZIP fica **7 dias** e depois já não se descarrega.
- **No máximo 3 por expirar por comerciante** (**proposta**, revisão do
  #189, P1-1): a quarta dá 409 `export.limit_reached`. Não é custo nem
  limite de vezes: as que tem descarregam-se quantas vezes quiser, e pede
  outra quando uma expirar. Cada pedido novo, antes de fazer o ZIP, apaga
  da pasta do comerciante os ZIP expirados, os ZIP sem linha e os
  temporários que ficaram, **parados há mais de uma hora**: um recente
  pode ser de outra instância da API a meio (ao publicar, a antiga e a
  nova atendem ao mesmo tempo; 2.ª revisão do #189, P2-A). Um ficheiro que
  não se deixa apagar não faz falhar a exportação (P2-B). Assim o disco de
  cada comerciante fica em 3 ZIP e o que ficou de uma falha na última
  hora. A linha das expiradas fica (a API não apaga linhas); o ficheiro de
  quem não volta a pedir fica até à limpeza geral da issue #179. Não conta
  para a quota das imagens.
- **Onde fica:** no armazenamento das imagens, em
  `.exportacoes/<comerciante>/<id>.zip` (na VPS,
  `/var/lib/eurolify/media/.exportacoes`); a cópia diária deixa-a de fora
  (`eurolify-copia`, `docs/11` §3.5), porque se refaz.
- **O ZIP** escreve-se sem biblioteca de fora (`apps/api/src/exportacao/zip.ts`,
  o formato do APPNOTE da PKWARE, sem ZIP64); o texto vai comprimido e as
  imagens como estão.
- **Sem custo:** a partir de 12/01/2027 a saída não se pode cobrar
  (`docs/09` linha 115, **W**).
- **Âmbito:** `catalog:read`, o mesmo de ler o catálogo pela API: a
  exportação não mostra nada a mais. Quando houver «exportar tudo» de
  vários domínios (`docs/15` §7), cada domínio pede o seu âmbito.
- **Sem registo de auditoria** das exportações nem das descargas: fica
  para quando houver o registo de auditoria das leituras
  (`observability-security`); hoje só fica a linha da exportação.
- **Fora desta parte:** a exportação em segundo plano (para catálogos em
  que o pedido demore demais; **não medi** quanto demora), o aviso por
  e-mail quando estiver pronta, e a importação (que lê este formato).

**Riscos:** um catálogo grande com muitas imagens faz um ZIP grande no
disco da VPS (até à quota de imagens, 1 GiB, mais os dados), até 3 por
comerciante. A compressão e o JSON fazem-se na memória e sem largar o
processo (`deflateRawSync`): um catálogo grande pode parar a API durante a
compressão (revisão do #189, P3-4). **Não medido:** medir o tempo e o
tamanho no ensaio antes de abrir a comerciantes; se passar de umas dezenas
de ms, a compressão passa a assíncrona ou a exportação a segundo plano.
**Sem tecto para o disco todo** (2.ª revisão do #189, P3-6): o limite é por
comerciante, e nada confere o espaço livre antes de começar; sem espaço, o
pedido dá 500 e o temporário apaga-se. O alerta de disco da VPS (`docs/11`
§3.8) é a rede, até haver comerciantes.

#### Importação do catálogo (decidido: Diogo, 08/10/2026, `docs/06`, CT; migração 0032; issue #77)

**Para quê.** O comerciante traz os artigos de uma folha de cálculo ou de
outro sistema sem os criar um a um. Diogo, 08/10/2026: «sim, avança com o
desenho da importação». Ex.: uma loja envia 300 variantes; o ensaio diz
«280 a criar, 15 a alterar, 5 recusadas (SKU já é de outro artigo)», e só
depois de ela confirmar se grava.

**As regras que já estavam escritas** (`catalog-pim`, «Importação»; esta
§3.11): primeiro o ensaio, que diz quantos criaria, alteraria e recusaria,
e porquê; **nunca apaga** o que não veio no ficheiro; importar duas vezes o
mesmo ficheiro não duplica nada (a chave é o SKU).

**O que entra nesta parte** (o resto fica para depois, e o relatório diz o
que foi ignorado):

| Entra | Fica para depois |
|---|---|
| criar artigos (sempre em **rascunho**) com as variantes | mudar o estado (activar, arquivar), publicar |
| acrescentar variantes a um artigo que já existe | arquivar variantes (nunca por omissão: o que não vem no ficheiro fica como está) |
| alterar os campos do artigo: `nome`, `descricao`, `marca`, `categoria_fiscal` | classificação (tem quem e quando, §3.10), opções e valores, kits |
| alterar os campos da variante: `gtin`, `gtin_origem`, `unidade_de_venda`, conteúdo, peso, dimensões, `onu`, `classe_adr` | traduções, categorias, colecções, imagens; preços (são de Preços e mercados) |

**Os ficheiros aceites:**

- **`catalogo.json`** da exportação (`eurolify.catalogo/1`): lê-se a parte
  que entra (os artigos e as variantes); o resto conta como ignorado.
- **Um CSV, uma linha por variante** (RFC 4180, UTF-8, com ou sem a marca de
  ordem dos bytes), com as colunas: `artigo`, `tipo`, `nome`, `descricao`,
  `marca`, `categoria_fiscal`, `sku`, `gtin`, `gtin_origem`,
  `unidade_de_venda`, `conteudo_quantidade`, `conteudo_unidade`, `peso_g`,
  `comprimento_mm`, `largura_mm`, `altura_mm`, `onu`, `classe_adr`. Só
  `artigo`, `sku` e, para criar, `nome`, `tipo` e `unidade_de_venda` são
  obrigatórias; uma coluna desconhecida recusa o ficheiro (um erro de
  escrita no cabeçalho não pode passar por campo vazio). Os campos do
  artigo vão em qualquer linha dele (basta numa); se duas linhas do mesmo
  artigo tiverem valores diferentes no mesmo campo, as linhas desse artigo
  são recusadas (`import.product_fields_differ`). No JSON, um campo com
  uma lista ou um objecto onde se espera texto recusa a linha. O apóstrofo que a
  exportação põe à frente de uma fórmula (`'=`, `'+`, `'-`, `'@`) tira-se
  ao ler, e só esse.

**Quem é quem** (nunca pelo nome, `AGENTS.md`, «Não se erra», regra 6):

- **A variante é o SKU** (sem distinguir maiúsculas, como na base, P9). Um
  SKU que já existe é essa variante, mesmo arquivada (um SKU arquivado não
  se reutiliza, P7: alterar uma arquivada é recusado).
- **O artigo é a coluna `artigo`:** um `prd_…` deste comerciante é esse
  artigo; outro texto qualquer (`GEL-ROSA`, um id de outro sistema) é uma
  referência dentro do ficheiro, que junta as variantes. Se algum SKU dela
  já existe, o artigo é o desses SKU (por isso importar o mesmo ficheiro
  outra vez não cria outro artigo); se são de artigos diferentes, recusa-se;
  se nenhum existe, é um artigo novo. Um `prd_…` que não existe neste
  comerciante (um ficheiro de outra conta) conta como referência.
- **Um SKU que já existe noutro artigo** do que o ficheiro diz é recusado,
  sem mudar nada (não se muda uma variante de artigo).
- **Um artigo com origem num sistema externo** (`origem: externo`, P5) não
  se altera por importação: as linhas dele são recusadas com o motivo. A
  ficha dele nasce lá.

**O que uma célula vazia quer dizer:** ao alterar, **não muda** o campo;
ao criar, fica sem valor. Esvaziar um campo por importação fica para
depois (o risco de apagar dados por uma coluna mal preenchida é maior do
que a falta).

**Como se pede** (âmbito `catalog:import`, que já existe):

| Operação | Método e caminho | Notas |
|---|---|---|
| Ensaio | `POST /imports` com o ficheiro (o corpo são os bytes, `Content-Type` `text/csv` ou `application/json`) | com `Idempotency-Key`; lê, confere tudo contra o catálogo e devolve o relatório, **sem escrever no catálogo**. Fica `analisada` 24 h |
| Ver | `GET /imports/{id}` | o estado e o relatório |
| Listar | `GET /imports` | das mais novas para as mais velhas (docs/18 §2a) |
| Aplicar | `POST /imports/{id}/apply` | grava **exactamente o plano do ensaio**, numa transacção só: ou tudo, ou nada. Se, entretanto, um artigo do plano mudou (a `versao`), uma variante do plano mudou num campo que se ia alterar ou foi arquivada, ou um SKU a criar passou a existir, nada se grava e a resposta diz quais (409 `import.stale`): faz-se outro ensaio |

- **O relatório:** quantos artigos e variantes se criam, alteram, ficam
  iguais e se recusam; por linha (CSV) ou por artigo (JSON) recusado, o
  código do erro (os do Catálogo, ex. `catalog.sku_invalid`,
  `catalog.gtin_invalid`) e o campo; para cada alteração, o campo, o valor
  de antes e o de depois; e o que foi ignorado (ex.: «opções: 12 artigos»).
  Ex.: `{"criar": {"artigos": 40, "variantes": 280}, "alterar":
  {"artigos": 3, "variantes": 12}, "recusadas": [{"onde": "linha 17",
  "sku": "GEL-001", "codigo": "catalog.sku_taken_by_other_product"}]}`.
  As listas de recusas e de alterações mostram no máximo 1000 cada uma e
  contam as outras (`recusadas_a_mais`, `alteracoes_a_mais`); os `avisos`
  dizem, por exemplo, que um `prd_…` não existe nesta conta. Quem tem
  `catalog:import` vê no relatório os valores de antes dos campos: importar
  pede ler o que se vai mudar. Códigos novos: `catalog.sku_taken_by_other_product`, `import.sku_repeated`, `import.product_fields_differ`, `import.bad_row`, `import.no_variants`, `import.product_repeated`, `import.external_product`, `import.invalid_file` (422), `import.too_large` (422), `import.stale` (409), `import.expired` (410), `import.not_found` (404).
- **As recusadas não impedem o resto:** o plano é o que passou. Quem
  quiser tudo ou nada vê o relatório e não aplica.
- **Importar duas vezes o mesmo ficheiro:** o segundo ensaio diz «iguais»
  para tudo o que o primeiro criou ou alterou; aplicá-lo não muda nada.
- **Uma importação de cada vez por comerciante** a aplicar (a segunda dá
  429), como a exportação.
- **Limites** (proposta): o ficheiro até 10 MB (acima, 413) e até 5000
  linhas ou variantes, boas ou más (acima, 422 `import.too_large`); um
  artigo novo até 100 variantes, como na criação pela API. Os valores
  conferem-se pelos mesmos esquemas da API (o nome até 200 caracteres, a
  descrição até 10000, os formatos); um ficheiro que não esteja em UTF-8
  recusa-se.
- **Dois grupos do ficheiro que dão o mesmo artigo:** o segundo recusa-se
  (`import.product_repeated`).
- **Uma espera por outra escrita** (mais de 5 s, `catalog.retry`) faz
  falhar o ensaio ou a aplicação inteira (503), em vez de virar recusa. Uma importação aplica-se uma vez
  (`aplicada`); aplicar outra vez devolve o resultado da primeira.
- **Como o ensaio confere:** faz as escritas a sério, cada artigo e cada
  variante num ponto de retorno (savepoint) da transacção, e desfaz tudo no
  fim. As regras da base correm todas como correriam (formatos, SKU único,
  GTIN, os gatilhos, e a das combinações de opções, que a base deixa para
  o fim da transacção e o ensaio força no fim de cada artigo: num artigo
  activo com opções, uma variante nova sem valores recusa-se já no ensaio).
  As variantes novas criam-se pela mesma função da API
  (`criarVarianteComValores`), e o artigo altera-se pela `alterarArtigo`
  (que reverifica as publicações quando o nome muda, §4.2).
- **Aplicar** pede `Idempotency-Key`, como as outras escritas.
- **Os eventos:** saem os mesmos que pelas funções da API (§6); **não
  verifiquei** quais saem hoje em cada uma.

**Guarda-se** (migração 0032, `importacao`): o comerciante, o formato, o
resumo SHA-256 do ficheiro, o tamanho, o estado (`analisada` ou `aplicada`;
`expirada` calcula-se na resposta), o relatório e o plano (JSON), quando
foi analisada e aplicada, e o prazo. **Sem prazo de retenção** das linhas:
fica por decidir (revisão do #197, P3-6). O ficheiro em si **não se guarda**: o plano chega para
aplicar, e um ficheiro de outro sistema pode trazer dados que não são do
catálogo.

**Riscos:**

- **Uma importação errada altera muitos artigos de uma vez.** Por isso o
  ensaio mostra antes e depois de cada campo, nada se esvazia, nada se
  arquiva e os artigos novos ficam em rascunho (não vão para venda sem
  passar pela publicação, C2).
- **Uma transacção com 5000 variantes** prende muitas linhas durante
  segundos, no ensaio e na aplicação; quem escreve nesses artigos espera
  até 5 s e recebe `catalog.retry`. **Não medi** quanto demora. Num artigo
  com opções e muitas variantes novas, a verificação das combinações corre
  a cada variante e pode ficar lenta (revisão do #197, P3-7).
- O que vier de outro sistema (uma folha de cálculo exportada de outra
  plataforma) pode trazer campos com outro significado: só as colunas da
  lista acima entram.

### 3.12 Linha do tempo (`chg_`)

Cada artigo tem a linha do tempo da `platform-architect`: mudanças de estado e
dos campos (quem, quando, antes → depois), notas da equipa, anexos. Alimenta-se
dos eventos (§6) e do registo de auditoria; **não é outra fonte de verdade**.

**Desenho de 09/10/2026** (Diogo: *«sim, avança com o desenho do histórico do
artigo»*; issue #77; cumpre a C7). Ex.: às 10:02 a chave `key_…` muda o **nome**
do «Gel UV 15 ml» para «Gel UV 15 ml transparente». A linha do tempo do artigo mostra uma alteração com quem
(`chave:key_…`), quando (UTC), o campo `nome`, o antes e o depois. Se o artigo
estava à venda e o nome deixou de ter tradução num mercado, a mesma alteração
mostra também a publicação a sair de venda (`verificacao_falhou`).

**O registo é a base, não a API.** Gatilhos com os direitos do dono das
tabelas escrevem uma entrada por cada linha que muda, na mesma transacção,
como os eventos da 0021. Assim, a API, a importação, os gatilhos em cadeia (a
reverificação) e o SQL escrito à mão no contexto do comerciante não mudam o
catálogo sem deixar rasto. A linha do tempo é só a leitura desse registo, que é
o registo de auditoria do Catálogo (`observability-security`, «Registo de
auditoria»).

| Campo | Notas |
|---|---|
| `id` (`chg_`) | uuidv7: a ordem dentro do mesmo comerciante |
| `comerciante_id` | RLS forçado, como as outras tabelas |
| `artigo_id` | o artigo a que a mudança pertence; numa tradução de opção ou valor, o da opção (num rascunho apagado, o que a opção deixou aqui); vazio numa categoria ou colecção, e nas traduções delas |
| `entidade`, `entidade_id` | a tabela e a linha: `artigo`, `variante`, `opcao`, `valor_opcao`, `variante_valor`, `componente`, `traducao`, `artigo_categoria`, `colecao_artigo`, `media`, `publicacao`, `categoria`, `colecao` |
| `operacao` | `criado`, `alterado`, `apagado` |
| `campos` | os campos que mudaram e, para cada um, `antes` e `depois` (JSON); só os que mudaram |
| `quem` | o `eurolify.quem` da transacção: `chave:key_…`, `pessoa:per_…` (o Hub), `sistema:<tarefa>` (uma tarefa automática que mude o catálogo tem de o pôr). **Sem ele, a escrita falha** (como na 0001), excepto o arquivo em cadeia de uma publicação, que leva o `arquivado_por` (`catalogo:<motivo>`) |
| `origem` | o `eurolify.origem` da transacção, quando existir: `importacao:imp_…`; vazio numa escrita normal da API (a reverificação vai na mesma transacção de quem mudou, com o motivo na publicação) |
| `transacao` | um identificador opaco (uuid) por transacção, guardado na sessão só durante ela: junta as entradas de um pedido numa só «alteração»; não é o número da transacção do PostgreSQL, que é da instância e dizia quantas escritas os outros comerciantes fizeram (revisão do #208, P2-1) |
| `em` | o instante da transacção, em UTC |

Regras (todas **proposta**):

- **Só se acrescenta** (gatilhos da 0008: sem `UPDATE`, `DELETE` nem
  `TRUNCATE`, nem pelo dono). Corrige-se com uma entrada nova.
- **Ficam de fora** os campos técnicos e os que já dizem quem
  (`versao`, `criado_em`, `atualizado_em`, `publicado_por`, `arquivado_por`,
  `classificado_por`, `traduzido_por`, `revisto_por`): o «quem» de cada
  entrada é o da entrada. Os bytes das imagens também ficam de fora: entra a
  linha da `media` (o texto alternativo, a ordem, o resumo do ficheiro).
- **O valor fica inteiro** (uma descrição longa entra toda no antes e no
  depois), porque a C7 pede o antes e o depois. **Não medi** quanto ocupa:
  mede-se no ensaio com uma importação de 5000 variantes antes de abrir a
  comerciantes.
- **Uma escrita que não muda nada não deixa entrada** (pedir o estado em que
  o artigo já está, §4.1).
- **Não há entradas de antes da migração**: a linha do tempo começa no dia em
  que ela entra no ensaio e diz `desde`. Não se inventa um passado.
- **Apagar um rascunho** (§4.1) deixa as entradas: o artigo some, o rasto não.
- As **notas da equipa e os anexos** ficam para depois: são dados que alguém
  escreve, com outro risco de dados pessoais (`platform-architect`).

**Quem vê o quê** (`docs/06`, CL: quem fez **não sai** com `catalog:read`):
`GET /products/{id}/timeline` pede um âmbito novo, `catalog:history`, que dá
tudo, `quem` incluído. No Hub, o `dono` e o `gestor` têm-no; o `armazém` e o
`apoio`, não (`docs/21` §5). Um âmbito novo entra na lista da base (o
`CHECK` da 0010, `AMBITOS` em `identidade/chaves.ts`) e nos papéis (a função
da 0018), na mesma migração; uma chave de servidor só o tem se quem a cria o
escolher. **Esta é a decisão
pedida ao Diogo ou ao Bruno.**

**Dados pessoais** (`docs/17`): `quem` é um identificador (`per_…`,
`key_…`), nunca o nome nem o e-mail; quando a pessoa é pseudonimizada (90 dias,
CD), o rasto fica com o `per_…`, como o `evento_conta`. Os valores do catálogo
não são dados pessoais, mas um texto livre (descrição, texto alternativo) pode
trazer um nome escrito à mão. O prazo de guarda do rasto é **por decidir — C**,
como o dos eventos (`docs/17` §3, linha do `quem`): fica enquanto o
comerciante tiver conta, até haver decisão.

**Leitura:** a mais recente primeiro, por páginas (cursor sobre o `id`; 25 por
omissão, até 100, como as outras listas); filtros `desde` e `entidade`.

**Em código** (migração 0033, issue #77; `docs/06`, CU):

- a tabela `alteracao_catalogo` e os gatilhos nas 13 tabelas; o teste falha
  se uma tabela com `artigo_id` ficar sem gatilho;
- `escrever` (`catalogo/rotas.ts`) põe o `eurolify.quem` (`chave:key_…`) em
  todas as escritas da API; a importação põe a origem;
- `GET /products/{id}/timeline` (`catalogo/rotas-linha-do-tempo.ts`), com
  `catalog:history`; o `entidade_id` sai com o prefixo quando a entidade o
  tem, e os `campos` como estão guardados (os identificadores sem prefixo);
- a política de escrita da tabela deixa o gatilho escrever sem
  `eurolify.comerciante` (o comerciante da entrada é o da linha que mudou);
  ler, só as do comerciante posto;
- **nos testes**, a base de teste traz `eurolify.quem = 'teste:base'` para
  os testes que preparam o catálogo por SQL ou pelo repositório; o teste da
  linha do tempo cria a sua sem ele, para provar que a API não depende dele.

**Faltas conhecidas:** a linha do tempo de uma categoria ou colecção (as
entradas existem, a rota não); o Hub ainda não mostra a linha do tempo nem
oferece `catalog:history` nas chaves (a lista do Hub é do `docs/22`, §9.3);
o espaço ocupado não foi medido.

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
| publicado | arquivado | retirar; ou artigo, mercado ou canal arquivado (em cadeia, 0019); ou reverificação falhada (motivo `verificacao_falhou`, 0023; `docs/06`, CJ); ou bloqueio vindo da Conformidade (ex.: recolha, substância proibida) |
| arquivado | publicado | nova verificação |

### 4.3 Tradução

| Estado | Quando |
|---|---|
| em falta | a língua é do mercado e não há texto (até haver mercados, na fila de uma língua pedida) |
| completa | há texto e o original guardado com ele é o original de agora (§3.8) |
| desactualizada | o original mudou depois da tradução, ou ficou vazio |

## 5. Regras do domínio

| # | Regra | Fonte |
|---|---|---|
| C1 | **A ficha vive num sítio só.** Campo novo de artigo nasce no domínio, na API de Administração e na ficha do Hub no mesmo passo; o Hub usa a API como qualquer cliente | `catalog-pim`, «Primeira regra»; `headless-commerce` |
| C2 | **«Pode publicar?» é uma pergunta ao servidor**, que responde sim ou a lista de impedimentos com código: sem SKU, sem unidade, sem categoria fiscal, sem preço no mercado ou a 0,00 € sem ser gratuito (pergunta a Preços), atributo obrigatório em falta no mercado (pergunta à Conformidade), classificação em falta ou incompatível, ou família restrita (§3.10, «Classificação do artigo»), nome ou avisos sem tradução numa língua do mercado, media sem texto alternativo. **Rede temporária** (decisão do Diogo, 06/10/2026, opção a; `docs/06`, CF): a Conformidade ainda não existe, por isso não se verifica. A resposta diz sempre `nao_verificado: [conformidade]`, e ninguém lê «sem impedimentos» como «conforme». A media verifica-se desde 08/10/2026 (`docs/06`, CR): cada imagem do artigo, ou de uma variante à venda no par, tem texto alternativo (impedimento `texto_alternativo_em_falta`, com os `med_…`); o texto alternativo só existe na língua de origem, e num mercado com outra língua e com imagens a resposta junta `traducao_do_texto_alternativo` ao `nao_verificado`. A base não repete esta regra (repete só o preço e o peso): SQL escrito à mão pela API pode deixar à venda um artigo com uma imagem sem texto, como na reverificação (revisão do #184, P3-2). **Fim:** quando a Conformidade existir, ou antes de haver produção (ADR-0027), o que vier primeiro. Os avisos traduzidos esperam pela Conformidade; do texto, verifica-se o nome do artigo | `catalog-pim`, regra 2 e «Antes de dizer está feito»; o gel a 0,00 € seis meses e meio com 149 unidades |
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

**Em código** (migração 0021, `docs/18` §5): já se escrevem `product.published`,
`product.unpublished` (com quem, quando e o motivo; `quem` não sai nos
webhooks, `docs/06`, CH) e `product.archived`.
`product.created` e `product.updated` entram com a parte 5. Os campos exactos
de cada evento (o contrato) estão na tabela do `docs/18` §5.

Quem consome: Preços (preço por mercado), Stock (composição dos kits), Pesquisa
e frontends (por webhook), linha do tempo.

## 7. Lista da API

Versão por data (ex.: `2027-01`) (`headless-commerce`, regra 7). Listas por
cursor, com indicação de que há mais e **o total explícito** (regra 4; lição
4.7). Erros RFC 9457 com código estável (regra 3). Todas as escritas com
`Idempotency-Key`. Âmbitos OAuth (**proposta**): `catalog:read`,
`catalog:write`, `catalog:publish`, `catalog:import`.

### 7.1 API de Administração

**Em código** (07/10/2026; pedido do Diogo: «sim, avança com as consultas
da API do Catálogo»; `apps/api/src/catalogo/rotas.ts`), com uma chave de
servidor com `catalog:read`:

- `GET /products`, com os filtros estado, tipo, SKU de uma variante e parte
  do nome, no formato de lista do `docs/18` §2a;
- `GET /products/{id}`, com as variantes sempre incluídas;
- `GET /products/{id}/publications`;
- `POST /products/{id}/publications/check`.

**As escritas em código** (07/10/2026; pedido do Diogo: «sim, avança com as
escritas da API do Catálogo»), todas com o cabeçalho `Idempotency-Key`
(`docs/18` §4: a escrita e a resposta guardada vão na mesma transacção; a
mesma chave com o mesmo pedido devolve a mesma resposta; com outro pedido,
`idempotency.key_reused`; uma escrita que falha não gasta a chave):

- com `catalog:write`: `POST /products` (rascunho, com pelo menos uma
  variante), `PATCH /products/{id}`, `PUT /products/{id}/classification`,
  `POST /products/{id}/activate`, `/archive` e `/restore` (cada um parte
  do seu estado — rascunho, activo e arquivado — ou do estado a que leva,
  que não muda nada; outro dá `catalog.invalid_transition`) e
  `DELETE /products/{id}`;
- com `catalog:publish`: `POST /products/{id}/publications` e
  `POST /publications/{id}/archive`.

**As variantes em código** (07/10/2026; pedido do Diogo: «sim», às rotas
das variantes):

- com `catalog:read`: `GET /products/{id}/variants` (também as arquivadas,
  por posição, SKU e id, no formato das listas do `docs/18` §2a, com
  `limite` e `cursor`), `GET /variants/{id}` e `GET /variants?sku=…` ou
  `?gtin=…` (exactamente um dos dois; o SKU sem distinguir maiúsculas, P9;
  o GTIN com os zeros à esquerda ignorados, C4; também arquivada; a lista
  tem uma variante ou nenhuma, porque os dois são únicos por comerciante, e
  vai no mesmo formato, sem páginas);
- com `catalog:write`, com a `Idempotency-Key`: `POST /products/{id}/variants`
  (com `valores`, um `ovl_…` por opção; num artigo que já não é rascunho a
  combinação tem de ficar completa e não repetida, e a base confirma-o no
  fim da transacção; num artigo publicado, a variante nova nasce fora das
  publicações, 0019) e `POST /variants/{id}/archive` (final; se era a última
  à venda, a publicação sai de venda, §8; uma variante já arquivada
  devolve-se sem mudar nada, como no artigo: decisão do Diogo, 07/10/2026,
  `docs/06`, CN).

Cada variante sai com o artigo (`prd_…`) e os valores das opções (`ovl_…`),
pela ordem das opções do artigo; a ficha do artigo (`GET /products/{id}`)
traz as variantes sem os valores. Os `valores` não se repetem (400) e um
valor que não existe, ou de outro artigo, dá `catalog.not_found`, como
qualquer referência que não existe (o `detail` diz que é o valor). O GTIN e
a origem dele vêm juntos, recusados no contrato (400) se vier um sem o
outro. **Falta**
`PATCH /variants/{id}`: não há ainda função que altere uma variante, e a
variante não tem `versao` para a escrita concorrente; desenha-se antes do
código.

**As opções e a composição dos kits em código** (07/10/2026; pedido do
Diogo: «sim, avança com as opções e os kits»):

- com `catalog:read`: `GET /products/{id}/options` (pela posição, cada
  opção com os valores todos) e `GET /variants/{id}/components` (pela
  ordem; vazia se a variante não é kit), ambas no formato das listas do
  `docs/18` §2a, e `GET /options/{id}`;
- com `catalog:write`, com a `Idempotency-Key`: `POST /products/{id}/options`
  (com os valores, pelo menos um e sem repetidos; só num rascunho, outro dá
  `catalog.not_draft`), `POST /options/{id}/values` (um valor no fim, em
  qualquer estado do artigo) e `PUT /variants/{id}/components` (substitui a
  composição inteira, no máximo 100, pela ordem; a base recusa ciclos,
  componentes novos arquivados e mexer num kit arquivado).

Um artigo, uma opção ou uma variante que não existe (ou de outro
comerciante) dá `catalog.not_found`, também quando é um componente no
corpo. O nome de uma opção e o valor não se repetem sem distinguir
maiúsculas nem os espaços nas pontas (o índice da 0005); iguais no próprio
pedido dão 400. Cada componente sai com o estado: um arquivado que já
estava no kit fica (§3.4). A composição não tem `versao`: o último a
escrever ganha, como «substitui a lista inteira» já dizia. A página da
composição só é estável enquanto ninguém a substitui: um `PUT` a meio de
quem pagina reescreve as posições (a excepção ao `docs/18` §2a; no máximo
100 componentes, por isso cabe numa página). **Falta**, por não haver ainda função: mudar o nome de uma opção ou
o texto de um valor, apagar uma opção e mudar a ordem; desenham-se antes do
código.

**As traduções em código** (08/10/2026; pedido do Diogo: «sim, avança com
as traduções»):

- com `catalog:read`, `GET /translations` em dois usos, exactamente um de
  cada vez: com `resource` (`prd_`, `opt_`, `ovl_`, `cat_` ou `col_`), as
  traduções desse recurso (de uma língua, com `locale`), cada uma com o
  estado contra o original de agora (§4.3) — poucas por natureza (os campos
  do tipo × as línguas), por isso vão todas; sem `resource`, com `locale`,
  a fila do que falta traduzir nessa língua (`estado`: `em_falta`,
  `desactualizada`), por páginas (`docs/18` §2a);
- com `catalog:write`, com a `Idempotency-Key`:
  `PUT /translations/{recurso}/{campo}/{lingua}` (traduz ou traduz outra vez,
  sempre como proposta de IA: o corpo não leva a origem, `docs/06`, CP;
  `original_visto` é o original que quem traduziu viu, e se mudou dá
  `catalog.version_conflict`) e `DELETE` (o campo passa a «em falta»; o nome
  de um artigo publicado num mercado dessa língua tira-o de venda, §8; quem
  apagou fica registado no arquivo da publicação).

**Rever uma proposta de IA não está nesta API** (`docs/06`, CO; revisão do
#166, P1-1): as chaves podem ser de agentes de IA, e só uma pessoa revê. A
revisão entra no Hub, com a sessão de uma pessoa (`docs/21`), e deve
comparar o texto que a pessoa viu, como o `original_visto` (revisão do
#166, P2-1). Até lá, `revista` só pode ficar verdadeira por quem tem acesso
directo à base; nada no Eurolify lê ainda esse campo (a publicação só
verifica o nome, §8).

Os campos de cada tipo são os da 0009 (artigo: nome e descrição; opção:
nome; valor: valor; categoria: nome e endereço amigável; colecção: nome,
descrição e endereço amigável); outro dá 400 `request.invalid`, recusado
antes de escrever. O texto também se recusa antes de escrever acima do
limite do campo, com o campo e o limite na mensagem: nome e valor até 200
(`catalog.invalid_field`), descrição até 20 000, endereço amigável até 100
(`catalog.slug_invalid`). A língua só se confere pelo formato (`^[a-z]{2}$`),
como na base: uma língua que nenhum mercado usa dá uma fila inteira «em
falta» (fica para quando os mercados tiverem línguas na API). Pedir as
traduções de um recurso na língua de origem dá
`catalog.translation_same_language`, como a fila. Traduzir outra vez
substitui sempre, também uma tradução de pessoa (gravada no Hub) por uma
proposta de IA (por decidir se se quer protecção, revisão do #166, P3-7).
Quem traduziu fica registado como a chave e não sai nas respostas
(**proposta**, por analogia com a CL; por confirmar com o Diogo ou o Bruno;
2.ª revisão do #166, P3-D). O limite de texto conta caracteres, como a
base, e repete os limites da 0009: muda-se nos dois sítios.

**Faltas conhecidas das traduções** (revisões do #166, P3-5 e 2.ª ronda,
P3-E): a resposta do `GET /translations` é uma de duas listas sem campo que
as distinga (um SDK gerado vê uma união; quem chama sabe qual pediu); o item
da fila não traz o original (lê-se na ficha do recurso: as categorias e as
colecções têm-na desde a parte 6). No Hub ainda não há rota nem data
para gravar traduções de pessoa nem para rever (`reverTraducao` já recebe o
texto que a pessoa viu): até lá, todas as traduções feitas pela API ficam
`ia` e nenhuma pode ser revista. Quando alguma coisa passar a ler `origem`
ou `revista` (textos legais, avisos), essas rotas do Hub têm de existir
antes (3.ª revisão do #166, P3-2).

**As categorias e as colecções em código** (08/10/2026; pedido do Diogo:
«sim, junta o #169 e avança com as categorias»): as regras são as da 0007 e
do repositório (§3.6 e §3.7); a API só as expõe.

- com `catalog:read`: `GET /categories` e `GET /collections` (por ordem de
  criação, filtro `estado`, por páginas, `docs/18` §2a; a árvore monta-se
  pelo `pai` de cada categoria, e cada colecção traz `total_artigos`),
  `GET /categories/{id}`, `GET /collections/{id}`,
  `GET /collections/{id}/products` (pela ordem da colecção, com o estado de
  cada artigo; como a composição de um kit, só é estável entre páginas
  enquanto ninguém a substitui) e `GET /products/{id}/categories` (com a
  versão do artigo, que é a que se manda para as mudar);
- com `catalog:write` e a `Idempotency-Key`: `POST /categories`,
  `PATCH /categories/{id}`, `POST /categories/{id}/move`,
  `POST /categories/{id}/archive` e `/restore`, `PUT
  /products/{id}/categories` (uma escrita do artigo: leva e sobe a versão
  dele), `POST /collections`, `PATCH /collections/{id}`,
  `POST /collections/{id}/archive` e `/restore` e
  `PUT /collections/{id}/products` (devolve a colecção; os artigos lêem-se à
  parte).

Arquivar e repor não estavam na tabela abaixo e entraram com esta parte,
como nos artigos: pedir o estado em que já está devolve a ficha sem mudar
nada. Não há `DELETE`: categorias e colecções arquivam-se (§3.6).

**Faltas conhecidas das categorias e colecções** (08/10/2026):

- **Quem** mudou uma categoria ou uma colecção fica na linha do tempo desde
  a migração 0033 (§3.12), sem artigo; ainda não há rota que a mostre por
  categoria ou colecção (só `GET /products/{id}/timeline`, que mostra as
  ligações do artigo às categorias e colecções).
- Os limites do contrato são **proposta**: até 100 categorias por artigo e
  até 1000 artigos por colecção num `PUT`. A base não tem limite; acima disso
  é preciso decidir (ou outra forma de mudar a lista, por partes).
- A lista de categorias não filtra pelo pai nem devolve a árvore montada.

Os estados
e as línguas são os do desenho: o `docs/14` §7.1 escrevia `outdated` e
`missing`, e o código usa `desactualizada` e `em_falta`, como o §4.3.

As alterações levam a `versao` lida (outra dá `catalog.version_conflict`,
antes de qualquer outra recusa) e devolvem a ficha. Pedir o estado em que o
artigo já está devolve a ficha sem mudar nada, nem a versão (§4.1), mas só
com a versão actual: quem perdeu a resposta e repete com uma chave nova e a
versão antiga recebe `catalog.version_conflict`; com a mesma chave, recebe a
resposta guardada. O esquema
de cada corpo diz o que a base aceita (medidas positivas, o formato da
categoria fiscal, do GTIN e do ONU), e um erro no fim da transacção sai com o
código do Catálogo (revisão do #153). Publicar com impedimentos responde 200
com `publicada: false`: quem chama lê `publicada`, nunca só o estado HTTP. Quem escreve fica registado como a chave
(`chave:key_<id>`), o formato que as migrações 0012, 0014, 0015 e 0025 já usam. As variantes, as opções, a
composição, as traduções, as categorias e as colecções entraram a seguir (abaixo); o resto da tabela
entra com as rotas seguintes.

**Faltas conhecidas** (revisão do #153, 07/10/2026; vinham de antes destas
rotas, que só as expõem):

- **Quem**, quando, antes e depois (C7) ficam na linha do tempo em todas as
  escritas desde a migração 0033 (§3.12).
- **Sem tecto de variantes por artigo** (revisão do #159, 2.ª, P3-N3): a
  lista das variantes vai por páginas, mas a ficha do artigo
  (`GET /products/{id}`) traz todas, e `POST /products/{id}/variants` não
  tem limite. O tecto (ou o `expand` com páginas) é decisão do Diogo ou do
  Bruno, antes de abrir a API para fora.
- **Sem tecto de valores por opção** (revisão do #161, P3-1): a criação
  limita a 100, mas `POST /options/{id}/values` não, e a opção sai com os
  valores todos. O tecto é decisão do Diogo ou do Bruno, com o das
  variantes, antes de abrir a API para fora.
- **A categoria fiscal** aceita qualquer código no formato: a lista é do
  Motor de IVA (§2), que ainda não existe, e nada confirma que o código
  existe lá (**C**, não verifiquei). **Rede temporária** (decisão do Diogo,
  07/10/2026, `docs/06`, CM). **Fim:** quando o Motor de IVA existir, ou
  antes de haver produção (ADR-0027), o que vier primeiro — como a rede da
  C2 (`docs/06`, CF).

Os nomes dos campos nas respostas são os do modelo (§3), em português, e os
identificadores levam o prefixo (`prd_`, `var_`, `pub_`, `chn_`, `mkt_`).
**Quem fez a mudança não sai** (`publicado_por`, `arquivado_por`,
`classificado_por`; decisão do Diogo, 07/10/2026, `docs/06`, CL): só os
instantes. As consultas correm numa transacção só de leitura e num só
momento (REPEATABLE READ, READ ONLY).

Os erros do Catálogo saem com o código estável e o estado HTTP de uma tabela
fechada em `rotas.ts` (**proposta**): 404 o que não existe (também o de
outro comerciante), 409 o que choca com o estado ou com outro registo que já
existe (versão, transição, em uso, e um SKU, GTIN, endereço, opção, valor ou
combinação que outro registo já tem), 422 o que o servidor recusa por regra,
incluindo um valor repetido dentro do próprio pedido (o mesmo componente,
categoria, artigo de colecção ou opção duas vezes; revisão do #150, 2.ª ronda,
P3-B) e o que se quer pôr dentro de algo arquivado (`category_archived`,
`component_archived`: a regra é sobre o que se pede, não sobre o estado do
registo que se muda; revisão do #170, P3-2), 400 um
valor mal formado (sem o texto da base no `detail`) e 503 `catalog.retry`, com
`Retry-After: 1`. Um código novo não compila sem lá entrar.
**Os filtros da procura de artigos** (08/10/2026; pedido do Diogo: «sim,
avança com os filtros»): `GET /products` junta todos os filtros dados.

- `categoria=cat_…`: os artigos nessa categoria, não nas subcategorias. Uma
  categoria que não existe (ou de outro comerciante) dá `catalog.not_found`,
  não uma lista vazia.
- `traducao_em_falta=es`: os artigos com o nome ou a descrição por traduzir
  nessa língua (em falta ou desactualizada), com a mesma regra da fila de
  traduções (`porTraduzir`, um só sítio). Só os campos do próprio artigo,
  não os das opções e dos valores. A língua de origem dá
  `catalog.translation_same_language`.
- `actualizado_desde=2026-10-08T00:00:00Z`: os artigos com `actualizado_em`
  a partir desse instante, inclusive, ao microssegundo; com o fuso
  obrigatório. A data é a da linha do artigo: muda ao alterar, classificar,
  activar, arquivar ou repor o artigo e ao mudar as categorias dele; **não**
  muda com as variantes, as opções, a composição, as traduções nem as
  publicações (procurado em 08/10/2026: só `repositorio.ts` e
  `categorias.ts` actualizam a tabela `artigo`). Quem quer «o que mudou»
  nessas partes ainda não tem filtro.
  **Não serve, sozinho, para sincronizar** (revisão do #173, P2-1): a data
  é a do início da transacção que alterou o artigo (`now()`, 0002), não a do
  momento em que a alteração ficou visível. Uma transacção que começa antes
  da última data que um cliente leu e acaba depois fica com uma data mais
  antiga do que essa marca, e um cliente que peça «desde a marca» não a vê.
  Quem sincroniza tem de recuar a marca e aceitar repetidos (o `id` e a
  `versao` dizem se já o tinha). Não há margem medida: o `lock_timeout` de
  5 s limita as esperas, não a duração de uma transacção. A resposta mostra
  `actualizado_em` ao milissegundo e o filtro compara ao microssegundo: usar
  a data da resposta como marca só dá repetidos, nunca perde artigos. Uma
  sincronização segura (um cursor pela ordem das alterações) fica, como
  **proposta**, para os eventos de saída (migração 0021). Sem índice próprio para estes filtros:
  fica na nota «Escala» do `docs/18`.

Ficam de fora: **sem foto** (entra com a media, §3.5) e **sem SKU** (não
existe: o SKU é obrigatório em todas as variantes, C3). O `expand` entra com
as rotas seguintes.

| Operação | Método e caminho | Âmbito | Notas |
|---|---|---|---|
| Procurar artigos | `GET /products` | read | filtros: estado, tipo, categoria, texto, SKU, tradução em falta numa língua, actualizado desde; sem foto entra com a media; sem SKU não existe (C3) |
| Ver artigo | `GET /products/{id}` | read | `expand=variants,options,media,translations,publications` |
| Criar artigo | `POST /products` | write | nasce em rascunho; pode trazer as variantes |
| Alterar artigo | `PATCH /products/{id}` | write | com a `versao`; recusa versão antiga |
| Activar | `POST /products/{id}/activate` | write | exige C3 |
| Arquivar | `POST /products/{id}/archive` | write | arquiva as publicações |
| Repor | `POST /products/{id}/restore` | write | volta a activo, sem republicar |
| Classificar | `PUT /products/{id}/classification` | write | com a `versao`; substitui a classificação toda (§3.10); a que deixa de servir tira as publicações de venda (§8) |
| Apagar rascunho | `DELETE /products/{id}` | write | só rascunho que nunca foi activo |
| Linha do tempo | `GET /products/{id}/timeline` | history | §3.12: as entradas do artigo, das variantes, opções, traduções, media, categorias, colecções e publicações dele, com quem, quando, antes e depois; âmbito `catalog:history` (**proposta**; CL) |
| Variantes | `GET /products/{id}/variants`, `POST /products/{id}/variants`, `PATCH /variants/{id}` | read / write | SKU único (C3) |
| Arquivar variante | `POST /variants/{id}/archive` | write | não toca no artigo (C6) |
| Procurar por SKU ou GTIN | `GET /variants?sku=…` · `GET /variants?gtin=…` | read | |
| Opções | `POST /products/{id}/options`, `PATCH /options/{id}`, valores idem | write | |
| Composição do kit | `PUT /variants/{id}/components` | write | substitui a lista inteira; recusa ciclos |
| Carregar media | `POST /media/uploads` → `POST /products/{id}/media` | write | os bytes vão à API (sem endereço assinado enquanto os ficheiros estão no disco da VPS, CQ) e depois a ligação ao artigo |
| Ler media | `GET /products/{id}/media`, `GET /media/{id}`, `GET /media/{id}/file` | read | a lista, uma, e os bytes |
| Alterar ou tirar media | `PATCH /media/{id}`, `DELETE /media/{id}` | write | texto alternativo, posição, principal |
| Categorias | `GET /categories`, `GET /categories/{id}`, `POST /categories`, `PATCH /categories/{id}`, `POST /categories/{id}/move`, `/archive`, `/restore` | read / write | recusa ciclos |
| Categorias de um artigo | `GET`, `PUT /products/{id}/categories` | read / write | com a versão do artigo |
| Colecções | `GET /collections`, `GET /collections/{id}`, `POST /collections`, `PATCH /collections/{id}`, `/archive`, `/restore`, `GET` e `PUT /collections/{id}/products` | read / write | lista manual, ordenada |
| Traduções | `GET /translations?resource=…&locale=…`, `PUT /translations/{resource}/{field}/{locale}` | read / write | |
| Fila de traduções | `GET /translations?estado=desactualizada,em_falta&locale=…` | read | o que falta traduzir |
| Verificar publicação | `POST /products/{id}/publications/check` | read | **não escreve**: devolve os impedimentos por canal × mercado (C2) |
| Publicar | `POST /products/{id}/publications` | publish | corre a verificação; com impedimentos, não publica e devolve a lista, com 200 e `publicada: false` (o repositório responde `publicada: false` com a verificação; `catalog.publish_blocked` é o que a base diz se alguém tentar contornar) |
| Retirar | `POST /publications/{id}/archive` | publish | |
| Ver publicações | `GET /products/{id}/publications` | read | |
| Atributos regulamentares | `PUT /products/{id}/regulatory`, `PUT /variants/{id}/regulatory` | write | valor, quem e quando |
| Importar | `POST /imports` (o ensaio: o ficheiro, CSV ou o `catalogo.json`), `GET /imports`, `GET /imports/{id}`, `POST /imports/{id}/apply` | import | o relatório do ensaio vem antes de escrever; aplicar grava o plano do ensaio, tudo ou nada (§3.11, «Importação do catálogo»; `docs/06`, CT) |
| Exportar | `POST /exports` (`{"dominios": ["catalogo"]}`), `GET /exports`, `GET /exports/{id}`, `GET /exports/{id}/file` | read | exportação completa, comum aos domínios (§3.11, «Exportação do catálogo»; `docs/06`, CS) |

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
aqui. Da parte 3a (também **proposta**): `catalog.category_cycle`,
`catalog.category_archived` (pai arquivado, ou um artigo a entrar numa
categoria arquivada), `catalog.category_has_children`,
`catalog.category_duplicate` (a mesma categoria duas vezes na lista),
`catalog.slug_invalid`, `catalog.slug_duplicate` e
`catalog.collection_product_duplicate`. Da parte 3b (também **proposta**):
`catalog.translated_by_required`, `catalog.translation_same_language`,
`catalog.translation_no_original`, `catalog.translation_not_ai` (rever uma
tradução que não é proposta de IA) e `catalog.translation_self_review`; no Comerciante,
`merchant.origin_language_locked`.

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
- **Uma verificação de publicação feita só uma vez.** Coberto desde a
  0023 (§4.2, «Reverificação»): as sete operações que mudam o que a
  verificação lê reverificam na mesma transacção, e o resto está travado na
  base (0019). **Fica por cobrir:** a Conformidade, que ainda não se
  verifica (CF); quando existir, as operações dela entram na tabela da
  reverificação. A media verifica-se desde 08/10/2026 (CR). E o SQL à mão, que não reverifica. Quando houver carrinhos,
  reservas e encomendas, um artigo que sai de venda por reverificação tem
  de ser tratado neles (o evento `product.unpublished` traz o motivo;
  revisão do #146, P3-6).
- **O rasto das transições da publicação** é feito pelos eventos (migração
  0021). Cada publicação, retirada ou nova publicação deixa um evento
  `product.published` ou `product.unpublished` que não se altera nem se
  apaga. O evento guarda quem, quando e, na retirada, o motivo. A linha da
  publicação continua a guardar só a última passagem (revisão do #139, P3-1).
- **Listas cortadas.** A procura de artigos sem total explícito repete a lição
  4.7.
- **SKU reutilizado.** A P7 decidiu que o SKU de uma variante arquivada não
  volta a ser usado; se a base não o impuser (um teste), uma encomenda antiga
  pode apontar para outro produto. A excepção da P8 (variante apagada de um
  rascunho) só é segura enquanto um rascunho não puder ter encomendas,
  reservas nem documentos: quando esses domínios existirem, têm de o garantir.
- **A lista de campos regulamentares por categoria** não está validada por um
  técnico (**C** até lá).

- **Linha do tempo (§3.12):** uma tabela do Catálogo nova, ou uma coluna
  nova numa tabela que já existe, fica sem rasto se ninguém lhe puser o
  gatilho. O teste da linha do tempo compara a lista das tabelas do Catálogo
  com as que têm o gatilho e falha se faltar alguma. Uma escrita sem
  `eurolify.quem` falha (como na 0001): o código que hoje escreve sem ele
  (criar, alterar, activar, arquivar, repor, apagar, variantes, opções,
  traduções, categorias, colecções, media, importação) passa a pô-lo, num
  sítio só, de uma vez; uma tarefa de sistema põe `sistema:<tarefa>`.

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
| P13 | Em que língua se escreve o original do catálogo? O `docs/15` tinha a língua de origem **na loja**, mas o artigo é do comerciante: com uma loja em português e outra em espanhol, o mesmo artigo tinha duas | ✅ **Decidido: uma só língua de origem por comerciante** (Diogo, 05/10/2026: *«sim, uma só língua de origem por comerciante»*). Passa da loja para o comerciante com a parte 3b do código |
