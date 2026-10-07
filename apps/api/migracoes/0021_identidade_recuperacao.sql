-- Fatia «identidade», parte B3a: acrescentar e retirar passkeys, as sessões
-- abertas, os códigos de recuperação, recuperar a conta e o registo de
-- entradas (docs/21 §6, §7, §8 e §12; issue #140). Ex.: a Ana perdeu o
-- telemóvel; no Hub de outro computador escreve o e-mail e um dos 10 códigos
-- que guardou, regista uma passkey nova e entra; o código não volta a valer
-- e todas as sessões dela, a do telemóvel perdido incluída, caem.
--
-- O que esta migração faz:
-- - `codigo_recuperacao`: 10 por pessoa, só o resumo sha256 (cada código tem
--   80 bits aleatórios: um resumo rápido chega, docs/21 §12); valem uma vez;
--   gerar outros apaga os antigos;
-- - `entrada`: cada entrada e cada tentativa de recuperação, com o método,
--   o resultado e o IP; sem conta, só o resumo do e-mail tentado (docs/21
--   §6); 14 dias (apaga-os a B4);
-- - limite de tentativas da recuperação: 5 falhas nos últimos 15 minutos,
--   contadas por e-mail (resumo) e por IP (CH; docs/21 §12). A falha regista-se e
--   fica (a função devolve o resultado em vez de levantar um erro, para o
--   registo não se desfazer com a transacção);
-- - os desafios WebAuthn ganham duas finalidades presas a uma pessoa:
--   `acrescentar` (uma passkey numa conta com sessão recente) e `recuperar`
--   (só depois de um código certo);
-- - retirar uma passkey e terminar todas as sessões fazem cair todas as
--   sessões e dão uma nova a quem pediu (§7); a última forma de entrar não
--   se retira;
-- - a conta nova pelo convite passa a guardar os 10 códigos e o registo de
--   entradas passa a ter o IP de quem entra: `conta_nova_com_passkey` e
--   `entrar_com_passkey` mudam de assinatura (DROP e CREATE). A versão
--   anterior da API, se ainda correr, recebe erro nessas duas: as rotas do
--   Hub não estão ligadas em nenhum ambiente (docs/21 §11, HUB_ORIGEM).
--
-- O que não faz (e onde fica): palavra-passe + TOTP (B3b; a regra «a última
-- forma de entrar» passa a contar com elas); as chaves pelo Hub (B3c); apagar
-- as entradas aos 14 dias e os códigos usados (B4).

SET LOCAL lock_timeout = '10s';

-- Retirar uma passkey tem motivo próprio na sessão (revisão do #144, P3-6).
ALTER TABLE sessao DROP CONSTRAINT sessao_revogada_motivo_check;
ALTER TABLE sessao ADD CONSTRAINT sessao_revogada_motivo_check CHECK (
  revogada_motivo IN ('saiu', 'pessoa_desactivada', 'recuperacao',
                      'terminar_todas', 'substituida', 'passkey_retirada'));

ALTER TABLE evento_conta DROP CONSTRAINT evento_conta_acto_check;
ALTER TABLE evento_conta ADD CONSTRAINT evento_conta_acto_check CHECK (acto IN (
  'convite_criado', 'convite_cancelado', 'convite_aceite', 'conta_criada',
  'papel_mudado', 'membro_terminado', 'pessoa_desactivada',
  'passkey_acrescentada', 'passkey_retirada', 'sessoes_terminadas',
  'codigos_gerados', 'recuperou'));

ALTER TABLE desafio_webauthn DROP CONSTRAINT desafio_webauthn_finalidade_check;
ALTER TABLE desafio_webauthn DROP CONSTRAINT desafio_registo_do_convite;
ALTER TABLE desafio_webauthn ADD COLUMN pessoa_id uuid REFERENCES pessoa (id);
ALTER TABLE desafio_webauthn ADD CONSTRAINT desafio_webauthn_finalidade_check
  CHECK (finalidade IN ('entrar', 'registar', 'acrescentar', 'recuperar'));
ALTER TABLE desafio_webauthn ADD CONSTRAINT desafio_registo_do_convite
  CHECK ((finalidade = 'registar') = (convite_id IS NOT NULL));
ALTER TABLE desafio_webauthn ADD CONSTRAINT desafio_da_pessoa
  CHECK ((finalidade IN ('acrescentar', 'recuperar')) = (pessoa_id IS NOT NULL));

CREATE TABLE codigo_recuperacao (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  pessoa_id uuid NOT NULL REFERENCES pessoa (id),
  resumo text NOT NULL CHECK (resumo ~ '^[0-9a-f]{64}$'),
  criado_em timestamptz NOT NULL DEFAULT now(),
  usado_em timestamptz,
  CONSTRAINT codigo_recuperacao_resumo_unico UNIQUE (resumo)
);
CREATE INDEX codigo_recuperacao_por_pessoa ON codigo_recuperacao (pessoa_id);

CREATE TABLE entrada (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  quando timestamptz NOT NULL DEFAULT now(),
  pessoa_id uuid REFERENCES pessoa (id),
  -- Sem conta conhecida: só o resumo do e-mail tentado, nunca o e-mail.
  email_resumo text CHECK (email_resumo ~ '^[0-9a-f]{64}$'),
  metodo text NOT NULL CHECK (metodo IN ('passkey', 'recuperacao')),
  resultado text NOT NULL CHECK (resultado IN ('ok', 'falhou', 'bloqueado')),
  ip inet,
  CONSTRAINT entrada_de_alguem CHECK (pessoa_id IS NOT NULL OR email_resumo IS NOT NULL)
);
CREATE INDEX entrada_por_email ON entrada (email_resumo, quando) WHERE email_resumo IS NOT NULL;
CREATE INDEX entrada_por_data ON entrada (quando);
CREATE INDEX entrada_por_ip ON entrada (ip, quando) WHERE ip IS NOT NULL;

-- Como as outras tabelas das contas (0018): RLS sem políticas, nenhum
-- privilégio à API. A data é sempre da base.
ALTER TABLE codigo_recuperacao ENABLE ROW LEVEL SECURITY;
ALTER TABLE entrada ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON codigo_recuperacao, entrada FROM PUBLIC;

-- Apoio (interna): o resumo do e-mail, sem distinguir maiúsculas.
CREATE FUNCTION email_resumo(p_email text) RETURNS text
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT public.resumo_do_segredo(lower(btrim(coalesce(p_email, ''))))
$$;

-- Apoio (interna): gastar um desafio preso a uma pessoa (acrescentar,
-- recuperar). Uma vez, nos 5 minutos, para a mesma finalidade e pessoa.
CREATE FUNCTION desafio_gastar_da_pessoa(p_resumo text, p_finalidade text, p_pessoa uuid)
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  UPDATE public.desafio_webauthn d SET usado_em = now()
  WHERE d.resumo = p_resumo
    AND d.finalidade = p_finalidade
    AND d.pessoa_id = p_pessoa
    AND d.usado_em IS NULL
    AND d.criado_em > now() - interval '5 minutes';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'auth.unauthenticated: desafio desconhecido, já usado ou expirado';
  END IF;
END
$$;

-- Apoio (interna): guardar uma passkey nova de uma pessoa.
CREATE FUNCTION passkey_guardar(p_pessoa uuid, p_credencial text, p_chave_publica bytea,
                                p_contador bigint, p_transportes text[], p_nome text)
  RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  nova uuid;
BEGIN
  IF p_contador IS NULL OR p_contador NOT BETWEEN 0 AND 4294967295 THEN
    RAISE EXCEPTION 'auth.unauthenticated: contador inválido';
  END IF;
  INSERT INTO public.passkey (pessoa_id, credencial_id, chave_publica, contador,
                              transportes, nome)
  VALUES (p_pessoa, p_credencial, p_chave_publica, p_contador,
          coalesce(p_transportes, '{}'), coalesce(nullif(btrim(p_nome), ''), 'Passkey'))
  RETURNING passkey.id INTO nova;
  RETURN nova;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'passkey.already_registered: esta passkey já está registada';
END
$$;

-- Apoio (interna): 10 resumos de códigos novos para uma pessoa; os antigos
-- (usados ou não) apagam-se.
CREATE FUNCTION codigos_guardar(p_pessoa uuid, p_resumos text[]) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF p_resumos IS NULL OR cardinality(p_resumos) <> 10
     OR (SELECT count(DISTINCT r) FROM unnest(p_resumos) AS r) <> 10 THEN
    RAISE EXCEPTION 'recovery.invalid_codes: são precisos 10 códigos diferentes';
  END IF;
  DELETE FROM public.codigo_recuperacao c WHERE c.pessoa_id = p_pessoa;
  INSERT INTO public.codigo_recuperacao (pessoa_id, resumo)
  SELECT p_pessoa, r FROM unnest(p_resumos) AS r;
END
$$;

-- Apoio (interna): todas as sessões da pessoa caem; nasce uma nova (§7).
-- Tranca a pessoa e, se a troca vem de uma sessão, confirma-a outra vez
-- depois da tranca: um «terminar todas» de uma sessão roubada, ao mesmo
-- tempo que a recuperação, não deixa uma sessão nova viva (revisão do
-- #144, P2-5).
CREATE FUNCTION sessoes_trocar_todas(p_pessoa uuid, p_motivo text, p_resumo_nova text,
                                     p_sessao_de_quem uuid)
  RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM 1 FROM public.pessoa p WHERE p.id = p_pessoa FOR UPDATE;
  IF p_sessao_de_quem IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.sessao x
       WHERE x.id = p_sessao_de_quem AND x.revogada_em IS NULL) THEN
    RAISE EXCEPTION 'auth.unauthenticated: a sessão já foi revogada';
  END IF;
  UPDATE public.sessao s SET revogada_motivo = p_motivo
  WHERE s.pessoa_id = p_pessoa AND s.revogada_em IS NULL;
  RETURN public.sessao_nova(p_pessoa, p_resumo_nova);
END
$$;

-- Apoio (interna): a sessão válida com autenticação recente (10 minutos).
CREATE FUNCTION sessao_recente(p_segredo text) RETURNS public.sessao
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  s public.sessao;
BEGIN
  s := public.sessao_valida(p_segredo);
  IF s.autenticada_em <= now() - interval '10 minutes' THEN
    RAISE EXCEPTION 'auth.reauthentication_required: autentique-se outra vez para esta operação';
  END IF;
  RETURN s;
END
$$;

-- As portas da API.

-- Entrar (substitui a da 0020): regista a entrada com o IP.
DROP FUNCTION entrar_com_passkey(text, uuid, bigint, text);
CREATE FUNCTION entrar_com_passkey(p_desafio text, p_passkey uuid, p_contador bigint,
                                   p_resumo_sessao text, p_ip inet)
  RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  pessoa uuid;
BEGIN
  PERFORM public.desafio_gastar(p_desafio, 'entrar', NULL);
  pessoa := public.passkey_usar(p_passkey, p_contador);
  INSERT INTO public.entrada (pessoa_id, metodo, resultado, ip)
  VALUES (pessoa, 'passkey', 'ok', p_ip);
  RETURN public.sessao_nova(pessoa, p_resumo_sessao);
END
$$;

-- Conta nova pelo convite (substitui a da 0020): guarda também os 10
-- códigos de recuperação (§4.2, ponto 3).
DROP FUNCTION conta_nova_com_passkey(text, text, text, text, bytea, bigint, text[], text, text);
CREATE FUNCTION conta_nova_com_passkey(p_desafio text, p_segredo_convite text, p_nome text,
                                       p_credencial text, p_chave_publica bytea,
                                       p_contador bigint, p_transportes text[],
                                       p_nome_passkey text, p_resumo_sessao text,
                                       p_resumos_codigos text[], p_ip inet)
  RETURNS TABLE (pessoa_id uuid, comerciante_id uuid, sessao_id uuid)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  nova record;
BEGIN
  PERFORM public.desafio_gastar(p_desafio, 'registar', p_segredo_convite);
  SELECT * INTO nova FROM public.convite_aceitar_conta_nova(p_segredo_convite, p_nome);
  PERFORM public.passkey_guardar(nova.pessoa_id, p_credencial, p_chave_publica,
                                 p_contador, p_transportes, p_nome_passkey);
  PERFORM public.codigos_guardar(nova.pessoa_id, p_resumos_codigos);
  INSERT INTO public.entrada (pessoa_id, metodo, resultado, ip)
  VALUES (nova.pessoa_id, 'passkey', 'ok', p_ip);
  RETURN QUERY SELECT nova.pessoa_id, nova.comerciante_id,
                      public.sessao_nova(nova.pessoa_id, p_resumo_sessao);
END
$$;

-- As passkeys da pessoa da sessão.
CREATE FUNCTION passkeys_listar(p_segredo text) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  s public.sessao;
BEGIN
  s := public.sessao_valida(p_segredo);
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'passkey', k.id, 'nome', k.nome, 'criada_em', k.criada_em,
             'ultimo_uso_em', k.ultimo_uso_em)
           ORDER BY k.criada_em, k.id)
    FROM public.passkey k WHERE k.pessoa_id = s.pessoa_id), '[]'::jsonb);
