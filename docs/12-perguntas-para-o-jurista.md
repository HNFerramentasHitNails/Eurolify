# Perguntas para o jurista

> **Versão de 03/10/2026.** Da Luckytarget Lda, para o jurista que vier a
> acompanhar o Eurolify. Preparado pelo Diogo, com Claude. **Ainda não
> enviado.**
>
> As leituras de textos legais aqui são de quem desenha um produto, não
> pareceres. Onde se diz **«lido no texto»**, leram-se os artigos citados no
> EUR-Lex a 03/10/2026, na versão publicada em inglês (não a consolidada); o
> resto do acto não. O mapa completo, com as fontes, está em
> [`03-regulamentar-ue.md`](03-regulamentar-ue.md). O que é fiscal (IVA,
> faturas) vai ao contabilista e não está aqui.

## O Eurolify, em poucas linhas

- Plataforma de comércio electrónico por subscrição, da Luckytarget Lda,
  **vendida a comerciantes de toda a UE desde a primeira versão** (ADR-0006).
- Cada comerciante tem a sua loja. O Eurolify **guarda e publica** o catálogo
  dele, faz o **checkout** e serve os momentos legais (confirmação, livre
  resolução, garantia); a montra pode ser feita por terceiros, ligada por API.
- **Nunca recebe nem guarda o dinheiro dos comerciantes**: cada um liga a sua
  conta num prestador de pagamento (EuPago, Stripe, Mollie…).
- **Não emite faturas por si**: liga-se ao software de faturação certificado
  de cada comerciante.
- Alojado numa VPS num centro de dados na UE (o ensaio, sem dados pessoais
  reais, está por agora no Reino Unido: ADR-0018). **Sem vendedores terceiros**
  (marketplace) enquanto não houver caso de negócio.
- Estado: desenho; o código está autorizado desde 04/10/2026 (ADR-0023), sem
  produto em uso nem dados de clientes. O primeiro comerciante de fora só entra depois
  de os fluxos do consumidor e o contrato estarem validados por um jurista
  (ADR-0006).

## O que pedimos

1. **Parte A** — resposta antes de fecharmos o desenho da Fase 1: são
   perguntas que mudam o que se constrói.
2. **Parte B** — orçamento para as validações que têm de estar feitas antes do
   primeiro comerciante de fora.
3. **Partes C e D** — só uma primeira opinião; são para mais tarde.

---

## A. Perguntas que mudam o desenho da Fase 1

### A1. O Eurolify é «serviço de alojamento» do DSA, mesmo sem marketplace?

**Contexto.** O Eurolify guarda e publica, a pedido de cada comerciante, o
catálogo, as fotografias e os textos dele. O DSA (Reg. (UE) 2022/2065) define o
serviço de «alojamento» como a armazenagem de informação prestada por um
destinatário do serviço, a pedido dele (art. 3.º, alínea g), iii)). O mecanismo
de denúncia (art. 16.º) aplica-se a **todos** os prestadores de alojamento; as
micro e pequenas empresas só estão isentas dos relatórios de transparência
(art. 15.º, n.º 2) e da secção das plataformas em linha (art. 19.º). *Lido no
texto.* Hoje o nosso plano só põe obrigações do DSA na loja de extensões (Fase
3) e no marketplace (Fase 4).

**Exemplo.** Alguém denuncia que a loja de um comerciante vende um gel com TPO,
proibido nos cosméticos desde 01/09/2025.

**Perguntas.**
1. Nesta descrição, o Eurolify é prestador de serviço de alojamento? Pode ser
   «plataforma em linha» (art. 3.º, alínea i)), sendo cada loja do comerciante?
2. Se for alojamento, que obrigações tem uma micro ou pequena empresa: só o
   art. 16.º, ou também a fundamentação das decisões e a comunicação de
   suspeitas de crimes (arts. 17.º e 18.º, que não lemos)?
3. Quem responde a uma denúncia — o Eurolify, o comerciante, ou os dois — e o
   que pode o contrato dizer sobre isso?
4. Vale a partir do primeiro comerciante?

**O que fica à espera.** Se o canal de denúncias e a moderação entram na Fase 1
(`05-fases-e-mvp.md`, `10-estimativa-prazo-e-custo.md`).

### A2. A nova responsabilidade por produtos defeituosos e o software do Eurolify

**Contexto.** A Dir. (UE) 2024/2853 aplica-se a produtos colocados no mercado
**depois de 09/12/2026** (art. 2.º, n.º 1). Um considerando (13) diz que o
software é produto seja qual for o modo de fornecimento, **incluindo o
fornecido como serviço**. Prazo: 10 anos; 25 anos só para lesões corporais que
se manifestam tarde (art. 17.º). *Lido no texto.* Não lemos os artigos sobre
os danos indemnizáveis nem sobre as plataformas.

