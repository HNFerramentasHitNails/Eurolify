-- Os índices da exportação do titular (docs/23 §15.10, parte 3; revisão do
-- #411, P2-3; issue #233). A exportação procura as encomendas pela ficha e,
-- em cada uma, a pós-venda e os documentos; sem estes índices, cada consulta
-- percorria a tabela inteira do comerciante com a ficha presa. As chaves
-- estrangeiras não criam índice; a expedição, o pagamento e as transições já
-- os tinham.

SET LOCAL lock_timeout = '10s';

CREATE INDEX encomenda_por_cliente ON encomenda (comerciante_id, cliente_id);
CREATE INDEX pedido_livre_resolucao_por_encomenda
  ON pedido_livre_resolucao (comerciante_id, encomenda_id);
CREATE INDEX devolucao_por_encomenda ON devolucao (comerciante_id, encomenda_id);
CREATE INDEX problema_por_encomenda ON problema (comerciante_id, encomenda_id);
CREATE INDEX reembolso_por_encomenda ON reembolso (comerciante_id, encomenda_id);
-- O da fatura (`documento_fiscal_uma_fatura`) é parcial: as notas de
-- crédito ficavam de fora.
CREATE INDEX documento_fiscal_por_encomenda
  ON documento_fiscal (comerciante_id, encomenda_id);
