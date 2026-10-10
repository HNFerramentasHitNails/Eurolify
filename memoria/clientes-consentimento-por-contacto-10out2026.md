# Clientes: consentimento por contacto e dupla confirmação (#233, #325, #330), 10/10/2026

## O que se fez

A pergunta deixada na 2b («só sim se todas as fichas aceitaram?») teve várias
respostas do Diogo a 10/10/2026:

- **Primeiro, uma régua por ficha** com cinco regras (o «não» de uma ficha vence,
  canal a canal). Foi programada no primeiro #325.
- **Depois, outro modelo.** A revisão desse código mostrou que um «sim» dado
  depois da fusão apagava a recusa de outra pessoa. O Diogo decidiu então:
  - o estado é **por contacto e por canal**;
  - sobre uma recusa, um «sim» novo só conta com uma **dupla confirmação** no
    próprio contacto;
  - fontes indicadas por ele: RGPD, arts. 5.º, 7.º e 21.º; Lei 41/2004,
    art. 13.º-A. Ficam **C**.
- **Q-C1 («quem envia a confirmação»):** *«A»*, o sistema do comerciante.
- **#325:** o código da régua por ficha saiu e ficou só o desenho
  (`docs/23` §14; `docs/06`, DL). Juntado a 10/10/2026 (`e270f01`).
- **#330:** o código. Juntado a 10/10/2026 (`313a487`), depois de o Diogo dizer
  *«continuar»* à pergunta «junto o #330?».
- **Publicado no ensaio** pelo fluxo `publicar` (corrida 38080970216, com
  sucesso às 19:52 UTC). O registo diz «migrar: aplicadas
  0052_clientes_consentimento_por_contacto» e «O /health da API responde».
- **A migração é a 0052.** Começou como 0051 e foi renumerada, porque o #327
  (o rasto) entrou com a 0051. O #312 tinha ficado com a 0050.
- **O que ficou no código:**
  - `consentimento.contacto` é obrigatório nas declarações novas, e tem de ser
    um contacto da ficha;
  - **o estado vale por contacto no comerciante**, em qualquer ficha: o mesmo
    e-mail em duas fichas é o mesmo contacto. É a leitura de «por contacto,
    não por ficha», escrita para o Diogo confirmar;
  - as declarações antigas (sem contacto) valem para os contactos que a ficha
    tinha na migração (`consentimento_contacto_inferido`);
  - **sobre uma recusa:**
    - um «sim» directo responde **202**, com o pedido (`ccf_`) e o segredo
      uma só vez;
    - o sistema do comerciante envia o segredo e entrega-o em
      `POST /consent-confirmations/{id}/confirm`;
    - **e-mail:** 24 h e uma ligação de 32 bytes;
    - **SMS:** 10 min e 6 dígitos;
    - 5 tentativas por pedido e 3 pedidos por contacto numa hora;
    - uma declaração posterior ao pedido faz cair a ligação;
  - o segredo fica só como resumo, fora dos eventos e da idempotência;
  - a pseudonimização apaga os pedidos;
  - `consent.changed` diz também `contacto_pode_receber`.
- **Revisões do agente (Sonnet 5.5, ADR-0035):**
  - #325: sem P0 nem P1; a P2-2 levou à decisão nova;
  - #330: 4 P1, 5 P2 e 6 P3, tratados; P3-1, P3-2 e P3-6 ficaram explicados.
- **O Codex não reviu:** a conta atingiu o limite de utilização.

## Números (com data e como se contaram)

Contado a 10/10/2026, neste contentor (PostgreSQL 18.6 por Docker).

- **Testes novos:**
  - `test/clientes-consentimento-contacto.test.ts`: 10;
  - `test/migracao-0052.test.ts`: 1.
- **Testes adaptados:** os de consentimentos (18), fusões e titular.
- **Mutações na 0052:** 16, todas apanhadas. Duas sobreviveram à primeira
  volta e levaram testes às segundas barreiras.
- **Testes da API (`npx vitest run`, com o `main` de 19:20 UTC): 1251 de
  1252.** A falha é a de `idempotencia-limpeza`, do papel deste contentor.
- **O CI do #330 falhou uma vez (19:34 UTC).** O teste inventava o e-mail com
  os primeiros 12 caracteres do id, que se repetiam em fichas do mesmo
  milissegundo. Corrigido no teste (`6359ec0`). A seguir, CI verde.

## O que ficou por verificar

- **Um pedido de confirmação feito no ensaio:** não li a base do ensaio (o MCP
  da VPS pede autorização nesta sessão).
- **O Diogo ainda não confirmou** que o estado vale no comerciante, e não no
  grupo de fichas.
- **As fontes legais (C)** ficam para o jurista, com a V4.
- **Fica do lado do comerciante:** a página da loja que recebe a ligação ou o
  código (Q-C1).
- **Não medido:** o desempenho de `marketing_do_contacto` com volume; não
  corri `EXPLAIN`.
