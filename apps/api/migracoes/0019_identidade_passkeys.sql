-- Fatia «identidade», parte B2: passkeys, desafios WebAuthn e as portas da
-- API para entrar, sair, aceitar convites e gerir a equipa (docs/21 §3,
-- §4.2 a §4.6 e §11; issue #140). Ex.: a Ana abre a ligação do convite,
-- regista a passkey do telemóvel e fica dentro do Hub; amanhã entra só com a
-- passkey, sem escrever o e-mail.
--
-- O que esta migração faz:
-- - a tabela `passkey` (docs/21 §4.1): a chave pública e o contador; a chave
--   privada nunca sai do dispositivo. O contador nunca recua (P-T14);
-- - a tabela `desafio_webauthn`: o resumo de cada desafio, de uso único e
--   válido 5 minutos (proposta, §11); o de registo fica preso ao convite;
-- - as funções que as rotas da B2 chamam, as únicas com EXECUTE para a API.
--   A verificação da assinatura WebAuthn faz-se na API (@simplewebauthn): a
--   base não a sabe fazer, e confia na API para ela, como confia no resumo
--   de uma chave (0010). A base impõe o resto: o desafio que ela deu, de uso
--   único e gasto na mesma transacção que cria a sessão; o contador; a
--   pessoa activa; os convites e os papéis (B1);
-- - reautenticar troca a sessão por uma nova, com segredo novo (P-T13): a
--   antiga fica revogada com o motivo `substituida`.
--
-- O que não faz (e onde fica): acrescentar e retirar passkeys, palavra-passe
-- + TOTP, códigos de recuperação e limites de tentativas (B3); apagar os
-- desafios velhos por tarefa (B4; até lá, cada desafio novo apaga os que
-- passaram de um dia).

SET LOCAL lock_timeout = '10s';

ALTER TABLE sessao DROP CONSTRAINT sessao_revogada_motivo_check;
ALTER TABLE sessao ADD CONSTRAINT sessao_revogada_motivo_check CHECK (
  revogada_motivo IN ('saiu', 'pessoa_desactivada', 'recuperacao',
                      'terminar_todas', 'substituida'));

CREATE TABLE passkey (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  pessoa_id uuid NOT NULL REFERENCES pessoa (id),
  -- O identificador da credencial, em base64url, como o devolve o navegador.
  credencial_id text NOT NULL CHECK (credencial_id ~ '^[A-Za-z0-9_-]{16,1366}$'),
  chave_publica bytea NOT NULL CHECK (length(chave_publica) BETWEEN 16 AND 4096),
  contador bigint NOT NULL CHECK (contador >= 0),
  transportes text[] NOT NULL DEFAULT '{}' CHECK (cardinality(transportes) <= 10),
  nome text NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 100),
  criada_em timestamptz NOT NULL DEFAULT now(),
  ultimo_uso_em timestamptz,
  CONSTRAINT passkey_credencial_unica UNIQUE (credencial_id)
);
CREATE INDEX passkey_por_pessoa ON passkey (pessoa_id);

CREATE TABLE desafio_webauthn (
  -- sha256 do desafio em base64url: o desafio só vive no navegador.
  resumo text PRIMARY KEY CHECK (resumo ~ '^[0-9a-f]{64}$'),
  finalidade text NOT NULL CHECK (finalidade IN ('entrar', 'registar')),
  convite_id uuid REFERENCES convite (id),
  criado_em timestamptz NOT NULL DEFAULT now(),
  usado_em timestamptz,
  CONSTRAINT desafio_registo_do_convite CHECK ((finalidade = 'registar') = (convite_id IS NOT NULL))
);
CREATE INDEX desafio_webauthn_por_data ON desafio_webauthn (criado_em);

