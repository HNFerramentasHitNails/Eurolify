# Scaleway por MCP: dá para ligar, e como se publica (03/10/2026)

> ⚠️ **03/10/2026, mais tarde:** o alojamento passou para uma VPS operada pelo
> Diogo e pelo Bruno, com o Claude a operá-la (ADR-0015, ADR-0016;
> `vps-operada-por-nos-03out2026.md`). Isto fica como registo.

**Pergunta do Diogo (03/10/2026):** *«scaleway conseguimos ligar por mcp para
que possas fazer deploy como no vercel+supabase??»* — logo depois de decidir o
alojamento europeu gerido (ADR-0003).

## O que se fez (só leitura e medição; nada instalado, nada criado)

- ✅ **A Scaleway ficou escolhida** pelo Diogo a 03/10/2026 (*«fica a
  scaleway»*, ADR-0004).
- ✅ **A proposta de publicação ficou decidida** pelo Diogo a 03/10/2026
  (*«sim, fica assim»*, ADR-0005, decisão I).

- **Existe MCP oficial**: vem dentro do programa de linha de comandos da
  Scaleway — `scw mcp server serve`. Expõe todos os comandos como ferramentas;
  pode ficar **só de leitura** (`read-only`) e limitado a serviços, recursos e
  verbos (`namespaces`, `resources`, `verbs`); fala por stdio ou por HTTP.
  Fonte: scaleway.com/en/developers/cli/mcp, lida a 03/10/2026.
  ⚠️ **Corrigido mais tarde a 03/10/2026:** a forma `--read-only` do exemplo
  da página dá `Unknown flag: --read-only` (v2.63.0); a que funciona é
  `read-only=true`. E o modo só de leitura **não esconde segredos** — ver
  «Preparação da conta» abaixo.
- **Não é um conector de um clique** como o Vercel e o Supabase: procurei no
  catálogo de conectores do claude.ai com «scaleway», «cloud», «deploy» e só
  vieram Vercel, Lovable, Supabase e Expo (todos já ligados).
- Há servidores de terceiros (ex.: feedback-loop-ai/mcp-scaleway, MIT, com
  modo só de leitura). Não usar: o oficial chega.

## Números (medidos nesta sessão, 03/10/2026)

| Teste | Resultado | Leitura |
|---|---|---|
| `GET api.scaleway.com/instance/v1/zones/fr-par-1/servers` sem chave | 401 | a API chega daqui; falta a chave |
| Página `github.com/scaleway/scaleway-cli/releases/latest` | 403 do proxy | ~~bloqueado~~ ⚠️ **leitura errada, corrigida mais tarde a 03/10/2026:** o 403 é só desta página; o ficheiro da release descarrega (ver abaixo) |
| `proxy.golang.org/…/scaleway-cli/v2/@latest` | 200; Go 1.24.7 instalado | dá para instalar com `go install`, mas o `go install` desceu mais de 1,8 GB de módulos e foi interrompido; a via certa é o binário |

## Proposta (decidida a 03/10/2026, ADR-0005)

- **Quem publica é o caminho no GitHub, não eu à mão**: cada alteração entra
  no `main`, os testes correm e o mesmo caminho põe no ar (lição 4.12 de
  `docs/04`: editar ≠ publicar).
- **Para mim, o MCP da Scaleway só de leitura** (estado, registos, custos), e
  escrita só num projecto de ensaio, com uma chave limitada a ele.
- A chave fica nas definições do ambiente da sessão (`SCW_ACCESS_KEY`,
  `SCW_SECRET_KEY`, `SCW_DEFAULT_PROJECT_ID`), nunca no chat nem no repo.
- Abrir a conta, criar chaves e configurar o MCP conta como código (ADR-0001):
  espera pelo OK. ✅ **OK dado pelo Diogo e preparação feita a 03/10/2026**
  (ADR-0011, decisão R); no Claude Code usa-se o `scw` directo, não o MCP.

## O que ficou por verificar (na primeira volta)

- ~~O `scw mcp` não foi experimentado~~ → experimentado a 03/10/2026 (abaixo).
- ~~Se o IAM limita uma chave a um projecto e só a leitura~~ → sim, por
  conjuntos de permissões com âmbito de projecto (abaixo).
