# Webhooks de saída — as subscrições, a assinatura e as entregas

> **Estado: desenho escrito sob a autorização geral do Diogo de 16/10/2026;
> à espera do OK dele no pedido.** Issue #473 (a peça 12 do `docs/10`: a
> tabela `evento_saida` do `docs/18` §5 grava-se, mas não tinha publicador).
> Traz também a primeira fatia de código (migrações 0107 e 0108,
> `apps/api/src/webhooks/`). O que for **proposta** está marcado; as
> decisões que o Diogo deve ver estão na §11.
>
> Skills seguidas: `headless-commerce` («Webhooks»: assinados com HMAC e
> carimbo, identificador do evento, reenvio com recuo durante 72 h, registo de
> entregas com botão de reenviar, mínimo de dados), `observability-security`
> (segredos, auditoria, abuso e SSRF) e `eu-gdpr-privacy` (mínimo de dados
> pessoais fora do Eurolify).
>
> **Marca W/M/C** (`docs/03`): este documento **não cita nenhuma regra
> fiscal nem legal da UE como fonte**. Não consultei o repositório `eur-lex`:
> não há aqui artigo de lei a ler. O que é decisão interna (limites, prazos,
> janelas) é **M**; o que depende de lei ou de contabilista/jurista é **C** e
> está dito (§9). Nada disto chega a um ecrã.

## 1. O que entra e o que não entra

| Entra (fatia 1) | Fica para depois |
|---|---|
| Subscrições por comerciante: endereço https, tipos de evento, segredo cifrado, estado | Âmbito próprio `webhooks:*` e aplicações de terceiros com OAuth (§4) |
| A distribuição dos eventos da outbox (0021) pelas subscrições | Os outros eventos que **já se escrevem** na outbox (`order.*`, `payment.*`, `customer.*`, `shipment.*`, `task.*`, desde as 0040 a 0102): entram no catálogo um a um, depois de decidir campo a campo o que sai. Até lá a distribuição **não lhes toca** e ficam por publicar |
| Assinatura HMAC com carimbo e janela contra repetição | Rotação do segredo com período de sobreposição (dois segredos válidos) |
| Novas tentativas com recuo durante 72 h; desistência | Pausa automática da subscrição que só falha (§7) |
| Registo de entregas e botão de reenviar (API de Administração) | Ecrã no Hub (`eurolify-design`); a API chega-lhe |
| Defesa contra SSRF (endereços privados) | Lista de endereços IP de saída fixos para o receptor filtrar |
| O envio é pelo registo de entregas e pelo reenvio | Um evento de teste (`ping`) e o prazo de guarda e limpeza dos eventos publicados e das entregas (§7) |

## 2. Fluxo

1. Uma mudança escreve o evento na outbox, **na mesma transacção** (0021).
2. O publicador (uma volta a cada 15 s, em segundo plano) toma os eventos por
   publicar de cada comerciante com webhooks e cria **uma entrega por
   subscrição activa** que pediu aquele tipo (`webhook_distribuir`, 0108);
   o evento fica «publicado» (= distribuído).
3. Cada entrega vencida envia-se em três passos (como as notificações,
   `docs/34`): toma-se a vez numa transacção curta, faz-se o pedido HTTP fora
   da transacção, grava-se o resultado noutra.
4. Um 2xx entrega; qualquer outra coisa (outro estado, erro de ligação, tempo
   esgotado) falha e repete com recuo, até desistir.

Ex.: o Alfa subscreve `price.changed`; às 12:00:00 um preço muda; às 12:00:15
sai um `POST` assinado para o endereço dele; o receptor responde 500; repete
às 12:01, 12:06, 12:36…; ao fim de 72 h desiste e o Alfa vê «desistida» no
registo, com o botão de reenviar.

## 3. Modelo (migrações 0107 e 0108)

**`webhook_subscricao`** — RLS por comerciante.

| Coluna | Tipo | Nota |
|---|---|---|
| `id` | uuid v7 | prefixo público `whk_` |
| `comerciante_id` | uuid | RLS |
| `url` | texto | `https://…`, ≤ 2000; a API valida mais (§8) |
| `descricao` | texto, nulo | 1 a 200 |
| `eventos` | texto[] | 1 a 30 tipos do catálogo (§5); a base tem a mesma lista num CHECK |
| `segredo_cifra`, `chave_versao` | bytea, texto | o segredo `whsec_…` **só cifrado** (AES-256-GCM, chave `WEBHOOKS_CHAVE` fora da base; conta e campo como dado associado, como as credenciais dos pagamentos). O HMAC precisa do segredo em claro no envio, por isso não se guarda um resumo |
| `estado` | texto | `activa`, `pausada`, `desactivada` (terminal) |
| `criada_em/por`, `actualizada_em/por`, `versao` | | `por` = `chave:key_…`; `versao` para o `PATCH` |

