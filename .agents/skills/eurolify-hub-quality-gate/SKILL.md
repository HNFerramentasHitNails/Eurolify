---
name: eurolify-hub-quality-gate
description: "Valida o Hub modular Eurolify antes de declarar conclusão: responsividade, Glassmorphism, acessibilidade, permissões e regressões. Usa para testar, rever ou entregar alterações ao launcher e shell; não substitui auditoria legal, aprovação visual ou revisão independente do repositório."
metadata:
  version: "1.0"
---

# Porta de qualidade do Hub

Não aproves uma interface por parecer certa no CSS. Distingue testes
executados, verificações manuais, simulações e verificações bloqueadas.

## Sequência de verificação

1. Lê `AGENTS.md`, `docs/hub-modular-glassmorphism.md` e
   `references/matriz.md`. Regista commit, diff, âmbito, Node/pnpm,
   navegadores e ambiente de testes. Confirma scripts nos `package.json`.
2. Executa os comandos existentes aplicáveis: `pnpm run lint`,
   `pnpm run tipos`, `pnpm run teste` e `pnpm run construir`, na raiz.
   Para diagnóstico do Hub usa `pnpm --filter @eurolify/hub run teste`.
   Não inventes um comando `npm test` nem afirmes que testes de API passaram
   quando faltava PostgreSQL.
3. Prepara o ambiente visual isolado e percorre a matriz. Reutiliza/amplia
   `apps/hub/scripts/capturas.mjs`, não declares que a matriz nova já existe.
   **Esse script cria/apaga bases e altera a palavra-passe de um papel
   PostgreSQL. Só o executar numa instância descartável e dedicada**,
   nunca na VPS, base partilhada ou produção.
4. Mede contraste composto, overflow, alvos, teclado, foco e estados.
   Ferramentas automáticas apoiam, mas não substituem a inspeção visual,
   leitor de ecrã e teclado. Inclui claro/escuro e fallback opaco.
5. Regressão: entrar, convite, recuperação, conta, equipa, artigos, ficha e
   chaves continuam acessíveis nas rotas reais, incluindo ligações diretas.
   Testa comerciante errado e resposta atrasada ao mudar de contexto.
6. Preenche `templates/relatorio.md` com evidência real. Falhas de isolamento,
   segurança, navegação, contraste ou reflow bloqueiam aprovação.
   Evidência obrigatória em falta deixa a entrega «por verificar».
7. Mostra antes/depois ao utilizador e segue a revisão/PR definidos no
   repositório. Aprovação do desenho não é aprovação automática das capturas.

## Critério de conclusão

Conclui apenas com a matriz obrigatória coberta, bloqueios resolvidos,
regressões verificadas e evidência identificável. Não substituas uma falha
de teste por remoção da asserção, `skip`, `overflow: hidden` ou dados fictícios.

## Exemplo

Pedido: «Está pronto para mobile?».

Resposta aceitável: larguras, temas, navegadores, capturas e casos testados;
«Safari num iPhone real ainda não foi verificado» se for esse o caso.
Resposta inaceitável: «100% responsivo» porque há media queries no ficheiro.
