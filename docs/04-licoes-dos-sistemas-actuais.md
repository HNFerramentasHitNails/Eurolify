# O que os sistemas actuais já pagaram — e como entra no Lumavo

> **Versão de 03/10/2026.** Os sistemas que a Luckytarget já usa todos os dias —
> um Hub interno de gestão, uma loja online sobre o Shopify e uma plataforma de
> formação — são, na prática, **a especificação dos problemas** que o Lumavo
> tem de resolver de raiz. Cada regra abaixo custou uma fatura errada, uma nota
> de crédito, horas de trabalho ou um cliente ao telefone.
>
> **Fonte:** a memória de trabalho do Bruno (repo `bruno-88/claude`), lida a
> 03/10/2026; cada linha indica o ficheiro. Os números têm a data em que foram
> medidos lá e **não foram medidos outra vez nesta sessão**. Nomes de clientes e
> números de documentos foram retirados de propósito.
>
> 🔴 **O Lumavo herda as REGRAS, não o CÓDIGO.** A tentativa de vender o Hub
> interno a outra empresa (30/09/2026) mediu que tem a marca e as regras de uma só
> empresa escritas em 92 ficheiros do ecrã e 51 funções, **nunca foi instalado de
> raiz noutra conta** (1.601 migrações, 225 funções) e tinha **77 funções da base
> chamáveis sem sessão, 24 delas a escrever** (18/09/2026) —
> `proposta-venda-do-hub-30set2026.md`.

---

## 1. Identidade e perfis de faturação

| # | Regra | O caso que a pagou | Fonte | No Lumavo |
|---|---|---|---|---|
| 1.1 | **A ficha do cliente não tem identidade fiscal.** NIF, isenção e validação VIES vivem no **perfil de faturação**: um cliente, vários perfis | O NIF saiu da ficha para o perfil a 06/08/2026; a 11/09 ainda havia **4 sítios** a ler a ficha, um a mandar o NIF errado ao Shopify | `CLAUDE.md` do Hub interno («Não se erra em documentos fiscais») | `Customer` e `BillingProfile` separados desde o primeiro dia; nenhum campo fiscal em `Customer` |
| 1.2 | **Um perfil é a mesma pessoa noutra postura fiscal; duas pessoas são duas fichas** | Um cliente comprou um bilhete para outra pessoa e o checkout criou um perfil com o NIF dessa pessoa **dentro** da ficha de quem comprou; o rascunho fiscal apontava à entidade errada (12/08/2026) | `identidade-comprou-para-outra-pessoa-12ago2026.md` | O checkout tem «a fatura é para outra pessoa/empresa» e nunca escreve dados de terceiros no perfil de quem está autenticado |
| 1.3 | **Cada compra liga a UM perfil**, escolhido por uma via conhecida | Regra do Bruno (05/08/2026) | `desenho-ecossistema-bruno.md` | `Order.billing_profile_id` obrigatório e imutável depois de emitida a fatura |
| 1.4 | **Identidade: NIF igual = a mesma; email ou telefone igual = talvez (uma pessoa decide); nunca pelo nome** | 26 pares propostos por um sinal inventado; um mesmo telefone usado por 4 pessoas diferentes (10/08/2026) | `regras-identidade-duplicados.md` | Detector de duplicados com estes três sinais e mais nenhum; fusão sempre humana |
| 1.5 | **Nunca deixar o sistema escolher sozinho o registo «melhor»** | Regra do Bruno para toda a gente | `CLAUDE.md` do Hub interno | Fusões e conflitos vão para uma fila com decisão humana |
| 1.6 | **Guardar ≠ comparar** — o NIF guarda-se como a lei manda e compara-se pelo número | A régua de comparar «comia» o `CHE` suíço ao gravar ⇒ **2.325 perfis duplicados** e 3 faturas com um contribuinte inexistente (16/09/2026) | `nif-guarda-se-como-a-lei-manda-16set2026.md` | Duas funções com nomes diferentes: `nif_legal` (guardar) e `nif_comparavel` (identidade) |
| 1.7 | **O NIF leva o prefixo fiscal do país, excepto o país do comerciante**; o que a pessoa escreveu com prefixo mantém-se; o prefixo fiscal **não** é o ISO (`CHE`, `EL`) | Ordem do Bruno a 16/09/2026; 942 perfis mudaram de forma e **zero** de identidade | `nif-com-codigo-executado-16set2026.md` | Régua `nif_com_codigo` no motor de identidade fiscal |
| 1.8 | **O país da morada não é o país do contribuinte** | Um perfil com NIF português e morada no Luxemburgo ia ficar `LU…` — um contribuinte que não existe | `nif-guarda-se-como-a-lei-manda-16set2026.md` | O perfil tem `pais_do_contribuinte` separado de `pais_da_morada` |
| 1.9 | **Validar o dígito de controlo não chega** | `000000000` e `123456789` passam o dígito de controlo; uma encomenda saiu com a entidade fiscal de outra pessoa (30/09/2026) | `nif-000000000-neuza-5414-30set2026.md` | Lista de números impossíveis por país, no servidor |
| 1.10 | **Contribuinte recusado retém; não sai como consumidor final** | 6 faturas saíram `999999990` a quem tinha dado o número (22/07 → 04/09/2026) | `contribuinte-recusado-retem-17set2026.md` | Estado `retida` com motivo e três saídas humanas |

