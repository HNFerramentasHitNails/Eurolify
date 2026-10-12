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

## 15. Em código — parte B (12/10/2026; migração 0075; `docs/06`, ED)

Pedido do Diogo, 12/10/2026: *«depois avança com a parte B dos envios»*.
**Sem o adaptador real dos CTT** (V1: não há especificação pública). Tudo o
resto corre contra uma transportadora de ensaio com o contrato inteiro da §8.

| O quê | Onde |
|---|---|
| o contrato do adaptador completo: `pedirEtiqueta`, `consultarEtiqueta`, `anularEtiqueta`, `consultarSeguimento`, `lerAviso` | `src/envios/adaptador.ts` |
| a etiqueta na expedição: estado (§4.1, posto pela base), tentativa, conta e serviço copiados do método vendido (R1), peso da caixa (as variantes-folha mais a embalagem do armazém, Q6), motivo, seguimento e endereço público | migração 0075; `src/envios/etiquetas.ts` |
| uma etiqueta viva por expedição e a referência «expedição-tentativa» como chave de idempotência (R2); uma etiqueta incerta não se repete: consulta-se pela referência (existe ⇒ emitida; não existe ⇒ recusada, e pede-se outra) | idem |
| anular, se a transportadora deixar, antes de a expedição sair; o ficheiro sai | idem |
| o ficheiro da etiqueta na base (privado), apagado 30 dias depois de a expedição acabar (Q7) pela volta da API, ou logo num apagamento do titular (gatilho na encomenda) | migração 0075 |
| os eventos de seguimento, só acrescentados, um por `id_externo`; mudam a expedição pelas portas do armazém (`mudarExpedicao`), só para a frente | idem |
| os avisos das transportadoras: gravados em bruto antes de se tratarem, só com assinatura válida mudam alguma coisa (R3); a porta do endereço para o comerciante como a dos pagamentos | idem; `POST /webhooks/carriers/{transportadora}/{conta}` |
| perdida ou devolvida ao remetente, e uma etiqueta incerta sem resposta há mais de um dia ⇒ um problema na pós-venda (Q4, a fila «problema» da peça 21) | `src/envios/etiquetas.ts` |
| a volta da API de 5 em 5 minutos: o seguimento das emitidas, as incertas e os ficheiros a apagar | `agendarTrabalhoEnvios` |
| rotas: `POST /shipments/{id}/label`, `GET /shipments/{id}/label`, `GET /shipments/{id}/label/file`, `POST /shipments/{id}/label/void`, `GET /shipments/{id}/events`, `POST /shipments/{id}/refresh`, `PUT /warehouses/{id}/packaging` | `src/envios/rotas.ts` |
| uma conta pronta que a transportadora deixa de aceitar volta a rascunho (revisão do #397, P3-6) | `src/envios/repositorio.ts` |
| 6 testes pela API com a transportadora de ensaio | `test/envios-etiquetas.test.ts`, `test/transportadora-falsa.ts` |

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

**Não testado:** o apagamento do titular a levar o ficheiro e a resumir os
avisos (o gatilho existe; o teste precisa de uma encomenda acabada e de um
pedido de apagamento); a etiqueta incerta sem resposta há mais de um dia (o
problema); concorrência (dois pedidos de etiqueta ao mesmo tempo: a base
bloqueia a expedição, sem teste).

**Por fazer:** o adaptador dos CTT (quando houver a especificação e as
credenciais de teste); a parte C (o segundo adaptador); os ecrãs do Hub.

