# ADR-0044 · O balcão vende pelo POS do Hub; o Moloni só emite as faturas

- **Estado:** aceite · substitui a saída do balcão do ADR-0043 (`docs/13` §7)
- **Data:** 11/10/2026
- **Quem decidiu:** Diogo (*«O POS será utilizado o do hub. O Moloni é só para
  facturação»*; e, à interpretação «o POS do Hub do Eurolify, o Moloni só a
  emitir as faturas de cada venda», *«sim, regista a DT»*). A letra ficou **DV**:
  a DT foi usada no mesmo dia pela pós-venda (#363) e a DU está reservada pelo
  #369
- **Decisão em aberto de origem:** a saída do balcão (`docs/13` §7), aprovada
  na DS (ADR-0043) no mesmo dia; issue #355

## Contexto

- O balcão (POS) passou pelas 8 portas a 11/10/2026 (`docs/13` §7) com a saída
  **estreitar e investigar**: o primeiro alvo **não era um POS do Eurolify**,
  mas a ligação a um POS certificado que o comerciante já usa, com esse POS a
  emitir o documento. A DS (ADR-0043) aprovou-a.
- Os testes da API do Moloni do mesmo dia (`docs/eurolify/fontes-api-moloni-11out2026.md`
  §8) mostraram que essa ligação era possível: as vendas de um terminal de
  POS lêem-se com o `terminal_id`.
- Em Portugal, as faturas só se emitem por software certificado (`docs/03`,
  **C**+**M**); o Eurolify não o é e emite pelo adaptador do Moloni (ADR-0037,
  fatia 10).

## Opções consideradas

| Opção | A favor | Contra |
|---|---|---|
| A ligação a um POS certificado (a saída da DS) | Pouco para construir; o POS e a emissão já existem | O balcão fica num programa de fora, com o stock, os preços e os clientes a ir e vir por uma ligação |
| **O POS do Hub, a emitir pelo Moloni** | O balcão é o Eurolify: o mesmo stock, os mesmos preços e a mesma ficha de cliente, sem ligação a sincronizar; o Moloni faz só o que tem de fazer, a fatura certificada | O POS constrói-se (porta 7 ❌ do `docs/13` §7); cada venda depende do Moloni em linha |

## Decisão

1. **O balcão vende pelo POS do Hub do Eurolify.** A venda nasce no
   Eurolify, como encomenda do canal «balcão», e baixa o stock pelo livro de
   movimentos (`docs/27`).
2. **O Moloni só emite as faturas** de cada venda ao balcão, pelo mesmo
   adaptador da fatia 10 (ADR-0037). O Moloni não é POS, nem fonte de stock,
   preços ou clientes do Eurolify.
3. **Sai do primeiro alvo** a ligação a um POS de fora (ler as vendas da app
   «Moloni POS» ou de outro POS certificado).

Não muda a fase: o balcão continua na Fase 2 (ADR-0042). Não é uma decisão de
desenho: o POS tem o modelo e a lista da API em tabela antes do código
(ADR-0023), e construí-lo continua a ser decisão do Diogo ou do Bruno.

## Consequências

- **Construir o POS é o custo que a porta 7 apontava** (`docs/13` §7): caixa e
  turnos, leitor, impressora de talões, terminal de pagamento por prestador
  (`eurolify-payment-readiness-eu`), permissões finas e acessibilidade dos
  terminais. O desenho tem de estreitar outra vez: um tipo de comerciante
  (loja online com um balcão, em Portugal, que emite pelo Eurolify), um papel
  (quem vende ao balcão), um fluxo (venda paga ao balcão).
- **Cada venda depende do Moloni no momento.** Sem rede ou sem Moloni, o
  balcão não emite. O que a lei permite em contingência **não está
  verificado** (**C**; `eurolify-legal-briefing-eu`,
  `references/retail-pos-tax.md`): pergunta para o contabilista antes do
  desenho. Até lá, o POS não vende sem emitir (regra da fatia 10: reter em vez
  de emitir errado, `docs/29`).
- **O stock do Moloni deixa de se ler.** Cada documento emitido baixa sozinho
  o stock do Moloni (teste P3, §8 das fontes); o livro é do Eurolify (DE Q3) e
  o stock do Moloni vai afastar-se do real. Nenhuma parte do Eurolify o lê.
- **Um comerciante cujo sistema de gestão emite** (ADR-0041) não usa o
  emissor do Eurolify; como vende ao balcão nesse caso **não está decidido**.
- Ficam por decidir no desenho, como já dizia a porta 6: a caixa
  (`pos_fiscal`, decisão DF), o PIN pessoal frente à passkey (decisão CA), e
  que a venda ao balcão não reaproveita o checkout alojado nem a livre
  resolução (ADR-0039; `eurolify-physical-retail-eu`).
- O `docs/13` §7, o `docs/31`, o `docs/06` (DV), o ADR-0043, as fontes do
  Moloni e a memória passam a dizê-lo.
- Pode partir: quem leia o ADR-0043 ou o `docs/13` §7 sozinho julga que o
  primeiro alvo é a ligação a um POS de fora. Os dois passam a remeter para
  este ADR.

## O que ficou por verificar

- A contingência fiscal sem rede, em Portugal (**C**).
- O que custa construir o POS: não está estimado.
- A procura (portas 3 e 4 do `docs/13` §7): nenhum comerciante ouvido.
