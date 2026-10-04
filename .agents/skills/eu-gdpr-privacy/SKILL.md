---
name: eu-gdpr-privacy
description: Protecção de dados no Eurolify (RGPD e ePrivacy) — privacidade desde a concepção e por omissão, minimização, finalidade e base legal por tratamento, consentimento granular e prova dele, retenção e apagamento (e o choque com os 10 anos fiscais), pedidos dos titulares (acesso, exportação, rectificação, apagamento, limitação), registo de tratamentos, violações de dados (aviso ao comerciante e as 72 h), subcontratantes e transferências. Usar sempre que se cria ou muda um campo com dados pessoais, um consentimento, uma exportação, um apagamento ou um fornecedor que recebe dados, e no plano de resposta a incidentes.
---

# RGPD e privacidade

> Estado: **desenho** — o código está autorizado (ADR-0023), mas o deste domínio só depois do desenho dele em tabela. Regras e fontes:
> `docs/03-regulamentar-ue.md` §4. Validação: encarregado de protecção de dados
> ou jurista. Isto não é aconselhamento jurídico.

## Quando usar

- Campo novo com dados de uma pessoa (nome, e-mail, telefone, morada, NIF de
  particular, IP, histórico de compras).
- Consentimento novo (marketing, cookies, WhatsApp, avaliações).
- Exportar, apagar ou anonimizar.
- Ligar um fornecedor novo que recebe dados (e-mail, SMS, IA, transportadora).

## Os dois papéis — não confundir

| | Responsável pelo tratamento | Subcontratante |
|---|---|---|
| Quem | **o comerciante** (os clientes são dele) | **o Eurolify** (trata por conta do comerciante) |
| Consequência | decide finalidades, responde aos clientes | só trata segundo instruções; precisa de **acordo de tratamento de dados** com cada comerciante; lista pública de subcontratantes ulteriores; avisa antes de mudar |

Quando o Eurolify trata dados **para si** (contas dos comerciantes, faturação do
Eurolify, segurança), aí é responsável. Escrever sempre qual dos dois papéis se
aplica a cada tratamento.

## Regras que não se negociam

1. **Base legal por finalidade, escrita.** O consentimento **não** é a base
   para tudo: a encomenda e a fatura assentam na execução do contrato e na
   obrigação legal; a prevenção de fraude no interesse legítimo; o marketing
   por e-mail a não-clientes e os cookies não essenciais no consentimento.
2. **Minimização.** Só se pede o que a finalidade precisa. Data de nascimento,
   género, documento de identificação: só com finalidade escrita.
3. **Consentimento granular e provado**: por canal (e-mail, SMS, WhatsApp) e por
   finalidade; guarda-se **o quê, quando, como (texto mostrado e versão), onde
   (loja, formulário) e de quem**. Retirar tem de ser tão fácil como dar.
4. **Uma régua só para «este cliente pode receber marketing?»**, no servidor —
   foi o que o Hub construiu a 29/09/2026 (`consentimento_do_cliente`): contam só
   as declarações explícitas, vale a mais recente, empate ⇒ não, sem nenhuma ⇒
   não; **WhatsApp sem fonte de consentimento ⇒ não** a toda a gente.
   (`consentimento-de-marketing-no-hub-29set2026.md`, repo `claude`.)
5. **«Nunca aceitou» não é «retirou»** e «não marcou a caixa» não é «disse
   não» — guardam-se de forma diferente.
6. **Cookies não essenciais só depois do consentimento** — o píxel da Meta a
   disparar antes do consentimento foi um achado da auditoria jurídica de 2026
   no ecossistema (`ai-act-compliance.md`). O Eurolify dá um gestor de
   consentimento por omissão às lojas.
7. **Dados pessoais fora dos registos técnicos**: logs, erros e métricas levam
   identificadores, não nomes, e-mails, telefones nem NIF em claro.

## Retenção e apagamento — o choque com o fisco

- **Faturas e documentos de suporte: 10 anos civis** (art. 52.º do CIVA em
  Portugal; outros países têm prazos próprios). Um pedido de apagamento **não**
  apaga uma fatura.
- O que se faz: apagar o que não tem obrigação legal (conta, preferências,
  carrinhos, marketing), **pseudonimizar** a ficha, e manter os documentos
  fiscais e os dados mínimos que eles exigem, com a razão escrita.
- Tabela de retenção por tipo de dado, com o prazo, a base e a acção no fim
  (apagar, anonimizar, manter). Uma tarefa diária aplica-a e **regista o que
  fez**.
- Cópias de segurança: o apagamento propaga-se quando a cópia expira; dizê-lo na
  política de privacidade.