## 2. IVA e documentos fiscais

| # | Regra | O caso | Fonte | No Lumavo |
|---|---|---|---|---|
| 2.1 | **A ordem da decisão do IVA:** 1.º o tipo de artigo (isento pelo artigo ganha a tudo); 2.º excepções — manual, VIES, fora da UE; 3.º o resto paga — taxa nacional ou do destino (OSS); 4.º **entrega no país do comerciante anula VIES e fora da UE, mas não a isenção manual** | A regra estava escrita duas vezes, as cópias divergiram na ordem e uma encomenda saiu com IVA com o ecrã a mostrar «s/ IVA» (13/08/2026) | `regra-isencao-iva-bruno.md` | Uma função de decisão de IVA no servidor, com testes por cada ramo |
| 2.2 | **A isenção manual é absoluta, mas exige prova** (ex.: declaração da alfândega) | Cliente suíço com transportadora própria recebe em Portugal e a mercadoria sai do país (13/08/2026) | `regra-isencao-iva-bruno.md`; `excepcoes-de-isencao-e-anexos-28set2026.md` | Isenção manual com motivo (art. 14.º CIVA / RITI), nota, anexos e quem a pôs |
| 2.3 | **Uma intracomunitária só é isenta com NIF válido no VIES** | 7 faturas intra-UE isentas sem NIF, 3.773,09 € (21/04 → 30/07/2026, número corrigido a 28/09) | `desenho-ecossistema-bruno.md`; `canarias-ceuta-melilla-extra-ue-28set2026.md` | Trava no servidor; a prova do VIES (data, resposta, identificador da consulta) guarda-se com a decisão |
| 2.4 | **Territórios fora do IVA da UE** decidem-se pelo código postal, nunca por «contém» | «Palma de Mallorca» cairia nas Canárias por «la palma» (28/09/2026) | `canarias-ceuta-melilla-extra-ue-28set2026.md` | Tabela de territórios especiais por país + código postal |
| 2.5 | **Se foi cobrado IVA, a fatura leva IVA** — a isenção do cliente nunca passa por cima do que foi cobrado | Cliente suíço pagou 67,05 € de IVA e a fatura ia sair sem IVA (05/08/2026) | `desenho-ecossistema-bruno.md` | A fatura nasce do que foi cobrado no checkout, não de um novo cálculo |
| 2.6 | **A prova do que saiu é o documento**, nunca o nosso registo | 13 faturas (2.656,04 €) saíram como consumidor final tendo nós o NIF — a nossa tabela guardava a **intenção** (12/08/2026) | `hub-nif-sai-da-entidade-moloni-12ago2026.md` | Depois de emitir, o Lumavo lê de volta o NIF, a taxa e os totais **do documento** e guarda-os à parte |
| 2.7 | **A taxa é por país; um nome de taxa não serve para ler o passado** | Uma taxa chamada «VAT PT» serviu Espanha a 21 % durante meses; editar a taxa no software de faturação **não é retroactivo** (10/08/2026) | `oss-iva-por-pais-10ago2026.md` | Chave (país, taxa); o documento guarda um retrato da taxa no momento |
| 2.8 | **O relatório OSS tem quatro baldes**: OSS, nacional, exportação, isentas (recapitulativa) | Ia-se declarar 1.346 € de IVA português no impresso errado (10/08/2026) | `oss-iva-por-pais-10ago2026.md` | Relatório com os quatro baldes, agrupado pelo **país de entrega** |
| 2.9 | **Os totais que fecham ao cêntimo são os do cabeçalho do documento** | Somar linhas perdia cêntimos (15,45 € contra 15,47 € numa fatura a 21 %) | `oss-iva-por-pais-10ago2026.md` | Guardar os totais devolvidos pelo emissor, não recalculados |
| 2.10 | **Nunca reenviar ou corrigir em lote**; o rascunho fiscal só nasce depois de confirmado o pagamento | Decisão do Bruno a 05/08/2026, perante uma proposta de reenviar 66 faturas | `desenho-ecossistema-bruno.md` | Filas com decisão linha a linha; nenhum «aplicar a todos» em documentos fiscais |
| 2.11 | **Uma rede temporária tem data de fim escrita** | «Sem perfil, usa a ficha» ficou um mês e levou **277 faturas em 90 dias** (11/09/2026) | `CLAUDE.md` do Hub interno | Toda a excepção temporária no código tem data de expiração e um alarme |
| 2.12 | **Nota de crédito tem duas saídas**: troca (encontro de contas) ou carteira (carregamento faturado; uso = desconto) | Regra do Bruno, 28/09/2026 | `regra-da-nc-e-da-carteira-28set2026.md` | Modelar as duas saídas; ⚠️ o tratamento fiscal da carteira tem de ser validado por contabilista |
| 2.13 | **Uma NC parcial não risca a fatura toda** | 134 casos, 95.858,54 € (10/09/2026) | `nc-parcial-risca-a-factura-toda-10set2026.md` | Estado da fatura calculado pelo saldo, não por «tem NC» |

