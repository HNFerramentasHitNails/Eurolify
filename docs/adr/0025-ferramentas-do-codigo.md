# ADR-0025 · As ferramentas do código: Node 24, TypeScript 6.0, pnpm, Fastify, PostgreSQL 18 com RLS, Kysely, Vitest

- **Estado:** aceite · completa o [ADR-0002](0002-nucleo-proprio-de-raiz.md)
  (TypeScript + PostgreSQL)
- **Data:** 04/10/2026
- **Quem decidiu:** Diogo
- **Decisão em aberto de origem:** A3 do pedido de 04/10/2026 (as
  ferramentas, a contar com a VPS-1 do [ADR-0021](0021-vps-1-ate-a-migracao.md))

## Contexto

O ADR-0002 fixou TypeScript e PostgreSQL. O ensaio corre numa VPS-1: 2
núcleos, 3,7 GiB de memória sem swap, 40 GB de disco (ADR-0021). O contrato da
API é REST com OpenAPI 3.1 (recomendação D-8; skill `headless-commerce`) e o
isolamento entre comerciantes é imposto pela base (skill `platform-architect`,
regra 3).

Versões lidas a 04/10/2026 nas fontes oficiais (`nodejs.org/dist/index.json`,
`github.com/nodejs/Release` `schedule.json`, `postgresql.org/versions.json`,
`registry.npmjs.org`):

- Node.js: LTS 24.21.0 «Krypton» (07/09/2026), manutenção a partir de
  20/10/2026, fim a 30/04/2028; a 26 (26.10.0, «Current») passa a LTS a
  28/10/2026.
- TypeScript: `latest` 7.0.2; última 6.0 = 6.0.3 (16/04/2026). O
  `typescript-eslint` 8.71.0 pede `typescript >=4.8.4 <6.1.0`.
- PostgreSQL: 18.6 (13/08/2026), «current», suportado até 14/11/2030.
- npm: pnpm 12.9.1 (03/10/2026), fastify 5.12.5 (16/09/2026), @sinclair/typebox
  0.34.52, @fastify/swagger 9.9.1, kysely 0.29.6 (16/09/2026), pg 8.23.1,
  vitest 5.0.3, testcontainers 12.2.0, eslint 10.12.0, typescript-eslint
  8.71.0, prettier 3.9.9, react 19.3.0, vite 8.3.2.

Pergunta feita ao Diogo, com a tabela de propostas e alternativas: *«Fica
assim a A3, ou mudas alguma peça?»* Resposta, a 04/10/2026: *«fica assim»*.

## Opções consideradas

| Peça | Escolhida | Deixada | Porquê |
|---|---|---|---|
| Ambiente | Node.js 24 LTS | 26 (ainda «Current») | LTS hoje; muda-se para a 26 depois de 28/10/2026 |
| Linguagem | TypeScript 6.0 | 7.0 | o lint com tipos não aceita o 7 |
| Pacotes | pnpm, áreas de trabalho | npm | API, Hub e SDK no mesmo repositório |
| API | Fastify + TypeBox + @fastify/swagger | Hono; NestJS | o esquema valida e gera o OpenAPI 3.1; pouca memória |
| Base | PostgreSQL 18, RLS por comerciante | 17 | «current»; isolamento imposto pela base |
| Acesso | Kysely + pg | Drizzle; Prisma | SQL tipado, sem motor à parte; `SET LOCAL` à vista |
| Migrações | SQL à mão, numerado, pelo migrador do Kysely | node-pg-migrate | políticas, `GRANT` e utilizadores escrevem-se em SQL |
| Testes | Vitest com PostgreSQL real (contentor) | — | o isolamento testa-se na base verdadeira |
| Lint e formato | ESLint + typescript-eslint + Prettier | Biome | regras com tipos (promessas esquecidas, lição 4.1) |
| Hub | React + Vite, estático | Next.js | sem servidor próprio na VPS |
| Imagens | Docker, construídas no GitHub | construir na VPS | não gasta a memória da VPS (liga com a A4) |

## Decisão

As ferramentas do Eurolify são as da coluna «Escolhida» acima, nas versões
lidas a 04/10/2026 e **fixadas** no `pnpm-lock` e no `package.json`
(`engines`, `packageManager`).

## Consequências

- **Datas a cumprir** (regra «uma rede temporária tem data de fim»):
  - passar ao **Node 26** num pedido próprio **depois de 28/10/2026** e antes de
    30/04/2028 (fim do Node 24);
  - passar ao **TypeScript 7** quando o `typescript-eslint` o aceitar —
    verificado em cada actualização de dependências.
- O Hub só começa quando o desenho dele existir (ADR-0023).
- Memória prevista na VPS-1 (**C**, não medida): PostgreSQL ≈ 512 MB, API
  ≈ 150–250 MB, proxy < 50 MB, sistema e `fail2ban` ≈ 300 MB — ≈ 1,2 GiB de
  3,7. Mede-se no ensaio.
- **O que pode partir:**
  - o Kysely está na série 0.x: uma versão nova pode mudar a API (versões
    fixadas; actualizar com testes);
  - com RLS, um `SET LOCAL` do comerciante esquecido devolve uma consulta
    vazia ou, com uma política mal escrita, dados de outro — os testes de
    leitura cruzada são a trava;
  - ficar no Node 24 ou no TypeScript 6 depois das datas acima.

## O que ficou por verificar

- Se o fastify 5.12 e o vitest 5 já funcionam no Node 26.
- A memória real de cada peça (só no ensaio).
