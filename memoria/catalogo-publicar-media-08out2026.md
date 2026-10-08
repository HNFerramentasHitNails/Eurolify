# Catálogo: «pode publicar?» verifica o texto alternativo das imagens — 08/10/2026

## O que se fez

- **Decisão CR** (`docs/06`). Diogo, 08/10/2026: «sim, avança com a verificação das imagens».
  - Uma imagem sem texto alternativo impede a publicação (C2), se for do artigo ou de uma variante à venda no par.
  - Acaba a parte da media da rede CF: `nao_verificado` passa a `["conformidade"]`.
  - Num mercado com uma língua que não é a de origem e com imagens que contam, junta-se `traducao_do_texto_alternativo`.
- **#184, juntado como 64b1751:**
  - impedimento novo `texto_alternativo_em_falta`, com os `med_…`;
  - `criarMedia` sem texto e `alterarMedia` que tira o texto reverificam as publicações do artigo; as que não passam saem de venda (`verificacao_falhou`, como na CJ). Fá-lo quem tem `catalog:write`, sem `catalog:publish`, como já arquivar uma variante;
  - as escritas da media tomam a linha do artigo (FOR KEY SHARE), a fila do artigo (0005) e a fila da media, por esta ordem;
  - as descrições OpenAPI do `POST`, `PATCH` e `DELETE` da media dizem o efeito;
  - `docs/14` §3.5, §4.2 (a reverificação passa a sete operações) e §5 C2; `docs/eurolify/implementation-plan.md`.
- **Revisão do agente (Claude Sonnet 5.5), 2 rondas, publicadas no pedido com o tratamento:**
  - 1.ª: dois P2, `catalog:write` tira de venda e o efeito em falta no contrato;
  - 2.ª: dois P3, os testes não provavam a ausência de reverificação.
- **Publicado no ensaio:** execução 37791783464 (14:26 UTC), «migrar: nada em falta», imagem `sha256:b43dae278de1a2f266c2d7919d57bfae1551f53bd3e51c55d860f3236efc314c`, «O /health da API responde», «A API chega à base».

## Números (com data e como se contaram)

- 08/10/2026, `pnpm teste` local contra o PostgreSQL 18.6, na 1.ª versão do pedido: API 836, MCP 58, Hub 47.
- `catalogo-publicacao.test.ts` na versão final: 44 testes, mais 8 (6 na escrita inicial, 2 na 1.ª ronda). Na 2.ª ronda reforçou-se um teste que já existia.
- Mutações, uma de cada vez e com os ficheiros repostos:
  - 7 de 7 na escrita inicial;
  - 2 de 2 na 1.ª ronda;
  - 2 de 2 na 2.ª ronda.

## O que ficou por verificar

- Não fiz o teste pela rota com um artigo publicado: montar mercado, canal e preços pela API é pesado.
- A base não repete a regra: SQL à mão da API pode deixar à venda um artigo com uma imagem sem texto (`docs/14` §5 C2).
- A resposta de criar ou alterar uma imagem não diz que o artigo saiu de venda; só se vê nas publicações.
- As traduções do texto alternativo continuam por fazer.
- **Pergunta em aberto, sem urgência:** só quem tem `catalog:publish` deve poder tirar de venda, mesmo de forma indirecta? Mudaria também o arquivar variantes e o mudar o nome.
- As rotas no ensaio não foram chamadas (o MCP da VPS continua sem autorização nesta sessão).
