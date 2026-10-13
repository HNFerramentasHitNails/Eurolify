# Envios — transportadoras, etiquetas e seguimento

> **Estado: desenho aprovado** (issue #393; `docs/06`, ED). Diogo, 12/10/2026:
> *«sim, começa o desenho dos envios»* e *«sim, aprovo; avança com a parte
> A»* (Q1 a Q8 como propostas). A parte A está no código (§14). É a **peça 9 da
> Fase 1** (`docs/10` §2: «Envios: CTT e um agregador») e a **parte 2 da
> fatia 9** (`docs/27` §1: «adaptadores de transportadora (cotação, etiqueta,
> seguimento automático, pontos de recolha) — parte 2 desta fatia (Q5)»).
> Depende do checkout (`docs/25`, os métodos de entrega da 0041) e do stock e
> das encomendas (`docs/27`, as expedições da 0047).
>
> Skills seguidas: `order-fulfilment` (o núcleo nunca fala a língua de uma
> transportadora; o serviço vendido é o da etiqueta; várias expedições),
> `eurolify-transport-logistics-eu` (a API gerar uma etiqueta não prova que a
> transportadora aceita a mercadoria; perigosos com profissional; estados da
> transportadora não decidem reembolso nem documento fiscal),
> `third-party-extensions` (o mesmo contrato para nós e para terceiros),
> `consumer-rights-eu` (portes no preço total, prazo de entrega),
> `eu-localization` (moradas e códigos postais por país, entregas por
> mercado), `eu-gdpr-privacy` (a transportadora recebe só o que precisa),
> `product-compliance-eu` (número ONU e classe na variante),
> `observability-security` (credenciais cifradas, avisos assinados) e
> `headless-commerce` (idempotência, erros, eventos).
>
> **Fontes legais lidas no repositório `eur-lex`** (ADR-0045), a 12/10/2026,
> na versão de cada ficheiro (§5). Nada aqui foi validado por jurista: fica
> para o fim do desenvolvimento (ADR-0045).

## 1. O que entra nesta fatia

| O quê | Fonte |
|---|---|
| **conta de transportadora** (`cac_`) por comerciante: credenciais cifradas, modo teste ou real, pronta só depois de uma chamada de teste | o padrão da conta de pagamento (`docs/26` §3.1) |
| **o método de entrega passa a apontar para um serviço** de uma conta (ou fica «manual») e diz a **data-limite** que o comerciante se compromete a cumprir | `order-fulfilment` («o serviço vendido é o da etiqueta»); L1, L4 |
| **zonas do método**: as regiões que o método serve dentro do país do mercado (PT continental, Açores, Madeira…), pelo código postal | L3; `eu-localization` («territórios especiais pelo código postal») |
| **etiqueta pela API**: ao criar a expedição, o adaptador pede a etiqueta com o serviço vendido, o peso calculado e a morada copiada; guarda o número de seguimento e o ficheiro | `order-fulfilment`, «Expedição» |
| **seguimento automático**: os eventos da transportadora (aviso assinado ou consulta) passam a estados da expedição | `order-fulfilment`; `docs/27` §3.7 |
| **a entrega é a do destinatário**, nunca a do transportador | L5 |
| **perigosos recusados por omissão**: uma variante com número ONU só sai por um serviço que declare aceitá-la | `eurolify-transport-logistics-eu`, 3; L9 |
| **adaptadores**: CTT primeiro (Q1); um agregador a seguir (Q2) | `docs/10` §2, peça 9; `docs/07` §3 |

**Fora desta fatia:**

| O quê | Onde |
|---|---|
| cotação em tempo real no checkout (o preço dos portes continua a ser o do comerciante, Q3) | parte 3, se um comerciante a pedir |
| pontos de recolha e cacifos (escolha do ponto no checkout) | parte 3 (Q5) |
| pagamento na entrega | Fase 2, com os países do Leste (`docs/07` §3) |
| etiqueta de devolução | fatia 11 (pós-venda), pelo mesmo contrato (§8) |
| vários volumes numa expedição | parte 3 (Q6); nesta parte, um volume por expedição |
| opções de entrega «respeitadoras do ambiente» | por decidir (Q8; L8) |
| ecrãs do Hub para expedições e contas | peça 14 (Hub mínimo); esta fatia é a API |
| frio, alimentos, medicamentos | `eurolify-transport-logistics-eu` com o setor; recusados como os perigosos |

## 2. Fronteira

| O quê | Dono | Como fala com os Envios |
|---|---|---|
| peso, dimensões, número ONU e classe da variante | **Catálogo** (`docs/14` §3, linha 121–123) | os Envios lêem; nunca guardam cópias fora da expedição |
| o método de entrega e o preço dos portes | **Checkout** (0041) | o método ganha os campos da §3.2; o preço continua a ser do comerciante |
| a encomenda, as expedições, as linhas, o lote e a saída do stock | **Stock e encomendas** (0047) | os Envios acrescentam a etiqueta e o seguimento à expedição; **não mexem no stock** |
| a transportadora e a língua dela | **adaptador** | o núcleo só conhece o contrato (§8) |
| a livre resolução, o reembolso e a nota de crédito | **Pós-venda** (`docs/30`) | ouve `shipment.delivered`, `shipment.lost`, `shipment.returned_to_sender` |
| o documento fiscal | **Documentos fiscais** (`docs/29`) | ouve `shipment.dispatched` como hoje; nada muda |

## 3. Modelo

### 3.1 Conta de transportadora (`cac_`)

| Campo | Regra | Fonte |
|---|---|---|
| `transportadora` | da lista fechada dos adaptadores: `ctt` nesta parte; o agregador a seguir (Q2) | `third-party-extensions`, 1 |
| `nome` | o que o comerciante lhe chama (ex.: «CTT — contrato da loja») | — |
| `modo` | `teste` ou `real`. **No ensaio só `teste`** (ADR-0019) | ADR-0019 |
| `credenciais` | cifradas na base com AES-256-GCM, a chave fora da base, como as das contas de pagamento | `docs/26` §3.1; `observability-security` |
| `segredo_aviso` | para conferir a assinatura dos avisos de seguimento, cifrado da mesma forma (só se a transportadora os tiver, V3) | `observability-security` |
| `remetente` | a morada de recolha (normalmente a do armazém) e o contacto que vai na etiqueta | — |
| `estado` | `rascunho` → `pronta` → `arquivada`; fica `pronta` só depois de `testar()` correr bem | o padrão de `docs/26` §3.1 |

As credenciais **nunca saem** pela API. Só o dono liga ou muda uma conta
(`shipping:accounts`), como nas contas de pagamento (`docs/26`, Q3).

### 3.2 Método de entrega (`shm_`) — o que muda

| Campo | Regra | Fonte |
|---|---|---|
| `conta`, `servico` | uma conta `pronta` e um serviço que o adaptador declara (`servicos()`), ou **nenhum** (método «manual»: a pessoa escreve a transportadora, como hoje) | `order-fulfilment` |
| `prazo_max_dias` | a data-limite que o comerciante se compromete a cumprir, em dias a contar do dia seguinte ao botão final; **no máximo 30** salvo acordo com o consumidor | L1, L4 |
| `zonas` | as regiões que o método serve no país do mercado, de uma lista do servidor pelo código postal (ex.: `PT-continente`, `PT-acores`, `PT-madeira`); vazio = o país todo | L3; `eu-localization` |
| `aceita_onu` | lista dos números ONU que o serviço aceita; **vazia por omissão** (nenhum perigoso) | L9; `eurolify-transport-logistics-eu`, 3 |
| `peso_max_g` | o peso máximo do serviço (o adaptador sugere; o comerciante confirma) | V2 |

Os campos da 0041 ficam (`nome`, `prazo` em texto por língua, `tarifa`,
`gratis_a_partir_de`, `pede_telefone`). **O preço continua a ser o do
comerciante** (Q3): o que o cliente paga não muda se a transportadora cobrar
outra coisa ao comerciante.

### 3.3 Expedição (`shp_`) — o que muda

| Campo | Regra |
|---|---|
| `conta`, `servico` | **copiados do método da encomenda** no momento da etiqueta; mudar de serviço é uma decisão de uma pessoa, com motivo (`docs/27`, R6) |
| `peso_g` | a soma do peso das linhas (variantes; num kit, os componentes) mais a embalagem por omissão do armazém (Q6); a pessoa pode corrigir com motivo |
| `etiqueta` | `por_pedir` → `a_pedir` → `emitida` \| `incerta` \| `recusada`; com o número de seguimento, o endereço público de seguimento e o ficheiro (§3.5) |
| `seguimento` | passa a ser escrito pelo adaptador (hoje é texto escrito à mão) |
| `prova_entrega` | o evento da transportadora que diz «entregue» (identificador, data, quem recebeu se vier) |

Os estados da expedição da 0047 ficam: `criada` → `expedida` → `entregue` \|
`devolvida_ao_remetente` \| `perdida`; `criada` → `cancelada`.

### 3.4 Evento de seguimento (`sev_`, só se acrescenta)

| Campo | Regra |
|---|---|
| `expedicao`, `origem` | `aviso` (assinado) ou `consulta` |
| `id_externo` | o identificador do evento na transportadora; **único por expedição** (o mesmo aviso duas vezes não conta duas vezes) |
| `estado_transportadora` | o código dela, em bruto |
| `estado_normalizado` | o que o adaptador traduz: `recolhida`, `em_transito`, `tentativa_falhada`, `disponivel_para_levantar`, `entregue`, `devolvida`, `perdida`, `outro` |
| `em` | a data do evento na transportadora; e `recebido_em`, do relógio da base |

### 3.5 Ficheiro da etiqueta

A etiqueta leva o nome, a morada e o telefone de quem recebe. Guarda-se no
armazenamento de ficheiros numa área **privada**, à parte das imagens públicas
do catálogo, servida só a quem tem `fulfilment:read`, e **apaga-se N dias depois de a expedição
acabar** (Q7). O número de seguimento e o evento da entrega ficam na
expedição, com a retenção da encomenda.

## 4. Estados

### 4.1 Etiqueta

```
por_pedir → a_pedir → emitida
               │   └→ recusada (o adaptador disse porquê: morada, peso, serviço)
               └→ incerta (tempo esgotado ou erro de rede: não se sabe se existe)
incerta → emitida | recusada   (só depois de consultar a transportadora)
emitida → anulada              (se a transportadora deixar, antes de recolhida)
```

- **Uma expedição tem no máximo uma etiqueta viva.** Pedir outra exige anular
  a anterior (ou a transportadora dizer que não existe).
- **`incerta` nunca se repete às cegas**: consulta-se a transportadora pela
  nossa referência; se não houver forma de consultar, vai para uma pessoa
  (fila de problemas da peça 21, Q4).

### 4.2 Expedição (pelo seguimento)

| Evento normalizado | Efeito |
|---|---|
| `recolhida`, `em_transito` | `criada → expedida` (se a pessoa ainda não a marcou); a saída do stock é a da 0047 |
| `entregue` | `→ entregue`, com `entregue_em` = a data do evento e a prova |
| `devolvida` | `→ devolvida_ao_remetente` |
| `perdida` | `→ perdida` |
| `tentativa_falhada`, `disponivel_para_levantar`, `outro` | só ficam no histórico (e o aviso ao comerciante, Q4) |

- **Os estados só andam para a frente** (como na 0047). Um evento fora de
  ordem fica no histórico e não muda nada. Corrigir um estado é uma nova
  transição com motivo, por uma pessoa.
- **«Entregue» pela transportadora é prova da entrega**, não de conformidade
  nem de satisfação (`eurolify-transport-logistics-eu`, 4). Não emite
  documento fiscal nem decide reembolso.

## 5. Regras

| # | Regra | Fonte (lida no `eur-lex` a 12/10/2026) |
|---|---|---|
| L1 | Antes da compra, o consumidor vê as **modalidades de entrega e a data-limite** em que o comerciante se compromete a entregar. O checkout mostra «entrega até DD/MM/AAAA», calculada de `prazo_max_dias` no fuso da loja, no resumo e na confirmação | Dir. 2011/83/UE, art. 6.º, n.º 1, al. g) (versão consolidada aplicável desde 27/09/2026, `corpus/consumidores-e-vendas/32011L0083-direitos-dos-consumidores.md`, obtido a 10/10/2026); em Portugal, DL 24/2014, art. 4.º, n.º 1, al. j) (consolidado do DRE até 03/03/2023, `legislacao-pt/decreto-lei-24-2014.md`) |
| L2 | **Os portes entram no preço total** mostrado antes da compra | Dir. 2011/83/UE, art. 6.º, n.º 1, al. e); DL 24/2014, art. 4.º, n.º 1, al. e) a g) |
| L3 | **As restrições à entrega** (regiões não servidas) dizem-se de forma clara, **o mais tardar no início do processo de encomenda** — não só quando o cliente escreve a morada | DL 24/2014, art. 7.º |
| L4 | **Prazo de entrega: 30 dias** no máximo, salvo acordo em contrário; em Portugal, a contar do dia seguinte à celebração. Sem entrega, o consumidor pode pedir um prazo adicional e depois resolver o contrato. Se o bem não estiver disponível, informa-se e reembolsa-se em 30 dias; depois disso, **em dobro** | Dir. 2011/83/UE, art. 18.º; DL 84/2021, art. 11.º, n.os 4 a 6 (original do DRE, `legislacao-pt/decreto-lei-84-2021.md`, obtido a 10/10/2026); DL 24/2014, art. 19.º, n.os 1 a 3 |
| L5 | **O bem está entregue quando o consumidor (ou alguém que ele indicou, que não o transportador) tem a posse física**; o risco de perda passa nesse momento, salvo se o consumidor escolheu um transportador que o comerciante não propôs. Uma expedição perdida é do comerciante | DL 84/2021, art. 11.º, n.º 1; Dir. 2011/83/UE, art. 20.º |
| L6 | **O prazo da livre resolução conta da posse física do último bem** quando a encomenda chega em várias expedições: `entregue_em` da **última** expedição | DL 24/2014, art. 10.º, n.º 1, al. b), subal. i) |
| L7 | **Envio para outro país da UE:** as opções de entrega e os encargos dizem-se antes da compra; o método por mercado já o faz | Reg. (UE) 2018/644, art. 7.º (original do JO, `ue/regulamentos/2018/32018R0644.md`, obtido a 10/10/2026) |
| L8 | A informação pré-contratual inclui as **opções de entrega respeitadoras do ambiente, se disponíveis** | Dir. 2011/83/UE, art. 6.º, n.º 1, al. g), na redacção da Dir. (UE) 2024/825 (marca M4 do consolidado). **A transposição portuguesa não está no `eur-lex`**: o DL 24/2014 está consolidado só até 03/03/2023 (Q8) |
| L9 | **Mercadorias perigosas** no transporte rodoviário seguem a Dir. 2008/68/CE; a classificação é de um profissional, nunca deduzida do nome. **Por omissão nenhum serviço aceita perigosos** | Dir. 2008/68/CE (`ue/diretivas/2008/32008L0068.md`; só localizada, os artigos não foram lidos); `eurolify-transport-logistics-eu`, 3 |
| L10 | Na livre resolução, os portes reembolsam-se, **excepto o custo a mais** de uma modalidade mais cara que o consumidor escolheu: a expedição guarda o método vendido e o seu preço, para a pós-venda saber qual era o mais barato | DL 24/2014, art. 12.º, n.º 3 |
| R1 | O serviço da etiqueta é o do método vendido; o adaptador recebe o serviço da expedição, nunca escolhe outro | `docs/04`, lição 3.7; `docs/27`, R6 |
| R2 | Uma expedição, no máximo uma etiqueta viva; o pedido leva uma chave de idempotência (`shp_` + número da tentativa) | `headless-commerce`; o padrão de `docs/26`, R2 a R4 |
| R3 | Um aviso de seguimento só conta com assinatura válida; sem assinatura responde-se 401 e não se muda nada; o evento em bruto grava-se antes de se tratar | `observability-security`; `docs/26` §8.2 |
| R4 | O checkout só oferece um método se **todas** as linhas couberem nele: zona da morada, peso total ≤ `peso_max_g`, e nenhuma variante com número ONU fora de `aceita_onu`. Sem método possível, o resumo diz o bloqueio: **na dúvida, não vende** | L3, L9; `docs/25` §3.6 |
| R5 | A morada que vai para a transportadora é a copiada da encomenda, com o código postal validado pelo formato do país (PT `0000-000`) | `eu-localization`, «Moradas» |
| R6 | Um adaptador traduz; nenhuma regra do núcleo (zonas, perigosos, prazos) vive no adaptador | `third-party-extensions`, 2 |

