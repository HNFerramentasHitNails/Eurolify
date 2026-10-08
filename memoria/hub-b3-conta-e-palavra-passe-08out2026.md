# Hub B3a e B3b: a minha conta, recuperar e a palavra-passe com código QR — 08/10/2026

Pedido do Diogo, 08/10/2026: *«sim, avança com os ecrãs da parte B3»*;
*«sim, com código QR, avança com a B3b»*; *«sim, prepara o pedido da chave
na VPS»*. Issue #156; desenho em `docs/22` §9.

## O que se fez

- **B3a (#174, f3564ca):** `/conta` (passkeys: acrescentar, retirar, a
  última recusada; sessões abertas e terminar as outras; códigos de
  recuperação) e `/recuperar` (e-mail, código, passkey nova; aviso depois).
  Revisão Opus 5.5: 0 P0, 1 P1 (um 401 numa acção mandava para «Entrar»
  com a sessão aberta: agora confirma-se com o `/hub/me`), 4 P2, 8 P3.
- **B3b (#177, 486e265):** migração **0029** (o `/hub/me` diz
  `palavra_passe`: activa, pendente ou null, só com a `TOTP_CHAVE`); na
  conta, activar (código QR + segredo + primeiro código), trocar e retirar;
  «Entrar com palavra-passe». Código QR com a `uqr` 0.1.3 (MIT, sem
  dependências). Revisão do Hub: 0 P0, 0 P1, 3 P2, 9 P3.
- **Chave TOTP na VPS (#177):** o passo 10 do `preparar.sh` gera
  `/etc/eurolify/api-totp.env` (600, root) uma vez e nunca o reescreve;
  `infra/vps/ficheiros/lib/chave-totp.sh` valida e gera; o
  `eurolify-publicar` só passa uma chave válida. Revisão da VPS: 0 P0, 0
  P1, 4 P2, 6 P3, todos tratados.
- **Alteração à máquina (AGENTS.md, «Operar a VPS», regra 6):** fluxo
  «aplicar-script», corrida 37783826567, 13:22: «gerar a chave dos
  segredos TOTP em /etc/eurolify/api-totp.env», «instalar
  /usr/local/lib/eurolify/chave-totp.sh», API recriada com a mesma imagem
  (/health e base ok). Publicação, corrida 37783827214, 13:27: «migrar:
  aplicadas 0029_identidade_eu_palavra_passe».
- O número da migração passou de 0028 a 0029: o #176 (imagens) juntou
  primeiro com a 0028. O `main` avançou três vezes durante o #177 (#176,
  #178, #180), sempre com a outra sessão nos mesmos ficheiros da VPS.

## Números (com data e como se contaram)

- Testes do Hub: 47 passam (`pnpm teste`, 08/10/2026).
- API: 830 testes em 44 ficheiros, depois de juntar o #176 (08/10/2026).
- `capturas.mjs` (Chromium, passkeys em software, API verdadeira): 84
  verificações em 84, 5 corridas seguidas (08/10/2026).
- Testes da VPS depois do #180: `publicar` 170, `chave-totp` 20, `copia`
  37, outros 90; nenhum falhou (neste contentor descartável, 08/10/2026).
- No ensaio, às 13:3x de 08/10/2026: `POST /hub/session/password` 401 (era
  404 antes da chave); `/hub/me` sem sessão 401; o código servido tem «Entrar
  com palavra-passe» e o código QR.

## O que ficou por verificar

- O código QR lido por uma aplicação de autenticação real (só o OpenCV o
  leu, nas capturas clara e escura).
- As passkeys em navegadores reais (Safari, Chrome no Android, Firefox).
- **Cópia da chave TOTP fora da máquina**: por fazer, à mão, pelo Diogo ou
  pelo Bruno (`infra/vps/LEIA-ME.md`, «A chave dos segredos TOTP»).
- Por decidir: a reautenticação só com a palavra-passe (`docs/22` §9.2) e o
  429 do bloqueio por conta que revela a conta (revisão do #177, P3-9).
- B3c (chaves de API pelo Hub) por fazer.
