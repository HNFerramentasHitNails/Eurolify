# Envios: a etiqueta de devolução pela transportadora (13/10/2026)

O Diogo aprovou o desenho a 13/10/2026 (*«sim, aprovo; avança com o
código»*): a etiqueta é paga pela conta do comerciante, e descontar a volta
no reembolso fica para uma pessoa, na decisão da devolução. O desenho é o
`docs/36` §22 (issue #393). Usa só a Sendcloud: os CTT continuam sem
especificação.

## O que se fez

- **Numa devolução à espera**, quem tem `returns:write` pede a etiqueta com
  a conta e um serviço de morada do país do cliente (migração 0092).
- **Para a transportadora vão** o nome e a morada de entrega do cliente, a
  morada de recolha da conta e o peso (linhas mais a embalagem). Não vão o
  telefone, o e-mail, os preços, o NIF nem o motivo do cliente. Por isso os
  serviços que pedem telefone ou e-mail não servem.
- **Uma viva por devolução.** A resposta perdida fica `incerta`: a lista da
  Sendcloud não procura pela nossa referência, por isso nunca se pede outra
  sozinha.
- **Anular é uma pessoa a confirmar** que a anulou no painel (a Sendcloud só
  aceita um pedido de anulação, 202).
- **O PDF** apaga-se 30 dias depois de a devolução acabar (tabela interna de
  prazos, como o `trabalho_envio`), ou logo no apagamento do titular.
- **A devolução fica com a transportadora e o seguimento** da etiqueta; o
  seguimento não muda a devolução.

## Números (com data e como se contaram)

- 13/10/2026, local, com o PostgreSQL 18.6 num contentor (resumo do
  `vitest`): `test/envios-devolucao.test.ts`, 4 verdes;
  `test/envios-sendcloud.test.ts`, 13 verdes (1 novo).
- Prova pela falha: sem a recusa da incerta e sem a dos serviços com
  telefone, falham 2 de 4.

## O que ficou por verificar

- Numa conta real da Sendcloud (V11 a V14): os serviços de volta e se o modo
  teste tem algum; se aceita a morada de um ponto como remetente; a
  anulação; o seguimento de uma devolução.
- **O Hub** (o botão e o PDF na página da devolução) fica para o pedido 2.

## Também nesta data

- O Diogo aprovou o aspecto dos ecrãs dos pontos de recolha (#443) depois de
  ver as capturas: *«aprovo; junta quando ficar verde»*.
