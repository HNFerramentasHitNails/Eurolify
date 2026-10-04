# ADR-0035 · A revisão do agente pode ser um agente lançado da mesma sessão, sem a conversa dela

- **Estado:** aceite · muda o ponto 1 do [ADR-0030](0030-revisao-sem-codex-e-sem-a-outra-pessoa.md)
  (que exigia uma sessão nova); mantém a data de revisão dele, **29/11/2026**
- **Data:** 04/10/2026
- **Quem decidiu:** Diogo
- **Decisão em aberto de origem:** — (pedido do Diogo na sessão de revisão do #45)

## Contexto

- O ADR-0030 diz que, sem o Codex, a revisão do código é de «uma sessão nova
  do Claude Code, sem a conversa de quem escreveu e, se possível, com outro
  modelo».
- Na prática, a 04/10/2026, cada sessão abria a sua sessão revisora; as
  revisoras acabavam a corrigir código e a abrir outras. Contado com
  `list_sessions` às 19:02 UTC: **15 sessões do Eurolify abertas nesse dia**,
  repartidas pelos pedidos #43 (7), #45 (5) e #47 (3), duas delas a corrigir a
  mesma revisão do #40 em dois pedidos (#45 e #47). Duas correcções paralelas
  do mesmo achado chegaram a ser escritas em sessões diferentes (uma ficou de
  fora, sem push).
- O Diogo, a 04/10/2026: *«ja tenho 12 sessoes abertas, e ja estou perdido
  sobre o que esta a fazer. podemos manter tudo dentro da mesma sessão e
  avançares com varios agentes em vez de varias sessoes?»*. O Claude respondeu
  que um agente lançado pela ferramenta `Agent` começa sem a conversa de quem
  o lança e pode correr noutro modelo, mas que não é uma «sessão nova», e
  perguntou se a regra podia mudar. Resposta: *«sim, escreve no AGENTS.md»*.

## Opções consideradas

| Opção | A favor | Contra |
|---|---|---|
| a) Manter só a sessão nova | Cumpre o ADR-0030 à letra | Sessões a multiplicar-se, ninguém sabe o que cada uma faz |
| **b) Também um agente lançado da sessão, sem a conversa dela** | Tudo numa conversa que o Diogo ou o Bruno acompanha; o revisor começa do zero e pode ser outro modelo | Quem lança escolhe o que o agente lê: o pedido ao agente tem de ser só o pedido de revisão, sem conclusões |

## Decisão

1. **A revisão do agente (ADR-0030, ponto 1) pode ser feita por uma sessão nova
   ou por um agente lançado da sessão de trabalho** (ferramenta `Agent`, não
   uma cópia da conversa), desde que:
   - o agente **não recebe a conversa** de quem escreveu: o pedido diz só o
     pedido de alteração, os commits, os ficheiros, o desenho a cumprir e o
     que rever — nunca a opinião de quem escreveu sobre o próprio código;
   - **se possível, outro modelo** (ex.: escreveu o Opus, revê o Sonnet);
   - o agente **só lê e mede**: não faz push nem altera ficheiros do ramo;
   - a revisão é publicada no pedido tal como o agente a devolveu, dizendo que
     foi um agente e com que modelo; os P0/P1 tratam-se antes de juntar.
2. **Corrigir e rever ficam na mesma sessão**: a sessão corrige, lança um agente
   novo para rever o que corrigiu, e repete até não haver P0/P1. Não se abrem
   sessões revisoras novas sem o Diogo ou o Bruno o pedirem.
3. Vários agentes ao mesmo tempo, só com o OK de quem pediu (`AGENTS.md`,
   «Agentes»).
4. **Revê-se a 29/11/2026**, com o ADR-0030.

## Consequências

- O `AGENTS.md` (secção Git e secção Agentes) passa a dizer isto.
- **O que pode partir:**
  - o pedido ao agente levar, sem querer, as conclusões de quem escreveu — e a
    revisão deixa de ser independente; por isso o ponto 1 diz o que o pedido
    pode conter;
  - um agente que rebenta a meio devolve uma revisão parcial; publica-se só o
    que ele verificou, dito como parcial.

## O que ficou por verificar

- Se um agente lançado da sessão apanha o mesmo que uma sessão nova (não há
  termo de comparação).
- Que sessões abertas a 04/10/2026 se arquivam: decide o Diogo.
