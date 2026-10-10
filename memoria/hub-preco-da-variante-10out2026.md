# Hub: definir e tirar o preço de uma variante (#335, #336, #339, #341) — 10/10/2026

## O que se fez

- Desenho no `docs/22` §25 (#336), aprovado pelo Diogo a 10/10/2026, com a
  Q1 em «sim» (os preços de um artigo do sistema de gestão editam-se no Hub).
- API (#339, squash `0dffbe3`): `PUT` e `DELETE /hub/price-lists/{id}/prices/{variante}`,
  as mesmas funções da chave, para quem tem `prices:write` (o dono e o
  gestor), sobre o preço `lido` (`versao` e `definido_em`; `null` sem preço).
  As respostas de preço passaram a dar a `versao`.
- Hub (#341, ramo `hub-preco-da-variante`): a página «Preço da variante»
  (`/artigos/{prd_…}/precos/{prl_…}/{var_…}`) e, na secção «Preços» da ficha,
  «Definir preço» ou «Alterar preço» em cada variante activa, só com
  `prices:write`.
  - O montante passa de texto a cêntimos sem vírgula flutuante
    (`apps/hub/src/preco.ts`): «39,9» → 3990; «39,905» e «1.234,50»
    recusados antes de pedir; 0 só com «Gratuito».
  - Um 409 mostra sempre o conflito, com o guardado agora, e o que se
    escreveu fica; só a resposta perdida se dá por gravada ao reler.
  - Com uma redução em vigor, o preço e «Gratuito» só se lêem e «Tirar» não
    aparece; as quantidades mudam.
  - Os limites do montante e das quantidades ficam também no ecrã: a API
    recusa-os no esquema sem dizer o campo (escrito no §25.3).
  - Revisão do agente (Opus 5.5, ADR-0035) publicada no #341: 0 P0, 0 P1,
    3 P2, 6 P3; corrigidos no `e4bd4c5`, menos o P3-2 (justificado) e o
    P3-4 (moedas sem casas, nenhuma verificada).
- Aspecto aprovado pelo Diogo a 10/10/2026 («aprovado»), na página de
  aprovação nova, privada, da conta desta sessão
  (https://claude.ai/artifact/8husE7Svxv913LJka35igb, versão 1): a página
  «Preço da variante» a 375/768/1280 px, claro e escuro, e a secção
  «Preços» da ficha com as ligações novas. A página anterior
  (`AQk53xNmRUGqeCBurFCtvK`) não abre nesta conta («artifact not found»).
- Uma verificação antiga da passagem («Editar a variante», num artigo
  activo) contava os textos antes de a variante chegar; passou a esperar
  por ela (só no teste).
- Sem alteração à VPS: o nginx já deixa passar o `PUT` e o `DELETE` em
  `/hub/` (`infra/vps/ficheiros/nginx-hub.conf`, `location /hub/`, sem
  limite de métodos).

## Números (com data e como se contaram)

- 10/10/2026, local, depois de juntar o `main` (`cff9c0d`): Hub 161 testes
  verdes em 18 ficheiros (`vitest run`; eram 140 no #331 e 159 antes das
  correcções da revisão); `pnpm lint` e `pnpm tipos` limpos.
- 10/10/2026, local: passagem (`node scripts/capturas.mjs`, PostgreSQL 18.6)
  com 540 «ok» e 0 falhas em duas corridas seguidas (`grep -c '^ok'` e
  `grep FALHOU` no registo). A primeira corrida, antes das correcções da
  passagem, deu 536 «ok» e 3 falhas, todas por contar linhas antes de a
  secção «Preços» chegar.

## O que ficou por verificar

- No ensaio: nada, ainda não está publicado.
- Leitores de ecrã reais; moedas da UE com outras casas que não duas.
- Risco que fica: outra pessoa grava exactamente o mesmo preço no instante
  em que a resposta se perde — o ecrã dá-o como seu.
