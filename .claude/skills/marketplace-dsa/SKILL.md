---
name: marketplace-dsa
description: Preparação do Eurolify para marketplace com vendedores terceiros — integração de vendedores, verificação de empresas (KYB/KYC) por adaptador, identidade fiscal do vendedor, contas e comissões, rastreabilidade (art. 30.º do DSA), aviso e acção, moderação de conteúdos e produtos, recurso, transparência de publicidade e recomendações, DAC7. Usar quando alguém propuser vendedores terceiros, comissões ou «marketplace», e para travar lógica de marketplace na Fase 1.
---

# Marketplace e DSA

> Estado: **desenho** — não há código (ADR-0001). Fase 4 em
> `docs/05-fases-e-mvp.md`. Fontes: `docs/03-regulamentar-ue.md` §4.

## 🔴 Primeira regra

**Não se activa lógica de marketplace sem um caso de negócio escrito e
aprovado.** Um marketplace muda quem é o vendedor, quem cobra o IVA, por onde
passa o dinheiro e que leis se aplicam. Desenhar as costuras sim; ligar não.

## O que se prepara desde já (barato, evita reconstruir)

1. **O vendedor é uma entidade do modelo**, mesmo que na Fase 1 seja sempre o
   próprio comerciante: encomenda, linha, stock, documento fiscal e reembolso
   sabem **de que vendedor** são.
2. **O dinheiro nunca passa pelo Eurolify** (`payments-psd2-sca`): num
   marketplace usa-se o produto de plataformas do prestador.
3. **O documento fiscal é do vendedor**, emitido com os dados dele — ou, nos
   casos de fornecedor presumido (art. 14.º-A da Directiva IVA, **C**), da
   plataforma. Decide o contabilista antes de existir.

## Quando existir — o que a lei pede

| Obrigação | Instrumento | Nota |
|---|---|---|
| Aviso e acção (denúncia de conteúdo/produto ilegal, decisão fundamentada, recurso) | DSA (Reg. (UE) 2022/2065) | aplica-se a alojamento de conteúdos de terceiros, qualquer tamanho — **C** |
| **Rastreabilidade dos vendedores** (art. 30.º): obter e verificar identidade, contactos, registo comercial, conta de pagamento, autocertificação de conformidade | DSA, secção 4 | **micro e pequenas plataformas estão isentas** das secções 3 e 4, salvo se forem designadas muito grandes (**W**) |
| Desenho da interface que permita ao vendedor dar a informação de produto obrigatória (art. 31.º) | DSA | idem |
| Transparência de publicidade e de sistemas de recomendação | DSA | secção 3 — mesma isenção |
| Verificar o registo EPR de embalagens do vendedor | PPWR (Reg. (UE) 2025/40) | aplica-se desde 12/08/2026 (**W** parcial) |
| Comunicar rendimentos dos vendedores à autoridade fiscal | DAC7 (Dir. (UE) 2021/514) | **C** |
| Informar os consumidores de que compram a um terceiro e se ele é profissional | Dir. 2011/83/UE, alterada pela Omnibus | **C** |

## Modelo (para quando chegar a vez)

| Entidade | Campos essenciais |
|---|---|
| Vendedor | identidade legal, NIF/IVA com prova VIES, morada, registo comercial, representante, estado (pendente, activo, suspenso), data de verificação e por quem/que serviço |
| Verificação (KYB/KYC) | adaptador do serviço, resultado em bruto, documentos, validade |
| Conta de recebimento | no prestador de pagamentos, nunca no Eurolify |
| Comissão | regra (percentagem, fixa, por categoria), vigência, documento de faturação da comissão |
| Denúncia | quem, o quê, fundamento, decisão, fundamentação, notificação, recurso — **registo imutável** |

## Anti-padrões

- Aceitar vendedores «de confiança» sem verificação, para andar depressa.
- Somar o dinheiro de vários vendedores numa conta do Eurolify.
- Moderação sem decisão fundamentada nem recurso.
- Decidir identidade de vendedores pelo nome (regra do ecossistema).

## Antes de dizer «está feito»

- [ ] Existe o caso de negócio aprovado.
- [ ] Jurista validou o enquadramento DSA (incluindo a dimensão da plataforma).
- [ ] Contabilista validou quem emite e quem liquida o IVA.
- [ ] Prestador de pagamentos com produto de plataformas contratado.
