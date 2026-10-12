# Relatório OSS — os baldes do IVA, o fecho e os registos

> **Estado: aprovado** (`docs/06`, EE). Diogo, 12/10/2026: *«sim, aprovo o
> desenho com as propostas Q-O1 a Q-O5»*. Pedido inicial, 12/10/2026: *«sim,
> avança com o desenho do relatório OSS»*. É a parte 3 da fatia 10 (issue #310) e a peça
> 18 da Fase 1 (`docs/10`; trazida da Fase 2 pela decisão AD, ADR-0022). Só
> desenho; nenhum código antes de aprovado (ADR-0023).
>
> Skills seguidas: `eu-vat-oss-ioss` («OSS e IOSS»: quatro baldes, pelo país
> de entrega, NC com sinal negativo, fecho mensal congelado),
> `eurolify-tax-pos-invoicing-eu` (prova fiscal), `eurolify-legal-evidence-eu`
> (fonte, versão, W/M/C), `observability-security` (fecho com quem e quando,
> só se acrescenta) e `headless-commerce` (a rota).
>
> **Fontes, lidas no repositório `eur-lex` a 12/10/2026** (obtido a
> 10/10/2026; versões consolidadas aplicáveis desde 14/04/2025; o aviso
> oficial vale — o consolidado não tem valor jurídico, faz fé o JO):
> - Diretiva 2006/112/CE (Diretiva IVA), artigos 369.º-A a 369.º-K, o
>   **regime da União** (`corpus/iva-alfandegas-e-fiscalidade/32006L0112-diretiva-iva.md`,
>   linhas 4393–4539), e o artigo 59.º-C (o limiar de 10 000 €, linhas
>   1033–1055);
> - Regulamento de Execução (UE) n.º 282/2011, artigos 61.º (correcções) e
>   63.º-C (o que os registos contêm)
>   (`corpus/iva-alfandegas-e-fiscalidade/32011R0282-regulamento-de-execucao-iva.md`,
>   linhas 1264–1276 e 1344–1404).
>
> Marca **W/M/C** como no `docs/03`: **W** = lido no texto da UE; **C** = por
> confirmar (interpretação nossa, ou depende de lei nacional ou do
> contabilista). As validações profissionais fazem-se no fim do
> desenvolvimento (decisão EC, ADR-0045); até lá, **C** fica **C**.

## 1. O que o texto da UE pede (W)

| # | Regra | Fonte |
|---|---|---|
| L1 | A declaração OSS é **trimestral** (trimestre civil), entregue até ao **fim do mês seguinte**, mesmo sem vendas | Diretiva IVA, art. 369.º-F |
| L2 | Por **Estado-Membro de consumo**: o valor total líquido de IVA, as taxas aplicadas, o IVA **discriminado por taxa** e o IVA total devido | art. 369.º-G, n.º 1 |
| L3 | Nas vendas à distância de bens, o Estado-Membro de consumo é **onde termina o transporte** para o cliente | art. 369.º-A, ponto 3, al. b) |
| L4 | Bens expedidos de **outro Estado-Membro** que não o de identificação: os mesmos números por Estado-Membro de **expedição**, com o NIF de lá | art. 369.º-G, n.º 2 |
| L5 | Alterações a declarações já apresentadas entram numa **declaração posterior**, até **3 anos**, a dizer o Estado-Membro de consumo, o período e o montante | art. 369.º-G, n.º 4; Reg. 282/2011, art. 61.º, n.º 1, 2.º parágrafo (períodos desde o 3.º trimestre de 2021) |
| L6 | A declaração é **em euros**; outras divisas à taxa do BCE do **último dia do período** | art. 369.º-H |
| L7 | **Registos** de cada operação, durante **10 anos** a contar de 31 de dezembro do ano da operação, disponíveis por via electrónica: Estado-Membro de consumo, descrição e quantidade, data da entrega, valor tributável e moeda, aumentos e reduções posteriores, taxa, IVA e moeda, data e montante dos pagamentos, as informações da fatura, onde começa e acaba o transporte, prova de devoluções | art. 369.º-K; Reg. 282/2011, art. 63.º-C, n.ºs 1 e 3 |
| L8 | Abaixo de **10 000 €** por ano de vendas à distância intracomunitárias (e no ano anterior), a venda é tributada no país do vendedor, salvo opção | art. 59.º-C |

