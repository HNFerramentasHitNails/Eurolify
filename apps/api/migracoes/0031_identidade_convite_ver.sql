-- Fatia «identidade»: o que um convite diz, para o ecrã do convite o mostrar
-- antes de aceitar (issue #194; docs/21, lista da API; docs/22 §10). Quem
-- tem a ligação já pode aceitar o convite e já recebe o e-mail dele nas
-- opções de registo (/hub/invitations/accept/options): isto não abre nada de
-- novo, só o nome do comerciante, o papel e quando expira.
--
-- Só lê: sem FOR UPDATE (quem aceita tranca com a convite_em_aberto) e sem
-- registo no evento_conta. A mesma recusa da convite_em_aberto para «não
-- existe», «já usado», «cancelado» e «expirado», e também para o
-- comerciante suspenso ou fechado (a API já o traduz assim nas rotas de
-- aceitar): quem tem uma ligação velha não aprende nada.

SET LOCAL lock_timeout = '10s';

CREATE FUNCTION convite_ver(p_segredo_convite text)
  RETURNS TABLE (comerciante_nome text, papel text, email text, expira_em timestamptz)
  -- VOLATILE (o valor por omissão): a comerciante_resumo muda um parâmetro
  -- da sessão.
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  c public.convite;
  r record;
BEGIN
  SELECT x.* INTO c FROM public.convite x
  WHERE x.resumo = public.resumo_do_segredo(p_segredo_convite);
  IF NOT FOUND OR c.aceite_em IS NOT NULL OR c.cancelado_em IS NOT NULL
     OR c.expira_em <= now() THEN
    RAISE EXCEPTION 'invite.invalid: o convite não existe, já foi usado, foi cancelado ou expirou';
  END IF;
  SELECT x.nome, x.estado INTO r FROM public.comerciante_resumo(c.comerciante_id) x;
  IF NOT FOUND OR r.estado IN ('suspenso', 'fechado') THEN
    RAISE EXCEPTION 'invite.invalid: o convite não existe, já foi usado, foi cancelado ou expirou';
  END IF;
  RETURN QUERY SELECT r.nome::text, c.papel, c.email, c.expira_em;
END
$$;

REVOKE ALL ON FUNCTION convite_ver(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION convite_ver(text) TO eurolify_api;
