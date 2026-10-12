# Envios, parte C — adaptador da Sendcloud (12/10/2026)

Pedido do Diogo, 12/10/2026: *«ainda não; avança com a parte C»*. Os CTT
esperam pela especificação da API. Issue #393; pedido #406; desenho em
`docs/36` §16.

## O que se fez

- **Documentação lida:** a API v3 da Sendcloud (`sendcloud.dev`, **W**,
  12/10/2026), descarregada em Markdown. Os pontos estão no `docs/36` §16.1.
- **Onde trata os dados:** o DPA diz que a Sendcloud é subcontratante e apaga
  os dados do cliente 365 dias depois de o envio acabar.
- **Lista oficial dos subcontratantes:** não li (a página recusa o acesso
  automático, 403). Pela pesquisa, inclui o SendGrid e o Zendesk; um agregador
  de terceiros dá-os a tratar dados nos EUA (**C**).
- **Código:** adaptador `src/envios/sendcloud.ts`; serviços por conta, numa
  fotografia guardada na chamada de teste (migração 0080, D1); modo teste só
  com `sendcloud:letter` (D2); o aviso é um sinal para consultar (D4).

## Números (com data e como se contaram)

- 12/10/2026, local: 9 testes do adaptador (`test/envios-sendcloud.test.ts`)
  e 1 pela API (`test/envios-etiquetas.test.ts`), verdes, depois da revisão do
  agente (#406: 0 P0, 1 P1, 7 P2, todos tratados).

## O que ficou por verificar

- Nada foi corrido contra uma conta real da Sendcloud.
- O conteúdo dos avisos na v3 (não está descrito).
- Se `sendcloud:letter` aparece numa conta portuguesa.
- Os estados de uma transportadora portuguesa através da Sendcloud.
- **Antes do modo real:** ler a lista oficial dos subcontratantes e o DPA com
  o jurista, e o Diogo ou o Bruno decidirem, por escrito, se os
  subcontratantes dos EUA são aceitáveis (regra 4).
