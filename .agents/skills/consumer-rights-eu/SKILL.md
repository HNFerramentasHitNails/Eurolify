---
name: consumer-rights-eu
description: Direitos do consumidor na UE no Eurolify — transparência de preço total, impostos, portes, prazos e condições; preço por unidade; reduções de preço com o preço mais baixo dos 30 dias; preço personalizado; avaliações e resultados de pesquisa pagos; confirmação da encomenda e prova contratual; botão de livre resolução (obrigatório desde 19/06/2026), devoluções, reembolsos e excepções (conteúdos digitais incluídos); aviso da garantia legal e selo da garantia comercial de durabilidade (27/09/2026); garantia e reparação (+12 meses, 31/07/2026); RAL e Livro de Reclamações; textos configuráveis por país e por comerciante; B2C vs B2B. Usar ao desenhar o checkout, a página de artigo, promoções, avaliações, pesquisa, a área de cliente, devoluções, garantias e páginas legais.
---

# Direitos do consumidor

> Estado: **desenho** — não há código (ADR-0001). Fontes e datas:
> `docs/03-regulamentar-ue.md` §2. **Validação: jurista.** As obrigações
> concretas dependem do **produto**, do **país** e de o comprador ser
> **consumidor ou profissional** — o Eurolify dá as peças; o comerciante e o
> jurista confirmam o texto.

## Quando usar

- Checkout, página de artigo, promoções, área de cliente, e-mails
  transaccionais, páginas legais, devoluções.

## 🔴 Consumidor ou profissional — por encomenda

Muitas regras deste ficheiro só se aplicam a **consumidores**. Grande parte das
vendas dos sistemas actuais é B2B (`ai-act-compliance.md`). Mas **ter NIF não faz de alguém
profissional**: em Portugal um particular também tem NIF. O Eurolify guarda **por
encomenda** se o comprador declarou comprar como profissional (e com que
perfil), e por omissão trata como consumidor.

## O que o Eurolify garante por construção

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
- **Aviso harmonizado da garantia legal** no ponto de venda, desde 27/09/2026:
  lembrar a garantia legal de conformidade e os seus elementos principais,
  com o mínimo de 2 anos, de forma destacada (art. 6.º, n.º 1, alínea l), da
  Dir. 2011/83/UE, na redacção da Dir. (UE) 2024/825 — **W · texto lido**). O
  desenho e o texto do aviso vêm de um acto de execução da Comissão que **não
  li** — **C**.
- **Selo da garantia comercial de durabilidade**, desde 27/09/2026: quando o
  **produtor** oferece, sem custo, uma garantia de durabilidade de **mais de 2
  anos** sobre o bem inteiro e dá essa informação ao comerciante, a loja mostra
  que o bem a tem, a duração e o lembrete da garantia legal, com o **selo
  harmonizado** (art. 6.º, n.º 1, alínea l-A), e art. 22.º-A, na redacção da
  Dir. 2024/825 — **W · texto lido**; o desenho do selo, **C**). Da mesma
  directiva, também antes da compra (alíneas l-C), u) e v)): o período mínimo
  de **actualizações de software** dos bens com elementos digitais e dos
  conteúdos e serviços digitais, quando o produtor o dá; o **índice de
  reparabilidade**, quando existe; e, na falta dele, o que o produtor der
  sobre peças (disponibilidade, custo estimado, como encomendar), manuais e
  restrições de reparação. ⇒ campos no artigo, preenchidos com o que o
  produtor dá; o Eurolify não os inventa.
- **Preço por unidade**: ao lado do preço de venda, o preço final por
  quilograma, litro, metro, metro quadrado ou metro cúbico, também em todo o
  anúncio que mostre o preço (arts. 2.º e 3.º da Dir. 98/6/CE — **W · texto
  lido**). Exemplo: um frasco de 15 ml a 9,90 € mostra 660,00 €/l. Cada país
  pode dispensar produtos em que o preço por unidade não seja útil ou confunda
  (art. 5.º) ⇒ a regra é **por país**, e o artigo guarda a quantidade e a
  unidade.
- **Preço personalizado**: se o preço foi personalizado com base numa decisão
  automatizada, a loja di-lo (art. 6.º, n.º 1, alínea e-A), da Dir.
  2011/83/UE, introduzida pela Dir. (UE) 2019/2161, Omnibus — **W · texto
  lido**). O Eurolify não personaliza preços por omissão; se um comerciante ou
  uma extensão o fizer, o aviso vem do servidor, como o preço.

### Na compra
- Botão final com texto inequívoco de obrigação de pagar («Encomendar com
  obrigação de pagar» — **C**, confirmar o texto por língua).
