# ADR-0011 · A conta da Scaleway fica preparada e o Claude lê-a com uma chave só de leitura

- **Estado:** aceite · **sem efeito para o alojamento** desde o
  [ADR-0015](0015-alojamento-numa-vps.md); o acesso só de leitura do Claude mudou pelo
  [ADR-0016](0016-o-claude-opera-a-vps.md)
- **Data:** 03/10/2026
- **Quem decidiu:** Diogo
- **Decisão em aberto de origem:** — (põe em prática o
  [ADR-0005](0005-publicacao-pelo-github.md); abre, **só para esta
  preparação**, a parte do [ADR-0001](0001-sem-codigo-ate-plano-decidido.md)
  que conta a configuração de alojamento como código)

## Contexto

O ADR-0001 conta a configuração de alojamento como código, e os ADR-0003,
0004 e 0005 diziam que abrir a conta, criar chaves e configurar o acesso do
Claude esperavam pelo OK escrito do Diogo ou do Bruno.

O Diogo abriu a conta da Scaleway a 03/10/2026 e pediu: *«como faço agora para
conectar o claude ao scaleway e preparar tudo antes de começarmos a
desenvolver o eurolify»*. Fez a preparação na consola, parte dela pelo Cowork,
e no fim respondeu, à pergunta *«Dás o OK para eu registar tudo isto no
repositório?»*: *«sim, regista o ADR-0010 e corrige a memória»*. O número
passou a **0011** porque o 0010 entrou no `main` às 20:26 UTC desse dia com
outro assunto (o `AGENTS.md`).

Medido nesta sessão a 03/10/2026 (pormenor em
`memoria/scaleway-mcp-e-deploy-03out2026.md`):

- O programa da Scaleway (`scw`) **instala-se pelas releases do GitHub**: o
  binário v2.63.0 descarrega em ≈ 2 s e a soma confere com o `SHA256SUMS`
  oficial. A memória dizia que estava bloqueado.
- **O MCP não protege os segredos.** O exemplo `--read-only` da documentação dá
  `Unknown flag: --read-only`; o que funciona é `read-only=true`, que reduz de
  1.133 para 453 ferramentas. Nesse modo ficam, por exemplo,
  `secret_version_get`, `k8s_kubeconfig_get` e
  `instance_server_get-rdp-password`. A protecção tem de estar nas permissões
  da chave.

## Opções consideradas

| Opção | A favor | Contra |
|---|---|---|
| **a) No Claude Code, o `scw` directo, com uma chave cujas permissões só leem, escolhidas uma a uma** | A protecção está na chave; não enche a conversa de ferramentas | Uma lista de permissões a manter |
| b) O MCP da Scaleway (`scw mcp server serve read-only=true`) no Claude Code | É o que o ADR-0005 nomeava | 453 ferramentas; o modo só de leitura deixa ferramentas que leem segredos; a forma `--read-only` da documentação falha |
| c) Chave com `AllProductsReadOnly` | Um só conjunto | A documentação não diz se lê o conteúdo dos segredos; o `SecretManagerReadOnly` diz que não lê |

## Decisão

Fica assim, na conta da Luckytarget Lda:

1. **Projecto `eurolify-ensaio`** (`e95409c3-…`): o único onde o Claude lê
   recursos. O projecto por omissão chama-se «Eurolify», tem o mesmo ID da
   organização (`87a21318-…`) e está vazio.
2. **Aplicação `claude-leitura`**, com a política `claude-leitura` (vista pelo
   Diogo na consola, captura de 03/10/2026):
   - regra 1, âmbito `eurolify-ensaio`: `ContainerRegistryReadOnly`,
     `ContainersReadOnly`, `ObjectStorageBucketsRead`, `ObservabilityReadOnly`,
     `RelationalDatabasesReadOnly`, `SecretManagerReadOnly`;
   - regra 2, âmbito da organização: `AuditTrailReadOnly`, `BillingReadOnly`,
     `ProjectReadOnly`.
3. **Uma chave por pessoa**, nunca no chat nem no repositório. A do Diogo foi
   criada a 03/10/2026, **expira a 03/10/2027** e tem o `eurolify-ensaio` como
   projecto preferido do Object Storage.
4. **Nas sessões do Claude Code**, as definições do ambiente têm
   `SCW_ACCESS_KEY`, `SCW_SECRET_KEY`, `SCW_DEFAULT_ORGANIZATION_ID`,
   `SCW_DEFAULT_PROJECT_ID` (o do ensaio), `SCW_DEFAULT_REGION=fr-par` e
   `SCW_DEFAULT_ZONE=fr-par-1`. O setup script instala o `scw` **2.63.0**,
   conferido pela soma oficial. A versão muda-se de propósito, não sozinha.
