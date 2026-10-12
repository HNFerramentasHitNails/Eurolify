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
> intervalo às 8 semanas. **A 12/10/2026 há uma primeira medição, provisória
> (§6.1)**, com 8 dias de código.

> ✅ **Decidido a 03/10/2026 pelo Diogo: cenário A** — *«será eu e o Bruno a
> desenvolver com o Claude Code e Codex»* ([ADR-0008](adr/0008-construcao-pelo-diogo-e-pelo-bruno.md)).
> A recomendação era a B. Os cenários B e C ficam como registo. O tempo do A,
> por fases, está no §9 (pedido do Diogo, 03/10/2026) e corrige-se às 8
> semanas (§6).

## 1. A resposta curta

| Cenário | Prazo de construção da Fase 1 | Custo da construção | Custo fixo por mês depois de abrir |
|---|---|---|---|
| **A** ✅ — só o Diogo e o Bruno, com Claude Code e Codex (decidido, ADR-0008) | Fase 1: **18 a 33 meses** os dois a tempo inteiro, **32 a 60** a meio tempo (§9, com hipótese C; recalculado a 11/10/2026 com as peças 21 e 22 da decisão DS — eram 17 a 32 e 31 a 58 — e outra vez no mesmo dia com as sete filas da peça 21, decisão DW — eram 17 a 33 e 31 a 60; a 04/10/2026, com as três da decisão AD — eram 15 a 29 e 28 a 52). **Medição provisória de 12/10/2026 (§6.1, C): o código da Fase 1 completo entre dezembro de 2026 e fevereiro de 2027; a Fase 1 passada entre junho e setembro de 2027** | ≈ 12.000–29.000 € em serviços externos (era ≈ 14.000–33.000, com o alojamento da Scaleway) + o que falta orçamentar | o tempo de duas pessoas que também gerem a empresa |
| **B** — 2 programadores sénior contratados + Diogo e Bruno no produto | **18 a 34 meses** (era 16 a 30) | **≈ 187.000–506.000 €** (era ≈ 173.000–465.000) | ≈ 9.950–14.230 € (era ≈ 9.940 antes do GitHub Pro e ≈ 10.150–14.870 com a Scaleway) |
| **C** — 3 programadores sénior contratados + Diogo e Bruno no produto | **13 a 25 meses** (era 12 a 23) | **≈ 208.000–565.000 €** (era ≈ 193.000–519.000) | ≈ 14.910–21.310 € (era ≈ 15.110–21.950, com a Scaleway) |

**Desde 04/10/2026, os três cenários (aqui, no §4 e no §9) contam as três
peças que a decisão AD (ADR-0022) passou da Fase 2 para a Fase 1** (peças 18 a
20 do §2); os valores antigos ficam entre parênteses. **Desde 11/10/2026, o
cenário A conta também as peças 21 e 22** que a decisão DS (ADR-0043) pôs na
Fase 1; **os cenários B e C não foram recalculados** com elas (não foram
escolhidos, ADR-0008) — os seus prazos e custos estão sem as peças 21 e 22. Os serviços externos (§5)
baixaram no mesmo dia, com o alojamento da construção contado na VPS da OVH,
e o custo fixo por mês depois de abrir também passou a ser contado na VPS
(§8; com a Scaleway gerida, o alojamento era ≈ 234–710 €/mês).

**Não estão nos números** (e não os invento): contabilista, jurista e seguro
(orçamentos a pedir), recrutamento, o tempo do Diogo e do Bruno, quem atende os
comerciantes depois de abrir. Antes da construção há a contratação (§4); depois
dela, os **3 meses de vendas reais** do critério de passagem da Fase 1.

**Entre B e C o trabalho é o mesmo**: muda sobretudo o prazo e o dinheiro que
sai por mês. C acaba 4 a 8 meses mais cedo e custa ≈ 21.000–59.000 € mais (antes
da decisão AD, ≈ 20.000–54.000 €),
porque três pessoas a trabalhar em paralelo perdem mais tempo a coordenar-se
do que duas.

