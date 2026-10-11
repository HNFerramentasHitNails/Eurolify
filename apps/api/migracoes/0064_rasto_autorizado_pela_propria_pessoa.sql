-- O rasto de auditoria: quem autorizou, quando a pessoa age ela própria
-- numa rota pública (issue #322; Diogo, 11/10/2026: «confirmo»).
-- Ex.: a Ana cria a conta pelo convite; o evento «conta_criada» ficava com
-- «autorizado por» vazio — «sem autorização de uma pessoa» (Q5) — quando foi
-- ela a criá-la. Passa a ficar `pessoa:per_<Ana>`.
--
-- Nas rotas públicas não há sessão: a API não sabe quem é a pessoa e não põe
-- `eurolify.autorizado_por`. A API verifica o registo da passkey
-- (`verificarRegisto`, com a verificação da pessoa pedida ao dispositivo);
-- a base confere o convite ou o código de recuperação e gasta o desafio.
-- Nesse ponto a função põe a própria pessoa como quem autorizou, só para o
-- resto da transacção. Se o pedido falhar depois, a transacção desfaz-se e
-- nada fica (só quando a operação termina bem).
--
-- Como na sessão do Hub (`docs/28` §3.2; revisão do #334, P3-1): com uma IA
-- declarada no pedido, não fica ninguém como quem autorizou (revisão do
-- #364, P2-1).
--
-- Limite (revisão do #364, P3-1): quem tiver o link do convite, ou o código
-- e o e-mail, fica registado como a própria pessoa — é a mesma prova que já
-- abre a conta.
--
-- O que muda (as assinaturas e o resto dos corpos ficam iguais):
-- - `rasto_autorizado_pela_propria(pessoa)`: nova, interna; com IA declarada
--   não põe ninguém; recusa se já estiver posta outra pessoa;
-- - `convite_aceitar_conta_nova()` (corpo da 0018): «conta_criada» e
--   «convite_aceite»;
-- - `recuperacao_concluir()` (corpo da 0022): «recuperou» e as sessões
--   trocadas.
--
-- Não muda: as linhas já gravadas; as rotas com sessão (a API já põe a
-- pessoa); a entrada com palavra-passe ou passkey, que não escreve no rasto
-- (só na tabela `entrada`).

SET LOCAL lock_timeout = '10s';

CREATE FUNCTION rasto_autorizado_pela_propria(p_pessoa uuid) RETURNS void
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  ja text := nullif(btrim(current_setting('eurolify.autorizado_por', true)), '');
  pessoa text;
BEGIN
  IF p_pessoa IS NULL THEN
    RAISE EXCEPTION 'rasto: falta a pessoa que autoriza';
  END IF;
  pessoa := 'pessoa:per_' || p_pessoa::text;
  -- Outra pessoa já posta como quem autorizou: não se troca em silêncio
  -- (revisão do #364, P3-2).
  IF ja IS NOT NULL AND ja <> pessoa THEN
    RAISE EXCEPTION 'rasto: o pedido já tem outra pessoa como quem autorizou';
  END IF;
  -- Com uma IA declarada, não prova que a pessoa confirmou (§3.2).
  IF nullif(btrim(current_setting('eurolify.ia', true)), '') IS NOT NULL THEN
    RETURN;
  END IF;
  PERFORM set_config('eurolify.autorizado_por', pessoa, true);
END
$$;

REVOKE ALL ON FUNCTION rasto_autorizado_pela_propria(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION convite_aceitar_conta_nova(p_segredo_convite text, p_nome text)
  RETURNS TABLE (pessoa_id uuid, comerciante_id uuid, membro_id uuid)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  c public.convite;
  nova uuid;
BEGIN
  c := public.convite_em_aberto(p_segredo_convite);
  IF p_nome IS NULL OR length(btrim(p_nome)) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'person.invalid_name: o nome tem de ter entre 1 e 100 caracteres';
  END IF;
  IF EXISTS (SELECT 1 FROM public.pessoa p WHERE lower(p.email) = lower(c.email)) THEN
    RAISE EXCEPTION 'invite.account_exists: já há uma conta com este e-mail; entre nela para aceitar';
  END IF;
  BEGIN
    INSERT INTO public.pessoa (email, nome) VALUES (c.email, btrim(p_nome))
    RETURNING pessoa.id INTO nova;
  EXCEPTION WHEN unique_violation THEN
    -- Outra conta com o mesmo e-mail nasceu ao mesmo tempo (revisão do #141,
    -- P3-4).
    RAISE EXCEPTION 'invite.account_exists: já há uma conta com este e-mail; entre nela para aceitar';
  END;
  -- A pessoa provou quem é no próprio pedido (o convite e a passkey com a
  -- verificação dela): autoriza o que faz a seguir (0064).
  PERFORM public.rasto_autorizado_pela_propria(nova);
  INSERT INTO public.evento_conta (acto, comerciante_id, pessoa_id, convite_id, quem)
  VALUES ('conta_criada', c.comerciante_id, nova, c.id, 'pessoa:per_' || nova::text);
  RETURN QUERY SELECT nova, c.comerciante_id, public.convite_concluir(c, nova);
END
$$;

CREATE OR REPLACE FUNCTION recuperacao_concluir(p_desafio text, p_email text, p_resumo_codigo text,
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
  -- A pessoa provou quem é no próprio pedido (o código e a passkey nova com a
  -- verificação dela): autoriza a recuperação (0064).
  PERFORM public.rasto_autorizado_pela_propria(pessoa);
  INSERT INTO public.evento_conta (acto, pessoa_id, quem)
  VALUES ('recuperou', pessoa, 'pessoa:per_' || pessoa::text);
  PERFORM public.sessoes_trocar_todas(pessoa, 'recuperacao', p_resumo_sessao, NULL);
  RETURN pessoa;
END
$$;
