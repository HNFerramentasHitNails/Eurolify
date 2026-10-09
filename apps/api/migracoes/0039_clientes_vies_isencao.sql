-- Clientes, parte 3: o VIES com prova e a isenção manual (docs/23 §13; issue
-- #233; Diogo, 09/10/2026: «sim, aprovo; avança com o código da parte 3», com
-- as respostas Q6 e Q7 propostas). Ex.: o perfil «Ana SARL» com o NIF
-- FR40303265045 fica `por_validar`; a fila consulta o VIES, guarda a prova
-- (data, NIF consultado, requerente, resposta, número de consulta) e o perfil
-- passa a `valido` com a data; à noite volta a confirmar. Uma isenção manual
-- («transportadora própria, declaração aduaneira entregue») só a põe e a
-- retira uma pessoa com `customers:exemptions` (o dono).
--
-- O que esta migração faz:
-- - `validacao_vies`, a prova de cada consulta, que só se acrescenta (§13.3);
-- - `vies_fila` (interna, como a `ficheiro_sem_uso` da 0035): que perfis
--   consultar e quando; preenchida pelos gatilhos do perfil e pela
--   `vies_registar`;
-- - `vies_registar`: grava a prova e muda o `estado_vies` só se o NIF do
--   perfil ainda for o consultado; um `indisponivel` não apaga a última
--   resposta (Q6); os eventos `billing_profile.validated` e
--   `billing_profile.invalidated` nas mudanças;
-- - a revalidação: depois de uma resposta, a próxima consulta é na janela da
--   noite (01:00–05:00 UTC) a pelo menos 24 h; um `indisponivel` volta à fila
--   em 1, 5 e 30 minutos, depois na janela da noite;
-- - `isencao_manual` (§13.5), que não se apaga nem se altera, só se retira, e
--   nunca com um `quem` de sistema (`eu-vat-oss-ioss`, regra 4); os eventos
--   `billing_profile.exemption_set` e `billing_profile.exemption_removed`;
-- - `validado_em` no perfil; o âmbito `customers:exemptions`, só do dono (Q4).
--
-- O que não faz: os anexos da isenção (um pedido à parte, com armazenamento
-- próprio: a pasta das imagens tem limpeza de ficheiros sem linha); a
-- consulta HTTP (é da API, fora da base).

SET LOCAL lock_timeout = '10s';

ALTER TABLE perfil_faturacao ADD COLUMN validado_em timestamptz;

CREATE OR REPLACE FUNCTION perfil_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  estado_da_ficha text;
  regua record;
  pais_comerciante text;
