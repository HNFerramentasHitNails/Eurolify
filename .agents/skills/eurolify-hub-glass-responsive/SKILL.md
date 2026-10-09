---
name: eurolify-hub-glass-responsive
description: "Aplica Glassmorphism discreto e responsivo ao Hub Eurolify, com tokens, grelha modular, temas claro/escuro e fallback opaco. Usa ao estilizar o launcher ou shell em mobile, tablet e desktop; não para identidade definitiva, montra ou regras de negócio."
metadata:
  version: "1.0"
---

# Glassmorphism funcional e responsivo

Usa vidro como tratamento de superfície, não como motivo para esconder
informação. Mantém o launcher compacto da referência: pesquisa, ícones,
rótulos e espaço regular. Sem hero, gráficos inventados, efeitos 3D,
gradientes saturados, partículas, brilho pulsante ou animação contínua.

## Sequência de trabalho

1. Lê `.agents/skills/eurolify-design/SKILL.md`,
   `docs/hub-modular-glassmorphism.md`, `apps/hub/src/tokens.css` e
   `estilos.css`. Não substituas os tokens atuais nem declares D-12 resolvida.
2. Antes do CSS, lê `references/superficies-e-tokens.md`. Define globais →
   semânticos → componente, com equivalentes claro, escuro e opaco.
   Conclusão: valores concentrados nos tokens e superfícies legíveis sem blur.
3. Antes do layout, lê `references/responsivo.md`. Implementa mobile primeiro,
   por largura disponível, sem deteção de dispositivo. Conclusão: cartões e
   rótulos refluem a 320 px, com zoom e textos longos.
4. Implementa interações com HTML nativo e foco visível. Mantém tipografia do
   sistema e ícones SVG locais; não carregues fontes, ícones ou imagens de CDN.
5. Mede contraste sobre o fundo efetivamente composto; verifica claro/escuro,
   transparência reduzida e sem `backdrop-filter`. Não basta calcular os
   tokens opacos. Conclusão: medições e capturas reais, não apenas CSS plausível.
6. Entrega à `.agents/skills/eurolify-hub-quality-gate/SKILL.md`. Se o vidro
   prejudicar legibilidade, desempenho ou toque, aumenta a opacidade ou
   remove-o antes de reduzir conteúdo ou tamanho da letra.

## Invariantes

- Vidro seletivo no campo de pesquisa, pequenas superfícies dos ícones e,
  se necessário, shell. Tabelas, formulários e mensagens críticas usam
  superfícies sólidas ou quase opacas.
- Não uses `opacity` no contentor de texto para criar vidro.
- Não aninhes camadas de `backdrop-filter` nem animes blur, sombras ou fundo.
- Rótulos visíveis fora da pequena superfície do ícone; ícone e rótulo formam
  um único alvo navegável. Não tornar só o quadrado clicável.
- Foco e estado não dependem apenas de cor, transparência ou hover.
- As cores de categorias são distintas dos tokens de estados de negócio.
- Qualquer introdução de componente partilhado preserva as restantes páginas.

## Exemplo

Pedido: «Dar ao hub o efeito de vidro e adaptar ao tablet».

Resultado: tokens locais de superfície, grelha adaptável, foco contrastado,
temas claro/escuro, fallback opaco e capturas nas larguras exigidas.
Não é resultado aceitável diminuir toda a página com `transform: scale()`.
