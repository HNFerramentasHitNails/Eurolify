-- O rasto de auditoria comum, passo 4, parte 1: a marca «chave de um agente
-- de IA» (docs/28 §3.3 e §4; decisão DK; Diogo, 10/10/2026: «aprovado»;
-- issue #322). Ex.: o dono cria, no Hub ou pela API, uma chave para o agente
-- que actualiza os preços e marca-a como de um agente de IA. Tudo o que essa
-- chave fizer fica no rasto com a IA «declarado», mesmo que o pedido não
-- traga o cabeçalho `Eurolify-IA` (quem marca a IA é a API, ao autenticar:
-- `identidade/autenticacao.ts`).
--
-- O que esta migração faz:
-- - `chave_api.agente_ia`: falso por omissão (as chaves de antes ficam como
--   estavam: não se inventa passado); só numa chave de servidor (a pública
--   não escreve); **não muda depois de criada**, como o resto da chave;
-- - criar pela API e pelo Hub recebe a marca (um parâmetro novo, no fim, com
--   o falso por omissão: a versão anterior da API continua a chamar as
--   funções com os mesmos argumentos durante a publicação);
-- - uma chave de um agente só cria chaves de um agente: a marca passa sempre
--   à chave nova (como os âmbitos, T9), para um agente não se «lavar» criando
--   uma chave sem marca;
-- - `chave_resolver()` e `chave_listar()` devolvem a marca.
--
-- Não faz:
-- - o comando do operador (`chave_criar`, 0010): cria a primeira chave, de
--   uma pessoa; fica sem marca;
-- - a IA «comprovado»: o Eurolify não chama nenhum modelo hoje (docs/28 §3.3).

SET LOCAL lock_timeout = '10s';

ALTER TABLE chave_api
  ADD COLUMN agente_ia boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT chave_api_agente_so_no_servidor
    CHECK (NOT agente_ia OR tipo = 'servidor');

-- A marca entra na lista do que não muda (o resto é o da 0016).
CREATE OR REPLACE FUNCTION chave_api_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  estado_da_loja text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'key.immutable: uma chave não se apaga; revoga-se';
  END IF;
  IF TG_OP = 'INSERT' THEN
    -- T13: nenhuma chave para uma loja arquivada. Sem linha (loja de outro
    -- comerciante ou inexistente), a chave estrangeira recusa a seguir.
    IF NEW.loja_id IS NOT NULL THEN
      SELECT l.estado INTO estado_da_loja
      FROM public.loja l
      WHERE l.comerciante_id = NEW.comerciante_id AND l.id = NEW.loja_id
      FOR SHARE;
      IF estado_da_loja = 'arquivada' THEN
        RAISE EXCEPTION 'key.store_archived: a loja está arquivada; não se criam chaves para ela';
      END IF;
    END IF;
    NEW.criada_em := now();
    NEW.revogada_em := NULL;
    NEW.revogada_por := NULL;
    NEW.ultimo_uso_em := NULL;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.comerciante_id, NEW.tipo, NEW.loja_id, NEW.nome, NEW.ambitos,
      NEW.prefixo, NEW.resumo, NEW.criada_por, NEW.criada_em, NEW.expira_em,
      NEW.agente_ia)
     IS DISTINCT FROM
     (OLD.id, OLD.comerciante_id, OLD.tipo, OLD.loja_id, OLD.nome, OLD.ambitos,
      OLD.prefixo, OLD.resumo, OLD.criada_por, OLD.criada_em, OLD.expira_em,
      OLD.agente_ia) THEN
    RAISE EXCEPTION 'key.immutable: uma chave não se altera; cria-se outra';
  END IF;
  IF OLD.revogada_por IS NOT NULL
     AND (NEW.revogada_por, NEW.revogada_em) IS DISTINCT FROM (OLD.revogada_por, OLD.revogada_em) THEN
    RAISE EXCEPTION 'key.already_revoked: a chave já foi revogada';
  END IF;
  IF OLD.revogada_por IS NULL AND NEW.revogada_por IS NOT NULL THEN
    NEW.revogada_em := now();
  END IF;
  RETURN NEW;
END
$$;

-- Ler a chave: com a marca. Mudar o que uma função devolve pede DROP; o
-- `select *` da versão anterior da API ignora a coluna a mais.
DROP FUNCTION chave_resolver(text);
CREATE FUNCTION chave_resolver(p_resumo text)
  RETURNS TABLE (id uuid, comerciante_id uuid, loja_id uuid, tipo text,
                 ambitos text[], prefixo text, agente_ia boolean)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  UPDATE public.chave_api c SET ultimo_uso_em = now()
  WHERE c.resumo = p_resumo
    AND c.revogada_em IS NULL
    AND (c.expira_em IS NULL OR c.expira_em > now())
    AND (c.ultimo_uso_em IS NULL OR c.ultimo_uso_em < now() - interval '1 minute');
  RETURN QUERY
    SELECT c.id, c.comerciante_id, c.loja_id, c.tipo, c.ambitos, c.prefixo,
           c.agente_ia
    FROM public.chave_api c
    WHERE c.resumo = p_resumo
      AND c.revogada_em IS NULL
      AND (c.expira_em IS NULL OR c.expira_em > now());
