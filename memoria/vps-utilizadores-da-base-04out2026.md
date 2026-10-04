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

## Aplicado na VPS (04/10/2026, 22:47 UTC)

Fluxo `aplicar-script`, corrida 37241277662, no `main` `e14ff84` (junção do #71, pedida pelo Diogo: *«sim, junta o #71»*):

- `--mostrar` primeiro: 4 alterações por fazer, 0 avisos; depois a corrida: **4 alterações feitas, 0 avisos** — instalar o novo `/usr/local/sbin/eurolify-publicar`, criar o `eurolify_api`, criar o `eurolify_migrador` e escrever o `migrar.env`, passar a base `eurolify` para o `eurolify_migrador`.
- Antes: passo 10 com «já está» no `postgres.env`, `api.env`, `migrar.env` e no contentor `eurolify-postgres` com a imagem certa.
- Registo do fluxo no GitHub: 0 sequências de 64 hexadecimais (procurado com `grep -cE '[0-9a-f]{64}'`).
- **Ainda por ver:** a migração 0001 na VPS, que só corre na publicação seguinte (o `publicar` corre com mudanças em `apps/**`); a #70 fecha quando essa publicação disser «aplicadas 0001_comerciante».

## A migração 0001 aplicada na VPS (04/10/2026, ~23:00 UTC)

Fluxo `publicar`, corrida 37242060285, no `main` `53e209d` (junção do #73): «migrar: aplicadas 0001_comerciante.» e «O /health da API responde.» As tabelas do Comerciante existem agora na base `eurolify` da VPS, do `eurolify_migrador`.

- **O `eurolify_api` sem `TEMPORARY`:** provado pela própria migração, que pára se o `eurolify_api` ainda o tiver (e não parou).
- **Sem `BYPASSRLS`, superutilizador ou `LOGIN`:** o passo 10b verifica e avisa; a corrida de 22:47 UTC deu 0 avisos.
- **Não medido directamente na VPS:** as consultas a `pg_roles` e `pg_tables` (não há MCP da VPS autorizado nesta sessão; o fluxo `medir` não lista papéis).
- A tarefa #70 fecha-se com isto.

## Os 3 P2 da revisão do `09882b4` (#71), a pedido do Diogo (*«trata os 3 P2 do #71»*)

- **P2-A:** o stderr do psql só sai no fim, com sequências de 16 ou mais hexadecimais tapadas, e a sessão dá `SET log_min_messages = 'panic'`. Medido: um erro de sintaxe com a palavra-passe como token dá `at or near "'***'"`; 0 pedaços no stderr e 0 no registo da base.
- **P2-B:** a renovação repõe `LOGIN`, `CONNECTION LIMIT -1` e `VALID UNTIL 'infinity'`, e «não pode entrar» ou «demasiadas ligações» contam como recusada. Medido: `NOLOGIN`, `CONNECTION LIMIT 0` e `VALID UNTIL` no passado são reparados (1 alteração, depois 0). Um `REVOKE CONNECT … FROM PUBLIC` não impede o migrador, que é dono da base (0 alterações, 0 avisos).
- **P2-C:** a linha do `migrar.env` tem de ser exactamente a que o script escreve (anfitrião, porta, base). Medido: base ou anfitrião trocados à mão → reescrita (1 alteração, depois 0); em `--mostrar`, «FARIA».
- De novo: 3 alterações e depois 0; a migração 0001 corre como o migrador; trap sem temporários; `shellcheck` sem achados.
