# Contas de pessoas (identidade, parte B) — código, 06/10/2026

Issue #140; desenho aprovado no `docs/21` (Diogo, 06/10/2026).

## O que se fez

- **B1 (#141, juntado e publicado):** migração `0018_identidade_pessoas` —
  pessoa, membro, convite, sessão e o rasto `evento_conta`; as regras dos
  papéis na base. Revisão do agente (Opus 5.5): 0 P0, 1 P1, 4 P2, 10 P3,
  tratados. P2-1 decidido pelo Diogo (CE): o e-mail do convite fica sem
  confirmação até ao primeiro comerciante real ou 31/03/2027.
- **B2 (#142, em curso):** migração `0020_identidade_passkeys` (a 0019 foi do #139) (passkey,
  desafio_webauthn, portas da API), rotas do Hub do `docs/21` §11,
  autenticador WebAuthn de teste em `apps/api/test/autenticador-de-teste.ts`.
- **B2 juntado e publicado** (#142; corrida 37501816877: «migrar: aplicadas
  0020_identidade_passkeys», /health responde). Revisão Opus 5.5: 0 P0, 0
  P1, 5 P2, 10 P3; tratados menos o P3-8. Decisão CG: Argon2id 64 MiB
  (RFC 9106 §4).
- **B3 em três pedidos** (docs/21 §12): B3a (#144: passkeys, sessões
  abertas, códigos de recuperação, recuperar, entradas; migração 0021), B3b
  (palavra-passe + TOTP), B3c (chaves pelo Hub).
- O #139 (Catálogo, outra sessão) também queria a 0018 e a 0019: quem junta
  em segundo renumera (avisos no #139).

## Números (com data e como se contaram)

- 06/10/2026, `npm audit` num pacote só com `@simplewebauthn/server@14.0.3` e
  `@fastify/cookie@11.1.2` (92 linhas no `npm ls --all`): 0 vulnerabilidades.
- 06/10/2026, `pnpm run teste` local (PostgreSQL 18.6): API 538, MCP 58 (B2);
  API 594, MCP 58 (B3a, com o #139 no main).
- 06/10/2026, `npm audit` com `otplib@13.5.0` e `@node-rs/argon2@2.2.2`: 0
  vulnerabilidades; a imagem é Debian (`trixie-slim`), com o binário
  `linux-x64-gnu` do Argon2.
- Publicação do #141 (corrida 37495008666): «migrar: aplicadas
  0018_identidade_pessoas»; «O /health da API responde».

## O que se leu no código das bibliotecas (06/10/2026)

- `verifyAuthenticationResponse` e `verifyRegistrationResponse`: exigem a
  verificação do utilizador por omissão; comparam a origem e o rpID
  exactamente; recusam o contador que não avança (quando um dos dois não é
  0). As mensagens de erro trazem o desafio e a origem: não se registam.
- `generateAuthenticationOptions`: `userVerification` por omissão
  `preferred` — passa-se `required`. Desafio de 32 bytes aleatórios.
- `@fastify/cookie`: `sameSite` por omissão `lax` e sem `secure` — o
  código passa sempre `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`.
- O PostgreSQL recusa repetições `{m,n}` acima de 255 numa expressão
  regular («invalid repetition count»): os limites de comprimento vão num
  `length()` à parte.

## O que ficou por verificar

- O código que verifica as assinaturas (`@peculiar/*`) e as dependências
  além do `npm audit`.
- O WebAuthn com um navegador e um telemóvel verdadeiros: só com o
  autenticador de teste.
- As tabelas novas na VPS: só pelo registo da publicação.
