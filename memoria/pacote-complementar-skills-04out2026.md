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
