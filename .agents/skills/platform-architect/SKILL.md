---
name: platform-architect
description: Arquitectura do Eurolify — monólito modular multi-inquilino, fronteiras entre domínios (catálogo, preços, carrinho, checkout, encomendas, stock, clientes, pagamentos, IVA, documentos fiscais, envios, notificações), eventos de domínio com outbox, idempotência, versões de API e ADR; e as capacidades comuns do Hub — linha do tempo de cada registo, tarefas com dono e prazo, módulos ligáveis por comerciante e as 8 portas para decidir se um módulo deve existir. Usar ao desenhar ou alterar um domínio, ao decidir onde vive uma regra, ao pensar em partir um módulo em serviço, e antes de registar qualquer decisão de arquitectura.
---

# Arquitecto da plataforma

> Estado: **desenho** — o código está autorizado (ADR-0023), mas o deste domínio só depois do desenho dele em tabela. Base: `docs/02-arquitectura.md`.

## Quando usar

- Desenhar um domínio novo ou mexer na fronteira entre dois.
- Decidir **onde vive uma regra** (resposta quase sempre: no domínio dono, no
  servidor, uma vez).
- Avaliar «partir isto num serviço à parte».
- Escrever um ADR.

## As regras que não se negociam

1. **Monólito modular primeiro.** Um serviço, uma base de dados, módulos com
   fronteiras escritas. Partir em serviços só com números: carga que um módulo
   não aguenta, equipa própria, ritmo de publicação diferente. «Fica mais
   limpo» não é número.
2. **Cada dado tem um dono.** Um domínio só lê outro pela API interna ou pelos
   eventos dele — **nunca pelas tabelas**. Se dois domínios escrevem o mesmo
   campo, a fronteira está errada.
3. **Multi-inquilino em todas as tabelas.** O identificador do comerciante está
   em todas as linhas e o isolamento é **imposto pela base** (políticas por
   inquilino), com testes que tentam ler o vizinho e têm de falhar.
4. **A decisão vive no servidor, uma vez.** Lição paga no Hub: a isenção de
   IVA escrita duas vezes divergiu na ordem e a #D4248 saiu com IVA
   (`docs/04-licoes-dos-sistemas-actuais.md`, 2.1 e 4.9). Uma cópia inevitável
   para o ecrã responder depressa **anota-se dos dois lados** e nunca é a
   autoridade.
5. **Eventos de domínio com outbox.** O evento grava-se **na mesma transacção**
   que a mudança de estado e é publicado depois. Nunca «gravar e depois tentar
   avisar» — é assim que um cancelamento fica num sistema e o rascunho fiscal
   fica vivo noutro (lição 4.5).
6. **Idempotência em todas as escritas** que venham de fora (API, avisos de
   fornecedores, tarefas repetidas). O mesmo pedido duas vezes dá o mesmo
   resultado uma vez (lição 4.4: a carteira creditada 5 vezes).
7. **Nada falha em silêncio.** Um erro devolve-se, regista-se e, se for de um
   aviso de fora, provoca reenvio. «Não encontrei» é um erro (lição 4.1).
8. **Listas de valores num sítio só** (estados, tipos, motivos). Um valor novo
   num ecrã sem o mesmo valor na base é o `23514` do Hub (lição 4.6).
9. **Excepção temporária tem data de fim** escrita no código e um alarme
   quando passa (lição 2.11: 277 faturas por uma rede que ninguém tirou).

## Os domínios e os seus eventos

