# O apagamento do titular e os textos livres (14/10/2026)

## O que se fez
- Decisão DU (`docs/23` §15.1, grupo C dos «textos livres»): o texto livre de uma pessoa ligado a um titular passa a «(pseudonimizado)». Já estavam `transicao_*.motivo` (0072) e `atribuicao_rasto.motivo` (0102).
- Migração 0104: `diferenca_pagamento.resolucao` (0044, até 2000) limpa-se em `titular_limpar_encomenda` nas diferenças **resolvidas** dos pagamentos da encomenda (a encomenda só acaba sem abertas, 0072); o jsonb devolve `resolucoes_de_diferencas`.
- A guarda «resolvida é imutável» (0044) aceita só um UPDATE da `resolucao` para o marcador, com a marca da pseudonimização e como dono (`titular_limpeza_permitida`); `ALWAYS`; a tabela não tem gatilhos AFTER UPDATE (sem eventos nem notificações).
- Sem pagamento (`aviso_sem_pagamento`): sem titular, fica.
- A 0104 corrige também o filtro do aviso em bruto (`aviso_pagamento.corpo`): `NOT LIKE '{"pseudonimizado"%'` nunca reconhecia o corpo limpo (o jsonb ordena as chaves) e limpar duas vezes recalculava o resumo; agora uma expressão regular sobre a forma exacta.
- Teste: `apps/api/test/pagamentos-resolucao-apagamento.test.ts` (8). Linha nova na `docs/23` §15.2 e a lista «por ligar» na §15.16.

## Números (com data e como se contaram)
- 14/10/2026, leitura das migrações 0001–0102 e de `src/` (sem base com dados): 6 colunas por ligar ou a confirmar (`docs/23` §15.16).
- Provas de falha, 14/10/2026, mudando a 0104 e repondo-a: sem a limpeza, 4 de 7 falham (contadas com o ficheiro ainda com 7 testes, antes do teste do aviso limpo duas vezes); com a guarda antiga, 6 de 7; com o filtro antigo do aviso, 1 de 8 (já com os 8 testes); com a guarda a aceitar qualquer texto ou sem a marca, 1 de 7 (o da guarda).

## O que ficou por verificar
- Nenhuma das colunas por ligar foi ligada; `movimento_stock.motivo` e as etiquetas estão por confirmar.
- Uma diferença nova, resolvida depois de a encomenda já estar limpa, não se limpa (`titular_pendente` só tem as encomendas por acabar).
- Já existia, não é desta migração: uma diferença `aberta` aceita `resolucao` sem `resolvida_por` (o CHECK e a guarda deixam passar); não verifiquei se alguma rota o permite.
- A exportação do titular não leva as diferenças de pagamento.
- Revisão do #469 (Sonnet 5.5, 14/10/2026): 0 P0/P1. P2-1: `reembolso.prova.motivo` guarda o mesmo texto da resolução e não se limpa — acrescentado à §15.16 como por ligar. P2-2: as etiquetas (0079, 0093) já se limpam por gatilhos na `encomenda` — corrigido na §15.16.