END
$$;

-- Desafio para acrescentar uma passkey (sessão recente). Devolve o e-mail e
-- as credenciais que a pessoa já tem, para o navegador não as repetir.
CREATE FUNCTION desafio_criar_acrescentar(p_resumo text, p_segredo_sessao text)
  RETURNS TABLE (email text, credenciais text[])
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  s public.sessao;
BEGIN
  s := public.sessao_recente(p_segredo_sessao);
  PERFORM public.desafio_arrumar();
  INSERT INTO public.desafio_webauthn (resumo, finalidade, pessoa_id)
  VALUES (p_resumo, 'acrescentar', s.pessoa_id);
  RETURN QUERY
    SELECT p.email, coalesce(array_agg(k.credencial_id ORDER BY k.criada_em)
                             FILTER (WHERE k.id IS NOT NULL), '{}')
    FROM public.pessoa p LEFT JOIN public.passkey k ON k.pessoa_id = p.id
    WHERE p.id = s.pessoa_id
    GROUP BY p.email;
END
$$;

-- Acrescentar uma passkey à conta da sessão (recente).
CREATE FUNCTION passkey_acrescentar(p_desafio text, p_segredo_sessao text,
                                    p_credencial text, p_chave_publica bytea,
                                    p_contador bigint, p_transportes text[], p_nome text)
  RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  s public.sessao;
  nova uuid;
