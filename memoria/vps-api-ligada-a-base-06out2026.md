# VPS: a API ligada à base com o eurolify_api (#107) — 06/10/2026

## O que se fez

Pedido do Diogo, 06/10/2026: *«avança com ligar a API à base na VPS»* (por
fazer no #107, depois da parte A da identidade, #110).

- **Passo 10b do `infra/vps/preparar.sh`:** as funções do migrador passam a
  receber «ficheiro variável papel» e servem os dois. O `eurolify_api` ganha
  `LOGIN` com uma palavra-passe gerada na máquina (`openssl rand -hex 32`, ao
  PostgreSQL por stdin, com o registo da base calado), e o `/etc/eurolify/api.env`
  (`600 root`) fica só com
  `BASE_DADOS_URL=postgres://eurolify_api:…@eurolify-postgres:5432/eurolify`.
  Renova-se como a do migrador: se a ligação do ficheiro deixar de entrar.
  Saiu o aviso «o eurolify_api pode entrar (LOGIN)».
- **Passo 10c, novo:** o docker só lê o `--env-file` ao criar o contentor; se o
  `api.env` mudou depois de o `eurolify-api` ser criado, o script chama o
  `eurolify-publicar` com o resumo da imagem que já está no ar. Uma falha
  avisa e não pára o resto do script.
- **`eurolify-publicar`:** com a mesma imagem e o `api.env` mais recente que o
  contentor, recria a API. Em qualquer publicação, se o `api.env` tem a
  ligação, prova que a API chega à base: `GET /me` com uma chave inventada da
  forma certa tem de dar 401 (passa pelo `chave_resolver`); 500 é falha. Não
  volta à imagem anterior nesse caso (usaria o mesmo `api.env`): avisa,
  regista e sai com erro. O MCP é tratado antes desta prova.
- **Documentos:** `infra/vps/LEIA-ME.md` (10b, 10c), `docs/15` §5 (linha VPS),
  `docs/19` §6.

## Números (com data e como se contaram)

Ensaio local a 06/10/2026, numa máquina de desenvolvimento: PostgreSQL 18.6
com o resumo do `ensaio.conf`, rede `eurolify`, a imagem da API compilada a
partir do `main` `fbed701` e servida por um registo local, os passos 10b e 10c
extraídos do script, e o `docker login/logout` substituído por um que não faz
nada (o resto do docker é o verdadeiro).

| O quê | Resultado |
|---|---|
| Estado inicial como a VPS hoje (10b antigo + `eurolify-publicar` antigo) | 0001–0010 aplicadas; `eurolify_api` sem LOGIN; `api.env` vazio |
| Novo 10b/10c em `--mostrar` | 2 alterações por fazer (LOGIN e `api.env`; recriar a API), nada mudado |
| Corrida | 2 alterações; «Recriada… O /health da API responde.» e «A API chega à base (eurolify_api).»; `api.env` `600 root`, 1 linha |
| Segunda corrida e `--mostrar` | 0 alterações, 0 avisos; «eurolify_api e a ligação dele em /etc/eurolify/api.env (entra)» |
| `GET /me` com chave inventada | 401; `pg_stat_activity`: 1 ligação do `eurolify_api` |
| Papéis | os dois com LOGIN; nenhum superutilizador, BYPASSRLS nem CREATEROLE |
| Palavra-passe mudada à mão na base, depois publicar | 500 a uma chave inventada → «ATENÇÃO: a API não chega à base», saída 1 |
| E o 10b a seguir | renova (1) e recria (1); «A API chega à base» |
| Imagem nova publicada | «migrar: nada em falta», /health, «A API chega à base», saída 0 |
| A palavra-passe nos registos | 0 no do PostgreSQL, 0 no da API, 0 no `acoes.log`, 0 no journal |
| CI local: `shellcheck -x`, `preparar.sh --mostrar` e os 3 testes num Ubuntu 26.04 vazio | passam |

## O que ficou por verificar

- A corrida na VPS a sério (no registo do `aplicar-script` depois de juntar):
  deve dizer 2 alterações no 10b/10c e «A API chega à base».
- A leitura pelo MCP da VPS (o conector não carregou na sessão de 06/10/2026).
- O comando do operador e o `GET /me` com uma chave verdadeira na VPS (falta a
  chave SSH do fluxo `operar`).
- Não há tranca entre fluxos: uma publicação e um `aplicar-script` ao mesmo
  tempo podem recriar a API os dois (já era assim; não medido).
- A imagem local não foi a do `Dockerfile` (a construção dentro do docker não
  passa pelo proxy desta máquina): foi a mesma compilação, posta numa imagem
  com o mesmo node fixado.
