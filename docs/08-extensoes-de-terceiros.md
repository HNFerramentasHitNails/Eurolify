# Extensões de terceiros — como qualquer programador acrescenta ao Eurolify

> **Versão de 03/10/2026 — desenho, sem código (ADR-0001).** Pedido do Diogo:
> *«é importante que haja a possibilidade de developers de terceiros,
> desenvolverem os seus próprios plugins, módulos, meios de pagamento, envios,
> regras, dentro do lumavo de forma fácil»*. Registado como requisito **K** em
> `06-decisoes-em-aberto.md`.
>
> Marcas de certeza como em `03-regulamentar-ue.md`: **W** pesquisa web a
> 03/10/2026; **M** memória dos sistemas actuais; **C** conhecimento prévio, não
> verificado.

## 1. A resposta curta

Sim, e desde o desenho: **o próprio Eurolify constrói os seus adaptadores
(EuPago, Mollie, CTT, Moloni…) com os mesmos contratos que um terceiro vai
usar.** Se o Eurolify consegue ligar um meio de pagamento por esse caminho, um
programador de fora também consegue — e o contrato fica provado antes de ser
aberto. É a mesma regra do Hub do Eurolify, que usa a mesma API que qualquer
integração (`02-arquitectura.md` §4.2).

## 2. «Regras»: as fiscais e legais ficam fora — decidido

> ✅ **Confirmado pelo Diogo a 03/10/2026:** *«sim, concordo»* (decisão K em
> `06-decisoes-em-aberto.md`).

Um terceiro pode escrever **regras de negócio** — descontos, portes, validação
do carrinho, escolha do armazém, ordem dos métodos de pagamento e de entrega.

Um terceiro **não** pode escrever nem substituir **regras fiscais e legais**: a
decisão do IVA, o NIF e o VIES, o botão de livre resolução, o preço mais baixo
dos 30 dias, as páginas legais, a retenção de faturas, o que um documento
fiscal leva.

**Porquê:** a promessa do Eurolify é «as regras da UE de raiz» (regras da UE no
`CLAUDE.md`). Uma extensão que mexesse no IVA punha faturas erradas em nome do
comerciante, e a decisão deixava de viver num sítio só — foi assim que, nos
sistemas actuais, a regra do IVA escrita duas vezes divergiu e uma encomenda
saiu com IVA com o ecrã a mostrar «s/ IVA» (13/08/2026, `docs/04` regra 2.1,
**M**). Uma regra fiscal nova, ou um país novo, entra no núcleo, com fonte e
validação de um contabilista desse país.

## 3. Os sete tipos de extensão

| Tipo | O que faz | Onde corre | Exemplo | Não pode |
|---|---|---|---|---|
| **Aplicação** | Liga o Eurolify a outro sistema: lê e escreve pela API de Administração, recebe avisos | No servidor do programador | Ligação a um ERP, a uma ferramenta de marketing | Ver outro comerciante; usar mais do que os âmbitos autorizados |
| **Meio de pagamento** | Implementa o contrato de pagamento: criar, autorizar, capturar, anular, reembolsar, avisar, conciliar | No servidor do prestador; o Eurolify chama-o | Um prestador grego com um método local | Receber o dinheiro por conta do Eurolify; tocar em dados de cartão no Eurolify |
| **Envio** | Implementa o contrato de transportadora: cotar portes, criar etiqueta, seguir, pontos de recolha, devoluções, mercadorias perigosas | No servidor da transportadora ou do agregador | Uma rede de cacifos nos Bálticos | Vender um serviço diferente do que vai na etiqueta (lição 3.7 de `docs/04`) |
| **Faturação** | Traduz uma decisão fiscal **já tomada** para o software certificado de um país e devolve o documento emitido | No servidor do software certificado | Um software Verifactu em Espanha | Decidir IVA, isenções ou NIF |
| **Função (regra de negócio)** | Código pequeno que o Eurolify corre num ponto de extensão listado | Dentro do Eurolify, numa caixa fechada: sem rede, com tempo e memória limitados, mesmo resultado para a mesma entrada (WebAssembly — **C**) | «Portes grátis acima de 50 € em Portugal continental» | Correr fora dos pontos listados; tocar em regras fiscais e legais (§2) |
| **Extensão de ecrã** | Acrescenta blocos ao Hub (com o sistema de design do Eurolify) e às zonas permitidas do checkout alojado (campos extra, mensagens) | No Hub e no checkout, isolada | Um campo «mensagem para oferta» | Esconder, mudar ou tirar um momento legal do checkout |
| **Campos e objectos próprios** | Dados com tipo, ligados a artigos, clientes, encomendas | Na base do Eurolify, por comerciante | «Tamanho da unha» num artigo | Guardar dados fiscais fora do perfil de faturação |

**Pontos de extensão das funções (lista fechada; um ponto novo é decisão):**
desconto do carrinho, regra de portes, validação do carrinho antes do
checkout, escolha do armazém para uma encomenda, ordem e visibilidade dos
métodos de pagamento e de entrega.

## 4. Os contratos — os mesmos para nós e para terceiros

- **Pagamento:** a máquina de estados da skill `payments-psd2-sca` (criado →
  a aguardar cliente → autorizado → capturado → reembolsado; falhado,
  expirado, anulado; em disputa). Avisos assinados; um aviso que falha devolve
  erro e é reenviado.
- **Envio:** cotação, etiqueta, seguimento, pontos de recolha, devolução, com o
  serviço escolhido no checkout a ir tal e qual para a etiqueta.
- **Faturação:** pedido de emissão com a decisão fiscal e a prova; resposta com
  o documento emitido, que o Eurolify lê de volta e guarda como prova; retenção
  com motivo.
