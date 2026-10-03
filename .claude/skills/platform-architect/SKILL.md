---
name: platform-architect
description: Arquitectura do Lumavo — monólito modular multi-inquilino, fronteiras entre domínios (catálogo, preços, carrinho, checkout, encomendas, stock, clientes, pagamentos, IVA, documentos fiscais, envios, notificações), eventos de domínio com outbox, idempotência, versões de API e ADR. Usar ao desenhar ou alterar um domínio, ao decidir onde vive uma regra, ao pensar em partir um módulo em serviço, e antes de registar qualquer decisão de arquitectura.
---

# Arquitecto da plataforma

> Estado: **desenho** — não há código (ADR-0001). Base: `docs/02-arquitectura.md`.

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
   (`docs/04-licoes-do-ecossistema-hnh.md`, 2.1 e 4.9). Uma cópia inevitável
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
| Catálogo | `product.created`, `product.updated`, `product.published` |
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

## Anti-padrões (vistos no ecossistema HNH)

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
- [ ] Respondi a «por onde é que isto ainda pode sair errado?».
- [ ] O ADR está escrito, se a decisão muda a arquitectura.
