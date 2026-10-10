# Eurolify — actores, papéis, canais e motor de regras por país

> **Versão de 04/10/2026.** Escrito a pedido do Diogo (04/10/2026), que mandou
> seguir o prompt do pacote complementar de skills (`eurolify-platform-orchestrator`
> e `eurolify-channel-governance`, lidas a partir do zip; não estão instaladas
> — ADR-0034; desde 05/10/2026 os canais seguem a `eurolify-b2b-channels-eu`, §3). **Não substitui** [`docs/02-arquitectura.md`](../02-arquitectura.md),
> que continua a ser a arquitectura dos domínios: este documento acrescenta o
> **papel real de cada actor**, os **canais comerciais**, as **dependências de
> digital e cartões-oferta** e o **motor de regras por país** — a primeira
> fatia, com o modelo e a lista da API em tabela, como o ADR-0023 pede antes do
> código.
>
> Marcas: **regra** (com fonte), **proposta** (desenho deste documento),
> **C** (não verificado). **Nada aqui declara conformidade**: o registo dos 27
> países começa todo «por verificar» ([`compliance-gaps.md`](compliance-gaps.md)).

## 1. O papel real de cada actor

O Eurolify **não é**, por omissão, marketplace, vendedor por conta própria
(*merchant of record*), instituição de pagamento nem sujeito passivo das
vendas dos comerciantes. Cada «não» tem uma condição que o pode mudar, escrita
ao lado.

| Actor | Papel real | Fonte | O que o pode mudar |
|---|---|---|---|
| **Luckytarget Lda (operador do Eurolify)** | fornecedor de software como serviço aos comerciantes; **subcontratante** dos dados dos clientes deles (RGPD), com acordo de tratamento por comerciante | `eu-gdpr-privacy` (tabela responsável/subcontratante); `docs/02` §5 | — |
| | **não recebe nem guarda o dinheiro** das vendas: cada comerciante liga a sua conta no prestador | `payments-psd2-sca`, regra 1; `docs/03` §5 (**C**) | guardar fundos de terceiros exige licença (PSD2) — nunca por omissão |
| | **não é marketplace** na Fase 1 | `marketplace-dsa`, «Primeira regra»; `docs/05` (marketplace fora da Fase 1) | um caso de negócio aprovado; aí o fornecedor presumido (art. 14.º-A da Directiva IVA, **C**) e o DSA pesam |
| | **não é sujeito passivo** das vendas dos comerciantes; fatura só a sua mensalidade (ADR-0007) | `eu-vat-oss-ioss`; `docs/02` §3 | nos serviços electrónicos, a presunção do art. 9.º-A do Reg. 282/2011 pode fazer de uma plataforma o fornecedor (**C**, `digital-products-eu`) — por isso o digital tem porta própria |
| | pode ser **«serviço de alojamento»** do DSA já na Fase 1 | `docs/03` §4 (pergunta para o jurista) | resposta do jurista |
| **Comerciante** | vende em nome próprio; **responsável pelo tratamento** dos dados dos seus clientes; **sujeito passivo** das suas vendas; responde pela garantia e pela livre resolução perante o consumidor | `eu-gdpr-privacy`; `consumer-rights-eu` | — |
| **Software de faturação certificado** (Moloni em Portugal) | emite o documento fiscal **do comerciante**, com os dados dele; o Eurolify decide o IVA e guarda a prova | D-4 (recomendação a)); `docs/05` Fase 1; ADR-0006 | D-10: se o comerciante já tem sistema de gestão, emite esse sistema |
| **Prestador de pagamento** (EuPago, Stripe…) | instituição autorizada; conta **do comerciante**; faz a autenticação forte | `payments-psd2-sca` | — |
| **Cliente** | **consumidor** (pessoa singular fora da actividade profissional) **ou profissional** — decidido **por encomenda**, não por conta | `consumer-rights-eu`; Dir. 2011/83/UE, art. 2.º (**C**) | — |
| **Transportadora** | presta o transporte ao comerciante; as suas regras não tiram direitos ao consumidor | `order-fulfilment` | — |
| **Emissor de um cartão-oferta** | o **comerciante**, num programa fechado só dele | `gift-cards-eu` (**C**) | vales aceites por vários comerciantes: porta financeira (PSD2) por decidir |
| **Parceiro de canal** (distribuidor, revendedor, franchisado, agente) | relação **entre o comerciante e o parceiro**; o Eurolify dá as ferramentas, não é parte do contrato | §3 deste documento (**C**) | — |
| **OVH** | subcontratante ulterior (alojamento e cópias, na UE) | ADR-0015, ADR-0032 | o ensaio está no Reino Unido até **31/03/2027**, sem dados pessoais reais (ADR-0018, ADR-0019) |

