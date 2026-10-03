---
name: consumer-rights-eu
description: Direitos do consumidor na UE no Lumavo — transparência de preço total, impostos, portes, prazos e condições; reduções de preço com o preço mais baixo dos 30 dias; confirmação da encomenda e prova contratual; botão de livre resolução (obrigatório desde 19/06/2026), devoluções, reembolsos e excepções; aviso da garantia legal (27/09/2026); RAL e Livro de Reclamações; textos configuráveis por país e por comerciante; B2C vs B2B. Usar ao desenhar o checkout, a página de artigo, promoções, a área de cliente, devoluções e páginas legais.
---

# Direitos do consumidor

> Estado: **desenho** — não há código (ADR-0001). Fontes e datas:
> `docs/03-regulamentar-ue.md` §2. **Validação: jurista.** As obrigações
> concretas dependem do **produto**, do **país** e de o comprador ser
> **consumidor ou profissional** — o Lumavo dá as peças; o comerciante e o
> jurista confirmam o texto.

## Quando usar

- Checkout, página de artigo, promoções, área de cliente, e-mails
  transaccionais, páginas legais, devoluções.

## 🔴 Consumidor ou profissional — por encomenda

Muitas regras deste ficheiro só se aplicam a **consumidores**. Grande parte das
vendas dos sistemas actuais é B2B (`ai-act-compliance.md`). Mas **ter NIF não faz de alguém
profissional**: em Portugal um particular também tem NIF. O Lumavo guarda **por
encomenda** se o comprador declarou comprar como profissional (e com que
perfil), e por omissão trata como consumidor.

## O que o Lumavo garante por construção

### Antes da compra
- **Preço total com impostos**, portes e custos extra visíveis antes do
  compromisso; o IVA mostrado vem do servidor (`eu-vat-oss-ioss`).
- Identidade e contactos do comerciante, prazos de entrega, métodos de
  pagamento, **direito de livre resolução** e suas excepções, garantia legal.
- **Reduções de preço**: o preço de referência anunciado é **o mais baixo dos
  30 dias anteriores** (art. 6.º-A da Dir. 98/6/CE, introduzido pela Omnibus —
  **C**). ⇒ o domínio de preços guarda **histórico de preços por mercado**.
- **Alegações ambientais** genéricas («eco», «verde») sem prova são proibidas
  desde 27/09/2026 (Dir. (UE) 2024/825, **W**) ⇒ campo de alegação ambiental
  só com documento de prova anexado.
- **Aviso harmonizado da garantia legal** no ponto de venda, desde 27/09/2026
  (**W**) — o texto exacto vem do acto da Comissão, **C**.

### Na compra
- Botão final com texto inequívoco de obrigação de pagar («Encomendar com
  obrigação de pagar» — **C**, confirmar o texto por língua).
- Aceitação das condições guardada: **versão do texto**, momento, encomenda.

### Depois da compra
- **Confirmação da encomenda** em suporte duradouro (e-mail com PDF ou
  equivalente), com as condições aceites — é a **prova contratual**.

## Botão de livre resolução (desde 19/06/2026)

Dir. (UE) 2023/2673, novo art. 11.º-A da Dir. 2011/83/UE (**W**):

- **Função online** fácil de encontrar, claramente visível e disponível
  **durante todo o prazo de 14 dias**, em todos os contratos à distância com
  direito de resolução celebrados por interface online.
- O consumidor identifica-se e identifica o contrato; o Lumavo **confirma a
  recepção** em suporte duradouro, com data e hora.
- No Lumavo: **é servido pelo servidor** (área de cliente e link no e-mail de
  confirmação), não por cada frontend — um frontend gerado por IA não pode
  esquecê-lo.
- A loja online actual tem um formulário de livre resolução (com captcha e
  limite de 3 pedidos por hora e e-mail). **Não verifiquei** se
  cumpre o art. 11.º-A nem se o pedido chega ao Hub.

## Livre resolução, devoluções e reembolsos

| Passo | Regra |
|---|---|
| Prazo | 14 dias a contar da entrega (bens) — **C** para os casos especiais |
| Excepções | ex.: bens selados que não podem ser devolvidos por razões de **saúde ou higiene** depois de abertos — muito relevante em cosmética (**C**, confirmar a redacção por país) |
| Devolução | liga-se a um **RMA** (`order-fulfilment`): o que volta, em que estado |
| Reembolso | prazo legal a contar da comunicação (14 dias, podendo reter até receber o bem — **C**); mesmo meio de pagamento por omissão |
| Documento | **nota de crédito** com o tratamento fiscal do original (`eu-vat-oss-ioss`) |

Regra do ecossistema: **devolução = volta mercadoria**; **problema = não
volta** (`devolucoes-nao-tem-fluxo-15set2026.md`).

## Resolução de litígios

- **A plataforma europeia ODR fechou a 20/07/2025** (Reg. (UE) 2024/3228,
  **W**): **não** pôr a ligação. As páginas legais por omissão do Lumavo não a
  trazem.
- Em Portugal: informação de **RAL** e **Livro de Reclamações electrónico**
  (**C**). Noutros países, as entidades de cada um.

## Textos legais por país e por comerciante

- Modelos por **país × língua × tipo de cliente**, com versões e data; o
  comerciante preenche os seus dados; o jurista dele valida.
- Cada encomenda guarda **a versão** dos textos aceites.
- Mudança de texto ⇒ versão nova, nunca editar a antiga.

## Geobloqueio

Não recusar o acesso à loja nem condições diferentes por nacionalidade ou
residência dentro da UE (Reg. (UE) 2018/302, **C**). Não obriga a entregar em
todo o lado.

## Vigiar

**Digital Fairness Act** — proposta ainda não apresentada a 03/10/2026,
esperada no 4.º trimestre (**W**): padrões enganadores, subscrições,
personalização.

## Antes de dizer «está feito»

- [ ] O preço mostrado em todo o lado vem do servidor e inclui IVA e portes.
- [ ] A promoção mostra o preço de referência dos 30 dias.
- [ ] Botão de livre resolução visível 14 dias, com confirmação de recepção.
- [ ] Versões dos textos aceites guardadas na encomenda.
- [ ] Jurista validou os textos do país.
