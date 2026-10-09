# Motor de IVA — modelo e lista da API

> **Estado: desenho aprovado; no código** (issue #255; migração 0040;
> `docs/06`, CZ). Diogo, 09/10/2026: *«sim, avança com o desenho da fatia 6»*
> e *«sim, aprovo; avança com o código da fatia 6»* (Q1 a Q5 como propostas).
> O que está programado e os desvios dizem-se na §13. É a fatia 6 do
> [`eurolify/implementation-plan.md`](eurolify/implementation-plan.md)
> («categorias, taxas com vigência, territórios»). Usa o que a fatia 5 já
> guarda (`docs/23`: perfil de faturação, prova do VIES, isenção manual,
> finalidade por encomenda) e é preciso antes do checkout (fatia 7) e do
> documento fiscal (fatia 10).
>
> Skills seguidas: `eu-vat-oss-ioss` (as peças, **a ordem da decisão do
> Bruno**, territórios, OSS, arredondamentos, «na dúvida, retém»),
> `digital-products-eu` (o serviço humano à distância não é serviço
> electrónico; digital desligado), `eurolify-legal-evidence-eu` (cada regra
> com fonte, versão, W/M/C), `consumer-rights-eu` (o preço total com IVA que o
> consumidor vê), `platform-architect` (uma regra, um sítio; fronteiras) e
> `headless-commerce` (montantes em cêntimos, erros).
>
> 🔴 **Regra deste domínio:** cada taxa, código de motivo e regra de lugar
> entra **com fonte e marca W/M/C** (`docs/03`); as **C** não chegam a uma
> encomenda real sem o contabilista do país (a porta para produção do plano).
> O servidor fica sempre do lado seguro: **na dúvida, não vende ou retém —
> nunca decide à sorte** (`eu-vat-oss-ioss`, «Regra zero»).
>
> Marcas como no `docs/14`, `docs/20` e `docs/23`: **regra**, **proposta**,
> **pergunta** (§9).

## 1. O que entra nesta fatia

| Entra | Fonte |
|---|---|
| **categorias fiscais** (a lista que o artigo usa, `docs/14` `categoria_fiscal`) e a **natureza para o IVA** (`docs/14` §3.10, `natureza_iva`) | `eu-vat-oss-ioss`, «As peças»; `docs/14` §2 e §3.10 |
| **taxas com vigência** por país, região e categoria, com fonte de cada linha | `eu-vat-oss-ioss` («nunca uma taxa escrita no código») |
| **territórios especiais** por país e código postal | `eu-vat-oss-ioss`, regra 6 e «As peças» |
| **registos fiscais** de cada entidade legal do comerciante: o regime das vendas à distância (origem ou destino) e os registos noutros países | `eu-vat-oss-ioss`, «As peças»; `docs/03` §1 (OSS, limiar de 10.000 €) |
| **a decisão de IVA de uma linha**, numa função só, pela ordem do Bruno, com o motivo, a regra, a versão e a evidência | `eu-vat-oss-ioss`, «A ordem da decisão» e «As peças» |
| o **fim da rede temporária CM** do Catálogo: a categoria fiscal passa a ter de existir na lista | `docs/06`, CM («fim: quando o Motor de IVA existir») |
| a **simulação** da decisão pela API (para o Hub e para testar), sem gravar | proposta |

| Fica fora desta fatia | Porquê |
|---|---|
| gravar a decisão na encomenda e mostrá-la no checkout | fatia 7 (checkout) e 9 (encomendas): pedem a decisão a este domínio e guardam a cópia |
| emitir, reter e provar o documento; notas de crédito | fatia 10 (`eu-vat-oss-ioss`, «Documentos»; ADR-0041 para quem tem sistema de gestão) |
| o relatório OSS (quatro baldes) | depois da fatia 10: soma documentos emitidos, não decisões (ADR-0022 trouxe-o para a Fase 1) |
| IOSS (venda a partir de fora da UE) | só se um comerciante vender de fora da UE (`docs/03` §1, **C**); nenhum na Fase 1 — proposta |
| conteúdo e serviço digital, cartões-oferta | desligados (ADR-0034); o Motor recusa-os até às portas deles |
| marketplace (fornecedor presumido, art. 14.º-A) | sem marketplace na Fase 1 (`marketplace-dsa`) |