**Exemplo do tipo de caso que nos preocupa.** Uma actualização do Eurolify
corrompe os dados das contas de consumidores finais de várias lojas.

**Perguntas.**
1. O Eurolify, como software fornecido aos comerciantes, cai na directiva como
   produto? O «fabricante» é a Luckytarget?
2. Que danos contam, e de quem: os comerciantes são profissionais, os clientes
   deles não?
3. O contrato com o comerciante pode limitar esta responsabilidade?
4. Muda alguma coisa para os comerciantes que vendem produtos físicos no
   Eurolify, ou para o papel do Eurolify quando o comerciante não é
   identificável?
5. Já existe a lei portuguesa de transposição? (**não verificámos**)

**Prazo.** 09/12/2026 — 67 dias depois desta versão. O seguro (pergunta A4)
depende desta resposta.

### A3. O papel do Eurolify no RGPD e o acordo de tratamento de dados

**Contexto.** Desenhámos o Eurolify como **subcontratante** de cada comerciante
(os clientes são do comerciante) e **responsável** só nos tratamentos próprios:
contas dos comerciantes, faturação do Eurolify, segurança. Numa violação de
dados, o subcontratante avisa o responsável sem demora injustificada e
ajuda-o a cumprir (arts. 28.º, n.º 3, e 33.º, n.º 2); o responsável notifica a
autoridade sem demora e, se possível, até 72 h (art. 33.º, n.º 1). *Lido no
texto.*

**Exemplo.** Uma falha expõe dados de clientes de 40 lojas: cada um dos 40
comerciantes tem as suas 72 h.

**Perguntas.**
1. A divisão de papéis está certa? Há tratamentos em que o Eurolify é
   responsável, sozinho ou em conjunto — por exemplo, prevenção de fraude que
   cruze lojas, estatísticas da plataforma, ou um consumidor com conta em várias
   lojas?
2. O que tem de ter o nosso acordo de tratamento de dados (art. 28.º) e a lista
   de subcontratantes ulteriores (o fornecedor da VPS, o das cópias de
   segurança)?
3. Como deve correr o aviso de uma violação a dezenas de comerciantes ao mesmo
   tempo, para cada um cumprir o seu prazo?
4. As faturas guardam-se 10 anos (art. 52.º do CIVA). Perante um pedido de
   apagamento, chega pseudonimizar a ficha e guardar os documentos fiscais?

### A4. O contrato de serviço com os comerciantes, o seguro e a saída

**Contexto.** O Eurolify decide o IVA de cada linha e prepara os documentos que
o software certificado do comerciante emite; um erro nosso vira uma nota de
crédito e um telefonema do comerciante ao cliente dele. Pelo Data Act, a partir
de **12/01/2027** não se pode cobrar pela saída; aviso máximo de 2 meses,
transição até 30 dias, direitos de mudança escritos no contrato (arts. 25.º e
29.º) — **só lido em resumos**, não no texto (`09-modelo-de-receita.md` §6).

**Exemplo.** O motor de IVA aplica a taxa errada às faturas de um comerciante
durante um fim de semana.

**Perguntas.**
1. O que pode o contrato limitar perante os comerciantes e perante os
   consumidores deles?
2. Que seguro de responsabilidade civil profissional e ciber faz sentido, e com
   que capitais?
3. Que cláusulas de mudança de fornecedor tem o contrato de ter para cumprir o
   Data Act, incluindo a exportação completa dos dados?
4. A nossa regra «na dúvida, o documento fica retido em vez de sair» — o
   comerciante vê porquê e decide — muda alguma coisa na responsabilidade?

### A5. Uma margem sobre os pagamentos, cobrada através do prestador

**Contexto.** A receita decidida é uma mensalidade por escalões, sem taxa sobre
as vendas (ADR-0007). Uma fonte estudada, por decidir, é a Mollie Connect: a
plataforma fixa uma margem ou taxa por pagamento e a Mollie liquida-a no saldo
da plataforma; o dinheiro do comerciante **nunca** passa pelo Eurolify
(`09-modelo-de-receita.md`, fonte 4).

**Exemplo** (valor inventado para a pergunta). 0,10 € por pagamento, retido
pela Mollie e pago à Luckytarget.

**Perguntas.**
1. Receber essa margem obriga a Luckytarget a alguma autorização ou registo
   como prestador de serviços de pagamento?
2. Que transparência é obrigatória perante o comerciante, e onde?
3. Muda alguma coisa perante os consumidores?

### A6. Consumidor ou profissional, encomenda a encomenda

**Contexto.** Muitas regras só valem para consumidores. Desenhámos assim: o
comprador declara, em cada encomenda, se compra como profissional; por omissão
é consumidor; ter NIF não faz de ninguém profissional (em Portugal, um
particular também tem NIF).

**Exemplo.** Um profissional de estética compra material com o NIF da empresa;
um particular compra o mesmo produto e também indica o NIF dele.

