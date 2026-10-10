# Clientes: os anexos da isenção manual, na base de dados (#233, #338), 10/10/2026

## O que se fez

- **Decisão do Diogo, 10/10/2026:** *«A»*, os anexos da isenção manual de IVA
  guardam-se na base de dados, não numa pasta da VPS (`docs/06`, **DN**).
  A letra começou como DM; passou a DN porque a pós-venda (#329) a registou
  primeiro (commit `aaf1782`, de outra sessão).
- **#338 juntado a 10/10/2026 às 22:01 UTC** (`cff9c0d`), depois de o Diogo
  dizer *«continuar»* à pergunta «junto o #338 quando o CI ficar verde?».
- **A migração é a 0055** (`0055_clientes_anexos_da_isencao.sql`). Começou
  como 0053 e passou a 0054 e depois a 0055: o #334 e o #340 entraram com
  essas. O #329 também tinha a 0054; foi avisado lá de que passa à 0056.
- **O que ficou:**
  - `anexo_isencao` (`exa_`): PDF, JPEG ou PNG pela assinatura (sem
    verificação da estrutura nem antivírus), até 10 MB, 5 por isenção e
    1 GB por comerciante (proposta, como as imagens);
  - só numa isenção em vigor, de um perfil activo numa ficha activa, e só por
    uma pessoa ou pela chave dela;
  - não se altera nem se apaga; a pseudonimização apaga os anexos dos perfis
    que ninguém usou e guarda os dos usados (R9);
  - `POST` e `GET /exemptions/{id}/attachments` e `GET …/{anexo}` com os
    bytes; o nome do ficheiro leva a extensão do tipo, em ASCII e em UTF-8,
    com `nosniff` e `sandbox`; no máximo 2 envios em simultâneo por
    comerciante;
  - a exportação do titular lista os anexos, sem os bytes.
- **Revisão do agente** (`eurolify-critical-review`, Sonnet 5.5, ADR-0035):
  0 P0, 1 P1, 5 P2, 9 P3; tratados, salvo P2-5 (fica **C**), P3-5, P3-6 e
  P3-7 (escritos em `docs/23` §13.11).
- **O Codex não reviu:** a conta atingiu o limite de utilização.
- **Publicado no ensaio** pelo fluxo `publicar` (corrida 38089880187, com
  sucesso às 22:10 UTC). O registo diz «migrar: aplicadas
  0055_clientes_anexos_da_isencao» e «O /health da API responde».

## Números (com data e como se contaram)

Contado a 10/10/2026, neste contentor (PostgreSQL 18.6 por Docker).

- **Testes novos:** `test/clientes-anexos-isencao.test.ts`, 10.
- **Mutações:** 14, 13 apanhadas. Sobrevive a verificação do tipo na rota:
  sem ela, o leitor do Fastify e o CHECK da base recusam na mesma.
- **`npx vitest run` com o `main` do #340: 1277 de 1278.** A falha é a de
  `idempotencia-limpeza`, do papel deste contentor.
- **CI do #338:** verde em `d7192c6` e em `cdb49b6`; o merge final foi feito
  sobre `aaf1782`.

## O que ficou por verificar

- **Um anexo enviado no ensaio:** não li a base do ensaio (o MCP da VPS
  pede autorização nesta sessão).
- **A exportação sem os bytes** (P2-5): se o direito de acesso exige os
  ficheiros é **C**, para o jurista.
- **O prazo de guarda:** é o fiscal; **C**, V2, para o contabilista.
- **Não medido:** o crescimento da base com anexos.
- **Sem teste:** o limite de envios em simultâneo; o ficheiro vazio e os
  10 MiB exactos.
- **Sem rasto:** o anexo não deixa evento nem rasto de leitura (P3-7); a
  pseudonimização não conta os anexos apagados (P3-6).
