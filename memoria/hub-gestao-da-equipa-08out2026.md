# Hub: gestão da equipa — 08/10/2026

Pedido do Diogo, 08/10/2026: *«sim, avança com a gestão da equipa no Hub»*;
*«sim, quando a revisão chegar junta o #188»*. Issue #186; desenho em
`docs/22` §10.

## O que se fez

- **#188 (5af52d6):** em `/equipa`, o dono muda o papel de um membro e
  tira-o da equipa; cada um sai por si («Sair desta equipa»). O último dono
  não sai nem perde o papel: a base recusa (migração 0018) e o ecrã
  desliga o botão com a explicação. Nada de novo na API: o Hub só usa as
  rotas e funções que já existiam.
- **Convite com conta existente:** quem já tem conta entra com a passkey e
  aceita; com a sessão aberta, aceita logo; com a sessão de outra pessoa,
  a base recusa (`invite.other_person`) e o ecrã oferece «Sair» ali mesmo.
  Quem só tem palavra-passe entra primeiro em «Entrar» e volta à ligação.
- **As confirmações dizem o que a base fecha** (`pessoa_fechar_acessos`,
  0025): os convites em aberto da pessoa são cancelados e as chaves de
  servidor que criou, e as criadas com elas, são revogadas; as chaves
  públicas ficam.
- **Passagem no navegador** (`apps/hub/scripts/capturas.mjs`): cada
  navegador da passagem tem o seu endereço de teste (o limite de 20 pedidos
  por minuto das rotas públicas apanhava-os juntos). Só existe no proxy da
  passagem; a API não lê esse cabeçalho.
- Revisão Opus 5.5 (agente da sessão, publicada no pedido): 0 P0, 0 P1,
  5 P2 (texto das confirmações; passkey de outra conta sem «Sair»; o
  «Sair» do convite deixava o aviso de conta recuperada; caminho para quem
  só tem palavra-passe; prova do convite cancelado), 11 P3. Tudo corrigido
  menos o P3-9 (o segredo do convite vive na memória da página, como já
  vivia; o §10 diz isso).

- **#192 (f7b2594), issue #191:** a passagem no navegador lê a árvore de
  acessibilidade do próprio Chromium (CDP) e confere que as tabelas são
  tabelas e o nome de cada célula. Medido assim, o Chromium mantém as
  tabelas como tabelas também nos cartões do telemóvel (`display: block`),
  sem papéis escritos: **a premissa do #191 estava errada** (vinha do
  `getByRole` do Playwright, que calcula o papel pela etiqueta). Nos cartões
  o leitor de ecrã recebe «Papel Dono» (o rótulo e o valor); fica assim até
  um ensaio com VoiceOver e TalkBack. Corrigido também: o aviso de convite
  cancelado aparecia antes de a lista ser relida (defeito do #188).

## Números (com data e como se contaram)

- Hub: 53 testes passam (`pnpm teste`, 08/10/2026).
- `capturas.mjs`: 111 verificações em 111, 5 corridas seguidas
  (08/10/2026).
- Verificações do GitHub no head a7f5070: codigo, imagem, script-vps e
  segredos verdes (08/10/2026, 14:59).
- Publicado no ensaio: corrida 37797820415, 15:10 UTC, «migrar: nada em
  falta», «Hub: os ecrãs desta publicação estão no ar». Medido de fora às
  15:10: `/equipa` e `/convite` 200, `/hub/me` sem sessão 401; o código
  servido (`index-CUFEunUm.js`) tem «Sair desta equipa», «Aceitar com esta
  conta» e «É o último dono» (o anterior, `index-BO-gbQ9_.js`, não tinha).
- #192: 129 verificações em 129, 5 corridas seguidas; a verificação nova
  fica vermelha com `role="presentation"` numa tabela e com texto a mais no
  nome das células (08/10/2026). Publicado: corrida 37802346072, 15:42 UTC,
  «Hub: os ecrãs desta publicação estão no ar»; o código servido
  (`index-DR2eUi1o.js`) tem o mesmo nome que a construção local do `main`.

## O que ficou por verificar

- Os cartões do telemóvel com VoiceOver e TalkBack reais: se dizem a coluna
  sem o rótulo visível (decide se o rótulo sai do nome da célula).

- Sem prova no navegador: a passkey de outra conta no ecrã «já tem conta»;
  quem só tem palavra-passe; um membro já tirado noutro separador; as
  corridas entre acções; a mudança de língua; o pedido da passkey para
  autenticação recente ao mudar e ao tirar.
- O ecrã do convite não diz para que comerciante nem com que papel é o
  convite antes de aceitar: a API não o expõe (fica para outro pedido).
- O aspecto dos ecrãs novos: para o OK do Diogo ou do Bruno.
