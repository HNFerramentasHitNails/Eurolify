---
name: headless-commerce
description: Desenho das interfaces do Eurolify — API da Loja (pública) e de Administração (privada), REST com contrato OpenAPI, OAuth 2.1/OIDC, papéis e chaves, webhooks assinados, paginação, limites, erros normalizados, chaves de idempotência, SDK tipado, checkout alojado, servidor MCP e o pacote para construtores de frontends (Lovable, Vercel, Bolt, Emergent). Usar ao desenhar ou alterar qualquer recurso, operação, aviso ou ferramenta de IA exposta para fora.
---

# Comércio sem cabeça (headless)

> Estado: **desenho** — o código está autorizado (ADR-0023), mas o deste domínio só depois do desenho dele em tabela. Base:
> `docs/02-arquitectura.md` §4. Decisões ligadas: D-7, D-8, D-9.

## Quando usar

- Acrescentar ou alterar um recurso, uma operação ou um aviso (webhook).
- Pensar no que um frontend feito com IA pode e não pode fazer.
- Desenhar uma ferramenta MCP.

## As duas APIs

| | API da Loja | API de Administração |
|---|---|---|
| Para quem | frontends (Lovable, Vercel, Bolt, Emergent, apps, balcão) | Hub do Eurolify, integrações, aplicações, sistemas de gestão dos comerciantes |
| Autenticação | chave **pública** por loja + sessão do visitante/cliente | **OAuth 2.1 / OIDC** com âmbitos; chaves de servidor para integrações |
| Pode | ler catálogo e preços do mercado, gerir o próprio carrinho, iniciar o checkout alojado, área de cliente | tudo o que o papel e os âmbitos permitirem |
| Não pode | decidir preço, IVA, disponibilidade ou elegibilidade | contornar as travas fiscais (vivem no domínio, não na API) |

**O Hub do Eurolify usa a API de Administração como qualquer outro cliente.** Se
o Hub precisa de uma coisa que a API não dá, a API está incompleta.

## Regras do contrato

1. **REST com contrato OpenAPI 3.1** é a fonte da verdade; documentação, SDK e
   ferramentas MCP geram-se dele. Nada é exposto fora do contrato.
2. **Recursos com nomes de negócio** e identificadores opacos, com prefixo do
   tipo (ex.: `ord_…`, `cus_…`).
3. **Erros num formato único** (RFC 9457) com código estável (`vat.vies_invalid`,
   `inventory.insufficient`), mensagem em PT/EN e o campo em causa. Nunca um 200
   com `ok: false` e nunca um erro engolido (lição 4.1 e o
   `supabase.functions.invoke` que deitava fora o corpo dos erros no Hub).
4. **Paginação por cursor**, sempre, com indicação de que há mais. Nenhuma
   lista cortada em silêncio (lição 4.7: «não existe» a 40 % das fichas).
5. **`Idempotency-Key` obrigatória** em todas as escritas; a mesma chave com
   outro corpo dá erro.
6. **Limites de pedidos** por chave e por loja, com cabeçalhos do que resta.
7. **Versão por data**, 12 meses de suporte, alterações anunciadas.
8. **Dinheiro**: valor em cêntimos (inteiro) + moeda ISO 4217; nunca vírgula
   flutuante. Datas em ISO 8601 com fuso.
9. **Expandir em vez de inventar**: campos relacionados pedem-se
   (`expand=billing_profile`), não se duplicam em cada resposta.

## Webhooks

- Assinados com HMAC e carimbo de tempo (rejeitar reenvios velhos).
- Identificador do evento para o receptor ser idempotente.
- Reenvio com recuo exponencial durante 72 h; registo de entregas visível ao
  comerciante, com botão de reenviar.
- **Mínimo de dados no corpo**; o receptor pede o resto à API (evita espalhar
  dados pessoais por sistemas de terceiros).

## Checkout alojado (D-7)

O checkout é **servido pelo Eurolify**, com o aspecto e o domínio da loja,
porque é onde a lei e o IVA se decidem: total com impostos e portes, condições
e aceitação, perfil de faturação («a fatura é para outra pessoa/empresa»),
VIES, métodos de pagamento do país, autenticação forte, confirmação com prova
contratual. Um frontend gerado por IA **redirecciona** para lá; não o imita.

## Pacote para construtores de frontends

Para o Lovable, Vercel (v0), Bolt e Emergent gerarem uma loja certa à primeira:

- `llms.txt` e o contrato OpenAPI publicados;
- um texto de instruções pronto a colar no construtor (a loja online actual da
  empresa foi feita no Lovable a partir de uma especificação deste género);
- uma loja de exemplo;
- a lista do que o frontend **não** faz: calcular IVA, validar NIF, decidir
  promoções, mostrar condições legais diferentes das do servidor.

## Servidor MCP (D-9)

Esta secção é o **MCP de comércio** (dados do comerciante). O **MCP de
operação da VPS** (`apps/mcp`, ADR-0033) é outro: leituras e quatro acções
fixas com confirmação, só para o Diogo e o Bruno; as regras dele estão no
ADR-0033, incluindo os nomes das ferramentas.

- Ferramentas geradas do mesmo contrato, com nomes de negócio
  (`procurar_artigos`, `vendas_por_pais`, `encomenda_por_numero`).
- **Fase 1: só leitura.** Escrita (Fase 3) sempre com confirmação humana;
  **nunca**: emitir faturas, reembolsar, fundir clientes, alterações em lote.
- Respostas **pequenas e paginadas** — o assistente interno actual gastava 185 mil
  tokens por conversa por levar o catálogo inteiro (lição 6.1).
- Autenticação OAuth com os mesmos âmbitos da API; cada chamada no registo de
  auditoria com utilizador, cliente de IA e modelo.
- Os modelos que não falam MCP usam o **mesmo contrato** OpenAPI por chamada de
  funções.
- Comércio por agentes (UCP, ACP): Fase 3, sobre o checkout alojado.
- **Lista de verificação do que o MCP tem de responder:** as 116 tarefas de
  comerciante do repo `40RTY-ai/shopify-admin-skills` (MIT, lido a 03/10/2026).
  Serve de inventário e de formato (operações declaradas, ensaio sem escrever
  por omissão); **não se copia** — ver
  `memoria/skills-shopify-admin-avaliadas-03out2026.md`.

### Construir o servidor MCP — a referência `mcp-builder`

Guia da Anthropic para construir servidores MCP, guardado em
`referencias/mcp-builder/` (Apache 2.0; origem em `referencias/ORIGEM.md`).
Ler `referencias/mcp-builder/mcp-builder.md` quando chegar a hora de construir
(o ADR-0023 substituiu o ADR-0001; o MCP é código de domínio e espera pelo
desenho dele), e os guias em `reference/` pela ordem
que ele indica. **As regras do Eurolify ganham ao guia:**

| O guia diz | No Eurolify |
|---|---|
| Na dúvida, cobrir a API toda | **Fase 1 só leitura.** A escrita entra na Fase 3, ferramenta a ferramenta, com confirmação humana — nunca faturas, reembolsos, fusões de clientes nem lotes |
| Ferramentas geradas à mão | geradas do **contrato OpenAPI**, para o MCP e a API nunca divergirem (uma regra, um sítio) |
| Prefixo de serviço nos nomes | prefixo `eurolify_` e nomes de negócio (`eurolify_vendas_por_pais`) |
| Paginar e filtrar | obrigatório, e com o total explícito (lição 4.7) |
| TypeScript e HTTP «streamable» sem estado | é a mesma recomendação da D-2 e da D-8; confirmar quando forem decididas |
| Avaliar com 10 perguntas realistas | perguntas **em português**, tiradas das tarefas reais de comerciante (lista do `40RTY-ai/shopify-admin-skills`); **correr a avaliação gasta créditos de API** — orçamento antes (lição 6.3) |

⚠️ O guia de avaliação (`reference/evaluation.md`) manda correr
`scripts/evaluation.py`: **os programas não foram copiados** (chamam a API paga
da Anthropic e são código: entram, se entrarem, pelas duas revisões do
ADR-0013). Estão no repositório de origem, no commit
indicado em `referencias/ORIGEM.md`.

## Anti-padrões

- Um endpoint «só para o Hub» fora do contrato.
- Devolver dados que o papel não pode ver e confiar no ecrã para os esconder.
- Contar no browser o que as permissões filtram (lição 4.8).
- Um webhook que responde 200 antes de ter gravado o evento.

## Antes de dizer «está feito»

- [ ] Está no contrato OpenAPI, com exemplos e erros.
- [ ] Escritas com idempotência; listas com cursor.
- [ ] Testado com um papel sem permissão e com outro inquilino.
- [ ] Se é sensível a IA: decidido se entra no MCP e com que confirmação.
