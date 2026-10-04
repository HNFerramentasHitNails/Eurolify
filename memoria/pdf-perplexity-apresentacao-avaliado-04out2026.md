# O PDF «Apresentação de Projeto» gerado pelo Perplexity — avaliado (04/10/2026)

**Pedido do Diogo (04/10/2026):** *«VERIFICA O QUE PODES ADICIONAR À
APRESENTAÇÃO DO BRUNO E CILA COM ESTE PDF GERADO PELO PERPLEXITY»*
(`Eurolify___Apresenta__o_de_Projeto_PDF.pdf`, 14 páginas, 49,3 KB). Depois da
avaliação: *«sim»* — fazer a versão 18 da apresentação e registar aqui.

## O que se fez

- Li as 14 páginas e comparei-as com `docs/00`, `02`, `03`, `05`, `06`, `09`,
  `10`, os ADR, a memória e a apresentação publicada (versão 17).
- Conferi os números e os programas nas fontes (lista abaixo, com o que foi
  lido directamente e o que foi por resumo).
- Levei à apresentação o que passou (versão 18,
  [[apresentacao-bruno-cila-03out2026]]): a página do mercado (9), a do
  financiamento (54) e a Dir. (UE) 2024/2853 na página 7.
- **O PDF não vai para o repositório** (é de fora, binário e com erros) e
  **não se envia a financiadores como está**: descreve como existente um
  produto que ainda não tem código (o OK para código só foi dado a 04/10/2026,
  ADR-0023) e diz «conforme» e «a única plataforma».

## Veredicto, por secção do PDF

| Secção do PDF | O que se fez com ela |
|---|---|
| Mercado (447 M consumidores, 757 mil M€, 27 M PME) | Corrigida e levada (página 9) — números abaixo |
| Financiamento (EIC, Portugal 2030, Europa Digital, Horizonte, InvestEU) | Levada em parte (página 54), com a condição do EIC que hoje nos exclui |
| Regulamentos (tabela de 18) | Já estavam quase todos no `docs/03`; levada só a Dir. 2024/2853 à página 7 |
| Arquitectura: microserviços, Kubernetes, AWS/Hetzner, GraphQL | **Não entra**: monólito modular (`docs/02` §3), VPS da OVH (ADR-0015, ADR-0021), REST e OpenAPI (D-8) |
| Gestão de vendedores, marketplace no plano de 299 € | **Não entra**: marketplace só na Fase 4, com caso de negócio |
| Planos 29/99/299 € por número de lojas; taxa de 1,5–2 % sobre as vendas | **Não entra**: escalões por vendas anuais e sem taxa sobre cada venda (ADR-0007); preços antes da peça 13 (ADR-0012) |
| MVP em 6 meses; 1,8 M€ com 800 mil € para engenharia; equilíbrio aos 24 meses | **Não entra**: Fase 1 de 17 a 32 meses (`docs/10` §9); o Diogo e o Bruno desenvolvem, sem contratar (ADR-0008); o 1,8 M€ não tem contas |
| Verificação anti-branqueamento de vendedores | **Não entra**: o Eurolify nunca recebe o dinheiro dos comerciantes (D-5) |
| Fatura electrónica emitida pelo Eurolify | **Não entra**: software certificado de cada país (recomendação da D-4) |
| «Residência de dados garantida» | **Não entra assim**: o ensaio está no Reino Unido até 31/03/2027 (ADR-0018, ADR-0019) |
| Auditorias e certificação como receita | **Não entra**: o Eurolify não substitui o contabilista nem o jurista (`docs/00` §3) |
| Comparação com o Shopify (DAC7, GPSR, AI Act «não disponível») | **Não entra**: nenhuma linha tem fonte; o DAC7 só se aplica a quem liga vendedores a compradores |

## Erros do PDF (conferidos)

- **Anti-branqueamento:** o regulamento é o Reg. (UE) 2024/1624 (AMLR); o
  2024/1620 que o PDF dá é o que cria a autoridade (AMLA). Aplica-se a
  10/07/2027 (EUR-Lex e DLA Piper, por resumo).
