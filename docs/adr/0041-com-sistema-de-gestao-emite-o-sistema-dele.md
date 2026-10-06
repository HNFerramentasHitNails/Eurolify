# ADR-0041 · Um comerciante com sistema de gestão continua a emitir por ele

- **Estado:** aceite · passar a emissão para o Eurolify decide-se depois, cliente a cliente
- **Data:** 06/10/2026
- **Quem decidiu:** Diogo
- **Decisão em aberto de origem:** D-10 (`docs/06-decisoes-em-aberto.md`)

## Contexto

- O `AGENTS.md` («Relação com os sistemas actuais») já dizia que o Eurolify
  não fala com o software de faturação de um cliente que já tem sistema de
  gestão, com a D-10 por tomar.
- Regra do Hub interno actual: «um só sistema fala com o Moloni» — dois
  emissores para a mesma venda dão faturas a dobrar ou nenhuma.

## Decisão

Diogo, 06/10/2026: *«sim, concordo, continua o sistema dele»*.

1. Num comerciante com sistema de gestão próprio, o Eurolify entrega-lhe as
   encomendas e **não chama o software de faturação** para essas vendas; o
   sistema dele é o único emissor.
2. Passar a emissão para o Eurolify é uma decisão posterior, cliente a
   cliente, com o Eurolify já provado.

## Consequências

- O perfil do comerciante tem de dizer quem emite (Eurolify pelo adaptador,
  ADR-0037, ou o sistema dele), e uma venda nunca pode ter os dois — a
  desenhar no domínio de documentos fiscais, com teste.
- Os campos que vêm desse sistema ficam só de leitura no Hub (P5 do
  `docs/14`, decisão AR).