## 3. Stock, encomendas e devoluções

| # | Regra | O caso | Fonte | No Lumavo |
|---|---|---|---|---|
| 3.1 | **Vender o disponível, não o físico** | A loja vendeu 2 coleções já prometidas a uma encomenda comercial; **216 de 1.259** artigos à venda nessa situação (16/09/2026) | `loja-vendeu-stock-ja-reservado-16set2026.md` | Um só número de disponibilidade por canal, com reservas de todos os canais |
| 3.2 | **Saldo e movimento andam juntos** — uma porta para mexer no stock | Nada obrigava os dois a concordar; baixas a dobrar em Abr–Mai (145 encomendas) | `mapa-da-cadeia-do-stock-18set2026.md`; `proposta-venda-do-hub-30set2026.md` | O stock só muda por movimento no livro de stock |
| 3.3 | **Kits e coleções derivam dos componentes** | 72 de 72 compostos batiam com os componentes por gatilho (16/09/2026) | `loja-vendeu-stock-ja-reservado-16set2026.md` | `Bundle` com disponibilidade derivada |
| 3.4 | **Lote para conseguir recolher** | O lote estava no passo 1 de 4; componentes dos kits (40 % das saídas) saíam sem lote | `proposta-venda-do-hub-30set2026.md` | Lote/série no movimento de stock e na linha expedida (GPSR: recolhas) |
| 3.5 | **Devolução = volta mercadoria ao armazém; problema = não volta** | 91 notas de crédito em 90 dias, **0** devoluções registadas e **0** movimentos de devolução em 44.431 (15/09/2026) | `devolucoes-nao-tem-fluxo-15set2026.md` | RMA ligado à NC, com o **estado do artigo** (cosmética aberta não volta a stock) |
| 3.6 | **Portes não se cobram duas vezes** | 12 encomendas e 150,43 € a mais (16/09/2026) | `portes-a-dobrar-16set2026.md` | Portes como linha própria, nunca como artigo |
| 3.7 | **A etiqueta tem de bater com o serviço cobrado** | Etiqueta dos CTT saiu Via Aérea com Via Marítima cobrada (17/09/2026) | `etiqueta-ctt-aerea-em-vez-de-maritima-17set2026.md` | O serviço de transporte escolhido no checkout é o que vai para a transportadora |
| 3.8 | **Ordens de compra não são despesas** | Uma ordem de compra é intenção; 0 de 85 tinham data de pagamento; dólares lidos como euros (22–23/09/2026) | `CLAUDE.md` do Hub interno | Compras e contabilidade em domínios separados |