- **Em todos:** chave de idempotência, versão por data (suportada pelo menos 12
  meses), erros num formato único, «não encontrei» é erro, registo de cada
  chamada no painel de entregas do comerciante.

## 5. Fácil para quem desenvolve

| Peça | Para quê |
|---|---|
| **Linha de comandos e modelos em TypeScript** | Criar uma extensão de cada tipo com um comando, já ligada ao contrato |
| **Loja de ensaio gratuita** por programador | Testar com dados de ensaio, **sem dados pessoais reais** |
| **Simulador de avisos** | Provocar «pagamento capturado», «encomenda cancelada»… sem esperar por eles |
| **Testes de conformidade do contrato** | Os mesmos que os adaptadores do Eurolify passam; uma extensão que falha não entra na loja |
| **Documentação para pessoas e para IA** | OpenAPI e `llms.txt` publicados, para que o Lovable, o Claude ou outro gerem uma extensão certa |
| **Exemplos completos** | Os adaptadores do próprio Eurolify como referência |
| **Versões por data** | O programador sabe com 12 meses de antecedência o que muda |

## 6. Segurança e dados — fechado por omissão

- **Âmbitos mínimos.** O comerciante vê, antes de instalar, o que a extensão
  lê e escreve **e em que país trata os dados**.
- **Acordo de tratamento de dados** (RGPD) entre o comerciante e o programador,
  com o Eurolify a exigi-lo na loja (skill `eu-gdpr-privacy`).
- **Regra 4 do `CLAUDE.md` (dados na UE):** a loja oficial só aceita
  extensões que tratem dados pessoais na UE, ou que declarem a transferência e
  a sua base legal.
- Segredos de cada extensão no cofre, por comerciante; nunca no código.
- **Cada acção de uma extensão fica no registo de auditoria** («quem» =
  aplicação), com limites de pedidos.
- **Botão para desligar uma extensão a todos os comerciantes** de uma vez, se
  se descobrir um problema.
- Revisão antes de entrar na loja; uma extensão nunca vê outro comerciante
  (isolamento imposto pela base, como no resto do Eurolify).

## 7. As regras da UE para uma loja de extensões

| Regra | O que obriga | Verif. |
|---|---|---|
| **DSA** — Reg. (UE) 2022/2065 | Uma loja de extensões aloja conteúdo de terceiros: mecanismo de denúncia, decisão fundamentada, recurso. As lojas de aplicações estão entre as plataformas online abrangidas (a App Store e o Google Play foram designadas plataformas muito grandes) | **W** ([Clifford Chance](https://www.cliffordchance.com/content/dam/cliffordchance/briefings/2022/12/the-digital-services-act-what-is-it-and-what-impact-will-it-have-updated-december-2022.pdf), [PwC](https://www.pwc.nl/en/insights-and-publications/themes/digitalization/the-dsa-is-now-a-reality-for-vlops.html)); que obrigações se aplicam ao Eurolify pela sua dimensão — skill `marketplace-dsa`, **C** |
| **Lei da Ciber-resiliência** — Reg. (UE) 2024/2847 | Software com elementos digitais colocado no mercado da UE. O serviço alojado (SaaS) fica em geral fora, salvo processamento remoto essencial a um produto; **a linha de comandos e as bibliotecas que o Eurolify distribuir podem ficar dentro — a confirmar**. Obrigações de notificação desde 11/09/2026; aplicação plena a 11/12/2027 | **W** ([EUR-Lex](https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=OJ:L_202402847), [Kirkland](https://www.kirkland.com/publications/kirkland-alert/2026/09/the-eu-cyber-resilience-act), resumos); o enquadramento das extensões **não verificado** |
| **Pagamentos (PSD2)** | Um meio de pagamento só entra na loja se o prestador estiver autorizado: registo da EBA para instituições de pagamento e de moeda electrónica, ou o regulador nacional se for banco | **W** ([EBA](https://www.eba.europa.eu/publications-and-media/press-releases/eba-goes-live-its-central-register-payment-and-electronic)) |
| **Faturação** | Uma extensão de faturação só entra com o certificado do software no país (em Portugal, software certificado pela AT) | `03-regulamentar-ue.md` §1 |
| **Produto e consumidor** | Uma extensão de ecrã não pode tirar o que a lei obriga a mostrar (preço total, livre resolução, garantia, dados de segurança do produto) | skills `consumer-rights-eu` e `product-compliance-eu` |

## 8. Fases

| Fase | Extensões |
|---|---|
| **0 (agora)** | Desenhar os contratos e os pontos de extensão, na lista de recursos e operações da API (`05-fases-e-mvp.md`) |
| **1** | Os adaptadores do próprio Eurolify (pagamentos, envios, faturação) escritos com os contratos, como se fossem de terceiros |
| **2 — decidido** (Diogo, 03/10/2026, decisão L) | **Primeiros parceiros convidados** a escrever eles próprios o seu adaptador: os prestadores e transportadoras da lista de parcerias (`07-pagamentos-e-envios-por-pais.md`) |
| **3** | Programa aberto a qualquer programador e loja de extensões (já estava na Fase 3) |

## O que ficou por verificar

- Se a Lei da Ciber-resiliência apanha a linha de comandos, as bibliotecas e
  as próprias extensões — só li resumos.
- Que obrigações do DSA se aplicam a uma loja de extensões pequena.
- A caixa fechada das funções (WebAssembly) é conhecimento prévio; a escolha
  técnica faz-se quando houver OK para código.
- Como o Eurolify ganha dinheiro com a loja (comissão, assinatura) é a D-14, não
  estudada.
