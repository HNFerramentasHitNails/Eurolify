# Envios na VPS de ensaio: a chave e os avisos (13/10/2026)

Pedido do Diogo, 13/10/2026: *«sim, aprovo; avança com o código»*, sobre o
desenho do `docs/36` §17 (issue #393).

## O que se fez

- **A chave dos envios** (`/etc/eurolify/api-envios.env`): gera-se uma vez
  no passo 10 do `preparar.sh`, como a do TOTP, e o `eurolify-publicar` só
  a passa à API se for válida.
- **O nginx do Hub** publica só o caminho dos avisos da Sendcloud,
  `POST /webhooks/carriers/sendcloud/cac_<uuid>`, com limite de pedidos. O
  resto de `/webhooks/` dá 404.
- **O Hub** deixa de dizer que os avisos não chegam.

## Números (com data e como se contaram)

- 13/10/2026, local:
  - o teste da chave: 21 verificações, verdes;
  - o teste da publicação: 198 verificações, verdes;
  - `shellcheck` sem avisos.
- 13/10/2026, nginx 1.27 local: as medições da tabela do §17.5 do
  `docs/36`.
- **Por engano**, ao medir, o `curl` saiu pelo proxy deste ambiente e foi ao
  `hub.eurolify.eu` verdadeiro. Foram:
  - cerca de 40 pedidos, entre GET e POST;
  - os POST levaram 405 do nginx da VPS;
  - o `/hub/me` levou 401.

  Nada mudou na VPS. As medições locais repetiram-se com `--noproxy`.

## O que ficou por verificar

- **Na VPS:** a chave gerada, a API com os envios, as medições do §17.2 e a
  cópia da chave fora da máquina (passo do Diogo, à mão).
- **O `preparar.sh --mostrar`** num Ubuntu vazio corre no GitHub (fluxo
  `script-vps`), e não aqui.
