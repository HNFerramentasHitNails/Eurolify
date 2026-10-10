# Clientes, parte 2a: consentimentos e a régua única do marketing (#233, #289), 10/10/2026

## O que se fez

Pedido do Diogo, 10/10/2026: *«sim, avança com a parte 2»* (issue #233; o
desenho está em `docs/23-dominio-clientes.md` §3.6, aprovado a 09/10/2026).
Pedido #289, juntado a 10/10/2026 (`c06e858`) com o OK do Diogo (*«sim, junta
o #289»*). Publicado no ensaio pelo fluxo `publicar` (corrida 38047147287,
com sucesso às 11:12 UTC; o registo diz «migrar: aplicadas
0042_clientes_consentimentos» e «O /health da API responde»).

- **Migração 0042:**
  - **a tabela `consentimento` (`cns_`)**: uma linha por declaração, `aceitou` ou `retirou`, com o canal (`email`, `sms`, `whatsapp`), a finalidade (só `marketing`), o texto, a versão e onde;
    - não se altera nem se apaga, nem pelo dono da base;
    - «nunca aceitou» é não haver linha;
  - **a hora e quem registou põe-nos a base**:
    - as declarações da mesma ficha entram uma de cada vez (a ficha fica tomada);
    - a hora fica sempre depois da última da ficha, mesmo que o relógio recue;
  - **a régua única `pode_receber_marketing(cliente, canal)`**:
    - contam só as declarações explícitas, e vale a mais recente;
    - empate dá não; sem nenhuma, não;
    - uma ficha limitada ou que não esteja activa dá não;
    - devolve sempre verdadeiro ou falso, nunca nulo;
  - **o evento `consent.changed`**, sem o texto nem o «onde»;
  - **as declarações entram na linha do tempo da ficha.**
- **API:** `GET` (por páginas, com a régua por canal) e
  `POST /customers/{id}/consents`, com os âmbitos que já existiam
  (`customers:read` e `customers:write`).
- **Revisão do agente** (Sonnet 5.5, ADR-0035, publicada no #289): sem P0 nem
  P1.
  - Tratados em `0c482b0`:
    - P2-1: o relógio a recuar punha uma retirada antes da aceitação;
    - P2-2: a régua não usava o índice sem RLS;
    - P2-3: a lista vinha inteira, sem páginas.
  - O P2-4 e os P3 de fusão e pseudonimização ficaram como condições da 2b e
    da 2c, escritas em `docs/23` §12.

## Números (com data e como se contaram)

Contado a 10/10/2026, neste contentor (PostgreSQL 18.6 por Docker).

- **`test/clientes-consentimentos.test.ts`: 18 testes, todos verdes.**
- **Mutações:** todas apanhadas na régua e nos gatilhos, salvo uma: trocar
  `clock_timestamp()` por `now()`, que depois da P2-1 dá a mesma ordem.
  - Antes da revisão: 14 mutações válidas, todas apanhadas.
    - Duas (a hora do início da transacção e não tomar a ficha) só foram
      apanhadas depois de dois testes novos.
    - Uma outra tentativa partia a migração e não conta.
    - **Correcção:** a 10/10/2026 disse-se «16 mutações» na conversa e no
      primeiro texto do #289; recontadas no registo da sessão, são 14.
  - Depois da revisão: 9 de novo, sobre a régua e a hora revistas; 8
    apanhadas, e sobrevive a do `now()`.
- **Testes da API (`npx vitest run`): 1077 de 1078.**
  - A falha que sobra é de `idempotencia-limpeza.test.ts`: o papel
    `eurolify_limpeza` deste contentor foi criado à mão sem `BYPASSRLS`
    (`rolbypassrls = f`).
  - No CI e na publicação, os testes passaram todos (corrida 38047147287,
    passo «pnpm teste»).

## O que ficou por verificar

- No ensaio, ninguém registou um consentimento nem perguntou à régua com
  dados de lá. A publicação só confirma que a API arranca e chega à base.
- **O consentimento implícito de quem já comprou** (art. 13.º, n.º 2, da Dir.
  2002/58/CE): não verificado, **C**. É a pergunta V4 para o jurista; até lá
  só conta o explícito.
- **Faltam:**
  - a 2b: duplicados e fusões; a régua da ficha que fica tem de contar as
    declarações das absorvidas, e uma retirada com o id antigo segue
    `fundido_em`;
  - a 2c: a pseudonimização tem de apagar os consentimentos e alcançar a
    cópia na linha do tempo;
  - a caixa de marketing no checkout e o caminho da loja para registar;
  - um ecrã no Hub.
