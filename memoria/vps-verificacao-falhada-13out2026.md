# A verificação diária da VPS a falhar (13/10/2026)

Pedido do Diogo, 13/10/2026: *«sim, avança com a 1»* (investigar a
verificação das 07:00 que falhava) e *«avança»* (o `medir` passa a mostrar o
que ela encontrou).

## O que se fez

- Lido o `eurolify-verificacao` (ADR-0027): dá «falhou» sempre que encontra
  um problema da sua lista (disco, memória, serviços, contentores, limpezas,
  actualizações de segurança, reinício pedido, datas das decisões, token do
  GHCR, certificados). A lista vai para o Healthchecks.io e para o diário da
  unidade; o `medir` só mostrava «failed».
- Causa provável, pela medição de 13/10/2026 às 10:15 UTC (fluxo `medir`,
  execução 38382102795): 38 actualizações por instalar e «Reinício pedido
  pelas actualizações». O resto da lista que se vê na medição estava bem
  (disco 42 %, 2,8 GiB livres, serviços activos, certificados até Janeiro).
- As actualizações e o reinício estavam marcados para 12/10 às 20:05 de
  Lisboa (sessão filha); o conector do MCP da VPS caiu e não se fizeram.
  Foram remarcados para 13/10 às 20:05 de Lisboa (lembrete
  `trig_01QKJAwTh78pHVGcN8Q97F51`, na sessão filha).
- O `eurolify-medir` ganha a secção «verificação diária (o que encontrou na
  última vez)»: as linhas da lista («- …» ou «Sem problemas.») da última
  corrida, pela invocação do systemd (sem ela, as últimas 26 h a partir do
  último arranque da unidade), no máximo 40; com a verificação a correr,
  diz-se. Só o estado da máquina; as linhas do systemd ficam de fora
  (revisão do #428).

## Números (com data e como se contaram)

- 13/10/2026, `infra/vps/testes/publicar.sh` num Ubuntu 26.04 descartável
  (a imagem do CI): 229 verificações certas, 16 delas novas. Contraprovas
  (cada uma faz falhar o seu caso): sem o filtro das linhas; sem o corte no
  último arranque da unidade; sem a mensagem da verificação a correr. Os outros nove
  testes da VPS, todos certos. `shellcheck` 0.10.0 sem avisos.

- Medido a 13/10/2026 às 13:22 UTC, com o `medir` novo instalado pelo
  `aplicar-script` às 13:18 UTC (#428; execução 38404342253): a verificação
  de 13/10 às 07:00 encontrou **um** problema só, «- reinício pedido pelas
  actualizações — fazer fora do horário de trabalho e anunciado
  (AGENTS.md)». As 38 actualizações não contam como «de segurança» para o
  `apt-check` (não estão na lista). Confirma a causa.

## O que ficou por verificar

- Se a verificação de 14/10 às 07:00 passa depois das actualizações e do
  reinício de 13/10 às 20:05.
- Se o `InvocationID` da unidade fica guardado depois de uma corrida, com
  sucesso ou com falha (não verifiquei num systemd real); sem ele vale o
  caminho das 26 h, a partir do último arranque da unidade.
- Se a primeira linha de um erro do psql na verificação pode trazer um valor
  (revisão do #428, P3-3; as funções das migrações 0026 e 0035 não foram
  lidas para isto).
