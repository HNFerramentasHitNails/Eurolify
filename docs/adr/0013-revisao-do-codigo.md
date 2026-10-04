# ADR-0013 · O código que um escreve, o outro revê — e o agente que não escreveu revê o diff

- **Estado:** aceite · ponto 1 (o outro aprova) substituído pelo [ADR-0031](0031-cada-um-aprova-o-que-fez.md): cada um junta o que fez · ponto 2 (o Codex revê) mudado, enquanto o Codex não volta, e o caso «a outra pessoa não pode rever» decidido pelo [ADR-0030](0030-revisao-sem-codex-e-sem-a-outra-pessoa.md)
- **Data:** 03/10/2026
- **Quem decidiu:** Diogo
- **Decisão em aberto de origem:** a proposta «Quem revê» do
  [ADR-0008](0008-construcao-pelo-diogo-e-pelo-bruno.md)

## Contexto

Com o ADR-0008, o Eurolify é desenvolvido só pelo Diogo e pelo Bruno, com
Claude Code e Codex, sem programador contratado. O ADR-0008 deixava escrito:
*«ninguém revê por ofício o que entra no `main`»*, e uma proposta por decidir.
O Eurolify vai tratar documentos fiscais de outras empresas; nos sistemas
actuais, as lições mais caras vieram de mudanças que ninguém reviu (277
faturas em 90 dias por uma rede temporária, 77 funções abertas a quem não
tinha sessão — `docs/04`).

Pergunta feita ao Diogo a 03/10/2026: *«Fica assim a revisão: o que um de vocês
escreve, o outro revê antes de entrar no `main`, e o agente que não escreveu
revê o diff (o Codex revê o que o Claude escreveu e o contrário)?»*
Resposta: *«sim, fica assim»*.

## Opções consideradas

| Opção | A favor | Contra |
|---|---|---|
| **a) Duas revisões: a outra pessoa e o outro agente** | Duas leituras independentes; o agente que não escreveu não tem o contexto que levou ao erro | Cada mudança espera pela outra pessoa |
| b) Só o outro agente revê | Mais rápido | Nenhuma pessoa lê o que entra |
| c) Sem revisão; os testes chegam | O mais rápido | Os testes só apanham o que alguém pensou testar |

## Decisão

1. **O código que o Diogo escreve, o Bruno revê antes de entrar no `main`, e
   o contrário.**
2. **O agente que não escreveu revê o diff**: o Codex revê o que o Claude Code
   escreveu e o Claude Code revê o que o Codex escreveu.
3. **Vale para código** (o que o ADR-0001 conta como código), **a partir da
   primeira linha**. Os documentos de desenho continuam a entrar como hoje,
   pela via do `AGENTS.md`. A pergunta foi sobre o código.

## Consequências

- A regra passa para o `AGENTS.md` (secção Git), onde os dois agentes a lêem
  (ADR-0010).
- **Uma sessão não leva código ao `main`** pela via de hoje (`cherry-pick` e
  `push` directo). O código passa a entrar por um pedido de alteração revisto.
- **Como se impõe, por decidir com o OK para código** (proposta minha): o `main`
  protegido no GitHub, com revisão obrigatória antes de juntar. Conta como
  configuração de integração contínua e espera pelo OK (ADR-0001).
- Os testes de isolamento entre inquilinos e o teste de intrusão externo antes
  do primeiro comerciante de fora continuam obrigatórios (`docs/05`, `docs/10`
  §5). A revisão não os substitui.
- **O que pode partir:** se um dos dois estiver fora, o código do outro fica
  parado à espera. Não está decidido o que acontece numa correcção urgente.
- Não é o OK para código (ADR-0001).

## O que ficou por verificar

- O que se faz quando a outra pessoa não pode rever (férias, doença, urgência).
- Se o Codex, numa sessão de revisão, segue as mesmas regras e skills: o teste
  do ADR-0010 ainda não foi feito.
