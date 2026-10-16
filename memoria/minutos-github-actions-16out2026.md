# Minutos pagos do GitHub Actions (16/10/2026)

Pedido do Diogo, 16/10/2026: a conta do GitHub está alta; escolheu cortar o
gasto do Actions (opção 3 de três: tornar público, executor próprio, cortar).
Tarefa #471, pedido #472.

## O que se fez

- `verificar`: um rascunho não corre nada (nem o trabalho que decide); um
  pedido só com documentos não corre `codigo`, `script-vps` nem `imagem`; o
  `script-vps` só corre quando muda `infra/`, o `Dockerfile` ou `.github/`.
  Na dúvida (lista vazia, erro do `grep`, falha do passo), corre tudo.
- `AGENTS.md`: testes na sessão antes do push, um push por pedido.
- Nota no ADR-0031.

## Números (com data e como se contaram)

- 16/10/2026: o Eurolify é o único privado dos repositórios destes trabalhos
  (`list_repos`); o `eur-lex` e o `eur-lex-arquivo` são públicos.
- Um `verificar` ≈ 18 min pagos: codigo ≈ 14 (testes 9,5, lint 2,5),
  script-vps ≈ 2, imagem ≈ 2 (execução 38585848164, passos do trabalho).
- A 14/10, 28 execuções do `verificar` entre as 11:28 e as 15:02 (lista das
  últimas 100 execuções). 2 555 execuções de todos os fluxos até 16/10.
- A API de utilização por execução devolve 0 ms pagos: não serve para medir.

## O que ficou por verificar

- O valor da conta e o preço por minuto: não tenho acesso à faturação.
- Os caminhos «rascunho» e «só documentos» numa execução real, e se a regra
  do `main` aceita trabalhos saltados como verdes (revisão do #472, P2-3).
- As imagens antigas do GHCR (espaço pago): por apagar, precisa de decisão.
- O orçamento a 0 € do Actions e do Packages: só o Diogo ou o Bruno.
