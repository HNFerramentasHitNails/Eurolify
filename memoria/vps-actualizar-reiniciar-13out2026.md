# Actualizar e reiniciar a VPS do ensaio (13/10/2026)

Pedido do Diogo, 12/10/2026, por escrito: *«Depois podes reiniciar a VPS»* e
*«actualiza também as 38 actualizações antes de reiniciar»*; a 13/10,
*«avança»* e *«Ligado»* (o conector religado). Feito pelo MCP da VPS
(ADR-0033), as duas acções fixas com código de confirmação, fora do horário
de trabalho (regra 4 de «Operar a VPS»).

## O que se fez

- 12/10, 16:48 UTC: medição de partida (`estado_do_ensaio`). Marcado para as
  20:05 de Lisboa. Às 18:05 e às 20:06 de Lisboa o conector `Eurolify_VPS`
  pedia nova autenticação; nada se fez.
- 13/10, 09:05 de Lisboa: conector religado, mas dentro do horário de
  trabalho; remarcado para as 20:05. Às 20:06 o conector voltou a pedir
  autenticação; nada se fez.
- 13/10, 21:51:42 UTC (22:51 de Lisboa), depois de o Diogo religar:
  `actualizar_vps` (código e confirmação). Às 21:55:02 UTC não havia nada
  por aplicar.
- 13/10, 21:55:21 UTC: `reiniciar_vps` (código e confirmação). A acção fez a
  cópia `eurolify-20261013T215521Z.dump.age` (1,5 MB) e as imagens
  `eurolify-media-20261013T215521Z.tar.age` (172 KB) às 21:55:35 UTC e
  reiniciou a máquina.
- Depois do reinício o conector caiu (como a ferramenta avisa); a medição foi
  feita pelo fluxo `medir` do GitHub (execução 38474656032, 21:59:54 UTC).
- Não se mexeu em configuração, chaves, firewall nem na base.

## Números (com data e como se contaram)

Todos de `estado_do_ensaio` / `eurolify-medir`, secção a secção.

| | antes (13/10, 08:05 UTC) | antes de actualizar (21:51 UTC) | depois do reinício (21:59 UTC) |
|---|---|---|---|
| actualizações por aplicar | 38 | 45 (2 de segurança) | 0 |
| só com ESM Apps (subscrição) | 2 | 2 | 2 |
| «Reinício pedido pelas actualizações» | sim | sim | não aparece |
| sistema | Ubuntu 26.04 LTS | 26.04 LTS | 26.04.1 LTS |
| núcleo | 7.0.0-34 | 7.0.0-34 | 7.0.0-38 |
| eurolify-api | healthy | healthy | Up 4 min, healthy |
| eurolify-mcp / postgres | a correr | a correr | Up 4 min / Up 4 min |
| VIES_URL na API no ar | sim | sim | sim |
| migrações base / versão no ar | 79 / 79 | 88 / 88 | 88 / 88 |
| MCP `{"estado":…}` | ok | ok | ok |

Serviços (ssh, docker, fail2ban, ufw, nginx, os quatro temporizadores e os
quatro `eurolify-pedido@`) todos `active` depois do reinício. Firewall igual
(22 e 443). A versão da API no ar é a mesma antes e depois
(`sha256:51d425ac…`).

## O que ficou por verificar

- As 2 actualizações de segurança do ESM Apps ficam por instalar (pedem
  subscrição da Ubuntu Pro). Não se decidiu.
- A verificação diária: depois do reinício o `medir` mostra
  `verificacao: inactive, success` sem data — é o estado da unidade depois do
  arranque, não uma corrida nova. A secção «o que encontrou na última vez»
  ainda mostra o reinício pedido (é da corrida das 07:00 de 13/10). Confirmar
  na corrida de 14/10 às 07:00 UTC que dá «Sem problemas.»
  (`memoria/vps-verificacao-falhada-13out2026.md`).
- O conector `Eurolify_VPS` perdeu a autenticação três vezes em dois dias
  (12/10 antes das 18:05 de Lisboa; 13/10 entre as 09:05 e as 20:06; e depois
  do reinício, como esperado). Causa não investigada; pode ser a validade do
  acesso do conector.
- Não se testou a API por fora (pedido real a `hub.eurolify.eu`); só o estado
  «healthy» do contentor e o `{"estado":"ok"}` do MCP.
