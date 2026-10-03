# Decisões — as que estão tomadas e as que faltam

> **Versão de 03/10/2026** (revista no mesmo dia: o Eurolify é da Luckytarget,
> sem marcas existentes). Cada decisão tem opções, uma recomendação com o
> porquê, quem decide e o que fica parado enquanto não se decide. Quando uma
> decisão é tomada, regista-se num ADR em `docs/adr/` e muda-se aqui o estado —
> **não se apaga a linha**.
>
> **Quem decide:** **o Diogo ou o Bruno**, cada um sozinho, em tudo — negócio,
> faturação, NIF, IVA, identidade de clientes, aspecto, e o OK para código
> (ordem do Diogo, 03/10/2026; `AGENTS.md`, «Quem decide»). As propostas de
> negócio e de marca continuam a ser apresentadas a Bruno e Cila.

## Já decidido

| # | Decisão | Quem, quando | Registo |
|---|---|---|---|
| ✅ A | **Nenhum código até haver um plano decidido.** Avança-se para código quando o Bruno ou o Diogo o decidirem | Diogo, 03/10/2026 | [ADR-0001](adr/0001-sem-codigo-ate-plano-decidido.md) |
| ✅ B | **Skills, memórias e informação do Eurolify vivem neste repositório**, para o Bruno e o Diogo trabalharem em conjunto | Diogo, 03/10/2026 | `AGENTS.md`, `memoria/` |
| ✅ C | **Requisitos de partida** (não são desenho): funcionar por API para qualquer frontend (Lovable, Vercel, Emergent, Bolt…); ter um Hub completo e adaptável; regras europeias de raiz; funcionar com qualquer IA | Diogo, 03/10/2026 | `00-proposta.md` |
| ✅ D | **O Eurolify é desenvolvido dentro da Luckytarget Lda, com marca própria.** Nenhuma marca existente da empresa é usada no Eurolify; os sistemas actuais servem só como fonte de regras e de casos medidos | Diogo, 03/10/2026 | `AGENTS.md`, `memoria/` |
| ✅ E | **O Eurolify é construído de raiz** (D-2 → a); a prova com a Medusa deixa de se fazer. Não é o OK para código | Diogo, 03/10/2026 | [ADR-0002](adr/0002-nucleo-proprio-de-raiz.md) |
| ✅ F | **O Eurolify é um produto para vender, como o Shopify, a todos os tipos de comerciantes da UE, e nativo para toda a UE** (exclui a c) da D-1; fecha a D-6) | Diogo, 03/10/2026 | D-1 e D-6 abaixo |
| ✅ G | **Alojamento num fornecedor europeu, com serviços geridos** (D-3 → a); o fornecedor ficou a Scaleway (H). Não é o OK para código | Diogo, 03/10/2026 | [ADR-0003](adr/0003-alojamento-europeu-gerido.md) |
| ✅ H | **O fornecedor de alojamento é a Scaleway**, sem comparação com a OVHcloud. Não é o OK para código | Diogo, 03/10/2026 | [ADR-0004](adr/0004-fornecedor-scaleway.md) |
| ✅ I | **Publica-se pelo GitHub**: cada alteração entra no `main`, os testes correm e o mesmo caminho põe no ar. O Claude tem o MCP da Scaleway **só de leitura**; escrita só num projecto de ensaio, com chave limitada a ele. Na prática, o `scw` directo com uma chave só de leitura (R) | Diogo, 03/10/2026 | [ADR-0005](adr/0005-publicacao-pelo-github.md) |
| ✅ J | **O Diogo e o Bruno têm toda a liberdade neste repositório**, cada um sozinho — incluindo faturação, NIF, IVA e identidade de clientes. **Regras da UE**: seguir as skills, só regras da UE com fonte, nunca inventar, dados na UE | Diogo, 03/10/2026 | `AGENTS.md` |
| ✅ K | **Requisito: terceiros desenvolvem extensões de forma fácil** — aplicações, meios de pagamento, envios, faturação por país, regras de negócio, ecrãs. **As regras fiscais e legais não são extensíveis** (confirmado pelo Diogo: *«sim, concordo»*) | Diogo, 03/10/2026 | `08-extensoes-de-terceiros.md` |
| ✅ L | **Na Fase 2, os parceiros da lista de pagamentos e envios são convidados a escrever eles próprios a sua ligação ao Eurolify**, com os contratos que o Eurolify já usa | Diogo, 03/10/2026 | `05-fases-e-mvp.md`, `07` e `08` |
| ✅ M | **O Eurolify vende-se a outros comerciantes desde o início** (D-1 → a)); a recomendação era a b). Registo de comerciantes, contratos, faturação do Eurolify, suporte e a emissão por Moloni passam à Fase 1; o modelo de receita (D-14) passa a ser preciso antes dela | Diogo, 03/10/2026 | [ADR-0006](adr/0006-vender-desde-o-inicio.md) |
| ✅ N | **A receita assenta numa mensalidade por plano, por escalões de vendas anuais, sem taxa sobre cada venda** (D-14, em parte). Preços e outras fontes por decidir | Diogo, 03/10/2026 | [ADR-0007](adr/0007-receita-mensalidade-por-escaloes.md) |
| ✅ O | **A Fase 1 é desenvolvida pelo Diogo e pelo Bruno, com Claude Code e Codex**, sem contratar programadores (D-13 → cenário A); a recomendação era a B (2 sénior). Fase 1: 15 a 29 meses os dois a tempo inteiro, 28 a 52 a meio tempo (`10` §9, hipótese C), corrigido às 8 semanas. As regras e as skills ficaram num sítio só para os dois (Q, ADR-0010). Não é o OK para código | Diogo, 03/10/2026 | [ADR-0008](adr/0008-construcao-pelo-diogo-e-pelo-bruno.md) |
| ✅ P | **O produto chama-se Eurolify** (antes Lumavo; D-12, na parte do nome). `.com` e `.eu` livres a 03/10/2026; a pesquisa de marcas no TMview e a compra dos domínios estão por fazer. A identidade visual continua por decidir | Diogo, 03/10/2026 | [ADR-0009](adr/0009-nome-eurolify.md) |
| ✅ Q | **As regras e as skills vivem num sítio só, lido pelo Claude Code e pelo Codex**: as regras no `AGENTS.md` (o `CLAUDE.md` só o importa); as 14 skills em `.agents/skills`, com uma ligação por skill em `.claude/skills`. Regras novas só no `AGENTS.md`, abaixo de 32 KiB | Diogo, 03/10/2026 | [ADR-0010](adr/0010-regras-num-sitio-so-agents-md.md) |
| ✅ R | **A conta da Scaleway está preparada e o Claude lê-a só de leitura**: projecto `eurolify-ensaio`, aplicação e política `claude-leitura` (9 conjuntos de permissões só de leitura), uma chave por pessoa com data de fim (a do Diogo a 03/10/2027) e o `scw` 2.63.0 nas sessões; no Claude Code, o `scw` directo em vez do MCP. Escrita, produção, recursos e publicação continuam fechados. Não é o OK para código | Diogo, 03/10/2026 | [ADR-0011](adr/0011-preparacao-da-conta-scaleway.md) |

