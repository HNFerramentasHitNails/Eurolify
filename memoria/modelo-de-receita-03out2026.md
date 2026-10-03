# Modelo de receita do Lumavo — o estudo (03/10/2026)

**Pedido do Diogo (03/10/2026):** *«estuda o modelo de receita do lumavo»*.

## O que se fez

- ✅ **Base decidida pelo Diogo a 03/10/2026** (*«sim, fica assim»*,
  ADR-0007, decisão N): mensalidade por escalões de vendas anuais, sem taxa
  sobre cada venda. Preços e outras fontes por decidir.

- `docs/09-modelo-de-receita.md`: ponto de partida, preços da concorrência,
  nove fontes de receita possíveis e uma proibida, proposta, como se calcula o
  ponto de equilíbrio, regras fiscais e europeias da receita do próprio Lumavo,
  e o que falta para decidir. D-14 em `docs/06` passa a «estudado, por
  decidir»; `docs/05` e `README.md` actualizados.

## Números (pesquisa web a 03/10/2026)

- Shopify, página portuguesa: Basic 27 € (19 € anual), Grow 74 € (56 €),
  Advanced 384 € (289 €), Plus desde 2.100 €; taxa extra com outro prestador
  2 % / 1 % / 0,6 % / 0,2 %.
- Shopify 2025: 76 % da receita de «merchant solutions» (pagamentos sobretudo),
  24 % de assinaturas (10-K, resumo).
- Shopware: Rise desde 600 €, Evolve desde 2.400 €, preço pelo volume de
  vendas; Community grátis (MIT). PrestaShop Hosted 24–29 € sem IVA.
- Loja de aplicações do Shopify: 0 % até US$ 1 M na vida do programador, 15 %
  depois (desde 01/01/2025).
- Mollie Connect: a plataforma pode fixar margem ou taxa por pagamento,
  liquidada pela Mollie no saldo da plataforma.
- Data Act: sem custos de saída a partir de 12/01/2027; aviso ≤ 2 meses;
  transição ≤ 30 dias.

## A ideia central

O Lumavo não recebe o dinheiro dos comerciantes, por isso não pode ganhar como
o Shopify (3/4 da receita em pagamentos). Depende da mensalidade e do valor da
conformidade europeia; dos pagamentos, só chega pelo prestador e às claras.

## Quando se decidem os preços (03/10/2026, mais tarde — ADR-0012)

- **Pergunta ao Diogo:** *«Aceitas que os preços da D-14 passem a ser exigidos
  só antes da peça 13, e não antes da primeira linha de código?»* Resposta:
  *«sim, aceito»*. Decisão **S** em `docs/06`.
- O critério de passagem da Fase 0 fica: D-13 decidida (ADR-0008), base da
  D-14 decidida (ADR-0007) e o OK escrito para código. Os preços (e as outras
  fontes por decidir) têm de estar em ADR antes da peça 13 (abertura a
  comerciantes, 6 a 10 pessoas-semana, `docs/10` §2, **C**).
- Varrido e acertado: `docs/05` (critério e linha da D-14), `docs/06` (M, S e
  a secção D-14), `docs/09`, `docs/00` §6, `docs/10` §9 e as linhas de estado
  dos ADR-0006 e 0007. O tempo da Fase 0 em `docs/10` §9 **não foi
  recalculado**.
- **Não verifiquei** a apresentação para Bruno e Cila: pode ainda dizer que a
  D-14 é precisa antes da Fase 1.

## O que ficou por verificar

- Escalões do Shopware (não públicos); percentagens do programa de parceiros
  da Mollie (só resumo; página 404); programas de partilha com
  transportadoras; enquadramento legal da margem sobre pagamentos; IVA das
  comissões. Sem preços finais nem ponto de equilíbrio (falta a D-13).
