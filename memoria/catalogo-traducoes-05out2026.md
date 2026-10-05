# Catálogo (fatia 3), parte 3b: traduções e língua de origem — 05/10/2026

## O que se fez

- O Diogo pediu a parte 3b (*«sim, começa a parte 3b do Catálogo»*, 05/10/2026), com a P13 decidida (*«sim, uma só língua de origem por comerciante»*; `docs/06` AW).
- Desenho escrito antes do código no `docs/14` §3.8: campos traduzíveis por recurso (artigo: nome, descrição; opção: nome; valor: valor; categoria: nome, endereço; colecção: nome, descrição, endereço) e as regras da parte (proposta).
- Migração `0009_catalogo_traducoes.sql` (era a 0008; o #104 juntou antes a `0008_rasto_imutavel_e_funcoes_fechadas.sql`):
  - `comerciante.lingua_origem` (os que existiam ficam com a das lojas ou a `lingua`); `loja.lingua_origem` fica, sem obrigação, até 31/10/2026 (compatibilidade com a versão anterior); a língua de origem não muda depois de haver artigo, categoria ou colecção (`merchant.origin_language_locked`).
  - O preenchimento corre com o RLS forçado e o trigger da versão desligados só durante a migração: o `eurolify_migrador` da VPS não é superutilizador nem ignora o RLS (`infra/vps/preparar.sh`, linha 433), e sem isso o UPDATE falhava (provado por mutação no teste `migracao-0008.test.ts`, que corre com um migrador igual).
  - Tabela `traducao` (uma coluna por tipo de recurso, cada uma com a sua chave estrangeira em cascata), RLS forçado, GRANT por coluna; a base guarda o original do momento, quem (`eurolify.quem`) e a data; revisão só de propostas de IA; endereço traduzido com formato e único por língua.
  - Vista `texto_original` (com `security_invoker`) para o estado e a fila.
  - P3-A da 2.ª revisão do #97: entrar numa categoria lê-a com `FOR SHARE` para uma variável. A primeira forma (EXISTS sobre subconsulta com o filtro fora) esperava com o superutilizador mas não com o `eurolify_api` — apanhado pelo teste; não verifiquei porquê ao certo.
- `src/catalogo/traducoes.ts`: `definirTraducao` (traduzir outra vez substitui e confirma contra o original de agora), `reverTraducao`, `apagarTraducao`, `traducoesDoRecurso` (com o estado), `filaDeTraducoes` (em falta e desactualizadas de uma língua). `registarComerciante` aceita `lingua_origem` (sem ela, a `lingua`); `criarLoja` deixa de a pedir.
- P3-B e P3-C da 2.ª revisão do #97 em `categorias.ts`: ids em minúsculas; alterar ignora campos fora da lista. P3-D: textos.
- **Revisão do #105 (agente, Sonnet 5.5, 05/10/2026):** 1 P1, 4 P2 e P3; o Diogo pediu tudo (*«sim, corrige o P1, os P2 e os P3 e manda rever»*).
  - P1-1: a língua de origem «fixa» mudava se se criasse o primeiro artigo, categoria ou colecção ao mesmo tempo (medido pelo revisor nos três). Agora criar prende o comerciante (`FOR SHARE`, trigger `catalogo_prende_o_comerciante`) e as duas operações ficam uma depois da outra. Com isto, o `FOR SHARE` que a tradução fazia ao comerciante deixou de ser preciso e saiu (uma tradução é de um recurso que já existe).
  - P2-1: rever outra vez o que já está revisto é recusado (dava por completa uma tradução desactualizada). P2-2: quem traduziu não se revê; que quem revê é uma pessoa fica para a API (pela conta), escrito no `docs/14` §3.8. P2-3: quem traduz diz o original que viu (`originalVisto`); o repositório prende a linha do recurso e compara. P2-4: compatível com a versão anterior (`infra/vps/LEIA-ME.md`): a `loja.lingua_origem` fica até 31/10/2026 e a base põe a língua de origem por omissão.
  - P3: a migração pára com lojas de um comerciante em línguas diferentes; confirma no fim que o RLS forçado e o trigger voltaram; índices para apagar em cascata; a fila mostra traduções de originais que ficaram vazios; limites (200 e 20 000); textos. O rasto do texto anterior fica para a parte 5.

## Números (com data e como se contaram)

- 05/10/2026, PostgreSQL 18.6 em Docker, `EXIGIR_BASE=1`, primeira versão: `catalogo-traducoes.test.ts` 11 testes, `migracao-0008.test.ts` 1, `catalogo-categorias.test.ts` 25; api 304 passados, mcp 52 (58 depois do merge do #102 e #103); `tipos`, `lint` e `construir` sem erros.
- Depois da revisão do #105 (com o `main` do #104 e #106): `catalogo-traducoes.test.ts` 15, `migracao-0009.test.ts` 2, `catalogo-categorias.test.ts` 25. Mutações novas, uma de cada vez (18): todas fazem falhar pelo menos um teste — incluindo as 7 lacunas que o revisor achou (endereço único e campos da colecção, cascatas da categoria, do valor e da opção, original só com espaços, a língua por omissão).
- Mutações, uma de cada vez (23): todas fazem falhar pelo menos um teste; a do RLS forçado na `traducao` só a apanha o `comerciante.test.ts` (o teste de todas as tabelas).

## O que ficou por verificar

- A 2.ª revisão do agente (ADR-0035) — por fazer quando escrevi isto.
- A 0009 na VPS com os dados de lá (em particular, se há comerciantes com lojas em línguas diferentes: nesse caso a publicação pára).
- Sair a `loja.lingua_origem` numa migração seguinte, até 31/10/2026.
- O «avisa» da C5 (eventos, parte 5); a lista de línguas por mercado (Preços e mercados); os `avisos` do artigo e o texto alternativo da media (campos que ainda não existem).
