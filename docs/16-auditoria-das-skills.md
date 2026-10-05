# Auditoria do repositório contra as 37 skills — 05/10/2026

Issue #85. **Só leitura: nada foi corrigido nesta auditoria.** As correcções
entram depois, um pedido de alteração por domínio, e as que mudam uma skill
ou uma decisão só com o OK do Diogo ou do Bruno (`AGENTS.md`, «Regras da UE»,
ponto 1).

## Como se fez

- Estado lido: `main` em `61dae55` (05/10/2026, depois do #84).
- 37 skills em 5 blocos, cada um lido por um agente só de leitura (Sonnet,
  `eurolify-scout`; o Diogo autorizou correr em paralelo): A processo e
  arquitectura (8), B API, segurança e dados (4), C catálogo e produto (6),
  D IVA, pagamentos e consumidor (8), E encomendas, canais e coordenação
  jurídica (11).
- Memória: `audit_memory.py` (skill `eurolify-repository-memory`) sobre
  `memoria/` e `docs/`.
- Os achados P1 foram reconferidos na fonte pela sessão principal; dois
  baixaram de gravidade (ver «Corrigido na reconferência»).
- Revisão da tabela: ver o fim do documento.
- **Nada foi executado**: nem testes, nem a base, nem a VPS.

Gravidade: **P1** corrigir ou decidir já (antes da próxima fatia que lhe
toca); **P2** depois, com dono; **—** sem acção. «Por desenhar» não é
divergência: é um domínio ou campo ainda sem desenho, assumido como tal.

## Resumo

| Bloco | Exigências que cumprem | P1 | P2 |
|---|---|---|---|
| A processo e arquitectura | ~14 | 1 | 9 |
| B API, segurança, dados | 17 | 1 | 17 |
| C catálogo e produto | 12 | 4 | 6 |
| D IVA, pagamentos, consumidor | 14 | 3 | 10 |
| E encomendas, canais, jurídico | 16 | 4 | 13 |

O que cumpre e pesa mais: cada comerciante só vê os seus dados (RLS forçada
em todas as tabelas, com um teste que falha se uma tabela nova nascer sem
ela — `apps/api/test/comerciante.test.ts:107-135`); os testes correm numa
base PostgreSQL real com o papel da API; nenhum segredo no repositório; o
motor de regras bloqueia por omissão e não deixa um território herdar a regra
do continente; o SKU e o GTIN estão separados e o GTIN nunca é derivado do
SKU; as datas do consumidor (19/06/2026, 27/09/2026, 31/07/2026) coincidem em
todos os sítios onde estão escritas; a memória não tem duplicados e as 31
memórias estão no índice.

## Decisões precisas (Diogo ou Bruno)

| # | Pergunta | Porquê | Fontes |
|---|---|---|---|
| Q1 | OK para corrigir as skills nos pontos marcados «skill» abaixo? | Mudar uma skill exige o OK (`AGENTS.md`) | tabelas abaixo |
| Q2 | O tipo de artigo `bilhete` fica desligado como o digital e o cartão-oferta, ou define-se? | Hoje pode criar-se um bilhete sem nenhum desenho; a skill de setores manda bloquear o que não está classificado | `0002_catalogo_artigos.sql:14,115`; `catalogo.test.ts:304-306`; `eurolify-sector-compliance-eu/SKILL.md:16`; P3 em `docs/14:425` só decidiu digital e cartão-oferta |
| Q3 | Em que fase entram a loja física/POS, os distribuidores e o franchising? | Só as listas de preços B2B estão na Fase 1; as skills novas não dizem a fase | `docs/05:44-88`; `docs/eurolify/architecture.md:224`; `implementation-plan.md:34` |
| Q4 | Canais B2B: manda a nova `eurolify-b2b-channels-eu` ou a `eurolify-channel-governance` do pacote de 04/10 (não instalada)? | O `architecture.md` segue a não instalada; o #38 está aberto | `docs/eurolify/architecture.md:58-61`; `docs/adr/0034:49-51`; `memoria/pacote-complementar-skills-04out2026.md:62` |
| Q5 | O nome da organização no GitHub (que tem a marca antiga) fica? | Aparece em configuração, testes e ADR por ser o endereço do repositório; não é marca em produto | `infra/vps/ficheiros/ensaio.conf:6-10`; `.github/CODEOWNERS`; `apps/mcp/test/oauth.test.ts:214,229` |
| Q6 | O parágrafo de `docs/00-proposta.md:39` sobre o Shopify fica? | É uma avaliação de um fornecedor de fora da UE (`AGENTS.md`, «Regras da UE», ponto 2) — não é regra | `docs/00-proposta.md:39` |

Já em aberto noutro sítio (não se repete aqui): carteira contra vale
(`docs/eurolify/compliance-gaps.md:33`, G3); margem sobre pagamentos (A5,
`docs/12:147-156`); art. 16.º do DSA na Fase 1 (G7,
`compliance-gaps.md:37`).

## P1 — corrigir ou decidir já

| Bloco | Achado | Fontes | Proposta | Dono |
|---|---|---|---|---|
| A | Revisão: duas skills e o agente revisor falam de «sessão nova»; a regra vigente é o agente da própria sessão (ADR-0035), que proíbe sessões novas sem pedido | `eurolify-efficient-workflow/SKILL.md:20`; `eurolify-evidence-before-done/SKILL.md:14`; `.claude/agents/eurolify-critical-review.md:17-18` contra `AGENTS.md` («Git») e `docs/adr/0035:37-49` | Reescrever as três frases a citar o ADR-0035 | skill (Q1) |
| B | MCP da VPS: a confirmação humana das acções depende só de uma pista ao cliente (`destructiveHint`); o servidor não a exige e o ADR diz «não verifiquei» que o cliente a mostra | `apps/mcp/src/ferramentas.ts:34-38,62-132`; `docs/adr/0033:61-62,135-136` | Verificar no cliente e registar no ADR, ou confirmação em dois passos no servidor | código (MCP) |
| C | Classificação setorial do artigo: não há campo nem a regra «por classificar não se publica» | `docs/14:291` (C2); `0002_catalogo_artigos.sql` | Desenhar no `docs/14` §3.10 antes da parte 3 (publicação) | #36 |
| C | Digital: um tipo `digital` no `docs/14` e no SQL; dois (`conteudo_digital`, `servico_digital`) no `architecture.md`; a skill pede duas classificações | `docs/14:90`; `0002:13-14`; `apps/api/src/base/esquema.ts:102-108`; `docs/eurolify/architecture.md:211`; `digital-products-eu/SKILL.md:30-42` | Reconciliar antes de ligar o digital (hoje desligado, `0002:115-117`) | #36 |
| C | `bilhete` | ver Q2 | — | Q2 |
| D | Motor de regras sem marca W/M/C por regra: uma regra **C** num domínio «verificado» daria «permitido». Latente: o registo tem 0 regras | `apps/api/src/regras/tipos.ts:95-121`; `validar.ts:205-213`; `decidir.ts:174-194`; `registo.ts:62-76`; `AGENTS.md`, «documentos fiscais», ponto 7 | Campo de marca na regra e recusa de uma **C** num domínio verificado, antes da primeira regra | #59 |
| D | Estados de prontidão da skill de países (5) sem correspondência com os do motor | `eurolify-legal-briefing-eu/references/countries.md:25`; `regras/tipos.ts:64-72,86-91,150` | Tabela de correspondência no #59 | #59 |
| D | Pagamento sem estado «incerto»; três skills novas exigem-no para a reconciliação | `payments-psd2-sca/SKILL.md:53-59`; `eurolify-payment-readiness-eu`; `finance-payments.md:32` | Acrescentar `incerto` à máquina antes de desenhar pagamentos | skill (Q1) |
| E | ViDA: datas diferentes — o `docs/03` diz fornecedor presumido «obrigatória 01/01/2030»; o calendário da skill tem etapas 01/01/2027, 01/07/2028, 01/07/2030, 01/01/2035 | `docs/03-regulamentar-ue.md:39`; `eurolify-legal-briefing-eu/references/timeline.md:14` | Ler o acto; até lá a linha do `docs/03` fica **C** nas datas que não coincidem | docs/03 |
| E | Art. 16.º do DSA: a skill marca-o **C** e só com marketplace; o `docs/03` tem-no **W** com texto lido | `marketplace-dsa/SKILL.md:32`; `docs/03:100`; `compliance-gaps.md:37` (G7) | Alinhar a skill com o `docs/03` e a G7 | skill (Q1) |
| E | Fase de loja física, distribuidores, franchising | ver Q3 | Depois da Q3, uma linha «Estado/fase» nas skills novas | Q3 |
| E | Canais B2B com duas origens | ver Q4 | — | Q4 |

### Corrigido na reconferência

- **AI Act** (bloco E dizia P1): o `docs/03:102` foi lido no EUR-Lex a
  03/10/2026 (**W** texto lido); o pacote é que não o conseguiu ler a 05/10
  (`references/source-gaps.jsonl:1`). Não há contradição de conteúdo; basta
  dizê-lo na lacuna do pacote → P2.
- **Quem emite** (bloco D dizia P1): o ADR-0006 (linhas 37-39) já pôs o
  Moloni em Portugal na Fase 1, por isso «o Eurolify não emite faturas
  portuguesas por si» (`eu-vat-oss-ioss/SKILL.md:101-102`) está certo. Falta
  só dizer na skill que os outros países (D-4) e o cliente com sistema próprio
  (D-10, `docs/06:211`) estão por decidir → P2.

## P2 — depois, com dono

**Skills (Q1)**
- `eurolify-session-continuity/SKILL.md:16` repete a escolha do modelo; deve remeter para `eurolify-efficient-workflow`.
- `platform-architect/SKILL.md:8` diz «Estado: desenho»; já há código (ADR-0023).
- `headless-commerce` («MCP só leitura até à Fase 3», linhas 82-83, 108) não distingue o MCP de operação da VPS (ADR-0033); nomes `eurolify_*` (linha 110) contra `apps/mcp/src/ferramentas.ts`.
- `eu-vat-oss-ioss`: citar ADR-0006, D-4 e D-10; acrescentar a reserva do Orçamento de 2027 do `docs/03:43` às linhas 154-155; apontar para a `eurolify-tax-pos-invoicing-eu` no ViDA.
- `consumer-rights-eu:88` e `docs/03:59`: «confirmar a transposição nacional», como já diz o `timeline.md:7`.
- `payments-psd2-sca`: a Floa não está na régua (`docs/06:171`, `docs/07:25`).
- `order-fulfilment:81`: troca e carteira são Fase 2 (`docs/05:112-115`); `:61` cita «`docs/07` §3», os números estão no §2 (linhas 109, 119); falta o passo da rota de retorno na RMA (`eurolify-transport-logistics-eu/SKILL.md:14,17,20`).
- `eurolify-b2b-channels-eu:13` e `docs/eurolify/architecture.md:73-78`: listas de papéis diferentes.
- `references/evidence.md`: M e C com redacção diferente do `docs/03:17-19`; falta a regra «uma **C** não chega a um ecrã» (`docs/03:21-23`).
- `references/timeline.md`: sem coluna W/M/C; `templates/rule-record.yaml:23` usa valores de `read_level` diferentes dos do `sources.jsonl`.
- `references/source-gaps.jsonl`: dizer que o Reg. 2026/1744 foi lido a 03/10 (`docs/03:102`).
- As 7 skills novas sem linha de estado (desenho, fase).
- As skills antigas não apontam para as complementares (só a coordenadora está no `AGENTS.md`).

**Documentos**
- `docs/02-arquitectura.md:3` diz «nada construído»; `docs/eurolify/implementation-plan.md:75-79` propõe como próxima a fatia 2, já feita; `implementation-plan.md:21,23` e `docs/adr/0034:58` só citam o ADR-0030 (falta o ADR-0035).
- `docs/eurolify/architecture.md:4`, `implementation-plan.md:6` e `docs/adr/0034:17` citam `eurolify-platform-orchestrator`, que não está instalada.
- `docs/15:182` diz que a API não apaga; `0002:261` e `0004:147` dão DELETE em artigo, variante e componente.
- `docs/15` §8 (220-231): a `Idempotency-Key` só aparece em `POST /merchants`.
- `docs/14` §3.10 (215-225): falta a identificação do produto do GPSR (modelo, série); §3.4: falta «uma colecção pode levar várias fórmulas» (`catalog-pim/SKILL.md:34`).
- `docs/05` e `docs/13` não apontam para as portas do digital e dos vales (só em `docs/eurolify/*`).
- `docs/eurolify/compliance-gaps.md:11` conta «27 × 7 = 189»; o registo tem 11 domínios por país (`regras/registo.ts:44-49`) e nenhum teste conta 189.
- `docs/03:86` (ADR/IATA, **C**+**M**) sem a Dir. 2008/68/CE; CRA, EUDR, brinquedos (Reg. 2025/2509) e o Reg. 2018/644 só estão no calendário da skill.
- `docs/02:77` (2 papéis) e `order-fulfilment:48` (3 papéis); `inventory.adjusted` só no `docs/02:78`.
- A montra com kit e temas por comerciante (`eurolify-design:20,32`) não está em nenhuma fase (`docs/05:77-82`).

**Segurança e dados (antes do primeiro comerciante real, salvo indicação)**
- Registo de tratamentos e lista de subcontratantes: prometido (`docs/11:175`, `docs/03:96`), não existe; OVH, Healthchecks.io (país por verificar, ADR-0027:91), GitHub.
- Retenção por campo de dados pessoais por escrever (`docs/15`; campos em `0001_comerciante.sql:45-136`); exportação e apagamento por desenhar (`docs/15:229-230`).
- Registos de auditoria imutáveis só por permissões, sem gatilho que recuse alterar ao dono (`0001:377-385`); `transicao_estado` sem «de onde» nem IA/modelo; Catálogo sem rasto (`docs/14:240-242`).
- MCP: regista `origem="mcp"` sem a conta (`infra/vps/ficheiros/sbin/eurolify-operar:72,87,100-101`), contra o ADR-0033:76-77; um só âmbito OAuth para ler e agir (`apps/mcp/src/oauth.ts:345,363`); o login GitHub gravado pelo MCP (`oauth.ts:200,220`) não está na excepção do ADR-0018:48-51.
- Funções da base com EXECUTE para todos e sem teste de privilégios (`0001:24,386`; `0002:81-92`).
- Ao abrir a primeira rota de domínio (passa a P1): erros normalizados (RFC 9457), limite de pedidos, contrato OpenAPI gerado (`apps/api/src/app.ts:16-33`; `docs/14:30-31`), `Idempotency-Key`, outbox antes do primeiro evento (`0002:5-7`).
- RTO por escrever; cópias na mesma conta OVH (aceite para o ensaio, ADR-0032:75-80).
- CI sem vigilância de dependências nem de segredos (`.github/`).
- Plano de resposta a incidentes por escrever.

**Código (Catálogo, #77)**
- GTIN sem emissor/esquema (`0002:49-50`): decidir quando houver Stock e leitor.
- `ORIGENS_ARTIGO` escrito em linha (`esquema.ts:157-160`), sem constante nem teste.

**Memória**
- 3 memórias acima de 35 KB (`ok-para-codigo-04out2026.md` 41 909 B, `apresentacao-bruno-cila-03out2026.md` 39 773 B, `vps-operada-por-nos-03out2026.md` 35 202 B): candidatas a um resumo à cabeça, sem apagar nada.

## O que não se verificou

- Se cada teste de isolamento falha quando a protecção é retirada (exige correr).
- Se o SDK do MCP impõe PKCE S256; se erros da base deixam valores nos registos; a retenção dos registos de acesso do nginx.
- O conteúdo jurídico das fontes das skills (fotografia de 05/10/2026, **W**).
- O texto do #38 e de outros *issues* (os agentes não tinham acesso ao GitHub).
- Partes das referências das skills complementares (cada bloco diz quais).

## Revisão

_Por publicar: revisor independente (agente `eurolify-critical-review`, Opus 5.5), ADR-0035._
