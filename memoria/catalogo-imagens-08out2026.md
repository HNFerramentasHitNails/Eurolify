# Catálogo: imagens dos artigos (API e VPS) — 08/10/2026

## O que se fez

- **Decisão CQ** (`docs/06`). Diogo, 08/10/2026: «sim, fica a (a); avança com as imagens».
  - As imagens ficam, por agora, no disco da VPS.
  - O código está preparado para um serviço europeu de ficheiros, que seria outra implementação da mesma interface. Essa implementação ainda não existe.
  - Imagens reais só depois da migração da VPS para Paris.
- **#176, juntado como f52f409.** A API das imagens:
  - **migração 0028:** as tabelas `ficheiro` e `media`, com RLS forçado e uma só principal por artigo;
  - **`armazenamento.ts`:** os ficheiros ficam no disco por comerciante e pelo resumo SHA-256; a escrita faz `fsync`, grava um `.tmp` e muda o nome no fim;
  - **as rotas:**
    - `POST /media/uploads`: só JPEG, PNG e WebP, confirmados pelos primeiros bytes, até 10 MB;
    - `POST` e `GET /products/{id}/media`;
    - `GET`, `PATCH` e `DELETE /media/{id}`;
    - `GET /media/{id}/file`, com `nosniff` e uma CSP;
  - **limites (proposta):**
    - 1 GiB por comerciante (409 `catalog.media_quota_exceeded`);
    - 2 envios em simultâneo por comerciante (429 antes de ler o corpo);
  - **a ordem do envio:** a chave de idempotência, depois o registo (na fila do comerciante, com a quota) e por fim a gravação no disco, tudo na transacção.
- **#178, juntado como a64cdbc.** A VPS:
  - a pasta `/var/lib/eurolify/media`, da API (uid 1000), montada com `--mount` e `MEDIA_PASTA`;
  - a cópia diária leva as imagens num `tar` cifrado, com os mesmos 14 dias na OVH;
  - os `.tmp` ficam de fora e o código 1 do `tar` é só aviso;
  - teste novo `infra/vps/testes/copia.sh`, com 8 casos.
- **#180, juntado como 0034290.** Ao aplicar o #178, o passo 10c do `preparar.sh` não recriou a API, porque a regra nova estava só no `eurolify-publicar` (defeito meu: não varri os dois sítios). Corrigido, com um teste que corre a função do passo 10c.
- **Revisões do agente (Claude Sonnet 5.5), publicadas nos pedidos com o tratamento:**
  - #176, 4 rondas:
    - na 1.ª, mudei o disco de ramo a meio e o revisor leu parte no `main`;
    - na 2.ª, um P1: a quota contornável com uma chave reutilizada;
    - na 3.ª, um P2: o lugar de envio largado cedo, confirmado com um servidor a escutar;
  - #178, 2 rondas (2 P1 na 1.ª: a API no ar sem a pasta, e a pasta criada como root);
  - #180, 1 ronda.
- **Issue #179** (prazo: antes da primeira imagem real, o mais tardar a 31/03/2027): tirar o EXIF, rever as imagens com pessoas e limpar os órfãos.
- **No ensaio:**
  - publicação 37780868450 (13:03 UTC): «migrar: aplicadas 0028_catalogo_media», imagem `sha256:ab100e7a19015e2bcd094948aed06b7c98b7e8645b72f22d35fb8a6bf6801b85`;
  - `aplicar-script` 37781505847 (13:04 UTC): a pasta criada, mas a API não foi recriada;
  - `aplicar-script` 37782847226 (13:15 UTC): «Recriada: … O /health da API responde.» e «A API chega à base.»

## Números (com data e como se contaram)

- 08/10/2026, `pnpm teste` local contra o PostgreSQL 18.6: API 828, MCP 58, Hub 42. `catalogo-api-media.test.ts` tem 17 testes.
- Testes da VPS (`infra/vps/testes/`, Ubuntu 26.04 descartável): 7 ficheiros, todos com código 0.
- Mutações (uma de cada vez, ficheiros repostos):
  - API, na escrita inicial: 10 feitas, 9 apanhadas, 1 redundante;
  - API, nas rondas de revisão: 15 feitas, 14 apanhadas, 1 redundante;
  - VPS: 10 de 10 no #178 e 1 de 1 no #180.

## O que ficou por verificar

- **As rotas das imagens no ensaio não foram chamadas:** a API só ouve na máquina e o MCP da VPS continua sem autorização nesta sessão. A prova é só o «Recriada… /health responde».
- **Na VPS existe a conta `ubuntu` com o uid e o gid 1000, o mesmo da API:** pode ler as imagens (aviso do `preparar.sh`, 13:04 UTC). Antes das imagens reais, a API tem de ter um uid próprio.
- A reposição das imagens é manual e não está testada (`docs/11` §3.5).
- **Por decidir:**
  - o tamanho e o custo da cópia completa diária, com imagens a sério;
  - o 409 da quota (proposta).
- Faltas escritas na `docs/14` §3.5:
  - o texto alternativo só na língua de origem;
  - sem dimensões;
  - o pool sem tempo máximo de espera;
  - o cliente lento;
  - sem teste directo de RLS nem de PATCH de principal em paralelo.