- **Imediatamente antes do botão final**, de forma clara e destacada: as
  características principais, o preço total, **o selo da garantia comercial
  de durabilidade quando houver**, a duração do contrato (ou as condições
  para o terminar, se for por tempo indeterminado ou se renovar sozinho) e a
  duração mínima das obrigações do consumidor, quando se apliquem (art. 8.º,
  n.º 2, e art. 6.º, n.º 1, alíneas a), e), l-A), o) e p), da Dir.
  2011/83/UE, na redacção da Dir. 2024/825 — **W · texto lido**).
- Aceitação das condições guardada: **versão do texto**, momento, encomenda.

### Depois da compra
- **Confirmação da encomenda** em suporte duradouro (e-mail com PDF ou
  equivalente), com as condições aceites — é a **prova contratual**.

## Botão de livre resolução (desde 19/06/2026)

Dir. (UE) 2023/2673, novo art. 11.º-A da Dir. 2011/83/UE (**W**):

- **Função online** fácil de encontrar, claramente visível e disponível
  **durante todo o prazo de 14 dias**, em todos os contratos à distância com
  direito de resolução celebrados por interface online.
- O consumidor identifica-se e identifica o contrato; o Eurolify **confirma a
  recepção** em suporte duradouro, com data e hora.
- No Eurolify: **é servido pelo servidor** (área de cliente e link no e-mail de
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
| Conteúdos digitais sem suporte material (descargas, cursos em linha) | perde-se a livre resolução depois de começar o fornecimento **só** se, num contrato pago, o consumidor deu **consentimento prévio expresso** para começar dentro do prazo, **reconheceu** que assim perde o direito e o comerciante enviou a **confirmação** (art. 16.º, alínea m), da Dir. 2011/83/UE, na redacção da Omnibus — **W · texto lido**) ⇒ o checkout pede e guarda as duas declarações, com a versão do texto, e a confirmação vai no suporte duradouro. Sem as três, o direito mantém-se |

Regra do ecossistema: **devolução = volta mercadoria**; **problema = não
volta** (`devolucoes-nao-tem-fluxo-15set2026.md`).

## Garantia legal e reparação

- Garantia legal de conformidade: **mínimo de 2 anos** (Dir. (UE) 2019/771,
  como a lembra o art. 6.º, n.º 1, alínea l), da Dir. 2011/83/UE — **W ·
  texto lido**); a lei de cada país pode dar mais (art. 22.º-A, n.º 3).
- **Desde 31/07/2026, se o consumidor escolher a reparação, o prazo da
  garantia ganha 12 meses, uma vez** (novo art. 10.º, n.º 2-A, da Dir.
  2019/771, pela Dir. (UE) 2024/1799 — **W · texto lido**). ⇒ o pedido de
  garantia guarda **o remédio escolhido** (reparação, substituição, redução do
  preço ou resolução) e recalcula o fim da garantia da linha.
- A **obrigação de reparar** a pedido do consumidor, também fora da garantia,
  é do **fabricante**, e só nos produtos com requisitos de reparabilidade num
  acto da UE (anexo II da Dir. 2024/1799: máquinas de lavar, aspiradores,
  telemóveis e tábletes, entre outros — art. 5.º, **W · texto lido**). Não é
  do comerciante.

## Avaliações e resultados de pesquisa

Dir. 2005/29/CE (práticas comerciais desleais), na redacção da Omnibus —
**W · texto lido**:

- Se a loja mostra avaliações, diz **se e como** garante que vêm de quem
  comprou ou usou o produto (art. 7.º, n.º 6).
- Afirmar que as avaliações são de quem comprou ou usou **sem passos razoáveis
  para o verificar** é prática proibida (anexo I, ponto 23-B); avaliações
  falsas, encomendadas ou deturpadas também (ponto 23-C) — e publicar só as
  positivas, apagando as negativas, é um dos exemplos dados no considerando.
  ⇒ no Eurolify, uma avaliação liga-se a uma **encomenda entregue**, a loja
  mostra a regra usada, e nenhuma se esconde por ser negativa.
- **Anúncio pago ou pagamento para subir** nos resultados de uma pesquisa tem
  de ser indicado claramente (anexo I, ponto 11-A) ⇒ a ordenação da pesquisa
  sabe o que é patrocinado e o ecrã mostra-o.

## Resolução de litígios

- **A plataforma europeia ODR fechou a 20/07/2025** (Reg. (UE) 2024/3228,
  **W**): **não** pôr a ligação. As páginas legais por omissão do Eurolify não a
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
- [ ] O preço por unidade aparece onde o país o exige.
- [ ] Selo da garantia de durabilidade e informação de reparação, quando o
      produtor as dá, antes da compra e antes do botão final.
- [ ] Conteúdo digital: consentimento, reconhecimento e confirmação guardados.
- [ ] Garantia: o remédio escolhido fica guardado e a reparação soma 12 meses.
- [ ] Avaliações ligadas a encomendas, com a regra de verificação visível.
- [ ] Botão de livre resolução visível 14 dias, com confirmação de recepção.
- [ ] Versões dos textos aceites guardadas na encomenda.
- [ ] Jurista validou os textos do país.
