---
name: eurolify-design
description: Design do Eurolify — montra (kit de loja e temas de cada comerciante), checkout alojado e momentos legais, Hub de gestão, e-mails e documentos; sistema de design com tokens e um tema por comerciante, claro/escuro, acessibilidade (EAA), PT/ES/EN, estados de ecrã, pesquisa com comerciantes e revisão. Traz uma biblioteca de 38 referências de terceiros (Anthropic, Vercel, designer-skills) a ler por etapa. Usar antes de desenhar, propor ou rever qualquer ecrã, componente, tema ou fluxo, e antes de falar com comerciantes sobre o produto.
---

# Design do Eurolify

> Estado: **desenho** — não há código (ADR-0001). A identidade visual do
> próprio Eurolify **ainda não está decidida** (D-12).
>
> Esta skill junta, numa entrada só, as regras de design do Eurolify e uma
> biblioteca de referências de terceiros em `referencias/`. **As regras do
> Eurolify ganham sempre às referências**; as referências estão em inglês e não
> conhecem nem a lei europeia nem as lições dos sistemas actuais.

## As três superfícies — objectivos diferentes

| Superfície | Quem a vê | O que manda | Quanto se pode ousar |
|---|---|---|---|
| **Montra** (kit de loja, temas, páginas de produto) | o cliente final | a marca **do comerciante**, por tema | muito: aqui serve a `frontend-design` |
| **Checkout alojado e momentos legais** (confirmação, livre resolução, garantia, faturas) | o cliente final | **clareza e prova**; o que a lei obriga não se personaliza | pouco: o comerciante muda cores, letra e logótipo, nunca o conteúdo legal nem a ordem |
| **Hub de gestão** | o comerciante e a equipa dele, todos os dias | **densidade, rapidez, estados claros** | nenhum: ferramenta de trabalho, sem decoração |

## Regras que não se negociam

1. **Nenhuma marca existente.** O Eurolify é da Luckytarget, com marca própria;
   a identidade visual dele decide-se (D-12) — nunca se inventa uma paleta ou um
   logótipo «definitivos». Tudo o que é aspecto do Eurolify vai **ao Diogo ou ao
   Bruno com o antes e o depois**, e só um deles dá o OK: nos sistemas actuais, um aspecto novo aprovado por
   outra pessoa e publicado em 14 commits foi todo revertido na mesma noite (01/10/2026,
   `regra-aspecto-so-com-ok-do-bruno-01out2026.md`, repo `claude`).
2. **Tokens em três níveis**: global (valores), semântico (`superficie`,
   `texto`, `accao-principal`, `estado-pago`…) e de componente. **Cada
   comerciante muda só os semânticos e os seus ficheiros de marca.** Nenhuma
   cor escrita num componente. Claro e escuro desde o primeiro dia.
3. **Um estado, uma cor.** No Hub interno actual, «pago» aparecia em quatro
   verdes diferentes e nenhum era legível — 4.811 cores escritas à mão
   (`cores-de-estado-11set2026.md`). No Eurolify os estados (pago, retida,
   expedida, devolvida…) são tokens semânticos únicos.
4. **Acessibilidade por omissão**, porque a lei a exige ao comércio
   electrónico desde 28/06/2025 (EAA — `docs/03-regulamentar-ue.md`): contraste
   de pelo menos 4,5:1 no texto, alvos de toque de 44 px, foco visível,
   navegação por teclado, movimento reduzido respeitado, texto alternativo em
   todas as imagens (traduzido). Nos sistemas actuais, um cabeçalho tinha 8 de
   9 peças abaixo do contraste mínimo, a pior a 1,73:1
   (`contraste-do-cabecalho-rosa-11set2026.md`). A norma de referência
   (EN 301 549 / WCAG) é **C** — confirmar a versão exigida.
5. **Primeiro o telemóvel.** Uma tabela de 743 px vista numa janela de 198 px
   mostra 27 % de cada vez (`tabela-em-cartoes-13set2026.md`): no Hub do Eurolify
   as listas têm vista de cartões no telemóvel desde o desenho.
6. **Português, espanhol e inglês desde o início.** Textos traduzíveis, sem
   letras maiúsculas forçadas nos rótulos, espaço para textos mais longos,
   datas, números e moedas formatados pela língua do cliente. Textos de produto
   e de interface em português no **masculino universal** («os clientes»).
7. **Todos os ecrãs têm os estados todos**: vazio, a carregar, erro, sem
   permissão, e — nos documentos fiscais — **retida, com o motivo e as saídas**.
   «Não encontrei» nunca se mostra como sucesso.
8. **A decisão vem do servidor.** Um ecrã mostra o preço, o IVA e o que a pessoa
   pode fazer como o servidor os decidiu; não os recalcula (ver
   `platform-architect`).
9. **Ver antes de dizer que está feito**: capturas a 375, 768 e 1280 px, em claro
   e escuro, e uma passagem só com teclado. Nos sistemas actuais, quatro passos
   feitos às cegas não viram um defeito que três fotografias de um telemóvel
   viram (`handover-responsivo-12-13set2026.md`).

