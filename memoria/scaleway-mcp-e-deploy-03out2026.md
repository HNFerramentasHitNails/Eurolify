# Scaleway por MCP: dá para ligar, e como se publica (03/10/2026)

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
- **Não é um conector de um clique** como o Vercel e o Supabase: procurei no
  catálogo de conectores do claude.ai com «scaleway», «cloud», «deploy» e só
  vieram Vercel, Lovable, Supabase e Expo (todos já ligados).
- Há servidores de terceiros (ex.: feedback-loop-ai/mcp-scaleway, MIT, com
  modo só de leitura). Não usar: o oficial chega.

## Números (medidos nesta sessão, 03/10/2026)

| Teste | Resultado | Leitura |
|---|---|---|
| `GET api.scaleway.com/instance/v1/zones/fr-par-1/servers` sem chave | 401 | a API chega daqui; falta a chave |
| Download do `scw` pelas releases do GitHub | 403 do proxy | bloqueado |
| `proxy.golang.org/…/scaleway-cli/v2/@latest` | 200; Go 1.24.7 instalado | dá para instalar com `go install` (não instalado) |

## Proposta (decidida a 03/10/2026, ADR-0005)

- **Quem publica é o caminho no GitHub, não eu à mão**: cada alteração entra
  no `main`, os testes correm e o mesmo caminho põe no ar (lição 4.12 de
  `docs/04`: editar ≠ publicar).
- **Para mim, o MCP da Scaleway só de leitura** (estado, registos, custos), e
  escrita só num projecto de ensaio, com uma chave limitada a ele.
- A chave fica nas definições do ambiente da sessão (`SCW_ACCESS_KEY`,
  `SCW_SECRET_KEY`, `SCW_DEFAULT_PROJECT_ID`), nunca no chat nem no repo.
- Abrir a conta, criar chaves e configurar o MCP conta como código (ADR-0001):
  espera pelo OK.

## O que ficou por verificar

- O `scw mcp` não foi experimentado: quantas ferramentas expõe e como se
  porta com um assistente.
- Se o IAM da Scaleway limita uma chave a um projecto e só a leitura — não li a
  documentação do IAM.
- A instalação pelo `go install` não foi feita.
