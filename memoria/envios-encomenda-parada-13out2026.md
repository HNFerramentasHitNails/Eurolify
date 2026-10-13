# Envios: a encomenda parada perto da data-limite (13/10/2026)

O Diogo aprovou-o a 13/10/2026: *«sim, aprovo; avança com o código»*. O
desenho é o `docs/36` §18 e completa a Q4 da decisão ED (issue #393).

## O que se fez

- **Quando abre um problema.** Uma encomenda paga, em preparação ou expedida
  em parte abre um problema da pós-venda, do tipo `atraso`, uma vez só,
  quando cumpre tudo isto:
  - tem unidades que ainda não saíram;
  - faltam 5 dias ou menos para a data-limite, ou a data já passou.

  A data-limite é a que o cliente viu, copiada na encomenda. O dia é o do
  fuso da loja.
- **Onde aparece.** O problema aparece na lista «A decidir», na fila
  «problema». Ao vencer, avisa por e-mail como os outros. Não há fila nova.
- **Quem decide.** Uma pessoa, sempre: nada se cancela nem reembolsa sozinho.
- **O código.** Migração 0084: as tabelas `encomenda_parada` (a marca) e
  `tarefa_parada` (interna, as candidatas). A volta corre de hora a hora,
  dentro da volta dos envios (`src/envios/paradas.ts`).
- **Desvios do desenho**, com a razão no §18.6:
  - o tipo do problema é `atraso`, e não `outro`;
  - a marca está numa tabela própria;
  - há uma tabela interna de candidatas, porque o RLS forçado da encomenda
    vale também para o dono das funções.
- **A numeração.** A 0083 já era do #420, e esta migração passou a 0084.

## Números (com data e como se contaram)

- 13/10/2026, local, com o PostgreSQL 18.6 num contentor:
  - `test/envios-paradas.test.ts`: 4 testes verdes;
  - as suites `comerciante`, `rasto-colunas`, `envios-*`, `posvenda*`,
    `tarefas*`, `clientes-titular` e `stock*`: 188 testes verdes antes de
    renomear para a 0084, mais os 2 do `comerciante` corrigidos depois.

## O que ficou por verificar

- **Encomendas antigas sem data-limite** (de antes da 0074): quantas há no
  ensaio. Não abrem aviso. Não verifiquei; a contagem faz-se pelo `medir` ou
  pela base, depois de aplicar.
- **Uma loja que muda de fuso** depois de a encomenda entrar: a data conta
  no fuso de hoje. Não há teste para a mudança a meio, só para os dois fusos.
- **Volume.** A função conta as unidades por encomenda candidata; não foi
  medida com muitas encomendas.
