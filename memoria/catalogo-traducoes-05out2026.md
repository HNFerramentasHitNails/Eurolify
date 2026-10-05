# Catálogo (fatia 3), parte 3b: traduções e língua de origem — 05/10/2026

## O que se fez

- O Diogo pediu a parte 3b (*«sim, começa a parte 3b do Catálogo»*, 05/10/2026), com a P13 decidida (*«sim, uma só língua de origem por comerciante»*; `docs/06` AW).
- Desenho escrito antes do código no `docs/14` §3.8: campos traduzíveis por recurso (artigo: nome, descrição; opção: nome; valor: valor; categoria: nome, endereço; colecção: nome, descrição, endereço) e as regras da parte (proposta).
- Migração `0008_catalogo_traducoes.sql`:
  - `comerciante.lingua_origem` (os que existiam ficam com a da primeira loja ou a `lingua`); `loja.lingua_origem` sai; a língua de origem não muda depois de haver artigo, categoria ou colecção (`merchant.origin_language_locked`).
  - O preenchimento corre com o RLS forçado e o trigger da versão desligados só durante a migração: o `eurolify_migrador` da VPS não é superutilizador nem ignora o RLS (`infra/vps/preparar.sh`, linha 433), e sem isso o UPDATE falhava (provado por mutação no teste `migracao-0008.test.ts`, que corre com um migrador igual).
  - Tabela `traducao` (uma coluna por tipo de recurso, cada uma com a sua chave estrangeira em cascata), RLS forçado, GRANT por coluna; a base guarda o original do momento, quem (`eurolify.quem`) e a data; revisão só de propostas de IA; endereço traduzido com formato e único por língua.
  - Vista `texto_original` (com `security_invoker`) para o estado e a fila.
  - P3-A da 2.ª revisão do #97: entrar numa categoria lê-a com `FOR SHARE` para uma variável. A primeira forma (EXISTS sobre subconsulta com o filtro fora) esperava com o superutilizador mas não com o `eurolify_api` — apanhado pelo teste; não verifiquei porquê ao certo.
- `src/catalogo/traducoes.ts`: `definirTraducao` (traduzir outra vez substitui e confirma contra o original de agora), `reverTraducao`, `apagarTraducao`, `traducoesDoRecurso` (com o estado), `filaDeTraducoes` (em falta e desactualizadas de uma língua). `registarComerciante` aceita `lingua_origem` (sem ela, a `lingua`); `criarLoja` deixa de a pedir.
- P3-B e P3-C da 2.ª revisão do #97 em `categorias.ts`: ids em minúsculas; alterar ignora campos fora da lista. P3-D: textos.

## Números (com data e como se contaram)

- 05/10/2026, PostgreSQL 18.6 em Docker, `EXIGIR_BASE=1`: `catalogo-traducoes.test.ts` 11 testes, `migracao-0008.test.ts` 1, `catalogo-categorias.test.ts` 25; api 304 passados, mcp 52; `tipos`, `lint` e `construir` sem erros.
- Mutações, uma de cada vez (23): todas fazem falhar pelo menos um teste; a do RLS forçado na `traducao` só a apanha o `comerciante.test.ts` (o teste de todas as tabelas).

## O que ficou por verificar

- A revisão do agente (ADR-0035) — por fazer quando escrevi isto.
- A 0008 na VPS com os dados de lá.
- O «avisa» da C5 (eventos, parte 5); a lista de línguas por mercado (Preços e mercados); os `avisos` do artigo e o texto alternativo da media (campos que ainda não existem).
