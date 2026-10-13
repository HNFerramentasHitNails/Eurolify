# Envios: o aviso da tentativa falhada e do «para levantar» (13/10/2026)

O Diogo aprovou-o a 13/10/2026 (*«sim, aprovo; avança com o código»*), com
o aviso para o dono, o gestor e o armazém. O desenho é o `docs/36` §20 e
completa a Q4 da decisão ED (issue #393).

## O que se fez

- **Quando a transportadora diz «tentativa falhada» ou «disponível para
  levantar»**, quem expede recebe um e-mail: o dono, o gestor e o armazém
  (`fulfilment:write`).
- **Uma vez por expedição e por estado.** A referência da notificação
  deriva-se da expedição e do estado: a segunda tentativa falhada não avisa
  outra vez, e um «para levantar» depois dela avisa.
- **No envio,** o aviso é cancelado (`expedicao_ja_acabou`) se a expedição
  já tiver acabado.
- **O e-mail** leva a loja, a expedição, a transportadora, o seguimento e a
  hora. Nunca o texto da transportadora, o nome nem a morada.
- **Migração 0087.** O gatilho no `evento_seguimento` não fica `ALWAYS`,
  pela regra da 0053; os das notificações da 0067, 0071 e 0084 ficaram, e
  alinhá-los fica para outro pedido. A sessão que fez a 0071 concordou
  (mensagem de 13/10/2026).
- **Documentos:** o `docs/17` T10 (os titulares passam a incluir o armazém)
  e o `docs/34` §12.2.

## Números (com data e como se contaram)

- 13/10/2026, local, com o PostgreSQL 18.6 num contentor (contados pelo
  resumo do `vitest`):
  - `test/envios-aviso-tentativa.test.ts`: 4 testes verdes;
  - as suites `comerciante`, `seguranca-base`, `notificacoes*`, `envios-*`
    e `identidade-api`: 154 verdes;
  - prova pela falha: sem o filtro da expedição acabada, o teste do evento
    que chega depois da entrega falha.

## O que ficou por verificar

- **O texto da transportadora** não entra no e-mail, mas fica no histórico
  do seguimento: pode trazer o nome (como já estava, `docs/36` §6).
- **O conteúdo real dos avisos da Sendcloud** (§16.4): não se verificou se a
  Sendcloud manda estes dois estados numa conta portuguesa.
- **Muitos e-mails** numa loja grande: um por expedição e por estado; não
  foi medido com volume.
