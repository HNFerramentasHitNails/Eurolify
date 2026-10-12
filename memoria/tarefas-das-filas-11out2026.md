# Peça 21: tarefas das filas que pedem uma pessoa — desenho, 11/10/2026

## O que se fez

Pedido do Diogo, 11/10/2026: *«começa o desenho da peça 21»* (issue #366;
decisão DS, ADR-0043; `docs/13` §10). Escrito o
`docs/33-tarefas-das-filas.md`, no pedido #368. **Aprovado** pelo Diogo a
11/10/2026 (*«sim, aprovo o desenho com as sete filas»*; `docs/06`, DW). A
peça 21 passa a 2,5–5 pessoas-semana e a Fase 1 a 18 a 33 meses (32 a 60 a
meio tempo), corrigido no `docs/10`, `docs/05`, `docs/31`, ADR-0008, ADR-0043
e na memória da estimativa.

- **Forma proposta:** a lista «A decidir» lê os casos abertos de cada fila (uma
  função da base por domínio) e junta-lhes a atribuição (`atribuicao`, `atr_`:
  responsável, prazo, aviso, versão), guardada à parte. Não há estado na
  tarefa nem fecho à mão: o caso sai da lista quando sai da fila.
- **Sete filas propostas** (a DS nomeou quatro): diferença dos pagamentos,
  documento fiscal (retido, divergente, incerto entregue a uma pessoa),
  duplicado de cliente, prazo do reembolso, e as três encontradas no código:
  pedido de livre resolução `pendente` ou `fora_de_prazo`, problema `aberto`,
  reembolso `incerto` ou `falhado`.
- O nome `tarefa_` fica para as cinco filas de trabalho automático que já
  existem (0044, 0047, 0050, 0061, 0063).

## Números (com data e como se contaram)

- **Filas que esperam por uma pessoa no código: 7** (11/10/2026), contadas
  por um agente só de leitura nas migrações e rotas de `apps/api` e conferidas
  à mão nas tabelas (`0044:380-399`, `0046:161-185`, `0058:255-267, 453-460,
  512-522`).
- **Filas com responsável ou prazo para uma pessoa: 0 de 7** (o `dono` da
  diferença está no `docs/26` §3.6, mas não na tabela, `0044:380-399`).
- **Tabelas `tarefa_*`: 5**, todas automáticas.
- **Leitores da `evento_saida` no programa: 0** (`grep -rln evento_saida
  --include=*.ts apps/`, só testes).

## Achado

**Um pedido de livre resolução `pendente`** (no prazo, sem devolução aberta)
corre o prazo legal do reembolso **sem aviso nem lista**: a função do prazo e
a lista só olham para devoluções (`0063:37-51`; `posvenda/repositorio.ts:
1377-1379`). O desenho cobre-o com a fila `livre_resolucao`; até ao código da
peça 21, continua assim.

## O que ficou por verificar

- O prazo legal para emitir uma fatura: não está nos documentos; contabilista.
- Se o reembolso `falhado` espera sempre por uma pessoa.
- O tempo de resposta da lista com volume; o que está aplicado no ensaio.
- A estimativa das três filas a mais (≈ +0,5–1 pessoa-semana, **C**), até à
  medida das 8 semanas.

## Código da parte 1 (11/10/2026; pedido #375)

- Pedido do Diogo: *«começa o código da parte 1 da peça 21»*. Migração 0066,
  `src/tarefas/`, rotas `/tasks`, a volta de hora a hora (`docs/33` §13).
- **Revisão do agente** (Sonnet 5.5, ADR-0035; publicada no #375): 0 P0, 3 P1,
  8 P2, 12 P3. Os 3 P1 corrigidos:
  - quem sai da equipa pelas funções verdadeiras não largava os casos: o
    `ate` vem do gatilho BEFORE (0026) e um `UPDATE OF ate` não o vê;
  - o problema volta a `aberto` quando se anula o reembolso: quarta coluna
    «na fila desde»;
  - uma permissão dada a um papel que pode não existir no cluster.
- **Lição:** um gatilho `AFTER UPDATE OF col` não dispara quando é outro
  gatilho BEFORE a mudar a coluna; usar `WHEN` sobre a linha final.
- **Lição:** um teste que escreve a linha à mão (`update membro set ate`) não
  prova o caminho real; testar pelas funções que o produto usa.
- Ficam, com a razão escrita no `docs/33` §13: P2-5, P2-6 (o motivo livre no
  apagamento do titular, à espera do código da DU), P3-1, P3-4, P3-6 a P3-9.

## Números do código (11/10/2026)

- `tarefas-api.test.ts`: 19 testes, todos verdes (vitest, PostgreSQL 18.6
  local, `EXIGIR_BASE=1`).
- Bateria completa antes da revisão: API 1382, Hub 177, MCP 58, todos verdes.

