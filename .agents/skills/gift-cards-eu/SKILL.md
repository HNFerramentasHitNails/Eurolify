---
name: gift-cards-eu
description: Cartões-oferta no Eurolify, só na UE — distinguir vale comprado, cupão de desconto e crédito de um reembolso; vales de finalidade única (SPV) e de finalidade múltipla (MPV) e o IVA na venda e no resgate; registo de movimentos imutável (emissão, reserva, resgate, estorno, suspensão, cancelamento, reembolso), saldo parcial e resgates em concorrência; livre resolução e reembolso sem a excepção dos conteúdos digitais; códigos seguros; a porta financeira (PSD2 e moeda electrónica) para vales aceites por vários comerciantes; e os testes que impedem o lançamento. Usar ao desenhar ou alterar cartões-oferta, vales, saldo ou reembolsos em vale. Não serve para cupões de desconto nem para tratar um vale enviado por e-mail como conteúdo digital.
---

# Cartões-oferta (só na UE)

> Estado: **desenho** — o código está autorizado (ADR-0023), mas o deste
> domínio só depois do desenho dele em tabela. **Fora da Fase 1** enquanto a
> pergunta P3 de `docs/14-dominio-catalogo.md` não for decidida pelo Diogo ou
> pelo Bruno.
>
> Origem: pacote enviado pelo Diogo a 04/10/2026, adaptado às regras do
> repositório (`referencias/ORIGEM.md`). 🔴 **Todas as regras desta skill são
> C**: as fontes citadas são do EUR-Lex, mas **não foram lidas por nós** (o
> EUR-Lex recusou a leitura a partir da sessão, 04/10/2026). **Validação:
> contabilista (IVA), jurista (consumidor e enquadramento financeiro).**

## Leitura obrigatória

- `referencias/regras-legais.md` antes de escolher IVA, livre resolução ou
  enquadramento financeiro.
- `referencias/desenho-e-testes.md` antes de desenhar saldo, resgate ou
  reembolso.
- Junta-se a `eu-vat-oss-ioss`, `payments-psd2-sca`, `consumer-rights-eu`,
  `order-fulfilment` (devoluções) e `observability-security` (códigos e
  abuso).

## ⚠️ Choque conhecido com a `eu-vat-oss-ioss`

A `eu-vat-oss-ioss` (secção das notas de crédito) diz que, na **carteira**, «o
uso do saldo é desconto» (regra do Bruno, 28/09/2026, já marcada **C** à
espera do contabilista). Este pacote diz que um vale usado é **forma de
pagamento, não desconto**. **Até o Diogo ou o Bruno decidirem com o
contabilista, vale a regra da `eu-vat-oss-ioss`** para a carteira, e esta
skill só para cartões-oferta vendidos. Ninguém resolve o choque no código.

## 🔴 Primeira regra: classificar o programa antes de vender um vale

Cada programa de vales tem uma classe, com fundamento, versão e quem decidiu:

| Classe | Quando | IVA |
|---|---|---|
| **SPV** (finalidade única) | o local da entrega e o IVA devido são conhecidos ao emitir | na venda do vale, como se fosse a entrega; **não se repete no resgate** |
| **MPV** (finalidade múltipla) | não é SPV (vários locais ou taxas possíveis) | **no resgate**, sobre o que foi pago pelo vale; **não é «isento»** |
| **por resolver** | termos insuficientes | **não se vende** |

«Válido em toda a UE» não faz de um vale um SPV. Um vale emitido **não muda
de classe** depois.

## Regras

1. **Vale ≠ cupão ≠ crédito de reembolso.** O cupão só dá desconto; o vale
   paga. Cada um tem o seu fluxo.
2. **Primeiro programa: fechado, por comerciante**, sem recarga, sem
   transferência entre pessoas, sem conversão em dinheiro nem levantamento.
   Vales aceites por **vários comerciantes** ficam bloqueados até a porta
   financeira (PSD2, moeda electrónica) estar decidida com o jurista. Mesmo
   assim, estas limitações **não provam** que o programa fica fora da PSD2.
3. **Registo de movimentos imutável**: emissão, reserva, libertação,
   resgate, estorno, suspensão, cancelamento, reembolso. O saldo resulta dos
   movimentos; uma correcção é um movimento compensatório, nunca um `UPDATE`
   ao passado (`platform-architect`, regras 5 e 6).
4. **Separar** valor nominal, preço pago, saldo resgatável, reservas e base
   fiscal. Um vale vendido com desconto guarda o preço pago.
5. **Resgate atómico**: estado, comerciante, moeda, restrições e saldo
   validados na mesma transacção; dois resgates em simultâneo nunca deixam o
   saldo negativo.
6. **O vale só nasce com o pagamento confirmado no servidor**
   (`payments-psd2-sca`), nunca com o regresso do browser.
7. **Livre resolução:** um vale por e-mail ou com QR **não** cai na excepção
   dos conteúdos digitais; nunca a regra global «cartões-oferta não são
   reembolsáveis». O contrato do vale e o contrato do que se compra com ele são
   fluxos distintos.
8. **Reembolso** no meio de pagamento original por omissão; nunca trocar
   dinheiro por vale sem o consentimento que a lei pede. Um saldo suspenso por
   estorno bancário não volta sozinho.
9. **Códigos aleatórios fortes**, guardados protegidos, mostrados mascarados,
   com limite de tentativas e alertas; nunca números sequenciais; nunca o
   código inteiro em registos, análises ou ecrãs de administração.
10. **Só na UE**: emissor e vendedor na UE, territórios configurados, todos os
    percursos de dados e subcontratantes na UE. Nunca recusar um comprador de
    outro Estado-membro pela nacionalidade ou pelo IP (Reg. 2018/302,
    geobloqueio, **C**).

## Antes de dizer «está feito»

- [ ] O programa tem classe (SPV/MPV), fundamento, versão e quem decidiu.
- [ ] O saldo sai dos movimentos; os 21 testes de
      `referencias/desenho-e-testes.md` correm e passam.
- [ ] O choque com a carteira da `eu-vat-oss-ioss` está decidido.
- [ ] Porta financeira decidida com o jurista, se o vale sai de um comerciante.
- [ ] Contabilista e jurista validaram; as regras deixaram de ser **C**.
