-- Fatia «identidade», parte B3c: criar e revogar chaves de API a partir do
-- Hub, com a sessão de uma pessoa (docs/21 §4.3, §4.7 e §12; decisão BA;
-- P-T8; issue #140). Ex.: a dona da «Loja de Teste» entra no Hub com a
-- passkey e cria a chave do seu software de gestão; a chave fica com
-- `criada_por = pessoa:per_<id>` e, se a dona sair da equipa, é revogada
-- (0018, `pessoa_fechar_acessos`).
--
-- O que esta migração faz:
-- - `chave_criar_pela_sessao` e `chave_revogar_pela_sessao`: só um membro
--   cujo papel tenha `keys:write` (hoje, o dono; §5), com autenticação
--   recente (BA, P-T8);
-- - a ordem das trancas da §4.7: a dos membros do comerciante e depois a das
--   chaves; o membro confere-se dentro delas (revisão do #141, P2-4) — quem
--   sai da equipa ao mesmo tempo não cria uma chave que escape;
-- - as mesmas regras da criação pela API (0012, 0014): comerciante suspenso
--   ou fechado não cria (pode revogar); data de expiração no futuro; a
--   chave pública tem `storefront`; uma chave de servidor só com âmbitos que
--   o papel tem;
-- - a regra «a última chave que gere chaves não se revoga» (0012) não se
--   aplica aqui: servia porque só uma chave criava chaves; com o Hub, o dono
--   cria outra quando quiser (proposta, docs/21 §12).
--
-- O que não faz: listar continua a ser o `chave_listar()` (0010), que a rota
-- chama depois de conferir o papel; a idempotência (as rotas do Hub não a
-- usam, docs/21 §11).

SET LOCAL lock_timeout = '10s';

CREATE FUNCTION chave_criar_pela_sessao(p_segredo_sessao text, p_tipo text,
                                        p_loja_id uuid, p_nome text,
                                        p_ambitos text[], p_prefixo text,
                                        p_resumo text, p_expira_em timestamptz)
  RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem public.membro;
  permitidos text[];
  ambitos text[];
  nova uuid;
BEGIN
  PERFORM public.membros_trancar(public.comerciante_actual());
  PERFORM pg_advisory_xact_lock(
    hashtextextended('chave_api:' || public.comerciante_actual()::text, 0));
  quem := public.membro_de_quem_pede(p_segredo_sessao, true);
  permitidos := public.papel_ambitos(quem.papel);
  IF NOT ('keys:write' = ANY (permitidos)) THEN
    RAISE EXCEPTION 'member.role_escalation: o papel não gere chaves';
  END IF;
  IF (SELECT m.estado FROM public.comerciante m WHERE m.id = quem.comerciante_id)
     IN ('suspenso', 'fechado') THEN
    RAISE EXCEPTION 'key.merchant_inactive: um comerciante suspenso ou fechado não cria chaves; pode revogá-las';
  END IF;
  IF p_expira_em IS NOT NULL AND p_expira_em <= now() THEN
    RAISE EXCEPTION 'key.invalid_expiry: a data de expiração tem de ser no futuro';
  END IF;
  IF p_tipo = 'publica' THEN
    ambitos := ARRAY['storefront']::text[];
  ELSE
    SELECT array_agg(DISTINCT a ORDER BY a) INTO ambitos FROM unnest(p_ambitos) AS a;
    IF ambitos IS NULL OR NOT (ambitos <@ permitidos) THEN
      RAISE EXCEPTION 'key.scope_escalation: uma chave não recebe âmbitos que o papel não tem';
    END IF;
  END IF;
  INSERT INTO public.chave_api (comerciante_id, tipo, loja_id, nome, ambitos,
                                prefixo, resumo, criada_por, expira_em)
  VALUES (quem.comerciante_id, p_tipo, p_loja_id, p_nome, ambitos,
          p_prefixo, p_resumo, 'pessoa:per_' || quem.pessoa_id::text, p_expira_em)
  RETURNING chave_api.id INTO nova;
  RETURN nova;
END
$$;

CREATE FUNCTION chave_revogar_pela_sessao(p_segredo_sessao text, p_id uuid)
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem public.membro;
  alvo public.chave_api;
BEGIN
  PERFORM public.membros_trancar(public.comerciante_actual());
  PERFORM pg_advisory_xact_lock(
    hashtextextended('chave_api:' || public.comerciante_actual()::text, 0));
  quem := public.membro_de_quem_pede(p_segredo_sessao, true);
  IF NOT ('keys:write' = ANY (public.papel_ambitos(quem.papel))) THEN
    RAISE EXCEPTION 'member.role_escalation: o papel não gere chaves';
  END IF;
  SELECT c.* INTO alvo FROM public.chave_api c
  WHERE c.id = p_id AND c.comerciante_id = quem.comerciante_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'key.not_found: a chave não existe neste comerciante';
  END IF;
  IF alvo.revogada_em IS NOT NULL THEN
    RAISE EXCEPTION 'key.already_revoked: a chave já foi revogada';
  END IF;
  UPDATE public.chave_api c SET revogada_por = 'pessoa:per_' || quem.pessoa_id::text
  WHERE c.id = alvo.id;
END
$$;

REVOKE ALL ON FUNCTION
  chave_criar_pela_sessao(text, text, uuid, text, text[], text, text, timestamptz),
  chave_revogar_pela_sessao(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  chave_criar_pela_sessao(text, text, uuid, text, text[], text, text, timestamptz),
  chave_revogar_pela_sessao(text, uuid) TO eurolify_api;
