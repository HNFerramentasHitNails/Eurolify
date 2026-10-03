# Extensões de terceiros no Lumavo — o desenho (03/10/2026)

**Pedido do Diogo (03/10/2026):** *«é importante que haja a possibilidade de
developers de terceiros, desenvolverem os seus próprios plugins, módulos, meios
de pagamente, envios, regras, dentro do lumavo de forma fácil»*.

## O que se fez

- ✅ **Decidido pelo Diogo a 03/10/2026:** as regras fiscais e legais ficam
  fora do que terceiros podem mudar (*«sim, concordo»*, decisão K) e, na
  Fase 2, os parceiros da lista de pagamentos e envios são convidados a
  escrever eles próprios a sua ligação (decisão L).

- Desenho em `docs/08-extensoes-de-terceiros.md`; requisito **K** em `docs/06`;
  skill nova `third-party-extensions`; ligações em `docs/02` (domínio
  Extensões), `docs/05` (Fases 0 a 3), `README.md` e tabela de skills do
  `CLAUDE.md`.
- **Ideia central:** o Lumavo escreve os seus adaptadores (EuPago, Mollie, CTT,
  Moloni…) com os mesmos contratos que os terceiros vão usar.
- **Sete tipos:** aplicação, meio de pagamento, envio, faturação, função (regra
  de negócio em caixa fechada), extensão de ecrã, campos e objectos próprios.
- **Discordância escrita:** terceiros escrevem regras de negócio (descontos,
  portes, validações, armazém, ordem dos métodos), **não regras fiscais e
  legais** — com o caso da regra do IVA escrita duas vezes (13/08/2026).
- **Fase 2 (decidido, L):** os parceiros da lista de pagamentos e envios
  (`docs/07`) escrevem o seu adaptador como primeiros convidados.

## Fontes (pesquisa web, 03/10/2026)

- DSA: lojas de aplicações são plataformas online (App Store e Google Play
  designadas muito grandes) — resumos de Clifford Chance e PwC.
- Lei da Ciber-resiliência, Reg. (UE) 2024/2847: notificações desde
  11/09/2026, aplicação plena a 11/12/2027; SaaS em geral fora — resumos de
  Kirkland e EUR-Lex.
- Registo da EBA de instituições de pagamento e de moeda electrónica (desde
  2019) — comunicado da EBA.

## O que ficou por verificar

- Se a Lei da Ciber-resiliência apanha a linha de comandos, as bibliotecas e
  as extensões.
- Que obrigações do DSA se aplicam a uma loja de extensões pequena.
- WebAssembly como caixa fechada é conhecimento prévio; escolha técnica só com
  OK para código.
- Receita da loja de extensões (D-14).