| Domínio | Eventos principais |
|---|---|
| Comerciante | `merchant.created`, `merchant.status_changed`, `legal_entity.created`, `store.created` |
| Catálogo | `product.created`, `product.updated`, `product.published`, `product.unpublished`, `product.archived` |
| Preços e mercados | `price.changed`, `promotion.started`, `promotion.ended` |
| Carrinho / checkout | `cart.updated`, `checkout.completed` |
| Encomendas | `order.created`, `order.cancelled`, `order.completed` |
| Stock | `inventory.reserved`, `inventory.released`, `inventory.adjusted` |
| Clientes e identidade fiscal | `customer.created`, `billing_profile.validated`, `customer.merged`, `consent.changed` |
| Documentos fiscais | `invoice.requested`, `invoice.retained`, `invoice.issued`, `credit_note.issued` |
| Pagamentos | `payment.authorized`, `payment.captured`, `payment.failed`, `refund.completed` |
| Envios | `shipment.created`, `shipment.dispatched`, `shipment.delivered` |
| Devoluções | `withdrawal.requested`, `return.received`, `return.inspected` |
| Privacidade | `dsar.received`, `dsar.completed` |

**Regras dos eventos:** nome no passado, identificador único, versão do
formato, inquilino, momento em UTC, e o mínimo de dados (o resto pede-se pela
API). Quem consome é idempotente pelo identificador do evento.

## Capacidades comuns a todos os domínios (para o Hub)

Ideias de desenho vistas nos guias do repositório `mart337i/odoo-skills` e
adaptadas ao Eurolify — não se usa o Odoo (memória
`odoo-skills-avaliado-03out2026.md`).

### Linha do tempo de cada registo

- Encomendas, clientes, artigos, devoluções e documentos retidos têm uma
  **linha do tempo** que a equipa do comerciante vê: mudanças de estado e dos
  campos escolhidos (quem, quando, antes → depois), notas da equipa, e-mails e
  avisos enviados, anexos.
- Alimenta-se dos **eventos de domínio** e do registo de auditoria
  (`observability-security`); não é outra fonte de verdade. As entradas do
  sistema não se editam nem se apagam.
- Respeita as permissões: quem não vê um campo também não vê as mudanças dele.
- Notas, e-mails e anexos sobre clientes são **dados pessoais**: entram na
  exportação e no apagamento do titular (`eu-gdpr-privacy`) e nunca nos
  registos técnicos.

### Tarefas sobre um registo

- Uma tarefa liga-se a um registo e tem **uma pessoa responsável, um prazo e
  um estado** (aberta, feita, cancelada — com quem a fechou e quando).
- As filas que pedem decisão humana — documentos fiscais retidos, fusões de
  clientes, correcções e reenvios fiscais — criam tarefas: cada item é decidido
  por uma pessoa, **nunca em lote** (`AGENTS.md`, «Não se erra em documentos
  fiscais», regra 5).
- Tarefa vencida ⇒ aviso a quem a tem e a quem gere a equipa: nada fica parado
  em silêncio (regra 7).

### Módulos ligáveis por comerciante (Fase 2)

- Cada módulo declara **de que módulos depende** e traz **as suas permissões e
  os seus dados**. A fronteira segue um conceito de negócio (devoluções, vários
  armazéns), não ficheiros técnicos.
- Desligar um módulo avisa antes se outro depende dele, e **nunca apaga** dados
  com obrigação legal (os documentos fiscais ficam 10 anos).
- Os dados que o Eurolify entrega feitos dividem-se em duas classes, escrita em
  cada um:
  1. **instalados uma vez e depois do comerciante** (modelos de e-mail,
     textos, automações de exemplo): uma actualização do Eurolify **nunca
     reescreve** o que o comerciante mudou. Se a versão do Eurolify mudar —
     por exemplo, por causa de uma lei nova — o comerciante é avisado e vê a
     diferença;
  2. **do Eurolify, actualizados sempre** (listas de países, estados,
     motivos): o comerciante não os muda (regra 8).
- Os textos legais seguem também a regra das versões da `consumer-rights-eu`:
  versão nova, nunca editar a antiga.

### Antes de construir um módulo: as 8 portas

Adaptadas da skill `odoo-idea-gates` do mesmo repositório. Passa-se pelas
portas por ordem e pára-se na primeira que falha. Construir ou não decide o
Diogo ou o Bruno.