END
$$;

DROP FUNCTION chave_listar();
CREATE FUNCTION chave_listar()
  RETURNS TABLE (id uuid, tipo text, loja_id uuid, nome text, ambitos text[],
                 prefixo text, criada_por text, criada_em timestamptz,
                 expira_em timestamptz, revogada_em timestamptz,
                 revogada_por text, ultimo_uso_em timestamptz,
                 agente_ia boolean)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT c.id, c.tipo, c.loja_id, c.nome, c.ambitos, c.prefixo, c.criada_por,
         c.criada_em, c.expira_em, c.revogada_em, c.revogada_por, c.ultimo_uso_em,
         c.agente_ia
  FROM public.chave_api c
  WHERE c.comerciante_id = public.comerciante_actual()
  ORDER BY c.criada_em, c.id
$$;

REVOKE EXECUTE ON FUNCTION chave_resolver(text), chave_listar() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION chave_resolver(text), chave_listar() TO eurolify_api;

-- Criar pela API: o corpo é o da 0014, mais a marca.
DROP FUNCTION chave_criar_pela_api(text, text, uuid, text, text[], text, text, timestamptz);
CREATE FUNCTION chave_criar_pela_api(p_segredo_quem text, p_tipo text,
                                     p_loja_id uuid, p_nome text,
                                     p_ambitos text[], p_prefixo text,
                                     p_resumo text, p_expira_em timestamptz,
                                     p_agente_ia boolean DEFAULT false)
  RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem public.chave_api;
  ambitos text[];
  agente boolean;
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
  -- do que o seu (Diogo, 06/10/2026; revisão do #118, P2-4).
  IF quem.expira_em IS NOT NULL
     AND (p_expira_em IS NULL OR p_expira_em > quem.expira_em) THEN
    RAISE EXCEPTION 'key.expiry_beyond_creator: uma chave com prazo não cria outra sem prazo nem que dure mais do que ela';
  END IF;
  -- Uma chave de um agente de IA só cria chaves de um agente (docs/28 §3.3):
  -- a marca passa à nova, como os âmbitos (T9).
  agente := coalesce(p_agente_ia, false) OR quem.agente_ia;
  IF p_tipo = 'publica' THEN
    IF agente THEN
      RAISE EXCEPTION 'key.agent_not_server: só uma chave de servidor pode ser de um agente de IA';
    END IF;
    -- A pública tem a lista fixa da Loja, só leitura (docs/19 §6.1).
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
                                prefixo, resumo, criada_por, expira_em, agente_ia)
  VALUES (quem.comerciante_id, p_tipo, p_loja_id, p_nome, ambitos,
          p_prefixo, p_resumo, 'chave:key_' || quem.id::text, p_expira_em, agente)
  RETURNING chave_api.id INTO nova;
  RETURN nova;
END
$$;

-- Criar pelo Hub: o corpo é o da 0025, mais a marca. Uma pessoa escolhe.
DROP FUNCTION chave_criar_pela_sessao(text, text, uuid, text, text[], text, text, timestamptz);
CREATE FUNCTION chave_criar_pela_sessao(p_segredo_sessao text, p_tipo text,
                                        p_loja_id uuid, p_nome text,
                                        p_ambitos text[], p_prefixo text,
                                        p_resumo text, p_expira_em timestamptz,
                                        p_agente_ia boolean DEFAULT false)
  RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem public.membro;
  permitidos text[];
  ambitos text[];
  agente boolean := coalesce(p_agente_ia, false);
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
    IF agente THEN
      RAISE EXCEPTION 'key.agent_not_server: só uma chave de servidor pode ser de um agente de IA';
    END IF;
    ambitos := ARRAY['storefront']::text[];
  ELSE
    SELECT array_agg(DISTINCT a ORDER BY a) INTO ambitos FROM unnest(p_ambitos) AS a;
    IF ambitos IS NULL OR NOT (ambitos <@ permitidos) THEN
      RAISE EXCEPTION 'key.scope_escalation: uma chave não recebe âmbitos que o papel não tem';
    END IF;
  END IF;
  INSERT INTO public.chave_api (comerciante_id, tipo, loja_id, nome, ambitos,
                                prefixo, resumo, criada_por, expira_em, agente_ia)
  VALUES (quem.comerciante_id, p_tipo, p_loja_id, p_nome, ambitos,
          p_prefixo, p_resumo, 'pessoa:per_' || quem.pessoa_id::text, p_expira_em,
          agente)
  RETURNING chave_api.id INTO nova;
  RETURN nova;
END
$$;

REVOKE ALL ON FUNCTION
  chave_criar_pela_api(text, text, uuid, text, text[], text, text, timestamptz, boolean),
  chave_criar_pela_sessao(text, text, uuid, text, text[], text, text, timestamptz, boolean)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  chave_criar_pela_api(text, text, uuid, text, text[], text, text, timestamptz, boolean),
  chave_criar_pela_sessao(text, text, uuid, text, text[], text, text, timestamptz, boolean)
  TO eurolify_api;
