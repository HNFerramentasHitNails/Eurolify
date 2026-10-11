# Notificações: o e-mail do aviso do prazo do reembolso (#372, #373), 11/10/2026

## O que se fez

- **Pedido do Diogo, 11/10/2026:** *«avança com o e-mail do aviso do
  prazo»*. O Eurolify não enviava e-mails (procurado em `apps/api/src` e nos
  issues, 11/10/2026). Desenho em `docs/34`; **aprovado** (*«aprovado, com a
  A»*: OVH E-mail Pro por agora, mantém o fornecedor único do ADR-0032;
  `docs/06`, DX).
- **Fornecedores lidos** nas suas páginas (**W**, 11/10/2026): OVH E-mail Pro
  (1,59 € + IVA por conta e mês, dados em França; a OVH escreve que as caixas
  não servem para envio em volume), Lettermint, Sweego e Scaleway TEM. O
  envio é por SMTP: mudar de fornecedor é mudar a configuração.
- **Código (#373, migração 0067):**
  - a fila `notificacao`: uma por dono e gestor activos e por aviso, gravada
    pelo gatilho do aviso do prazo (0063); a loja, os identificadores, o
    último dia e os dias; nenhum dado do cliente; RLS forçado;
  - o envio em três passos (a vez, o SMTP fora da transacção, o resultado);
    o destinatário recusado falha logo, o 4xx dele repete até à 6.ª, um erro
    do servidor (autenticação, DNS) não conta e pára a volta;
  - não sai se a devolução já não espera, nem a quem saiu ou mudou de papel;
  - PT, ES ou EN (a língua do Hub); sem o nome da pessoa (o endereço não está
    confirmado, CE); limpeza 90 dias depois (**C**);
  - `GET /notifications?estado=` (`merchant:read`), sem o endereço nem o texto;
  - `nodemailer` 10.0.10 (MIT-0, sem dependências, de 14/09/2026).
- **Números:** o desenho começou como `docs/33` e a migração como 0066, e a
  decisão como DW: as três foram usadas primeiro pelas tarefas das filas
  (#368, #375). Ficaram `docs/34`, 0067 e DX.
- **Revisão do agente** (`eurolify-critical-review`, Claude Sonnet 5.5): 0
  P0, 1 P1 (a autenticação recusada virava «falhada» à primeira), 6 P2, 10
  P3; tratados menos P3-3 e P3-9, escritos no `docs/34` §11.
- **Juntado** a 11/10/2026 (`1f7031e`). **Publicado no ensaio:** CORRIDA.

## Números (com data e como se contaram)

- 11/10/2026, neste contentor (PostgreSQL 18.6 da lista
  `infra/ci/imagens-base.txt`, Node 24.21), com o `main` do #375: `pnpm lint`
  e `pnpm tipos` limpos; **API 1396 de 1396**.
- 3 testes em `test/posvenda-api.test.ts` e 5 em
  `test/notificacoes-correio.test.ts` (um contra um servidor SMTP falso).
- Mutações: 28, 26 apanhadas; duas equivalentes (o destino confere o
  comerciante e o estado, que o RLS forçado e a gravação também conferem).

## O que ficou por verificar

- **Nenhum e-mail real saiu:** falta a conta `avisos@eurolify.eu`, as cinco
  variáveis `SMTP_*` no `api.env` da VPS e o DNS (SPF, DKIM, DMARC) —
  Diogo ou Bruno. O envio contra a OVH não foi ensaiado; os limites do E-mail
  Pro por hora não estão na página dele.
- **Se os e-mails do ensaio para o Diogo e o Bruno contam como dado pessoal
  real** para o ADR-0018: não verifiquei.
- **Por fazer:** uma medida de fila parada para o operador (P3-3); o esquema
  e a paginação da lista (P3-9); os eventos `notification.*`; o ecrã no Hub;
  os avisos das tarefas das filas por e-mail; os e-mails ao cliente (o
  serviço transaccional decide-se antes).
- **Não li a base do ensaio** depois de publicar.
