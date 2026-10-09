# Domínio Clientes e identidade fiscal — modelo e lista da API

> **Estado: desenho aprovado; parte 1 no código** (issue #233; `docs/06`,
> CX). Diogo, 09/10/2026: *«sim, avança com o desenho da fatia 5»* e *«sim,
> aprovo; avança com o código da fatia 5»* (as cinco respostas da §9 como
> propostas). É a fatia 5 do
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
