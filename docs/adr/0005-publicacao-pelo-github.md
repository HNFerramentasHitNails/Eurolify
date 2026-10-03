# ADR-0005 · Publica-se pelo GitHub; o Claude tem o MCP da Scaleway só de leitura

- **Estado:** aceite · posto em prática pelo [ADR-0011](0011-preparacao-da-conta-scaleway.md):
  no Claude Code usa-se o `scw` directo com uma chave só de leitura, em vez do
  MCP; o `scw mcp` e o IAM foram experimentados nele · completado pelo
  [ADR-0014](0014-um-so-ensaio.md): um só ensaio, actualizado a cada entrada no `main`
- **Data:** 03/10/2026
- **Quem decidiu:** Diogo
- **Decisão em aberto de origem:** — (completa o ADR-0004)

## Contexto

Pergunta do Diogo: *«scaleway conseguimos ligar por mcp para que possas fazer
deploy como no vercel+supabase??»*. A Scaleway tem um MCP oficial dentro do seu
programa de linha de comandos (`scw mcp server serve`), que pode ficar só de
leitura; a API dela responde a partir das sessões do Claude (401 sem chave,
medido a 03/10/2026). Pormenor em `memoria/scaleway-mcp-e-deploy-03out2026.md`.

Nos sistemas actuais, editar não era publicar e o deploy dependia de outro
agente (lição 4.12 de `docs/04`).

Pergunta feita ao Diogo: *«Fica assim a publicação: pelo GitHub, com o MCP da
Scaleway só de leitura para mim e escrita só num projecto de ensaio?»*
Resposta, a 03/10/2026: *«sim, fica assim»*.

## Opções consideradas

| Opção | A favor | Contra |
|---|---|---|
| **Publicar pelo GitHub; Claude com MCP só de leitura** | O mesmo caminho testado para tudo; o Claude não tem chaves de escrita em produção | Montar o caminho no GitHub dá trabalho |
| Claude publica pelo MCP com escrita | Como hoje com a Vercel e a Supabase | Publicações à mão, fora dos testes; chaves de escrita numa sessão |

## Decisão

1. **Quem publica é o GitHub**: cada alteração entra no `main`, os testes
   correm e o mesmo caminho põe no ar.
2. **O Claude tem o MCP da Scaleway só de leitura** (estado, registos, custos).
3. **Escrita só num projecto de ensaio**, com uma chave limitada a ele.
4. As chaves ficam nas definições do ambiente da sessão ou nos segredos do
   GitHub — nunca no chat nem no repositório.

## Consequências

- **Não é o OK para código.** Abrir a conta, criar chaves e montar o caminho
  no GitHub esperam pelo OK escrito do Diogo ou do Bruno (ADR-0001).
- Uma correcção urgente também passa pelo GitHub; não há atalho à mão.

## O que ficou por verificar

- O `scw mcp` não foi experimentado.
- Se o IAM da Scaleway limita uma chave a um projecto e só a leitura — não lido.