## 2. O que se está a estimar

O âmbito da Fase 1 em `05-fases-e-mvp.md`, com os acréscimos de vender desde o
início (ADR-0006). Em pessoas-semana de um programador sénior a trabalhar com
Claude Code (**C**, todas as linhas):

| # | Peça | Pessoas-semana |
|---|---|---|
| 1 | Desenho final: modelo de domínio, lista da API, contratos de extensão | 4–8 |
| 2 | Fundações: inquilinos isolados pela base, contas e permissões, auditoria, eventos e avisos idempotentes, versões da API, publicação GitHub → VPS (ADR-0015), cópias e alarmes | 8–14 |
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
| 18 | Relatório OSS com os quatro baldes (decisão AD, 04/10/2026; veio da Fase 2) | 2–4 |
| 19 | Devolução → estado do artigo → reembolso → nota de crédito (decisão AD; veio da Fase 2) | 4–7 |
| 20 | Lotes na linha expedida e compostos (decisão AD; veio da Fase 2) | 3–5 |
| 21 | Tarefas das filas que pedem uma pessoa: dono, prazo, aviso (decisão DS, ADR-0043, 11/10/2026; veio dos módulos de gestão; sete filas pela decisão DW, `docs/33`, era 2–4 com quatro) | 2,5–5 |
| 22 | Consulta das vendas do dia e do mês, para o MCP de leitura (decisão DS; a ferramenta do MCP está na peça 12) | 1–2 |
| | **Soma** (com as peças 18 a 22; com a 21 de quatro filas era 104–177; sem a 21 e a 22, 101–171; sem as 18 a 22, 92–155) | **104,5–178** |
| | **Com imprevistos e coordenação** (+15 % no mínimo, +30 % no máximo; com a 21 de quatro filas era ≈ 120–230; sem a 21 e a 22, ≈ 116–222; sem as 18 a 20, ≈ 106–202) | **≈ 120–231** |

**Como se estimaram as peças 18 a 20** (04/10/2026, **C**, por julgamento,
como as outras): cada uma é parte de uma peça da Fase 2, que se partiu em duas
— o relatório OSS sai dos 4–8 do relatório com as ligações (ficam 2–4 para as
ligações); o núcleo das devoluções sai dos 6–10 das devoluções (ficam 2–3 para
a troca e a carteira); os lotes e os compostos saem dos 8–14 do armazém
completo (ficam 5–9). Cada estimativa conta os ecrãs e os testes da peça; as
linhas de ecrãs e de testes da Fase 2 não se mexeram.

**Como se estimaram as peças 21 e 22** (11/10/2026, **C**, por julgamento,
como as outras; ainda não há a medida das 8 semanas do §6). *Corrigido no
mesmo dia com o desenho aprovado da 21 (decisão DW, `docs/33`): a lista lê os
casos de cada fila e a tarefa só guarda o responsável e o prazo; são **sete
filas**, não quatro; cada fila a mais é uma função e os testes dela ⇒
**2,5–5** (era 2–4). O texto abaixo descreve a estimativa inicial.* A **21** é uma
tabela de tarefas (dono, prazo, estado, isolada por comerciante e com o
rasto), a ligação às quatro filas que a Fase 1 já cria (cada caso que entra
cria a tarefa, cada decisão fecha-a), uma tarefa automática que avisa ao
vencer, atribuir e mudar o prazo, a lista «a decidir» no Hub e os testes
(isolamento, duas pessoas a atribuir ao mesmo tempo, cada fila): **2–4**, ao
lado do relatório OSS (2–4) e dos lotes e compostos (3–5). A **22** é uma
consulta (encomendado, pago, faturado e devolvido, com e sem IVA, por canal e
mercado, no fuso do comerciante, cada número com o que conta), uma rota da
API e os testes com vendas conhecidas; a ferramenta do MCP fica na peça 12 e o
ecrã do painel na Fase 2: **1–2**.

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
| GitHub Pro, na conta onde vive o repositório (decisão AF, [ADR-0024](adr/0024-revisoes-impostas-no-github-pro.md); acrescentado a 04/10/2026) | **US$ 4 por mês**, contado uma vez para a conta | **W** o preço, por uma FAQ antiga do GitHub citada no ADR-0024 (o preço pago não está escrito); **C** que os colaboradores — o Bruno, ou os contratados de B e C — não pagam |