## 2. Fronteira

| Dado | Dono | Como se liga |
|---|---|---|
| categorias, naturezas, taxas, territórios, motivos, registos fiscais, a função da decisão | **Motor de IVA** | — |
| a `categoria_fiscal` e a classificação (`natureza_iva`, `local_prestacao`, `modo`) do artigo | **Catálogo** (`docs/14`) | o artigo guarda o **código**; o Motor diz se existe e o que vale |
| preço, mercado, `preco_inclui_iva` | **Preços e mercados** (`docs/20`) | o Motor recebe o montante e se inclui IVA; nunca guarda preços |
| perfil, NIF, estado e data do VIES, isenção manual, finalidade | **Clientes** (`docs/23`) | o Motor lê-os no momento da decisão e copia-os para a evidência |
| entidade legal (país, NIF) | **Comerciante** (`docs/15`) | os registos fiscais são de uma entidade legal |
| a cópia da decisão, o total cobrado | **Checkout / Encomendas** | «se foi cobrado IVA, a fatura leva IVA» (`eu-vat-oss-ioss`, regra 2): o documento nasce da cópia, nunca de um recálculo |

## 3. Modelo

### 3.1 Categoria fiscal (`categoria_fiscal`)

A lista é **do Eurolify** (igual para todos os comerciantes); o comerciante
escolhe uma para cada artigo.

| Campo | Notas | Marca |
|---|---|---|
| `codigo` | ex.: `normal`, `livros`, `alimentacao_basica`, `formacao_profissional` | proposta |
| `descricao` | por língua | proposta |
| `estado` | `activa` ou `por_validar` (existe, mas não decide sem taxa validada) | proposta |

**Fase 1:** só `normal` entra activa. As outras (reduzidas, isentas por
natureza) entram uma a uma, cada uma com o contabilista do país, porque o
mesmo produto tem taxas diferentes em países diferentes — proposta.

### 3.2 Natureza para o IVA (`natureza_iva`)

| Código | O que é | Lugar da operação | Marca |
|---|---|---|---|
| `bem` | um bem que se entrega | §5 (a ordem do Bruno) | regra |
| `servico_presencial` | serviço prestado num lugar (`local_prestacao`) | o lugar da prestação, se for no país do comerciante; noutro país, **bloqueado** até à validação | proposta; arts. 53.º/54.º (**W**, `docs/03`) |
| `acesso_evento_presencial` | entrada num evento ou sessão com data, num lugar | onde o evento se realiza (B2B art. 53.º, B2C art. 54.º, n.º 1) | **W** (`docs/03`; `docs/eurolify/fontes-eventos-servicos-iva-05out2026.md`); só no país do comerciante na Fase 1 — proposta |
| `servico_a_distancia` | serviço humano prestado à distância (não é electrónico) | **bloqueado** na Fase 1 (regra geral B2C/B2B **C**) | `digital-products-eu`; proposta |
| `servico_electronico`, `vale` | digital e cartão-oferta | **desligados** (ADR-0034) | regra |

A natureza do Catálogo (`natureza_iva`) passa a ser uma destas, validada
pelo servidor, e tem de bater com a `natureza_consumidor` (ex.: `bem` só num
artigo `fisico`) — proposta.

### 3.3 Taxa (`taxa_iva`)

Uma linha por **país, região, categoria e vigência**; nunca se altera: uma
taxa nova é uma linha nova com início (`eu-vat-oss-ioss`, regra 7: editar o
nome de uma taxa não reescreve o passado).

