# ADR-0014 · Um só ensaio na Scaleway, actualizado a cada entrada no `main`

- **Estado:** aceite · o ensaio passa para a VPS pelo
  [ADR-0015](0015-alojamento-numa-vps.md); a decisão (um só, a cada entrada no `main`) mantém-se
- **Data:** 03/10/2026
- **Quem decidiu:** Diogo
- **Decisão em aberto de origem:** — (completa o
  [ADR-0005](0005-publicacao-pelo-github.md), que decidiu publicar pelo
  GitHub e escrever só num projecto de ensaio, mas não quantos ensaios há nem
  quando se actualizam)

## Contexto

Pedido do Diogo, a 03/10/2026: *«Verifica antes de escrever código, como
podemos depois fazer deploy no scaleway para ver em tempo real o que estamos a
contruir.»*

Lido nesse dia: o texto da documentação da Scaleway (repositório
`scaleway/docs-content`, commit `416c1da` de 02/10/2026 — contentores sem
servidor, registo de imagens, permissões, base SQL sem servidor e o tutorial
do GitHub) e as páginas de preços. Pormenor, números e fontes em
`memoria/scaleway-publicacao-ensaio-03out2026.md`. Em resumo:

- O caminho do ADR-0005 faz-se com o que a Scaleway tem: o GitHub corre os
  testes, constrói a imagem, envia-a para o registo de imagens do
  `eurolify-ensaio` e actualiza o contentor. No `scw` 2.63.0, actualizar o
  contentor já o volta a pôr no ar (`scw container container --help`).
- Não é «tempo real»: a documentação diz que pôr um contentor no ar *«can take
  several minutes»*. Não medido.

Pergunta feita ao Diogo: *«quando houver código, o ensaio é um só,
actualizado a cada entrada no `main`, ou queres também uma pré-visualização
por cada ramo de trabalho?»* Resposta, a 03/10/2026: *«o ensaio é um só,
actualizado a cada entrada no main»*.

## Opções consideradas

| Opção | A favor | Contra |
|---|---|---|
| **a) Um só ensaio, actualizado a cada entrada no `main`** | Bate com «o `main` é o que conta» (`AGENTS.md`) e com o ADR-0005; uma base de ensaio só; o que lá aparece já passou as duas revisões do ADR-0013 | Uma alteração não se vê na Scaleway antes de entrar no `main` |
| b) Também uma pré-visualização por ramo | Vê-se cada alteração antes de entrar | Uma base por ramo (não desenhada), mais contentores, custo e limpeza |

## Decisão

1. Há **um só ensaio**, no projecto `eurolify-ensaio` da Scaleway.
2. Actualiza-se **a cada entrada no `main`**, pelo caminho do GitHub do
   ADR-0005: testes, imagem, registo de imagens, contentor.
3. **Não há pré-visualizações por ramo.**

## Consequências

- Com o ADR-0013, o código entra no `main` por um pedido de alteração revisto:
  o que aparece no ensaio já foi revisto pela outra pessoa e pelo outro
  agente. Antes disso, uma alteração vê-se **dentro da sessão** (o Eurolify a
  correr na sessão, com capturas de ecrã), não na Scaleway.
- **Não é o OK para código.** Criar o registo de imagens, o contentor, a base,
  a chave de escrita, os segredos do GitHub e o fluxo de publicação continua
  fechado (ADR-0001, ADR-0011).
- **Por decidir com o OK para código** (propostas minhas, com fonte na
  memória):
  - o endereço do ensaio fica **público**: um contentor privado só aceita
    pedidos com o cabeçalho `X-Auth-Token` (sem ele, 403), e um browser não o
    manda; a protecção é o login do Eurolify e, até ele existir, uma
    palavra-passe guardada como segredo do contentor; nunca dados pessoais
    reais (`docs/02` §6);
  - a base do ensaio em **PostgreSQL gerido**, a máquina mais pequena, e não a
    base SQL sem servidor da Scaleway, que não aceita `GRANT` nem
    `CREATE USER` por SQL, partilha o `SET` entre clientes e não garante o
    `pg_advisory_lock`;
  - a chave de escrita do GitHub: uma aplicação IAM nova, com
    `ContainerRegistryFullAccess` e `ContainersFullAccess` só no
    `eurolify-ensaio` (não há conjunto «só publicar») e data de fim;
  - quando nasce a produção e como se passa do ensaio para ela;
  - se uma entrada no `main` só com documentos também republica.
- **O que pode partir:**
  - um `main` partido deixa o ensaio partido para os dois ao mesmo tempo;
  - uma migração errada que entre no `main` corre logo na única base de
    ensaio, e não há outra onde a ensaiar antes.

## O que ficou por verificar

- Quanto demora uma publicação e o arranque depois de o contentor desligar
  por inactividade (15 minutos, segundo a documentação).
- Se a máquina DB-DEV-S ainda se pode criar e qual é o disco mínimo.
- Se a chave `claude-leitura` lê os registos do contentor
  (`scw container container logs`): não há contentor onde experimentar.
- O âmbito da aplicação IAM `serverless-namespace-…` que a Scaleway cria
  sozinha com cada grupo de contentores.
