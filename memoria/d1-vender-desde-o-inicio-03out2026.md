# D-1 decidida: o Lumavo vende-se desde o início (03/10/2026)

**Resposta do Diogo (03/10/2026)**, na página da D-1 da apresentação: *«a)
Vender a outros desde o início»*. A recomendação escrita era a b) (provar com
um cliente zero e abrir na Fase 3); a discordância ficou dita na resposta e no
ADR-0006.

## O que se fez

- ADR-0006; decisão **M** em `docs/06`; D-13 passa a ser a próxima tarefa;
  D-14 (modelo de receita) passa a ser preciso **antes da Fase 1**.
  ⚠️ Mudado mais tarde a 03/10/2026 (ADR-0012, decisão S): a base sim; os
  preços só antes da peça 13 da Fase 1.
- `docs/05` reorganizado: a Fase 1 passa a «Núcleo e os primeiros
  comerciantes (vende-se desde o início)» e recebe da Fase 3 o registo de
  comerciantes, os contratos e o acordo de tratamento de dados, a faturação do
  Lumavo, o suporte e a exportação completa; recebe da Fase 2 a emissão por
  Moloni em Portugal. A Fase 3 passa a «Extensões abertas e comércio por
  agentes». O critério da Fase 2 («um 2.º comerciante») foi trocado por uma
  proposta: comerciantes de pelo menos dois países a vender há 3 meses.
- Antes do primeiro comerciante de fora: IVA validado pelo contabilista, fluxos
  do consumidor por jurista, contrato com limites e seguro, D-14.
- `docs/00` (recomendação, estado, §5, fases, riscos) e `docs/02` acertados.
- **Correcção a um erro meu:** a Fase 1 de `docs/05` ainda dizia «fica de
  fora: outros países», contra a decisão F (nativo para toda a UE) — escapou ao
  varrimento dessa decisão. Corrigido aqui.

## 04/10/2026 — três peças da Fase 2 passam para a Fase 1 (decisão AD, ADR-0022)

Pedido do Diogo: *«sim, passa as três para a Fase 1»*, depois de os módulos da
Fase 2 passarem pelas 8 portas (`docs/13-portas-da-fase-2.md`).

- Passam: o **relatório OSS com os quatro baldes** (em todos os planos), o
  fluxo **devolução → estado do artigo → reembolso → nota de crédito** e os
  **lotes na linha expedida com os compostos**. Ficam na Fase 2: troca,
  carteira, vários armazéns, separação, inventários e as ligações ao software
  de faturação de comerciantes de outros países.
- Varrimento (procura por «relatório OSS», «quatro baldes», «devoluções
  completas», «devoluções ligadas», «vários armazéns», «armazém completo»,
  «compostos», «carteira» nos `docs/`, README, skills e `AGENTS.md`; e por
  «15 a 29», «92–155», «101–192», «52–90», «60–117», «9 a 18» em todo o
  repositório): acertados `docs/05` (âmbito da Fase 1, o que fica de fora,
  critério de passagem, Fase 2), `docs/06` (linha AD e a linha O), `docs/09`
  (planos), `docs/10` (peças 18 a 20 «por estimar» e as somas marcadas «sem
  elas»), `docs/13` e README.
- **Não mexi:** no ADR-0008 (aceite, não se edita — o ADR-0022 diz que os
  números dele são sem estas peças); nas skills, porque nenhuma punha estas
  três peças numa fase (a `order-fulfilment` só diz «vários armazéns (Fase
  2)», que continua certo); na apresentação impressa para Bruno e Cila.

## O que ficou por verificar

- O seguro de responsabilidade civil para uma plataforma destas.
- O que o contrato de serviço pode limitar — com jurista.
- ~~Quanto custam as três peças da decisão AD e quanto tiram à Fase 2: não
  estimado.~~ Estimadas a 04/10/2026, a pedido do Diogo (`docs/10`, **C**):
  2–4, 4–7 e 3–5 pessoas-semana; a Fase 1 passa a 17–32 meses os dois a tempo
  inteiro, a Fase 2 a 7–15. Os cenários B e C também foram recalculados no
  mesmo dia: B 18–34 meses, ≈ 189.000–510.000 €; C 13–25 meses,
  ≈ 210.000–569.000 €.