-- A passkey: o que a identifica não muda; o contador não recua; a data é da
-- base.
CREATE FUNCTION passkey_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.criada_em := now();
    NEW.ultimo_uso_em := NULL;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.pessoa_id, NEW.credencial_id, NEW.chave_publica, NEW.criada_em)
     IS DISTINCT FROM (OLD.id, OLD.pessoa_id, OLD.credencial_id, OLD.chave_publica, OLD.criada_em) THEN
    RAISE EXCEPTION 'account.immutable: uma passkey não muda de pessoa nem de chave';
  END IF;
  IF NEW.contador < OLD.contador THEN
    RAISE EXCEPTION 'account.immutable: o contador de uma passkey não recua';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER passkey_antes_de_gravar
  BEFORE INSERT OR UPDATE ON passkey
  FOR EACH ROW EXECUTE FUNCTION passkey_antes_de_gravar();
ALTER TABLE passkey ENABLE ALWAYS TRIGGER passkey_antes_de_gravar;

-- Como as outras tabelas das contas (0018): RLS sem políticas (nada a quem
-- não é dono), nenhum privilégio à API.
ALTER TABLE passkey ENABLE ROW LEVEL SECURITY;
ALTER TABLE desafio_webauthn ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON passkey, desafio_webauthn FROM PUBLIC;

