---
name: product-compliance-eu
description: Conformidade de produto no Eurolify — atributos regulamentares do artigo (GPSR, cosméticos, químicos/CLP, embalagens/PPWR, mercadorias perigosas), operador económico e pessoa responsável na UE, documentos e evidências fornecidos pelo comerciante, identificadores, avisos por língua, lotes, alertas e recolhas, categorias regulamentadas e fórmulas com versões. Usar ao desenhar campos de artigo, a página de produto, recolhas, o envio de mercadorias perigosas, ou qualquer alegação de certificação.
---

# Conformidade de produto

> Estado: **desenho** — não há código (ADR-0001). Fontes e datas:
> `docs/03-regulamentar-ue.md` §3. **Validação: técnico regulamentar e
> jurista.**

## 🔴 Primeira regra

**O Eurolify nunca afirma que um produto está conforme ou certificado.** Guarda
o que o comerciante declara **e os documentos que o provam**, mostra o que a lei
obriga a mostrar, e avisa quando falta. Uma certificação sem documento anexado
e válido não aparece na loja.

## Quando usar

- Campo novo no artigo que tenha a ver com segurança, rotulagem, composição,
  embalagem ou transporte.
- Página de produto (o que tem de aparecer **antes** da compra).
- Recolha de um lote.

## Atributos regulamentares do artigo

| Grupo | Campos | Instrumento |
|---|---|---|
| **Operador económico** | fabricante (nome, morada, contacto electrónico); **pessoa responsável na UE** quando o fabricante é de fora | GPSR (Reg. (UE) 2023/988, **W**) |
| **Identificação** | tipo, modelo, lote ou série, fotografia, GTIN/EAN | GPSR art. 19.º (**W**, artigo não lido por inteiro) |
| **Avisos e instruções** | por **língua do país** onde se vende | GPSR |
| **Cosmético** | pessoa responsável, n.º de notificação CPNP, INCI, **fórmula com versão**, PAO/validade, rótulo | Reg. (CE) 1223/2009 (**C**) |
| **Mistura química** | classificação CLP, pictogramas, palavra-sinal, frases de perigo e prudência; **na venda online, todos os elementos do rótulo visíveis na oferta** a partir de 01/01/2028 | Reg. (UE) 2024/2865 adiado pelo 2025/2439 (**W**) |
| **Embalagem** | n.º de registo EPR **por país** onde se vende; materiais | PPWR (Reg. (UE) 2025/40), desde 12/08/2026 (**W** parcial) |
| **Transporte** | número ONU / classe ADR, restrições por modo (avião, mar) e transportadora | ADR/IATA (**C**) |
| **Alegações ambientais** | só com documento de prova | Dir. (UE) 2024/825, desde 27/09/2026 (**W**) |

Cada atributo tem: valor, **documento de prova** (ficheiro, emissor, validade),
quem o preencheu e quando. Atributo obrigatório em falta para um país ⇒ o
artigo **não se publica nesse mercado** e o comerciante vê porquê.

## Fórmulas com versões — o caso que o prova

O TPO, um fotoiniciador comum em géis de unhas, foi **proibido nos cosméticos a
01/09/2025 sem período de escoamento** (Reg. (UE) 2025/877, **W**). De um dia
para o outro deixou de se poder vender o que já estava em stock.

No Hub interno actual, o fornecedor troca fórmulas e os SKU mantêm-se
(`formulas-versionadas-cosmeticos-04set2026.md`, repo `claude`). ⇒ no Eurolify:

- O artigo aponta para **uma versão de fórmula** com o seu INCI.
- O **lote** sabe que versão de fórmula leva.
- Uma substância proibida numa data ⇒ consulta imediata: que artigos, que
  lotes, que stock, que encomendas por expedir — e bloqueio da venda no mercado
  afectado.

## Lotes, alertas e recolhas

- Lote na entrada de stock e **na linha expedida** — sem isso não se sabe a quem
  avisar (no Hub, os componentes dos kits, 40 % das saídas, saíam sem lote —
  `proposta-venda-do-hub-30set2026.md`).
- **Recolha**: abre-se sobre um lote ou versão de fórmula ⇒ lista de clientes
  afectados, notificação nas línguas deles, bloqueio de venda, registo das
  acções. Os alertas às autoridades (Safety Gate) são do comerciante — o Eurolify
  prepara a informação.

## Mercadorias perigosas

Vernizes e solventes não seguem por qualquer via. O artigo diz o que é; o
domínio de envios recusa serviços incompatíveis **antes do checkout**. Lição da
casa: a etiqueta dos CTT saiu Via Aérea quando o cliente tinha pago Via
Marítima (`etiqueta-ctt-aerea-em-vez-de-maritima-17set2026.md`).

## O que os sistemas actuais já têm e serve de referência

Rótulos com versão e imagens de CPNP, fórmulas versionadas, lote que nasce no
enchimento — tudo no Hub interno actual (memórias de 18/08 a 02/10/2026, repo `claude`).
**Referência de regras, não de código.**

## Anti-padrões

- Um selo «certificado» desenhado na página sem documento.
- Avisos só em português numa loja que vende em Espanha.
- O mesmo SKU para duas fórmulas diferentes sem versão.

## Antes de dizer «está feito»

- [ ] Todo o atributo obrigatório tem documento e validade.
- [ ] A página de produto mostra, por mercado, o que a lei pede antes da compra.
- [ ] Uma recolha simulada encontra os clientes certos.
- [ ] Técnico regulamentar validou a lista de campos por categoria.
