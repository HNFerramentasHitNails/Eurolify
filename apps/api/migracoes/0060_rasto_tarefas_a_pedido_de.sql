-- O rasto de auditoria comum, passo 4, parte 4 (docs/28 §3.7; decisão DO;
-- Diogo, 11/10/2026, Q6; issue #322): o trabalho feito mais tarde a pedido
-- de alguém. Ex.: o agente «Preços» (uma chave de um agente de IA) marca uma
-- encomenda como entregue; 14 dias depois a tarefa das conclusões fecha-a. O
-- rasto dessa conclusão diz `quem = sistema:encomendas`, e agora também
-- `a_pedido_de = {"pedido": "<o pedido do agente>", "quem": "chave:key_…"}`,
-- com a IA e o «sem autorização de uma pessoa» herdados do pedido.
--
-- O que esta migração faz:
-- - `contexto_do_rasto()` lê uma variável nova, `eurolify.a_pedido_de`
--   (`{pedido, quem}`), que a API põe ao correr uma tarefa com origem;
-- - as oito tabelas do rasto ganham a coluna `a_pedido_de`, que o gatilho
--   comum (`rasto_completar()`) preenche;
-- - as três tabelas de tarefas (`tarefa_pagamento`, `tarefa_encomenda`,
--   `tarefa_documento`) ganham a coluna `origem` (`{a_pedido_de,
--   autorizado_por, ia}`): põe-na um gatilho, ao agendar ou reagendar, a
--   partir do contexto da transacção que agenda — o código não a escolhe.
--   Quem agenda dentro de uma tarefa com origem passa a origem dela (uma
--   cadeia de tarefas não perde o pedido inicial);
-- - `tarefa_origem()`: a origem de uma tarefa do comerciante do contexto,
--   para a API a pôr ao correr a tarefa.
--
-- Não faz: preencher a origem das tarefas já agendadas (não se sabe quem as
-- pediu; ficam «sem pedido de origem registado», §3.7).

SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION contexto_do_rasto() RETURNS jsonb
  LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem text := nullif(btrim(current_setting('eurolify.quem', true)), '');
  canal text := nullif(btrim(current_setting('eurolify.canal', true)), '');
  pedido text := nullif(btrim(current_setting('eurolify.pedido', true)), '');
  origem text := nullif(btrim(current_setting('eurolify.origem', true)), '');
  -- Cortado, não recusado (revisão do #334, P1-1).
  motivo text := left(nullif(btrim(current_setting('eurolify.motivo', true)), ''), 500);
  autorizado text := nullif(btrim(current_setting('eurolify.autorizado_por', true)), '');
  ia_texto text := nullif(btrim(current_setting('eurolify.ia', true)), '');
  a_pedido_texto text := nullif(btrim(current_setting('eurolify.a_pedido_de', true)), '');
  ia jsonb;
  a_pedido jsonb;
  chave text;
BEGIN
  IF canal IS NOT NULL AND canal NOT IN
     ('hub', 'api', 'importacao', 'integracao', 'mcp', 'sistema', 'operador') THEN
    RAISE EXCEPTION 'audit.context_invalid: canal desconhecido';
  END IF;
  IF pedido IS NOT NULL AND pedido !~ '^[A-Za-z0-9._:-]{1,100}$' THEN
    RAISE EXCEPTION 'audit.context_invalid: identificador do pedido mal formado';
  END IF;
  -- Quem autoriza é sempre uma pessoa (docs/28 §3.2): nunca uma chave nem uma IA.
  IF autorizado IS NOT NULL
     AND autorizado !~ '^pessoa:per_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'audit.context_invalid: quem autoriza tem de ser uma pessoa';
  END IF;
  IF ia_texto IS NOT NULL THEN
    IF NOT pg_input_is_valid(ia_texto, 'jsonb') THEN
      RAISE EXCEPTION 'audit.context_invalid: a IA não é JSON';
    END IF;
    ia := ia_texto::jsonb;
    -- §3.3: só «comprovado» ou «declarado»; «desconhecido» é não haver IA.
    IF jsonb_typeof(ia) <> 'object'
       OR (ia ->> 'prova') IS NULL
       OR (ia ->> 'prova') NOT IN ('comprovado', 'declarado') THEN
      RAISE EXCEPTION 'audit.context_invalid: a IA precisa da prova (comprovado ou declarado)';
    END IF;
    FOR chave IN SELECT jsonb_object_keys(ia) LOOP
      IF chave NOT IN ('fornecedor', 'modelo', 'execucao', 'prova')
         OR jsonb_typeof(ia -> chave) <> 'string'
         OR length(ia ->> chave) NOT BETWEEN 1 AND 100 THEN
        RAISE EXCEPTION 'audit.context_invalid: campo da IA desconhecido ou mal formado';
      END IF;
    END LOOP;
  END IF;
  -- §3.7: o pedido de origem de uma tarefa e quem o fez; só estes dois.
  IF a_pedido_texto IS NOT NULL THEN
    IF NOT pg_input_is_valid(a_pedido_texto, 'jsonb') THEN
      RAISE EXCEPTION 'audit.context_invalid: a origem não é JSON';
    END IF;
    a_pedido := a_pedido_texto::jsonb;
    IF jsonb_typeof(a_pedido) <> 'object' OR a_pedido = '{}'::jsonb THEN
      RAISE EXCEPTION 'audit.context_invalid: a origem tem de ter o pedido ou quem pediu';
    END IF;
    FOR chave IN SELECT jsonb_object_keys(a_pedido) LOOP
      IF chave NOT IN ('pedido', 'quem')
         OR jsonb_typeof(a_pedido -> chave) <> 'string'
         OR length(a_pedido ->> chave) NOT BETWEEN 1 AND 200 THEN
        RAISE EXCEPTION 'audit.context_invalid: campo da origem desconhecido ou mal formado';
      END IF;
    END LOOP;
    IF (a_pedido ->> 'pedido') IS NOT NULL
       AND (a_pedido ->> 'pedido') !~ '^[A-Za-z0-9._:-]{1,100}$' THEN
      RAISE EXCEPTION 'audit.context_invalid: identificador do pedido de origem mal formado';
    END IF;
  END IF;
  RETURN jsonb_strip_nulls(jsonb_build_object(
    'quem', quem, 'canal', canal, 'pedido', pedido, 'origem', origem,
    'motivo', motivo, 'autorizado_por', autorizado, 'ia', ia,
    'a_pedido_de', a_pedido));
END
$$;

ALTER TABLE transicao_estado ADD COLUMN a_pedido_de jsonb;
ALTER TABLE alteracao_catalogo ADD COLUMN a_pedido_de jsonb;
ALTER TABLE alteracao_cliente ADD COLUMN a_pedido_de jsonb;
ALTER TABLE transicao_pagamento ADD COLUMN a_pedido_de jsonb;
ALTER TABLE transicao_encomenda ADD COLUMN a_pedido_de jsonb;
ALTER TABLE historico_preco ADD COLUMN a_pedido_de jsonb;
ALTER TABLE evento_conta ADD COLUMN a_pedido_de jsonb;
ALTER TABLE documento_rasto ADD COLUMN a_pedido_de jsonb;

-- O corpo é o da 0053, mais a origem.
CREATE OR REPLACE FUNCTION rasto_completar() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  contexto jsonb := public.contexto_do_rasto();
BEGIN
  NEW.canal := contexto ->> 'canal';
  NEW.pedido := contexto ->> 'pedido';
  NEW.ia := contexto -> 'ia';
  NEW.autorizado_por := contexto ->> 'autorizado_por';
  NEW.a_pedido_de := contexto -> 'a_pedido_de';
  IF NEW.motivo IS NULL THEN
    NEW.motivo := contexto ->> 'motivo';
  END IF;
  RETURN NEW;
END
$$;

-- ---------------------------------------------------- A origem das tarefas

ALTER TABLE tarefa_pagamento ADD COLUMN origem jsonb;
ALTER TABLE tarefa_encomenda ADD COLUMN origem jsonb;
ALTER TABLE tarefa_documento ADD COLUMN origem jsonb;

-- A origem de quem agenda (§3.7): dentro de uma tarefa com origem, essa
-- origem; dentro de uma tarefa sem origem, nenhuma (não se inventa); fora
-- de uma tarefa, o pedido e quem o fez, com quem autorizou e a IA. Sem
-- pedido (uma escrita fora da API, como um comando à mão), nenhuma: um
-- `quem` sozinho não é um pedido de origem.
CREATE FUNCTION rasto_origem_actual() RETURNS jsonb
  LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  contexto jsonb := public.contexto_do_rasto();
  a_pedido jsonb;
BEGIN
  IF contexto ? 'a_pedido_de' THEN
    a_pedido := contexto -> 'a_pedido_de';
  ELSIF contexto ->> 'canal' = 'sistema' THEN
    RETURN NULL;
  ELSIF contexto ? 'pedido' THEN
    a_pedido := jsonb_strip_nulls(jsonb_build_object(
      'pedido', contexto ->> 'pedido', 'quem', contexto ->> 'quem'));
  ELSE
    RETURN NULL;
  END IF;
  RETURN jsonb_strip_nulls(jsonb_build_object(
    'a_pedido_de', a_pedido,
    'autorizado_por', contexto ->> 'autorizado_por',
    'ia', contexto -> 'ia'));
END
$$;

-- Ao reagendar sem origem no contexto (uma escrita fora de um pedido, ou
-- uma tarefa sem origem), fica a que já havia: não se apaga a origem por
-- falta de contexto.
CREATE FUNCTION tarefa_guardar_origem() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  nova jsonb := public.rasto_origem_actual();
BEGIN
  IF TG_OP = 'UPDATE' AND nova IS NULL THEN
    NEW.origem := OLD.origem;
  ELSE
    NEW.origem := nova;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER tarefa_guardar_origem BEFORE INSERT OR UPDATE ON tarefa_pagamento
  FOR EACH ROW EXECUTE FUNCTION tarefa_guardar_origem();
CREATE TRIGGER tarefa_guardar_origem BEFORE INSERT OR UPDATE ON tarefa_encomenda
  FOR EACH ROW EXECUTE FUNCTION tarefa_guardar_origem();
CREATE TRIGGER tarefa_guardar_origem BEFORE INSERT OR UPDATE ON tarefa_documento
  FOR EACH ROW EXECUTE FUNCTION tarefa_guardar_origem();
-- Como o `documento_fiscal_tarefa` (0050): também numa cópia em `replica`.
ALTER TABLE tarefa_documento ENABLE ALWAYS TRIGGER tarefa_guardar_origem;

-- A origem de uma tarefa do comerciante do contexto: `pagamento` e
-- `encomenda` (tarefa_pagamento), `conclusao` (tarefa_encomenda) e
-- `documento` (tarefa_documento). Vazia se não houver.
CREATE FUNCTION tarefa_origem(p_tipo text, p_alvo uuid) RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT CASE p_tipo
    WHEN 'pagamento' THEN (SELECT t.origem FROM public.tarefa_pagamento t
      WHERE t.comerciante_id = public.comerciante_actual()
        AND t.alvo_tipo = 'pagamento' AND t.alvo_id = p_alvo)
    WHEN 'encomenda' THEN (SELECT t.origem FROM public.tarefa_pagamento t
      WHERE t.comerciante_id = public.comerciante_actual()
        AND t.alvo_tipo = 'encomenda' AND t.alvo_id = p_alvo)
    WHEN 'conclusao' THEN (SELECT t.origem FROM public.tarefa_encomenda t
      WHERE t.comerciante_id = public.comerciante_actual() AND t.encomenda_id = p_alvo)
    WHEN 'documento' THEN (SELECT t.origem FROM public.tarefa_documento t
      WHERE t.comerciante_id = public.comerciante_actual() AND t.documento_id = p_alvo)
  END
$$;

REVOKE EXECUTE ON FUNCTION rasto_origem_actual(), tarefa_guardar_origem(),
  tarefa_origem(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tarefa_origem(text, uuid) TO eurolify_api;
