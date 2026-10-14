-- A retenção dos avisos sem pagamento (docs/26 §16; porta P2-8; Diogo,
-- 14/10/2026: «sim, aprovo o desenho com a Q1 em a)»; docs/06, ET). Ex.: a
-- 14/10/2026 chega um aviso MB WAY de 12,00 € com uma referência que não é da
-- «Loja Exemplo» e o telefone de alguém; abre-se uma diferença. O dono
-- resolve-a a 20/10/2026; na limpeza de 13/01/2027, a primeira depois de
-- passarem 90 dias desde a chegada, o corpo passa a resumo.
--
-- Um aviso sem pagamento (`pagamento_id` nulo: `sem_pagamento`, `erro` ou
-- por tratar) não pertence a nenhuma encomenda, e o apagamento do titular
-- (0072, 0102) nunca o apanha. Passados 90 dias da chegada, e sem nenhuma
-- diferença aberta que aponte para ele, o corpo passa a resumo: a forma da
-- 0102, com a chave do rasto (0054) e o motivo. A linha fica: o
-- UNIQUE (conta_id, id_evento) é a idempotência (R6) e a diferença e a
-- transição apontam para ela. Os avisos com pagamento seguem a encomenda.
--
-- A regra fica num sítio, `aviso_pagamento_resumivel`: o gatilho da 0072
-- passa a aceitar esta mudança só dentro da função da limpeza (a marca da
-- transacção numa tabela só do dono, como a da 0049), só no corpo, só no
-- que a regra deixa e só para o resumo certo. Corre na limpeza diária da VPS
-- (eurolify-limpeza, 05:00 UTC), com o papel eurolify_limpeza, que só recebe
-- o EXECUTE das duas funções; a verificação das 07:00 avisa se ficarem
-- avisos com o prazo passado há mais de um dia.
SET LOCAL lock_timeout = '10s';

-- A limpeza e a contagem só olham para os avisos sem pagamento.
CREATE INDEX aviso_pagamento_sem_pagamento ON aviso_pagamento (comerciante_id, recebido_em)
  WHERE pagamento_id IS NULL;

