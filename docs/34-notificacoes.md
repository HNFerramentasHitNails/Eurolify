# Notificações: o envio de e-mails (desenho, 11/10/2026)

> Pedido do Diogo, 11/10/2026: *«avança com o e-mail do aviso do prazo»*
> (issue #372). **Aprovado pelo Diogo a 11/10/2026, com o fornecedor A**
> (*«aprovado, com a A»*, à Q11; `docs/06`, DX). Primeira
> notificação: o aviso do prazo do reembolso (R10; `docs/30` §14; decisão
> DQ, A4: *«sem e-mail até haver notificações»*).

## 1. O que existe (lido a 11/10/2026)

- **O Eurolify não envia e-mails.** Procurei em `apps/api/src` por SMTP,
  `nodemailer`, nomes de fornecedores e funções de envio, e nos issues por
  «notificações» e «envio de e-mail»: nada. Os convites não vão por e-mail
  (CB); a recuperação da conta usa códigos, não e-mail.
- O domínio está só na tabela do `docs/02` (linha «Notificações»: modelos
  por língua e país, envio transaccional, preferências; lê o consentimento
  de marketing; eventos `notification.sent` e `notification.failed`). O
  `docs/05` pede notificações em PT, ES e EN na Fase 1.
- O aviso do prazo já sai como evento (`refund.deadline_approaching`,
  `refund.deadline_passed`) e na lista `GET /returns?prazo_reembolso=`
  (migração 0063). Falta o e-mail.
- **ADR-0032:** *«A OVH é o fornecedor único do Eurolify (VPS, cópias e o
  que vier)»*. Um segundo fornecedor muda esta decisão.

## 2. O fornecedor (lido a 11/10/2026, nas páginas de cada um; **W**)

| | OVH E-mail Pro | Lettermint | Sweego | Scaleway TEM |
|---|---|---|---|---|
| O que é | uma caixa de correio, com SMTP | serviço de e-mail transaccional (API, SMTP) | serviço de e-mail transaccional (API, SMTP) | serviço de e-mail transaccional (API, SMTP) |
| Onde | «Localização dos dados: França» | «EU-based infrastructure»; a sede não está na página de preços (directórios dizem Países Baixos — não verifiquei) | «Made with ♥ in France»; onde ficam os dados, a página não diz | região `fr-par` (documentação) |
| Preço | 1,59 € + IVA por conta e por mês | 0 € até 300 por mês (pára no limite); 10 € por mês com 10 000; +1,50 € por mil | 0 € com 100 por dia; 10 € por mês com 20 000 (página com dois preços, não esclarecido) | 300 incluídos; +0,25 € por mil |
| Estado da entrega | não (só a resposta do SMTP) | webhooks (não detalhados) | webhook | webhooks pela Topics and Events (beta) |
| Acordo de tratamento | o da OVH (um só, ADR-0032) | «A data processing agreement under Article 28 GDPR applies automatically to every customer» | página «DPA» (não li) | não encontrei na página |
| Contra | a OVH escreve: «Standard mailbox solutions are not designed for bulk sending» e recomenda um serviço transaccional para volume; o MX Plan tem «around 200 emails» por hora e conta (o E-mail Pro não tem limite na página) | segundo fornecedor (muda o ADR-0032) | segundo fornecedor; preços por esclarecer | a Scaleway deixou de se usar (ADR-0032, AN) |

Fontes: `ovhcloud.com/pt/emails/email-pro/`; `docs.ovhcloud.com/en/guides/web-cloud/web-hosting/email-sending-best-practices`;
`lettermint.co/pricing`; `sweego.io/pricing`; `scaleway.com/en/transactional-email-tem/` e
`scaleway.com/en/docs/transactional-email/reference-content/tem-capabilities-and-limits/`.
Os preços podem ter mudado depois desta data; o IVA não está claro em
todas. A Brevo não abriu a página de preços: não verifiquei.

**O código não depende da escolha:** o envio faz-se por **SMTP**, que os
quatro aceitam; mudar de fornecedor é mudar a configuração (anfitrião,
porta, utilizador, palavra-passe), não o código. O que se perde no SMTP
sem webhooks: saber se o e-mail chegou à caixa (só se sabe que o servidor o
aceitou).

## 3. Propostas

| # | O quê | Proposta | Fonte |
|---|---|---|---|
| N1 | **O fornecedor** | **A: OVH E-mail Pro**, uma conta `avisos@eurolify.eu`, enquanto os e-mails forem poucos (os avisos à equipa dos comerciantes); um serviço transaccional decide-se antes da confirmação da encomenda ao cliente (§9). B: Lettermint já, como segundo fornecedor | §2; ADR-0032 |
| N2 | **A quem** | às pessoas activas com papel **dono** ou **gestor** no comerciante (as que decidem reembolsos, `refunds:write`, Q6); cada uma recebe o seu, no endereço da conta. Sem lista de endereços configurável nesta parte | `docs/30` Q6; `eu-gdpr-privacy` (minimização) |
| N3 | **O que diz** | o tipo de aviso, a devolução (`rma_…`) e a encomenda (`ord_…`), o último dia e os dias que faltam, e a ligação ao Hub. **Nenhum dado do cliente** (nome, e-mail, morada, artigos) | DQ, A4; `eu-gdpr-privacy` |
| N4 | **Em que língua** | a do Hub do comerciante (`comerciante.lingua`) se for `pt`, `es` ou `en`; senão, `en`. Modelos em texto simples, com versão | `docs/05`; `eu-localization` |
| N5 | **Uma fila, não um envio directo** | a notificação grava-se na mesma transacção que o aviso (o gatilho que já escreve o evento), uma por pessoa; uma tarefa de minuto a minuto envia-as. Nunca duas para a mesma pessoa e o mesmo aviso (chave única) | `platform-architect` (outbox); `observability-security` |
| N6 | **Quando falha** | falha temporária (sem ligação, 4xx do SMTP): tenta outra vez ao fim de 1, 5, 30 minutos, 2 e 6 horas; à 6.ª, ou numa recusa definitiva (5xx), fica **falhada**, com o código, e vê-se na lista; nunca em silêncio | `observability-security` («tarefas que não param em silêncio») |
| N7 | **O que se aceita** | se a máquina parar entre o SMTP aceitar e o Eurolify gravar «enviada», o aviso pode sair **duas vezes**. Para um aviso à equipa é aceitável; para documentos ao cliente não (§9) | — |
| N8 | **Sem configuração** | sem as credenciais SMTP, a tarefa não envia e as notificações ficam à espera (dito uma vez no registo); nos testes, um adaptador de ensaio guarda os e-mails em memória | como o emissor de ensaio da faturação |
| N9 | **Dados pessoais** | a fila guarda a **pessoa** (`per_…`), não o endereço; o endereço lê-se no envio. Apaga-se 90 dias depois de enviada ou falhada (**C**). Tratamento T8 alargado (avisos às contas de pessoas), base legal a do T8 (**C**); subcontratante: o fornecedor de N1 | `eu-gdpr-privacy`; `docs/17` T8 |
| N10 | **O domínio de envio** | `eurolify.eu` com SPF, DKIM e DMARC no DNS; sem isso, os e-mails vão para o spam. O registador do domínio não está escrito (`docs/06`, P): é o Diogo que o configura | `docs/06`, P |
| N11 | **Onde se vê** | `GET /notifications?estado=` na API de Administração (âmbito `merchant:read`): o tipo, a pessoa, o estado, as tentativas e o último código; sem o endereço nem o corpo | `headless-commerce` |

## 4. O modelo

| Tabela | Colunas | Regras na base |
|---|---|---|
| `notificacao` | `id`, `comerciante_id`, `tipo` (`refund.deadline_approaching`, `refund.deadline_passed`), `referencia` (a devolução), `pessoa_id`, `lingua`, `dados` (a loja, a devolução, a encomenda, o último dia e os dias), `estado` (`a_enviar`, `enviada`, `falhada`, `cancelada`), `tentativas`, `proxima_em`, `ultimo_erro` (código, sem dados pessoais), `id_mensagem` (o `Message-ID`), `criada_em`, `terminada_em` | RLS do comerciante, forçado; única por (`tipo`, `referencia`, `pessoa_id`); só se acrescenta e muda de estado para a frente; grava-a o gatilho do aviso, não a API; sem `TRUNCATE`; só se apaga 90 dias depois de terminada |

A tarefa segue o molde dos avisos do prazo (0063): uma função lista os
comerciantes com notificações a enviar; cada notificação na sua transacção,
com o comerciante; um erro num comerciante não pára os outros e fica no
registo.

## 5. A configuração (fora do repositório)

`SMTP_ANFITRIAO`, `SMTP_PORTA`, `SMTP_UTILIZADOR`, `SMTP_PALAVRA_PASSE` e
`SMTP_REMETENTE`, no `/etc/eurolify/api.env` da VPS, como as outras chaves da
API (`infra/vps/LEIA-ME.md`, passo 10b). Levá-las pelos segredos do ambiente
`ensaio` do GitHub (ADR-0028) é um passo de infra à parte, por fazer.
**Precisa do Diogo ou do Bruno:** criar a conta de e-mail, pôr as cinco
variáveis e configurar o DNS (N10).

## 6. O ensaio

A VPS do ensaio está no Reino Unido sem dados pessoais reais (ADR-0018): os
e-mails do ensaio vão só para as contas do Diogo e do Bruno, que já entram
no Hub do ensaio. **Não verifiquei** se isso conta como dado pessoal real
para o ADR-0018: é o endereço deles, não de clientes.

## 7. Os testes que impedem o lançamento

- Um aviso dá uma notificação por dono e gestor activos; nenhuma ao armazém,
  ao apoio, a um membro que saiu ou a uma pessoa desactivada.
- O mesmo aviso nunca dá duas notificações à mesma pessoa.
- O corpo não tem o nome nem o e-mail do cliente (procurar no texto).
- Falha temporária tenta outra vez; definitiva fica falhada; à 6.ª fica
  falhada; outro comerciante não vê as notificações deste.
- Sem configuração, nada sai e nada se perde.

## 8. Como entra no código (quando aprovado)

Uma migração (a tabela, o gatilho, a função dos comerciantes), o adaptador
SMTP (biblioteca `nodemailer`, licença MIT-0 — dependência nova, revista no
pedido) e o de ensaio, a tarefa no `servidor.ts`, os modelos PT/ES/EN, a
lista da API, os testes e a revisão do agente. Um pedido só.

## 9. Fora desta parte

- **Os e-mails ao cliente** que a lei pede em suporte duradouro: a
  confirmação da encomenda com as condições aceites e a confirmação da
  recepção do pedido de livre resolução (`consumer-rights-eu`). Esses não
  podem sair duas vezes nem perder-se, pedem o estado da entrega e volume:
  **decide-se o serviço transaccional antes deles**.
- **Os avisos das tarefas das filas** (`docs/33`, peça 21, DW): hoje vêem-se
  só na lista («Sem e-mail até haver notificações», `src/tarefas/avisos.ts`);
  passar a e-mail é um tipo novo nesta fila, num pedido próprio.
- Marketing (lê o consentimento, DL), preferências por pessoa, SMS e
  WhatsApp, webhooks aos sistemas dos comerciantes.

## 11. Em código (11/10/2026; migração 0067; `docs/06`, DX)

| O quê | Onde |
|---|---|
| `notificacao`, com o RLS do comerciante: gravada pelo gatilho do aviso do prazo, uma por dono e gestor activos e por aviso; estados só para a frente (`a_enviar` → `enviada`, `falhada` ou `cancelada`); a API não a grava nem a apaga | migração 0067 |
| `tarefa_notificacao`, interna (como as filas da 0047 e da 0063): diz à tarefa em que comerciantes entrar (para enviar, ou para apagar 90 dias depois de terminada), sem ler a `notificacao` sem comerciante | migração 0067 |
| `notificacao_destino()`: o endereço lido no envio, só se a pessoa continua activa e dona ou gestora; senão, a notificação fica `cancelada`; e só se a devolução continua à espera do reembolso (senão, `cancelada` com `devolucao_ja_nao_espera`) | migração 0067; `src/notificacoes/repositorio.ts` |
| o correio por SMTP (`nodemailer` 10.0.10, licença MIT-0, sem dependências, de 14/09/2026 — a mais recente com mais de duas semanas) e o de ensaio; uma ligação por volta, 60 segundos no máximo por envio; o endereço validado antes (um com `,`, `<` ou `"` não sai); a culpa de cada erro: o destinatário recusado (5xx ao `RCPT TO`) falha logo, o 4xx dele repete, e o resto (autenticação, remetente, ligação, DNS) é do servidor — não conta como tentativa e pára a volta | `src/notificacoes/correio.ts` |
| os textos PT, ES e EN, com o nome da loja numa linha só e sem o nome da pessoa | `src/notificacoes/modelos.ts` |
| a tarefa de minuto a minuto, em três passos: toma a vez numa transacção curta (a próxima hora passa para daqui a 10 minutos), envia fora dela e grava o resultado noutra; as esperas 1, 5, 30, 120 e 360 minutos; à 6.ª falha, `falhada`; a limpeza dos 90 dias na mesma volta, também sem SMTP | `src/notificacoes/repositorio.ts`; `servidor.ts` |
| `GET /notifications?estado=&limite=` (`merchant:read`): o tipo, a referência, a pessoa, a língua, o estado, as tentativas, a próxima hora, o último código e as datas; nunca o endereço nem o texto | `src/notificacoes/rotas.ts` |
| 3 testes pela API e 5 sem base (um contra um servidor SMTP falso que responde 535, 550 e 451); 28 mutações, 26 apanhadas e duas equivalentes (o destino confere o comerciante e o estado, que o RLS forçado e a gravação também conferem) | `test/posvenda-api.test.ts`; `test/notificacoes-correio.test.ts` |

**Desvios do desenho:**
- **O documento é o `docs/34` e a migração a 0067:** o `docs/33` e a 0066
  são das tarefas das filas (#368, #375), que entraram primeiro.
- **A língua é a do Hub do comerciante** (`comerciante.lingua`), não a do
  catálogo: o e-mail é para a equipa.
- **Sem ligação ao Hub** (N3): o Hub ainda não tem os ecrãs da pós-venda; o
  e-mail diz a lista da API (`GET /returns?prazo_reembolso=`).
- **Um quarto estado, `cancelada`**: a pessoa saiu, foi desactivada ou
  deixou de ser dona ou gestora antes do envio.
- **A configuração vai no `api.env` da VPS** (§5), não nos segredos do
  GitHub: é onde vivem as outras chaves da API. Uma configuração a meio, ou
  a porta errada, não derruba a API: o registo diz que variáveis faltam.
- **Correcções da revisão do #373** (Sonnet 5.5; 0 P0, 1 P1, 6 P2, 10 P3): a
  culpa de cada erro do SMTP (P1-1); o envio fora da transacção (P2-1); a
  devolução que já não espera (P2-2); sem o nome da pessoa, a loja numa
  linha só e o endereço validado (P2-3); o nome da loja (P2-4); a
  configuração a meio (P2-5); o T10 e o E-mail Pro no `docs/17` (P2-6); uma
  ligação por volta, o tempo máximo, a limpeza sem SMTP, «hasta el», sem
  parênteses vazios, sem `TRUNCATE` e o servidor falso (P3-1, 2, 4, 5, 6,
  8, 10). **Ficam:** uma medida para o operador de uma fila parada
  (P3-3; até lá, o registo de erro de cada volta); a resposta da lista sem
  esquema no contrato e sem paginação além de 200 (P3-9); a idade máxima de
  uma notificação, que se decide quando houver a fila parada a sério (P2-2).
- **O e-mail vai para endereços não confirmados** (CE): por isso não leva o
  nome da pessoa nem texto livre além do nome da loja numa linha.
- **Por fazer:** a conta de e-mail, as cinco variáveis na VPS e o DNS
  (Diogo ou Bruno); os eventos `notification.sent` e `notification.failed`
  (sem quem os leia ainda); o ecrã no Hub.

## 12. Os avisos das tarefas vencidas por e-mail (desenho, 12/10/2026; #372)

O §9 deixou este aviso para «um pedido próprio». A peça 21 (`docs/33`, DW)
já marca um caso vencido uma vez por prazo e põe `task.overdue` na
`evento_saida` (`tarefas_marcar_vencida()` e `atribuicao_evento()`, migração
0066). Hoje o aviso só se vê na lista `GET /tasks?vencida=true`
(`src/tarefas/avisos.ts`: «Sem e-mail até haver notificações»). Esta parte
leva-o à fila de e-mails das §3–§4, sem mudar o fornecedor, o envio nem as
regras N4 a N11.

| # | O quê | Proposta | Fonte |
|---|---|---|---|
| T1 | **A quem** (Q12) | **A:** à pessoa **responsável** pelo caso, se houver; um caso **sem responsável** vai a quem pode **decidir a fila** e **atribuir** (`tasks:assign`, dono e gestor), isto é, os donos e gestores com o âmbito de decisão da fila (`docs/33` §1): na fila `pagamento` só os donos. **B:** sempre aos donos e gestores, como N2, e também ao responsável, se for de outro papel | `docs/33` R3, R8; `eu-gdpr-privacy` (minimização) |
| T2 | **Quando** | na mesma transacção da marca de vencido (a linha `vencida` do `atribuicao_rasto`), uma notificação por pessoa; nunca duas para a mesma pessoa e o mesmo aviso. Mudar o prazo para depois permite um aviso novo (R6): a `referencia` é a linha do rasto, não a atribuição | `docs/33` R6; N5 |
| T3 | **A fila `prazo_reembolso`** | **não** entra: tem os e-mails do §3 (R6: «não sai um segundo») | `docs/33` R6 |
| T4 | **O que diz** | a fila (o nome traduzido), o caso com o prefixo (`pdi_…`, `inv_…`, `dup_…`, `wdr_…`, `prb_…`, `rfd_…`; `src/tarefas/filas.ts`), o motivo da fila (código, da lista de valores dela), o prazo e há quanto venceu, a loja numa linha só, e a lista da API (`GET /tasks?vencida=true`), porque o Hub não tem o ecrã «A decidir» (parte 2). **Nenhum dado do cliente**, nem o motivo livre de uma mudança de prazo (`docs/33` §6: pode ter dados que alguém lá escreveu) | N3; `docs/33` §6 e §7 |
| T5 | **No envio** | o endereço lê-se no envio, como hoje (N9). Fica **cancelada**, com o código, se a pessoa já não estiver activa ou já não puder receber pela T1, ou se o caso já não esperar: saiu da fila, mudou de prazo ou de passagem (`tarefa_ja_nao_espera`) | §11, `notificacao_destino()` |
| T6 | **Língua** | a do Hub do comerciante, como os avisos do reembolso (§11, desvios) | N4 |
| T7 | **Dados pessoais** | os mesmos da N9 (a pessoa, não o endereço; 90 dias, **C**); o tratamento T10 do `docs/17` alarga-se: a finalidade passa a incluir os casos vencidos e, na A, os titulares passam a incluir o armazém e o apoio quando são responsáveis de um caso da fila `livre_resolucao` (`docs/33` §1: decidem-na); actualiza-se no mesmo pedido do código | `docs/17` T10 |

**O modelo:** o `tipo` da `notificacao` ganha `task.overdue`; nenhuma tabela
nova. Os `dados` levam a fila, o caso, o motivo, o prazo e a hora do aviso.

**Os testes que impedem o lançamento:**

- um caso vencido com responsável dá **uma** notificação, a dele;
- sem responsável, dá uma a cada pessoa da T1, e nenhuma ao armazém, ao
  apoio, a um membro que saiu ou a uma pessoa desactivada;
- a fila `pagamento` sem responsável só avisa os donos;
- `prazo_reembolso` não dá nenhuma;
- um prazo mudado para depois e vencido outra vez dá um aviso novo;
- um caso decidido, ou uma pessoa que deixou de poder, antes do envio dá
  `cancelada`;
- o corpo não tem dados do cliente nem o motivo livre; outro comerciante não
  vê as notificações deste.

**Como entra no código:** uma migração (o `tipo`, o gatilho no
`atribuicao_rasto`, o destino), os modelos PT, ES e EN, os testes e a
revisão do agente. Um pedido só.

## 10. Pergunta para o Diogo ou o Bruno

| # | Pergunta | Proposta |
|---|---|---|
| Q11 ✅ A (Diogo, 11/10/2026) | Aprovas o desenho (N1 a N11), com o fornecedor **A: OVH E-mail Pro** por agora (mantém o fornecedor único) ou **B: Lettermint** já (segundo fornecedor, com estado da entrega)? | A |
| Q12 | Aprovas o §12 (T1 a T7)? O aviso de um caso vencido vai **A:** ao responsável, ou, sem responsável, aos donos e gestores que decidem a fila, ou **B:** sempre aos donos e gestores, e também ao responsável? | A |
