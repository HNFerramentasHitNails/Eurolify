# Pedidos do titular em todos os domínios (#233, decisão DU) — 11/10/2026

Desenho: `docs/23` §15, aprovado pelo Diogo a 11/10/2026 (*«aprovado»*),
com Q1 a Q4 decididas (§15.8; `docs/06`, DU). Pedidos: desenho #369
(juntado, 53b7ccd); parte 1 do código neste ramo
(`titular-apagamento-dominios`, migração 0072).

## O que se fez

- Medido: o apagamento só tratava a ficha. As fatias 0041, 0044, 0047,
  0050, 0058, 0061 e 0063 guardam cópias dos dados pessoais em tabelas
  imutáveis, e nenhuma entrou no apagamento. O resultado já o admitia
  (`encomendas_com_dados_por_tratar`; `checkout-api.test.ts:1404-1412`).
- A regra (RGPD, art. 17.º, n.º 1, al. a), e n.º 3, als. b) e e), lido no
  EUR-Lex, CELEX 32016R0679): a prova fiscal fica 10 anos; uma encomenda em
  curso fica até acabar e limpa-se sozinha; o resto limpa-se logo.
- Parte 1 (0072): os gatilhos abrem só as colunas pessoais, só com a marca
  da 0049; `titular_limpar_encomenda()`; a fila `titular_pendente` (interna)
  e a tarefa de hora a hora; o perfil só fica sem cancelamento sem pagamento
  (Q2); o aviso em bruto passa a resumo com a chave do rasto (0054, 8 hex;
  Q3).
- Uma encomenda «acabou»: estado `concluida`, `cancelada`,
  `cancelada_sem_pagamento` ou `devolvida`, e nada aberto na pós-venda
  (com as duas excepções do P1-1 abaixo, 12/10/2026). A conclusão
  automática é 14 dias depois de entregue (`stock/repositorio.ts:1313`),
  o prazo da livre resolução.
- Parte 3 (12/10/2026, `docs/23` §15.10): a exportação ganha a coluna
  «Exportação» da §15.2 (a encomenda inteira, expedições, estados sem
  motivo, documentos fiscais sem PDF, livre resolução, devoluções,
  problemas, reembolsos sem prova) e, com o apagamento, as fichas com o
  mesmo e-mail ou telefone (§15.5), só listadas.

## Números (com data e como se contaram)

- Testes da parte 1 (11/10/2026, PostgreSQL 18.6 local): 3 no
  `checkout-api.test.ts` (acabada sem nada fiscal; em curso na fila; as
  colunas fechadas fora da função do dono) e 1 no `posvenda-api.test.ts`
  (paga e concluída: a cópia fiscal fica, o aviso fica resumo). 3
  contraprovas (sempre limpar a cópia fiscal; o perfil a contar canceladas
  sem pagamento; o gatilho da encomenda sem o contacto): cada uma faz falhar
  um teste.
- Revisão do #374, P1-1 (12/10/2026, PostgreSQL 18.6 em Docker, Node
  24.21.0): 1 caso novo no `posvenda-api.test.ts` com 4 encomendas
  (devolvida em parte; perdida com reembolso sem portes; perdida com o
  problema fechado sem reembolso; perdida com disputa). 4 contraprovas (sem
  os 14 dias; sem o problema fechado; sem o pagamento; sem `em_disputa` na
  lista comum): cada uma faz falhar o caso.
- Parte 3 (12/10/2026, PostgreSQL 18.6 em Docker, Node 22.22.0): 1 caso no
  `posvenda-api.test.ts` e 1 no `clientes-titular.test.ts`. 5 contraprovas
  (o motivo nas transições; a prova no reembolso; o PDF no documento; sem
  tirar o grupo; contar depois de apagar): cada uma faz falhar o caso. Os
  quatro ficheiros afectados: 83 testes certos.
- Revisão do #411 (agente, 12/10/2026): nenhum P0/P1; tratados P2-1 (número
  declarado de um documento emitido fora), P2-2 (comprador lido do
  documento), P2-3 (índices na 0082 e a procura de contactos com listas,
  para os índices GIN). 2 contraprovas novas, cada uma faz falhar o caso.
- P3-2 do #411 (Diogo, 13/10/2026, *«sim, avança com os quatro num pedido
  à parte»*): a exportação traz também as linhas da livre resolução e do
  reembolso, a decisão de higiene e o seguimento da transportadora (sem o
  id do evento nem o aviso em bruto). 5 contraprovas (13/10/2026,
  PostgreSQL 18.6 em Docker): cada uma faz falhar o caso.

## O que ficou por verificar

- O formato do aviso da EuPago: os campos não pessoais não ficam no resumo
  (Q3, **C**).
- Os 10 anos para a cópia de onde se emite e para o PDF (V10 do `docs/29`),
  e se uma encomenda não paga precisa do NIF (Q2) — contabilista.
- As notificações por e-mail (#373, em desenho por outra sessão) devem
  ignorar contactos com o marcador «(pseudonimizado)».
- Parte 2 (sessões de checkout por prazo) feita a 12/10/2026, migração
  0077 (`docs/23` §15.10): ao criar a encomenda e 7 dias depois de expirar
  ou ser abandonada (a mais cedo entre a última mudança e `expira_em`,
  revisão do #402, P2-1). O prazo de 7 dias é **C** (jurista). Índice só
  das sessões com dados; o custo com muitas sessões não foi medido. A tarefa
  não avisa se parar (desvio ao §15.6, como a fila do titular).
  Fechado a 13/10/2026: a verificação diária avisa as duas (`docs/23`
  §15.11; migração 0088; memória `aviso-tarefas-que-param-13out2026.md`).
- Parte 3: não se mediu o tamanho nem o tempo da exportação de uma pessoa
  com muitas encomendas (uma consulta por tabela e por ficha), nem se o
  planeador usa os índices da 0082 e os GIN da 0046 (sem EXPLAIN). Os montantes
  saem como texto (bigint), como os pagamentos já saíam. As fichas com o
  mesmo contacto não procuram pelo NIF (o sinal `nif_particular` dos
  duplicados), porque a §15.5 só fala de e-mail e telefone.
- Revisão do #374, P1-1, **decidida** (Diogo, 12/10/2026: *«a»*); os
  estados da encomenda não mudam. Acabam também, sem nada aberto: uma
  `devolvida_parcial` 14 dias depois da última entrega (como a
  `concluida`), e uma `expedida` com a expedição perdida ou devolvida ao
  remetente depois de uma pessoa fechar o problema ou de o pagamento deixar
  de estar capturado. Um pagamento `em_disputa` conta como aberto. Estas
  condições vêm da segunda revisão (agente, 12/10/2026): a primeira versão
  exigia o pagamento todo `reembolsado` e deixava presos o reembolso sem
  portes, o reenvio fora e a disputa perdida. Teste com quatro contraprovas
  em `posvenda-api.test.ts`.
- Por decidir: uma `expedida_parcial` cuja expedição se perdeu e cujo resto
  nunca sai fica sem fim (só passa a `expedida`, já não se cancela).
- Fica de fora (revisão do #374, P3): os avisos sem pagamento associado
  (formato da EuPago **C**); os textos que entrem depois numa encomenda já
  limpa (uma devolução ou um problema novos); os apagamentos feitos antes da
  0072 (decisão pedido a pedido, nunca em massa); o custo dos gatilhos, que
  passam a converter OLD e NEW em JSON em cada alteração.