## Por decidir — por esta ordem

### D-1 · O que é o Eurolify primeiro?

> ✅ **Decidido a 03/10/2026 pelo Diogo: a) vender a outros comerciantes desde
> o início** ([ADR-0006](adr/0006-vender-desde-o-inicio.md)). A recomendação
> era a b); o texto abaixo fica como registo das opções.

> **03/10/2026, Diogo:** *«O Lumavo é um produto vendável como o shopify, para
> todos os tipos de comerciantes dentro a UE nativamente.»* ⇒ a c) cai. Entre a
> a) e a b) a frase não diz **quando** abre a outros comerciantes (logo, ou
> depois de provado com um cliente zero) — é isso que fica por decidir aqui.

| Opção | O que quer dizer |
|---|---|
| a) Produto para vender a outros comerciantes desde o início | Onboarding, faturação do próprio Eurolify, suporte e contratos já na 1.ª versão |
| **b) Plataforma multi-inquilino, com um cliente zero real, aberta a outros só na Fase 3** ⭐ | Constrói-se como produto (isolamento, nada de um cliente escrito no código), mas prova-se com uma loja real antes de vender. O cliente zero pode ser uma operação do próprio grupo ou um comerciante parceiro — **parte desta decisão** |
| c) Plataforma só para uso interno da Luckytarget | Mais rápido no início; vender depois obriga a reconstruir — foi o que a proposta de venda do Hub mostrou (30/09/2026) |

