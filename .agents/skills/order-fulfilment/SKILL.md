---
name: order-fulfilment
description: Encomendas, stock e expedição no Eurolify — reserva de stock, disponível por canal, livro de movimentos, lotes, encomendas com estados claros e auditáveis, divisão em várias expedições, etiquetas e seguimento por adaptador de transportadora, devoluções (RMA) ligadas à nota de crédito, reembolsos parciais, trocas, e os eventos order.created, inventory.reserved, payment.authorized, payment.captured, shipment.dispatched, refund.completed. Usar ao desenhar ou alterar encomendas, stock, armazém, transportadoras ou devoluções.
---

# Encomendas, stock e expedição

> Estado: **desenho** — o código está autorizado (ADR-0023), mas o deste domínio só depois do desenho dele em tabela. Lições:
> `docs/04-licoes-dos-sistemas-actuais.md` §3.
> Complementares (05/10/2026): `eurolify-transport-logistics-eu` (rota, perigosos, frio, retorno) e `eurolify-physical-retail-eu` (recolha em loja, devolução noutro estabelecimento); coordenação em `eurolify-legal-briefing-eu`.

## Stock — as regras

1. **O stock só muda por movimento** num livro de movimentos (entrada, venda,
   reserva, libertação, devolução, ajuste de inventário, fabrico), com origem,
   quem, quando, antes e depois. **Saldo e movimento andam juntos** na mesma
   transacção. No Hub nada o obrigava e houve baixas a dobrar em 145 encomendas
   (Abr–Mai/2026) e duas portas que abatiam sem picagem
   (`proposta-venda-do-hub-30set2026.md`).
2. **Vende-se o disponível, não o físico.** Disponível = físico − reservado de
   **todos** os canais. O Hub mandava o físico à loja e a loja vendeu 2 coleções
   já prometidas a uma encomenda comercial; **216 de 1.259** artigos à venda
   estavam nessa situação (16/09/2026).
3. **Reserva com prazo**: nasce no checkout ou na encomenda pendente, liberta-se
   ao expirar ou cancelar, converte-se em saída ao expedir.
4. **Kits e coleções derivam** a disponibilidade dos componentes; vender um
   componente à peça actualiza os compostos que o levam.
5. **Lote** na entrada e **na linha expedida** (recolhas — `product-compliance-eu`).
6. **Stock negativo é erro**, não estado — a não ser em artigos marcados como
   «vende sem stock» (por encomenda).
7. **Vários armazéns** (Fase 2): disponível por armazém e regra de escolha.

## Encomenda — estados

```
pendente → paga → em_preparação → expedida(parcial | total) → entregue → concluída
    │         │          │
    └→ cancelada (com motivo, liberta reservas, avisa o domínio fiscal e o de pagamentos)
```

- Cada transição com **quem/o quê** a provocou e quando; transições só para a
  frente; correcção = nova transição com motivo, nunca reescrever.
- **Cancelar avisa toda a gente que precisa de saber** (documentos fiscais,
  pagamentos, stock, integrações) — no ecossistema, um cancelamento que ficava
  num sistema deixava o rascunho fiscal vivo noutro (lição 4.5).
- **Uma encomenda nunca entra por duas vias**: nos sistemas actuais, cada
  bilhete de evento gerava duas encomendas no armazém, uma pela Shopify e outra
  pela plataforma de formação (29/09/2026). Identificador externo único por origem.
- **Quem compra ≠ quem é faturado ≠ quem recebe**: três papéis na encomenda.
- **Portes são linha própria**, nunca um artigo — no Hub voltavam como artigo ao
  reabrir a encomenda e cobraram-se duas vezes (12 encomendas, 150,43 €, 16/09/2026).
- Uma encomenda só de **serviços** não leva portes (11/09/2026).

## Expedição

- Uma encomenda pode ter **várias expedições** (stock em sítios diferentes,
  artigos que esperam).
- **Adaptadores de transportadora** (CTT, DPD, GLS, agregadores como Sendcloud
  ou Packlink): cotação, etiqueta, seguimento, recolha — o núcleo nunca fala a
  língua de uma transportadora.
  Transportadoras por país, com fonte: `docs/07-pagamentos-e-envios-por-pais.md`.
- **Pagamento na entrega** (pesa 37–59 % no Leste — `docs/07` §3): é um serviço
  da transportadora, que cobra e entrega o dinheiro ao comerciante; o Eurolify
  regista o estado, nunca o dinheiro.
- **O serviço vendido é o serviço da etiqueta**: a etiqueta dos CTT saiu Via
  Aérea com Via Marítima cobrada (17/09/2026). E artigos perigosos recusam
  serviços incompatíveis **antes do checkout**.
- Espaço vazio da caixa e registos de embalagem: ver PPWR em
  `product-compliance-eu` (a confirmar).

## Devoluções (RMA)

**Critério: volta mercadoria ao armazém? ⇒ devolução. Não volta? ⇒ problema**
(`devolucoes-nao-tem-fluxo-15set2026.md`: 91 notas de crédito em 90 dias, zero
devoluções registadas, zero movimentos de devolução em 44.431).

| Passo | O que se guarda |
|---|---|
| Pedido | origem (botão de livre resolução, apoio ao cliente, comercial), linhas, motivo |
| Rota de retorno | a transportadora e a rota de volta admitem o artigo (a rota de ida não aprova a volta; perigosos com profissional) — `eurolify-transport-logistics-eu` |
| Recepção | o que chegou, quantidades, data |
| Inspecção | **estado do artigo** — cosmética aberta **não volta a stock** |
| Decisão | reembolso na Fase 1; troca e carteira na Fase 2 (`docs/05`) — regras fiscais em `eu-vat-oss-ioss` |
| Stock | só o que foi aceite volta, por movimento de devolução |

## Eventos

`order.created`, `order.cancelled`, `inventory.reserved`, `inventory.released`,
`payment.authorized`, `payment.captured`, `shipment.created`,
`shipment.dispatched`, `shipment.delivered`, `withdrawal.requested`,
`return.received`, `return.inspected`, `refund.completed`.

## Antes de dizer «está feito»

- [ ] Nenhum caminho mexe no saldo sem movimento.
- [ ] O disponível que sai para os canais desconta as reservas de todos.
- [ ] Cancelar uma encomenda paga com fatura emitida dispara o que tem de
      disparar (e só isso).
- [ ] A mesma encomenda recebida duas vezes da mesma origem não duplica.
