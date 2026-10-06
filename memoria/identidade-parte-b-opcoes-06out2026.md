# Identidade, parte B — as opções para as contas de pessoas (06/10/2026)

Pergunta do `docs/19` §7 (P1): construir com uma biblioteca na API, alojar um
servidor de identidade aberto na VPS, ou um fornecedor gerido na UE.
Preparação para a decisão do Diogo ou do Bruno; **nada decidido aqui**.

## O que se fez

- Pesquisa por um agente (Sonnet 5.5, 06/10/2026), lendo as páginas oficiais
  com o WebFetch, que as resume com um modelo pequeno: **os números vêm desses
  resumos e reconfirmam-se antes do ADR**.
- Medição da VPS pelo fluxo `medir` (ADR-0028), corrida
  https://github.com/HNFerramentasHitNails/Eurolify/actions/runs/37450923421,
  06/10/2026 10:36 UTC.

## Números (com data e como se contaram)

**VPS do ensaio, 06/10/2026 10:36 UTC (fluxo `medir`, `free -h` e
`docker stats`):** 2 núcleos; 3,7 GiB de memória, 781 MiB usados, 3,0 GiB
disponíveis; sem swap. Contentores: `eurolify-postgres` 109,2 MiB (limite
768 MiB), `eurolify-api` 37,75 MiB (limite 512 MiB), `eurolify-mcp`
31,25 MiB (limite 256 MiB). Os limites somam 1,5 GiB.

**a) Biblioteca na API**

| Biblioteca | Licença | Estado | Fonte |
|---|---|---|---|
| node-oidc-provider | MIT | v9, certificada OpenID | github.com/panva/node-oidc-provider |
| SimpleWebAuthn | não verifiquei | lançamento lido: v14.0.3; exige Node 22+ | github.com/MasterKale/SimpleWebAuthn |
| Lucia | MIT | **descontinuada em março de 2025** | github.com/lucia-auth/lucia |
| Better Auth | MIT | passkeys, 2FA, OIDC e organizações em extensões; último lançamento não verifiquei | github.com/better-auth/better-auth |

Sem processo novo; a palavra-passe, a recuperação e os convites são nossos.

**b) Servidor na VPS**

| | Licença | Memória (documentação) | Base | Último lançamento lido |
|---|---|---|---|---|
| Keycloak | Apache-2.0 | 2 GB de limite para produção pequena | PostgreSQL; Java | 26.8.0, 01/10/2026 |
| Zitadel | **AGPL-3.0 desde a v3** (APIs e SDK Apache-2.0) | ~512 MB; pede núcleos livres para o resumo das palavras-passe (4 recomendados) | PostgreSQL ≥ 14; Go | v4.19.4, 01/10/2026 |
| Ory Kratos + Hydra | Apache-2.0 | não verifiquei | PostgreSQL; Go; o ecrã de entrada é nosso | Kratos v26.2.0 (pode não ser o último) |
| authentik | MIT no núcleo, partes Enterprise proprietárias | 2 núcleos e 2 GB mínimo | PostgreSQL | 2026.8.3, 17/09/2026 |

Fontes: os repositórios no GitHub; keycloak.org (containers, memory and CPU
sizing); zitadel.com/docs/self-hosting/manage/production e
zitadel.com/blog/apache-to-agpl; docs.goauthentik.io.

**c) Gerido na UE**

- cidaas (Widas ID GmbH, Alemanha, «made and hosted in Germany»): candidato;
  preço, contrato e subcontratantes não verifiquei.
- Zitadel Cloud (contrato com a CAOS AG, Suíça; ZITADEL Inc. nos EUA) e Logto
  Cloud (empresa provavelmente nos EUA, não confirmado): **fora da UE, não se
  avaliam** (`AGENTS.md`, regra 4).

## O que ficou por verificar

- Os números da documentação foram lidos por resumo, não na página inteira.
- Memória do Ory; licença do SimpleWebAuthn; passkeys na cidaas.
- A VPS de produção (VPS-3, ADR-0017) não existe; a medição é do ensaio.
