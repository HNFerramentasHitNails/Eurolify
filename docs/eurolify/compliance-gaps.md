# Eurolify — lacunas de conformidade

> **Versão de 04/10/2026.** Pedido do Diogo (ADR-0034). **Nada aqui está
> conforme por estar listado**: cada linha diz o que falta, quem fecha, de que
> depende e que prova a fecha. Uma lacuna `aberta` bloqueia só o âmbito dela
> (país, domínio, fatia). Junta-se a [`docs/03-regulamentar-ue.md`](../03-regulamentar-ue.md)
> (marcas W/M/C) e a [`docs/12-perguntas-para-o-jurista.md`](../12-perguntas-para-o-jurista.md).

## 1. O registo dos 27 países

Hoje (registo versão 1, `apps/api/src/regras/registo.ts`): **27 países × 7
domínios obrigatórios = 189 combinações, todas `por_verificar`**; 0 regras;
0 territórios mapeados (contado nos testes, 04/10/2026). Com isto, **nenhuma
venda é permitida pelo motor** em nenhum país.

| Domínio | O que cada país precisa | Responsável | Prova que fecha | Estado |
|---|---|---|---|---|
| consumidor | livre resolução e excepções, entrega, garantia e presunção de defeito, informação pré-contratual, língua, resolução alternativa de litígios | jurista | artigo da lei nacional lido, com URL oficial e data | aberta × 27 |
| iva | território de IVA, taxas por categoria e data, OSS, registos | contabilista | idem | aberta × 27 |
| faturacao | requisitos nacionais do documento, comunicação à autoridade, arquivo | contabilista | idem; adaptador certificado | aberta × 27 (Portugal: Moloni, D-4) |
| privacidade_marketing | autoridade competente, comunicações electrónicas, cookies, retenção | jurista | idem | aberta × 27 |
| produto_ambiente | segurança, rotulagem, sectores regulados, embalagens e responsabilidade alargada do produtor | técnico regulamentar | idem | aberta × 27 |
| acessibilidade_plataforma | obrigações por serviço e excepções; DSA | jurista | idem | aberta × 27 |
| pagamentos | prestador autorizado, papel da plataforma, vales | jurista | idem | aberta × 27 |
| territórios | Açores, Madeira, Canárias, Ceuta, Melilla e os outros da `eu-vat-oss-ioss` | contabilista | código postal → território, com fonte | aberta (nenhum mapeado) |

## 2. Lacunas por tema

| # | Lacuna | Âmbito que bloqueia | Responsável | Depende de | Prova que fecha | Estado |
|---|---|---|---|---|---|---|
| G1 | Fontes do EUR-Lex das skills `digital-products-eu` e `gift-cards-eu` e das regras de canais **não lidas** (a sessão de 04/10/2026 recebeu respostas vazias) | digital, vales, canais | quem tiver acesso ao EUR-Lex | — | artigo lido, marca **C → W** | aberta |
| G2 | Perguntas P1, P2, P4–P7 do Catálogo | fatia 3 | Diogo ou Bruno | — | resposta escrita no `docs/14` | aberta |
| G3 | Choque da carteira: «uso do saldo é desconto» (`eu-vat-oss-ioss`) contra «vale é pagamento» (`gift-cards-eu`) | fatia 13, carteira | Diogo ou Bruno + contabilista | — | decisão escrita | aberta |
| G4 | Quem é o fornecedor perante o IVA nos serviços electrónicos (presunção do art. 9.º-A do Reg. 282/2011, **C**) | fatia 12 | contabilista | — | parecer | aberta |
| G5 | Porta financeira dos vales aceites por vários comerciantes (PSD2, art. 3.º, alínea k), **C**) | fatia 13 alargada | jurista | — | parecer | aberta (programa fechado por comerciante não depende dela) |
| G6 | Regras de concorrência dos canais (Reg. 2022/720, Dir. 86/653, **C**) e leis nacionais de franchising | fatia 14 | jurista | G1 | parecer por política | aberta |
| G7 | O Eurolify é «serviço de alojamento» do DSA já na Fase 1? | fatia 3 em diante | jurista | — | resposta (`docs/03` §4) | aberta |
| G8 | Termos entre plataforma e empresas (Reg. 2019/1150): aplica-se a um SaaS? (**C**) | relação com os comerciantes | jurista | — | parecer | aberta |
| G9 | Motor de IVA validado | fatias 6, 10 | contabilista | — | validação escrita | aberta (`docs/05`, «antes do primeiro comerciante de fora») |
| G10 | Fluxos do consumidor validados (checkout, confirmação, livre resolução, garantia) | fatias 7, 11 | jurista | — | validação escrita | aberta (`docs/05`) |
| G11 | Contrato de serviço, acordo de tratamento de dados, limites de responsabilidade, seguro | abertura a comerciantes | jurista | — | documentos assinados | aberta (`docs/05`) |
| G12 | **Dados só na UE**: e-mail, registos, suporte, cópias e acessos remotos verificados fornecedor a fornecedor | produção | Diogo ou Bruno | — | contrato e localização de cada fornecedor | aberta; o ensaio está no Reino Unido até 31/03/2027, sem dados reais (ADR-0018/0019) |
| G13 | Acessibilidade (EAA) do checkout e da montra | fatias 7 em diante | — | — | auditoria; testes automáticos não chegam | aberta |
| G14 | NIS2: o Eurolify cabe num dos anexos? | operação | jurista | — | parecer (`observability-security`) | aberta |
| G15 | Revisão do código do motor por uma sessão nova (ADR-0030) | entrada no `main` | Diogo ou Bruno | — | revisão publicada no pedido | **o #37 entrou antes da revisão**; a revisão chegou depois (1 P0, 2 P1, 9 P2), corrigidos no #40 (issue #39), que também entrou antes da revisão (1 P1, 6 P2), corrigidos no #47 (issue #46), que entrou depois de revisto; o pedido seguinte (propostas e dois P2) também espera revisão **antes** de entrar |

## 3. O que não é lacuna, e porquê

- **Ligação à plataforma ODR:** não se põe; fechou a 20/07/2025 (`docs/03` §2).
- **Botão de livre resolução:** obrigatório desde 19/06/2026 — já está nas
  skills; é trabalho das fatias 7 e 11, não uma dúvida.
