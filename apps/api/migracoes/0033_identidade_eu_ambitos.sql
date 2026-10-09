-- Fatia «identidade»: o /hub/me diz, por comerciante, os âmbitos do papel da
-- pessoa, lidos da base (papel_ambitos, 0018), para o Hub mostrar «Editar»
-- só a quem pode, sem copiar no ecrã a tabela dos papéis (docs/22 §13.2,
-- issue #210; eurolify-design, regra 8). O servidor recusa na mesma: isto só
-- decide o que o ecrã oferece.
--
-- A mesma pessoa_eu da 0029, com o campo `ambitos` em cada comerciante.

SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION pessoa_eu(p_segredo text) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  s public.sessao;
BEGIN
  s := public.sessao_valida(p_segredo);
  RETURN (
    SELECT jsonb_build_object(
      'pessoa', p.id, 'nome', p.nome, 'email', p.email,
      'palavra_passe', (
        SELECT w.estado FROM public.palavra_passe w
        WHERE w.pessoa_id = p.id
        ORDER BY (w.estado = 'activa') DESC
        LIMIT 1),
      'comerciantes', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
                 'comerciante', m.comerciante_id, 'nome', c.nome,
                 'papel', m.papel, 'membro', m.id,
                 'ambitos', to_jsonb(public.papel_ambitos(m.papel)))
               ORDER BY c.nome, m.comerciante_id)
        FROM public.membro m
        CROSS JOIN LATERAL public.comerciante_resumo(m.comerciante_id) c
        WHERE m.pessoa_id = p.id AND m.ate IS NULL), '[]'::jsonb))
    FROM public.pessoa p WHERE p.id = s.pessoa_id);
END
$$;
