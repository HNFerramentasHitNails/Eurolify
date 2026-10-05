---
name: catalog-pim
description: Catálogo e gestão de informação de produto (PIM) no Eurolify — artigos, variantes, opções, atributos, kits e coleções, media, categorias e colecções, conteúdo multilingue, SEO, feeds, publicação por canal e mercado, validações, importação e exportação, auditoria e ciclo de vida do artigo, ligação a stock, preço e disponibilidade por canal. Usar ao desenhar ou alterar qualquer campo do artigo, traduções, publicação numa loja ou num canal, importações e feeds.
---

# Catálogo (PIM)

> Estado: **desenho** — o código está autorizado (ADR-0023), mas o deste domínio só depois do desenho dele em tabela. Os campos regulamentares
> estão em `product-compliance-eu`; o preço em «Preços e mercados»; o stock em
> `order-fulfilment`.
> Complementares (05/10/2026): `eurolify-identifiers-traceability-eu` (identificadores) e `eurolify-sector-compliance-eu` (classificação antes de publicar); coordenação em `eurolify-legal-briefing-eu`.

## 🔴 Primeira regra: a ficha do artigo vive num sítio só

Nos sistemas actuais isto falhou **três vezes** (18/08, 24/08 e 26/09/2026): a
foto, as quantidades mínimas e a galeria foram criadas em ecrãs-espelho e não
na ficha onde o Bruno trabalha — para ele foi como não existirem
(`catalogo-de-produtos-centraliza-26set2026.md`, repo `claude`).

No Eurolify: **campo novo de artigo nasce no domínio Catálogo, na API de
Administração e na ficha do Hub do Eurolify, no mesmo passo.** Os outros ecrãs e
canais são espelhos que mostram ou não.

Num cliente que já tem um sistema de gestão onde a ficha do artigo nasce (como o
Hub interno actual), a ficha continua a nascer lá e é espelhada para o Eurolify
pela API de Administração.

## O modelo

| Entidade | Notas |
|---|---|
| **Artigo** | o produto comercial; tipo (físico, serviço, digital, bilhete, cartão-oferta), categoria fiscal (`eu-vat-oss-ioss`), atributos regulamentares |
| **Variante** | a unidade vendável: SKU único, GTIN, opções (cor, tamanho), peso e dimensões, unidade de medida |
| **Opção** | nome e valores, traduzíveis |
| **Kit / coleção** | lista de componentes com quantidades; **a disponibilidade deriva dos componentes** (no Hub: 72 de 72 compostos batiam com os componentes, 16/09/2026); uma coleção pode levar **várias fórmulas** |
| **Media** | imagens e vídeos com texto alternativo por língua (acessibilidade), ordem, principal |
| **Categoria e colecção** | árvore de navegação; colecções manuais ou por regra |
| **Tradução** | por língua e por campo, com estado: **completa, desactualizada, em falta** |
| **Publicação** | por **canal × mercado**: rascunho, publicado, arquivado, com data e quem |
| **Atributos personalizados** | definidos pelo comerciante, tipados e validados |

## Regras

1. **Estado na casa ≠ estado na loja.** «Activo» no catálogo não quer dizer
   «à venda»: o Hub dava 1.312 activos quando a loja tinha 1.043 à venda (13/09/2026).
   No Eurolify a publicação é **por canal e mercado**, guardada e mostrada.
2. **Nada se publica a 0,00 €** sem ser explicitamente gratuito — um gel esteve
   à venda a 0,00 € seis meses e meio com 149 unidades em stock
   (`produtos-a-zero-euros-no-shopify-09set2026.md`). A publicação pergunta ao
   servidor se pode, e diz porquê se não pode.
3. **SKU obrigatório e único por inquilino**; **unidade de medida obrigatória** —
   no Hub, artigo sem SKU ou sem unidade **travava a fatura** (11/09 e 17/09/2026).
4. **Códigos de barras com origem**: GS1 do comerciante, do fornecedor ou
   interno — guardado qual. No Hub nenhum dos 1.305 códigos era da casa e 18
   estavam repetidos (`estudo-codigos-de-barras-gs1-amazon-lote-15set2026.md`).
5. **Traduções nascem e vivem no Eurolify**, nunca numa app de terceiros: mudar o
   texto original marca as traduções como **desactualizadas** e avisa (decisão
   do Diogo para o Hub, 18/09/2026).
6. **Um artigo arquivado não derruba os outros**: arquivar uma variante num
   canal não pode retirar o produto inteiro (no Hub, arquivar um refill tirou 4
   produtos do site, 27–28/08/2026).
7. **Alterações com rasto**: quem, quando, antes e depois — o catálogo alimenta
   preços, IVA e conformidade.

## Importação, exportação e feeds

- Importação em **modo de ensaio primeiro**: diz quantos criaria, alteraria e
  recusaria, e porquê; só depois escreve.
- Exportação completa em formato aberto (é também a saída do Data Act).
- Feeds por canal (Google, Meta, comparadores) gerados do catálogo publicado
  naquele mercado, com a língua e o preço do mercado.
- **Nunca** uma importação que apaga o que não veio no ficheiro.

## SEO

URL amigável por língua, título e descrição por língua, dados estruturados do
produto (preço, disponibilidade, avaliações reais), mapa do site por mercado.

## Antes de dizer «está feito»

- [ ] O campo novo está no domínio, na API e na ficha do Hub do Eurolify.
- [ ] Tem tradução e estado de tradução, se é texto visível.
- [ ] A publicação recusa os casos impossíveis (sem preço, sem SKU, sem atributo
      obrigatório no mercado).
- [ ] Importar duas vezes o mesmo ficheiro não duplica nada.
