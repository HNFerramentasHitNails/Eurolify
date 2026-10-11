# Notificações: o envio de e-mails (desenho, 11/10/2026)

> Pedido do Diogo, 11/10/2026: *«avança com o e-mail do aviso do prazo»*
> (issue #372). **Aprovado pelo Diogo a 11/10/2026, com o fornecedor A**
> (*«aprovado, com a A»*, à Q11; `docs/06`, DW). Primeira
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
| `notificacao` | `id`, `comerciante_id`, `tipo` (`refund.deadline_approaching`, `refund.deadline_passed`), `referencia` (a devolução), `pessoa_id`, `lingua`, `estado` (`a_enviar`, `enviada`, `falhada`), `tentativas`, `proxima_em`, `ultimo_erro` (código, sem dados pessoais), `id_mensagem` (o `Message-ID`), `criada_em`, `enviada_em` | RLS do comerciante; única por (`tipo`, `referencia`, `pessoa_id`); só se acrescenta e muda de estado para a frente (`a_enviar` → `enviada` ou `falhada`); grava-a o gatilho do aviso, não a API |

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
SMTP (biblioteca `nodemailer`, licença MIT — dependência nova, revista no
pedido) e o de ensaio, a tarefa no `servidor.ts`, os modelos PT/ES/EN, a
lista da API, os testes e a revisão do agente. Um pedido só.

## 9. Fora desta parte

- **Os e-mails ao cliente** que a lei pede em suporte duradouro: a
  confirmação da encomenda com as condições aceites e a confirmação da
  recepção do pedido de livre resolução (`consumer-rights-eu`). Esses não
  podem sair duas vezes nem perder-se, pedem o estado da entrega e volume:
  **decide-se o serviço transaccional antes deles**.
- Marketing (lê o consentimento, DL), preferências por pessoa, SMS e
  WhatsApp, webhooks aos sistemas dos comerciantes.

## 11. Em código (11/10/2026; migração 0066; `docs/06`, DW)

| O quê | Onde |
|---|---|
| `notificacao`, com o RLS do comerciante: gravada pelo gatilho do aviso do prazo, uma por dono e gestor activos e por aviso; estados só para a frente (`a_enviar` → `enviada`, `falhada` ou `cancelada`); a API não a grava nem a apaga | migração 0066 |
| `tarefa_notificacao`, interna (como as filas da 0047 e da 0063): diz à tarefa em que comerciantes entrar, sem ler a `notificacao` sem comerciante | migração 0066 |
| `notificacao_destino()`: o endereço e o nome lidos no envio, só se a pessoa continua activa e dona ou gestora; senão, a notificação fica `cancelada` | migração 0066; `src/notificacoes/repositorio.ts` |
| o correio por SMTP (`nodemailer` 10.0.10, licença MIT-0, sem dependências, de 14/09/2026 — a mais recente com mais de duas semanas) e o de ensaio; a classificação dos erros (4xx e rede repetem; 5xx falha logo) | `src/notificacoes/correio.ts` |
| os textos PT, ES e EN | `src/notificacoes/modelos.ts` |
| a tarefa de minuto a minuto (cada notificação na sua transacção, bloqueada; as esperas 1, 5, 30, 120 e 360 minutos; à 6.ª falha, `falhada`) e a limpeza dos 90 dias na mesma volta | `src/notificacoes/repositorio.ts`; `servidor.ts` |
| `GET /notifications?estado=` (`merchant:read`) | `src/notificacoes/rotas.ts` |
| 2 testes pela API e 4 sem base | `test/posvenda-api.test.ts`; `test/notificacoes-correio.test.ts` |

**Desvios do desenho:**
- **A língua é a do Hub do comerciante** (`comerciante.lingua`), não a do
  catálogo: o e-mail é para a equipa.
- **Sem ligação ao Hub** (N3): o Hub ainda não tem os ecrãs da pós-venda; o
  e-mail diz a lista da API (`GET /returns?prazo_reembolso=`).
- **Um quarto estado, `cancelada`**: a pessoa saiu, foi desactivada ou
  deixou de ser dona ou gestora antes do envio.
- **A configuração vai no `api.env` da VPS** (§5), não nos segredos do
  GitHub: é onde vivem as outras chaves da API.
- **Por fazer:** a conta de e-mail, as cinco variáveis na VPS e o DNS
  (Diogo ou Bruno); os eventos `notification.sent` e `notification.failed`
  (sem quem os leia ainda); o ecrã no Hub.

## 10. Pergunta para o Diogo ou o Bruno

| # | Pergunta | Proposta |
|---|---|---|
| Q11 ✅ A (Diogo, 11/10/2026) | Aprovas o desenho (N1 a N11), com o fornecedor **A: OVH E-mail Pro** por agora (mantém o fornecedor único) ou **B: Lettermint** já (segundo fornecedor, com estado da entrega)? | A |