**Âmbito UE.** Os 27 Estados-membros (§4). Âmbito comercial e residência dos
dados são decisões diferentes: os dados ficam na UE (`AGENTS.md`, regra 4) e
isso inclui cópias, registos, e-mail, suporte e acessos remotos — a verificar
fornecedor a fornecedor (`compliance-gaps.md`).

## 2. Comerciantes pequenos e organizações maiores

| Dimensão | O que precisa | Onde vive |
|---|---|---|
| Individual | assistente de configuração com escolhas explicadas | Hub (Fase 1 mínima) |
| PME | equipas e papéis, integrações, mais de um armazém (Fase 2) | `observability-security` (permissões), `docs/05` |
| Empresarial | várias entidades legais na mesma conta, aprovações, SSO, limites medidos | **proposta**: entidade legal como registo próprio por baixo do comerciante — cada uma com o seu NIF, séries e livros, nunca misturados |

**Os direitos dos clientes e os controlos essenciais não são funções pagas**:
nenhum escalão (ADR-0007) os tira.

## 3. Canais comerciais — papéis por relação, não por conta

Segue a skill **`eurolify-b2b-channels-eu`** (instalada a 05/10/2026, #84),
que substitui como fonte o `eurolify-channel-governance` do pacote de 04/10,
nunca instalado (decisão do Diogo, 05/10/2026: *«sim, manda a skill nova»*,
Q4 do `docs/16`). Regras de concorrência e de agência: **W · texto lido** nos
artigos citados no `docs/03` §7 (Reg. (UE) 2022/720, arts. 3.º, n.º 1, 4.º,
8.º, al. d), e 11.º; Dir. 86/653, arts. 1.º, 2.º e 17.º a 19.º; lidos a
06/10/2026, #135); **C** no resto (ex.: arts. 2.º e 5.º do Reg. 2022/720, as
orientações da Comissão, as leis nacionais). A skill manda análise
concorrencial antes de restringir preço, território, venda online ou
clientes. Na Fase 1
só entram as **listas de preços B2B por etiqueta**; o resto é da **Fase 2**
(Diogo, 05/10/2026; `docs/05`).

### 3.1 Modelo (proposta)

| Registo | O que guarda |
|---|---|
| **Parte** | uma pessoa ou empresa, com o seu NIF quando o tem; **não tem tipo fixo** |
| **Relação comercial** | comerciante ↔ parte, com o tipo da relação (abaixo), datas e estado |
| **Versão do contrato** | o que foi acordado e quando: produtos, território (informação), mínimos de compra, preço de compra, duração, denúncia; nunca editado — versão nova |
| **Política do canal** | uma regra comercial sensível (preço, território, venda online, não concorrência, partilha de dados) com o estado `desligada` por omissão, o parecer guardado, âmbito, revisão e quem decidiu |
| **Papel na encomenda** | quem vende, quem compra, a **finalidade** (consumo, uso profissional, revenda), quem recebe o dinheiro, quem envia, quem responde pela garantia |

**Tipos de relação:** distribuidor (compra, guarda stock e revende a
jusante), revendedor (compra para revender em nome próprio; inclui envio
directo pelo fornecedor), franchisado (negócio próprio dentro de uma rede de
marca e saber-fazer, com royalties), agente (negoceia por conta do principal),
operador logístico (guarda ou entrega por conta de outro, sem vender),
cliente profissional, consumidor. **A mesma parte pode ter várias relações**
com papéis diferentes. «Cliente profissional» nunca tira direitos a quem
actua como consumidor (`eurolify-b2b-channels-eu`).

### 3.2 Como se classifica

- **A relação**, pelo contrato e pelos riscos reais (quem compra, guarda o
  stock, fatura e suporta o risco), nunca pela etiqueta «parceiro».
- **Cada encomenda**, pela finalidade declarada naquela compra. Um NIF não tira
  direitos de consumidor a uma compra pessoal; um caso ambíguo vai para
  revisão, nunca para exclusão.

### 3.3 O que fica desligado até haver revisão