BEGIN
  s := public.sessao_recente(p_segredo_sessao);
  PERFORM public.desafio_gastar_da_pessoa(p_desafio, 'acrescentar', s.pessoa_id);
  nova := public.passkey_guardar(s.pessoa_id, p_credencial, p_chave_publica,
                                 p_contador, p_transportes, p_nome);
  INSERT INTO public.evento_conta (acto, pessoa_id, quem)
  VALUES ('passkey_acrescentada', s.pessoa_id, 'pessoa:per_' || s.pessoa_id::text);
  RETURN nova;
END
$$;

-- Retirar uma passkey da conta da sessão (recente). Nunca a última forma de
-- entrar. Todas as sessões caem e nasce uma nova para quem pediu (§7).
CREATE FUNCTION passkey_retirar(p_segredo_sessao text, p_passkey uuid, p_resumo_nova text)
  RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  s public.sessao;
BEGIN
  s := public.sessao_recente(p_segredo_sessao);
  -- Duas retiradas ao mesmo tempo não deixam a pessoa sem passkey.
  PERFORM 1 FROM public.pessoa p WHERE p.id = s.pessoa_id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM public.passkey k
                 WHERE k.id = p_passkey AND k.pessoa_id = s.pessoa_id) THEN
    RAISE EXCEPTION 'passkey.not_found: a passkey não existe nesta conta';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.passkey k
                 WHERE k.pessoa_id = s.pessoa_id AND k.id <> p_passkey) THEN
    RAISE EXCEPTION 'passkey.last_credential: é a última forma de entrar; acrescente outra antes';
  END IF;
  DELETE FROM public.passkey k WHERE k.id = p_passkey;
  INSERT INTO public.evento_conta (acto, pessoa_id, quem)
  VALUES ('passkey_retirada', s.pessoa_id, 'pessoa:per_' || s.pessoa_id::text);
  RETURN public.sessoes_trocar_todas(s.pessoa_id, 'passkey_retirada', p_resumo_nova, s.id);
