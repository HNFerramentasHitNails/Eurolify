# Hub: o ecrã «Expedir» (13/10/2026)

Pedido do Diogo, 13/10/2026: *«sim, aprovo; avança com o código»*, sobre o
desenho do `docs/22` §32 (issue #393, pedido #418).

## O que se fez

- **API:** dez rotas do Hub para:
  - a vista do armazém;
  - as expedições;
  - a etiqueta: pedir, ler, descarregar, anular e consultar;
  - o seguimento.

  Usam as mesmas funções das rotas da chave, e quem escreve fica
  `pessoa:per_…`. Sem migração.
- **Hub:** o módulo «Expedir», com:
  - a lista das encomendas por expedir;
  - a página da encomenda: quem recebe, as linhas, criar a expedição e um
    cartão por expedição, com a etiqueta e o seguimento;
  - num método «Manual», a transportadora e o seguimento escritos à mão.
- **Testes:** a preparação da encomenda paga passou a
  `test/envios-cenario.ts`, partilhado com o teste das etiquetas.

- **Revisão do agente** (Sonnet 5.5, no #418): 2 P1, corrigidos.
  - O mapa dos erros usava `shipping.invalid_transition` em vez de
    `shipments.invalid_transition`. Um teste confere agora os códigos
    contra o servidor.
  - Com conta, a expedição saía sem a etiqueta emitida.

## Números (com data e como se contaram)

- 13/10/2026, local:
  - 4 testes da API (`test/envios-hub-expedir.test.ts`), verdes;
  - os 42 testes dos envios e do stock, verdes depois da mudança do
    cenário;
  - 237 testes do Hub, verdes.

## O que ficou por verificar

- **As capturas da encomenda usam respostas simuladas da API:** o ensaio
  não tem uma encomenda paga.
- **A passagem só com o teclado** não foi feita.
- **Etiquetas em lote** e **escolher o lote à mão** ficam para depois.