Assumo que os 45.000–65.000 € já incluem os 14 meses (**C**). Se o primeiro
contratado for o líder técnico (o que eu recomendo, §7), pode custar mais do
que o topo deste intervalo.

## 4. Os cenários, por extenso

| | B — 2 sénior | C — 3 sénior |
|---|---|---|
| Construção | 17,6 a 33,7 meses (era 16,0 a 30,5) | 13,2 a 25,3 meses (era 12,0 a 22,9) |
| Pessoas | 167.600–463.400 € (era 152.700–420.000) | 188.600–521.300 € (era 171.800–472.600) |
| Claude (US$ 200 × pessoas × meses, contado 1 US$ = 1 € por cima) | 7.000–13.500 (era 6.400–12.200) | 7.900–15.200 (era 7.200–13.700) |
| GitHub Pro (US$ 4 × meses, 1 US$ = 1 €; acrescentado a 04/10/2026 — não mexe nos totais ao milhar) | 70–135 | 53–101 |
| Serviços externos com preço (§5) | 12.000–29.000 (era 14.000–33.000) | 12.000–29.000 (era 14.000–33.000) |
| **Total com preço** | **≈ 187.000–506.000 €** (era ≈ 173.000–465.000) | **≈ 208.000–565.000 €** (era ≈ 193.000–519.000) |
| Sai por mês, em pessoas | 9.500–13.800 € | 14.300–20.600 € |