**Recomendação: b).** A tentativa de vender o Hub interno mediu que nunca foi
instalado de raiz e que tem a marca e as regras de uma só empresa escritas em
92 ficheiros do ecrã: construir
para um e vender a muitos sai caro. E vender antes de provar com uma loja real
põe faturas de outras empresas em risco.
**Bloqueia:** quase tudo — é a primeira.

### D-2 · Construir de raiz ou partir de um motor aberto?

> ✅ **Decidido a 03/10/2026 pelo Diogo: a) núcleo próprio, de raiz**
> ([ADR-0002](adr/0002-nucleo-proprio-de-raiz.md)). A prova com a Medusa
> deixa de se fazer. O texto abaixo fica como registo das opções.

| Opção | Licença | A favor | Contra |
|---|---|---|---|
| **a) Núcleo próprio** (TypeScript + PostgreSQL) ⭐ | nossa | O que diferencia o Eurolify (perfis fiscais, motor de IVA, faturação por país, Hub) nenhum motor tem; a equipa trabalha em TypeScript; multi-inquilino desenhado de raiz | Mais trabalho no que é comum (carrinho, promoções, stock) |
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

> ✅ **Decidido a 03/10/2026 pelo Diogo: a) fornecedor europeu, serviços
> geridos** ([ADR-0003](adr/0003-alojamento-europeu-gerido.md)) — *«sim, fica
> o europeu gerido»*. Fornecedor: **Scaleway** (decisão H,
> [ADR-0004](adr/0004-fornecedor-scaleway.md), Diogo, 03/10/2026: *«fica a scaleway»*). O texto abaixo fica como registo das opções.

Revista a 03/10/2026, a pedido do Diogo (*«servidor dedicado, ou Vercel e
Supabase?»*), com os preços lidos nas páginas oficiais nesse dia — números e
fontes em `memoria/alojamento-e-custos-03out2026.md`.

| Opção | A favor | Contra |
|---|---|---|
| **a) Serviços geridos de um fornecedor europeu** — base de dados gerida com segunda máquina, contentores, armazenamento (ex.: Scaleway, Paris; OVHcloud por verificar) ⭐ | O argumento «europeu» é verdadeiro; a base, as cópias e a segunda máquina são do fornecedor; custa da mesma ordem das outras | A autenticação e o caminho de publicação constroem-se (a Supabase dá-os feitos) |
| b) Servidores dedicados (ex.: Hetzner) | Europeu; máquina potente | A base, as cópias, a segunda máquina, as actualizações e os alarmes são nossos, e ninguém na equipa faz operação; a máquina já não é muito mais barata (o AX42 custa 97,30 €/mês desde 15/06/2026) |
| c) Vercel + Supabase, na região UE | A equipa conhece; o mais rápido a arrancar | Empresas norte-americanas: a região UE muda onde estão os dados, não quem pode ser obrigado a entregá-los (CLOUD Act); a Supabase põe a base de dados à frente do browser, o modelo que deixou 77 funções abertas a quem não tem sessão no Hub interno (18/09/2026); as funções da Vercel param aos 800 s e o Eurolify precisa de processos sempre ligados (avisos, reenvios, VIES diário) |
| d) AWS, Google ou Azure na região UE | Serviços geridos completos | A mesma questão de jurisdição; custo |

