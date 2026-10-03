# ADR-0017 · A VPS é uma VPS-3 da OVH, num centro de dados na UE

- **Estado:** aceite · o centro de dados da VPS comprada é o do Reino Unido,
  por excepção temporária só para o ensaio: [ADR-0018](0018-vps-do-ensaio-no-reino-unido.md)
- **Data:** 03/10/2026
- **Quem decidiu:** Diogo
- **Decisão em aberto de origem:** `docs/11-preparacao-da-vps.md` §7, ponto 1
  (completa o [ADR-0015](0015-alojamento-numa-vps.md))

## Contexto

O ADR-0015 decidiu uma VPS operada pelo Diogo e pelo Bruno e deixou o
fornecedor e o plano por escolher. Preços da página portuguesa das VPS da OVH,
lidos a 03/10/2026 (*«a partir de»*, sem IVA): VPS-2 (4 vCores, 8 GB, 75 GB)
7,21 €; **VPS-3 (6 vCores, 12 GB, 100 GB NVMe) 10,40 €**; VPS-4 (8 vCores,
24 GB, 200 GB) 19,96 €; todas com *«Backup automatizado 1 dia»*.

Pergunta feita ao Diogo: *«para começar com o ensaio, fica a VPS-3 da OVH (6
vCores, 12 GB, 10,40 € + IVA/mês), num centro de dados na UE?»* Resposta, a
03/10/2026: *«sim, fica a VPS-3 da OVH»*.

## Opções consideradas

| Opção | A favor | Contra |
|---|---|---|
| VPS-2 (7,21 €) | Mais barata | 8 GB para a base, a API, o Hub e as construções das imagens: pouca margem (**C**, não medido) |
| **VPS-3 (10,40 €)** | 12 GB e 6 vCores: margem para tudo na mesma máquina | — |
| VPS-4 (19,96 €) | Mais margem | O dobro do preço sem carga medida que o peça |

## Decisão

Começa-se com **uma VPS-3 da OVH, num centro de dados na UE**, para o ensaio
durante a construção.

## Consequências

- Quem compra: o Diogo ou o Bruno, na consola da OVH (`docs/11` §2).
- **O centro de dados escolhe-se na compra.** A página das VPS mostra as
  localizações num mapa; o texto não as lista (procurei os nomes das cidades
  europeias da OVH no texto da página: nenhum). Tem de ser na UE (regra 4 do
  `AGENTS.md`).
- A produção numa segunda máquina, antes do primeiro comerciante de fora,
  continua proposta (`docs/11` §7, ponto 3).
- **O que pode partir:** se o preço «a partir de» exigir 12 meses pagos
  adiantados (o que diz a página irlandesa, lida por resumo), trocar de plano
  ou de fornecedor antes disso tem custo.

## O que ficou por verificar

- As condições do preço e o preço sem compromisso.
- Os centros de dados da UE disponíveis para a VPS-3.
- O acordo de tratamento de dados da OVH.