| Política | Porquê | Fonte (marca) |
|---|---|---|
| preço mínimo ou fixo de revenda, bloqueio de publicação abaixo do recomendado | restrição especialmente grave | Reg. 2022/720, art. 4.º, alínea a) (**W** · texto lido, `docs/03` §7) |
| recusar um pedido por território, morada ou IP | uma venda passiva não é venda activa | art. 4.º, alíneas b) a d) (**W** · texto lido); Reg. 2018/302 (**C**) |
| desligar a venda online, ou somar regras que a impeçam | restrição especialmente grave | art. 4.º, alínea e) (**W** · texto lido) |
| não concorrência sem prazo ou acima de 5 anos, pós-contratual | excluída da isenção, com excepções | art. 5.º (**C**) |
| mostrar ao fornecedor preços futuros, margens ou clientes identificados de revendedores concorrentes | troca de informação fora da isenção | art. 2.º, n.os 4 e 5 (**C**) |

Ficar fora da isenção **não** quer dizer ilegal: quer dizer análise caso a caso.
O Eurolify bloqueia a política e diz porquê; nunca declara o parceiro ilegal.

### 3.4 Encaixe nos domínios

| Domínio (`docs/02`) | O que recebe |
|---|---|
| Clientes e identidade fiscal | parte, relação comercial, finalidade por encomenda |
| Preços e mercados | listas B2B por relação (Fase 1, por etiqueta); preço de compra separado do recomendado |
| Encomendas | papel na encomenda |
| Stock | stock por entidade; consignação só com contrato |
| Novo, por decidir | versão do contrato, política do canal, royalties do franchising |

## 4. Motor de regras por país — primeira fatia

O `eurolify-country-rule-engine` do pacote propõe um registo de regras por
país, com vigência e prova, que **decide por combinação** (país, território,
domínio, momento) e **bloqueia** o que não está verificado. Nenhuma taxa,
prazo ou transposição é escrita aqui: o registo começa com os 27 países
**todos por verificar**, e por isso hoje **tudo sai bloqueado**. É o
comportamento certo: o checkout, a fatura e a livre resolução vão perguntar a
este motor antes de agir.

### 4.1 Modelo

