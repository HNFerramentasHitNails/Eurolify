# ADR-0021 · O ensaio fica na VPS-1 comprada até à migração para Paris

- **Estado:** aceite · muda o plano do [ADR-0017](0017-vps-3-da-ovh.md)
  (VPS-3) para a máquina do ensaio no Reino Unido; acaba com ela, na migração
  para Paris, **até 31/03/2027** ([ADR-0019](0019-fim-da-vps-no-reino-unido.md))
- **Data:** 04/10/2026
- **Quem decidiu:** Diogo
- **Decisão em aberto de origem:** — (a VPS comprada não é a do ADR-0017)

## Contexto

O ADR-0017 decidiu uma VPS-3 da OVH (6 vCores, 12 GB, 100 GB; 10,40 €/mês «a
partir de», sem IVA). A máquina comprada a 03/10/2026 (`vps-c01fa544`) mede 2
núcleos, 3,7 GiB de memória sem swap e 40 GB de disco (`nproc`, `free -h`,
`lsblk`, medidos pelo Claude Code no computador do Diogo a 03/10/2026, 23:49
UTC). O Diogo confirmou na consola da OVH a 04/10/2026: *«é mesmo a vps 1»*. A
VPS-1 custa 3,81 €/mês «a partir de», sem IVA (página portuguesa da OVH,
03/10/2026).

A API pública da OVH dava, a 04/10/2026 às 00:01 UTC, a VPS-1 e a VPS-3
esgotadas nos 11 centros, incluindo o do Reino Unido onde o Diogo comprou
minutos antes. Se o indicador corresponde à página de compra: não verificado.

Pergunta feita ao Diogo: *«Ficamos com a VPS-1 até à migração para Paris
(muda a decisão X), ou tentas subir para a VPS-3?»* Resposta, a 04/10/2026:
*«ficamos com a VPS-1 até à migração»*.

## Opções consideradas

| Opção | A favor | Contra |
|---|---|---|
| **a) Ficar com a VPS-1 até à migração** | Ainda não há código (ADR-0001); a máquina é temporária (ADR-0019); 3,81 € em vez de 10,40 €; o tamanho de Paris escolhe-se com a carga medida | 3,7 GiB sem swap: a base, a API, o Hub e as construções das imagens ao mesmo tempo ficam apertados (**C**, não medido) |
| b) Subir para a VPS-3 | A margem que o ADR-0017 queria | Custo; pode não haver stock; mais trabalho numa máquina que se vai largar |

## Decisão

O ensaio fica na **VPS-1** comprada (`vps-c01fa544`, Reino Unido) até à
migração para Paris, que acontece até 31/03/2027 (ADR-0019). O plano da
máquina de Paris decide-se na altura, com a carga medida no ensaio.

## Consequências

- O ADR-0017 continua a dizer o que se queria (uma VPS-3); quem lê o estado
  dele chega aqui.
- **Pesa na decisão 6 do `docs/11` §7** (Coolify ou o GitHub por SSH): a
  Coolify pede no mínimo 2 GB, mais de metade da memória desta máquina.
- As contas de custo do `docs/09` e do `docs/10` continuam por recalcular para
  a VPS (já estavam). *(04/10/2026: recalculadas — `docs/10` §5 e §8,
  `docs/09` §5.)*
- **O que pode partir:** sem swap, quando a memória acabar o sistema mata
  processos — pode ser o PostgreSQL a meio de uma escrita. Se faltar memória,
  sobe-se de plano (se a OVH deixar) por decisão do Diogo ou do Bruno; não se
  resolve em silêncio.

## O que ficou por verificar

- Se a OVH deixa subir a VPS-1 sem reinstalar, e a que preço.
- Quanta memória o ensaio usa de facto (só se mede quando houver o que correr).
- Se o indicador de stock da API corresponde à página de compra.
