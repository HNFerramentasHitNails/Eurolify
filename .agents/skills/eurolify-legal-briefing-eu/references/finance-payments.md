# Financeiro, prestadores e conciliação

Usa para pagamentos, caixa, saldos, subscrições, crédito e exportação contabilística. Complementa `payments-psd2-sca`, `eu-vat-oss-ioss` e `gift-cards-eu`.

## Licenças e papéis

Identifica quem recebe, detém, transmite e liquida fundos. Preserva a decisão atual de a Eurolify não receber fundos dos comerciantes; não introduz custódia ou escrow como melhoria técnica.

O registo EBA é uma fonte de pesquisa, mas declara que não confere direitos e que a informação depende das autoridades nacionais; confirma a entidade e autorizações no registo competente ([EBA, instituições de pagamento e moeda eletrónica](https://www.eba.europa.eu/risk-and-data-analysis/data/registers/payment-institutions-register)). Um PSP, método ou conta aprovados não aprovam automaticamente todos os setores que o comerciante queira vender.

Crédito ao consumidor, BNPL, carteiras, saldos resgatáveis e instrumentos multi-comerciante exigem classificação própria. Não presume exceção de rede limitada, simples “crédito de loja” ou ausência de regulação pelo nome.

## Instrumento e IVA

A Diretiva 2016/1065 introduz tratamento distinto para vouchers de finalidade única e múltipla; não classifica todos os cartões-oferta de modo igual ([diretiva de vouchers](https://eur-lex.europa.eu/eli/dir/2016/1065/oj/eng)). A fonte original e a sua implementação nacional devem ser revistas antes de ativação; a skill existente mantém a porta.

Documento fiscal, meio de pagamento, comprovativo PSP, movimento comercial e reconhecimento contabilístico não são a mesma coisa. Plano de contas, receitas, responsabilidades, imposto e retenção são validados pelo profissional competente.

## Modelo de controlo proposto

- Cada movimento guarda entidade/comerciante, moeda, valor, referência autoritativa, tipo, estado e data.
- Conciliação distingue valor bruto, descontos, imposto, transporte, taxas, retenções, reembolso, chargeback e depósito.
- Ajustamentos têm motivo, autor e prova; não se reescrevem movimentos confirmados para esconder diferenças.
- Adiantamentos, cartões, crédito e subscrição precisam de tratamento aprovado, não simples soma no dashboard.
- Fecho de caixa, extrato bancário, liquidação PSP e exportação têm versões e responsáveis.
- Divergências ficam em fila. Uma correção contabilística/fiscal real não é uma ação automática de IA.

## Integração e falha

Usa checkout/terminal do prestador conforme contrato e desenho. Hosted checkout reduz certas responsabilidades técnicas, mas a informação oficial não o apresenta como conformidade universal ([pagamentos numa loja online](https://europa.eu/youreurope/business/growing/digitalising/setting-up-online-shop/index_en.htm)).

Verifica assinaturas, beneficiário, conta, referência, montante e moeda. Timeout após possível cobrança gera estado incerto e reconciliação, não repetição cega. Concilia e testa chargebacks, pagamentos parciais, devoluções parciais, várias liquidações e diferenças de câmbio quando aprovadas.

PSD3/PSR constavam como “próximos da adoção”, ainda sujeitos a adoção formal, na página consultada atualizada a 20/09/2026 ([Parlamento Europeu](https://www.europarl.europa.eu/legislative-train/theme-an-economy-that-works-for-people/file-revision-of-eu-rules-on-payment-services)). Não os aplica como substituição já confirmada da legislação atual.
