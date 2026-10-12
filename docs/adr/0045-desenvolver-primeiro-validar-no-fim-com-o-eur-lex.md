# ADR-0045 · Desenvolver primeiro; o contabilista, o jurista e o seguro no fim; o repositório `eur-lex` como fonte

- **Estado:** aceite
- **Data:** 12/10/2026
- **Quem decidiu:** Diogo (*«Quando terminarmos tudo, tratamos do contabilista
  do jurista e do seguro. o objetivo é focarnos no desenvolvimento conforme o
  plano. Para nos auxiliar, utilizamos sempre o repositorio Eur-lex que contem
  toda a informação de leis e outras coisa de portugal e união europeia!!»*).
  A letra é **EC** (`docs/06`): a EA está no pedido #386 e a EB já foi usada
- **Decisão em aberto de origem:** a medição provisória do ritmo
  (`docs/10` §6.1, #390), cuja recomendação era pedir já os orçamentos

## Contexto

- A 12/10/2026, depois de 8 dias de código, estavam feitos ≈ 31 % da Fase 1
  (`docs/10` §6.1, **C**). Os trabalhos de fora — contabilista, jurista e
  seguro — passaram a ser o caminho crítico para abrir a comerciantes de fora
  (`docs/05`, «Antes do primeiro comerciante de fora»).
- O repositório `HNFerramentasHitNails/eur-lex` tem o texto da legislação da UE
  em vigor (≈ 64 mil actos, a partir do Cellar), as leis portuguesas de
  transposição e o Código do IVA da AT, a jurisprudência dos actos curados e
  as orientações da Comissão e do CEPD. É actualizado às segundas-feiras
  (`eur-lex/CLAUDE.md`, lido a 12/10/2026).

## Opções consideradas

| Opção | A favor | Contra |
|---|---|---|
| Pedir já os orçamentos e as validações, em paralelo com o código (`docs/10` §7) | Encurta o caminho até ao primeiro comerciante de fora | Tira tempo ao desenvolvimento; as validações podem ter de se repetir se o desenho mudar |
| **Desenvolver primeiro, validar no fim, e verificar as regras no texto do `eur-lex` ao desenhar** | Foco no plano; as validações incidem sobre o produto acabado; as regras já chegam aos profissionais com o artigo citado | O primeiro comerciante de fora fica para depois das validações, cujo prazo não está estimado |

## Decisão

1. **O contabilista, o jurista e o seguro tratam-se quando o desenvolvimento da
   Fase 1 terminar.** Até lá, o trabalho é o desenvolvimento, pela ordem do
   plano (`docs/05`, `docs/10` §2).
2. **Usa-se sempre o repositório `eur-lex` como fonte das regras da UE e de
   Portugal**: antes de uma regra fiscal ou legal entrar num desenho, num
   teste ou em código, procura-se lá o acto e lê-se o artigo
   (`ferramentas/procurar.py`; a skill `consultar-legislacao` desse
   repositório).
3. **Os 3 meses de vendas reais do critério de passagem da Fase 1 contam só
   com a loja piloto do grupo** (Diogo, 12/10/2026, à pergunta deste ADR:
   *«só com a loja piloto do grupo»*). As outras condições do critério ficam:
   nenhum documento fiscal errado, pagamentos 100 % conciliados, isolamento
   sempre verde e uma livre resolução tratada até à nota de crédito.

## Consequências

- **Não muda o que tem de acontecer antes do primeiro comerciante de fora**
  (`docs/05`): o motor de IVA validado pelo contabilista, os fluxos do
  consumidor e o contrato pelo jurista, e o seguro. Muda só **quando** se
  tratam: no fim do desenvolvimento.
- **A regra 7 de «Não se erra em documentos fiscais» e a regra 3 de «Regras
  da UE» continuam:** uma regra **C** não chega a um ecrã sem verificação ou
  validação. O artigo lido no `eur-lex` é a verificação. O que precisa de
  profissional continua marcado e fica desligado para comerciantes de fora até
  à validação.
- **Uma linha lida no `eur-lex` cita** o ficheiro, o acto, o artigo, a versão
  (`versao_aplicavel_desde` e se é o original do JO ou a versão consolidada) e
  o `obtido_em` (`docs/03`, nota sob a tabela das marcas).
- **A previsão** (`docs/10` §6.1): o código da Fase 1 continua previsto entre
  dezembro de 2026 e fevereiro de 2027. O primeiro comerciante de fora passa a
  vir **depois** das validações, cujo prazo não está estimado.
- **A Fase 1 pode passar antes de entrar o primeiro comerciante de fora**
  (ponto 3): a previsão de junho a setembro de 2027 (`docs/10` §6.1) não
  depende do prazo das validações.
- **A recomendação do `docs/10` §7** (pedir já os orçamentos) fica como
  registo e não se segue.

## O que ficou por verificar

- Quanto demoram as validações do contabilista e do jurista e a contratação do
  seguro: sem orçamento nem prazo.
- O critério de passagem com só a loja piloto não prova o Eurolify com
  comerciantes de fora (outros catálogos, outros sistemas de gestão, outros
  países); isso fica para depois das validações, já na Fase 2 ou em paralelo.
