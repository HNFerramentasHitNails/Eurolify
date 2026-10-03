---
name: eu-vat-oss-ioss
description: Motor de IVA e documentos fiscais do Lumavo — categoria fiscal do artigo, jurisdição e taxas com vigência, territórios especiais, isenções com prova (manual, VIES, exportação), B2C/B2B e autoliquidação, a ordem de decisão do Bruno, NIF com código do país, perfis de faturação, retenção em vez de emissão errada, prova do documento emitido, OSS/IOSS, arredondamentos, notas de crédito, reembolsos e correcções. Usar SEMPRE que se toca em IVA, NIF, VIES, perfis de faturação, faturas, notas de crédito, relatórios fiscais ou no adaptador de um software de faturação.
---

# IVA, OSS/IOSS e documentos fiscais

> Estado: **desenho** — não há código (ADR-0001). Fontes e datas:
> `docs/03-regulamentar-ue.md` §1. Lições: `docs/04-licoes-dos-sistemas-actuais.md`
> §1 e §2. **Quem decide: Bruno.**
>
> 🔴 **Validação obrigatória:** cada regra deste ficheiro é validada por um
> contabilista **do país** antes de chegar a um documento real. O que está
> marcado **C** não foi verificado nesta sessão.

## 🔴 Regra zero

**Um documento fiscal errado não se apaga.** Corrige-se com nota de crédito, um
telefonema ao cliente e um risco legal que é do comerciante. Por isso, no
Lumavo: **na dúvida, retém** — nunca emite à sorte.

## As peças

| Peça | O que guarda / faz |
|---|---|
| **Categoria fiscal do artigo** | normal, reduzida, isenta por natureza (ex.: formação profissional isenta pelo art. 9.º do CIVA em PT — regra dos sistemas actuais, pode não ser a de outro comerciante) |
| **Jurisdição e taxa** | país (e região: Açores, Madeira), categoria, percentagem, **data de início e de fim**. Nunca uma taxa escrita no código (o Hub tinha 23 % fixos no ecrã — `regra-isencao-iva-bruno.md`) |
| **Territórios especiais** | por país + código postal: Canárias (35xxx, 38xxx), Ceuta (51xxx), Melilla (52xxx) **fora do IVA da UE** (M) — e, a confirmar (**C**): Åland, Monte Atos, Büsingen, Heligoland, Livigno, Campione, departamentos ultramarinos franceses, Irlanda do Norte (`XI`) |
| **Registos fiscais do comerciante** | onde está registado: país-sede, OSS, IOSS, registos noutros países (a loja actual tinha um registo suíço activo no Shopify a cobrar 8,1 % de MwSt sem o querer — `desenho-ecossistema-bruno.md`) |
| **Perfil de faturação** | NIF, país do contribuinte, morada fiscal, tipo (particular/empresa), validação VIES com prova, isenção manual com motivo, nota e anexos |
| **Decisão de IVA da linha** | taxa ou isenção, **motivo** (código: ex.: M05 exportação, M16 intracomunitária, M07 isento art. 9.º — códigos portugueses), a **regra que decidiu**, a versão da regra e a **evidência** (país de entrega, resposta do VIES, isenção manual) — gravada no momento do checkout |
| **Pedido de documento** | o que se mandou ao software certificado, a resposta em bruto |
| **Prova do documento** | o que o documento diz **depois de emitido**, lido de volta: número, NIF, taxas, totais do cabeçalho |
| **Fila das retidas** | documentos que não saem, com o motivo e as saídas humanas |

## A ordem da decisão (regra do Bruno, 13/08/2026)

1. **O tipo de artigo vem primeiro.** Artigo isento por natureza é isento — não
   se olha a ficha, morada nem país.
2. Se não é isento, **excepções**, por esta ordem:
   1. **isenção manual**, posta por uma pessoa, com motivo e prova;
   2. **NIF válido no VIES** numa venda intracomunitária (autoliquidação);
   3. **venda para fora da UE** (exportação), incluindo os territórios fora do
      IVA da UE.