| Registo | Campo | Notas |
|---|---|---|
| **Registo** | `versao` | sobe a cada alteração; cada decisão guarda a versão usada — uma versão nova **não reescreve** o que já foi decidido |
| | `paises` | os 27, por código ISO 3166-1 (Grécia = `GR`; o prefixo fiscal `EL` é coisa do adaptador do VIES, `eu-vat-oss-ioss`) |
| **Perfil do país** | `codigo`, `nome` | |
| | `dominios` | por domínio (os 7 obrigatórios e os 4 condicionais), o estado da revisão: `por_verificar`, `verificado`, `nao_aplicavel` (este exige justificação e prova) |
| | `territorios` | `null` = não mapeados: um território pedido **não herda** a regra do continente |
| **Regra** | `id`, `versao`, `dominio`, `pais` | a `id` é única em todo o registo: identifica uma regra de um país e de um domínio, nas suas versões; as decisões citam `id@versao`. **O território não faz parte da identidade** (#59, #283): uma regra dos Açores e outra da Madeira têm `id` diferentes; duas versões da mesma `id` com territórios diferentes a valer ao mesmo tempo são recusadas ao arrancar, como quaisquer duas versões sobrepostas. Formato: minúsculas, algarismos, `.`, `_` e `-`, a começar por letra ou algarismo (ex.: `pt-consumidor-1`) — nada de maiúsculas nem espaços que façam duas `id` parecer a mesma |
| | `estadoLegal` | `em_vigor`, `adoptada_futura`, `proposta`, `revogada` — uma **proposta nunca decide**, e por isso pode entrar num domínio ainda `por_verificar`; os outros estados só num domínio `verificado` (decisão do Diogo, 04/10/2026) |
| | `aplicaDesde`, `aplicaAte` | instantes ISO 8601 **com fuso** (`Z` ou `±hh:mm`, até ±23:59, não `-00:00` — na RFC 3339 é «fuso desconhecido»; fracção de segundo até 3 dígitos); vale de `aplicaDesde` (incluído) até `aplicaAte` (excluído) |
| | `base` | URL oficial, título, artigo |
| | `verificadaEm`, `revistaPor` | |
| | `marca` | `W`, `M` ou `C`, com o significado do `docs/03` (tabela «Como ler a coluna Verificação»); `textoLido` diz se, num `W`, o texto legal foi lido (e não só o resumo) — decisão do Diogo, 05/10/2026 (*«avança com a marca W/M/C no motor de regras»*; P1 da auditoria `docs/16`) |
| | `validacao` | `null` ou `{ por, papel, em }`, com `papel` um dos da coluna «Quem valida» do `docs/03` (`jurista`, `contabilista`, `tecnico_regulamentar`, `despachante`, `entidade_gestora`, `encarregado_de_dados`, `transportadora`): a validação profissional da regra. **O papel tem de corresponder ao domínio** (Diogo, 06/10/2026, #59: *«sim, concordo, tem de corresponder»*): só valida um papel indicado para o tema na coluna «Quem valida» do `docs/03`; senão o `validar` recusa o registo. Feito **linha a linha** (decisão BR, #128): cada regra traz `tema`, o identificador da linha do `docs/03` de onde vem (`TEMAS_DOCS03` em `apps/api/src/regras/temas.ts`, 64 linhas das secções 1 a 5 e 7); com uma validação, o `tema` é obrigatório e o papel tem de estar na coluna «Quem valida» dessa linha (uma linha com «—» não aceita nenhum). Cada linha diz o domínio em que vive (decisão do Diogo, 06/10/2026, revisão do #133, P2-2: *«fica a a)»*), pelas definições do `docs/eurolify/compliance-gaps.md` §1 — ex.: a informação de entrega em `consumidor`, a acessibilidade e o DSA em `acessibilidade_plataforma`; o tema de uma regra tem de ser do domínio dela. Cinco linhas ficam sem domínio e nenhuma regra as usa até se decidir: três não cabem em nenhuma definição (mudança de fornecedor de nuvem, IA, cibersegurança) e duas esperam que um profissional diga onde ficam (a DAC7, pelo contabilista, e o fim da isenção aduaneira, pelo despachante; decisão BZ, Diogo, 06/10/2026: *«a»*). Os quatro domínios condicionais têm uma linha cada na secção 7 do `docs/03` (acordos verticais, franchising, agentes comerciais e P2B; #135), validadas por um jurista. O teste `regras-temas.test.ts` lê o `docs/03` e falha se a tabela deixar de dizer o mesmo. Antes (#126) a regra era por domínio, com a união dos papéis. O `decidir` também não aceita um papel que não corresponda (`regra_sem_prova`). Num `W` com texto lido, a data da leitura é o `verificadaEm` |
| | `tema` | `null` ou o identificador da linha do `docs/03` de onde a regra vem (`TEMAS_DOCS03`); obrigatório com uma `validacao` (decisão BR, #128) |
| | **pode decidir** | uma regra que não é `proposta` só entra num domínio `verificado` se tiver **`W` com texto lido** ou **validação profissional** — a regra do `docs/03` («uma linha C não entra numa decisão sem passar a W com o texto legal lido ou ser validada por um profissional»), estendida a `M` e a `W` só de resumo por decisão do Diogo, 05/10/2026 (*«mantém para M e W só de resumo»*). O `validar` recusa o registo; o `decidir`, se lhe chegar uma assim, não a aplica (`regra_sem_prova`) |

**Domínios obrigatórios** (do pacote): consumidor, IVA, faturação, privacidade
e marketing, produto e ambiente, acessibilidade e plataforma, pagamentos.
**Condicionais**: distribuição e concorrência, franchising, agência comercial,
termos entre plataforma e empresas.

### 4.2 Decisão

Entrada: país, território (opcional), domínios pedidos (pelo menos um),
momento (ISO 8601 com fuso).
Saída: `estado` (`permitido`, `revisao_necessaria`, `recusado`), regras
aplicadas, versão do registo e motivos.

**A data de verificação de um domínio não limita o momento pedido**
(Diogo, 06/10/2026, #59: *«sim, concordo, fica a a)»*): diz quando se leu;
o que vale para cada momento é a vigência e a prova de **cada versão** da
regra. Ex.: uma nota de crédito de 2027 sobre uma venda de 10/11/2026 decide
com a versão em vigor a 10/11/2026, desde que essa versão tenha prova.

**Nunca sai `permitido` sem pelo menos uma regra aplicada** (corrigido a
04/10/2026, revisão do #37, P0-1: uma lista de domínios vazia saía
permitida).

| Caso | Resultado |
|---|---|
| Código de país que não são duas maiúsculas (`pt`, `PRT`), ou que não é texto | `recusado`, motivo `codigo_pais_invalido` — não se normaliza |
| País fora dos 27 (`CH`, `GB`, `EL`) | `recusado`, motivo `pais_fora_da_ue` |
| Momento que não é ISO 8601 com fuso, ou data impossível (`2026-02-30`), ou com `-00:00` (a mesma leitura das datas das regras e das verificações) | `recusado`, motivo `momento_invalido` |
| Lista de domínios vazia, ou que não é uma lista | `recusado`, motivo `sem_dominios` |
| Domínio que não existe (também `constructor`, `__proto__`) | `recusado`, motivo `dominio_desconhecido` |
| Território pedido e não mapeado | `revisao_necessaria`, motivo `territorio_nao_mapeado` |
| Domínio `por_verificar`, ou com um estado que não existe | `revisao_necessaria`, motivo `dominio_por_verificar` — só `verificado` segue para as regras |
| Domínio `verificado` sem regra em vigor nesse momento | `revisao_necessaria`, motivo `sem_regra_em_vigor` |
| Regra `proposta`, ou `adoptada_futura` antes de `aplicaDesde`, ou com um estado legal que não existe | não conta — só `em_vigor`, `adoptada_futura` e `revogada` podem contar. Uma `adoptada_futura` cuja data já chegou **conta**, sem passar a `em_vigor` à mão: um acto adoptado aplica-se a partir da data de aplicação (a distinção proposta / adoptado / aplicação da `eurolify-regulatory-watch-eu`); a prova continua a ser exigida (#59, #283) |
| Regra `revogada` depois de `aplicaAte` | não conta |
| Território mapeado, só com a regra do continente | `revisao_necessaria`, motivo `sem_regra_em_vigor` (o território não herda) |
| Domínio `nao_aplicavel` com justificação | não bloqueia |
| Só domínios `nao_aplicavel` | `revisao_necessaria`, motivo `sem_regra_aplicada` |
| Regra em vigor sem `W` com texto lido nem validação profissional (só num registo que não passou pelo `validar`) | `revisao_necessaria`, motivo `regra_sem_prova` — bloqueia o domínio, e as outras regras dele não se aplicam |
| Todos os domínios pedidos verificados, com regra em vigor **e com prova** | `permitido` |

**O registo é validado ao arrancar** (`validar.ts`): datas sem fuso ou
impossíveis, `aplicaAte` antes de `aplicaDesde`, `revogada` sem data de fim,
regra repetida, duas versões da mesma regra a valer ao mesmo tempo (uma
`proposta` não conta), país sem perfil, território não mapeado, regra num
domínio que não está `verificado` (uma `proposta` pode estar num domínio
`verificado` ou `por_verificar`, nunca num `nao_aplicavel`; revisão do #49) ou
que não existe (também um domínio que não
é texto, como `["consumidor"]`; revisão do #50), estado de revisão ou
estado legal desconhecido, prova vazia (`base`, `revistaPor`, `revistoPor`),
`id` vazia ou `versao` que não é inteiro ≥ 1 (revisão do #40), a mesma
`id` em dois países ou dois domínios, propostas incluídas (revisão do #45),
`id` fora do formato do §4.1 (revisão do #50), marca desconhecida, `textoLido` que não é booleano ou fora de um `W`, validação mal formada (sem `por`, papel fora da lista, data inválida) e regra que não é `proposta`, num domínio `verificado`, sem prova para decidir (§4.1; a vigência não conta: uma versão antiga ou futura também precisa de prova) —
a aplicação **não arranca** e diz a lista toda.

Um bloqueio vale **só para a combinação pedida**: o IVA de França bloqueado
não bloqueia o consumidor de Portugal.

### 4.3 Lista da API

| Operação | Método e caminho | Quem | Notas |
|---|---|---|---|
| Cobertura dos países | `GET /paises` | qualquer cliente (dados do Eurolify, sem dados pessoais) | os 27, o estado de cada domínio e a versão do registo; **provisório** até haver a versão por data e a autenticação da API de Administração (`headless-commerce`) |

A decisão (`decidir`) é **interna**: chamam-na os domínios no servidor. Não
fica exposta para os frontends refazerem decisões (`AGENTS.md`, «Uma regra, um
sítio»).

### 4.4 Onde vive

`apps/api/src/regras/` — dados do Eurolify, iguais para todos os comerciantes
(classe 2 da `platform-architect`): nesta fatia ficam no código, com versão;
passam para a base quando houver revisão de regras pelo Hub.

**Quando o registo passar para a base** (#59, #283): cada versão chega como
JSON lido da base e passa pelo `errosDoRegisto` antes de ser servida; só
então decide. Hoje nenhum caminho entrega ao motor outra coisa (o registo
está no código), mas um objecto que não seja dados simples (um `Proxy`, por
exemplo) pode rebentar o `validar` e o `decidir` (`mostrar.ts`, medido nas
revisões do #50, sem teste).

### 4.5 A prontidão por país (`eurolify-country-readiness-eu`) e o motor

A skill fala de **estados de revisão** de um país; o motor, de estados de um
domínio e de uma regra. Correspondem assim (#59, #283):

| Na skill (`eurolify-legal-briefing-eu`, `references/countries.md`) | No motor | Notas |
|---|---|---|
| `pendente` | domínio `por_verificar` | o ponto de partida dos 27 (`countries.json`: `national_law_status: pending`) |
| `confirmado` | domínio `verificado`, com regras com prova (`W` com texto lido ou validação profissional) | um domínio `verificado` sem regra em vigor continua a sair `revisao_necessaria` |
| `não aplicável com fundamento` | domínio `nao_aplicavel`, com justificação e prova | |
| `bloqueado` | não é um estado guardado: é o resultado `revisao_necessaria` ou `recusado` da decisão, para uma combinação | |
| `revogado/substituído` | regra `revogada` (com `aplicaAte`) e a versão seguinte da mesma `id` | |

**Os domínios não são os mesmos.** Os 10 `pending_domains` do
`countries.json` (consumidor, IVA e faturação, fiscal de caixa, produto e
setor, privacidade, resíduos e embalagens, instalações e emprego,
transporte, permissões de pagamento, concorrência e contratos) não
coincidem com os 7 obrigatórios e os 4 condicionais do motor. Por exemplo,
caixa, resíduos, instalações e transporte não têm domínio no motor. Ficam
**por verificar**, sem domínio no motor, até haver uma decisão do Diogo ou
do Bruno sobre os acrescentar. Até lá, o motor não os pode dar como
cobertos.

## 5. Digital e cartões-oferta

**Decisão do Diogo (04/10/2026):** *«Não excluas produtos digitais e
cartões-oferta só por faltarem regras: identifica as dependências e usa as duas
skills específicas para os desenhar. Não os ativas em produção antes dos
respetivos gates.»* — responde à P3 do `docs/14` (ADR-0034).

| Dependência | Digital (`digital-products-eu`) | Cartão-oferta (`gift-cards-eu`) |
|---|---|---|
| Catálogo | tipo `conteudo_digital` / `servico_digital`; perfil digital; duas classificações (consumidor e IVA) | tipo `cartao_oferta`; programa de vales com classe SPV/MPV |
| Motor de regras (§4) | domínios consumidor e IVA verificados no país | domínios IVA e pagamentos verificados |
| Checkout | consentimento e reconhecimento por linha; prova do país do cliente (dois elementos) | compra de vale separada de pagar com vale |
| Pagamentos | pagamento confirmado no servidor antes de entregar | vale só nasce com pagamento confirmado; saldo por movimentos |
| Encomendas / entrega | entrega autenticada, direitos de acesso | entrega do código; códigos seguros |
| Devoluções | livre resolução ≠ desconformidade | livre resolução do vale não usado (desenho conservador) |
| Decisões em aberto | quem é o fornecedor perante o IVA (art. 9.º-A) | choque com a carteira da `eu-vat-oss-ioss`; porta PSD2 |
| **Porta para ligar** | os 16 testes da skill passam; jurista e contabilista validam | os 21 testes passam; contabilista e jurista validam |

## 6. O que este documento não decide

- As perguntas P1, P2 e P4 a P7 do Catálogo: decididas no `docs/14` §9 (Diogo, 05/10/2026; `docs/06`, AR), não aqui.
- Se as skills do pacote se instalam (ADR-0034: usadas a partir do zip).
- ~~Portais de distribuidor, franchising e royalties em que fase.~~ Decidido: Fase 2, só as listas de preços B2B na Fase 1 (Diogo, 05/10/2026; `docs/05`).
- O preenchimento de qualquer regra nacional: cada uma entra com fonte oficial
  lida, data e revisor.