-- O corpo já está em resumo (o da 0102 ou o deste prazo)? Pelo conteúdo, não
-- pelo início do texto: o jsonb ordena as chaves pelo comprimento, e o texto
-- da 0102 começa por «{"resumo"». Um corpo que não é JSON não está em resumo.
CREATE FUNCTION aviso_pagamento_em_resumo(p_corpo text) RETURNS boolean
  LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  j jsonb;
BEGIN
  IF p_corpo IS NULL OR p_corpo NOT LIKE '{%' THEN
    RETURN false;
  END IF;
  BEGIN
    j := p_corpo::jsonb;
  EXCEPTION WHEN others THEN
    RETURN false;
  END;
  RETURN jsonb_typeof(j) = 'object' AND j -> 'pseudonimizado' = 'true'::jsonb
    AND jsonb_typeof(j -> 'resumo') = 'string'
    AND (j - 'pseudonimizado' - 'resumo' - 'motivo') = '{}'::jsonb;
END
$$;

-- O resumo de um corpo: o mesmo da 0102 (o mesmo campo da chave do rasto),
-- com o motivo. Ex.: {"motivo": "prazo", "resumo": "3fa1c2d4", "pseudonimizado": true}.
CREATE FUNCTION aviso_pagamento_resumo(p_comerciante uuid, p_corpo text) RETURNS text
  LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT jsonb_build_object('pseudonimizado', true, 'motivo', 'prazo',
    'resumo', public.rasto_resumo(p_comerciante, 'aviso_pagamento.corpo', to_jsonb(p_corpo)))::text
$$;

-- A regra (Q1 a): sem pagamento, chegado há mais de 90 dias (mais a folga
-- da verificação), com o corpo ainda em bruto e sem diferença aberta que
-- aponte para ele. O corpo vazio (assinatura inválida) não tem o que limpar.
CREATE FUNCTION aviso_pagamento_resumivel(p_comerciante uuid, p_id uuid, p_pagamento uuid,
  p_recebido timestamptz, p_corpo text, p_folga interval DEFAULT interval '0')
  RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT p_pagamento IS NULL
    AND p_recebido < now() - interval '90 days' - p_folga
    AND p_corpo <> ''
    AND NOT public.aviso_pagamento_em_resumo(p_corpo)
    AND NOT EXISTS (SELECT FROM public.diferenca_pagamento d
                    WHERE d.comerciante_id = p_comerciante AND d.aviso_id = p_id
                      AND d.estado = 'aberta')
$$;

-- Verdadeiro só dentro da pagamentos_avisos_resumir: uma linha com a
-- transacção, numa tabela onde só o dono escreve (a forma da 0049; um
-- parâmetro da sessão a API podia pô-lo). Sai no fim da função.
CREATE TABLE aviso_resumo_em_curso (transaccao xid8 PRIMARY KEY);
REVOKE ALL ON aviso_resumo_em_curso FROM PUBLIC;

CREATE FUNCTION pagamentos_avisos_resumo_em_curso() RETURNS boolean
  LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  -- Primeiro o dono: a API nem lê a tabela.
  IF NOT public.clientes_dono_a_escrever() THEN
    RETURN false;
  END IF;
  RETURN EXISTS (SELECT FROM public.aviso_resumo_em_curso m
                 WHERE m.transaccao = pg_catalog.pg_current_xact_id());
END
$$;

-- A da 0072, com o resumo do prazo antes do resto.
CREATE OR REPLACE FUNCTION aviso_pagamento_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  -- O prazo dos avisos sem pagamento (0105): só dentro da função da limpeza,
  -- só o corpo, só o que a regra deixa e só para o resumo dele.
  IF TG_OP = 'UPDATE' AND public.pagamentos_avisos_resumo_em_curso() THEN
    IF (to_jsonb(NEW) - 'corpo') = (to_jsonb(OLD) - 'corpo')
       AND public.aviso_pagamento_resumivel(OLD.comerciante_id, OLD.id, OLD.pagamento_id,
             OLD.recebido_em, OLD.corpo)
       AND NEW.corpo = public.aviso_pagamento_resumo(OLD.comerciante_id, OLD.corpo) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'payments.immutable: só o corpo de um aviso sem pagamento, 90 dias depois, passa a resumo';
  END IF;
  -- O apagamento do titular (0072): só as colunas com dados pessoais, só
  -- dentro da função do dono.
  IF TG_OP = 'UPDATE' AND public.titular_limpeza_permitida(to_jsonb(OLD), to_jsonb(NEW),
       ARRAY['corpo']) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payments.immutable: um aviso não se apaga';
  END IF;
  IF (to_jsonb(NEW) - 'pagamento_id' - 'resultado' - 'erro' - 'processado_em')
     IS DISTINCT FROM (to_jsonb(OLD) - 'pagamento_id' - 'resultado' - 'erro' - 'processado_em') THEN
    RAISE EXCEPTION 'payments.immutable: o aviso em bruto não muda';
  END IF;
  IF OLD.resultado IS NOT NULL AND OLD.resultado <> 'erro' THEN
    RAISE EXCEPTION 'payments.immutable: um aviso tratado não muda';
  END IF;
  RETURN NEW;
END
$$;

-- Os comerciantes com avisos: os de uma conta de pagamento (a porta dos
-- avisos, 0044; sem o RLS forçado, o dono lê-a toda).
CREATE FUNCTION pagamentos_avisos_comerciantes() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT DISTINCT a.comerciante_id FROM public.conta_pagamento_aviso a ORDER BY 1
$$;

-- A tarefa diária. Por comerciante, por causa do RLS forçado; até 50 000
-- avisos por corrida, como a 0100: o resto fica para o dia seguinte e a
-- verificação avisa se se acumular. Devolve quantos passaram a resumo.
CREATE FUNCTION pagamentos_avisos_resumir() RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  anterior text := pg_catalog.current_setting('eurolify.comerciante', true);
  c uuid;
  n integer;
  total integer := 0;
BEGIN
  INSERT INTO public.aviso_resumo_em_curso VALUES (pg_catalog.pg_current_xact_id());
  FOR c IN SELECT x FROM public.pagamentos_avisos_comerciantes() x LOOP
    EXIT WHEN total >= 50000;
    PERFORM pg_catalog.set_config('eurolify.comerciante', c::text, true);
    UPDATE public.aviso_pagamento a
    SET corpo = public.aviso_pagamento_resumo(c, a.corpo)
    WHERE a.id IN (
      SELECT x.id FROM public.aviso_pagamento x
      WHERE x.comerciante_id = c AND x.pagamento_id IS NULL
        AND public.aviso_pagamento_resumivel(c, x.id, x.pagamento_id, x.recebido_em, x.corpo)
      LIMIT 50000 - total);
    GET DIAGNOSTICS n = ROW_COUNT;
    total := total + n;
  END LOOP;
  DELETE FROM public.aviso_resumo_em_curso WHERE transaccao = pg_catalog.pg_current_xact_id();
  PERFORM pg_catalog.set_config('eurolify.comerciante', coalesce(anterior, ''), true);
  RETURN total;
END
$$;

-- A verificação diária: os avisos que a limpeza já devia ter passado a
-- resumo há mais de um dia. Só a contagem, de todos os comerciantes, sem
-- identificadores. VOLATILE: muda um parâmetro da sessão, como a 0100.
CREATE FUNCTION pagamentos_avisos_em_atraso() RETURNS bigint
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  anterior text := pg_catalog.current_setting('eurolify.comerciante', true);
  c uuid;
  n bigint := 0;
BEGIN
  FOR c IN SELECT x FROM public.pagamentos_avisos_comerciantes() x LOOP
    PERFORM pg_catalog.set_config('eurolify.comerciante', c::text, true);
    n := n + (SELECT count(*) FROM public.aviso_pagamento a
      WHERE a.comerciante_id = c AND a.pagamento_id IS NULL
        AND public.aviso_pagamento_resumivel(c, a.id, a.pagamento_id, a.recebido_em, a.corpo,
                                             interval '1 day'));
  END LOOP;
  PERFORM pg_catalog.set_config('eurolify.comerciante', coalesce(anterior, ''), true);
  RETURN n;
END
$$;

-- ------------------------------------------------------------ Permissões

REVOKE EXECUTE ON FUNCTION aviso_pagamento_em_resumo(text),
  aviso_pagamento_resumo(uuid, text),
  aviso_pagamento_resumivel(uuid, uuid, uuid, timestamptz, text, interval),
  pagamentos_avisos_comerciantes(), pagamentos_avisos_resumir(),
  pagamentos_avisos_em_atraso() FROM PUBLIC;
-- O gatilho corre com quem escreve: a API precisa da que diz se a marca está
-- posta (dá falso fora da função do dono), como a 0072 com a do titular.
GRANT EXECUTE ON FUNCTION pagamentos_avisos_resumo_em_curso() TO eurolify_api;
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'eurolify_limpeza') THEN
    GRANT EXECUTE ON FUNCTION pagamentos_avisos_resumir(),
      pagamentos_avisos_em_atraso() TO eurolify_limpeza;
  END IF;
END
$$;
