-- O rasto de auditoria comum, passo 2 (docs/28 §4; decisão DK; Diogo,
-- 10/10/2026: «aprovado»; issue #322). Ex.: uma pessoa que, no Hub, muda o
-- nome de um artigo deixa em `alteracao_catalogo` a linha de sempre e agora
-- também `canal = 'hub'`, `pedido = '<id do pedido>'` e
-- `autorizado_por = 'pessoa:per_…'`; um agente com chave e o cabeçalho
-- `Eurolify-IA` deixa `canal = 'api'` e `ia = {"modelo": …, "prova":
-- "declarado"}`, com `autorizado_por` vazio (§3.2: uma chave não autoriza).
--
-- O que esta migração faz:
-- - acrescenta às sete tabelas do rasto que já existem (§2) as colunas
--   `canal`, `pedido`, `ia` e `autorizado_por`, e o `motivo` às que não o
--   tinham. As linhas antigas ficam vazias, isto é, «desconhecido»: não se
--   inventa passado (§4, passo 2);
-- - um só gatilho, `rasto_completar()`, antes de cada linha entrar numa
--   dessas tabelas, preenche-as com `contexto_do_rasto()` (0051). As funções
--   que já escrevem o rasto não mudam: uma regra num sítio (§3.1);
-- - o gatilho sobrepõe sempre o canal, o pedido, a IA e quem autorizou (quem
--   escreve a linha não os escolhe); o motivo só entra onde a linha não o
--   trouxe, porque há domínios que o põem eles próprios. O `quem` e a
--   `origem` ficam como cada domínio os grava (a `origem` dos pagamentos tem
--   outra lista, 0044);
-- - corre como o dono (SECURITY DEFINER), para servir também as linhas
--   escritas por papéis sem acesso à `contexto_do_rasto()` (revisão do #327,
--   P3-7). Só lê as variáveis da própria transacção.
--
-- Não faz: os dados sensíveis (passo 3) nem o Hub a mostrar (passo 4).

SET LOCAL lock_timeout = '10s';

ALTER TABLE transicao_estado
  ADD COLUMN canal text, ADD COLUMN pedido text, ADD COLUMN ia jsonb,
  ADD COLUMN autorizado_por text;
ALTER TABLE alteracao_catalogo
  ADD COLUMN canal text, ADD COLUMN pedido text, ADD COLUMN ia jsonb,
  ADD COLUMN autorizado_por text, ADD COLUMN motivo text;
ALTER TABLE alteracao_cliente
  ADD COLUMN canal text, ADD COLUMN pedido text, ADD COLUMN ia jsonb,
  ADD COLUMN autorizado_por text, ADD COLUMN motivo text;
ALTER TABLE transicao_pagamento
  ADD COLUMN canal text, ADD COLUMN pedido text, ADD COLUMN ia jsonb,
  ADD COLUMN autorizado_por text;
ALTER TABLE transicao_encomenda
  ADD COLUMN canal text, ADD COLUMN pedido text, ADD COLUMN ia jsonb,
  ADD COLUMN autorizado_por text;
ALTER TABLE historico_preco
  ADD COLUMN canal text, ADD COLUMN pedido text, ADD COLUMN ia jsonb,
  ADD COLUMN autorizado_por text, ADD COLUMN motivo text;
ALTER TABLE evento_conta
  ADD COLUMN canal text, ADD COLUMN pedido text, ADD COLUMN ia jsonb,
  ADD COLUMN autorizado_por text, ADD COLUMN motivo text;

CREATE FUNCTION rasto_completar() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  contexto jsonb := public.contexto_do_rasto();
  linha jsonb := to_jsonb(NEW);
  junta jsonb := jsonb_build_object(
    'canal', contexto -> 'canal',
    'pedido', contexto -> 'pedido',
    'ia', contexto -> 'ia',
    'autorizado_por', contexto -> 'autorizado_por');
BEGIN
  IF linha ? 'motivo' AND linha ->> 'motivo' IS NULL AND contexto ? 'motivo' THEN
    junta := junta || jsonb_build_object('motivo', contexto -> 'motivo');
  END IF;
  NEW := jsonb_populate_record(NEW, junta);
  RETURN NEW;
END
$$;

REVOKE EXECUTE ON FUNCTION rasto_completar() FROM PUBLIC;

CREATE TRIGGER rasto_completar BEFORE INSERT ON transicao_estado
  FOR EACH ROW EXECUTE FUNCTION rasto_completar();
CREATE TRIGGER rasto_completar BEFORE INSERT ON alteracao_catalogo
  FOR EACH ROW EXECUTE FUNCTION rasto_completar();
CREATE TRIGGER rasto_completar BEFORE INSERT ON alteracao_cliente
  FOR EACH ROW EXECUTE FUNCTION rasto_completar();
CREATE TRIGGER rasto_completar BEFORE INSERT ON transicao_pagamento
  FOR EACH ROW EXECUTE FUNCTION rasto_completar();
CREATE TRIGGER rasto_completar BEFORE INSERT ON transicao_encomenda
  FOR EACH ROW EXECUTE FUNCTION rasto_completar();
CREATE TRIGGER rasto_completar BEFORE INSERT ON historico_preco
  FOR EACH ROW EXECUTE FUNCTION rasto_completar();
CREATE TRIGGER rasto_completar BEFORE INSERT ON evento_conta
  FOR EACH ROW EXECUTE FUNCTION rasto_completar();

-- Como os outros gatilhos do rasto (0008): também com a replicação a correr.
ALTER TABLE transicao_estado ENABLE ALWAYS TRIGGER rasto_completar;
ALTER TABLE alteracao_catalogo ENABLE ALWAYS TRIGGER rasto_completar;
ALTER TABLE alteracao_cliente ENABLE ALWAYS TRIGGER rasto_completar;
ALTER TABLE transicao_pagamento ENABLE ALWAYS TRIGGER rasto_completar;
ALTER TABLE transicao_encomenda ENABLE ALWAYS TRIGGER rasto_completar;
ALTER TABLE historico_preco ENABLE ALWAYS TRIGGER rasto_completar;
ALTER TABLE evento_conta ENABLE ALWAYS TRIGGER rasto_completar;
