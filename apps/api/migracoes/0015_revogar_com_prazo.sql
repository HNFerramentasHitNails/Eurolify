-- Uma chave com prazo só revoga chaves que expirem no mesmo instante ou antes
-- dela (Diogo, 06/10/2026: «sim, concordo, não pode revogar»; decisão BQ;
-- revisão do #124, P2-1; docs/19 §5, T14; issue #107). Ex.: um integrador com
-- uma chave que expira a 31/10 não revoga a chave permanente do comerciante;
-- se a revogasse, a 01/11 o comerciante ficava sem gestora (desde a 0014 a
-- temporária já não pode criar uma permanente de substituição).
--
-- Substitui a função da 0012 com a mesma assinatura: o CREATE OR REPLACE
-- mantém o dono e os privilégios (EXECUTE só para o eurolify_api). Uma chave
-- sem prazo continua a revogar qualquer chave do comerciante. O comando do
-- operador (chave_revogar, 0010) fica sem esta regra: é a porta de
-- emergência. A versão anterior da API recebe este erro como 500 (não 403)
-- enquanto as duas convivem; nenhuma revogação indevida passa.

SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION chave_revogar_pela_api(p_segredo_quem text, p_id uuid)
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem public.chave_api;
  alvo public.chave_api;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('chave_api:' || public.comerciante_actual()::text, 0));
  quem := public.chave_que_pede(p_segredo_quem);
  SELECT c.* INTO alvo FROM public.chave_api c
  WHERE c.id = p_id AND c.comerciante_id = quem.comerciante_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'key.not_found: a chave não existe neste comerciante';
  END IF;
  IF alvo.revogada_em IS NOT NULL THEN
    RAISE EXCEPTION 'key.already_revoked: a chave já foi revogada';
  END IF;
  -- T14: uma chave com prazo não revoga uma sem prazo nem uma que dure mais
  -- do que ela; no mesmo instante ou antes, sim (também a si própria).
  IF quem.expira_em IS NOT NULL
     AND (alvo.expira_em IS NULL OR alvo.expira_em > quem.expira_em) THEN
    RAISE EXCEPTION 'key.revoke_beyond_creator: uma chave com prazo não revoga uma chave sem prazo nem uma que dure mais do que ela';
  END IF;
  IF 'keys:write' = ANY (alvo.ambitos) AND NOT EXISTS (
       SELECT 1 FROM public.chave_api c
       WHERE c.comerciante_id = quem.comerciante_id
         AND c.id <> alvo.id
         AND c.revogada_em IS NULL
         AND (c.expira_em IS NULL OR c.expira_em > now())
         AND 'keys:write' = ANY (c.ambitos)) THEN
    RAISE EXCEPTION 'key.last_key_writer: é a última chave que gere chaves deste comerciante; crie outra antes de a revogar';
  END IF;
  UPDATE public.chave_api c SET revogada_por = 'chave:key_' || quem.id::text
  WHERE c.id = alvo.id;
END
$$;
