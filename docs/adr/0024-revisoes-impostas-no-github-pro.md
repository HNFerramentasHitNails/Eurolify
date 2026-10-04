# ADR-0024 · O código vive neste repositório, e as duas revisões impõem-se com o GitHub Pro

- **Estado:** aceite · ponto 3 (revisão obrigatória dos donos) substituído pelo [ADR-0031](0031-cada-um-aprova-o-que-fez.md) · ponto 5 (revisão automática do Codex) suspenso enquanto o Codex não volta: [ADR-0030](0030-revisao-sem-codex-e-sem-a-outra-pessoa.md) · completa o [ADR-0013](0013-revisao-do-codigo.md)
  (como se impõem as duas revisões) e o [ADR-0023](0023-ok-para-codigo.md)
- **Data:** 04/10/2026
- **Quem decidiu:** Diogo
- **Decisão em aberto de origem:** A2 do pedido de 04/10/2026 (onde vive o
  código e como se impõem as duas revisões); ADR-0013, «Como se impõe»

## Contexto

Lido a 04/10/2026 com o `gh` (conta `HNFerramentasHitNails`):

- O repositório `HNFerramentasHitNails/Eurolify` é **privado** e pertence a
  uma **conta pessoal** (`owner.type = User`). Tem **um colaborador**: a
  própria conta, `admin`. As Actions estão ligadas e não há nenhum fluxo.
- A protecção do `main` e as regras (*rulesets*) respondem **403**: *«Upgrade
  to GitHub Pro or make this repository public to enable this feature»*.

Páginas oficiais, lidas a 04/10/2026:

- `github.com/pricing`: Free 0 $, Team 4 $ por utilizador e mês, Enterprise
  21 $; ramos protegidos, revisores obrigatórios e donos do código em
  repositórios privados só no Team ou acima (para organizações).
- `docs.github.com` (*GitHub's plans*): o **GitHub Pro** (contas pessoais) tem,
  nos repositórios privados, *«Required pull request reviewers»*, *«Protected
  branches»* e *«Code owners»*. Preço: **4 $ por mês**, segundo a FAQ das
  mudanças aos planos (texto antigo; a página de preços de hoje não mostra o
  Pro) — a confirmar na compra.
- Codex (documentação da OpenAI, `learn.chatgpt.com/docs/third-party/github`,
  sem data na página): revê com `@codex review` ou em modo automático, publica
  como `chatgpt-codex-connector`, **não aprova nem pede alterações** (só aponta
  problemas P0 e P1) e segue a secção `## Code Review Rules` do `AGENTS.md`.

Pergunta feita ao Diogo, com três opções: a) organização nova `eurolify` no
GitHub Team (recomendada), b) ficar na conta pessoal com o GitHub Pro, c) ficar
como está, sem protecção. Resposta, a 04/10/2026: *«b»*.

## Opções consideradas

| Opção | A favor | Contra |
|---|---|---|
| a) Organização `eurolify` no GitHub Team, repositório transferido | Protecção e donos do código; cada um com a sua conta; tira do endereço o nome da marca existente | 8 $/mês; muda o endereço do clone |
| **b) Conta pessoal, com o GitHub Pro** | Sem transferência; ≈ 4 $/mês | O Bruno entra como colaborador com conta própria; o nome da marca existente continua no endereço |
| c) Como está (Free) | 0 € | Nada impõe as revisões |

## Decisão

1. **O código vive neste repositório**, com os documentos, as regras e as
   skills (ADR-0010), na conta pessoal `HNFerramentasHitNails`, que passa ao
   **GitHub Pro**.
2. **Regra no `main`**, quando o Pro estiver activo: só entra por pedido de
   alteração; os testes, o lint e os tipos têm de passar; proibido empurrar à
   força e apagar o ramo.
3. **Código:** o ficheiro `CODEOWNERS` dá o código (`apps/`, `packages/`,
   `infra/`, `.github/`, e o que se acrescentar) ao Diogo e ao Bruno, com
   revisão dos donos obrigatória. Como o autor não se aprova a si próprio, o
   pedido de um só entra com a aprovação do outro (ADR-0013, ponto 1).
4. **Documentos:** 0 aprovações obrigatórias — um pedido só com documentos
   junta-o o próprio autor. A via de hoje (`cherry-pick` e `push` directo ao
   `main`) acaba quando a regra se ligar, para todos; o `AGENTS.md` muda nessa
   altura.
5. **Codex:** revisão automática ligada neste repositório. Quem aprova só o
   faz depois de existir a revisão do Codex e de os P0/P1 estarem tratados
   (ADR-0013, ponto 2). Quando o código é do Codex, o Claude Code revê o diff e
   comenta no pedido. As regras de revisão escrevem-se em `## Code Review
   Rules` no `AGENTS.md`.

## Consequências

- **O Bruno precisa de conta própria no GitHub**, colaborador do repositório.
  Sem ela, nenhum código entra (ninguém aprova o seu próprio pedido — é de
  propósito). Se os dois usam hoje a mesma conta, a regra não se cumpre.
- Quem compra o Pro e liga a regra: o Diogo, dono da conta. Ligar a regra é
  uma mudança nas definições do GitHub: mostra-se e espera pelo OK do Diogo.
- **O nome da marca existente continua no endereço do repositório**
  (`HNFerramentasHitNails`). O `AGENTS.md` proíbe a marca no Eurolify; o Diogo
  escolheu esta opção sabendo-o (estava na coluna «contra» da pergunta).
  Ficam de fora dela os documentos, os ecrãs, os exemplos e os nomes de
  ficheiros, como manda a regra.
- **O que pode partir:**
  - sessões que escrevem directo no `main` (havia várias em paralelo a
    04/10/2026) falham no `push` depois de a regra se ligar, até lerem o
    `AGENTS.md` novo;
  - não está decidido o que acontece quando o outro não pode rever
    (ADR-0013);
  - a revisão do Codex não é imposta pelo GitHub: depende de quem aprova
    olhar para ela.

## O que ficou por verificar

- Se o Bruno tem conta própria no GitHub (perguntado ao Diogo, sem resposta).
- O preço actual do GitHub Pro.
- Se o GitHub aceita «0 aprovações + revisão dos donos obrigatória» numa conta
  Pro (testa-se depois de ligar a regra, com um pedido de teste).
- Se o Codex se liga a um repositório de uma conta pessoal com o mesmo
  procedimento.