| # | Porta | Passa quando | Falha quando |
|---|---|---|---|
| 1 | **Conhecemos o problema por dentro** | Vimos a dor nos sistemas actuais (`docs/04`, `memoria/`) ou falámos com comerciantes que a têm | A ideia veio de ver o que outros fazem, sem ninguém que a viva |
| 2 | **Ainda não está resolvido** | Depois de ver o que já existe — um domínio do Eurolify, configuração, um adaptador ou uma extensão de terceiros (`docs/08`), um serviço de fora — fica uma falha clara | Já existe e pode usar-se, configurar-se ou ligar-se |
| 3 | **Já se gasta dinheiro ou tempo nisto** | Os comerciantes já pagam extensões, consultores, folhas de cálculo ou horas por causa disto | Ninguém gasta nada perto do problema: a procura teria de ser criada |
| 4 | **Chegamos a quem compra** | Conseguimos nomear 50 comerciantes que o usariam e falar com 5 numa semana | O comprador é abstracto |
| 5 | **O primeiro alvo é estreito** | A primeira versão serve um tipo de comerciante, um papel e um fluxo | Serve toda a gente e todos os fluxos |
| 6 | **Encaixa no Eurolify** | Cabe num domínio existente, ou num novo com fronteira clara, e não mexe nas regras fiscais nem legais (não são extensíveis, decisão K) | Força excepções às regras, cópias de regras ou acessos largos aos dados |
| 7 | **O custo de manter compensa** | Segurança, isolamento entre comerciantes, migrações, risco fiscal e testes são proporcionais à dor | Uma dor pequena pede mudanças fundas e arriscadas |
| 8 | **O valor aparece depressa** | O comerciante vê valor em menos de 30 minutos, sem reorganizar a loja nem limpar dados | Só se vê valor depois de semanas de configuração |

**Saída:** **matar** (diz a porta que falhou), **estreitar** (guarda a ideia,
encolhe o alvo), **investigar** (falta prova: qual é o passo mais pequeno para
a obter) ou **avançar** (a fronteira do módulo e como se valida). Escreve-se o
resultado de cada porta (passa, falha, não se sabe).

## Versões da API

- Versão por data (ex.: `2027-01`), suportada pelo menos 12 meses.
- Mudança que parte clientes ⇒ versão nova, anúncio, período de convivência.
- **Fixar a versão dos fornecedores** de que dependemos e testá-la: a mudança
  de versão da API do Stripe pôs as renovações a desistir em silêncio no
  projecto Cila Santos (lição 4.2).

## Como escrever um ADR

Modelo em `docs/adr/0000-modelo.md`. Obrigatório: contexto com números e fonte,
opções com prós e contras, decisão numa frase, consequências (incluindo o que
pode partir) e, se for temporária, **data de fim**. Um ADR aceite não se edita:
substitui-se por outro.

## Anti-padrões (vistos nos sistemas actuais)

- Duas funções com nomes parecidos que respondem à mesma pergunta.
- Um `if` no ecrã que repete uma trava da base.
- Uma integração que escreve directamente nas tabelas de outro domínio.
- `try { … } catch {}` à volta de uma chamada que devolve o erro em vez de o
  lançar — a raiz 3 do ecossistema, «o sistema falha em silêncio».
- Uma lista cortada aos 1.000 sem aviso (lição 4.7).

## Antes de dizer «está feito»

- [ ] Cada dado novo tem um dono e só um.
- [ ] A regra nova vive num sítio; as cópias estão anotadas.
- [ ] Os eventos gravam-se na mesma transacção que o estado.
- [ ] Há teste de isolamento entre inquilinos para as tabelas novas.
- [ ] O registo novo tem linha do tempo e, se pede decisão humana, tarefa com
      dono e prazo.
- [ ] Respondi a «por onde é que isto ainda pode sair errado?».
- [ ] Módulo novo: passou pelas 8 portas, com o resultado escrito.
- [ ] O ADR está escrito, se a decisão muda a arquitectura.
