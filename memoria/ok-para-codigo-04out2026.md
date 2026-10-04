# OK para código (decisão AE, ADR-0023) — 04/10/2026

Pedido do Diogo, 04/10/2026: *«preparar tudo para começarmos a escrever o
código do Eurolify no GitHub e para que cada entrada no main seja publicada
sozinha no ensaio (a VPS)»*. Fase A do pedido, decisão A1: o OK para código
num ADR que substitui o ADR-0001, com o âmbito *«código do produto, script da
VPS, integração contínua»*.

## O que se fez

- O Claude leu, antes de propor: `AGENTS.md`, `docs/05`, `06` e `11`, os
  ADR-0001, 0002, 0005, 0013 a 0022, a memória da VPS e as skills
  `platform-architect`, `observability-security`, `headless-commerce` e
  `eu-gdpr-privacy`.
- Mostrou o texto do ADR-0023 antes de o gravar e perguntou se ficava com a
  trava «o código de um domínio só depois do desenho dele» (acrescento do
  Claude, não pedido). Resposta do Diogo: *«podes avançar mesmo assim»*
  (na mesma mensagem em que disse que tinha acabado de comprar o domínio).
  **Lida como OK ao texto mostrado, com a trava** — a resposta não a nomeou.
- ADR-0023 novo; ADR-0001 com o estado «substituído»; `docs/06` com a linha
  AE e a nota na A.
- **Varrimento** (`grep` de «ADR-0001», «não há código», «sem código» e «OK
  para código» em todos os `.md`, sem `memoria/` e sem as referências das
  skills): 71 ocorrências em 38 ficheiros. Mudados os documentos vivos:
  `AGENTS.md` (3 sítios), `README.md`, o cabeçalho das 14 skills, mais 2
  frases da `headless-commerce`, `docs/00`, `05` (título e critério de
  passagem), `08` (2), `10` (linha da Fase 0) e `12`. Ficam como estão os ADR
  aceites (registo histórico), as memórias datadas e o exemplo hipotético do
  `docs/10` («se o OK para código for dado a 01/01/2027…»), que é um cenário
  de contratação e não um estado.

## Números (com data e como se contaram)

| O quê | Valor | Fonte e como |
|---|---|---|
| Ocorrências varridas | 71 em 38 ficheiros | `Grep` de `ADR-0001\|não há código\|sem código\|OK para código`, 04/10/2026 |
| `AGENTS.md` depois desta mudança | 13.515 bytes (limite do Codex: 32 KiB) | `(Get-Item AGENTS.md).Length`, 04/10/2026 |

## O que ficou por verificar

- Se o Bruno concorda com o OK (vale com o do Diogo, mas é o Bruno quem revê).
- Se o Diogo queria mesmo a trava do domínio.
- A A2 (onde vive o código e como se impõem as duas revisões) é a próxima
  decisão; até ela, nenhum código se escreve.
