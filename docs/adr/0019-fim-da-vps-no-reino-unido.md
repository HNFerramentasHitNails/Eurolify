# ADR-0019 · A excepção do Reino Unido acaba a 31/03/2027

- **Estado:** aceite · completa o
  [ADR-0018](0018-vps-do-ensaio-no-reino-unido.md) (ponto 3, data de fim)
- **Data:** 03/10/2026
- **Quem decidiu:** Diogo
- **Decisão em aberto de origem:** ADR-0018, ponto 3

## Contexto

O ADR-0018 deixou a VPS do ensaio no Reino Unido até à migração para um
servidor em Paris, sem data de fim. A regra do `AGENTS.md` («uma rede
temporária tem data de fim escrita») e a skill `platform-architect` («se for
temporária, data de fim») exigem-na. A lição é a do Hub: uma rede sem data
ficou um mês e levou 277 faturas em 90 dias (`docs/04`, 2.11).

Pergunta feita ao Diogo: *«Que data de fim escrevo para a migração para Paris?
Proponho 31/03/2027 (seis meses), ou antes disso, se algum dado de um cliente
real tiver de entrar.»* Resposta, a 03/10/2026: *«sim, 31/03/2027»*.

## Opções consideradas

| Opção | A favor | Contra |
|---|---|---|
| Sem data, «quando houver Paris» | Nenhum prazo a cumprir | A excepção pode ficar para sempre (lição 2.11) |
| **31/03/2027, ou antes se entrar um dado de cliente real** | Seis meses; a excepção tem um fim que se vê | Se não houver servidor em Paris até lá, é preciso decidir outra vez |

## Decisão

A excepção do ADR-0018 acaba a **31/03/2027**, ou **antes**, se algum dado de
um cliente real tiver de entrar no ensaio. Até essa data, o ensaio tem de estar
num centro de dados na UE.

## Consequências

- Se a 31/03/2027 o ensaio não tiver migrado, **a excepção não se prolonga em
  silêncio**: ou se migra, ou o Diogo ou o Bruno decidem outra coisa num ADR
  novo.
- **Alarme** (proposta): os alertas da máquina (`docs/11` §3.8) avisam a
  partir de 01/03/2027, um mês antes.
- **O que pode partir:** a data passar sem ninguém a ver, se os alertas ainda
  não existirem nessa altura (para onde vão está por decidir, `docs/11` §7).

## O que ficou por verificar

- O que o ADR-0018 deixou: que produto é o servidor de Paris, o preço, a
  disponibilidade e o custo de sair desta VPS antes do fim do período pago.