3. Nos outros casos **paga IVA**: a taxa nacional, ou a do **país de destino**
   (OSS) acima do limiar.
4. 🔴 **A excepção à excepção:** entrega em Portugal **anula** o VIES e a
   exportação — **não anula a isenção manual** (o cliente com transportadora
   própria que entrega a declaração da alfândega).

Generalizar: «Portugal» = o país do comerciante. A regra vive **numa função no
servidor** com um teste por ramo. A #D4248 saiu com IVA porque esta regra estava
escrita duas vezes e as cópias divergiram na ordem.

## Regras que não se negociam

1. **Intracomunitária isenta só com NIF válido no VIES.** Sem NIF ⇒ cobra. Nos
   sistemas actuais saíram 7 faturas assim, 3.773,09 € (`canarias-ceuta-melilla-extra-ue-28set2026.md`).
   Que o VIES é condição substantiva desde 2020 vem de uma pesquisa (OCC) que
   **não foi lida** — **C**.
2. **Se foi cobrado IVA, a fatura leva IVA.** A fatura nasce do que foi cobrado
   no checkout, nunca de um recálculo posterior.
3. **O cliente sabe no checkout se paga com ou sem IVA**, e isso não muda
   depois. Uma isenção que caia, cai antes do checkout seguinte.
4. **Uma isenção posta por uma pessoa nunca é desligada por um processo
   automático** (nem pelo VIES diário) — regra do Bruno de 06/08/2026.
5. **A prova do VIES** guarda-se com a decisão: data, NIF consultado, resposta,
   identificador da consulta. Revalidação diária dos perfis activos, sem tocar
   nas isenções manuais.
6. **Territórios especiais decidem-se pelo código postal**, nunca por «contém»
   («Palma de Mallorca» cairia nas Canárias por «la palma»).
7. **Nada de taxas partilhadas entre países** no software de faturação: chave
   (país, taxa). Editar o nome de uma taxa não reescreve o passado.

## NIF — guardar, comparar, enviar

