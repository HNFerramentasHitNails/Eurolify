# O envio de e-mails chega à VPS pelo GitHub (#372) — 12/10/2026

## O que se fez

- **O Diogo, a 12/10/2026:**
  - criou a conta `avisos@eurolify.eu` na OVH;
  - criou os cinco segredos `SMTP_*` no ambiente `ensaio` do GitHub (vi a
    lista dos nomes numa captura dele; os valores não);
  - configurou a zona DNS de `eurolify.eu`.
- **Decisão do Diogo:** à pergunta «por que porta entram os dados?»
  respondeu *«a»*: uma acção e uma chave próprias (`configurar`), e não a
  chave do `operar`.
- **Código** (pedido do ramo `vps-configurar-smtp`):
  - a acção `configurar.yml`;
  - o fluxo `configurar` no `eurolify-pedido` e no `eurolify-trabalho`;
  - o `eurolify-configurar`, que valida os cinco valores e escreve o
    `api-smtp.env` (600, root);
  - o `eurolify-publicar` e o passo 10c passam o ficheiro à API;
  - o utilizador e a pasta no passo 11.
  - Desenho em `docs/34` §13.
- **A chave do fluxo `configurar`** (12/10/2026): o Diogo criou-a no computador dele, guardou a parte privada no segredo `VPS_CHAVE_CONFIGURAR` do ambiente `ensaio` e colou a pública, que entrou em `infra/vps/chaves/fluxos/configurar.pub` (ed25519, impressão `SHA256:h38JE67Leg8JbDeKgnrBlGbRObNRKLcqSb6++lh7Uzg`, calculada da linha). O `aplicar-script` instala-a ao juntar. O SPF ficou com um registo só (`v=spf1 include:mx.ovh.com -all`, lido em `dns.google` a 12/10/2026).
- **A acção `configurar` correu** (12/10/2026, corrida 38263297038, lançada pelo Diogo, verde): escreveu o `/etc/eurolify/api-smtp.env` (5 variáveis), recriou a API com a imagem que estava no ar (`sha256:a67a5c48…`), o `/health` responde, a API chega à base e corre com a configuração do e-mail (lido no registo da corrida).

## Números (com data e como se contaram)

- **DNS de `eurolify.eu`**, lido a 12/10/2026 em `dns.google/resolve`:
  - **TXT:** dois SPF, `v=spf1 include:mx.ovh.com ~all` e
    `v=spf1 include:mx.ovh.com -all`. Com dois, o SPF dá erro (RFC 7208,
    §4.5), e foi pedido ao Diogo que tire um;
  - **TXT `_dmarc`:** `v=DMARC1; p=none; rua=mailto:avisos@eurolify.eu`;
  - **MX:** `mx1`, `mx2` e `mx3.mail.ovh.net`.
- **Testes**, 12/10/2026, num contentor Ubuntu:
  - `infra/vps/testes/configurar.sh`: todas as verificações passam. Cobrem
    a escrita, o mesmo pedido sem mudança, 10 recusas e a palavra-passe
    nunca na saída nem no registo;
  - os outros oito testes da VPS passam; o `pedido.sh` foi alargado aos
    limites do `configurar`;
  - `preparar.sh --mostrar` passa.

## O que ficou por verificar

- O DKIM: o selector vem do painel da OVH e não o li.
- O primeiro e-mail real: a API tem a configuração (12/10/2026), mas não vi
  nenhum sair nem chegar, nem se a OVH aceita o início de sessão (só se sabe
  no primeiro envio, no estado da notificação).
- Se a conta é Email Pro ou MX Plan: o painel mostra 1 GB, e não sei se
  isso corresponde à Email Pro.
