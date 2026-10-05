# ADR-0034 · Seguir o plano do pacote complementar: motor de regras por país primeiro, digital e vales desenhados

- **Estado:** aceite
- **Data:** 04/10/2026
- **Quem decidiu:** Diogo
- **Decisão em aberto de origem:** P3 de `docs/14-dominio-catalogo.md` (tipos
  de artigo na Fase 1); nova

## Contexto

O Diogo enviou a 04/10/2026 um pacote de 26 skills (zip, sha256 começa por
`472f5e0aed0a53ea`; 32 ficheiros, 111.839 bytes), com um «prompt inicial». O
Claude propôs trazer só os temas novos e não seguir o prompt nas partes que
chocam com o ADR-0023 e com a P3; o Diogo aceitou e, a seguir, mandou seguir o
prompt, com as palavras dele:

> *«Usa /eurolify-platform-orchestrator no repositório Eurolify. […] Não
> excluas produtos digitais e cartões-oferta só por faltarem regras: identifica
> as dependências e usa as duas skills específicas para os desenhar. Não os
> ativas em produção antes dos respetivos gates. […] Cria
> docs/eurolify/architecture.md, implementation-plan.md e compliance-gaps.md.
> Usa o registo dos 27 países, sem inventar taxas, prazos ou transposições.
> Propõe a primeira fatia implementável, implementa-a e executa os testes […]
> Usa as skills de apoios para preparar um diagnóstico de financiamento
> separado […] Usa /eurolify-channel-governance para modelar distribuidores,
> revendedores, franchisados e clientes finais.»*

## Opções consideradas

| Opção | A favor | Contra |
|---|---|---|
| a) Só os temas novos, adaptados (proposta do Claude) | uma skill por tema; nada decide a P3 | não era o que o Diogo pediu a seguir |
| **b) Seguir o prompt, dentro das regras do repositório** | o Diogo decide a P3 e o rumo; o desenho continua antes do código (ADR-0023) | mais documentos; as skills do pacote ficam por instalar |

## Decisão

Segue-se o prompt do pacote, dentro das regras do repositório:

1. **P3 respondida:** digital e cartões-oferta **desenham-se** com
   `digital-products-eu` e `gift-cards-eu` e **ficam desligados** até às
   portas deles (testes das skills e validação de jurista e contabilista).
2. **`docs/eurolify/`** com `architecture.md` (actores, canais, motor de regras),
   `implementation-plan.md`, `compliance-gaps.md` e
   `diagnostico-financiamento.md`. O `docs/02` continua a ser a arquitectura
   dos domínios.
3. **Primeira fatia: o motor de regras por país** (registo dos 27, todos por
   verificar; decisão pura; `GET /paises`), com o modelo e a API em tabela no
   `architecture.md` §4 antes do código, como manda o ADR-0023.
4. **As skills do pacote leram-se a partir do zip e não foram instaladas.**
   Instalá-las é outra decisão: dez delas repetem temas que já têm skill nossa
   (`memoria/pacote-complementar-skills-04out2026.md`).

## Consequências

- O motor de regras passa a ser o sítio onde cada regra nacional entra, com
  fonte, vigência e revisor; enquanto nada estiver verificado, **todas as
  decisões saem «revisão necessária»** — nenhuma venda é permitida por ele.
- O código desta fatia entra no `main` só com a revisão de uma sessão nova do
  Claude Code (ADR-0030, ADR-0031). *Nota de 05/10/2026: desde o ADR-0035, a
  revisão pode ser de um agente lançado da própria sessão.*
- Pode partir: um domínio que ignore o motor e decida sozinho (`AGENTS.md`,
  «Uma regra, um sítio»); o `GET /paises` é provisório até haver a versão por
  data e a autenticação da API de Administração.

## O que ficou por verificar

- As fontes do EUR-Lex citadas pelo pacote (a sessão recebeu respostas vazias).
- As 11 das 12 páginas da lista de avisos do COMPETE 2030 que não foram lidas.
