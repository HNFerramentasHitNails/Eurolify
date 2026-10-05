# ADR-0018 · A VPS do ensaio fica, por agora, no Reino Unido; migra-se para Paris

- **Estado:** aceite · **excepção temporária** ao centro de dados na UE do
  [ADR-0017](0017-vps-3-da-ovh.md) e à regra 4 do `AGENTS.md`, **só para o
  ensaio e sem dados pessoais reais** · **data de fim: 31/03/2027**, ou antes
  se entrar um dado de cliente real ([ADR-0019](0019-fim-da-vps-no-reino-unido.md))
- **Data:** 03/10/2026
- **Quem decidiu:** Diogo
- **Decisão em aberto de origem:** `docs/11-preparacao-da-vps.md` §1 (a
  localização da VPS comprada)

## Contexto

A VPS da OVH foi comprada a 03/10/2026 (`vps-c01fa544.vps.ovh.net`) — uma
VPS-1, não a VPS-3 que aqui se escrevia (corrigido a 04/10/2026,
[ADR-0021](0021-vps-1-ate-a-migracao.md)). O
registo da RIPE dos dois endereços dá o Reino Unido: o IPv4 está no bloco
`VPS-UK2`, país GB, titular «OVH Ltd», e o IPv6 no bloco `OVH-PCI-ERI`, país GB
(`rdap.db.ripe.net`, 03/10/2026). O Diogo confirmou na consola da OVH, a
03/10/2026: *«está em uk. mais tarde faremos a migração para um servidor em
paris. agora so havia esta localidade para a vps»*.

Lido na API pública da OVH a 03/10/2026, 23:10 UTC
(`eu.api.ovh.com/v1/vps/order/rule/datacenter`, plano `vps-2025-model3`,
subsidiária PT): os 11 centros do VPS-3 estavam **todos esgotados**
(`out-of-stock`). Os da UE são `eu-west-gra`, `eu-west-sbg`, `eu-west-rbx`,
`eu-west-lim` (o «DE»), `eu-central-waw` e `eu-south-mil`; o «UK» é
`eu-west-eri`. A consulta é posterior à compra: não mostra o que havia no
momento em que o Diogo comprou. **Paris não está na lista** dos centros das
VPS.

## Opções consideradas

| Opção | A favor | Contra |
|---|---|---|
| a) Esperar por uma VPS-3 num centro da UE | Cumpre a regra 4 desde o primeiro dia | Não havia nenhuma disponível; atrasa a preparação |
| **b) Ficar com a do Reino Unido para o ensaio e migrar para Paris** | Começa-se já; o ensaio não tem dados pessoais reais | Uma migração a fazer; uma excepção que pode ficar esquecida |

## Decisão

1. A VPS `vps-c01fa544` (centro `UK` da OVH) fica **para o ensaio**, por
   agora.
2. **Migra-se para um servidor em Paris** mais tarde (Diogo).
3. **Data de fim: por decidir.** Proposta do Claude: a migração faz-se
   **antes do primeiro dado pessoal real**, e nunca depois de uma data fixa a
   escolher pelo Diogo ou pelo Bruno (regra «uma rede temporária tem data de
   fim escrita», `AGENTS.md`).
4. Mantém-se o que já estava escrito para o ensaio: **sem dados pessoais
   reais** (`docs/11` §3.7, `docs/02` §6): nenhum cliente, encomenda ou
   comerciante verdadeiro. Os registos técnicos da máquina são a excepção que
   sobra (ver «O que pode partir»).
5. A produção **não** vai para esta máquina: a regra 4 continua a valer para
   ela sem excepção.

## Consequências

- **Tudo o que se instala nesta máquina tem de sair do script de preparação
  do repositório** (`docs/11`), para que migrar seja correr o mesmo script em
  Paris e repor a base, e não refazer à mão o que se fez aqui.
- **O servidor de Paris não é uma VPS da gama actual** (Paris não está na
  lista dos centros das VPS da OVH, 03/10/2026). Que produto é, quanto custa e
  se substitui o VPS-3 do ADR-0017: por decidir quando se migrar.
- **O que pode partir:**
  - alguém pôr dados pessoais reais no ensaio (ex.: importar uma lista de
    clientes verdadeira para testar) — os dados saem da UE sem acordo de
    transferência. A base legal para transferir dados pessoais para o Reino
    Unido (RGPD, capítulo V) **não a verifiquei**;
  - **os registos técnicos guardam endereços IP**, que são dados pessoais
    (skill `eu-gdpr-privacy`, «Quando usar»): os do Diogo e do Bruno nos
    registos do SSH, e os de quem abrir o ensaio, se o endereço for público
    (ADR-0014). Quanto tempo se guardam e se se encurtam: por decidir no
    script;
  - a excepção ficar para sempre por não ter data de fim;
  - as chaves SSH e as configurações feitas à mão que não estejam no script
    perdem-se na migração.

## Nota de 05/10/2026 — contas dos operadores nos registos

O número e o login da conta do GitHub do Diogo e do Bruno, que o MCP da VPS
grava (ADR-0033; auditoria `docs/16`), entram na excepção dos registos
técnicos do ponto 4, **com 14 dias, como os endereços IP**. Decisão do Diogo:
*«14 dias, como os IP»*. Aplicado no `logrotate-eurolify` (`acoes.log`), no
registo do contentor do MCP, que passa para o diário do sistema
(`journald-eurolify.conf`, 14 dias, com um ficheiro por dia para o prazo
valer ao dia), e no `rsyslog-eurolify.conf`, que deixa essas linhas fora do
`/var/log/syslog`. Pormenor no `docs/17` §3. Fica de fora, como já estava: o
`auth.log` e o `fail2ban.log` com IP (`infra/vps/LEIA-ME.md`).

## O que ficou por verificar

- A data de fim (ponto 3).
- Que produto da OVH é o «servidor em Paris», o preço e a disponibilidade.
- Se a OVH muda uma VPS de centro de dados sem comprar outra, e o custo de
  sair desta antes do fim do período pago (se for de 12 meses adiantados).
- A base de transferência do RGPD para o Reino Unido.
