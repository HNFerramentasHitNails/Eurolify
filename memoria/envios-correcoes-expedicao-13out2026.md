# Envios: corrigir o peso e mudar o serviço de uma expedição (13/10/2026)

O Diogo aprovou-o a 13/10/2026: *«sim, aprovo; avança com o código»*, com a
mudança de serviço só para o dono e o gestor. O desenho é o `docs/36` §19,
que já estava previsto no §3.3 (issue #393).

## O que se fez

- **O peso corrigido e o serviço escolhido** são colunas da expedição
  (migração 0086). A etiqueta usa-os em vez do peso calculado e do serviço
  vendido. A encomenda e a cópia do método (`metodo_entrega`) não mudam:
  ficam o preço dos portes, a data-limite e o método da livre resolução.
- **A base só aceita a correcção** com a expedição `criada`, sem etiqueta
  viva e com motivo. Cada correcção fica numa linha de `correcao_expedicao`,
  que só se acrescenta.
- **Os serviços que se oferecem** são os de contas prontas que servem a
  caixa: o país, o peso, os perigosos e o telefone. Quem os escolhe é a
  API, e o ecrã só os mostra.
- **Quem pode:** o peso, o armazém, o dono e o gestor (`fulfilment:write`).
  O serviço, só o dono e o gestor (`shipping:write`), e nunca uma IA
  (`shipping.ai_not_allowed`).
- **No ecrã «Expedir»** há dois botões novos, «Corrigir o peso» e «Mudar o
  serviço», e a lista das correcções.
- **A numeração:** a migração é a 0086, porque a 0084 e a 0085 entraram
  antes.

## Números (com data e como se contaram)

- 13/10/2026, local, com o PostgreSQL 18.6 num contentor (contados pelo
  resumo do `vitest`):
  - `test/envios-correcoes.test.ts`: 4 testes verdes;
  - as suites `envios-*`, `comerciante`, `rasto-colunas`, `seguranca-base` e
    `stock*`: 137 verdes, antes de juntar o `main`;
  - o Hub: 277 testes verdes, e depois 10 em `test/expedir.test.ts`, com os
    3 novos.

## O que ficou por verificar

- **O motivo é texto livre** e pode trazer dados de clientes. O ecrã diz para
  não os escrever, mas o apagamento do titular não limpa o rasto (como nas
  outras tabelas de rasto, `docs/33` P2-6).
- **Um serviço mais lento** pode falhar a data-limite: os serviços não
  declaram prazos, e o Eurolify não o confere. O ecrã avisa.
- **Um método manual** só passa a ter etiqueta pela API. O ecrã não o
  oferece.
