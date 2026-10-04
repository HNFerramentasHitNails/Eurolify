# Pacote complementar de skills (26) — lido, não instalado; o prompt dele seguido (04/10/2026)

**Pedido do Diogo (04/10/2026):** enviou o zip
`Eurolify___Pack_Complementar_de_Skills_UE__Com_rcio_Canais_e_Apoios.zip` e
depois o README dele em separado. Aceitou a proposta do Claude (*«sim, avança
com a tua proposta»*) e, a seguir, interrompeu e mandou seguir o «prompt
inicial» do pacote (texto no ADR-0034).

## O que se fez

- Li os 32 ficheiros na pasta temporária da sessão.
- `eurolify-digital-products-eu` e `eurolify-gift-cards-eu` são **iguais byte
  a byte** às do zip anterior (`diff -rq`), já instaladas como
  `digital-products-eu` e `gift-cards-eu`.
- Comparação das 21 novas com as nossas:
  - **repetem temas nossos (10):** orchestrator, invoicing-tax-adapters,
    payments-reconciliation, orders-returns, catalog-product-compliance,
    logistics-eu, enterprise-operations, localized-storefront,
    security-privacy, marketing-consent;
  - **tema novo, canais B2B (5):** channel-governance, distributors,
    resellers, franchising, final-customer;
  - **tema novo, entrada de comerciantes (1):** merchant-onboarding;
  - **processo (3):** country-rule-engine, regulatory-updates,
    launch-readiness;
  - **negócio (2):** portugal-funding, eu-funding.
- A proposta de juntar os canais numa `channels-competition-eu` foi
  interrompida pelo Diogo antes de se escrever; **nenhuma skill do pacote foi
  instalada**.
- Seguiu-se o prompt (ADR-0034): `docs/eurolify/` (architecture,
  implementation-plan, compliance-gaps, diagnostico-financiamento); primeira
  fatia = motor de regras por país em `apps/api/src/regras/`; P3 do `docs/14`
  respondida.

## Choques do pacote com as nossas regras

- O README manda copiar para `.claude/skills/` (contra o ADR-0010).
- O prompt mandava `docs/eurolify/architecture.md`: escrito como complemento,
  o `docs/02` continua a ser a arquitectura dos domínios.
- «Implementa a primeira fatia»: escolhida uma que não depende das perguntas
  do Catálogo e com o desenho em tabela antes do código (ADR-0023).
- Sem marcas W/M/C; grafia nova; estados em inglês. Nenhuma fonte de fora da
  UE.

## Números (com data e como se contaram)

- Zip: 32 ficheiros, 111.839 bytes (`wc -c`); sha256 começa por
  `472f5e0aed0a53ea` (04/10/2026).
- Motor de regras: 27 países × 7 domínios obrigatórios = 189 combinações, todas
  por verificar; 0 regras; 18 testes novos (`grep -c "it("`); `pnpm teste` na
  api: 20 passaram, 1 saltou (base) — 04/10/2026, Node 22 local.
- COMPETE 2030, `compete2030.gov.pt/avisos/` lida a 04/10/2026: 9 avisos
  abertos na primeira de 12 páginas.
- EIC Accelerator, `eic.ec.europa.eu` lida a 04/10/2026: TRL 6-8; subvenção
  abaixo de 2,5 M€; capital até 10 M€.

## O que ficou por verificar

- As fontes do EUR-Lex das regras de canais (Reg. 2022/720, Dir. 86/653,
  Reg. 2019/1150): a sessão recebeu respostas vazias do EUR-Lex.
- 11 das 12 páginas de avisos do COMPETE; Horizonte Europa, Europa Digital,
  InvestEU.
- Se as skills de canais e de entrada de comerciantes se instalam (e como).
- A revisão do código do motor por uma sessão nova (ADR-0030).

## Depois: o #37 entrou antes da revisão (04/10/2026)

- **O que aconteceu:** às 14:28 UTC lançou-se a sessão de revisão (`claude-fable-5-1`, sem a conversa). Às 14:33:46 a conta `HNFerramentasHitNails` tirou o #37 de rascunho e às 14:34:21 juntou-o. A revisão só foi publicada às 14:36:49. O registo da sessão de revisão não tem nenhuma chamada para juntar o pedido nem para mudar o estado dele; quem o fez, ao certo, não verifiquei.
- **O que a revisão achou:** 1 P0, 2 P1 e 9 P2.
  - **P0:** `decidir` com `dominios: []` saía «permitido» contra o registo vazio. Reproduzido nesta sessão.
  - **P1-1:** as datas sem fuso dependiam do fuso do servidor, e o `Date.parse` aceitava `"1"` e `"10/04/2026"`. Encontrado depois, nesta sessão: `2026-02-30` passava para 2 de Março.
  - **P1-2:** um registo incoerente passava em silêncio.