O Eurolify **não apresenta** a declaração: quem a apresenta é o comerciante
(ou o contabilista dele), no portal do Estado-Membro de identificação. O
Eurolify dá-lhe os números e os registos, tirados dos documentos que saíram.

## 2. O que entra e de onde vem

| Regra | Porquê |
|---|---|
| **O1.** Os montantes vêm **só das provas** (`documento_prova`: as linhas e os totais como o emissor os devolveu), nunca do pedido nem da encomenda | `docs/29` §11; `AGENTS.md`, «Não se erra…», regra 4 |
| **O2.** O balde de cada linha vem da **decisão de IVA copiada no conteúdo** do documento (a `regra` do Motor de IVA, `docs/24` §5.2), alinhada com a linha da prova pela posição (a mesma que a conferência R6/R7 usou) | a decisão é do Motor de IVA; o relatório não a refaz (`AGENTS.md`, «Uma regra, um sítio») |
| **O3.** O Estado-Membro de consumo é o **país de entrega** da encomenda (`destino` do conteúdo), nunca o nome da taxa | L3; `eu-vat-oss-ioss` |
| **O4.** Notas de crédito entram com **sinal negativo**, no balde e no país da fatura que corrigem (repetem o tratamento dela, `docs/29` §3.6) | `eu-vat-oss-ioss`; L2 |
| **O5.** Só documentos **emitidos** ou **resolvidos**. Um **divergente** por resolver aparece à parte e **impede o fecho** do período (Q-O4) | uma divergência é um número por decidir |
| **O6.** Só euros nesta fase (M6, `docs/29` §13.6): um documento noutra moeda impede o fecho; a conversão de L6 fica para quando houver | L6, **C** |

### 2.1 Os baldes (a regra do Motor de IVA → balde)

| Balde | Regras do Motor de IVA | Vai para | Grau |
|---|---|---|---|
| **OSS** — vendas à distância para outro Estado-Membro, à taxa do destino | `distancia_destino` | a declaração OSS, por Estado-Membro de consumo e por taxa (L2) | W (L2, L3) |
| **Nacional** — IVA do país do comerciante | `nacional`, `distancia_origem`, `servico_no_lugar` no país do comerciante | a declaração periódica nacional (fora do OSS) | **C** (a declaração nacional é lei nacional) |
| **Intracomunitárias isentas** — B2B com NIF válido no VIES | `vies_intracomunitaria` | a declaração recapitulativa (fora do OSS) | **C** |
| **Exportação** — fora do território de IVA da UE | `exportacao` | não entra no OSS | **C** |
| **Outras isentas** — isento por natureza ou isenção manual | `isento_natureza`, `isencao_manual` | não entra no OSS; o contabilista diz onde (Q-O3) | **C** |

A skill fala em **quatro** baldes; a proposta separa um **quinto** (Q-O3),
porque uma isenção manual ou por natureza não é uma entrega intracomunitária
e misturá-las punha na declaração recapitulativa o que não é dela.

### 2.2 À parte, nunca nos baldes

| Lista | O que mostra | Porquê |
|---|---|---|
| **Emitidas fora do Eurolify** (`fora`, `docs/29` §15) | quantas, a encomenda, o país de entrega e o total da encomenda, com o número **declarado** | Q-F3 (EA): o comerciante junta-as ao OSS dele |
| **Vendas com sistema próprio** (ADR-0041) | o mesmo, para as encomendas pagas no período com `emissor = sistema_proprio` | Q-O5: sem isto, um relatório «completo» esquecia-as |
| **Por emitir** | pedidos retidos, prontos ou incertos com data de pagamento no período | para não fechar com vendas ainda sem documento |

### 2.3 O limiar dos 10 000 € (informação)

O relatório mostra o total, líquido de IVA, das vendas à distância
intracomunitárias que o Eurolify **vê** no ano civil (baldes OSS e as
`distancia_origem`). Não decide nada: o regime declara-o o comerciante
(`docs/24` §3.5, porque há vendas fora do Eurolify). Quando o total passa
10 000 €, o relatório avisa (L8, **W**; o aviso é a proposta do `docs/24`
§3.5).

## 3. O período e o fecho

