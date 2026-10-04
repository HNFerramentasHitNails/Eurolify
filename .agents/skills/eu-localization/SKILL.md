---
name: eu-localization
description: Localização europeia no Eurolify — mercados (país, moeda, língua, canal e contexto de preço), línguas e traduções, moedas e câmbios guardados com taxa e data, formatos regionais, moradas e códigos postais por país, regiões e territórios especiais, fusos horários, métodos de pagamento e de entrega por país, conteúdo legal e comunicações transaccionais por língua. Usar ao abrir um país ou língua, ao mexer em moradas, datas, moedas ou montantes, e ao configurar métodos de pagamento ou de entrega por mercado.
---

# Localização europeia

> Estado: **desenho** — o código está autorizado (ADR-0023), mas o deste domínio só depois do desenho dele em tabela. Países: **toda a UE, de
> raiz** (decisão F e D-6, Diogo, 03/10/2026).

## 🔴 Regra de ouro

**Nunca converter moeda nem aplicar IVA sem guardar a taxa ou a regra usada, e
a data.** No ecossistema, uma despesa de 14.505 USD ficou guardada como euros e
uma ordem de compra não tinha moeda nenhuma (23/09/2026, `CLAUDE.md` do Hub).

## Mercado

O **mercado** é a unidade de venda: **país (ou grupo de países) + moeda +
línguas + lista de preços + métodos de pagamento + métodos de entrega + textos
legais + registos fiscais**. Uma loja tem vários mercados — a loja online actual, para vender
noutros países, **duplica lojas Shopify inteiras** (um duplicador de loja mãe
para lojas destino); no Eurolify é um mercado a mais na mesma loja.

- O mercado de um visitante decide-se pelo **país de entrega** quando o há;
  antes disso, por escolha dele (nunca impor pelo IP — geobloqueio).
- **Preço por mercado**: o comerciante escolhe entre preço com IVA igual em
  todos os países (absorve a diferença) ou preço sem IVA igual (o final muda) —
  é decisão comercial com efeito fiscal, mostrada claramente.

## Línguas e traduções

- Línguas por mercado; a de origem é a do comerciante.
- Traduções **vivem no Eurolify**, por campo, com estado (completa,
  desactualizada, em falta); mudar o original marca-as desactualizadas.
- Tradução automática por IA **só como proposta**, revista por uma pessoa antes
  de publicar textos legais ou avisos de segurança.
- Tudo o que o cliente lê é traduzível: ecrãs, e-mails, PDF, mensagens de erro,
  textos legais. No Hub, as mensagens do carrinho ficavam em português para toda
  a gente (02/09/2026) e os parceiros estrangeiros não conseguiam entrar por o
  login só estar em português (02/10/2026).

## Moradas e códigos postais

- Formato **por país**: campos obrigatórios, ordem, validação do código postal
  (PT `0000-000`, ES 5 dígitos — e um código espanhol com 4 dígitos perdeu o
  zero da frente).
- **Região escolhida de uma lista no servidor**, nunca texto livre: no Hub eram
  181 valores diferentes em 5.765 perfis (29/09/2026); listas com o código do
  formato usado pelos canais.
- **País em código ISO** em todo o lado; o nome por extenso só para mostrar.
- **Territórios especiais** pelo código postal (Canárias, Ceuta, Melilla…) —
  ver `eu-vat-oss-ioss`.
- Códigos postais impossíveis (`0000-000`) recusados.
- **Morada de faturação ≠ morada de entrega**, e o país do contribuinte é outro
  campo ainda.

## Datas, horas e fusos

- Guardar em **UTC**; mostrar no fuso do comerciante ou do cliente.
- Testes com a mudança de hora: no Hub o agendamento do banner recuava 1 hora a
  cada gravação (15/09/2026).
- Prazos legais (14 dias de livre resolução, reembolso) contam-se em **dias de
  calendário do país**, com a regra do país — **C**.

## Números, moeda e câmbio

- Montantes em cêntimos (inteiros) + moeda ISO 4217.
- Formato por língua (1 234,56 € vs €1,234.56).
- Câmbio: taxa, fonte, data e hora guardadas com cada conversão; o documento
  fiscal na moeda exigida pelo país.

## Pagamentos e entregas por mercado

> **A lista dos 27 países, com fonte em cada linha, está em
> `docs/07-pagamentos-e-envios-por-pais.md`** (pesquisa de 03/10/2026). Não se
> escreve aqui uma segunda cópia: consulta-se lá.

| País | Métodos de pagamento a considerar | Notas |
|---|---|---|
| Portugal | MB WAY, Multibanco, cartão, Klarna | MB WAY é o meio mais usado online (Marktest, 14/03/2025 — `docs/07`); Klarna = 58 pagamentos e 28.305 € em 90 dias na plataforma de formação actual (29/09/2026) |
| Espanha | cartão, Bizum, PayPal | **W** (`docs/07`) |
| Bélgica / Países Baixos | Bancontact; iDEAL a passar a Wero (2026–2027) | **W** (`docs/07`) |
| Polónia | BLIK, Przelewy24 (A2A 70 % do valor) | **W** (`docs/07`) |
| Leste (BG, HU, SK, CZ, RO) | **pagamento na entrega** pesa 37–59 % | é um serviço da transportadora (`docs/07` §3) |

Entregas por mercado: transportadoras, serviços, prazos e restrições
(mercadorias perigosas), configurados por mercado.

## Comunicações e conteúdo legal

E-mails transaccionais, faturas, notas de crédito e textos legais **por língua
e por país**, com versões. Ver `consumer-rights-eu`.

## Antes de dizer «está feito»

- [ ] Montantes com moeda; conversões com taxa e data.
- [ ] Datas em UTC, mostradas no fuso certo; testado na mudança de hora.
- [ ] Moradas validadas pelo formato do país; região de uma lista.
- [ ] Todo o texto novo visível ao cliente é traduzível.
