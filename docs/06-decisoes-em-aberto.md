# Decisões — as que estão tomadas e as que faltam

> **Versão de 03/10/2026** (revista no mesmo dia: o Lumavo é da Luckytarget,
> sem marcas existentes). Cada decisão tem opções, uma recomendação com o
> porquê, quem decide e o que fica parado enquanto não se decide. Quando uma
> decisão é tomada, regista-se num ADR em `docs/adr/` e muda-se aqui o estado —
> **não se apaga a linha**.
>
> **Quem decide (proposta, a confirmar):** o negócio decidem **Bruno e
> Cila**; tudo o que é faturação, NIF, IVA e identidade de clientes passa pelo
> **Bruno**, como em todo o ecossistema; avançar para código decide **o Bruno ou
> o Diogo** (ADR-0001).

## Já decidido

| # | Decisão | Quem, quando | Registo |
|---|---|---|---|
| ✅ A | **Nenhum código até haver um plano decidido.** Avança-se para código quando o Bruno ou o Diogo o decidirem | Diogo, 03/10/2026 | [ADR-0001](adr/0001-sem-codigo-ate-plano-decidido.md) |
| ✅ B | **Skills, memórias e informação do Lumavo vivem neste repositório**, para o Bruno e o Diogo trabalharem em conjunto | Diogo, 03/10/2026 | `CLAUDE.md`, `memoria/` |
| ✅ C | **Requisitos de partida** (não são desenho): funcionar por API para qualquer frontend (Lovable, Vercel, Emergent, Bolt…); ter um Hub completo e adaptável; regras europeias de raiz; funcionar com qualquer IA | Diogo, 03/10/2026 | `00-proposta.md` |
| ✅ D | **O Lumavo é desenvolvido dentro da Luckytarget Lda, com marca própria.** Nenhuma marca existente da empresa é usada no Lumavo; os sistemas actuais servem só como fonte de regras e de casos medidos | Diogo, 03/10/2026 | `CLAUDE.md`, `memoria/` |

## Por decidir — por esta ordem

### D-1 · O que é o Lumavo primeiro?

| Opção | O que quer dizer |
|---|---|
| a) Produto para vender a outros comerciantes desde o início | Onboarding, faturação do próprio Lumavo, suporte e contratos já na 1.ª versão |
| **b) Plataforma multi-inquilino, com um cliente zero real, aberta a outros só na Fase 3** ⭐ | Constrói-se como produto (isolamento, nada de um cliente escrito no código), mas prova-se com uma loja real antes de vender. O cliente zero pode ser uma operação do próprio grupo ou um comerciante parceiro — **parte desta decisão** |
| c) Plataforma só para uso interno da Luckytarget | Mais rápido no início; vender depois obriga a reconstruir — foi o que a proposta de venda do Hub mostrou (30/09/2026) |

**Recomendação: b).** A tentativa de vender o Hub interno mediu que nunca foi
instalado de raiz e que tem a marca e as regras de uma só empresa escritas em
92 ficheiros do ecrã: construir
para um e vender a muitos sai caro. E vender antes de provar com uma loja real
põe faturas de outras empresas em risco.
**Bloqueia:** quase tudo — é a primeira.

### D-2 · Construir de raiz ou partir de um motor aberto?

| Opção | Licença | A favor | Contra |
|---|---|---|---|
| **a) Núcleo próprio** (TypeScript + PostgreSQL) ⭐ | nossa | O que diferencia o Lumavo (perfis fiscais, motor de IVA, faturação por país, Hub) nenhum motor tem; a equipa trabalha em TypeScript; multi-inquilino desenhado de raiz | Mais trabalho no que é comum (carrinho, promoções, stock) |
| b) Medusa v2 | MIT | TypeScript, maduro no comum, sem custos de licença | **Sem multi-inquilino nativo**; os fornecedores (pagamentos, e-mail) são únicos por instância ⇒ uma instância por comerciante |
| c) Saleor | BSD-3 | Multi-canal de raiz, GraphQL | Python, que a equipa não usa |
| d) Vendure | GPLv3 + camada comercial | TypeScript | Núcleo GPL e funções avançadas pagas |

Fonte das licenças e do multi-inquilino: pesquisa web a 03/10/2026
([Medusa no GitHub](https://github.com/medusajs/medusa),
[discussão do multi-inquilino](https://github.com/medusajs/medusa/discussions/11671),
[licença Vendure](https://github.com/vendurehq/vendure/blob/master/LICENSE.md),
[comparação](https://contracollective.com/blog/saleor-vs-medusa-vs-vendure-open-source-headless-commerce-2026))
— **resumos de pesquisa, código não lido**.

**Recomendação: a)**, mas **só depois de uma prova de 2 semanas com a b)**: se
a Medusa aguentar o modelo de perfis fiscais e o isolamento por inquilino com
pouco esforço, poupa meses no comum. A prova faz parte da Fase 0 e não é código
de produção.
**Bloqueia:** estimativas de prazo e custo (D-13).

### D-3 · Onde fica alojado?

| Opção | A favor | Contra |
|---|---|---|
| **a) Fornecedor europeu** (Hetzner, Scaleway, OVHcloud) ⭐ | Argumento «europeu» verdadeiro; dados fora do alcance de leis de outros países | Mais trabalho de operação |
| b) Supabase na região UE | A equipa conhece; rápido | Empresa norte-americana; o caminho de publicação do Hub (editar ≠ publicar, dependência do agente do Lovable) é lição a não repetir |
| c) AWS/Google/Azure na região UE | Serviços geridos completos | Mesma questão de jurisdição; custo |