END
$$;

-- As sessões abertas da pessoa da sessão.
CREATE FUNCTION sessoes_listar(p_segredo text) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  s public.sessao;
BEGIN
  s := public.sessao_valida(p_segredo);
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'sessao', x.id, 'criada_em', x.criada_em,
             'ultimo_uso_em', x.ultimo_uso_em, 'esta', x.id = s.id)
           ORDER BY x.criada_em, x.id)
    FROM public.sessao x
    WHERE x.pessoa_id = s.pessoa_id AND x.revogada_em IS NULL
      AND x.ultimo_uso_em > now() - interval '12 hours'
      AND x.criada_em > now() - interval '30 days'), '[]'::jsonb);
END
$$;

-- Terminar todas as sessões (recente); nasce uma nova para quem pediu.
CREATE FUNCTION sessoes_terminar_todas(p_segredo_sessao text, p_resumo_nova text)
  RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  s public.sessao;
BEGIN
  s := public.sessao_recente(p_segredo_sessao);
  INSERT INTO public.evento_conta (acto, pessoa_id, quem)
  VALUES ('sessoes_terminadas', s.pessoa_id, 'pessoa:per_' || s.pessoa_id::text);
  RETURN public.sessoes_trocar_todas(s.pessoa_id, 'terminar_todas', p_resumo_nova, s.id);
