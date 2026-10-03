---
name: third-party-extensions
description: Extensões de terceiros no Eurolify — aplicações, meios de pagamento, transportadoras, faturação por país, funções (regras de negócio em caixa fechada), extensões de ecrã e campos próprios; os contratos que o próprio Eurolify usa, os pontos de extensão, o que um terceiro nunca pode mudar (regras fiscais e legais), âmbitos e consentimento, dados na UE, loja de extensões (DSA, ciber-resiliência, prestadores autorizados) e a experiência de quem desenvolve. Usar ao desenhar qualquer contrato de adaptador, ponto de extensão, permissão de aplicação, a loja de extensões ou o programa de parceiros.
---

# Extensões de terceiros

> Estado: **desenho** — não há código (ADR-0001). Base:
> `docs/08-extensoes-de-terceiros.md`. Requisito K em `docs/06`.

## Quando usar

> Fase 2 (decisão L, 03/10/2026): os parceiros da lista de pagamentos e envios
> (`docs/07`) são convidados a escrever eles próprios o seu adaptador.

- Desenhar ou mudar um contrato (pagamento, envio, faturação).
- Criar um ponto de extensão novo para funções ou para o ecrã.
- Dar permissões a uma aplicação, ou mexer na loja de extensões.
- Falar com um parceiro que quer escrever o seu adaptador.

## 🔴 Regras que não se negociam

1. **O Eurolify usa os mesmos contratos que os terceiros.** Um adaptador nosso
   não tem atalhos que uma extensão não tenha — senão o contrato não está
   provado.
2. **Regras fiscais e legais não são extensíveis** (confirmado pelo Diogo,
   03/10/2026, decisão K). Decisão do IVA, NIF e
   VIES, livre resolução, preço dos 30 dias, páginas legais, retenção e
   conteúdo de documentos fiscais vivem no núcleo, uma vez. Uma extensão de
   faturação só **traduz** uma decisão já tomada.
3. **Pontos de extensão: lista fechada.** Desconto do carrinho, regra de
   portes, validação do carrinho, escolha do armazém, ordem e visibilidade dos
   métodos de pagamento e de entrega. Um ponto novo é uma decisão do Diogo ou
   do Bruno, registada.
4. **Funções correm numa caixa fechada**: sem rede, tempo e memória limitados,
   mesmo resultado para a mesma entrada.
5. **Fechado por omissão** (skill `observability-security`): âmbitos mínimos,
   consentimento do comerciante com os dados e o país de tratamento, registo de
   auditoria de cada acção, limites de pedidos, desligar a todos de uma vez.
6. **Dados na UE** (regra 4 do `CLAUDE.md`): a loja oficial só aceita
   extensões que tratem dados pessoais na UE ou que declarem a transferência e
   a base legal; acordo de tratamento de dados obrigatório.
7. **Só entra na loja quem pode exercer:** meio de pagamento com prestador
   autorizado (registo da EBA ou regulador nacional); faturação com software
   certificado no país; tudo com os testes de conformidade do contrato a passar.
8. **Uma extensão de ecrã nunca esconde nem tira um momento legal** do
   checkout (skill `consumer-rights-eu`).

## Antes de dizer «está feito»

- [ ] O contrato tem idempotência, versão por data, erros num formato único e
      «não encontrei» como erro.
- [ ] Há teste de conformidade que o adaptador do próprio Eurolify passa.
- [ ] Nenhum ponto de extensão novo toca numa regra fiscal ou legal.
- [ ] O ecrã de consentimento diz que dados e em que país.
- [ ] As regras da UE da loja (DSA, ciber-resiliência) foram vistas com fonte
      W/M/C (`docs/08` §7).
