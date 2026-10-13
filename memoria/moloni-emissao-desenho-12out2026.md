# Moloni: a emissão lida na documentação e desenhada (#310, parte 2), 12/10/2026

## O que se fez

- **Pedido do Diogo, 12/10/2026:** *«sim, avança com o adaptador Moloni»*.
- Lidas em bruto 33 páginas de `moloni.pt/dev` (faturas, documentos, PDF,
  notas de crédito, clientes, artigos, taxas, isenções, séries, autenticação,
  erros): `docs/eurolify/fontes-api-moloni-11out2026.md` §9.
- Desenho da parte 2 em `docs/29` §13: o mapa contrato → Moloni, os tokens,
  as perguntas M1 a M8 e o que medir na conta trial. **Aprovado** pelo Diogo a
  12/10/2026 (*«sim, aprovo o desenho com as propostas M1 a M8»*; `docs/06`, DZ).

- **Código** no pedido #384 (migração **0069**, porque a 0068 entrou no
  `main` com as vendas do dia): adaptador, renovação dos tokens, configuração
  da ligação, M7 retida; `docs/29` §14.
- **Revisão** de um agente (Sonnet 5.5; 0 P0, 2 P1, 8 P2, 10 P3) publicada no
  #384 e corrigida: «não existe» só com a lista do Moloni vazia (P1-1); só as
  empresas de `MOLONI_EMPRESAS_TESTE` (P1-2, o M8 em código).

## Números (com data e como se contaram)

- 33 páginas descarregadas a 12/10/2026 (`curl` de cada endereço, texto
  extraído do HTML); 0 pedidos à API.
- Testes a 12/10/2026, contra PostgreSQL 18.6 local (Docker) e um Moloni
  simulado: 35 do adaptador, 10 pela API, 1 na pós-venda; bateria completa
  antes das correcções 1422 a passar e 4 a falhar (listas fechadas sem a
  migração nova, corrigidas).

## O que ficou por verificar

- As credenciais `MOLONI_*` **não estavam** no ambiente desta sessão
  (verificado a 12/10/2026, as quatro em falta): nada medido na conta trial.
- O ATCUD e o `document_product_id` não aparecem nas páginas do `getOne`;
  casas decimais do `price`; tamanho do `our_reference` (`docs/29` §13.7).

## 13/10/2026 — criar e configurar a ligação pelo Hub (#412)

### O que se fez
- Desenho no `docs/22` §31, aprovado pelo Diogo com a Q1 em A (`docs/06`,
  EH); código no pedido #412 (`docs/22` §31.8).
- O Moloni simulado mostrou que as isenções do Moloni (`{code, name,
  description}`) eram lidas como erro: agora um erro é só `{code,
  description}` com o código a começar por um número (página «Controlo de
  erros», lida a 13/10/2026).
- Revisão de um agente (Sonnet 5.5; 0 P0, 1 P1, 6 P2, 12 P3), publicada no
  #412 e tratada.

### Números (com data e como se contaram)
- 13/10/2026, PostgreSQL local (Docker) e Moloni simulado: bateria da API
  antes da revisão 1556 a passar e 1 saltado; Hub 231 a passar.
- Abrir «Configurar» são 8 pedidos ao Moloni; gravar até 10; as leituras do
  Hub ficam com 2/3 do limite por empresa (40 de 60).

### O que ficou por verificar
- Nada lido no Moloni real: as credenciais continuam fora do ambiente.
- `fiscal_zone`, `saft_type` e a paginação acima de 50 por medir.