| Pergunta | Régua |
|---|---|
| Como se guarda? | **com o prefixo fiscal do país, excepto o país do comerciante** (em Portugal: sem prefixo). O que a pessoa escreveu com prefixo **mantém-se sempre**. O prefixo fiscal **não** é o ISO: `CHE` na Suíça, `EL` na Grécia |
| São o mesmo contribuinte? | compara-se **só o número**, sem prefixo nem pontuação |
| Número de 9 dígitos sem prefixo, ficha estrangeira, passa o dígito de controlo português? | leva `PT` (o padrão das emigrantes — 8 casos nos sistemas actuais, 16/09/2026) |
| Procurar a entidade no software de faturação? | **pelo número sem prefixo** — procurar `PT263631656` não encontra `263631656` |
| Números impossíveis? | `000000000`, `123456789` e afins **passam o dígito de controlo** e são recusados por lista (#5414, 30/09/2026) |
| Recusado pela régua? | **retém** — nunca sai como consumidor final a quem deu o número |

E sempre: **o país da morada não é o país do contribuinte** (perfil com NIF
português e morada no Luxemburgo).

## Perfis de faturação

- Um cliente, **vários perfis**; um perfil é **a mesma pessoa** noutra postura
  fiscal; **duas pessoas são duas fichas**.
- **Cada encomenda liga a um perfil**, fixo depois de emitida a fatura.
- O checkout tem **«a fatura é para outra pessoa/empresa»**: quem compra não é
  quem é faturado (o bilhete comprado para outra pessoa, 12/08/2026).
- O perfil «principal» é **um** sinal, guardado na base, que o ecrã e o servidor
  leem — no Hub eram duas réguas e divergiam em 182 de 314 fichas (28/09/2026).

## Documentos — emissão, retenção e prova

- **O Lumavo não emite faturas portuguesas por si**: liga-se a software
  certificado (D-4). O adaptador traduz; **a decisão fiscal já vem tomada**.
- **No adaptador do Moloni** (lições do Hub): o rascunho leva o identificador
  da entidade e **o NIF que sai é o da entidade**, não o nosso — confirmar a
  entidade antes de emitir; o Moloni não deixa mudar o NIF de uma entidade que
  já emitiu documentos.
- **Retém** em vez de emitir quando: o contribuinte é recusado; o perfil é de
  outra ficha; isenção intracomunitária sem NIF; o território não se consegue
  decidir; o artigo não tem o que o emissor exige (unidade, código). Cada
  retenção tem **motivo e saídas humanas**; libertar à mão vale como validação
  manual (senão volta à fila em ciclo).
- **O rascunho só nasce depois de o pagamento estar confirmado.**
- **Prova:** depois de emitido, lê-se de volta o NIF, as taxas e os totais do
  documento e guardam-se à parte. É isso que se mostra e se reporta, não o que
  quisemos enviar.
- **Nota de carimbo**: nas observações do documento, «destino ES · IVA 21 %» ou
  «destino BE · isento (M16)» — imutável e legível a olho.

## Arredondamentos

- Guardar os totais **do cabeçalho do documento** como o emissor os devolve;
  somar linhas perde cêntimos (15,45 € contra 15,47 € numa fatura a 21 %).
- Regra de arredondamento por linha ou por documento: a do país e do emissor
  — **C**, confirmar por país.

## Notas de crédito, reembolsos e correcções

- A nota de crédito **referencia o documento original** e repete o tratamento
  fiscal dele (taxa e motivo de então), mesmo que as taxas tenham mudado.
- **Uma NC parcial não anula a fatura toda**: o estado calcula-se pelo saldo
  (no Hub: 134 casos, 95.858,54 € mal marcados, 10/09/2026).
- **Reembolso ≠ nota de crédito**: dois registos, ligados.
- Saídas de uma NC (regra do Bruno, 28/09/2026): **troca** (encontro de contas)
  ou **carteira** (carregamento faturado; o uso do saldo é desconto, com a
  origem nas observações). ⚠️ Validar com o contabilista à luz da directiva dos
  vales (Dir. (UE) 2016/1065) — **C**.
- **Nunca correcções nem reenvios em lote**: fila, linha a linha, decide uma
  pessoa.

## OSS e IOSS

- Relatório com **quatro baldes**: OSS (outros Estados-Membros, taxa do
  destino), nacional, exportação (não entra), isentas (vão na declaração
  recapitulativa).
- Agrupado pelo **país de entrega da encomenda**, nunca pelo nome da taxa.
- Notas de crédito entram **com sinal negativo**.
- **Fecho mensal**: retrato congelado, com quem fechou e quando.
- IOSS só se um comerciante vender a partir de fora da UE (≤150 €).
- Fora da UE, o comerciante pode ter de se registar no país de destino (Reino
  Unido, Suíça) — **C**, por país.

## Fatura electrónica por país

Ver `docs/03-regulamentar-ue.md` §1: Portugal (certificado, ATCUD, QR; PDF com
assinatura qualificada desde 01/01/2027), Espanha (Verifactu 2027), França
(Plateforme Agréée), Bélgica, Alemanha, Polónia (KSeF), Itália (SDI). **Um
adaptador por regime**, cada um com o seu contabilista.

## Antes de dizer «está feito»

- [ ] Há um teste por ramo da ordem de decisão, incluindo a #D4248 (isenção
      manual com entrega em PT), o bilhete comprado para outra pessoa, o `000000000`
      e as Canárias.
- [ ] A decisão grava a evidência e a versão da regra.
- [ ] O documento emitido é lido de volta e comparado com o que se pediu.
- [ ] Todos os sítios que liam a regra antiga estão listados e tratados.
- [ ] Respondi a «por onde é que isto ainda pode sair errado?» — e fui ver.
- [ ] O contabilista validou (com nome e data no ADR).