**Recomendação: a)**, com a base de dados gerida pelo próprio fornecedor
europeu. **Não verifiquei preços.**

### D-4 · Quem emite as faturas?

| Opção | O que quer dizer |
|---|---|
| **a) Adaptadores a software certificado de cada país** ⭐ | Em Portugal o Moloni (e outros); em Espanha um software Verifactu; em França uma Plateforme Agréée. O Lumavo decide o IVA e guarda a prova; o documento legal é do software certificado |
| b) Certificar o próprio Lumavo junto da AT (e equivalentes) | Controlo total; custo, prazo e responsabilidade legal por país |

**Recomendação: a)** nas Fases 1 a 3. Reavaliar a b) com números de clientes.
**Quem decide: Bruno.**

### D-5 · Pagamentos

**Recomendação:** o Lumavo **nunca recebe o dinheiro dos comerciantes**
(guardar fundos de terceiros exige licença de instituição de pagamento); cada
comerciante liga a sua conta do prestador. Primeiros prestadores: **EuPago**
(MB WAY, Multibanco, cartão, Floa) e **Stripe** (Klarna, cartão, Apple/Google
Pay) — a mesma escolha que o Bruno fez para a plataforma de formação a 29/09/2026
(`academy-piloto-eupago-desenho-29set2026.md`, repo `claude`), com a régua
«método → prestador → conta» numa tabela do servidor. Marketplace, se um dia
existir, só com o produto de plataformas do prestador (Stripe Connect, Adyen
for Platforms, Mollie Connect).

### D-6 · Países da primeira versão

**Recomendação: Portugal e Espanha.** É onde os sistemas actuais vendem mais
fora de Portugal (340 perfis espanhóis activos, medido a 28/09/2026 em
`canarias-ceuta-melilla-extra-ue-28set2026.md`) e já obriga a tratar OSS, VIES
e territórios especiais. Restantes países por procura — cada regime de
faturação electrónica é um projecto (ver `03-regulamentar-ue.md` §1).
⚠️ **Discordo de «todos os mercados europeus nativamente» desde o início**: são
27 regimes fiscais e vários de faturação obrigatória diferentes; prometê-lo é
prometer faturas erradas.

### D-7 · Checkout alojado pelo Lumavo ou feito por cada frontend?

**Recomendação: alojado** (com o aspecto da loja, no domínio da loja). Um
frontend gerado por IA não é sítio para decidir IVA, aceitar condições ou
mostrar o botão de livre resolução. API de checkout própria só na Fase 3 e com
verificação.

### D-8 · Estilo da API

**Recomendação: REST com contrato OpenAPI 3.1**, webhooks assinados e SDK
TypeScript. É o que os construtores de frontends com IA e os modelos com
chamada de funções leem melhor. GraphQL só com necessidade medida.

### D-9 · IA

**Recomendação:** MCP de **leitura** na Fase 1; escrita com confirmação humana
na Fase 3; protocolos de comércio por agentes (UCP, ACP) na Fase 3. **Nunca**
uma IA emite faturas, reembolsa, funde clientes ou corrige em lote.

### D-10 · Um cliente que já tem sistema de gestão: quem emite as faturas?

**Recomendação: continua a ser o sistema dele.** O Lumavo entrega-lhe as
encomendas como o Shopify faz hoje, e esse sistema continua a ser o único que
fala com o software de faturação — é a regra do Hub interno actual («um só
sistema fala com o Moloni»), e evita dois emissores para a mesma venda. Passar
a emissão para o Lumavo é uma decisão posterior, cliente a cliente, com o
Lumavo já provado. **Quem decide: Bruno.**

### D-11 · Ponte para a memória de trabalho existente

A memória do Lumavo vive aqui (decisão B). **Por decidir com o Bruno:** pôr no
repo `bruno-88/claude` **uma** memória curta a apontar para este repositório,
para que uma sessão sobre os sistemas actuais saiba que o Lumavo existe. Não o fiz: o
pedido foi guardar aqui.

### D-12 · O nome «Lumavo»

**Não verifiquei** se a marca está livre no EUIPO nem que domínios estão
disponíveis. Verificar antes de gastar dinheiro em marca.

### D-13 · Quem constrói, em quanto tempo e com que orçamento

**Sem número nesta versão.** Depende de D-1, D-2 e D-3. A primeira tarefa da
Fase 0, depois dessas três, é a estimativa. Referência do que um sistema destes
pesa: o Hub tinha, a 30/09/2026, 420 caminhos de ecrã, 225 funções no servidor, 761 tabelas
e 78 tarefas automáticas (`proposta-venda-do-hub-30set2026.md`).

### D-14 · Como o Lumavo ganha dinheiro

Mensalidade, percentagem das vendas, módulos pagos, instalação dedicada — **não
estudado**. Decide-se depois de D-1 e antes da Fase 3.
