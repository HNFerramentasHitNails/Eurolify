# Contas de pessoas (identidade, parte B) — desenho antes do código

> **Versão de 06/10/2026 — desenho, por aprovar.** Pedido do Diogo: *«sim,
> avança com a a)»* (a parte B da identidade, antes do código). Cumpre as
> consequências do [ADR-0036](adr/0036-contas-de-pessoas-construidas-na-api.md):
> a escolha das bibliotecas, o tratamento dos dados pessoais e a recuperação
> de uma conta, **escritos antes do código**. Parte do
> [`docs/19`](19-fatia-identidade.md) §7 e §8 (issue #107). Skills:
> `observability-security` (permissões em quatro camadas, sessões, auditoria),
> `eu-gdpr-privacy` (registo de tratamentos, retenção, apagamento),
> `headless-commerce` (OAuth 2.1/OIDC na API de Administração).
>
> O que está **decidido** (ADR-0036, decisões BA e BC do `docs/06`): contas
> construídas na API, com bibliotecas abertas; **passkeys como forma principal
> de entrar** e o código de autenticação (TOTP) como alternativa; revisão de
> segurança própria antes de juntar; criar uma chave de API pelo Hub pede
> autenticação outra vez. O que está **por decidir** está na §9.

## 1. O que a parte B dá

| Precisa | Como |
|---|---|
| Uma pessoa entra no Hub | passkey; em alternativa, e-mail + palavra-passe + TOTP (§9 P1) |
| Uma pessoa trabalha para um ou mais comerciantes | `membro`: pessoa × comerciante × papel |
| Papéis | dono, gestor, armazém, apoio (`observability-security`, «Permissões em quatro camadas») |
| Convidar e retirar alguém da equipa | convite com prazo; retirar desliga logo as sessões dessa pessoa nesse comerciante |
| Perder o telemóvel | recuperação da §6 |
| Saber quem fez o quê | `quem` passa a `pessoa:per_<id>` (`docs/19` §5), no rasto que já existe |

**Fora da parte B:** o login dos clientes das lojas (é da Loja, outra fatia);
a entrada única com o sistema de um cliente (revê-se com a opção b) do
ADR-0036); aplicações de terceiros que pedem acesso em nome de uma pessoa
(OIDC como fornecedor, §9 P3).

## 2. Bibliotecas

Lidas no registo do npm (`registry.npmjs.org`) a 06/10/2026: a versão
publicada como `latest`, a licença dessa versão e a data em que saiu. O
código **não foi lido**.

| Para quê | Biblioteca | Versão · data | Licença | Proposta |
|---|---|---|---|---|
| Passkeys (WebAuthn): registar e verificar | `@simplewebauthn/server` | 14.0.3 · 25/09/2026 | MIT | **usar** |
| Código de autenticação (TOTP, RFC 6238) | `otplib` | 13.5.0 · 21/08/2026 | MIT | **usar** |
| Resumo de palavra-passe (P1 = a)) | `@node-rs/argon2` (Argon2id) | 2.2.2 · 06/10/2026 | MIT | **usar** |
| Cookie da sessão | `@fastify/cookie` | 11.1.2 · 15/07/2026 | MIT | **usar** (a API é Fastify 5.12.5) |
| Fornecedor OIDC | `oidc-provider` | 9.12.2 · 05/09/2026 | MIT | **não agora** (§9 P3) |
| Tudo feito (contas, sessões, 2FA) | `better-auth` | 1.7.7 · 30/09/2026 | MIT | **não**: traz as suas tabelas e sessões, fora das funções da base, do RLS e do rasto que o Eurolify já tem (`docs/19` §3) |
| — | `@oslojs/otp` | 1.1.0 · 11/12/2024 | MIT | **não**: marcada como descontinuada no npm |

**Sessões sem biblioteca própria:** como as chaves de API (`docs/19` §3), a
sessão é uma linha na base com o **resumo** de um segredo aleatório; o cookie
leva o segredo (`HttpOnly`, `Secure`, `SameSite=Lax`, só o domínio do Hub).
A base resolve-a por uma função, como a `chave_resolver`; a API não lê a
tabela. Assim revogar é imediato e o rasto é o mesmo das chaves.

**Por verificar antes do código:** o código e os avisos de segurança de cada
biblioteca (o fluxo `vigiar` do CI já corre a auditoria das dependências);
quem mantém cada uma.

