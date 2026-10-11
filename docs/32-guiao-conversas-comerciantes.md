# Guião das conversas com os comerciantes

> **Versão de 11/10/2026.** Pedido do Diogo, 11/10/2026: *«prepara o guião das
> conversas com os comerciantes»* (issue #355). Serve três perguntas em
> aberto; até hoje ninguém de fora foi ouvido (`docs/05`, Fase 0, «Conversas
> com 3 a 5 comerciantes — por fazer»):
>
> 1. **o balcão (POS)** — as portas 3 e 4 do `docs/13` §7: já se gasta dinheiro
>    ou tempo com o stock desencontrado entre a loja online e o balcão? Chegamos
>    a quem o compra?
> 2. **os módulos de gestão da empresa** (decisão DR, ADR-0042) — o que já pagam
>    fora da loja (comercial, compras, financeiro, pessoas…) e o que pesa mais;
> 3. **os preços** (D-14, `docs/09` §7) — quanto pagam hoje e a quem.
>
> Também cobre as perguntas mínimas por módulo do `docs/13` («O que isto pede
> ao Diogo ou ao Bruno», ponto 2).
>
> Feito a partir da referência `interview-script` da skill `eurolify-design`
> (perguntas abertas, do geral para o particular, «a última vez que…», nada
> que sugira a resposta). **Quem conduz é o Diogo ou o Bruno**; o guião não
> substitui o juízo de quem está na conversa.

## 1. A quem perguntar

| Critério | Porquê |
|---|---|
| **5 comerciantes estabelecidos num país da UE**, com loja online **e** pelo menos um balcão (loja, showroom, feira) | É o alvo estreito do balcão (`docs/13` §7) |
| De fora do grupo — as lojas do próprio grupo contam como **um** | `docs/13`, «O que vale para todos» |
| Pelo menos 1 que já use um POS ligado ao software de faturação (ex.: o do Moloni) e pelo menos 1 que use outro | Para comparar o que já está resolvido |
| Mistura de tamanhos: 2 pequenos (1 a 3 pessoas), 2 médios, 1 com mais de um balcão | A pequena loja vê o necessário, a maior tem locais e permissões (`eurolify-commerce-coverage-eu`, ponto 5) |
| De preferência sectores diferentes | Para não desenhar só para um sector (porta 5) |

**Para a porta 4** («conseguimos nomear 50 comerciantes que o usariam»): no
fim de cada conversa pede-se quem mais conhecem na mesma situação (§4,
pergunta 22). Os nomes ficam **fora do repositório**.

## 2. Antes da conversa

- **45 minutos**, por vídeo ou presencial. Duas pessoas, se possível: uma
  pergunta, outra toma notas.
- **Dizer ao que se vai**: estamos a estudar como os comerciantes com loja e
  balcão trabalham hoje; não vamos vender nada nesta conversa. Mostrar o
  Eurolify só no fim, se pedirem — mostrar antes faz o comerciante responder
  ao produto, não ao trabalho dele.
- **Dados da pessoa** (`eu-gdpr-privacy`): pedir autorização para tomar
  notas; **gravar só com autorização explícita**, dita no início e anotada;
  dizer para que servem as notas e quanto tempo se guardam. Que base legal e
  que prazo se usam **não verifiquei** — confirmar antes da primeira
  conversa. **No repositório não entram** nomes, contactos, nome da empresa
  nem números que a identifiquem: cada comerciante é «Comerciante A», «B»…
- Não levar perguntas sobre clientes do comerciante pelo nome; se ele os
  nomear, não se anota o nome.

## 3. Como perguntar

- **Começar largo e acabar no particular.** Primeiro como trabalham, depois o
  balcão, depois o resto.
- **Pedir casos, não opiniões:** «a última vez que…», «o que aconteceu a
  seguir?», «como resolveu?». Uma opinião sobre o futuro («usaria?») vale
  pouco; um caso com data e número vale muito.
- **Não sugerir a resposta.** Em vez de «isso é frustrante?», «como foi para
  si?». Em vez de «pagaria por…?», «quanto gasta hoje com isso?».
- **Pedir o número** sempre que houver um: euros por mês, horas por semana,
  vendas perdidas, quantas vezes. E perguntar **como chegou a ele** (fatura,
  estimativa, «acho que…»).
- **Silêncio é bom.** Depois de uma resposta, esperar; o melhor vem muitas
  vezes a seguir.
- Se a conversa fugir para um tema útil, deixar ir; voltar ao guião quando
  acabar. Se fugir para um inútil, «voltando a…».

## 4. As perguntas

### Abertura (5 min)

1. Conte-me como é o seu negócio: o que vende, onde, a quem, quantas pessoas
   trabalham consigo.
2. Em que país está estabelecida a empresa, e para que países vende?
3. Um dia normal: o que ocupa mais tempo, a si e à equipa?

### O balcão (15 min) — portas 3 e 4 do `docs/13` §7

4. Como vende ao balcão hoje? Que programa ou equipamento usa para cobrar e
   passar o documento?
5. Quem lhe vendeu esse programa, quanto paga por ele (por mês ou por ano) e
   desde quando?
6. Como é que o stock do balcão e o da loja online se encontram? O que faz,
   e quem o faz, para ficarem iguais?
7. **A última vez que** vendeu online uma coisa que já tinha saído no balcão
   (ou o contrário): o que aconteceu? Com o cliente, com a encomenda, com o
   documento fiscal?
8. Quantas vezes isso acontece, num mês? Como sabe esse número?
9. Quanto tempo gasta a equipa, por semana, a acertar stock, preços ou
   artigos entre o balcão e a loja online?
10. Um cliente que compra ao balcão e outro dia online: é a mesma ficha nos
    dois sítios? Como sabe que é o mesmo?
11. Quando um cliente devolve ao balcão uma coisa comprada online (ou o
    contrário), como trata?
12. O que o fez escolher o programa do balcão que tem? O que mudaria nele?

### A empresa para lá da loja (12 min) — módulos de gestão (DR)

13. Além da loja e do balcão, que programas, folhas de cálculo ou serviços
    usa para gerir a empresa? Por exemplo: vendas da equipa comercial,
    compras a fornecedores, despesas e banco, horários e férias da equipa,
    tarefas e projectos, marketing. (Ler a lista só depois de ele responder
    sem ajuda.)
14. De cada um: quanto paga por mês, e quem o usa?
15. Qual deles lhe dá mais trabalho por não falar com os outros? Conte-me a
    última vez que isso custou tempo ou dinheiro.
16. Quantos armazéns ou locais de stock tem, e como separa as encomendas?
17. Como trata hoje uma devolução, do pedido do cliente até à nota de
    crédito? Quem faz cada passo?
18. Que software de faturação usa, e quem o escolheu (a empresa ou o
    contabilista)?
19. Que avisos automáticos lhe poupariam tempo? Pense na última vez que
    soube de um problema tarde de mais.
20. Há alguma informação que precisa de guardar e não tem onde (num artigo,
    num cliente, numa encomenda)?

### O que paga hoje (5 min) — D-14

21. Somando tudo — plataforma da loja, extensões, POS, faturação,
    contabilista, outros programas —, quanto paga por mês? Que parte disso
    sente que paga sem tirar proveito?

### Fecho (3 min)

22. Conhece outros comerciantes com loja e balcão que vivam o mesmo? Poderia
    apresentar-nos? (Os contactos ficam fora do repositório.)
23. Há alguma coisa que não perguntei e que devia ter perguntado?
24. Podemos voltar a falar quando tivermos algo para mostrar?

## 5. Depois da conversa — a ficha

Preenche-se **no próprio dia**, sem nomes, numa memória nova
(`memoria/conversas-comerciantes-<data>.md`, uma linha no índice). Um número só entra com **como foi
contado** (fatura, estimativa do comerciante, conta nossa).

| Campo | Comerciante A |
|---|---|
| País de estabelecimento · sector · tamanho (pessoas) · n.º de balcões | |
| POS usado · quanto paga (€/mês) · como sabe | |
| Vende o que já não tem? Quantas vezes por mês · como sabe | |
| Horas por semana a acertar stock, preços, artigos · como sabe | |
| Mesma ficha de cliente no balcão e online? | |
| Devolução cruzada (online → balcão) · como trata | |
| Outros programas de gestão · quanto paga cada um | |
| O que mais pesa por não falar com o resto · o caso contado | |
| Armazéns · devolução até à nota de crédito · software de faturação | |
| Avisos que poupariam tempo · campos em falta | |
| Total que paga hoje (€/mês) | |
| Quantos conhecidos indicou (só o número) | |
| Frase que resume a dor, nas palavras dele (sem o identificar) | |

**Como se lê, para as portas:**

- **Porta 3 passa** num módulo quando pelo menos 3 dos 5 já gastam dinheiro
  (um programa, uma extensão, um consultor) ou horas medidas com o problema.
  **Proposta** de critério; decide o Diogo ou o Bruno.
- **Porta 4** passa quando, com os conhecidos indicados, se consegue nomear 50
  comerciantes na mesma situação (`platform-architect`, as 8 portas).
- Uma resposta sem caso nem número conta como «não se sabe».

## 6. O que não foi verificado

- A base legal e o prazo para guardar as notas das conversas (`eu-gdpr-privacy`;
  jurista se houver dúvida).
- O critério de «3 dos 5» para a porta 3 é proposta, não está escrito na
  skill.
- O guião não foi experimentado com ninguém; a primeira conversa serve também
  para o afinar.
