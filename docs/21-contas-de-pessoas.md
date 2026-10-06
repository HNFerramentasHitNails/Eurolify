# Contas de pessoas (identidade, parte B) — desenho antes do código

> **Versão de 06/10/2026 — desenho aprovado** (Diogo, 06/10/2026: *«sim,
> aprovo; junta o #138 e começa o código»*)**; as quatro perguntas da §10
> decididas (CA a CD do `docs/06`); revisto depois da revisão do agente
> publicada no #138 (2 P0, 9 P1).** Pedido do Diogo: *«sim, avança com a a)»*
> (a parte B da identidade, antes do código). Cumpre as consequências do
> [ADR-0036](adr/0036-contas-de-pessoas-construidas-na-api.md): a escolha das
> bibliotecas, o tratamento dos dados pessoais e a recuperação de uma conta,
> **escritos antes do código**. Parte do [`docs/19`](19-fatia-identidade.md)
> §7 e §8 (issue #107). Skills: `observability-security`, `eu-gdpr-privacy`,
> `headless-commerce`.
>
> **Decidido:** contas construídas na API, com bibliotecas abertas; passkeys
> primeiro e TOTP como alternativa; revisão de segurança própria antes de
> juntar (ADR-0036); autenticação recente para criar uma chave pelo Hub (BA);
> sem passkey, e-mail + palavra-passe + TOTP (CA); convites sem e-mail na Fase
> 1 (CB); sem fornecedor OIDC até haver aplicações de terceiros (CC); os
> prazos das sessões e das contas (CD). O resto é **proposta** deste desenho.

## 1. O que a parte B dá

| Precisa | Como |
|---|---|
| Uma pessoa entra no Hub | passkey; em alternativa, e-mail + palavra-passe + TOTP (CA) |
| Uma pessoa trabalha para um ou mais comerciantes | `membro`: pessoa × comerciante × papel; o pedido diz para que comerciante é (§4.6) |
| Papéis | dono, gestor, armazém, apoio (`observability-security`, «Permissões em quatro camadas»), com os âmbitos da §5 |
| Convidar e retirar alguém da equipa | convite de uso único (CB); retirar desliga as sessões e as chaves dessa pessoa nesse comerciante (§4.4) |
| Perder o telemóvel | recuperação da §7 |
| Saber quem fez o quê | `quem` passa a `pessoa:per_<id>` (`docs/19` §5), no rasto que já existe |

**Fora da parte B:** o login dos clientes das lojas (é da Loja); a entrada
única com o sistema de um cliente (ADR-0036, opção b)); aplicações de
terceiros em nome de uma pessoa (CC).

**Ensaio:** até à migração para a UE (ADR-0018 e ADR-0019), as contas na VPS
do ensaio só têm **e-mails e nomes fictícios** — também os do Diogo e do Bruno
(`AGENTS.md`, «Regras da UE», 4).

## 2. Bibliotecas

Lidas no registo do npm (`registry.npmjs.org`) a 06/10/2026: a versão
`latest`, a licença dela e a data em que saiu. O código **não foi lido**.

| Para quê | Biblioteca | Versão · data | Licença | Proposta |
|---|---|---|---|---|
| Passkeys (WebAuthn) | `@simplewebauthn/server` | 14.0.3 · 25/09/2026 | MIT | **usar** |
| TOTP (RFC 6238) | `otplib` | 13.5.0 · 21/08/2026 | MIT | **usar** |
| Resumo da palavra-passe (CA) | `@node-rs/argon2` (Argon2id) | 2.2.2 · 06/10/2026 | MIT | **usar** |
| Cookie da sessão | `@fastify/cookie` | 11.1.2 · 15/07/2026 | MIT | **usar** (a API é Fastify 5.12.5) |
| Fornecedor OIDC | `oidc-provider` | 9.12.2 · 05/09/2026 | MIT | **não agora**: só com aplicações de terceiros (CC) |
| Tudo feito | `better-auth` | 1.7.7 · 30/09/2026 | MIT | **não**: traz as suas tabelas e sessões, fora das funções da base, do RLS e do rasto (`docs/19` §3) |
| — | `@oslojs/otp` | 1.1.0 · 11/12/2024 | MIT | **não**: descontinuada no npm |

**Por verificar antes do código:** o código, os avisos de segurança e quem
mantém cada biblioteca, e a actividade do projecto (ADR-0036).

## 3. Onde vivem o Hub e a sessão

- **O Hub e a API no mesmo anfitrião** (proposta; o anfitrião escolhe-se
  quando o Hub for publicado). Se tiverem de ficar separados, o CORS da API
  aceita **só a origem exacta do Hub**, com credenciais. O Hub não vive num
  construtor de frontends de fora (o cookie não lhe chegaria).
- **A sessão** é uma linha na base com o **resumo** de um segredo aleatório de
  256 bits, como as chaves (`docs/19` §3). O cookie leva o segredo: prefixo
  `__Host-` (só aquele anfitrião, sem `Domain`, `Path=/`), `Secure`,
  `HttpOnly`, `SameSite=Strict`.
- **Contra pedidos forjados (CSRF):** toda a escrita exige o cabeçalho
  `Origin` igual ao do Hub e `Content-Type: application/json`; **nenhuma
  acção com efeitos por GET** (abrir a ligação de um convite só mostra a
  página; aceitar é um POST depois da passkey).
- **O segredo da sessão muda** ao entrar e ao fazer a autenticação recente
  (fixação de sessão).
- **WebAuthn:** o identificador do domínio (`rpID`) é o **anfitrião do Hub**,
  não `eurolify.eu`; `userVerification: required`; credenciais detectáveis
  (entrar com a passkey sem escrever o e-mail, para não revelar contas pela
  lista de credenciais).

## 4. Modelo e fluxos

### 4.1 Tabelas (proposta)

Duas espécies: **estado** (muda, apaga-se ou pseudonimiza-se pelos prazos da
§6) e **rasto** (só se acrescenta, como o da 0008).

| Tabela | Espécie | Campos principais | Notas |
|---|---|---|---|
| `pessoa` | estado | id (`per_`), e-mail (único sem distinguir maiúsculas; **não confirmado**), nome, estado (activa, desactivada) | sem comerciante: uma pessoa pode trabalhar para vários |
| `membro` | estado | pessoa, comerciante, papel, desde, até, quem convidou | RLS por comerciante; cada comerciante tem sempre **um dono activo**, de uma pessoa activa |
| `passkey` | estado | pessoa, id da credencial, chave pública, contador, nome do dispositivo, criada_em, último uso | a chave privada nunca sai do dispositivo |
| `palavra_passe` | estado | pessoa, resumo Argon2id, mudada_em | só entra com o TOTP (CA) |
| `segundo_factor` | estado | pessoa, segredo TOTP **cifrado**, último passo de tempo aceite, activo desde | um por pessoa; o mesmo código não vale duas vezes |
| `codigo_recuperacao` | estado | pessoa, resumo, usado_em | 10 por pessoa (§7) |
| `convite` | estado | comerciante, e-mail, papel, resumo do segredo, expira_em, aceite_em, cancelado_em, quem convidou | uso único; o dono vê os pendentes e cancela-os |
| `sessao` | estado | pessoa, resumo do segredo, criada_em, último uso, autenticação recente em, revogada_em | 12 h sem uso e no máximo 30 dias (CD) |
| `entrada` | estado | conta (ou o **resumo** do e-mail tentado, se não houver conta), quando, resultado, IP | segurança; 14 dias (§6) |
| `evento_conta` | rasto | pessoa, comerciante (se houver), acto (convidou, aceitou, mudou papel, recuperou…), quem, quando | só se acrescenta |

**Acesso:** as tabelas sem comerciante (`pessoa`, `passkey`,
`palavra_passe`, `segundo_factor`, `codigo_recuperacao`, `sessao`,
`entrada`) **não dão nenhum privilégio à API**: só funções da base
`SECURITY DEFINER`, com o `search_path` fixo, como as das chaves (T7).

### 4.2 Criar a conta e aceitar um convite

1. Um **dono** convida com qualquer papel; um **gestor** só com um papel
   abaixo do seu (armazém, apoio). **O papel dono só o dá um dono.** Imposto
   na base.
2. O dono copia a ligação e envia-a (CB). A ligação vale **uma vez** e expira
   (7 dias, proposta).
3. **E-mail que ainda não tem conta:** quem abre cria a passkey — obrigatória
   — e, se quiser a alternativa, a palavra-passe **e** o TOTP juntos. Recebe os
   10 códigos de recuperação.
4. **E-mail que já tem conta:** o convite **só se aceita autenticado como essa
   pessoa**, com uma credencial que ela já tem. **Um convite nunca acrescenta
   uma credencial a uma conta que já existe.** A página do convite é igual nos
   dois casos (não revela a quem convida que a conta existe).
5. Aceitar é um POST depois da autenticação; dois aceites ao mesmo tempo do
   mesmo convite: só um passa (tranca).

### 4.3 Entrar e autenticação recente

- Passkey; ou e-mail + palavra-passe + TOTP. **A palavra-passe sozinha nunca
  entra.**
- **Autenticação recente** (BA): para criar uma chave de API, mudar papéis,
  mudar dados fiscais ou credenciais, a sessão tem de ter feito passkey ou
  palavra-passe + TOTP há **menos de 10 minutos** (proposta).

### 4.4 Sair da equipa

O dono termina o `membro`. No pedido seguinte:
- as sessões dessa pessoa deixam de valer **nesse comerciante** (continuam
  noutro onde trabalhe);
- as **chaves de API que ela criou nesse comerciante** (`criada_por =
  pessoa:per_…`) ficam **revogadas por omissão** (`observability-security`:
  «quem sai continua a entrar»); o dono pode criar outras.

Dois donos que se retiram ao mesmo tempo não deixam o comerciante sem dono
(tranca por comerciante, como no T11).

Cada pessoa também sai por si; tirar **outro** é só do dono, com
autenticação recente (proposta, B1). As chaves criadas **por uma chave** que
a pessoa criou (`criada_por = chave:key_…`) **não** se revogam em cadeia: o
dono vê-as na lista e revoga-as (proposta, B1; a rever com o Hub).

### 4.5 Mudar de papel e desactivar uma pessoa

- Só um dono muda papéis; ninguém muda o seu próprio. Vale no pedido seguinte.
- Desactivar uma `pessoa` (o operador, ou ela própria): todas as sessões
  caem; recusa-se se ela for o **último dono activo** de algum comerciante.

### 4.6 Para que comerciante é o pedido

A sessão é da pessoa; o comerciante vem do cabeçalho `Eurolify-Comerciante:
mer_…`, escolhido no Hub. A função `sessao_resolver(segredo, comerciante)`
devolve o papel **só se houver um `membro` activo**; sem ele, 403. Nunca do
corpo nem do caminho (`docs/19` §5). As regras do comerciante `suspenso` ou
`fechado` (AZ, P2-3) valem igual para as sessões.

### 4.7 O que a parte B1 do código acrescentou (propostas)

Escolhas do código da base (migração `0018`, issue #140) que o desenho não
dizia; ficam como **proposta** até o Diogo ou o Bruno as mudarem:

- **Convidar exige autenticação recente** (10 minutos), como mudar papéis:
  dar um papel é dar acesso. Cancelar um convite e sair por si, não.
- **Só um dono cancela convites** (§4.1: «o dono vê os pendentes e
  cancela-os»).
- Um convite com resposta única para «não existe», «já usado», «cancelado»
  e «expirado» (`invite.invalid`): quem tem uma ligação velha não aprende
  nada. Um e-mail com conta recusa a criação de outra conta
  (`invite.account_exists`): só o vê quem tem a ligação.
- Comerciante `suspenso` ou `fechado` (AZ): não convida, não muda papéis e
  não aceita convites; tirar alguém da equipa continua (fecha acessos, como
  revogar chaves).
- Uma pessoa desactivada não volta; o e-mail de uma pessoa não muda. Nada
  nestas tabelas se apaga até a tarefa dos prazos (B4).
- **Quem perde poderes perde o que abriu** (revisão do #141, P1-1, P2-3):
  ao sair da equipa ou ser desactivado, os convites em aberto que criou
  são cancelados e as chaves que criou são revogadas; ao mudar de papel, só
  os convites que o papel novo já não dá e as chaves com âmbitos que o papel
  novo não tem. Aceitar um convite volta a confirmar que quem o criou ainda
  pode dar aquele papel.
- **Desactivar uma pessoa tira-a de todas as equipas** (excepto se for o
  último dono, que recusa). Desactivar-se a si própria entra com as rotas
  (B2); nesta parte só o operador desactiva.
- **Aceitar um convite autenticado exige autenticação recente** (10
  minutos), como dar um papel.
- As trancas tomam-se sempre pela mesma ordem: a dos membros do comerciante
  e depois a das chaves. Criar uma chave a partir de uma sessão (B2) tem de
  tomar a dos membros e confirmar o membro dentro dela (revisão do #141,
  P2-4).
- `sessao_resolver` distingue a sessão inválida (`auth.unauthenticated`,
  401) de não ser membro do comerciante (`auth.forbidden`, 403).
- **Rede temporária, com data de fim** (Diogo, 06/10/2026: *«sim,
  concordo, fica a a)»*; CE; revisão do #141, P2-1): o e-mail de um
  convite não é confirmado e, com a CB, quem convida tem a ligação — pode
  abri-la ele próprio, ficar com a conta desse e-mail e saber se o e-mail
  já tem conta. Aceite **até ao primeiro comerciante real ou 31/03/2027, o
  que chegar primeiro**; antes disso entra a protecção (e-mail confirmado
  ou convites enviados por e-mail).
- **Por resolver** (revisão do #141): uma pessoa desactivada fica com o
  e-mail preso — um convite novo para ele dá `invite.account_exists` e não
  há sessão que o aceite (P2-2). O caminho entra com a recuperação pelo
  operador (§7, ponto 5; parte B3). E o e-mail de um convite não se pode
  apagar enquanto o rasto apontar para o convite: na B4 pseudonimiza-se
  (§6; P3-8).

## 5. Papéis e âmbitos (proposta)

A sessão traz o papel; a base traduz-o nos âmbitos do `docs/19` §4, que as
rotas já conferem.

| Papel | Âmbitos | Notas |
|---|---|---|
| dono | todos, incluindo `keys:write` e mudar papéis | pelo menos um activo |
| gestor | `merchant:read`, `catalog:*` | não muda papéis, não cria chaves, não muda dados fiscais |
| armazém | `catalog:read` (e os de stock e expedição, quando existirem) | sem preços de custo nem margens |
| apoio | `merchant:read`, `catalog:read` (e os de encomendas e clientes, quando existirem) | sem preços de custo |

A camada «campos» da skill (ex.: o preço de custo só para dono e gestor)
desenha-se com cada domínio que tiver campos assim.

## 6. Dados pessoais (`eu-gdpr-privacy`)

O Eurolify é **responsável** por estes tratamentos (as contas são dele, não do
comerciante). Entram no registo de tratamentos do
[`docs/17`](17-dados-pessoais-e-incidentes.md) §1 como T8 **com o código**.
**Bases legais e prazos legais são todos C** (não verifiquei): a base da
primeira linha pode ser antes o interesse legítimo, porque a pessoa é
trabalhadora do comerciante e não parte do contrato — **para o jurista**.

| Dado | Para quê | Base legal (C) | Prazo | No fim |
|---|---|---|---|---|
| E-mail e nome | entrar, ser convidado, saber quem fez o quê | execução do contrato com o comerciante, ou interesse legítimo (jurista) | enquanto houver um `membro` activo; depois, **90 dias** (CD) | pseudonimizar |
| `membro` (onde trabalha, papel, desde, até, quem convidou) | permissões e prova | idem | o da pessoa | pseudonimizar com ela |
| E-mail de um convite | convidar | idem | até ser aceite, cancelado ou expirar, e mais 30 dias (proposta) | apagar |
| Passkey: chave pública, nome do dispositivo, último uso | entrar | idem | enquanto a passkey existir | apagar |
| Palavra-passe (resumo) e data da mudança | entrar (com o TOTP) | idem | enquanto houver conta | apagar |
| Segredo TOTP (cifrado), último passo | entrar | idem | enquanto estiver activo | apagar |
| Resumos dos códigos de recuperação | recuperar | idem | até serem usados ou trocados | apagar |
| Sessões (datas, último uso) | manter a pessoa dentro | idem | 30 dias depois de acabarem (proposta) | apagar |
| Registo de entradas, com IP; e-mail tentado só em resumo | segurança | interesse legítimo (segurança) | **14 dias** na base; com as cópias de 14 dias, **até ~28 dias** | apagar |
| Rasto (`evento_conta`, `quem = pessoa:per_<id>`) | provar quem fez cada acto | interesse legítimo / prova | o do registo a que pertence (**C**) | fica pseudonimizado |

- **Uma tarefa diária** aplica os prazos (como o `eurolify-limpeza`, 0013),
  regista o que fez e a verificação das 07:00 avisa se parar.
- **IP:** o `docs/18` §6 manda contar os limites por chave e não por IP. Na
  entrada ainda não há chave: conta-se **por conta**, e o IP só fica no
  registo de entradas, com o prazo acima. **Nem e-mail nem IP** nos registos
  da aplicação.
- **Pedidos dos titulares:** a pessoa exporta e apaga os seus dados de conta;
  o rasto de um comerciante pseudonimiza-se, não se apaga.

## 7. Recuperar uma conta

Qualquer recuperação **revoga todas as sessões** da pessoa e deixa um aviso
no Hub; o mesmo ao mudar a palavra-passe ou retirar uma passkey. O Hub mostra
as sessões abertas, com «terminar todas». Pela ordem:

1. **Outra passkey** da mesma pessoa (o Hub pede para registar duas).
2. **Palavra-passe + TOTP** (CA), se a pessoa os activou.
3. **Um código de recuperação:** 10, mostrados uma vez; cada um com pelo
   menos 80 bits de aleatoriedade (proposta), guardado só em resumo; vale uma
   vez e **obriga a registar uma passkey nova**; tentativas limitadas (§8).
4. **Outro dono do mesmo comerciante:** **não recupera a conta.** Termina o
   `membro` da pessoa nesse comerciante e convida-a outra vez; se ela já tiver
   conta, aplica-se a §4.2, ponto 4 (só autenticada). Nunca chega aos outros
   comerciantes dela.
5. **O operador** (Diogo ou Bruno, pelo fluxo `operar`), em último recurso:
   - com **prova escrita do representante legal da entidade legal** do
     comerciante, conferida pela positiva (proposta; como se confere: **C**,
     para o jurista), e **nunca decidindo pela pessoa pelo nome**
     (`AGENTS.md`, «Não se erra em documentos fiscais», 6);
   - o segredo do convite gera-se **no computador do operador** e só o
     resumo passa pelo fluxo (como o `gerar-chave.mjs`, `docs/19` §6);
   - fica no rasto; numa memória, só o resumo do acto, **sem dados pessoais**
     (`docs/17` §5).

Um comerciante com um só dono que perdeu tudo cai no ponto 5: o Hub recomenda
dois donos.

## 8. Segurança (`observability-security`)

- **Tentativas:** limite por conta para a palavra-passe, o TOTP e os códigos
  de recuperação, com bloqueio temporário (proposta: 5 falhas → 15 minutos;
  valores a medir); TOTP com no máximo ±1 janela de 30 s e o último passo
  aceite guardado.
- **Enumeração:** a mesma resposta **e o mesmo tempo** para «não existe» e
  «falhou» (calcula-se um Argon2id falso quando o e-mail não existe); passkey
  sem escrever o e-mail (§3).
- **Palavra-passe:** Argon2id com parâmetros a fixar com medições na VPS, não
  abaixo dos de uma fonte reconhecida, **a ler antes do código**; mínimo de 12
  caracteres e recusa das muito comuns (proposta).
- **Segredo TOTP:** cifrado com uma chave que **não vive na base** (segredo
  do ambiente, como as outras chaves da VPS; ADR-0028), com troca planeada.
- **Escalada:** só um dono dá papéis; um gestor não convida acima dele;
  ninguém muda o seu papel (o incidente de 28/08/2026 da skill: «qualquer
  conta dava-se admin a si própria»).
- **Revisão de segurança própria** antes de juntar (ADR-0036, ponto 3).

## 9. Testes que o código tem de trazer

| # | Teste |
|---|---|
| P-T1 | sem sessão → 401; sessão revogada, expirada (12 h, 30 dias) ou de pessoa desactivada → 401 |
| P-T2 | a pessoa só vê os comerciantes de que é membro; com A e B, depois de sair de A, nada de A |
| P-T3 | cada papel tenta o que não pode (§5) e falha |
| P-T4 | um gestor não convida dono nem acima dele; ninguém muda o seu papel; o último dono não sai, também com dois ao mesmo tempo |
| P-T5 | segredos, e-mails e IP nunca nos registos da aplicação; os códigos só na resposta da criação |
| P-T6 | convite e código de recuperação valem uma vez; dois aceites ao mesmo tempo, só um passa; convite expirado ou cancelado não vale |
| P-T7 | sair da equipa desliga as sessões nesse comerciante e revoga as chaves que a pessoa lá criou |
| P-T8 | criar uma chave de API sem autenticação recente → recusado (BA) |
| P-T9 | **um convite para um e-mail com conta não se aceita sem autenticar como essa pessoa** e nunca acrescenta uma credencial (P0-1 da revisão) |
| P-T10 | **a recuperação por outro dono não dá acesso aos outros comerciantes da pessoa** (P0-2 da revisão) |
| P-T11 | a palavra-passe sozinha nunca entra (CA); o mesmo TOTP não vale duas vezes; tentativas a mais bloqueiam |
| P-T12 | CSRF: escrita com `Origin` errado ou sem JSON → recusada; nenhum GET muda nada |
| P-T13 | o segredo da sessão muda ao entrar e na autenticação recente |
| P-T14 | WebAuthn: outra origem, outro `rpID`, contador a recuar ou sem verificação do utilizador → recusado |
| P-T15 | o `eurolify_api` não lê nenhuma das tabelas novas (como o T7) |
| P-T16 | comerciante `suspenso` ou `fechado`: as regras AZ valem para as sessões |
| P-T17 | a tarefa dos prazos (14 e 90 dias) corre, regista e é avisada se parar |
| P-T18 | qualquer recuperação revoga todas as sessões |

## 10. Decisões (Diogo ou Bruno)

| # | Pergunta | Decisão |
|---|---|---|
| P1 | A alternativa à passkey: com que primeiro passo? | ✅ **a) e-mail + palavra-passe (Argon2id) + TOTP** (Diogo, 06/10/2026: *«sim, concordo, fica a a)»*; CA) |
| P2 | Como chegam os convites? | ✅ **b) na Fase 1, sem e-mail**: o dono copia a ligação (Diogo, 06/10/2026: *«sim, concordo, fica a b)»*; CB) |
| P3 | Fornecedor OIDC já, ou só com aplicações de terceiros? | ✅ **b) só com aplicações de terceiros** (Diogo, 06/10/2026: *«sim, concordo, fica a b)»*; CC). O «Já decidido» do `docs/19` e a `headless-commerce` (OAuth 2.1/OIDC na API de Administração) ficam para quando houver terceiros |
| P4 | Prazos das sessões e das contas | ✅ **12 h sem uso; 30 dias no máximo; 90 dias para pseudonimizar** (Diogo, 06/10/2026: *«sim, concordo, aceito os três prazos»*; CD). Sem fonte legal; os 90 dias para o jurista confirmar (C) |

## O que não foi verificado

- O código, os avisos de segurança e a manutenção das bibliotecas da §2.
- As bases legais e os prazos legais da §6 (todos **C**), e como se confere a
  prova do representante legal (§7, ponto 5).
- O anfitrião do Hub e da API (§3): não há nada escrito no repositório.
- Os parâmetros do Argon2id (§8): a fonte ainda não foi lida.
- O comportamento real de `SameSite`, do WebAuthn e do `@fastify/cookie`:
  escrito a partir do que se sabe, sem a documentação lida nesta versão.