- ~~A instalação pelo `go install`~~ → não serve; instala-se pelo binário.

## Preparação da conta (03/10/2026, à noite — ADR-0011)

### O que se fez

- O Diogo abriu a conta, criou o projecto `eurolify-ensaio`, a aplicação e a
  política `claude-leitura`, e a chave dele. Parte foi feita pelo Cowork, com
  um prompt que o proibia de gerar chaves, ver segredos, comprar e apagar.
- No ambiente do Claude Code: as seis variáveis `SCW_*` e um setup script que
  instala o `scw` 2.63.0 e confere a soma oficial.
- Duas sessões novas de prova, criadas por mim no mesmo ambiente, correram só
  leituras.

### Números (medidos a 03/10/2026; como, em cada linha)

| O quê | Resultado | Como |
|---|---|---|
| Binário `scaleway-cli_2.63.0_linux_amd64` das releases | 200, 56,9 MB, soma igual à do `SHA256SUMS`; instala em ≈ 2 s | `curl` + `sha256sum`, nesta sessão |
| Ferramentas do MCP, sem filtro | 1.133 | `tools/list` ao `scw mcp server serve`, com uma chave falsa |
| Ferramentas com `read-only=true` | 453 (218 `list`, 160 `get`…) | idem |
| Ferramentas sensíveis que ficam no modo só de leitura | 28, ex.: `secret_version_get`, `k8s_kubeconfig_get`, `instance_server_get-rdp-password`, `mnq_sqs_get-credentials` | nomes com credential, secret, kubeconfig, password, certificate, access ou `-ca`; 29 apanhados, menos 1 falso (`product-catalog_product_list`) |
| Política `claude-leitura` | regra 1 no ensaio: ContainerRegistryReadOnly, ContainersReadOnly, ObjectStorageBucketsRead, ObservabilityReadOnly, RelationalDatabasesReadOnly, SecretManagerReadOnly; regra 2 na organização: AuditTrailReadOnly, BillingReadOnly, ProjectReadOnly | captura da consola enviada pelo Diogo |
| Chave do Diogo | criada a 03/10/2026, expira a 03/10/2027, projecto preferido `eurolify-ensaio` | captura da consola |
| Projectos | 2: «Eurolify» (mesmo ID da organização, o por omissão) e «eurolify-ensaio» | `scw account project list`, prova 1, 20:48 UTC |
| Contentores, registo, bases, Cockpit, faturação | 0 cada, sem erro | prova 1 |
| Auditoria | 8 eventos (conteúdo não lido) | prova 1 |
| IAM | recusado (`insufficient permissions`) | prova 1 |
| Segredos sem `project-id` / com o do ensaio | recusado / 0 | provas 1 e 2 |
| Servidores e contentores fora do ensaio, sem permissão | 0, **sem erro** | prova 2, 20:54 UTC |
| Servidor com ID inexistente | `Cannot find resource` | prova 2 |
| Pedido à API do GitHub (`api.github.com/.../releases/latest`) | 403 nesta sessão | `curl`; é o que a skill da Scaleway usa (ver `scaleway-skills-avaliado-03out2026.md`) |

**Leitura:** nalgumas listas sem permissão a Scaleway devolve «vazio» e não
«recusado». Uma lista vazia não prova nada; e tentar apagar um ID que não
existe também não, porque responde «não existe».

### O que ficou por verificar

- O portador da chave (a captura não mostra a coluna; a recusa no IAM só prova
  que não é o utilizador dono) e se outra política, «AllApps» ou um grupo lhe
  dão mais.
- A recusa da escrita e a do conteúdo de um segredo (o sistema de permissões da
  sessão de prova bloqueou o `scw secret version access`).
- O alerta de faturação, a autenticação em dois passos e o nome da entidade
  nos dados de faturação: pedidos, não vistos.
- De onde vêm as variáveis `AWS_ACCESS_KEY_ID` e `AWS_SECRET_ACCESS_KEY` do
  ambiente (o `AWS_CA_BUNDLE` é do proxy das sessões).
- O MCP com uma chave verdadeira; a chave e o ambiente do Bruno.
