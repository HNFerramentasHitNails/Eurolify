# Hub: as contas de transportadora (12/10/2026)

Pedido do Diogo, 12/10/2026: *«sim, aprovo; avança com o código»*, sobre o
desenho do `docs/22` §29 (issue #393).

## O que se fez

- **API:** as rotas `/hub/carrier-accounts` (lista, ligar, mudar,
  credenciais, testar, serviços), com as mesmas funções das rotas da chave e
  o mesmo âmbito. Ficam em `src/envios/rotas-hub.ts`.
- **API, o que a lista passa a dizer:** a data da fotografia dos serviços
  (`servicos_em`) e os campos de credenciais que o adaptador declara
  (`campos_credenciais`).
- **Hub:** o módulo «Envios» e três ecrãs: a lista, «Ligar uma
  transportadora» e a conta. A conta tem os dados, as credenciais (os
  segredos nunca voltam), o caminho dos avisos, «Testar a ligação», os
  serviços e «Arquivar».
- **Correcção ao desenho:** as rotas do Hub não usam `Idempotency-Key`
  (`docs/21` §11).

## Números (com data e como se contaram)

- 12/10/2026, local:
  - 3 testes da API pelo Hub (`test/envios-hub.test.ts`), verdes;
  - 198 testes do Hub, verdes.

## O que ficou por verificar

- **Os avisos não chegam à API na VPS.** O `nginx-hub.conf` só publica
  `/hub/`; os avisos das transportadoras e dos pagamentos precisam de um
  caminho público (mudança à VPS, ADR-0028).
- **«Testar a ligação» não passou pelas capturas:** seria uma chamada à
  Sendcloud verdadeira. O resultado do teste está coberto nos testes da API.
- **Os métodos de entrega e o peso da embalagem** são o passo seguinte (§30).