- **O que se corrigiu** (issue #39):
  - `instante.ts`, a leitura única de datas;
  - `validar.ts`, que impede a aplicação de arrancar com um registo incoerente;
  - `decidir` nunca permite sem uma regra aplicada;
  - os P2 1 a 7: domínio desconhecido, código de país inválido, registo congelado, esquema do `GET /paises` fechado, testes tautológicos substituídos, e a tabela §4.2 do `architecture.md` acertada.
- **Números** (04/10/2026, `grep -c "it("` e `pnpm teste`): 33 testes do motor; a API com 35 a passar e 1 saltado. Repetido com o servidor nos fusos de Paris, Kiritimati e Los Angeles.
- **O que ficou por fazer:** P2-8 (testar localmente em Node 24) e P2-9 (limite de pedidos na rota pública, quando houver autenticação).

## Depois: o #40 também entrou antes da revisão (04/10/2026)

- **O que aconteceu:** o #40 foi juntado às 14:51 UTC; a revisão da sessão nova (`claude-fable-5-1`) saiu às 14:58 UTC ([#40](https://github.com/HNFerramentasHitNails/Eurolify/pull/40#pullrequestreview-5406771672)). Quem o juntou, ao certo, não verifiquei. O Diogo pediu: *«corrige o P1 e os P2 num commit novo»* — como o #40 já estava no `main` e o ramo tinha sido reaproveitado pela fatia 2 (#43), as correcções foram num ramo novo a partir do `main`.
- **O que a revisão achou:** sem P0; 1 P1 e 6 P2.
  - **P1-1:** `decidir` tratava como verificado qualquer estado que não fosse `por_verificar` nem `nao_aplicavel`; com um estado com gralha e uma regra em vigor saía «permitido» (medido). Só não era P0 porque `criarApp` valida antes. Corrigido: só `verificado` chega às regras, e o `validar` lista estados desconhecidos.
  - **P2:** `validar` rebentava com `TypeError` numa regra de domínio desconhecido; `constructor`/`__proto__` passavam por domínio em `decidir`, e `dominios: null` rebentava; uma `proposta` da mesma regra contava como sobreposição (falso positivo, impedia o arranque); campos de prova vazios (`base`, `revistaPor`, `revistoPor`, `id`, `versao`) passavam; o `Type.Enum` do `GET /paises` não trava na serialização (medido: `codigo: "XX"` sai com 200), ao contrário do que a descrição do #40 dizia; o alcance do fuso em `instante` era decidido pelo `Date.parse`, não pela expressão.
- **Números** (04/10/2026, `grep -c "  it("` e `pnpm teste`): 38 testes do motor; a API com 40 a passar e 1 saltado (base, sem PostgreSQL). Repetido em Node 24.21.0 e com o servidor em Paris e Kiritimati.
- **O que ficou por verificar:** a semântica de `proposta` na skill do pacote (assumiu-se que coexiste com a versão em vigor, a partir do §4.2); P2-9 do #37 (limite de pedidos) continua à espera da autenticação.

## A revisão do #45 chegou antes de juntar (04/10/2026)

- **O que se fez:** a sessão de revisão (Opus 5.5, sem a conversa) publicou às 15:29 UTC ([#45](https://github.com/HNFerramentasHitNails/Eurolify/pull/45#pullrequestreview-5406880633)): sem P0; 1 P1 e 6 P2. Pela primeira vez neste motor a revisão chegou antes do `main`.
- **P1-1:** o mesmo padrão do P1 do #40, no campo ao lado. `regraEmVigor` só excluía `"proposta"` por igualdade exacta, e o `validar` não verificava o `estadoLegal`: uma `"Proposta"` com maiúscula passava a porta de arranque e saía «permitido» (medido pelo revisor). Corrigido pela positiva (`em_vigor`, `adoptada_futura`, `revogada`) e listado no `validar`. A lição «varrer, não remendar»: na correcção do #40 devia ter-se procurado o mesmo padrão em todos os campos de estado, não só no da revisão.
- **P2:** domínio fora dos 11 mas presente no perfil (`decidir` passa a usar a lista dos 11); `null` e formas erradas em revisões, `dominios`, `territorios` e `base` ficam listados; `territorios: ""` deixa de contar como «sem território»; a mesma `id` em dois países ou domínios é erro; `-00:00` recusado (RFC 3339 §4.3); teste próprio para o estado desconhecido sem regra. Fica: `+23:59` aceite (é ISO válido; está escrito em `instante.ts`).
- **Números** (04/10/2026, `grep -c "  it("` e `pnpm teste`): 44 testes do motor; a API com 46 a passar e 1 saltado.

## Segunda volta da revisão do #45 (04/10/2026)

- **O que se fez:** a revisão de `8a9d31f` (Fable 5.1, sessão nova) saiu às 15:44 UTC ([#45](https://github.com/HNFerramentasHitNails/Eurolify/pull/45#pullrequestreview-5406941876)): sem P0; 1 P1 e 3 P2. Confirmou o P1 anterior fechado.
- **P1-1:** a varredura das formas (P2-2 anterior) deixou de fora os `territorios` do **perfil**. Com um texto, `includes` passava a ser pesquisa de subtexto: `"PT-30"` mapeava `"PT-3"`, passava o validador e saía «permitido». Corrigido em `decidir` e `validar` (só uma lista mapeia; o validador lista o erro). Terceira vez seguida que o achado é «o mesmo padrão no campo ao lado»: cada correcção de forma deve varrer **todos** os campos lidos, com `grep` de `?? []` e `.includes(`.
- **P2:** `instante` sem coerção (uma lista com um texto deixava de ser recusada); frase no §4.4: quando o registo passar para a base, cada versão passa pelo `errosDoRegisto` antes de ser servida (o revisor concordou que a `base` fica fora de `decidir`); um teste simplificado. Fica: a mensagem «undefined: a mesma id…» com duas regras sem `id` (verdadeira e listada ao lado de «sem id»).
- **Números** (04/10/2026, `grep -c "  it("` e `pnpm teste`): 46 testes do motor; a API com 48 a passar e 1 saltado.

