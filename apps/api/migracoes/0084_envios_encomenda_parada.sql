-- Envios: a encomenda parada perto da data-limite (docs/36 §18; Q4 da
-- decisão ED; issue #393; Diogo, 13/10/2026: «sim, aprovo; avança com o
-- código»). Uma encomenda paga com unidades por expedir a 5 dias ou menos da
-- data-limite que o cliente viu no checkout (L1, L4) abre um problema da
-- pós-venda, uma vez só, para uma pessoa decidir (fila «problema» da peça
-- 21, sem fila nova). A data é a copiada na encomenda, nunca a do método de
-- hoje; o dia conta-se no fuso da loja, como no checkout.
SET LOCAL lock_timeout = '10s';

-- Os dias de aviso antes da data-limite: proposta da Q4 (não é lei), num
-- sítio só, como o `posvenda_dias_de_aviso()` (0063).
CREATE FUNCTION envios_dias_de_aviso_parada() RETURNS integer
  LANGUAGE sql IMMUTABLE AS $$ SELECT 5 $$;

-- A data-limite copiada na encomenda (`metodo_entrega.data_limite`, 0074),
-- ou NULL quando falta ou não é uma data: uma encomenda antiga não pára a
-- volta dos outros.
CREATE FUNCTION envios_data_limite(p_metodo jsonb) RETURNS date
  LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  t text := p_metodo ->> 'data_limite';
BEGIN
  IF t IS NULL OR t !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RETURN NULL;
  END IF;
  RETURN t::date;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
  RETURN NULL;
END
$$;

-- Uma linha por encomenda já avisada: a chave primária é o «uma vez só»; a
-- linha e o problema gravam-se na mesma transacção. Sem dados pessoais (os
-- identificadores, a data e o número de unidades quando abriu).
CREATE TABLE encomenda_parada (
  encomenda_id uuid PRIMARY KEY,
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  data_limite date NOT NULL,
  por_expedir integer NOT NULL CHECK (por_expedir > 0),
  problema_id uuid NOT NULL,
  avisada_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (comerciante_id, encomenda_id) REFERENCES encomenda (comerciante_id, id),
  FOREIGN KEY (comerciante_id, problema_id) REFERENCES problema (comerciante_id, id)
);
CREATE TRIGGER encomenda_parada_so_se_acrescenta
  BEFORE UPDATE OR DELETE ON encomenda_parada
  FOR EACH ROW EXECUTE FUNCTION rasto_so_se_acrescenta();
ALTER TABLE encomenda_parada ENABLE ALWAYS TRIGGER encomenda_parada_so_se_acrescenta;
CREATE TRIGGER encomenda_parada_sem_truncate BEFORE TRUNCATE ON encomenda_parada
  FOR EACH STATEMENT EXECUTE FUNCTION rasto_so_se_acrescenta();
ALTER TABLE encomenda_parada ENABLE ROW LEVEL SECURITY;
ALTER TABLE encomenda_parada FORCE ROW LEVEL SECURITY;
CREATE POLICY so_o_proprio ON encomenda_parada
  USING (comerciante_id = comerciante_actual())
  WITH CHECK (comerciante_id = comerciante_actual());
REVOKE ALL ON encomenda_parada FROM PUBLIC;
GRANT SELECT ON encomenda_parada TO eurolify_api;
GRANT INSERT (encomenda_id, comerciante_id, data_limite, por_expedir, problema_id)
  ON encomenda_parada TO eurolify_api;

-- As candidatas, por comerciante (interna, RLS sem forçar, como a
-- `tarefa_encomenda` da 0047): a volta de todos os comerciantes não pode ler
-- a encomenda, que tem o RLS forçado também para o dono das funções. Uma
-- linha por encomenda por expedir com data-limite e ainda sem aviso; posta e
-- tirada pelos gatilhos. Quem decide se está parada é `envios_paradas_de`,
-- já dentro do comerciante.
CREATE TABLE tarefa_parada (
  encomenda_id uuid PRIMARY KEY,
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  data_limite date NOT NULL
);
CREATE INDEX tarefa_parada_data ON tarefa_parada (data_limite);
ALTER TABLE tarefa_parada ENABLE ROW LEVEL SECURITY;
CREATE POLICY so_o_proprio ON tarefa_parada
  USING (comerciante_id = comerciante_actual())
  WITH CHECK (comerciante_id = comerciante_actual());
REVOKE ALL ON tarefa_parada FROM PUBLIC;

