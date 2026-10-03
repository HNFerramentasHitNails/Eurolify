# Estimativa de prazo e custo da Fase 1 (D-13)

> **Versão de 03/10/2026 — estimativa para decidir, não orçamento.** Pedido do
> Diogo: *«faz a estimativa de prazo e custo»*. Com D-1, D-2 e D-3 decididas
> (ADR-0006, ADR-0002, ADR-0003/0004), a D-13 era a próxima tarefa da Fase 0.
>
> Marcas de certeza como em `03-regulamentar-ue.md`: **W** pesquisa web a
> 03/10/2026; **M** medido nos sistemas actuais; **C** julgamento meu, não
> verificado. **O esforço de cada peça é C**: não há medição de quanto um
> programador com Claude Code demora a construir isto com o rigor de um produto
> vendido. Por isso tudo vem em intervalos, e a §6 diz como se corrige o
> intervalo às 8 semanas.

> ✅ **Decidido a 03/10/2026 pelo Diogo: cenário A** — *«será eu e o Bruno a
> desenvolver com o Claude Code e Codex»* ([ADR-0008](adr/0008-construcao-pelo-diogo-e-pelo-bruno.md)).
> A recomendação era a B. Os cenários B e C ficam como registo. O tempo do A,
> por fases, está no §9 (pedido do Diogo, 03/10/2026) e corrige-se às 8
> semanas (§6).

## 1. A resposta curta

| Cenário | Prazo de construção da Fase 1 | Custo da construção | Custo fixo por mês depois de abrir |
|---|---|---|---|
| **A** ✅ — só o Diogo e o Bruno, com Claude Code e Codex (decidido, ADR-0008) | Fase 1: **15 a 29 meses** os dois a tempo inteiro, **28 a 52** a meio tempo (§9, com hipótese C) | ≈ 14.000–33.000 € em serviços externos + o que falta orçamentar | o tempo de duas pessoas que também gerem a empresa |
| **B** — 2 programadores sénior contratados + Diogo e Bruno no produto | **16 a 30 meses** | **≈ 173.000–465.000 €** | ≈ 10.150–14.840 € |
| **C** — 3 programadores sénior contratados + Diogo e Bruno no produto | **12 a 23 meses** | **≈ 193.000–519.000 €** | ≈ 15.110–21.920 € |

**Não estão nos números** (e não os invento): contabilista, jurista e seguro
(orçamentos a pedir), recrutamento, o tempo do Diogo e do Bruno, quem atende os
comerciantes depois de abrir. Antes da construção há a contratação (§4); depois
dela, os **3 meses de vendas reais** do critério de passagem da Fase 1.

**Entre B e C o trabalho é o mesmo**: muda sobretudo o prazo e o dinheiro que
sai por mês. C acaba 4 a 8 meses mais cedo e custa ≈ 20.000–54.000 € mais,
porque três pessoas a trabalhar em paralelo perdem mais tempo a coordenar-se
do que duas.

## 2. O que se está a estimar

O âmbito da Fase 1 em `05-fases-e-mvp.md`, com os acréscimos de vender desde o
início (ADR-0006). Em pessoas-semana de um programador sénior a trabalhar com
Claude Code (**C**, todas as linhas):

