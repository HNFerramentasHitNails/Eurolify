# Superfícies e tokens

Lê antes de estilizar. Estes valores são ponto de partida proposto para o
Hub, não identidade aprovada nem garantia automática de contraste.

## Direção visual

Fundo neutro, com variação tonal estática muito leve se necessária para
tornar o vidro percetível. Pequenas superfícies translúcidas, contorno
delicado, sombra curta e ícones lineares de espessura consistente. Preservar
o carácter de ferramenta de trabalho. O rótulo fica sobre fundo previsível.

Reutiliza `--texto`, `--texto-secundario`, `--foco`, `--accao-principal` e os
tokens de estado. Acrescenta valores globais de alpha, blur, sombra e raio,
sem escrever valores repetidos nos componentes. Semânticos apontam para
globais; tokens de componente apontam para semânticos.

| Token semântico proposto | Claro, ponto de partida | Escuro, ponto de partida |
|---|---|---|
| `--vidro-fundo` | Branco, alpha 0,84 | Cinzento 900, alpha 0,90 |
| `--vidro-fundo-forte` | Branco, alpha 0,96 | Cinzento 900, alpha 0,97 |
| `--vidro-fundo-opaco` | Superfície opaca clara | Superfície opaca escura |
| `--vidro-borda` | Derivado da borda existente | Derivado da borda existente |
| `--vidro-sombra` | Sombra curta e pouco intensa | Sombra curta, menos dependente de preto |
| `--vidro-desfoque` | 12 px de início | 12 px de início |

Começa em 8 px de blur nas superfícies pequenas em mobile e mede; não
ultrapasses 16 px sem benefício demonstrado. Estes limites são escolhas
deste pacote, não norma de acessibilidade.

| Token de componente proposto | Valor inicial |
|---|---|
| `--hub-largura-maxima` | 1120 px, apenas no launcher |
| `--hub-icone-superficie` | 64 px em mobile, 72 px em desktop |
| `--hub-icone-tamanho` | 30–36 px |
| `--hub-icone-raio` | 16–20 px |
| `--hub-pesquisa-altura-minima` | 48 px |
| `--hub-pesquisa-largura-maxima` | 640 px |
| `--hub-rotulo-tamanho` | 14 px, sem reduzir para caber |
| `--hub-rotulo-entrelinha` | 1,4 |
| `--hub-transicao` | 120–180 ms, apenas cor/opacidade/transform |

Regista valores nos níveis adequados. Não alteres `--raio` ou
`--largura-pagina` global só para mudar a entrada e desformatar as fichas.
CSS custom properties não funcionam como substituição geral de condições
`@media`: mantém breakpoints documentados num único sítio, sem sintaxe falsa
como `@media (min-width: var(--breakpoint))`.

## Progressive enhancement obrigatório

1. Base sem suporte: fundo sólido, borda, contraste e foco completos.
2. Só dentro de `@supports` para `backdrop-filter` ou
   `-webkit-backdrop-filter`, aplicar fundo translúcido e blur.
3. Colocar as regras de redução DEPOIS do enhancement, com especificidade
   suficiente: remover ambos os filtros e repor fundo sólido em
   `prefers-reduced-transparency: reduce`.
4. Disponibilizar modo opaco na interface, pelo menos durante a sessão,
   acessível por teclado e traduzido; não depender apenas da media query.
   Não acrescentar persistência sem atualizar o desenho de armazenamento.
5. Em `forced-colors: active`, remover blur e sombras decorativas, usar
   cores de sistema e bordas/foco reconhecíveis; não bloquear com
   `forced-color-adjust: none`.
6. Em `prefers-reduced-motion: reduce`, retirar movimento e scroll suave
   dos componentes novos. Hover só com `(hover: hover) and (pointer: fine)`.

`backdrop-filter` filtra o que está atrás do elemento e precisa de
transparência para o efeito aparecer; `opacity` num antepassado também pode
alterar o backdrop root. Ver
[MDN, backdrop-filter](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/backdrop-filter).

O suporte de `prefers-reduced-transparency` é limitado; o modo opaco manual
é a salvaguarda deste projeto, não uma garantia do navegador. Ver
[MDN, prefers-reduced-transparency](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-transparency).

## Contraste, sem resultados falsos

O objetivo técnico é WCAG 2.2 AA; texto normal tem mínimo 4,5:1 e elementos
gráficos/limites necessários para identificar controlos têm mínimo 3:1,
conforme [WCAG 2.2, 1.4.3 e 1.4.11](https://www.w3.org/TR/wcag/).
O projeto mantém 4,5:1 também nos rótulos pequenos e não usa a exceção de
texto grande como desculpa para os enfraquecer.

Usa foco com contorno sólido de pelo menos 2 px e afastamento que não seja
cortado, verificando 3:1 com o fundo adjacente. Não chames ao contorno de
2 px, por si só, prova de conformidade AA ou AAA.

- Mede texto e ícones funcionais sobre os piores fundos reais de cada tema.
- Quando há alpha, calcula a cor composta antes da luminância. Num fundo
  variável ou filtrado, confirma os fundos renderizados; um único pixel não
  prova o ecrã inteiro.
- Mantém e amplia `apps/hub/test/contraste.test.ts`: o parser atual resolve
  hex e uma referência global, não comprova RGBA nem cadeias de três níveis.
  Não enfraqueças o teste para aceitar uma string sem medição.
- Se não conseguires provar contraste numa área, torna essa área opaca.
- Não apresentar cumprimento técnico como certificação legal EAA; manter a
  verificação legal separada conforme a skill de design existente.
