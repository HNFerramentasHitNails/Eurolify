# Responsivo por espaço disponível

Lê antes de definir grelha, cabeçalho, pesquisa ou navegação em ecrãs estreitos.
As medidas seguintes são decisões propostas para este launcher.

## Grelha e anatomia

Mobile primeiro. Usa CSS Grid com `minmax(0, 1fr)` e número de colunas ajustado
à largura útil do contentor, não ao modelo do dispositivo. Usa container
queries se adequadas à base suportada, com fallback por media queries.

| Largura útil da grelha | Colunas preferidas |
|---|---|
| Menos de 480 px | 2 |
| 480–639 px | 3 |
| 640–879 px | 4 |
| 880–1039 px | 5 |
| A partir de 1040 px | 6 |

Reduz para uma coluna se o conteúdo ou aumento de texto o exigirem.
Não forçar seis colunas só por ser desktop; painéis laterais e zoom retiram
largura útil. Com poucos módulos, preserva o tamanho e a ordem, sem esticar
ícones nem inventar entradas para preencher a linha.

Cada item contém uma pequena superfície quadrada com ícone e o rótulo abaixo,
ambos dentro da mesma ligação. Espaço vertical inicial 24–32 px; horizontal
12–24 px. O cartão completo tem foco e área de toque.

Rótulos ocupam normalmente até duas linhas, mas podem crescer: sem corte,
line-clamp, altura fixa, tooltip como única alternativa ou abreviatura
automática. Usa `min-width: 0` e quebra de palavras longas. Ordem DOM e ordem
visual iguais; sem `grid-auto-flow: dense` a mudar a leitura.

## Estrutura por tamanho

- **Mobile:** padding lateral inicial 16 px, pesquisa a toda a largura,
  cabeçalho que quebra linhas, contexto do comerciante legível. Nada essencial
  escondido em hover. Não introduzir bottom navigation sem necessidade.
- **Tablet:** padding 24 px, grelha com 3–5 colunas conforme a largura útil,
  utilização confortável em retrato e paisagem e com teclado aberto.
- **Desktop:** padding 32 px, contentor até 1120 px, pesquisa centrada até
  640 px e grelha de até seis colunas. Não alargar a ficha de artigo por efeito
  colateral do launcher.

Usa fluxo normal para a altura da página; `min-height` em vez de altura fixa.
Se precisas de unidades de viewport, considera `dvh` com fallback e safe areas.
Não uses `100vw` dentro de contentores com padding nem `overflow-x: hidden`
para disfarçar elementos largos.

## Toque, teclado e ampliação

Adota alvos de pelo menos 44 × 44 CSS px como regra do projeto.
Não os confundas com o mínimo AA de 24 × 24 CSS px com exceções: 44 × 44 é
o critério Enhanced de nível AAA. Ver
[WCAG, Target Size Enhanced](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html)
e [WCAG 2.2, 2.5.8](https://www.w3.org/TR/wcag/#target-size-minimum).

O reflow deve preservar informação e função a uma largura equivalente a
320 CSS px, sem deslocação em duas dimensões para este launcher; 1280 px
a 400% é um caso de teste, conforme
[W3C, Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html).

Testa 200% de tamanho de texto e zoom real a 400%; viewport estreito por si só
não comprova todo o comportamento de zoom. Não bloquear zoom em viewport meta.
Verifica teclado virtual, rotação e foco que não fica coberto por cabeçalhos.

## Desempenho

Sem imagens de fundo pesadas ou animações contínuas. Ícones locais,
estáveis e decorativos quando o rótulo já dá o nome acessível. Evita filtros
em grandes camadas fixas e `will-change` permanente em todos os cartões.

Mede scroll, digitação e mudança de tema/contexto antes e depois, com os
mesmos dados e ambiente. Se houver regressão percetível, reduz primeiro
blur e área filtrada; preserva texto e alvos. Não inventar FPS, percentis
ou resultados de equipamento real a partir de emulação.
