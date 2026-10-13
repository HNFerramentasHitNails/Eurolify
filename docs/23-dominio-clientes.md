# Domínio Clientes e identidade fiscal — modelo e lista da API

> **Estado: desenho aprovado; parte 1 no código** (issue #233; `docs/06`,
> CX). Diogo, 09/10/2026: *«sim, avança com o desenho da fatia 5»* e *«sim,
> aprovo; avança com o código da fatia 5»* (as cinco respostas da §9 como
> propostas). **Parte 3 (VIES e isenção manual): aprovada e no código, §13**
> (`docs/06`, CY). **Parte 2a (consentimentos e régua do marketing): no
> código, §12** (Diogo, 10/10/2026: *«sim, avança com a parte 2»*). **Parte
> 2b (duplicados e fusões, perfis copiados) e parte 2c (pedidos do titular):
> no código, §12**. É a fatia 5 do
> [`eurolify/implementation-plan.md`](eurolify/implementation-plan.md)
> («Clientes e perfis de faturação; finalidade por encomenda») e é preciso
> antes do Motor de IVA (fatia 6) e do checkout (fatia 7): o Motor de IVA
> decide com o perfil de faturação e a prova do VIES, e o checkout guarda a
> finalidade declarada. O que está programado diz-se na §12.
>
> Skills seguidas: `eu-vat-oss-ioss` (perfil de faturação, NIF, VIES com
> prova, isenção manual, ordem da decisão), `eu-gdpr-privacy` (papéis,
> base legal por finalidade, consentimento com prova, régua única do
> marketing, retenção contra apagamento, pedidos dos titulares, fusões),
> `consumer-rights-eu` (consumidor ou profissional **por encomenda**),
> `eurolify-b2b-channels-eu` (listas B2B por etiqueta sem tirar direitos de
> consumidor), `platform-architect` (fronteiras e eventos),
> `headless-commerce` (identificadores, idempotência, erros) e
> `observability-security` (rasto, dados pessoais fora dos registos).
> Arquitectura: [`02-arquitectura.md`](02-arquitectura.md) §3 (Clientes e
> identidade fiscal: ficha, perfis de faturação, validações VIES com prova,
> duplicados, fusões humanas, consentimentos; eventos `customer.created`,
> `billing_profile.validated`, `customer.merged`, `consent.changed`).
>
> Marcas de cada linha, como no `docs/14` e no `docs/20`: **regra** (vem de
> uma skill, de um documento ou de um ADR, com a fonte); **proposta** (desenho
> deste documento, decide-se ao aprovar); **pergunta** (está na §9, não se
> programa sem resposta). Regras legais com **W/M/C** como no
> [`03-regulamentar-ue.md`](03-regulamentar-ue.md); as **C** não chegam a um
> ecrã sem verificação ou validação profissional.

## 1. O que entra nesta fatia

| Entra | Fonte |
|---|---|
| **ficha do cliente** de cada comerciante: nome, e-mails, telefones, língua, país | `docs/02` §3; `eu-gdpr-privacy`, regra 2 (minimização) |
| **perfis de faturação**: vários por cliente, cada um com tipo, nome no documento, NIF, país do contribuinte, morada fiscal e **um** principal | `eu-vat-oss-ioss`, «As peças» e «Perfis de faturação» |
| **NIF guardado e comparado pela régua** (prefixo fiscal, só o número para comparar, números impossíveis recusados) | `eu-vat-oss-ioss`, «NIF — guardar, comparar, enviar» |
| **validação no VIES com prova** e revalidação diária | `eu-vat-oss-ioss`, regras 1 e 5 |
| **isenção manual** com motivo, nota e anexos, que nenhum processo automático desliga | `eu-vat-oss-ioss`, «As peças» e regra 4 |
| **finalidade por encomenda** (consumo, profissional, revenda): o tipo e a regra; quem a guarda é a encomenda | `consumer-rights-eu`, «Consumidor ou profissional — por encomenda»; `docs/03` §2 (nota no fim) |
| **etiquetas de cliente**, para as listas B2B do `docs/20` | `docs/20` §2 (a etiqueta é deste domínio); migração 0017 (`etiqueta_id` sem tabela) |
| **consentimentos** por canal e finalidade, com prova, e a **régua única** «pode receber marketing?» | `eu-gdpr-privacy`, regras 3, 4 e 5 |
| **duplicados** sinalizados e **fusões só por uma pessoa** | `eu-gdpr-privacy`, «Fusões e identidade»; `AGENTS.md`, «Não se erra em documentos fiscais», regra 6; `docs/02` (o MCP não funde sem uma pessoa) |
| **pedidos dos titulares**: exportação, rectificação, limitação, apagamento por pseudonimização | `eu-gdpr-privacy`, «Retenção e apagamento» e «Pedidos dos titulares» |
| **rasto** de cada alteração (quem, quando, o quê), como a linha do tempo do Catálogo | `observability-security`; `docs/14` §3.12 (migração 0033) |

| Fica fora desta fatia | Porquê |
|---|---|
| **contas de login dos clientes** nas lojas (palavra-passe, sessão, recuperação) | são da Loja (`docs/21`, «Fora da parte B»); a ficha existe sem conta (✅ Q5) |
| moradas de entrega guardadas na ficha (livro de moradas) | a morada de entrega é da encomenda; entra com o checkout (fatia 7) se fizer falta — **proposta** (minimização) |
| o que o checkout pergunta e mostra (o perfil, «a fatura é para outra pessoa», a finalidade) | fatia 7; este domínio dá as peças |
| a decisão de IVA da linha | Motor de IVA (fatia 6); este domínio só guarda o perfil, a prova do VIES e a isenção manual |
| a retenção do documento fiscal e a fila das retidas | Documentos fiscais (fatia 10) |
| importação de clientes de outro sistema | depois; quando entrar, passa pelas mesmas regras de duplicados (§5, R11) — **proposta** |
| vários compradores de uma empresa com permissões (conta B2B) | Fase 2 (`docs/eurolify/architecture.md` §3) |
| marketing a clientes sem consentimento explícito (o caso do cliente que já comprou) | a dispensa do art. 13.º, n.º 2, da Dir. 2002/58/CE **não verifiquei** — **C**; na Fase 1 só conta o consentimento explícito (§3.6) |

## 2. Fronteira — o que é deste domínio e o que não é

| Dado | Dono | Como se liga |
|---|---|---|
| ficha, perfil de faturação, validação VIES, isenção manual, etiqueta, consentimento, duplicado, fusão | **Clientes** | — |
| comerciante (`mer_`), loja (`sto_`), entidade legal e o **NIF do comerciante** | **Comerciante** (`docs/15`) | a ficha é de um comerciante (RLS forçado); o país do comerciante decide o prefixo (§3.3) e o NIF dele é o requerente no VIES (§3.4) |
| lista B2B (`prl_`) | **Preços e mercados** (`docs/20`) | aponta para a etiqueta pelo identificador; passa a ter chave estrangeira (§3.5) |
| decisão de IVA da linha, motivo, prova da decisão | **Motor de IVA** (fatia 6) | lê o perfil, o estado do VIES e a isenção manual **no momento do checkout** e guarda a cópia na decisão (`eu-vat-oss-ioss`, regra 3) |
| encomenda, finalidade declarada, perfil usado, cópia do perfil | **Encomendas** (fatia 9) e checkout (fatia 7) | a encomenda guarda o `bpf_` **e a cópia dos campos** que saíram no documento; o perfil pode mudar depois sem mudar o passado (§5, R4) |
| documento fiscal, fila das retidas, prova do documento | **Documentos fiscais** (fatia 10) | o NIF que sai no documento é o do perfil copiado na encomenda |
| envio de e-mails e mensagens | **Notificações** | lê a régua «pode receber marketing?» (§3.6); nunca a refaz |
| registo de tratamentos, pedido do titular como processo | **Privacidade** (`docs/02`) e `docs/17` | este domínio exporta e pseudonimiza o que é dele, a pedido |

## 3. Modelo — entidades e campos

Todas as tabelas com o comerciante e o **RLS forçado**, como as do Catálogo
(`docs/15` §5, regra). Datas em UTC. Identificadores opacos com prefixo
(`headless-commerce`, regra 2; prefixos **proposta**).

### 3.1 Cliente (`cus_`)

| Campo | Notas | Marca |
|---|---|---|
| `nome` | como o cliente o escreveu; **nunca serve para decidir identidade** | regra (`AGENTS.md`, fiscal, regra 6) |
| `emails` | lista; um é o de contacto; **não é único** no comerciante (um casal com um e-mail são duas fichas) | proposta |
| `telefones` | lista, em E.164 | proposta (`eu-localization`) |
| `lingua` | para as mensagens; das línguas do mercado | proposta |
| `pais` | país de residência declarado; **não é o país do contribuinte** | regra (`eu-vat-oss-ioss`, «NIF», última linha) |
| `estado` | §4.1 | proposta |
| `fundido_em` | o `cus_` que absorveu esta ficha, depois de uma fusão (§3.7) | proposta |
| `limitado` | bandeira de limitação/oposição: trava marketing e alterações sem apagar | regra (`eu-gdpr-privacy`, «Pedidos dos titulares») |
| `criado_em`, `versao` | a versão para a escrita optimista, como nos canais (`docs/20` §10) | proposta |

Sem data de nascimento, género nem documento de identificação: nenhuma
finalidade escrita os pede (`eu-gdpr-privacy`, regra 2).

### 3.2 Perfil de faturação (`bpf_`)

Um perfil é **a mesma pessoa noutra postura fiscal**; **duas pessoas são duas
fichas** (`eu-vat-oss-ioss`, «Perfis de faturação»).

| Campo | Notas | Marca |
|---|---|---|
| `cliente_id` | a ficha dona | regra |
| `tipo` | `particular` ou `empresa` | regra (`eu-vat-oss-ioss`, «As peças») |
| `nome_documento` | o nome que sai no documento fiscal (pessoa ou firma) | regra |
| `nif_escrito` | exactamente o que a pessoa escreveu — **mantém-se sempre** | regra (`eu-vat-oss-ioss`, «NIF») |
| `nif` | o NIF pela régua (§3.3): com o prefixo fiscal, excepto o país do comerciante. **Calcula-se ao ler** (`nif_com_prefixo`), do país e do número: o país do comerciante é o das entidades legais activas (com entidades em dois países, sai sempre com prefixo), e um NIF guardado já com ou sem prefixo ficava errado se o comerciante mudasse de país | regra; a forma, proposta (código, parte 1) |
| `nif_numero` | só o número, sem prefixo nem pontuação — **é o que se compara** | regra |
| `pais_contribuinte` | o país do NIF; pode ser diferente do da morada (NIF português e morada no Luxemburgo) | regra |
| `morada_fiscal` | linhas, código postal, localidade, país; o código postal é o que decide os territórios especiais no Motor de IVA | regra (`eu-vat-oss-ioss`, regra 6) |
| `principal` | **um** por ficha, guardado na base (índice único parcial); o ecrã e o servidor leem este campo | regra (`eu-vat-oss-ioss`: as duas réguas do Hub divergiam em 182 de 314 fichas, 28/09/2026 — **M**) |
| `estado_vies` | §4.2; preenchido pela última validação (§3.4) | proposta |
| `estado` | `activo` ou `arquivado` | proposta |
| `usado_em_documento` | sim depois da primeira encomenda com documento emitido; a partir daí o NIF, o tipo e o país não mudam (§5, R4); põe-no o domínio dos documentos (fatia 10), nunca a API | ✅ Q3 decidida |
| `versao` | escrita optimista | proposta |

Um perfil **sem NIF** é válido (o consumidor final). Um perfil `empresa` sem
NIF é recusado — **proposta** (uma empresa sem NIF não tem como ser faturada
como tal; validar com o contabilista).

### 3.3 A régua do NIF