5. **No Claude Code usa-se o `scw` directo, não o MCP** (opção a). O ADR-0005
   fica igual no que decide — o Claude só lê — e muda só o meio. Se um dia se
   usar o MCP (ex.: Claude Desktop), é com `read-only=true` e filtro por
   `namespaces`.

**Continua fechado até ao OK para código (ADR-0001):** a chave com escrita no
ensaio, o projecto de produção, criar qualquer recurso (bases de dados,
contentores, registo, armazenamento), os segredos do GitHub e o caminho de
publicação (ADR-0005), e o código do produto.

**Antes do primeiro dado pessoal real:** ler o acordo de tratamento de dados da
Scaleway ([DPA de 01/06/2024](https://www-uploads.scaleway.com/DPA_2024_ENG_b0abb5cc26.pdf),
encontrado e não lido) e a [lista de subcontratantes](https://www.scaleway.com/en/subprocessorlist/),
e pôr a Scaleway no registo de tratamentos (skill `eu-gdpr-privacy`).

## Provas (03/10/2026, duas sessões novas do mesmo ambiente)

Às 20:48 UTC (prova 1) e às 20:54 UTC (prova 2), só leituras:

| Leitura | Resultado |
|---|---|
| `scw` instalado pelo setup script | `/usr/local/bin/scw`, 2.63.0 |
| As duas variáveis da chave | presentes (só os nomes foram vistos) |
| Projectos | 2: «Eurolify» e «eurolify-ensaio» |
| Contentores, registo, bases de dados, Cockpit | 0 cada, sem erro |
| Faturação | respondeu, 0 linhas |
| Registo de auditoria | respondeu, 8 eventos (conteúdo não lido) |
| IAM (`iam policy list`) | recusado: `insufficient permissions` |
| Segredos com `project-id=` do ensaio | 0, sem erro |
| Segredos sem projecto | recusado: `insufficient permissions: list secret` |
| Servidores (sem permissão nenhuma) | 0, sem erro |
| Contentores no projecto «Eurolify» (sem permissão) | 0, sem erro |
| Ler um servidor com um ID que não existe | `Cannot find resource` |

## Consequências

- O ADR-0001 continua a valer para tudo o resto; só esta preparação saiu dele.
- **O Bruno faz o mesmo na conta dele**: uma chave própria da aplicação
  `claude-leitura`, no ambiente dele. O Codex, se ligar à Scaleway, também só
  lê (ADR-0008).
- **Uma lista vazia não prova nada.** Nalgumas leituras sem permissão, a
  Scaleway devolve «vazio» e não «recusado» (servidores e contentores fora do
  ensaio, medido acima). Antes de concluir «não há nada», confirma-se que a
  leitura está no âmbito da chave.
- **Os segredos lêem-se sempre com `project-id=`** do ensaio; sem ele, a
  Scaleway recusa.
- **O que pode partir:**
  - a chave deixa de funcionar a 03/10/2027 se não for trocada antes;
  - as políticas somam-se, e uma política dada a «AllApps» alargaria esta
    chave sem ninguém lhe mexer
    ([políticas](https://www.scaleway.com/en/docs/iam/policies-permissions/policy/));
  - se uma versão futura do `scw` mudar o nome do ficheiro nas releases, o
    setup script falha e as sessões arrancam sem `scw`.

## O que ficou por verificar

- **Que a chave é da aplicação `claude-leitura`.** A captura das chaves não
  mostra a coluna do portador. A recusa no IAM prova que não é o utilizador
  dono, mas não diz que aplicação é.
- **Que nenhuma outra política lhe dá mais** (outra com o mesmo principal,
  «AllApps» ou um grupo).
- **Que a escrita é recusada.** Não foi tentada: tentar apagar um ID que não
  existe não prova nada, porque responde «não existe» como na última linha das
  provas.
- **Que o conteúdo de um segredo é recusado.** O sistema de permissões da
  sessão de prova bloqueou o `scw secret version access`.
- O alerta de faturação, a autenticação em dois passos e o nome da entidade nos
  dados de faturação: pedidos, **não vistos**.
- As variáveis `AWS_ACCESS_KEY_ID` e `AWS_SECRET_ACCESS_KEY` existem no
  ambiente e **não se sabe de onde vêm**. O `AWS_CA_BUNDLE` vem da
  configuração do proxy das sessões; as outras duas, não.
- O MCP com uma chave verdadeira; a chave e o ambiente do Bruno.

Fontes da Scaleway, lidas a 03/10/2026:
[conjuntos de permissões](https://www.scaleway.com/en/docs/iam/policies-permissions/permission-sets/),
[chaves](https://www.scaleway.com/en/docs/iam/credentials/create-api-keys/),
[MCP](https://www.scaleway.com/en/developers/cli/mcp/), e `scw config --help`
(v2.63.0) para os nomes das variáveis.
