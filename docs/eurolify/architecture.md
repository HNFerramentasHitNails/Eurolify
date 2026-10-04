# Eurolify — actores, papéis, canais e motor de regras por país

> **Versão de 04/10/2026.** Escrito a pedido do Diogo (04/10/2026), que mandou
> seguir o prompt do pacote complementar de skills (`eurolify-platform-orchestrator`
> e `eurolify-channel-governance`, lidas a partir do zip; não estão instaladas
> — ADR-0034). **Não substitui** [`docs/02-arquitectura.md`](../02-arquitectura.md),
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

Segue o `eurolify-channel-governance` do pacote (**C** em tudo o que é regra
de concorrência: Reg. (UE) 2022/720, Dir. 86/653, não lidos por nós). Na Fase
1 só entram as **listas de preços B2B por etiqueta** (`docs/05`); o resto é
desenho para quando o Diogo ou o Bruno o puserem numa fase.

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
cliente profissional, consumidor. **A mesma parte pode ter várias relações**
com papéis diferentes.

### 3.2 Como se classifica

- **A relação**, pelo contrato e pelos riscos reais (quem compra, guarda o
  stock, fatura e suporta o risco), nunca pela etiqueta «parceiro».
- **Cada encomenda**, pela finalidade declarada naquela compra. Um NIF não tira
  direitos de consumidor a uma compra pessoal; um caso ambíguo vai para
  revisão, nunca para exclusão.

### 3.3 O que fica desligado até haver revisão

| Política | Porquê | Fonte (**C**) |
|---|---|---|
| preço mínimo ou fixo de revenda, bloqueio de publicação abaixo do recomendado | restrição especialmente grave | Reg. 2022/720, art. 4.º, alínea a) |
| recusar um pedido por território, morada ou IP | uma venda passiva não é venda activa | art. 4.º, alíneas b) a d); Reg. 2018/302 |
| desligar a venda online, ou somar regras que a impeçam | restrição especialmente grave | art. 4.º, alínea e) |
| não concorrência sem prazo ou acima de 5 anos, pós-contratual | excluída da isenção, com excepções | art. 5.º |
| mostrar ao fornecedor preços futuros, margens ou clientes identificados de revendedores concorrentes | troca de informação fora da isenção | art. 2.º, n.os 4 e 5 |

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
| **Regra** | `id`, `versao`, `dominio`, `pais` | a `id` é única em todo o registo: identifica uma regra de um país e de um domínio, nas suas versões; as decisões citam `id@versao`. Formato: minúsculas, algarismos, `.`, `_` e `-`, a começar por letra ou algarismo (ex.: `pt-consumidor-1`) — nada de maiúsculas nem espaços que façam duas `id` parecer a mesma |
| | `estadoLegal` | `em_vigor`, `adoptada_futura`, `proposta`, `revogada` — uma **proposta nunca decide**, e por isso pode entrar num domínio ainda `por_verificar`; os outros estados só num domínio `verificado` (decisão do Diogo, 04/10/2026) |
| | `aplicaDesde`, `aplicaAte` | instantes ISO 8601 **com fuso** (`Z` ou `±hh:mm`, até ±23:59, não `-00:00` — na RFC 3339 é «fuso desconhecido»; fracção de segundo até 3 dígitos); vale de `aplicaDesde` (incluído) até `aplicaAte` (excluído) |
| | `base` | URL oficial, título, artigo |
| | `verificadaEm`, `revistaPor` | |

**Domínios obrigatórios** (do pacote): consumidor, IVA, faturação, privacidade
e marketing, produto e ambiente, acessibilidade e plataforma, pagamentos.
**Condicionais**: distribuição e concorrência, franchising, agência comercial,
termos entre plataforma e empresas.

### 4.2 Decisão

Entrada: país, território (opcional), domínios pedidos (pelo menos um),
momento (ISO 8601 com fuso).
Saída: `estado` (`permitido`, `revisao_necessaria`, `recusado`), regras
aplicadas, versão do registo e motivos.

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
| Regra `proposta`, ou `adoptada_futura` antes de `aplicaDesde`, ou com um estado legal que não existe | não conta — só `em_vigor`, `adoptada_futura` e `revogada` podem contar |
| Regra `revogada` depois de `aplicaAte` | não conta |
| Território mapeado, só com a regra do continente | `revisao_necessaria`, motivo `sem_regra_em_vigor` (o território não herda) |
| Domínio `nao_aplicavel` com justificação | não bloqueia |
| Só domínios `nao_aplicavel` | `revisao_necessaria`, motivo `sem_regra_aplicada` |
| Todos os domínios pedidos verificados, com regra em vigor | `permitido` |

**O registo é validado ao arrancar** (`validar.ts`): datas sem fuso ou
impossíveis, `aplicaAte` antes de `aplicaDesde`, `revogada` sem data de fim,
regra repetida, duas versões da mesma regra a valer ao mesmo tempo (uma
`proposta` não conta), país sem perfil, território não mapeado, regra num
domínio que não está `verificado` (excepto propostas) ou que não existe (também um domínio que não
é texto, como `["consumidor"]`; revisão do #50), estado de revisão ou
estado legal desconhecido, prova vazia (`base`, `revistaPor`, `revistoPor`),
`id` vazia ou `versao` que não é inteiro ≥ 1 (revisão do #40), a mesma
`id` em dois países ou dois domínios, propostas incluídas (revisão do #45),
`id` fora do formato do §4.1 (revisão do #50) —
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

- As perguntas P1, P2 e P4 a P7 do Catálogo (`docs/14` §9).
- Se as skills do pacote se instalam (ADR-0034: usadas a partir do zip).
- Portais de distribuidor, franchising e royalties em que fase.
- O preenchimento de qualquer regra nacional: cada uma entra com fonte oficial
  lida, data e revisor.
