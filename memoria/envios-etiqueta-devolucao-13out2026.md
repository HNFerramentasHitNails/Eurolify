# Envios: a etiqueta de devolução pela transportadora (13/10/2026)

O Diogo aprovou o desenho a 13/10/2026 (*«sim, aprovo; avança com o
código»*): a etiqueta é paga pela conta do comerciante, e descontar a volta
no reembolso fica para uma pessoa. Esse desconto **ainda não existe** no
reembolso da pós-venda: é uma decisão por desenhar, e a etiqueta pré-paga
pode contar como aceitar o custo (**C**, jurista). O desenho é o
`docs/36` §22 (issue #393). Usa só a Sendcloud: os CTT continuam sem
especificação.

## O que se fez

- **Numa devolução à espera**, quem tem `returns:write` pede a etiqueta com
  a conta e um serviço de morada do país do cliente (migração 0093; a 0092
  é de outra sessão).
- **Para a transportadora vão** o nome e a morada de entrega do cliente, a
  morada de recolha da conta e o peso (linhas mais a embalagem). Não vão o
  telefone, o e-mail, os preços, o NIF nem o motivo do cliente. Por isso os
  serviços que pedem telefone ou e-mail não servem.
- **Uma viva por devolução, no máximo 10.** Qualquer falha depois de pedir
  fica `incerta` (a lista da Sendcloud não procura pela nossa referência),
  e nunca se pede outra sozinha.
- **Anular é uma pessoa a confirmar** que a anulou no painel (a Sendcloud só
  aceita um pedido de anulação, 202); uma incerta só 15 minutos depois.
- **Um histórico só de acréscimo** guarda cada etiqueta, com o seguimento e
  quem.
- **O PDF** apaga-se 30 dias depois de a devolução acabar (tabela interna de
  prazos, como o `trabalho_envio`), ou logo no apagamento do titular.
- **A devolução fica com a transportadora e o seguimento** da etiqueta; o
  seguimento não muda a devolução.

## Números (com data e como se contaram)

- 13/10/2026, local, com o PostgreSQL 18.6 num contentor (resumo do
  `vitest`): `test/envios-devolucao.test.ts`, 4 verdes no primeiro commit e
  5 depois da revisão do agente (#447); `test/envios-sendcloud.test.ts`, 13
  verdes (1 novo).
- A suite inteira no primeiro commit: 1647 verdes.
- Prova pela falha: sem a recusa da incerta e sem a dos serviços com
  telefone, falham 2 de 4. Depois da revisão: sem «qualquer falha é
  incerta» e sem os 15 minutos, falham 2 de 5.

## O que ficou por verificar

- Numa conta real da Sendcloud (V11 a V14): os serviços de volta e se o modo
  teste tem algum; se aceita a morada de um ponto como remetente; a
  anulação; o seguimento de uma devolução.
- **O Hub** (o botão e o PDF na página da devolução) fica para o pedido 2
  (feito a 14/10/2026: ver abaixo).

## Também nesta data

- O Diogo aprovou o aspecto dos ecrãs dos pontos de recolha (#443) depois de
  ver as capturas: *«aprovo; junta quando ficar verde»*.

## Pedido 2: o Hub (14/10/2026)

- **Descobriu-se ao preparar:** o Hub não tinha nenhum ecrã da pós-venda,
  por isso o pedido 2 trouxe o módulo «Devoluções» (a lista e a página, só
  de leitura) e as rotas `/hub/returns…`. O desenho é o `docs/36` §22.10. O
  Diogo aprovou-o: *«sim, aprovo; avança com o código»*.
- **Números**, a 14/10/2026, local, contados pelo resumo do `vitest`:
  - `apps/api/test/envios-hub-devolucoes.test.ts`: 3 verdes;
  - `envios-devolucao`, `identidade-api`, `posvenda-api` e `envios-hub*`:
    verdes depois da mudança;
  - o Hub: 300 verdes (eram 293).
  - O script das capturas passou sem falhas, depois de pôr os oito
    módulos nas verificações da entrada.
- **Ficou por verificar:**
  - a passagem só com o teclado pela página da devolução;
  - o PDF verdadeiro de uma conta real.