| # | Peça | Pessoas-semana |
|---|---|---|
| 1 | Desenho final: modelo de domínio, lista da API, contratos de extensão | 4–8 |
| 2 | Fundações: inquilinos isolados pela base, contas e permissões, auditoria, eventos e avisos idempotentes, versões da API, publicação GitHub → Scaleway, cópias e alarmes | 8–14 |
| 3 | Catálogo: variantes, kits, traduções, campos regulamentares, espelho do sistema do comerciante | 5–9 |
| 4 | IVA dos 27 e OSS, NIF e VIES com prova, territórios especiais, preços B2B, mínimos, histórico de 30 dias | 8–14 |
| 5 | Carrinho e checkout alojado: perfis de faturação, fatura para outra pessoa, momentos legais | 8–12 |
| 6 | Pagamentos: dois prestadores, máquina de estados, avisos, conciliação | 6–10 |
| 7 | Encomendas e stock (um armazém, reservas, disponível por canal) | 5–8 |
| 8 | Faturação: entrega ao sistema do comerciante, adaptador Moloni, retenção e fila | 5–8 |
| 9 | Envios: CTT e um agregador | 4–6 |
| 10 | Livre resolução, área de cliente, confirmação com prova, notificações PT/ES/EN | 4–7 |
| 11 | RGPD essencial | 3–5 |
| 12 | API da Loja e de Administração, webhooks, SDK, MCP de leitura, documentação | 8–12 |
| 13 | Abertura a comerciantes: registo, contrato aceite, faturação do Eurolify por escalões, suporte, exportação (Data Act) | 6–10 |
| 14 | Hub mínimo: definições, encomendas, integrações, webhooks, auditoria | 6–10 |
| 15 | Desenho de ecrãs (checkout, Hub, registo) e acessibilidade | 4–8 |
| 16 | Testes, isolamento entre inquilinos, carga, correcções do teste de intrusão e da auditoria de acessibilidade | 6–10 |
| 17 | Loja piloto do grupo sobre a API | 2–4 |
| | **Soma** | **92–155** |
| | **Com imprevistos e coordenação** (+15 % no mínimo, +30 % no máximo) | **≈ 106–202** |

**Como se passa a meses** (**C**): 44 semanas produtivas por pessoa e por ano
(férias, feriados e doença); duas pessoas rendem 90 % de duas, três rendem
80 % de três.

## 3. Quanto custa uma pessoa

