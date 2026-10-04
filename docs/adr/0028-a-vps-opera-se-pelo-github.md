# ADR-0028 · A VPS opera-se pelo GitHub; as chaves pessoais ficam para emergência

- **Estado:** aceite · completa o [ADR-0016](0016-o-claude-opera-a-vps.md)
  (o Claude opera a VPS) e o [ADR-0020](0020-acesso-pelo-computador-do-diogo.md)
  (acesso pelo computador do Diogo, que passa a ser a via de emergência) ·
  acrescenta à [ADR-0026](0026-publicacao-pelo-github-por-ssh.md) os fluxos do
  script e da medição
- **Data:** 04/10/2026
- **Quem decidiu:** Diogo
- **Decisão em aberto de origem:** A4 do pedido de 04/10/2026, acrescentada
  pelo Diogo

## Contexto

O ADR-0020 pôs o Claude a operar a VPS pelo Claude Code no computador do
Diogo, por SSH, com a chave dele, e cada comando aprovado no ecrã. O Diogo,
a 04/10/2026: *«quero trabalhar sem depender deste computador (tenho outro no
trabalho; o Bruno usa um Mac)»*.

Lido a 04/10/2026 em `docs.github.com`:

- *Deployments and environments*: *«If you are on a GitHub Free, GitHub Pro,
  or GitHub Team plan, required reviewers are only available for public
  repositories»* (o mesmo para o tempo de espera); no Pro e no Team há, em
  repositórios privados, segredos de ambiente, variáveis de ambiente e
  *«deployment branches and tags»*; até seis revisores, e a opção de impedir
  que quem lançou aprove.
- *Using secrets*: *«To create secrets or variables for an environment in a
  personal account repository, you must be the repository owner»*; para os
  segredos do repositório basta ser colaborador.
- *About mandatory two-factor authentication*: o GitHub obriga certas contas
  (por exemplo, quem administra ou contribui para repositórios que publicam
  pacotes); exigir 2FA aos membros é coisa de organizações — a página não diz
  que o dono de um repositório pessoal o possa exigir aos colaboradores.

O repositório é de uma conta pessoal, `HNFerramentasHitNails`, no GitHub Pro
(ADR-0024).

Resposta do Diogo, a 04/10/2026, depois de ver estes três factos: *«b),
operar pelo GitHub»* e, à pergunta *«gravo assim, com a aprovação feita pela
revisão do pedido e as chaves presas ao `main`?»*: *«sim»*.

## Opções consideradas

| Opção | A favor | Contra |
|---|---|---|
| a) Manter o ADR-0020: o Claude opera pelo computador do Diogo | Cada comando aprovado no ecrã | Só com aquele computador ligado; o Bruno e o outro computador do Diogo ficam de fora |
| **b) Operar pelo GitHub** | Qualquer computador ou sessão na cloud; o que muda a máquina é revisto como código | Sem aprovação antes de correr no Pro: a trava é a revisão do pedido e o `main` protegido |
| c) b) com aprovação antes de cada execução (ambiente com revisores) | Um «sim» por execução | Só no GitHub Enterprise (21 $/utilizador/mês) para repositórios privados |

## Decisão

1. **Tudo o que muda a VPS entra por pedido de alteração revisto** (o outro e
   o agente que não escreveu, ADR-0013) e **é o GitHub que o aplica**: a
   publicação (ADR-0026), o script de preparação e as suas alterações. **Essa
   revisão é a confirmação antes de mexer na máquina** (`AGENTS.md`, «Operar a
   VPS», regra 1).
2. **Três fluxos** no GitHub Actions:
   - **publicar** — no `push` ao `main` com código (ADR-0026);
   - **aplicar o script** — no `push` ao `main` que muda o script de preparação;
     corre primeiro no modo que só mostra e depois a sério;
   - **medir** — lançado à mão (`workflow_dispatch`), de qualquer computador ou
     sessão na cloud; **só leitura**, com uma lista fixa de medições e **sem
     comandos livres** nem argumentos de quem o lança.
3. **As chaves da VPS são segredos do ambiente `ensaio`**, que só aceita o
   ramo `main` (*deployment branches*); **nunca segredos do repositório**. Cada
   fluxo tem a sua chave, limitada na VPS a um comando fixo
   (`restrict,command=…`): a de publicar só pede uma publicação; a de aplicar
   só corre o script que está no `main`; a de medir só corre as medições.
4. **As chaves pessoais por SSH ficam só para emergência** (o GitHub ou os
   fluxos em baixo, ou um incidente): a do Diogo (`eurolify_vps`, no computador
   dele) e uma do Bruno, no Mac dele. Cada uso fica registado numa memória.
5. **A chave de emergência do Bruno acrescenta-se assim:**
   1. no Mac, com frase-passe e guardada no porta-chaves:
      `ssh-keygen -t ed25519 -f ~/.ssh/eurolify_vps -C "bruno-eurolify-vps"` e
      `ssh-add --apple-use-keychain ~/.ssh/eurolify_vps`;
   2. a parte pública entra num pedido de alteração, em
      `infra/vps/chaves/bruno.pub`; o script instala as chaves pessoais a
      partir dessa pasta;
   3. o Diogo e o Codex revêem; **a impressão digital confirma-se por telefone
      ou em pessoa**, não pelo pedido;
   4. troca a 31/03/2027, como a do Diogo (decisão AB).
6. **O Bruno precisa de conta própria no GitHub, com verificação em dois
   passos** ligada — regra escrita, confirmada nas definições da conta dele
   antes do convite (a conta pessoal não a consegue impor).

## Consequências

- **Não há aprovação antes de cada execução** (seria o Enterprise). A trava é:
  `main` protegido com aprovação do outro (ADR-0024) + chaves presas ao
  ambiente do `main` + comandos fixos na VPS. **Por verificar no C2:** que um
  fluxo alterado noutro ramo não recebe os segredos do ambiente `ensaio` (teste
  com um ramo de ensaio).
- **Só a conta `HNFerramentasHitNails` cria e muda os segredos do ambiente**
  (é a dona do repositório) — a conta com o nome da marca que o `AGENTS.md` não
  deixa usar no Eurolify. O Bruno não os pode mudar. A organização da A2,
  opção a), resolvia as duas coisas; a A2 ficou na b) (ADR-0024).
- O ADR-0020 deixa de ser a via normal: passa a emergência. O `AGENTS.md`
  («Operar a VPS») e o `docs/11` §5 mudam em conformidade.
- **O que pode partir:**
  - um pedido aprovado sem ser lido com cuidado chega à máquina sem mais
    nenhuma pergunta;
  - quem tem escrita no repositório lança a medição: é só leitura, mas o que
    ela mostra fica nos registos do GitHub — **sem dados pessoais nem
    endereços IP** na saída (filtrados no script de medição);
  - se a restrição do ambiente ao `main` não funcionar como se espera, um
    fluxo num ramo recebe as chaves — o teste do C2 é a trava;
  - se o GitHub estiver em baixo, só as chaves de emergência chegam à máquina.

## O que ficou por verificar

- O teste do ramo (acima).
- Se o Bruno tem conta no GitHub e a 2FA ligada.
- Se a chave de emergência do Diogo continua a ser precisa no computador do
  trabalho dele (hoje está só neste).