END
$$;

-- Gerar 10 códigos de recuperação novos (recente); os antigos deixam de
-- valer.
CREATE FUNCTION codigos_gerar(p_segredo_sessao text, p_resumos text[]) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  s public.sessao;
BEGIN
  s := public.sessao_recente(p_segredo_sessao);
  PERFORM public.codigos_guardar(s.pessoa_id, p_resumos);
  INSERT INTO public.evento_conta (acto, pessoa_id, quem)
  VALUES ('codigos_gerados', s.pessoa_id, 'pessoa:per_' || s.pessoa_id::text);
END
$$;

-- Recuperar, passo 1: e-mail + código. Devolve 'ok' (e guarda o desafio de
-- registo preso à pessoa), 'falhou' ou 'bloqueado'; regista as falhas e os
-- bloqueios (o êxito regista-se no passo 2). Não levanta erro de propósito:
-- a falha tem de ficar registada para contar no limite — 5 falhas nos
-- últimos 15 minutos, por e-mail e por IP, numa janela que desliza (CH). O
-- código não se gasta aqui; só no passo 2, com a passkey nova.
CREATE FUNCTION recuperacao_iniciar(p_resumo_desafio text, p_email text,
                                    p_resumo_codigo text, p_ip inet)
  RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  tentado text := public.email_resumo(p_email);
  pessoa uuid;
  falhas_email bigint;
  falhas_ip bigint;
BEGIN
  -- Uma tentativa de cada vez por e-mail e por IP (por esta ordem, sempre):
  -- a contagem e o registo não se cruzam.
  PERFORM pg_advisory_xact_lock(hashtextextended('recuperacao:' || tentado, 0));
  IF p_ip IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('recuperacao-ip:' || host(p_ip), 0));
  END IF;
  SELECT count(*) INTO falhas_email FROM public.entrada e
  WHERE e.email_resumo = tentado AND e.metodo = 'recuperacao'
    AND e.resultado = 'falhou' AND e.quando > now() - interval '15 minutes';
  SELECT count(*) INTO falhas_ip FROM public.entrada e
  WHERE p_ip IS NOT NULL AND e.ip = p_ip AND e.metodo = 'recuperacao'
    AND e.resultado = 'falhou' AND e.quando > now() - interval '15 minutes';
  -- O limite conta por e-mail e por IP (Diogo, 07/10/2026: «fica a a)»;
  -- CH; revisão do #144, P2-2): um IP com 5 falhas fica bloqueado para
  -- qualquer e-mail; um e-mail com 5 falhas só bloqueia quem também falhou
  -- desse IP (ou quem chega sem IP). Quem sabe o e-mail da Ana não lhe
  -- bloqueia a recuperação a partir de outro IP.
  IF falhas_ip >= 5 OR (falhas_email >= 5 AND (p_ip IS NULL OR falhas_ip > 0)) THEN
    INSERT INTO public.entrada (email_resumo, metodo, resultado, ip)
    VALUES (tentado, 'recuperacao', 'bloqueado', p_ip);
    RETURN 'bloqueado';
  END IF;
  SELECT p.id INTO pessoa
  FROM public.pessoa p JOIN public.codigo_recuperacao c ON c.pessoa_id = p.id
  WHERE lower(p.email) = lower(btrim(coalesce(p_email, '')))
    AND p.estado = 'activa'
    AND c.resumo = p_resumo_codigo
    AND c.usado_em IS NULL;
  IF pessoa IS NULL THEN
    INSERT INTO public.entrada (email_resumo, metodo, resultado, ip)
    VALUES (tentado, 'recuperacao', 'falhou', p_ip);
    RETURN 'falhou';
  END IF;
  PERFORM public.desafio_arrumar();
  INSERT INTO public.desafio_webauthn (resumo, finalidade, pessoa_id)
  VALUES (p_resumo_desafio, 'recuperar', pessoa);
  RETURN 'ok';