## 4. Integrações e falhas silenciosas

| # | Regra | O caso | Fonte | No Lumavo |
|---|---|---|---|---|
| 4.1 | **«Não encontrei» nunca é «feito»** | Um sistema respondia `200 not_found` e o outro registava «apagado»; 211 arquivamentos sem rasto porque a tabela de registo **nunca foi criada** (18/09/2026) | `CLAUDE.md` do repo `claude` | Respostas da API com estado explícito; registo de integrações obrigatório |
| 4.2 | **Um aviso (webhook) que falha não pode responder 200** | Uma mudança de versão da API do Stripe fez as renovações desistirem em silêncio com 200: **0 transacções** registadas e 14 de 22 subscrições paradas (07/08/2026, projecto Cila Santos) | `cila-renovacoes-stripe-07ago2026.md` | Versão da API do fornecedor fixada e testada; falha ⇒ 5xx e reenvio; alarme |
| 4.3 | **Guardar o que chegou em bruto** | De 3.744 encomendas vindas do Shopify só 1.002 tinham registo em bruto (27 %) — houve que reconstruir casos por efeitos (16/09/2026) | `nif-guarda-se-como-a-lei-manda-16set2026.md` | Caixa de entrada de eventos com o corpo original, retida pelo prazo legal |
| 4.4 | **O mesmo pedido duas vezes não conta duas vezes** | Um botão de importação creditou a carteira de um cliente 5 vezes (415,05 € em vez de 83,01 €, 16/09/2026) | `carteira-fanonyx-creditos-a-quintuplicar-16set2026.md` | Chave de idempotência em todas as escritas da API |
| 4.5 | **O estado viaja: quem cancela avisa o centro, o centro distribui** | Um cancelamento que ficava num sistema deixava o rascunho fiscal vivo noutro (18/09/2026) | `CLAUDE.md` do repo `claude` | Eventos de domínio com outbox; nenhum sistema ligado fala com o emissor de faturas por fora |
| 4.6 | **Um CHECK esquecido rejeita valores novos** (`23514`) | Inserções rejeitadas e ninguém verificava o erro (projecto Cila Santos; agentes do Hub interno) | `agente-estrategia-check-14ago2026.md` | Listas de valores num sítio só e erros nunca engolidos |
| 4.7 | **Não cortar listas em silêncio** | O «corte das 1.000» fez a pesquisa dizer «não existe» a 40 % das fichas (12/08/2026) | `academy-pesquisa-perfis-cortada-12ago2026.md` | Paginação por cursor obrigatória e total explícito |
| 4.8 | **Nunca contar no browser o que as permissões filtram** | «Não vejo» virou «não há» várias vezes | `regra-decisao-no-servidor.md` | Contagens só no servidor |
| 4.9 | **Uma regra usada em dois sítios vive no servidor** | Isenção de IVA (regra 2.1), permissões copiadas 4 vezes (43 pessoas barradas) | `regra-decisao-no-servidor.md` | **A API é o servidor.** Os frontends feitos em Lovable/Vercel/Bolt nunca decidem preço, IVA nem quem pode o quê |
| 4.10 | **Horas em UTC, mostradas na hora local** | Um agendamento recuava 1 h por cada gravação (15/09/2026) | `agendamento-banner-hero-loja-15set2026.md` | Datas sempre com fuso; testes com mudança de hora |
| 4.11 | **Moeda e câmbio guardados com a data** | Uma despesa de 14.505 USD guardada como euros (23/09/2026) | `CLAUDE.md` do Hub interno | Valor + moeda + taxa de câmbio + data em todos os montantes |
| 4.12 | **Editar não é publicar** | Editar uma função não a põe no ar; o push não a põe no ar; um ficheiro partilhado obriga a redeployar todos os que o usam (16/09/2026) | `CLAUDE.md` do Hub interno; `nif-guarda-se-como-a-lei-manda-16set2026.md` | Integração contínua: cada alteração testada e publicada pelo mesmo caminho |
| 4.13 | **Segurança fechada por omissão** | 77 funções abertas a quem não tem sessão, 24 a escrever (18/09/2026) | `proposta-venda-do-hub-30set2026.md` | Tudo fechado por omissão; teste automático que falha se algo nascer aberto |

