# Limpeza diária da idempotência (#107) — 06/10/2026

## O que se fez

Pedido do Diogo, 06/10/2026: *«avança com a tarefa diária da idempotência»*.
O `docs/18` §4 e o `docs/17` §3 pediam-na antes de uma rota com dados pessoais
usar a idempotência.

- **Migração 0013:** a função `idempotencia_apagar_expiradas()`.
  - Apaga as linhas com `expira_em <= now()` e devolve quantas.
  - Não é SECURITY DEFINER: o RLS forçado aplica-se também ao dono quando ele
    não é superutilizador (revisão do #118, P3-9).
  - A API não a pode chamar.
- **VPS:** o programa `eurolify-limpeza` e o temporizador
  `eurolify-limpeza.timer`, às 05:00 UTC, depois da cópia das 03:00.
  - Entra na base com o papel `eurolify_limpeza`, não com o superutilizador
    (revisão do #119, P2-2). Na primeira versão entrava como superutilizador,
    e o dono das tabelas podia pôr código na função ou num gatilho que corria
    todos os dias como superutilizador. Um `SET ROLE` não chegava: o código
    chamado pode fazer `RESET ROLE`.
  - O papel é `LOGIN` sem palavra-passe (só pelo socket do contentor),
    `BYPASSRLS`, sem superutilizador, e só tem a `idempotencia`. Cria-o o
    `preparar.sh` no passo 10b; a 0013 dá-lhe os privilégios, ou o passo 10b
    dá-os se a migração correu antes dele.
  - Regista quantas apagou no `acoes.log`, e também uma falha.
  - Tem limite de 5 min por consulta e `After=docker.service`.
- **Verificação diária (07:00):** avisa o Healthchecks se a última corrida
  falhou (`systemctl is-failed`), se houver linhas expiradas há mais de um dia,
  ou se não conseguir entrar como `eurolify_limpeza`. Sem a tabela (antes da
  0012), não avisa.
- **A medição (`eurolify-medir`)** mostra o temporizador e a última corrida.
- **Documentos:** `docs/18` §4, `docs/17` §3 e `infra/vps/LEIA-ME.md` (passo 12).

## Números (com data e como se contaram)

Ensaio local a 06/10/2026: PostgreSQL 18.6 com o resumo do `ensaio.conf`, as
13 migrações aplicadas pelo `dist/migrar.js`, 3 linhas (2 expiradas há 2 dias).

| O quê | Resultado |
|---|---|
| Verificação antes | «2 linha(s) da idempotência expiradas há mais de um dia…» |
| `eurolify-limpeza` | «Limpeza: 2 linha(s)…», saída 0, uma linha no `acoes.log` |
| Verificação depois | sem problemas; fica a linha válida |
| Com a base parada | «ERRO: a limpeza da idempotência falhou», saída 1 |
| Testes da função (`idempotencia-limpeza.test.ts`) | 2 passam. Falha 1 sem o filtro, e falha também com uma folga de 2 minutos |
| CI local: `shellcheck`, `preparar.sh --mostrar` e os 3 testes da VPS num Ubuntu 26.04 vazio | passam; o `--mostrar` diz que instalaria o programa e as duas unidades e ligaria o temporizador |

## Revisão do agente (Claude Opus 5.5, ADR-0035), publicada no #119

Encontrou 0 P0, 0 P1, 3 P2 e 9 P3, tratados na mesma sessão:
- **P2-1:** a unidade falhada avisa.
- **P2-2:** o papel próprio, ligado com a sua sessão.
- **P2-3:** a medição.
- **P3:** a retenção no `docs/17`, o `After=docker.service` e o limite de
  tempo, a falha no registo, o teste da ACL, o comentário «num só sítio», a
  mensagem da verificação, e as linhas antigas do `docs/18`.
- **P3-7 e P3-8:** ficam escritos no `docs/18` §4, para decisão e para
  produção.

Ensaio local depois da revisão, como na VPS (o `preparar.sh` cria os papéis e
o migrador, sem ser superutilizador, corre as migrações):

| O quê | Resultado |
|---|---|
| 10b, 1.ª corrida | 5 alterações (os três papéis, as duas ligações) |
| Migrações como migrador | 0001–0013; os privilégios do `eurolify_limpeza` dados pela 0013 |
| 10b, 2.ª corrida | 0 alterações |
| Privilégios tirados à mão, 10b de novo | 2 alterações (os dois GRANT), como se a migração tivesse corrido antes |
| Limpeza com 2 expiradas | 2 apagadas; registo; a verificação deixa de avisar |
| Sem a função | saída 1, «limpeza da idempotência falhou (código 1)» no `acoes.log` |
| Sem a tabela / papel sem LOGIN | sem aviso / «não consegui entrar na base como eurolify_limpeza…» |
| `eurolify_limpeza` de fora do contentor | recusado (`no password supplied`) |
| Teste com a função trocada pelo dono por `RESET ROLE` + `ALTER ROLE … SUPERUSER`, numa sessão do `eurolify_limpeza` | recusado; o `eurolify_api` continua sem superutilizador |

## O que ficou por verificar

- A primeira corrida na VPS a sério. O `aplicar-script` instala e liga o
  temporizador, e a 0013 entra pela publicação, também quando se juntar.
- O aviso de uma unidade falhada (`systemctl is-failed`) não se mediu: não
  há systemd na máquina do ensaio local.
- Cada linha entra em pelo menos uma cópia das 03:00 e fica lá 14 dias; na
  base fica até ~48 h. Hoje estas linhas não têm dados pessoais (`docs/17` §3).
