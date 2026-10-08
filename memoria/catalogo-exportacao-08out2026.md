# Catálogo: exportação completa (Data Act) — 08/10/2026

## O que se fez

- **Desenho e decisão CS** (`docs/06`). Diogo, 08/10/2026: «sim, avança com o desenho da exportação», depois «sim, aprovo; avança com o código da exportação» e, por fim, «sim» ao limite de 3 por expirar.
- **#189, juntado como 7daa226:**
  - **migração 0030:** a tabela `exportacao`, com RLS; a API só insere e lê; o prazo de 7 dias é posto pela base;
  - **o recurso comum `POST /exports`** com `{"dominios":["catalogo"]}` e âmbito `catalog:read`, mais `GET /exports`, `GET /exports/{id}` e `GET /exports/{id}/file`;
  - **o ZIP:**
    - `catalogo.json` (o completo) e 12 CSV (RFC 4180, BOM, guarda contra fórmulas);
    - as imagens em `imagens/<resumo>`;
    - todos os estados, sem `*_por`, sem preços e sem stock;
  - **o escritor de ZIP é próprio** (`exportacao/zip.ts`): sem ZIP64, até 65 534 ficheiros e 4 GiB;
  - **como corre:**
    - leitura de um momento só (REPEATABLE READ), e o ZIP faz-se depois, sem a base presa;
    - uma exportação de cada vez por comerciante (429);
    - no máximo 3 por expirar (409 `export.limit_reached`);
    - antes de cada pedido, a pasta do comerciante é limpa do que está parado há mais de uma hora;
    - a chave de idempotência confere-se antes de fazer o ZIP;
  - **VPS:** a cópia diária (`eurolify-copia`) deixa `media/.exportacoes` de fora, no `tar` e no `du`.
- **Revisão do agente (Claude Sonnet 5.5), 2 rondas, publicadas no pedido com o tratamento:**
  - 1.ª ronda: um P1, o disco sem limite nem limpeza;
  - 2.ª ronda: dois P2, a limpeza em corrida entre instâncias e um erro de ficheiro a fazer falhar o pedido.
- **Issue #179:** comentário a juntar a limpeza geral das exportações (os ZIP de quem não volta a pedir e as linhas expiradas).
- **Publicado no ensaio:**
  - publicação 37803283411: «migrar: aplicadas 0030_exportacoes», imagem `sha256:b4394348ec7079bdade823edd6c91ba481f685ece050a4f50035068bcd7ab650`, «A API chega à base»;
  - `aplicar-script` 37803282796: «1 alteração(ões) feita(s)» (instalou o `eurolify-copia` novo).

## Números (com data e como se contaram)

- 08/10/2026, `pnpm teste` local contra o PostgreSQL 18.6, na versão final: API 855, MCP 58, Hub 53.
- `exportacao.test.ts`: 17 testes (10 na escrita inicial, 7 nas revisões).
- Mutações, uma de cada vez, com os ficheiros repostos:
  - escrita inicial: 11 de 11 (API 10, VPS 1);
  - 1.ª ronda: 8 de 8;
  - 2.ª ronda: 2 de 4. As duas que passaram retiram, cada uma, uma de duas guardas sobrepostas.

## O que ficou por verificar

- **Não medi o tempo nem a memória de uma exportação grande.** A compressão é síncrona e pode parar a API; medir no ensaio antes de abrir a comerciantes.
- **Não há tecto para o disco todo**, só por comerciante. A rede é o alerta de disco da VPS.
- **Ficam até à limpeza geral (#179):** os ZIP de quem não volta a pedir e as linhas expiradas.
- **Não há teste:**
  - do valor de `loja` numa publicação;
  - do limite de bytes do escritor (pede 4 GiB);
  - de um `unlink` que falha a sério.
- **Sem registo de auditoria** das exportações e das descargas.
- **Não verifiquei:**
  - o que o Data Act exige ao Eurolify (lido só em resumos);
  - como o Excel em português abre CSV com vírgula.
- As rotas no ensaio não foram chamadas (o MCP da VPS continua sem autorização nesta sessão).
