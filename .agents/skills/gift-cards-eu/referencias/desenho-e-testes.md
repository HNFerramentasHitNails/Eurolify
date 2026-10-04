# Desenho e testes dos cartões-oferta

> Do pacote enviado pelo Diogo a 04/10/2026 (`ORIGEM.md`). Os nomes são
> **propostas**: adaptam-se ao desenho dos domínios (Pagamentos, Encomendas,
> Motor de IVA) e às ferramentas do ADR-0025. Não cria uma carteira de
> pagamentos.

## Dados propostos

| Registo | O que guarda |
|---|---|
| programa de vales | emissor na UE, comerciante e fornecedores aceites, países e territórios, moeda, regras de validade e de reembolso, classe SPV/MPV, fundamento fiscal, versão |
| vale | comerciante e programa, identificador interno, segredo protegido, valor nominal, preço pago, moeda, histórico da alocação fiscal, beneficiário quando preciso, emissão, validade, estado. O código inteiro nunca em análises, registos ou ecrãs de administração |
| movimento do vale | emissão, reserva, libertação, resgate, estorno, suspensão, cancelamento, reembolso; montante nominal e valor pago alocado; chave de idempotência, encomenda e linha, reembolso do prestador, quem, quando e o movimento anterior quando compensa |
| facto fiscal | quem fatura, momento, país e território, categoria e taxa, base, IVA, documento, versão, e se vem da emissão ou do resgate. À parte do saldo nominal |

Fotografia do contrato e comprovativo em suporte duradouro. Retenção
aprovada por tipo de registo (`eu-gdpr-privacy`), não «tudo para sempre».

## Invariantes

- O saldo disponível nunca é negativo; o reservado nunca passa o livre.
- Montantes em inteiros na menor unidade da moeda, com regra de
  arredondamento escrita (`headless-commerce`, regra 8).
- O saldo resulta de movimentos imutáveis; corrigir é compensar.
- O resgate é atómico (transacção com bloqueio ou equivalente, testado).
- A mesma chave de idempotência nunca dá duas emissões, dois resgates ou dois
  reembolsos.
- O vale só fica activo com o pagamento confirmado no servidor.
- Movimento, encomenda, e-mail e prestador de pagamento ficam consistentes
  pelo outbox; as falhas conciliam-se (`platform-architect`, regra 5).
- No resgate, o vale é forma de pagamento, não desconto (ver o choque com a
  carteira na `SKILL.md`).

## Ciclo

Pagamento confirmado → emissão → entrega imediata ou agendada → activo →
reserva → resgate parcial ou total. Pagamento falhado ou cancelado liberta a
reserva; a devolução de uma compra estorna conforme a regra aprovada.
Suspensão, estorno bancário e caducidade são estados próprios, não resgates.

No mesmo carrinho, comprar um vale novo e pagar com um vale existente são
fluxos separados. Ficam desligados no início: comprar um vale com outro vale,
recargas e pacotes de crédito.

## Testes que impedem o lançamento

| Caso | Resultado exigido |
|---|---|
| Aviso de pagamento repetido | Uma emissão, um movimento, uma entrega |
| SPV emitido e resgatado | O IVA da entrega já tributada não se repete |
| MPV emitido | Não aparece como «isento»; o facto fiscal fica à parte |
| MPV resgatado | IVA da entrega calculado no resgate |
| MPV nominal 100 €, pago 90 €, usados 40 € | Saldo nominal 60 €; pago alocado 36 € (alocação simples aprovada) |
| MPV com taxas de IVA misturadas | Alocação por linha e por taxa, sem taxa média |
| MPV com preço pago desconhecido | Regra aprovada do valor indicado, sem inventar preço |
| Dois resgates em simultâneo com saldo curto | Só um confirma; saldo nunca negativo |
| Reserva caducada ou pagamento falhado | A reserva liberta-se uma vez, sem criar crédito |
| Reembolso repetido ou aviso fora de ordem | Nada duplicado; conciliação com rasto |
| Comprar um vale e pagar com vale no mesmo pedido | Fluxo recusado; nunca disfarçado de desconto |
| Vale de outro comerciante, programa ou moeda | Recusado, sem mostrar dados do beneficiário |
| Tentativas em força bruta de códigos | Limite de tentativas e alerta; sem enumeração |
| E-mail enviado ao beneficiário | Não se marca perda da livre resolução |
| Vale não usado dentro do prazo aprovado | Saldo cancelado ou suspenso de forma atómica e reembolso devido feito |
| Livre resolução com resgate parcial | Segue a regra aprovada; nunca «não reembolsável» automático |
| Devolução de compra paga com vale e cartão | Alocação com rasto; não se devolve a mais |
| Vale caducado sem uso | Nenhum IVA de MPV inventado nem receita sem regra contabilística |
| Resgate em vários comerciantes pedido | Bloqueado pela porta financeira |
| Beneficiário noutro Estado-membro aprovado | Não se bloqueia pela nacionalidade ou língua; confere território e termos |
| Fornecedor de e-mail, registos ou cópias fora da UE | A porta «só UE» não passa |

## Antes de publicar um programa

Emissor e quem fatura identificados; programa classificado; países e
territórios aprovados; regras de validade e de livre resolução de cada país
aprovadas; enquadramento financeiro validado; dados e subcontratantes na UE
verificados; testes corridos de facto; suporte preparado para resgates e
reembolsos; conciliação e alertas a funcionar. A lista não activa nada por
existir.