| Regra | Grau |
|---|---|
| **P1.** O relatório pede-se por **trimestre civil** (L1) e também por **mês** (para a declaração nacional) | W (trimestre); mês, proposta |
| **P2.** Um documento conta no período da **data do documento** (a `data` da prova), no fuso de Portugal (a entidade da Fase 1) | **C** (Q-O1): a regra geral é a entrega (art. 63.º, **W**); o art. 66.º deixa cada Estado-Membro pôr a exigibilidade na emissão da fatura ou no pagamento (**W**) — o que Portugal escolheu é lei nacional, não lida |
| **P3.** **Fechar** um período congela-o: grava-se uma **fotografia** (os números, os documentos que entraram, a versão da regra dos baldes), com quem fechou e quando; só se acrescenta | `eu-vat-oss-ioss` («Fecho mensal: retrato congelado»); `observability-security` |
| **P4.** Um documento que chegue **depois** do fecho com data num período fechado (uma NC, uma fatura que estava retida) entra no **próximo período aberto** como **alteração** desse período, com o Estado-Membro, o período original e o montante | W (L5) |
| **P5.** Não fecha com divergentes por resolver, documentos noutra moeda, ou pedidos «por emitir» do período sem uma pessoa dizer que os viu | proposta (Q-O4) |
| **P6.** Fechar é do **dono** (Q-O4); reabrir não existe — corrige-se com alterações no período seguinte (L5) | proposta |

## 4. Os registos (L7)

Uma exportação, por período, **uma linha por linha de documento**, com o que
o art. 63.º-C pede e o Eurolify tem:

| Campo do art. 63.º-C, n.º 1 | De onde vem |
|---|---|
| a) Estado-Membro de consumo | o país de entrega (O3) |
| b) descrição e quantidade | a linha da prova |
| c) data da entrega | a data da expedição (`docs/27`); sem expedição registada, vazio e marcado |
| d) valor tributável e moeda | a linha da prova |
| e) aumentos e reduções posteriores | as NC da fatura (O4) |
| f), g) taxa e IVA, com a moeda | a linha da prova |
| h), i) pagamentos (data, montante, adiantamentos) | o pagamento capturado (`docs/26`) |
| j) as informações da fatura | o número, a série, a data e o ATCUD da prova |
| k) onde começa e acaba o transporte | o país do armazém e o país e código postal de entrega |
| l) prova de devolução | a devolução ligada à NC (`docs/30`) |

Os registos ficam **10 anos** (L7; o mesmo prazo do art. 52.º do CIVA,
`docs/29` §6). Exportam-se em CSV, com o cabeçalho em português, e nunca vão
para os registos do servidor (têm dados pessoais: `eu-gdpr-privacy`).

## 5. A API

| Rota | Âmbito |
|---|---|
| `GET /tax-reports/oss?periodo=2026-T4` (ou `2026-10`): os baldes, por país e taxa, as alterações de períodos anteriores, as listas à parte, o limiar, o que impede o fecho | `tax:read` |
| `POST /tax-reports/oss/{periodo}/close` (com a versão e as confirmações de P5) | `tax:write` (só o dono, Q-O4) |
| `GET /tax-reports/oss/{periodo}` de um fechado: a fotografia, nunca recalculada | `tax:read` |
| `GET /tax-reports/oss/{periodo}/records.csv`: os registos da §4 | `tax:read` |

Eventos: `tax_report.closed`. Erros novos: `tax_reports.not_closable`
(com o motivo), `tax_reports.already_closed`, `tax_reports.invalid_period`.

## 6. Perguntas para o Diogo ou o Bruno

| # | Pergunta | Proposta |
|---|---|---|
| Q-O1 | **Em que período conta um documento?** | **pela data do documento** (a data da fatura, como o emissor a devolveu); o contabilista confirma no fim se é a data da entrega (**C**) |
| Q-O2 | **Uma NC conta onde?** | **no período da data da NC**, a negativo, no país e na taxa da fatura que corrige; se essa fatura estiver num período já fechado, a NC é uma alteração dele (P4) (**C**) |
| Q-O3 | **Quatro ou cinco baldes?** | **cinco**: «outras isentas» (por natureza e manuais) à parte das intracomunitárias, para não as misturar na recapitulativa |
| Q-O4 | **Quem fecha, e o que impede fechar?** | **só o dono**; não fecha com divergentes, outra moeda ou «por emitir» por ver (P5); não se reabre — corrige-se no período seguinte |
| Q-O5 | **As vendas com sistema próprio aparecem?** | **sim, numa lista à parte** (como as `fora`), só com a contagem, o país e o total da encomenda |

