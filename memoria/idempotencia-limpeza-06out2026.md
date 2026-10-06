# Limpeza diária da idempotência (#107) — 06/10/2026

## O que se fez

Pedido do Diogo, 06/10/2026: *«avança com a tarefa diária da idempotência»*.
O `docs/18` §4 e o `docs/17` §3 pediam-na antes de uma rota com dados pessoais
usar a idempotência.

- **Migração 0013:** a função `idempotencia_apagar_expiradas()`.
  - Apaga as linhas com `expira_em <= now()` e devolve quantas.
  - Não é SECURITY DEFINER: o RLS forçado aplica-se também ao dono quando ele
    não é superutilizador (revisão do #118, P3-9).
  - A API não a pode chamar.
- **VPS:** o programa `eurolify-limpeza` e o temporizador
  `eurolify-limpeza.timer`, às 05:00 UTC, depois da cópia das 03:00.
  - Chama a função como o superutilizador do PostgreSQL, como a cópia faz.
  - Regista quantas apagou no `acoes.log`.
  - Se falhar, sai com erro.
- **Verificação diária (07:00):** avisa o Healthchecks se houver linhas
  expiradas há mais de um dia (a limpeza parou), ou se não conseguir ler a
  tabela.
- **Documentos:** `docs/18` §4, `docs/17` §3 e `infra/vps/LEIA-ME.md` (passo 12).

## Números (com data e como se contaram)

Ensaio local a 06/10/2026: PostgreSQL 18.6 com o resumo do `ensaio.conf`, as
13 migrações aplicadas pelo `dist/migrar.js`, 3 linhas (2 expiradas há 2 dias).

| O quê | Resultado |
|---|---|
| Verificação antes | «2 linha(s) da idempotência expiradas há mais de um dia…» |
| `eurolify-limpeza` | «Limpeza: 2 linha(s)…», saída 0, uma linha no `acoes.log` |
| Verificação depois | sem problemas; fica a linha válida |
| Com a base parada | «ERRO: a limpeza da idempotência falhou», saída 1 |
| Testes da função (`idempotencia-limpeza.test.ts`) | 2 passam. Falha 1 sem o filtro, e falha também com uma folga de 2 minutos |
| CI local: `shellcheck`, `preparar.sh --mostrar` e os 3 testes da VPS num Ubuntu 26.04 vazio | passam; o `--mostrar` diz que instalaria o programa e as duas unidades e ligaria o temporizador |

## O que ficou por verificar

- A primeira corrida na VPS a sério. O `aplicar-script` instala e liga o
  temporizador, e a 0013 entra pela publicação, também quando se juntar.
- Uma corrida em que a limpeza falhe na VPS: ninguém é avisado nessa hora,
  só pela verificação das 07:00 do dia seguinte, e só quando já houver linhas
  expiradas há mais de um dia.
- Uma linha ainda válida às 03:00 vai para a cópia e fica lá 14 dias. Hoje
  estas linhas não têm dados pessoais (`docs/17` §3).