Uma subscrição **não se apaga** (gatilho): desactiva-se, para as entregas
guardarem a história. A identidade dela não muda.

**`webhook_entrega`** — RLS por comerciante; uma linha por (subscrição, evento).

| Coluna | Tipo | Nota |
|---|---|---|
| `id` | uuid v7 | prefixo `whd_` |
| `subscricao_id`, `evento_id` | uuid | únicos em conjunto: o mesmo evento não se entrega duas vezes à mesma subscrição |
| `estado` | texto | `pendente`, `entregue`, `desistida`, `cancelada` |
| `tentativas`, `reenvios` | inteiros | as tentativas recomeçam a 0 num reenvio |
| `proxima_em`, `prazo_ate` | instantes | `prazo_ate` = criação + 72 h |
| `ultimo_estado_http`, `ultimo_erro` | inteiro, texto | só o código HTTP e um código curto (`webhooks.timeout`…); **nunca o corpo da resposta** (pode ter dados pessoais do receptor) |

O corpo **não se guarda**: monta-se do evento no envio (§6). **`webhook_comerciante`**
é interna (sem RLS, a API não lhe toca): lista os comerciantes com webhooks, porque
a outbox tem RLS e o publicador não a pode ler entre comerciantes.

## 4. API de Administração (contrato OpenAPI; escritas com `Idempotency-Key`)

| Rota | Âmbito | O que faz |
|---|---|---|
| `GET /webhook-event-types` | `merchant:read` | os tipos subscritíveis e os campos de cada um |
| `GET /webhook-subscriptions` | `merchant:read` | as subscrições (sem segredo) |
| `POST /webhook-subscriptions` | `keys:write` | cria; devolve o segredo **uma vez**; repetir a chave de idempotência dá `idempotency.secret_not_repeated` |
| `GET /webhook-subscriptions/{id}` | `merchant:read` | uma subscrição |
| `PATCH /webhook-subscriptions/{id}` | `keys:write` | `versao` + endereço, eventos, descrição, estado |
| `GET /webhook-deliveries` | `merchant:read` | o registo, das mais recentes; filtros `subscricao`, `estado`; cursor `depois` |
| `POST /webhook-deliveries/{id}/resend` | `keys:write` | reenvia uma entrega entregue, desistida ou cancelada (a subscrição tem de estar activa) |

Erros: `webhooks.not_found` 404, `webhooks.url_invalid` 422,
`webhooks.version_conflict` 409, `webhooks.limit` 409 (no máximo 20 subscrições
não desactivadas, **M**), `webhooks.invalid_transition` 409,
`webhooks.not_resendable` 409, `webhooks.not_configured` 503 (sem
`WEBHOOKS_CHAVE`).

**Âmbitos — proposta.** Sem âmbito novo: ler com `merchant:read`, escrever com
`keys:write` (hoje só o dono), porque um webhook é uma credencial de saída e um
destino para onde saem dados da loja. Um âmbito `webhooks:read/write` toca no
CHECK das chaves, em `papel_ambitos` e nas duas listas do TypeScript, e só
compensa quando houver aplicações de terceiros (OAuth, `docs/21`).

## 5. Eventos e catálogo

Os tipos subscritíveis são os que a outbox já escreve (`docs/18` §5):
`product.published`, `product.unpublished`, `product.archived`,
`price.changed`, `market.activated`, `market.archived`. Um evento novo só
passa a sair quando se acrescenta ao catálogo do código (`eventos.ts`), à
lista do CHECK e a este quadro. A distribuição (`webhook_distribuir`) só toma
os tipos do catálogo: os outros eventos da outbox ficam por publicar. Um
evento só chega a subscrições **que já existiam quando foi escrito** e estavam
**activas** quando a distribuição o tomou: não há reenvio do passado nem do
que se perdeu durante uma pausa (§10).

## 6. O pedido

`POST` para o endereço, `Content-Type: application/json`, com:

| Cabeçalho | Valor |
|---|---|
| `Eurolify-Event-Id` | `evt_<uuid>`: o receptor deduplica por ele (o mesmo em todas as tentativas) |
| `Eurolify-Event-Type` | ex.: `product.published` |
| `Eurolify-Delivery-Id`, `Eurolify-Delivery-Attempt` | a entrega e a tentativa (1, 2…) |
| `Eurolify-Signature` | `t=<segundos UTC>,v1=<HMAC-SHA256 em hex de "<t>.<corpo>">` |