## A biblioteca — o que ler, e quando

Ler **só o ficheiro da etapa em que se está**. Origem, licenças e o que ficou de
fora: `referencias/ORIGEM.md`.

### 1. Descobrir (Fase 0 — antes de desenhar ecrãs)

| Para | Ler |
|---|---|
| As conversas com 3 a 5 comerciantes (Fase 0) | `referencias/designer-skills/design-research/interview-script.md` |
| Que trabalho o comerciante «contrata» ao Eurolify | `referencias/designer-skills/design-research/jobs-to-be-done.md` |
| O percurso do comerciante e o do cliente final | `referencias/designer-skills/design-research/journey-map.md` |
| Eurolify contra Shopify, Shopware, PrestaShop | `referencias/designer-skills/ux-strategy/competitive-analysis.md` |
| O que está por trás de cada ecrã (pagamentos, faturação, armazém) | `referencias/designer-skills/ux-strategy/service-blueprint.md` |

### 2. Definir

| Para | Ler |
|---|---|
| Os princípios de design do Eurolify (propor ao Diogo ou ao Bruno) | `referencias/designer-skills/ux-strategy/design-principles.md` |
| O caderno de encargos de um ecrã ou fluxo | `referencias/designer-skills/ux-strategy/design-brief.md` |
| A arquitectura de informação do Hub e da montra | `referencias/designer-skills/ux-strategy/information-architecture.md` |
| Fluxos (checkout, livre resolução, onboarding) | `referencias/designer-skills/prototyping-testing/user-flow-diagram.md` |
| Esboços com especificação | `referencias/designer-skills/prototyping-testing/wireframe-spec.md` |

### 3. Sistema de design

| Para | Ler |
|---|---|
| Tokens (regra 2) | `referencias/designer-skills/design-systems/design-token.md` |
| Um tema por comerciante | `referencias/designer-skills/design-systems/theming-system.md` |
| Especificar um componente | `referencias/designer-skills/design-systems/component-spec.md` |
| Biblioteca de padrões | `referencias/designer-skills/design-systems/pattern-library.md` |
| Línguas e mercados | `referencias/designer-skills/design-systems/localization-design.md` (e a skill `eu-localization`) |
| Cor, escuro, letra, espaço, grelha | `referencias/designer-skills/ui-design/` — `color-system`, `dark-mode-design`, `typography-scale`, `spacing-system`, `layout-grid` |

### 4. Ecrãs e interacção

| Para | Ler |
|---|---|
| Direcção visual de uma montra ou tema | `referencias/anthropic/frontend-design.md` — **só na montra** |
| Hierarquia e responsivo | `referencias/designer-skills/ui-design/visual-hierarchy.md`, `responsive-design.md` |
| Painéis e gráficos do Hub | `referencias/designer-skills/ui-design/data-visualization.md` |
| Formulários (checkout, perfil de faturação, NIF) | `referencias/designer-skills/interaction-design/form-design.md` |
| Erros, carregamentos, estados | `referencias/designer-skills/interaction-design/` — `error-handling-ux`, `loading-states`, `state-machine` |
| Menus e pesquisa do Hub e da montra | `referencias/designer-skills/interaction-design/` — `navigation-patterns`, `search-ux` |
| Primeira utilização do comerciante | `referencias/designer-skills/interaction-design/onboarding-design.md` |
| Textos da interface (traduzir para PT-PT e aplicar a regra 6) | `referencias/designer-skills/designer-toolkit/ux-writing.md` |

### 5. Testar e rever

| Para | Ler |
|---|---|
| Rever código de interface, regra a regra | `referencias/vercel/web-interface-guidelines.md` (cópia de 17/08/2026) |
| Auditoria de acessibilidade | `referencias/designer-skills/design-systems/accessibility-audit.md`, `prototyping-testing/accessibility-test-plan.md` |
| Avaliação heurística | `referencias/designer-skills/prototyping-testing/heuristic-evaluation.md` |
| Teste com utilizadores | `referencias/designer-skills/design-research/usability-test-plan.md` |
| Verificação antes de entregar | `referencias/designer-skills/design-ops/design-qa-checklist.md` |

## Onde as referências chocam com o Eurolify

- A `frontend-design` pede ousadia estética: vale para a **montra**, não para o
  checkout nem para o Hub.
- A lista da Vercel assume React/Next.js e aspas curvas inglesas; em português
  usam-se as aspas «».
- Nenhuma referência sabe de IVA, de NIF nem do botão de livre resolução: isso
  vem das skills `consumer-rights-eu` e `eu-vat-oss-ioss`.

## Antes de dizer «está feito»

- [ ] Nenhuma cor, tamanho ou espaço escrito à mão: tudo por token.
- [ ] Claro e escuro; 375, 768 e 1280 px; só teclado — vistos, não supostos.
- [ ] Estados: vazio, a carregar, erro, sem permissão (e retida, se fiscal).
- [ ] Textos em PT/ES/EN, masculino universal em PT, nada de maiúsculas forçadas.
- [ ] O que é aspecto do Eurolify foi ao Diogo ou ao Bruno com o antes e o depois.
