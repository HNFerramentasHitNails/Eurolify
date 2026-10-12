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
- **Revisão do agente (Sonnet 5.5, publicada no #409): 0 P0, 2 P1, 7 P2.**
  Corrigido:
  - P1-1: editar o remetente no Hub apagava o telefone e o e-mail;
  - P1-2: a página de uma conta CTT não abria, porque os serviços pedem o
    adaptador e passam a ler-se à parte;
  - dois códigos novos na API, `shipping.account_in_use` e
    `shipping.service_in_use` (409, `docs/36` §7.4), com texto próprio no
    Hub;
  - textos do arquivar e das credenciais corrigidos;
  - `shipping.retry` com texto próprio;
  - `no-store` também nos 403;
  - mais testes (credenciais recusadas, CTT, arquivar, 403 no PATCH,
    registo sem segredos).

## Números (com data e como se contaram)

- 12/10/2026, local:
  - 5 testes da API pelo Hub (`test/envios-hub.test.ts`), verdes;
  - 199 testes do Hub, verdes;
  - capturas (`scripts/capturas.mjs`) sem nenhum `FALHOU`, antes das
    correcções da revisão.

## O que ficou por verificar

- **Os avisos não chegam à API na VPS.** O `nginx-hub.conf` só publica
  `/hub/`; os avisos das transportadoras e dos pagamentos precisam de um
  caminho público (mudança à VPS, ADR-0028). O texto do ecrã que o diz é
  uma rede temporária: retira-se com esse pedido, ou revê-se a 31/03/2027.
- **Da revisão, ficou por fazer:**
  - P2-7: capturas das credenciais recusadas, do conflito e do papel
    armazém;
  - P3-5: erros do servidor junto ao campo;
  - P3-7: foco no erro de uma acção;
  - P3-8: retirar o segredo dos avisos;
  - P3-9: tempo limite do pedido.
- **«Testar a ligação» não passou pelas capturas:** seria uma chamada à
  Sendcloud verdadeira. O resultado do teste está coberto nos testes da API.
- **Os métodos de entrega e o peso da embalagem** são o passo seguinte (§30).
