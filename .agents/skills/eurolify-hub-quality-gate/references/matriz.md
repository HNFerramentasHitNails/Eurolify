# Matriz de aceitação

Lê antes de testar. `P` significa passou com evidência, `F` falhou e `NV`
não verificado; `NA` só com justificação. Sem checkmarks pré-preenchidos.

## Cobertura obrigatória

| Eixo | Casos |
|---|---|
| Larguras CSS | 320, 375, 390, 768, 820, 1024, 1280 e 1440 px |
| Orientação | Mobile e tablet em retrato e paisagem |
| Tema | Claro e escuro em todas as larguras |
| Idioma | PT/ES/EN a 375, 768 e 1280 px; maior rótulo nas restantes |
| Ampliação | Texto 200%; zoom real 400% a partir de desktop de 1280 px |
| Superfície | Vidro e modo opaco manual; sem suporte ao filtro; redução de transparência |
| Preferências | Movimento reduzido e forced colors |
| Navegadores | Chromium, Firefox e WebKit, com versão; Safari real separado |
| Pessoas/contextos | Sem sessão; zero, um e vários comerciantes; papéis documentados |
| Dados | Poucos módulos reais, pesquisa longa, zero resultados e rótulos longos |
| Dispositivos | Pelo menos um mobile e um tablet reais antes de afirmar validação nesses equipamentos |

Base visual: as oito larguras nos dois temas, pelo menos 16 capturas do
launcher pronto. Não é o total da auditoria: juntar estados, idiomas,
orientações e fallbacks. Em Firefox/WebKit testar no mínimo 375, 768 e
1280 px, ambos os temas. WebKit emulado não equivale a Safari num iPhone.

Conjunto com muitos módulos apenas como fixture isolada e identificada,
nunca exposto como catálogo funcional em produção.

## Asserções automáticas a acrescentar

- `scrollWidth <= clientWidth + 1` na página e nos contentores relevantes,
  sem recortes artificiais. Exceções só em tabelas operacionais aprovadas,
  não no launcher.
- Cada destino tem `href` interno válido, título traduzido e contexto correto.
- Pesquisa não devolve módulos não autorizados nem cria destinos inexistentes.
- Um único foco por cartão; Enter navega; Tab/Shift+Tab percorrem em ordem.
- Ctrl/Cmd+clique e clique do meio preservam navegação nativa.
- Mudar comerciante cancela/ignora resposta anterior e não mistura resultados.
- 401/403, erros e vazio não expõem dados nem são tratados como sucesso.
- Alvos interativos >= 44 × 44 CSS px segundo a regra do projeto.
- Rótulos compridos não são cortados; imagens/ícones não causam saltos.
- Teste de traduções mantém chaves iguais.
- Testes de contraste cobrem superfícies reais e fallback, não só hex opacos.

Se a ferramenta de teste não simula `prefers-reduced-transparency`, usar uma
via determinística para testar a mesma variante e registar a preferência
nativa como não verificada; não mascarar a limitação.

## Passagem manual

Só teclado: salto para conteúdo, pesquisa, limpar, contexto, todos os cartões,
conta, sair, erros e tentar novamente. Foco visível e não encoberto; mudança
de rota atualiza título e foco depois do destino montar, não apenas antes.
Sem armadilhas; Escape só atua onde foi definido.

Leitor de ecrã: landmarks, título único, campo identificado, nomes dos links,
ícones sem repetição e anúncio contido dos resultados. Anotar combinação
concreta, por exemplo VoiceOver/Safari ou NVDA/Firefox, sem inventar teste.

Em toque: não depender de hover, não haver alvos sobrepostos, teclado virtual
não bloquear pesquisa e rotação não perder consulta nem contexto.

## Segurança e regressões

Usar só contas e dados sintéticos. A API deve recusar acesso mesmo quando
se altera manualmente URL, comerciante ou pedido. Falta de cartão não prova
controlo de acesso. Não persistir dados de sessão ou consultas fora do desenho.

Testar os fluxos existentes listados no SKILL.md e repetir contratos/testes
de API se forem tocados. Não alterar fiscalidade, autenticação, permissões
ou contratos só para satisfazer a composição visual.

## Relato de desempenho

Registar ambiente, massa de dados, build, configuração e medições antes/depois.
Rever scroll e pesquisa com/sem vidro. Não impor metas de bundle, FPS ou
latência sem baseline ou requisito já aprovado; qualquer novo orçamento deve
ser documentado como proposta. Sem telemetria externa.
