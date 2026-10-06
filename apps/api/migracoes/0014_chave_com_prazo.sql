-- Uma chave com prazo não cria outra sem prazo nem que dure mais do que ela
-- (Diogo, 06/10/2026: «avança com a chave com prazo: não cria outra sem
-- prazo»; revisão do #118, P2-4; docs/19 §6.1; issue #107). Ex.: o comerciante
-- dá a um integrador uma chave com `keys:write` que expira amanhã; com ela, o
-- integrador já não cria uma chave sem expiração nem uma que expire depois de
-- amanhã.
--
-- Substitui a função da 0012 com a mesma assinatura: o CREATE OR REPLACE
-- mantém o dono e os privilégios (EXECUTE só para o eurolify_api). Uma chave
-- sem prazo continua a criar chaves com ou sem prazo. A versão anterior da API
-- funciona com esta (o erro novo chega-lhe como 500, não como 422, até ela ser
-- trocada; a publicação troca as duas ao mesmo tempo).

SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION chave_criar_pela_api(p_segredo_quem text, p_tipo text,
                                     p_loja_id uuid, p_nome text,
                                     p_ambitos text[], p_prefixo text,
                                     p_resumo text, p_expira_em timestamptz)
  RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem public.chave_api;
  ambitos text[];
  nova uuid;
BEGIN
  -- A mesma tranca da revogação: não se cria em nome de uma chave que está a
  -- ser revogada nesse instante.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('chave_api:' || public.comerciante_actual()::text, 0));
  quem := public.chave_que_pede(p_segredo_quem);
  -- Um comerciante suspenso ou fechado não cria chaves; revogar continua,
  -- para poder fechar acessos (Diogo, 06/10/2026, revisão do #118, P2-3).
  IF (SELECT m.estado FROM public.comerciante m WHERE m.id = quem.comerciante_id)
     IN ('suspenso', 'fechado') THEN
    RAISE EXCEPTION 'key.merchant_inactive: um comerciante suspenso ou fechado não cria chaves; pode revogá-las';
  END IF;
  IF p_expira_em IS NOT NULL AND p_expira_em <= now() THEN
    RAISE EXCEPTION 'key.invalid_expiry: a data de expiração tem de ser no futuro';
  END IF;
  -- Uma chave com prazo não cria outra sem prazo, nem com um prazo mais longo
  -- do que o seu (Diogo, 06/10/2026: «a chave com prazo: não cria outra sem
  -- prazo»; revisão do #118, P2-4). Ex.: um integrador com uma chave até
  -- amanhã não cria uma permanente.
  IF quem.expira_em IS NOT NULL
     AND (p_expira_em IS NULL OR p_expira_em > quem.expira_em) THEN
    RAISE EXCEPTION 'key.expiry_beyond_creator: uma chave com prazo não cria outra sem prazo nem que dure mais do que ela';
  END IF;
  IF p_tipo = 'publica' THEN
    -- A pública tem a lista fixa da Loja, só leitura (docs/19 §6.1): não
    -- se escolhe, e qualquer chave com keys:write a pode criar.
    ambitos := ARRAY['storefront']::text[];
  ELSE
    -- Sem repetidos e por ordem, para a lista guardada ser sempre a mesma.
    SELECT array_agg(DISTINCT a ORDER BY a) INTO ambitos FROM unnest(p_ambitos) AS a;
    -- T9: nada que quem pede não tenha.
    IF ambitos IS NULL OR NOT (ambitos <@ quem.ambitos) THEN
      RAISE EXCEPTION 'key.scope_escalation: uma chave não cria outra com âmbitos que não tem';
    END IF;
  END IF;
  INSERT INTO public.chave_api (comerciante_id, tipo, loja_id, nome, ambitos,
                                prefixo, resumo, criada_por, expira_em)
  VALUES (quem.comerciante_id, p_tipo, p_loja_id, p_nome, ambitos,
          p_prefixo, p_resumo, 'chave:key_' || quem.id::text, p_expira_em)
  RETURNING chave_api.id INTO nova;
  RETURN nova;
END
$$;
