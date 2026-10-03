# Arranque do Lumavo — proposta, desenho e skills (03/10/2026)

**Pedido por:** Diogo · **Sessão:** https://claude.ai/code/session_01URyrpGYUUBZv5e3iicDc4g

## O pedido, nas palavras dele (03/10/2026)

> *«Vamos antes de tudo criar uma proposta para o bruno e cila, para uma
> alternativa do Shopify para a europa, com todas as regras Europeias, chamada
> Lumavo»*
>
> *«Não escrevas qualquer codigo até termos um plano decidido. Deves de guardar
> no repositorio lumavo todas as skills, memorias, informações importantes,
> para que eu e o bruno possamos trabalhar em conjunto depois.»*
>
> *«O Lumavo, tem de funcionar com API (ou podes sugerir outra alternativa), Em
> que se possa criar um frontend em lovable, vercel, emergent, bolt.new, etc»*
>
> *«O Lumavo também deverá conter um hub totalmente funcional e adaptavel tipo o
> hub da hnhitnails […] funcionar nativamente com todos os mercados europeus,
> aplicação de pagamentos, envios, e outras personalizações uteis»*
>
> *«Será importante, também o lumavo funcionar com todas as IAs do mundo, como
> codex, claude, deepseek, etc, talvez por mcp ou algo parecido.»*
>
> *«Só avançamos para o código quando eu ou o bruno decidirmos avançar.»*
>
> *«aproveita o que existe ja no hub hit nails e no front end da loja shopify da
> hnhitnails, para fazeres consultas de algumas regras.»*

Trouxe uma lista de 12 skills pedida ao Perplexity (as que estão em
`.claude/skills/`, com os mesmos nomes).

## O que ficou feito

| Ficheiro | O quê |
|---|---|
| `docs/00-proposta.md` | a proposta para Bruno e Cila |
| `docs/02-arquitectura.md` | peças, domínios, API, checkout alojado, MCP, multi-inquilino |
| `docs/03-regulamentar-ue.md` | mapa regulamentar com datas e fontes (W/M/C) |
| `docs/04-licoes-do-ecossistema-hnh.md` | ~40 regras pagas pelo Hub, loja e Academy, cada uma com o caso e o ficheiro de origem |
| `docs/05-fases-e-mvp.md` | fases 0–4 e critérios de passagem |
| `docs/06-decisoes-em-aberto.md` | 3 decididas, 14 por decidir (D-1 a D-14) |
| `docs/adr/0000-modelo.md`, `0001-…` | modelo de ADR; ADR-0001 «sem código até plano decidido» |
| `CLAUDE.md`, `README.md` | regras das sessões e porta de entrada |
| `.claude/skills/*` | as 12 skills, escritas de raiz com as lições do ecossistema |

## Onde fui buscar o que está escrito

- **Memória do ecossistema** — repo `bruno-88/claude`, anexado nesta sessão;
  lidos por inteiro: `desenho-ecossistema-bruno`, `feedback-uma-coisa-de-cada-vez`,
  `plano-sessoes-ago2026`, `user-bruno`, `regra-isencao-iva-bruno`,
  `regra-decisao-no-servidor`, `regras-identidade-duplicados`,
  `identidade-comprou-para-outra-pessoa-12ago2026`, `oss-iva-por-pais-10ago2026`,
  `nif-guarda-se-como-a-lei-manda-16set2026`, `nif-com-codigo-executado-16set2026`,
  `canarias-ceuta-melilla-extra-ue-28set2026`, `excepcoes-de-isencao-e-anexos-28set2026`,
  `contribuinte-recusado-retem-17set2026`, `hub-nif-sai-da-entidade-moloni-12ago2026`,
  `cila-renovacoes-stripe-07ago2026`, `projetos-plataformas-31ago2026`,
  `proposta-venda-do-hub-30set2026`, `regras-nos-repos-vs-memoria`,
  `ai-act-compliance`, `project-loja-lovable`; lidos em parte: `agentes-e-skills-no-repo-21set2026`,
  `academy-pagamento-directo-mapa-29set2026`, `academy-piloto-eupago-desenho-29set2026`,
  `commerce-agents-anthropic-13set2026`, `consentimento-de-marketing-no-hub-29set2026`,
  `loja-vendeu-stock-ja-reservado-16set2026`, `devolucoes-nao-tem-fluxo-15set2026`,
  `regra-da-nc-e-da-carteira-28set2026`, `shopify-arquivar-variante-derrubava-produto-28ago2026`,
  `activar-na-loja-26set2026`, `produtos-a-zero-euros-no-shopify-09set2026`,
  `estado-do-artigo-na-loja-13set2026`, `traducoes-dos-produtos-no-hub-18set2026`,
  `lingua-do-hub-para-parceiros-02out2026`. Os outros números citados foram
  conferidos por `grep` no ficheiro de origem (ex.: 150,43 € em
  `portes-a-dobrar-16set2026.md`).
- **Código** — `hub-hit-nails` (`CLAUDE.md`, `.claude/`) e `hitnails`
  (`README.md`, `src/data/policiesContent.ts`, `supabase/functions/submit-withdrawal-request`,
  `supabase/functions/shopify-duplicator-sync`), lidos a 03/10/2026.
- **Web** — ~20 pesquisas a 03/10/2026; as fontes estão nas linhas **W** de
  `docs/03-regulamentar-ue.md`. **Li os resumos e os títulos, não os textos
  legais.**

## O que NÃO foi verificado

- Nenhum texto legal lido por inteiro.
- Nenhum número da HNH medido de novo nesta sessão.
- Nenhuma base de dados consultada (nem do Hub, nem do Academy, nem do Shopify).
- Prazos e custos: não estimados, de propósito (D-13).
- A marca e os domínios «Lumavo» (D-12).
- Licenças e capacidades da Medusa, Saleor e Vendure — só resumos de pesquisa.
- Se o formulário de livre resolução da loja cumpre o art. 11.º-A e se o pedido
  chega ao Hub (procurei `withdrawal` e «livre resolução» em `hub-hit-nails/src`
  e `supabase/functions`: zero ficheiros — o que **não** prova que não chega por
  outra via).

## Tensões que deixei escritas, em vez de as resolver sozinho

- **Memória no repo de código.** No ecossistema a regra é «nunca memória num
  repo de código; a memória vive no repo `claude`». O Diogo pediu explicitamente
  para guardar tudo aqui; o Lumavo ainda não tem código e é um produto à parte.
  Ficou na pasta `memoria/`, separada, e a ponte para o repo `claude` é a D-11.
- **Ramo e `main`.** A sessão veio com o ramo designado
  `hnferramentas/gallant-wozniak-ri7s3z`; a regra do ecossistema manda as
  memórias para o `main`. O repositório estava **vazio** (sem ramos no remoto, a
  03/10/2026).

## Achados fora do Lumavo (não tratados aqui)

1. **A loja HNH ainda liga à plataforma europeia ODR**, encerrada a 20/07/2025:
   `hitnails/src/data/policiesContent.ts:558`. Ligação a retirar (zona jurídica).
2. **O Academy serve «5 marcas»** segundo o `CLAUDE.md` do Hub e **«6 marcas»**
   segundo `nif-guarda-se-como-a-lei-manda-16set2026.md` («Pink incluído»).
   Pode ser só a forma de contar o Pink, ou um dos dois estar desactualizado.
   Não verifiquei; por isso os documentos do Lumavo não dão o número.