Corpo: `id`, `tipo`, `versao_esquema`, `criado_em`, `agregado {tipo, id}` e
`dados`. **Só os campos de cada tipo que a lista do código permite**, com os
identificadores com o prefixo público (`prd_`, `pub_`, `chn_`, `mkt_`, `prl_`,
`var_`, `sto_`). Um campo novo na outbox **não sai** até alguém o acrescentar à
lista (lista de permitidos, não de proibidos).

**Assinatura e repetição.** O receptor recalcula o HMAC com o segredo,
compara em tempo constante e recusa carimbos com mais de **300 s** de
diferença (**M**; `verificarAssinatura` está no código, para o SDK). Cada
tentativa assina com o carimbo do momento. Um pedido capturado e repetido
mais tarde falha na janela; um carimbo alterado falha no HMAC, porque o
carimbo está dentro do que se assina.

## 7. Novas tentativas, desistência e guarda

- Tentativa 1 de imediato; depois da falha *n*, espera de 1, 5, 30, 120, 360,
  720, 1440, 1440 e 1440 minutos (**M**); a espera nunca passa de `prazo_ate`
  (72 h): a última tentativa cai nele e, falhando, a entrega fica
  `desistida`. São 10 tentativas ao todo.
- Um 2xx é sucesso. **Qualquer outro código repete**, incluindo 4xx: um erro
  do receptor costuma corrigir-se em horas (**M**). Redirecções não se seguem
  (contam como falha). **Prazo total de 10 s por pedido**, DNS e ligação
  incluídos (cabeçalhos a pingar ou `100 Continue` sem fim não o adiam); depois
  do código HTTP a ligação fecha-se sem ler a resposta. Cada comerciante tem um
  tecto de 60 s por volta: o que ficar por enviar vence na volta seguinte e um
  receptor lento não pára os dos outros.
- Se o processo parar a meio, a entrega volta passados 10 minutos (pode sair
  duas vezes: por isso o `Eurolify-Event-Id`).
- Subscrição **pausada**: as entregas por enviar esperam (sem gastar
  tentativas, a olhar de 10 em 10 minutos) e não recebe eventos novos;
  **desactivada**: as entregas por enviar cancelam-se logo, no mesmo pedido
  que desactiva.
- O resultado só se grava se a entrega ainda estiver `pendente` na mesma
  tentativa que se reservou: uma volta presa não escreve por cima de outra.
- Sem a chave do segredo (troca da `WEBHOOKS_CHAVE` sem a anterior) a entrega
  **não gasta tentativa**: espera 10 minutos e tenta outra vez, até ao prazo.
  `WEBHOOKS_CHAVE_ANTERIOR` (com `_VERSAO`) só decifra, nunca cifra.
- Uma entrega cujo evento não existe desiste logo (`webhooks.event_missing`).
- **Reenviar** (botão): volta a `pendente`, com o recuo e o prazo de 72 h de
  novo.
- Falta (§10): pausa automática de uma subscrição que só falha, e o prazo de
  guarda do `docs/18` §5 (`DELETE` só do que está publicado e fora do prazo).

## 8. O que nunca sai e o que protege o Eurolify

**Nunca sai** (`docs/06` CH, `docs/18` §5, `eu-gdpr-privacy`): `quem` (a pessoa
ou a chave que fez a mudança), nem nomes, e-mails, moradas, NIF ou qualquer
dado de clientes; o corpo leva identificadores e o que mudou, e o receptor
pede o resto à API, que verifica as permissões. Nenhum dos seis tipos de hoje
tem dados pessoais de clientes; os eventos futuros (`customer.*`, `order.*`)
só entram depois de se decidir campo a campo (**M**).

**SSRF** (`observability-security`): o comerciante escolhe para onde o
Eurolify faz um pedido, e sem regras podia apontar à rede interna da VPS ou ao
serviço de metadados. Só https, porta 443, sem `utilizador:senha@`, sem
fragmento, nome com ponto (nada de `localhost`, `.internal`, `.local`…) e, se
for um IP, só público. **Verifica-se ao guardar e outra vez ao enviar**,
resolvendo o nome nesse momento e ligando ao IP verificado (contra DNS
rebinding); se qualquer resposta do DNS for privada, não se liga.

**Segredo:** só se mostra na criação; na base só cifrado; nunca nos registos,
nas listas, na resposta guardada da idempotência nem nos erros. Perdido ou
exposto: desactiva-se a subscrição e cria-se outra (a rotação com
sobreposição fica para depois).

## 9. Isolamento entre comerciantes

- `webhook_subscricao` e `webhook_entrega` têm RLS forçado
  (`comerciante_actual()`); a API não tem privilégio na outbox.
