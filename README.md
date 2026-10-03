# Lumavo

**Comércio electrónico feito na Europa, para vender na Europa.** Um projecto
da **Luckytarget Lda**.

Um núcleo de loja por API para qualquer frontend, um Hub de gestão, as regras
europeias de raiz e aberto a qualquer IA.

> **Estado a 03/10/2026: Fase 0 — proposta e desenho. Não há código**
> ([ADR-0001](docs/adr/0001-sem-codigo-ate-plano-decidido.md)). Avança-se para
> código quando o Bruno ou o Diogo o decidirem.

## Por onde começar

| Ler | Para quê |
|---|---|
| [`docs/00-proposta.md`](docs/00-proposta.md) | **A proposta**, apresentada a Bruno e Cila |
| [`docs/06-decisoes-em-aberto.md`](docs/06-decisoes-em-aberto.md) | O que está decidido e as 14 decisões que faltam, por ordem |
| [`docs/05-fases-e-mvp.md`](docs/05-fases-e-mvp.md) | Fases, o que entra na primeira versão e quando se passa à seguinte |
| [`docs/02-arquitectura.md`](docs/02-arquitectura.md) | As peças, os domínios e as interfaces (API, checkout, MCP) |
| [`docs/03-regulamentar-ue.md`](docs/03-regulamentar-ue.md) | O mapa das regras europeias, com datas e fontes |
| [`docs/04-licoes-dos-sistemas-actuais.md`](docs/04-licoes-dos-sistemas-actuais.md) | As regras que os sistemas actuais da empresa já pagaram |
| [`docs/07-pagamentos-e-envios-por-pais.md`](docs/07-pagamentos-e-envios-por-pais.md) | Os pagamentos e os envios mais usados na UE, e com quem fazer parcerias |
| [`docs/08-extensoes-de-terceiros.md`](docs/08-extensoes-de-terceiros.md) | Como terceiros acrescentam pagamentos, envios, regras e ecrãs ao Lumavo |
| [`docs/09-modelo-de-receita.md`](docs/09-modelo-de-receita.md) | Como o Lumavo ganha dinheiro: concorrência, fontes de receita e a proposta (D-14) |
| [`docs/adr/`](docs/adr/) | As decisões registadas |
| [`memoria/MEMORY.md`](memoria/MEMORY.md) | O índice da memória de trabalho |
| [`CLAUDE.md`](CLAUDE.md) | As regras para qualquer sessão de Claude neste repositório |
| [`.claude/skills/`](.claude/skills/) | As 14 skills de trabalho (12 de domínio, a de design com 38 referências de terceiros, e a de extensões) |

## As quatro peças

1. **Núcleo por API** — catálogo, preços por mercado, carrinho, checkout
   alojado, encomendas, stock, pagamentos, envios, devoluções.
2. **Hub de gestão** — o back-office adaptável onde o comerciante trabalha.
3. **Regras europeias de raiz** — IVA e OSS, NIF e VIES, faturação legal por
   país, direitos do consumidor, segurança dos produtos, RGPD.
4. **Aberto a qualquer IA** — MCP, contrato OpenAPI e, mais tarde, os
   protocolos de comércio por agentes.
