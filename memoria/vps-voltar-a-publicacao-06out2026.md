# VPS: voltar a uma publicação pelo MCP — 06/10/2026

## O que se fez

- **Problema** (tarefa #113, achado na revisão do #112): a acção `voltar_a_publicacao` do MCP da VPS corria o migrador da imagem antiga. O Kysely 0.29.6 recusa uma base com migrações que não conhece («corrupted migrations … is missing», `migrator.js:496-502`, confirmado pela revisão do #115), por isso a volta falhava sempre que houvesse uma migração mais recente.
- **#115** (juntado como d7ba6d8, seis revisões do agente: cinco com o Opus 5.5 e a 6.ª com o Sonnet 5.5):
  - o `eurolify-publicar` compara as migrações da imagem (`/app/apps/api/migracoes`) com as da base (`kysely_migration`):
    - base com migrações a mais e também com falta → recusa;
    - base com migrações a mais → só segue se for a publicação imediatamente anterior à que está no ar (opção A, decisão do Diogo) e se essas migrações forem todas das que a publicação no ar aplicou. Nesse caso não corre o migrador;
    - nos outros casos migra como sempre;
  - o `publicacoes.log` ganha o campo `migrou:` em cada linha;
  - o MCP só aceita a anterior da que está no ar;
  - o `--emergencia` serve para voltar mais atrás por SSH;
  - qualquer saída com erro fica registada no `acoes.log`;
  - o `estado_do_ensaio` passa a ter a secção «migrações».
- **#122** (juntado como 7717190, três revisões com o Sonnet 5.5): uma tentativa que falha deixa uma linha «falhou» com o que ficou na base. Vale para a migração a meio, para a imagem que nem arranca e para o /health. Ao repetir a mesma imagem, ela herda essas migrações. A linha «falhou» é escrita antes de voltar à anterior, e uma falha a escrever no registo não impede a reposição.
- **Também no #115**: o cadeado do #116 já punha as publicações em série. Ficou corrigido um defeito do teste do MCP (`pedidos.test.ts`): a máquina a fingir lia o mesmo pedido duas vezes num executor lento.
- **Regras e documentos**: `infra/vps/LEIA-ME.md` («Regras para quem mexer») e o ADR-0033, ponto 5.

## Números (com data e como se contaram)

- 06/10/2026, `infra/vps/testes/publicar.sh` num Ubuntu 26.04 descartável, com `docker`, `curl`, `sleep` e `systemd-run` a fingir: 134 verificações a passar no eb233a6.
- Cada protecção, tirada, faz falhar pelo menos uma verificação. As mutações correram-se uma de cada vez, com a saída contada por `grep -c FALHOU`.
- Publicações na VPS, segundo o registo do fluxo `publicar`:
  - d7ba6d8: corrida 37449978449, 10:30 UTC, com «migrar: nada em falta», o /health e o MCP a responder, e «A API chega à base»;
  - 7717190: corrida 37454333971, com conclusão «success» às 11:11 UTC. Não li o registo dessa corrida.

## O que ficou por verificar

- A primeira linha do `publicacoes.log` da VPS no formato novo (`| migrou:`): não a li. O MCP da VPS pediu outra vez a ligação depois da publicação e não estava ligado nesta sessão.
- **Na VPS real**, não verifiquei:
  - que o `docker inspect` devolve `Config.Image` como `repo@sha256:…`;
  - o `psql -U postgres` por `docker exec`;
  - o `sudo` com `EUROLIFY_ORIGEM` para o `--emergencia`.
- O comportamento do Kysely quando uma migração falha a meio (se as anteriores do lote ficam na base). O código assume que sim e regista o que encontra.
- A acção `voltar_a_publicacao` nunca foi usada a sério depois destas alterações. É uma acção com confirmação.
- Uma morte do processo entre arrancar a imagem nova e repor a anterior. Já existia antes, sem tratamento.