| Campo | Notas | Marca |
|---|---|---|
| `pais` | ISO de um país da UE | regra |
| `regiao` | vazio, ou `PT-20` (Açores), `PT-30` (Madeira) | regra; as taxas regionais **M** (16 % e 22 % na normal, medidas nos sistemas actuais, `docs/03` §1) |
| `categoria` | o código da §3.1 | regra |
| `tipo` | `taxa` ou `isenta` | proposta |
| `percentagem` | em centésimas de ponto (`2300` = 23 %), nunca vírgula flutuante | proposta (`headless-commerce`, regra 8) |
| `codigo_motivo` | numa `isenta`: o código do país (em PT, `M07` art. 9.º) | **C** (a lista dos códigos da AT não foi lida) |
| `inicio`, `fim` | vigência; a decisão usa a do **momento** da operação | regra |
| `fonte`, `verificado` | a fonte da linha (ex.: base de dados de taxas da Comissão, com a data da consulta) e quem validou (contabilista, data) ou **C** | regra (`eurolify-legal-evidence-eu`) |

**Quem escreve as taxas:** o Eurolify (nunca o comerciante), por migração
revista, com a fonte de cada linha — proposta. As taxas dos 27 países **não
estão neste documento**: carregam-se da fonte oficial com a data, e ficam
**C** até ao contabilista. Uma decisão com uma taxa **C** diz-o na evidência
(`verificado: false`), e a porta para produção não abre com elas — regra.

### 3.4 Território (`territorio_fiscal`)

| Campo | Notas | Marca |
|---|---|---|
| `pais`, `codigos_postais` | o país e os prefixos do código postal (nunca «contém» o nome da localidade) | regra (`eu-vat-oss-ioss`, regra 6) |
| `efeito` | `fora_do_iva_ue` (venda de bens = exportação) ou `regiao` (taxas próprias) | proposta |
| `regiao` | numa `regiao`: o código das taxas (`PT-20`, `PT-30`) | proposta |

**Fase 1:** Canárias (35xxx, 38xxx), Ceuta (51xxx), Melilla (52xxx) **fora do
IVA da UE** — **M** (`docs/03` §1, executado nos sistemas actuais a
28/09/2026); Açores e Madeira como regiões — **M** nas taxas normais; o resto
da lista da skill (Åland, Monte Atos, Büsingen, Heligoland, Livigno,
Campione, departamentos ultramarinos franceses, Irlanda do Norte) **C**: até
ao contabilista, uma entrega num deles **não se vende** (o código postal está
na lista, com `efeito = por_validar`) — proposta.

### 3.5 Registos fiscais do comerciante (`registo_fiscal`)

Por **entidade legal** (a que vende).

| Campo | Notas | Marca |
|---|---|---|
| `regime_distancia` | `origem` (abaixo do limiar de 10.000 € e não optou) ou `destino` (OSS, ou registo em cada país) ou `por_declarar` | regra (`docs/03` §1: limiar de 10.000 €, **C** + **M**); a forma, proposta |
| `oss_desde` | a data do registo no OSS, quando o há | proposta |
| `registos` | outros países onde a entidade tem número de IVA (país, número, desde) | `eu-vat-oss-ioss` («As peças»: o registo suíço esquecido) |
| `declarado_por`, `declarado_em` | só o dono (`tax:write`) | proposta |

O limiar conta **todas** as vendas à distância do comerciante na UE, também
fora do Eurolify, que o Eurolify não vê: por isso **declara-o o comerciante**,
nunca o deduz o servidor. O Eurolify só **avisa** quando as vendas que ele vê
passam 10.000 € no ano — proposta (pergunta Q2).

### 3.6 Motivo (`motivo_iva`)

Os códigos que saem no documento, por **país do emissor**: em PT, `M05`
(exportação), `M16` (intracomunitária), `M07` (isento art. 9.º) — **C** (são
os dos sistemas actuais, `eu-vat-oss-ioss`; a lista oficial não foi lida).
Cada decisão isenta leva um; sem código conhecido para o país do comerciante,
**não se vende isento** (fica a pagar, ou bloqueado — §5, R6) — proposta.

### 3.7 A decisão (o resultado da função)

