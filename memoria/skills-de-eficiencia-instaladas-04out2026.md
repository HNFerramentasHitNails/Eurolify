# Pacote de eficiência (6 skills) instalado (04/10/2026)

Pedidos do Diogo, 04/10/2026: dois zips «Eurolify — Skills de Eficiência,
Modelos e Memória para Claude Code» (o segundo, versão 1.2 do pacote, sha256
começa por `caa8da830a313e3e`), com a ordem de auditar `memoria/` e `docs/` só
em leitura, propor um índice por tema e uma fonte por decisão, e depois
*«instala as skills do pacote no repositório»* e *«faz tudo por mim»*.

## O que se fez

- **Auditoria só de leitura** (`main` em `d64861d`) com o `audit_memory.py`
  do pacote: 80 ficheiros `.md` em `memoria/` e `docs/`, 666 105 bytes,
  **0 ficheiros iguais**; 1 parágrafo repetido (o aviso «passou para a VPS»
  em 3 memórias da Scaleway, de propósito). A duplicação real era a mesma
  decisão no ADR, no `docs/06` e numa memória, e já tinha divergido (a T, a
  AA e a AF do `docs/06` não diziam o que os ADR diziam).
- Daí três pedidos, cada um com o seu *issue*: o índice por tema e as 3
  linhas com mais de 300 caracteres (#52, *issue* #51); o `docs/06` com uma
  linha curta por ADR (#54, #53); um bloco de estado no topo das 4 memórias
  com mais de 10 KB (#56, #55).
- **Instaladas as 6 skills** em `.agents/skills/`, com a ligação em
  `.claude/skills/` (ADR-0010) e uma linha cada na tabela do `AGENTS.md`:
  `eurolify-session-continuity`, `eurolify-manager-communication`,
  `eurolify-efficient-workflow`, `eurolify-repository-memory`,
  `eurolify-fault-first-debugging`, `eurolify-evidence-before-done`. Cada uma
  tem um `ORIGEM.md` com as alterações: a ligação ao repositório no GitHub
  saiu (nome de uma marca existente), as memórias seguem o formato do
  `AGENTS.md`, a continuidade de sessão é a descrição do pedido e o *issue*
  (ADR-0031), e duas palavras passaram a português de Portugal.
- **Política de modelos, decisão do Diogo (04/10/2026):** Sonnet para a
  execução normal, Haiku para a pesquisa mecânica, Opus 5.5 para a análise e
  a revisão de risco; **o Fable não se usa**, nem como recurso; não se troca
  o Opus 5.5 em silêncio. Está na skill `eurolify-efficient-workflow`.
- **Instalados também, a pedido do Diogo** (*«instala também os agentes e o
  estilo de gestão»*): os 3 subagentes em `.claude/agents/`
  (`eurolify-scout`, Haiku, só leitura; `eurolify-builder`, Sonnet;
  `eurolify-critical-review`, `claude-opus-5-5`, só leitura) e o estilo
  `eurolify-gestao` em `.claude/output-styles/`. Só o Claude Code os lê; o
  Codex não. Ao estilo acrescentei que as regras de «Como responder» do
  `AGENTS.md` valem acima dele; os agentes ficaram como no pacote. O
  `eurolify-critical-review` **não substitui** a revisão por sessão nova do
  ADR-0030. O estilo **está ligado por omissão para os dois**, em
  `.claude/settings.json` (`"outputStyle": "eurolify-gestao"`, do
  `templates/settings-management.json` do pacote): decisão do Diogo
  (04/10/2026), *«Ligar para mim e para o bruno!»*, que substitui a anterior
  do mesmo dia (*«cada um liga o estilo quando quiser»*). Quem não o quiser
  numa sessão muda com `/output-style`.
- **O fragmento do pacote entrou no `AGENTS.md`**, a pedido do Diogo
  (*«põe também o fragmento no AGENTS.md»*), como secção nova «Sessões e
  comunicação de gestão», antes de «Git»: arranque pela
  `eurolify-session-continuity` depois das leituras obrigatórias, comunicação
  pela `eurolify-manager-communication`, e o registo de continuidade na
  descrição do pedido e no *issue* (ADR-0031, em vez do «registo de
  continuidade» do pacote). Diz que não reduz nenhuma regra acima.
- **As revisões do #58** estão todas nos comentários do pedido, que são a
  fonte (os números mudavam a cada comentário). Em resumo, todas deram 0 P0
  e 0 P1, e cada commit foi revisto por uma sessão que não o escreveu:
  - a sessão de revisão Sonnet 5.5 reviu os commits da sessão que instalou;
    depois corrigiu ela própria os P2 dos seus dois primeiros comentários no
    `bf7f15d`, o do `.gitignore` no `94b7302` e os do 5.º comentário no
    `42c1e0c`. O P2-5 do 1.º comentário (o índice) ficou para o #52;
  - uma sessão Opus 5.5 reviu o `bf7f15d` e o `d6fe59f` e corrigiu ela
    própria os seus 5 P2 no `165ebc7`, que a sessão Sonnet reviu;
  - uma terceira sessão nova (Opus 5.5) reviu o `94b7302` e o `42c1e0c` e,
    depois, também o `165ebc7` e o merge `aa57078`, com a CI verde
    (comentário das 20:16 no #58). O `165ebc7` teve assim duas revisões.
- **O `8ed7bf8` ficou fora do `main`:** a sessão Sonnet enviou-o ao ramo
  `skills-eficiencia` às 20:20, depois de o #58 estar junto. Tratava o mesmo
  P2 que o #61 tratou por outro caminho, por isso não se juntou.
- **Quem pediu às sessões de revisão que corrigissem:** o pedido inicial
  dizia-lhes para não alterar o ramo. O que cada uma escreveu no #58:
  - a sessão Sonnet, na resposta do `bf7f15d`, «a pedido do Diogo»; no 5.º
    comentário e na resposta do `42c1e0c`, «o utilizador desta sessão», com
    a citação *«Corrige os P2 e responde no pedido»*;
  - a sessão Opus, na resposta do `165ebc7`, «a pedido do Diogo nesta
    conversa», com a citação *«corrige os 5 P2 no ramo»*.

  Essas mensagens não passaram pelo canal entre sessões: nenhuma se pôde
  verificar fora da conversa de cada sessão.
- **Os P2 que ficaram depois de juntar** (pedido do Diogo, *«trata os P2 que
  ficaram por fazer»*): o `audit_memory.py` passa a comparar **palavras
  inteiras** do nome do ficheiro, em vez de pedaços de texto. `desenhado-…` e
  `secretaria-…` voltam a contar, e `api_key`, `apikey`, `chave_privada` e
  `private_key` passam a ser saltados (com aviso). Há um teste novo, que falha
  com o script antigo. As frases desta memória sobre as revisões foram
  corrigidas: a atribuição por commit e a numeração.
- **Os 4 P2 da revisão do #61** (pedido do Diogo, *«corrige os P2 do #61
  num pedido»*, issue #64): `env` só conta como ficheiro de ambiente
  (`.env.md`, `ensaio.env.md`), já não `env-vars.md` nem `node-env.md`; as
  sequências ganham os plurais (`api-keys`, `access-tokens`,
  `chaves-privadas`…), `secret key`, `passphrase` e `passwd`; há um teste
  para os plurais, as maiúsculas e o `env`. Continua a ser uma heurística:
  `chaves-vps.md` é lido, porque «chaves» sozinho apanharia o ADR-0029, e
  `env-local.md`, `env-prod.md` e `env_vars.md` também são lidos (o `env` só
  conta com ponto, como em `.env.md`). A revisão Sonnet do #65 (P2-1 a P2-3)
  levou a acrescentar este aviso e `env.md` e `.env.local.md` ao teste. Quem
  escreveu essas correcções (`a67beab`) foi a própria sessão de revisão
  Sonnet, que tinha encontrado os P2, depois de o utilizador dela lho pedir
  na conversa (*«corrige os 3 P2 no #65»*; não se verificou quem escreveu).
  O `a67beab` foi revisto antes de juntar pela sessão Opus que escreveu o
  `623ae84` e não o `a67beab` (0 P0, 0 P1, 1 P2: esta frase).

## Números (com data e como se contaram)

| O quê | Valor | Como |
|---|---|---|
| Carregado sempre por sessão | ≈ 17,2 KB automáticos (`CLAUDE.md` + `AGENTS.md`), 9 451 caracteres de descrições das 16 skills, 57,9 KB de leitura obrigatória (`README`, `docs/00`, `docs/06`, `MEMORY.md`) | `wc -c` e Python, 04/10/2026, antes dos pedidos acima; bytes, não tokens |
| `docs/06` com o #54 | 31 416 → 23 948 bytes | `wc -c` no ramo, 04/10/2026 |
| Testes do `audit_memory.py` | 7, a passar | `python3 test_audit_memory.py`, no zip e depois de instalado |
| Testes do `audit_memory.py` depois das revisões do #58 | 10, a passar | `python3 test_audit_memory.py`, 04/10/2026 |
| Testes do `audit_memory.py` com as palavras inteiras | 11, a passar; o teste novo falha com o script do `main` em `c3c2e4c` | `python3 test_audit_memory.py`, 04/10/2026 |
| `audit_memory.py` sobre `memoria docs .agents` | 164 ficheiros, 0 avisos | 04/10/2026, depois das palavras inteiras |
| Testes do `audit_memory.py` com os P2 do #61 | 12, a passar; o teste novo falha com o script do `main` em `417e0a5` | `python3 test_audit_memory.py`, 04/10/2026 |
| `audit_memory.py` sobre `memoria docs .agents` com os P2 do #61 | 165 ficheiros, 0 avisos | 04/10/2026, `--repo . --roots memoria docs .agents` |
| `AGENTS.md` com as 6 linhas | 17 926 bytes (limite 32 KiB) | `wc -c`, 04/10/2026 |
| `AGENTS.md` com a secção «Sessões e comunicação de gestão» | 19 076 bytes (limite 32 KiB); em `wc -c`, 04/10/2026 (ramo `p2-do-61`, depois do #58), 19 781 | `wc -c`, 04/10/2026, depois de remeter o ponto 3 para «Trabalhar os dois» (P2-1 do 5.º comentário da revisão Sonnet do #58) |
| Modelo da sessão | `claude-opus-5-5` configurado e servido | `get_session`, 04/10/2026 |

## O que ficou por verificar

- **Nenhuma poupança medida.** Não se comparou a utilização nem a qualidade
  antes e depois; os números acima são bytes.
- Que o Sonnet e o Haiku respondem de facto nesta conta: aparecem como opção
  da ferramenta de agentes, não foram experimentados.
- As 6 skills apareceram na lista de skills da sessão do Claude Code logo a
  seguir a serem copiadas; **não se testou numa sessão de Codex**.
- Os subagentes e o estilo **não foram experimentados**: não se viu `/agents`
  nem `/output-style` com eles. Que o identificador `claude-opus-5-5` é aceite
  no campo `model` de um subagente não foi verificado.
- O resto do texto das skills ficou em português com o Acordo Ortográfico
  («atual», «arquitetura»); não foi reescrito.
