# Arquitectura da entrada modular

Lê antes de definir módulos, pesquisa, seleção do comerciante ou rotas.
Os caminhos abaixo foram observados em 09/10/2026; relê-os na revisão atual.

## Pontos de integração

| Peça existente | Responsabilidade a preservar |
|---|---|
| `apps/hub/src/App.tsx` | Rotas, histórico, título, cabeçalho, idioma, sair e foco |
| `apps/hub/src/ecras/Inicio.tsx` | `api.eu()`, identidade e comerciantes da pessoa |
| `apps/hub/src/api.ts` e `contexto.tsx` | Contratos, erros, contexto e navegação |
| `apps/hub/src/ecras/{Artigos,Artigo,Equipa,Chaves,Conta}.tsx` | Fluxos existentes; não reescrever como parte do launcher |
| `apps/hub/src/textos/{pt,es,en}.ts` | Chaves iguais nas três línguas |

O código observado usa React/Vite e navegação própria, não Next.js.
Não introduzas outro router sem necessidade demonstrada e decisão técnica.

## Inventário inicial, não catálogo definitivo

| Entrada candidata | Rota observada | Contexto |
|---|---|---|
| Artigos | `/artigos?comerciante=…` | Comerciante; API confirma acesso |
| Equipa | `/equipa?comerciante=…` | Comerciante; ações limitadas pela API |
| Chaves de API | `/chaves?comerciante=…` | Comerciante; entrada atual só para `dono`, API decide |
| A minha conta | `/conta` | Pessoa; manter no cabeçalho, não duplicar sem razão |

Não há aqui prova de que outros domínios não existam. Pesquisa novamente
`App.tsx`, ecrãs, contratos e desenho; só acrescenta destinos confirmados.
A lista de domínios planeados não comprova que uma interface funcione.

## Contexto seguro

1. Sem sessão: fluxo existente para entrar; nunca mostrar módulos de outra pessoa.
2. Zero comerciantes: estado vazio orientado, mantendo acesso à conta e saída.
3. Um comerciante: pode selecionar-se para apresentação após resposta da API.
4. Vários: oferecer escolha clara; não usar silenciosamente o primeiro.
5. Mostrar nome e papel do contexto ativo junto ao launcher.
6. Ao mudar contexto: limpar resultados, erros e dados antigos; cancelar pedidos
   ou ignorar respostas atrasadas. Uma resposta do comerciante A nunca preenche B.
7. Contexto na URL, quando necessário, validado contra a API; não o tratar como
   autorização. Preservar ligações diretas, refresh e voltar/avançar.
8. Se a API não expõe capacidades, reutilizar apenas as regras de apresentação
   já documentadas. Não construir um motor paralelo de permissões no cliente.

## Registo e componentes

Define um registo tipado de apresentação com `id`, `chaveTitulo`,
`chaveDescricao` opcional, `icone`, `grupo` opcional, `ambito`, `destino` e
`ordem`. Tipifica `destino` para os caminhos internos admitidos; gera parâmetros
com as APIs de URL. Não aceites URLs arbitrários vindos de pesquisa.

Mantém uma só origem para a grelha e a pesquisa. O estado de implementação vem
da existência verificada do destino; a autorização vem dos contratos reais.
Grupos só quando o número real de módulos justificar a divisão.

Responsabilidades sugeridas, não nomes obrigatórios:

- `EntradaHub`: estado da pessoa, comerciante ativo e estados de carregamento.
- `PesquisaModulos`: filtro e contagem anunciada sem interromper a escrita.
- `GrelhaModulos`: lista semântica e ordem estável.
- `AtalhoModulo`: ícone decorativo, rótulo visível e ligação real.

Não crie `role="grid"` para uma lista de links: isso implicaria outro contrato
de teclado. Use `nav` com nome acessível e `ul/li` quando for navegação.

## Pesquisa sem promessa falsa

Começa com filtro dos módulos disponíveis: ignorar maiúsculas e acentos,
remover espaços exteriores, pesquisar rótulos traduzidos e termos controlados.
Usa «Pesquisar módulos» nas três línguas; não anuncies pesquisa de clientes,
faturas ou páginas sem backend que realmente a suporte.

O campo tem label acessível independente do placeholder, limpar com alvo
adequado, contagem `aria-live="polite"` sem anúncios excessivos e estado sem
resultados com ação para limpar. Não movas o foco a cada tecla. Não cries um
combobox se só filtras uma lista abaixo.

O atalho `/` é opcional: não o capturar em inputs, textarea, select,
contenteditable, composição IME ou com modificadores. Um atalho de carácter
único global exige mecanismo para desligar/remapear ou ficar limitado ao foco;
é preferível omiti-lo na primeira versão. Ver
[WCAG 2.2, 2.1.4](https://www.w3.org/TR/wcag/#character-key-shortcuts).

## Estados obrigatórios

| Estado | Apresentação e comportamento |
|---|---|
| A carregar | Estrutura estável, `aria-busy`, sem nomes fictícios |
| Pronto | Só módulos confirmados, ordem previsível |
| Sem comerciantes | Explicação e ações existentes, não uma grelha vazia muda |
| Sem módulos autorizados | Explicação distinta de erro e de pesquisa vazia |
| Sem resultados | Consulta preservada e limpar pesquisa |
| Erro de rede/API | Mensagem traduzida, repetir sem perder contexto seguro |
| 401 | Fluxo de sessão existente, sem detalhes privados residuais |
| 403 | Sem acesso; não sugerir que o módulo não está implementado |
| Mudança de contexto | Impedir interação com dados antigos e respostas cruzadas |

Não acrescentar favoritos, arrastar para ordenar, contadores, pesquisa global
ou persistência nesta fatia. Exigem desenho e critérios próprios.
