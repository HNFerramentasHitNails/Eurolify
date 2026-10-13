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
- **No envio,** o aviso é cancelado se a expedição já tiver acabado
  (`expedicao_ja_acabou`) ou se a encomenda voltou a andar depois do evento
  (`encomenda_voltou_a_andar`, revisão do #434, P2-1).
- **Revisão do agente** (Sonnet 5.5, publicada no #434): sem P0 nem P1;
  corrigidos P2-1 a P2-3, o texto do P2-4, P3-1 a P3-3, P3-5 e P3-6.
- **O e-mail** leva a loja, a expedição, a transportadora, o seguimento e a
  hora. Nunca o texto da transportadora, o nome nem a morada.
- **Migração 0087.** O gatilho no `evento_seguimento` não fica `ALWAYS`,
  pela regra da 0053; os das notificações da 0067, 0071 e 0084 ficaram, e
  alinhá-los fica para outro pedido. A outra sessão do Claude Code que
  trabalha nas notificações concordou numa mensagem entre sessões de
  13/10/2026 (fora do repositório; não há outra fonte escrita).
- **Documentos:** o `docs/17` T10 (os titulares passam a incluir o armazém)
  e o `docs/34` §12.2.

## Números (com data e como se contaram)

- 13/10/2026, local, com o PostgreSQL 18.6 num contentor (contados pelo
  resumo do `vitest`):
  - `test/envios-aviso-tentativa.test.ts`: 4 testes verdes no primeiro
    commit; 7 depois da revisão;
  - prova pela falha, depois da revisão: sem o `encomenda_voltou_a_andar`
    falha o teste da encomenda que volta a andar; sem o ramo do tipo no
    `notificacao_destino()` falha o do armazém (2 de 7 falham);
  - as suites `comerciante`, `seguranca-base`, `notificacoes*`, `envios-*`
    e `identidade-api`: 154 verdes no primeiro commit; 166 depois da
    revisão (16 ficheiros, mais o `faturacao-ligacao-com-erro`);
  - prova pela falha: sem o filtro da expedição acabada, o teste do evento
    que chega depois da entrega falha.

## O que ficou por verificar

- **O número de seguimento nas notificações** (até 90 dias) não entra no
  apagamento do titular (0072); se deve entrar fica **C**, para o Diogo ou o
  Bruno decidirem (revisão do #434, P2-4).
- **O texto da transportadora** não entra no e-mail, mas fica no histórico
  do seguimento: pode trazer o nome (como já estava, `docs/36` §6).
- **O conteúdo real dos avisos da Sendcloud** (§16.4): não se verificou se a
  Sendcloud manda estes dois estados numa conta portuguesa.
- **Muitos e-mails** numa loja grande: um por expedição e por estado; não
  foi medido com volume.