## 3. Modelo (proposta)

| Tabela | Campos principais | Notas |
|---|---|---|
| `pessoa` | id (`per_`), e-mail (único, sem distinguir maiúsculas), nome, estado (activa, desactivada), criada_em | não é de nenhum comerciante: uma pessoa pode trabalhar para vários |
| `membro` | pessoa, comerciante, papel, desde, até, quem convidou | RLS por comerciante; um comerciante tem sempre pelo menos um **dono** activo (como a «última gestora» das chaves, T11) |
| `passkey` | pessoa, id da credencial, chave pública, contador, nome do dispositivo, criada_em, último uso | a chave privada **nunca** sai do dispositivo |
| `segundo_factor` | pessoa, segredo TOTP **cifrado**, activo desde | um por pessoa |
| `palavra_passe` | pessoa, **resumo** Argon2id, mudada_em | só serve com o TOTP (P1); nunca sozinha |
| `codigo_recuperacao` | pessoa, **resumo** do código, usado_em | 10 códigos, cada um usa-se uma vez (§6) |
| `convite` | comerciante, e-mail, papel, resumo do segredo, expira_em, aceite_em, quem convidou | expira (proposta: 7 dias, **C**) |
| `sessao` | pessoa, resumo do segredo, criada_em, expira_em, último uso, revogada_em | expira por inactividade e por prazo máximo (§9 P4) |
| `entrada` | pessoa (ou e-mail tentado), quando, resultado, IP | o registo de entradas, para segurança (§5) |

Todas com o padrão das chaves: a API só chama funções da base; o rasto não se
altera nem se apaga; o contexto do comerciante vem da sessão (`docs/19` §5).

## 4. Fluxos

1. **Primeira pessoa de um comerciante:** criada pelo comando do operador
   (como a primeira chave, `docs/19` §6), com o papel **dono**, e recebe um
   convite.
2. **Convite:** um dono ou gestor convida um e-mail com um papel. A pessoa
   abre a ligação, cria a passkey (e, se quiser, o TOTP) e recebe os códigos
   de recuperação. Como chega a ligação: §9 P2.
3. **Entrar:** passkey; o Hub pede outra vez a autenticação para os actos
   sensíveis (criar uma chave de API — decisão BA; mudar papéis; mudar os
   dados fiscais).
4. **Sair da equipa:** o dono termina o `membro`; as sessões dessa pessoa
   nesse comerciante deixam de valer no pedido seguinte. A pessoa continua a
   existir se trabalhar para outro comerciante.
5. **Mudar de papel:** só um dono; fica no rasto quem mudou, de quê para quê.

## 5. Dados pessoais (`eu-gdpr-privacy`)

Entram no registo de tratamentos do [`docs/17`](17-dados-pessoais-e-incidentes.md)
§1 quando o código entrar. **Bases legais e prazos são todos C** (não
verifiquei; para o jurista ou o encarregado de dados).

| Dado | Para quê | Base legal (C) | Prazo proposto (C) | No fim |
|---|---|---|---|---|
| E-mail e nome | entrar, ser convidado, saber quem fez o quê | execução do contrato com o comerciante | enquanto a pessoa tiver um `membro` activo; depois, §9 P4 | pseudonimizar (`pessoa:per_<id>` fica no rasto) |
| Chave pública da passkey, nome do dispositivo | entrar | idem | enquanto a passkey existir | apagar |
| Segredo TOTP (cifrado) | entrar | idem | enquanto estiver activo | apagar |
| Resumo da palavra-passe | entrar (com o TOTP) | idem | enquanto a pessoa tiver conta | apagar |
| Resumos dos códigos de recuperação | recuperar a conta | idem | até serem usados ou trocados | apagar |
| Registo de entradas, com IP | segurança e investigação de incidentes | interesse legítimo (segurança) | proposta: **14 dias**, como os outros IP (`docs/17` §3, ADR-0027) | apagar |
| Rasto (`quem` = `pessoa:per_<id>`) | provar quem fez cada acto | interesse legítimo / obrigação de prova | o do registo a que pertence (ex.: 10 anos se tocar em fatura) | fica pseudonimizado |