## 6. Dados pessoais

- **A transportadora recebe só o que precisa para entregar:** nome de quem
  recebe, morada de entrega, telefone (quando o serviço o pede) e e-mail
  **só se o serviço o exigir** para avisar o destinatário (V2). Nunca o NIF,
  o perfil de faturação, os preços nem as linhas.
- **O papel da transportadora no RGPD** (subcontratante do comerciante ou
  responsável próprio) **não verifiquei — C**; fica para o jurista, no fim
  (ADR-0045). O Eurolify, como subcontratante do comerciante, só envia por
  instrução dele (a conta que ele ligou).
- **Dados na UE** (regra 4 do `AGENTS.md`): os CTT são portugueses (**C**, não
  verifiquei onde tratam os dados); o agregador só entra depois de se
  verificar onde trata os dados (Q2).
- **O ficheiro da etiqueta** apaga-se depois do prazo da Q7; os registos e os
  eventos (`shipment.*`) nunca levam a morada.

## 7. Lista da API

### 7.1 API de Administração

| Rota | Âmbito |
|---|---|
| `GET /carrier-accounts`, `POST /carrier-accounts`, `PATCH /carrier-accounts/{id}` | `shipping:read` / `shipping:accounts` |
| `PUT /carrier-accounts/{id}/credentials` (nunca devolve as credenciais) | `shipping:accounts` |
| `POST /carrier-accounts/{id}/test` (passa a `pronta` se correr bem) | `shipping:accounts` |
| `GET /carrier-accounts/{id}/services` (os serviços que o adaptador declara) | `shipping:read` |
| `PATCH /shipping-methods/{id}` (conta, serviço, prazo, zonas, ONU aceites, peso máximo) | `shipping:write` |
| `POST /shipments/{id}/label` (pede a etiqueta; idempotente) | `fulfilment:write` |
| `GET /shipments/{id}/label` (o ficheiro, enquanto existir) | `fulfilment:read` |
| `POST /shipments/{id}/label/void` (anula, se a transportadora deixar) | `fulfilment:write` |
| `GET /shipments/{id}/events` (o seguimento) | `fulfilment:read` |
| `POST /shipments/{id}/refresh` (consulta a transportadora agora) | `fulfilment:write` |

`shipping:read` e `shipping:write` já existem (os métodos de entrega da 0041,
`src/identidade/papeis.ts`); **âmbito novo: `shipping:accounts`**, só do dono.
O armazém e o apoio já têm `shipping:read` (`papeis.ts:100` e `:117`).

### 7.2 Avisos das transportadoras (sem chave; pela assinatura)

| Rota | O quê |
|---|---|
| `POST /webhooks/carriers/{transportadora}/{conta}` | evento de seguimento; R3 |

### 7.3 Checkout e API da Loja

| O quê | Muda |
|---|---|
| lista de métodos de entrega | só os que cabem (R4); cada um com a **data-limite** (L1) e as regiões que serve |
| resumo e confirmação | «entrega até DD/MM/AAAA» (L1); bloqueio `sem_metodo_entrega` quando nenhum cabe |

### 7.4 Erros (novos)

`shipping.account_not_ready`, `shipping.service_unknown`,
`shipping.zone_not_served`, `shipping.too_heavy`,
`shipping.dangerous_goods_refused`, `shipping.label_exists`,
`shipping.label_uncertain`, `shipping.label_refused`,
`shipping.void_not_allowed`, `shipping.carrier_unavailable`,
`checkout.no_shipping_method`.

