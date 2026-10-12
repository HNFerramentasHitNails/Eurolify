# Documentos fiscais: a saída «emitida fora do Eurolify» (#310, #386), 12/10/2026

## O que se fez

- **Pedido do Diogo, 12/10/2026:** *«avança com a saída «emitida fora do
  Eurolify»»*; desenho aprovado (*«sim, aprovo o desenho com as propostas Q-F1
  a Q-F3»*; `docs/06`, EA; `docs/29` §15).
- Código no #386 (migração 0070; `docs/29` §16): o estado final `fora`, o
  número declarado (não é prova), só o dono, a NC vai com a fatura e um
  reembolso depois não pede NC.
- **Encontrado ao desenhar:** `nota_credito_pedir` (0058) pedia NC para
  qualquer fatura, mesmo retida para sempre — a NC ficava também presa.
- Revisão de um agente (Sonnet 5.5; 0 P0, 0 P1, 5 P2) publicada no #386 e
  corrigida: a corrida com um reembolso (a fatura tranca-se ao pedir a NC) e
  a NC sem o número da fatura.

## Números (com data e como se contaram)

- Bateria completa antes das correcções da revisão (12/10/2026, PostgreSQL
  18.6 local): 1457 a passar, 1 a falhar (a lista fechada das rotas do
  contrato sem a rota nova, corrigida).

## O que ficou por verificar

- O relatório OSS (parte 3) ainda não existe: a lista à parte (Q-F3) é **C**.
- Como o sistema próprio sabe de um reembolso feito antes de a fatura sair
  `fora` (além do evento `refund.created`): não verificado.
