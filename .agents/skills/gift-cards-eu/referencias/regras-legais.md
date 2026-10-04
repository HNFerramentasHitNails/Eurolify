# Regras legais e fiscais dos cartões-oferta na UE

> Do pacote enviado pelo Diogo a 04/10/2026 (`ORIGEM.md`), que diz ter sido
> «verificado a 4 de outubro de 2026». **Todas as linhas são C** até alguém
> ler o texto no EUR-Lex: a sessão de 04/10/2026 não conseguiu (resposta vazia
> do EUR-Lex). A validade dos vales, a livre resolução e o enquadramento
> financeiro validam-se por país antes de lançar: não há um regime único para
> os 27.

## O que é um vale

| Regra | Fonte citada | Marca |
|---|---|---|
| Vale (para o IVA): obrigação de o aceitar como pagamento, total ou parcial, e os bens, serviços ou fornecedores identificados no vale ou na documentação. Pode ser físico ou electrónico. Um cupão que só dá desconto não segue estas regras | Dir. (UE) 2016/1065 (art. 30.º-A da Dir. 2006/112/CE) | **C** |
| Uma representação digital de valor usada para pagar não é, por si, conteúdo nem serviço digital ⇒ um PDF com um cartão-oferta não herda a renúncia de um ebook | Dir. (UE) 2019/770, considerando 23 | **C** |
| SPV: local da entrega e IVA devido conhecidos ao emitir. MPV: todo o vale que não é SPV. Informação insuficiente ⇒ não se vende; não se assume MPV | Dir. (UE) 2016/1065 | **C** |

## IVA

| Momento | SPV | MPV | Fonte citada | Marca |
|---|---|---|---|---|
| Venda do vale em nome próprio | tratada como a entrega dos bens ou serviços | não é o momento do IVA da entrega | art. 30.º-B | **C** |
| Resgate | não se tributa outra vez a mesma entrega; analisar a cadeia emissor–fornecedor | IVA na entrega dos bens ou serviços | art. 30.º-B | **C** |
| Comissão de distribuição ou promoção | avaliar como serviço à parte | serviço identificável pode tributar-se à parte | art. 30.º-B | **C** |
| Base no resgate de um MPV | — | o que foi pago pelo vale (ou, se não se souber, o valor indicado), sem o IVA; resgate parcial na proporção | art. 73.º-A e considerando 11 | **C** |
| Vale que caduca sem uso | — | a directiva não resolve por inteiro; não se inventa um IVA, e o registo contabilístico é outra decisão | considerando 12 | **C** |

**Exemplo para teste, não é regra:** MPV de valor nominal 100 €, comprado por
90 €; resgate de 40 € nominais numa entrega a 23 %, com uma alocação simples
aprovada. Pago alocado: 36 €; base 36 / 1,23 = 29,27 €; IVA 36 − 29,27 = 6,73 €.
Saldo nominal: 60 €. Não se aplica sem adaptar a resgates mistos, subsídios,
agentes, preço pago desconhecido e regras nacionais.

## Livre resolução, validade e reembolso

| Regra | Fonte citada | Marca |
|---|---|---|
| Desenho conservador proposto: 14 dias de livre resolução para um vale **não usado** vendido online, sujeito à classificação do contrato e à lei do país. É escolha de desenho, **não** prova de regime harmonizado | leitura do pacote; Dir. 2011/83/UE | **C** |
| Não há excepção geral para cartões-oferta na Dir. 2011/83/UE; a entrega por e-mail não é a excepção dos conteúdos digitais; um resgate parcial não tira automaticamente todos os direitos | Dir. 2011/83/UE; Dir. (UE) 2019/2161 | **C** |
| Por país: quem exerce o direito (quem comprou ou quem recebeu), quando começa o prazo, efeito do resgate, montante a devolver, cancelamento do vale e reposição do saldo | leitura do pacote | **C** |
| Botão de livre resolução e confirmação em suporte duradouro, desde 19/06/2026 | Dir. (UE) 2023/2673 | já no `docs/03` §2 |
| Reembolso de uma compra: pelo meio de pagamento usado, salvo acordo; nunca transformar dinheiro em crédito da loja sem consentimento. Compra paga parte com vale e parte com cartão: alocação rastreável, sem devolver a mais | Dir. 2011/83/UE, art. 13.º | **C** |

## Porta financeira: PSD2 e moeda electrónica

| Regra | Fonte citada | Marca |
|---|---|---|
| Ser vale para o IVA não prova que fica fora da regulação dos pagamentos. As redes limitadas podem caber na exclusão do art. 3.º, alínea k), mas as condições avaliam-se; alargar a muitos comerciantes ou categorias pode mudar o enquadramento | Dir. (UE) 2015/2366 (PSD2), art. 3.º, alínea k) | **C** |
| Acima de 1 milhão de € de operações nos 12 meses anteriores, nas actividades do art. 3.º, alínea k), i) e ii), pode haver notificação à autoridade; não é isenção automática abaixo nem proibição acima | PSD2, art. 37.º | **C** |
| Primeiro desenho: programa fechado por comerciante, sem recarga, transferências entre pessoas, conversão ou levantamento; vales de vários comerciantes e carteiras de pagamento bloqueados até revisão com o jurista e, se for preciso, um parceiro autorizado | leitura do pacote; o Eurolify nunca guarda fundos de terceiros (`docs/03` §5) | **C** |

## Só na UE, sem discriminar entre Estados-membros

Uso nos países e territórios aprovados, com as restrições ditas **antes** da
compra. Nunca excluir um comprador de outro Estado-membro pela nacionalidade
ou pelo IP; restrições de contrato e de acesso validam-se com a regra do
geobloqueio (Reg. (UE) 2018/302, **C**).
