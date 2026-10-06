# ADR-0040 · As IAs dos comerciantes só lêem na Fase 1

- **Estado:** aceite
- **Data:** 06/10/2026
- **Quem decidiu:** Diogo
- **Decisão em aberto de origem:** D-9 (`docs/06-decisoes-em-aberto.md`)

## Contexto

- Requisito de partida C: o Eurolify funciona com qualquer IA (`docs/06`).
  A recomendação D-9 estava escrita desde 03/10/2026, sem confirmação.
- Fala do servidor MCP **de comércio** (skill `headless-commerce`, que traz o
  guia `mcp-builder`), não do MCP da VPS (ADR-0033).

## Decisão

Diogo, 06/10/2026: *«sim, concordo, só ler na Fase 1»*.

| Fase | A IA de um comerciante pode |
|---|---|
| Fase 1 | **só ler** (artigos, encomendas, stock, relatórios), com uma chave e âmbitos de leitura (`docs/19`) |
| Fase 3 | escrever **com confirmação de uma pessoa** em cada escrita; protocolos de comércio por agentes (UCP, ACP) |
| Nunca | emitir faturas, reembolsar, fundir clientes, corrigir em lote |

## Consequências

- O «nunca» vale também para as chaves de servidor usadas por uma IA: essas
  acções não têm âmbito que uma chave possa ter sem uma pessoa (a desenhar com
  os domínios de faturação, pagamentos e clientes).
- A escrita da Fase 3 reutiliza o segundo passo do Hub (decisão BA).