-- Apoio (interna): criar a sessão de uma pessoa activa.
CREATE FUNCTION sessao_nova(p_pessoa uuid, p_resumo text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  nova uuid;
BEGIN
  IF p_resumo IS NULL OR p_resumo !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'auth.invalid_secret: resumo da sessão inválido';
  END IF;
  RETURN public.sessao_criar(p_pessoa, p_resumo);
END
$$;

-- Apoio (interna): usar uma passkey. O contador só avança (ou fica em 0
-- nas passkeys que não o usam, como as sincronizadas); um contador que não
-- avança é recusado como uma passkey clonada (P-T14).
CREATE FUNCTION passkey_usar(p_passkey uuid, p_contador bigint) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  dona uuid;
BEGIN
  UPDATE public.passkey k
  SET contador = p_contador, ultimo_uso_em = now()
  FROM public.pessoa p
  WHERE k.id = p_passkey
    AND p.id = k.pessoa_id
    AND p.estado = 'activa'
    AND p_contador IS NOT NULL AND p_contador >= 0
    AND ((p_contador = 0 AND k.contador = 0) OR p_contador > k.contador)
  RETURNING k.pessoa_id INTO dona;
  IF dona IS NULL THEN
    RAISE EXCEPTION 'auth.unauthenticated: passkey desconhecida, de pessoa desactivada ou com o contador a recuar';
  END IF;
  RETURN dona;
END
$$;

-- As portas da API.

-- Guardar um desafio de entrada. Apaga os desafios com mais de um dia.
CREATE FUNCTION desafio_criar_entrada(p_resumo text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  DELETE FROM public.desafio_webauthn d WHERE d.criado_em < now() - interval '1 day';
  INSERT INTO public.desafio_webauthn (resumo, finalidade) VALUES (p_resumo, 'entrar');
END
$$;

-- Guardar um desafio de registo, preso a um convite em aberto. Devolve o
-- e-mail do convite (o nome da credencial no dispositivo) e o identificador
-- do convite, que serve de identificador do utilizador no WebAuthn.
CREATE FUNCTION desafio_criar_registo(p_resumo text, p_segredo_convite text)
  RETURNS TABLE (convite_id uuid, email text)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  c public.convite;
BEGIN
  c := public.convite_em_aberto(p_segredo_convite);
  DELETE FROM public.desafio_webauthn d WHERE d.criado_em < now() - interval '1 day';
  INSERT INTO public.desafio_webauthn (resumo, finalidade, convite_id)
  VALUES (p_resumo, 'registar', c.id);
  RETURN QUERY SELECT c.id, c.email;
END
$$;

-- Gastar um desafio (interna): uma vez, nos 5 minutos, para a mesma
-- finalidade (e o mesmo convite, no registo). Sem isso,
-- `auth.unauthenticated`. Gasta-se na mesma transacção que cria a sessão:
-- a API não cria uma sessão sem um desafio que a base deu.
CREATE FUNCTION desafio_gastar(p_resumo text, p_finalidade text, p_segredo_convite text)
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  UPDATE public.desafio_webauthn d SET usado_em = now()
  WHERE d.resumo = p_resumo
    AND d.finalidade = p_finalidade
    AND d.usado_em IS NULL
    AND d.criado_em > now() - interval '5 minutes'
    AND (p_finalidade = 'entrar' OR d.convite_id = (
      SELECT x.id FROM public.convite x
      WHERE x.resumo = public.resumo_do_segredo(p_segredo_convite)));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'auth.unauthenticated: desafio desconhecido, já usado ou expirado';
  END IF;
END
$$;

-- A passkey de uma credencial, para a API verificar a assinatura. Nada para
-- uma pessoa desactivada.
CREATE FUNCTION passkey_para_entrar(p_credencial text)
  RETURNS TABLE (passkey_id uuid, pessoa_id uuid, chave_publica bytea,
                 contador bigint, transportes text[])
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT k.id, k.pessoa_id, k.chave_publica, k.contador, k.transportes
  FROM public.passkey k JOIN public.pessoa p ON p.id = k.pessoa_id
  WHERE k.credencial_id = p_credencial AND p.estado = 'activa'
$$;

-- Entrar: depois de a API verificar a assinatura, avança o contador e cria
-- a sessão (segredo novo a cada entrada, P-T13).
CREATE FUNCTION entrar_com_passkey(p_desafio text, p_passkey uuid, p_contador bigint,
                                   p_resumo_sessao text)
  RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM public.desafio_gastar(p_desafio, 'entrar', NULL);
  RETURN public.sessao_nova(public.passkey_usar(p_passkey, p_contador), p_resumo_sessao);
END
$$;

-- Autenticação recente: a passkey tem de ser da pessoa da sessão; a sessão
-- antiga é revogada e nasce outra, com segredo novo (P-T13).
CREATE FUNCTION reautenticar_com_passkey(p_desafio text, p_segredo_sessao text,
                                         p_passkey uuid, p_contador bigint,
                                         p_resumo_nova text)
  RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  s public.sessao;
BEGIN
  s := public.sessao_valida(p_segredo_sessao);
  PERFORM public.desafio_gastar(p_desafio, 'entrar', NULL);
  IF NOT EXISTS (SELECT 1 FROM public.passkey k
                 WHERE k.id = p_passkey AND k.pessoa_id = s.pessoa_id) THEN
    RAISE EXCEPTION 'auth.unauthenticated: a passkey não é da pessoa da sessão';
  END IF;
  PERFORM public.passkey_usar(p_passkey, p_contador);
  UPDATE public.sessao x SET revogada_motivo = 'substituida'
  WHERE x.id = s.id AND x.revogada_em IS NULL;
  RETURN public.sessao_nova(s.pessoa_id, p_resumo_nova);
END
$$;

-- Conta nova a partir de um convite (docs/21 §4.2, ponto 3): a pessoa, o
-- membro, a passkey e a sessão na mesma transacção.
CREATE FUNCTION conta_nova_com_passkey(p_desafio text, p_segredo_convite text, p_nome text,
                                       p_credencial text, p_chave_publica bytea,
                                       p_contador bigint, p_transportes text[],
                                       p_nome_passkey text, p_resumo_sessao text)
  RETURNS TABLE (pessoa_id uuid, comerciante_id uuid, sessao_id uuid)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  nova record;
BEGIN
  PERFORM public.desafio_gastar(p_desafio, 'registar', p_segredo_convite);
  SELECT * INTO nova FROM public.convite_aceitar_conta_nova(p_segredo_convite, p_nome);
  BEGIN
    INSERT INTO public.passkey (pessoa_id, credencial_id, chave_publica, contador,
                                transportes, nome)
    VALUES (nova.pessoa_id, p_credencial, p_chave_publica, p_contador,
            coalesce(p_transportes, '{}'), coalesce(nullif(btrim(p_nome_passkey), ''), 'Passkey'));
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'passkey.already_registered: esta passkey já está registada';
  END;
  RETURN QUERY SELECT nova.pessoa_id, nova.comerciante_id,
                      public.sessao_nova(nova.pessoa_id, p_resumo_sessao);
END
$$;

-- Validar uma sessão (sem comerciante): a pessoa e se a autenticação é
-- recente. `auth.unauthenticated` sem sessão válida.
CREATE FUNCTION sessao_verificar(p_segredo text)
  RETURNS TABLE (sessao_id uuid, pessoa_id uuid, recente boolean)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  s public.sessao;
BEGIN
  s := public.sessao_valida(p_segredo);
  UPDATE public.sessao x SET ultimo_uso_em = now()
  WHERE x.id = s.id AND x.revogada_em IS NULL
    AND x.ultimo_uso_em < now() - interval '1 minute';
  RETURN QUERY SELECT s.id, s.pessoa_id, s.autenticada_em > now() - interval '10 minutes';
END
$$;

-- A pessoa da sessão e os comerciantes de que é membro activo.
CREATE FUNCTION pessoa_eu(p_segredo text) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  s public.sessao;
BEGIN
  s := public.sessao_valida(p_segredo);
  RETURN (
    SELECT jsonb_build_object(
      'pessoa', p.id, 'nome', p.nome, 'email', p.email,
      'comerciantes', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
                 'comerciante', m.comerciante_id, 'nome', c.nome,
                 'papel', m.papel, 'membro', m.id)
               ORDER BY c.nome, m.comerciante_id)
        FROM public.membro m JOIN public.comerciante c ON c.id = m.comerciante_id
        WHERE m.pessoa_id = p.id AND m.ate IS NULL), '[]'::jsonb))
    FROM public.pessoa p WHERE p.id = s.pessoa_id);
