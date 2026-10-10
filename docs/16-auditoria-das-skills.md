# Auditoria do repositório contra as 37 skills — 05/10/2026

Issue #85. **Só leitura: nada foi corrigido nesta auditoria.** As correcções
entram depois, um pedido de alteração por domínio, e as que mudam uma skill
ou uma decisão só com o OK do Diogo ou do Bruno (`AGENTS.md`, «Regras da UE»,
ponto 1).

## Como se fez

- Estado lido: `main` em `61dae55` (05/10/2026, depois do #84).
- 37 skills em 5 blocos, cada um lido por um agente só de leitura (Sonnet,
  `eurolify-scout`): A processo e arquitectura (8), B API, segurança e dados
  (4), C catálogo e produto (6), D IVA, pagamentos e consumidor (8), E
  encomendas, canais e coordenação jurídica (11). O bloco A correu sozinho;
  B a E correram em paralelo depois de o Diogo o autorizar nesta sessão
  («podes correr os blocos em paralelo», 05/10/2026).
- Memória: `audit_memory.py` (skill `eurolify-repository-memory`) sobre
  `memoria/` e `docs/`, 05/10/2026.
- Os achados P1 foram reconferidos na fonte pela sessão principal (Opus 5.5);
  dois baixaram de gravidade (ver «Corrigido na reconferência»).
- Revisão: agente `eurolify-critical-review` (Opus 5.5), no fim do documento.
- **Nada foi executado**: nem testes, nem a base, nem a VPS.

Gravidade: **P1** corrigir ou decidir antes da próxima fatia que lhe toca;
**P2** depois, com dono. «Por desenhar» não é divergência: é um domínio ou
campo ainda sem desenho, assumido como tal.

## Resumo

| Bloco | Exigências que cumprem (contagem de cada agente) | P1 | P2 (aprox.) |
|---|---|---|---|
| A processo e arquitectura | 14 | 0 | 10 |
| B API, segurança, dados | 17 | 1 | 17 |
| C catálogo e produto | 12 | 2 | 7 |
| D IVA, pagamentos, consumidor | 14 | 3 | 10 |
| E encomendas, canais, jurídico | 16 | 2 | 15 |

O que cumpre e pesa mais: cada comerciante só vê os seus dados (RLS forçada
em todas as tabelas, com um teste que falha se uma tabela nova nascer sem
ela — `apps/api/test/comerciante.test.ts:107-135`); os testes correm numa
base PostgreSQL real com o papel da API; nenhum segredo no repositório
(pesquisa de padrões de chaves e tokens, bloco B); o motor de regras bloqueia
por omissão e não deixa um território herdar a regra do continente; o SKU e
o GTIN estão separados e o GTIN nunca é derivado do SKU; a memória não tem
duplicados e as 31 memórias estão no índice.

## Decisões precisas (Diogo ou Bruno)

| # | Pergunta | Porquê | Fontes |
|---|---|---|---|
| Q1 | OK para corrigir as skills nos pontos marcados «skill» abaixo? | Mudar uma skill exige o OK (`AGENTS.md`) | tabelas abaixo |
| Q2 | Os tipos `bilhete` e `servico` (este quando é um serviço prestado à distância) ficam desligados até terem classificação, ou definem-se já? | Hoje criam-se sem classificação (`catalogo.test.ts:304-306`); a skill de setores manda bloquear o que não está classificado e a de digitais exige classificar o serviço à distância. A P3 só desligou digital e cartão-oferta | `0002_catalogo_artigos.sql:14,115`; `eurolify-sector-compliance-eu/SKILL.md:16`; `digital-products-eu/SKILL.md:39-42`; `docs/14:425` |
| Q3 | Em que fase entram a loja física/POS, os distribuidores e o franchising? | Só as listas de preços B2B estão na Fase 1; as skills novas não dizem a fase | `docs/05:44-88`; `docs/eurolify/architecture.md:224`; `implementation-plan.md:34` |
| Q4 | Canais B2B: manda a nova `eurolify-b2b-channels-eu` ou a `eurolify-channel-governance` do pacote de 04/10 (não instalada)? | O `architecture.md` segue a não instalada; o #38 está aberto (lista de *issues* abertos, GitHub, 05/10/2026) | `docs/eurolify/architecture.md:58-61`; `docs/adr/0034:49-51`; `memoria/pacote-complementar-skills-04out2026.md:62` |
| Q5 | A conta do GitHub que aloja o repositório (id 259400126, ADR-0033:57,119) tem no nome a marca da empresa que o `AGENTS.md` («Marca própria») exclui do Eurolify. Fica, ou muda-se a conta? | O nome aparece por ser o endereço técnico: 18 ficheiros, 104 ocorrências (`grep -rioE "hnferramentas\|hit ?nails"`, 05/10/2026), entre eles `infra/vps/ficheiros/ensaio.conf:6-10`, `.github/CODEOWNERS`, `apps/mcp/test/oauth.test.ts:214,229`, `docs/11`, `implementation-plan.md:62,66`, ADR 0024/0026/0028/0030/0033 e `eurolify-engineering-execution/references/basis.md:9,13`. Não é marca em produto nem em ecrã | as citadas |

Já em aberto noutro sítio (não se repete aqui): carteira contra vale
(`docs/eurolify/compliance-gaps.md:33`, G3); margem sobre pagamentos (A5,
`docs/12:147-156`); fase do art. 16.º do DSA (G7, `compliance-gaps.md:37`;
`docs/03:137-145` manda deixar a skill `marketplace-dsa` como está até o
jurista responder).

## P1 — corrigir ou decidir antes da próxima fatia que lhe toca

| Bloco | Achado | Fontes | Proposta | Dono |
|---|---|---|---|---|
| B | MCP da VPS: a confirmação humana das acções depende só de uma pista ao cliente (`destructiveHint`); o servidor não a exige e o ADR diz «não verifiquei» que o cliente a mostra | `apps/mcp/src/ferramentas.ts:34-38,62-132`; `docs/adr/0033:61-62,135-136` | Verificar no cliente e registar no ADR, ou confirmação em dois passos no servidor | código (MCP) |
| C | Classificação setorial do artigo: o `docs/14` só tem «atributo obrigatório em falta» no C2 e a `0002` não tem campo de família ou classificação (leitura do `docs/14` e pesquisa de `classifica` na `0002`, bloco C) | `docs/14:291`; `0002_catalogo_artigos.sql` | Desenhar no `docs/14` §3.10 a classificação e «por classificar não se publica», antes da parte 3 (publicação) | #36 |
| C | `bilhete` e `servico` à distância sem classificação | ver Q2 | — | Q2 |
| D | Motor de regras sem marca W/M/C por regra: uma regra **C** num domínio «verificado» daria «permitido». Latente: o registo tem 0 regras | `apps/api/src/regras/tipos.ts:95-121`; `validar.ts:205-213`; `decidir.ts:174-194`; `registo.ts:62-76`; `AGENTS.md`, «documentos fiscais», ponto 7 | Campo de marca na regra e recusa de uma **C** num domínio verificado, antes da primeira regra | #59 |
| D | Estados de prontidão da skill de países (5) sem correspondência com os do motor | `eurolify-legal-briefing-eu/references/countries.md:25`; `regras/tipos.ts:64-72,86-91,150` | Tabela de correspondência no #59 | #59 |
| D | Pagamento sem estado «incerto»; três skills novas exigem-no para a reconciliação. Latente: a fatia 8 (pagamentos) está por fazer (`implementation-plan.md:28`) | `payments-psd2-sca/SKILL.md:53-59`; `eurolify-payment-readiness-eu`; `finance-payments.md:32` | Acrescentar `incerto` à máquina antes de desenhar pagamentos | skill (Q1) |
| E | Fase de loja física, distribuidores, franchising | ver Q3 | Depois da Q3, uma linha «Estado/fase» nas skills novas | Q3 |
| E | Canais B2B com duas origens | ver Q4 | — | Q4 |

### Corrigido na reconferência e na revisão

- **AI Act** (o bloco E dizia P1): o `docs/03:102` foi lido no EUR-Lex a
  03/10/2026 (**W** texto lido); o pacote é que não o conseguiu ler a 05/10
  (`references/source-gaps.jsonl:1`). Não há contradição → P2.
- **Quem emite** (o bloco D dizia P1): o ADR-0006 (linhas 38-40) pôs o
  Moloni em Portugal na Fase 1, e a skill já cita a D-4
  (`eu-vat-oss-ioss/SKILL.md:101-102`). Falta só citar o ADR-0006 e a D-10
  (`docs/06:211-218`) → P2.
- **Revisão «sessão nova»** (a auditoria dizia P1): as três frases são
  condicionais («quando o projeto o exigir»), por isso estão desactualizadas,
  não erradas → P2.
- **Digital, um tipo contra dois** (dizia P1): desligado e sem dados; acertar
  custa uma migração sem linhas → P2.
- **ViDA** (dizia P1): o calendário da skill (`timeline.md:14`) admite
  «adiamento nacional» do fornecedor presumido e o `docs/03:39` dá «opcional
  01/07/2028, obrigatória 01/01/2030»; não se contradizem, só falta à skill o
  fim do adiamento → P2, sem mexer na marca do `docs/03`.
- **Art. 16.º do DSA** (dizia P1): o conteúdo da skill coincide com o
  `docs/03:100` («alojamento de conteúdos de terceiros, qualquer tamanho»);
  só a marca está desactualizada (**C** na skill, **W** texto lido no
  `docs/03`); a fase fica com a G7 → P2.

## P2 — depois, com dono

**Skills (Q1)**
- Revisão: `eurolify-efficient-workflow/SKILL.md:20`, `eurolify-evidence-before-done/SKILL.md:14`, `.claude/agents/eurolify-critical-review.md:17-18` e `docs/eurolify/compliance-gaps.md:45` (G15) falam de «sessão nova»; citar o ADR-0035 (`docs/adr/0035:37-49`).
- `eu-vat-oss-ioss/SKILL.md:149-150`: «o comerciante pode ter de se registar no país de destino (Reino Unido, Suíça)» — contra o `AGENTS.md`, «Regras da UE», ponto 2 (🔴): a venda para fora da UE trata-se pelas regras da UE (exportação). Retirar ou reescrever.
- `eu-vat-oss-ioss`: citar o ADR-0006 e a D-10 junto da D-4 (linhas 101-102); acrescentar às linhas 154-155 a reserva do Orçamento de 2027 do `docs/03:43`; apontar para a `eurolify-tax-pos-invoicing-eu` no ViDA.
- `marketplace-dsa/SKILL.md:32`: marca do art. 16.º para **W** texto lido (`docs/03:100`), só depois da resposta da G7 (`docs/03:137-145`).
- `references/timeline.md:14`: dizer até quando vai o adiamento nacional do fornecedor presumido, com fonte; não verifiquei o acto.
- `eurolify-session-continuity/SKILL.md:16` repete a escolha do modelo; deve remeter para `eurolify-efficient-workflow`.
- `headless-commerce` («MCP só leitura até à Fase 3», linhas 82-83, 108) não distingue o MCP de operação da VPS (ADR-0033); nomes `eurolify_*` (linha 110) contra `apps/mcp/src/ferramentas.ts`.
- `consumer-rights-eu:88` e `docs/03:59`: «confirmar a transposição nacional», como já diz o `timeline.md:7`.
- `payments-psd2-sca`: a Floa não está na régua (`docs/06:171`, `docs/07:25`).
- `order-fulfilment:81`: troca e carteira são Fase 2 (`docs/05:112-115`); falta o passo da rota de retorno na RMA (`eurolify-transport-logistics-eu/SKILL.md:14,17,20`).
- `eurolify-b2b-channels-eu:13` e `docs/eurolify/architecture.md:73-78`: listas de papéis diferentes.
- `references/evidence.md`: M e C com redacção diferente do `docs/03:17-19`; falta a regra «uma **C** não chega a um ecrã» (`docs/03:21-23`).
- `references/timeline.md`: sem coluna W/M/C; `templates/rule-record.yaml:23` usa valores de `read_level` diferentes dos do `sources.jsonl`.
- `references/source-gaps.jsonl`: dizer que o Reg. 2026/1744 foi lido a 03/10 (`docs/03:102`).
- As 7 skills novas sem linha de estado (desenho, fase).
- As skills antigas não apontam para as complementares (só a coordenadora está no `AGENTS.md`).

**Documentos**
- `docs/02-arquitectura.md:3` diz «nada construído»; `docs/eurolify/implementation-plan.md:75-79` propõe como próxima a fatia 2, já feita; `implementation-plan.md:21-22` e `docs/adr/0034:58` só citam o ADR-0030 (falta o ADR-0035).
- `docs/eurolify/architecture.md:4`, `implementation-plan.md:6` e `docs/adr/0034:17` citam `eurolify-platform-orchestrator`, que não está instalada (pesquisa de pastas `*orchestrator*` em `.agents/skills/`).
- `docs/15:182` diz que a API não apaga; `0002:261` e `0004:147` dão DELETE em artigo, variante e componente, como o `docs/14:255-257,337` permite para rascunhos.
- `docs/15` §8 (220-231): a `Idempotency-Key` só aparece em `POST /merchants`.
- `docs/14` §3.10 (215-225): falta a identificação do produto que o `docs/03:81` lista para o GPSR («tipo, lote/série, foto»); §3.4: falta «uma colecção pode levar várias fórmulas» (`catalog-pim/SKILL.md:34`).
- `docs/05` e `docs/13` não apontam para as portas do digital e dos vales (pesquisa de `digital`, `cartão`, `vales`, `ADR-0034` nos dois; só em `docs/eurolify/*`).
- `docs/eurolify/compliance-gaps.md:11`: «27 × 7 = 189» está certo para os domínios obrigatórios, mas o teste percorre os 11 domínios por país (`regras.test.ts:111`, `registo.ts:44-49`); dizer qual é o número contado.
- `docs/03:86` (ADR/IATA, **C**+**M**) sem a Dir. 2008/68/CE; o Reg. 2018/644 não está no `docs/03` (pesquisa de `2018/644`). Ambos estão em `references/transport.md:9,21` e `sources.jsonl:11,15` (**W**, resumo da página). CRA, EUDR e brinquedos (Reg. 2025/2509) só estão no `timeline.md:11,13,15`.
- `docs/02:77` (2 papéis) e `order-fulfilment:48` (3 papéis); `inventory.adjusted` só no `docs/02:78`.
- A montra com kit e temas por comerciante (`eurolify-design:20,32`) não está em nenhuma fase (pesquisa de `montra` e `tema` no `docs/05`: sem ocorrências).

**Segurança e dados (antes do primeiro comerciante real, salvo indicação)**
- Registo de tratamentos e lista de subcontratantes: prometido (`docs/11:175`, `docs/03:96`), sem ficheiro próprio (pesquisa de «registo de tratamentos» no repositório). A lista tem de incluir a OVH, a Healthchecks.io (país por verificar, ADR-0027:91), o GitHub e a Anthropic (os pedidos ao MCP saem dela, ADR-0033:27-29; com dados reais é um serviço de fora da UE que exige a decisão escrita do `AGENTS.md`, regra 4).
- Retenção por campo de dados pessoais por escrever (`docs/15`; campos em `0001_comerciante.sql:45-136`); exportação e apagamento por desenhar (`docs/15:229-230`).
- Registos de auditoria imutáveis só por permissões, sem gatilho que recuse alterar ao dono (`0001:377-385`); `transicao_estado` sem «de onde» nem IA/modelo; Catálogo sem rasto (`docs/14:240-242`).
- MCP: o registo da máquina guarda `origem="mcp"` sem a conta (`infra/vps/ficheiros/sbin/eurolify-operar:72,87,100-101`), contra o ADR-0033:76-77 — a conta só fica no registo do contentor (`apps/mcp/src/ferramentas.ts:17`, `apps/mcp/src/app.ts:66`); um só âmbito OAuth para ler e agir (`apps/mcp/src/oauth.ts:345,363`); o login GitHub gravado pelo MCP (`oauth.ts:220`) não está na excepção do ADR-0018:48-51.
- Funções da base: só `comerciante_escrever_rasto` (a única `SECURITY DEFINER`, `0001:232`) é revogada a todos (`0001:386`); as outras (`comerciante_actual`, `0001:24`; `gtin_valido`, `0002:81-92`) ficam executáveis por todos — risco baixo, são funções puras; falta um teste de privilégios de funções.
- Ao abrir a primeira rota de domínio (passa a P1): erros normalizados (RFC 9457), limite de pedidos, contrato OpenAPI gerado (`apps/api/src/app.ts:16-33`; `docs/14:30-31`), `Idempotency-Key`, outbox antes do primeiro evento (`0002:5-7`).
- RTO por escrever; cópias na mesma conta OVH (aceite para o ensaio, ADR-0032:75-80).
- CI sem vigilância de dependências nem de segredos (pesquisa de `audit`, `dependabot`, `codeql`, `gitleaks` em `.github/`).
- Plano de resposta a incidentes por escrever.

**Código (Catálogo, #77)**
- GTIN sem emissor/esquema (`0002:49-50`): decidir quando houver Stock e leitor.
- `ORIGENS_ARTIGO` escrito em linha (`esquema.ts:157-160`), sem constante nem teste.

**Memória**
- 3 memórias acima de 35 KB (`wc -c`, 05/10/2026: `ok-para-codigo-04out2026.md` 41 909 B, `apresentacao-bruno-cila-03out2026.md` 39 773 B, `vps-operada-por-nos-03out2026.md` 35 202 B): candidatas a um resumo à cabeça, sem apagar nada.

**Sem acção**
- `docs/00-proposta.md:34-40` (o Shopify) é um caso medido a 05/08/2026, não uma regra importada; fica.

## O que não se verificou

- Se cada teste de isolamento falha quando a protecção é retirada (exige correr).
- Se o SDK do MCP impõe PKCE S256; se erros da base deixam valores nos registos; a retenção dos registos de acesso do nginx.
- O texto dos actos (ViDA, DSA, AI Act) e o conteúdo jurídico das fontes das skills (fotografia de 05/10/2026, **W**).
- O texto do #38 e dos *issues* #36 e #59 (os agentes não tinham acesso ao GitHub; só se viu que estão abertos).
- Partes das referências das skills complementares (cada bloco diz quais).

## Revisão

Agente `eurolify-critical-review`, Opus 5.5 (o modelo fixado para a revisão
na política de modelos, `eurolify-efficient-workflow/references/model-policy.md:21`;
a sessão principal também é Opus 5.5, por isso o «outro modelo» do ADR-0035
ficou nos agentes da auditoria, Sonnet). Só leitura, 05/10/2026. Sem P0.
Pediu: baixar ViDA e DSA de P1; retirar o achado de `order-fulfilment:61`
(o `docs/07:167-169` tem os números); corrigir as citações de `0001:386`,
`oauth.ts:200`, `platform-architect:8`, `eu-vat:101-102`, GPSR, transporte,
189 e `implementation-plan.md:21`; dizer o método das afirmações pela
negativa e dos números; reformular a Q5 e retirar a Q6; acrescentar
`eu-vat-oss-ioss:149-150`, o `servico` à Q2, a Anthropic nos subcontratantes
e a G15. **Tudo aplicado nesta versão.** O texto integral está publicado no
pedido de alteração.

## Estado das correcções

- **Q1 respondida** (Diogo, 05/10/2026: «sim, podes corrigir as skills»).
  Corrigido no pedido seguinte a este documento: revisão pelo ADR-0035 (duas
  skills e o agente revisor); modelo na `eurolify-session-continuity`;
  `eu-vat-oss-ioss` (ADR-0006, D-10, exportação pelas regras da UE em vez do
  país de destino, reserva do Orçamento de 2027, ViDA); estado `incerto` e a
  Floa na `payments-psd2-sca`; transposição nacional no botão de livre
  resolução; rota de retorno e Fase 2 da troca e da carteira na
  `order-fulfilment`; o MCP de operação separado na `headless-commerce`;
  `evidence.md`, `timeline.md`, `rule-record.yaml` e `source-gaps.jsonl`;
  linha de estado nas 7 skills novas; remissões das 6 skills antigas para as
  complementares.
- **Q2 respondida** (Diogo, 05/10/2026: «podemos classificar já»): a classificação do artigo está desenhada no `docs/14` §3.10 («Classificação do artigo») e na C2; o código fica para o #77.
- **Q3 respondida** (Diogo, 05/10/2026: «Fase 2, só as listas B2B ficam na Fase 1»): `docs/05`, `docs/eurolify/architecture.md` §6 e a linha de estado das três skills.
- **Lista das famílias restritas** da classificação aceite (Diogo, 05/10/2026: «sim, aceito a lista»), `docs/14` §3.10.
- **Q4 respondida** (Diogo, 05/10/2026: «sim, manda a skill nova»): o `docs/eurolify/architecture.md` §3 passa a seguir a `eurolify-b2b-channels-eu`, com o operador logístico na lista de relações.
- **Q5 respondida** (Diogo, 05/10/2026: «fica, por agora não se muda»): excepção escrita no `AGENTS.md`, «Marca própria».
- **P1 de código feitos:** confirmação das acções do MCP em dois passos (#93, no `main`); marca W/M/C nas regras do motor (#95, no `main`); classificação do artigo em código (pedido da migração 0006).
- **Fica à espera:** `marketplace-dsa` (marca do art. 16.º) até à resposta
  da G7 (`docs/03:137-145`).
- **Pontos de documentos feitos** (Diogo, 05/10/2026: «avança com os pontos
  de documentação do docs/16»), menos um: estado do código no `docs/02` e no
  plano; ADR-0035 ao lado do ADR-0030; o orquestrador marcado como não
  instalado (a citação no ADR-0034:17 é literal e fica); `DELETE` dos
  rascunhos e `Idempotency-Key` em todas as escritas no `docs/15`; GPSR e
  fórmulas por componente no `docs/14`; remissões do digital e dos vales no
  `docs/05` e no `docs/13`; o número contado no `compliance-gaps.md`; Dir.
  2008/68/CE, Reg. 2018/644, CRA, EUDR e brinquedos no `docs/03` (**W**);
  três papéis no `docs/02` e `inventory.adjusted` na `order-fulfilment`.
  A montra com kit e temas por comerciante fica na **Fase 2** (Diogo,
  05/10/2026: «Fase 2»; `docs/05`).
- **Segurança — CI:** fluxo `vigiar` (gitleaks em todo o histórico; `pnpm
  audit` alto/crítico no `main`, de manhã e nos pedidos que mexem nas
  dependências; issue automático se a corrida da manhã falhar). Fica em
  aberto: as acções e as imagens fixadas por resumo não são vigiadas, não há
  actualização por rotina, e o `segredos` não está nas verificações
  obrigatórias (decisão do Diogo ou do Bruno).
- **Segurança — MCP:** o registo da máquina passa a dizer a conta (só o
  número no GitHub) de quem pediu cada acção. Um âmbito OAuth só fica, por
  agora: as duas contas permitidas têm as mesmas permissões, e separar ler de
  agir só protege quando houver uma conta só de leitura. A conta e o login dos
  operadores nos registos da VPS ficam 14 dias, como os IP (Diogo,
  05/10/2026: «14 dias, como os IP»; ADR-0018, nota).
- **Segurança — dados:** registo de tratamentos, subcontratantes, retenção,
  cópias e plano de incidentes no `docs/17` (desenho; bases e prazos **C**).
  Falta: o RTO (decisão), a exportação e o apagamento do titular (desenho no
  `docs/15`).
- **Segurança — base (migração 0008):** o rasto do Comerciante
  (`transicao_estado`, `aceitacao_contrato`, `prova_verificacao`) recusa
  alterar, apagar e esvaziar, também ao dono (desligar o gatilho exige ser dono e uma migração revista); as funções do esquema `public`
  deixam de estar abertas a PUBLIC, as novas nascem fechadas, e a API fica
  só com as que chama (teste que falha se alguma nascer aberta). Fica por
  desenhar: «de onde» e «que IA e modelo» no rasto, e o rasto do Catálogo.
- **Ao abrir a primeira rota:** desenho no `docs/18`. Feitos: erros RFC 9457
  em todas as rotas e no 404, e o contrato OpenAPI 3.1 gerado e publicado em
  `/openapi.json` (uma rota fora do contrato não se regista). Por fazer: as
  tabelas da idempotência e dos eventos (próxima migração), a `Idempotency-Key`
  nas rotas e os limites de pedidos, com a fatia «identidade».
- **Código (Catálogo):** `ORIGENS_ARTIGO` passa a constante, com teste que a
  compara com a regra da base (`artigo_origem_check`). O GTIN sem emissor
  fica para quando houver Stock e leitor, como a auditoria diz.

## Estado a 10/10/2026 (#283)

Conferido no repositório a 10/10/2026 (`ls apps/api/migracoes`,
`apps/api/src/base/`, `wc -c memoria/*.md`, a regra do `main` no GitHub).

**Feito depois da auditoria:**
- **Ao abrir a primeira rota:** a tabela da idempotência (migração 0012),
  a outbox dos eventos (0021) e o limite de pedidos
  (`apps/api/src/base/limite.ts`) estão no código.
- **Rasto do Catálogo:** a linha do tempo do artigo (0033; `docs/06`, CU).
- **Exportação dos dados do comerciante:** `POST /exports` (`docs/06`, CS).
  A exportação e o apagamento do titular (clientes da loja) estão na parte 2
  do #233, noutra sessão.
- **Memórias acima de 35 KB:** as três (`ok-para-codigo-04out2026.md`,
  41 909 B; `apresentacao-bruno-cila-03out2026.md`, 39 773 B;
  `vps-operada-por-nos-03out2026.md`, 35 202 B, os mesmos tamanhos de
  05/10/2026) já têm o resumo à cabeça (o bloco «📌 Estado a 04/10/2026»).
  Nada a fazer.

**Continua aberto, à espera de uma decisão do Diogo ou do Bruno:**
- **RTO** (tempo para voltar) para a produção (`docs/17`, «Cópias»): o
  ensaio de domingo mede quanto demora uma reposição; o objectivo é uma
  decisão antes do primeiro comerciante.
- **As acções e as imagens fixadas por resumo sem vigilância nem
  actualização por rotina** (o fluxo `vigiar` só olha para o `pnpm audit`).
- **«De onde» e «que IA e modelo» no rasto do Comerciante:** por desenhar.

**Fechado depois:** o `segredos` (gitleaks) passou a obrigatório para juntar
ao `main` a 10/10/2026, 12:53 UTC, gravado pelo Diogo na regra «main
protegido»; a API do GitHub lê agora `codigo`, `script-vps`, `imagem` e
`segredos` (`docs/06`, DG).

**À espera de terceiros:**
- `marketplace-dsa`: a marca do art. 16.º, até à resposta da G7 (jurista).

**Adiado de propósito:** o GTIN sem emissor, até haver Stock e leitor.