**Perguntas.**
1. Esta regra protege o comerciante? Chega a declaração do comprador, ou é
   preciso mais (por exemplo, um NIF de empresa validado no VIES)?
2. Numa encomenda declarada profissional, que obrigações de consumidor deixam
   de se aplicar (livre resolução, garantia legal, botão de livre resolução)?

---

## B. Validações antes do primeiro comerciante de fora (pedido de orçamento)

O Eurolify é para toda a UE desde o início (decisão F, `06-decisoes-em-aberto.md`).
Os textos e fluxos abaixo são servidos pelo Eurolify em todas as lojas.

1. **Checkout e informação antes do botão final**: características principais,
   preço total, preço por unidade, selo da garantia comercial de durabilidade,
   duração do contrato (art. 8.º, n.º 2, da Dir. 2011/83/UE, na redacção da
   Dir. (UE) 2024/825 — *lido no texto*); o texto do botão final em cada língua.
2. **Livre resolução**: o botão do art. 11.º-A (obrigatório desde 19/06/2026),
   as excepções (bens selados por razões de higiene; conteúdos digitais, art.
   16.º, alínea m) — *lido no texto*), o reembolso.
3. **Garantia**: o aviso harmonizado da garantia legal e o selo da garantia de
   durabilidade (o desenho vem de actos de execução que **não lemos**); os 12
   meses a mais quando o consumidor escolhe a reparação (Dir. (UE) 2024/1799 —
   *lido no texto*).
4. **Avaliações, resultados de pesquisa pagos e preço personalizado** (Dir.
   2005/29/CE e Dir. 2011/83/UE, na redacção da Omnibus — *lido no texto*).
5. **Páginas legais por omissão**: termos, privacidade, cookies; **sem** a
   ligação à plataforma europeia de litígios (encerrada a 20/07/2025); com a
   informação de RAL e o Livro de Reclamações em Portugal.
6. **Documentos do próprio Eurolify**: contrato de serviço, acordo de
   tratamento de dados, política de privacidade.

**Pergunta.** Como organizar a validação por país — um jurista por país, ou um
escritório com rede europeia — e por que países começar?

---

## C. Para a Fase 3 (extensões e comércio por agentes) — primeira opinião

### C1. A loja de extensões

1. Que obrigações do DSA tem uma loja de extensões pequena
   (`08-extensoes-de-terceiros.md` §7)?
2. A Lei da Ciber-resiliência (Reg. (UE) 2024/2847) apanha a linha de comandos,
   as bibliotecas e o SDK que o Eurolify distribuir? As obrigações de
   notificação aplicam-se desde 11/09/2026 e o resto a 11/12/2027 (*lido no
   texto*).

### C2. A IA no Eurolify

O comerciante liga o seu assistente de IA ao Eurolify (na Fase 1, só para
consultar); mais tarde, agentes de compras poderão comprar nas lojas.

1. No AI Act, quem é «prestador» e quem é «responsável pela implantação» nestes
   dois casos?
2. O aviso de que se está a falar com uma IA (art. 50.º) aplica-se desde
   02/08/2026 (*lido no texto*, art. 113.º, não alterado pelo Reg. (UE)
   2026/1744): em que casos é obrigação do Eurolify?
3. **Esta já se aplica:** a literacia em IA (art. 4.º, desde 02/02/2025, na
   redacção do Reg. (UE) 2026/1744 — «tomar medidas para apoiar»). A Luckytarget
   desenvolve o Eurolify com assistentes de IA: que medidas chegam?

---

## D. Quando o Eurolify crescer

1. **NIS2** (Dir. (UE) 2022/2555): aplica-se a médias empresas ou maiores dos
   anexos I e II (art. 2.º, n.º 1); os fornecedores de computação em nuvem estão
   no anexo I e os mercados em linha no anexo II; num incidente, 24 h, 72 h e
   um mês (art. 23.º, n.º 4) — *lido no texto*. O Eurolify cabe num deles? O que
   diz a lei portuguesa de transposição (**não verificámos**)?
2. **Marketplace** (Fase 4, só com caso de negócio escrito): rastreabilidade dos
   vendedores (art. 30.º do DSA), quem liquida o IVA, DAC7. Não pedimos nada
   agora.

---

## O que não verificámos

- Nenhum texto legal foi lido por inteiro, e nenhuma versão consolidada: se um
  acto foi alterado depois, não o vimos (salvo o Reg. (UE) 2026/1744, que
  altera o AI Act).
- Nenhuma lei nacional de transposição (responsabilidade por produtos, NIS2,
  REEE).
- Que o Eurolify seja «serviço de alojamento» do DSA é leitura nossa do texto.
- Os actos de execução com o desenho do aviso da garantia legal e do selo da
  garantia de durabilidade.
- O Data Act só foi lido em resumos.