END
$$;

-- Os membros activos do comerciante do contexto; o dono vê também os
-- convites em aberto (docs/21 §11).
CREATE FUNCTION membros_listar(p_segredo text) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem public.membro;
BEGIN
  quem := public.membro_de_quem_pede(p_segredo, false);
  RETURN jsonb_build_object(
    'membros', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'membro', m.id, 'pessoa', p.id, 'nome', p.nome, 'email', p.email,
               'papel', m.papel, 'desde', m.desde)
             ORDER BY m.desde, m.id)
      FROM public.membro m JOIN public.pessoa p ON p.id = m.pessoa_id
      WHERE m.comerciante_id = quem.comerciante_id AND m.ate IS NULL), '[]'::jsonb),
    'convites', CASE WHEN quem.papel = 'dono' THEN coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'convite', x.id, 'email', x.email, 'papel', x.papel,
               'criado_em', x.criado_em, 'expira_em', x.expira_em)
             ORDER BY x.criado_em, x.id)
      FROM public.convite x
      WHERE x.comerciante_id = quem.comerciante_id
        AND x.aceite_em IS NULL AND x.cancelado_em IS NULL
        AND x.expira_em > now()), '[]'::jsonb) END);
END
$$;

REVOKE ALL ON FUNCTION passkey_antes_de_gravar(), sessao_nova(uuid, text),
  passkey_usar(uuid, bigint), desafio_criar_entrada(text),
  desafio_criar_registo(text, text), desafio_gastar(text, text, text),
  passkey_para_entrar(text), entrar_com_passkey(text, uuid, bigint, text),
  reautenticar_com_passkey(text, text, uuid, bigint, text),
  conta_nova_com_passkey(text, text, text, text, bytea, bigint, text[], text, text),
  sessao_verificar(text), pessoa_eu(text), membros_listar(text) FROM PUBLIC;

-- A API recebe só as portas que as rotas da B2 chamam (docs/21 §11).
GRANT EXECUTE ON FUNCTION desafio_criar_entrada(text),
  desafio_criar_registo(text, text), passkey_para_entrar(text), entrar_com_passkey(text, uuid, bigint, text),
  reautenticar_com_passkey(text, text, uuid, bigint, text),
  conta_nova_com_passkey(text, text, text, text, bytea, bigint, text[], text, text),
  sessao_verificar(text), sessao_resolver(text, uuid), sessao_terminar(text),
  pessoa_eu(text), membros_listar(text), convite_criar(text, text, text, text),
  convite_cancelar(text, uuid), convite_aceitar(text, text),
  membro_mudar_papel(text, uuid, text), membro_terminar(text, uuid)
  TO eurolify_api;