| Campo | Notas |
|---|---|
| `resultado` | `tributada`, `isenta` ou `bloqueada` (com o motivo do bloqueio, §5.3) |
| `pais_imposto`, `regiao` | onde se deve o IVA |
| `taxa` (centésimas de ponto), `codigo_motivo` | |
| `base`, `iva`, `total` | em cêntimos, por linha (§6) |
| `regra`, `versao_regras` | o ramo da ordem que decidiu (ex.: `vies_intracomunitaria`) e a versão do conjunto de regras e taxas |
| `evidencia` | a cópia do que decidiu: país e código postal de entrega, finalidade, categoria e natureza, regime do comerciante, o perfil (NIF, país), a prova do VIES usada (`vvc_…`, resultado, data), a isenção manual (`exm_…`, motivo, NIF dela), a taxa usada (linha, fonte, `verificado`) |

A função **não grava**: o checkout grava a cópia (fatia 7), que é a prova
(`eu-vat-oss-ioss`, «Decisão de IVA da linha»: «gravada no momento do
checkout»).

## 4. Estados

| Coisa | Estados |
|---|---|
| categoria | `por_validar` → `activa` (só com a taxa validada nos países onde se vende); `activa` → `arquivada` (nenhum artigo publicado a usa) |
| taxa | não tem estados: tem vigência; uma correcção é uma linha nova (a errada fica, com `fim`) |
| regime | `por_declarar` → `origem` ou `destino`; muda só pelo dono, com rasto; uma mudança vale para as decisões **a partir daí** |

## 5. A decisão — a ordem do Bruno

Uma **função pura no servidor** (recebe tudo o que precisa; não lê relógios
nem a rede), com **um teste por ramo** — regra (`eu-vat-oss-ioss`: a #D4248
saiu errada porque a regra estava escrita duas vezes).

### 5.1 Entradas

O comerciante (país da entidade, regime, registos); a linha (categoria,
natureza, `local_prestacao`, montante, `preco_inclui_iva`, moeda); a encomenda
(finalidade declarada, perfil de faturação com NIF, estado e data do VIES,
isenção manual em vigor, país e código postal de **entrega**); o momento.

### 5.2 A ordem (bens)

