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

> **Uma fonte por decisão (04/10/2026):** quando há ADR, o texto da decisão e o estado completo estão no ADR; aqui fica uma linha curta, com o estado resumido da linha «Estado» do ADR. Sem ADR, o texto fica aqui. O texto anterior de cada linha está no histórico do Git.

| # | Decisão | Estado | Quem, quando | Registo |
|---|---|---|---|---|
| ✅ A | Nenhum código até haver um plano decidido | ⚠️ substituída por AE | Diogo, 03/10/2026 | [ADR-0001](adr/0001-sem-codigo-ate-plano-decidido.md) |
| ✅ B | **Skills, memórias e informação do Eurolify vivem neste repositório**, para o Bruno e o Diogo trabalharem em conjunto | em vigor | Diogo, 03/10/2026 | `AGENTS.md`, `memoria/` |
| ✅ C | **Requisitos de partida** (não são desenho): funcionar por API para qualquer frontend (Lovable, Vercel, Emergent, Bolt…); ter um Hub completo e adaptável; regras europeias de raiz; funcionar com qualquer IA | em vigor | Diogo, 03/10/2026 | `00-proposta.md` |
| ✅ D | **O Eurolify é desenvolvido dentro da Luckytarget Lda, com marca própria.** Nenhuma marca existente da empresa é usada no Eurolify; os sistemas actuais servem só como fonte de regras e de casos medidos | em vigor | Diogo, 03/10/2026 | `AGENTS.md`, `memoria/` |
| ✅ E | O Eurolify é construído de raiz (D-2 → a); a prova com a Medusa deixa de se fazer | em vigor; completada por AG | Diogo, 03/10/2026 | [ADR-0002](adr/0002-nucleo-proprio-de-raiz.md) |
| ✅ F | **O Eurolify é um produto para vender, como o Shopify, a todos os tipos de comerciantes da UE, e nativo para toda a UE** (exclui a c) da D-1; fecha a D-6) | em vigor | Diogo, 03/10/2026 | D-1 e D-6 abaixo |
| ✅ G | Alojamento num fornecedor europeu, com serviços geridos (D-3 → a) | ⚠️ substituída por V | Diogo, 03/10/2026 | [ADR-0003](adr/0003-alojamento-europeu-gerido.md) |
| ✅ H | O fornecedor de alojamento é a Scaleway | ⚠️ substituída por V | Diogo, 03/10/2026 | [ADR-0004](adr/0004-fornecedor-scaleway.md) |
| ✅ I | Publica-se pelo GitHub | em parte: o ponto 1 (publicar pelo GitHub) mantém-se; o «só de leitura» (pontos 2 e 3) substituído por W | Diogo, 03/10/2026 | [ADR-0005](adr/0005-publicacao-pelo-github.md) |
| ✅ J | **O Diogo e o Bruno têm toda a liberdade neste repositório**, cada um sozinho — incluindo faturação, NIF, IVA e identidade de clientes. **Regras da UE**: seguir as skills, só regras da UE com fonte, nunca inventar, dados na UE | em vigor | Diogo, 03/10/2026 | `AGENTS.md` |
| ✅ K | **Requisito: terceiros desenvolvem extensões de forma fácil** — aplicações, meios de pagamento, envios, faturação por país, regras de negócio, ecrãs. **As regras fiscais e legais não são extensíveis** (confirmado pelo Diogo: *«sim, concordo»*) | em vigor | Diogo, 03/10/2026 | `08-extensoes-de-terceiros.md` |
| ✅ L | **Na Fase 2, os parceiros da lista de pagamentos e envios são convidados a escrever eles próprios a sua ligação ao Eurolify**, com os contratos que o Eurolify já usa | em vigor | Diogo, 03/10/2026 | `05-fases-e-mvp.md`, `07` e `08` |
| ✅ M | O Eurolify vende-se a outros comerciantes desde o início (D-1 → a)) | em vigor; os preços só antes da peça 13 (S) | Diogo, 03/10/2026 | [ADR-0006](adr/0006-vender-desde-o-inicio.md) |
| ✅ N | A receita assenta numa mensalidade por plano, por escalões de vendas anuais, sem taxa sobre cada venda (D-14, em parte) | em vigor; preços e outras fontes por decidir (S) | Diogo, 03/10/2026 | [ADR-0007](adr/0007-receita-mensalidade-por-escaloes.md) |
| ✅ O | A Fase 1 é desenvolvida pelo Diogo e pelo Bruno, com Claude Code e Codex (D-13 → cenário A) | em vigor; prazo recalculado com AD | Diogo, 03/10/2026 | [ADR-0008](adr/0008-construcao-pelo-diogo-e-pelo-bruno.md) |
| ✅ P | O produto chama-se Eurolify (antes Lumavo; D-12, na parte do nome) | em vigor · ⚠️ **`eurolify.eu` comprado pelo Diogo a 04/10/2026** (registador não dito; o `.com` e o TMview continuam por fazer). A identidade visual continua por decidir | Diogo, 03/10/2026 | [ADR-0009](adr/0009-nome-eurolify.md) |
| ✅ Q | As regras e as skills vivem num sítio só, lido pelo Claude Code e pelo Codex (`AGENTS.md`) | em vigor | Diogo, 03/10/2026 | [ADR-0010](adr/0010-regras-num-sitio-so-agents-md.md) |
| ✅ R | A conta da Scaleway está preparada e o Claude lê-a só de leitura | ⚠️ sem efeito: alojamento por V, acesso por W; a Scaleway deixa de se usar (AN) | Diogo, 03/10/2026 | [ADR-0011](adr/0011-preparacao-da-conta-scaleway.md) |
| ✅ S | Os preços da D-14 são precisos antes da peça 13 da Fase 1, não antes do código | em vigor | Diogo, 03/10/2026 | [ADR-0012](adr/0012-precos-da-d14-antes-da-peca-13.md) |
| ✅ T | O código que um escreve, o outro revê; e o agente que não escreveu revê o diff | em parte: o ponto 1 (o outro aprova) substituído por AM; o ponto 2 mudado por AL enquanto o Codex não volta | Diogo, 03/10/2026 | [ADR-0013](adr/0013-revisao-do-codigo.md) |
| ✅ U | Um só ensaio, actualizado a cada entrada no `main` | em vigor; o ensaio passou para a VPS (V) | Diogo, 03/10/2026 | [ADR-0014](adr/0014-um-so-ensaio.md) |
| ✅ V | O Eurolify fica numa VPS operada pelo Diogo e pelo Bruno, num centro de dados na UE (substitui G e H) | em vigor | Diogo, 03/10/2026 | [ADR-0015](adr/0015-alojamento-numa-vps.md) |
| ✅ W | O Claude opera a VPS com acesso total (substitui o «só de leitura» de I e R) | em vigor; por onde chega à máquina: AA e AJ | Diogo, 03/10/2026 | [ADR-0016](adr/0016-o-claude-opera-a-vps.md) |
| ✅ X | A VPS é uma VPS-3 da OVH, num centro de dados na UE | em parte: a comprada é uma VPS-1 no Reino Unido (Y), onde o ensaio fica até à migração (AC) | Diogo, 03/10/2026 | [ADR-0017](adr/0017-vps-3-da-ovh.md) |
| ✅ Y | A VPS do ensaio fica, por agora, no Reino Unido, sem dados pessoais reais | em vigor até 31/03/2027 (Z) | Diogo, 03/10/2026 | [ADR-0018](adr/0018-vps-do-ensaio-no-reino-unido.md) |
| ✅ Z | A excepção do Reino Unido (Y) acaba a 31/03/2027, ou antes se entrar um dado de cliente real | em vigor | Diogo, 03/10/2026 | [ADR-0019](adr/0019-fim-da-vps-no-reino-unido.md) |
| ✅ AA | O Claude chega à VPS pelo Claude Code no computador do Diogo, por SSH (passos no `docs/11` §5.1) | ⚠️ passou a via de emergência (AJ) | Diogo, 03/10/2026 | [ADR-0020](adr/0020-acesso-pelo-computador-do-diogo.md) |
| ✅ AB | **A chave SSH do Diogo para a VPS troca-se a 31/03/2027**, com a migração para Paris (máquina nova, chave nova); a do Bruno terá data própria | em vigor | Diogo, 03/10/2026 | `11-preparacao-da-vps.md` §3.1 |
| ✅ AC | O ensaio fica na VPS-1 comprada até à migração para Paris | em vigor até 31/03/2027 | Diogo, 04/10/2026 | [ADR-0021](adr/0021-vps-1-ate-a-migracao.md) |
| ✅ AD | Três peças da Fase 2 passam para a Fase 1 (relatório OSS, devolução → nota de crédito, lotes) | em vigor | Diogo, 04/10/2026 | [ADR-0022](adr/0022-tres-pecas-da-fase-2-para-a-fase-1.md) |
| ✅ AE | OK para código (substitui A); o código de um domínio só depois de o modelo e a lista da API dele estarem escritos em tabela | em vigor | Diogo, 04/10/2026 | [ADR-0023](adr/0023-ok-para-codigo.md) |
| ✅ AF | O código vive neste repositório, e as duas revisões (T) impõem-se com o GitHub Pro | em parte: o ponto 3 (revisão dos donos) substituído por AM; o ponto 5 (Codex) suspenso enquanto o Codex não volta (AL) | Diogo, 04/10/2026 | [ADR-0024](adr/0024-revisoes-impostas-no-github-pro.md) |
| ✅ AG | As ferramentas do código (completa E) | em vigor; corrigida a 04/10/2026 (pacote `typebox` 1.x) | Diogo, 04/10/2026 | [ADR-0025](adr/0025-ferramentas-do-codigo.md) |
| ✅ AH | Publica-se no ensaio pelo GitHub por SSH | em vigor; completada por AJ | Diogo, 04/10/2026 | [ADR-0026](adr/0026-publicacao-pelo-github-por-ssh.md) |
| ✅ AI | O ensaio: cópias, alertas, registos e endereço | em parte: cópias na OVH (AN), chave também na VPS (AK), porta 443 só para o MCP (AO) | Diogo, 04/10/2026 | [ADR-0027](adr/0027-copias-alertas-registos-e-endereco-do-ensaio.md) |
| ✅ AJ | A VPS opera-se pelo GitHub (completa W e AA) | em vigor; completada por AO | Diogo, 04/10/2026 | [ADR-0028](adr/0028-a-vps-opera-se-pelo-github.md) |
| ✅ AK | A chave privada das cópias do ensaio fica também na VPS (muda AI) | em vigor; cópias na OVH (AN) | Diogo, 04/10/2026 | [ADR-0029](adr/0029-chave-do-age-tambem-na-vps.md) |
| ✅ AL | Sem o Codex, revê uma sessão nova do Claude Code (muda o ponto 2 de T) | em parte: o ponto 1 mantém-se até 29/11/2026, alargado por AQ; o ponto 2 (quando a outra pessoa não pode rever) sem objecto por AM | Diogo, 04/10/2026 | [ADR-0030](adr/0030-revisao-sem-codex-e-sem-a-outra-pessoa.md) |
| ✅ AM | Cada um junta o que fez (substitui a aprovação cruzada de T e AF) | em vigor | Diogo, 04/10/2026 | [ADR-0031](adr/0031-cada-um-aprova-o-que-fez.md) |
| ✅ AN | A OVH é o fornecedor único (muda AI e AK; põe fim a R) | em vigor; contentor em Paris, três zonas | Diogo, 04/10/2026 | [ADR-0032](adr/0032-ovh-fornecedor-unico.md) |
| ✅ AO | Um servidor MCP na VPS, por HTTPS, com acções (muda AI; completa AJ) | em vigor | Diogo, 04/10/2026 | [ADR-0033](adr/0033-mcp-na-vps-com-accoes.md) |
| ✅ AP | Segue-se o plano do pacote complementar de skills, dentro das regras do repositório | em vigor | Diogo, 04/10/2026 | [ADR-0034](adr/0034-plano-do-pacote-e-motor-de-regras.md) |
| ✅ AR | Catálogo: as propostas P1, P2 e P4 a P7 do `docs/14` §9 (canal e mercado de Preços e mercados; fórmula da Conformidade; sem atributos próprios na Fase 1; campos de um sistema externo só de leitura no Hub; `product.unpublished` e `product.archived`; SKU arquivado não volta) | em vigor | Diogo, 05/10/2026 | [`docs/14`](14-dominio-catalogo.md) §9 |
| ✅ AQ | A revisão do agente pode ser um agente lançado da própria sessão, sem a conversa dela (muda o ponto 1 de AL); sessões novas só a pedido | em vigor até 29/11/2026 (com AL) | Diogo, 04/10/2026 | [ADR-0035](adr/0035-revisao-por-agente-na-mesma-sessao.md) |
| ✅ AS | Catálogo: o SKU de uma variante apagada de um artigo rascunho (também já arquivada) volta a ficar livre; a P7 continua para tudo o resto | em vigor | Diogo, 05/10/2026 | [`docs/14`](14-dominio-catalogo.md) §9, P8 |
| ✅ AT | Catálogo: o SKU não distingue maiúsculas — `GEL-001` e `gel-001` são o mesmo, também contra as arquivadas | em vigor | Diogo, 05/10/2026 | [`docs/14`](14-dominio-catalogo.md) §9, P9 |
| ✅ AU | Catálogo: um artigo sem opções pode ter várias variantes; a combinação de opções só se exige única quando o artigo tem opções | em vigor | Diogo, 05/10/2026 | [`docs/14`](14-dominio-catalogo.md) §9, P10 |
| ✅ AV | Catálogo: num artigo que já não é rascunho, o texto de uma opção ou de um valor não muda (a ordem sim) | em vigor | Diogo, 05/10/2026 | [`docs/14`](14-dominio-catalogo.md) §9, P12 |
| ✅ AW | Catálogo: uma só língua de origem por comerciante (sai da loja) | em vigor; no código com a parte 3b (migração 0009) | Diogo, 05/10/2026 | [`docs/14`](14-dominio-catalogo.md) §9, P13 |
| ✅ AX | Identidade: uma chave de acesso nunca cria outra que dure mais do que ela | em vigor; programada no #124 (migração 0014, T12) | Diogo, 06/10/2026 | [`docs/19`](19-fatia-identidade.md) §5 |
| ✅ AY | Identidade: a chave pública de uma loja arquivada deixa de funcionar e não se criam novas; o registo fica; se a loja voltar a activa, as antigas não voltam | em vigor; migração 0016 (T13) | Diogo, 06/10/2026 | [`docs/19`](19-fatia-identidade.md) §5 |
| ✅ AZ | Comerciante `suspenso` ou `fechado` não escreve pela API (excepto encomendas pendentes do suspenso, revogar chaves e exportar) | em vigor; entra em cada domínio com as rotas que escrevem | Diogo, 06/10/2026 | [`docs/15`](15-dominio-comerciante.md) §4, [`docs/19`](19-fatia-identidade.md) §5 |
| ✅ BA | Identidade: criar uma chave pela API não tem segundo passo de confirmação; no Hub (parte B), sim, com nova autenticação da pessoa | em vigor | Diogo, 06/10/2026 | [`docs/19`](19-fatia-identidade.md) §10 |
| ✅ BB | Motor de regras: a data de verificação de um domínio não limita o momento pedido; vale a vigência e a prova de cada versão | em vigor (é o que o código já faz) | Diogo, 06/10/2026 | [`docs/eurolify/architecture.md`](eurolify/architecture.md) §4.2, #59 |
| ✅ BC | As contas de pessoas constroem-se na API, com bibliotecas abertas; passkeys primeiro, TOTP como alternativa; revisão de segurança própria | em vigor | Diogo, 06/10/2026 | [ADR-0036](adr/0036-contas-de-pessoas-construidas-na-api.md) |
| ✅ BD | Motor de regras: quem valida uma regra tem de ter um papel indicado para o tema dela no `docs/03` | em vigor; no código com o `PAPEIS_POR_DOMINIO` (#59) | Diogo, 06/10/2026 | [`docs/eurolify/architecture.md`](eurolify/architecture.md) §4.1, #59 |
| ✅ BE | As faturas emitem-se pelo software certificado de cada país, ligado por adaptador; o Eurolify decide o IVA e guarda o documento como prova (D-4 → a) | em vigor nas Fases 1 a 3 | Diogo, 06/10/2026 | [ADR-0037](adr/0037-faturas-por-software-certificado.md) |
| ✅ BF | O Eurolify nunca recebe o dinheiro das vendas: cada comerciante liga a sua conta (EuPago, Stripe primeiro) (D-5) | em vigor | Diogo, 06/10/2026 | [ADR-0038](adr/0038-o-eurolify-nunca-recebe-o-dinheiro.md) |
| ✅ BG | O checkout é alojado pelo Eurolify, com o aspecto e no domínio da loja; API de checkout própria só na Fase 3 (D-7) | em vigor | Diogo, 06/10/2026 | [ADR-0039](adr/0039-checkout-alojado-pelo-eurolify.md) |
| ✅ BH | As IAs dos comerciantes só lêem na Fase 1; escrita com confirmação humana na Fase 3; nunca faturas, reembolsos, fusões de clientes nem lotes (D-9) | em vigor | Diogo, 06/10/2026 | [ADR-0040](adr/0040-ia-so-le-na-fase-1.md) |
| ✅ BI | Um comerciante com sistema de gestão continua a emitir por ele; o Eurolify não fala com o software de faturação nessas vendas (D-10) | em vigor | Diogo, 06/10/2026 | [ADR-0041](adr/0041-com-sistema-de-gestao-emite-o-sistema-dele.md) |
| ✅ BJ | **Não** se põe nenhuma nota sobre o Eurolify no repositório `bruno-88/claude`: o Eurolify é um projecto totalmente separado (D-11 → não) | em vigor | Diogo, 06/10/2026 (*«Não. O Eurolify é um projeto totalmente separado»*) | D-11 abaixo |
| ✅ BK | Ensaio e produção em máquinas separadas a partir do primeiro comerciante de fora (produção na máquina da OVH em Paris; o produto escolhe-se na migração, ADR-0021) | em vigor | Diogo, 06/10/2026 | [`docs/11`](11-preparacao-da-vps.md) §7, ponto 3 |
| ✅ BL | Produção: cópia contínua (WAL) mais completa diária — perda máxima de 5 minutos, volta em até 4 horas; números a confirmar num ensaio de reposição | em vigor; onde ficam: BM | Diogo, 06/10/2026 | [`docs/11`](11-preparacao-da-vps.md) §7, ponto 4 |
| ✅ BM | Produção: as cópias ficam na OVH e numa segunda cópia cifrada noutro fornecedor da UE (só produção; o ensaio fica como no ADR-0032) | em vigor; a segunda cópia numa VPS da PTISP (só cópias; centro de dados, preço e acordo por verificar) | Diogo, 06/10/2026 | [`docs/11`](11-preparacao-da-vps.md) §7, ponto 4 |
| ✅ BN | Produção sem réplica da base no arranque; entra quando um comerciante precisar de voltar em menos de 4 h ou na Fase 2 | em vigor | Diogo, 06/10/2026 | [`docs/11`](11-preparacao-da-vps.md) §7, ponto 5 |
| ✅ BO | Produção: alertas pelo Healthchecks.io para o Diogo e o Bruno, mais verificação de minuto a minuto da API | em vigor; plano e custo por verificar | Diogo, 06/10/2026 | [`docs/11`](11-preparacao-da-vps.md) §7, ponto 7 |
| ✅ BP | O Codex opera a VPS com o mesmo acesso que o Claude, pelo GitHub (pedidos revistos, `medir`, MCP), sem chave SSH | em vigor | Diogo, 06/10/2026 | [`docs/11`](11-preparacao-da-vps.md) §7, ponto 8 |
| ✅ BQ | Identidade: uma chave com prazo só revoga chaves que expirem no mesmo instante ou antes dela | em vigor; migração 0015 (T14) | Diogo, 06/10/2026 | [`docs/19`](19-fatia-identidade.md) §5 |
| ✅ BR | Motor de regras: o papel de quem valida confere-se por domínio para já e, a seguir, linha a linha do `docs/03` (cada regra diz de que linha vem) | em vigor; linha a linha no código (`TEMAS_DOCS03`, #128) | Diogo, 06/10/2026 | [`docs/eurolify/architecture.md`](eurolify/architecture.md) §4.1, #126 |
| ✅ BS | Preços e mercados: um mercado novo tem os preços **com IVA** por omissão (o mesmo preço em todos os países; o comerciante pode mudar por mercado) | em vigor; por programar (desenho por aprovar) | Diogo, 06/10/2026 | [`docs/20`](20-dominio-precos-e-mercados.md) §9, Q1; #127 |
| ✅ BT | Preços e mercados: na Fase 1 não há conversão automática de moeda; cada lista de preços escreve os seus preços na moeda do mercado | em vigor; por programar (desenho por aprovar) | Diogo, 06/10/2026 | [`docs/20`](20-dominio-precos-e-mercados.md) §9, Q2; #127 |
| ✅ BU | Preços e mercados: os códigos de desconto e as regras de carrinho ficam para depois (com o domínio Carrinho); na Fase 1 só a redução anunciada com o preço anterior dos 30 dias | em vigor | Diogo, 06/10/2026 | [`docs/20`](20-dominio-precos-e-mercados.md) §9, Q3; #127 |
| ✅ BV | Preços e mercados: numa loja, um país só está num mercado activo (o mesmo cliente nunca vê dois preços) | em vigor; por programar (desenho por aprovar) | Diogo, 06/10/2026 | [`docs/20`](20-dominio-precos-e-mercados.md) §9, Q4; #127 |
| ✅ BW | Preços e mercados: o preço por unidade mostra-se sempre que a variante tem quantidade e unidade, até haver a lista validada das dispensas de cada país | em vigor; por programar (desenho por aprovar); as dispensas por país são C (jurista, `docs/12` B7) | Diogo, 06/10/2026 | [`docs/20`](20-dominio-precos-e-mercados.md) §9, Q5; #127 |
| ✅ BX | Preços e mercados: os eventos `market.activated` e `market.archived` entram na lista de eventos (o Catálogo arquiva as publicações de um mercado arquivado) | em vigor; no `docs/02`, no `docs/20` §6 e na skill `platform-architect` | Diogo, 06/10/2026 | [`docs/20`](20-dominio-precos-e-mercados.md) §9, Q6; #127 |
| ✅ BY | Motor de regras: cada linha do `docs/03` diz o domínio do motor em que vive (não a secção); três linhas sem domínio (nuvem, IA, cibersegurança) | em vigor; no código (`TEMAS_DOCS03`, #133) | Diogo, 06/10/2026 | [`docs/eurolify/architecture.md`](eurolify/architecture.md) §4.1, #133 |
| ✅ BZ | Motor de regras: a DAC7 e o fim da isenção aduaneira ficam sem domínio até o contabilista e o despachante dizerem onde pertencem | em vigor; no código (`TEMAS_DOCS03`, #133) | Diogo, 06/10/2026 | [`docs/eurolify/architecture.md`](eurolify/architecture.md) §4.1, #133 |
| ✅ CA | Contas de pessoas: sem passkey, entra-se com e-mail + palavra-passe (resumo Argon2id) + código TOTP; nunca a palavra-passe sozinha | em vigor; desenho aprovado | Diogo, 06/10/2026 | [`docs/21`](21-contas-de-pessoas.md) §10, P1 |
| ✅ CB | Contas de pessoas: na Fase 1, os convites não vão por e-mail; o dono copia a ligação no Hub e envia-a ele (vale uma vez e expira) | em vigor; desenho aprovado | Diogo, 06/10/2026 | [`docs/21`](21-contas-de-pessoas.md) §10, P2 |
| ✅ CC | O Eurolify só passa a fornecedor de identidade (OIDC) quando houver aplicações de terceiros; até lá, sessão própria no Hub e chaves de API nas integrações | em vigor; desenho aprovado | Diogo, 06/10/2026 | [`docs/21`](21-contas-de-pessoas.md) §10, P3 |
| ✅ CD | Contas de pessoas: a sessão acaba após 12 h sem uso e no máximo 30 dias depois de entrar; a conta sem nenhum comerciante é pseudonimizada 90 dias depois de sair (o prazo dos 90 dias para o jurista confirmar, C) | em vigor; desenho aprovado | Diogo, 06/10/2026 | [`docs/21`](21-contas-de-pessoas.md) §10, P4 |
| ✅ CE | O e-mail de um convite não é confirmado na Fase 1 (quem convida tem a ligação, CB): aceita-se o risco de quem convida ficar com a conta desse e-mail e de saber se ele já tem conta; **rede temporária até ao primeiro comerciante real ou 31/03/2027, o que chegar primeiro** — antes disso, a protecção (e-mail confirmado ou convites por e-mail) | em vigor, com data de fim | Diogo, 06/10/2026 | [`docs/21`](21-contas-de-pessoas.md) §4.7; revisão do #141, P2-1 |
| ✅ CF | Catálogo: a publicação verifica já o que existe (artigo, mercado e canal activos, categoria fiscal, classificação, preço, peso, tradução do nome) e diz sempre que a Conformidade e a media **não foram verificadas**; rede com fim: quando a Conformidade existir ou antes de haver produção | em vigor para a Conformidade; a parte da media acabou a 08/10/2026 (CR); no código (migração 0019, #77) | Diogo, 06/10/2026 | [`docs/14`](14-dominio-catalogo.md) §5, C2 |
| ✅ CG | A palavra-passe das contas guarda-se com Argon2id, no mínimo t=3, p=4, 64 MiB, sal de 128 bits e resultado de 256 bits (RFC 9106 §4, segunda opção recomendada); o tempo mede-se na VPS | em vigor; o código entra na B3 | Diogo, 06/10/2026 | [`docs/21`](21-contas-de-pessoas.md) §8 |
| ✅ CH | Eventos de domínio: quem fez a mudança (`quem`) fica guardado no Eurolify, como rasto interno, mas **nunca sai** nos webhooks; quem recebe e precisar dele pede-o à API, que verifica as permissões | em vigor; aplica-se no publicador (os webhooks) | Diogo, 07/10/2026: *«fica a (a)»* | [`docs/18`](18-base-comum-da-api.md) §5; [`docs/17`](17-dados-pessoais-e-incidentes.md) §3 |
| ✅ CI | Recuperar a conta: o limite de tentativas conta por e-mail e por IP — um IP com 5 falhas em 15 minutos fica bloqueado para qualquer e-mail; um e-mail com 5 falhas só bloqueia quem também falhou desse IP; um código certo de um IP sem falhas passa. Só protege quando a API vir o IP verdadeiro (condição para ligar o Hub) | em vigor; código no #144 | Diogo, 07/10/2026 | [`docs/21`](21-contas-de-pessoas.md) §12; revisão do #144, P2-2 |
| ✅ CJ | Catálogo: uma publicação publicada que deixa de passar na verificação (classificação, nome e tradução, última variante à venda, língua nova no mercado) **sai de venda sozinha**, com o motivo `verificacao_falhou` e os impedimentos guardados | em vigor; no código (migração 0023, #146; issue #77) | Diogo, 07/10/2026: *«sim, avança com a (a)»* | [`docs/14`](14-dominio-catalogo.md) §4.2 e §8 |
| ✅ CK | Contas de pessoas: as chaves públicas (as do site da loja, que qualquer visitante vê) não se revogam quando quem as criou sai da equipa ou muda de papel; as de servidor revogam-se em cadeia | em vigor; código no #149 | Diogo, 07/10/2026 | [`docs/21`](21-contas-de-pessoas.md) §4.4 e §12; revisão do #149, P2-2 |
| ✅ CL | API do Catálogo: quem publicou, arquivou ou classificou (`publicado_por`, `arquivado_por`, `classificado_por`) **não sai** nas consultas com `catalog:read`; volta, se for preciso, com um âmbito próprio e uma razão escrita | em vigor; no código (#150) | Diogo, 07/10/2026: *«sim, fica a (a)»* | [`docs/14`](14-dominio-catalogo.md) §7.1; CH |
| ✅ CM | Catálogo: a categoria fiscal de um artigo aceita qualquer código no formato da base (`^[a-z][a-z0-9_]*$`), sem confirmar que existe na lista do Motor de IVA — **rede temporária**, marcada **C**. **Fim:** quando o Motor de IVA existir, ou antes de haver produção (ADR-0027), o que vier primeiro, como a rede da CF | **terminada** a 09/10/2026: a migração 0040 (Motor de IVA, CZ) recusa uma categoria que não esteja na lista | Diogo, 07/10/2026: *«sim, confirmo esse prazo»* | [`docs/14`](14-dominio-catalogo.md) §2 e §7.1; CF |
| ✅ CN | API do Catálogo: arquivar uma variante que já está arquivada devolve-a sem mudar nada (200), como pedir o estado em que o artigo já está (§4.1); arquivada continua final, não volta a activa | em vigor; no código (#159) | Diogo, 07/10/2026: *«sim, fica como no artigo»* | [`docs/14`](14-dominio-catalogo.md) §7.1 |
| ✅ CO | API do Catálogo: rever uma tradução proposta por IA **não se faz pela API de chaves** — as chaves podem ser de agentes de IA, e só uma pessoa revê; faz-se no Hub, com a sessão de uma pessoa (docs/21). | em vigor; no código (#166) | Diogo, 08/10/2026: *«sim, fica a (a)»* (revisão do #166, P1-1) | [`docs/14`](14-dominio-catalogo.md) §7.1 |
| ✅ CP | API do Catálogo: uma tradução feita por chave fica **sempre como proposta de IA** (`origem: ia`); o pedido não diz a origem. Só o Hub, com a sessão de uma pessoa, grava traduções de pessoa — como o `docs/14` §3.8 já dizia (a origem vem de quem chama, nunca do corpo) | em vigor; no código (#166) | Diogo, 08/10/2026: *«sim, fica sempre IA»* (2.ª revisão do #166, P2-A) | [`docs/14`](14-dominio-catalogo.md) §3.8 e §7.1 |
| ✅ CQ | Catálogo: as imagens dos artigos guardam-se, por agora, **no disco da VPS**, servidas pelo Eurolify, com o código preparado para mudar para um serviço europeu de armazenamento de ficheiros (outra implementação da mesma interface, sem mudar as rotas; essa implementação ainda não existe); esse serviço (fornecedor, contrato, custo) decide-se quando houver lojas a sério, com preços verificados. Imagens reais só depois da migração da VPS para Paris (ADR-0018, ADR-0019) | em vigor; no código (media) | Diogo, 08/10/2026: *«sim, fica a (a); avança com as imagens»* | [`docs/14`](14-dominio-catalogo.md) §3.5 |
| ✅ CR | Catálogo: uma imagem sem texto alternativo **impede a publicação** (C2), se for do artigo ou de uma variante à venda no par; a verificação diz já só `nao_verificado: [conformidade]` (acaba a parte da media da rede CF), e junta `traducao_do_texto_alternativo` num mercado com outra língua e com imagens, porque o texto alternativo só existe na língua de origem; acrescentar uma imagem sem texto ou tirar o texto a uma **tira de venda** as publicações onde conta (como na CJ); fá-lo quem tem `catalog:write`, sem `catalog:publish`, como já arquivar uma variante ou mudar o nome | em vigor; no código (#77) | Diogo, 08/10/2026: *«sim, avança com a verificação das imagens»* | [`docs/14`](14-dominio-catalogo.md) §3.5, §4.2 e §5, C2 |
| ✅ CS | Exportação dos dados: um recurso comum `POST /exports` com os domínios (hoje só `catalogo`); um ZIP com `catalogo.json` (o completo), um CSV por entidade e as imagens, em todos os estados, sem quem fez nem preços; feito dentro do pedido a partir de um momento só; uma de cada vez por comerciante; fica 7 dias; no máximo 3 por expirar (**proposta**, revisão do #189); sem custo | em vigor; no código (migração 0030, #77) | Diogo, 08/10/2026: *«sim, aprovo; avança com o código da exportação»* | [`docs/14`](14-dominio-catalogo.md) §3.11; [`docs/15`](15-dominio-comerciante.md) §7 |
| ✅ CT | Importação do catálogo: primeiro o ensaio (`POST /imports`, CSV de uma linha por variante ou o `catalogo.json`), que não grava e diz o que cria, altera, fica igual ou recusa; depois aplicar grava o plano, tudo ou nada, e recusa se algo mudou entretanto. Cria só em rascunho; nunca apaga nem arquiva; célula vazia não muda; a variante é o SKU, nunca o nome; artigos de sistema externo não se alteram; 24 h, 10 MB, 5000 variantes (**proposta**) | em vigor; no código (migração 0032, #77) | Diogo, 08/10/2026: *«sim, aprovo; avança com o código da importação»* | [`docs/14`](14-dominio-catalogo.md) §3.11 |
| ✅ CU | Catálogo: a linha do tempo do artigo (C7) — a base regista cada mudança nas tabelas do Catálogo (quem, quando, antes e depois), só se acrescenta, e recusa a mudança sem quem; começa no dia da migração (sem passado inventado); lê-se em `GET /products/{id}/timeline` com o âmbito novo `catalog:history`, que têm o dono e o gestor (não o armazém nem o apoio); notas e anexos ficam para depois; prazo de guarda por decidir (**C**) | em vigor; no código (migração 0033, #77) | Diogo, 09/10/2026: *«sim, aprovo; avança com o código do histórico»* | [`docs/14`](14-dominio-catalogo.md) §3.12; CL |
| ✅ CV | Imagens: os metadados (EXIF, XMP, IPTC, textos do PNG) saem ao receber, sem voltar a codificar a imagem e sem biblioteca de fora; no JPEG fica só a orientação; uma imagem que não se consegue limpar recusa-se. Um ficheiro sem uso (nenhuma media o liga) sai do disco e da tabela ao fim de **7 dias** (**proposta**), pela própria API, uma vez por dia, na fila dos envios do comerciante; a verificação diária avisa com mais de 9. Quem aparece nas imagens é responsabilidade do comerciante (subcontratante; **C**, `docs/12`, B, ponto 8) | em vigor; no código (migração 0035, #179) | Diogo, 09/10/2026: *«sim, aprovo; avança com o código da #179»* | [`docs/14`](14-dominio-catalogo.md) §3.5; [`docs/17`](17-dados-pessoais-e-incidentes.md) T9 |
| ✅ CW | Preços, parte 2: a API de Administração (mercados, canais, listas, preços, reduções) com dois âmbitos novos, `prices:read` e `prices:write` (o dono e o gestor, os dois; o armazém e o apoio, só a leitura); a redução anunciada com o preço de referência calculado pela base (o mais baixo praticado nos 30 dias, contando as reduções anteriores), recusada sem 30 dias seguidos de preço, abaixo ou igual ao de referência, ou com outra em vigor; o preço não muda por baixo de uma redução; a redução começa logo (sem datas no futuro); o preço por unidade com quatro casas, sem arredondar para mostrar (**C**) | em vigor; no código (migração 0036, #127) | Diogo, 09/10/2026: *«sim, aprovo; avança com o código de Preços»* | [`docs/20`](20-dominio-precos-e-mercados.md) §10 |
| ✅ CX | Clientes (fatia 5): o desenho do `docs/23` aprovado com as cinco respostas recomendadas — **Q1** a finalidade (consumo / profissional / revenda) começa sempre em consumo e escolhe-se em cada encomenda; **Q2** o mesmo NIF em dois perfis empresa não é sinal de duplicado (podem ser duas pessoas da mesma empresa); **Q3** um perfil usado numa fatura não muda de NIF, tipo nem país (cria-se outro); **Q4** só o dono põe ou tira uma isenção manual de IVA; **Q5** o login dos clientes fica para a Loja. Parte 1 no código: ficha, perfis com a régua do NIF na base, um principal por ficha, etiquetas ligadas às listas B2B, linha do tempo e eventos sem dados pessoais; âmbitos `customers:read` e `customers:write` (o dono, o gestor e o apoio; não o armazém) e `customers:billing`, só do dono: criar e mudar perfis de faturação (NIF, morada fiscal) — o gestor e o apoio mudam a ficha e as etiquetas, não os dados fiscais | em vigor; parte 1 no código (migração 0037, #233) | Diogo, 09/10/2026: *«sim, aprovo; avança com o código da fatia 5»*; *«sim, só o dono»* (o `customers:billing`, revisão do #234, P3-13) | [`docs/23`](23-dominio-clientes.md) |
| ✅ CZ | Motor de IVA (fatia 6): o desenho do `docs/24` aprovado com as cinco respostas recomendadas — **Q1** numa venda isenta com preço com IVA, o cliente paga sem o IVA do país do comerciante; **Q2** sem o regime declarado (origem ou destino), as vendas a consumidores de outros países da UE ficam bloqueadas; **Q3** as entregas nos Açores e na Madeira de um comerciante do continente ficam bloqueadas até o contabilista dizer a taxa; **Q4** a isenção manual leva o código do motivo do documento; **Q5** serviços e eventos só com o lugar no país do comerciante. No código: as tabelas (só a taxa normal de Portugal, **M**), a decisão pela ordem do Bruno, a simulação, o fim da rede CM | em vigor; no código (migração 0040, #255) | Diogo, 09/10/2026: *«sim, aprovo; avança com o código da fatia 6»* | [`docs/24`](24-motor-de-iva.md) |
| ✅ CY | Clientes, parte 3: o VIES consultado só pelo servidor, com a prova de cada consulta (que só se acrescenta) e a revalidação de noite; **Q6** sem resposta, o perfil «válido» continua «válido» com a data da última resposta (quanto tempo serve para isentar decide-o o Motor de IVA com o contabilista, V5); **Q7** o NIF do comerciante vai como requerente (é o que traz o número de consulta, medido a 09/10/2026). A isenção manual só a põe e retira o dono (`customers:exemptions`), e a base recusa que um processo de sistema a retire. Os anexos ficam para um pedido à parte | em vigor; no código (migração 0039, #233) | Diogo, 09/10/2026: *«sim, aprovo; avança com o código da parte 3»* | [`docs/23`](23-dominio-clientes.md) §13 |
| ✅ DA | Checkout alojado (fatia 7): o desenho do `docs/25` aprovado com as seis propostas — **Q1** o botão final cria o núcleo da encomenda a aguardar pagamento, com a cópia de tudo; **Q2** portes com tarifa fixa por mercado e método, grátis acima de um valor; **Q3** o stock só na fatia 9; **Q4** a confirmação guardada, o envio por e-mail com a fatia de Notificações (sem ele, não há produção); **Q5** `checkout.eurolify.eu/{loja}` na Fase 1; **Q6** checkout sem conta. Parte 1 no código: carrinho, sessão, textos legais com versões, métodos de entrega, resumo com o IVA do Motor e o botão final; só artigos físicos até a natureza para o IVA estar no artigo | em vigor; parte 1 no código (migração 0041, #273) | Diogo, 09/10/2026: *«sim, aprovo; avança com o código da fatia 7»* | [`docs/25`](25-checkout.md) |
| ✅ DB | Pagamentos (fatia 8): o desenho do `docs/26` aprovado com as seis propostas — **Q1** EuPago (MB WAY e Multibanco) primeiro, em modo teste; **Q2** a Stripe só na parte 2, depois da decisão da regra 4 (empresa-mãe fora da UE); **Q3** só o dono liga a conta do prestador, credenciais cifradas com chave do ambiente; **Q4** captura no pagamento; **Q5** 24 h para pagar antes de cancelar; **Q6** tarefas automáticas de minuto a minuto (correm dentro da API, como a fila do VIES). Parte 1 no código: contas, régua, pagamento com a máquina da skill, avisos assinados, incerto e fila de diferenças, encomenda paga ou cancelada | em vigor; parte 1 no código (migração 0044, #287) | Diogo, 09/10/2026: *«sim, aprovo; avança com o código da fatia 8»* | [`docs/26`](26-pagamentos.md) |
| ✅ DC | Contas de pessoas: depois de recuperar a conta, o Hub **mostra as chaves de acesso que a pessoa criou e propõe revogá-las**; não as revoga sozinho (revisão do #149, P2-1) | em vigor; o aviso do Hub por programar (#107) | Diogo, 10/10/2026: *«só propor, não revogar sozinho»* | [`docs/21`](21-contas-de-pessoas.md) §7 e §12 |
| ✅ DD | Clientes, parte 2b (fusões): numa fusão, os perfis de faturação da ficha absorvida **copiam-se** para a que fica (opção A), com a indicação de onde vieram, porque um perfil nunca muda de ficha (0037) e cada encomenda está presa ao par ficha e perfil (0041); os perfis originais e as encomendas antigas ficam na ficha absorvida, só de leitura; as cópias voltam ao VIES; a isenção manual não se copia (uma pessoa volta a pô-la). Rejeitadas: B (a ficha que fica «vê» os perfis da outra, que obrigava a mudar todos os leitores) e C (mudar a ficha nas encomendas já feitas). Fundir e decidir candidatos pede o âmbito `customers:merge` (dono e gestor) | em vigor; no código (migração 0046, #233) | Diogo, 10/10/2026: *«sim, copiar (A)»* | [`docs/23`](23-dominio-clientes.md) §3.7 e §12 |
| ✅ DE | Stock e encomendas (fatia 9): o desenho do `docs/27` aprovado com as sete propostas — **Q1** um armazém por loja; **Q2** a reserva no botão final; **Q3** com um sistema de gestão, o livro é do Eurolify e o sistema dele envia entradas e ajustes pela API; **Q4** o lote obrigatório só nas variantes marcadas; **Q5** transportadora e seguimento à mão nesta parte; **Q6** concluída 14 dias depois de entregue (**C**); **Q7** a loja mostra disponível ou esgotado. Parte 1 no código: livro de movimentos como única porta do saldo, lotes, kits pelos componentes, reserva e libertação, expedições e a vista do armazém | em vigor; parte 1 no código (migração 0047, #295) | Diogo, 10/10/2026: *«sim, aprovo; avança com o código da fatia 9»* | [`docs/27`](27-stock-e-encomendas.md) |
| ✅ DF | Motor de regras: a caixa (`pos_fiscal`), as instalações e o emprego, e o transporte **não entram como domínios** do motor até haver uma loja que precise deles; até lá, o motor não os dá como cobertos | em vigor | Diogo, 10/10/2026: *«ficam fora até haver uma loja que precise»* | [`docs/eurolify/architecture.md`](eurolify/architecture.md) §4.5; #283 |
| ✅ DG | A verificação `segredos` (o gitleaks do fluxo `vigiar`) passa a ser **obrigatória** para juntar ao `main`, ao lado de `codigo`, `script-vps` e `imagem` | em vigor desde 10/10/2026, 12:53 UTC (regra «main protegido», lida na API do GitHub) | Diogo, 10/10/2026: *«sim»*, gravado por ele | [`docs/16`](16-auditoria-das-skills.md), «Estado a 10/10/2026» |
| ✅ DL | Clientes, consentimento de marketing: o estado guarda-se **por contacto e por canal** (cada e-mail, cada telefone), não por ficha; a prova identifica o canal e o contacto; sobre uma recusa activa desse contacto, um «sim» novo só conta depois de uma **dupla confirmação** enviada a esse contacto (ligação por e-mail, código por SMS), cujo registo fica como prova; sem confirmação, a recusa fica; um «sim» noutro contacto não mexe na recusa dos outros. A prova pode ficar na ficha de origem, lida a partir da fundida, desde que a ligação não se perca; se a ficha de origem for apagada ou pseudonimizada, o consentimento dela cai. Substitui a régua por ficha proposta no #325 (o «não» de uma ficha a vencer, ou um «sim» depois da fusão a vencer). Fontes indicadas pelo Diogo (RGPD, arts. 5.º, n.º 1, al. d), 7.º, n.os 1 e 3, e 21.º, n.º 3; Lei 41/2004, art. 13.º-A, n.º 1) — **C**, não verificadas | decidido; desenho no `docs/23` §14; no código no pedido da migração 0052 (#330, por juntar). Q-C1 decidida (Diogo, 10/10/2026: «A»): envia o sistema do comerciante; o Eurolify cria o pedido, devolve o segredo uma vez e valida | Diogo, 10/10/2026, em resposta à revisão do #325 | [`docs/23`](23-dominio-clientes.md) §14 |
| ✅ DN | Clientes: os anexos da isenção manual de IVA (PDF, JPEG ou PNG, até 10 MB, até 5 por isenção) guardam-se **na base de dados**, e não numa pasta da VPS: ficam com o RLS de cada comerciante, entram nas cópias que já existem e saem com a pseudonimização dos perfis que ninguém usou (os dos usados ficam, R9); até 1 GB por comerciante (proposta); o custo é a base crescer (não medido). Rejeitada: uma pasta privada no disco (obrigava a mudar a VPS e o script das cópias) | em vigor; no código (migração 0055, #233) | Diogo, 10/10/2026: «A» | [`docs/23`](23-dominio-clientes.md) §13.5 e §13.11 |
| ✅ DH | Vigiar as versões fixas: o **Dependabot** abre um pedido por semana com as acções do GitHub novas (mantém a fixação pelo resumo); as **imagens base**, que ele não lê, confere-as todas as manhãs o trabalho `imagens` do fluxo `vigiar`, que abre um issue quando uma etiqueta tem uma imagem nova **no espelho `mirror.gcr.io`** (é o espelho que se compara, não o Docker Hub). Os pedidos do Dependabot contam como código: revisão do agente e aprovação de um dono. Nada entra no `main` sozinho | em vigor ao juntar este pedido | Diogo, 10/10/2026: *«sim, avança com o Dependabot»* | [`.github/dependabot.yml`](../.github/dependabot.yml); [`docs/16`](16-auditoria-das-skills.md) |
| ✅ DI | Documentos fiscais (fatia 10): o desenho do `docs/29` aprovado com as sete propostas — **Q1** a primeira emissão é automática, uma a uma, com retenção; correcções, reenvios e reconciliações são de uma pessoa; **Q2** o documento nasce ao confirmar o pagamento; **Q3** em modo real, uma taxa por verificar retém; **Q4** antes de emitir só se corrigem o NIF, o nome e a morada fiscal, nunca taxas nem montantes, e nunca «consumidor final» a quem deu NIF; **Q5** parte 1 com um emissor de ensaio, o Moloni na parte 2 com a documentação oficial lida e uma conta de teste; **Q6** quem emite escolhe-se na entidade legal e copia-se para a encomenda; **Q7** decidir a fila dono e gestor, ligar o emissor só o dono — **corrigir NIF, nome e morada e libertar retenções só o dono** (`customers:billing`, `customers:exemptions`; Diogo, 10/10/2026, *«aprovado»*, revisão do #312, P2-4). Parte 1 no código: emissor, ligação, retenção, emissão em dois passos, prova lida de volta, incerto reconciliado | em vigor; parte 1 no código (migração 0050, #310) | Diogo, 10/10/2026: *«sim, aprovo; avança com o código da fatia 10»* | [`docs/29`](29-documentos-fiscais.md) |
| ✅ DJ | **RTO de 4 horas:** depois de uma avaria, a produção volta a funcionar no máximo em 4 horas (repor a base a partir da cópia incluído) | em vigor; o ensaio de reposição de domingo mede o tempo real (`docs/17`, «Cópias») | Diogo, 10/10/2026: *«RTO máximo de 4 horas»* | [`docs/17`](17-dados-pessoais-e-incidentes.md) |
| ✅ DK | **O rasto de auditoria responde a seis perguntas** em todos os domínios: o que mudou (comerciante, registo, campos, antes e depois, com os dados sensíveis protegidos); quem executou (pessoa, aplicação ou automatismo, com identificador autenticado); de onde veio (Hub, API, importação, integração ou MCP, com o identificador do pedido); a IA (fornecedor, modelo e execução, distinguindo comprovado, declarado e desconhecido); quem autorizou (a pessoa, separada da IA ou da aplicação que executou); quando e porquê (UTC, motivo, ligação à operação de origem) | desenho no `docs/28` **aprovado** com as quatro propostas (Q1 a Q4); o código por domínio (#322) | Diogo, 10/10/2026: *«aprovado»* | [`docs/28`](28-rasto-de-auditoria.md) |
| ✅ DM | Pós-venda (fatia 11): o desenho do `docs/30` aprovado com as sete propostas — **Q1** o botão de livre resolução só para consumidores (profissionais pelo apoio); **Q2** reembolsos de Multibanco e MB WAY manuais (transferência registada com prova) até se ler a documentação da EuPago; **Q3** a devolução reembolsa-se depois de recebida e inspeccionada, o problema logo depois da decisão; **Q4** na livre resolução reembolsa-se a entrega inicial e a volta paga-a o cliente, salvo oferta do comerciante (**C**, jurista); **Q5** só o revendável volta a stock; **Q6** o armazém recebe e inspecciona, dono e gestor decidem reembolsos e cancelamentos, o apoio regista pedidos; **Q7** uma pessoa pode cancelar uma encomenda paga não expedida (reservas, reembolso total, NC se a fatura saiu) | em vigor; desenho (#328) | Diogo, 10/10/2026: *«aprovado»* | [`docs/30`](30-pos-venda.md) |
| ✅ DO | Rasto de auditoria, quatro regras: **(1)** o aviso «sem autorização de uma pessoa» aparece em **toda** a alteração sem uma pessoa registada como quem autorizou, seja qual for a origem (agente, regra, importação, tarefa) — não só com IA declarada; uma linha sem contexto (de antes de 10/10/2026) diz «autorização desconhecida» (Q8, RGPD art. 5.º, exatidão); **(2)** o trabalho feito mais tarde a pedido de alguém guarda o pedido de origem e herda a autorização: «sistema, a pedido do agente X (pedido n.º …)», nunca só «sistema»; **(3)** o histórico de preços em dois níveis: `prices:read` vê o tipo de autor e o aviso; quem mudou e quem autorizou pedem `prices:history` (os papéis do `catalog:history`); **(4)** na conta nova pelo convite e na recuperação, a própria pessoa fica como quem autorizou, só quando a operação termina bem e sem IA declarada no pedido (Q9) | em vigor; desenho no `docs/28` §3.2 e §3.6 a §3.8; o código por partes (#322) | Diogo, 11/10/2026 (Q5 a Q9 do `docs/28`; Q8 e Q9: *«confirmo»*) | [`docs/28`](28-rasto-de-auditoria.md) §3.2, §3.6–§3.8 |
| ✅ DP | Pós-venda, parte 2 (fatia 11): o desenho do reembolso pela EuPago (`docs/30` §13) aprovado — o **MB WAY** reembolsa-se pela EuPago (OAuth com `client_id` e `client_secret` cifrados na conta; o `trid` guardado do aviso; pedido aceite fica `a_confirmar` até a consulta dizer `reembolsado`; um tempo esgotado fica `incerto` e só uma pessoa o reconcilia, nunca se repete sozinho); **Q8: o Multibanco continua à mão** (opção A: o Eurolify não recebe IBANs) | em vigor; código no pedido #350 | Diogo, 11/10/2026: *«aprovado, com a A»* | [`docs/30`](30-pos-venda.md) §13 |
| ✅ DQ | Pós-venda, o aviso do prazo do reembolso (R10): **3 dias antes e no dia em que passa**, uma vez cada, só nas devoluções de um pedido de livre resolução ainda por reembolsar; como evento (`refund.deadline_approaching`, `refund.deadline_passed`) e numa lista da API (`GET /returns?prazo_reembolso=`), **sem e-mail** até haver notificações; o prazo conta-se no **fuso do comerciante** (14 dias, **C**, J4) | em vigor; código no pedido #353 | Diogo, 11/10/2026: *«aprovado»* | [`docs/30`](30-pos-venda.md) §14 |
| ✅ DR | **A gestão da empresa inteira entra no produto, em módulos ligáveis a partir da Fase 2** (camadas B a H do `docs/31` §8: operação, comercial, financeiro, organização, por sector, pessoas, parceiros); cada módulo pelas 8 portas e com desenho antes do código; a Fase 1 não muda (muda o `docs/00` §2.2) | em vigor; nenhum módulo passou ainda as portas; por estimar | Diogo, 11/10/2026: *«a, actualiza o docs/00 e o docs/05»* | [ADR-0042](adr/0042-gestao-da-empresa-em-modulos-da-fase-2.md) |
| ✅ DS | As **saídas das 8 portas** dos módulos de gestão (`docs/13` §7 a §19) aprovadas: nove **estreitar**, as tarefas **estreitar e avançar**, e a organização, o marketing e gráfica e as pessoas **mortos como módulos próprios** (as peças que se aproveitam vão para o Catálogo, o MCP de leitura ou extensões; nenhuma biometria sem o jurista). **Duas peças passam para a Fase 1:** as tarefas das filas que pedem uma pessoa e a consulta das vendas do dia e do mês | em vigor; as duas peças estimadas no `docs/10` (**C**); a peça 21 desenhada com sete filas (DW); as portas 3 e 4 por responder (conversas do `docs/32`) | Diogo, 11/10/2026: *«sim, aprovo as saídas todas»* | [ADR-0043](adr/0043-saidas-das-portas-dos-modulos-de-gestao.md) |
| ✅ DT | Pós-venda, a marca «selado por higiene» (R4; Directiva 2011/83/UE, art. 16.º, e)): **no artigo**, posta pelo comerciante, só num físico; **copiada para a linha da encomenda** no botão final; mostrada no resumo e na confirmação (o texto legal por país com a parte 2 do checkout, **C**, J5); numa linha marcada que voltou **aberta** de uma livre resolução, uma pessoa decide **explicitamente** se reembolsa ou aplica a excepção, sem escolha por omissão | em vigor; código no pedido #363 | Diogo, 11/10/2026: *«aprovado»* | [`docs/30`](30-pos-venda.md) §15 |
| ✅ DU | **Os pedidos do titular cobrem todos os domínios**: no apagamento, a prova fiscal fica 10 anos (art. 52.º do CIVA); os dados de uma encomenda em curso ficam até ela acabar e limpam-se sozinhos (Q1); o resto limpa-se logo; o perfil de faturação só fica com documento emitido ou por emitir (Q2, **C** contabilista); o aviso em bruto do prestador passa a resumo e campos não pessoais (Q3); os documentos saem na exportação sem os bytes do PDF e o motivo da correcção fica (Q4); as sessões de checkout limpam-se por prazo (logo, na concluída; 7 dias, na abandonada) | aprovado; código por partes (#233) | Diogo, 11/10/2026 (*«aprovado»*) | [`docs/23`](23-dominio-clientes.md) §15 |
| ✅ DV | **O balcão vende pelo POS do Hub do Eurolify; o Moloni só emite as faturas** de cada venda, pelo adaptador da fatia 10 (ADR-0037). Substitui a saída do balcão da DS: sai do primeiro alvo a ligação a um POS de fora (app «Moloni POS» ou outro certificado). O Moloni não é POS nem fonte de stock, preços ou clientes | em vigor; o balcão continua na Fase 2; construir o POS por estimar; a contingência sem rede por verificar com o contabilista (**C**) | Diogo, 11/10/2026: *«O POS será utilizado o do hub. O Moloni é só para facturação»*; *«sim, regista a DT»* (ficou DV: a DT já era da pós-venda, #363) | [ADR-0044](adr/0044-balcao-pelo-pos-do-hub-moloni-so-para-faturar.md) |
| ✅ DW | Peça 21 da Fase 1, as **tarefas das filas que pedem uma pessoa**: a lista «A decidir» **lê os casos abertos de cada fila** e a tarefa só guarda o responsável e o prazo (`atribuicao`); não se fecha à mão; **sete filas** (as quatro da DS mais o pedido de livre resolução pendente ou fora de prazo, o problema aberto e o reembolso incerto ou falhado); prazos por omissão de 1, 2 e 7 dias (proposta, **não é lei**) e o prazo legal no reembolso; atribuir a outros só dono e gestor (`tasks:assign`). A peça passa a 2,5–5 pessoas-semana (**C**) | em vigor; código por fazer | Diogo, 11/10/2026: *«sim, aprovo o desenho com as sete filas»* | [`docs/33`](33-tarefas-das-filas.md) |
| ✅ DX | Notificações: o Eurolify envia e-mails por **SMTP** a partir de uma fila na base, começando pelo aviso do prazo do reembolso aos donos e gestores (sem dados do cliente, PT/ES/EN, repetições e «falhada» visível); fornecedor **OVH E-mail Pro** por agora (mantém o fornecedor único, ADR-0032); o serviço transaccional decide-se antes dos e-mails ao cliente | em vigor; código no pedido #373 | Diogo, 11/10/2026: *«aprovado, com a A»* | [`docs/34`](34-notificacoes.md) |
| ✅ DY | Peça 22 da Fase 1, as **vendas do dia e do mês**: uma consulta da API (`GET /sales/summary`, e a mesma no Hub) com quatro números — encomendado, pago, faturado e devolvido —, cada um com e sem IVA (lido, nunca recalculado; o que não se sabe fica em `sem_iva_por_conhecer`, nunca estimado), por canal e mercado, no fuso do comerciante, sem somar moedas e com a frase do que conta. **Q1** um âmbito novo `sales:read`, no dono e no gestor; **Q2** o encomendado conta as encomendas que depois se cancelaram, com `das_quais_canceladas` à parte; **Q3** sem limite para trás até a medição dizer o contrário | aprovada; código por fazer | Diogo, 12/10/2026: *«aprovado»* | [`docs/35`](35-vendas-do-dia-e-do-mes.md) |
| ✅ DZ | Documentos fiscais, parte 2 (fatia 10): o **adaptador Moloni** desenhado no `docs/29` §13 aprovado com as oito propostas — **M1** a conta de Developer do Moloni é da Luckytarget, em nome do Eurolify, e cada comerciante autoriza pelo `authorization_code`; **M2** o artigo de cada linha procura-se pela referência exacta = SKU e, se não existir, o Eurolify cria-o sem gestão de stock (mais de um → retém; nunca pelo nome; os portes no artigo da ligação); **M3** o cliente procura-se pelo NIF (mais de um → retém) e cria-se se não existir; sem NIF, o cliente «Consumidor final» da ligação (**C**, V9); **M4** `price = base / quantidade` e um cêntimo de diferença no cabeçalho é divergência até ao V6; **M5** fatura até ao V1; **M6** só euros; **M7** notas de crédito pelo Moloni fora desta parte até se medir o `related_id`; **M8** o modo real continua fechado | aprovada; código em pedido (migração 0069, `docs/29` §14); nada medido na conta trial (credenciais fora do ambiente a 12/10/2026) | Diogo, 12/10/2026: *«sim, aprovo o desenho com as propostas M1 a M8»* | [`docs/29`](29-documentos-fiscais.md) §13 |
| ✅ EA | Documentos fiscais: a saída **«emitida fora do Eurolify»** (`docs/29` §15) aprovada — uma fatura retida com `emissor_por_configurar`, de uma encomenda paga antes da escolha cuja entidade escolheu depois o **sistema próprio**, passa pelo dono a um estado final `fora`, com motivo e o **número declarado** do documento no sistema próprio (não é prova); a NC já pedida também passa a `fora` e um reembolso dessa encomenda deixa de pedir NC. **Q-F1** só o dono (`invoices:accounts`); **Q-F2** o número é obrigatório; **Q-F3** o relatório OSS não as conta nos baldes mas lista-as à parte (**C**, contabilista) | aprovada; código por fazer | Diogo, 12/10/2026: *«sim, aprovo o desenho com as propostas Q-F1 a Q-F3»* | [`docs/29`](29-documentos-fiscais.md) §15 |
| ✅ EB | Notificações: o **aviso de um caso vencido** das tarefas das filas (`task.overdue`) passa a e-mail, pela fila do DX. **Q12 A:** vai à pessoa responsável pelo caso; sem responsável, aos donos e gestores que podem decidir a fila (na `pagamento`, só os donos). A fila `prazo_reembolso` fica com os e-mails que já tem; sem dados do cliente nem o motivo livre; cancela-se no envio se o caso já não esperar ou a pessoa já não puder receber; o T10 do `docs/17` alarga-se ao armazém e ao apoio responsáveis de uma livre resolução | aprovada; em código (migração 0071) | Diogo, 12/10/2026: *«A, aprovado»* | [`docs/34`](34-notificacoes.md) §12 |
| ✅ EC | **Desenvolver primeiro:** o contabilista, o jurista e o seguro tratam-se quando o desenvolvimento da Fase 1 terminar. **Usa-se sempre o repositório `eur-lex`** como fonte das regras da UE e de Portugal (o artigo lido e citado com a versão). O que tem de acontecer antes do primeiro comerciante de fora não muda (`docs/05`). **Os 3 meses de vendas do critério de passagem da Fase 1 contam só com a loja piloto do grupo** | em vigor; o prazo das validações por estimar | Diogo, 12/10/2026: *«Quando terminarmos tudo, tratamos do contabilista do jurista e do seguro. o objetivo é focarnos no desenvolvimento conforme o plano»*; *«só com a loja piloto do grupo»* | [ADR-0045](adr/0045-desenvolver-primeiro-validar-no-fim-com-o-eur-lex.md) |
| ✅ ED | Envios (fatia 9, parte 2; peça 9 da Fase 1): o desenho do `docs/36` aprovado com as oito propostas — **Q1** CTT primeiro, em modo teste; **Q2** Sendcloud a seguir, depois de verificar onde trata os dados; **Q3** o preço dos portes é do comerciante; **Q4** etiqueta incerta, perdida, devolvida e encomenda parada vão para a fila «problema» da peça 21, sem fila nova; **Q5** pontos de recolha na parte 3; **Q6** embalagem por omissão por armazém e um volume por expedição; **Q7** o ficheiro da etiqueta apaga-se 30 dias depois de a expedição acabar; **Q8** nenhum método se apresenta como «respeitador do ambiente» | em vigor; parte A no código (migração 0074, #397); parte B no código (migração 0079, #400), sem o adaptador real dos CTT; parte C (Sendcloud, modo teste) no código (migração 0080, #406, `docs/36` §16); ligada na VPS de ensaio (#423, §17); a encomenda parada da Q4 no código (migração 0085, §18, #426); corrigir o peso e mudar o serviço no código (0086, §19, #429); o aviso da tentativa falhada em pedido (0087, §20) | Diogo, 12/10/2026: *«sim, aprovo; avança com a parte A»* | [`docs/36`](36-envios.md) |
| ✅ EE | Tarefas das filas: um **pedido de livre resolução `pendente`** (no prazo, mas a devolução não abriu) **não avisa antes** do prazo legal, só quando passa (`task.overdue`, R6); um aviso antecipado empurraria o comerciante a reembolsar antes de receber os bens, que a Directiva 2011/83/UE, art. 13.º, n.º 3, lhe permite reter (`eur-lex`, versão consolidada 02011L0083-20260927; **C**, J4) | em vigor; o código já faz assim | Diogo, 12/10/2026: *«A»* | [`docs/33`](33-tarefas-das-filas.md) R6 |
| ✅ EF | Documentos fiscais, parte 3: o **relatório OSS** (`docs/37`) aprovado — os montantes só das provas, o balde da decisão de IVA copiada, o Estado-Membro de consumo = o país de entrega, NC a negativo, fecho com fotografia congelada e registos do art. 63.º-C do Reg. 282/2011 em CSV. **Q-O1** o período pela data do documento (**C**); **Q-O2** a NC no período da data dela, a negativo, no país e taxa da fatura, e numa fatura de um período fechado é alteração (**C**); **Q-O3** cinco baldes (as «outras isentas» à parte); **Q-O4** só o dono fecha, não fecha com divergentes, outra moeda ou «por emitir» por ver, não se reabre; **Q-O5** as vendas com sistema próprio numa lista à parte. **P1-B** (2.ª revisão do #392): não se fecha um período anterior ao último fechado; o que chega com data anterior a esse fecho é alteração do período seguinte. **P1-A:** um documento que o relatório não classifica sozinho (linhas da prova diferentes das do pedido num `resolvido`, linha sem balde, prova sem data) é classificado uma vez pelo dono — o balde e o país; a taxa e os valores da prova (**C**) | aprovada; código em pedido (migração 0078, `docs/37` §10) | Diogo, 12/10/2026: *«sim, aprovo o desenho com as propostas Q-O1 a Q-O5»*; *«sim, aceito a proposta para o P1-B»*; P1-A: *«aprovado»* | [`docs/37`](37-relatorio-oss.md) |
| ✅ EG | Hub: o ecrã **«Faturação»** (`docs/22` §30) aprovado — a ligação ao emissor por entidade (ligar o Moloni pela autorização dele, testar), o relatório OSS do trimestre (ver, classificar, fechar com autenticação recente, descarregar os registos), por oito rotas `/hub/...` que fazem o mesmo que as da chave; o dono faz tudo, o gestor e o apoio só lêem; o módulo só se liga no ensaio até o contabilista validar o `docs/37` (regras **C**). **Q1 A:** a ligação e os mapas continuam a criar-se pela integração até haver leitura das listas do Moloni | aprovada; código por fazer | Diogo, 12/10/2026: *«sim, aprovo o desenho com a Q1 em A»* | [`docs/22`](22-hub-primeiros-ecras.md) §30 |
| ✅ EH | Ensaio: o **convite de equipa pelo Hub** passa a aceitar só endereços de domínios de teste e do domínio exacto `@eurolify.eu` (caixas da empresa), como já fazia o convite do operador; os outros dão 422 `invite.email_not_allowed` antes da base. Rede temporária até à migração para Paris (no máximo 31/03/2027, ADR-0019) | em código | Diogo, 13/10/2026: *«A»* | [`docs/19`](19-fatia-identidade.md) §6.0 |
| ✅ EI | Hub, Faturação: **criar a ligação ao Moloni e os mapas** (`docs/22` §32) aprovado — o dono cria a ligação de uma entidade e configura a série, as taxas, as isenções, os métodos de pagamento, a língua, o vencimento, a unidade, a categoria, o artigo dos portes e o cliente «Consumidor final», sempre escolhidos de listas lidas do Moloni (sem cópia na base); o Eurolify diz o que falta mapear; ao gravar, o servidor confere cada id contra o Moloni. **Q1 A:** nada vem pré-escolhido; as taxas com o mesmo valor e zona vêm no topo. O contabilista confere os mapas antes do primeiro comerciante de fora (**C**) | aprovada; em código no #412 | Diogo, 13/10/2026: *«sim, aprovo o desenho com a Q1 em A»* | [`docs/22`](22-hub-primeiros-ecras.md) §32 |
| ✅ EJ | Hub, publicar um artigo: numa publicação que **não está à venda** (retirada ou por publicar), ao rever, **nenhuma variante vem marcada**; escolhe-se uma a uma o que volta à venda (a base não marca como fora a variante acrescentada entretanto, e a Q1 diz que nada entra numa loja sem alguém o escolher) | em código (pedido #421) | Diogo, 13/10/2026: *«A»* | [`docs/22`](22-hub-primeiros-ecras.md) §27.5 |
| ✅ EK | Documentos fiscais: **o aviso ao dono quando a ligação ao software de faturação fica com erro** (`docs/29` §18) aprovado — uma fila nova `ligacao_faturacao` no «A decidir» (só o dono decide, prazo de 1 dia, proposta) e, **Q1 A**, um e-mail logo aos donos quando a renovação é recusada, um por passagem, além do `task.overdue` ao fim do prazo | aprovada; código no #422 | Diogo, 13/10/2026: *«sim, aprovo o desenho com a Q1 em A»* | [`docs/29`](29-documentos-fiscais.md) §18 |
| ✅ EL | Relatório OSS: **uma prova sem linhas** (que nunca se pode classificar linha a linha) é **declarada à parte** pelo dono, com motivo e, se faltar, a data — sai dos baldes e dos impedimentos, fica numa lista «declarados à parte» no relatório, na fotografia e nos registos, conta nos excluídos do limiar e o valor declara-se à mão a partir do documento (**C**, contabilista) | aprovada; desenho e código no #437 (migração 0089) | Diogo, 13/10/2026: *«sim, aprovo a saída A»*; desenho: *«sim, aprovo o desenho do §11; avança com o código»* | [`docs/37`](37-relatorio-oss.md) §11 |

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

> ⚠️ **Revista a 03/10/2026, mais tarde, pelo Diogo: VPS operada pelo Diogo e
> pelo Bruno, com o Claude a operá-la** (decisões V e W,
> [ADR-0015](adr/0015-alojamento-numa-vps.md),
> [ADR-0016](adr/0016-o-claude-opera-a-vps.md)) — *«o alojamento para uma VPS
> operada por vocês os dois»*. Fica perto da b) abaixo. A recomendação era
> manter a a); a discordância está no ADR-0015. Guia: `11-preparacao-da-vps.md`.

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

> ✅ **Decidido a 06/10/2026 pelo Diogo: a)**
> ([ADR-0037](adr/0037-faturas-por-software-certificado.md)). O texto abaixo
> fica como registo das opções.

| Opção | O que quer dizer |
|---|---|
| **a) Adaptadores a software certificado de cada país** ⭐ | Em Portugal o Moloni (e outros); em Espanha um software Verifactu; em França uma Plateforme Agréée. O Eurolify decide o IVA e guarda a prova; o documento legal é do software certificado |
| b) Certificar o próprio Eurolify junto da AT (e equivalentes) | Controlo total; custo, prazo e responsabilidade legal por país |

**Recomendação: a)** nas Fases 1 a 3. Reavaliar a b) com números de clientes.
**Quem decide:** Diogo ou Bruno.

### D-5 · Pagamentos

> ✅ **Decidido a 06/10/2026 pelo Diogo: nunca recebe o dinheiro**
> ([ADR-0038](adr/0038-o-eurolify-nunca-recebe-o-dinheiro.md)).

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

> ✅ **Decidido a 06/10/2026 pelo Diogo: alojado**
> ([ADR-0039](adr/0039-checkout-alojado-pelo-eurolify.md)).

**Recomendação: alojado** (com o aspecto da loja, no domínio da loja). Um
frontend gerado por IA não é sítio para decidir IVA, aceitar condições ou
mostrar o botão de livre resolução. API de checkout própria só na Fase 3 e com
verificação.

### D-8 · Estilo da API

> ✅ **Já decidida com o ADR-0025** (Diogo, 04/10/2026): o ADR das ferramentas
> do código parte da recomendação abaixo — REST com OpenAPI 3.1 — e o código
> segue-a desde o #106 (`docs/18`). Registado a 06/10/2026, sem pergunta nova.

**Recomendação: REST com contrato OpenAPI 3.1**, webhooks assinados e SDK
TypeScript. É o que os construtores de frontends com IA e os modelos com
chamada de funções leem melhor. GraphQL só com necessidade medida.

### D-9 · IA

> ✅ **Decidido a 06/10/2026 pelo Diogo: só ler na Fase 1**
> ([ADR-0040](adr/0040-ia-so-le-na-fase-1.md)).

**Recomendação:** MCP de **leitura** na Fase 1; escrita com confirmação humana
na Fase 3; protocolos de comércio por agentes (UCP, ACP) na Fase 3. **Nunca**
uma IA emite faturas, reembolsa, funde clientes ou corrige em lote.

### D-10 · Um cliente que já tem sistema de gestão: quem emite as faturas?

> ✅ **Decidido a 06/10/2026 pelo Diogo: continua o sistema dele**
> ([ADR-0041](adr/0041-com-sistema-de-gestao-emite-o-sistema-dele.md)).

**Recomendação: continua a ser o sistema dele.** O Eurolify entrega-lhe as
encomendas como o Shopify faz hoje, e esse sistema continua a ser o único que
fala com o software de faturação — é a regra do Hub interno actual («um só
sistema fala com o Moloni»), e evita dois emissores para a mesma venda. Passar
a emissão para o Eurolify é uma decisão posterior, cliente a cliente, com o
Eurolify já provado. **Quem decide:** Diogo ou Bruno.

### D-11 · Ponte para a memória de trabalho existente

> ✅ **Decidido a 06/10/2026 pelo Diogo: não** — *«O Eurolify é um projeto
> totalmente separado»*. Nada se escreve no `bruno-88/claude`.

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
> 12 a 23 meses, ≈ 193.000–519.000 € *(recalculados a 04/10/2026 com a
> decisão AD e o alojamento da construção na OVH: B 18 a 34 meses,
> ≈ 187.000–506.000 €; C 13 a 25 meses, ≈ 208.000–565.000 €)*; **A** — só o Diogo e o Bruno com Claude
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
>
> ✅ **Quando (03/10/2026, Diogo, decisão S,
> [ADR-0012](adr/0012-precos-da-d14-antes-da-peca-13.md)):** os preços têm de
> estar decididos antes da peça 13 da Fase 1, não antes do código.

Mensalidade, percentagem das vendas, módulos pagos, instalação dedicada — **não
estudado**. Com a D-1 → a) (vender desde o início, ADR-0006), **passa a ser
preciso antes da Fase 1**.
