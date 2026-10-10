# A imagem da base de dados do ensaio trocada (10/10/2026)

Decisão do Diogo, 10/10/2026: *«sim, troca hoje às 23:00»*, corrigida logo a
seguir para *«não, troca agora»*, na sessão do Claude Code
https://claude.ai/code/session_01P2HbURVqRS19Rd9LY9zFNL. A descrição do
[#316](https://github.com/HNFerramentasHitNails/Eurolify/pull/316) cita-a. A vigilância das imagens (#308, `docs/06` DH)
encontrou uma reconstrução da `postgres:18.6`.

## O que se fez

- **[#316](https://github.com/HNFerramentasHitNails/Eurolify/pull/316)** (squash `2affa06`): o `preparar.sh` passou a saber trocar a imagem
  da base, só com a autorização `TROCAR_POSTGRES_PARA` no `ensaio.conf`, igual
  a `IMAGEM_POSTGRES`. Fá-lo pela ordem:
  1. fora do horário de trabalho;
  2. descarregar a imagem nova;
  3. a mesma versão maior;
  4. a cópia desta execução;
  5. parar a base e guardar o contentor antigo;
  6. arrancar o novo com o mesmo volume;
  7. se não responder em 60 s, ou se o processo for interrompido, voltar ao
     antigo;
  8. reiniciar a API.

  Revisão de agente (Sonnet 5.5) publicada e tratada no pedido:
  [a revisão](https://github.com/HNFerramentasHitNails/Eurolify/pull/316#issuecomment-6099957631) e
  [o que se fez com ela](https://github.com/HNFerramentasHitNails/Eurolify/pull/316#issuecomment-6099977768).
- **Na VPS**, fluxo `aplicar-script`,
  [corrida 38070435075](https://github.com/HNFerramentasHitNails/Eurolify/actions/runs/38070435075), com êxito. O registo
  diz:
  - `a fazer: trocar a imagem do eurolify-postgres para mirror.gcr.io/library/postgres:18.6@sha256:74935e72… (cópia antes; era postgres:18.6@sha256:5a5a84b1…)`
  - `cópia da base feita`
  - `a base responde com mirror.gcr.io/library/postgres:18.6@sha256:74935e72…`
  - `a fazer: reiniciar o eurolify-api depois da troca da base`
  - um aviso: `o Hub não respondeu como devia: /entrar 200, /hub/me 502 (esperava 401)`. Foi a verificação feita durante o reinício da API (ver os números).
- **Este pedido** tira o `TROCAR_POSTGRES_PARA` do `ensaio.conf`: deixado,
  a próxima mudança das duas linhas trocava a base sem decisão nova
  ([revisão do #316](https://github.com/HNFerramentasHitNails/Eurolify/pull/316#issuecomment-6099957631), P3-2). O
  mecanismo fica no `preparar.sh` de propósito, para uma troca futura com uma
  decisão nova.

## Números (com data e como se contaram)

Medidos pelo Claude nesta sessão (ligação acima), neste contentor, com
`docker` e `curl`. O registo da corrida está na ligação da corrida.

- **O que mudou na imagem.** Comparação pacote a pacote (`dpkg-query`) das
  duas imagens, 10/10/2026:
  - o PostgreSQL é o mesmo, `18.6 (Debian 18.6-1.pgdg13+2)`;
  - `openssl`, `libssl3t64`, `openssl-provider-legacy` e `libpcre2-8-0`
    passaram de `deb13u2` a `deb13u3`;
  - a `libicu76` não mudou.
- **Datas de criação** (`docker inspect`): a imagem antiga a 19/09/2026, a
  nova a 06/10/2026. O resumo novo `74935e72…` é o mesmo no `mirror.gcr.io` e
  no Docker Hub.
- **Depois da troca, 17:15 UTC.** A API, ao `/hub/me` com um segredo de
  sessão bem formado mas inventado (`eus_` e 32 bytes), respondeu 401 em
  0,40–0,42 s, três vezes. Para o recusar, a API procura-o na base. Também:
  `/hub/me` sem sessão deu 401 e `/entrar` deu 200.
- **Teste local da troca** (Docker verdadeiro, as funções do `preparar.sh`),
  8 casos ok:
  - a troca mantém o dado e fica com a `libssl` `deb13u3`;
  - a cópia é feita antes;
  - sem cópia, não troca;
  - se a nova não arranca, volta à antiga;
  - interrompida a meio, volta à antiga;
  - o regresso fica registado;
  - em horário de trabalho, não troca;
  - a recusa fica registada.

  O guião não está no repositório: precisa de um Docker a correr.

## O que ficou por verificar

- A imagem em uso lida directamente na máquina (`docker inspect` na VPS).
  Afirma-o o registo da corrida; não a li.
- Que a cópia feita antes da troca se repõe. O ensaio de reposição de
  domingo, 04:00 UTC, confere a última.
- Que falha de segurança corrige o OpenSSL `deb13u3`. Só se viu a versão.
- Quanto tempo a base esteve parada: o registo não tem a hora de cada passo.
