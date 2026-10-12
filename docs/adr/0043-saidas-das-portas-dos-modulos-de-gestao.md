# ADR-0043 · As saídas das 8 portas dos módulos de gestão, e duas peças para a Fase 1

- **Estado:** aceite · a saída do balcão foi substituída pelo ADR-0044 (DV, 11/10/2026)
- **Data:** 11/10/2026
- **Quem decidiu:** Diogo (*«sim, aprovo as saídas todas»*)
- **Decisão em aberto de origem:** as saídas do `docs/13-portas-da-fase-2.md`
  §7 a §19 (issue #355); completa o ADR-0042 (decisão DR)

## Contexto

O ADR-0042 pôs a gestão da empresa inteira no produto, em módulos ligáveis a
partir da Fase 2, cada um pelas 8 portas da skill `platform-architect` antes
de ser desenhado. A 11/10/2026 passaram as treze avaliações do `docs/13`: o
balcão (§7), compras e fornecedores (§8), apoio ao cliente (§9), tarefas sobre
um registo (§10), painéis (§11), comercial (§12), financeiro (§13),
organização (§14), fabrico (§15), formação (§16), marketing e gráfica (§17),
pessoas (§18) e parceiros (§19).

Nenhum comerciante de fora foi ouvido: as portas 3 e 4 deram «não se sabe» em
todos (`docs/13`, «O que vale para todos»). O guião das conversas está no
`docs/32`.

## Opções consideradas

| Opção | A favor | Contra |
|---|---|---|
| **Aprovar as saídas todas** | Cada módulo fica com o primeiro alvo estreito, ou sai; duas peças que a Fase 1 já precisa entram nela | A Fase 1 cresce com duas peças por estimar |
| Aprovar só as que não mudam de fase | A Fase 1 não cresce | As filas que pedem uma pessoa continuam sem dono, e o painel e o MCP de leitura contariam as vendas em sítios diferentes |
| Esperar pelas conversas | Mais prova | As saídas que matam ou estreitam não dependem da procura |

## Decisão

**As saídas do `docs/13` §7 a §19 ficam aprovadas, tal como estão escritas.**
Em resumo:

1. **Estreitar** (nove): o balcão (*substituída pelo ADR-0044: o balcão
   vende pelo POS do Hub e o Moloni só emite as faturas*), compras e fornecedores, apoio ao cliente,
   painéis, comercial, financeiro, fabrico, formação (pela porta da fatia 12) e
   parceiros — cada um com o primeiro alvo da sua secção, e o resto fora ou a
   investigar.
2. **Estreitar e avançar com o núcleo** (um): as tarefas sobre um registo.
3. **Matar como módulo próprio** (três): a organização (camada E), o marketing
   e gráfica e as pessoas (camada G). As peças que se aproveitam mudam de
   sítio:
   - os **lançamentos agendados** e os **feeds do catálogo publicado** vão para
     o Catálogo; as **avaliações de quem comprou** também, com a regra da
     `consumer-rights-eu`;
   - o **assistente interno** é o MCP de leitura da Fase 1, ligado ao
     assistente do comerciante;
   - programas de fora (projectos, redes sociais, RH) ligam-se, se houver
     procura, por extensão de terceiros (`docs/08`), com os dados na UE;
   - **nenhuma biometria** no Eurolify sem o jurista e uma avaliação de
     impacto, nem por extensão.
4. **Duas peças passam para a Fase 1**, como na decisão AD (ADR-0022):
   - **as tarefas das filas que pedem uma pessoa** (`docs/13` §10): dono,
     prazo, estado e aviso ao vencer nas filas que a Fase 1 já cria
     (diferenças dos pagamentos; documentos retidos, incertos e divergentes;
     candidatos a duplicado; prazo do reembolso); sem tarefas livres;
   - **a consulta das vendas do dia e do mês** (`docs/13` §11): encomendado,
     pago, faturado e devolvido, com e sem IVA, por canal e mercado, cada
     número com o que conta; uma consulta para o MCP de leitura e, na Fase 2,
     para o ecrã do painel.

Não é uma decisão de desenho: cada primeiro alvo tem o modelo e a lista da API
em tabela antes do código (ADR-0023), e construir cada um continua a ser
decisão do Diogo ou do Bruno.

## Consequências

- **A Fase 1 cresce com duas peças por estimar.** Entram no `docs/10` como
  peças 21 e 22, «por estimar»; a soma e o prazo da Fase 1 não mudam até se
  estimarem.
  *Actualização de 11/10/2026, a pedido do Diogo (*«estima as duas peças novas
  da Fase 1»*):* estimadas no `docs/10` (**C**) — tarefas das filas 2–4,
  consulta das vendas 1–2 pessoas-semana. A Fase 1 passa a 17 a 33 meses os
  dois a tempo inteiro (31 a 60 a meio tempo); o total até ao fim da Fase 3
  fica em ≈ 38 a 71 meses. Os cenários B e C não foram recalculados.
  *Actualização de 11/10/2026 (decisão DW; Diogo: *«sim, aprovo o desenho
  com as sete filas»*):* o desenho da peça 21 (`docs/33`) junta às quatro
  filas do ponto 4 mais três que a Fase 1 já cria (pedido de livre
  resolução pendente ou fora de prazo, problema aberto, reembolso incerto ou
  falhado). A peça passa a 2,5–5 pessoas-semana; a Fase 1 a 18 a 33 meses
  (32 a 60 a meio tempo); até ao fim da Fase 3, ≈ 39 a 71 meses.
- O `docs/05` (Fase 1 e Fase 2), o `docs/00` («Em uma página» e §2.2), o
  `docs/13`, o `docs/14` (Catálogo, «fica para depois»), o `docs/31` e a
  memória passam a dizê-lo.
- As portas 3 e 4 continuam por responder em todos os módulos: as conversas
  do `docs/32` podem reabrir uma saída.
- Pode partir: quem leia o ADR-0042 sozinho julga que as camadas E e G e o
  marketing entram como módulos. O ADR-0042 passa a dizer «completado pelo
  ADR-0043».

## O que ficou por verificar

- Nenhuma das regras legais e fiscais dos módulos foi verificada outra vez
  (marcadas **W** ou **C** em cada secção do `docs/13`).
- As duas peças da Fase 1 não estão estimadas.
- A procura de cada módulo (portas 3 e 4).