## Pedidos dos titulares (DSAR)

| Pedido | O que o Eurolify entrega |
|---|---|
| Acesso / exportação | ficheiro legível por máquina com tudo o que existe sobre a pessoa, **em todos os domínios** (encomendas, perfis, consentimentos, mensagens, registos de comunicação) |
| Rectificação | correcção com rasto; ⚠️ **um NIF num documento fiscal emitido não se corrige** — corrige-se com nota de crédito, e isso é do domínio fiscal |
| Apagamento | ver «retenção» acima |
| Limitação / oposição | bandeira que trava o tratamento sem apagar |

Prazo legal de resposta de um mês (prorrogável) — **C**, confirmar.
Cada pedido: quem pediu, como se verificou a identidade, o que se fez, quando.

## Violação de dados pessoais

RGPD, arts. 28.º, n.º 3, 33.º e 34.º — **W · texto lido** (EUR-Lex, versão
inglesa, 03/10/2026):

| Quem | O quê | Prazo |
|---|---|---|
| **O Eurolify como subcontratante** (dados dos clientes de cada comerciante) | avisa **cada comerciante afectado** e ajuda-o a cumprir as suas obrigações (art. 33.º, n.º 2; art. 28.º, n.º 3) | sem demora injustificada depois de ter conhecimento |
| **O comerciante** (responsável) | notifica a autoridade de controlo, salvo se a violação não for susceptível de resultar num risco para as pessoas (art. 33.º, n.º 1) | sem demora injustificada e, se possível, **até 72 h** depois de ter conhecimento |
| O comerciante, se o **risco for elevado** | comunica a violação às pessoas afectadas, em linguagem clara (art. 34.º) | sem demora injustificada |
| **O Eurolify como responsável** (contas dos comerciantes, faturação do Eurolify) | o mesmo que o comerciante: autoridade e, se o risco for elevado, as pessoas | os mesmos: se possível, até 72 h |

- A notificação diz pelo menos: a natureza da violação, as categorias e o
  número aproximado de pessoas e de registos, um contacto, as consequências
  prováveis e as medidas tomadas ou propostas (art. 33.º, n.º 3); pode ir por
  fases (n.º 4).
- **Todas** as violações ficam documentadas — factos, efeitos, o que se fez —,
  mesmo as que não se notificam (n.º 5).
- ⇒ No Eurolify: os registos por inquilino e o registo de auditoria têm de
  dizer depressa **que comerciantes e quantas pessoas** uma violação tocou;
  sem isso, ninguém cumpre as 72 h. O plano de resposta e o modelo do aviso ao
  comerciante ficam prontos antes do primeiro comerciante. Um incidente de
  segurança pode ser, ao mesmo tempo, violação de dados e incidente da NIS2
  (`observability-security`).

## Fusões e identidade

Uma fusão de fichas junta dados de duas «pessoas» — por isso só com os sinais do
ecossistema (NIF igual = a mesma; email/telefone = talvez, decide uma pessoa;
**nunca pelo nome**) e com o 2.º e-mail e o 2.º telefone guardados, não
perdidos (`regras-identidade-duplicados.md`). Os consentimentos das duas fichas
seguem a régua única.

## Transferências e subcontratantes

- Alojamento numa VPS num centro de dados na UE, operada pelo Diogo e pelo
  Bruno (ADR-0015; antes, a Scaleway gerida): o fornecedor da VPS e o das
  cópias são subcontratantes. Excepção temporária: a VPS do ensaio está no
  Reino Unido até à migração para Paris (ADR-0018) — nela não entra nenhum
  dado pessoal real. Cada
  fornecedor com dados: país, garantias da
  transferência se sair da UE, acordo assinado, finalidade.
- **IA**: um modelo de terceiros que recebe dados de clientes é um
  subcontratante — mesmo cuidado, e sem treino com os dados.

## Anti-padrões

- Um campo «consentimento» `true/false` sem data, texto nem origem.
- Copiar dados pessoais para um sistema de terceiros «para ficar mais rápido».
- Apagar faturas a pedido do titular.
- Contar consentimentos no browser (vê menos do que existe).

## Antes de dizer «está feito»

- [ ] O tratamento novo está no registo de tratamentos, com base legal e prazo.
- [ ] Entra na exportação e no apagamento do titular.
- [ ] Nenhum dado pessoal novo nos registos técnicos.
- [ ] Se há fornecedor novo: acordo, país e lista de subcontratantes actualizada.
- [ ] Numa violação, sabemos dizer que comerciantes e quantas pessoas foram
      tocados, a tempo de cada comerciante notificar em 72 h.
