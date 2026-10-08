-- Fatia «identidade»: o /hub/me diz se a pessoa tem a palavra-passe com o
-- TOTP activa, à espera do primeiro código (pendente) ou nenhuma, para o
-- ecrã da conta oferecer activar ou retirar (docs/22 §9.2; parte B3b dos
-- ecrãs). Só o estado: nem o resumo, nem o segredo TOTP, nem datas.
--
-- A mesma pessoa_eu da 0027, com o campo `palavra_passe`. Uma activa conta
-- antes de uma pendente (uma pessoa pode ter as duas: a pendente é a troca
-- por confirmar, 0024).

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
                 'papel', m.papel, 'membro', m.id)
               ORDER BY c.nome, m.comerciante_id)
        FROM public.membro m
        CROSS JOIN LATERAL public.comerciante_resumo(m.comerciante_id) c
        WHERE m.pessoa_id = p.id AND m.ate IS NULL), '[]'::jsonb))
    FROM public.pessoa p WHERE p.id = s.pessoa_id);
END
$$;