| # | Ramo | Resultado | Fonte |
|---|---|---|---|
| 0 | Território de entrega na lista com `por_validar`, categoria `por_validar`, natureza bloqueada ou desligada, regime `por_declarar` numa venda B2C para outro país da UE | **bloqueada**, com o motivo | proposta («na dúvida, não vende») |
| 1 | **Isento por natureza** (a categoria tem `isenta` no país do imposto) | isenta, com o código | regra (ordem, 1) |
| 2a | **Isenção manual** em vigor e do mesmo NIF do perfil | isenta, com o código da isenção (Q4) — **vale mesmo com entrega no país do comerciante** | regra (ordem, 2.1 e 4: a #D4248) |
| 2b | **NIF válido no VIES**, finalidade `profissional` ou `revenda`, entrega **noutro país da UE** (dentro do IVA da UE) | isenta, autoliquidação (`M16`, **C**) | regra (ordem, 2.2; regra 1); a idade máxima da resposta «válido» é **C** (V5) |
| 2c | Entrega **fora do território de IVA da UE** (país terceiro, Canárias, Ceuta, Melilla) | isenta, exportação (`M05`, **C**) | regra (ordem, 2.3) |
| 4 | Entrega **no país do comerciante** | anula 2b e 2c (não anula 2a) | regra (ordem, 4) |
| 3 | B2B sem 2b para outro país da UE (sem VIES válido, finalidade `profissional` ou `revenda`) | **bloqueada** (`b2b_sem_vies`); o cliente pode comprar como consumidor | revisão do #256, P1-3 (o desenho tinha «à taxa de origem», **C**) |
| 3a | B2C para outro país da UE, regime `destino` | tributada à **taxa do país (e região) de entrega** | regra (ordem, 3; OSS) |
| 3b | o mesmo, regime `origem` | tributada à taxa do país do comerciante | regra (`docs/03` §1, limiar, **C**) |
| 3c | Entrega no país do comerciante | tributada à taxa nacional (região: **pergunta Q3**) | regra (ordem, 3) |

**Ter NIF não faz de alguém profissional** (`docs/23`, R1): o ramo 2b exige a
finalidade declarada **e** o VIES; um consumidor com NIF paga como consumidor.

### 5.3 Serviços e entradas em eventos

| Natureza | Lugar | Fase 1 |
|---|---|---|
| `servico_presencial`, `acesso_evento_presencial` | o `local_prestacao` | tributada à taxa desse país se for o do comerciante; noutro país, **bloqueada** (o comerciante teria de estar registado lá; **C**) |
| `servico_a_distancia` | **C** | bloqueada |
| `servico_electronico`, `vale` | — | bloqueada (desligados) |

### 5.4 Regras

| # | Regra | Fonte |
|---|---|---|
| R1 | A decisão vive numa função só, no servidor; o checkout, o Hub, as IAs e o documento usam-na, nunca a refazem | `AGENTS.md`, «Uma regra, um sítio»; `eu-vat-oss-ioss` |
| R2 | Sem resposta «válido» do VIES (com a idade máxima de V5) não há isenção intracomunitária; «indisponivel» não é válido | `eu-vat-oss-ioss`, regra 1; `docs/23`, R7 |
| R3 | Uma isenção manual só conta se o NIF dela for o do perfil da encomenda | `docs/23` §13.5 (P3-8 do #244); proposta |
| R4 | A taxa é a em vigor no momento da operação; uma taxa nova não muda decisões passadas (a encomenda guarda a cópia) | `eu-vat-oss-ioss`, regra 7 |
| R5 | Os territórios decidem-se pelo código postal da morada de **entrega**, nunca pelo nome da localidade nem pela morada fiscal | `eu-vat-oss-ioss`, regra 6 e «NIF»: o país da morada não é o do contribuinte |
| R6 | Sem código de motivo conhecido para o país do comerciante, não há venda isenta | proposta |
| R7 | O cliente sabe no checkout se paga com ou sem IVA, e isso não muda depois | `eu-vat-oss-ioss`, regra 3 |
| R8 | Uma decisão com uma taxa ou um código **C** diz-o na evidência; a porta para produção não abre com elas | `eurolify-legal-evidence-eu`; o plano, porta da fatia 6 |

## 6. Montantes e arredondamento

- Em cêntimos e com moeda; a taxa em centésimas de ponto; nunca vírgula
  flutuante — regra (`headless-commerce`, regra 8).
- **Preço sem IVA** (`preco_inclui_iva = nao`): `iva = arredondar(base × taxa)`;
  `total = base + iva`.
- **Preço com IVA** (`sim`): o total é o preço; `base = arredondar(total ÷ (1
  + taxa))`; `iva = total − base`. O mesmo preço em todos os países, e o
  comerciante absorve a diferença (`docs/20`, Q1, decidida).
- **Preço com IVA numa venda isenta** (2a, 2b, 2c): **pergunta Q1**.
- Arredondar ao cêntimo, metade para cima, **por linha**; a regra por país
  (por linha ou por documento) é **C** (`eu-vat-oss-ioss`, «Arredondamentos»),
  e os totais do documento são os que o emissor devolve (fatia 10).

## 7. Eventos

| Evento | Quando | Leva |
|---|---|---|
| `tax.rate_added` | uma taxa nova (por migração) | país, região, categoria, início — proposta |
| `tax.regime_changed` | o dono mudou o regime ou os registos | a entidade legal, o regime — proposta |
| `tax.decided` | **interno**, não sai em webhook | — (`docs/02` §3) |

## 8. Lista da API

Âmbitos novos: `tax:read` (dono, gestor, apoio) e `tax:write` (só o dono:
os registos fiscais) — proposta.

| Operação | Método e caminho | Âmbito |
|---|---|---|
| Categorias fiscais | `GET /tax/categories` | `tax:read` |
| Taxas | `GET /tax/rates?pais=&categoria=` | `tax:read` |
| Territórios | `GET /tax/territories` | `tax:read` |
| Motivos de isenção | `GET /tax/reasons?pais=` | `tax:read` |
| Regime de cada entidade legal | `GET /tax/registrations`; `PUT /tax/registrations/{lgl_…}` | `tax:read` / `tax:write` |
| Simular uma decisão | `POST /tax/decisions/simulate` (a linha, a moeda, a entrega, a finalidade, o perfil) | `tax:read`, e também `customers:read` quando leva um perfil; **não grava** e não é a decisão da encomenda |

O checkout (fatia 7) chama a função por dentro, não por esta API.

## 9. Por onde é que isto ainda pode sair errado

| Risco | O que o evita |
|---|---|
| Uma isenção intracomunitária com o VIES em baixo ou antigo | R2 e V5; «indisponivel» nunca isenta |
| A #D4248: isenção manual com entrega no país do comerciante saiu com IVA (ou o contrário) | ramo 2a antes do 4, com um teste próprio |
| Um consumidor com NIF tratado como empresa | o ramo 2b exige a finalidade declarada (`docs/23`, R1) |
| Palma de Maiorca tratada como Canárias por «contém la palma» | R5: só código postal |
| Uma taxa mudada que reescreve decisões passadas | R4: linhas com vigência; a encomenda guarda a cópia |
| O regime errado (cobrar a taxa de origem acima do limiar) | o comerciante declara (§3.5); sem declaração, a venda B2C intra-UE não se faz; o aviso dos 10.000 € |
| Uma taxa inventada | §3.3: cada linha com fonte; as **C** marcadas na evidência (R8) e sem produção |
| Arredondamentos que não batem com o documento | por linha agora (**C**); os totais do documento vêm do emissor (fatia 10) |
| A mesma regra escrita duas vezes (o checkout e o documento) | R1 e a cópia da decisão na encomenda |

## 10. Perguntas para o Diogo ou o Bruno

| # | Pergunta | Proposta |
|---|---|---|
| Q1 | Num mercado com preços **com IVA**, uma venda **isenta** (empresa noutro país com VIES válido, exportação, isenção manual): o cliente paga o preço **sem o IVA do país do comerciante**, ou paga o mesmo preço? | ✅ **Decidido** (Diogo, 09/10/2026, com a aprovação do desenho; `docs/06`, CZ): **Sem o IVA do país do comerciante** (ex.: 12,30 € com IVA a 23 % → 10,00 €): é o que o cliente espera numa venda isenta, e não esconde IVA num preço sem IVA |
| Q2 | Enquanto o comerciante **não declarar o regime** (origem ou destino), as vendas a consumidores de **outros países da UE** ficam bloqueadas? | ✅ **Decidido** (Diogo, 09/10/2026, com a aprovação do desenho; `docs/06`, CZ): **Sim, bloqueadas**, com a mensagem «o comerciante ainda não configurou o IVA para este país»; o Eurolify não sabe as vendas que ele faz fora daqui, por isso não pode decidir o limiar por ele |
| Q3 | Um comerciante do continente que entrega nos **Açores ou na Madeira**: até o contabilista responder qual a taxa (`docs/03` §1, por responder), o que se faz? | ✅ **Decidido** (Diogo, 09/10/2026, com a aprovação do desenho; `docs/06`, CZ): **Bloquear essas vendas** até à resposta, e fazer a pergunta ao contabilista já: escolher uma taxa sem fonte é inventar (`AGENTS.md`, «Nunca inventar») |
| Q4 | A **isenção manual** passa a levar o **código do motivo** do documento (ex.: `M05`, `M07`), escolhido pelo dono de uma lista do país dele? | ✅ **Decidido** (Diogo, 09/10/2026, com a aprovação do desenho; `docs/06`, CZ): **Sim**: sem código, a isenção não chega à fatura; o código é obrigatório ao pôr uma isenção nova |
| Q5 | Na Fase 1, os **serviços e eventos** só se vendem com o lugar no **país do comerciante**? | ✅ **Decidido** (Diogo, 09/10/2026, com a aprovação do desenho; `docs/06`, CZ): **Sim**; fora dele, ou à distância, ficam bloqueados até o contabilista validar o lugar e o registo |

## 11. Para o contabilista (bloqueiam a produção, não o código)

| # | Pergunta |
|---|---|
| V5 | Quanto tempo antes do checkout pode ter sido a última resposta «válido» do VIES para isentar a venda? (vem do `docs/23`) |
| V6 | As taxas dos 27 países (normal, e as reduzidas das categorias que entrarem), com a fonte |
| V7 | Os códigos de motivo da AT (`M05`, `M16`, `M07`…) e os equivalentes dos outros países |
| V8 | Açores e Madeira: venda do continente leva a taxa regional? (Q3) |
| V9 | Arredondamento por linha ou por documento, por país |
| V10 | Os territórios especiais **C** (Åland, Monte Atos, Büsingen, Heligoland, Livigno, Campione, DOM, `XI`) |
| V11 | Que prova de saída se guarda numa exportação |

## 12. Como entra no código (quando aprovado)

| Parte | O quê |
|---|---|
| 1 | migração: categorias, naturezas, taxas (só `normal` e as de PT medidas, com fonte e **C** onde falta validação), territórios, motivos, registos fiscais, âmbitos; o fim da rede CM no Catálogo (a categoria tem de existir); rotas de leitura e do registo |
| 2 | a função da decisão, pura, com um teste por ramo da §5 (incluindo a #D4248, o bilhete comprado para outra pessoa, o `000000000` e as Canárias — `eu-vat-oss-ioss`, «Antes de dizer está feito») e o arredondamento; a simulação |

Cada parte com a revisão de um agente antes de juntar (ADR-0031, ADR-0035).

## 13. Em código (09/10/2026; migração 0040; `docs/06`, CZ)

| O quê | Onde |
|---|---|
| `categoria_fiscal` (só `normal`), `taxa_iva` (só se acrescenta; PT continente 23 %, Açores 16 %, Madeira 22 % na normal, **M**, `verificado = false`), `territorio_fiscal` (Canárias, Ceuta, Melilla **M**; ilhas portuguesas e os C por validar), `motivo_iva` (`M05`, `M16`, `M07`, **C**) — tabelas globais, a API só as lê | migração 0040 |
| `declaracao_regime`: o regime de cada entidade legal, só se acrescenta (a última vale), só por `pessoa:per_…` ou `chave:key_…`; evento `tax.regime_changed` | migração 0040 |
| o código do motivo na isenção manual, da lista do país do comerciante (Q4) | migração 0040; `src/clientes/` |
| o fim da rede CM: uma categoria fiscal nova ou mudada num artigo tem de estar na lista (`catalog.tax_category_unknown`); os artigos já gravados ficam | migração 0040 |
| a decisão, função pura pela ordem do Bruno, com a regra, a versão (`2026-10-09.2`) e a evidência; montantes em cêntimos, metade para cima, por linha | `src/iva/decisao.ts` |
| a API: `GET /tax/categories`, `/tax/rates`, `/tax/territories`, `/tax/reasons`, `GET /tax/registrations`, `PUT /tax/registrations/{id}`, `POST /tax/decisions/simulate` | `src/iva/rotas.ts` |
| os âmbitos `tax:read` (dono, gestor, apoio) e `tax:write` (dono) | migração 0040; `src/identidade/` |
| 22 testes da decisão (um por ramo: a #D4248, as Canárias e Palma de Maiorca, o VIES antigo, em baixo e «do futuro», o consumidor com NIF, as ilhas, Åland, a Irlanda do Norte, o Mónaco, os regimes, os serviços, a vigência no fuso, o arredondamento, os montantes, os países e códigos postais inválidos) e 6 pela API; 17 mutações antes da revisão e 21 depois, todas apanhadas (09/10/2026) | `test/iva-decisao.test.ts`, `test/iva-api.test.ts` |

**Desvios do desenho:**
- **As taxas dos outros 26 países não entram aqui:** carregam-se num pedido
  próprio, da base de dados de taxas da Comissão (TEDB), com a fonte e a data
  de cada linha, e com o contabilista (V6). Até lá, uma venda que precise
  delas (regime destino, ou um país sem taxa) fica **bloqueada**
  (`taxa_em_falta`).
- **A `natureza_iva` ainda não está no artigo:** entra com o checkout (fatia
  7), que é quem a lê; a simulação recebe-a explícita.
- **O aviso dos 10.000 €** (§3.5) espera pelas encomendas: hoje não há vendas
  para contar.
- **`tax.rate_added`** não sai: as taxas são globais e o evento é por
  comerciante; uma taxa nova vê-se em `GET /tax/rates`.
- **Os registos noutros países** guardam-se na declaração (lista), sem tabela
  própria; a decisão ainda não os usa (os serviços fora do país estão
  bloqueados, Q5).
- **A idade máxima da resposta «válido» do VIES** é 72 h — **C**, até à V5.
- **Uma empresa sem VIES válido noutro país da UE** não compra como empresa:
  **bloqueada** (`b2b_sem_vies`); pode comprar como consumidor (revisão do
  #256, P1-3).

**Da revisão do #256 (09/10/2026):**
- **Países:** só os 249 códigos da ISO 3166-1; um código fora dela
  (`XX`, `EL`, `XI`) bloqueia (`pais_invalido`), nunca é «fora da UE». O
  comerciante tem de ser de um país da UE.
- **Territórios por validar acrescentados** (todos **C**): Irlanda do Norte
  (`GB`, prefixo `BT`), Mónaco e Ilha de Man (o país todo, prefixo vazio), o
  ultramar francês (`FR` 97 e 98, e os códigos ISO próprios: GP, MQ, GF, RE,
  YT, MF, BL, PM, NC, PF, WF, TF), Åland (`AX`), São Marinho e Vaticano.
- **Código postal:** num país com territórios especiais é obrigatório
  (`codigo_postal_em_falta`) e tem de ter a forma do país
  (`codigo_postal_invalido`: um símbolo, ou letras onde os prefixos são só
  algarismos).
- **Sem coluna `fim` nas taxas** (§3.3): uma taxa vale até à linha seguinte do
  mesmo país, região e categoria; uma correcção é uma linha nova, por
  migração revista.
- **«Verificada»:** só com a taxa verificada **e** a regra na lista das
  validadas pelo contabilista, hoje vazia — nenhuma decisão sai verificada.
- **O dia da taxa** conta-se no fuso do comerciante (**C**: não verifiquei se
  a lei de cada país o conta assim); um fuso desconhecido bloqueia.
- **Montantes:** inteiros, não negativos e até 225 179 981 368 cêntimos por
  linha (o limite em que as contas não perdem precisão); fora disso,
  `montante_invalido`.
- **Serviço presencial a uma empresa** de outro país, ou sem perfil:
  **bloqueado** (`servico_b2b_por_validar`, **C**).
- **O VIES na decisão:** o estado e a data vêm da mesma prova; uma resposta com
  data posterior ao momento não conta; o limite das 72 h inclui-se.
- **A isenção manual** sobrepõe-se a um território por validar (é do NIF, e
  quem a deu responde por ela com o código); uma isenção de outro NIF fica na
  evidência como ignorada (`isencao_ignorada`).
- **A evidência** leva a moeda, o dia usado e os identificadores com prefixo
  (`exm_…`, `vvc_…`). Uma taxa sem percentagem bloqueia
  (`taxa_sem_percentagem`), nunca vale 0 %. Um perfil arquivado não decide
  (`tax.profile_archived`).
- **`versao_regras`** sobe a cada mudança da função (hoje `2026-10-09.2`); a
  encomenda guarda a versão com a decisão.
- **Por fazer:** a publicação de um artigo exigir uma categoria `activa` entra
  com o checkout (fatia 7); os artigos e as isenções já gravados sem código
  ficam (uma isenção sem código bloqueia a venda, `isencao_sem_codigo`).