BEGIN
  -- A ficha tem de se ver (RLS) e estar activa; tomá-la serializa os perfis
  -- dela (o principal do primeiro perfil, os arquivos).
  SELECT c.estado INTO estado_da_ficha FROM public.cliente c
  WHERE c.comerciante_id = NEW.comerciante_id AND c.id = NEW.cliente_id
  FOR UPDATE;
  IF estado_da_ficha IS NULL THEN
    RAISE EXCEPTION 'customers.not_found: a ficha não existe';
  END IF;
  IF estado_da_ficha <> 'activo' THEN
    RAISE EXCEPTION 'customers.invalid_transition: a ficha está %', estado_da_ficha;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.id <> OLD.id OR NEW.comerciante_id <> OLD.comerciante_id
       OR NEW.cliente_id <> OLD.cliente_id THEN
      RAISE EXCEPTION 'customers.immutable_identity: o id, o comerciante e a ficha de um perfil não mudam';
    END IF;
    IF NEW.usado_em_documento IS DISTINCT FROM OLD.usado_em_documento
       AND NOT NEW.usado_em_documento THEN
      RAISE EXCEPTION 'customers.profile_used: um perfil usado num documento não deixa de o ter sido';
    END IF;
  END IF;

  -- A régua do NIF, quando o NIF ou o país mudam (a API manda os dois).
  IF TG_OP = 'INSERT' OR NEW.nif_escrito IS DISTINCT FROM OLD.nif_escrito
     OR NEW.pais_contribuinte IS DISTINCT FROM OLD.pais_contribuinte THEN
    IF NEW.nif_escrito IS NULL AND NEW.pais_contribuinte IS NOT NULL THEN
      RAISE EXCEPTION 'customers.nif_invalid: um país do contribuinte sem NIF';
    END IF;
    pais_comerciante := public.pais_do_comerciante(NEW.comerciante_id);
    SELECT r.pais, r.numero INTO regua
    FROM public.nif_regua(NEW.nif_escrito, NEW.pais_contribuinte,
      pais_comerciante IS NOT DISTINCT FROM 'PT') r;
    NEW.pais_contribuinte := regua.pais;
    NEW.nif_numero := regua.numero;
  ELSE
    NEW.nif_numero := OLD.nif_numero;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.usado_em_documento
     AND (NEW.tipo <> OLD.tipo
       OR NEW.nif_numero IS DISTINCT FROM OLD.nif_numero
       OR NEW.pais_contribuinte IS DISTINCT FROM OLD.pais_contribuinte) THEN
    -- R4 (Q3 decidida): cria-se outro perfil; o NIF escrito pode mudar só na
    -- pontuação (o mesmo número).
    RAISE EXCEPTION 'customers.profile_used: um perfil usado num documento não muda de NIF, tipo nem país; crie outro perfil';
  END IF;

  -- O estado do VIES (§4.2): a consulta (parte 3) muda-o; aqui só se sabe se
  -- se aplica. Um NIF novo volta a precisar de validação.
  IF TG_OP = 'INSERT' OR NEW.nif_numero IS DISTINCT FROM OLD.nif_numero
     OR NEW.pais_contribuinte IS DISTINCT FROM OLD.pais_contribuinte THEN
    pais_comerciante := public.pais_do_comerciante(NEW.comerciante_id);
    NEW.estado_vies := CASE
      WHEN NEW.nif_numero IS NOT NULL AND public.prefixo_fiscal(NEW.pais_contribuinte) IS NOT NULL
        AND NEW.pais_contribuinte IS DISTINCT FROM pais_comerciante THEN 'por_validar'
      ELSE 'nao_aplicavel'
    END;
    NEW.validado_em := NULL;
  ELSIF current_setting('eurolify.vies_registar', true) IS DISTINCT FROM 'sim' THEN
    -- Só a `vies_registar` (com a resposta do VIES) muda o estado do VIES.
    NEW.estado_vies := OLD.estado_vies;
    NEW.validado_em := OLD.validado_em;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.estado <> 'activo' THEN
      RAISE EXCEPTION 'customers.invalid_transition: um perfil nasce activo';
    END IF;
    IF NEW.usado_em_documento THEN
      RAISE EXCEPTION 'customers.profile_used: um perfil novo não foi usado em nenhum documento';
    END IF;
    -- O primeiro perfil activo da ficha é o principal (R5).
    NEW.principal := NOT EXISTS (
      SELECT FROM public.perfil_faturacao p
      WHERE p.cliente_id = NEW.cliente_id AND p.principal);
    NEW.versao := 1;
    NEW.criado_em := now();
    NEW.actualizado_em := now();
    RETURN NEW;
  END IF;

  IF OLD.estado = 'activo' AND NEW.estado = 'arquivado' THEN
    IF OLD.principal AND EXISTS (
      SELECT FROM public.perfil_faturacao p
      WHERE p.cliente_id = NEW.cliente_id AND p.id <> NEW.id AND p.estado = 'activo') THEN
      RAISE EXCEPTION 'customers.primary_profile: o perfil principal não se arquiva enquanto houver outro activo; torne outro principal primeiro';
    END IF;
    NEW.principal := false;
  ELSIF OLD.estado = 'arquivado' AND NEW.estado = 'activo' THEN
    NEW.principal := NOT EXISTS (
      SELECT FROM public.perfil_faturacao p
      WHERE p.cliente_id = NEW.cliente_id AND p.id <> NEW.id AND p.principal);
  ELSIF NEW.estado = 'arquivado' AND NEW.principal THEN
    RAISE EXCEPTION 'customers.invalid_transition: um perfil arquivado não é o principal';
  END IF;
  NEW.criado_em := OLD.criado_em;
  NEW.actualizado_em := now();
  NEW.versao := OLD.versao + 1;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION clientes_evento() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  campos jsonb;
  nomes jsonb;
  dados jsonb;
  quem text := nullif(btrim(current_setting('eurolify.quem', true)), '');
