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

## Decisão do Diogo, 16/10/2026: o repositório passa a público

*«vou colocar publico»*; *«já está público»* (confirmado por `list_repos`,
`visibility: public`). Num repositório público os minutos dos executores
normais não se pagam. Antes da mudança procurou-se no histórico (1 374
commits): chaves privadas, tokens do GitHub, chaves da Stripe e da AWS,
endereços IP e e-mails. Nada de secreto; fica à vista o nome da VPS (ADR-0018),
o desenho da segurança, as decisões de negócio e o e-mail dos commits. Desde
14/10/2026 às 15:16 UTC todas as execuções davam «startup_failure».

## Seguimento, 17/10/2026: executor próprio

O bloqueio manteve-se; o Diogo pediu os testes numa máquina nossa. Proposta em
`executor-de-ci-proprio-17out2026.md` e no ADR-0046.

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
