# Hub: os métodos de entrega e a embalagem (13/10/2026)

Pedido do Diogo, 13/10/2026: *«sim, aprovo; avança com o código»*, sobre o
desenho do `docs/22` §31 (issue #393, pedido #413).

## O que se fez

- **API:** as rotas do Hub para:
  - os métodos de entrega (`/hub/shipping-methods`);
  - os mercados (`/hub/markets`, todas as páginas);
  - os armazéns (`/hub/warehouses`, com `embalagem_g`);
  - a embalagem (`PUT /hub/warehouses/{id}/packaging`).

  Usam as mesmas funções das rotas da chave. Sem migração.
- **Hub:** os separadores «Contas», «Métodos de entrega» e «Embalagem». O
  formulário do método serve para criar e para mudar, e tem arquivar e
  reactivar. A embalagem tem uma linha por armazém.
- **Os números ONU não se mudam pelo Hub:** a classificação é de um
  profissional (L9).

## Números (com data e como se contaram)

- 13/10/2026, local:
  - 4 testes da API (`test/envios-hub-metodos.test.ts`), verdes;
  - 230 testes do Hub, verdes.

## O que ficou por verificar

- **Os prefixos dos códigos postais** não se conferem contra uma tabela de
  regiões: essa tabela (`zonas`, `docs/36` §3.2) ainda não existe.
- **A passagem só com o teclado**, feita à mão, não foi feita; as capturas
  usam o rato do Playwright.
- **Os métodos e a embalagem não têm rasto de auditoria.** Procurei-o nas
  migrações a 13/10/2026 e não o encontrei.
