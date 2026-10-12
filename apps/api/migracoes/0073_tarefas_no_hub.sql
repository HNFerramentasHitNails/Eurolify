-- O ecrã «A decidir» no Hub (docs/22 §28; issue #366, parte 2; Diogo,
-- 12/10/2026: «A, aprovado»).
--
-- O que esta migração faz:
-- - `tarefas_podem_ser_responsaveis(fila)`: as pessoas do comerciante do
--   contexto que podem ser responsáveis de um caso da fila (R3), pela régua
--   única da base (`tarefas_pode_decidir`, 0066). O Hub mostra-as em
--   «Atribuir…» sem guardar uma cópia da régua (docs/22 §28.2;
--   eurolify-design, regra 8). Só identificadores, só deste comerciante.

SET LOCAL lock_timeout = '10s';

-- O membro e a pessoa têm RLS sem política para a API: lê-os o dono, só no
-- comerciante do contexto.
CREATE FUNCTION tarefas_podem_ser_responsaveis(p_fila text) RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT m.pessoa_id FROM public.membro m
  WHERE m.comerciante_id = public.comerciante_actual() AND m.ate IS NULL
    AND public.tarefas_pode_decidir(m.pessoa_id, p_fila)
  ORDER BY m.pessoa_id
$$;

REVOKE EXECUTE ON FUNCTION tarefas_podem_ser_responsaveis(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tarefas_podem_ser_responsaveis(text) TO eurolify_api;