| Pergunta | Régua | Marca |
|---|---|---|
| Com que prefixo se guarda? | com o **prefixo fiscal do país**, excepto o país do comerciante (num comerciante português: sem prefixo). O prefixo fiscal **não é o ISO**: `EL` na Grécia | regra (`eu-vat-oss-ioss`) |
| São o mesmo contribuinte? | compara-se só o `nif_numero` | regra |
| 9 dígitos sem prefixo, ficha estrangeira, passa o dígito de controlo português? | leva `PT` (8 casos nos sistemas actuais, 16/09/2026) | regra · **M** |
| Números impossíveis (`000000000`, `123456789`…) | passam o dígito de controlo e são **recusados por lista** | regra · **M** (#5414 nos sistemas actuais, 30/09/2026) |
| Dígito de controlo de outros países | **não verifiquei** os algoritmos; na Fase 1 só o português é conferido na escrita; os outros confere-os o VIES | proposta · **C** |
| Recusado pela régua | a escrita do perfil é recusada (`customers.nif_invalid`) e diz porquê; **nunca** se grava como consumidor final quem deu um número | regra (`eu-vat-oss-ioss`: «nunca sai como consumidor final a quem deu o número») |

A régua vive **numa função na base**, com um teste por ramo, e é a mesma que
o checkout e a importação usam (`AGENTS.md`, «Uma regra, um sítio»; a #D4248
dos sistemas actuais saiu errada por uma regra escrita duas vezes).

### 3.4 Validação no VIES (`vvc_`)

Uma linha por consulta; **não se altera nem se apaga** (append-only, como o
histórico de preços).

| Campo | Notas | Marca |
|---|---|---|
| `perfil_id`, `nif_consultado` | o NIF exactamente como foi enviado | regra (`eu-vat-oss-ioss`, regra 5) |
| `consultado_em` | data e hora | regra |
| `resultado` | `valido`, `invalido` ou `indisponivel` (o VIES ou o serviço do país não respondeu) | proposta |
| `nome_devolvido`, `morada_devolvida` | o que o VIES devolveu, quando devolve | proposta |
| `identificador_consulta` | o número de consulta do VIES | regra; que o VIES só o dá quando o pedido leva o NIF do requerente (o do comerciante) **não verifiquei** — **C** |
| `motivo` | `criacao`, `alteracao`, `revalidacao`, `pedido` (manual) | proposta |

Regras:
- só se consulta o VIES num perfil com NIF de **outro país da UE** que não o
  do comerciante (é para a venda intracomunitária, `eu-vat-oss-ioss`, «A
  ordem da decisão», 2.2); nos outros, `estado_vies = nao_aplicavel` —
  **proposta**;
- **`indisponivel` nunca conta como válido**: sem uma resposta `valido`, o
  Motor de IVA cobra (`eu-vat-oss-ioss`, regra 1) — **regra**;
- **revalidação diária** dos perfis activos com VIES aplicável; um perfil que
  passa de `valido` a `invalido` emite `billing_profile.invalidated` e o
  checkout seguinte já cobra IVA; **nunca toca na isenção manual** — regra
  (`eu-vat-oss-ioss`, regras 3, 4 e 5);
- o VIES é um serviço da Comissão Europeia; o NIF de um empresário em nome
  individual é dado pessoal e vai para lá na finalidade fiscal — **proposta**;
  os limites de pedidos do VIES **não verifiquei**.

### 3.5 Etiqueta (`ctg_`) e etiqueta do cliente

| Campo | Notas | Marca |
|---|---|---|
| `nome` | único no comerciante; ex.: «Revendedores 2027» | proposta |
| `estado` | `activa` ou `arquivada`; arquivar uma etiqueta usada numa lista B2B activa é recusado (`customers.tag_in_use`) | proposta |
| etiqueta do cliente | par (`cus_`, `ctg_`) com quem e quando; tirar fica no rasto | proposta |

A migração junta a chave estrangeira de `lista_precos.etiqueta_id` para a
etiqueta (a 0017 deixou-a só com o id, à espera deste domínio). **Ter a
etiqueta não faz de ninguém profissional**: a lista B2B aplica-se quando o
cliente tem a etiqueta **e** declarou comprar como profissional nessa
encomenda (`docs/20` §5, R10; `consumer-rights-eu`) — regra.

### 3.6 Consentimento (`cns_`)

Uma linha por declaração; **não se altera nem se apaga** (é a prova).

| Campo | Notas | Marca |
|---|---|---|
| `cliente_id` | | regra |
| `canal` | `email`, `sms`, `whatsapp` | regra (`eu-gdpr-privacy`, regra 3) |
| `finalidade` | `marketing` na Fase 1; outras (avaliações…) quando houver finalidade escrita | proposta |
| `declaracao` | `aceitou` ou `retirou` — «nunca aceitou» é **não haver linha** | regra (`eu-gdpr-privacy`, regra 5) |
| `texto`, `versao_texto` | o texto mostrado e a versão | regra |
| `onde` | loja e formulário (ou «Hub, pelo operador X, a pedido do cliente») | regra |
| `declarado_em`, `quem` | quando e por quem foi registado | regra |

**A régua única** `pode_receber_marketing(cliente, canal)`, numa função na
base: contam só as declarações explícitas; vale a mais recente; empate ⇒ não;
sem nenhuma ⇒ não; WhatsApp sem fonte ⇒ não; ficha `limitado` ⇒ não. Passa a
ser por contacto e por canal, no comerciante, com dupla confirmação sobre
uma recusa (§14; `docs/06`, DL; migração 0052). É a
régua que os sistemas actuais construíram a 29/09/2026 (`eu-gdpr-privacy`,
regra 4 — **M**, medida no repositório `claude`, não neste). Notificações,
exportações e IAs perguntam a esta função; nenhuma conta consentimentos por
si.

### 3.7 Duplicados e fusões

| Sinal | O que quer dizer | Marca |
|---|---|---|
| mesmo `nif_numero` em dois perfis **particulares** de fichas diferentes | a mesma pessoa — candidato **forte** | regra (`eu-gdpr-privacy`, «Fusões e identidade») |
| mesmo `nif_numero` em dois perfis **empresa** | a mesma empresa, **não** a mesma pessoa (dois funcionários a comprar): não é sinal de duplicado | ✅ Q2 decidida |
| mesmo e-mail ou telefone | **talvez** — decide uma pessoa | regra |
| mesmo nome | **nada**; nunca é sinal | regra (`AGENTS.md`, fiscal, regra 6) |

- O servidor **sinaliza** candidatos numa fila (`dup_`), com o sinal e as duas
  fichas; **nunca funde sozinho** nem escolhe a ficha «melhor» — regra
  (`AGENTS.md`, fiscal, regra 6).
- A fusão é um pedido de uma pessoa, com âmbito próprio (`customers:merge`),
  que escolhe a ficha que fica; a outra fica `fundida` com `fundido_em`, não
  se apaga — **proposta**.
- Passam para a ficha que fica: as etiquetas activas e o 2.º e-mail e o 2.º
  telefone **guardados, não perdidos** — regra (`eu-gdpr-privacy`).
- **Os perfis copiam-se** (Diogo, 10/10/2026, *«sim, copiar (A)»*; `docs/06`,
  DD): um perfil nunca muda de ficha (0037) e cada encomenda está presa ao par
  ficha e perfil (0041). A ficha que fica recebe uma cópia de cada perfil
  activo, com `copiado_de`; a cópia volta ao VIES; a isenção manual **não**
  se copia (uma pessoa volta a pô-la). Uma cópia igual a um perfil activo da
  ficha que fica não se faz.
- Os consentimentos **não se movem** (não se alteram, 0042): a régua da ficha
  que fica conta as declarações das fichas fundidas nela, e uma declaração
  pedida com o id antigo regista-se na ficha que ficou. Hoje vale a declaração
  mais recente das duas fichas; o consentimento da ficha que fica passa a
  cobrir os e-mails e telefones acrescentados — **C** (jurista, com a V4). O
  ensaio mostra a régua antes e depois (revisão do #298, P2-1). **Desde a
  0052:** o consentimento é por contacto, com dupla confirmação sobre uma
  recusa (§14; `docs/06`, DL); deixa de haver uma regra própria para as
  fusões.
- As encomendas e os documentos **não mudam**: ficam na ficha absorvida, com o
  perfil que tinham.
- **Sem desfazer** na Fase 1: antes de fundir, a API mostra o que vai mudar
  (pré-visualização, como o ensaio da importação), e o rasto guarda tudo —
  **proposta**.
- **Nenhuma IA nem o MCP fundem** — podem listar candidatos (`docs/02`).

### 3.8 Rasto

Uma tabela `alteracao_cliente` como a `alteracao_catalogo` (migração 0033):
cada inserção, alteração e remoção nas tabelas deste domínio, com os campos
mudados, `quem` obrigatório, `origem` e transacção, escrita por gatilhos
— **proposta**. **Sem NIF, e-mail nem telefone em claro nos registos da
aplicação** (`eu-gdpr-privacy`, regra 7); no rasto, que é dado do comerciante
com o mesmo RLS, ficam os valores — **proposta**.

### 3.9 Isenção manual (`exm_`)

| Campo | Notas | Marca |
|---|---|---|
| `perfil_id` | | regra (`eu-vat-oss-ioss`, «As peças») |
| `motivo` | texto obrigatório; ex.: «transportadora própria, declaração aduaneira entregue» | regra |
| `nota`, `anexos` | os anexos são ficheiros (PDF ou imagem), guardados **na base de dados** (`docs/06`, DN; §13.11) | regra; o armazenamento decidido |
| `posta_por`, `posta_em` | quem e quando | regra |
| `retirada_por`, `retirada_em` | só uma pessoa a retira; **nenhum processo automático** | regra (`eu-vat-oss-ioss`, regra 4) |

Pôr ou tirar uma isenção manual pede um âmbito próprio (`customers:exemptions`),
só do dono (✅ Q4). A entrega no país do comerciante **não** anula a isenção
manual (anula o VIES e a exportação): é a «excepção à excepção», e quem a
aplica é o Motor de IVA — regra (`eu-vat-oss-ioss`, «A ordem da decisão», 4).

## 4. Estados

### 4.1 Ficha

| De | Para | Condição |
|---|---|---|
| activo | fundido | uma pessoa fundiu-a noutra (§3.7); fica só de leitura |
| activo | pseudonimizado | pedido de apagamento do titular (§5, R9); nome, e-mails, telefones e consentimentos de marketing apagam-se; os perfis usados em documentos ficam com os campos mínimos |
| fundido, pseudonimizado | — | finais |

`limitado` é uma bandeira, não um estado: pode ligar-se e desligar-se numa
ficha activa.

### 4.2 Validação de um perfil (`estado_vies`)

| Estado | Quando |
|---|---|
| `nao_aplicavel` | sem NIF, NIF do país do comerciante ou de fora da UE |
| `por_validar` | NIF de outro país da UE ainda sem consulta |
| `valido` | a última consulta com resposta disse válido |
| `invalido` | a última consulta com resposta disse inválido |
| `indisponivel` | a última consulta não teve resposta; **conta como não válido** |

A isenção manual **não é um estado do VIES**: é uma entidade à parte (§3.9),
para que a revalidação nunca lhe toque.

## 5. Regras do domínio

| # | Regra | Fonte |
|---|---|---|
| R1 | **Ter NIF não faz de alguém profissional.** A finalidade (`consumo`, `profissional`, `revenda`) é **declarada por encomenda**; por omissão `consumo` | `consumer-rights-eu`; `docs/03` §2 (nota) |
| R2 | A finalidade **nunca vem pré-preenchida** com `profissional` ou `revenda` a partir da ficha, do perfil ou de uma encomenda anterior | ✅ Q1 decidida |
| R3 | `profissional` ou `revenda` pedem um perfil `empresa` com NIF nessa encomenda | proposta · que um profissional possa comprar sem NIF **não verifiquei** — **C** (contabilista e jurista) |
| R4 | Um perfil usado num documento emitido não muda de NIF, tipo nem país; muda-se criando outro perfil. A encomenda guarda a cópia dos campos | `eu-vat-oss-ioss` («cada encomenda liga a um perfil, fixo depois de emitida a fatura»; «um NIF num documento emitido não se corrige» em `eu-gdpr-privacy`); a forma: ✅ Q3 |
| R5 | Um só perfil principal por ficha, na base | `eu-vat-oss-ioss` (**M**, 182 de 314) |
| R6 | A régua do NIF (§3.3) e a régua do marketing (§3.6) vivem cada uma numa função na base, usadas por todos os caminhos de escrita e leitura | `AGENTS.md`, «Uma regra, um sítio» |
| R7 | Sem uma resposta `valido` do VIES não há isenção intracomunitária; `indisponivel` não é válido | `eu-vat-oss-ioss`, regra 1 (o VIES como condição substantiva é **C**) |
| R8 | Nenhum processo automático desliga uma isenção manual | `eu-vat-oss-ioss`, regra 4 |
| R9 | **Apagar ≠ destruir faturas**: o pedido de apagamento pseudonimiza a ficha e apaga o que não tem obrigação legal; os perfis usados em documentos e a prova do VIES ficam o prazo fiscal, com a razão escrita | `docs/03` §4 (**C**); art. 52.º do CIVA, 10 anos em Portugal (**W**); os prazos dos outros países e se a prova do VIES fica 10 anos **não verifiquei** — **C** (contabilista) |
| R10 | Nenhuma fusão sem uma pessoa; nunca pelo nome | `AGENTS.md`, fiscal, regra 6; `eu-gdpr-privacy` |
| R11 | A importação e a API da Loja passam pela mesma régua de duplicados: sinalizam, não fundem | proposta |
| R12 | Os eventos levam identificadores, **nunca** nome, e-mail, telefone ou NIF; quem precisa lê pela API com o âmbito | `eu-gdpr-privacy`, regra 7; proposta quanto aos eventos |
| R13 | O papel deste tratamento: o comerciante é o **responsável**, o Eurolify é **subcontratante** (T2 do `docs/17`, que passa a existir com esta fatia) | `eu-gdpr-privacy`, «Os dois papéis»; `docs/17` |

## 6. Eventos

Com outbox (`evento_saida`), como os do Catálogo e de Preços.

| Evento | Quando | Leva |
|---|---|---|
| `customer.created` | ficha nova | `cus_` (a origem fica na linha do tempo, não no evento) |
| `customer.updated` | ficha alterada | `cus_`, os **nomes** dos campos mudados (sem valores) |
| `customer.merged` | uma pessoa fundiu duas fichas | o `cus_` que ficou, o que foi absorvido, quem |
| `customer.pseudonymized` | apagamento do titular feito | `cus_` — **proposta** (novo; já está na lista do `docs/02`) |
| `billing_profile.created`, `billing_profile.updated` | perfil novo ou alterado | `bpf_`, `cus_` — **proposta** (novos) |
| `billing_profile.validated` | consulta ao VIES com resposta `valido` | `bpf_`, `vvc_` |
| `billing_profile.invalidated` | o perfil deixou de ser válido no VIES | `bpf_`, `vvc_` — **proposta** (novo) |
| `consent.changed` | declaração nova | `cus_`, `cns_`, canal, finalidade, o resultado da régua depois da declaração, quem e quando (migração 0042; revisão do #289) |

Os eventos novos entram no `docs/02` e na skill `platform-architect` com a
aprovação deste desenho (como os `market.*`, `docs/06`, BX).

## 7. Lista da API

Versão por data, listas por cursor com o total explícito, erros RFC 9457 com
código estável (`docs/18`), `Idempotency-Key` em todas as escritas, como nos
outros domínios.

**Âmbitos novos** (proposta; na CHECK e em `papel_ambitos`, como os de
Preços na 0036):

| Âmbito | Dá | Papéis (proposta) |
|---|---|---|
| `customers:read` | ler fichas, perfis, etiquetas, consentimentos, candidatos a duplicado | dono, gestor, apoio |
| `customers:write` | criar e alterar fichas e etiquetas; registar consentimentos | dono, gestor, apoio |
| `customers:billing` | criar e alterar perfis de faturação (NIF, morada fiscal), o principal, arquivar e repor; pedir uma validação | **só o dono** (Diogo, 09/10/2026: *«sim, só o dono»*; `docs/06`, CX) |
| `customers:exemptions` | pôr e tirar isenções manuais | dono (✅ Q4) |
| `customers:merge` | fundir fichas | dono, gestor |
| `customers:privacy` | exportar e pseudonimizar a pedido do titular; ligar a limitação | dono |

O armazém não lê clientes: a morada de que precisa vem na encomenda
(minimização, `eu-gdpr-privacy`, regra 2).

### 7.1 API de Administração

| Operação | Método e caminho | Âmbito | Notas |
|---|---|---|---|
| Clientes | `GET /customers`, `GET /customers/{id}`, `POST /customers`, `PATCH /customers/{id}` | read / write | nunca devolve fichas de outro comerciante |
| Procurar | `POST /customers/search` (`{ procura, limite, cursor }`) | read | por e-mail, telefone ou NIF (pelo número, §3.3), nunca pelo nome; no corpo, para o valor não ficar nos registos (R12; revisão do #234, P1-1) |
| Perfis | `GET /customers/{id}/billing-profiles`, `POST …`, `PATCH /billing-profiles/{id}` | read / billing | recusa a régua do NIF (`customers.nif_invalid`) e R4 (`customers.profile_used`) |
| Perfil principal | `POST /billing-profiles/{id}/make-primary` | billing | troca o principal na mesma transacção |
| Arquivar perfil | `POST /billing-profiles/{id}/archive`, `…/restore` | billing | |
| Validar no VIES | `POST /billing-profiles/{id}/vies-checks`, `GET …/vies-checks` | write / read | a consulta e o histórico das provas |
| Isenção manual | `PUT /billing-profiles/{id}/exemption`, `DELETE …/exemption` | exemptions | com motivo obrigatório |
| Etiquetas | `GET /customer-tags`, `POST`, `PATCH`, `…/archive` | read / write | |
| Etiquetas de um cliente | `PUT /customers/{id}/tags/{tagId}`, `DELETE …` | write | |
| Consentimentos | `GET /customers/{id}/consents`, `POST /customers/{id}/consents` | read / write | o `GET` devolve as declarações e o resultado da régua por canal |
| Candidatos a duplicado | `GET /customer-duplicates`, `POST /customer-duplicates/{id}/dismiss` | read / merge | descartar fica no rasto |
| Fundir | `POST /customers/{id}/merge` (`{ absorver: cus_…, ensaio: true }`) | merge | com `ensaio` devolve o que mudaria sem escrever |
| Linha do tempo | `GET /customers/{id}/timeline` | read | o rasto (§3.8) |
| Exportação do titular | `POST /customers/{id}/export` | privacy | JSON com tudo deste domínio e o que os outros guardam sobre as encomendas da pessoa (§15.2, parte 3 da §15.10), e as fichas com o mesmo contacto (§15.5). Um `POST` e não um `GET` (parte 2c): o pedido leva a verificação da identidade e fica registado |
| Limitação | `PUT /customers/{id}/restriction`, `DELETE …` | privacy | |
| Pseudonimizar | `POST /customers/{id}/pseudonymize` | privacy | irreversível; pede a confirmação no corpo, como as acções do MCP da VPS |

### 7.2 API da Loja

Fora desta fatia: o checkout (fatia 7) cria a ficha e o perfil, regista os
consentimentos e guarda a finalidade, pelas mesmas funções da base.

### 7.3 MCP de leitura

| Ferramenta | O que dá |
|---|---|
| `eurolify_cliente` | uma ficha com os perfis, o estado do VIES e as etiquetas |
| `eurolify_duplicados` | os candidatos a duplicado por decidir — **sem fundir** |

## 8. Por onde é que isto ainda pode sair errado

| Risco | O que o evita |
|---|---|
| Um consumidor com NIF tratado como profissional (perde direitos, ou apanha a lista B2B) | R1 e R2: a finalidade é declarada em cada encomenda e por omissão é consumo; a etiqueta sozinha não basta (§3.5) |
| Uma venda intracomunitária sai isenta com o VIES em baixo | R7: `indisponivel` não é válido; o Motor de IVA cobra |
| A revalidação diária desliga uma isenção que uma pessoa pôs | R8: a isenção manual é uma entidade à parte (§3.9); a revalidação só escreve no `estado_vies` |
| Dois funcionários da mesma empresa fundidos numa só ficha | §3.7: o NIF de um perfil empresa não é sinal de mesma pessoa (Q2); toda a fusão passa por uma pessoa (R10) |
| O NIF muda num perfil já faturado e a fatura antiga parece ter outro NIF | R4 e a cópia na encomenda |
| `PT263631656` e `263631656` vistos como dois contribuintes | §3.3: compara-se o `nif_numero` |
| Um número impossível (`123456789`) aceite porque passa o dígito de controlo | §3.3: lista de recusados |
| Dois perfis principais, e o ecrã e o servidor escolhem perfis diferentes | R5: índice único parcial na base |
| Um e-mail de marketing a quem nunca aceitou, ou depois de retirar | §3.6: a régua única, na base, com «sem declaração ⇒ não» |
| O apagamento do titular destrói a base de uma fatura | R9: pseudonimiza; os perfis usados e a prova do VIES ficam o prazo fiscal |
| NIF ou e-mails em claro nos registos da aplicação ou num webhook | R12; os registos levam identificadores |
| Uma ficha de outro comerciante aparece numa procura por NIF | RLS forçado; um teste que procura o NIF do vizinho e tem de dar vazio (como os testes de isolamento do `docs/15`) |
| As regras **C** (dígitos de controlo de outros países, o identificador da consulta VIES, os prazos de retenção fora de Portugal, o profissional sem NIF) chegam a um ecrã sem validação | ficam marcadas e o servidor fica do lado seguro: confere só o que se sabe, cobra sem VIES válido, guarda mais tempo em vez de menos |

## 9. Perguntas para o Diogo ou o Bruno

| # | Pergunta | Proposta |
|---|---|---|
| Q1 | No checkout, a finalidade (consumo / profissional / revenda) **vem preenchida** com a da última encomenda do cliente, ou começa **sempre em consumo** e o cliente escolhe? | ✅ **Decidido** (Diogo, 09/10/2026, com a aprovação do desenho; `docs/06`, CX): **Sempre em consumo**, e o cliente escolhe em cada encomenda; preencher com a anterior pode pôr um consumidor a comprar como profissional sem dar por isso (R1, R2) |
| Q2 | Dois perfis **empresa** com o mesmo NIF em fichas diferentes são candidatos a fusão? | ✅ **Decidido** (Diogo, 09/10/2026, com a aprovação do desenho; `docs/06`, CX): **Não**: é a mesma empresa e podem ser duas pessoas (dois funcionários); só o NIF igual em perfis **particulares** é sinal forte (§3.7) |
| Q3 | Um perfil já usado numa fatura pode mudar de NIF? | ✅ **Decidido** (Diogo, 09/10/2026, com a aprovação do desenho; `docs/06`, CX): **Não**: cria-se um perfil novo e o antigo fica, para a fatura antiga continuar a bater certo (R4) |
| Q4 | Quem pode pôr ou tirar uma **isenção manual** de IVA? | ✅ **Decidido** (Diogo, 09/10/2026, com a aprovação do desenho; `docs/06`, CX): **Só o dono** (âmbito `customers:exemptions`); o gestor já hoje «não muda dados fiscais» (`docs/21`, papéis) |
| Q5 | As **contas de login** dos clientes nas lojas entram nesta fatia? | ✅ **Decidido** (Diogo, 09/10/2026, com a aprovação do desenho; `docs/06`, CX): **Não**: entram com a Loja e o checkout; esta fatia faz a ficha, os perfis e as regras, que o login depois usa |

## 10. Para o contabilista e o jurista (não bloqueiam o código; bloqueiam a produção)

| # | Pergunta | A quem |
|---|---|---|
| V1 | Um cliente pode declarar compra profissional **sem NIF**? (R3) | contabilista e jurista |
| V2 | Quanto tempo se guarda a prova do VIES e os perfis usados, fora de Portugal? (R9) | contabilista |
| V3 | O número de consulta do VIES exige o NIF do comerciante como requerente, e vale como prova? (§3.4) | contabilista |
| V4 | Os clientes que já compraram podem receber e-mails de produtos semelhantes sem consentimento (art. 13.º, n.º 2, da Dir. 2002/58/CE)? Até lá, só o consentimento explícito (§1) | jurista |

É a porta para produção do plano: «VIES com prova; validação do
contabilista».

## 11. Como entra no código (quando aprovado)

| Parte | O quê |
|---|---|
| 1 | migração (a próxima livre, hoje 0037 — avisar no pedido do outro se estiver a usar o mesmo número): ficha, perfil, régua do NIF, etiquetas com a chave estrangeira de `lista_precos`, rasto, âmbitos; rotas de clientes, perfis e etiquetas; testes (isolamento, régua do NIF ramo a ramo, principal único) |
| 2 | consentimentos e a régua do marketing; duplicados e fusão com ensaio; pedidos do titular |
| 3 | VIES: o adaptador, a prova, a revalidação diária (como a limpeza dos ficheiros, `agendarLimpezaDosFicheiros`); a isenção manual com anexos |

Cada parte com a revisão de um agente antes de juntar (ADR-0031, ADR-0035).

## 12. Em código (09/10/2026; migração 0037; `docs/06`, CX)

**Parte 1** (issue #233):

| O quê | Onde |
|---|---|
| ficha (`cliente`), perfis (`perfil_faturacao`), etiquetas (`etiqueta_cliente`, `cliente_etiqueta`), RLS forçado | migração 0037 |
| a régua do NIF numa função só (`nif_regua`; `nif_limpo`, `nif_para_procura`, `nif_portugues_valido`), usada pelo gatilho do perfil e pela procura; o NIF a mostrar por `nif_com_prefixo` e `pais_do_comerciante` | migração 0037 |
| um principal por ficha (índice único parcial; o primeiro perfil activo; `perfil_tornar_principal`); o principal não se arquiva com outro activo (`customers.primary_profile`); repor um perfil numa ficha sem principal fá-lo principal | migração 0037 |
| R4: um perfil `usado_em_documento` não muda de NIF, tipo nem país (`customers.profile_used`); o mesmo número escrito de outra maneira passa | migração 0037 |
| `estado_vies` só `nao_aplicavel` ou `por_validar` (a consulta é a parte 3) | migração 0037 |
| a chave estrangeira de `lista_precos.etiqueta_id`; as etiquetas que as listas já referiam nascem com o nome «Etiqueta da lista «…» (0037)»; uma etiqueta numa lista B2B activa não se arquiva (`customers.tag_in_use`); uma lista não se activa com uma etiqueta arquivada (`prices.label_archived`); a API de Preços passa a aceitar e devolver a etiqueta como `ctg_…` | migração 0037; `src/precos/rotas.ts` |
| a linha do tempo (`alteracao_cliente`), que só se acrescenta e recusa a escrita sem quem | migração 0037; `GET /customers/{id}/timeline` |
| os eventos `customer.created`, `customer.updated`, `billing_profile.created`, `billing_profile.updated`, só com identificadores e os nomes dos campos | migração 0037 |
| a API de Administração: fichas (com a procura por e-mail, telefone ou NIF), perfis, principal, arquivar/repor, etiquetas, pôr e tirar etiquetas | `src/clientes/rotas.ts` |
| os âmbitos `customers:read` e `customers:write` (dono, gestor, apoio) e `customers:billing` (só o dono: os perfis de faturação) | migração 0037; `src/identidade/` |
| 16 testes pela API e 1 da migração sobre dados; 20 mutações, todas apanhadas (a lista de impossíveis, o principal, R4, o prefixo, a etiqueta em uso, a etiqueta arquivada, a procura pelo número, o país antigo num NIF novo, o quem, o VIES no país do comerciante, os valores nos eventos, a dedução do PT) | `test/clientes-api.test.ts` |


**Depois da revisão do agente** (#234, 09/10/2026):
- a procura passou de `GET /customers?procura=` para `POST /customers/search`
  (P1-1);
- o preenchimento das etiquetas: o nome começa pelo id, e o mesmo id em dois
  comerciantes dá uma etiqueta nova ao segundo, com a lista dele actualizada
  (P1-2);
- PT só se deduz de 9 dígitos sem prefixo num comerciante português (P2-1);
  um número com o código do país indicado (`GR…` com GR) é recusado (P2-2);
- a lista B2B toma a etiqueta com `FOR SHARE` (P2-3); a ficha toma-se antes
  dos perfis no arquivo e na troca do principal, e a API deixou de escrever
  a coluna `principal` (P3-1, P3-2);
- testes: isolamento em todas as rotas, a etiqueta real de outro comerciante
  numa lista, R4 no país, repor com outro principal, a procura página a
  página, duas corridas (dois primeiros perfis; etiqueta contra lista).

**Fica escrito para as partes seguintes:**
- **Apagamento e linha do tempo (P2-4):** a `alteracao_cliente` guardava o
  antes e o depois do nome, e-mails, telefones e NIF, e só se acrescenta.
  Desde a migração 0054 guarda um marcador em vez desses valores
  (`docs/28` §3.4). A
  pseudonimização do titular (parte 2) tem de a alcançar: uma função do dono,
  registada, que substitui esses valores nas entradas da ficha — o único
  caminho que muda o rasto.
- **Recusa e retenção (P3-6):** a API recusa um NIF que a régua não aceita;
  no checkout (fatia 7) o NIF que o comprador deu não se pode perder — a
  encomenda fica retida, nunca sai como consumidor final.
- **Primeiros dígitos do NIF português (P3-5):** a lista de impossíveis tem
  só os repetidos e `123456789`; as regras oficiais dos primeiros dígitos
  **não verifiquei** — **C**.
- **Comerciante sem país único (P3-3):** sem entidade activa, ou com
  entidades em dois países, todos os NIF da UE ficam `por_validar` (lado
  seguro) e saem com prefixo.
- **Fusões (P3-10):** a chave estrangeira de `fundido_em` entra com a parte 2.
- **Perfis por ficha (P3-4):** sem limite nem paginação; um limite entra
  antes da API da Loja.

**Fica para as partes 2 e 3** (§11): consentimentos e a régua do marketing;
duplicados, fusões, pedidos dos titulares; VIES, isenção manual com anexos.
Os âmbitos `customers:exemptions`, `customers:merge` e `customers:privacy`
entram com elas.

**Testado sobre dados:** a migração sobre uma base com listas B2B que já
apontavam para etiquetas (`test/migracao-0037.test.ts`, com um migrador sem
poderes, como o da VPS; as duas mutações — sem desligar o RLS forçado, sem o
voltar a ligar — são apanhadas). Quantas listas B2B há na base do ensaio
**não verifiquei** (o MCP da VPS pede autorização nesta sessão).

**Parte 2a — consentimentos e a régua do marketing** (migração 0042; issue
#233; Diogo, 10/10/2026: *«sim, avança com a parte 2»*):

| O quê | Onde |
|---|---|
| o consentimento (`consentimento`, `cns_`): uma linha por declaração, `aceitou` ou `retirou`, com o canal, a finalidade (só `marketing`), o texto, a versão e onde; não se altera nem se apaga, nem pelo dono da base | migração 0042 |
| a hora e quem registou, postos pela base (`declarado_em`, `quem`); sem `eurolify.quem` recusa; só numa ficha activa (uma ficha limitada aceita, para retirar não ficar mais difícil) | migração 0042 |
| as declarações da mesma ficha entram uma de cada vez (a ficha fica tomada) e a hora é a do relógio quando entram, sempre depois da última da ficha, mesmo que o relógio recue (revisão do #289, P2-1): a mais recente é a última que entrou | migração 0042 |
| a régua única `pode_receber_marketing(cliente, canal)`: só declarações explícitas, vale a mais recente, empate ⇒ não, sem nenhuma ⇒ não, ficha limitada ou não activa ⇒ não; dá sempre verdadeiro ou falso, nunca nulo. **Desde a 0052, por contacto** (§14.8) | migração 0042 |
| o evento `consent.changed` com o cliente, o canal, a finalidade e o resultado da régua, sem o texto nem o «onde» (R12); as declarações na linha do tempo | migração 0042 |
| `GET` e `POST /customers/{id}/consents` (`customers:read` e `customers:write`): o `GET` devolve as declarações por páginas e a régua por canal em todas | `src/clientes/rotas.ts` |
| 18 testes; as mutações da régua e dos gatilhos todas apanhadas, salvo trocar o relógio pela hora do início da transacção, que depois da P2-1 dá a mesma ordem | `test/clientes-consentimentos.test.ts` |

**Parte 2b — duplicados e fusões** (migração 0046; issue #233; Diogo,
10/10/2026: *«sim, avança com a parte 2b»* e *«sim, copiar (A)»*):

| O quê | Onde |
|---|---|
| a fila de candidatos (`duplicado_cliente`, `dup_`): o servidor sinaliza ao criar ou mudar uma ficha ou um perfil, nunca funde. Sinais: o mesmo NIF em perfis particulares (forte), o mesmo e-mail sem diferença de maiúsculas ou o mesmo telefone (talvez); o NIF de empresa (Q2) e o nome não são sinal; só o tipo do sinal, nunca o valor | migração 0046 |
| descartar (`duplicado_descartar`) e fundir (`cliente_fundir`) só por uma pessoa ou a chave dela (R10); um sinal novo num par descartado volta a pô-lo por decidir (proposta) | migração 0046 |
| a fusão com ensaio: a absorvida fica `fundido` com `fundido_em` (com a chave estrangeira, P3-10), os contactos acrescentam-se (recusa se passarem de 10), as etiquetas activas e os perfis activos copiam-se, a limitação passa; o par fica `fundido` e os outros pares da absorvida `fechado`; o evento `customer.merged` | migração 0046 |
| os consentimentos das fundidas contam na régua da ficha que fica (`clientes_do_grupo`), e uma declaração com o id antigo vai para a que ficou (revisão do #289, P2-4) | migração 0046 |
| `GET /customer-duplicates`, `POST /customer-duplicates/{id}/dismiss`, `POST /customers/{id}/merge` (`{ absorver, ensaio }`); a ficha mostra `fundido_em`, o perfil `copiado_de` | `src/clientes/rotas.ts` |
| o âmbito `customers:merge` (dono e gestor) | migração 0046; `src/identidade/` |
| 13 testes de fusões, o de consentimentos revisto e o da migração sobre dados | `test/clientes-fusoes.test.ts`, `test/migracao-0046.test.ts` |

**Depois da revisão do agente** (#298, Sonnet 5.5; sem P0 nem P1):
- a ficha fundida é só de leitura também para uma isenção nova, tirar uma
  etiqueta e pedir o VIES; os perfis dela saem da fila do VIES (P2-2, P3-2);
- a régua calcula o grupo uma vez (`regua_marketing`, a única que conta
  declarações; P2-3) — o efeito com milhares de declarações **não medi**;
- o plano traz `marketing_antes` e `marketing_depois` (P2-1);
- a cópia do principal da absorvida é a principal se a ficha que fica não
  tinha perfis (P3-6);
- um teste da migração sobre fichas que já existiam (`migracao-0046.test.ts`).

**Fica de fora da 2b, com o que a revisão apontou:**
- desfazer uma fusão (Fase 1 sem desfazer);
- a ferramenta `eurolify_duplicados` do MCP, que entra com as de Clientes; o
  MCP **nunca** expõe `customers:merge` (P3-4);
- um sinal que deixou de existir (o e-mail mudou) não tira o par da fila;
  um par descartado com a absorvida pode voltar com a ficha que fica — decide
  uma pessoa (P3-6);
- **para a 2c:** os pedidos do titular têm de alcançar o grupo inteiro (a
  ficha que fica não lista as fundidas nela: `clientes_do_grupo`; P3-3);
- **para a fatia 10 (documentos):** marcar `usado_em_documento` num perfil de
  uma ficha fundida (encomenda anterior à fusão) é hoje recusado pelo gatilho
  do perfil; abrir a excepção só para essa marca;
- **Motor de IVA:** decide com o perfil da encomenda, mesmo de uma ficha
  fundida (pós-venda) — é o certo, fica dito aqui;
- **concorrência:** editar o e-mail de uma ficha ao mesmo tempo que ela entra
  numa fusão pode dar `customers.retry` (503) a uma das duas (P3-1); não
  corrompe dados;
- **âmbitos:** o gestor funde (desenho) mas não tem `customers:billing`; as
  cópias dos perfis nascem pela fusão, não por ele (P3-5).

**Fica para a parte 2c:** a pseudonimização apaga os consentimentos de
marketing (§4.1); a recusa de apagar desta migração terá de abrir só para
essa função, e tem de alcançar a cópia do texto e do «onde» que a linha do
tempo guarda (revisão do #289, P3).

**O checkout** (`docs/25`) ainda não regista consentimentos: a rota pede
`customers:write`, não o âmbito da loja; a caixa de marketing desenha-se com
a fatia 7.

**Parte 2c — pedidos do titular** (migração 0049; issue #233; Diogo,
10/10/2026: *«sim, avança com a parte 2c»*):

| O quê | Onde |
|---|---|
| o registo de cada pedido (`pedido_titular`, `dsr_`): o tipo, como se verificou a identidade (obrigatório), quem fez, quando e o resultado em contagens; só se acrescenta (`eu-gdpr-privacy`, «Pedidos dos titulares») | migração 0049 |
| a limitação (`PUT`/`DELETE /customers/{id}/restriction`): a régua do marketing dá não e a API não muda o nome nem os contactos da ficha limitada (`customers.restricted`), sem apagar nada — **proposta**. **Não trava** (revisão do #314, P3-2): os perfis (NIF, morada), as etiquetas, a fila do VIES, a procura de candidatos a duplicado, o checkout e as funções do dono (a fusão). O art. 18.º do RGPD pede mais do que o marketing: o que mais trava fica para decidir | migração 0049 |
| a exportação (`POST /customers/{id}/export`): a ficha e as fundidas nela, com os perfis, as provas do VIES, as isenções, as etiquetas, os consentimentos, as encomendas com as linhas e os pagamentos (só para ler), os candidatos a duplicado, a linha do tempo e os pedidos. Lida com a ficha tomada (P3-4); uma ficha fundida não se exporta sozinha, pede-se pela que ficou (P3-3). **A resposta não fica guardada**: a idempotência guarda só o id do pedido, e repetir a chave dá `idempotency.response_not_kept` (P2-5) | `src/clientes/repositorio.ts`; `src/clientes/rotas.ts` |
| a pseudonimização (`POST /customers/{id}/pseudonymize`), irreversível, com a confirmação escrita «pseudonimizar cus_…» (o erro já não repete a frase, P3-5), só por uma pessoa ou a chave dela, sobre o grupo inteiro (revisão do #298, P3-3), lido **depois** de tomar a ficha pedida, para uma fusão ao mesmo tempo não deixar uma ficha de fora (revisão do #314, P1-2): nome «Pseudonimizado», sem e-mails, telefones, língua nem país; consentimentos e etiquetas apagados; os perfis que nenhum documento nem encomenda usou sem nome, NIF nem morada, arquivados, as provas do VIES deles apagadas e as isenções sem NIF, nota nem os motivos escritos (P3-11 do #244; P2-3 do #314); a linha do tempo sem os valores pessoais nem o texto livre (motivos e notas), também a do par de duplicados guardada na outra ficha (P2-4 do #234; P2-3 do #314); os candidatos fechados; o evento `customer.pseudonymized` | migração 0049 |
| ficam como estão, com as provas do VIES, as isenções e a linha do tempo deles, o prazo fiscal (R9) — na linha do tempo, o nome, o NIF e a morada ficam como marcador, não em claro, como nos outros perfis: a prova fiscal é a cópia no documento (`docs/29` §4; `docs/28` §3.4; Diogo, 10/10/2026: *«sim»*): os perfis usados em documentos **e os que uma encomenda aponta**, também a não paga (revisão do #314, P1-1). A decisão do IVA da encomenda cita a prova e a isenção; a fatura e a nota de crédito ainda podem precisar delas. Um critério mais estreito (só as encomendas pagas) é do contabilista — **C** | migração 0049 |
| o resultado do apagamento diz `encomendas_com_dados_por_tratar`: com mais de zero, o apagamento **não está completo** (P2-4) | migração 0049 |
| uma prova nova do VIES só se grava numa ficha activa: uma resposta que chegue depois do apagamento é recusada e a fila trata-a como falhada (P1-3) | migração 0049 |
| as recusas de alterar ou apagar abrem-se **só** dentro da função do dono: a marca é uma linha da transacção numa tabela só do dono (`pseudonimizacao_em_curso`), e não um parâmetro que a API possa pôr (P2-1); a API e o superutilizador, com o parâmetro antigo ou com a marca, continuam recusados (testado) | migração 0049 |
| o registo à escolha (`pedido_titular_registar`) é só das funções do dono; a API regista só a exportação, com o tipo e a contagem fixos (P2-2) | migração 0049 |
| o âmbito `customers:privacy`, só no dono; **o MCP nunca o expõe**, como o `customers:merge` (P3-5) | migração 0049; `src/identidade/` |
| 7 testes no titular e 1 no checkout (uma encomenda real); 13 mutações antes da revisão e 12 nas correcções, todas apanhadas | `test/clientes-titular.test.ts`; `test/checkout-api.test.ts` |

**Fica por fazer, e onde:**
- **os dados pessoais que o checkout e as encomendas guardam** (o contacto,
  a entrega, a cópia do perfil): são desses domínios; a pseudonimização de
  um cliente não lhes toca (a exportação lê as encomendas). Têm de se juntar
  ao apagamento com a regra deles (o que a lei obriga a guardar de uma
  encomenda) — fatia 9 e fatia 10;
- **o prazo de resposta** (um mês, prorrogável) e **os prazos de guarda**
  fora de Portugal: **não verifiquei** — **C** (R9);
- **a verificação da identidade** é um texto que a pessoa escreve; o
  Eurolify não a prova;
- **a rectificação** faz-se pelas rotas que já existem (`PATCH`), com a
  linha do tempo; um NIF num documento emitido não se corrige (R4);
- **as cópias de segurança**: o apagamento chega a elas quando expiram;
  dizê-lo na política de privacidade de cada loja. O mesmo para as respostas
  guardadas da idempotência de outras rotas (`POST /customers`,
  consentimentos): expiram em 24 h e o apagamento não as limpa;
- **a fatia 10 emite sempre de `encomenda.perfil_copia`**, nunca do perfil
  vivo, e marca `usado_em_documento` (também nas fichas fundidas);
- **o texto da verificação** (`pedido_titular.verificacao`) fica para sempre
  e não passa pela pseudonimização: escrever como se verificou («resposta do
  e-mail da ficha»), nunca o e-mail ou o número de um documento (P3-1). O
  Hub tem de o dizer;
- **os perfis mantidos por obrigação fiscal**: depois do pedido, só o dono
  lê o nome, o NIF e a morada (decidido a 13/10/2026, EM; §15.12);
- **levantar a limitação** é um `DELETE` com corpo; uma variante `POST` para
  clientes que descartam o corpo de um `DELETE` fica para depois (P3-7);
- **a exportação** ainda não junta o que os outros domínios guardarem
  depois (expedições, devoluções, documentos).

## 13. Parte 3 — VIES com prova e isenção manual (desenho de 09/10/2026)

> **Estado: aprovado; no código** (migração 0039; `docs/06`, CY). Diogo,
> 09/10/2026: *«sim, avança com o desenho da parte 3»* e *«sim, aprovo; avança
> com o código da parte 3»* (Q6 e Q7 como propostas). Detalha os §3.4 e §3.9 para o código. Vem antes da
> parte 2 porque o Motor de IVA (fatia 6) decide com isto
> (`eu-vat-oss-ioss`, «A ordem da decisão», 2.1 e 2.2).

### 13.1 O que entra

| Entra | Fonte |
|---|---|
| a consulta ao VIES, feita **só pelo servidor**, e a prova de cada consulta, que não se altera nem se apaga | `eu-vat-oss-ioss`, regra 5; §3.4 |
| o `estado_vies` do perfil mudado pelas respostas; os eventos `billing_profile.validated` e `billing_profile.invalidated` | §4.2, §6 |
| a revalidação diária e a consulta pedida por uma pessoa | `eu-vat-oss-ioss`, regra 5 |
| a isenção manual com motivo, nota e anexos, que **nenhum processo automático desliga**, com o âmbito `customers:exemptions`, só do dono | `eu-vat-oss-ioss`, regra 4; §3.9; Q4 |

| Fica fora | Porquê |
|---|---|
| decidir se a venda é isenta | Motor de IVA (fatia 6): lê o estado, a prova e a isenção no checkout e guarda a cópia |
| há quanto tempo pode ter sido a última resposta «válido» para isentar uma venda | regra fiscal, **C** — vai para o contabilista com a fatia 6 (V5, §13.8) |
| o registo do comerciante para a venda (OSS, etc.) | Motor de IVA |

### 13.2 O serviço VIES — o que se mediu

A API REST pública da Comissão Europeia
(`https://ec.europa.eu/taxation_customs/vies/rest-api/`), medida a
09/10/2026 a partir da sessão de trabalho (não da VPS):

| Pedido | Resultado medido |
|---|---|
| `GET …/check-status` | `{"vow":{"available":true},"countries":[{"countryCode":"AT","availability":"Available"},…]}` — o estado de cada país |
| `POST …/check-vat-number` com `{"countryCode":"DE","vatNumber":"000000000"}` | `valid: false`, `requestDate`, `requestIdentifier: ""` (**vazio sem requerente**), `name`/`address` `"---"` |
| o mesmo, com `requesterMemberStateCode`/`requesterNumber` de um NIF inventado | `{"actionSucceed":false,"errorWrappers":[{"error":"INVALID_REQUESTER_INFO"}]}` |
| um pedido sem requerente, logo a seguir | `{"actionSucceed":false,"errorWrappers":[{"error":"MS_MAX_CONCURRENT_REQ"}]}` — o serviço do país recusou por excesso de pedidos |

Conclusões (**M**, medidas; o resto não verifiquei):
- **o número de consulta só vem com um requerente válido** — o NIF do
  comerciante (a entidade legal dele). Sem requerente, a resposta vem sem
  número. Se isso vale como prova para o fisco é a V3 (**C**);
- **há erros que não são resposta** (`MS_MAX_CONCURRENT_REQ`,
  `INVALID_REQUESTER_INFO`); a lista completa dos códigos **não verifiquei**.
  Regra: tudo o que não traz `valid: true` ou `valid: false` é
  `indisponivel`;
- os limites de pedidos do VIES **não verifiquei**; o serviço do país recusa
  pedidos em simultâneo.

### 13.3 A prova (`validacao_vies`, `vvc_`)

Uma linha por consulta, **só se acrescenta** (como o histórico de preços), RLS
forçado.

| Campo | Notas | Marca |
|---|---|---|
| `perfil_id`, `pais_consultado`, `numero_consultado` | exactamente o que se enviou | regra (`eu-vat-oss-ioss`, regra 5) |
| `requerente` | o NIF do comerciante enviado como requerente, ou vazio | proposta (Q7) |
| `consultado_em` | do nosso relógio, antes de enviar | regra |
| `data_vies` | o `requestDate` da resposta | proposta |
| `resultado` | `valido`, `invalido` ou `indisponivel` | proposta |
| `codigo_erro` | o código do VIES num `indisponivel` (`MS_MAX_CONCURRENT_REQ`, tempo esgotado…) | proposta |
| `identificador_consulta` | o `requestIdentifier`, quando vem | regra; o valor como prova é **C** (V3) |
| `nome_devolvido`, `morada_devolvida` | o que o VIES devolveu (`"---"` guarda-se como vazio) | proposta; o prazo de guarda é **C** (V2) |
| `motivo` | `perfil_novo`, `nif_mudou`, `revalidacao`, `pedido` | proposta |
| `quem` | `sistema:vies` nas automáticas; a chave ou a pessoa num pedido | regra (`observability-security`) |

### 13.4 Como corre

| Passo | O quê | Marca |
|---|---|---|
| 1 | Um perfil novo, ou com o NIF mudado, fica `por_validar` (já na parte 1) | regra |
| 2 | Uma tarefa da API, como a limpeza dos ficheiros (`agendarLimpezaDosFicheiros`), **de minuto a minuto** pega nos `por_validar`, **um de cada vez**, com pausa entre pedidos | proposta |
| 3 | A consulta é HTTP **fora de qualquer transacção** da base (nunca se seguram locks à espera do VIES); tempo máximo de 10 s | proposta |
| 4 | O resultado grava-se numa função da base (`vies_registar`) que escreve a prova e muda o `estado_vies` **só se o NIF do perfil ainda for o consultado** (se mudou entretanto, a prova fica e o estado não) | proposta |
| 5 | `valido` ou `invalido` passam para o `estado_vies` com `validado_em`; um `indisponivel` **não apaga** a última resposta: um perfil `valido` continua `valido` com a data antiga; um perfil sem resposta nenhuma fica `indisponivel` | **pergunta Q6** |
| 6 | Revalidação diária, fora do horário de trabalho, dos perfis activos com VIES aplicável cuja última resposta tem mais de 24 h, espalhada pela noite | regra (`eu-vat-oss-ioss`, regra 5); o horário, proposta |
| 7 | De `valido` para `invalido`: `billing_profile.invalidated`; para `valido`: `billing_profile.validated`. A isenção manual não se toca | regra (regra 4) |
| 8 | `POST /billing-profiles/{id}/vies-checks`: uma pessoa pede a consulta; o perfil passa à frente da fila e a tarefa consulta-o no minuto seguinte (202); a prova lê-se em `GET …/vies-checks` (revisão do #244, P1-1: nenhum pedido HTTP prende uma ligação à base) | proposta |

Um `indisponivel` volta à fila com espera crescente (1 min, 5 min, 30 min,
depois a revalidação diária) — proposta. Os erros vão para o registo da
aplicação **sem o NIF** (só o `bpf_` e o código; R12).

**Requerente:** o NIF da entidade legal do comerciante, quando ele tem uma só
entidade activa num país da UE (`pais_do_comerciante`). Se o VIES responder
`INVALID_REQUESTER_INFO`, repete sem requerente e a prova fica sem número de
consulta — proposta (Q7).

### 13.5 A isenção manual (`isencao_manual`, `exm_`) e os anexos

| Campo | Notas | Marca |
|---|---|---|
| `perfil_id` | uma isenção **em vigor** por perfil (índice único parcial) | proposta |
| `motivo` | texto obrigatório, 1 a 500 caracteres; ex.: «transportadora própria, declaração aduaneira entregue» | regra (`eu-vat-oss-ioss`, «As peças») |
| `nota` | texto livre | regra |
| `posta_por`, `posta_em` | a chave ou a pessoa; **nunca** `sistema:` | regra (regra 4) |
| `retirada_por`, `retirada_em`, `motivo_retirada` | só uma pessoa; a base recusa `sistema:` | regra (regra 4) |

- Não se altera: muda-se retirando e pondo outra (o histórico fica inteiro) —
  proposta.
- **Anexos** (`anexo_isencao`, `exa_`): PDF, JPEG ou PNG, até 10 MB cada, até
  5 por isenção; **na base de dados** (Diogo, 10/10/2026: «A»; `docs/06`, DN),
  nunca públicos; os bytes lêem-se pela API com `customers:exemptions` — no
  código (migração 0055, §13.11). O prazo de guarda é o fiscal (**C**, V2).
- Eventos `billing_profile.exemption_set` e `billing_profile.exemption_removed`
  (`bpf_`, `exm_`, quem) — proposta (novos).

### 13.6 Lista da API (parte 3)

| Operação | Método e caminho | Âmbito |
|---|---|---|
| Pedir uma consulta (202; a fila consulta no minuto seguinte) | `POST /billing-profiles/{id}/vies-checks` | `customers:billing` |
| As provas | `GET /billing-profiles/{id}/vies-checks` | `customers:read` |
| Pôr uma isenção | `PUT /billing-profiles/{id}/exemption` (`{ motivo, nota }`) | `customers:exemptions` |
| Retirar | `DELETE /billing-profiles/{id}/exemption` (`{ motivo_retirada }`) | `customers:exemptions` |
| A isenção e o histórico | `GET /billing-profiles/{id}/exemptions` | `customers:read` |
| Anexos | `POST /exemptions/{id}/attachments` e `GET /exemptions/{id}/attachments/{anexo}` (`customers:exemptions`); `GET /exemptions/{id}/attachments`, sem os bytes (`customers:read`) | ver §13.11 |

O perfil passa a mostrar `validado_em` e se tem isenção em vigor.

### 13.7 Por onde é que isto ainda pode sair errado

| Risco | O que o evita |
|---|---|
| Uma venda sai isenta com o VIES em baixo | `indisponivel` nunca é `valido` (R7); o Motor de IVA cobra |
| Um NIF mudado durante a consulta fica «válido» com a resposta do antigo | §13.4, passo 4: o estado só muda se o NIF ainda for o consultado |
| A revalidação desliga a isenção de uma pessoa | a isenção é outra tabela; a base recusa retirá-la com `quem` de sistema |
| Pedidos a mais e o VIES recusa | um de cada vez, com pausa e espera crescente (§13.4) |
| A API presa à espera do VIES | a consulta é fora das transacções, com 10 s de tempo máximo |
| O NIF nos registos da aplicação | só o `bpf_` e o código de erro (R12) |
| A VPS sem saída para `ec.europa.eu` | **não verifiquei** se a rede do contentor da API sai para a Internet; mede-se no ensaio antes de ligar a tarefa |
| Uma prova sem número de consulta não vale para o fisco | V3 (**C**); o servidor guarda tudo o que o VIES devolve |

### 13.8 Perguntas

| # | Pergunta | Proposta |
|---|---|---|
| Q6 | Quando o VIES não responde, o perfil que estava «válido» continua «válido» (com a data da última resposta) ou passa logo a «sem resposta»? | ✅ **Decidido** (Diogo, 09/10/2026): **continua «válido», com a data**; quanto tempo essa resposta serve para isentar uma venda decide-o o Motor de IVA com o contabilista (V5). Passar logo a «sem resposta» faria cobrar IVA a um cliente válido sempre que o VIES falha |
| Q7 | Enviar o NIF do comerciante como requerente em cada consulta? | ✅ **Decidido** (Diogo, 09/10/2026): **sim**: é o único modo de o VIES devolver o número de consulta (medido, §13.2), que é o que se guarda como prova |

Para o contabilista (bloqueiam a produção, não o código):

| # | Pergunta |
|---|---|
| V3 | (já na §10) O número de consulta exige o requerente (medido: sim) — e vale como prova? |
| V5 | Quanto tempo antes do checkout pode ter sido a última resposta «válido» do VIES para isentar a venda? |

### 13.9 Como entra no código

Uma migração (a próxima livre) com `validacao_vies`, `vies_registar`,
`isencao_manual`, `anexo_isencao`, o âmbito `customers:exemptions` (só o
dono) e os eventos; o adaptador do VIES em `src/clientes/vies.ts`, com um
servidor falso nos testes (nenhum teste chama a Comissão); a tarefa de
minuto a minuto e a diária; as rotas. Revisão de um agente antes de juntar.

### 13.10 Em código (09/10/2026; migração 0039; `docs/06`, CY)

| O quê | Onde |
|---|---|
| a prova (`validacao_vies`), que só se acrescenta; `vies_registar`, que muda o estado só se o NIF ainda for o consultado e se não houver resposta mais recente gravada, mantém a última resposta num `indisponivel` (Q6), só altera o perfil quando o estado muda e emite `validated`/`invalidated`; a data da última resposta (`validado_em`) lê-se das provas | migração 0039 |
| a fila (`vies_fila`, interna): o gatilho do perfil põe e tira; depois de uma resposta, a próxima na janela da noite (01:00–05:00 UTC) a pelo menos 24 h; sem resposta, 1, 5 e 30 min, depois a noite | migração 0039 |
| o requerente (Q7): o NIF da entidade legal, só com uma activa num país da UE (`vies_requerente`) | migração 0039 |
| a isenção manual (`isencao_manual`): uma em vigor por perfil, com o NIF do perfil no momento, não se altera nem se apaga, retira-se uma vez; só com `quem` `pessoa:per_…` ou `chave:key_…` (lista branca) | migração 0039 |
| o adaptador da API REST do VIES (EL para a Grécia, `---` como vazio, tudo o que não é `valid` é `indisponivel`, repete sem requerente num `INVALID_REQUESTER_INFO`, 10 s) | `src/clientes/vies.ts` |
| a tarefa de minuto a minuto, um pedido de cada vez com 1 s de pausa, até 5 por comerciante e 30 por volta, um país que diz «pedidos a mais» fica de fora até à volta seguinte, uma falha adia a linha; `quem` «sistema:vies». **Desligada por omissão**: liga-se com `VIES_URL` (o endereço da API REST), depois de medir a saída da VPS | `src/clientes/vies-fila.ts`; `src/servidor.ts` |
| as rotas: `POST/GET /billing-profiles/{id}/vies-checks`, `PUT/DELETE /billing-profiles/{id}/exemption`, `GET /billing-profiles/{id}/exemptions`; o perfil com `validado_em` e `isencao_em_vigor` | `src/clientes/rotas.ts` |
| o âmbito `customers:exemptions`, só do dono (Q4) | migração 0039; `src/identidade/` |
| 20 testes (o adaptador contra um servidor HTTP falso; a API e a fila contra uma consulta falsa — nenhum chama a Comissão); 19 mutações desta versão, todas apanhadas | `test/clientes-vies.test.ts` |

**Desvios do desenho:**
- **Os anexos da isenção ficaram para um pedido à parte**: a pasta das imagens
  tem uma limpeza de ficheiros sem linha (`docs/14` §3.5). Entraram depois, na
  base de dados (§13.11).
- **A consulta pedida** (`POST …/vies-checks`) não espera pelo VIES: põe o
  perfil à frente da fila e responde 202 (revisão do #244, P1-1).
- **A fila vem desligada** até se medir a saída da VPS para a Comissão
  (`VIES_URL`; revisão do #244, P2-5): ligar é um pedido à parte. A medição
  fixa da VPS (`eurolify-medir`, fluxo `medir`) diz se a máquina chega ao
  `check-status` do VIES e se o `VIES_URL` está na configuração da API
  (12/10/2026).
  Mede a partir da máquina, não do contentor da API (outra rede e outros
  certificados): a prova final é a primeira consulta da fila depois de ligar,
  com o `codigo_erro` se falhar (revisão do #377, P2-1).
  Ligar muda a configuração da máquina (AGENTS.md, «Operar a VPS», regra 1):
  o Diogo decidiu ligar a 12/10/2026 (*«sim, avança»*). O passo 10c do
  `preparar.sh` escreve o `VIES_URL` no `/etc/eurolify/api-vies.env` e recria
  a API; a publicação passa-o à API; a medição diz se está na configuração e
  na API no ar. **No ensaio, o serviço de teste da Comissão**
  (`…/rest-api/check-vat-test-service`; «100» válido, «200» inválido, com
  nome e morada de exemplo): a VPS ainda está no Reino Unido e nenhum dado
  pessoal real entra nela (ADR-0019; revisão do #405, P2-1; Diogo,
  12/10/2026: *«a»*). O serviço verdadeiro liga-se em Paris.
- A isenção e a prova não entram na linha do tempo da ficha: são registos que
  só se acrescentam, com o seu quem e quando.

**Depois da revisão do agente** (#244): P1-1, P2-1 a P2-8 tratados como
acima, com testes; dos P3, o `TEMPO_ESGOTADO` a meio do corpo (P3-3), o NIF
na isenção (P3-8) e o `FOR SHARE` do perfil ao pôr a isenção (P3-9).
**Ficam escritos para depois:** a prova sem o corpo bruto da resposta (P3-1;
guarda os campos); a Grécia guarda-se como `GR` e envia-se `EL` (P3-2); um
varrimento que reponha linhas da fila em falta (P3-4); o Motor de IVA exige
idade máxima da resposta (P3-5, V5); duas instâncias da API duplicavam
consultas (P3-7; há uma); `valido → por_validar` por NIF novo sem evento
próprio (P3-10); a pseudonimização do nome e morada devolvidos, na parte 2
(P3-11); a isenção num perfil sem VIES aplicável fica para o Motor de IVA
(P3-14).

**Não verificado:** se o contentor da API na VPS sai para `ec.europa.eu`
(sem saída, as provas ficam `indisponivel` com `SEM_LIGACAO`, e nada fica
isento); os limites de pedidos do VIES; V3 e V5 com o contabilista.

### 13.11 Os anexos da isenção em código (10/10/2026; migração 0055)

| O quê | Onde |
|---|---|
| `anexo_isencao` (`exa_`) **na base de dados** (Diogo, 10/10/2026: «A»; `docs/06`, DN): com o RLS de cada comerciante, nas cópias que já existem, sem nada a mudar na VPS | migração 0055 |
| PDF, JPEG ou PNG **pela assinatura** (os primeiros bytes têm de ser do tipo dito; não há verificação da estrutura nem antivírus), até 10 MB, até 5 por isenção e até 1 GB por comerciante (como as imagens, proposta; revisão do #338, P2-2), só numa isenção em vigor de um perfil activo numa ficha activa (P2-1); o tamanho e o resumo (sha256) põe-nos a base; os bytes ficam como chegaram (é a prova: não se limpam metadados) | migração 0055 |
| só uma pessoa ou a chave dela (`customers.exemption_by_person`), como a isenção | migração 0055 |
| não se altera nem se apaga, nem pelo superutilizador (`audit.append_only`); a pseudonimização apaga os anexos das isenções dos perfis que ninguém usou e guarda os dos usados | migração 0055 |
| `POST /exemptions/{id}/attachments` (o corpo são os bytes, com o Content-Type; `?nome=` opcional; no máximo 2 envios em simultâneo por comerciante) e `GET /exemptions/{id}/attachments/{anexo}` com `customers:exemptions`; `GET /exemptions/{id}/attachments` (sem os bytes) com `customers:read`. O descarregamento leva a extensão do tipo (nunca a que veio no nome), o nome em ASCII e em UTF-8 (RFC 6266), `nosniff` e `sandbox` (P1-1, P2-4) | `src/clientes/rotas.ts`, `repositorio.ts` |
| a exportação do titular **lista** os anexos (sem os bytes); os bytes lêem-se pela rota deles, com `customers:exemptions` — se o acesso do titular exige os bytes na exportação é **C**, para o jurista (revisão do #338, P2-5) | `src/clientes/repositorio.ts` |
| testes: `test/clientes-anexos-isencao.test.ts` (10: os tipos, os limites, a corrida no quinto lugar, a quota, a isenção retirada e o perfil pseudonimizado, o âmbito, o RLS dos bytes, a prova, a pseudonimização, o nome e os cabeçalhos, a idempotência, a exportação); 14 mutações, 13 apanhadas (a verificação do tipo na rota é uma segunda rede: sem ela, o leitor e a base recusam) | `test/` |

**Fica por fazer:** o prazo de guarda (**C**, V2); medir o crescimento da base
com anexos (não medido); o limite de envios em simultâneo não tem teste (é
o mesmo das imagens); o resultado da pseudonimização não conta os anexos
apagados (P3-6); o anexo não deixa evento nem rasto de leitura (P3-7).

## 14. Consentimento por contacto e dupla confirmação (desenho de 10/10/2026)

> **Estado: no código (migração 0052), revisto (revisão do agente no #330); à espera de juntar.**
> Decisão do Diogo, 10/10/2026, em resposta à revisão do #325, que substitui
> a régua por ficha (`docs/06`, DL); Q-C1 decidida (A). Ver §14.8.
> As fontes legais abaixo foram indicadas pelo Diogo; **não verifiquei** o
> texto delas, por isso ficam **C** até um jurista as confirmar (com a V4).

### 14.1 As regras

| # | Regra | Fonte (indicada pelo Diogo) |
|---|---|---|
| C1 | O estado do marketing guarda-se **por contacto e por canal** (cada e-mail, cada telefone), não por ficha | RGPD, art. 7.º, n.º 1 — **C** |
| C2 | A prova de cada declaração identifica **o canal e o contacto concreto** a que o «sim» ou o «não» se refere | RGPD, art. 7.º, n.º 1 — **C** |
| C3 | Se um contacto tem uma recusa activa (oposição, retirada, subscrição cancelada), um «sim» novo para esse contacto **não muda o estado logo**: dispara uma **dupla confirmação** enviada a esse contacto (ligação por e-mail, código por SMS). Só a confirmação passa o estado a «sim», e o registo dela fica como prova | RGPD, art. 21.º, n.º 3, e art. 7.º, n.º 3 — **C** |
| C4 | Sem confirmação, a recusa mantém-se | RGPD, art. 21.º, n.º 3 — **C** |
| C5 | Um «sim» dado através de outro contacto só autoriza esse contacto; não mexe na recusa dos outros | RGPD, art. 5.º, n.º 1, al. d) — **C** |
| C6 | E-mail e SMS exigem consentimento prévio expresso | Lei 41/2004, art. 13.º-A, n.º 1 (PT) — **C** |
| C7 | A prova pode ficar na ficha de origem, lida a partir da ficha fundida, desde que a ligação não se perca; se a ficha de origem for apagada ou pseudonimizada, o consentimento que vinha dela cai | RGPD, art. 7.º, n.º 1 — **C** |

**O estado é do contacto no comerciante**, não da ficha nem do grupo: o
mesmo e-mail noutra ficha do mesmo comerciante é o mesmo contacto, e a recusa
dada numa vale na outra (leitura da regra do Diogo, «por contacto e por canal,
não por ficha»; revisão do #330, P1-4).

**Consequência para as fusões:** deixa de haver uma regra própria. Cada
contacto leva o seu estado; numa fusão, a ficha que fica junta os contactos e
cada um continua com o estado que tinha, dado em qualquer ficha do grupo.
Exemplo: a Ana retirou `ana@exemplo.pt` na ficha antiga e aceitou
`ana.silva@exemplo.pt` na nova; fundidas, recebe no segundo e não no primeiro.
Um «sim» novo para `ana@exemplo.pt` só conta depois de ela clicar na ligação
enviada a esse endereço.

### 14.2 Modelo (proposta)

| Muda | Como |
|---|---|
| `consentimento.contacto` (novo) | o e-mail como se compara (sem espaços, minúsculas) ou o telefone como está na ficha; obrigatório nas declarações novas; tem de ser um contacto da ficha (ou do grupo) no momento da declaração |
| `consentimento.via` (novo) | `directa` (a declaração como hoje) ou `dupla_confirmacao` (nasceu de uma confirmação; aponta para ela) |
| `confirmacao_consentimento` (`ccf_`, nova) | o pedido de confirmação: ficha, canal, contacto, o resumo do segredo (nunca o segredo), criado, expira, tentativas, estado (`pendente`, `confirmada`, `expirada`, `cancelada`, `esgotada`); muda de estado só para a frente |
| a régua | por contacto: a última declaração desse contacto e canal no grupo; sem nenhuma ⇒ não; um «aceitou» `directa` sobre uma recusa activa **não entra**: vira um pedido de confirmação |
| `pode_receber_marketing(cliente, canal)` | passa a devolver os contactos com «sim»; nova `pode_receber_marketing(cliente, canal, contacto)` para a pergunta exacta |
| as declarações antigas (sem contacto) | valem para os contactos que a ficha tinha à data da migração, guardados em `consentimento_contacto_inferido`; um contacto acrescentado depois não herda nada (revisão do #330, P2-1). No ensaio não há dados pessoais reais (ADR-0019), por isso não há consentimentos reais a herdar |

O que já está feito e serve: as declarações só se acrescentam e ficam na
ficha onde foram dadas (0042); a lista dos consentimentos lê o grupo (0046);
a pseudonimização apaga as declarações do grupo inteiro (0049), e por isso o
consentimento cai com a ficha (C7).

### 14.3 A dupla confirmação

- **E-mail:** uma ligação com um segredo de uso único, válida **24 horas** —
  **proposta**.
- **SMS:** um código de **6 dígitos**, válido **10 minutos**, no máximo **5
  tentativas**; depois, o pedido cai — **proposta**.
- **WhatsApp:** sem fonte de consentimento, continua não (§3.6); não há
  confirmação por WhatsApp.
- Guarda-se só o resumo do segredo (como as chaves e o token do checkout).
- Um pedido novo para o mesmo contacto e canal cancela o anterior; **no
  máximo 3 pedidos por contacto e canal numa hora** (`customers.confirmation_rate_limited`,
  429), para não inundar o contacto nem deixar adivinhar o código pedindo
  outro (revisão do #330, P1-3).
- **Uma declaração do contacto depois do pedido** (um «não» que chegou
  entretanto) faz cair a ligação antiga (revisão do #330, P1-2).
- O Eurolify não prova que quem clica é o dono do contacto: isso é do sistema
  do comerciante, que recebe o segredo; a prova guarda quem pediu (a chave).
- A confirmação regista uma declaração `aceitou` com `via =
  dupla_confirmacao`, a hora, o contacto e a referência do pedido: é a prova
  (C3).
- **Quem envia a mensagem: o sistema do comerciante** (Q-C1, decidida: A).
  O Eurolify cria o pedido e devolve o segredo (a ligação ou o código) **uma
  só vez**, na resposta ao pedido que o criou; repetir com a mesma chave de
  idempotência não o devolve outra vez (`idempotency.secret_not_repeated`,
  como as chaves). O sistema do comerciante envia a mensagem ao contacto e,
  quando a pessoa clica ou escreve o código, pede ao Eurolify para confirmar;
  o Eurolify valida. O segredo nunca vai num evento nem num registo (R12).
  Mais tarde, o domínio de Notificações do Eurolify pode enviar ele mesmo,
  com um fornecedor na UE (decisão escrita à parte).

### 14.4 API (proposta)

| Operação | O quê |
|---|---|
| `POST /customers/{id}/consents` | passa a pedir `contacto`; sobre uma recusa activa responde **202** com o pedido de confirmação (`ccf_…`), o segredo (uma só vez) e a hora em que expira, e não muda a régua |
| `POST /consent-confirmations/{id}/confirm` (`customers:write`) | o sistema do comerciante entrega o que a pessoa trouxe (o segredo da ligação ou o código); recusa se está errado, expirou, foi cancelado, já foi usado ou esgotou as tentativas |
| `GET /customers/{id}/consents` | a régua por canal **e por contacto** |
| eventos | `consent.changed` e `consent.confirmation_requested` levam só identificadores (`cus_`, `cns_`, `ccf_`, canal), **nunca** o contacto nem o segredo (R12) |

### 14.5 Por onde é que isto ainda pode sair errado

- **O segredo vaza** (num registo, num evento): só o resumo se guarda; o
  segredo só existe na mensagem enviada.
- **Força bruta ao código do SMS:** 5 tentativas por pedido e 3 pedidos por
  contacto e canal numa hora (15 tentativas por hora num código de 6 dígitos).
  Quem tiver uma cópia da base adivinha o resumo de um código em segundos;
  fecha em 10 minutos.
- **Um contacto que muda de dono** (um e-mail ou telefone reatribuído): a
  confirmação vai ao contacto, não à pessoa; fica escrito como risco.
- **Comparar contactos:** o mesmo e-mail com maiúsculas é o mesmo contacto; um
  telefone em formatos diferentes não se junta sozinho (a ficha só aceita o
  formato da 0037).
- **Um contacto tirado da ficha:** deixa de receber, porque não está na ficha;
  se voltar, o estado é o que tinha.

### 14.6 Perguntas

| # | Pergunta | Proposta |
|---|---|---|
| Q-C1 | Quem envia a ligação e o código da dupla confirmação? | **Decidida (Diogo, 10/10/2026: «A»):** o sistema do comerciante; o Eurolify cria o pedido, devolve o segredo uma vez e valida |
| Q-C2 | Os prazos (24 h, 10 min, 5 tentativas) | os acima, **proposta** |
| Q-C3 | As declarações antigas sem contacto | as da proposta do §14.2 |

### 14.7 Como entra no código (quando aprovado)

1. Migração: `contacto` e `via` no consentimento, a tabela dos pedidos, a régua
   por contacto e as funções da confirmação; as declarações antigas.
2. API: as rotas do §14.4 e os eventos.
3. Testes: as regras C1–C7, um a um, com uma fusão; a força bruta; a
   expiração; o segredo fora dos registos e dos eventos; as mutações.
4. A migração 0051 do #325 (a régua por ficha) **não entra**: é substituída por
   esta.

### 14.8 Em código (10/10/2026; migração 0052)

| O quê | Onde |
|---|---|
| `consentimento.contacto` (obrigatório nas novas, como se compara: o e-mail em minúsculas, o telefone como a ficha o guarda; tem de ser da ficha), `via` e `confirmacao_id` (só a confirmação os põe) | migração 0052 |
| o estado por contacto (`marketing_do_contacto`): a última declaração desse contacto no comerciante, em qualquer ficha; as antigas sem contacto valem para os contactos que a ficha tinha na migração (`consentimento_contacto_inferido`) | migração 0052 |
| as réguas: `pode_receber_marketing(cliente, canal, contacto)`, `contactos_com_marketing(cliente, canal)`; `pode_receber_marketing(cliente, canal)` dá sim se algum contacto **da ficha** pode; o plano da fusão conta os contactos das duas | migração 0052 |
| sobre uma recusa activa do contacto, a base recusa um «sim» directo (`customers.consent_confirmation_required`), e a API cria o pedido (`confirmacao_consentimento`, `ccf_`) e responde **202** com o segredo, uma só vez | migração 0052; `src/clientes/` |
| a confirmação (`POST /consent-confirmations/{id}/confirm`, `customers:write`): 24 h e uma ligação de 32 bytes no e-mail, 10 min e 6 dígitos no SMS, 5 tentativas; a tentativa errada fica contada; um pedido novo cancela o anterior; WhatsApp sem confirmação (`customers.confirmation_channel`) | migração 0052; `src/clientes/` |
| o segredo: só o resumo (sha256 do id e do segredo), a API não lê o resumo; nem nos eventos (`consent.confirmation_requested` leva só identificadores), nem na idempotência (repetir dá `idempotency.secret_not_repeated`) | migração 0052; `src/clientes/rotas.ts` |
| depois da revisão do #330: o estado no comerciante (P1-4); a pseudonimização com pedidos confirmados (chaves diferidas, P1-1); a ligação cai com uma declaração posterior (P1-2); 3 pedidos por hora (P1-3); as antigas inferidas à data da migração (P2-1); o evento `consent.changed` diz também `contacto_pode_receber` e `via` (P2-2); a ficha tomada antes do pedido ao confirmar (P2-3) | migração 0052 |
| **quebra de contrato** (ensaio, sem clientes da API em produção; registada a 10/10/2026, decisão DL): `contacto` obrigatório no `POST /customers/{id}/consents`, que pode responder 202 | `src/clientes/rotas.ts` |
| a pseudonimização apaga os pedidos do grupo (têm o contacto) e a linha do tempo perde o contacto das declarações; a exportação junta os pedidos, sem o resumo | migração 0052; `src/clientes/repositorio.ts` |
| testes: `test/clientes-consentimento-contacto.test.ts` (10: C1–C7, o SMS, a expiração, o segredo, a fusão, a pseudonimização, o comerciante, o limite, o «não» posterior, o contacto tirado), `test/migracao-0051.test.ts` (as antigas sobre dados); os de consentimentos, fusões e titular adaptados; 16 mutações, todas apanhadas | `test/` |

**Fica por fazer:** a página (ou o ecrã) da loja que recebe a ligação e o
código (é do sistema do comerciante, Q-C1); o domínio de Notificações, se
um dia o Eurolify enviar ele mesmo; as fontes **C** com o jurista.

## 15. Os pedidos do titular em todos os domínios (desenho de 11/10/2026)

Pedido do Diogo, 11/10/2026: *«sim, avança com o desenho do #233»*. O que
estava em aberto desde a parte 2c: «os dados de encomendas e checkout no
apagamento (fatias 9 e 10)» (§12; migração 0049, linhas 41-46). Skills:
`eu-gdpr-privacy`, `eu-vat-oss-ioss`, `consumer-rights-eu`,
`order-fulfilment`, `payments-psd2-sca`, `observability-security`.

**O problema, medido a 11/10/2026** (leitura das migrações e do teste
`checkout-api.test.ts:1404-1412`): a exportação e a pseudonimização só
tratam a ficha e o que pende dela. As fatias que entraram depois — checkout
(0041), pagamentos (0044), stock e encomendas (0047), documentos (0050),
pós-venda (0058, 0061, 0063) — guardam **cópias** dos dados pessoais em
tabelas que não se deixam mudar, e nenhuma entrou no apagamento. Não são
cinco esquecimentos: o apagamento ficou preso à ficha e cada domínio novo
acrescentou a sua cópia.

Ex.: a Ana compra sem conta e pede o apagamento. A ficha dela fica
«Pseudonimizado», mas a encomenda continua com `contacto` (e-mail, nome,
telefone), `entrega` (morada) e `perfil_copia` (NIF e morada fiscal), o
pedido de livre resolução com o e-mail dela, e o perfil de faturação inteiro
(a encomenda aponta para ele). O resultado já o admite:
`encomendas_com_dados_por_tratar: 1`.

### 15.1 A regra: três grupos de dados

RGPD, art. 17.º (texto oficial em português, EUR-Lex, CELEX 32016R0679,
lido a 11/10/2026 — **W · texto lido**): apaga-se quando os dados «deixaram
de ser necessários para a finalidade» (n.º 1, al. a)); não se apaga o que
for necessário para «uma obrigação legal» (n.º 3, al. b)) ou para a
«defesa de um direito num processo judicial» (n.º 3, al. e)).

| Grupo | O quê | No apagamento |
|---|---|---|
| **A. Prova fiscal** | o conteúdo e a prova de cada documento fiscal (comprador, NIF, morada, PDF) e a cópia de onde se emitiu | **fica**, 10 anos civis em Portugal (art. 52.º do CIVA, **W**; outros países **C**) — art. 17.º, n.º 3, al. b) |
| **B. Dados da encomenda em curso** | contacto, morada e textos de uma encomenda que ainda não acabou (por pagar, por expedir, com livre resolução, devolução, problema ou reembolso em aberto) | **fica até acabar**, e então limpa-se sozinho (§15.3) — ainda é preciso para cumprir o contrato |
| **C. O resto** | contacto e morada de encomendas acabadas, e-mail do pedido de livre resolução, textos livres, sessões de checkout | **limpa-se já** — art. 17.º, n.º 1, al. a) |

O que é registo do negócio sem dados de quem comprou — o que se vendeu, as
quantidades, os preços, as datas, os estados — **fica** (o comerciante
precisa dele para a garantia, as devoluções e a contabilidade).

### 15.2 Tabela a tabela

«Marcador» é o texto fixo «(pseudonimizado)», como na 0049; num `jsonb`,
os campos pessoais passam a marcador e os outros ficam.

| Tabela.coluna | Dado | Apagamento | Exportação |
|---|---|---|---|
| `encomenda.contacto` | e-mail, nome, telefone | grupo C: marcador; grupo B: quando acabar | já sai |
| `encomenda.entrega` | morada de entrega | igual | já sai |
| `encomenda.perfil_copia` | NIF, nome e morada fiscais | **fica** se a encomenda tem documento emitido ou por emitir (grupo A); senão, marcador | já sai |
| `encomenda` (linhas, totais, estado, datas) | registo do negócio | fica | passa a sair inteira (hoje faltam `portes`, `metodo_entrega`, `aceitacoes`, `lingua`) |
| `perfil_faturacao` usado | NIF, nome, morada | **fica** só se um documento o usou ou uma encomenda paga o vai usar (Q2) — hoje fica com qualquer encomenda, também a não paga | já sai |
| `sessao_checkout` (e-mail, nome, telefone, entrega, faturação) | cópia do que se escreveu no checkout | não tem ligação à ficha: não se acha por cliente. Limpa-se por prazo (§15.4) | não sai (não há como a ligar à pessoa sem decidir pelo e-mail — regra 6 do `AGENTS.md`) |
| `expedicao.prova_entrega` | texto livre (pode ter o nome de quem recebeu) | marcador | passa a sair (com transportadora, seguimento, datas) |
| `pagamento` | referência, montante, estado | fica (registo do negócio) | já sai |
| `aviso_pagamento.corpo` | aviso em bruto do prestador; segundo o `docs/26` (V3), o MB WAY traz o telefone | quando o pagamento acabou: o corpo passa a resumo SHA-256 e aos campos que se sabem não pessoais (Q3) | não sai (técnico) |
| `transicao_encomenda.motivo`, `transicao_pagamento.motivo` | texto livre escrito por uma pessoa | marcador, como na 0062 | passa a sair o histórico de estados (sem o motivo) |
| `documento_conteudo`, `documento_prova` (com o PDF e a resposta em bruto) | comprador, NIF, morada | **fica** (grupo A) | passa a sair: tipo, número, data, totais e o comprador como está no documento; **sem os bytes do PDF** (Q4) |
| `documento_rasto.motivo` | texto livre da correcção de um documento | **fica** (faz parte do rasto do documento fiscal; Q4) | não sai |
| `pedido_livre_resolucao.contacto` | e-mail | grupo C: «sem e-mail»; grupo B: quando acabar | passa a sair (com a confirmação e o estado) |
| `pedido_livre_resolucao.motivo_decisao`, `devolucao.motivo`, `problema.descricao` | texto livre | marcador quando acabarem | passam a sair |
| `reembolso` | montantes, estado, prova (data, referência do banco, quem); o IBAN nunca se guarda | fica (registo financeiro) | passa a sair (sem a prova) |
| `linha_livre_resolucao`, `linha_reembolso`, `linha_devolucao.decisao_higiene` | que artigos a pessoa quis devolver; de que linhas (e portes) é cada reembolso; a decisão que reembolsa ou recusa um artigo selado aberto | fica (sem texto livre) | passam a sair (Diogo, 13/10/2026; revisão do #411, P3-2) |
| `evento_seguimento.estado_transportadora` | o estado que a transportadora deu (pode trazer quem recebeu) | marcador (0079) | passa a sair, com o estado normalizado e a data; sem o id do evento da transportadora nem o aviso em bruto (`aviso_transportadora`) (Diogo, 13/10/2026) |
| `evento_saida` | só identificadores e montantes | fica | não sai |

### 15.3 Encomendas em curso: aplica-se quando acabarem

Uma encomenda **acabou** quando o estado é final (`concluida`, `cancelada`,
`cancelada_sem_pagamento`, `devolvida`; migração 0058, linhas 27-30) e não
tem nada aberto na pós-venda (livre resolução `pendente` ou `fora_de_prazo`,
à espera da decisão de uma pessoa; devolução que não
esteja `fechada` nem `cancelada`, problema que não esteja `fechado`,
reembolso que não esteja `executado` nem `cancelado`; 0058, linhas 260, 322,
459 e 515), nem pagamento vivo ou incerto, nem diferença de pagamento por
resolver (ex.: pago depois de cancelada; revisão do #374, P2-3).

Duas que nunca chegam a um estado final também acabam, nas mesmas condições
(revisão do #374, P1-1; Diogo, 12/10/2026: *«a»*). Os estados da encomenda
não mudam:

- `devolvida_parcial`, que só pode passar a `devolvida`: 14 dias depois da
  última entrega, como a `concluida` (o resto ainda se pode devolver);
- `expedida` sem expedição `criada` nem `expedida`, com alguma `perdida` ou
  `devolvida_ao_remetente`, depois de uma pessoa fechar o problema da
  encomenda (com ou sem reembolso: um reenvio fora, numa encomenda nova) ou
  de o pagamento deixar de estar capturado (reembolsado, disputa perdida).
  Até lá, o comerciante ainda reenvia (e precisa da morada) ou reembolsa.

Um pagamento `em_disputa` também conta como aberto, em qualquer estado: a
prova de entrega é do comerciante (segunda revisão do #374, P2-2).

Fica sem fim, fora da decisão: uma `expedida_parcial` cuja expedição se
perdeu e cujo resto nunca sai (só pode passar a `expedida`, e já não se
cancela). Por decidir.

- No pedido de apagamento, as encomendas acabadas limpam-se logo; as outras
  ficam numa fila com o pedido (`pedido_titular`), e o resultado diz quantas
  (`encomendas_por_acabar`).
- Uma tarefa limpa cada uma quando acabar, e escreve no pedido o que fez. O
  pedido só fica **completo** quando a fila esvazia; o `GET
  /customers/{id}/privacy-requests` mostra-o.
- Uma livre resolução depois do apagamento continua possível pelo número da
  encomenda; o pedido fica «sem e-mail».

### 15.4 As sessões de checkout

Não têm `cliente_id` (o cliente nasce no botão final; 0041, linhas 209-216).
Procurar a da Ana pelo e-mail seria decidir identidade por um sinal que só
diz «talvez». Em vez disso, por prazo (o que o `docs/25` §7 já propunha):

- **sessão concluída**: os dados pessoais limpam-se logo ao criar a
  encomenda — a encomenda tem a cópia (parte 2). Num pedido de apagamento,
  a sessão de cada encomenda limpa-se com ela: chega-se pela encomenda, sem
  decidir pelo e-mail (parte 1; revisão do #374, P2-1);
- **sessão expirada ou abandonada**: limpam-se 7 dias depois (`docs/25`
  §7, proposta; prazo **C**, jurista).

Assim, nenhuma sessão guarda dados mais de cerca de 8 dias (até 24 h aberta,
mais 7 dias, mais até 1 h da volta da tarefa; revisão do #402, P2-1), e o
pedido do titular não precisa de as procurar.

### 15.5 Várias fichas da mesma pessoa

Cada compra sem conta cria uma ficha nova (`docs/25` R8). Um pedido sobre
uma ficha não chega às outras da mesma pessoa. O resultado da exportação e
do apagamento passa a listar as **fichas com o mesmo e-mail ou telefone**
para o dono decidir se as funde antes — nunca o sistema sozinho (regra 6 do
`AGENTS.md`; `eu-gdpr-privacy`, «Fusões e identidade»).

### 15.6 Como entra no código

- **Uma função só**, a da 0049 (`cliente_pseudonimizar`), passa a tratar
  também os outros domínios, na mesma transacção e com a mesma marca
  (`pseudonimizacao_em_curso`). Cada tabela que hoje recusa mudanças abre
  **só** as colunas da §15.2, **só** para o marcador e **só** com a marca;
  a API e o superutilizador continuam recusados (como na 0049).
- O que fica (grupo A) não se toca: os gatilhos dos documentos fiscais não
  ganham excepção nenhuma.
- Um pedido é sempre sobre um cliente, decidido por uma pessoa com
  `customers:privacy`, com a confirmação escrita — nunca em lote.
- O resultado diz, por tabela, quantas linhas limpou, quantas ficaram e
  porquê (obrigação fiscal; encomenda por acabar).
- A tarefa da §15.3 e a limpeza das sessões (§15.4) registam cada passo no
  `pedido_titular` ou num registo próprio, e avisam se pararem
  (`observability-security`).
- A exportação ganha as tabelas da coluna «Exportação» da §15.2.
- Testes que falham sem a protecção: a encomenda acabada fica sem contacto
  e morada; a em curso fica até acabar e depois limpa-se; o documento
  emitido fica igual, byte a byte; a API não consegue abrir as colunas; a
  sessão concluída fica sem dados; a de 8 dias também.

### 15.7 Fica de fora

- Os **prazos de guarda depois dos 10 anos** e a purga das encomendas
  antigas por idade: dependem da Q4 do `docs/28` (jurista e contabilista).
- A **limitação** (art. 18.º) noutros domínios: continua só na ficha (§12).
- As **cópias de segurança**: o apagamento chega quando expiram (14 dias,
  `docs/17` §3); fica dito na política de privacidade.
- Os ecrãs no Hub: os pedidos do titular ainda não têm ecrã.

### 15.8 Perguntas para o Diogo ou o Bruno

✅ **Decididas** pelo Diogo a 11/10/2026 (*«aprovado»*, às propostas;
`docs/06`, DU).

| # | Pergunta | Decisão |
|---|---|---|
| Q1 | Uma encomenda em curso: limpa-se logo ou quando acabar? | Quando acabar (§15.3): limpar o contacto de uma encomenda por expedir impede entregá-la — o contrato ainda está a ser cumprido |
| Q2 | O perfil de faturação de uma encomenda **não paga** fica? | Não: só fica com documento emitido ou por emitir (encomenda paga). Uma não paga não gera fatura. **C**, contabilista — é o «critério mais estreito» que a §12 deixou em aberto |
| Q3 | O aviso em bruto do prestador, depois de o pagamento acabar | Passa a resumo SHA-256 mais os campos não pessoais (id do evento, montante, referência, estado). Os campos exactos dependem do formato da EuPago — não verifiquei (**C**) |
| Q4 | Os documentos fiscais na exportação, e o motivo da correcção de um documento | Na exportação: tipo, número, data, totais e o comprador como está no documento, sem os bytes do PDF (como os anexos da isenção, DN; **C**, jurista). O motivo da correcção fica (rasto do documento fiscal; **C**, contabilista) |

### 15.9 Para o contabilista e o jurista (não bloqueiam o código; bloqueiam a produção)

- Se os 10 anos valem também para a cópia de onde se emitiu
  (`perfil_copia`) e para o PDF guardado (V10 do `docs/29`).
- Se uma encomenda não paga precisa de guardar o NIF (Q2).
- O prazo das sessões abandonadas (7 dias).
- Se uma encomenda por acabar justifica que o apagamento fique completo
  depois do mês do art. 12.º, n.º 3, do RGPD («no prazo de um mês»,
  prorrogável até dois meses com aviso ao titular dentro do primeiro mês —
  **W · texto lido**, EUR-Lex, 11/10/2026). A proposta: a resposta no mês
  diz o que se limpou e o que espera pelo fim da encomenda, e porquê.

### 15.10 Em código

**Parte 1 — o apagamento nos outros domínios** (migração 0072; Diogo,
11/10/2026: *«aprovado, junta o #369 e avança com o código»*):

| O quê | Onde |
|---|---|
| os gatilhos de `encomenda`, `expedicao`, `aviso_pagamento`, `pedido_livre_resolucao`, `devolucao` e `problema` deixam mudar **só** as colunas da §15.2, **só** com a marca da 0049; as transições (`transicao_encomenda`, `transicao_pagamento`) **só** o motivo e **só** para o marcador. A API e o dono sem a marca continuam recusados (testado) | `titular_limpeza_permitida()`, `titular_rasto_so_se_acrescenta()` |
| a limpeza de uma encomenda acabada: contacto, morada de entrega (fica o país), a cópia do perfil só sem nada fiscal (cancelada sem pagamento e sem documento), a prova de entrega, os motivos das transições, o aviso em bruto passa a `{"pseudonimizado": true, "resumo": "<8 hex, chave do rasto>"}` (Q3: sem os campos não pessoais, porque o formato da EuPago não está verificado; o pagamento guarda o montante, a referência e o estado), o pedido de livre resolução fica «sem e-mail» e os textos livres da pós-venda | `titular_limpar_encomenda()` |
| `devolvida_parcial` (14 dias depois da entrega) e `expedida` perdida ou devolvida ao remetente (problema fechado, ou pagamento já não capturado) também acabam, sem nada aberto; `em_disputa` conta como aberto (§15.3; revisão do #374, P1-1, Diogo, 12/10/2026: «a») | `titular_encomenda_acabou()` |
| as encomendas em curso ficam na fila (`titular_pendente`, interna); a tarefa de hora a hora limpa as que acabaram; a lista dos pedidos diz `encomendas_por_acabar` | `titular_pendentes_aplicar()`; `src/clientes/titular-fila.ts` |
| o perfil de faturação só fica com documento ou encomenda que não foi cancelada sem pagamento (Q2) | `cliente_pseudonimizar()` |
| uma livre resolução numa encomenda já limpa guarda «sem e-mail», não o marcador | `src/posvenda/repositorio.ts` |
| a sessão de checkout de cada encomenda limpa fica vazia; o resumo do aviso leva a chave do rasto (0054, 8 hex); os objectos guardam só o que não é pessoal (país, tipo) e limpam o resto; uma encomenda que volte a ficar em curso vai para a fila em vez de falhar o pedido; a tarefa trata cada encomenda à parte e regista as falhas (código, sem dados); a limpeza adiada limpa também o perfil que deixou de servir (revisão do #374) | 0072 |

**Parte 2 — as sessões de checkout por prazo** (§15.4; migração 0077):

| O quê | Onde |
|---|---|
| ao criar a encomenda, a sessão perde o e-mail, o nome, o telefone e as moradas (a encomenda tem a cópia); `GET /checkout/{token}` passa a dar `contacto: null`, e a confirmação continua a ler a encomenda | `concluir()` em `src/checkout/repositorio.ts` |
| 7 dias depois de expirar ou de ser abandonada, contados da mais cedo entre a última mudança e `expira_em` (uma aberta esquecida, 7 dias depois de `expira_em`), a sessão perde os mesmos dados; o estado e o resto ficam; as concluídas antes da 0077 também | `checkout_sessoes_limpar()` (com um índice só das sessões com dados); a tarefa de hora a hora `src/checkout/limpeza-sessoes.ts` (`tarefa:sessoes`), que repete enquanto as voltas vêm cheias |
| desvio ao §15.6: a tarefa escreve só no registo da aplicação (as limpas e as falhas, sem dados) e não avisava se parasse — como a fila do titular | fechado a 13/10/2026: a verificação diária conta o que as duas deviam ter limpo há mais de um dia (§15.11; migração 0088) |
| a limpeza só passa com a marca da 0049, dentro da função do dono; fora dela, o gatilho recusa (`checkout.closed`) | `sessao_checkout_antes_de_gravar()` (0072) |

O prazo de 7 dias é proposta (`docs/25` §7, J3/J4: **C**, jurista).

**Parte 3 — a exportação e as fichas com o mesmo contacto** (§15.2, coluna
«Exportação»; §15.5):

| O quê | Onde |
|---|---|
| a encomenda sai inteira (também os portes, o método de entrega e o de pagamento, as aceitações e a língua) | `exportarCliente()` em `src/clientes/repositorio.ts` |
| as expedições, com a transportadora, o serviço, o seguimento, as datas e a prova de entrega; sem a etiqueta nem as tentativas de a pedir (técnico) | `expedicoes` |
| o histórico de estados da encomenda e do pagamento (de, para, quando, canal), sem o motivo nem quem mudou | `estados_das_encomendas`, `estados_dos_pagamentos` |
| os documentos fiscais: tipo, estado, o comprador e os totais da última versão do conteúdo e, emitido, o número, a série, a data, o ATCUD, os totais e o comprador lidos do documento (`comprador_no_documento`); emitido fora do Eurolify, o número declarado (`numero_declarado`, 0070); sem o PDF nem a resposta em bruto (Q4); o rasto (com o motivo das correcções) não sai | `documentos_fiscais` |
| a livre resolução (contacto, confirmação, prazo, estado, motivo da decisão), as devoluções com as linhas, os problemas com a descrição, os reembolsos (montante, via, estado, datas) sem a prova nem a falha técnica | `pedidos_de_livre_resolucao`, `devolucoes`, `linhas_das_devolucoes`, `problemas`, `reembolsos` |
| as linhas da livre resolução (que artigos a pessoa quis devolver), as linhas de cada reembolso (com os portes, sem artigo), a decisão de higiene de cada linha devolvida e o seguimento da transportadora (o estado que ela deu, o normalizado e a data; sem o id do evento dela nem o aviso em bruto) | `linhas_da_livre_resolucao`, `linhas_dos_reembolsos`, `linhas_das_devolucoes.decisao_higiene`, `seguimento_das_expedicoes` |
| não saem a sessão de checkout, os avisos dos prestadores nem os eventos de saída | — |
| os índices das procuras da exportação: as encomendas pela ficha, a pós-venda e os documentos pela encomenda (revisão do #411, P2-3) | migração 0082 |
| a exportação e o apagamento listam as outras fichas do comerciante, fora do grupo, com um e-mail (sem distinguir maiúsculas, como os candidatos a duplicado) ou um telefone igual: só o id, o estado e o sinal, nunca o contacto; é para o dono, não para entregar ao titular (um telefone partilhado pode ser de outra pessoa). Não se juntam: decide o dono se as funde e repete o pedido. No apagamento contam-se antes de apagar, com a ficha presa, na mesma transacção | `fichasComOMesmoContacto()`; `fichas_com_o_mesmo_contacto` nas duas respostas |

Testes, com contraprova (cada um falha com a protecção tirada): a
exportação de uma encomenda paga, com fatura, expedição, problema com
reembolso transferido e livre resolução, traz tudo isto e não traz o motivo
das transições, a prova do reembolso, o PDF, os avisos nem a sessão; uma
fatura emitida fora dá o número declarado e não o motivo do rasto
(`posvenda-api.test.ts`); as fichas com o mesmo e-mail, telefone ou os dois
aparecem na exportação e no apagamento, as do grupo, as já apagadas e as de
outro comerciante não, e ficam como estavam (`clientes-titular.test.ts`).

As linhas da livre resolução e do reembolso, a decisão de higiene de uma
linha devolvida e o seguimento da transportadora passam também a sair
(`linhas_da_livre_resolucao`, `linhas_dos_reembolsos`,
`linhas_das_devolucoes.decisao_higiene`, `seguimento_das_expedicoes`;
revisão do #411, P3-2; Diogo, 13/10/2026: *«sim, avança com os quatro num
pedido à parte»*), com teste e contraprova de cada um. O texto da
transportadora, como a prova de entrega, pode ter o nome de outra pessoa
(quem recebeu): o RGPD, art. 15.º, n.º 4, diz que a cópia «não prejudica
os direitos e as liberdades de terceiros» (`eur-lex`, `corpus/dados-e-privacidade/32016R0679-rgpd.md`, versão de 2016-05-04) — **C**, para o jurista (revisão
do #414, P3-6). Um evento ou um aviso da transportadora que chegue depois do
apagamento (ou durante), numa encomenda já limpa, entra com o marcador; um
aviso que não se ligue a nenhuma expedição fica em bruto até ao resumo dos
30 dias (migração 0083; revisão do #414, P3-1, e do #420; `docs/36`).

Fica de fora, da revisão do #411: a lista das fichas parecidas só se vê antes do apagamento pela
exportação (P3-3); a exportação lê em READ COMMITTED, dentro da transacção
da idempotência (P3-5).


### 15.11 O aviso quando as duas tarefas param (desenho de 13/10/2026)

Pedido do Diogo, 13/10/2026 (*«A»*, à pergunta «pego nos avisos dessas duas
tarefas automáticas?»). Fecha o desvio ao §15.6 que ficou na §15.10: a fila
do titular (`src/clientes/titular-fila.ts`) e a limpeza das sessões de
checkout (`src/checkout/limpeza-sessoes.ts`) correm de hora a hora dentro da
API e, se pararem ou falharem sempre, só o registo da aplicação o diz —
ninguém o lê. Ex.: a API arranca sem a tarefa por um erro de configuração;
a Ana pediu o apagamento e a encomenda dela acabou há uma semana, mas o
contacto e a morada continuam lá, e ninguém sabe. Lição dos sistemas
actuais: o recálculo diário esteve parado 15 dias sem ninguém saber
(`docs/11` §3.8). Skill: `observability-security` («tarefas automáticas que
não param em silêncio»).

**O que já existe e se segue** (lido a 13/10/2026): a verificação diária da
VPS (`infra/vps/ficheiros/sbin/eurolify-verificacao`, 07:00, ADR-0027) já
confere duas tarefas pelo **efeito na base**, não por um sinal da tarefa: a
limpeza dos prazos das contas (`contas_prazos_em_atraso()`) e a dos
ficheiros sem uso (`ficheiros_sem_uso_em_atraso()`, 0035). Cada função conta
o que já devia ter sido feito há mais de um dia; com mais de zero, a
verificação avisa o Diogo pelo Healthchecks.io, com a frase do problema.

| # | O quê | Proposta | Porquê |
|---|---|---|---|
| T1 | **Como se vê que parou** | pelo efeito, como as outras duas: o que a tarefa já devia ter limpo e continua lá | apanha a tarefa parada, a que falha sempre e a que nunca arrancou, sem a tarefa ter de dizer nada |
| T2 | **A fila do titular** | `titular_pendentes_em_atraso()`: as linhas por aplicar há mais de **1 dia** (`criado_em`) cuja encomenda já acabou (`titular_encomenda_acabou`, a mesma regra da tarefa). A encomenda não guarda quando mudou de estado, por isso conta-se pela idade da linha | a tarefa corre de hora a hora; um dia é folga para uma volta que falhou por acaso |
| T3 | **As sessões de checkout** | `checkout_sessoes_em_atraso()`: as sessões que ainda têm dados e que pela regra da §15.4 já deviam estar limpas há mais de **1 dia** (o mesmo critério de `checkout_sessoes_limpar`, com 8 dias em vez de 7) | o mesmo |
| T4 | **O que as funções devolvem** | só uma contagem, de todos os comerciantes, sem dados pessoais nem identificadores; `SECURITY DEFINER`, fechadas a todos e abertas só ao papel da limpeza (`eurolify_limpeza`), como a da 0035 | quem lê é a verificação da máquina, que não entra como a API |
| T5 | **O aviso** | a verificação diária chama as duas; com mais de zero, uma linha no aviso: «N encomenda(s) de pedidos de apagamento por limpar há mais de um dia: a fila do titular (clientes/titular-fila.ts) não está a correr (docker logs eurolify-api)» e o mesmo para as sessões. Sem a função (migração por publicar), não avisa; uma consulta que falhe ou uma resposta que não seja número avisa, **só com a categoria** («a consulta falhou»), nunca a primeira linha do erro do `psql`, que pode trazer valores e agora também sai no `medir` (revisão do #428, P3-3) | o padrão das outras duas, sem a fuga |
| T6 | **Para quem** | o Diogo, como hoje (ADR-0027); na produção, o Diogo e o Bruno (`docs/11` §3.8) | não muda quem recebe |

**Fica de fora:** as outras tarefas da API que correm sozinhas (a fila do
VIES, os pagamentos, os documentos, os avisos de prazo e de tarefas, as
notificações, os envios; 14 ao todo em `servidor.ts`) também não avisam se
pararem. Ficam para outro pedido, uma a uma, com o mesmo padrão, se o Diogo
ou o Bruno o pedirem. **Por onde pode sair errado:** um aviso falso quando
uma encomenda que estava na fila há mais de um dia acaba na hora antes das
07:00 e a tarefa ainda não teve a volta seguinte (ex.: a encomenda da Ana,
na fila desde 2/10, passa a concluída às 06:40) — no dia seguinte já não
aparece. A janela é de até duas horas antes das 07:00 (a encomenda muda a
qualquer hora e a tarefa corre de hora a hora; revisão do #433, P2-3), e
vale para cada encomenda da fila que acabe nela: com muitas, o aviso falso
fica mais provável. **Como ler o aviso:** um número que aparece num dia e
desaparece no seguinte não é a tarefa parada; o que repete dois dias seguidos
é. Se os avisos falsos se tornarem frequentes, a correcção é contar desde que
a encomenda acabou, e isso volta ao Diogo ou ao Bruno.

**Decidido:** Q-T1, aprovado pelo Diogo a 13/10/2026 (*«A»*), com **1 dia**
de folga e o aviso pela verificação diária das 07:00.

**Em código** (13/10/2026, issue #233):

| O quê | Onde |
|---|---|
| T2 e T3: as duas contagens, cada comerciante no contexto dele só durante a contagem (a `encomenda` e a `sessao_checkout` têm o RLS forçado também para o dono); `SECURITY DEFINER`, fechadas a todos e abertas só ao `eurolify_limpeza` | migração `0088_tarefas_em_atraso.sql` |
| T5: as duas linhas do aviso; uma falha só com a categoria | `infra/vps/ficheiros/sbin/eurolify-verificacao` (`em_atraso`) |
| testes: a fila acabada há dois dias conta e deixa de contar depois da tarefa; a encomenda em curso não conta; as sessões de 9 dias e a concluída com dados há dois dias contam, a de 7 dias e meio não; a API não as chama; falham sem o contexto por comerciante | `apps/api/test/checkout-api.test.ts` |
| o aviso, a função por publicar, a falha sem a linha do erro e a resposta que não é número | `infra/vps/testes/verificacao.sh` (falha se a linha do erro do `psql` voltar ao aviso) |

Não verificado: o tempo das duas contagens com muitos comerciantes e sessões
(uma consulta por comerciante, sem `EXPLAIN`); o aviso a sério só se vê na
VPS depois da publicação.

### 15.12 Os perfis guardados por obrigação fiscal, só para o dono (desenho de 13/10/2026)

Decisão do Diogo, 13/10/2026 (*«A»*; `docs/06` EM), ao P3-6 que ficou na
§15.10 («Fica por fazer»): depois de um pedido de apagamento, **só quem tem
`customers:billing` (o dono)** lê o nome, o NIF e a morada dos perfis que
ficam por obrigação fiscal. O gestor e o apoio (`customers:read`) vêem que o
perfil existe e que está guardado, sem esses dados. Ex.: a Ana pede o
apagamento; o perfil da fatura dela fica; o apoio vê «perfil guardado por
obrigação fiscal», sem o NIF nem a morada.

**Fonte:** RGPD, art. 25.º, n.º 2 (por defeito, só os dados necessários a
cada finalidade, também na «acessibilidade»), e art. 17.º, n.º 3, alínea b)
(guardar para cumprir uma obrigação legal) — `eur-lex`
`corpus/dados-e-privacidade/32016R0679-rgpd.md`, versão consolidada
02016R0679-20160504, obtido_em 2026-10-12. Que o gestor e o apoio deixem de
precisar destes dados depois do pedido é leitura nossa: **C**, jurista.

**Como se reconhece:** um perfil cuja ficha, ou a ficha em que ela foi
fundida (subindo por `fundido_em`), está `pseudonimizado`. Não há coluna
nova: a pseudonimização já deixa a ficha assim (0072). O campo
`guardado_por_obrigacao_fiscal` diz que a ficha foi pseudonimizada: vem
`true` em todos os perfis dela, também nos que não ficaram (esses já estão
com «Pseudonimizado» e sem dados; a quem não é dono saem com `null` em vez
de «Pseudonimizado»; revisão do #440, P3-2).

**Os sítios por onde se lêem** (procurados a 13/10/2026 nas rotas de
`clientes/`, `iva/`, `checkout/`, `faturacao/` e `identidade/hub-*`, por
`perfil_faturacao`, `nif_escrito`, `nome_documento`, `morada_linha`,
`perfil_copia` e `alteracao_cliente`):

| # | Rota | Âmbito hoje | Sem `customers:billing`, num perfil guardado |
|---|---|---|---|
| G1 | `GET /customers/{id}/billing-profiles` e `GET /billing-profiles/{id}` | `customers:read` | `nome_documento`, `nif`, `nif_escrito`, `pais_contribuinte` e `morada` a `null`; o campo novo `guardado_por_obrigacao_fiscal: true` diz porquê (para o dono também, com os dados) |
| G2 | `GET /billing-profiles/{id}/vies-checks` | `customers:read` | `pais_consultado`, `numero_consultado`, `nome_devolvido` e `morada_devolvida` a `null` (a prova do VIES traz o NIF, e o nome e a morada que o VIES respondeu) |
| G3 | `GET /billing-profiles/{id}/exemptions`, e a resposta de pôr e retirar a isenção (`PUT` e `DELETE /billing-profiles/{id}/exemption`, `customers:exemptions`) | `customers:read` | `nota` a `null`, e `motivo` e `motivo_retirada` (quando há) com «(reservado)»: são texto livre que pode falar da pessoa |
| G4 | `GET /exemptions/{id}/attachments` e os bytes (`GET /exemptions/{id}/attachments/{anexo}`, `customers:exemptions`) | `customers:read` | o `nome` do ficheiro com «(reservado)» (pode ter o nome da pessoa); os bytes dão 403 `auth.forbidden` (o documento é da pessoa) |
| G5 | `POST /customers/search` com `nif` | `customers:read` | as fichas pseudonimizadas não aparecem: a resposta confirmava que aquele NIF é da pessoa que pediu o apagamento |
| G6 | `POST /tax/decisions/simulate` com `perfil` | `tax:read` e `customers:read` | 403 `auth.forbidden` (a decisão devolve o país e o número do NIF do perfil) |

**Fica como está, e porquê:**
- **a linha do tempo** (`GET /customers/{id}/timeline`): os campos do perfil
  já só guardam o marcador, nunca o valor (0054);
- **a exportação do titular** (`customers:privacy`): só o dono;
- **a cópia na encomenda** (`perfil_copia`, `GET /orders/{id}`, `orders:read`),
  **o documento fiscal** (`GET /invoices/{id}` e o PDF, `invoices:read`) e
  **o relatório OSS** (`tax:read`): são as cópias de onde se emite e se
  declara, e quem trata das encomendas e das faturas precisa delas. Não são
  o perfil; restringi-las é outra decisão, que fica em aberto;
- **o dono** lê tudo, como hoje.

**Atenção (revisão do #440, P2-1):** esta regra fecha os perfis e o que se
pendura neles (`clientes/` e a simulação do `iva/`). A cópia na encomenda
fecha-se na §15.13; a fatura e o relatório OSS ficam (§15.13).

**Por onde pode sair errado:** uma rota nova que leia perfis sem passar pela
mesma função; por isso a regra vive num só sítio em `clientes/` e o teste
percorre as seis rotas com uma chave sem `customers:billing`.

### 15.13 A cópia fiscal da encomenda, só para o dono (desenho de 13/10/2026)

Decisão do Diogo, 13/10/2026 (*«A»*; `docs/06` EN), ao que ficou de fora
na §15.12: depois de um pedido de apagamento, **a cópia do perfil de
faturação na encomenda** (`perfil_copia`: nome, NIF e morada fiscal) só sai
a quem tem `customers:billing` (o dono). Ex.: a Rita pediu o apagamento; o
apoio abre a encomenda dela de março e vê as linhas, os totais, o estado e a
entrega, mas `perfil_copia: null` e `guardado_por_obrigacao_fiscal: true`.

| Onde | Sem `customers:billing`, numa ficha pseudonimizada |
|---|---|
| `GET /orders/{id}` (`orders:read`) | `perfil_copia: null`; o campo novo `guardado_por_obrigacao_fiscal` diz porquê (para o dono também, com a cópia) |
| `GET /checkout/{token}/confirmation` (público, pelo token) | `perfil_copia: null` (quem tem o token não tem âmbito) |

- **A mesma regra** da §15.12 (`fichaPseudonimizada`), lida em
  `lerEncomenda`; `GET /orders` em lista não traz a cópia.
- **Fica como está:** o contacto e a entrega (a encomenda em curso precisa
  deles para entregar; a acabada já os tem limpos, §15.10); a emissão do
  documento fiscal, que lê a cópia no servidor; **a fatura, o PDF e o
  relatório OSS** (`invoices:read`, `tax:read`): são os documentos fiscais
  que se entregam e se declaram (Diogo, 13/10/2026, «A»).
- **Fonte:** a mesma da §15.12 (RGPD, art. 25.º, n.º 2); **C**, jurista.
