# A `mcp-builder` juntada à skill `headless-commerce` (03/10/2026)

**Pedido do Diogo (03/10/2026):** *«junta também a mcp-builder»* — logo a seguir
a juntar as skills de design ([[skills-de-design-juntadas-03out2026]]).

## O que se fez

- O guia da Anthropic para construir servidores MCP (`anthropics/skills`,
  commit `8a1541c`, Apache 2.0) ficou em
  `.claude/skills/headless-commerce/referencias/mcp-builder/`: o guia principal e
  os 4 guias de referência (boas práticas, TypeScript, Python, avaliação), com o
  conteúdo original e a licença.
- **Ficou na `headless-commerce` e não na `lumavo-design`**: não é design; é a
  skill que já tem as regras do MCP do Lumavo.
- Na `headless-commerce` entrou uma tabela com o que **o Lumavo muda ao guia**:
  só leitura na Fase 1 (o guia diz «na dúvida, cobrir a API toda»), ferramentas
  geradas do contrato OpenAPI, prefixo `lumavo_`, paginação com total,
  avaliação com perguntas em português e com orçamento de créditos.

## Ficou de fora

A pasta `scripts/` (`evaluation.py`, `connections.py`): programas que se ligam a
servidores MCP e chamam a API paga da Anthropic. É código (ADR-0001) e gasta
créditos. O guia de avaliação refere-os; estão no repositório de origem.

## Verificado

- Os 4 caminhos `./reference/…` do guia principal existem na cópia.
- Nenhum ficheiro copiado se chama `SKILL.md` (não aparece como skill solta).

## O que ficou por verificar

- Li o guia principal por inteiro; os 4 guias de referência só pelos títulos e
  pelas linhas que falam dos programas e da rede.
- O guia manda ler a especificação do MCP e os SDK na rede: não verifiquei se a
  versão que lá está hoje bate com o que o guia descreve.
