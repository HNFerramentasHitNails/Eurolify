# Publicação na Scaleway: um só ensaio, actualizado a cada entrada no `main` (03/10/2026)

**Pedido do Diogo (03/10/2026):** *«Verifica antes de escrever código, como
podemos depois fazer deploy no scaleway para ver em tempo real o que estamos a
contruir.»*

**Decisão do Diogo (03/10/2026):** *«o ensaio é um só, actualizado a cada
entrada no main»* — ADR-0014, decisão U em `docs/06`.

## O que se fez (só leitura; nada criado na Scaleway)

- Clone parcial, só de leitura, do texto da documentação da Scaleway
  (`scaleway/docs-content`, commit `416c1da`, 02/10/2026) no scratchpad da
  sessão; lidas as pastas dos contentores sem servidor, do IAM, da base SQL
  sem servidor e o tutorial do GitHub. O leitor automático de páginas cortava
  a documentação na navegação; o texto-fonte não.
- Páginas de preços lidas a 03/10/2026, com o HTML descarregado e procurado
  à mão (não por resumo).
- Leituras na conta com a chave `claude-leitura` e a ajuda do `scw` 2.63.0.
- **Nenhuma acção de terceiros** para publicar na Scaleway pelo GitHub foi
  usada nem se propõe (httptoolkit, yamatt): não são da Scaleway e o `scw`
  faz o mesmo.

## Como fica o caminho (ADR-0005 + ADR-0014)

1. O pedido de alteração revisto (ADR-0013) entra no `main`.
2. O GitHub corre os testes; se falharem, pára.
3. Constrói a imagem e envia-a para o registo de imagens do `eurolify-ensaio`
   (tutorial oficial: `docker/login-action` com utilizador `nologin` e a
   chave secreta como palavra-passe).
4. `scw container container update <id> image=…:<commit>`: no `scw` 2.63.0
   actualizar já volta a pôr no ar (o comando `deploy` da página da
   documentação já não existe nesta versão; há `redeploy`).
5. Tu e o Bruno abrem o endereço do contentor
   (`….functions.fnc.fr-par.scw.cloud`); mais tarde um domínio próprio por
   CNAME, com o certificado posto pela Scaleway.

Para ver uma alteração **antes** de entrar no `main`: o Eurolify a correr
dentro da sessão, com capturas de ecrã. Não é a Scaleway.

## Números (com data e como se contaram)

| O quê | Valor | Fonte e como |
|---|---|---|
| Recursos no `eurolify-ensaio` às 21:25 UTC de 03/10/2026 | 0 grupos de contentores, 0 contentores, 0 registos de imagens, 0 bases, 0 espaços de ficheiros | `scw … list` com a chave `claude-leitura`; todas dentro do âmbito da chave, por isso o vazio vale |
| Base SQL sem servidor | recusado: `insufficient permissions: read database` | `scw sdb-sql database list`, mesma hora; a política não tem esse conjunto |
| Contentores: preço | €0,00001/vCPU-s e €0,000002/GB-s, depois de 200.000 vCPU-s e 400.000 GB-s grátis **por conta e por mês**; entrada e saída de tráfego grátis | scaleway.com/en/pricing/serverless, 03/10/2026; `serverless-containers/faq.mdx` |
| Contentor 0,5 vCPU e 1 GB, 4 h/dia em 22 dias | 158.400 vCPU-s e 316.800 GB-s ⇒ dentro do gratuito, ≈ 0 € | conta minha; o gratuito é da conta toda, partilhado com outros contentores |
| O mesmo contentor sempre ligado (730 h) | ≈ 15,60 €/mês (11,14 + 4,46) | conta minha |
| Base PostgreSQL gerida DB-DEV-S (2 vCPU, 2 GB) | €0,0156/h ⇒ ≈ 11,40 €/mês; disco €0,0993/GB/mês; cópias €0,03/GB/mês | scaleway.com/en/pricing/managed-databases, 03/10/2026 |
| Registo de imagens privado | €0,027/GB/mês; tráfego na mesma região grátis, entre regiões €0,033/GB | scaleway.com/en/pricing/containers, 03/10/2026, conferido no HTML |
| Ensaio inteiro | ≈ 12 a 28 €/mês | soma minha; o `docs/10` §5 conta 2.000–5.000 € de alojamento na construção — **não recalculado** |
| Desligar por inactividade | 15 min com `min-scale` 0; republicar não desliga o serviço | `containers-autoscaling.mdx` |
| Pôr no ar | *«can take several minutes, depending on the image used»* | `api-cli/deploy-container-cli.mdx`; não medido |
| Registos e métricas no Cockpit | grátis com a retenção por omissão (7 dias registos, 31 dias métricas) | `how-to/monitor-container.mdx` |

## Leitura — o que a documentação obriga (propostas, por decidir com o OK para código)

- **O endereço do ensaio fica público.** Um contentor privado recusa (403)
  todo o pedido sem o cabeçalho `X-Auth-Token` com uma chave IAM
  (`how-to/create-auth-token-from-console.mdx`); um browser não o manda. Os
  Edge Services também só chegam a contentores públicos
  (`how-to/deploy-container-behind-edge-services.mdx`). Protecção: o login do
  Eurolify (peça 2) e, até lá, uma palavra-passe guardada como segredo do
  contentor. Dados de ensaio sem dados pessoais reais (`docs/02` §6).
- **A base do ensaio em PostgreSQL gerido, não a SQL sem servidor.** A SQL sem
  servidor (`serverless-sql-databases/reference-content/known-differences.mdx`)
  não aceita `CREATE USER` nem `GRANT` por SQL, partilha o `SET` entre
  clientes e não garante o `pg_advisory_lock`. Isso toca no isolamento entre
  comerciantes imposto pela base e nas migrações; e a produção será PostgreSQL
  gerido (ADR-0003), pelo que o ensaio deve ser o mesmo motor.
- **A chave de escrita do GitHub.** Os conjuntos dos contentores são só três:
  `ContainersReadOnly`, `ContainersFullAccess` e `ContainersPrivateAccess`
  (`iam/policies-permissions/permission-sets.mdx`). Proposta: aplicação IAM
  nova, `ContainerRegistryFullAccess` + `ContainersFullAccess` só no
  `eurolify-ensaio`, chave com data de fim nos segredos do GitHub. Procurei
  entrada sem chave guardada (OIDC, «federation», «workload identity») na pasta
  `pages/iam`: só há entrada única para pessoas (Google, GitHub, SAML).
- **Aplicação IAM que nasce sozinha.** Criar um grupo de contentores cria uma
  aplicação e uma política `serverless-namespace-<região>-<id>` com
  `ContainerRegistryFullAccess` e `MessagingAndQueuingFullAccess`
  (`reference-content/v1-migration-guide.mdx`). Não alarga a `claude-leitura`,
  mas é mais um portador com escrita: ver no IAM quando for criada.
- **Republicar só quando muda código** (filtro por pastas no GitHub), para um
  commit de documentos não republicar o mesmo: proposta minha.

## O que ficou por verificar

- Quanto demora uma publicação e o primeiro pedido depois de o contentor
  desligar: a documentação não dá números.
- Se a DB-DEV-S ainda se pode criar e o disco mínimo.
- Se a chave `claude-leitura` lê os registos com `scw container container
  logs` (não há contentor).
- O âmbito (projecto ou organização) da aplicação `serverless-namespace-…`.
- A entrada sem chave guardada só foi procurada em `pages/iam` da
  documentação.