END
$$;

-- Recuperar, passo 2: o desafio do passo 1 decide a pessoa — sem ele, o
-- código nem se lê (revisão do #144, P2-1: o passo 2 não serve para
-- experimentar códigos fora do limite). Depois o código dessa pessoa
-- gasta-se, a passkey nova entra, todas as sessões caem e nasce uma (§7).
CREATE FUNCTION recuperacao_concluir(p_desafio text, p_email text, p_resumo_codigo text,
                                     p_credencial text, p_chave_publica bytea,
                                     p_contador bigint, p_transportes text[],
                                     p_nome_passkey text, p_resumo_sessao text, p_ip inet)
  RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  pessoa uuid;
  codigo uuid;
BEGIN
  UPDATE public.desafio_webauthn d SET usado_em = now()
  WHERE d.resumo = p_desafio
    AND d.finalidade = 'recuperar'
    AND d.usado_em IS NULL
    AND d.criado_em > now() - interval '5 minutes'
  RETURNING d.pessoa_id INTO pessoa;
  IF pessoa IS NULL THEN
    RAISE EXCEPTION 'auth.unauthenticated: desafio desconhecido, já usado ou expirado';
  END IF;
  -- O código dessa pessoa, com o e-mail dela, trancado: dois passos 2 ao
  -- mesmo tempo, só um passa.
  SELECT c.id INTO codigo
  FROM public.codigo_recuperacao c JOIN public.pessoa p ON p.id = c.pessoa_id
  WHERE c.pessoa_id = pessoa
    AND lower(p.email) = lower(btrim(coalesce(p_email, '')))
    AND p.estado = 'activa'
    AND c.resumo = p_resumo_codigo
    AND c.usado_em IS NULL
  FOR UPDATE OF c;
  IF codigo IS NULL THEN
    RAISE EXCEPTION 'auth.unauthenticated: código desconhecido ou já usado';
  END IF;
  UPDATE public.codigo_recuperacao c SET usado_em = now() WHERE c.id = codigo;
  PERFORM public.passkey_guardar(pessoa, p_credencial, p_chave_publica, p_contador,
                                 p_transportes, p_nome_passkey);
  INSERT INTO public.entrada (pessoa_id, metodo, resultado, ip)
  VALUES (pessoa, 'recuperacao', 'ok', p_ip);
  INSERT INTO public.evento_conta (acto, pessoa_id, quem)
  VALUES ('recuperou', pessoa, 'pessoa:per_' || pessoa::text);
  PERFORM public.sessoes_trocar_todas(pessoa, 'recuperacao', p_resumo_sessao, NULL);
  RETURN pessoa;
END
$$;

REVOKE ALL ON FUNCTION email_resumo(text), desafio_gastar_da_pessoa(text, text, uuid),
  passkey_guardar(uuid, text, bytea, bigint, text[], text),
  codigos_guardar(uuid, text[]), sessoes_trocar_todas(uuid, text, text, uuid),
  sessao_recente(text),
  entrar_com_passkey(text, uuid, bigint, text, inet),
  conta_nova_com_passkey(text, text, text, text, bytea, bigint, text[], text, text, text[], inet),
  passkeys_listar(text), desafio_criar_acrescentar(text, text),
  passkey_acrescentar(text, text, text, bytea, bigint, text[], text),
  passkey_retirar(text, uuid, text), sessoes_listar(text),
  sessoes_terminar_todas(text, text), codigos_gerar(text, text[]),
  recuperacao_iniciar(text, text, text, inet),
  recuperacao_concluir(text, text, text, text, bytea, bigint, text[], text, text, inet)
  FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  entrar_com_passkey(text, uuid, bigint, text, inet),
  conta_nova_com_passkey(text, text, text, text, bytea, bigint, text[], text, text, text[], inet),
  passkeys_listar(text), desafio_criar_acrescentar(text, text),
  passkey_acrescentar(text, text, text, bytea, bigint, text[], text),
  passkey_retirar(text, uuid, text), sessoes_listar(text),
  sessoes_terminar_todas(text, text), codigos_gerar(text, text[]),
  recuperacao_iniciar(text, text, text, inet),
  recuperacao_concluir(text, text, text, text, bytea, bigint, text[], text, text, inet)
  TO eurolify_api;
