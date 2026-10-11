# ADR-0042 · A gestão da empresa inteira entra no produto, em módulos ligáveis a partir da Fase 2

- **Estado:** aceite
- **Data:** 11/10/2026
- **Quem decidiu:** Diogo (*«a, actualiza o docs/00 e o docs/05»*, resposta à
  pergunta do `docs/31` §10)
- **Decisão em aberto de origem:** `docs/31-hub-de-gestao-da-empresa.md` §10
  (issue #355); muda o `docs/00-proposta.md` §2.2

## Contexto

O `docs/00` §2.2 (versão 0.3, 03/10/2026) dizia que o Hub do Eurolify cobria a
loja — catálogo, encomendas, clientes, stock, armazém, faturação, devoluções —
e que *«assiduidade, marketing editorial, streaming, gráfica»* não entravam,
por serem *«de uma empresa, não de uma loja»*.

A 11/10/2026 o Diogo pediu que o Eurolify fosse *«mais que uma loja estilo
shopify, mas também uma plataforma completa para gerir toda a empresa»*, a
partir da apresentação e da proposta comercial do Hub interno actual. O
`docs/31` mapeou esse Hub: 15 sequências de trabalho e 32 módulos (proposta
p. 24), dos quais 7 servem qualquer loja, 20 são de gestão da empresa e 5 são
de um sector (contados à mão sobre a tabela do `docs/31` §4).

A prova de procura é de **um** comprador: o Hub corre numa empresa (proposta
p. 2); nenhum comerciante de fora foi ouvido (portas 3 e 4 «não se sabe»,
`docs/13`). A Fase 1 está estimada em 17 a 32 meses a tempo inteiro (`docs/10`
§9, **C**) e não conta com estes módulos.

## Opções consideradas

| Opção | A favor | Contra |
|---|---|---|
| **a) Sim, em módulos ligáveis a partir da Fase 2** | O núcleo e o prazo da Fase 1 não mudam; cada módulo entra quando houver quem o peça | A gestão da empresa só chega depois do primeiro comerciante |
| b) Sim, já na Fase 1 | Chega mais cedo | A Fase 1 cresce sem estimativa; o critério de passagem (3 meses sem documento fiscal errado) afasta-se |
| c) Não | Fica o `docs/00` §2.2 | O Eurolify fica sem a parte que distingue o Hub actual |

## Decisão

**A gestão da empresa inteira passa a fazer parte do produto Eurolify, em
módulos que cada comerciante liga, a partir da Fase 2.** São as camadas B a H
do `docs/31` §8: operação, comercial, financeiro, organização, sectoriais,
pessoas e parceiros.

Cada módulo, antes de ser desenhado, passa pelas **8 portas** (skill
`platform-architect`) com o resultado escrito; e, antes do código, tem o
modelo e a lista da API em tabela (ADR-0023). Construir cada um continua a
ser decisão do Diogo ou do Bruno.

Não muda a Fase 1 (núcleo da loja) nem o seu critério de passagem.

## Consequências

- O `docs/00` §2.2 e o `docs/05` (Fase 1 «fica de fora», Fase 2) passam a
  dizê-lo; o `docs/13` recebe os módulos novos para as portas.
- **Ficam como estão, para estes módulos também:**
  - a IA só lê na Fase 1 e escreve com confirmação humana na Fase 3
    (ADR-0040) — os assistentes do Hub actual que criam artigos e tarefas
    esperam por isso;
  - as regras fiscais e legais não são extensíveis (decisão K);
  - um serviço de fora da UE que receba dados pessoais só entra com decisão
    escrita e acordo de transferência (`AGENTS.md`, «Regras da UE», regra 4);
  - a carteira de cliente só com o contabilista e o choque com a
    `gift-cards-eu` decidido.
- **Os módulos de pessoas** (assiduidade, biometria, avaliações, perfis
  comportamentais) só se desenham com o jurista: dados biométricos são
  categoria especial do RGPD (art. 9.º) e o direito do trabalho é de cada
  Estado-membro — **não verificado**.
- A estimativa (`docs/10`) não conta estes módulos; ficam **por estimar**, um
  a um, quando passarem as portas.
- Pode partir: a leitura de que «Hub do Eurolify» é só o back-office da loja,
  noutros documentos. Procurei a exclusão antiga em `docs/`, `README.md`,
  `AGENTS.md` e nas skills (`grep` por «streaming», «marketing editorial» e
  «de uma empresa, não») — só estava no `docs/00` §2.2.

## O que ficou por verificar

- Nenhuma das regras fiscais e legais dos módulos novos foi verificada (todas
  **C** no `docs/31`).
- Nenhum módulo passou ainda pelas 8 portas por inteiro; o `docs/31` §4 dá só
  a natureza e o estado.
- Prazo e custo dos módulos: não estimados.
