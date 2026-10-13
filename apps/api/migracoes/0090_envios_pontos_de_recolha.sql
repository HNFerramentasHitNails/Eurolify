-- Envios: entrega num ponto de recolha ou cacifo (docs/36 §21; Q5, parte 3;
-- issue #393; Diogo, 13/10/2026: «sim, aprovo; avança com o código»). Ex.: o
-- método «Entrega num ponto» de uma conta da Sendcloud; o cliente escreve o
-- código postal, escolhe a «Papelaria Central» e a etiqueta sai para lá.
--
-- - O método diz onde entrega: `morada` (como até aqui) ou `ponto`. Um
--   método `ponto` tem sempre conta e serviço (o serviço declara-se para
--   pontos; confere-o a API, como o resto do serviço).
-- - A sessão conta as procuras de pontos (no máximo 20, §21.3): cada procura
--   é uma chamada à transportadora com a conta do comerciante.
-- - O ponto escolhido fica na `entrega` da sessão e da encomenda (a morada do
--   ponto e o `ponto`), sem coluna nova: o apagamento do titular (0072) já
--   deixa só o país.
SET LOCAL lock_timeout = '10s';

ALTER TABLE metodo_entrega
  ADD COLUMN entrega text NOT NULL DEFAULT 'morada' CHECK (entrega IN ('morada', 'ponto')),
  ADD CONSTRAINT metodo_entrega_ponto_com_conta
    CHECK (entrega = 'morada' OR (conta_transportadora_id IS NOT NULL AND servico IS NOT NULL));

ALTER TABLE sessao_checkout
  ADD COLUMN procuras_pontos smallint NOT NULL DEFAULT 0
    CHECK (procuras_pontos BETWEEN 0 AND 20);

GRANT INSERT (entrega) ON metodo_entrega TO eurolify_api;
GRANT UPDATE (entrega) ON metodo_entrega TO eurolify_api;
GRANT UPDATE (procuras_pontos) ON sessao_checkout TO eurolify_api;
