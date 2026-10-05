# Loja física, omnicanal e fiscalidade

Usa para balcão, POS, recolha, devolução noutro canal e emissão. Reutiliza os domínios existentes; os controlos abaixo são requisitos de desenho, não novos pareceres fiscais.

## Contrato e consumidor

A regra UE de livre resolução por mudança de opinião não é uma regra geral para compras realizadas numa loja física; a informação oficial distingue esta situação das compras à distância ([direitos nas compras](https://europa.eu/youreurope/citizens/consumers/shopping/shopping-consumer-rights/index_en.htm)). As garantias legais de bens defeituosos abrangem também compras em loja, com proteção nacional que pode exceder o mínimo UE ([garantias](https://europa.eu/youreurope/business/selling-in-eu/consumer-contracts-guarantees/consumer-guarantees/index_en.htm)).

Para click-and-collect, identifica celebração do contrato e não apenas a recolha. Usa a skill de consumidor para prazo, exceções, prova contratual, informação e remédios; confirma o país.

A função online de resolução do art. 11a da Diretiva 2011/83/UE, inserida pela Diretiva 2023/2673, abrange contratos à distância por interface online sujeitos a resolução e não fica limitada a serviços financeiros; a diretiva prevê aplicação das medidas nacionais desde 19/06/2026 ([texto alterador, art. 1 e art. 2](https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=OJ:L_202302673)). Confirma a transposição nacional antes de declarar uma interface conforme.

## Dados de uma venda física

Desenha entidade emitente, loja, posto/caixa, operador, turno, produto/variante, quantidade/unidade, preço, descontos, impostos aprovados, meio de pagamento e documento. Não mistura encerramento de caixa, liquidação PSP e emissão.

Stock e preços vêm do servidor autoritativo. Define reservas e conflitos entre balcão e online, transferência entre locais, recolha, cancelamento parcial e devolução sem duplicar o movimento.

## Emissão nacional

Para cada regime, confirma:

- Emitente, documento, certificação/licenciamento e integração autorizada.
- Numeração/série, assinaturas/códigos, comunicação e correção.
- Recibo de pagamento versus documento fiscal.
- Adiantamentos, devoluções/nota de crédito, perdas de rede e contingência.
- Retenção, integridade, acesso e exportação contabilística.

Não define estes valores por comparação com Shopify. Não usa a versão original antiga da Diretiva IVA para decidir regras atuais: lê consolidação/alterações e país. O pacote ViDA tem implementação faseada, sem dispensar os regimes nacionais ([Comissão, ViDA](https://taxation-customs.ec.europa.eu/taxation/vat/vat-digital-age-vida_en)).

## Dados, acessibilidade e controlo

Leitor de códigos e terminal não recebem acesso irrestrito. Permissões distinguem venda, desconto manual, abrir caixa, cancelar, reembolsar e exportar. Câmaras, fidelização, email de recibo e dados de empregados passam pela skill de privacidade.

Regras de acessibilidade incluem produtos e serviços específicos, entre eles terminais e comércio eletrónico, com exceções condicionadas; não presume isenção só por a loja ser pequena ([acessibilidade](https://europa.eu/youreurope/business/selling-in-eu/selling-goods-services/accessibility/indexamp_en.htm)). Verifica separadamente instalações e transposição local.

Testa o percurso inteiro e os caminhos de falha. Offline é uma capacidade a aprovar por regime, não um atalho para emitir documentos sem controlo.
