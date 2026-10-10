# Clientes: os anexos da isenção manual, na base de dados (#233, #338), 10/10/2026

## O que se fez

- **Decisão do Diogo, 10/10/2026:** *«A»*, os anexos guardam-se na base de
  dados (`docs/06`, **DN**; desenho em `docs/23` §13.5 e §13.11). O §13.10
  dizia porque não iam para a pasta das imagens.
- **A letra passou de DM a DN** antes de juntar: a DM já era da pós-venda
  (#329, commit `80a4771`, 18:32 UTC) e este pedido registou-a às 20:13
  (`fb10743`). Duas sessões a trabalhar ao mesmo tempo escolheram a mesma letra
  sem verem a outra; corrigido no `docs/06`, no `docs/23` e no comentário da
  migração (`aaf1782`).
- **Migração 0055** (`0055_clientes_anexos_da_isencao.sql`). Foi 0053 e 0054;
  o #334 e o #340 entraram com esses números.
  - `anexo_isencao` (`exa_`): os bytes na base (`SET STORAGE EXTERNAL`), com o
    RLS de cada comerciante, e entram nas cópias diárias que já existem;
  - PDF, JPEG ou PNG pela **assinatura** (os primeiros bytes); até 10 MB, até 5
    por isenção, até 1 GB por comerciante (proposta, como as imagens);
  - só numa isenção em vigor de um perfil activo numa ficha activa, e só por
    uma pessoa ou pela chave dela (`customers.exemption_by_person`);
  - não se altera nem se apaga, nem pelo superutilizador; a excepção é a
    pseudonimização (0049), que apaga os anexos dos perfis que ninguém usou.
- **API:** `POST /exemptions/{id}/attachments` (bytes no corpo, Idempotency-Key
  com o resumo dos bytes, 2 envios em simultâneo por comerciante),
  `GET /exemptions/{id}/attachments` (a lista, `customers:read`) e
  `GET /exemptions/{id}/attachments/{anexo}` (os bytes, `customers:exemptions`,
  `private, no-store`, `nosniff`, `sandbox`). A exportação do titular lista os
  anexos, sem os bytes.
- **Revisão do agente** (`eurolify-critical-review`, Claude Sonnet 5.5,
  ADR-0035): sem P0, 1 P1 (nome do ficheiro fora de latin1) e 5 P2, tratados;
  a P2-5 (exportação sem os bytes) fica **C**, para o jurista.
- **Continuado noutra sessão** (a que o escreveu ficou sem crédito): juntado o
  `main` (#339), a bateria corrida outra vez e a letra corrigida.
- **Juntado** a 10/10/2026 (`cff9c0d`). **Publicado no ensaio:** corrida 38089880187, com sucesso às 22:10 UTC; o registo diz «migrar: aplicadas 0055_clientes_anexos_da_isencao» e «O /health da API responde».

## Números (com data e como se contaram)

- 10/10/2026, neste contentor (PostgreSQL 18.6 da lista
  `infra/ci/imagens-base.txt`, Node 24.21), com o `main` do #339: `pnpm lint` e
  `pnpm tipos` limpos; **API 1289 de 1289**, Hub 140, MCP 58.
- `test/clientes-anexos-isencao.test.ts`: 10 testes.
- Mutações: 14, 13 apanhadas; a que sobrevive é a verificação do tipo na rota,
  que é uma segunda rede (a base também recusa).

## O que ficou por verificar

- **O prazo de guarda** é o fiscal: **C**, V2, para o contabilista.
- **A exportação sem os bytes:** **C**, para o jurista.
- **O crescimento da base com anexos:** não medido.
- **Sem teste:** o limite de envios em simultâneo; o ficheiro vazio e os
  10 MiB exactos.
- **Sem rasto:** o anexo não deixa evento nem rasto de leitura; a
  pseudonimização não conta os anexos apagados.
- **Não li a base do ensaio** depois de publicar.