- **EuroStack:** é a proposta de um relatório da Bertelsmann Stiftung
  (fevereiro de 2025, coordenado por Francesca Bria), com ≈ 300 mil M€ em 10
  anos; não é um programa da UE nem tem fundos (resumo de pesquisa).
- **«A única plataforma… construída na Europa»:** falso — Shopware (Alemanha)
  e PrestaShop (França) (`docs/00` §4, página 38 da apresentação).
- **Os números de mercado** estão fora de contexto (abaixo).

## Números (com data e como se contaram)

Todos lidos a 04/10/2026.

| Número | Pergunta a que responde | Fonte e como se leu |
|---|---|---|
| **450,4 M** | Habitantes da UE a 01/01/2025 | Notícia do Eurostat de 11/07/2025, lida directamente |
| **72 %** | Pessoas dos 16 aos 74 anos na UE que compram bens ou serviços online, 2025 | European E-commerce Report 2026 (Ecommerce Europe e EuroCommerce, versão resumida, criada a 18/09/2026), p. 11 — PDF descarregado e lido com `pdftotext` |
| **757,3 mil M€** | Vendas online a consumidores na UE-27 **previstas para 2026** | Mesmo relatório, p. 11 |
| **842 → 911 mil M€** | Vendas online a consumidores na Europa (38 países), 2024 → 2025 | Mesmo relatório, p. 6 |
| 447,7 M | População da UE-27 em 2021 e 2022 no gráfico do relatório (fonte deles: Banco Mundial e ONU) | Mesmo relatório, p. 11 — é daqui, ou de parecido, que vem o «447M» do PDF |
| 26,1 M | PME no sector não financeiro da UE em 2024 | Relatório anual das PME europeias 2024/2025 (Comissão, JRC), **só por resumo** — o PDF não abriu (certificado do sítio que o tinha falhou; não forcei) |
| < 2,5 M€ e 1–10 M€ | Subvenção e capital do EIC Accelerator; exige TRL 6 a 8 | eic.ec.europa.eu, página do programa, lida directamente |
| 3.900 M€ | Dotação do COMPETE 2030 (2.567 Competitivo, 815 Verde, 400 Social) | compete2030.gov.pt, lida directamente; as regiões não estão na página |
| 1,3 mil M€ | Programa de trabalho 2025–2027 do Europa Digital | digital-strategy.ec.europa.eu, notícia de 28/03/2025, lida directamente |

**Correcção minha, a 04/10/2026:** na primeira resposta ao Diogo escrevi que
não tinha encontrado a fonte dos 757 mil M€ nem do 447. Estava errado: os dois
estão na p. 11 do relatório de 2026. Os 757 mil M€ são **uma previsão para
2026 na UE-27**, que o PDF apresenta como valor anual medido. A mesma resposta
dava os 842 mil M€ de 2024 por resumo; o relatório confirma-os (p. 6) e já há
o de 2025 (911 mil M€). Os números só ficaram escritos na conversa; aqui e na
apresentação estão os certos.

**Fora da apresentação, de propósito:**

- o orçamento do EIC para 2026: um resumo diz 634 M€ e outro 414 M€;
- as 26,1 M PME: só por resumo.

## O que ficou por verificar

- **As regiões do COMPETE 2030** (os resumos dizem Norte, Centro e Alentejo) e
  **onde está a sede da Luckytarget** — decide se o programa serve.
- Se o SIFIDE II é renovado para 2027 (`docs/10` §8).
- O papel da ANI, do IAPMEI e da Enterprise Europe Network que o PDF sugere
  como contactos, e o número de telefone da UE que dá.
- As linhas da tabela de regulamentos do PDF que já estavam no `docs/03`: não
  as conferi outra vez. As que não estão lá (ESPR e passaporte digital do
  produto, eIDAS 2 e a carteira europeia, AMLR): ficaram fora, **C**.
- Se o Eurolify deve candidatar-se a financiamento é decisão do Diogo ou do
  Bruno — a página 54 da apresentação tem a caixa para isso.