Desde o docs/22 §29 (revisão do #409), dois códigos próprios para o que um
método de entrega activo impede, para que o Hub o diga sem ler o texto:
`shipping.account_in_use` (409, arquivar uma conta que um método activo usa)
e `shipping.service_in_use` (409, um teste cuja lista nova de serviços
deixaria um método activo sem o serviço dele). O `detail` leva os métodos.

### 7.5 Eventos

`shipment.label_created`, `shipment.label_refused`, `shipment.label_voided`,
`shipment.tracking_updated`, e os da 0047 (`shipment.dispatched`,
`shipment.delivered`, `shipment.returned_to_sender`, `shipment.lost`). Só
identificadores e estados; nunca a morada.

## 8. O contrato do adaptador (`docs/08` §4)

O mesmo para o adaptador dos CTT, para o agregador e para uma transportadora
que escreva o seu (decisão L, Fase 2):

| Operação | Entrada | Saída |
|---|---|---|
| `servicos()` | — | os serviços (código, nome, países e regiões, peso máximo, se pede telefone ou e-mail, se aceita perigosos e quais) |
| `testar(credenciais)` | — | conta válida ou o erro dela |
| `pedirEtiqueta(pedido)` | a nossa referência, serviço, remetente, destinatário (mínimos, §6), peso, valor declarado se o serviço o pedir, chave de idempotência | `emitida` (número de seguimento, endereço de seguimento, ficheiro), `recusada` com motivo, ou erro de rede (⇒ `incerta`) |
| `consultarEtiqueta(referencia)` | — | existe ou não, e o número de seguimento |
| `anularEtiqueta(seguimento)` | — | anulada ou «não é possível» |
| `consultarSeguimento(seguimento)` | — | os eventos, já normalizados (§3.4) |
| `lerAviso(cabecalhos, corpo, segredo)` | — | assinatura válida? e os eventos normalizados |
| `pedirEtiquetaDevolucao` | — | prevista no contrato; usada na fatia 11 |

O núcleo só conhece este contrato. A versão da API da transportadora fica
fixada dentro do adaptador, com testes dele (R6).

## 9. Por onde é que isto ainda pode sair errado

| Risco | O que o trava |
|---|---|
| duas etiquetas pagas para a mesma expedição (clique duplo, tempo esgotado) | R2; `incerta` sem repetir às cegas; uma etiqueta viva por expedição (§4.1) |
| serviço errado na etiqueta (lição 3.7) | R1: o serviço vem do método vendido, não da pessoa nem do adaptador |
| vender para uma região que o método não serve (ex.: Açores com tarifa do continente) | R4 e L3: as zonas pelo código postal, e o bloqueio no checkout |
| um perigoso numa etiqueta de um serviço que não o aceita | R4 e L9: recusado por omissão, antes do checkout |
| «entregue» dado pela transportadora a contar a livre resolução errada | L6: conta a última expedição entregue; a data é a do evento, não a do aviso |
| um aviso falso a marcar «entregue» | R3: só com assinatura; ou pela consulta |
| expedição perdida sem ninguém ver | `shipment.lost` e o aviso ao comerciante; a pós-venda trata como problema (L4, L5) |
| prometer um prazo que não se cumpre | L1 e L4: o prazo é do comerciante, no máximo 30 dias; o aviso de encomendas paradas (Q4) |
| a morada do cliente a ficar nos registos ou na etiqueta para sempre | §6; Q7 |

## 10. Perguntas para o Diogo ou o Bruno

| # | Pergunta | Proposta |
|---|---|---|
| Q1 | **Por que transportadora começar?** | **CTT, em modo teste**: são o maior operador em Portugal (43,5 % das encomendas no 2.º trimestre de 2024, `docs/07` §2.2, **W**) e a loja piloto é portuguesa |
| Q2 | **Qual o segundo**, para cumprir «CTT e um agregador» (`docs/10`, peça 9)? | **Sendcloud** (Países Baixos, `docs/07` §1.2, **W**), depois de verificar onde trata os dados (regra 4); a Packlink tem empresa-mãe de fora da UE (**C**, `docs/07`) |
| Q3 | **Quem decide o preço dos portes?** | **O comerciante**, como hoje (tarifa fixa e grátis acima de um valor). A cotação em tempo real fica para quando um comerciante a pedir |
| Q4 | **O que pede uma pessoa?** Etiqueta incerta sem consulta possível, expedição perdida, devolvida ao remetente, e encomenda paga sem expedição a 5 dias da data-limite | entram na fila «problemas abertos» da peça 21 (`docs/33`), com o aviso por e-mail que já existe (`docs/34`); **sem fila nova** |
| Q5 | **Pontos de recolha e cacifos** no checkout? | **parte 3**: na loja piloto chega a entrega em casa |
| Q6 | **Peso da embalagem e volumes?** | um peso de embalagem por omissão por armazém (ex.: 200 g) somado às variantes; **um volume por expedição** nesta parte |
| Q7 | **Quanto tempo se guarda o ficheiro da etiqueta?** | **30 dias depois de a expedição acabar** (entregue, devolvida, perdida ou cancelada): chega para reimprimir e para uma reclamação. O número de seguimento e a prova da entrega ficam com a encomenda. **C**: prazo por julgamento |
| Q8 | **Opções «respeitadoras do ambiente»** (L8) | **nenhum método se apresenta como tal nesta fatia**: uma alegação ambiental sem prova é proibida (Dir. (UE) 2024/825, a ler no `eur-lex` antes de qualquer marca); fica para quando houver um serviço com prova |

## 11. Por verificar antes do código (bloqueiam o adaptador, não o modelo)

**Não li a documentação da API dos CTT nem a da Sendcloud.** Nada foi corrido
contra um ambiente de teste.

| # | O quê | O que falta |
|---|---|---|
| V1 | API dos CTT para etiquetas e seguimento | **Pesquisa de 12/10/2026 (W, resumos):** não há documentação pública da API de envios dos CTT. O acesso é por contrato CTT Expresso e as credenciais e a especificação pedem-se ao gestor comercial ([CTT, plugins](https://www.ctt.pt/empresas/e-commerce-e-logistica/e-commerce/plugins-para-lojas-online)). A API pública que os CTT têm ([services.ctt.pt](https://services.ctt.pt/api_docs/DecisionServerRS/)) é para máquinas de triagem. Falta a especificação e as credenciais de teste |
| V2 | Os serviços dos CTT | códigos, peso máximo, se pedem telefone ou e-mail, Açores e Madeira, se aceitam algum perigoso |
| V3 | Seguimento | se os CTT avisam (com que assinatura) ou se só se consulta; de quanto em quanto tempo se pode consultar |
| V4 | Anular uma etiqueta | se e até quando se pode |
| V5 | Formato da etiqueta | PDF, ZPL ou outro; tamanho (A6, A4) |
| V6 | Sendcloud | os mesmos pontos, e onde trata os dados (regra 4 do `AGENTS.md`). A página da Sendcloud sobre a CTT Express diz que liga com o contrato do próprio comerciante e que pede uma empresa registada em Espanha ([Sendcloud, W, resumo](https://www.sendcloud.com/carriers/ctt-express/)): não confirmado na documentação técnica |

## 12. Para o jurista (no fim do desenvolvimento, ADR-0045)

- O papel da transportadora no RGPD e o acordo com ela (§6).
- A transposição portuguesa da Dir. (UE) 2024/825 nas opções de entrega
  (L8): o DL 24/2014 do `eur-lex` está consolidado só até 03/03/2023.
- Se o art. 19.º do DL 24/2014 (reembolso em dobro) se aplica à expedição
  perdida ou só à indisponibilidade do bem (L4).
- Os textos da data-limite e das restrições de entrega por língua (L1, L3).

## 13. Como entra no código (quando aprovado)

| Parte | O quê |
|---|---|
| **A** | contas de transportadora, campos novos do método, zonas, R4 no checkout, a data-limite no resumo e na confirmação; sem adaptador real (um adaptador de ensaio que finge a transportadora, para os testes) |
| **B** | o adaptador dos CTT (depois de V1 a V5), etiquetas, seguimento, avisos, a tarefa de consulta |
| **C** | o segundo adaptador (Q2) |

Testes que têm de falhar sem a protecção: duas etiquetas para a mesma
expedição; um aviso sem assinatura; um evento repetido; um evento fora de
ordem; um perigoso no checkout; uma morada fora da zona; o isolamento entre
comerciantes em contas, métodos, expedições e eventos.

## 14. Em código — parte A (12/10/2026; migração 0074; `docs/06`, ED)

| O quê | Onde |
|---|---|
| tabela `conta_transportadora` (só `ctt`, só modo teste), com o RLS forçado; credenciais e segredo dos avisos cifrados com AES-256-GCM e a chave fora da base (`ENVIOS_CHAVE`, como a dos pagamentos); pronta só com credenciais e a chamada de teste | migração 0074; `src/envios/repositorio.ts` |
| o âmbito novo `shipping:accounts`, só do dono (na lista das chaves e em `papel_ambitos`) | migração 0074; `src/identidade/` |
| as rotas da §7.1 para as contas: listar, criar, mudar ou arquivar, definir as credenciais, testar, ver os serviços | `src/envios/rotas.ts` |
| o contrato do adaptador com `servicos()` e `testar()`; as outras operações da §8 entram com a parte B | `src/envios/adaptador.ts` |
| o método de entrega com `conta` e `servico` (juntos, ou nenhum: método manual), `prazo_max_dias` (1 a 30), `codigos_postais`, `aceita_onu` e `peso_max_g`; com conta, confere-se que a conta está pronta, que o serviço existe, que entrega nos países do mercado, que aceita os ONU do método, que o peso não passa o dele e que o telefone se pede quando o serviço o pede | migração 0074; `src/checkout/repositorio.ts` |
| R4 numa regra só (`porQueNaoServe`): zona pelo prefixo do código postal, perigosos, peso das variantes-folha (um kit pelos componentes) e conta pronta; usada pela lista do checkout, pela escolha do método, pelo resumo (bloqueio `metodo_entrega`) e pelo botão final (`checkout.no_delivery_method`) | `src/checkout/entrega.ts` |
| `GET /checkout/{token}/delivery-methods`: os métodos do mercado com a data-limite, os códigos postais servidos e, nos que não servem, o porquê (L1, L3) | `src/checkout/rotas.ts` |
| a data-limite (L1, L4) no resumo (`portes.data_limite`), na cópia da encomenda (`metodo_entrega.data_limite`, com a conta e o serviço vendidos, R1) e na confirmação (sem a conta nem o serviço) | `src/checkout/` |
| 9 testes pela API, com um adaptador de ensaio; os de zona, perigosos, peso e conta falham sem a regra (conferido: com `porQueNaoServe` a devolver sempre `null`, 3 dos 6 primeiros falham), e o da data-limite falha sem ela na impressão | `test/envios-api.test.ts` |

**Desvios do desenho:**
- **As zonas são prefixos do código postal**, não regiões com nome
  (`PT-acores`…): os intervalos dos códigos postais das ilhas não estão
  verificados (o Motor de IVA tem-nos como **C**, migração 0040). O
  comerciante escreve os prefixos (ex.: `1` a `8` para o continente); o Hub
  pode oferecer listas feitas depois, com fonte.
- **Os prefixos valem para todos os países do mercado.** Um mercado com
  vários países e um método só para parte de um deles precisa de prefixos
  por país: fica para quando houver um mercado assim.
- **O peso da embalagem** (Q6) entra com a etiqueta (parte B): no checkout
  conta só o peso das variantes.
- **Sem adaptador real no servidor:** a parte A não traz o dos CTT. Uma conta
  dos CTT cria-se, mas o teste dá `shipping.carrier_unavailable` até à parte
  B. Os métodos «manuais» (sem conta) funcionam já com as zonas, o peso, os
  perigosos e a data-limite.
- **`ENVIOS_CHAVE` não está na VPS:** sem ela, as credenciais dão
  `shipping.not_configured` (503), como os pagamentos sem `PAGAMENTOS_CHAVE`.
- **Uma variante publicada não fica sem peso** (a base já o impede, `docs/14`
  C2): `peso_desconhecido` só aparece se uma folha não se ler; testa-se a
  regra directamente.

- **Os códigos de erro e o bloqueio** não são os do §7.3 e §7.4: um método
  que não serve dá `checkout.no_delivery_method` (422) com o `motivo`
  (`zona_nao_servida`, `perigoso_recusado`, `peso_excedido`,
  `peso_desconhecido`, `conta_indisponivel`), e o resumo dá o bloqueio
  `metodo_entrega` com o mesmo motivo; sem método escolhido, continua o
  `em_falta: metodo_entrega` da 0041. Os `shipping.zone_not_served`,
  `shipping.too_heavy` e `shipping.dangerous_goods_refused` não existem.
- **A lista do checkout traz todos os métodos** com `serve` e `motivo`, não
  só os que cabem: é assim que as restrições se dizem antes da encomenda
  (L3). Na lista pública, `conta_indisponivel` e `peso_desconhecido` saem como
  `indisponivel` (são da operação).
- **O peso máximo de um método com conta** fica o do serviço quando não se
  dá (ou se dá `null`); o comerciante pode baixá-lo, não tirá-lo.
- **`GET /carrier-accounts/{id}/services`** dá 503
  `shipping.carrier_unavailable` enquanto não houver o adaptador da
  transportadora no servidor.
- **O segredo dos avisos** fica quando se definem só as credenciais; `null`
  tira-o.

**Correcções da revisão do #397** (Claude Sonnet 5.5; 0 P0, 1 P1, 5 P2, 11
P3):
- **A data-limite entra na impressão do que o cliente viu** (P1-1): se mudar
  entre o resumo e o botão final (meia-noite, prazo mudado), dá
  `checkout.total_changed`. O botão final calcula-a com o relógio da base,
  como a hora da aceitação (P3-4). A impressão mudou de formato: uma sessão
  aberta antes desta versão tem de pedir o resumo outra vez.
- **A conta guarda-se na base** (P2-1), como a de pagamento: não se apaga, a
  transportadora, o modo e o comerciante não mudam, uma arquivada não muda,
  e credenciais novas devolvem-na a rascunho.
- **O segredo dos avisos não se apaga** ao trocar só a chave (P2-2).
- **Testes novos** (P2-3, P2-4): o peso e os perigosos de um kit pelos
  componentes; a conta de outro comerciante por identificador (PATCH,
  credenciais, teste, serviços); a escrita optimista; arquivar e depois não
  mudar; o erro de credenciais recusadas sem as credenciais.
- **Os desvios acima** (P2-5) ficaram declarados.
- **Nos `CHECK`**, os prefixos e os ONU já não aceitam elementos nulos nem
  vírgulas (P3-1); há um índice dos métodos por conta (P3-11).

**Ficou da revisão** (por fazer, com razão):
- Os testes de concorrência (arquivar a conta enquanto um método passa a
  usá-la; credenciais a mudar durante a chamada de teste) não existem. A
  ordem dos bloqueios foi revista por leitura (P2-4).
- Ficam para a parte B, quando a etiqueta usar a conta e o serviço:
  - um teste falhado não tira a conta de `pronta` (P3-6);
  - a rotação da chave (P3-7);
  - o tempo-limite e os erros tipados do adaptador (P3-8);
  - a leitura da conta e do serviço no botão final sem bloqueio (P3-5).
- `ENVIOS_CHAVE` tem de ser diferente da `PAGAMENTOS_CHAVE` quando for para a
  VPS (P3-9).
- Os identificadores na cópia da encomenda continuam sem prefixo, como o
  `id` do método já estava (P3-10).
- O `prazo_max_dias` 30 dos métodos antigos pode contradizer o `prazo` em
  texto: o comerciante confere-o (P3-11).

**Por fazer:** a parte B (o adaptador dos CTT depois de V1 a V5, etiquetas,
seguimento, avisos), a parte C (o segundo adaptador) e os ecrãs do Hub.

## 15. Em código — parte B (12/10/2026; migração 0079; `docs/06`, ED)

Pedido do Diogo, 12/10/2026: *«depois avança com a parte B dos envios»*.
**Sem o adaptador real dos CTT** (V1: não há especificação pública). Tudo o
resto corre contra uma transportadora de ensaio com o contrato inteiro da §8.

| O quê | Onde |
|---|---|
| o contrato do adaptador completo: `pedirEtiqueta`, `consultarEtiqueta`, `anularEtiqueta`, `consultarSeguimento`, `lerAviso` | `src/envios/adaptador.ts` |
| a etiqueta na expedição: estado (§4.1, posto pela base), tentativa, conta e serviço copiados do método vendido (R1), peso da caixa (as variantes-folha mais a embalagem do armazém, Q6), motivo, seguimento e endereço público | migração 0079; `src/envios/etiquetas.ts` |
| uma etiqueta viva por expedição e a referência «expedição-tentativa» como chave de idempotência (R2); uma etiqueta incerta não se repete: consulta-se pela referência (existe ⇒ emitida; não existe ⇒ recusada, e pede-se outra) | idem |
| anular, se a transportadora deixar, antes de a expedição sair; o ficheiro sai | idem |
| o ficheiro da etiqueta na base (privado), apagado 30 dias depois de a expedição acabar (Q7) pela volta da API, ou logo num apagamento do titular (gatilho na encomenda) | migração 0079 |
| os eventos de seguimento, só acrescentados, um por `id_externo`; mudam a expedição pelas portas do armazém (`mudarExpedicao`), só para a frente | idem |
| os avisos das transportadoras: gravados em bruto antes de se tratarem, só com assinatura válida mudam alguma coisa (R3); a porta do endereço para o comerciante como a dos pagamentos | idem; `POST /webhooks/carriers/{transportadora}/{conta}` |
| perdida ou devolvida ao remetente, e uma etiqueta incerta sem resposta há mais de um dia ⇒ um problema na pós-venda (Q4, a fila «problema» da peça 21) | `src/envios/etiquetas.ts` |
| a volta da API de 5 em 5 minutos: o seguimento das emitidas, as incertas e os ficheiros a apagar | `agendarTrabalhoEnvios` |
| rotas: `POST /shipments/{id}/label`, `GET /shipments/{id}/label`, `GET /shipments/{id}/label/file`, `POST /shipments/{id}/label/void`, `GET /shipments/{id}/events`, `POST /shipments/{id}/refresh`, `PUT /warehouses/{id}/packaging` | `src/envios/rotas.ts` |
| uma conta pronta que a transportadora deixa de aceitar volta a rascunho (revisão do #397, P3-6) | `src/envios/repositorio.ts` |
| 11 testes pela API com a transportadora de ensaio | `test/envios-etiquetas.test.ts`, `test/transportadora-falsa.ts` |

**Desvios do desenho:**
- **O ficheiro fica na base**, não no armazenamento de ficheiros (§3.5): a
  pasta das imagens apaga o que nenhum artigo usa, e a etiqueta tem dados
  pessoais.
- **`entregue_em` é a hora a que o Eurolify soube**, não a do evento da
  transportadora (§4.2): o gatilho da 0047 põe-na. A data do evento fica no
  evento de seguimento e na prova de entrega. Para a livre resolução, a
  hora posterior dá ao cliente mais tempo, nunca menos (L6).
- **O ficheiro da etiqueta é `GET …/label/file`** (rota à parte), e o peso da
  embalagem é `PUT /warehouses/{id}/packaging`.
- **Os perdidos e devolvidos** abrem um problema de tipo `outro` com a
  descrição (a pós-venda não tem tipos próprios para eles).

- **A referência é `<uuid>-<tentativa>`**, sem o `shp_` (R2): é o que a
  transportadora guarda, e o prefixo não lhe diz nada.
- **Não se emite `shipment.tracking_updated`** (§7.5); só `label_created`,
  `label_refused` e `label_voided`. Fica para quando houver quem o ouça.
- **Uma recusa responde 200 com `etiqueta: "recusada"`** e o motivo, em vez do
  erro `shipping.label_refused` (§7.4): a recusa é um resultado, não uma
  falha do pedido.
- **Corrigir o peso e mudar o serviço «com motivo»** (§3.3) não tem rota
  ainda: entra com os ecrãs do Hub.
- **Tentativa falhada e para levantar** ficam só no histórico; o aviso ao
  comerciante (Q4) entra com as notificações.

**Revisão do agente (#400, Sonnet 5.5), tratada neste pedido:**
- P1-1: as credenciais leem-se antes de a etiqueta passar a `a_pedir`; uma
  `a_pedir` com mais de 5 minutos (a API reiniciou) passa a incerta pela
  volta, e resolve-se pela referência.
- P2-1: com a etiqueta viva, a expedição não se cancela e o número, o
  serviço, a transportadora e a conta não se trocam por fora (gatilho).
- P2-2: «não existe» na consulta de uma incerta só se conclui 15 minutos
  depois (a confirmar com a especificação dos CTT, V4).
- P2-3: os eventos e o problema na mesma transacção; uma mudança que o
  armazém recuse fica num ponto de retorno: os eventos ficam e abre-se um
  problema, sem 5xx sem fim.
- P2-4: a volta conta as falhas, com o código, e regista-as.
- P2-5: o apagamento do titular limpa também o motivo da etiqueta e o texto
  da transportadora nos eventos; os avisos que não se ligaram a nada
  resumem-se 30 dias depois de chegar.
- P2-6: cada chamada à transportadora tem tempo-limite (30 s por omissão).
- P2-7: testes da concorrência, do pedido a meio, do tempo-limite, dos
  eventos fora de ordem, da contradição, do isolamento das rotas e dos
  avisos, e da tentativa antiga.
- P3-1, P3-2, P3-3, P3-4, P3-5 tratados (a tentativa do aviso, eventos
  inválidos descartados, a contradição abre um problema, o problema da
  incerta abre-se uma vez, a decifra do aviso dentro do `try`).
- **Ficam:** P3-6 (limite por conta nos avisos), P3-7 (anular com a
  expedição bloqueada), P3-8 (validar a resposta do adaptador antes de
  gravar), P3-9 (`Idempotency-Key` guardada nas rotas da etiqueta), P3-10
  (índice por seguimento, emitidas que nunca saem), P3-11 (peso do kit pela
  composição congelada). Do §14 também ficam o P3-5 (leitura da conta sem
  bloqueio) e o P3-7 (rotação da chave); o P3-8 (tempo-limite) ficou feito.

**Testado depois (13/10/2026, migração 0083; revisão do #414, P3-1):** o
apagamento do titular leva o ficheiro e limpa os avisos e os eventos; e o
que a transportadora manda **depois** do apagamento, numa encomenda já
limpa, entra sem o nome: o evento com o marcador no texto (o estado
normalizado e a data ficam) e o aviso, ao ligar-se à expedição, com o
marcador no corpo (`envios_encomenda_limpa()`; o caso «depois do apagamento
do titular» em `envios-etiquetas.test.ts`, com duas contraprovas). A
encomenda conta como limpa pelo e-mail do contacto (o nome é texto livre do
cliente). Um aviso que chega durante o apagamento espera por ele (a leitura
toma a encomenda, `FOR KEY SHARE`; caso «durante o apagamento», com
contraprova). **Excepção:** um aviso que não se liga a nenhuma expedição
(assinatura errada, referência desconhecida, etiqueta já não viva) fica em
bruto até ao resumo dos 30 dias, como já era (revisão do #420, P2-1, P2-2,
P3-1).

**Não testado:** a etiqueta incerta sem resposta há
mais de um dia (o problema); um evento que o armazém recuse (o ponto de
retorno); o resumo dos avisos aos 30 dias. A concorrência testa-se pela API,
mas o segundo pedido chega depois de o primeiro ter gravado `a_pedir`, não
dentro do bloqueio.

**Por fazer:** o adaptador dos CTT (quando houver a especificação e as
credenciais de teste); a parte C (o segundo adaptador); os ecrãs do Hub.


## 16. Parte C — o adaptador da Sendcloud (12/10/2026; desenho e código)

Pedido do Diogo, 12/10/2026: *«ainda não; avança com a parte C»*. Os CTT
esperam pela especificação. A Sendcloud é o segundo adaptador (Q2).

### 16.1 O que se leu (V6)

Documentação técnica da Sendcloud, API v3, lida a 12/10/2026 em
`sendcloud.dev` (**W**). Nada se correu contra uma conta real.

| Ponto | O que diz | Página |
|---|---|---|
| Autenticação | Basic: chave pública e chave secreta da integração. OAuth2 opcional. | `docs/getting-started/authentication` |
| Endereço | `https://panel.sendcloud.sc/api/v3` | todas |
| Etiqueta | `POST /shipments/announce` (síncrono) devolve o envio, o número de seguimento, o endereço de seguimento e, com um volume só, o ficheiro em base64 (`label_file`) | `api/v3/shipments/create-and-announce-a-shipment-synchronously` |
| Idempotência | `external_reference_id` é único por conta. Repeti-lo dá **409 e devolve o envio que já existe**: é a nossa referência «expedição-tentativa» (R2). | idem |
| Consultar | `GET /shipments?external_reference_id=…` e `?tracking_number=…` | `api/v3/shipments/retrieve-shipments` |
| Anular | `POST /shipments/{id}/cancel`: 200 anulada; 202 em fila (a Sendcloud anula se o envio não andar em 14 dias); 409 recusada (já anulada, entregue, ou mais de 42 dias depois de anunciada). Nem todas as transportadoras deixam. | `api/v3/shipments/cancel-a-shipment` |
| Seguimento | `GET /parcels/tracking/{número}`: eventos com `event_at`, `phase`, `exception` e `sub_status`. **Os eventos não têm identificador.** | `api/v3/parcel-tracking/…`, `docs/parcel-tracking/retrieve-tracking-info` |
| Avisos | HMAC-SHA256 do corpo em bruto, em hexadecimal, no cabeçalho `Sendcloud-Signature`, com a chave secreta ou a chave de assinatura dos avisos. Repete até 10 vezes e pode chegar fora de ordem. **O conteúdo do aviso na v3 não está descrito** («o mesmo do volume»). | `api/v3/webhooks/index` |
| Serviços | `POST /shipping-options`: por origem e destino, com o peso máximo, `requirements.fields` (`to_email`, `to_telephone`, medidas), se exige ponto de recolha ou documentos aduaneiros, e `dangerous_goods` (sim ou não, sem números ONU) | `api/v3/shipping-options/return-a-list-of-available-shipping-options` |
| Etiquetas de teste | o serviço `sendcloud:letter` («Unstamped letter») não é cobrado | `docs/getting-started/creating-test-labels` |
| Limites | 100 pedidos/min para escrever, 1000/min para ler | `docs/getting-started/rate-limits` |

### 16.2 Onde trata os dados (regra 4 do `AGENTS.md`, Q2)

- **A Sendcloud é dos Países Baixos** (Sendcloud B.V., Eindhoven). No acordo de
  tratamento (DPA, lido a 12/10/2026, **W**), é **subcontratante**. Os dados
  do cliente do comerciante (nome, morada, e-mail…) servem «para as
  transportadoras entregarem e para o seguimento». **Apagam-se 365 dias depois
  de o envio acabar.** As transferências para fora da UE fazem-se pelo
  capítulo V do RGPD, com cláusulas-tipo.
- **A lista oficial dos subcontratantes** (página de apoio da Sendcloud, de
  01/08/2024) **não a li**: recusa o acesso automático (403). A pesquisa
  resume-a assim:
  - AWS EMEA SARL, onde corre a plataforma, na UE;
  - CM.com, 360dialog e Trustpilot, para avisos por SMS, WhatsApp e avaliações;
  - Twilio SendGrid, para os e-mails de seguimento;
  - Zendesk, para o apoio.
- **Um agregador de terceiros** (openli, 28/11/2024) dá o SendGrid e o Zendesk
  a tratar dados **nos EUA**. **Não verifiquei, C.**
- **O que reduz o risco:** o Eurolify só envia o telefone e o e-mail de quem
  recebe quando o serviço os exige (§6). Os avisos de seguimento da Sendcloud
  por e-mail e por SMS ficam então sem o contacto do cliente. Em modo teste
  (D2), o único serviço não exige nenhum dos dois.
- **Antes do modo real** (uma migração com decisão escrita, 0074), é preciso:
  ler a lista oficial e o DPA com o jurista; e o Diogo ou o Bruno decidirem,
  por escrito, se os subcontratantes dos EUA são aceitáveis.

### 16.3 Decisões técnicas (de rotina)

| # | Decisão | Porquê |
|---|---|---|
| D1 | **Serviços por conta.** Na Sendcloud, os serviços dependem das transportadoras que cada conta tem ligadas. Ao passar a chamada de teste, o Eurolify pede-os para a origem (o país do remetente) e para cada país dos mercados do comerciante, e guarda uma fotografia na conta (`servicos`, `servicos_em`). O checkout, os métodos e a etiqueta leem a fotografia, sem chamar a Sendcloud. Testar outra vez renova-a. Os adaptadores de lista fixa (CTT) ficam como estão. | o contrato da §8 (`servicos()`) supunha uma lista fixa |
| D2 | **Em modo teste, só o serviço `sendcloud:letter`**, que não é cobrado | o modo teste não pode pagar etiquetas |
| D3 | **Ficam de fora os serviços** que exigem ponto de recolha (Q5, parte 3), medidas (o modelo não as tem) ou documentos aduaneiros. Nenhum aceita perigosos (`aceitaOnu` vazio): a Sendcloud diz só «sim ou não», sem números ONU. | R4: não se vende o que não se consegue cumprir |
| D4 | **O aviso é um sinal para consultar.** Verifica-se a assinatura e lê-se só o número de seguimento ou a referência. A consulta à Sendcloud fica marcada para daí a 1 minuto. Os eventos vêm sempre da consulta. | o conteúdo do aviso não está descrito (16.1) |
| D5 | **O identificador de um evento** é `event_at`, `phase`, `exception` e `sub_status`, juntos | os eventos não o trazem; o mesmo evento repetido continua a não contar duas vezes |
| D6 | **Estados:**<br>• `dropped` e `accepted` ⇒ recolhida<br>• `sorted`, `in_transit`, `customs` e `in_delivery` ⇒ em trânsito<br>• `attempted` ⇒ tentativa falhada<br>• `pup` ⇒ para levantar<br>• `delivered` **sem subestado** ⇒ entregue<br>• tudo o resto ⇒ outro, só no histórico<br>Ficam em «outro», todos **C**:<br>• `delivered` com subestado (ex.: vizinho, caixa do correio): pode não ser a posse que conta para a livre resolução (L6), e não verifiquei que subestados existem<br>• `delivery_forced`: sem confirmação da transportadora<br>• `missing`: pode ser temporário<br>• `returned_sender`: «vai ser devolvida» ainda não é devolvida | só para a frente (§4.2), e estados finais só com certeza |
| D7 | **Anular:** 200 ⇒ anulada; 202, 409 ou 404 ⇒ não é possível | com o 202 a anulação fica em fila e a etiqueta continua viva: pedir outra arriscava duas etiquetas vivas |
| D8 | **Respostas:**<br>• 4xx com erros ⇒ recusada, com o primeiro motivo<br>• 5xx, 429, 408 ou sem resposta ⇒ incerta (R2)<br>• o volume em falha de anúncio ou anulado ⇒ recusada<br>• o volume ainda a ser anunciado, sem número ⇒ incerta, nunca «recusada» nem «não existe»<br>• um ficheiro que não é PDF ⇒ incerta<br>Em modo teste, um serviço que não seja o de teste nem chega à Sendcloud. | R2 |
| D9 | **Só vai o que a entrega precisa** (§6): nome, morada, peso e, só se o serviço exigir, telefone e e-mail. Não vão as linhas, os preços nem o número da encomenda. | minimização |

**Serviços por conta, ao testar a conta outra vez:**
- A fotografia nova é recusada se deixar sem serviço, ou sem um país do
  mercado, um método activo da conta.
- Se a lista de serviços falhar, a conta fica como estava.
- Só se lida com serviços cujo peso venha em kg ou g e cujo código a base
  aceite. Os que não trazem requisitos ficam de fora (D3).

### 16.4 Em código (migração 0080)

| O quê | Onde |
|---|---|
| o adaptador: teste da conta, serviços da conta, etiqueta, consulta pela referência, anular, seguimento, aviso | `src/envios/sendcloud.ts` |
| o contrato ganha `servicosDaConta` (opcional); o núcleo lê a fotografia da conta quando o adaptador o tem (`servicosDe`) | `src/envios/adaptador.ts`, `src/envios/repositorio.ts`, `src/envios/etiquetas.ts` |
| a conta guarda `servicos` e `servicos_em`; a transportadora `sendcloud`; o código do serviço passa a aceitar `:` e `/`, até 100 caracteres | migração 0080; `src/checkout/rotas.ts` |
| um aviso sem eventos marca a consulta para daí a 1 minuto (D4) | `receberAviso` |
| o servidor liga o adaptador da Sendcloud | `src/servidor.ts` |
| 9 testes do adaptador contra uma Sendcloud de ensaio, sem base; 1 teste pela API (a conta, a fotografia, o método recusado e aceite, a etiqueta, o aviso, a volta até entregue, o aviso atrasado, a lista que falha, a fotografia recusada) | `test/envios-sendcloud.test.ts`, `test/sendcloud-falsa.ts`, `test/envios-etiquetas.test.ts` |

**Por fazer na parte C:** os ecrãs do Hub dos envios ficam para um pedido à
parte. Ficam por verificar numa conta de teste:
- o conteúdo real dos avisos;
- os estados de uma transportadora portuguesa;
- se `sendcloud:letter` aparece na lista de serviços de uma conta portuguesa.
  Se não aparecer, o modo teste fica sem serviços.

## 17. Ligar os envios na VPS de ensaio (desenho; issue #393)

Pedido do Diogo, 13/10/2026: *«depois avança com o próximo passo dos
envios»* e *«sim, avança com o desenho»*. Desenho aprovado pelo Diogo a
13/10/2026 (*«sim, aprovo; avança com o código»*).
Mexe na VPS: entra por um pedido revisto e é o GitHub que o aplica
(ADR-0028, regra 9 do `AGENTS.md`). Skills: `observability-security`,
`eu-gdpr-privacy`, `order-fulfilment`.

**Hoje, na VPS de ensaio** (lido no repositório a 13/10/2026):
- a API arranca sem `ENVIOS_CHAVE`:
  - o `eurolify-publicar` só lhe passa o `api.env`, o `api-base.env`, o
    `api-hub.env`, o `api-totp.env`, o `api-smtp.env` e o `api-vies.env`;
  - por isso, ligar uma transportadora dá `shipping.not_configured` e não
    se pedem etiquetas;
  - o Hub di-lo («Os envios ainda não estão ligados neste servidor»);
- o nginx do Hub (`infra/vps/ficheiros/nginx-hub.conf`) só publica `/hub/` e
  os ecrãs: os avisos da Sendcloud não chegam à API (§29.3 do `docs/22`).

Ex.: depois deste pedido, o Diogo liga a Sendcloud em modo teste pelo Hub do
ensaio. Cola as chaves de uma conta de teste, carrega em «Testar a ligação»
e a conta fica «Pronta». No painel da Sendcloud indica o endereço
`https://hub.eurolify.eu/webhooks/carriers/sendcloud/cac_…` para os avisos.

### 17.1 O que entra e o que fica de fora

| Entra |
|---|
| **A chave dos envios** (`/etc/eurolify/api-envios.env`, 600, root). Tem `ENVIOS_CHAVE` (32 bytes em base64) e `ENVIOS_CHAVE_VERSAO=1`. **Gera-se na máquina uma vez e nunca se reescreve**, como a chave TOTP (passo 10 do `preparar.sh`): trocá-la deixaria ilegíveis as credenciais guardadas, e cada conta teria de as receber outra vez. É **diferente da dos pagamentos** (revisão do #406, P3-9). O `eurolify-publicar` só a passa à API se tiver o formato que a API aceita; uma estragada derrubava a API ao arrancar. |
| **A cópia da chave** guarda-se fora da máquina e à parte das cópias da base, como a `api-totp.env` e a `age.key` (LEIA-ME da VPS). |
| **Os avisos da Sendcloud no nginx**: uma `location` só para `/webhooks/carriers/sendcloud/cac_<uuid>`. Leva as mesmas travas da `/hub/`: o pedido original tem de ter essa forma, e o caminho que vai para a API é o normalizado. Só aceita `POST`, com corpo até 64 KB (o limite do site), e tem um
limite de pedidos por IP (`limit_req`, o mecanismo do login do MCP em
`nginx-mcp.conf`, com valores nossos: 60 por minuto e 20 de folga, sem
fonte, a rever com os avisos reais). O resto de `/webhooks/` continua a dar 404. |
| **O texto provisório do Hub** (`enviosAvisosVps`, «os avisos ainda não chegam») sai no mesmo pedido, como o §29.3 do `docs/22` diz (rede temporária com fim). |
| **Os testes da VPS**: a chave dos envios ganha um teste como o `chave-totp.sh`. O `nginx -t` e o 404 dos outros `/webhooks/` medem-se depois de aplicar. |

| Fica de fora, e porquê |
|---|
| **Os avisos dos pagamentos** (`/webhooks/payments/…`): o ensaio também não tem a chave dos pagamentos, e ligá-los é outra decisão. |
| **O modo real da Sendcloud**: a decisão escrita sobre os subcontratantes de fora da UE continua por tomar (`docs/36` §16.2). Só o modo teste. |
| **Os dados de clientes reais**: a VPS do ensaio está no Reino Unido até à migração para Paris (ADR-0018 e ADR-0019). Só contas e encomendas de teste. |
| **Os CTT**: sem especificação nem credenciais de teste. |

### 17.2 Como entra na máquina

1. O pedido muda `infra/vps/`:
   - `preparar.sh`: o passo 10 gera a chave, se faltar;
   - `ficheiros/lib/`: a chave dos envios, com a validação;
   - `ficheiros/sbin/eurolify-publicar`: passa o ficheiro à API;
   - `ficheiros/nginx-hub.conf`: a `location` dos avisos;
   - `testes/`: o teste novo;
   - `LEIA-ME.md`: os ficheiros, a cópia e a troca da chave.
2. Com o pedido no `main`, o fluxo `aplicar-script` corre o `preparar.sh`,
   primeiro em `--mostrar` e depois a aplicar (ADR-0028). O passo 10c recria
   a API com a mesma imagem quando a chave acaba de nascer.
3. **O Diogo ou o Bruno guardam a cópia da chave fora da máquina**, do seu
   computador, pela chave de emergência (ADR-0020), copiando o ficheiro sem
   o abrir e nunca numa sessão do Claude. O uso fica numa memória. É o único
   passo à mão. No ensaio pode esperar (perdê-la custa voltar a colar as
   chaves de teste); antes de Paris é obrigatório.
4. Mede-se, pelo fluxo só de leitura:
   - o `/health` da API;
   - `POST /webhooks/carriers/sendcloud/cac_<uuid qualquer>` sem assinatura
     dá 401 ou 404 da API, e não do nginx;
   - `GET` nesse caminho dá 403 do nginx;
   - `/webhooks/payments/x` dá 404 do nginx.

### 17.3 Por onde é que isto ainda pode sair errado

- **Perder a chave** deixa as credenciais das transportadoras ilegíveis. A
  API diz «defina-as outra vez» (`shipping.account_not_ready`). No ensaio
  isso custa só voltar a colar as chaves de teste; a cópia fora da máquina
  é obrigatória antes da migração para Paris.
- **Um caminho aberto a mais no nginx**: a `location` é exacta, e há uma
  medição de que o resto de `/webhooks/` dá 404.
- **Um aviso com dados de quem recebe** pode trazer o nome. Fica gravado em
  bruto (`aviso_transportadora`, `docs/36` §6). No ensaio só há encomendas
  de teste.
- **A API sem a chave** continua a arrancar, sem envios, como hoje. Uma
  chave estragada não lhe chega.

### 17.4 Antes de dizer que está feito

- os testes da VPS (`infra/vps/testes/`) no fluxo `script-vps`;
- o `shellcheck` no CI, como hoje;
- o `nginx -t`, que hoje não corre no CI: corre o `preparar.sh` antes de
  ligar o site (passo 14), e um erro deixa o site como estava;
- as medições do 17.2 depois de aplicar, numa memória com a data;
- o Hub sem o texto provisório, com as capturas do ecrã da conta.

### 17.5 Em código (13/10/2026)

- **A chave:**
  - `infra/vps/ficheiros/lib/chave-envios.sh`, igual à da chave TOTP, com a
    versão que a API aceita (`[0-9A-Za-z_-]{1,20}`);
  - o passo 10 do `preparar.sh` gera-a e avisa para guardar a cópia;
  - o 10c recria a API quando ela nasce ou muda;
  - o `eurolify-publicar` só a passa à API se for válida.
- **O nginx:**
  - uma `location` com a expressão exacta do caminho e a mesma trava do
    `$request_uri`;
  - `limit_except POST`;
  - `limit_req` de 60 pedidos por minuto, com 20 de folga;
  - `location /webhooks/` dá 404.
- **O Hub:** saiu o texto provisório `enviosAvisosVps` (§29.3 do
  `docs/22`).
- **Testes:**
  - `infra/vps/testes/chave-envios.sh` (novo);
  - `infra/vps/testes/publicar.sh`: chave nova, em falta e estragada.

**Medido localmente a 13/10/2026**, com o nginx 1.27 num contentor, um
certificado de ensaio e um servidor falso no lugar da API (sem IPv6 no
contentor, por isso tirou-se a linha `[::]:443` só nessa cópia):

| Pedido | Resultado |
|---|---|
| `nginx -t` | sem erros |
| POST ao caminho dos avisos | chega à API |
| GET ao mesmo caminho | 403 |
| com consulta, CTT, pagamentos, maiúsculas, `%63ac_…`, `..%2F`, barra no fim | 404 |
| corpo de 70 KB | 413 |
| 30 POST seguidos | 19 passam, 11 levam 429 |
| `/hub/me` e `/entrar` | como antes |

**Aplicado na VPS a 13/10/2026** (#423, fluxo `aplicar-script`): a chave
gerada, a API recriada com o `/health` a responder e o nginx do Hub
recarregado (`memoria/envios-na-vps-13out2026.md`). **Medido a 13/10/2026** (o 17.2, ponto 4; #424, fluxo `medir`): a
`ENVIOS_CHAVE` está na API no ar; o `POST` à Sendcloud com uma conta
fictícia leva 401 da API; o `GET` leva 403 do nginx (`limit_except`, e não
405); os CTT e os pagamentos levam 404 do nginx.

## 18. Encomendas paradas perto da data-limite (desenho; Q4, issue #393)

Pedido do Diogo, 13/10/2026: *«depois avança com o próximo passo dos
envios»*; aprovado no mesmo dia: *«sim, aprovo; avança com o código»*. Completa a Q4, aprovada a
12/10/2026 (`docs/06`, ED): *«etiqueta incerta, perdida, devolvida e
encomenda parada vão para a fila «problema» da peça 21, sem fila nova»*. As
três primeiras já estão no código (§15). A **encomenda parada** ficou por
fazer: procurei em `apps/api/src` e nas migrações por `data_limite`,
«parada» e «sem expedição», e só o checkout lê a data-limite. Skills:
`order-fulfilment`, `consumer-rights-eu`, `platform-architect`.

Ex.: a encomenda de 13/10/2026 foi paga com a data-limite de 12/11/2026. A
07/11/2026 ainda tem unidades por expedir. Abre-se um problema: «A encomenda
tem 2 unidades por expedir e a data-limite de entrega é 12/11/2026».
Aparece na lista «A decidir» do Hub, com o prazo de 2 dias.

### 18.1 O que entra

| O quê | Como |
|---|---|
| **Quando está parada** | o estado é `paga`, `em_preparacao` ou `expedida_parcial`, há unidades por expedir e faltam **5 dias ou menos** para a data-limite, contados no fuso da loja (Q4). Inclui as que já passaram da data-limite |
| **A data-limite** | a que o cliente viu no checkout (L1), copiada na encomenda (`metodo_entrega.data_limite`). Nunca se recalcula a partir do método de hoje |
| **O que abre** | um **problema** da pós-venda, do tipo `atraso` (no desenho era `outro`; ver §18.6), com uma descrição sem dados pessoais: unidades por expedir e data-limite |
| **Uma vez por encomenda** | uma marca, posta na mesma transacção que o problema (no código, a tabela `encomenda_parada`; ver §18.6). Uma encomenda nunca abre dois problemas por estar parada |
| **Quem procura** | uma volta de hora a hora, à parte da dos envios, que não depende da chave das transportadoras (§18.6). Um erro numa encomenda não pára as outras |
| **O aviso** | o da fila `problema`: aparece na lista «A decidir», com o prazo de 2 dias, e o aviso ao vencer (`docs/33`, R6) vai também por e-mail (`docs/34` §12). Não há aviso novo |
| **O que a pessoa faz** | expede (a encomenda sai do estado, mas o problema fica até ser fechado), combina com o cliente, cancela ou reembolsa. O problema fecha-se com `POST /problems/{id}/close` ou com o reembolso (`decidirProblema`), e decide sempre uma pessoa (regra 5 do fiscal: nada em lote) |

### 18.2 O que fica de fora, e porquê

| Fica de fora |
|---|
| **Avisar o cliente.** O e-mail ao cliente espera pela escolha do serviço transaccional (`docs/34` §9) |
| **Cancelar ou reembolsar sozinho.** A lei dá ao consumidor o pedido de um prazo adicional e só depois a resolução (L4, Dir. 2011/83/UE, art. 18.º). Quem decide é uma pessoa |
| **Fechar o problema quando a encomenda é expedida.** Uma expedição pode sair depois da data-limite, e a pessoa tem de ver o caso. Fica aberto até ela o fechar |
| **Uma fila nova** em «A decidir»: a Q4 diz «sem fila nova» |
| **Os 5 dias por comerciante.** Fica um valor só, numa função da base (`envios_dias_de_aviso_parada()`), como o `posvenda_dias_de_aviso()`. Muda-se se um comerciante o pedir |

### 18.3 Por onde é que isto ainda pode sair errado

- **Uma encomenda antiga sem `data_limite`** (de antes da 0074): sem data,
  não há aviso. Diz-se na lista de verificação do pedido quantas há no
  ensaio.
- **O fuso:** o «dia» é o da loja (`comerciante.fuso`), como no checkout. Um
  teste à volta da meia-noite.
- **Duas voltas ao mesmo tempo** (dois processos da API): a marca (chave
  primária) e o problema na mesma transacção impedem o segundo, e a volta
  confere a encomenda outra vez com ela presa (§18.6).
- **Uma encomenda que volta a parar** (expedida em parte, ainda com
  unidades): não abre outro problema. O primeiro diz quantas unidades havia
  quando abriu, e a encomenda mostra o resto.
- **Muitas encomendas paradas de uma vez** (um armazém fechado): abre um
  problema por encomenda, todos na lista, sem cortar (`docs/33`, R10).

### 18.4 Testes que têm de falhar sem a protecção

- uma encomenda a 6 dias não abre; a 5 abre; a que já passou também abre;
- a segunda volta não abre outro;
- `expedida`, `cancelada` ou sem unidades por expedir não abre;
- o fuso: perto da meia-noite, o dia é o da loja;
- o isolamento entre comerciantes (RLS): a volta de um não toca no outro;
- sem `data_limite`, não abre e não falha.

### 18.5 Como entra no código

Um pedido só, com:
- a migração 0085 (a 0083 e a 0084 já eram de outros pedidos): a marca, a função dos dias e a função que lista as
  paradas;
- a volta em `src/envios/`;
- os testes;
- este §18 com «Em código».

Sem ecrã novo: o problema já aparece em «A decidir» e na encomenda.

### 18.6 Em código (13/10/2026; migração 0085)

| O quê | Onde |
|---|---|
| os 5 dias, num sítio só, e a data-limite lida da cópia da encomenda (NULL quando falta ou não é uma data, sem parar a volta) | `envios_dias_de_aviso_parada()`, `envios_data_limite()`, migração 0085 |
| a marca «já avisada», com o problema que abriu; só se acrescenta, com o RLS forçado | `encomenda_parada` |
| as candidatas por comerciante, postas e tiradas pelos gatilhos da encomenda e da marca; as que já existiam entram na migração | `tarefa_parada` (interna) |
| a decisão, dentro do comerciante: o estado, a data no fuso da loja, sem marca e com unidades que ainda não saíram (uma expedição só criada ainda está no armazém) | `envios_paradas()` |
| a volta: de hora a hora, à parte da volta das etiquetas (corre sem a `ENVIOS_CHAVE`); com a encomenda presa, confere-a outra vez antes de abrir; abre o problema e a marca na mesma transacção; uma segunda volta ao mesmo tempo desfaz o seu | `src/envios/paradas.ts` (`agendarEncomendasParadas`); `src/servidor.ts` |
| 7 testes com o PostgreSQL 18.6: os 5 dias, depois da data, uma vez só, a expedição criada contra a expedida, o fuso a leste e a oeste, a candidata (entra ao pagar, sai ao cancelar e ao avisar; a API não a lê), a cancelada, duas voltas ao mesmo tempo, o isolamento e a data inválida | `test/envios-paradas.test.ts` |

**Revisão do #426** (Sonnet 5.5; 0 P0, 0 P1, 3 P2, 9 P3; publicada no
pedido): corrigidos os P2-1 (conferir outra vez com a encomenda presa), P2-2
(a volta à parte, sem a chave), P2-3 (os testes que faltavam) e os P3-1 a
P3-4 (estes textos e a memória). Ficam, com a razão:
- **P3-5** (a cabeça da fila): nenhum erro por encomenda a faz falhar sempre;
  um fuso inválido não entra (a coluna confere-o, 0001).
- **P3-6** (o gatilho sem o comerciante da transacção): inofensivo, porque
  `envios_paradas` volta a filtrar.
- **P3-7** (a soma contra a linha): uma linha não sai a mais
  (`shipments.quantity_exceeded`).
- **P3-8** (encomendas sem nada para expedir): fica para quando entrarem os
  produtos digitais (`digital-products-eu`).
- **Sem teste** da encomenda cancelada entre a lista e o problema (a
  conferência com a encomenda presa): a corrida não se reproduz sem um
  gancho no meio da volta.

**Desvios do desenho:**
- **O problema é do tipo `atraso`**, e não `outro`: a pós-venda já tem esse
  tipo (0058), e é o que o caso é.
- **A marca é uma tabela própria** (`encomenda_parada`), e não uma coluna na
  encomenda: a encomenda tem os campos guardados por gatilho (0047), e a
  tabela guarda também o problema que abriu, a data e as unidades.
- **Uma tabela interna de candidatas** (`tarefa_parada`), como a
  `tarefa_encomenda` da 0047: a volta de todos os comerciantes não lê a
  encomenda, que tem o RLS forçado também para o dono das funções. Para
  escolher os comerciantes conta-se o fuso mais adiantado (UTC+14); o dia de
  cada loja decide-se dentro dela.

## 19. Corrigir o peso e mudar o serviço de uma expedição (desenho; issue #393)

Pedido do Diogo, 13/10/2026: *«depois avança com o próximo passo dos
envios»*; aprovado no mesmo dia, com o serviço só para o dono e o gestor:
*«sim, aprovo; avança com o código»*. O §3.3 já o previa: *«a pessoa
pode corrigir [o peso] com motivo»* e *«mudar de serviço é uma decisão de uma
pessoa, com motivo (`docs/27`, R6)»*. Ficou por fazer na parte B (§15,
«Desvios»: *«não tem rota ainda: entra com os ecrãs do Hub»*), e o «Expedir»
deixou-o de fora (`docs/22` §33.1). Skills: `order-fulfilment`,
`consumer-rights-eu`, `eurolify-transport-logistics-eu`,
`observability-security`.

**Hoje há dois becos sem saída** (lido em `src/envios/etiquetas.ts` a
13/10/2026):
- **Uma variante sem peso** faz o pedido da etiqueta falhar com
  `shipping.invalid_field`, e a pessoa não tem como avançar.
- **Um serviço que a transportadora deixou de ter** falha com
  `shipping.service_unknown`, e a mensagem diz «muda-o uma pessoa, com
  motivo» quando isso ainda não existe.

Ex.: uma encomenda de 3 frascos sai do armazém de Lisboa. A balança diz
1 450 g, e o Eurolify calculou 1 290 g, porque a caixa maior não é a de
omissão. O armazém escreve «1450» com o motivo «caixa grande, pesada na
balança» e pede a etiqueta com esse peso.

### 19.1 O que entra

| O quê | Regra |
|---|---|
| **Corrigir o peso** | `PUT /shipments/{id}/weight` com `peso_g` (1 a 1 000 000) e `motivo` (3 a 500 caracteres, sem dados de clientes). `peso_g: null` volta ao calculado. A etiqueta usa o corrigido em vez da soma. Âmbito `fulfilment:write` (o dono, o gestor e o armazém: quem pesa a caixa) |
| **Mudar o serviço** | `PUT /shipments/{id}/service` com `conta`, `servico` e `motivo`. `null` volta ao vendido. A conta tem de estar `pronta` e o serviço tem de ser dela e de servir o país da morada, o peso, os números ONU da expedição e o telefone, se o pedir. Âmbito `shipping:write` (o dono e o gestor): muda o custo e a transportadora, por isso o armazém não decide |
| **Quando se pode** | só com a expedição `criada` e a etiqueta `por_pedir`, `recusada` ou `anulada`. Com uma etiqueta viva (`a_pedir`, `emitida`, `incerta`), anula-se primeiro (R2) |
| **O vendido não muda** | a encomenda e a cópia do método na expedição (`metodo_entrega`) ficam como foram vendidas: o preço, a data-limite (L1) e o método para a livre resolução (L10). O serviço escolhido fica em colunas próprias da expedição |
| **O rasto** | cada correcção grava quem, quando, o valor antigo, o novo e o motivo (`docs/28`, `eurolify.motivo`). A expedição mostra «peso corrigido» e «serviço mudado», com o motivo |
| **Concorrência** | as duas rotas levam a `versao` da expedição: a segunda pessoa recebe `shipping.version_conflict` e relê |
| **Hub («Expedir»)** | na expedição: «Corrigir o peso» (com o calculado à vista) e «Mudar o serviço» (só os serviços que servem esta expedição, de contas prontas), cada um com o motivo obrigatório. O erro `shipping.service_unknown` passa a apontar para «Mudar o serviço» |

### 19.2 O que fica de fora, e porquê

| Fica de fora |
|---|
| **Cobrar a diferença ao cliente** ou mudar o preço dos portes: o cliente pagou o método vendido (L2), e a diferença é do comerciante |
| **Mudar o serviço depois de a etiqueta existir**: anula-se e pede-se outra, como hoje |
| **Mudar o peso de uma variante a partir daqui**: corrige-se no artigo (catálogo). Aqui só se corrige esta caixa |
| **Vários volumes** numa expedição (Q6): continua um volume |
| **Escolher um serviço de um método manual pelo Hub**: uma expedição manual não tem etiqueta pelo Eurolify. Para passar a ter, muda-se o serviço **só pela API** (`PUT …/service`), que aceita uma conta mesmo quando o vendido era manual |

### 19.3 Por onde é que isto ainda pode sair errado

- **Um serviço mais lento** pode falhar a data-limite prometida (L1, L4). O
  Hub avisa disso ao lado da escolha (o aviso, sem a data: o ecrã da
  expedição não a tem; revisão do #429, P2-6). Os serviços não declaram
  prazos (§8), por isso o Eurolify não o pode conferir.
- **Um serviço que não aceita um perigoso**: a rota confere os números ONU
  da expedição contra os do serviço (R4, L9). Na dúvida, recusa.
- **O peso corrigido muito abaixo do real** pode dar uma taxa extra da
  transportadora. O motivo fica no rasto e o calculado fica à vista.
- **Uma IA pela chave**: as rotas aceitam chaves com o âmbito, mas o rasto
  diz que foi uma chave, e o motivo é obrigatório. Uma chave de agente de IA
  não muda o serviço (como o R11 do `docs/33`).

### 19.4 Testes que têm de falhar sem a protecção

- a etiqueta sai com o peso corrigido, e volta ao calculado com `null`;
- a etiqueta sai com o serviço escolhido; a encomenda e o `metodo_entrega`
  da expedição não mudam;
- recusa: sem motivo; com etiqueta viva; com a expedição já expedida;
  conta não pronta; serviço de outra conta; país não servido; peso acima do
  máximo; perigoso não aceite; telefone pedido e em falta;
- o armazém corrige o peso e não muda o serviço (403);
- `versao` antiga dá 409;
- isolamento: a conta de outro comerciante não serve;
- o rasto tem o valor antigo, o novo e o motivo.

### 19.5 Como entra no código

Um pedido com a API e os ecrãs, tal como o «Expedir»:
- a migração 0086 (no desenho, 0085; ver §19.6): as colunas
  `peso_corrigido_g`, `conta_escolhida_id` e `servico_escolhido`, o rasto
  `correcao_expedicao` e o gatilho que as guarda;
- as rotas da chave e as do Hub;
- os ecrãs, com as capturas para o teu OK do aspecto;
- este §19 com «Em código».

### 19.6 Em código (13/10/2026; migração 0086)

| O quê | Onde |
|---|---|
| o peso corrigido e o serviço escolhido na expedição; o vendido (`metodo_entrega`) não muda | migração 0086 |
| o gatilho: só com a expedição `criada` e a etiqueta `por_pedir`, `recusada` ou `anulada`; sempre com motivo (3 a 500); uma linha no rasto por campo mudado, com o antes, o depois, o motivo e o contexto da transacção | `expedicao_correcao()`; `correcao_expedicao` (só se acrescenta, RLS forçado) |
| a etiqueta usa o corrigido e o escolhido; um serviço escolhido confere também os perigosos ao pedir (L9) | `src/envios/etiquetas.ts` (`preparar`) |
| os serviços que servem a caixa (país, peso, ONU, telefone), de contas prontas; corrigir o peso; mudar o serviço, com a `versao` | `src/envios/correcoes.ts` |
| rotas da chave: `GET /shipments/{id}/services`, `GET /shipments/{id}/corrections`, `PUT /shipments/{id}/weight` (`fulfilment:write`), `PUT /shipments/{id}/service` (`shipping:write`; nunca uma IA) | `src/envios/rotas.ts` |
| as mesmas pelo Hub (`/hub/shipments/{id}/…`), com a pessoa como «quem» | `src/envios/rotas-hub-expedir.ts` |
| o «Expedir»: «Corrigir o peso» (com o calculado à vista) e «Mudar o serviço» (só o dono e o gestor; os serviços que a API devolve), o motivo obrigatório, as notas «peso corrigido» e «serviço escolhido» e a lista das correcções | `apps/hub/src/ecras/Expedir.tsx` |
| 9 testes da API com o PostgreSQL 18.6 (8 com a base, 1 da regra «serve a caixa») e 3 do Hub | `test/envios-correcoes.test.ts`; `apps/hub/test/expedir.test.ts` |

**Desvios do desenho:**
- **O motivo fica só no rasto** (`correcao_expedicao`), e não em colunas da
  expedição: uma regra num sítio, e a lista das correcções lê-o de lá.
- **Duas rotas de leitura a mais** (`…/services` e `…/corrections`): o ecrã
  precisa de saber que serviços servem a caixa sem os decidir ele.
- **Um código novo**, `shipping.ai_not_allowed` (403), para a IA que tenta
  mudar o serviço.
- **Um método manual passa a ter etiqueta só pela API**: o «Expedir» mostra
  as correcções só nas expedições com conta (o ecrã de um método manual não
  tem a parte da etiqueta).
- **A migração é a 0086**: a 0084 e a 0085 entraram entretanto.

**Revisão do #429** (Sonnet 5.5; 0 P0, 2 P1, 7 P2, 7 P3; publicada no
pedido):
- corrigidos:
  - **P1-1:** uma expedição acabada dava 500 pelo gatilho da 0079; agora o
    código confere o estado antes e responde 409;
  - **P1-2:** testes da chave de agente de IA e do cabeçalho `Eurolify-IA`
    pela chave, sem linha no rasto. Tirar o `chave.agenteIa` não os faz
    falhar: a chave de agente já põe a IA no rasto do pedido, e a recusa
    apanha-a por aí também;
  - **P2-1:** os testes do §19.4 que faltavam: conta não pronta, peso acima
    do máximo, etiqueta viva, sem motivo na base, rasto de outro
    comerciante, variante sem peso, e a regra «serve a caixa» com o país,
    o peso, os perigosos e o telefone;
  - **P2-2:** a etiqueta volta a conferir o país, o peso, os perigosos e o
    telefone, do vendido e do escolhido;
  - **P2-3:** a leitura dos serviços já não prende a expedição;
  - **P2-4:** a API diz se o escolhido deixou de servir, e o ecrã avisa;
  - **P2-5:** `shipping.service_unknown` aponta para «Mudar o serviço», e a
    recusa da etiqueta para «Corrigir o peso»;
  - **P2-6:** estes textos;
  - **P3-1:** o telefone conta igual nos dois sítios;
  - **P3-3:** com um serviço escolhido, um peso que não cabe nele
    recusa-se logo;
  - **P3-4:** numa recusa, o formulário fica aberto com o que se escreveu,
    e ao abrir o foco vai para o título dele.
- ficam, com a razão:
  - **P2-7** (o motivo fora do apagamento do titular): decidido pelo
    Diogo a 13/10/2026, *«fica só o aviso»*: o ecrã avisa para não escrever
    dados de clientes, e o apagamento do titular não limpa o motivo;
  - **P3-2:** um 200 vazio na lista de outra expedição não mostra nada
    (RLS);
  - **P3-5:** o `quem` é um identificador (`pessoa:per_…`) que não diz nada
    a quem lê a lista;
  - **P3-6:** a base recusa o motivo só com espaços;
  - **P3-7:** é intencional: arquivar uma conta escolhida faz a etiqueta
    dizer que a conta não está pronta.

## 20. O aviso ao comerciante: «tentativa falhada» e «para levantar» (desenho; Q4, issue #393)

Pedido do Diogo, 13/10/2026: *«depois avança com o próximo passo dos
envios»*; aprovado no mesmo dia, com o aviso para o dono, o gestor e o
armazém: *«sim, aprovo; avança com o código»*. Completa o último ponto da Q4
(`docs/06`, ED) que ficou por fazer: o §4.2 diz que a «tentativa falhada» e o
«disponível para levantar» *«só ficam no histórico (e o aviso ao comerciante,
Q4)»*, e o §15 deixou o aviso *«para quando houver notificações»*. Já há: a
fila de e-mails do `docs/34` (§3–§4, §12, §12.1). Skills: `order-fulfilment`,
`eu-gdpr-privacy`, `observability-security`.

Ex.: a transportadora diz, às 11:20 de 14/11/2026, que não encontrou ninguém
na morada da expedição `shp_…` (seguimento `3SYZXG1234567`). O dono, o gestor
e o armazém recebem um e-mail: «A transportadora não conseguiu entregar a
expedição shp_… (3SYZXG1234567) em 14/11/2026, 11:20. Veja o seguimento no
Hub, em «Expedir».» Sem o nome nem a morada de quem recebe.

### 20.1 O que entra

| O quê | Regra |
|---|---|
| **Quando** | um evento de seguimento novo com o estado `tentativa_falhada` ou `disponivel_para_levantar` (§4.2), numa expedição que ainda não acabou |
| **Uma vez** | um aviso por expedição e por estado: a segunda tentativa falhada da mesma expedição fica só no histórico (o seguimento mostra-a). Um «para levantar» depois de uma «tentativa falhada» avisa outra vez, porque é outra coisa a fazer |
| **O tipo** | `shipment.needs_attention`, com o estado nos `dados` |
| **A quem** | quem expede: o dono, o gestor e o armazém (`fulfilment:write`), lido outra vez no envio (`notificacao_destino()`), como no §12.1. O apoio não |
| **No envio** | fica `cancelada`, com `expedicao_ja_acabou`, se a expedição já estiver entregue, devolvida, perdida ou cancelada |
| **O que diz** | a loja, a expedição (`shp_…`), a transportadora, o número de seguimento, o estado (traduzido) e a data do evento no fuso do comerciante, e onde a ver no Hub. **Nunca** o nome, a morada nem o telefone de quem recebe, nem o texto da transportadora (pode trazê-los) |
| **Língua** | a do Hub do comerciante (N4) |
| **Dados pessoais** | os mesmos da N9 (a pessoa da equipa; 90 dias, **C**). O tratamento T10 do `docs/17` alarga-se: a finalidade inclui este aviso e os titulares passam a incluir o armazém |

### 20.2 O que fica de fora, e porquê

| Fica de fora |
|---|
| **Avisar o cliente**: espera pela escolha do serviço transaccional (`docs/34` §9) |
| **Abrir um problema na pós-venda**: a Q4 manda para a fila só a perdida, a devolvida, a incerta e a parada. Uma tentativa falhada resolve-se quase sempre com a transportadora |
| **SMS, WhatsApp ou aviso no Hub**: só o e-mail que já existe |
| **Os CTT**: sem adaptador real ainda (§11) |

### 20.3 Por onde é que isto ainda pode sair errado

- **Muitos e-mails** numa loja com muitas expedições: um por expedição e por
  estado, nunca por evento. Uma transportadora que repete o mesmo evento não
  repete o aviso.
- **Um evento atrasado** depois de a expedição estar entregue: não avisa (a
  expedição já acabou) e, se o aviso já estava na fila, cancela-se no envio.
- **O armazém recebe um e-mail** que antes não recebia: fica no T10, e cada
  um vê só a sua loja.

### 20.4 Testes que têm de falhar sem a protecção

- uma tentativa falhada dá um aviso a cada pessoa com `fulfilment:write`, e
  nenhum ao apoio, a quem saiu ou a uma pessoa desactivada;
- a segunda tentativa falhada da mesma expedição não dá outro; um «para
  levantar» dá;
- um evento numa expedição já entregue não dá nada; uma entregue antes do
  envio fica `cancelada`;
- o corpo não tem o nome, a morada, o telefone nem o texto da transportadora;
- outro comerciante não vê estas notificações;
- o texto em PT, ES e EN.

### 20.5 Como entra no código

Um pedido só: a migração 0087 (o tipo, o gatilho no `evento_seguimento`, o
destino e a conferência no envio), os modelos PT, ES e EN, o T10 do
`docs/17`, os testes e a revisão do agente. Sem ecrã novo.

### 20.6 Em código (13/10/2026; migração 0087)

| O quê | Onde |
|---|---|
| o tipo `shipment.needs_attention`; o gatilho no `evento_seguimento` (sem `ALWAYS`, regra da 0053); quem recebe (`envios_aviso_pode_receber()`, `fulfilment:write`); a referência por expedição e estado; a conferência no envio (`envios_aviso_espera()`); `notificacao_destino()` com o tipo novo | migração 0087 |
| os textos PT, ES e EN (o número de seguimento e a transportadora numa linha curta; um estado desconhecido falha com `dados_invalidos`) | `src/notificacoes/modelos.ts` |
| no envio: `expedicao_ja_acabou` | `src/notificacoes/repositorio.ts` |
| 4 testes com o PostgreSQL 18.6 | `test/envios-aviso-tentativa.test.ts` |
| o T10 do `docs/17` e o `docs/34` §12.2 | — |

**Desvio do desenho:**
- **Um evento no mesmo lote da entrega** (a tentativa e o «entregue» chegam
  juntos): o evento grava-se antes de a expedição mudar, e o aviso entra na
  fila. No envio cancela-se, sem e-mail. Um evento que chega depois da
  entrega não entra na fila (o §20.3 dizia só «não avisa»; o resultado é o
  mesmo: nenhum e-mail).