⚠️ **Correcção (03/10/2026):** a versão anterior desta tabela dava contra a
Supabase «o caminho de publicação do Hub (editar ≠ publicar, agente do
Lovable)». Isso é do Lovable, não da Supabase — saiu.

**Recomendação: a).** Não um servidor dedicado já: a máquina custa quase o
mesmo e a operação fica toda connosco, com documentos fiscais de outras
empresas. Não Vercel + Supabase como casa do núcleo: contraria o argumento
europeu e o desenho «a API é o servidor». **As lojas dos comerciantes podem
viver na Vercel, no Lovable ou onde quiserem** — é para isso que a API existe,
e esse alojamento é deles.

### D-4 · Quem emite as faturas?

| Opção | O que quer dizer |
|---|---|
| **a) Adaptadores a software certificado de cada país** ⭐ | Em Portugal o Moloni (e outros); em Espanha um software Verifactu; em França uma Plateforme Agréée. O Eurolify decide o IVA e guarda a prova; o documento legal é do software certificado |
| b) Certificar o próprio Eurolify junto da AT (e equivalentes) | Controlo total; custo, prazo e responsabilidade legal por país |

**Recomendação: a)** nas Fases 1 a 3. Reavaliar a b) com números de clientes.
**Quem decide:** Diogo ou Bruno.

### D-5 · Pagamentos

**Recomendação:** o Eurolify **nunca recebe o dinheiro dos comerciantes**
(guardar fundos de terceiros exige licença de instituição de pagamento); cada
comerciante liga a sua conta do prestador. Primeiros prestadores: **EuPago**
(MB WAY, Multibanco, cartão, Floa) e **Stripe** (Klarna, cartão, Apple/Google
Pay) — a mesma escolha que o Bruno fez para a plataforma de formação a 29/09/2026
(`academy-piloto-eupago-desenho-29set2026.md`, repo `claude`), com a régua
«método → prestador → conta» numa tabela do servidor. Marketplace, se um dia
existir, só com o produto de plataformas do prestador (Stripe Connect, Adyen
for Platforms, Mollie Connect).

### D-6 · Países

> ✅ **Decidido a 03/10/2026 pelo Diogo (decisão F): nativo para toda a UE.**
> Era a segunda vez que o pedia; a recomendação «Portugal e Espanha primeiro»
> e a discordância que aqui estavam saem.

O que isto obriga a ter **de raiz**: o motor de IVA com as taxas dos 27 países
e o OSS; NIF e VIES de todos; os territórios especiais; línguas, moedas,
moradas e métodos de pagamento por país. O que tem **calendário próprio por
país** é a ligação ao software de faturação certificado de um comerciante
estabelecido nesse país (ex.: um comerciante francês emite por uma Plateforme
Agréée — `03-regulamentar-ue.md` §1), com a regra validada pelo contabilista
desse país (D-4).

### D-7 · Checkout alojado pelo Eurolify ou feito por cada frontend?

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

**Recomendação: continua a ser o sistema dele.** O Eurolify entrega-lhe as
encomendas como o Shopify faz hoje, e esse sistema continua a ser o único que
fala com o software de faturação — é a regra do Hub interno actual («um só
sistema fala com o Moloni»), e evita dois emissores para a mesma venda. Passar
a emissão para o Eurolify é uma decisão posterior, cliente a cliente, com o
Eurolify já provado. **Quem decide:** Diogo ou Bruno.

### D-11 · Ponte para a memória de trabalho existente

A memória do Eurolify vive aqui (decisão B). **Por decidir pelo Diogo ou pelo Bruno:** pôr no
repo `bruno-88/claude` **uma** memória curta a apontar para este repositório,
para que uma sessão sobre os sistemas actuais saiba que o Eurolify existe. Não o fiz: o
pedido foi guardar aqui.

