# Clientes, parte 2b: duplicados e fusões, com os perfis copiados (#233, #298), 10/10/2026

## O que se fez

Pedido do Diogo, 10/10/2026: *«sim, avança com a parte 2b»* (issue #233;
desenho em `docs/23-dominio-clientes.md` §3.7).

- **Decisão DD** (`docs/06`). O desenho mandava «passar» os perfis da ficha
  absorvida para a que fica, mas o código não o deixa: um perfil nunca muda de
  ficha (`0037_clientes.sql:341-342`) e cada encomenda está presa ao par ficha
  e perfil (`0041_checkout.sql:350-351`). O Diogo escolheu copiar, entre três
  opções: *«sim, copiar (A)»*.
- **Pedido #298**, juntado a 10/10/2026 (`c4730e2`) com o OK do Diogo (*«sim,
  junta o #298»*). Publicado no ensaio pelo fluxo `publicar` (corrida
  38053776699, com sucesso às 13:03 UTC). O registo diz «migrar: aplicadas
  0046_clientes_duplicados_fusoes» e «O /health da API responde».
- **A migração é a 0046.** Começou como 0043 e foi renumerada duas vezes,
  porque o #290, o #288 e o #293 entraram antes com a 0043, a 0044 e a 0045.
  A mensagem do commit no `main` ainda diz «Migração 0043» no primeiro
  parágrafo; o ficheiro certo é a 0046.
- **O que ficou no código:**
  - **a fila de candidatos** (`duplicado_cliente`):
    - o mesmo NIF em perfis particulares é sinal forte; o mesmo e-mail (sem
      maiúsculas) ou o mesmo telefone é «talvez»;
    - o NIF de empresa (Q2) e o nome não são sinal;
    - guarda só o tipo do sinal, nunca o valor;
  - **descartar e fundir só por uma pessoa** ou a chave dela;
  - **a fusão, com ensaio:**
    - a absorvida fica só de leitura, com as encomendas dela;
    - a que fica recebe os contactos, as etiquetas e uma cópia de cada perfil
      activo;
    - a isenção de IVA não se copia, e o plano diz onde repor;
    - o plano mostra a régua do marketing antes e depois;
  - **a régua dos consentimentos conta as fichas fundidas**
    (`clientes_do_grupo`, `regua_marketing`), e uma declaração com o id
    antigo vai para a ficha que ficou;
  - **o âmbito `customers:merge`** (dono e gestor) e o evento
    `customer.merged`.
- **Revisão do agente** (Sonnet 5.5, ADR-0035, publicada no #298): sem P0 nem
  P1.
  - Tratados em `6892346`:
    - P2-1: o plano não mostrava a régua do marketing antes e depois;
    - P2-2: a ficha fundida ainda aceitava isenção nova, tirar etiquetas e
      pedir o VIES;
    - P2-3: a régua recalculava o grupo por linha;
    - P3-2: os perfis da absorvida ficavam na fila do VIES;
    - P3-6: o principal das cópias e a ordem dos e-mails.
  - O resto ficou escrito em `docs/23` §12.

## Números (com data e como se contaram)

Contado a 10/10/2026, neste contentor (PostgreSQL 18.6 por Docker).

- **Testes novos:**
  - `test/clientes-fusoes.test.ts`: 13;
  - `test/migracao-0046.test.ts`: 1, sobre fichas que já existiam, com
    migrador sem poderes.
- **Mutações:**
  - antes da revisão: 16 válidas, 15 apanhadas. Sobrevive tirar a ordem com
    que as duas fichas são tomadas, porque o teste não provoca o
    interbloqueio;
  - nas correcções da revisão: 10 válidas, todas apanhadas no fim. Uma só
    depois de reforçar o teste da limitação.
- **Testes da API (`npx vitest run`, último merge): 1136 de 1137.** A falha
  é a do papel `eurolify_limpeza` deste contentor, criado à mão sem
  `BYPASSRLS`. No CI e na publicação passaram todos.

## O que ficou por verificar

- **Quantos candidatos a migração criou no ensaio,** e uma fusão feita lá.
  Não li a base do ensaio: o MCP da VPS pede autorização nesta sessão.
- **A régua com milhares de declarações,** e se os índices GIN servem com RLS.
  Não medi: não corri `EXPLAIN` com volume.
- **O consentimento da ficha que fica passa a cobrir os contactos
  acrescentados.** Não verificado, **C**: vai para o jurista com a V4. A
  alternativa mais prudente («só sim se todas as fichas aceitaram») ficou
  proposta ao Diogo. Ele decidiu outra regra, canal a canal, a 10/10/2026
  (`docs/06`, DH; migração 0050): o «não» de qualquer ficha vence, e uma
  declaração feita depois da fusão vale para todas.
- **Fica para depois:**
  - **2c:** os pedidos do titular têm de alcançar o grupo inteiro;
  - **fatia 10:** abrir a marca `usado_em_documento` nos perfis de fichas
    fundidas;
  - **MCP:** nunca expõe `customers:merge`;
  - **Hub:** um ecrã para os duplicados e a fusão.
