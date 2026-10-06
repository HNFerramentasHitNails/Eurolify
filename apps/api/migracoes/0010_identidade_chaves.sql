-- Fatia «identidade», parte A: chaves de API (docs/19 §3–§5; issue #107;
-- Diogo, 06/10/2026: «sim, começa pela parte A»). Ex.: o software de gestão
-- de um comerciante chama a API com `eul_sk_…` e só vê os dados desse
-- comerciante, com os âmbitos que a chave tem.
--
-- O que esta migração faz:
-- - a tabela `chave_api`: o segredo nunca se guarda, só o resumo (sha256);
--   uma chave nunca se apaga; revogar é uma vez e não tem volta;
-- - quatro funções SECURITY DEFINER, as únicas portas da API para a tabela:
--   resolver um segredo (atravessa comerciantes, porque ainda não se sabe de
--   quem é a chave), listar, criar e revogar (estas três sempre no comerciante
--   do contexto, `comerciante_actual()`);
-- - a loja ganha UNIQUE (comerciante_id, id), para a chave pública apontar
--   para uma loja do mesmo comerciante.
--
-- Porque o RLS não é forçado nesta tabela: a procura da chave tem de ver as
-- chaves de todos, antes de haver contexto, e as políticas por comerciante dão
-- erro sem ele (0001). O isolamento faz-se pelas funções: a API não tem nenhum
-- privilégio na tabela, só EXECUTE nas quatro funções (teste T7). O RLS fica
-- ligado sem FORCE, como segunda barreira: as funções (do dono) passam; se
-- alguém um dia der um privilégio à API, ela só vê o próprio comerciante.
--
-- O que não faz (e onde fica): as pessoas e o início de sessão (parte B,
-- P1); o comando do operador que cria a primeira chave (pedido seguinte).

SET LOCAL lock_timeout = '10s';

ALTER TABLE loja ADD CONSTRAINT loja_comerciante_e_id UNIQUE (comerciante_id, id);

CREATE TABLE chave_api (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  tipo text NOT NULL CHECK (tipo IN ('servidor', 'publica')),
  loja_id uuid,
  nome text NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 100),
  ambitos text[] NOT NULL,
  -- O início visível da chave, para a reconhecer sem a guardar.
  prefixo text NOT NULL CHECK (prefixo ~ '^eul_(sk|pk)_[a-z2-7]{5}$'),
  resumo text NOT NULL CHECK (resumo ~ '^[0-9a-f]{64}$'),
  criada_por text NOT NULL CHECK (length(btrim(criada_por)) BETWEEN 1 AND 200),
  criada_em timestamptz NOT NULL DEFAULT now(),
  expira_em timestamptz,
  revogada_em timestamptz,
  revogada_por text CHECK (revogada_por IS NULL OR length(btrim(revogada_por)) BETWEEN 1 AND 200),
  ultimo_uso_em timestamptz,
  CONSTRAINT chave_api_resumo_unico UNIQUE (resumo),
  CONSTRAINT chave_api_loja_do_comerciante
    FOREIGN KEY (comerciante_id, loja_id) REFERENCES loja (comerciante_id, id),
  -- A pública é de uma loja; a de servidor, de nenhuma.
  CONSTRAINT chave_api_loja_so_na_publica CHECK ((tipo = 'publica') = (loja_id IS NOT NULL)),
  CONSTRAINT chave_api_prefixo_do_tipo CHECK (
    (tipo = 'servidor' AND prefixo LIKE 'eul\_sk\_%')
    OR (tipo = 'publica' AND prefixo LIKE 'eul\_pk\_%')),
  CONSTRAINT chave_api_ambitos_validos CHECK (
    cardinality(ambitos) BETWEEN 1 AND 20
    AND ambitos <@ ARRAY[
      'merchant:read', 'merchant:write',
      'catalog:read', 'catalog:write', 'catalog:publish', 'catalog:import',
      'keys:write', 'storefront'
    ]::text[]),
  -- A pública tem a lista fixa da Loja e nada de Administração (T6).
  CONSTRAINT chave_api_ambitos_do_tipo CHECK (
    (tipo = 'publica' AND ambitos = ARRAY['storefront']::text[])
    OR (tipo = 'servidor' AND NOT ('storefront' = ANY (ambitos)))),
  CONSTRAINT chave_api_revogacao_inteira CHECK ((revogada_em IS NULL) = (revogada_por IS NULL)),
  CONSTRAINT chave_api_expira_depois CHECK (expira_em IS NULL OR expira_em > criada_em)
);

CREATE INDEX chave_api_por_comerciante ON chave_api (comerciante_id, criada_em);

ALTER TABLE chave_api ENABLE ROW LEVEL SECURITY;
CREATE POLICY so_o_proprio ON chave_api
  USING (comerciante_id = comerciante_actual())
  WITH CHECK (comerciante_id = comerciante_actual());