BEGIN
  campos := public.clientes_campos_mudados(TG_OP,
    CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) END, to_jsonb(NEW))
    -- O estado do VIES tem os eventos próprios (validated, invalidated).
    - ARRAY['estado_vies', 'validado_em'];
  IF campos = '{}' THEN
    RETURN NULL;
  END IF;
  SELECT coalesce(jsonb_agg(k ORDER BY k), '[]') INTO nomes FROM jsonb_object_keys(campos) k;
  IF TG_TABLE_NAME = 'cliente' THEN
    dados := jsonb_build_object('cliente_id', NEW.id);
  ELSE
    dados := jsonb_build_object('perfil_id', NEW.id, 'cliente_id', NEW.cliente_id);
  END IF;
  IF TG_OP = 'UPDATE' THEN
    dados := dados || jsonb_build_object('campos', nomes);
  END IF;
  dados := dados || jsonb_build_object('quem', quem,
    'em', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  INSERT INTO public.evento_saida (comerciante_id, tipo, agregado_tipo, agregado_id, dados)
  VALUES (NEW.comerciante_id,
    CASE TG_TABLE_NAME WHEN 'cliente' THEN 'customer' ELSE 'billing_profile' END
      || CASE TG_OP WHEN 'INSERT' THEN '.created' ELSE '.updated' END,
    TG_TABLE_NAME, NEW.id, dados);
  RETURN NULL;
END
$$;

-- -------------------------------------------------------------- A prova

CREATE TABLE validacao_vies (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  perfil_id uuid NOT NULL,
  pais_consultado text NOT NULL CHECK (pais_consultado ~ '^[A-Z]{2}$'),
  numero_consultado text NOT NULL CHECK (numero_consultado ~ '^[A-Z0-9]{2,20}$'),
  requerente_pais text CHECK (requerente_pais ~ '^[A-Z]{2}$'),
  requerente_numero text CHECK (requerente_numero ~ '^[A-Z0-9]{2,20}$'),
  consultado_em timestamptz NOT NULL,
  data_vies timestamptz,
  resultado text NOT NULL CHECK (resultado IN ('valido', 'invalido', 'indisponivel')),
  codigo_erro text CHECK (codigo_erro IS NULL OR length(codigo_erro) BETWEEN 1 AND 100),
  identificador_consulta text CHECK (identificador_consulta IS NULL
    OR length(identificador_consulta) BETWEEN 1 AND 100),
  nome_devolvido text CHECK (nome_devolvido IS NULL OR length(nome_devolvido) <= 500),
  morada_devolvida text CHECK (morada_devolvida IS NULL OR length(morada_devolvida) <= 1000),
  motivo text NOT NULL CHECK (motivo IN ('perfil_novo', 'nif_mudou', 'revalidacao', 'pedido')),
  quem text NOT NULL CHECK (length(quem) BETWEEN 1 AND 200),
  registado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT validacao_vies_requerente_inteiro CHECK (
    (requerente_pais IS NULL) = (requerente_numero IS NULL)),
  CONSTRAINT validacao_vies_erro_so_sem_resposta CHECK (
    (resultado = 'indisponivel') = (codigo_erro IS NOT NULL)),
  CONSTRAINT validacao_vies_do_perfil FOREIGN KEY (comerciante_id, perfil_id)
    REFERENCES perfil_faturacao (comerciante_id, id)
);
CREATE INDEX validacao_vies_por_perfil ON validacao_vies (comerciante_id, perfil_id, id);

CREATE TRIGGER validacao_vies_so_se_acrescenta
  BEFORE UPDATE OR DELETE ON validacao_vies
  FOR EACH ROW EXECUTE FUNCTION rasto_so_se_acrescenta();
CREATE TRIGGER validacao_vies_sem_truncate
  BEFORE TRUNCATE ON validacao_vies
  FOR EACH STATEMENT EXECUTE FUNCTION rasto_so_se_acrescenta();
ALTER TABLE validacao_vies ENABLE ALWAYS TRIGGER validacao_vies_so_se_acrescenta;
ALTER TABLE validacao_vies ENABLE ALWAYS TRIGGER validacao_vies_sem_truncate;

-- -------------------------------------------------------------- A fila

-- Interna: só as funções do dono lhe tocam (a API não tem direitos). Sem o
-- RLS forçado, como a `ficheiro_sem_uso` (0035): a tarefa precisa de ver que
-- comerciantes têm consultas por fazer.
CREATE TABLE vies_fila (
  perfil_id uuid PRIMARY KEY,
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  proxima_em timestamptz NOT NULL,
  tentativas integer NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
  motivo text NOT NULL CHECK (motivo IN ('perfil_novo', 'nif_mudou', 'revalidacao', 'pedido')),
  CONSTRAINT vies_fila_do_perfil FOREIGN KEY (comerciante_id, perfil_id)
    REFERENCES perfil_faturacao (comerciante_id, id)
);
CREATE INDEX vies_fila_por_hora ON vies_fila (proxima_em);
ALTER TABLE vies_fila ENABLE ROW LEVEL SECURITY;

-- A próxima revalidação: na janela da noite (01:00–05:00 UTC), a pelo menos
-- 24 h de agora, num minuto ao acaso para não irem todas juntas.
CREATE FUNCTION vies_proxima_noite() RETURNS timestamptz
  LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  minimo timestamptz := now() + interval '24 hours';
  dia timestamptz := date_trunc('day', minimo AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  quando timestamptz;
BEGIN
  quando := dia + interval '1 hour' + floor(random() * 240) * interval '1 minute';
  IF quando < minimo THEN
    quando := quando + interval '1 day';
  END IF;
  RETURN quando;
END
$$;

-- O gatilho do perfil põe na fila (ou tira) quando o NIF, o país ou o
-- estado mudam; as respostas do VIES mexem na fila pela `vies_registar`.
CREATE FUNCTION perfil_vies_fila() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF current_setting('eurolify.vies_registar', true) = 'sim' THEN
    RETURN NULL;
  END IF;
  IF NEW.estado <> 'activo' OR NEW.estado_vies = 'nao_aplicavel' THEN
    DELETE FROM public.vies_fila WHERE perfil_id = NEW.id;
    RETURN NULL;
  END IF;
  IF TG_OP = 'INSERT' OR NEW.nif_numero IS DISTINCT FROM OLD.nif_numero
     OR NEW.pais_contribuinte IS DISTINCT FROM OLD.pais_contribuinte
     OR OLD.estado <> 'activo' THEN
    INSERT INTO public.vies_fila (perfil_id, comerciante_id, proxima_em, tentativas, motivo)
    VALUES (NEW.id, NEW.comerciante_id, now(), 0,
      CASE WHEN TG_OP = 'INSERT' THEN 'perfil_novo'
           WHEN OLD.estado <> 'activo' THEN 'revalidacao'
           ELSE 'nif_mudou' END)
    ON CONFLICT (perfil_id) DO UPDATE
      SET proxima_em = EXCLUDED.proxima_em, tentativas = 0, motivo = EXCLUDED.motivo;
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER perfil_vies_fila
  AFTER INSERT OR UPDATE ON perfil_faturacao
  FOR EACH ROW EXECUTE FUNCTION perfil_vies_fila();

-- Os perfis que já estão por validar (a parte 1 já estava no ensaio): para
-- a fila. O perfil tem o RLS forçado e a migração corre sem comerciante: o
-- NO FORCE só dura esta transacção.
ALTER TABLE perfil_faturacao NO FORCE ROW LEVEL SECURITY;
INSERT INTO vies_fila (perfil_id, comerciante_id, proxima_em, tentativas, motivo)
SELECT p.id, p.comerciante_id, now(), 0, 'perfil_novo'
FROM perfil_faturacao p
WHERE p.estado = 'activo' AND p.estado_vies <> 'nao_aplicavel';
ALTER TABLE perfil_faturacao FORCE ROW LEVEL SECURITY;

-- Os comerciantes com consultas para fazer agora (a tarefa da API percorre-os).
CREATE FUNCTION vies_comerciantes_com_fila() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT DISTINCT f.comerciante_id FROM public.vies_fila f WHERE f.proxima_em <= now()
$$;

-- As consultas para fazer agora no comerciante posto, as mais antigas
-- primeiro.
CREATE FUNCTION vies_por_consultar(p_limite integer)
  RETURNS TABLE (perfil_id uuid, pais text, numero text, motivo text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT p.id, p.pais_contribuinte, p.nif_numero, f.motivo
  FROM public.vies_fila f
  JOIN public.perfil_faturacao p
    ON p.comerciante_id = f.comerciante_id AND p.id = f.perfil_id
  WHERE f.comerciante_id = public.comerciante_actual() AND f.proxima_em <= now()
    AND p.estado = 'activo' AND p.nif_numero IS NOT NULL
  ORDER BY f.proxima_em, f.perfil_id
  LIMIT greatest(p_limite, 0)
$$;

-- O requerente (Q7): o NIF da entidade legal do comerciante posto, quando
-- ele tem uma só entidade activa num país da UE.
CREATE FUNCTION vies_requerente(OUT pais text, OUT numero text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT min(e.pais), min(e.numero_fiscal)
  FROM public.entidade_legal e
  WHERE e.comerciante_id = public.comerciante_actual() AND e.estado = 'activa'
    AND public.prefixo_fiscal(e.pais) IS NOT NULL
  HAVING count(*) = 1
$$;

-- Grava a resposta (§13.4, passo 4). Devolve o id da prova.
CREATE FUNCTION vies_registar(
  p_perfil uuid, p_pais text, p_numero text,
  p_requerente_pais text, p_requerente_numero text,
  p_consultado_em timestamptz, p_data_vies timestamptz,
  p_resultado text, p_codigo_erro text, p_identificador text,
  p_nome text, p_morada text, p_motivo text)
  RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem text := nullif(btrim(current_setting('eurolify.quem', true)), '');
  ficha uuid;
  perfil record;
  prova uuid;
  mesmo boolean;
  novo_estado text;
  tentativas_agora integer;
BEGIN
  IF quem IS NULL THEN
    RAISE EXCEPTION 'customers.change_without_who: vies_registar sem eurolify.quem';
  END IF;
  -- A ficha antes do perfil, pela ordem dos outros caminhos (revisão do
  -- #234, P3-1).
  SELECT p.cliente_id INTO ficha FROM public.perfil_faturacao p WHERE p.id = p_perfil;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'customers.not_found: o perfil não existe';
  END IF;
  PERFORM FROM public.cliente c WHERE c.id = ficha FOR UPDATE;
  SELECT p.comerciante_id, p.pais_contribuinte, p.nif_numero, p.estado, p.estado_vies
  INTO perfil FROM public.perfil_faturacao p WHERE p.id = p_perfil FOR UPDATE;

  INSERT INTO public.validacao_vies (comerciante_id, perfil_id, pais_consultado,
    numero_consultado, requerente_pais, requerente_numero, consultado_em, data_vies,
    resultado, codigo_erro, identificador_consulta, nome_devolvido, morada_devolvida,
    motivo, quem)
  VALUES (perfil.comerciante_id, p_perfil, p_pais, p_numero, p_requerente_pais,
    p_requerente_numero, p_consultado_em, p_data_vies, p_resultado, p_codigo_erro,
    nullif(btrim(p_identificador), ''), nullif(btrim(p_nome), ''),
    nullif(btrim(p_morada), ''), p_motivo, quem)
  RETURNING id INTO prova;

  -- Se o NIF mudou entretanto, a prova fica e o estado não (§13.4, passo 4).
  mesmo := perfil.estado = 'activo' AND perfil.pais_contribuinte = p_pais
    AND perfil.nif_numero = p_numero AND perfil.estado_vies <> 'nao_aplicavel';
  IF NOT mesmo THEN
    RETURN prova;
  END IF;

  -- Q6: sem resposta, a última resposta fica; só um perfil sem nenhuma passa
  -- a `indisponivel`.
  novo_estado := CASE
    WHEN p_resultado IN ('valido', 'invalido') THEN p_resultado
    WHEN perfil.estado_vies = 'por_validar' THEN 'indisponivel'
    ELSE perfil.estado_vies
  END;
  PERFORM set_config('eurolify.vies_registar', 'sim', true);
  UPDATE public.perfil_faturacao
  SET estado_vies = novo_estado,
      validado_em = CASE WHEN p_resultado IN ('valido', 'invalido')
        THEN coalesce(p_data_vies, p_consultado_em) ELSE validado_em END
  WHERE id = p_perfil;
  PERFORM set_config('eurolify.vies_registar', '', true);

  IF novo_estado = 'valido' AND perfil.estado_vies <> 'valido' THEN
    INSERT INTO public.evento_saida (comerciante_id, tipo, agregado_tipo, agregado_id, dados)
    VALUES (perfil.comerciante_id, 'billing_profile.validated', 'perfil_faturacao', p_perfil,
      jsonb_build_object('perfil_id', p_perfil, 'cliente_id', ficha, 'validacao_id', prova,
        'quem', quem, 'em', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
  ELSIF novo_estado = 'invalido' AND perfil.estado_vies = 'valido' THEN
    INSERT INTO public.evento_saida (comerciante_id, tipo, agregado_tipo, agregado_id, dados)
    VALUES (perfil.comerciante_id, 'billing_profile.invalidated', 'perfil_faturacao', p_perfil,
      jsonb_build_object('perfil_id', p_perfil, 'cliente_id', ficha, 'validacao_id', prova,
        'quem', quem, 'em', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
  END IF;

  -- A fila: com resposta, a próxima é na noite a pelo menos 24 h; sem
  -- resposta, 1, 5 e 30 minutos, depois a noite.
  IF p_resultado IN ('valido', 'invalido') THEN
    INSERT INTO public.vies_fila (perfil_id, comerciante_id, proxima_em, tentativas, motivo)
    VALUES (p_perfil, perfil.comerciante_id, public.vies_proxima_noite(), 0, 'revalidacao')
    ON CONFLICT (perfil_id) DO UPDATE
      SET proxima_em = EXCLUDED.proxima_em, tentativas = 0, motivo = 'revalidacao';
  ELSE
    SELECT coalesce(f.tentativas, 0) + 1 INTO tentativas_agora
    FROM public.vies_fila f WHERE f.perfil_id = p_perfil;
    tentativas_agora := coalesce(tentativas_agora, 1);
    INSERT INTO public.vies_fila (perfil_id, comerciante_id, proxima_em, tentativas, motivo)
    VALUES (p_perfil, perfil.comerciante_id,
      CASE tentativas_agora
        WHEN 1 THEN now() + interval '1 minute'
        WHEN 2 THEN now() + interval '5 minutes'
        WHEN 3 THEN now() + interval '30 minutes'
        ELSE public.vies_proxima_noite()
      END, tentativas_agora, p_motivo)
    ON CONFLICT (perfil_id) DO UPDATE
      SET proxima_em = EXCLUDED.proxima_em, tentativas = EXCLUDED.tentativas;
  END IF;
  RETURN prova;
END
$$;

-- ------------------------------------------------------ A isenção manual

CREATE TABLE isencao_manual (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  perfil_id uuid NOT NULL,
  motivo text NOT NULL CHECK (length(btrim(motivo)) BETWEEN 1 AND 500),
  nota text CHECK (nota IS NULL OR length(nota) <= 2000),
  posta_por text NOT NULL,
  posta_em timestamptz NOT NULL DEFAULT now(),
  motivo_retirada text CHECK (motivo_retirada IS NULL OR length(btrim(motivo_retirada)) BETWEEN 1 AND 500),
  retirada_por text,
  retirada_em timestamptz,
  CONSTRAINT isencao_retirada_inteira CHECK (
    (motivo_retirada IS NULL) = (retirada_por IS NULL)
    AND (retirada_por IS NULL) = (retirada_em IS NULL)),
  CONSTRAINT isencao_do_perfil FOREIGN KEY (comerciante_id, perfil_id)
    REFERENCES perfil_faturacao (comerciante_id, id)
);
-- Uma em vigor por perfil.
CREATE UNIQUE INDEX isencao_uma_em_vigor ON isencao_manual (perfil_id) WHERE retirada_em IS NULL;
CREATE INDEX isencao_por_perfil ON isencao_manual (comerciante_id, perfil_id, id);

-- Só uma pessoa (ou a chave dela) a põe e a retira; nunca um processo de
-- sistema (`eu-vat-oss-ioss`, regra 4). Não se altera: só se retira, uma vez.
CREATE FUNCTION isencao_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem text := nullif(btrim(current_setting('eurolify.quem', true)), '');
  estado_do_perfil text;
BEGIN
  IF quem IS NULL OR quem LIKE 'sistema:%' THEN
    RAISE EXCEPTION 'customers.exemption_by_person: a isenção manual só a põe ou retira uma pessoa (quem: %)',
      coalesce(quem, 'nenhum');
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT p.estado INTO estado_do_perfil FROM public.perfil_faturacao p
    WHERE p.comerciante_id = NEW.comerciante_id AND p.id = NEW.perfil_id;
    IF estado_do_perfil IS NULL THEN
      RAISE EXCEPTION 'customers.not_found: o perfil não existe';
    END IF;
    IF estado_do_perfil <> 'activo' THEN
      RAISE EXCEPTION 'customers.invalid_transition: o perfil está arquivado';
    END IF;
    NEW.posta_por := quem;
    NEW.posta_em := now();
    NEW.motivo_retirada := NULL;
    NEW.retirada_por := NULL;
    NEW.retirada_em := NULL;
    RETURN NEW;
  END IF;
  IF OLD.retirada_em IS NOT NULL OR NEW.motivo_retirada IS NULL
     OR NEW.id <> OLD.id OR NEW.comerciante_id <> OLD.comerciante_id
     OR NEW.perfil_id <> OLD.perfil_id OR NEW.motivo <> OLD.motivo
     OR NEW.nota IS DISTINCT FROM OLD.nota OR NEW.posta_por <> OLD.posta_por
     OR NEW.posta_em <> OLD.posta_em THEN
    RAISE EXCEPTION 'customers.exemption_immutable: uma isenção não se altera; retira-se, uma vez, e põe-se outra';
  END IF;
  NEW.retirada_por := quem;
  NEW.retirada_em := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER isencao_antes_de_gravar
  BEFORE INSERT OR UPDATE ON isencao_manual
  FOR EACH ROW EXECUTE FUNCTION isencao_antes_de_gravar();
ALTER TABLE isencao_manual ENABLE ALWAYS TRIGGER isencao_antes_de_gravar;
CREATE TRIGGER isencao_nao_se_apaga
  BEFORE DELETE ON isencao_manual
  FOR EACH ROW EXECUTE FUNCTION rasto_so_se_acrescenta();
CREATE TRIGGER isencao_sem_truncate
  BEFORE TRUNCATE ON isencao_manual
  FOR EACH STATEMENT EXECUTE FUNCTION rasto_so_se_acrescenta();
ALTER TABLE isencao_manual ENABLE ALWAYS TRIGGER isencao_nao_se_apaga;
ALTER TABLE isencao_manual ENABLE ALWAYS TRIGGER isencao_sem_truncate;

CREATE FUNCTION isencao_evento() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  INSERT INTO public.evento_saida (comerciante_id, tipo, agregado_tipo, agregado_id, dados)
  VALUES (NEW.comerciante_id,
    CASE TG_OP WHEN 'INSERT' THEN 'billing_profile.exemption_set'
      ELSE 'billing_profile.exemption_removed' END,
    'perfil_faturacao', NEW.perfil_id,
    jsonb_build_object('perfil_id', NEW.perfil_id, 'isencao_id', NEW.id,
      'quem', CASE TG_OP WHEN 'INSERT' THEN NEW.posta_por ELSE NEW.retirada_por END,
      'em', to_char(coalesce(NEW.retirada_em, NEW.posta_em) AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
  RETURN NULL;
END
$$;
CREATE TRIGGER isencao_evento
  AFTER INSERT OR UPDATE ON isencao_manual
  FOR EACH ROW EXECUTE FUNCTION isencao_evento();

-- ----------------------------------------------------- RLS e permissões

DO $$
DECLARE
  tabela text;
BEGIN
  FOREACH tabela IN ARRAY ARRAY['validacao_vies', 'isencao_manual'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tabela);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tabela);
    EXECUTE format(
      'CREATE POLICY so_o_proprio ON %I USING (comerciante_id = comerciante_actual()) WITH CHECK (comerciante_id = comerciante_actual())',
      tabela);
  END LOOP;
END
$$;

GRANT SELECT ON validacao_vies, isencao_manual TO eurolify_api;
GRANT INSERT (comerciante_id, perfil_id, motivo, nota) ON isencao_manual TO eurolify_api;
GRANT UPDATE (motivo_retirada) ON isencao_manual TO eurolify_api;

REVOKE EXECUTE ON FUNCTION vies_proxima_noite(), perfil_vies_fila(),
  vies_comerciantes_com_fila(), vies_por_consultar(integer), vies_requerente(),
  vies_registar(uuid, text, text, text, text, timestamptz, timestamptz, text, text, text, text, text, text),
  isencao_antes_de_gravar(), isencao_evento() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vies_comerciantes_com_fila(), vies_por_consultar(integer),
  vies_requerente(),
  vies_registar(uuid, text, text, text, text, timestamptz, timestamptz, text, text, text, text, text, text)
  TO eurolify_api;

-- ------------------------------------------------------------- O âmbito

ALTER TABLE chave_api DROP CONSTRAINT chave_api_ambitos_validos;
ALTER TABLE chave_api ADD CONSTRAINT chave_api_ambitos_validos CHECK (
  cardinality(ambitos) BETWEEN 1 AND 20
  AND ambitos <@ ARRAY[
    'merchant:read', 'merchant:write',
    'catalog:read', 'catalog:write', 'catalog:publish', 'catalog:import',
    'catalog:history', 'prices:read', 'prices:write',
    'customers:read', 'customers:write', 'customers:billing',
    'customers:exemptions', 'keys:write', 'storefront'
  ]::text[]);

CREATE OR REPLACE FUNCTION papel_ambitos(p_papel text) RETURNS text[]
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT CASE p_papel
    WHEN 'dono' THEN ARRAY['catalog:history', 'catalog:import', 'catalog:publish',
                           'catalog:read', 'catalog:write', 'customers:billing',
                           'customers:exemptions', 'customers:read',
                           'customers:write', 'keys:write', 'merchant:read',
                           'merchant:write', 'prices:read', 'prices:write']
    WHEN 'gestor' THEN ARRAY['catalog:history', 'catalog:import', 'catalog:publish',
                             'catalog:read', 'catalog:write', 'customers:read',
                             'customers:write', 'merchant:read', 'prices:read',
                             'prices:write']
    WHEN 'armazem' THEN ARRAY['catalog:read', 'prices:read']
    WHEN 'apoio' THEN ARRAY['catalog:read', 'customers:read', 'customers:write',
                            'merchant:read', 'prices:read']
  END::text[]
$$;
