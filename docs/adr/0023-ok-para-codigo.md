# ADR-0023 · OK para código: o produto, o script da VPS e a integração contínua

- **Estado:** aceite · substitui o [ADR-0001](0001-sem-codigo-ate-plano-decidido.md)
- **Data:** 04/10/2026
- **Quem decidiu:** Diogo
- **Decisão em aberto de origem:** critério de passagem da Fase 0
  (`docs/05-fases-e-mvp.md`; [ADR-0012](0012-precos-da-d14-antes-da-peca-13.md))

## Contexto

O ADR-0001 fechou o código até haver OK escrito do Diogo ou do Bruno, e o
ADR-0015 abriu-o só para a preparação da VPS. O critério de passagem da Fase 0
(ADR-0012) pede três coisas: a D-13 decidida (ADR-0008, 03/10/2026), a base
da D-14 decidida (ADR-0007, 03/10/2026) e o OK escrito para código. As duas
primeiras estavam cumpridas.

Pedido do Diogo, a 04/10/2026: *«preparar tudo para começarmos a escrever o
código do Eurolify no GitHub e para que cada entrada no main seja publicada
sozinha no ensaio (a VPS)»*, com o âmbito *«código do produto, script da VPS,
integração contínua»*.

O Claude mostrou este texto, com a trava «o domínio espera pelo desenho», e
perguntou se o gravava com ela ou sem ela. Resposta do Diogo, a 04/10/2026:
*«podes avançar mesmo assim»* — lida como OK ao texto mostrado, com a trava.

Ficam por fazer entregáveis da Fase 0 que não são critério de passagem
(`docs/05`): o modelo de domínio em tabelas, a lista de recursos e operações
da API, as regras do IVA validadas pelo contabilista, os fluxos do consumidor
validados por jurista e as conversas com comerciantes.

## Opções consideradas

| Opção | A favor | Contra |
|---|---|---|
| a) Manter o ADR-0001 até acabar o resto da Fase 0 | O código nasce sobre o modelo de domínio e a lista da API | Adia o esqueleto, a publicação e o script da VPS, que não dependem desse desenho |
| **b) OK para código, com as duas revisões desde a primeira linha** | Começa-se pelo que não depende do domínio (esqueleto, publicação, VPS); o critério de passagem está cumprido | Risco de escrever domínio antes de o desenhar |

## Decisão

**O código do Eurolify passa a poder escrever-se**: o código do produto, o
script de preparação da VPS e a integração contínua (fluxos do GitHub
Actions). Tudo o que o ADR-0001, ponto 2, contava como código — provas de
conceito, contrato OpenAPI, esquemas da base, configuração de alojamento e de
integração contínua — entra pelas **duas revisões do ADR-0013**, num ramo e
num pedido de alteração, e nunca directo ao `main`.

## Consequências

- O ADR-0001 passa a «substituído pelo ADR-0023». Varreram-se os documentos
  vivos que diziam «não há código»: `AGENTS.md`, `README.md`, o cabeçalho das
  14 skills e os `docs/00`, `05`, `06`, `08`, `10` e `12`. Os ADR aceites e as
  memórias datadas ficam como estão.
- Mantêm-se: as duas revisões (ADR-0013), a publicação pelo GitHub (ADR-0005,
  ponto 1), o ensaio único (ADR-0014), o ensaio sem dados pessoais reais
  (ADR-0018) e as regras fiscais do `AGENTS.md`.
- Como se impõem as duas revisões no GitHub decide-se a seguir (A2 do pedido
  de 04/10/2026).
- **O domínio espera pelo desenho**: código de domínio (catálogo, IVA,
  encomendas…) só depois de o modelo do domínio e a lista da API desse domínio
  estarem escritos em tabela (`docs/05`, Fase 0). O esqueleto, a publicação e
  a VPS não esperam.
- **O que pode partir:**
  - escrever um domínio antes de o desenhar e ter de o refazer — a lição
    «construir antes de mapear» que levou ao ADR-0001;
  - a revisão do Bruno torna-se o gargalo: nada entra no `main` sem ele, e
    ainda não está decidido o que acontece quando não pode rever (ADR-0013);
  - o primeiro código corre numa VPS no Reino Unido, até 31/03/2027 (ADR-0019):
    nenhum dado pessoal real no ensaio.

## O que ficou por verificar

- Se o Bruno concorda: a decisão é válida só com o OK do Diogo (`AGENTS.md`,
  «Quem decide»), mas é ele quem revê o código.
- Se o Diogo queria a trava «o domínio espera pelo desenho»: a resposta não a
  nomeou; ficou porque estava no texto mostrado.
