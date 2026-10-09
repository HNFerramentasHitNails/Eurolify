---
name: eurolify-hub-modular
description: "Define e implementa a entrada do Hub Eurolify por módulos, com pesquisa, contexto do comerciante e rotas reais. Usa para criar ou reorganizar o launcher e a navegação modular; não para a montra, checkout ou implementação dos domínios de negócio."
metadata:
  version: "1.0"
---

# Hub por módulos

Mantém a estrutura da referência do utilizador: pesquisa superior, grelha
regular, ícones em pequenas superfícies arredondadas e rótulos por baixo.
Não transformes a entrada num painel de métricas, landing page ou mosaico de
cartões grandes. Não copies marcas, nomes de módulos nem cores da imagem.

## Sequência de trabalho

1. Lê `AGENTS.md`, `.agents/skills/eurolify-design/SKILL.md` e
   `docs/hub-modular-glassmorphism.md`. Confirma o código e trabalho concorrente
   antes de usar o inventário datado. Conclusão: âmbito, base e conflitos
   identificados, sem alterar código de tarefas alheias.
2. Lê `references/arquitectura.md`. Escreve a tabela
   `módulo | âmbito | rota real | origem da permissão | estados | evidência`.
   Distingue funcional, só desenhado e por fazer. Conclusão: cada ligação tem
   destino e autorização verificáveis; não criaste módulos fictícios.
3. Define o contexto do comerciante e os estados antes dos componentes.
   Preserva os fluxos de entrada, conta, equipa, catálogo e chaves.
   Não inventes APIs para capacidades ou pesquisa. Se forem necessárias,
   desenha-as primeiro e trata o backend como trabalho separado.
4. Ao construir a interface, lê
   `.agents/skills/eurolify-hub-glass-responsive/SKILL.md`. Reutiliza React,
   Vite, TypeScript, tokens, traduções e navegação do projeto. Conclusão:
   pesquisa e cartões usam o mesmo registo tipado, sem listas divergentes.
5. Ao testar ou entregar, lê
   `.agents/skills/eurolify-hub-quality-gate/SKILL.md`. Mostra o antes/depois
   e separa preparado, implementado, verificado e publicado. Não publiques
   nem declares aprovação visual em nome do utilizador.

## Invariantes

- A API continua a decidir acessos. Esconder um cartão não é autorização.
- Nenhuma rota de página começa por `/hub/`, reservado à API.
- Cada cartão navegável é uma ligação com `href` real. Preserva abrir noutro
  separador, Ctrl/Cmd+clique, recarregar e voltar/avançar.
- Sem cartões navegáveis para destinos por construir. Um estado de acesso
  negado não se confunde com funcionalidade ainda não implementada.
- Todos os textos novos pertencem a `src/textos/{pt,es,en}.ts`.
- Não mudes frameworks nem introduzas bibliotecas de UI por conveniência.
- Não guardes contexto, favoritos ou pesquisas no navegador sem desenho
  aprovado; respeita os limites de armazenamento existentes em `docs/22`.

## Exemplo

Pedido: «Quero o início como uma grelha de aplicações».

Resultado: tabela de módulos confrontada com o código, seleção explícita do
comerciante quando necessária, grelha dos destinos existentes, filtro por
nome e testes de navegação/permissões. «Artigos» pode apontar para a rota
existente; «Encomendas» não ganha uma página vazia só para preencher a grelha.