## 5. Shopify — onde se sente o limite

| # | O que se mediu | Fonte |
|---|---|---|
| 5.1 | A lista de isenções do Shopify tem **74 valores** e só **1** serve a uma loja portuguesa; **não existe** isenção de exportação (art. 14.º CIVA) | `desenho-ecossistema-bruno.md` (05/08/2026) |
| 5.2 | O NIF do campo de IVA intra-UE só aparecia no **texto de um evento** da encomenda («Reverse charge was applied. A valid VAT number: ES… was provided») | `desenho-ecossistema-bruno.md` (05/08/2026); ⚠️ a 17/09 descobriu-se o campo `customer.taxSettings.taxId` na versão 2026-07 da API (`campo-nif-do-shopify-nao-chega-17set2026.md`) |
| 5.3 | Para vender noutros países foi preciso construir um **duplicador de lojas Shopify** (loja mãe → lojas destino) | código da loja online actual, lido a 03/10/2026 |
| 5.4 | A plataforma de formação está a preparar a saída do Shopify para a **EuPago** e a **Stripe**, com um interruptor no servidor; a Klarna representou **58 pagamentos e 28.305 €** em 90 dias | `academy-pagamento-directo-mapa-29set2026.md`; `academy-piloto-eupago-desenho-29set2026.md` |
| 5.5 | O preço vivia em **3 sítios** (Hub interno, plataforma de formação, Shopify) | `academy-pagamento-directo-mapa-29set2026.md` |

## 6. IA

| # | Regra | O caso | Fonte | No Lumavo |
|---|---|---|---|---|
| 6.1 | **Uma ferramenta de IA devolve um índice, não o catálogo inteiro** | O assistente interno gastava **185 mil tokens por conversa**, 70 % no catálogo enviado inteiro; passou a 28 mil (15/09/2026) | `estrela-gasta-185-mil-tokens-por-conversa-15set2026.md`; `estrela-fase1-catalogo-fora-do-prompt-15set2026.md` | As ferramentas MCP do Lumavo devolvem páginas pequenas e procuras, nunca dumps |
| 6.2 | **Uma régua corre sozinha e avisa; um agente responde a quem pergunta** | 5 funções abertas criadas em 6 dias, nenhuma apanhada por um agente (21/09/2026) | `agentes-e-skills-no-repo-21set2026.md` | Vigilâncias são consultas agendadas, não IA |
| 6.3 | **Créditos de IA esgotam** | O assistente interno ficou em baixo a 15/09/2026 por falta de créditos | `estrela-fase3-bloqueada-creditos-15set2026.md` | Orçamento de IA por comerciante, com tecto e aviso |

---

## O que ficou por verificar

- Os números acima **não foram medidos de novo**: vêm das memórias, com a data
  de lá. Se algum for citado a um cliente, mede-se outra vez.
- Não li por inteiro todas as memórias citadas; li as que são regra e as de
  maior impacto, e conferi os números das outras por procura no ficheiro.
