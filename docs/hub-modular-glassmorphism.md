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

## Primeira implementação: a entrada `/` (issue #218)

Pedido do Diogo, 09/10/2026: *«avança»*, sobre a implementação da entrada
modular. Base: `main` em `ef8a2b2`. Este é o desenho; o código vem no mesmo
pedido, depois desta secção.

### Inventário verificado

| Módulo | Âmbito | Rota real | Origem da permissão | Estados | Evidência |
|---|---|---|---|---|---|
| Equipa | comerciante | `/equipa?comerciante=…` | ser membro (sessão do comerciante; `GET /hub/members`); sem âmbito próprio | funcional | `apps/api/src/identidade/hub.ts` (`/hub/members`, `ambito: "sessao_comerciante"`); `Inicio.tsx` mostrava-a a todos |
| Artigos | comerciante | `/artigos?comerciante=…` | `catalog:read` nos `ambitos` do `/hub/me` | funcional | `Inicio.tsx:69` (#212) |
| Chaves de API | comerciante | `/chaves?comerciante=…` | `keys:write` nos `ambitos` do `/hub/me` | funcional | `Inicio.tsx:82` (#212) |
| A minha conta | pessoa | `/conta` | sessão | funcional; fica no cabeçalho, **não** na grelha | `App.tsx` (ligação no cabeçalho) |

A ficha do artigo (`/artigos/{prd_…}`) e a edição (#210, só desenhada) são
páginas de dentro de Artigos, não módulos. Encomendas, clientes, stock,
pagamentos, faturas e envios **não têm ecrã**: não entram na grelha. Com os
quatro papéis de hoje (`apps/api/src/identidade/papeis.ts`), o dono vê 3
módulos, o gestor e o apoio 2, o armazém 2.

### Contexto do comerciante

- Lido do `/hub/me` uma vez. Mudar de comerciante não faz outro pedido: os
  módulos saem dos mesmos dados, por isso não há resposta atrasada de A a
  preencher B. A pesquisa e o seu estado recomeçam a cada comerciante.
- O comerciante activo vai no endereço: `/?comerciante=mer_…` (o mesmo
  parâmetro das outras páginas). Recarregar, voltar e avançar mantêm-no. O
  endereço não é autorização: só se aceita um comerciante da lista do
  `/hub/me`; os módulos abrem páginas cuja API confere tudo outra vez.
- Zero comerciantes: o texto de hoje («Não pertence a nenhuma equipa…»).
- Um comerciante: escolhe-se esse, depois da resposta da API.
- Vários e nenhum no endereço: «Escolha o comerciante», com o nome e o papel
  de cada um, cada linha uma ligação. Nunca se escolhe o primeiro sozinho.
- Um comerciante no endereço que não está na lista: aviso e a mesma escolha.
- Com um comerciante activo: o nome e o papel por cima da grelha e, se houver
  mais do que um, «Mudar de comerciante» (volta a `/`).
- O «Voltar» de Equipa, Artigos e Chaves passa a levar o comerciante
  (`/?comerciante=…`), para não obrigar a escolher outra vez.

### Pesquisa

Filtro dos módulos disponíveis, rotulado «Pesquisar módulos» (não promete
pesquisar artigos, clientes nem faturas). Ignora maiúsculas, acentos e espaços
nas pontas; procura no nome do módulo e em termos fixos de cada língua (ex.:
Equipa → membros, convites, papéis). A contagem anuncia-se com
`aria-live="polite"`; sem resultados, diz qual foi a pesquisa e oferece
«Limpar». Sem atalho de tecla nesta versão. Nada se guarda no navegador.

### Aspecto (proposta, vai ao Diogo ou ao Bruno com as capturas)

- Grelha: lista de ligações (`nav` com nome, `ul/li`), cada uma com uma
  superfície pequena com o ícone (SVG local, decorativo) e o rótulo por baixo,
  tudo um só alvo. Colunas pela largura da própria grelha: 2 abaixo de 480 px,
  3 até 639, 4 até 879, 5 até 1039, 6 daí para cima. A página do Hub tem
  960 px no máximo (`--largura-pagina`), por isso a grelha fica em 928 px e
  **nunca passa das 5 colunas**; alargar a página só na entrada é uma
  decisão de aspecto, que fica para as capturas. Com 3 módulos, ficam 3
  células do mesmo tamanho, sem esticar.
- O campo de pesquisa tem uma borda própria (`--borda-controlo`), com pelo
  menos 3:1 contra o fundo nos dois temas; as outras caixas do Hub ficam
  com a borda de hoje.
- Vidro só no campo de pesquisa e nas superfícies dos ícones, sobre um fundo
  estático com um gradiente muito leve. Sem suporte de `backdrop-filter`, com
  `prefers-reduced-transparency`, em `forced-colors` ou com «Superfícies
  opacas» ligado, tudo opaco. «Superfícies opacas» é um botão na entrada;
  vale até fechar ou recarregar a página (sem armazenamento: o desenho de
  armazenamento do `docs/22` §5 só guarda a língua).
- Os valores novos são tokens em `tokens.css`; o resto do Hub não muda. O
  teste de contraste passa a medir também as cores compostas (vidro sobre os
  dois extremos do gradiente), nos dois temas.

### Fora desta fatia

Favoritos, ordenar, contadores, pesquisa global, guardar preferências, mudar
o cabeçalho das outras páginas, módulos novos.

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