-- Uma chave não se apaga nem se reescreve: só se revoga (uma vez) e se marca
-- o último uso. A data da revogação é da base.
CREATE FUNCTION chave_api_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'key.immutable: uma chave não se apaga; revoga-se';
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.criada_em := now();
    NEW.revogada_em := NULL;
    NEW.revogada_por := NULL;
    NEW.ultimo_uso_em := NULL;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.comerciante_id, NEW.tipo, NEW.loja_id, NEW.nome, NEW.ambitos,
      NEW.prefixo, NEW.resumo, NEW.criada_por, NEW.criada_em, NEW.expira_em)
     IS DISTINCT FROM
     (OLD.id, OLD.comerciante_id, OLD.tipo, OLD.loja_id, OLD.nome, OLD.ambitos,
      OLD.prefixo, OLD.resumo, OLD.criada_por, OLD.criada_em, OLD.expira_em) THEN
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

CREATE TRIGGER chave_api_antes_de_gravar
  BEFORE INSERT OR UPDATE OR DELETE ON chave_api
  FOR EACH ROW EXECUTE FUNCTION chave_api_antes_de_gravar();
CREATE TRIGGER chave_api_sem_truncate
  BEFORE TRUNCATE ON chave_api
  FOR EACH STATEMENT EXECUTE FUNCTION rasto_so_se_acrescenta();
ALTER TABLE chave_api ENABLE ALWAYS TRIGGER chave_api_antes_de_gravar;
ALTER TABLE chave_api ENABLE ALWAYS TRIGGER chave_api_sem_truncate;

-- As quatro portas da API. Todas com o search_path fixo e os nomes com o
-- esquema, como a 0001 (uma tabela temporária com o mesmo nome não desvia
-- nada).

-- Resolver: de um resumo para o contexto. Só uma chave válida (não revogada,
-- não expirada). Marca o último uso no máximo uma vez por minuto.
CREATE FUNCTION chave_resolver(p_resumo text)
  RETURNS TABLE (id uuid, comerciante_id uuid, loja_id uuid, tipo text,
                 ambitos text[], prefixo text)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  UPDATE public.chave_api c SET ultimo_uso_em = now()
  WHERE c.resumo = p_resumo
    AND c.revogada_em IS NULL
    AND (c.expira_em IS NULL OR c.expira_em > now())
    AND (c.ultimo_uso_em IS NULL OR c.ultimo_uso_em < now() - interval '1 minute');
  RETURN QUERY
    SELECT c.id, c.comerciante_id, c.loja_id, c.tipo, c.ambitos, c.prefixo
    FROM public.chave_api c
    WHERE c.resumo = p_resumo
      AND c.revogada_em IS NULL
      AND (c.expira_em IS NULL OR c.expira_em > now());
END
$$;

-- Listar as chaves do comerciante do contexto, sem o resumo.
CREATE FUNCTION chave_listar()
  RETURNS TABLE (id uuid, tipo text, loja_id uuid, nome text, ambitos text[],
                 prefixo text, criada_por text, criada_em timestamptz,
                 expira_em timestamptz, revogada_em timestamptz,
                 revogada_por text, ultimo_uso_em timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT c.id, c.tipo, c.loja_id, c.nome, c.ambitos, c.prefixo, c.criada_por,
         c.criada_em, c.expira_em, c.revogada_em, c.revogada_por, c.ultimo_uso_em
  FROM public.chave_api c
  WHERE c.comerciante_id = public.comerciante_actual()
  ORDER BY c.criada_em, c.id
$$;

-- Criar uma chave no comerciante do contexto. O segredo nunca chega à base:
-- vem só o resumo e o prefixo.
CREATE FUNCTION chave_criar(p_tipo text, p_loja_id uuid, p_nome text,
                            p_ambitos text[], p_prefixo text, p_resumo text,
                            p_criada_por text, p_expira_em timestamptz)
  RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  nova uuid;
BEGIN
  INSERT INTO public.chave_api (comerciante_id, tipo, loja_id, nome, ambitos,
                                prefixo, resumo, criada_por, expira_em)
  VALUES (public.comerciante_actual(), p_tipo, p_loja_id, p_nome, p_ambitos,
          p_prefixo, p_resumo, p_criada_por, p_expira_em)
  RETURNING chave_api.id INTO nova;
  RETURN nova;
END
$$;

-- Revogar uma chave do comerciante do contexto. Devolve falso se não existe
-- nesse comerciante (ou já estava revogada).
CREATE FUNCTION chave_revogar(p_id uuid, p_revogada_por text)
  RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  UPDATE public.chave_api c SET revogada_por = p_revogada_por
  WHERE c.id = p_id
    AND c.comerciante_id = public.comerciante_actual()
    AND c.revogada_em IS NULL;
  RETURN FOUND;
END
$$;

-- A API não tem nada na tabela; só as quatro portas (a 0008 já fecha as
-- funções a PUBLIC por omissão).
REVOKE ALL ON chave_api FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION chave_resolver(text), chave_listar(),
  chave_criar(text, uuid, text, text[], text, text, text, timestamptz),
  chave_revogar(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION chave_resolver(text), chave_listar(),
  chave_criar(text, uuid, text, text[], text, text, text, timestamptz),
  chave_revogar(uuid, text) TO eurolify_api;
