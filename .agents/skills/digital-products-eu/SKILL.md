---
name: digital-products-eu
description: Produtos digitais no Eurolify, só na UE — distinguir conteúdo digital (ebook, ficheiro), serviço digital (SaaS, armazenamento) e serviço humano prestado à distância (formação ao vivo, consultoria por vídeo); livre resolução e a perda dela por início da execução (consentimento, reconhecimento e confirmação, por linha), desconformidade, IVA dos serviços prestados por via electrónica e prova do país do cliente, quem é o fornecedor perante o IVA numa plataforma, entrega autenticada e direitos de acesso, subscrições, carrinho misto e os testes que impedem o lançamento. Usar ao desenhar ou alterar artigos digitais, o checkout de uma linha digital, licenças, descargas ou subscrições. Não serve para cartões-oferta (`gift-cards-eu`).
---

# Produtos digitais (só na UE)

> Estado: **desenho** — o código está autorizado (ADR-0023), mas o deste
> domínio só depois do desenho dele em tabela. **Desenha-se e fica desligado**
> até à porta (os testes desta skill e a validação de jurista e contabilista):
> decisão do Diogo, 04/10/2026 (ADR-0034, P3 do `docs/14`).
>
> Origem: pacote enviado pelo Diogo a 04/10/2026, adaptado às regras do
> repositório (`referencias/ORIGEM.md`). 🔴 **Todas as regras desta skill são
> C**: as fontes citadas são do EUR-Lex, mas **não foram lidas por nós** (o
> EUR-Lex recusou a leitura a partir da sessão, 04/10/2026). Excepção: o art.
> 16.º, alínea m), da Dir. 2011/83/UE já está **W · texto lido** na
> `consumer-rights-eu`. **Validação: jurista e contabilista.**

## Leitura obrigatória

- `referencias/regras-legais.md` antes de decidir uma regra legal ou fiscal.
- `referencias/desenho-e-testes.md` antes de desenhar tabelas, fluxos ou
  testes.
- Junta-se a `consumer-rights-eu` (livre resolução, botão, confirmação),
  `eu-vat-oss-ioss` (IVA e OSS), `eu-gdpr-privacy` (consentimentos e dados),
  `payments-psd2-sca` (pagamento confirmado no servidor) e `catalog-pim` (o
  tipo de artigo).

## 🔴 Primeira regra: classificar antes de vender

Cada artigo digital tem **uma classificação para o consumidor** e **outra
para o IVA**, guardadas à parte, com quem classificou e quando:

| Para o consumidor | Exemplo | Para o IVA |
|---|---|---|
| **conteúdo digital** | ebook, ficheiro, música descarregável, curso gravado | avaliar se é serviço prestado por via electrónica |
| **serviço digital** | SaaS, armazenamento, plataforma | avaliar se é serviço prestado por via electrónica |
| **serviço humano à distância** | formação ao vivo com professor, consultoria por vídeo | **não** é automaticamente serviço electrónico |

Não se deduz uma classificação da outra, nem «é entregue pela Internet»
⇒ «é serviço electrónico». Sem classificação, **o artigo não se publica**.

## Regras

1. **Só na UE.** Lista dos 27 Estados-membros, perfis fiscais por território
   com versão. UE ≠ EEE, Reino Unido ou Suíça. O país do cliente **nunca** se
   decide pelo IP, pela língua ou pela nacionalidade (geobloqueio,
   `eu-localization`).
2. **A perda da livre resolução não vem de termos gerais.** Num conteúdo
   digital pago, só se perde com **consentimento prévio expresso**,
   **reconhecimento** da perda e **confirmação** em suporte duradouro
   (`consumer-rights-eu`, **W · texto lido**). Caixa **vazia** por omissão,
   por **linha**, separada do consentimento de marketing. Sem ela, a compra
   faz-se na mesma e a entrega espera pelo fim do prazo.
3. **Serviço digital não é conteúdo digital.** Começar a usar uma subscrição
   não extingue o direito; segue o regime dos serviços (**C**).
4. **Perder a livre resolução não tira a garantia.** Desconformidade e falta
   de fornecimento têm direitos próprios (Dir. 2019/770, **C**); «sem
   devoluções» nunca é resposta a um defeito.
5. **IVA por categoria, país, território, B2B/B2C e regime do vendedor**
   (`eu-vat-oss-ioss`). Classificação, prova do país ou taxa por resolver ⇒ o
   checkout **bloqueia**; nunca uma taxa de recurso nem taxa zero para
   contornar.
6. **Prova do país do cliente:** dois elementos que não se contradizem (ex.:
   morada e banco), guardados com a decisão de IVA (Reg. 282/2011, **C**). Um
   IP sozinho, ou com VPN, não chega.
7. **Quem é o fornecedor perante o IVA** escreve-se por comerciante: o Eurolify
   cobra? entrega? define os termos? A presunção do art. 9.º-A do Reg.
   282/2011 pode fazer da plataforma o fornecedor (**C**, contabilista).
   «Somos só software» não resolve.
8. **Pagamento recebido ≠ e-mail enviado ≠ execução iniciada.** São três
   factos, guardados à parte; a perda do direito só se avalia com o terceiro.
9. **Entrega autenticada:** ficheiros privados na UE, endereços assinados de
   curta duração, sem tokens nos registos (`observability-security`); um aviso
   de pagamento repetido dá **uma** entrega, **um** acesso e **um** documento
   fiscal (`platform-architect`, regra 6).
10. **Carrinho misto:** IVA, consentimento, entrega e reembolso **por linha**;
    o consentimento do ebook não toca na livre resolução do artigo físico.
11. **Leis futuras** só entram com acto publicado, data e âmbito; o resto vai
    para a lista de vigilância do `docs/03` (ex.: *Digital Fairness Act*).

## Antes de dizer «está feito»

- [ ] Cada artigo digital tem as duas classificações, com quem e quando.
- [ ] O consentimento e o reconhecimento estão por linha, com o texto, a
      versão e a língua, e a confirmação em suporte duradouro.
- [ ] Os 16 testes de `referencias/desenho-e-testes.md` correm e passam —
      uma lista escrita não é execução.
- [ ] O fornecedor perante o IVA está escrito por comerciante.
- [ ] Jurista e contabilista validaram; as regras deixaram de ser **C**.
