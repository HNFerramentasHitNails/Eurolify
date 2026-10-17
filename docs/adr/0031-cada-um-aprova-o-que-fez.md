# ADR-0031 · Cada um junta o que fez; o histórico dos pedidos e os *issues* evitam repetir e atropelar

- **Estado:** aceite · substitui o ponto 1 do [ADR-0013](0013-revisao-do-codigo.md)
  (o outro aprova o código) e o ponto 3 do
  [ADR-0024](0024-revisoes-impostas-no-github-pro.md) (revisão obrigatória dos
  donos); torna sem objecto o ponto 2 do
  [ADR-0030](0030-revisao-sem-codex-e-sem-a-outra-pessoa.md) (quando o outro
  não pode rever); mantém o ponto 1 do ADR-0030 (revisão do agente)
- **Data:** 04/10/2026
- **Quem decidiu:** Diogo
- **Decisão em aberto de origem:** pedido do Diogo de 04/10/2026 sobre o
  trabalho a dois

## Contexto

O Diogo, a 04/10/2026: *«cada um pode auto aprovar o que fez, mas por exemplo,
o bruno trabalhou a noite inteira, e eu quando chegar de manha ao trabalho,
quero ter o historico do que foi feito para nunca haver a oportunidade de
repetir coisas, ou criar algo novo de algo que ja esteja criado. de forma a
que seja coloborativo o trabalho de dois e que ninguem atrapalha ninguem.
também pode haver trabalhos em conjunto, ao mesmo tempo, onde o bruno faz o X
e eu faço o Y.»*

Factos (GitHub, 04/10/2026): o autor de um pedido nunca o pode aprovar; a
regra do `main` (ruleset `24437624`) exigia a revisão dos donos do código. O
pedido #10, aberto pela conta dona do repositório, aparecia `CLEAN` (pronto a
juntar) antes de o `bruno-88` aceitar o convite — a trava dos donos **não
estava a funcionar como se pensava** (provavelmente porque o GitHub ignora
dono que ainda não é colaborador; não verificado a fundo).

O Claude propôs uma via intermédia (cada um aprova o que fez, excepto
`infra/vps/`, `.github/` e, mais tarde, as regras fiscais, que continuariam a
pedir o outro) e avisou, uma vez, que as lições mais caras dos sistemas
actuais vieram de mudanças que ninguém reviu (`docs/04`). Resposta do Diogo:
*«cada um aprova tudo o que fez»*.

## Opções consideradas

| Opção | A favor | Contra |
|---|---|---|
| Aprovação cruzada em tudo (ADR-0013) | Duas pessoas lêem cada mudança | O trabalho de um pára à espera do outro |
| Intermédia: cada um aprova, menos VPS, fluxos e fiscal | Revisão cruzada onde o erro custa mais | Mais uma regra a gerir |
| **Cada um aprova tudo o que fez** | Ninguém espera; o histórico substitui a revisão prévia | Nenhuma pessoa lê o código antes de entrar; a trava passa a ser os testes e a revisão do agente |

## Decisão

1. **Cada um junta o que fez**, documentos e código. O GitHub exige os testes
   verdes (fluxo `verificar`); no código, a **revisão do agente** que não o
   escreveu (ADR-0030, ponto 1) tem de estar publicada no pedido, com os
   P0/P1 tratados.
2. **O histórico é a descrição dos pedidos**: o que fez, porquê, como se
   testou, o que ficou por fazer e o que pode partir. Ao começar uma sessão, o
   agente mostra a quem pediu o que o outro juntou desde a última vez, o que
   está em curso e as tarefas abertas (`AGENTS.md`, «Antes da primeira
   resposta», ponto 4).
3. **Uma tarefa = um *issue* com dono.** Antes de começar procura-se se já
   existe (tarefa, código ou documento); o que está atribuído ao outro não se
   toca sem falar com ele.
4. **Trabalho em paralelo:** um ramo e um pedido por tarefa, aberto como
   rascunho no primeiro commit; pedidos pequenos, de preferência num domínio
   só; aviso no pedido do outro quando dois mexem no mesmo ficheiro.
5. **A regra do `main`** deixa de exigir a revisão dos donos e passa a exigir
   os testes do fluxo `verificar` — depois de o fluxo estar no `main` (#10).
   Continua: nada directo ao `main`, sem `push --force`, sem apagar o ramo.

## Consequências

- O `AGENTS.md` muda («Antes da primeira resposta», secção Git e uma secção
  nova «Trabalhar os dois»).
- O `CODEOWNERS` fica (pede revisão ao outro automaticamente, para ele saber),
  mas deixa de bloquear.
- A revisão do Bruno ao #10, prevista até 07/10/2026 (ADR-0030), deixa de ser
  condição; fica como leitura do histórico.
- **O que pode partir:**
  - um erro de um entra no `main` sem nenhuma pessoa o ter lido — incluindo
    o script que corre como root na VPS e, mais tarde, as regras fiscais; a
    trava passa a ser os testes, a revisão do agente e o `--mostrar` antes de
    aplicar na VPS;
  - um pedido com a descrição pobre apaga o histórico que a decisão quer;
  - dois a trabalhar no mesmo sítio sem *issue* nem rascunho repetem trabalho.

## O que ficou por verificar

- Porque é que o #10 aparecia `CLEAN` com a revisão dos donos ligada.
- Se o ponto 4 (rascunhos, avisos) chega na prática para não haver
  conflitos — ver às 8 semanas (29/11/2026, como o ADR-0030).

## Nota de 16/10/2026 (#471)

Para cortar os minutos pagos do GitHub Actions (Diogo, 16/10/2026), o
`verificar` deixa de correr os testes num rascunho e num pedido só com
documentos (`docs/` — menos o `docs/03`, que um teste lê —, `memoria/`,
`.agents/`, `.claude/`, `*.md` da raiz). Os trabalhos saltados contam como
verdes na regra do `main`. Num pedido com código, os testes continuam
obrigatórios (#472).
