# VPS: utilizadores da base e ligação do migrador (#70) — 04/10/2026

## O que se fez

- **Passo 10b do `infra/vps/preparar.sh`** (tarefa #70, pedida pelo Diogo: *«pega na tarefa #70»*), aplicado pelo fluxo `aplicar-script` quando entrar no `main` (ADR-0028; a revisão do pedido é a confirmação da regra 1 de «Operar a VPS»):
  - cria o papel `eurolify_api` como a migração 0001 o criaria (`NOLOGIN`, sem palavra-passe, sem `BYPASSRLS`), porque o migrador não tem `CREATEROLE`;
  - cria o `eurolify_migrador` (`LOGIN`, sem superutilizador, `BYPASSRLS` nem `CREATEROLE`) com uma palavra-passe gerada na máquina (`openssl rand -hex 32`), dada ao PostgreSQL por stdin com o registo de erros desligado nessa sessão; escreve `/etc/eurolify/migrar.env` (`600 root`) por um ficheiro temporário e `mv`;
  - passa a base `eurolify` para o `eurolify_migrador` (o esquema `public` vai com ela);
  - avisa se algum dos dois tiver superutilizador, `BYPASSRLS` ou `CREATEROLE`.
- **Decisão de rotina tomada nesta sessão:** o `api.env` fica vazio e o `eurolify_api` sem acesso até a API usar a base (hoje só o `migrar.js` lê uma ligação: `grep process.env apps/api/src`). Fechado por omissão.
- **As tabelas só aparecem na publicação seguinte:** o fluxo `publicar` corre quando muda algo em `apps/**` (não tem arranque manual).

## Números (com data e como se contaram)

Ensaio local a 04/10/2026, PostgreSQL 18.6 em Docker com o nome `eurolify-postgres` e a base `eurolify`, o passo 10b extraído para um script à parte:

| O quê | Resultado |
|---|---|
| `--mostrar` | 3 alterações por fazer, nada mudado |
| Primeira corrida | 3 alterações feitas; `migrar.env` `600 root`, com a ligação |
| Segunda corrida | 0 alterações («já está» nas três) |
| `node dist/migrar.js` com a ligação gerada | «aplicadas 0001_comerciante», depois «nada em falta»; 8 tabelas, todas do `eurolify_migrador`; `has_database_privilege('eurolify_api', 'eurolify', 'TEMP') = f` |
| Papéis | `eurolify_api` sem LOGIN nem palavra-passe; `eurolify_migrador` com LOGIN; nenhum com superutilizador, `BYPASSRLS` ou `CREATEROLE` |
| Rasto com o dono não superutilizador (RLS forçado aplica-se) | `SET ROLE eurolify_api`, criar e mudar de estado: uma linha `rascunho→em_revisao` |
| Cópia e reposição como os scripts (`pg_dump -U postgres -Fc`, `pg_restore --no-owner`) | 8 tabelas repostas, 8 na base viva |
| Palavra-passe no registo do PostgreSQL | 0 ocorrências de 64 hexadecimais (`docker logs`) |
| `preparar.sh --mostrar` num Ubuntu 26.04 vazio, como o CI | passa; o 10b diz o que faria |

## O que ficou por verificar

- A corrida na VPS a sério (depois de juntar, no registo do `aplicar-script`) e a primeira migração lá (na publicação seguinte).
- Uma base `eurolify` que já tivesse tabelas do `postgres` antes de mudar de dono (na VPS está vazia: a publicação de 04/10/2026 disse «nenhuma migração aplicada»).
- A memória da VPS (`vps-operada-por-nos-03out2026.md`) ganha uma linha quando o passo correr lá.

## Os 4 P2 da revisão do `63cadd6` (#71), a pedido do Diogo (*«sim, corrige os 4 P2 e manda rever»*)

- **P2-1:** o stderr do psql (que vai para o registo do fluxo no GitHub) passa por um `sed` que mascara `PASSWORD '…'`. Medido: um erro com posição mostra `PASSWORD '***'`; com as duas linhas `SET` do script, 0 ocorrências no registo da base.
- **P2-2:** «já está» só se a ligação do `migrar.env` **entra** de facto: um contentor na rede `eurolify` liga-se como o migrador, com a palavra-passe pelo ambiente do cliente docker (dentro do contentor da base, `127.0.0.1` entra sem palavra-passe — `pg_hba` da imagem). Medido: palavra-passe mudada à mão → o passo renova-a (1 alteração), depois 0.
- **P2-3:** aviso se o `eurolify_api` tiver `LOGIN`. Medido: 1 aviso.
- **P2-4:** o ficheiro temporário com a palavra-passe apaga-se se o script morrer a meio (trap de saída com uma variável global: com uma local, o `set -u` parava o trap e o ficheiro ficava — medido antes de corrigir). Medido com o `mv` a falhar: 0 temporários; a corrida seguinte repara.
- O `eurolify-publicar` diz «passos 10 e 10b» quando falta o `migrar.env`.

## O P1 e os 2 P2 da revisão do `f1ede40` (#71), a pedido do Diogo (*«sim, corrige o P1 e os 2 P2 e manda rever»*)

- **P1-1:** a máscara com `sed` não chegava: o psql corta o pedaço da instrução que repete, e o corte deixava 14 ou 52 dos 64 caracteres à vista (medido pelo revisor). Passou a `-v VERBOSITY=terse`: o erro sai sem a instrução. Medido: os dois casos (erro antes e depois da palavra-passe) dão só `ERROR: … at character N`, `rc=3`, 0 pedaços da palavra-passe.
- **P2-1:** a verificação da ligação distingue «recusada» (sem ligação no ficheiro, ou `password authentication failed`: renova) de «erro» do docker ou da rede (avisa e **não** renova), e não descarrega imagens (`--pull never`). Medido: imagem em falta e rede em falta dão 1 aviso e 0 alterações.
- **P2-2:** em `--mostrar` só se lê o ficheiro; não arranca contentores. Medido com `docker events`: 0 contentores criados.
- De novo: 1.ª corrida 3 alterações, 2.ª 0; palavra-passe mudada à mão → renovada, depois 0; trap: 0 temporários; `shellcheck` e `--mostrar` como o CI passam.
