# Hub modular em Glassmorphism

Pedido de Diogo em 09/10/2026: preparar skills para o Claude Code orientar o
Hub por módulos como a imagem entregue, em Glassmorphism e totalmente
responsivo para tablet e mobile. Este documento fixa a direção pedida e os
limites da preparação; não é uma implementação nem aprovação de capturas.

## Direção e limites

A imagem é referência de composição: campo de pesquisa superior, grelha
regular, pequenas superfícies de ícones e rótulos abaixo. A adaptação proposta
é vidro discreto e funcional, sem converter o Hub em landing page ou painel
de métricas. Nomes, marcas, módulos e cores da imagem não são catálogo ou
identidade do Eurolify.

- **Âmbito:** entrada modular e shell partilhado quando necessário.
- **Preservar:** autenticação, contratos API, isolamento de comerciantes,
  rotas reais, traduções PT/ES/EN, temas e restante comportamento existente.
- **Fora desta preparação:** implementação da interface, novos domínios,
  pesquisa global de dados, favoritos, personalização persistente, deploy.
- **D-12:** a direção do Hub não decide logótipo, paleta ou identidade final.
- **Aprovação:** antes/depois da implementação continuam a ir ao Diogo ou
  Bruno; este pedido não aprova antecipadamente resultados ainda não vistos.

## Skills e responsabilidades

| Skill | Resultado |
|---|---|
| `eurolify-hub-modular` | Inventário verificável, contexto, navegação, pesquisa e estados |
| `eurolify-hub-glass-responsive` | Tokens, superfícies, fallback e layout adaptável |
| `eurolify-hub-quality-gate` | Matriz, testes, capturas, regressões e evidência |

São complementos específicos da `eurolify-design`, não substitutos das suas
38 referências. Ler só a skill da etapa e os recursos indicados. A primeira
encaminha para as restantes ao implementar e testar.

As skills de projeto do Claude Code usam `.claude/skills/<nome>/SKILL.md`
e podem ser invocadas por `/nome`, conforme a
[documentação do Claude Code](https://code.claude.com/docs/en/skills).
Neste repositório mantém-se a fonte única em `.agents/skills/` e ligações
em `.claude/skills/`, como já definido no ADR-0010.

## Desenho antes de código

| Componente | Decisão desta preparação | Verificação necessária na implementação |
|---|---|---|
| Contexto | Comerciante explícito; não escolher o primeiro silenciosamente | Zero/um/vários, URL, voltar, respostas atrasadas |
| Módulos | Só destinos implementados e permitidos | Inventário real, sem cartões vazios ou links falsos |
| Pesquisa | Inicialmente filtro de módulos | Rótulo honesto, acentos, línguas, vazio e limpar |
| Cartão | Superfície pequena com ícone; rótulo abaixo; uma ligação | Foco, clique nativo, toque, texto longo |
| Vidro | Seletivo, leve, opaco como base | Claro/escuro, contraste composto, sem suporte |
| Grelha | 2–6 colunas por largura útil; uma se necessário | 320–1440 px, orientações e zoom |
| Conteúdo operacional | Sólido ou quase opaco | Tabelas e formulários mantêm leitura e densidade |
| Novos valores | Tokens, não estilos locais repetidos | Sem regressões nas restantes páginas |

## Base observada

Consulta de 09/10/2026, commit `aeb07293bc02e7f2192504b93f896cee6fd2e031`.
`apps/hub` contém React/Vite/TypeScript, tokens CSS, Vitest, traduções e um
programa de capturas com `playwright-core`. `Inicio.tsx` lista comerciantes
e ligações para equipa, artigos e chaves; `App.tsx` tem navegação própria.
Este inventário deve ser revalidado antes de implementar.

O teste de contraste existente não mede automaticamente superfícies
translúcidas. O programa de capturas modifica uma instância PostgreSQL,
incluindo a palavra-passe de um papel: só se deve usar em instância dedicada,
isolada e descartável. A preparação das skills não executou esse programa.

## Política técnica de acessibilidade

Define-se WCAG 2.2 AA como objetivo técnico, sem declarar certificação legal;
4,5:1 para texto normal e reflow a 320 CSS px seguem
[WCAG 2.2](https://www.w3.org/TR/wcag/).
A regra interna de toque é 44 × 44 CSS px, mais exigente do que o mínimo
AA de 24 × 24 com exceções; ver
[W3C, Target Size Enhanced](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html)
e [WCAG 2.2, Target Size Minimum](https://www.w3.org/TR/wcag/#target-size-minimum).

A redução de transparência do sistema não é universalmente suportada,
conforme [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-transparency).
Por isso exige-se fallback sem filtro e modo opaco acessível na sessão.

## Prompt para iniciar no Claude Code

```text
/eurolify-hub-modular

Prepara e implementa a entrada modular do Hub conforme
docs/hub-modular-glassmorphism.md. Primeiro confirma o main, PRs e trabalho
concorrente; apresenta o inventário de módulos e rotas reais. Mantém o
launcher de ícones com rótulos, Glassmorphism discreto e fallback opaco.
Segue eurolify-hub-glass-responsive na implementação e
eurolify-hub-quality-gate na validação. Não inventes módulos, APIs,
permissões ou pesquisa global, não migres de stack e não alteres os fluxos
de negócio. Entrega capturas e resultados da matriz, indicando o que não
foi verificado. Não publiques sem a aprovação visual e o processo do repo.
```