**Nunca nos registos da aplicação:** o segredo da sessão, o código TOTP, os
códigos de recuperação, a palavra-passe (se existir) — os mesmos testes que
o T5 faz às chaves. **Pedidos dos titulares:** a pessoa exporta e pede o
apagamento dos seus dados de conta; o que é rasto de um comerciante
pseudonimiza-se, não se apaga.

## 6. Recuperar uma conta

Sem isto não há código (ADR-0036). Pela ordem:

1. **Outra passkey** da mesma pessoa (o Hub pede para registar duas, por
   exemplo o telemóvel e o computador).
2. **Código TOTP**, se a pessoa o activou.
3. **Um dos 10 códigos de recuperação**, mostrados uma vez quando a conta é
   criada; cada um vale uma vez e obriga a registar uma passkey nova.
4. **Outro dono do mesmo comerciante** gera um convite de recuperação para
   essa pessoa (fica no rasto quem o fez). O papel e o histórico mantêm-se.
5. **Último recurso, o operador** (Diogo ou Bruno, pelo fluxo `operar`): só
   com prova escrita do comerciante e **nunca decidindo pela pessoa pelo
   nome** (`AGENTS.md`, «Não se erra em documentos fiscais», 6); fica no rasto
   e numa memória.

Um comerciante com um só dono que perdeu tudo cai no ponto 5. Por isso o Hub
recomenda dois donos.

## 7. Segurança (`observability-security`)

- **Sessões:** segredo de 256 bits, só o resumo na base; renovar o segredo ao
  entrar e ao mudar de papel; revogar todas ao desactivar a pessoa.
- **Limites:** tentativas de entrada limitadas por e-mail e por IP (valores
  com medições, como o `docs/18` §6); resposta igual para «e-mail não existe»
  e «falhou», para não revelar quem tem conta.
- **Escalada:** só um dono dá ou tira papéis; ninguém se dá a si próprio um
  papel (o incidente de 28/08/2026 da skill); teste por papel que tenta o que
  não pode.
- **Revisão de segurança própria** antes de juntar (ADR-0036, ponto 3).

## 8. Testes que o código tem de trazer

| # | Teste |
|---|---|
| P-T1 | sem sessão → 401; sessão revogada, expirada ou de uma pessoa desactivada → 401 |
| P-T2 | a sessão de uma pessoa só vê os comerciantes de que é membro; nunca os outros (isolamento) |
| P-T3 | cada papel tenta o que não pode e falha (armazém não muda preços; apoio não muda papéis) |
| P-T4 | ninguém fica dono sem um dono o dar; o último dono não sai |
| P-T5 | segredos (sessão, TOTP, códigos) nunca nos registos nem na resposta, salvo os códigos uma vez |
| P-T6 | um código de recuperação vale uma vez; um convite expirado ou usado não vale |
| P-T7 | sair da equipa desliga as sessões nesse comerciante no pedido seguinte |
| P-T8 | criar uma chave de API pelo Hub sem autenticação recente é recusado (BA) |

## 9. O que fica por decidir (Diogo ou Bruno)

| # | Pergunta | Proposta |
|---|---|---|
| P1 | A alternativa à passkey (decidido: TOTP): com que primeiro passo? | ✅ **Decidido: a) e-mail + palavra-passe (resumo Argon2id) + TOTP** (Diogo, 06/10/2026: *«sim, concordo, fica a a)»*; decisão CA): entrar não depende de um fornecedor de e-mail |
| P2 | Como chegam os convites e os avisos? a) um fornecedor de e-mail na UE (subcontratante novo, acordo de tratamento); b) na Fase 1, o dono copia a ligação e envia-a ele | por decidir |
| P3 | O Eurolify como fornecedor OIDC (`oidc-provider`) já na parte B, ou só quando houver aplicações de terceiros (Fase 3)? | só depois: o Hub usa a sessão própria (§2) |
| P4 | Prazos: duração da sessão; quanto tempo a conta de uma pessoa sem nenhum `membro` fica antes de ser pseudonimizada | por decidir, com o jurista (C) |

## O que não foi verificado

- O código das bibliotecas da §2 e os avisos de segurança de cada uma.
- As bases legais e os prazos da §5 (todos **C**).
- Como o WebAuthn se comporta com o domínio do Hub e os domínios das lojas
  (o identificador da passkey é o domínio onde se regista).