CREATE FUNCTION encomenda_tarefa_parada() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  limite date := public.envios_data_limite(NEW.metodo_entrega);
BEGIN
  IF NEW.estado IN ('paga', 'em_preparacao', 'expedida_parcial') AND limite IS NOT NULL
     AND NOT EXISTS (SELECT FROM public.encomenda_parada p WHERE p.encomenda_id = NEW.id) THEN
    INSERT INTO public.tarefa_parada (encomenda_id, comerciante_id, data_limite)
    VALUES (NEW.id, NEW.comerciante_id, limite)
    ON CONFLICT (encomenda_id) DO NOTHING;
  ELSE
    DELETE FROM public.tarefa_parada WHERE encomenda_id = NEW.id;
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER encomenda_tarefa_parada AFTER INSERT OR UPDATE OF estado ON encomenda
  FOR EACH ROW EXECUTE FUNCTION encomenda_tarefa_parada();

-- Avisada: deixa de ser candidata.
CREATE FUNCTION encomenda_parada_avisada() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  DELETE FROM public.tarefa_parada WHERE encomenda_id = NEW.encomenda_id;
  RETURN NULL;
END
$$;
CREATE TRIGGER encomenda_parada_avisada AFTER INSERT ON encomenda_parada
  FOR EACH ROW EXECUTE FUNCTION encomenda_parada_avisada();

-- As encomendas que já existem (o dono das tabelas não passa o RLS forçado:
-- desliga-se o «forçado» só durante a cópia, como na 0074).
ALTER TABLE encomenda NO FORCE ROW LEVEL SECURITY;
INSERT INTO tarefa_parada (encomenda_id, comerciante_id, data_limite)
SELECT e.id, e.comerciante_id, envios_data_limite(e.metodo_entrega)
FROM encomenda e
WHERE e.estado IN ('paga', 'em_preparacao', 'expedida_parcial')
  AND envios_data_limite(e.metodo_entrega) IS NOT NULL;
ALTER TABLE encomenda FORCE ROW LEVEL SECURITY;

-- As paradas por avisar do comerciante da transacção: por expedir (paga, em
-- preparação ou expedida em parte), com data-limite, a 5 dias ou menos dela
-- no fuso da loja (também as que já passaram), sem aviso, e com unidades que
-- ainda não saíram. Saiu o que está numa expedição expedida, entregue,
-- devolvida ou perdida, como em `acertarEstadoDaEncomenda`
-- (src/stock/repositorio.ts); uma expedição só criada ainda está no
-- armazém. Lê com os direitos do dono, mas dentro do comerciante: o RLS
-- forçado das tabelas filtra-o, e a função filtra também.
CREATE FUNCTION envios_paradas(p_agora timestamptz, p_limite integer)
  RETURNS TABLE (encomenda_id uuid, data_limite date, por_expedir integer)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT e.id, envios_data_limite(e.metodo_entrega), q.por_expedir
  FROM public.tarefa_parada t
  JOIN public.encomenda e ON e.id = t.encomenda_id
  JOIN public.comerciante c ON c.id = e.comerciante_id
  CROSS JOIN LATERAL (
    SELECT ((
      SELECT coalesce(sum(l.quantidade), 0) FROM public.linha_encomenda l
      WHERE l.comerciante_id = e.comerciante_id AND l.encomenda_id = e.id
    ) - (
      SELECT coalesce(sum(le.quantidade), 0)
      FROM public.linha_expedicao le
      JOIN public.expedicao x ON x.id = le.expedicao_id
      WHERE x.comerciante_id = e.comerciante_id AND x.encomenda_id = e.id
        AND x.estado NOT IN ('criada', 'cancelada')
    ))::integer AS por_expedir
  ) q
  WHERE t.comerciante_id = public.comerciante_actual()
    AND e.comerciante_id = public.comerciante_actual()
    AND e.estado IN ('paga', 'em_preparacao', 'expedida_parcial')
    AND envios_data_limite(e.metodo_entrega) - envios_dias_de_aviso_parada()
      <= (p_agora AT TIME ZONE c.fuso)::date
    AND NOT EXISTS (SELECT FROM public.encomenda_parada p WHERE p.encomenda_id = e.id)
    AND q.por_expedir > 0
  ORDER BY 2, 1
  LIMIT greatest(p_limite, 0)
$$;

-- Os comerciantes com alguma candidata no prazo. O dia de cada loja só se
-- sabe dentro dela: aqui conta-se o fuso mais adiantado (UTC+14), e a função
-- de cima decide.
CREATE FUNCTION envios_comerciantes_com_paradas(p_agora timestamptz) RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT DISTINCT t.comerciante_id FROM public.tarefa_parada t
  WHERE t.data_limite - public.envios_dias_de_aviso_parada()
    <= ((p_agora + interval '14 hours') AT TIME ZONE 'UTC')::date
$$;

REVOKE ALL ON FUNCTION envios_dias_de_aviso_parada(), envios_data_limite(jsonb),
  encomenda_tarefa_parada(), encomenda_parada_avisada(),
  envios_comerciantes_com_paradas(timestamptz),
  envios_paradas(timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION envios_comerciantes_com_paradas(timestamptz),
  envios_paradas(timestamptz, integer) TO eurolify_api;
