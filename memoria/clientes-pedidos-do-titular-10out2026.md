# Clientes, parte 2c: os pedidos do titular (#233, #314), 10/10/2026

## O que se fez

Pedido do Diogo, 10/10/2026: *«sim, avança com a parte 2c»* (issue #233;
desenho em `docs/23-dominio-clientes.md` §4.1, R9, §7.1 e §12).

- **Pedido #314**, juntado a 10/10/2026 (`98302c1`) depois de o Diogo dizer
  *«continuar»* à pergunta «junto o #314?».
- **A migração é a 0049.** Começou como 0048 e foi renumerada, porque o #306
  entrou antes com a 0048.
- **O que ficou no código:**
  - **o registo dos pedidos** (`pedido_titular`, `dsr_`): o tipo, como se
    verificou a identidade, quem fez, quando e o resultado em contagens. Só se
    acrescenta. A API regista só a exportação, com o tipo fixo;
  - **a limitação**: a régua do marketing dá não e a API não muda o nome nem
    os contactos. Não trava os perfis, as etiquetas, o VIES, os duplicados nem
    o checkout;
  - **a exportação**:
    - leva o grupo, com as encomendas, as linhas e os pagamentos delas;
    - recusa uma ficha fundida;
    - a resposta não fica guardada na idempotência
      (`idempotency.response_not_kept`);
  - **a pseudonimização do grupo inteiro**:
    - toma a ficha antes de ler o grupo;
    - apaga os dados pessoais, o texto livre, os consentimentos e as
      etiquetas;
    - ficam os perfis usados num documento **ou apontados por uma
      encomenda**, com as provas do VIES e as isenções (R9);
  - uma prova do VIES só se grava numa ficha activa;
  - as recusas abrem-se só pela marca `pseudonimizacao_em_curso`, uma linha
    da transacção numa tabela só do dono;
  - o âmbito `customers:privacy`, só no dono.
- **Revisão do agente** (Sonnet 5.5, ADR-0035, publicada no #314): 3 P1,
  6 P2 e 9 P3, sem P0.
  - Tratados em `f784021`: todos os P1 e P2, e os P3-3, P3-4, P3-5 e P3-8.
  - Os outros P3 ficaram escritos no `docs/23` §12.
- **O Codex não reviu**: o limite de utilização dele estava atingido
  (comentário do bot no #314).

## Números (com data e como se contaram)

Contado a 10/10/2026, neste contentor (PostgreSQL 18.6 por Docker).

- **Testes novos:**
  - `test/clientes-titular.test.ts`: 7;
  - `test/checkout-api.test.ts`: 1, com uma encomenda real.
- **Mutações**, cada uma aplicada à mão e desfeita depois:
  - antes da revisão: 13, todas apanhadas;
  - nas correcções: 12, uma por correcção, todas apanhadas (script
    `mut.py` desta sessão).
- **Testes da API (`npx vitest run`, com o `main` de 14:20 UTC): 1176 de
  1177.** A falha é a de `idempotencia-limpeza`, do papel `eurolify_limpeza`
  deste contentor, criado sem `BYPASSRLS`. No CI do #314 passaram todos
  (verificação `codigo`, 14:33 UTC).

## O que ficou por verificar

- **A publicação no ensaio** (corrida 38069445047): estava a correr quando
  esta memória foi escrita.
- **Os dados pessoais das encomendas e do checkout** (o contacto, a entrega,
  a cópia do perfil, as sessões e os carrinhos) ficam para as fatias 9 e 10.
  O resultado do apagamento conta-as em `encomendas_com_dados_por_tratar`.
- **Qualquer encomenda segura o perfil**, também a não paga. O critério mais
  estreito é do contabilista: **C**.
- **Os prazos de resposta e os de guarda fora de Portugal:** não verifiquei,
  **C**.
- **A corrida com mais de duas transacções** não foi testada.