### D-12 · O nome «Lumavo» e a identidade visual

> ✅ **Nome decidido a 03/10/2026 pelo Diogo: Eurolify** — *«fica o eurolify»*
> ([ADR-0009](adr/0009-nome-eurolify.md)). «Lumavo» estava ocupado
> (`lumavo.com` desde 2009, `lumavo.eu` com dono). Por fazer: a pesquisa à mão
> no TMview e a compra dos domínios. A **identidade visual** continua por
> decidir. O texto abaixo fica como registo.
>
> **Logótipo (03/10/2026):** o Diogo entregou uma folha de 9 estudos
> «Eurolify», com paleta e frases de assinatura, que substitui os 18 rascunhos
> anteriores (apresentação, páginas 57 a 59). 🔴 O estudo 5 usa um círculo de
> estrelas: o EUIPO recusa marcas que reproduzam ou imitem o emblema europeu
> (art. 7.º, n.º 1, al. i), do regulamento da marca da UE; directrizes do
> EUIPO por resumo de pesquisa, **W**). Escolha por fazer.

**Não verifiquei** se a marca está livre no EUIPO nem que domínios estão
disponíveis. Verificar antes de gastar dinheiro em marca. A **identidade
visual** (logótipo, cores, letra) também está por decidir: as propostas vão com o
antes e o depois e decide o Diogo ou o Bruno (skill `eurolify-design`, regra 1).

### D-13 · Quem constrói, em quanto tempo e com que orçamento

> ✅ **Decidida a 03/10/2026 pelo Diogo: cenário A** — *«será eu e o Bruno a
> desenvolver com o Claude Code e Codex»* ([ADR-0008](adr/0008-construcao-pelo-diogo-e-pelo-bruno.md)).
> Tempo por fases no [§9 do docs/10](10-estimativa-prazo-e-custo.md); corrige-se às 8 semanas. O texto abaixo fica como registo da estimativa.

> **Estimada a 03/10/2026** em [`10-estimativa-prazo-e-custo.md`](10-estimativa-prazo-e-custo.md). Construção da Fase 1: **B** — 2
> programadores sénior, 16 a 30 meses, ≈ 173.000–465.000 €; **C** — 3 sénior,
> 12 a 23 meses, ≈ 193.000–519.000 €; **A** — só o Diogo e o Bruno com Claude
> Code, sem prazo estimável (sem medida). Fora dos números: contabilista,
> jurista, seguro, recrutamento e suporte (orçamentos a pedir). Recomendação: B
> com um líder técnico, medir às 8 semanas e decidir a terceira pessoa.

Referência do que um sistema destes pesa: o Hub tinha, a 30/09/2026, 420
caminhos de ecrã, 225 funções no servidor, 761 tabelas e 78 tarefas
automáticas (`proposta-venda-do-hub-30set2026.md`).

### D-14 · Como o Eurolify ganha dinheiro

> **Estudado a 03/10/2026** em [`09-modelo-de-receita.md`](09-modelo-de-receita.md).
> Recomendação: mensalidade por plano com escalões de vendas anuais, **sem taxa
> sobre cada venda**; receita de pagamentos só pelo prestador e às claras;
> módulos por país de faturação; serviço de migração; comissão da loja de
> extensões na Fase 3; nunca custos de saída.
>
> ✅ **Decidida a base a 03/10/2026 pelo Diogo** (*«sim, fica assim»*,
> [ADR-0007](adr/0007-receita-mensalidade-por-escaloes.md)): mensalidade por
> escalões de vendas anuais, sem taxa sobre cada venda. **Por decidir:** os
> preços (depois de falar com comerciantes e da D-13) e as outras fontes.

Mensalidade, percentagem das vendas, módulos pagos, instalação dedicada — **não
estudado**. Com a D-1 → a) (vender desde o início, ADR-0006), **passa a ser
preciso antes da Fase 1**.
