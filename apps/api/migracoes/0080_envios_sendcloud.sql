-- Envios, parte C (docs/36 §16; docs/06, ED; issue #393; Diogo, 12/10/2026:
-- «ainda não; avança com a parte C»): a Sendcloud como segunda
-- transportadora, e os serviços de uma conta guardados nela (D1). Na
-- Sendcloud, os serviços dependem das transportadoras que cada conta tem
-- ligadas: ao passar a chamada de teste, o Eurolify guarda uma fotografia
-- deles; o checkout, os métodos e a etiqueta leem-na sem chamar a
-- Sendcloud. Os adaptadores de lista fixa (CTT) deixam-na vazia.
SET LOCAL lock_timeout = '10s';

ALTER TABLE conta_transportadora
  DROP CONSTRAINT conta_transportadora_transportadora_check,
  ADD CONSTRAINT conta_transportadora_transportadora_check
    CHECK (transportadora IN ('ctt', 'sendcloud')),
  ADD COLUMN servicos jsonb CHECK (servicos IS NULL OR (jsonb_typeof(servicos) = 'array'
    AND pg_column_size(servicos) <= 262144)),
  ADD COLUMN servicos_em timestamptz,
  ADD CONSTRAINT conta_transportadora_servicos_com_data
    CHECK ((servicos IS NULL) = (servicos_em IS NULL));

GRANT UPDATE (servicos, servicos_em) ON conta_transportadora TO eurolify_api;

-- Os códigos dos serviços da Sendcloud levam «:» e «/» (ex.:
-- `postnl:standard/signature`) e podem ir até 100 caracteres (o limite do
-- serviço na expedição, 0047).
ALTER TABLE metodo_entrega
  DROP CONSTRAINT metodo_entrega_servico_check,
  ADD CONSTRAINT metodo_entrega_servico_check
    CHECK (servico IS NULL OR servico ~ '^[0-9A-Za-z_.:/-]{1,100}$');
