# O Hub da empresa inteira: o conhecimento dos dois PDFs do Hub actual, 11/10/2026

## O que se fez

Pedido do Diogo, 11/10/2026 (issue #355): retirar todo o conhecimento da
apresentação (5 páginas) e da proposta comercial (35 páginas, ref. de
30/09/2026) do Hub interno actual, para o Eurolify ter também uma plataforma
de gestão da empresa inteira, não só uma loja.

- Lidos os dois PDFs por inteiro (as 40 páginas como imagem).
- Escrito o `docs/31-hub-de-gestao-da-empresa.md`: o Hub numa página, os seis
  princípios (já são regras do Eurolify), as 15 sequências de trabalho lado a
  lado com o estado do Eurolify, os 32 módulos com domínio e natureza, as
  integrações, o que muda de uma empresa para vários comerciantes, o modelo
  comercial como referência, uma ordem por camadas, os choques com decisões e
  a decisão de âmbito pedida.
- Sem a marca dos sistemas actuais e sem nomes de clientes; o exemplo de lote
  do PDF não se copiou.

- **O balcão (POS) pelas 8 portas** (pedido do Diogo, 11/10/2026, *«passa o
  primeiro módulo pelas 8 portas»*; `docs/13` §7): ◐ ◐ ◐ ❔ ❌ ◐ ❌ ◐ →
  **estreitar e investigar**. O POS já existe em software certificado (o
  Moloni tem uma app de POS; o Vendus vende planos de 9 e 22 €/mês sem IVA);
  falta a ligação ao stock, aos preços e aos clientes do Eurolify. Primeiro
  alvo: a ligação a um POS certificado, que emite ele o documento (como a
  D-10). Antes: ler a API do Moloni e falar com 5 comerciantes com loja física.

- **A API do Moloni lida** (pedido do Diogo, *«sim, lê a API do Moloni»*):
  14 páginas de `moloni.pt/dev` e a da app na App Store, em
  `docs/eurolify/fontes-api-moloni-11out2026.md`. Lêem-se documentos
  alterados desde uma data (50 por pedido) e as linhas um a um; stock por
  artigo e armazém, e movimentos para inserir; sem avisos nem limites
  escritos; token de 1 hora no endereço, renovação de 14 dias. ~~Que a app de
  POS aparece nos documentos: provável, não verificado~~ — testado noutra
  sessão (#360, §8 do ficheiro de fontes): as vendas de terminal vêm com
  `terminal_id`; o stock do Moloni baixa sozinho com cada venda; o token só
  no endereço; o `status` 2 por perceber. Remissão no `docs/29`.

- **Compras e fornecedores pelas 8 portas** (pedido do Diogo, *«passa o
  próximo módulo pelas 8 portas»*; `docs/13` §8): ✅ ◐ ❔ ❔ ❌ ◐ ◐ ◐ →
  **estreitar**. Primeiro alvo: a entrada de stock que já existe passa a
  dizer o fornecedor (NIF com o país) e o documento dele, com o lote; mais o
  aviso de stock abaixo do mínimo. Fora: ordem de compra com estados (o
  Moloni já a tem), Pareto, custo (contabilista, C), despesa (camada D).
  Pergunta 16a acrescentada ao guião.
- **Apoio ao cliente pelas 8 portas** (`docs/13` §9): ◐ ◐ ❔ ❔ ❌ ◐ ◐ ◐ →
  **estreitar**. Primeiro alvo: o pedido de apoio sobre uma encomenda, aberto
  na página da encomenda, com número, estado, responsável e linha do tempo;
  depende do envio de e-mails (que não existe). Fora: formulário público,
  encaminhamento por carteira (camada C). Pergunta 16b no guião.
- **Tarefas sobre um registo pelas 8 portas** (`docs/13` §10): ✅ ◐ ❔ ❔ ❌ ✅
  ◐ ✅ → **estreitar e avançar com o núcleo**. Primeiro alvo: dono, prazo e
  aviso ao vencer nas quatro filas que já pedem uma pessoa (diferenças dos
  pagamentos, documentos retidos, duplicados de clientes, prazo do
  reembolso); **proposta de passar para a Fase 1**, por decidir e estimar.
- **Painéis pelas 8 portas** (`docs/13` §11): ◐ ◐ ❔ ❔ ❌ ✅ ✅ ✅ →
  **estreitar**. Primeiro alvo: vendas do dia e do mês (encomendado, pago,
  faturado, devolvido; com e sem IVA; por canal e mercado), cada número com
  como foi contado; uma consulta para o Hub e para o MCP de leitura da Fase 1
  (proposta: a consulta na Fase 1, o ecrã na 2). Não há rotas de números no
  `main`; o `apps/mcp` é o MCP da VPS. Camada B passada por inteiro.
- **Comercial (camada C) pelas 8 portas** (`docs/13` §12): ✅ ◐ ❔ ❔ ❌ ◐ ◐
  ✅ → **estreitar**. Primeiro alvo: a encomenda feita pela equipa — o
  carrinho preparado para um cliente, com os preços dele, e a ligação do
  checkout alojado (hoje o carrinho só nasce pela API da Loja). Investigar
  com o jurista as chamadas do dia e a carteira (perfis, contacto para
  vender, C) e as comissões (C). Pergunta 16c no guião.
- **Financeiro (camada D) pelas 8 portas** (`docs/13` §13): ✅ ◐ ❔ ❔ ❌ ◐ ◐
  ◐ → **estreitar**. Primeiro alvo: a conciliação das liquidações do
  prestador com o extracto do banco, ligada à fila de diferenças (o `docs/26`
  §1 já a deixava para depois). Investigar: despesas com IA (regra 4, onde
  corre o modelo) e ligação directa aos bancos (serviço regulado? C).
- **Organização (camada E) pelas 8 portas** (`docs/13` §14): ◐ ❌ ❔ ❔ ❌ ◐ ❌
  ◐ → **matar como módulo próprio** (porta 2: projectos, chat, documentos e
  calendário já existem e ligam-se). Os lançamentos agendados vão para o
  Catálogo (não há no `docs/14`); o assistente interno é o MCP de leitura da
  Fase 1. Decisão de matar por tomar (a DR põe a camada no produto).
- **Fabrico (camada F) pelas 8 portas** (`docs/13` §15; a camada F passa
  sector a sector): ✅ ◐ ❔ ❔ ❌ ✅ ◐ ◐ → **estreitar**. Primeiro alvo: a
  versão da fórmula no artigo e no lote (já desenhada na
  `product-compliance-eu`; caso do TPO, 01/09/2025, W), com a consulta do que
  é afectado e o bloqueio decidido por uma pessoa; serve também quem revende.
  Depois, o registo de fabrico mínimo. Fora: programação, Gantt, capacidade.
- **Formação (camada F) pelas 8 portas** (`docs/13` §16): ✅ ◐ ❔ ❔ ❌ ◐ ◐ ◐ →
  **estreitar, pela porta da fatia 12**. Primeiro alvo: a inscrição numa
  formação com data, com o kit na mesma encomenda. O cancelamento faturado dá
  nota de crédito, nunca apaga a fatura (o Hub actual «anula»). Fora:
  plataforma de cursos, prestações (C), comissões (C).
- **Marketing e gráfica (camada F) pelas 8 portas** (`docs/13` §17): ◐ ❌ ❔ ❔
  ❌ ◐ ❌ ◐ → **matar como módulo próprio** (porta 2: ferramentas de redes e
  de projectos já existem). Para o Catálogo: os feeds (já «fica para depois»
  no `docs/14`) e as avaliações de quem comprou (regra W da
  `consumer-rights-eu`). Riscos anotados: alegações ambientais (27/09/2026) e
  dados de redes de fora da UE.
- **O guião das conversas com os comerciantes** (pedido do Diogo, 11/10/2026):
  `docs/32`. 5 comerciantes da UE com loja online e balcão, de fora do grupo;
  27 perguntas em 45 minutos (balcão, gestão da empresa, quanto pagam,
  conhecidos para a porta 4); ficha sem nomes; proposta de critério da porta
  3 (3 dos 5). Base legal e prazo das notas por verificar.

## Números (com data e como se contaram)

- Do PDF, não medidos por mim (proposta p. 4, «contados no próprio código e na
  base de dados a 30 de setembro de 2026»): 32 módulos, +400 ecrãs, +220
  funções no servidor, +500 tabelas, +70 tarefas automáticas.
- Preço proposto a um cliente (proposta p. 33): 80.000 € + IVA, em 30/40/10/10/10 %;
  14 semanas até ao arranque; formação de 26 sessões de 2 horas.
- Eurolify, 11/10/2026, `git ls-tree origin/main`: 60 migrações (0001 a 0061,
  sem a 0056), 15 pastas em `apps/api/src/`.
- Os 32 módulos pela tabela do `docs/31` §4, contados à mão: 7 de núcleo, 20 de
  gestão, 5 sectoriais; 6 em parte no Eurolify, 2 desenhados e desligados, 6
  fora pelo `docs/00` §2.2, 18 por desenhar.

## O que ficou por verificar

- ~~A decisão de âmbito (`docs/31` §10)~~ **Decidida a 11/10/2026** pelo Diogo
  (*«a, actualiza o docs/00 e o docs/05»*): a gestão da empresa entra em
  módulos ligáveis a partir da Fase 2 (decisão DR, ADR-0042). Actualizados o
  `docs/00` (§2.2, §4, §6, §7), o `docs/05` (Fase 1 «fica de fora» e Fase 2),
  o `docs/06` (DR), o `docs/13` e o `docs/31`. A exclusão antiga só estava no
  `docs/00` §2.2 (`grep` por «streaming», «marketing editorial» e «de uma
  empresa, não» em `docs/`, `README.md`, `AGENTS.md` e nas skills).
- Só o balcão passou pelas 8 portas; nenhum módulo novo está estimado.
- Do balcão: os preços do Vendus vêm do texto da pesquisa (página ao vivo não
  aberta); a API do Moloni foi lida mas **não testada** — as oito perguntas
  para a sandbox estão no §7 do ficheiro de fontes; a conta de demonstração
  ainda não foi pedida. *Mais tarde, a 11/10:* a subscrição da conta antiga
  expirou; o Diogo criou uma conta trial e pôs as quatro variáveis
  `MOLONI_*` no ambiente (lêem-se numa sessão nova). Regras dos testes no §7
  do ficheiro de fontes: ler livre, escrever só com OK, **nenhuma venda nem
  documento fechado antes de o Moloni confirmar que não seguem para a AT**;
  as chaves que apareceram numa captura não se usam.
- Todas as regras fiscais e legais do PDF ficam **C** (isenção da formação,
  bilhete de evento, biometria no trabalho, relatório da autoridade dos
  cosméticos, rótulo, prestações).
- O plano de fatias diz «em pedido» para as fatias 8, 9 e 10, que já estão no
  `main` (0044, 0047, 0050): desactualizado, não corrigido neste pedido.
- Se a fatura do Eurolify nasce das quantidades expedidas (sequência 01) — não
  confirmado no `docs/27` nem no `docs/29`.
