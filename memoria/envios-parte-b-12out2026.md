# Envios, parte B — etiquetas, seguimento e avisos (12/10/2026)

Pedido do Diogo, 12/10/2026: *«depois avança com a parte B dos envios»*
(#393, decisão ED). O que está no código está no `docs/36` §15.

## O que se fez

- Migração 0078, com:
  - a etiqueta na expedição;
  - o ficheiro dela, na base;
  - os eventos de seguimento, só acrescentados;
  - os avisos em bruto;
  - a porta dos avisos;
  - o trabalho da API (`trabalho_envio`);
  - o gatilho que, num apagamento do titular, leva a etiqueta e resume os avisos.
- `src/envios/etiquetas.ts`:
  - pedir, anular e resolver a incerta;
  - o seguimento por consulta e por aviso;
  - perdida ou devolvida abre um problema;
  - a volta de 5 em 5 minutos.
- `test/transportadora-falsa.ts`: a transportadora de ensaio com o contrato inteiro.
- **Sem o adaptador real dos CTT**: a pesquisa de 12/10/2026 (W, resumos) não encontrou documentação pública da API de envios; pede-se ao gestor comercial, com contrato CTT Expresso.

## Números (com data e como se contaram)

- 12/10/2026, local, `test/envios-etiquetas.test.ts`: 6 testes verdes no primeiro commit; 11 depois da revisão do agente (P1 e P2 tratados, docs/36 §15).
- 12/10/2026, local, a suite inteira no primeiro commit: 1498 verdes, 1 saltado.
- `comerciante.test.ts`: passou a contar 88 tabelas com RLS forçado (eram 85).

## O que ficou por verificar

- A API dos CTT (V1 a V5 do `docs/36`).
- Sem teste:
  - o apagamento do titular a levar a etiqueta e a limpar avisos e eventos;
  - o problema da incerta sem resposta há um dia;
  - um evento que o armazém recuse (o ponto de retorno);
  - o resumo dos avisos aos 30 dias.
- Os P3 da revisão que ficaram estão no docs/36 §15.
- A `ENVIOS_CHAVE` continua fora da VPS: sem ela a volta dos envios não arranca.
