---
name: payments-psd2-sca
description: Pagamentos no Eurolify — camada de adaptadores para prestadores (EuPago, Stripe, Adyen, Mollie…), intenção de pagamento, autorização, captura, anulação, reembolso, disputa e conciliação, máquina de estados, autenticação forte (SCA/3DS2), nunca guardar dados de cartão nem fundos de terceiros, avisos assinados, idempotência, falhas e reenvios. Usar ao desenhar ou alterar qualquer fluxo de dinheiro, método de pagamento, aviso de um prestador ou conciliação.
---

# Pagamentos (PSD2 e autenticação forte)

> Estado: **desenho** — o código está autorizado (ADR-0023), mas o deste domínio só depois do desenho dele em tabela. Fontes: `docs/03-regulamentar-ue.md`
> §5. Decisão ligada: D-5.

## Quando usar

- Método de pagamento novo, prestador novo, conta nova.
- Qualquer mudança de estado de um pagamento ou reembolso.
- Avisos (webhooks) de prestadores e conciliação com o banco.

## 🔴 As duas fronteiras

1. **O Eurolify nunca recebe nem guarda o dinheiro dos comerciantes.** Cada
   comerciante liga a **sua** conta no prestador. Guardar fundos de terceiros é
   prestar um serviço de pagamento e exige licença (PSD2 — **C**). Se um dia
   houver marketplace, o dinheiro reparte-se pelo produto de plataformas do
   prestador (Stripe Connect, Adyen for Platforms, Mollie Connect), nunca por
   uma conta do Eurolify.
2. **O Eurolify nunca toca em dados de cartão.** Páginas ou componentes alojados
   pelo prestador; a autenticação forte (3DS2) é do prestador. Fora do âmbito
   PCI pesado por construção.

## A régua método → prestador → conta

Desenho que o Bruno escolheu para a plataforma de formação a 29/09/2026
(`academy-piloto-eupago-desenho-29set2026.md`, repo `claude`), generalizado:

| Método | Prestador | Conta | Activo | Mercados |
|---|---|---|---|---|
| MB WAY | EuPago | Formação / Produtos | sim | PT |
| Multibanco | EuPago | … | sim | PT |
| Klarna | Stripe | … | sim | PT, ES… |
| Cartão, Apple Pay, Google Pay | Stripe (ou EuPago) | … | … | todos |

- **Tabela no servidor**, que o comerciante muda sem código.
- **A conta escolhe-se pelo que se vende, nunca pelo domínio** (hoje há duas
  contas EuPago, uma para formação e outra para produtos).
- Quando um prestador não deixa escolher os métodos por pedido (o Pay By Link da
  EuPago não deixa — resumo de 29/09), **a escolha do método faz-se no checkout
  do Eurolify**, antes de sair para o prestador.
- Métodos por país: **`docs/07-pagamentos-e-envios-por-pais.md`** (27 países,
  com fonte, 03/10/2026). O pagamento na entrega é um serviço da transportadora:
  o Eurolify nunca toca no dinheiro.

## Máquina de estados do pagamento

```
criado → a_aguardar_cliente → autorizado → capturado → (reembolsado_parcial | reembolsado)
             │                    │
             ├→ falhado           └→ anulado
             └→ expirado
capturado → em_disputa → (ganha | perdida)
```

- Cada transição tem **origem** (aviso do prestador, consulta, pessoa) e o
  **evento em bruto** guardado.
- Transições só para a frente; uma transição impossível (ex.: `reembolsado →
  autorizado`) é **erro registado**, não se ignora.
- **Multibanco paga-se horas ou dias depois**; o link que expira pode **não
  avisar** (EuPago, segundo uma biblioteca de terceiros — não confirmado) ⇒
  tarefa que consulta os pendentes e marca `expirado`.

## Avisos dos prestadores (webhooks)

1. **Verificar a assinatura** (HMAC, chave por canal) antes de ler.
2. **Gravar o evento em bruto** e o seu identificador, **depois** responder.
3. **Idempotência pelo identificador do evento**: o mesmo aviso duas vezes não
   conta duas vezes (no projecto Cila Santos, um reenvio podia contar uma
   prestação a dobrar e cancelar a subscrição — `cila-renovacoes-stripe-07ago2026.md`).
4. **Falhou o processamento ⇒ responder erro (5xx)** para o prestador reenviar.
   Responder 200 a um aviso que não se percebeu foi o que deixou 14 de 22
   subscrições paradas sem ninguém saber (mesma memória).
5. **Versão da API do prestador fixada e testada.** A mudança de versão do
   Stripe mudou três campos de sítio e o código não deu erro — desistiu.

## Captura, reembolso, disputa

- Captura na expedição ou no pagamento, **por comerciante e por tipo de artigo**
  (serviços e bilhetes capturam já; produtos podem capturar à expedição).
- Reembolso **ligado à nota de crédito** e à devolução; reembolso parcial com
  as linhas a que corresponde.
- Por omissão, o reembolso vai para o **mesmo meio** de pagamento (é o que diz
  a política da loja online actual, lida a 03/10/2026).
- Disputas: prazo, provas (confirmação da encomenda, prova de entrega, aceitação
  das condições) reunidas automaticamente.

## Conciliação

- Cada pagamento tem **a nossa referência** (`identifier`) igual à do prestador
  — no módulo financeiro actual a conciliação EuPago já casa por essa referência.
- Os pagamentos de um dia/liquidação do prestador ligam-se ao movimento do
  banco; taxas do prestador como despesa à parte.
- **O meio de pagamento que vai para o documento fiscal tem de ser o real** — no
  Hub interno, tudo o que não era «encontro de contas» saía «Shopify Payments», o que
  num pagamento EuPago seria um documento errado (29/09/2026).

## Ambiente de testes

**Um pagamento de testes nunca gera documento fiscal**: marcado como teste em
toda a cadeia e retido antes do emissor (desenho de 29/09/2026).

## Antes de dizer «está feito»

- [ ] Nenhum caminho passa dinheiro por uma conta do Eurolify.
- [ ] Avisos com assinatura verificada, evento em bruto gravado, idempotentes.
- [ ] Testados: MB WAY (imediato), Multibanco (dias depois), cartão com 3DS,
      aviso repetido, reembolso parcial, link expirado, desligar o prestador a
      meio.
- [ ] O meio de pagamento chega certo ao documento fiscal.
