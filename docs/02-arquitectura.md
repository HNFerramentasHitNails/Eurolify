# Arquitectura proposta do Eurolify

> **Versão de 03/10/2026 — proposta.** As escolhas marcadas com **D-n**
> dependem de uma decisão de [`06-decisoes-em-aberto.md`](06-decisoes-em-aberto.md).
> Este documento descreve peças, fronteiras e contratos. **Estado a
> 05/10/2026:** há código desde o ADR-0023 — o motor de regras por país, o
> Comerciante (fatia 2) e o Catálogo em curso (#77), em `apps/api/`; o que está
> feito por domínio vê-se em [`eurolify/implementation-plan.md`](eurolify/implementation-plan.md).

## 1. A forma em uma imagem

```
   Frontends de qualquer origem               IAs de qualquer origem
   (Lovable, Vercel, Bolt, Emergent,          (Claude, ChatGPT/Codex, Gemini,
    app móvel, POS, um ERP)                    DeepSeek, agentes de compra)
            │  API da Loja (pública)                 │  MCP · OpenAPI · UCP/ACP
            │  API de Administração (privada)        │
            ▼                                        ▼
 ┌──────────────────────────────────────────────────────────────────┐
 │                      EUROLIFY — o servidor                        │
 │  Checkout alojado · Botão de livre resolução · Páginas legais     │
 │ ─────────────────────────────────────────────────────────────── │
 │  Catálogo │ Preços e mercados │ Carrinho │ Encomendas │ Stock     │
 │  Clientes e perfis fiscais │ Motor de IVA │ Documentos fiscais    │
 │  Pagamentos │ Envios │ Devoluções │ Notificações │ Privacidade    │
 │  Conformidade de produto │ Auditoria │ Extensões                  │
 │ ─────────────────────────────────────────────────────────────── │
 │  Eventos de domínio (outbox) → webhooks assinados                 │
 └──────────────────────────────────────────────────────────────────┘
      │ adaptadores (nunca código do fornecedor no núcleo)
      ▼
 Pagamentos: EuPago · Stripe · (Adyen, Mollie…)     Faturação: Moloni · (InvoiceXpress,
 Envios: CTT · DPD · agregadores                     Verifactu ES, Plateforme Agréée FR…)
 Identidade fiscal: VIES                             Comunicação: e-mail, SMS, WhatsApp
```

E por cima de tudo, o **Hub do Eurolify**: o back-office onde o comerciante
trabalha, que usa **a mesma API de Administração** que qualquer outro cliente.

## 2. Princípios (cada um tem um caso pago — ver `04-licoes-dos-sistemas-actuais.md`)

1. **A API é o servidor, e o servidor decide.** Preço, IVA, disponibilidade,
   quem pode o quê e o que é um documento emitido decidem-se no núcleo. Um
   frontend gerado por IA mostra a decisão, nunca a refaz (lição 4.9).
2. **Os momentos legais são servidos pelo Eurolify**, não por cada frontend:
   checkout (preço total, impostos, portes, condições, aceitação), confirmação
   da encomenda, botão de livre resolução, páginas legais e documento fiscal. O
   comerciante muda o aspecto; não pode tirar o que a lei obriga. **D-7.**
3. **Monólito modular primeiro.** Um só serviço com módulos de fronteiras
   claras e uma base de dados; partir em serviços só quando um módulo o pedir
   com números (carga, equipa, ritmo de publicação).
4. **Multi-inquilino desde o primeiro dia.** Cada linha tem o seu comerciante;
   o isolamento é imposto pela base (políticas por inquilino), não só pelo
   código. Vende-se a outros comerciantes desde a primeira versão (D-1, ADR-0006).
5. **Adaptadores para tudo o que é de fora.** Pagamentos, faturação, envios,
   VIES, e-mail. O núcleo fala uma língua só; trocar de fornecedor não mexe no
   núcleo.
6. **Nada falha em silêncio.** Toda a escrita devolve um estado explícito;
   «não encontrei» é erro; um aviso de fora que falha devolve erro para ser
   reenviado (lições 4.1 e 4.2).
7. **Guardar o que chega em bruto** (avisos dos fornecedores, pedidos à API de
   faturação e as respostas) e **a prova do que saiu** (o documento, como o
   emissor o devolveu) — lições 2.6 e 4.3.
8. **Idempotência em todas as escritas** (lição 4.4).
9. **Fechado por omissão** — permissões, funções, ficheiros (lição 4.13).
10. **Sair é fácil.** Exportação completa de dados em formato aberto, sem custo
    — é lei a partir de 12/01/2027 (Data Act) e é argumento de venda contra o
    Shopify.

## 3. Domínios e fronteiras

| Domínio | É dono de | Não é dono de | Eventos que publica |
|---|---|---|---|
| **Comerciante** (`15-dominio-comerciante.md`) | comerciante (o inquilino), entidades legais, lojas, estados, aceitação de contratos, provas de verificação | registos fiscais (Motor de IVA), pessoas e papéis (identidade) | `merchant.created`, `merchant.status_changed`, `legal_entity.created`, `store.created` |
| **Catálogo (PIM)** | artigos, variantes, opções, atributos, kits/coleções, media, categorias, traduções, atributos regulamentares | preço, stock, canal e mercado (de Preços e mercados), fórmula com versão (da Conformidade) | `product.created`, `product.updated`, `product.published`, `product.unpublished`, `product.archived` |
| **Preços e mercados** | listas de preços, mercados (país + moeda + língua + canal) e canais (`docs/14` §9, P1), histórico de preços (30 dias da Omnibus), promoções, quantidades mínimas, preços B2B por etiqueta | imposto | `price.changed`, `promotion.started`, `promotion.ended`, `market.activated`, `market.archived` (`docs/20` §6; Q6, Diogo, 06/10/2026) |
| **Carrinho** | carrinho, linhas, códigos de desconto aplicados, cotação de portes | decisão de IVA (pede-a) | `cart.updated` |
| **Checkout** | sessão de checkout, aceitação de condições, escolha de perfil de faturação, escolha do método | o pagamento em si | `checkout.completed` |
| **Encomendas** | encomenda, linhas, estado, quem compra, quem é faturado e quem recebe/usa (o bilhete para outra pessoa: `docs/14` §3.10; a `order-fulfilment` também separa estes papéis), cancelamentos | o documento fiscal | `order.created`, `order.cancelled` |
| **Stock** | armazéns, saldos, reservas, movimentos, lotes, compostos derivados | preço | `inventory.reserved`, `inventory.released`, `inventory.adjusted` |
| **Clientes e identidade fiscal** | ficha, perfis de faturação, validações VIES com prova, duplicados, fusões (humanas), consentimentos | encomendas | `customer.created`, `customer.updated`, `billing_profile.created`, `billing_profile.updated`, `billing_profile.validated`, `billing_profile.invalidated`, `billing_profile.exemption_set`, `billing_profile.exemption_removed`, `customer.merged`, `customer.pseudonymized`, `consent.changed` |
| **Motor de IVA** | categorias fiscais de artigo, registos fiscais de cada entidade legal (país-sede, OSS, IOSS, outros), jurisdições, taxas com vigência, territórios especiais, regras de isenção, **evidência da decisão** | o documento | `tax.decided` (interno), `tax.regime_changed` |
| **Documentos fiscais** | pedido de emissão ao software certificado, fila de **retidas**, prova do documento emitido, notas de crédito, relatórios (OSS) | o cálculo do IVA | `invoice.requested`, `invoice.retained`, `invoice.issued`, `credit_note.issued` |
| **Pagamentos** | intenção de pagamento, autorização, captura, anulação, reembolso, disputa, conciliação | dinheiro (nunca o guarda) | `payment.authorized`, `payment.captured`, `payment.failed`, `refund.completed` |
| **Envios** | expedições, divisão em várias caixas, etiquetas, seguimento, restrições de transporte | stock | `shipment.created`, `shipment.dispatched`, `shipment.delivered` |
| **Devoluções** | pedido de livre resolução, RMA, recepção, estado do artigo, decisão (reembolso, troca, carteira) | o reembolso em si | `withdrawal.requested`, `return.received`, `return.inspected` |
| **Notificações** | modelos por língua e país, envio transaccional, preferências | consentimento de marketing (lê-o) | `notification.sent`, `notification.failed` |
| **Privacidade** | registo de tratamentos, pedidos dos titulares, retenção, pseudonimização | dados fiscais (retenção de 10 anos) | `dsar.received`, `dsar.completed` |
| **Conformidade de produto** | operador económico, pessoa responsável, documentos e prazos, alertas e recolhas, fórmulas com versão (INCI; `docs/14` §9, P2) | o catálogo (anexa-se a ele) | `recall.opened` |
| **Auditoria** | registo imutável de acções administrativas e fiscais | — | — |
| **Extensões** | aplicações instaladas, permissões, webhooks, campos personalizados, contratos de adaptadores, funções em caixa fechada, extensões de ecrã — desenho em `08-extensoes-de-terceiros.md` | regras fiscais e legais (não são extensíveis) | — |

**Regra de fronteira:** um domínio só lê outro pela sua API interna ou pelos
seus eventos — nunca pelas tabelas dele. É isto que permite, um dia, separar um
módulo sem reescrever os outros.

## 4. As interfaces

### 4.1 API da Loja (pública)

- Para frontends de qualquer origem. **Chave pública por loja**, só leitura do
  catálogo e escrita no carrinho/checkout do próprio visitante.
- Catálogo por mercado, preços já com o IVA certo **para mostrar** (o cálculo
  que vale é o do checkout), disponibilidade, carrinho, início do checkout
  alojado, área de cliente (encomendas, faturas, **livre resolução**,
  privacidade).

### 4.2 API de Administração (privada)

- Para o Hub do Eurolify, integrações e aplicações. **OAuth 2.1 / OIDC** com
  âmbitos (`orders:read`, `invoices:write`…), chaves de servidor para
  integrações, papéis e permissões por utilizador.
- O Hub do Eurolify usa **exactamente esta API** — se o Hub consegue, uma
  integração consegue.

### 4.3 Regras comuns às duas

| Tema | Proposta |
|---|---|
| Estilo | **REST com contrato OpenAPI 3.1** (D-8). GraphQL só se houver necessidade medida |
| Versões | versão na data (ex.: `2027-01`), suportada pelo menos 12 meses, mudanças anunciadas |
| Erros | formato único (RFC 9457 *problem details*) com código estável e mensagem em português/inglês |
| Paginação | por cursor, sempre; nunca um corte silencioso (lição 4.7) |
| Idempotência | cabeçalho `Idempotency-Key` obrigatório em todas as escritas |
| Limites | por chave e por loja, com cabeçalhos a dizer quanto falta |
| Webhooks | assinados (HMAC), com identificador do evento, reenvio com recuo exponencial, registo de entregas visível ao comerciante |
| SDK | gerado do contrato: TypeScript primeiro |
| Documentação para IA | `llms.txt` e o contrato OpenAPI publicados — um construtor como o Lovable ou o Bolt lê-os e gera o cliente certo |

### 4.4 Checkout alojado (D-7)

- Página do Eurolify, com o aspecto da loja, no domínio da loja
  (`checkout.loja.pt`).
- Faz o que nenhum frontend gerado por IA deve refazer: total com impostos e
  portes, condições e aceitação, escolha ou criação do perfil de faturação
  («a fatura é para outra pessoa/empresa»), validação VIES, métodos de
  pagamento do país, autenticação forte, confirmação da encomenda com prova
  contratual.
- Para quem precisa de checkout próprio: API de checkout, mas só depois de uma
  verificação de conformidade (Fase 3).

### 4.5 IA (D-9)

| Peça | Para quê | Fase |
|---|---|---|
| **Servidor MCP de Administração** | O comerciante liga o seu assistente (Claude, ChatGPT, Gemini, Cursor…) ao Eurolify: «quanto vendi ontem em Espanha?», «que artigos estão sem foto?» | 1 (só leitura) |
| Escrita por MCP | criar artigos, preparar encomendas — **sempre com confirmação humana**; nunca emitir faturas, reembolsar ou fundir clientes sem uma pessoa | 3 |
| **OpenAPI para chamada de funções** | qualquer modelo que saiba chamar funções (incluindo os que não falam MCP) usa o mesmo contrato | 1 |
| **Comércio por agentes (UCP/ACP)** | um agente de compras de terceiros encontra o catálogo e compra pelo checkout do Eurolify | 3 |
| Pacote para construtores de frontends | instruções e exemplos para o Lovable/Vercel/Bolt/Emergent gerarem uma loja que fala com o Eurolify (a especificação da loja online actual, escrita para o Lovable, é deste género) | 1 |

Regras: as ferramentas devolvem **páginas pequenas e procuras**, não dumps
(lição 6.1); cada chamada fica no registo de auditoria com quem a fez e por que
modelo; orçamento de IA por comerciante (lição 6.3).

## 5. Multi-inquilino, alojamento e dados (D-1, D-3)

- **Um inquilino = um comerciante**, com uma ou várias lojas (marcas) e vários
  mercados. Um grupo com várias marcas é um inquilino com várias lojas.
- Isolamento na base por inquilino em todas as tabelas, com testes que provam
  que um comerciante não vê o outro.
- **Alojamento numa VPS operada pelo Diogo e pelo Bruno**, num centro de
  dados na UE, com o Claude a operá-la (decidido a 03/10/2026, ADR-0015 e
  ADR-0016; substitui a Scaleway gerida dos ADR-0003 e ADR-0004): PostgreSQL,
  contentores para a API e os processos sempre ligados, cópias fora da máquina
  — o que se instala está em `11-preparacao-da-vps.md`. As lojas dos
  comerciantes ficam onde cada um quiser e falam pela API.
- **Separar dados pessoais dos registos técnicos**: os logs não levam nomes,
  e-mails nem NIF em claro.
- Cópias de segurança cifradas, com ensaio de reposição agendado — e
  **nunca abertas ao público** (lição: as cópias do Hub nasciam expostas, 12/08/2026).

## 6. Como se trabalha no código (quando houver código)

- Ambientes: desenvolvimento, ensaio e produção, com dados de ensaio
  **sem dados pessoais reais**. O ensaio é **um só**, na VPS, actualizado
  a cada entrada no `main` (ADR-0014, ADR-0015).
- Cada alteração passa por: tipos, testes, testes de permissões, migração
  testada contra uma cópia — e só então é publicada, pelo mesmo caminho sempre.
- O que é fiscal tem testes por cada ramo da regra e por cada caso pago do
  sistemas actuais (a isenção manual com entrega em Portugal, o bilhete comprado
  para outra pessoa, o `000000000`, as Canárias…).
- Decisões de arquitectura registadas como ADR em `docs/adr/`.

## 7. O que este documento não decide

A linguagem e a base de dados concretas, o fornecedor de alojamento, construir
de raiz ou partir de um motor aberto, e a ordem das fases — são as decisões
D-1 a D-14.
