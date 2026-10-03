# O repo `JoelLewis/finance_skills` — avaliado, não instalado (03/10/2026)

**Pedido do Diogo (03/10/2026):** *«podes verificar se esta skill acrescenta
alguma coisa https://github.com/JoelLewis/finance_skills»*

## O que se fez

- Clone de leitura (`--depth 1`) em `/home/user/joellewis/finance_skills` na
  sessão; último commit `5c498ea`, 18/07/2026; licença MIT.
- Lidos o `README.md`, o `CLAUDE.md` do repo e a estrutura das avaliações
  (`evals/`, `finance-skills-workspace/`). De 4 skills li secções, não o ficheiro
  todo: `fee-billing`, `reconciliation`, `integration-patterns` e
  `data-quality`. As outras 87, só pelo nome e pelo README.
- Comparado com a nossa `payments-psd2-sca` (secção «Conciliação») e com o
  `docs/09` (escalões).
- **Nada foi instalado nem copiado.**

## Números (contados a 03/10/2026 na cópia)

| O quê | Resultado | Como |
|---|---|---|
| Skills | **91** em 7 grupos: core 3, wealth-management 38, compliance 17, advisory-practice 12, trading-operations 9, client-operations 8, data-integration 4 | `find -name SKILL.md`; contagem igual à do `CLAUDE.md` deles |
| Ficheiros `.md` em `plugins/` que citam | FINRA 53 · SEC 50 · IRS 14 · «European» 4 · MiFID 3 · GDPR 0 · VAT 0 · PSD2 0 | `grep -rl` por termo |
| Avaliações deles | casos com a skill esperada e o que a resposta tem de dizer (`evals/evals.json`), testes de activação (`evals/trigger/`), um corrector sem «passa por omissão» (`grade_responses.py`), 3 iterações | leitura dos ficheiros |
| Avaliações das nossas 14 skills | **0** | procurei `*eval*` em `.agents/skills`: só 2 referências de terceiros, que não são avaliações |

## Leitura

- **O domínio é outro**: gestão de investimentos e regulação de valores
  mobiliários dos EUA (SEC, FINRA, ERISA, FinCEN). A regra 2 das regras da UE
  (`AGENTS.md`) não deixa importar nada disto. **Não se instala.**
- **O que pode servir, como método e nunca como regra:**
  1. **Conciliação** (`reconciliation`): qual sistema manda em cada dado;
     tolerância por tipo de diferença; diferenças classificadas pela causa (fora
     de tempo, em falta, duplicada, dados errados); gravidade com prazo e
     escalada. A nossa `payments-psd2-sca` tem 3 pontos de conciliação
     (referência igual à do prestador, ligação ao banco, meio de pagamento
     real). Acrescentar isto à skill pede o OK do Diogo ou do Bruno.
  2. **Faturação por escalões** (`fee-billing`), para os preços da D-14 e a
     peça 13: a diferença entre escalão marginal (cada parte paga a taxa do
     seu escalão) e escalão de patamar (tudo paga a taxa do escalão atingido).
     Com a tabela deles, 1,8 M$ dá **13.800 $** marginal e **10.800 $** de
     patamar (conta minha). Também a mudança de escalão a meio do período, o
     cobrar no início ou no fim, e a ordem dos ajustes (preço negociado, mínimo,
     máximo, isenções). O reconhecimento de receita (US GAAP) e as divulgações
     (ADV, Reg BI) são dos EUA: ficam de fora.
  3. **Avaliar as skills**: o método deles serviria para fazer o teste que
     falta no ADR-0010 (o Codex lê as 14 skills?) e para saber se as nossas
     skills se activam no pedido certo.
  4. **Extracto bancário ISO 20022 (`camt.053`)**, citado em
     `integration-patterns`, para ligar as liquidações dos prestadores ao
     banco. Se os bancos dos comerciantes o entregam: **não verifiquei (C)**.

## O que ficou por verificar

- 87 das 91 skills só pelo nome; as 4 lidas, só em parte.
- As avaliações deles não foram corridas.
- Não comparei com a `skill-creator` da Anthropic, que também faz avaliações e
  está disponível nas sessões.
- Se os bancos portugueses e europeus entregam `camt.053` aos comerciantes.
