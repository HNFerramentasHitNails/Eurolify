# Envios, parte A — contas de transportadora e regras do método (12/10/2026)

Pedido do Diogo, 12/10/2026: *«sim, aprovo; avança com a parte A»* (#393;
desenho no `docs/36`, decisão ED). O que está no código está no `docs/36` §14.

## O que se fez

- Migração 0074:
  - `conta_transportadora` (só `ctt`, só modo teste, credenciais cifradas com `ENVIOS_CHAVE`);
  - os campos novos do `metodo_entrega` (conta e serviço, `prazo_max_dias`, `codigos_postais`, `aceita_onu`, `peso_max_g`);
  - o âmbito `shipping:accounts`, só do dono.
- `src/envios/`: as contas, o contrato do adaptador (só `servicos` e `testar`) e as rotas.
- `src/checkout/entrega.ts`: a regra única de «este método serve?» (zona, perigosos, peso, conta pronta) e a data-limite. É usada pela lista `GET /checkout/{token}/delivery-methods`, pela escolha, pelo resumo e pelo botão final.
- O ambiente de testes numa sessão na nuvem:
  - `dockerd &`;
  - a imagem do PostgreSQL vem de `mirror.gcr.io/library/postgres@sha256:7493…`, com o mesmo resumo do `infra/ci/imagens-base.txt`: o Docker Hub deu 429 e o espelho no GHCR é privado;
  - `pnpm install` correu com o Node 22, embora o projecto peça o 24.

## Números (com data e como se contaram)

- 12/10/2026, local:
  - `test/envios-api.test.ts`: 9 testes, todos verdes (6 iniciais e 3 da revisão do #397);
  - com a regra desligada (`porQueNaoServe` a devolver `null`), 3 dos 6 iniciais falham;
  - sem a data-limite na impressão, o teste do P1-1 falha;
  - o `comerciante.test.ts` passou a contar 85 tabelas com RLS forçado (eram 84).

## O que ficou por verificar

- A API dos CTT (V1 a V5 do `docs/36`). Não há adaptador real no servidor: o teste de uma conta dá `shipping.carrier_unavailable`.
- A `ENVIOS_CHAVE` ainda não está na VPS.
- Os intervalos dos códigos postais dos Açores e da Madeira (as zonas ficaram por prefixos que o comerciante escreve).
