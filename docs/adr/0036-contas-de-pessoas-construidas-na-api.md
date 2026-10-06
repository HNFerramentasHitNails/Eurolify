# ADR-0036 · As contas de pessoas constroem-se na API, com bibliotecas abertas

- **Estado:** aceite
- **Data:** 06/10/2026
- **Quem decidiu:** Diogo
- **Decisão em aberto de origem:** P1 do `docs/19` §7 (parte B da identidade)

## Contexto

- A parte A da identidade (chaves de API) está no `main` desde o #110 e o
  #118. A parte B dá contas de pessoas ao Hub: início de sessão forte, papéis
  por comerciante, convites e saída de quem deixa a equipa (`docs/19` §7).
- A VPS do ensaio, medida a 06/10/2026 10:36 UTC pelo fluxo `medir`: 2
  núcleos, 3,7 GiB, 781 MiB usados; os limites dos três contentores somam
  1,5 GiB (`memoria/identidade-parte-b-opcoes-06out2026.md`).
- Pesquisa de 06/10/2026, na mesma memória (lida por resumo, a reconfirmar):
  Keycloak e authentik pedem ~2 GB; Zitadel é AGPL-3.0 desde a v3 e recomenda
  4 núcleos; a memória do Ory não foi encontrada; gerido na UE só sobra a
  cidaas (Alemanha), com contrato e preço por verificar.

## Opções consideradas

| Opção | A favor | Contra |
|---|---|---|
| **a) Construir na API, com bibliotecas abertas** | nenhum serviço nem memória a mais; dados na nossa base, com RLS; nenhum subcontratante novo | a segurança da entrada é código nosso; mais código a rever |
| b) Servidor de identidade aberto na VPS | entrada de um projecto com mais uso | Keycloak e authentik não cabem com folga; Zitadel AGPL e com mais núcleos; mais uma peça a operar |
| c) Fornecedor gerido na UE (cidaas) | menos a operar | subcontratante novo e acordo de tratamento; dados fora da nossa máquina; contrato por verificar |

## Decisão

Diogo, 06/10/2026: *«sim, concordo, fica a a)»*.

1. As contas de pessoas, a entrada, os convites e os papéis constroem-se na
   API do Eurolify, com bibliotecas de código aberto; os dados ficam na nossa
   base, com RLS, como o resto.
2. **Passkeys (WebAuthn) são a forma principal de entrar**; o código de
   autenticação (TOTP) é a alternativa.
3. O código da parte B tem **uma revisão de segurança própria** antes de
   juntar, além da revisão do agente (ADR-0031, ADR-0035), com a skill
   `observability-security`.
4. Criar uma chave de API pelo Hub pede à pessoa que se autentique outra vez
   nesse momento (decisão BA, `docs/19` §10).

## Consequências

- Antes do código: a escolha das bibliotecas (licença, manutenção, versão),
  com os números da pesquisa reconfirmados na página inteira; o registo de
  tratamentos, a retenção e o apagamento das contas de pessoas escritos
  (`docs/19` §8, skill `eu-gdpr-privacy`).
- Fica por desenhar: a recuperação de uma conta que perdeu todas as passkeys
  e o TOTP (sem isto não há código).
- Se a parte B crescer para lá do que uma biblioteca dá (ex.: entrada única
  com o sistema de um cliente), revê-se com a opção b) e números novos.
