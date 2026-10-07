# Hub: os primeiros ecrãs (#156) — 07/10/2026

## O que se fez

Decisão do Diogo, 07/10/2026 (*«sim, concordo, fica a a)»*): primeiro os
ecrãs mínimos do Hub, depois a publicação em `hub.eurolify.eu`, só com contas
de teste (ADR-0019). Desenho em `docs/22`.

- `apps/hub`: React 19.3.0 + Vite 8.3.2, estático (ADR-0025). Ecrãs: entrar
  com passkey, aceitar convite com conta nova (e os 10 códigos de
  recuperação, uma vez), os comerciantes de quem entrou, a equipa (membros,
  convites em aberto, convidar, cancelar), sair. PT/ES/EN. Claro e escuro.
- O segredo do convite vai no fragmento (`/convite#euc_…`): o navegador não
  o envia; o ecrã tira-o da barra de endereço.
- Tokens **provisórios** (D-12 por decidir) em `src/tokens.css`; um teste
  mede os contrastes nos dois temas.
- `scripts/capturas.mjs`: base nova + API com o Hub + «proxy» HTTPS local +
  Chromium com o autenticador virtual (CDP `WebAuthn.addVirtualAuthenticator`)
  — percorre o fluxo inteiro e tira 27 capturas.
- As versões recentes recusam-se pela idade mínima do pnpm (a do Argon2 2.2.2
  foi um caso): escolhidas `@vitejs/plugin-react` 6.1.1 (28/08) em vez da
  6.1.2 (05/10) e `vite` 8.3.2 (01/10), a do ADR-0025.

## Números (com data e como se contaram)

- 07/10/2026, `pnpm run teste` local (PostgreSQL 18.6): Hub 32, MCP 58, API
  735 (com o #153 no main); `pnpm audit`: «No known vulnerabilities found».
- 07/10/2026, `capturas.mjs`: 31 verificações certas (o segredo sai da barra,
  10 códigos, convidar dá a ligação com `#`, sair e entrar outra vez com a
  passkey, nenhum pedido leva o segredo, o primeiro Tab é o salto, e nenhum
  dos 24 ecrãs tem deslocação horizontal).
- Primeiras capturas: os códigos partiam-se a meio a 375 px e o quadro
  «Convidar» encostava à tabela — corrigido e visto outra vez.

- **OK ao aspecto provisório:** Diogo, 07/10/2026 (*«sim, dou o OK ao
  aspecto provisório»*), sobre 7 capturas enviadas. A identidade visual
  continua por decidir (D-12).

- **Revisão Opus 5.5 (#158):** 0 P0, 0 P1, 4 P2, 12 P3. P2-1: o segredo
  do convite fica no histórico do navegador (medido no Chromium) — escrito
  no `docs/22` §2 e no aviso a quem convida; o prazo mais curto ficou
  por decidir — **decidido depois: fica nos 7 dias** (Diogo, 07/10/2026,
  *«fica nos 7 dias, junta o #158»*). P2-2: o gestor só vê armazém e apoio. P2-3: mais códigos com
  texto nas três línguas. P2-4: o `capturas.mjs` passou a 41 verificações
  (reautenticação, passkey recusada, cancelar duas vezes, rede, ligação
  estragada, gestor, apoio); fica manual, fora do CI.

## O que ficou por verificar

- Passkeys em navegadores e telemóveis reais (só o autenticador virtual).
- A publicação: tratada em `publicacao-hub-07out2026.md`.