| Dado | Valor | Verif. |
|---|---|---|
| Salário de um programador sénior em empresa portuguesa, 2026 | **45.000–65.000 € brutos por ano** | **W**, resumos de guias de 2026 ([olamundo.pt](https://olamundo.pt/blog/salrios-trabalho-remoto-portugal-2026-guia-programadores), [eurotoptech](https://www.eurotoptech.com/blog/software-engineer-salary-portugal-2026)); o guia original não foi lido |
| Um arquitecto de software com mais de 5 anos, Lisboa | **até 110.000 €** (máximo) | **W**, Guia Hays 2026, via [HR Portugal](https://hrportugal.sapo.pt/sao-estes-os-perfis-tecnologicos-com-maior-potencial-salarial-em-portugal-comeca-nos-80-mil-ano-e-chega-aos-260-mil/) |
| TSU paga pela empresa | **23,75 %** | **W** ([Santander](https://www.santander.pt/salto/taxa-social-unica), [CGD](https://www.cgd.pt/Site/Saldo-Positivo/trabalho/Pages/descontos-seguranca-social.aspx)) |
| Fundos de compensação (FCT/FGCT) | FCT acabou a 01/01/2024; FGCT suspenso até ao fim de 2026 | **W**, resumo ([Doutor Finanças](https://www.doutorfinancas.pt/empresas/como-funciona-o-fundo-de-compensacao-do-trabalho/)) |
| Seguro de acidentes de trabalho e subsídio de refeição | conto **+3 %** sobre o bruto | **C** |
| **Custo para a empresa** | **×1,27 ⇒ 57.150–82.550 € por ano**, ≈ 4.760–6.880 € por mês | conta |
| Claude Max 20x | **US$ 200 por mês** por pessoa | **W** ([suporte Anthropic](https://support.claude.com/en/articles/11049741-what-is-the-max-plan)) |

Assumo que os 45.000–65.000 € já incluem os 14 meses (**C**). Se o primeiro
contratado for o líder técnico (o que eu recomendo, §7), pode custar mais do
que o topo deste intervalo.

## 4. Os cenários, por extenso

| | B — 2 sénior | C — 3 sénior |
|---|---|---|
| Construção | 16,0 a 30,5 meses | 12,0 a 22,9 meses |
| Pessoas | 152.700–420.000 € | 171.800–472.600 € |
| Claude (US$ 200 × pessoas × meses, contado 1 US$ = 1 € por cima) | 6.400–12.200 | 7.200–13.700 |
| Serviços externos com preço (§5) | 14.000–33.000 | 14.000–33.000 |
| **Total com preço** | **≈ 173.000–465.000 €** | **≈ 193.000–519.000 €** |
| Sai por mês, em pessoas | 9.500–13.800 € | 14.300–20.600 € |

**Antes de começar:** contratar leva tempo — **1 a 3 meses** para um sénior
(**C**, não verifiquei). **Exemplo:** se o OK para código (ADR-0001) for dado a
01/01/2027 e as contratações fecharem a 01/03/2027, a construção no cenário C
acaba entre **março de 2028 e janeiro de 2029**, e a Fase 1 só passa 3 meses
depois de o primeiro comerciante vender.

**O mínimo e o máximo não acontecem juntos por acaso:** o mínimo exige salários
no fundo da tabela **e** tudo a correr bem. A §6 diz como se sabe cedo de que
lado se está.

## 5. O que não sai do bolso da equipa

| Serviço | Valor | Verif. |
|---|---|---|
| Teste de intrusão de uma plataforma multi-inquilino | **5.950–8.500 €** cada (7 a 10 dias a 849 €/dia); conto um ou dois ⇒ 5.950–17.000 € | **W**, [Budget Security](https://budgetsecurity.com/blog/web-application-penetration-testing-cost/), 20/07/2026 |
| Auditoria de acessibilidade (a Lei Europeia da Acessibilidade obriga as lojas online desde 28/06/2025) | **5.000–10.000 €** para um sítio pequeno, manual | **W**, resumo de pesquisa — fonte fraca, preços sobretudo britânicos e americanos |
| Marca da UE na EUIPO, 3 classes | **1.050 €** (850 € a 1.ª, 50 € a 2.ª, 150 € a 3.ª) | **W**, resumos ([ds.solutions](https://ds.solutions/en/eu-trademark-cost/)); a página da EUIPO deu 403. As classes (9, 35, 42) são escolha minha, **C** |
| Alojamento durante a construção (ensaio e, nos últimos meses, produção ≈ 225 €/mês) | **2.000–5.000 €** | **C**, a partir de `memoria/alojamento-e-custos-03out2026.md` |
| Contabilista: validar o motor de IVA antes do primeiro comerciante de fora | **orçamento a pedir** | — |
| Jurista: checkout e livre resolução, contrato com limites, acordo de tratamento de dados, Data Act, margem sobre pagamentos | **orçamento a pedir** | — |
| Seguro de responsabilidade civil profissional e ciber | **orçamento a pedir** — há produtos de entrada desde 404 €/ano, mas com capitais que não servem a uma plataforma que trata faturas de outras empresas | **W** ([Santander](https://www.santander.pt/empresas/seguros/seguro-protecao-empresas-cyber)) |

**Cenário A — porque não lhe dava prazo** (a pedido do Diogo, ficou estimado no §9, com a hipótese escrita). O Hub interno mostra o que o Bruno e,
desde julho de 2026, também o Diogo constroem com o agente do Lovable e o
Claude Code (**M**, contado a 03/10/2026 no `main` do Hub): primeira migração a
18/11/2025, **1.643 migrações, 229 funções no servidor e ≈ 568 mil linhas** de
código (sem o ficheiro de tipos gerado). É muito, depressa. Mas foi construído
para uma empresa só e corrigido em produção, e as lições custaram faturas
reais: 277 faturas em 90 dias por uma rede temporária, 77 funções abertas a
quem não tinha sessão (`docs/04`). O Eurolify é vendido a outras empresas, com
contrato e responsabilidade: precisa de alguém que reveja cada mudança, de
testes de isolamento e de segurança que o Hub não tem. Não tenho medida de
quanto isso atrasa duas pessoas que gerem também a empresa — por isso o
prazo do §9 assenta numa hipótese escrita e corrige-se às 8 semanas.

**Discordo** de fazer a Fase 1 só no cenário A, pelo motivo acima. Fica
dito uma vez; a decisão é do Diogo ou do Bruno.

## 6. Como se corrige a estimativa às 8 semanas

Uma estimativa sem medida é um palpite. Por isso:

1. As peças 1 e 2 (desenho final e fundações) fazem-se primeiro, com o esforço
   planeado escrito antes de começar.
2. **Às 8 semanas** compara-se o esforço planeado com o gasto nas partes
   acabadas. Exemplo: se 12 pessoas-semana planeadas levaram 18, o factor é
   1,5 e o resto da estimativa multiplica-se por ele.
3. Com o factor medido, decide-se se entra a terceira pessoa (B → C) e
   corrige-se esta página **onde os números estão escritos**.

## 7. Recomendação — opinião (não seguida: decidido o A, ADR-0008)

- **Cenário B com o primeiro contratado como líder técnico** (base de dados,
  isolamento entre inquilinos, segurança): é quem revê cada mudança, incluindo
  as que o Diogo e o Bruno fizerem com Claude Code.
- **Às 8 semanas, medir (§6) e decidir a terceira pessoa.**
- O Diogo e o Bruno ficam com o produto: decisões, conversas com comerciantes,
  contabilista e jurista, loja piloto.
- Pedir já os orçamentos do contabilista, do jurista e do seguro: são os
  números que faltam, e o contabilista e o jurista estão no caminho crítico
  antes do primeiro comerciante de fora.

## 8. Depois de abrir — ligação à D-14

O custo fixo por mês depois de abrir (pessoas + alojamento ≈ 225–680 € +
Claude) é ≈ **10.150–14.840 €** no cenário B e ≈ **15.110–21.920 €** no C, sem
contabilista, jurista, seguro nem quem atende os comerciantes.

**No cenário A (decidido):** sem salários de programadores, o que sai em
dinheiro por mês é o alojamento e as subscrições — ≈ 225–680 € + US$ 440–800
(2 × Claude Max US$ 200 + 2 × Codex entre o Plus de US$ 20 e o Pro de US$ 200,
**W**, páginas oficiais). **O tempo do Diogo e do Bruno não está contado, e é
o custo real**: sem lhe pôr um valor, o ponto de equilíbrio do cenário A não
se calcula.

**Exemplo de conta (hipótese, não é preço):** se cada comerciante deixar, em
média, 100 € por mês depois dos custos dele, são precisos ≈ **100–150
comerciantes** no cenário B (≈ 150–220 no C) só para pagar isto. Os preços
decidem-se na D-14, depois das conversas com 3 a 5 comerciantes
(`09-modelo-de-receita.md`).

**Incentivos:** o SIFIDE II dá crédito fiscal de 32,5 % das despesas de I&D
(mais 50 % do aumento face à média dos dois anos anteriores), e o
desenvolvimento de software novo é elegível — **mas o regime vigora até
31/12/2026** (**W**, resumo; [ANI](https://ani.pt/sifide-sistema-de-incentivos-fiscais-a-ied-empresarial/)).
Se for renovado, pode reduzir o custo da construção; elegibilidade a confirmar
com o contabilista. Não entra nos números acima.

## 9. O tempo do Diogo e do Bruno, por fases (cenário A)

Pedido do Diogo, 03/10/2026: *«coloca só o tempo que eu e o Bruno [levamos]
usando a IA como o Claude Code e Codex, por fases»*.

**Hipóteses (todas C — é aqui que a estimativa pode falhar):**

1. **Cada um rende como um programador sénior com IA.** É a hipótese do meio:
   vocês conhecem as regras fiscais e os casos melhor do que qualquer
   contratado (o Hub interno prova-o, e prova o volume que fazem com IA); mas
   ninguém com ofício de engenharia revê o que entra. Se renderem menos, o
   tempo cresce na mesma proporção; se renderem mais, encurta.
2. **Duas dedicações possíveis:** os dois a tempo inteiro (duas pessoas rendem
   90 % de duas) ou cada um a meio tempo (uma pessoa no total), porque os dois
   também cuidam dos sistemas actuais da empresa.
3. 44 semanas produtivas por pessoa e por ano; o esforço de cada fase com
   imprevistos (+15 % a +30 %).

**O tempo, em meses:**

| Fase | O que é | Esforço (pessoas-semana) | Os dois a tempo inteiro | Cada um a meio tempo |
|---|---|---|---|---|
| **0** (o que falta) | Desenho final (domínio, API, contratos), conversas com 3 a 5 comerciantes, preços (D-14), OK para código. Desde 03/10/2026 os preços só travam a peça 13 (ADR-0012); estes números não foram recalculados | 5–10 | **1 a 3** | **1,5 a 3** |
| **1** | Núcleo à venda (§2, sem a peça 1) | 101–192 | **15 a 29** | **28 a 52** |
| | Critério de passagem: 3 meses de vendas reais sem documento fiscal errado | — | **+3** | **+3** |
| **2** | Hub completo e mais países (tabela abaixo) | 60–117 | **9 a 18** | **16 a 32** |
| | Critério de passagem: 3 meses em comerciantes de pelo menos dois países | — | **+3** | **+3** |
| **3** | Extensões abertas e comércio por agentes (tabela abaixo) | 46–90 | **7 a 14** | **12 a 25** |
| **4** | Marketplace | — | **não se estima**: só com caso de negócio escrito (`05-fases-e-mvp.md`) | |
| | **Até ao fim da Fase 3** | | **≈ 38 a 70** (3 a 6 anos) | **≈ 64 a 118** (5 a 10 anos) |

**Exemplo:** com a Fase 0 fechada a 31/12/2026 e os dois a tempo inteiro, a
construção da Fase 1 acaba entre **abril de 2028 e junho de 2029**; o primeiro
comerciante de fora pode entrar quando o motor de IVA estiver validado pelo
contabilista e o contrato pelo jurista, que correm em paralelo.

**O contraste com o Hub interno, dito às claras:** o Hub foi construído em
≈ 10,5 meses (primeira migração a 18/11/2025, **M**) e tem mais módulos do que
a Fase 1. Estes números são maiores porque o Eurolify tem de ser provado antes
de abrir — isolamento entre comerciantes, testes, segurança, validações — e o
Hub foi corrigido em produção. **Não tenho medida** de quanto mais rápido
vocês são do que a hipótese 1: às 8 semanas mede-se (§6) e estes números
corrigem-se aqui.

### O que entra na Fase 2 (pessoas-semana, C)

| Peça | Pessoas-semana |
|---|---|
| Armazém completo: vários armazéns, picking, lotes, compostos, inventários | 8–14 |
| Devoluções ligadas à nota de crédito, estado do artigo, troca e carteira | 6–10 |
| Emissão por adaptador em dois países novos (ex.: Verifactu em Espanha) | 6–12 |
| Relatório OSS com os quatro baldes; ligações ao software de faturação de comerciantes de outros países | 4–8 |
| Automações e notificações configuráveis, campos personalizados, módulos por comerciante | 8–12 |
| Ecrãs do Hub para o que entra nesta fase | 6–10 |
| Migração da loja principal do grupo | 4–8 |
| Programa para os parceiros convidados (documentação, loja de ensaio, simulador, testes do contrato) | 6–10 |
| Testes, segurança e novo teste de intrusão | 4–6 |
| **Soma** | **52–90** (com imprevistos ≈ 60–117) |

### O que entra na Fase 3 (pessoas-semana, C)

| Peça | Pessoas-semana |
|---|---|
| Loja de extensões: publicação, revisão, instalação, permissões, extensões pagas | 8–14 |
| Caixa fechada para as funções de terceiros e os pontos de extensão | 6–10 |
| Extensões de ecrã no Hub e no checkout | 4–8 |
| Linha de comandos, modelos, loja de ensaio e documentação para programadores | 6–10 |
| Obrigações do DSA na loja (denúncia, decisão fundamentada, recurso) | 3–5 |
| MCP com escrita sob confirmação | 3–6 |
| Comércio por agentes (UCP/ACP) e API de checkout com verificação | 6–10 |
| Testes e segurança | 4–6 |
| **Soma** | **40–69** (com imprevistos ≈ 46–90) |

## O que ficou por verificar

- **O esforço de cada peça (§2 e §9) é julgamento meu**, sem medição; e a
  hipótese de o Diogo e o Bruno renderem como um sénior com IA (§9). É a maior
  incerteza desta página; a §6 é a forma de a reduzir.
- Os salários vêm de resumos de artigos que citam guias de 2026; o Guia Hays e
  o estudo da Michael Page de 2026 não foram lidos (o PDF de TI da Michael Page
  descarregado não tem ano e não traz programadores — não foi usado).
- Os 3 % de seguro de acidentes de trabalho e subsídio de refeição; se os
  45.000–65.000 € incluem os 14 meses.
- O tempo de contratação de um sénior.
- O preço da auditoria de acessibilidade (fonte fraca) e da marca (página
  oficial da EUIPO deu 403).
- O câmbio do dólar não foi aplicado: o Claude conta-se 1 US$ = 1 €, por cima.
- Se o SIFIDE II é renovado para 2027.
- Contabilista, jurista, seguro, recrutamento e suporte: **sem número**.