**Antes de começar:** contratar leva tempo — **1 a 3 meses** para um sénior
(**C**, não verifiquei). **Exemplo:** se o OK para código (ADR-0001) for dado a
01/01/2027 e as contratações fecharem a 01/03/2027, a construção no cenário C
acaba entre **abril de 2028 e abril de 2029** (antes da decisão AD: março de
2028 e janeiro de 2029), e a Fase 1 só passa 3 meses
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
| Alojamento durante a construção, na OVH (recalculado a 04/10/2026; era 2.000–5.000 €, contado para a Scaleway gerida a ≈ 234 €/mês; antes das peças 21 e 22, a 11/10/2026, era ≈ 120–1.360 €) — conta abaixo | **≈ 120–1.400 €** | preços **W** (página portuguesa da OVH, 03/10/2026, sem IVA, «a partir de»); meses e planos **C** |
| Contabilista: validar o motor de IVA antes do primeiro comerciante de fora | **orçamento a pedir** | — |
| Jurista: checkout e livre resolução, contrato com limites, acordo de tratamento de dados, Data Act, margem sobre pagamentos | **orçamento a pedir** | — |
| Seguro de responsabilidade civil profissional e ciber | **orçamento a pedir** — há produtos de entrada desde 404 €/ano, mas com capitais que não servem a uma plataforma que trata faturas de outras empresas | **W** ([Santander](https://www.santander.pt/empresas/seguros/seguro-protecao-empresas-cyber)) |

**Como se contou o alojamento da construção** (04/10/2026). Preços da OVH sem
IVA, «a partir de» (`11-preparacao-da-vps.md` §2 e ADR-0021): VPS-1 3,81 €,
VPS-2 7,21 €, VPS-3 10,40 €, VPS-4 19,96 € por mês.

- **Ensaio, até à migração para Paris:** a VPS-1 comprada, 6 meses (outubro de
  2026 a março de 2027; ADR-0019, ADR-0021).
- **Ensaio, em Paris, até ao fim da construção:** entre uma VPS-2 e uma VPS-4
  (**C**: o plano escolhe-se com a carga medida; a VPS-1 já é apertada).
- **Produção nos últimos meses** (**C**): 3 meses numa VPS-3 sem segunda
  máquina da base, a 6 meses numa VPS-4 com uma segunda VPS-4 para a base
  (as duas decisões estão por tomar no `11-preparacao-da-vps.md` §7).
- **Meses até ao fim da construção** = o que falta da Fase 0 (1–3) + a
  contratação nos cenários B e C (1–3) + a construção (§4 e §9):

| Cenário | Meses | Alojamento |
|---|---|---|
| A, os dois a tempo inteiro | 19–36 (era 18–36 antes das sete filas da peça 21, e 18–35 antes das peças 21 e 22) | ≈ 150–860 € (o mês a mais no mínimo numa VPS-2 a 7,21 €, e no máximo numa VPS-4 a 19,96 €; conta minha; era ≈ 140–860) |
| A, cada um a meio tempo | 33,5–63 (era 32,5–63, e 32,5–61 antes das peças 21 e 22) | ≈ 250–1.400 € (dois meses a mais no máximo; o mês a mais no mínimo, ≈ 7 €, não muda o arredondamento) |
| B | 19,6–39,7 | ≈ 150–940 € |
| C | 15,2–31,3 | ≈ 120–770 € |

**Não está contado:** as cópias fora da máquina (preço **não verificado**,
`11-preparacao-da-vps.md` §8), o IVA, e as condições do preço «a partir de»
(a página irlandesa, lida por resumo, fala de 12 meses adiantados). Mesmo que
dupliquem o valor, a linha dos serviços externos mexe pouco.

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

### 6.1 Medição provisória a 12/10/2026 (8 dias de código, cenário A)

Pedido do Diogo, 12/10/2026: *«sim, corrige já o docs/10 com esta medição»*
(#390). **Não substitui a medição das 8 semanas** (≈ 29/11/2026), que
continua a fazer-se. Ainda não há o esforço planeado escrito antes de cada
peça, nem as horas que o Diogo e o Bruno gastaram.

**Como se mediu:** para cada peça do §2, li o estado do desenho (o cabeçalho
de `docs/14` a `docs/35`) e procurei o código (`apps/api/src/`, `apps/hub/src/`,
`apps/mcp/src/`). A partir disso dei um avanço em percentagem — **C**: é
julgamento meu, não está medido. A percentagem aplica-se ao ponto médio do
esforço sem imprevistos.

**Números, contados a 12/10/2026 no `main`:**
- **338 commits** entre 04/10 e 12/10/2026 (`git log --date=short`, por dia);
- **69 migrações** (`0001` a `0069_faturacao_moloni.sql`);
- **109 ficheiros de teste** (`*.test.ts`, fora de `node_modules`);
- os commits por dia: 82 a 04/10, 11 a 12/10 até ao meio-dia.

| # | Peça | Ponto médio (p-s) | Avanço (**C**) | Feito (p-s) | Em que me baseio |
|---|---|---|---|---|---|
| 2 | Fundações | 11 | 60 % | 6,6 | Contas e identidade (`docs/19`, `docs/21`), isolamento na base, rasto (`docs/28`), publicação pelo GitHub |
| 3 | Catálogo | 7 | 75 % | 5,3 | `docs/14` e `src/catalogo/`; publicar pelo Hub (#378) em curso; espelho do sistema do comerciante por fazer |
| 4 | IVA, VIES, preços B2B, 30 dias | 11 | 40 % | 4,4 | Motor de IVA no código (`docs/24`); VIES (`src/clientes/vies.ts`) |
| 5 | Checkout alojado | 10 | 25 % | 2,5 | Só a parte 1 (`docs/25` §13) |
| 6 | Pagamentos | 8 | 20 % | 1,6 | Parte 1 e reembolso MB WAY pela EuPago; a Stripe só aparece num comentário |
| 7 | Encomendas e stock | 6,5 | 30 % | 2,0 | Só a parte 1 (`docs/27` §12) |
| 8 | Faturação | 6,5 | 50 % | 3,3 | Parte 1 e adaptador Moloni (`docs/29`); #386 em curso |
| 9 | Envios | 5 | 0 % | 0 | Sem código: «CTT» não aparece em `src/` |
| 10 | Livre resolução, área de cliente, notificações | 5,5 | 25 % | 1,4 | `docs/30`, partes 1 e 2; e-mail do prazo (`docs/34`) |
| 11 | RGPD essencial | 4 | 40 % | 1,6 | Consentimentos; pedidos do titular a meio (#374) |
| 12 | API, SDK, MCP de leitura, webhooks | 10 | 20 % | 2,0 | Rotas REST por domínio. Sem SDK e sem webhooks de saída. O `apps/mcp` é o MCP da VPS, não o MCP de leitura |
| 13 | Abertura a comerciantes | 8 | 10 % | 0,8 | Só a exportação (`src/exportacao/`) |
| 14 | Hub mínimo | 8 | 25 % | 2,0 | Catálogo, equipa e chaves; sem ecrãs de encomendas nem de definições |
| 15 | Ecrãs e acessibilidade | 6 | 20 % | 1,2 | Os ecrãs do Hub feitos até agora |
| 16 | Testes, carga, intrusão | 8 | 15 % | 1,2 | Testes de isolamento; carga e teste de intrusão por fazer |
| 17 | Loja piloto | 3 | 0 % | 0 | — |
| 18 | Relatório OSS | 3 | 0 % | 0 | O motor decide o OSS, mas o relatório não existe |
| 19 | Devolução → nota de crédito | 5,5 | 35 % | 1,9 | `docs/30`, partes 1 e 2 |
| 20 | Lotes e compostos | 4 | 20 % | 0,8 | Já há lote no stock (`src/stock/`) |
| 21 | Tarefas das filas | 3,75 | 50 % | 1,9 | `docs/33` §13, parte 1 |
| 22 | Vendas do dia e do mês | 1,5 | 90 % | 1,4 | `docs/35`, consulta, índices e teste de ponta a ponta |
| | **Soma** (sem a peça 1) | **≈ 135** | **≈ 31 %** | **≈ 42** | |

**O ritmo medido:** ≈ 42 pessoas-semana do §2 em ≈ 1,3 semanas de
calendário. Isto dá ≈ 32 pessoas-semana estimadas por semana de calendário.
Mesmo com os dois a tempo inteiro, é **mais de 10 vezes** o ritmo da
hipótese 1 do §9 (**C**). Falta saber a dedicação de cada um para converter
este ritmo num factor exacto.

**Porque o resto não se extrapola em linha recta (C):**
- O que está feito são sobretudo as primeiras partes, que dependem só de nós.
- O que falta depende de terceiros: integrações reais (Stripe, CTT, Moloni em
  produção), contas de ensaio, o teste de intrusão, a carga e as validações do
  contabilista e do jurista.
- O ritmo já está a descer.

Por isso conto o resto **3 a 4 vezes mais devagar** do que o ritmo medido.

**Previsão revista (cenário A, todas as linhas C):**

| Marco | A hipótese do §9 | Com a medição de 12/10/2026 |
|---|---|---|
| Esforço que falta na Fase 1 | 116–221 p-s | ≈ 80–152 p-s (69 % de 100,5–170, com +15 % a +30 %) |
| Código da Fase 1 completo | maio de 2028 a outubro de 2029 | **dezembro de 2026 a fevereiro de 2027** (≈ 8 a 19 semanas a contar de 12/10/2026) |
| Primeiro comerciante de fora | — | depois do código completo, das validações do contabilista e do jurista e do seguro (no fim, ADR-0045) e da VPS em Paris (até 31/03/2027, ADR-0019); o prazo das validações **não está estimado** |
| Fase 1 passada (+3 meses de vendas reais) | +3 meses sobre o fim da construção | **junho a setembro de 2027**: os 3 meses contam só com a loja piloto do grupo (ADR-0045), por isso não dependem do prazo das validações |
| Até ao fim da Fase 3 | ≈ 39 a 71 meses (3 a 6 anos) | **ordem de grandeza: 2028** — as Fases 2 e 3 não foram medidas peça a peça |

**O que manda continua a ser o critério de passagem, não o calendário**
(`05-fases-e-mvp.md`). Agora o caminho crítico está fora do código:
- as validações do contabilista, do jurista e do seguro, que se tratam no fim
  do desenvolvimento (decisão EC, ADR-0045) e por isso somam-se ao prazo;
- as conversas com comerciantes e os preços da D-14 (travam a peça 13);
- a VPS em Paris antes do primeiro dado real;
- os 3 meses de vendas reais.

**O que esta medição não sabe:**
- as horas e a dedicação de cada um;
- se as «partes 1» já cobrem os casos difíceis de cada domínio;
- se as conversas com comerciantes já começaram.

Às 8 semanas, refaz-se esta tabela com o esforço planeado e o gasto, e
corrige-se o §1 e o §9.

## 7. Recomendação — opinião (não seguida: decidido o A, ADR-0008)

- **Cenário B com o primeiro contratado como líder técnico** (base de dados,
  isolamento entre inquilinos, segurança): é quem revê cada mudança, incluindo
  as que o Diogo e o Bruno fizerem com Claude Code.
- **Às 8 semanas, medir (§6) e decidir a terceira pessoa.**
- O Diogo e o Bruno ficam com o produto: decisões, conversas com comerciantes,
  contabilista e jurista, loja piloto.
- ~~Pedir já os orçamentos do contabilista, do jurista e do seguro~~ — **não
  se segue** (decisão EC, ADR-0045, 12/10/2026): tratam-se quando o
  desenvolvimento da Fase 1 terminar.

## 8. Depois de abrir — ligação à D-14

O custo fixo por mês depois de abrir (pessoas + alojamento + Claude dos
programadores + GitHub Pro) é ≈ **9.950–14.230 €** no cenário B e ≈ **14.910–21.310 €** no C,
sem contabilista, jurista, seguro nem quem atende os comerciantes. Recalculado
a 04/10/2026 com o alojamento na VPS da OVH e, no mesmo dia, com o GitHub Pro
(US$ 4, ADR-0024: o mínimo do B era ≈ 9.940 €; o resto não muda ao arredondar
à dezena); com a Scaleway gerida eram ≈ 10.150–14.870 € e ≈ 15.110–21.950 € (refeita a conta antiga, os mínimos dão
≈ 10.160 € e ≈ 15.120 €; estavam escritos 10 € abaixo).

**Alojamento depois de abrir, na VPS da OVH: ≈ 18–70 €/mês** (preços sem IVA,
«a partir de», `11-preparacao-da-vps.md` §2). As duas escalas são as da conta
antiga da Scaleway (`memoria/alojamento-e-custos-03out2026.md`), passadas para
planos da OVH (**C**, carga não medida):

| Escala | Na Scaleway gerida (antes) | Na VPS da OVH |
|---|---|---|
| Início (na Scaleway: base 2 vCPU/8 GB com segunda máquina, 2 contentores) | ≈ 234 €/mês | base, API e Hub numa VPS-3 + ensaio numa VPS-2 = **≈ 17,61 €/mês**; com uma segunda VPS-3 para a base, **≈ 28,01 €/mês** (a segunda máquina está por decidir, `11-preparacao-da-vps.md` §7) |
| Médio (na Scaleway: base 8 vCPU/32 GB com segunda máquina, 6 contentores) | ≈ 710 €/mês | base numa VPS-4 + segunda VPS-4 + contentores numa VPS-4 + ensaio numa VPS-3 = **≈ 70,28 €/mês** |

**Não está contado:** as cópias fora da máquina (preço **não verificado**), o
tráfego das montras (o que cresce de verdade, segundo a memória do alojamento;
**não verifiquei** o preço na OVH), o IVA e as condições do «a partir de». A
VPS-4 tem 24 GB, menos do que os 32 GB da escala média da Scaleway; os planos
acima dela não têm preço lido. E há o trabalho de operar as máquinas, que na
Scaleway gerida era do fornecedor e passa a ser nosso (ADR-0015).

**No cenário A (decidido):** sem salários de programadores, o que sai em
dinheiro por mês é o alojamento e as subscrições — ≈ 18–70 € (era ≈ 234–710 €,
com a Scaleway) + US$ 444–804
(2 × Claude Max US$ 200 + 2 × Codex entre o Plus de US$ 20 e o Pro de US$ 200,
**W**, páginas oficiais; + o GitHub Pro, US$ 4, ADR-0024 — era US$ 440–800
antes dele, 04/10/2026). **O tempo do Diogo e do Bruno não está contado, e é
o custo real**: sem lhe pôr um valor, o ponto de equilíbrio do cenário A não
se calcula.

**Exemplo de conta (hipótese, não é preço):** se cada comerciante deixar, em
média, 100 € por mês depois dos custos dele, são precisos ≈ **100–140
comerciantes** no cenário B (≈ 150–210 no C) só para pagar isto (com a Scaleway
gerida eram ≈ 100–150 e ≈ 150–220). Os preços
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
| **0** (o que falta) | Desenho final (domínio, API, contratos), conversas com 3 a 5 comerciantes, preços (D-14), OK para código (dado a 04/10/2026, ADR-0023). Desde 03/10/2026 os preços só travam a peça 13 (ADR-0012); estes números não foram recalculados. A Fase 0 passou a 04/10/2026 (critério S); o resto desta linha continua por fazer e faz-se no começo da Fase 1, domínio a domínio | 5–10 | **1 a 3** | **1,5 a 3** |
| **1** | Núcleo à venda (§2, sem a peça 1; com as peças 18 a 20 da decisão AD e a 21 e a 22 da decisão DS, a 21 com as sete filas da decisão DW — com quatro filas eram 115–220, 17 a 33 e 31 a 60; sem a 21 e a 22, 112–212, 17 a 32 e 31 a 58; sem as 18 a 20, 101–192, 15 a 29 e 28 a 52) | 116–221 | **18 a 33** | **32 a 60** |
| | Critério de passagem: 3 meses de vendas reais sem documento fiscal errado | — | **+3** | **+3** |
| **2** | Hub completo e mais países (tabela abaixo; sem as peças que a decisão AD passou para a Fase 1 — com elas eram 60–117, 9 a 18 e 16 a 32) | 49–96 | **7 a 15** | **13 a 26** |
| | Critério de passagem: 3 meses em comerciantes de pelo menos dois países | — | **+3** | **+3** |
| **3** | Extensões abertas e comércio por agentes (tabela abaixo) | 46–90 | **7 a 14** | **12 a 25** |
| **4** | Marketplace | — | **não se estima**: só com caso de negócio escrito (`05-fases-e-mvp.md`) | |
| | **Até ao fim da Fase 3** (igual depois da decisão AD: o trabalho mudou de fase, não cresceu; com a decisão DS cresceu — eram ≈ 38 a 70 e ≈ 64 a 118; com a DW, ≈ 38 a 71 e ≈ 64 a 120) | | **≈ 39 a 71** (3 a 6 anos) | **≈ 65 a 120** (5 a 10 anos) |

**Exemplo** (recalculado a 04/10/2026; outra vez a 11/10/2026, com as peças
21 e 22): a Fase 0 passou a 04/10/2026, e o desenho que faltava (linha 0, 1 a
3 meses) faz-se no começo da Fase 1. Com os dois a tempo inteiro, a construção
da Fase 1 acaba entre **maio de 2028 e outubro de 2029** (1 a 3 + 18 a 33 =
19 a 36 meses a contar de 05/10/2026, **C**; antes das sete filas da peça 21,
abril de 2028; antes das peças 21 e 22, abril de 2028 a setembro de 2029). Com a Fase 0 fechada a 31/12/2026, como o exemplo supunha antes, era
junho de 2028 a setembro de 2029 (e, antes da decisão AD, abril de 2028 e
junho de 2029). O primeiro
comerciante de fora pode entrar quando o motor de IVA estiver validado pelo
contabilista e o contrato pelo jurista, que correm em paralelo.

**Corrigido a 12/10/2026 com a medição provisória (§6.1, C):** depois de
8 dias de código estão feitos ≈ 31 % da Fase 1. O código fica completo entre
**dezembro de 2026 e fevereiro de 2027**, e a Fase 1 passa entre **junho e
setembro de 2027**. As datas de maio de 2028 a outubro de 2029 eram da
hipótese 1 e ficam aqui só como registo.

**O contraste com o Hub interno, dito às claras:** o Hub foi construído em
≈ 10,5 meses (primeira migração a 18/11/2025, **M**) e tem mais módulos do que
a Fase 1. Estes números são maiores porque o Eurolify tem de ser provado antes
de abrir — isolamento entre comerciantes, testes, segurança, validações — e o
Hub foi corrigido em produção. **Não tenho medida** de quanto mais rápido
vocês são do que a hipótese 1: às 8 semanas mede-se (§6) e estes números
corrigem-se aqui. *A 12/10/2026 já há uma primeira medida (§6.1): mais de 10 vezes o ritmo
da hipótese 1 nos primeiros 8 dias (C); a tabela acima fica como estava até à
medição das 8 semanas.*

### O que entra na Fase 2 (pessoas-semana, C)

| Peça | Pessoas-semana |
|---|---|
| Armazém completo: vários armazéns, picking, inventários (os lotes e os compostos passaram para a Fase 1, decisão AD; eram 8–14) | 5–9 |
| Troca e carteira nas devoluções (o núcleo passou para a Fase 1, decisão AD; eram 6–10) | 2–3 |
| Emissão por adaptador em dois países novos (ex.: Verifactu em Espanha) | 6–12 |
| Ligações ao software de faturação de comerciantes de outros países (o relatório OSS passou para a Fase 1, decisão AD; eram 4–8) | 2–4 |
| Automações e notificações configuráveis, campos personalizados, módulos por comerciante | 8–12 |
| Ecrãs do Hub para o que entra nesta fase | 6–10 |
| Migração da loja principal do grupo | 4–8 |
| Programa para os parceiros convidados (documentação, loja de ensaio, simulador, testes do contrato) | 6–10 |
| Testes, segurança e novo teste de intrusão | 4–6 |
| **Soma** | **43–74** (com imprevistos ≈ 49–96; antes da decisão AD, 52–90 e ≈ 60–117) |

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

- **A medição de 12/10/2026 (§6.1) é provisória:** o avanço de cada peça é
  julgamento meu sobre o desenho e o código, sem as horas gastas; o abrandamento
  de 3 a 4 vezes no que falta é uma hipótese (C).
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
- O preço do GitHub Pro: os US$ 4 por mês vêm de uma FAQ antiga (ADR-0024); o
  Diogo comprou-o a 04/10/2026, mas o valor pago e se é por mês ou por ano não
  estão escritos.
- Se o SIFIDE II é renovado para 2027.
- Contabilista, jurista, seguro, recrutamento e suporte: **sem número**.
