-- Fatia «identidade», parte B4: a tarefa dos prazos das contas de pessoas
-- (docs/21 §6 e §13; decisão CD; issue #140). Ex.: a «Ana» sai da última
-- equipa a 1 de Março; a limpeza de 31 de Maio (90 dias depois) troca-lhe o
-- e-mail por `pseudonimo+<id>@eurolify.invalid`, o nome por «Pessoa
-- pseudonimizada», apaga as passkeys, a palavra-passe e os códigos; o rasto
-- fica com `per_<id>`, que já não leva a ninguém.
--
-- O que esta migração faz:
-- - `contas_aplicar_prazos()`: apaga as entradas com mais de 14 dias, os
--   códigos de recuperação usados, os desafios usados ou velhos, as
--   palavras-passe pendentes com mais de 1 dia e as sessões acabadas há mais
--   de 30 dias; pseudonimiza o e-mail dos convites 30 dias depois do fim e as
--   pessoas 90 dias depois de saírem do último comerciante (CD). Devolve
--   quantas tratou, por categoria;
-- - `contas_prazos_em_atraso()`: o que a tarefa devia ter tratado há mais de
--   um dia, para a verificação das 07:00 (P-T17);
-- - os gatilhos (0018) passam a deixar apagar uma sessão e pseudonimizar um
--   convite ou uma pessoa **só quando o prazo passou**: a regra mora na
--   tabela, e um erro noutra função não apaga cedo demais.
-- - depois da revisão do #152: um gatilho recusa uma credencial ou sessão
--   nova para uma pessoa pseudonimizada (P2-1); cada pessoa trata-se numa
--   subtransacção e um impasse adia só essa pessoa (P2-2); o fim de uma
--   sessão ou de um convite é o que vier primeiro (P3-1).
--
-- Quem chama as duas funções é o papel `eurolify_limpeza` (0013), pelo
-- programa `eurolify-limpeza` da VPS. São SECURITY DEFINER (correm como o
-- dono das tabelas): o papel da limpeza só recebe o EXECUTE delas, nenhum
-- privilégio nas tabelas das contas. A API não as pode chamar.

SET LOCAL lock_timeout = '10s';

ALTER TABLE pessoa ADD COLUMN pseudonimizada_em timestamptz;
ALTER TABLE pessoa ADD CONSTRAINT pessoa_pseudonimizada_desactivada
  CHECK (pseudonimizada_em IS NULL OR estado = 'desactivada');

ALTER TABLE evento_conta DROP CONSTRAINT evento_conta_acto_check;
ALTER TABLE evento_conta ADD CONSTRAINT evento_conta_acto_check CHECK (acto IN (
  'convite_criado', 'convite_cancelado', 'convite_aceite', 'conta_criada',
  'papel_mudado', 'membro_terminado', 'pessoa_desactivada',
  'passkey_acrescentada', 'passkey_retirada', 'sessoes_terminadas',
  'codigos_gerados', 'recuperou', 'palavra_passe_activada',
  'palavra_passe_retirada', 'pessoa_pseudonimizada'));

-- Apoio (interna): o e-mail que substitui o verdadeiro. O domínio `.invalid`
-- está reservado e nunca recebe correio (RFC 2606 §2).
CREATE FUNCTION pseudonimo(p_id uuid) RETURNS text
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT 'pseudonimo+' || p_id::text || '@eurolify.invalid'
$$;

-- Apoio (interna): quando acabou uma sessão — revogada, ou expirada (12 h sem
-- uso ou 30 dias desde a criação, a regra do `sessao_valida`, 0018).
CREATE FUNCTION sessao_fim(s public.sessao) RETURNS timestamptz
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  -- O que vier primeiro: uma sessão já expirada que se revoga depois (um
  -- «terminar todas») acabou na expiração (revisão do #152, P3-1). O least
  -- ignora o NULL.
  SELECT least(s.revogada_em,
               s.ultimo_uso_em + interval '12 hours',
               s.criada_em + interval '30 days')
$$;

-- Apoio (interna): a pessoa não tem nenhum membro activo e saiu do último
-- comerciante há mais de `p_prazo` (sem membros, conta a criação).
CREATE FUNCTION pessoa_saiu_ha(p_pessoa uuid, p_criada timestamptz, p_prazo interval)
  RETURNS boolean
  LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.membro m
                     WHERE m.pessoa_id = p_pessoa AND m.ate IS NULL)
     AND coalesce((SELECT max(m.ate) FROM public.membro m WHERE m.pessoa_id = p_pessoa),
                  p_criada) < now() - p_prazo
$$;

-- Apoio (interna): quando acabou um convite (aceite, cancelado ou expirado,
-- o que vier primeiro).
CREATE FUNCTION convite_fim(x public.convite) RETURNS timestamptz
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  -- Um convite cancelado depois de expirar acabou na expiração (revisão do
  -- #152, P3-1).
  SELECT least(coalesce(x.aceite_em, x.cancelado_em), x.expira_em)
$$;

-- Os gatilhos da 0018, com as três excepções dos prazos (o resto igual).
CREATE OR REPLACE FUNCTION pessoas_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Uma sessão apaga-se 30 dias depois de acabar (docs/21 §6); o resto
    -- não se apaga: pseudonimiza-se.
    -- (Dois IF: numa só expressão, o OLD de outra tabela não tem o tipo
    -- `sessao` e a chamada falha.)
    IF TG_TABLE_NAME = 'sessao' THEN
      IF public.sessao_fim(OLD) < now() - interval '30 days' THEN
        RETURN OLD;
      END IF;
    END IF;
    RAISE EXCEPTION 'account.immutable: % não se apaga', TG_TABLE_NAME;
  END IF;
  IF TG_TABLE_NAME = 'pessoa' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.criada_em := now();
      NEW.estado := 'activa';
      NEW.desactivada_em := NULL;
      NEW.pseudonimizada_em := NULL;
    ELSIF OLD.pseudonimizada_em IS NOT NULL THEN
      RAISE EXCEPTION 'account.immutable: uma pessoa pseudonimizada não muda';
    ELSIF NEW.pseudonimizada_em IS NOT NULL THEN
      -- Pseudonimizar (CD): só para o pseudónimo, e só com o prazo cumprido.
      IF NEW.id <> OLD.id OR NEW.criada_em <> OLD.criada_em
         OR NEW.email <> public.pseudonimo(OLD.id)
         OR NEW.nome <> 'Pessoa pseudonimizada'
         OR NEW.estado <> 'desactivada' THEN
        RAISE EXCEPTION 'account.immutable: pseudonimizar só troca o e-mail e o nome pelos do pseudónimo';
      END IF;
      IF NOT public.pessoa_saiu_ha(OLD.id, OLD.criada_em, interval '90 days') THEN
        RAISE EXCEPTION 'account.retention: a pessoa ainda está no prazo (90 dias depois de sair do último comerciante)';
      END IF;
      NEW.pseudonimizada_em := now();
      NEW.desactivada_em := coalesce(OLD.desactivada_em, now());
    ELSIF NEW.id <> OLD.id OR NEW.criada_em <> OLD.criada_em
          OR NEW.email <> OLD.email THEN
      RAISE EXCEPTION 'account.immutable: o e-mail e a identidade de uma pessoa não mudam';
    ELSIF OLD.estado = 'desactivada' AND NEW.estado <> 'desactivada' THEN
      RAISE EXCEPTION 'account.immutable: uma pessoa desactivada não volta';
    ELSIF OLD.estado = 'activa' AND NEW.estado = 'desactivada' THEN
      NEW.desactivada_em := now();
    ELSE
      NEW.desactivada_em := OLD.desactivada_em;
    END IF;
  ELSIF TG_TABLE_NAME = 'membro' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.desde := now();
      NEW.ate := NULL;
      NEW.terminado_por := NULL;
    ELSIF (NEW.id, NEW.comerciante_id, NEW.pessoa_id, NEW.desde, NEW.convidado_por)
          IS DISTINCT FROM (OLD.id, OLD.comerciante_id, OLD.pessoa_id, OLD.desde, OLD.convidado_por) THEN
      RAISE EXCEPTION 'account.immutable: um membro não muda de pessoa nem de comerciante';
    ELSIF OLD.ate IS NOT NULL THEN
      RAISE EXCEPTION 'account.immutable: um membro que saiu não muda; convida-se outra vez';
    ELSIF NEW.terminado_por IS NOT NULL THEN
      NEW.ate := now();
    END IF;
  ELSIF TG_TABLE_NAME = 'convite' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.criado_em := now();
      NEW.expira_em := now() + interval '7 days';
      NEW.aceite_em := NULL;
      NEW.aceite_por := NULL;
      NEW.cancelado_em := NULL;
      NEW.cancelado_por := NULL;
    ELSIF NEW.email IS DISTINCT FROM OLD.email
          AND NEW.email = public.pseudonimo(OLD.id)
          AND (NEW.id, NEW.comerciante_id, NEW.papel, NEW.resumo, NEW.convidado_por,
               NEW.criado_em, NEW.expira_em, NEW.aceite_em, NEW.aceite_por,
               NEW.cancelado_em, NEW.cancelado_por)
          IS NOT DISTINCT FROM
              (OLD.id, OLD.comerciante_id, OLD.papel, OLD.resumo, OLD.convidado_por,
               OLD.criado_em, OLD.expira_em, OLD.aceite_em, OLD.aceite_por,
               OLD.cancelado_em, OLD.cancelado_por) THEN
      -- Pseudonimizar o e-mail de um convite: 30 dias depois do fim (§6).
      IF public.convite_fim(OLD) >= now() - interval '30 days' THEN
        RAISE EXCEPTION 'account.retention: o convite ainda está no prazo (30 dias depois do fim)';
      END IF;
    ELSIF (NEW.id, NEW.comerciante_id, NEW.email, NEW.papel, NEW.resumo,
           NEW.convidado_por, NEW.criado_em, NEW.expira_em)
          IS DISTINCT FROM (OLD.id, OLD.comerciante_id, OLD.email, OLD.papel, OLD.resumo,
           OLD.convidado_por, OLD.criado_em, OLD.expira_em) THEN
      RAISE EXCEPTION 'account.immutable: um convite não se altera; cancela-se e cria-se outro';
    ELSIF OLD.aceite_em IS NOT NULL OR OLD.cancelado_em IS NOT NULL THEN
      RAISE EXCEPTION 'invite.used: o convite já foi aceite ou cancelado';
    ELSIF NEW.aceite_por IS NOT NULL THEN
      NEW.aceite_em := now();
    ELSIF NEW.cancelado_por IS NOT NULL THEN
      NEW.cancelado_em := now();
    END IF;
  ELSIF TG_TABLE_NAME = 'sessao' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.criada_em := now();
      NEW.ultimo_uso_em := now();
      NEW.autenticada_em := now();
      NEW.revogada_em := NULL;
      NEW.revogada_motivo := NULL;
    ELSIF (NEW.id, NEW.pessoa_id, NEW.resumo, NEW.criada_em)
          IS DISTINCT FROM (OLD.id, OLD.pessoa_id, OLD.resumo, OLD.criada_em) THEN
      RAISE EXCEPTION 'account.immutable: uma sessão não muda de pessoa nem de segredo';
    ELSIF OLD.revogada_em IS NOT NULL THEN
      RAISE EXCEPTION 'account.immutable: uma sessão revogada não volta';
    ELSIF NEW.revogada_motivo IS NOT NULL THEN
      NEW.revogada_em := now();
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- Nada de novo para uma pessoa pseudonimizada (revisão do #152, P2-1): as
-- funções da API conferem a sessão e só depois gravam; se a limpeza
-- pseudonimiza a pessoa nesse intervalo, uma passkey, uma palavra-passe, um
-- código ou uma sessão gravados a seguir ficavam para sempre. O FOR SHARE
-- espera pela limpeza e relê a pessoa já pseudonimizada.
CREATE FUNCTION credencial_de_pessoa_viva() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM 1 FROM public.pessoa p
  WHERE p.id = NEW.pessoa_id AND p.pseudonimizada_em IS NULL
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'auth.unauthenticated: a pessoa foi pseudonimizada';
  END IF;
  RETURN NEW;
END
$$;

DO $$
DECLARE
  tabela text;
BEGIN
  FOREACH tabela IN ARRAY ARRAY['passkey', 'palavra_passe', 'codigo_recuperacao', 'sessao'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT ON %I
                    FOR EACH ROW EXECUTE FUNCTION credencial_de_pessoa_viva()',
                   tabela || '_de_pessoa_viva', tabela);
    EXECUTE format('ALTER TABLE %I ENABLE ALWAYS TRIGGER %I', tabela, tabela || '_de_pessoa_viva');
  END LOOP;
END
$$;

-- A tarefa diária (eurolify-limpeza, 05:00 UTC). Uma pessoa trancada por um
-- pedido em curso fica para o dia seguinte (SKIP LOCKED); as condições
-- conferem-se outra vez depois da tranca. Aceitar um convite tranca a pessoa
-- com FOR SHARE e só aceita uma pessoa `activa` (0018): ou aceita antes e a
-- pessoa tem um membro activo, ou espera e encontra-a desactivada.
CREATE FUNCTION contas_aplicar_prazos()
  RETURNS TABLE (o_que text, quantas integer)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  n integer;
  alvo record;
  pessoas integer := 0;
  adiadas integer := 0;
  espera_antes text;
BEGIN
  -- Em lotes de até 50 000 por corrida (revisão do Codex no #152): um
  -- ataque enche o registo de entradas, e apagar tudo de uma vez podia
  -- passar os 5 minutos da limpeza e desfazer a corrida todos os dias. O
  -- resto fica para o dia seguinte, e a verificação das 07:00 avisa se se
  -- acumular.
  DELETE FROM public.entrada e WHERE e.id IN (
    SELECT x.id FROM public.entrada x
    WHERE x.quando < now() - interval '14 days' LIMIT 50000);
  GET DIAGNOSTICS n = ROW_COUNT;
  o_que := 'entradas'; quantas := n; RETURN NEXT;

  DELETE FROM public.codigo_recuperacao c WHERE c.usado_em IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  o_que := 'codigos_usados'; quantas := n; RETURN NEXT;

  -- A mesma regra do desafio_arrumar (0020), sem o tecto.
  DELETE FROM public.desafio_webauthn d
  WHERE d.usado_em IS NOT NULL OR d.criado_em < now() - interval '5 minutes';
  GET DIAGNOSTICS n = ROW_COUNT;
  o_que := 'desafios'; quantas := n; RETURN NEXT;

  DELETE FROM public.palavra_passe w
  WHERE w.estado = 'pendente' AND w.criada_em < now() - interval '1 day';
  GET DIAGNOSTICS n = ROW_COUNT;
  o_que := 'palavras_passe_pendentes'; quantas := n; RETURN NEXT;

  -- Cada pessoa numa subtransacção, com espera curta pelas trancas (revisão
  -- do #152, P2-2): uma entrada com passkey tranca a passkey e depois a
  -- pessoa, a limpeza ao contrário. Um impasse ou uma espera longa adiam só
  -- essa pessoa para o dia seguinte, sem desfazer o resto da corrida.
  espera_antes := current_setting('lock_timeout');
  PERFORM set_config('lock_timeout', '2s', true);
  FOR alvo IN SELECT x.id, x.criada_em FROM public.pessoa x
              WHERE x.pseudonimizada_em IS NULL
                AND public.pessoa_saiu_ha(x.id, x.criada_em, interval '90 days')
              ORDER BY x.id
              FOR UPDATE SKIP LOCKED LOOP
    -- Releitura depois da tranca: um membro novo entretanto faz saltar.
    CONTINUE WHEN NOT public.pessoa_saiu_ha(alvo.id, alvo.criada_em, interval '90 days');
    BEGIN
      DELETE FROM public.passkey k WHERE k.pessoa_id = alvo.id;
      DELETE FROM public.palavra_passe w WHERE w.pessoa_id = alvo.id;
      DELETE FROM public.codigo_recuperacao c WHERE c.pessoa_id = alvo.id;
      DELETE FROM public.desafio_webauthn d WHERE d.pessoa_id = alvo.id;
      UPDATE public.sessao s SET revogada_motivo = 'pessoa_desactivada'
      WHERE s.pessoa_id = alvo.id AND s.revogada_em IS NULL
        AND public.sessao_fim(s) > now();
      UPDATE public.pessoa p
      SET email = public.pseudonimo(p.id), nome = 'Pessoa pseudonimizada',
          estado = 'desactivada', pseudonimizada_em = now()
      WHERE p.id = alvo.id;
      INSERT INTO public.evento_conta (acto, pessoa_id, quem)
      VALUES ('pessoa_pseudonimizada', alvo.id, 'sistema:prazos');
      pessoas := pessoas + 1;
    EXCEPTION WHEN deadlock_detected OR lock_not_available THEN
      adiadas := adiadas + 1;
    END;
  END LOOP;
  PERFORM set_config('lock_timeout', espera_antes, true);
  o_que := 'pessoas'; quantas := pessoas; RETURN NEXT;
  o_que := 'pessoas_adiadas'; quantas := adiadas; RETURN NEXT;

  DELETE FROM public.sessao s WHERE s.id IN (
    SELECT x.id FROM public.sessao x
    WHERE public.sessao_fim(x) < now() - interval '30 days' LIMIT 50000);
  GET DIAGNOSTICS n = ROW_COUNT;
  o_que := 'sessoes'; quantas := n; RETURN NEXT;

  UPDATE public.convite x SET email = public.pseudonimo(x.id)
  WHERE x.email <> public.pseudonimo(x.id)
    AND public.convite_fim(x) < now() - interval '30 days';
  GET DIAGNOSTICS n = ROW_COUNT;
  o_que := 'convites'; quantas := n; RETURN NEXT;
END
$$;

-- Para a verificação das 07:00: o que a tarefa devia ter tratado há mais de
-- um dia. Acima de zero, a limpeza das contas não está a correr.
CREATE FUNCTION contas_prazos_em_atraso() RETURNS integer
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT ((SELECT count(*) FROM public.entrada e
           WHERE e.quando < now() - interval '15 days')
        + (SELECT count(*) FROM public.sessao s
           WHERE public.sessao_fim(s) < now() - interval '31 days')
        + (SELECT count(*) FROM public.convite x
           WHERE x.email <> public.pseudonimo(x.id)
             AND public.convite_fim(x) < now() - interval '31 days')
        + (SELECT count(*) FROM public.pessoa p
           WHERE p.pseudonimizada_em IS NULL
             AND public.pessoa_saiu_ha(p.id, p.criada_em, interval '91 days'))
        -- Os que se apagam na limpeza seguinte, com um dia de folga
        -- (revisão do Codex no #152).
        + (SELECT count(*) FROM public.codigo_recuperacao c
           WHERE c.usado_em < now() - interval '1 day')
        + (SELECT count(*) FROM public.desafio_webauthn d
           WHERE d.criado_em < now() - interval '1 day')
        + (SELECT count(*) FROM public.palavra_passe w
           WHERE w.estado = 'pendente' AND w.criada_em < now() - interval '2 days')
        -- Credenciais de quem já foi pseudonimizado (revisão do #152, P2-1).
        + (SELECT count(*) FROM public.passkey k
           JOIN public.pessoa p ON p.id = k.pessoa_id WHERE p.pseudonimizada_em IS NOT NULL)
        + (SELECT count(*) FROM public.palavra_passe w
           JOIN public.pessoa p ON p.id = w.pessoa_id WHERE p.pseudonimizada_em IS NOT NULL)
        + (SELECT count(*) FROM public.codigo_recuperacao c
           JOIN public.pessoa p ON p.id = c.pessoa_id WHERE p.pseudonimizada_em IS NOT NULL))::integer
$$;

REVOKE ALL ON FUNCTION
  credencial_de_pessoa_viva(),
  pseudonimo(uuid),
  sessao_fim(public.sessao),
  pessoa_saiu_ha(uuid, timestamptz, interval),
  convite_fim(public.convite),
  contas_aplicar_prazos(),
  contas_prazos_em_atraso() FROM PUBLIC;

-- Na VPS o papel cria-o o preparar.sh (passo 10b), que também dá o EXECUTE
-- se esta migração correu antes dele.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'eurolify_limpeza') THEN
    GRANT EXECUTE ON FUNCTION contas_aplicar_prazos(), contas_prazos_em_atraso()
      TO eurolify_limpeza;
  END IF;
END
$$;
