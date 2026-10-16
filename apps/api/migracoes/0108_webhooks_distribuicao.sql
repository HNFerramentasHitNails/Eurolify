-- Webhooks de saída: a distribuição dos eventos e a leitura do evento no
-- envio (docs/38 §5 e §6; issue #473).
--
-- A API não tem privilégios na outbox (0021: um evento forjado seria aceite
-- como verdadeiro). O publicador usa, por isso, duas funções do dono, ambas
-- presas ao comerciante da transacção (`comerciante_actual()`; o RLS forçado
-- da outbox faz o resto):
-- - `webhook_distribuir(n)`: toma até `n` eventos por publicar (`publicado_em
--   IS NULL`, por `FOR UPDATE SKIP LOCKED`, nunca por cursor: 0021), cria uma
--   entrega por cada subscrição **activa**, que já existia quando o evento
--   foi escrito e que pediu esse tipo, e marca o evento como publicado
--   («distribuído»). Um evento anterior a todas as subscrições fica
--   publicado sem entregas (docs/38 §5);
-- - `webhook_evento_da_entrega(id)`: o evento de uma entrega **deste**
--   comerciante, para montar o corpo. O corpo só leva os campos permitidos
--   (lista no código; `quem` nunca sai: docs/06, CH).
SET LOCAL lock_timeout = '10s';

CREATE FUNCTION webhook_distribuir(p_limite integer) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  e record;
  n integer := 0;
BEGIN
  IF p_limite IS NULL OR p_limite < 1 OR p_limite > 500 THEN
    RAISE EXCEPTION 'webhooks.invalid: o limite é de 1 a 500';
  END IF;
  IF public.comerciante_actual() IS NULL THEN
    RAISE EXCEPTION 'webhooks.invalid: sem comerciante';
  END IF;
  FOR e IN
    SELECT x.id, x.tipo, x.criado_em FROM public.evento_saida x
    WHERE x.comerciante_id = public.comerciante_actual() AND x.publicado_em IS NULL
    ORDER BY x.criado_em, x.id
    LIMIT p_limite
    FOR UPDATE SKIP LOCKED
  LOOP
    INSERT INTO public.webhook_entrega (comerciante_id, subscricao_id, evento_id, proxima_em, prazo_ate)
    SELECT s.comerciante_id, s.id, e.id, date_trunc('milliseconds', clock_timestamp()),
           date_trunc('milliseconds', clock_timestamp()) + interval '72 hours'
    FROM public.webhook_subscricao s
    WHERE s.comerciante_id = public.comerciante_actual()
      AND s.estado = 'activa' AND e.tipo = ANY (s.eventos) AND s.criada_em <= e.criado_em
    ON CONFLICT (subscricao_id, evento_id) DO NOTHING;
    UPDATE public.evento_saida SET publicado_em = clock_timestamp(), tentativas = tentativas + 1
    WHERE id = e.id;
    n := n + 1;
  END LOOP;
  RETURN n;
END
$$;

CREATE FUNCTION webhook_evento_da_entrega(p_entrega uuid)
  RETURNS TABLE (id uuid, tipo text, versao_esquema integer, agregado_tipo text,
                 agregado_id uuid, dados jsonb, criado_em timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT x.id, x.tipo, x.versao_esquema, x.agregado_tipo, x.agregado_id, x.dados, x.criado_em
  FROM public.webhook_entrega d
  JOIN public.evento_saida x ON x.id = d.evento_id AND x.comerciante_id = d.comerciante_id
  WHERE d.id = p_entrega AND d.comerciante_id = public.comerciante_actual()
$$;

REVOKE EXECUTE ON FUNCTION webhook_distribuir(integer), webhook_evento_da_entrega(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION webhook_distribuir(integer), webhook_evento_da_entrega(uuid) TO eurolify_api;