## 7. Por onde é que isto ainda pode sair errado

| Risco | O que o trava |
|---|---|
| contar uma venda duas vezes (fatura e `fora`) | O1: só provas nos baldes; as `fora` não têm prova (`docs/29` §15, F4) |
| um balde errado por um recálculo | O2: o balde vem da decisão copiada, nunca recalculada |
| uma NC esquecida num período fechado | P4: entra como alteração, com o período original |
| um período fechado que muda | P3: fotografia que só se acrescenta; P6: não se reabre |
| fechar com vendas por documentar | P5 |
| o limiar passado sem ninguém saber | §2.3 (aviso) |
| os registos com dados pessoais num registo do servidor | §4 |

## 8. Como entra no código (depois de aprovado)

- migração: a fotografia do fecho (só se acrescenta), o evento, os âmbitos já
  existentes;
- `src/iva/` ou um domínio `relatorios/` (a decidir no código, pela fronteira
  da `platform-architect`): a leitura dos baldes das provas, as alterações, as
  listas à parte, o limiar, o fecho e o CSV;
- testes: um por balde e por regra do Motor de IVA, NC a negativo, uma NC
  depois do fecho (alteração), divergente que impede o fecho, `fora` e
  sistema próprio à parte, os 10 000 €, a fotografia que não muda, o CSV com
  os campos do art. 63.º-C; mutações; a revisão do agente.

## 9. O que não foi verificado

- **A lei portuguesa** da declaração periódica nacional e da recapitulativa
  (fora do OSS): não li; os baldes «nacional» e «intracomunitárias» são **C**.
- **Se a data da fatura serve de data do período** (Q-O1): a Diretiva liga o
  facto gerador à entrega (art. 63.º) e deixa os Estados-Membros escolherem a
  fatura ou o pagamento (art. 66.º, linhas 1105–1117); o art. 66.º-A (linha
  1121) só trata das interfaces electrónicas do art. 14.º-A, que não é o caso
  do Eurolify. O que a lei portuguesa escolheu: **não li**.
- **O tratamento das NC** no OSS (Q-O2) para além do art. 369.º-G, n.º 4.
- **Vendas expedidas de outro Estado-Membro** (L4): a Fase 1 tem um armazém
  só; o relatório diz o país do armazém, mas não separa por país de expedição.

## 10. Em código (12/10/2026; migração 0075; EE)

| O quê | Onde |
|---|---|
| a regra do Motor de IVA → balde (cinco, Q-O3), o período (trimestre e mês), a classificação pura (baldes, alterações, impedimentos) | `src/faturacao/oss.ts` (`baldeDe`, `lerPeriodo`, `agregar`) |
| a leitura das provas (montantes) e do último conteúdo (a decisão), as listas à parte, o limiar no ano civil | `src/faturacao/oss.ts` (`relatorioOss`) |
| o fecho: só o dono (`tax:write`), um de cada vez por entidade, recusa com impedimentos (os «por emitir» só com `confirmo_por_emitir`), a fotografia e os documentos que entraram, uma vez só | `src/faturacao/oss.ts` (`fecharOss`); migração 0075 |
| `relatorio_oss_fecho` e `relatorio_oss_documento`: só se acrescentam (a base recusa mudar e apagar), RLS forçado; o evento `tax_report.closed` | migração 0075 |
| os registos do art. 63.º-C em CSV (com a protecção contra fórmulas) | `src/faturacao/oss.ts` (`registosOss`) |
| as rotas `GET /tax-reports/oss`, `POST /tax-reports/oss/close`, `POST /tax-reports/oss/classifications`, `GET /tax-reports/oss/records` | `src/faturacao/rotas-oss.ts` |
| 10 testes da classificação sem base; 5 pela API | `test/oss.test.ts`, `test/documentos-api.test.ts` |

