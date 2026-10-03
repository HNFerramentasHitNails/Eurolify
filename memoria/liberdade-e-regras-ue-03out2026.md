# O Diogo e o Bruno decidem tudo neste repositório, e as regras da UE para o Claude (03/10/2026)

**Ordem do Diogo (03/10/2026):** *«neste projeto, não é só o bruno que trata de
facturação. EU e o Bruno, temos toda a liberdade dentro deste repositorio. Cria
só algumas regras, como o claude seguir as skills ja criadas, para seguir
totalmente as regras da UE e nunca inventar nada fora da UE»*.

## O que se fez

- **Quem decide** (`CLAUDE.md`, `docs/06`): passa a ser **o Diogo ou o Bruno,
  cada um sozinho, em tudo** — negócio, faturação, NIF, IVA, identidade de
  clientes, Moloni, aspecto, marca e o OK para código. Decisão J em `docs/06`.
- Tirado o «quem decide: Bruno» de onde estava: D-4, D-10, D-11 e D-12 em
  `docs/06`, a skill `eu-vat-oss-ioss` e as regras de aspecto da skill
  `lumavo-design` (o aspecto vai ao Diogo ou ao Bruno com o antes e o depois).
- Ficaram as referências ao Bruno que dizem **de onde veio** uma regra (ex.: «a
  ordem do IVA, regra do Bruno, 13/08/2026») — são a fonte, não quem decide.
- **A Cila** saiu da tabela de quem decide; as propostas de negócio e de marca
  continuam a ser apresentadas a Bruno e Cila. Se a Cila também decide, ainda
  não foi dito.
- **Quatro regras novas** no `CLAUDE.md` («Regras da UE — seguir as skills,
  nunca inventar»): abrir e seguir a skill de cada tema; só regras da UE e dos
  Estados-membros, com fonte W/M/C, nada importado de fora da UE; nunca
  inventar («não verifiquei» e marca C); os dados ficam na UE (um serviço de
  fora da UE com dados pessoais só com decisão escrita e acordo de
  transferência).
- Na mesma conversa: **decisão I** (ADR-0005) — publica-se pelo GitHub e o
  Claude tem o MCP da Scaleway só de leitura.

## O que ficou por verificar

- A regra 4 (dados na UE) apanha a Stripe, recomendada na D-5: a Stripe é uma
  empresa norte-americana; a entidade que serve a UE e o acordo de
  transferência não foram vistos. Fica para quando a D-5 for decidida.
