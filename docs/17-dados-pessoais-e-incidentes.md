# Dados pessoais: tratamentos, subcontratantes, retenção, recuperação e incidentes

> **Versão de 05/10/2026 — desenho.** Responde aos pontos de segurança da
> auditoria (`docs/16`, «Segurança e dados»), a pedido do Diogo (*«avança com
> os pontos de segurança do docs/16»*). Skills: `eu-gdpr-privacy` e
> `observability-security`. **Nenhum dado pessoal real entrou no Eurolify**
> (ADR-0018, ADR-0019). Antes do primeiro, o `docs/11` §4 pede os acordos de
> tratamento e os fornecedores no registo de tratamentos; proponho que este
> documento esteja validado nessa altura. Tudo o que é base legal ou prazo legal está
> marcado **C** e vai ao encarregado de dados ou ao jurista. Isto não é
> aconselhamento jurídico.

## 1. Registo de tratamentos

O RGPD pede um registo de tratamentos (`docs/03` §4, **C**). Este é o
primeiro, com o que existe a 05/10/2026 (código no `main` e script da VPS).
O papel segue a `eu-gdpr-privacy` («Os dois papéis»): o Eurolify é
**responsável** pelo que trata para si e **subcontratante** pelo que trata por
conta de cada comerciante.

| # | Tratamento | Papel | Titulares | Dados | Finalidade | Base legal | Onde fica | Prazo |
|---|---|---|---|---|---|---|---|---|
| T1 | Registo e verificação do comerciante (Comerciante, `0001_comerciante.sql`) | responsável | o comerciante em nome individual; quem aceita contratos e muda estados | denominação, número fiscal e morada da entidade legal; `aceite_por`; `quem` nas transições; documento da prova de verificação | contratar e verificar quem vende | execução do contrato e obrigação legal — **C** | base PostgreSQL (VPS) e cópias | §3 — **C** |
| T2 | Dados dos clientes de cada comerciante (encomendas, contas, consentimentos) | subcontratante | clientes dos comerciantes | **ainda não existe** | — | a do comerciante; acordo de tratamento (`aceitacao_contrato`, tipo `acordo_tratamento_dados`) | — | entra com cada domínio |
| T3 | Acesso dos operadores ao MCP da VPS (ADR-0033) | responsável | o Diogo e o Bruno | número e login da conta do GitHub | autenticar e registar quem pediu cada acção | interesse legítimo (segurança) — **C** | registo do contentor do MCP; registo de acções da máquina e diário do sistema (`logger`, `comum.sh`), só o número (#102); fora do `/var/log/syslog` (`rsyslog-eurolify.conf`). O `medir` e o `estado_do_ensaio` mostram as últimas acções com o número substituído por `<n>` (`eurolify-medir`), por isso a conta não chega ao GitHub Actions nem à Anthropic | §3 |
| T4 | Registos técnicos da máquina | responsável | os operadores; quem abre o ensaio ou o MCP | endereços IP (SSH, fail2ban, firewall, nginx) | segurança da máquina | interesse legítimo (segurança) — **C** | VPS | 14 dias (ADR-0018, ADR-0027; `journald-eurolify.conf`) |
| T5 | Cópias da base | o mesmo de T1 e T2 | os mesmos | toda a base, cifrada (`age`) | recuperar depois de uma falha | a dos tratamentos copiados | OVH Object Storage, Paris (ADR-0032) | 14 dias (`eurolify-copia`) |
| T6 | Repositório, revisão e CI | responsável | o Diogo e o Bruno | contas, commits e comentários no GitHub | desenvolver o Eurolify | interesse legítimo — **C** | GitHub | o do GitHub — não verifiquei |
| T7 | Chaves de API (migração 0010; `docs/19`) | responsável | o operador que cria ou revoga (Diogo, Bruno) | `criada_por` e `revogada_por` = `operador:github:<número da conta>`; pela API (0012), `chave:key_<id>`, que não é dado pessoal | saber quem criou e revogou cada chave | interesse legítimo (segurança) — **C** | base PostgreSQL (VPS) e cópias | enquanto a chave existir (não se apaga) — **C** |

Falta, e entra com o domínio: cada tratamento novo acrescenta aqui uma linha
(`eu-gdpr-privacy`, «Antes de dizer está feito»).

## 2. Subcontratantes

| Fornecedor | O que recebe | País | Acordo de tratamento | Estado |
|---|---|---|---|---|
| **OVH** — VPS do ensaio | a base, os registos técnicos | Reino Unido (ADR-0018) | por assinar | excepção temporária: **sem dados pessoais reais**; acaba a 31/03/2027 ou antes do primeiro dado real (ADR-0019) |
| **OVH** — Object Storage | as cópias cifradas | França, Paris (ADR-0032) | por assinar (um só acordo com a OVH, ADR-0032) | mesma conta que a VPS: aceite para o ensaio; para a produção, onde ficam as cópias decide-se de novo (ADR-0032) |
| **Healthchecks.io** | sinais de vida das tarefas: o texto do resultado, sem IP e até 10 KB (`comum.sh`, `filtrar_ip`); os textos são o nome e o tamanho da cópia e o resultado da reposição e da verificação (`eurolify-copia`, `eurolify-reposicao`, `eurolify-verificacao`), sem dados pessoais | empresa na Letónia; país dos servidores **não verificado** (ADR-0027) | não verifiquei | confirmar o país dos servidores antes do primeiro dado real |
| **GitHub** | o código, as revisões e as contas dos operadores; nenhum dado de clientes | fora da UE — não verifiquei onde ficam os dados | não verifiquei | só dados dos operadores |
| **Anthropic** | os pedidos ao MCP saem da infraestrutura dela e as respostas passam por ela (ADR-0033) | fora da UE — não verifiquei onde ficam os dados | não verifiquei | **com dados pessoais reais na VPS, é um serviço de fora da UE que recebe dados**: só com decisão escrita do Diogo ou do Bruno e o acordo de transferência (`AGENTS.md`, «Regras da UE», regra 4). Hoje as respostas do MCP filtram os endereços IP (`filtrar_ip`, `eurolify-trabalho`) |

## 3. Retenção por campo e o que falta

**Prazos legais: todos C.** Procurei no `docs/03` e na `eu-gdpr-privacy`
prazos de conservação: só encontrei o das faturas (10 anos civis, art. 52.º
do CIVA, `docs/03`, **W**), e o Comerciante ainda não emite faturas.

| Dado | Onde | Prazo proposto | Acção no fim | Nota |
|---|---|---|---|---|
| Entidade legal (denominação, número fiscal, morada) | `entidade_legal` | enquanto o comerciante tiver conta; depois, o prazo dos documentos fiscais em que aparece — **C** | pseudonimizar o que não for exigido | «arquivar não apaga: os documentos fiscais ficam 10 anos» (`docs/15`, tabela da entidade legal, campo `estado`) |
| Quem aceitou e que versão | `aceitacao_contrato` | o prazo de prova do contrato — **C** (não verifiquei) | manter enquanto for prova | só se acrescenta |
| Quem mudou o estado e porquê | `transicao_estado` | o mesmo — **C** | idem | só se acrescenta (§5 da auditoria: falta o gatilho que o garanta) |
| Prova de verificação | `prova_verificacao` | o mesmo — **C** | idem | `rever_ate` não é prazo de retenção |
| Endereços IP | registos da máquina | 14 dias no diário e no `ufw.log` | apagar | o `auth.log`, o `fail2ban.log` e o `wtmp`/`btmp` podem guardá-los mais tempo (`infra/vps/LEIA-ME.md`): **ponto aberto** |
| Conta e login dos operadores | registo do contentor do MCP | **14 dias**: o contentor escreve no diário do sistema (`--log-driver journald`, `eurolify-publicar`), a partir da publicação seguinte | apagar | Diogo, 05/10/2026: *«14 dias, como os IP»* |
| Número da conta dos operadores | `/var/log/eurolify/acoes.log` | **14 dias** (`logrotate-eurolify`; diário, a última cópia pode ter até ~15 dias, como o `ufw.log`) | apagar | idem; antes não rodava |
| Número e login da conta dos operadores | diário do sistema (`logger`; contentor do MCP) | 14 dias (`journald-eurolify.conf`, com um ficheiro por dia, `MaxFileSec=1day`: o journald só apaga ficheiros inteiros) | apagar | estas linhas não vão para o `/var/log/syslog` (`rsyslog-eurolify.conf`), que roda ao fim de semanas |
| Resposta guardada de uma escrita (`Idempotency-Key`) | `idempotencia` (0012; `docs/18` §4) | expira às **24 h**; apaga-se na limpeza seguinte (`eurolify-limpeza`, 05:00 UTC, 0013), por isso fica **até ~48 h na base** (mais, se a limpeza parar: a verificação das 07:00 avisa). **Cada linha entra em pelo menos uma cópia** das 03:00, e as cópias ficam 14 dias | apagar | hoje só as rotas das chaves, sem dados pessoais (nome da chave e `chave:key_…`); uma rota com dados pessoais que use a idempotência tem de contar com estes prazos |
| Quem publicou, retirou ou mudou um preço (`quem`) | `evento_saida.dados` (0021; `docs/18` §5); também `publicacao.publicado_por`/`arquivado_por` e `historico_preco.definido_por` | **por decidir — C**: o evento não se altera nem se apaga, e o prazo de guarda entra com o publicador | pseudonimizar no apagamento: a forma desenha-se com o apagamento (o evento não aceita `UPDATE`) | **nunca sai nos webhooks** nem nas consultas da API com `catalog:read` (Diogo, 07/10/2026, `docs/06`, CH e CK); se for preciso, com um âmbito próprio; hoje é texto declarado, `pessoa:…` depois da fatia de identidade |
| Cópias | OVH Object Storage | 14 dias | apagar | um apagamento propaga-se quando a cópia expira (`eu-gdpr-privacy`) |

**Exportação e apagamento do titular** (pedidos dos titulares): ficam por
desenhar no `docs/15` (auditoria `docs/16`, «Segurança e dados»). O que já se sabe:

- a exportação percorre **todas** as tabelas acima com o `comerciante_id` da
  pessoa;
- o apagamento **não** apaga o que é prova (`aceitacao_contrato`,
  `transicao_estado`, `prova_verificacao`) nem o que tiver prazo fiscal:
  pseudonimiza (`eu-gdpr-privacy`, «Retenção e apagamento»). Como se
  pseudonimiza uma tabela «só se acrescenta» sem lhe dar `UPDATE` é uma
  pergunta de desenho para quando se escrever o apagamento.

## 4. Cópias e recuperação

Medido no script da VPS a 05/10/2026:

- **Cópia diária às 03:00 UTC** (`eurolify-copia.timer`): numa falha pode
  perder-se **até ~24 h** do que se escreveu (o RPO de hoje, de facto).
- **14 dias** de cópias na OVH; na máquina, as de menos de 3 dias (até 3
  cópias, `find -mtime +2` em `eurolify-copia`).
- As cópias estão **na mesma conta da OVH** que a VPS; a skill pede-as fora
  da conta principal (`observability-security`, «Cópias»). Aceite para o
  ensaio; para a produção decide-se de novo (ADR-0032).
- **Ensaio de reposição ao domingo às 04:00 UTC** (`eurolify-reposicao.timer`):
  repõe numa base temporária, confere e apaga.
- **Tempo para voltar (RTO): por escrever.** Não está medido aqui quanto
  demora uma reposição completa; o ensaio de domingo dá esse número
  (`estado_do_ensaio`, secção «tarefas»). O objectivo para a produção é uma
  decisão do Diogo ou do Bruno, antes do primeiro comerciante; para o ensaio,
  sem dados reais, não se fixa.

## 5. Plano de resposta a incidentes

Fontes: `eu-gdpr-privacy` («Violação de dados pessoais», RGPD arts. 28.º,
33.º e 34.º, **W** · texto lido) e `docs/03` §4 (NIS2, art. 23.º, **W** · texto
lido + **C** para a lei de cada país que a transpõe). Quem responde: o Diogo e
o Bruno; quem souber primeiro avisa o outro e **é quem envia** os avisos dos
passos 3, 4 e 7, salvo se combinarem outra coisa no momento.

| Passo | O quê | Prazo |
|---|---|---|
| 1. Conter | Uma chave exposta **revoga-se primeiro e investiga-se depois** (`AGENTS.md`, «Operar a VPS», regra 7); parar o serviço tocado, se for preciso (nunca em horário de trabalho sem aviso, regra 4) | logo |
| 2. Medir | Que comerciantes e **quantas pessoas** foram tocadas, que dados, desde quando — pelos registos por comerciante e de auditoria | antes do passo 3 |
| 3. Avisar os comerciantes (o Eurolify como subcontratante) | Cada comerciante afectado, com o que se sabe | **sem demora injustificada** (art. 33.º, n.º 2) |
| 4. Notificar a autoridade (o Eurolify como responsável, T1, T3, T4, T6) | Autoridade de controlo, salvo se não houver risco para as pessoas; a autoridade competente e o canal **não verifiquei** | sem demora e, se possível, **até 72 h** (art. 33.º, n.º 1) |
| 5. Comunicar às pessoas | Se o risco for elevado, em linguagem clara | sem demora (art. 34.º) |
| 6. Registar | **Todas** as violações, notificadas ou não: factos, efeitos, o que se fez (art. 33.º, n.º 5). Em `memoria/` vai só o resumo **sem dados pessoais** (o repositório está no GitHub, fora da UE); os pormenores ficam na VPS. Onde guardar os pormenores na produção é uma decisão por tomar | sempre |
| 7. NIS2 | Só se o Eurolify estiver abrangido (média empresa ou maior; pergunta para o jurista, `docs/03` §4): alerta precoce, notificação e relatório final, **ao CSIRT ou à autoridade nacional** (`docs/03` §4); qual é, por país, **C** | 24 h, 72 h, até um mês (art. 23.º, n.º 4) |

**O aviso ao comerciante** leva o que ele precisa para a sua própria
notificação, cujo conteúdo mínimo é o do art. 33.º, n.º 3: a natureza da
violação, as categorias e o número aproximado de pessoas e de registos, um
contacto, as consequências prováveis e as medidas tomadas ou propostas. Que
o aviso do subcontratante tenha de levar tudo isto é leitura nossa — **C**.
A notificação pode ir por fases (n.º 4).

**O que falta para o plano funcionar:** o registo de auditoria por comerciante
(a auditoria, §5) e a resposta a «quantas pessoas?», que só existe quando
houver dados de clientes (T2).

## O que não foi verificado

- Todas as bases legais e todos os prazos marcados **C**.
- O país e o acordo de tratamento do Healthchecks.io, do GitHub e da
  Anthropic.
- A autoridade de controlo competente e o canal de notificação.
- A duração de uma reposição completa.
