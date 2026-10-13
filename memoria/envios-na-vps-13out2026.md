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
  Não eram só leituras (houve POST), o que a regra 1 da VPS não dá por
  livre: fica aqui registado (revisão do pedido, P3-4).

- 13/10/2026, **aplicado na VPS** (#423 junto como `a8b6033`; fluxo
  `aplicar-script`, execução 38381970891, 10:14 UTC):
  - o `--mostrar` deu 5 alterações e 1 aviso, e a aplicação deu 6
    alterações e 2 avisos (lidos no registo da execução). Os avisos: a
    chave dos envios acabou de nascer (esperado) e o do número 1000
    (`ubuntu`), que já vinha de antes;
  - feito: a lib e o `eurolify-publicar` instalados, a chave gerada, a API
    recriada (o `/health` respondeu) e o `eurolify-hub.conf` instalado,
    com o nginx recarregado (o passo 14 só recarrega depois do `nginx -t`);
  - às 10:15:20 UTC, o fluxo `publicar` do mesmo commit publicou a imagem
    `sha256:a97d1dca…`, já com o `eurolify-publicar` novo.
- 13/10/2026, fluxo `medir` (execução 38382102795, 10:15 UTC):
  - o `/health` da API deu `{"estado":"ok"}`;
  - as migrações estão iguais na base e na versão no ar (79);
  - abertas para fora, só a 22 e a 443 (`ss` e `ufw`); a 8080 da API só
    nesta máquina;
  - **O fluxo não media** se a `ENVIOS_CHAVE` chegou à API nem as
    respostas de `/webhooks/`. Pedi-las daqui ao `hub.eurolify.eu` foi
    recusado pelas permissões da sessão, e bem: a regra é medir pelo fluxo.
    Por isso o #424 acrescenta ao `eurolify-medir` a secção «envios»: a
    chave no contentor (só sim ou não) e quatro pedidos à própria máquina
    (`--noproxy` e `--resolve` para 127.0.0.1), com uma conta fictícia que
    não grava nada. O teste `publicar.sh` passou a 213 verificações verdes
    (13/10/2026, local, contadas pelas linhas `ok:`).
- Visto de passagem no `medir`: a tarefa `verificacao` **falhou** às 07:00
  UTC de 13/10/2026 (`exit-code`). Não é deste pedido: está por investigar.

## O que ficou por verificar

- **Na VPS:** a `ENVIOS_CHAVE` na API no ar e as respostas de `/webhooks/`
  (§17.2, ponto 4), pelo `medir` depois de o #424 estar aplicado; e a
  cópia da chave fora da máquina (passo do Diogo ou do Bruno, à mão).
- **O `preparar.sh --mostrar`** num Ubuntu vazio corre no GitHub (fluxo
  `script-vps`), e não aqui.
- **O nginx da VPS (Ubuntu)** é outra versão que a 1.27 do ensaio local; o
  `nginx -t` do passo 14 confere-o ao aplicar. Não há teste automático do
  nginx (revisão, P3-3).
- **O limite de 60 pedidos por minuto** não tem fonte: revê-se com os
  avisos reais (revisão, P2-1).
