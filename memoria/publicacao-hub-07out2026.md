# Publicação do Hub em `hub.eurolify.eu` (#156) — 07/10/2026

## O que se fez

Pedido do Diogo, 07/10/2026 (*«sim, avança com a publicação do Hub»*).
Desenho no `docs/22` §7; passo 14 no `infra/vps/LEIA-ME.md`.

- `Dockerfile`: a imagem da API leva também os ecrãs do Hub em `/app/hub`.
- `eurolify-publicar`: copia os ecrãs da imagem para
  `/var/lib/eurolify/hub/<resumo>` e troca a ligação `actual`; guarda 3; também
  ao voltar atrás. Se a cópia falhar, avisa e não desfaz a API.
- `nginx-hub.conf`: os estáticos, `/hub/` para a API com o `X-Forwarded-For`
  reescrito, cabeçalhos de segurança, `index.html` sem cache.
- `preparar.sh`, passo 14: certificado pelo desafio DNS da OVH (só com o
  nome a resolver), site ligado com o `nginx -t`, `api-hub.env` com a
  `HUB_ORIGEM` e a `PROXY_CONFIAVEL` = gateway da rede `eurolify` lido em cada
  corrida (em vez de fixar a sub-rede, como dizia o rascunho do §7).

## Números (com data e como se contaram)

- 07/10/2026, `getent ahostsv4 hub.eurolify.eu` na sessão: nada (o registo A
  não existe); `mcp.eurolify.eu` → 57.129.168.39. Mais tarde, no mesmo dia,
  depois de o Diogo criar o registo (*«hub.eurolify.eu ja adicionei nos
  record»*): `hub.eurolify.eu` → 57.129.168.39.
- 07/10/2026, `infra/vps/testes/publicar.sh` corrido na sessão: 150 ok.
- 07/10/2026, nginx local com esta configuração (sem a linha IPv6) e a API
  verdadeira (`PROXY_CONFIAVEL=127.0.0.1`), com `curl --interface`: 20
  `POST /hub/session/options` de 127.0.0.2 deram 200 e o 21.º 429
  (`Retry-After: 60`); 127.0.0.3 deu 200; um `X-Forwarded-For: 9.9.9.9`
  vindo de 127.0.0.2 deu 429; `Origin` de outro site deu 403; `/hub/me` 401;
  `/entrar` 200.

- 07/10/2026, revisão Opus 5.5 do #160: 0 P0, 1 P1, 2 P2, 12 P3. P1-1
  medido (nginx local): `/products/a%2F..%2F..%2Fhub%2Fb` → 401 da rota
  `/products` da API; depois da correcção, nenhum caminho codificado chega à
  API (404, ou 200 com a página do Hub quando a normalização dá `/products`;
  corrigido na revisão do #162, P3-B). P2-1: teste
  novo («a ligação dos ecrãs não se troca»), que falhava no script antigo
  (3 FALHOU) e passa no novo; `publicar.sh` passou a 154 ok.

- 07/10/2026, no ensaio. O #160 foi juntado às 17:00:57 com o commit
  anterior às correcções da revisão (o GitHub dava 500 aos envios); as
  correcções entraram pelo #162 (`9114a37`, 17:16). Registo do
  `aplicar-script` do #160: certificado de `hub.eurolify.eu` emitido (até
  05/01/2027), site ligado, `api-hub.env` escrito, API recriada; a
  publicação (17:09) pôs os ecrãs. Registo do `aplicar-script` do #162:
  `nginx-hub.conf` novo instalado e nginx recarregado; «o Hub abre (/entrar
  200) e a API do Hub responde (/hub/me 401 sem sessão)».
- 07/10/2026, de fora, pelo proxy da sessão, depois do #162: `/entrar`,
  `/convite`, `/equipa`, `/` 200 (título «Eurolify Hub»); `/hub/me` 401;
  `/products/a%2F..%2F..%2Fhub%2Fb` 404; `/hub/..%2Fproducts` e `/products`
  200 (a página do Hub, não a API); 5 cabeçalhos de segurança presentes;
  `index.html` `no-cache`, `assets/` cache longa. Um pedido em cada lote
  deu `000` (sem resposta em 20 s) e repetido deu 200 — causa não
  verificada (o proxy de saída da sessão ou a VPS).

## O que ficou por verificar

- Na VPS: se o limite por IP conta cada cliente à parte (a sessão sai sempre
  pelo mesmo endereço); se o `stat` aceita `%.9Y`.
- Se a chave da OVH da VPS pode criar o registo `hub` (por isso fica à mão).
- O cookie `__Host-` pelo nginx verdadeiro (só medido pelo «proxy» das
  capturas).
- **Ninguém consegue entrar ainda**: o fluxo `operar` não tem a acção
  `convite` para o primeiro dono (a função da base existe).
