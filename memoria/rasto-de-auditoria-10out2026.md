# Rasto de auditoria comum (#322, decisão DK) — 10/10/2026

Desenho: `docs/28-rasto-de-auditoria.md`, aprovado pelo Diogo a 10/10/2026
(*«aprovado»*), com Q1 a Q4 decididas (§5). O código entra pela ordem da §4.

## O que se fez

| Passo | Pedido | Migração | O quê |
|---|---|---|---|
| 1 | #327 | 0051 | `contexto_do_rasto()` e as variáveis da transacção, lidas pela API num só sítio (`base/rasto.ts`, `app.ts`); o cabeçalho `Eurolify-IA` lido e gravado como «declarado» |
| 2 | #334 | 0053 | as colunas `canal`, `pedido`, `ia`, `autorizado_por`, `motivo` em oito tabelas do rasto, por um só gatilho (`rasto_completar()`); as linhas antigas ficam vazias («desconhecido») |
| 3 | #340 | 0054 | os dados pessoais dos Clientes passam a marcador `{"protegido": true, "resumo": "<8 hex>"}` (HMAC com uma chave da base); a lista em `campo_sensivel`; os valores já em claro reescritos (Q2) |
| 4, parte 1 | #342 (juntado a 10/10/2026, 8c8e93d) | 0057 | a marca «chave de um agente de IA»: `chave_api.agente_ia`, no `POST /keys`, `POST /hub/keys`, listas e `/me`; a autenticação põe a IA `{"prova": "declarado"}` quando a chave é de um agente e não há cabeçalho; uma chave de um agente só cria chaves de um agente |
| 4, parte 2 | #345 | — | as linhas do tempo da API (artigo, Hub, cliente, encomenda, transições de pagamento, rasto de documento) trazem `canal`, `pedido`, `ia` (sempre, com `desconhecido` explícito), `autorizado_por` e `motivo`, por um só esquema e função (`base/rasto-resposta.ts`) |

Fonte dos passos 1 a 3: as descrições dos pedidos e o `docs/28` §2 a §4 no
`main` de 10/10/2026 (commit 0dffbe3).

Plano do resto do passo 4 (dito ao Diogo a 10/10/2026):
- parte 3: o aviso calculado na API e o histórico de preços em dois níveis;
- parte 4: as tarefas diferidas com o pedido de origem;
- parte 5: o Hub mostra as respostas no histórico do artigo e a opção da
  marca no ecrã das chaves — desenho e maqueta primeiro, só se junta com o
  aspecto aprovado;
- antes da parte 5: os pendentes do #322 (o `quem` e o `autorizado_por` da
  autenticação; as escritas do Hub em `identidade/hub.ts`,
  `hub-credenciais.ts` e `hub-palavra-passe.ts` a usar `comRastoNaBase`;
  `EXECUTE` da `contexto_do_rasto()` (P3-7); motivo acima de 500 caracteres
  no `mudarEstado` (P3-8); rotas públicas; canais `importacao`,
  `integracao`, `mcp`; motivo na pseudonimização). A exportação do titular
  já levava as colunas novas (`select *`).

**Decididas pelo Diogo a 11/10/2026 (DO; `docs/28` Q5 a Q7, §3.6 a §3.8):**
- o aviso «sem autorização de uma pessoa» em toda a alteração sem pessoa a
  autorizar, seja qual for a origem — tarefas incluídas (a proposta de
  10/10 excluía as tarefas; ficou a regra do Diogo);
- as tarefas diferidas guardam o pedido de origem e herdam a autorização:
  «sistema, a pedido do agente X (pedido n.º …)»;
- o histórico de preços em dois níveis: `prices:read` vê o tipo de autor e
  o aviso; quem mudou e quem autorizou pedem `prices:history`.

## Números (com data e como se contaram)

- Migrações no `main` a 10/10/2026, 21:40 UTC: a última é a 0054
  (`ls apps/api/migracoes | tail`); a 0055 e a 0056 estão reservadas pelos
  #338 e #329; a parte 1 do passo 4 usa a 0057.
- Testes da parte 1 (10/10/2026, PostgreSQL 18.6 local por Docker):
  `test/rasto-chave-agente.test.ts`, 9 testes depois da revisão; 9 mutações
  (a marcação na autenticação, a herança, a marca na lista do que não muda,
  as recusas da pública na rota e na base, a marca no Hub, a regra da tabela,
  a repetição da revogação) — cada uma faz falhar pelo menos um teste.
- IA «comprovado»: nenhum caso hoje — `grep -rn -i "anthropic\|openai\|mistral\|deepl" apps/api/src`
  só encontra o tipo em `base/rasto.ts` (10/10/2026).

## O que ficou por verificar

- A configuração de registo da base na VPS (o segredo de quem pede passa às
  funções; `docs/19` §6.1 já o dizia).
- O ecrã das chaves do Hub ainda não mostra nem escolhe a marca (parte 3).
- O MCP da VPS (`apps/mcp`) é de operação, não de comércio: não põe o canal
  `mcp` nem o cabeçalho.
