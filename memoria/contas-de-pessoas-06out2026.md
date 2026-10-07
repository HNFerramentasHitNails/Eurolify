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
  abertas, códigos de recuperação, recuperar, entradas; migração 0022 — a 0021 foi do #143), B3b
  (palavra-passe + TOTP), B3c (chaves pelo Hub).
- **B3a juntado e publicado** (#144; corrida 37594866373: «migrar:
  aplicadas 0022_identidade_recuperacao»). Revisão Opus 5.5: 0 P0, 0 P1, 5
  P2, 10 P3. Decisão CI (07/10/2026): o limite conta por e-mail e por IP (a
  CH foi do #143, que também levou a 0021).
- **B3b (#147):** palavra-passe + TOTP, migração 0024 (o #146 juntou
  primeiro com a 0023), `@node-rs/argon2` 2.2.1 e `otplib` 13.5.0; a chave `TOTP_CHAVE`
  fora da base. A 2.2.2 do Argon2 (publicada a 06/10/2026) não se usa: o
  pnpm 12 recusa versões com menos de um certo tempo publicadas e pedia uma
  excepção no `pnpm-workspace.yaml`; a 2.2.1 (10/09/2026) cumpre sem ela.
  `npm audit` da 2.2.1: 0 vulnerabilidades (07/10/2026).
- **B3b juntado e publicado** (#147; corrida 37603564234: «migrar:
  aplicadas 0024_identidade_palavra_passe»). Revisão Opus 5.5: 1 P1 (o
  limite não aguentava pedidos em paralelo), tratado.
- **B3c juntado e publicado** (#149; corrida 37617162110: «migrar:
  aplicadas 0025_identidade_chaves_pela_sessao»). Decisão CK: as chaves
  públicas ficam quando quem as criou sai.
- **B4 juntado e publicado** (#152; corrida 37628571362: «migrar:
  aplicadas 0026_identidade_prazos», /health responde; o script da VPS,
  corrida 37628571164, «4 alteração(ões) feita(s)»: a `eurolify-limpeza` e
  a `eurolify-verificacao` novas). Revisão do Codex no #152: 2 P2 tratados
  (a verificação conta todas as categorias; apagar em lotes de 50 000).
- **Limite geral por IP (07/10/2026, em curso):** na API, nas rotas do Hub
  (`docs/21` §14): 20/min nas públicas, 300/min em todas, IPv6 por /64,
  429 com `Retry-After`; `PROXY_CONFIAVEL` para o `trustProxy` (só
  endereços exactos). O `hub-sessoes.test.ts` mandava tudo do mesmo IP e
  esbarrou no limite: passou a um IP por pedido.
  Revisão Opus 5.5 (#154): 0 P0, 1 P1, 1 P2, 9 P3. P1-1: na VPS a API
  vê o gateway da rede Docker, não o cliente — com a `HUB_ORIGEM` a API não
  arranca sem `PROXY_CONFIAVEL`, e ao ligar fixa-se a rede e mede-se (§12).
  P2-1: pedidos de outro site gastavam o limite — a origem confere-se antes
  de contar.
- **B4 (desenho e código, 07/10/2026):** a tarefa dos prazos, migração 0026
  (`docs/21` §13): `contas_aplicar_prazos()` na `eurolify-limpeza` das
  05:00 e `contas_prazos_em_atraso()` na verificação das 07:00, só com o
  `EXECUTE` para o `eurolify_limpeza`. Os gatilhos da 0018 só deixam apagar
  uma sessão e pseudonimizar um convite ou uma pessoa com o prazo passado.
  Um teste antigo (`identidade-pessoas`, «nada se apaga») apanhou um erro:
  no PL/pgSQL, `TG_TABLE_NAME = 'sessao' AND sessao_fim(OLD)` falha nas
  outras tabelas (o OLD não é `sessao`); vai em dois IF.
  Revisão Opus 5.5 (#152): 0 P0, 0 P1, 2 P2, 4 P3, tratados. P2-1: uma
  credencial gravada enquanto a limpeza pseudonimiza a pessoa ficava para
  sempre (gatilho que relê a pessoa). P2-2: impasse passkey → pessoa
  contra pessoa → passkey anulava a corrida inteira (subtransacção por
  pessoa, espera de 2 s, `pessoas_adiadas`).
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
- 07/10/2026, `pnpm run teste` local (PostgreSQL 18.6) com a B4: API 673,
  MCP 58. Provas por mutação da B4: tirar o prazo do gatilho da sessão, da
  pessoa ou do convite, pôr 13 dias nas entradas ou tirar o `SKIP LOCKED`
  faz falhar 1 a 4 dos 9 testes de `contas-prazos.test.ts`.
  Depois da revisão: 13 testes; API 694, MCP 58. Tirar o gatilho da
  credencial, a subtransacção ou o `least` do fim faz falhar o teste de
  cada um.
- 07/10/2026, programa `eurolify-limpeza` corrido contra uma base local
  migrada até à 0026 (com o `docker` substituído por um `psql` local):
  «prazos das contas: entradas=1 codigos_usados=0 … convites=0», saída 0;
  sem o EXECUTE, saída 1 e «limpeza falhou» no registo; sem a função
  (antes da 0026), só a idempotência, saída 0. O `eurolify_limpeza` lê a
  `entrada`? Não: «permission denied for table entrada».
- Publicação do #141 (corrida 37495008666): «migrar: aplicadas
  0018_identidade_pessoas»; «O /health da API responde».

- 07/10/2026, limite por IP: `pnpm run teste` local, API 703, MCP 58;
  tirar o gancho, contar o IPv6 inteiro ou tirar o limite das públicas faz
  falhar 4, 2 e 3 dos 9 testes de `limite.test.ts`.

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