- `webhook_distribuir` e `webhook_evento_da_entrega` são funções do dono presas
  ao comerciante da transacção: sem esse contexto não fazem nada (o RLS da
  outbox é forçado também para o dono), e o evento de uma entrega só se lê no
  comerciante dela. O publicador corre **um comerciante de cada vez**, numa
  transacção com o contexto dele.
- Testes que falham sem a protecção: outro comerciante não vê, não muda, não
  reenvia, e as subscrições dele com o mesmo tipo não recebem eventos alheios
  (`apps/api/test/webhooks-api.test.ts`).
- **C** (jurista/DPO, antes do primeiro comerciante de fora): o endereço do
  receptor pode estar fora da UE; o que sai são identificadores, mas o
  comerciante responde por onde os envia. Não verifiquei texto de lei.

## 10. Por onde é que isto ainda pode sair errado

| Risco | Estado |
|---|---|
| O receptor processa o mesmo evento duas vezes (reenvio, processo parado a meio) | Mitigado: `Eurolify-Event-Id` estável; **o receptor tem de deduplicar** (dizê-lo na documentação pública) |
| Eventos sem subscrição ficam por publicar (`publicado_em IS NULL`) para sempre, e o índice cresce | **Aberto**: só entram no publicador os comerciantes com webhooks; falta o prazo de guarda do `docs/18` §5 |
| Subscrição pausada perde os eventos desse período; não há repetição do passado | Assumido e dito na §5; um «reenviar tudo desde» é pedido próprio |
| Entregas por enviar de uma subscrição pausada para sempre | Aberto: sem prazo de limpeza |
| O receptor está sempre em baixo e queima o recuo de milhares de eventos | Aberto: falta a pausa automática (proposta: pausar depois de 20 entregas desistidas seguidas e avisar a equipa pela fila de notificações, `docs/34`) |
| Ordem dos eventos | Garantida só dentro da mesma linha de origem (`docs/18` §5); as entregas vencidas enviam-se por `proxima_em`, e um 500 de um evento deixa o seguinte passar à frente. O receptor ordena por `criado_em` do corpo |
| Uma volta de 50 entregas bloqueia nas respostas lentas | Mitigado: prazo total de 10 s por pedido e tecto de 60 s por comerciante; o envio continua em série (com muitos comerciantes pede concorrência limitada) |
| Duas instâncias da API a correr o publicador | Mitigado: `FOR UPDATE SKIP LOCKED` na distribuição e na vez; pode haver envio duplicado (acima) |
| Relógio do receptor desfasado mais de 300 s | Recusa legítima; documentar a janela |
| Alguém com a chave do dono cria um webhook para exfiltrar | Mitigado: só vão identificadores e `keys:write` é do dono; criar fica no rasto (`criada_por`); **falta** a tabela de auditoria imutável das mudanças às subscrições |
| Os próprios testes não tocam a rede nem o DNS reais | Parcial: o emissor verdadeiro testa-se contra servidores locais lentos (sem TLS); o TLS a sério e o DNS real não se verificaram |
| O IP público da própria VPS e o `192.88.99.0/24` passam o filtro de endereços | Aceite enquanto a API é de confiança; ao abrir a terceiros, acrescentar o IP da VPS à recusa |
| `webhook_comerciantes()` está ao alcance da API (dá os identificadores dos comerciantes com webhooks) e o URL completo aparece a quem só lê | Aceite, dito ao Diogo |

## 11. Decisões para o Diogo

| # | Decisão | Proposta |
|---|---|---|
| W1 | Âmbitos: reutilizar `merchant:read` e `keys:write` | sim, até haver aplicações de terceiros |
| W2 | As funções do dono dão ao publicador o acesso à outbox (o `docs/18` §5 previa um utilizador da base próprio, criado fora das migrações, com `BYPASSRLS`) | funções, porque o migrador não cria papéis e fica tudo preso ao comerciante; o utilizador próprio pode vir depois, sem mudar o contrato |
| W3 | Qualquer não-2xx repete (também 4xx) | sim |
| W4 | Recuo e prazo: 10 tentativas até às 72 h | sim (72 h é da skill; as esperas são nossas) |
| W5 | Máximo de 20 subscrições por comerciante; janela de 300 s | sim (**M**) |
| W6 | Pausa automática e guarda dos eventos | pedido seguinte, antes de ligar a mais de um comerciante |

## 12. O que não foi verificado

- O envio HTTPS verdadeiro contra um servidor real (os testes trocam a rede).
- A carga: uma volta com milhares de entregas.
- Os pedidos de alteração em curso 0104–0106 podem mexer nos mesmos testes
  de contagem (`comerciante.test.ts`, `seguranca-base.test.ts`): o primeiro
  a juntar resolve o conflito.
- Nenhuma fonte de lei foi lida (§ no início).
