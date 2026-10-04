# ADR-0030 · Sem o Codex, revê uma sessão nova do Claude Code; e quando a outra pessoa não pode rever

- **Estado:** aceite · ponto 2 (quando o outro não pode rever) sem objecto pelo [ADR-0031](0031-cada-um-aprova-o-que-fez.md); o ponto 1 mantém-se · muda o ponto 2 do [ADR-0013](0013-revisao-do-codigo.md)
  (o Codex revê o Claude Code) **enquanto o Codex não volta** · decide o que o
  ADR-0013 deixou em aberto («o que se faz quando a outra pessoa não pode
  rever») · ajusta o [ADR-0024](0024-revisoes-impostas-no-github-pro.md),
  ponto 5 · **data de revisão: 29/11/2026**
- **Data:** 04/10/2026
- **Quem decidiu:** Diogo
- **Decisão em aberto de origem:** ADR-0013, «O que ficou por verificar»
  (quando a outra pessoa não pode rever); pedido #10 à espera do Bruno e do
  Codex

## Contexto

- O ADR-0013 exige duas revisões do código: a da outra pessoa e a do agente que
  não o escreveu (o Codex revê o Claude Code, e o contrário). Deixou por
  decidir o que acontece quando a outra pessoa não pode rever.
- O Diogo, a 04/10/2026: *«vamos utilizar agora so o claude code, e o codex
  talvez mais tarde»*.
- O pedido #10 (o primeiro código: API, fluxos, script da VPS) foi escrito pelo
  Claude Code na conta `HNFerramentasHitNails`; o GitHub não deixa o autor
  aprovar o próprio pedido, e a regra do `main` (ADR-0024) exige a aprovação de
  um dono do código, sem excepções. O Bruno (`bruno-88`) foi convidado a
  04/10/2026 e ainda não aceitou. O Diogo: *«O bruno ja tem convite e deve de
  aceitar amanha ou segundo. por isso, avançamos sem ele com a minha
  permissão»*.
- O Claude disse que, sem o Bruno e sem o Codex, o #10 entraria sem nenhuma
  revisão independente — com um script que corre como root na VPS e mexe no
  SSH e na firewall — e propôs o plano abaixo. Resposta do Diogo, a
  04/10/2026: *«sim»*.

## Opções consideradas

| Opção | A favor | Contra |
|---|---|---|
| **a) Revisão do agente por uma sessão nova do Claude Code, com outro modelo** | Duas leituras independentes do contexto; sem outra ferramenta | Mesmo fornecedor e mesma família de modelos: menos independente do que o Codex |
| b) Só a revisão da outra pessoa | Mais simples | Uma só leitura independente |
| — para o #10: esperar pelo Bruno | Cumpre o ADR-0013 como está | Parado um ou dois dias |
| **— para o #10: entrar com a revisão do agente e o Bruno rever depois** | Não pára | O código entra no `main` antes de uma pessoa o ler |

## Decisão

1. **Enquanto o Codex não volta, a revisão do agente é de uma sessão nova do
   Claude Code**, sem a conversa de quem escreveu e, se possível, com outro
   modelo (ex.: escreveu o Opus, revê o Sonnet), publicada no pedido; os P0/P1
   tratam-se antes de juntar. **Revê-se a 29/11/2026** (as 8 semanas do
   ADR-0008).
2. **Quando a outra pessoa não pode rever**, o Diogo ou o Bruno pode autorizar,
   por escrito, que um pedido entre sem ela, com três condições: a revisão do
   agente feita e os P0/P1 tratados; **a outra pessoa revê depois**, com data
   escrita no pedido, e o que encontrar corrige-se num pedido novo; a regra do
   `main` desliga-se só para esse pedido e volta a ligar-se logo, ficando as
   duas mudanças na memória.
3. **Para o #10:** autorizado pelo Diogo; o Bruno revê depois de entrar, **até
   07/10/2026**.

## Consequências

- O `AGENTS.md` (secção Git) passa a dizer isto; o ADR-0024, ponto 5 (revisão
  automática do Codex), fica suspenso até o Codex voltar.
- Juntar o #10 não toca na VPS: os fluxos ainda não têm chaves (Fase D, que
  espera pela ordem do Diogo); a trava antes da VPS é o `--mostrar` corrido
  passo a passo com o OK dele.
- **O que pode partir:**
  - um erro no código entra no `main` sem uma pessoa o ter lido;
  - a excepção do ponto 2 usar-se por comodidade e não por necessidade — por
    isso fica escrita na memória cada vez que se usa;
  - desligar a regra do `main` abre-a para todos durante esse momento; um
    `push` de outra sessão nesse intervalo entraria sem pedido.

## O que ficou por verificar

- Se a revisão do Bruno ao #10 acontece até 07/10/2026.
- Se uma sessão do Claude Code com outro modelo apanha o que o Codex apanharia
  (não há termo de comparação).
