# Domínio Clientes e identidade fiscal — modelo e lista da API

> **Estado: desenho aprovado; parte 1 no código** (issue #233; `docs/06`,
> CX). Diogo, 09/10/2026: *«sim, avança com o desenho da fatia 5»* e *«sim,
> aprovo; avança com o código da fatia 5»* (as cinco respostas da §9 como
> propostas). **Parte 3 (VIES e isenção manual): aprovada e no código, §13**
> (`docs/06`, CY). É a fatia 5 do
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
sem nenhuma ⇒ não; WhatsApp sem fonte ⇒ não; ficha `limitado` ⇒ não. É a
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
- Passam para a ficha que fica: os perfis, as etiquetas, os consentimentos
  (todas as linhas; a régua decide pelo mais recente), e o 2.º e-mail e o 2.º
  telefone **guardados, não perdidos** — regra (`eu-gdpr-privacy`).
- As encomendas e os documentos **não mudam de perfil**: continuam ligados ao
  `bpf_` que tinham, agora dentro da ficha que ficou — **proposta**.
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
| `nota`, `anexos` | os anexos são ficheiros (PDF ou imagem), guardados no mesmo armazenamento das imagens do Catálogo | regra; o armazenamento **proposta** |
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
| `customer.pseudonymized` | apagamento do titular feito | `cus_` — **proposta** (novo; a lista do `docs/02` não o tem) |
| `billing_profile.created`, `billing_profile.updated` | perfil novo ou alterado | `bpf_`, `cus_` — **proposta** (novos) |
| `billing_profile.validated` | consulta ao VIES com resposta `valido` | `bpf_`, `vvc_` |
| `billing_profile.invalidated` | o perfil deixou de ser válido no VIES | `bpf_`, `vvc_` — **proposta** (novo) |
| `consent.changed` | declaração nova | `cus_`, canal, finalidade, o resultado da régua depois da declaração |

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
| Exportação do titular | `GET /customers/{id}/export` | privacy | JSON com tudo deste domínio; os outros domínios juntam o seu quando existirem |
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
- **Apagamento e linha do tempo (P2-4):** a `alteracao_cliente` guarda o
  antes e o depois do nome, e-mails, telefones e NIF, e só se acrescenta. A
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
- **Anexos** (`anexo_isencao`): PDF, JPEG ou PNG, até 10 MB cada, até 5 por
  isenção; no mesmo armazenamento das imagens, numa pasta privada, nunca
  públicos; lêem-se pela API com `customers:exemptions` — proposta. O prazo de
  guarda é o fiscal (**C**, V2).
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
| Anexos | `POST /exemptions/{id}/attachments`, `GET /exemptions/{id}/attachments`, `GET /exemptions/{id}/attachments/{anexo}` | `customers:exemptions` |

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
- **Os anexos da isenção ficam para um pedido à parte**: a pasta das imagens
  tem uma limpeza de ficheiros sem linha (`docs/14` §3.5), e os anexos
  precisam de armazenamento próprio e privado, e das cópias da VPS. O motivo e
  a nota já entram.
- **A consulta pedida** (`POST …/vies-checks`) não espera pelo VIES: põe o
  perfil à frente da fila e responde 202 (revisão do #244, P1-1).
- **A fila vem desligada** até se medir a saída da VPS para a Comissão
  (`VIES_URL`; revisão do #244, P2-5): ligar é um pedido à parte.
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
