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

## O que ficou por verificar

- Na VPS: nada, até este pedido entrar e o `preparar.sh` correr (o
  `aplicar-script` corre com o push em `infra/vps/**` que este pedido leva).
- Se a chave da OVH da VPS pode criar o registo `hub` (por isso fica à mão).
- O cookie `__Host-` pelo nginx verdadeiro (só medido pelo «proxy» das
  capturas).
- **Ninguém consegue entrar ainda**: o fluxo `operar` não tem a acção
  `convite` para o primeiro dono (a função da base existe).