**Desvios do desenho:**
- **As rotas** levam a entidade e o período na consulta (`?entidade=&periodo=`)
  e o fecho no corpo, em vez de `/{periodo}` no caminho: um comerciante pode
  ter mais de uma entidade (cada uma com o seu OSS).
- **O período de um documento** conta pela data da prova; os da lista à
  parte (`fora`, «por emitir») pela data em que o pedido nasceu, e os do
  sistema próprio pela captura do pagamento — não têm prova.
- **Um documento sem data** na prova impede o fecho (não se adivinha).

**Correcções da revisão do #392** (agente revisor, 12/10/2026):
- **CSV:** uma célula de texto que comece por `= + - @`, tabulação ou retorno
  leva sempre o apóstrofo (também `-1+1`); os números passam como estão; com
  BOM; as datas no fuso de Portugal.
- **As linhas** da prova e do conteúdo casam uma a uma pela quantidade, a taxa
  e o motivo; uma diferença impede (`linhas_desalinhadas`); um montante
  negativo na prova também (`sinal_inesperado`).
- **As emitidas fora** entram uma vez só (ficam em `relatorio_oss_documento`
  no fecho) e, se chegarem depois do fecho do seu período, aparecem como
  alteração dele (`alteracao_de`).
- **Impedem também:** um documento de um período anterior ainda aberto
  (`periodo_anterior_aberto`) e um documento já declarado que passou a
  divergente (`declarado_divergente`).
- **Os registos** de um período fechado lêem o balde e o país gravados no
  fecho (coluna `linhas`), nunca a regra actual; de um período aberto, só sem
  impedimentos que deixem documentos de fora. Sem expedição registada, o país
  de início do transporte fica vazio e `expedicao_registada = nao`.
- **O limiar** soma o ano civil e o anterior e diz quantos documentos ficaram
  fora da soma (`documentos_excluidos`).
- **A base** recusa também `TRUNCATE` nas duas tabelas.

**Decisão da 2.ª revisão do #392 (P1-B; Diogo, 12/10/2026: *«sim, aceito a
proposta para o P1-B»*):** não se fecha um período anterior ao último já
fechado da mesma granularidade (impedimento `periodo_posterior_fechado`); um
documento com data anterior ao último fecho entra sempre como alteração do
período seguinte, mesmo que o período dele nunca se tenha fechado no
Eurolify (Diretiva IVA, art. 369.º-G, n.º 4: as alterações a uma declaração
apresentada fazem-se numa declaração posterior; **C**, contabilista).

**Decisão da 2.ª revisão do #392 (P1-A; Diogo, 12/10/2026: *«aprovado»*):**
um documento que o relatório não classifica sozinho — uma fatura ou NC
`resolvido` (ou emitida) com as linhas da prova diferentes das do pedido, uma
linha sem balde, ou uma prova sem data — é classificado **pelo dono** em
`POST /tax-reports/oss/classifications` (`tax:write`): o balde e o país de
cada linha da prova, pela ordem dela; **a taxa e os valores vêm sempre da
prova**; a data só quando a prova não a tem. Fica em
`relatorio_oss_classificacao`, uma vez por documento, e a base recusa mudar,
apagar ou esvaziar. Ex.: uma fatura que saiu a 21 % quando o pedido dizia
23 %, aceite como `resolvido`, entra no balde nacional, PT, a 21 %. **C**
(contabilista): que essa linha se declara à taxa da fatura emitida. No
limiar, de um documento classificado conta o que o dono pôs no OSS.

**Também desta ronda:** as leituras do relatório e dos registos correm numa
só fotografia da base (P2-2); os erros saem com os códigos do relatório
(`tax_reports.*`, P3-6); um documento sem data conta uma vez só nos
excluídos do limiar (P3-3).

**Limites que ficam:**
- As vendas com sistema próprio não têm documento no Eurolify: mostram-se
  pela captura do pagamento e **não têm alteração** se o pagamento for
  capturado depois do fecho.
- O código de país é o do Eurolify (ISO 3166, `GR`); a declaração OSS usa
  `EL` para a Grécia — **não verifiquei** se o portal da AT pede um ou outro.
- `fechado_por` guarda a chave que fechou (o identificador dela), não o nome
  da pessoa.

**Por fazer:** o ecrã no Hub; os registos de serviços (art. 63.º-C, al. b) e
k) para serviços) quando houver; outras moedas (L6).
