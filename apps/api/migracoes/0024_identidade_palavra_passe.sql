-- Fatia «identidade», parte B3b: a palavra-passe com o TOTP, a alternativa à
-- passkey (docs/21 §4.3, §7, §8 e §12; decisões CA e CG; issue #140). Ex.: o
-- Rui não pode usar passkeys no computador da loja; activa uma palavra-passe
-- de 16 caracteres e o código de seis dígitos da aplicação do telemóvel, e
-- entra com e-mail + palavra-passe + código. A palavra-passe sozinha nunca
-- entra.
--
-- O que esta migração faz:
-- - `palavra_passe`: uma por pessoa, em dois estados: `pendente` (acabada de
--   escolher, à espera do primeiro código certo) e `activa`. A palavra-passe
--   e o TOTP vivem na mesma linha porque só existem juntos (CA): o docs/21
--   §4.1 tinha-os em duas tabelas (proposta; a §12 regista a mudança). O
--   resumo é o Argon2id em formato PHC, calculado na API (CG: t=3, p=4,
--   64 MiB); o segredo TOTP chega já cifrado (AES-256-GCM, chave fora da
--   base, `chave_versao` para a troca planeada, §8);
-- - o mesmo código não vale duas vezes: guarda-se o último passo de tempo
--   aceite e só passa um maior (§8, P-T11);
-- - o limite de tentativas: cada tentativa regista-se logo à entrada, como
--   falha, dentro das trancas, e só passa a `ok` quando tudo está certo
--   (revisão do #147, P1-1: pedidos em paralelo já não passam todos); conta
--   por IP e por e-mail como a recuperação (CI) e, como pede a §8, **por
--   conta**: 5 códigos errados depois de uma palavra-passe certa, em 15
--   minutos, bloqueiam a entrada por palavra-passe dessa conta (só quem
--   tem a palavra-passe o provoca). Um IPv6 conta pela sua rede /64 (P2-1);
--   a recuperação (0022) passa a contar assim também;
-- - activar a palavra-passe faz cair todas as sessões e dá uma nova a quem
--   pediu (§7); retirar também; a última forma de entrar não se retira (a
--   regra da passkey, 0022, passa a contar com a palavra-passe activa);
-- - como nas passkeys (0020), a verificação (aqui o Argon2id e o TOTP)
--   faz-se na API, e a base confia nela para isso: quem tiver a credencial
--   do eurolify_api cria uma sessão de uma pessoa com palavra-passe activa
--   (docs/21 §11, «Confiança na API»).
--
-- O que não faz (e onde fica): recusar as palavras-passe mais comuns (falta
-- escolher a lista e a fonte; docs/21 §12); apagar as entradas aos 14 dias
-- (B4).

SET LOCAL lock_timeout = '10s';

ALTER TABLE evento_conta DROP CONSTRAINT evento_conta_acto_check;
ALTER TABLE evento_conta ADD CONSTRAINT evento_conta_acto_check CHECK (acto IN (
  'convite_criado', 'convite_cancelado', 'convite_aceite', 'conta_criada',
  'papel_mudado', 'membro_terminado', 'pessoa_desactivada',
  'passkey_acrescentada', 'passkey_retirada', 'sessoes_terminadas',
  'codigos_gerados', 'recuperou', 'palavra_passe_activada',
  'palavra_passe_retirada'));

ALTER TABLE entrada DROP CONSTRAINT entrada_metodo_check;
ALTER TABLE entrada ADD CONSTRAINT entrada_metodo_check
  CHECK (metodo IN ('passkey', 'recuperacao', 'palavra_passe'));

ALTER TABLE sessao DROP CONSTRAINT sessao_revogada_motivo_check;
ALTER TABLE sessao ADD CONSTRAINT sessao_revogada_motivo_check CHECK (
  revogada_motivo IN ('saiu', 'pessoa_desactivada', 'recuperacao',
                      'terminar_todas', 'substituida', 'passkey_retirada',
                      'palavra_passe'));

CREATE TABLE palavra_passe (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  pessoa_id uuid NOT NULL REFERENCES pessoa (id),
  estado text NOT NULL CHECK (estado IN ('pendente', 'activa')),
  -- Argon2id em PHC: $argon2id$v=19$m=65536,t=3,p=4$<sal>$<resumo>.
  -- Sal de 128 bits (≥ 22 caracteres) e resultado de 256 bits (≥ 43), CG.
  resumo text NOT NULL CHECK (resumo ~ '^\$argon2id\$v=19\$m=[0-9]+,t=[0-9]+,p=[0-9]+\$[A-Za-z0-9+/]{22,}\$[A-Za-z0-9+/]{43,}$'
                              AND length(resumo) <= 200),
  -- iv (12) + etiqueta (16) + o segredo em base32 cifrado (32 bytes no TOTP
  -- de 160 bits).
  totp_cifrado bytea NOT NULL CHECK (length(totp_cifrado) BETWEEN 29 AND 128),
  chave_versao integer NOT NULL CHECK (chave_versao BETWEEN 1 AND 1000),
  ultimo_passo bigint NOT NULL DEFAULT 0 CHECK (ultimo_passo >= 0),
  criada_em timestamptz NOT NULL DEFAULT now(),
  activa_em timestamptz,
  CONSTRAINT palavra_passe_activa_desde CHECK ((estado = 'activa') = (activa_em IS NOT NULL))
);
-- Uma pendente e uma activa por pessoa, no máximo.
CREATE UNIQUE INDEX palavra_passe_por_estado ON palavra_passe (pessoa_id, estado);

-- Os parâmetros do Argon2id nunca abaixo dos da CG (m=65536 KiB, t=3, p=4).
CREATE FUNCTION palavra_passe_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  partes text[];
BEGIN
  partes := regexp_match(NEW.resumo, '^\$argon2id\$v=19\$m=([0-9]+),t=([0-9]+),p=([0-9]+)\$');
  IF partes IS NULL OR partes[1]::bigint < 65536 OR partes[2]::int < 3 OR partes[3]::int < 4 THEN
    RAISE EXCEPTION 'password.weak_parameters: o Argon2id está abaixo do mínimo (CG)';
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.criada_em := now();
    NEW.activa_em := CASE WHEN NEW.estado = 'activa' THEN now() END;
  ELSIF (NEW.id, NEW.pessoa_id, NEW.resumo, NEW.totp_cifrado, NEW.chave_versao, NEW.criada_em)
        IS DISTINCT FROM
        (OLD.id, OLD.pessoa_id, OLD.resumo, OLD.totp_cifrado, OLD.chave_versao, OLD.criada_em) THEN
    RAISE EXCEPTION 'account.immutable: a palavra-passe não se altera; escolhe-se outra';
  ELSIF NEW.ultimo_passo < OLD.ultimo_passo THEN
    RAISE EXCEPTION 'account.immutable: o passo do TOTP não recua';
  ELSIF OLD.estado = 'pendente' AND NEW.estado = 'activa' THEN
    NEW.activa_em := now();
  ELSIF NEW.estado IS DISTINCT FROM OLD.estado THEN
    RAISE EXCEPTION 'account.immutable: uma palavra-passe activa não volta a pendente';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER palavra_passe_antes_de_gravar
  BEFORE INSERT OR UPDATE ON palavra_passe
  FOR EACH ROW EXECUTE FUNCTION palavra_passe_antes_de_gravar();
ALTER TABLE palavra_passe ENABLE ALWAYS TRIGGER palavra_passe_antes_de_gravar;

ALTER TABLE palavra_passe ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON palavra_passe FROM PUBLIC;

-- Apoio (interna): a rede de um IP para o limite — um IPv4 conta por si,
-- um IPv6 pela rede /64 (revisão do #147, P2-1).
CREATE FUNCTION ip_rede(p_ip inet) RETURNS cidr
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT CASE WHEN p_ip IS NULL THEN NULL
              WHEN family(p_ip) = 6 THEN network(set_masklen(p_ip, 64))
              ELSE network(set_masklen(p_ip, 32)) END
$$;

-- Apoio (interna): o limite de tentativas da CI para um método. Verdadeiro
-- se bloqueia.
CREATE FUNCTION entrada_bloqueada(p_email_resumo text, p_ip inet, p_metodo text)
  RETURNS boolean
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  falhas_email bigint;
  falhas_ip bigint;
BEGIN
  SELECT count(*) INTO falhas_email FROM public.entrada e
  WHERE e.email_resumo = p_email_resumo AND e.metodo = p_metodo
    AND e.resultado = 'falhou' AND e.quando > now() - interval '15 minutes';
  SELECT count(*) INTO falhas_ip FROM public.entrada e
  WHERE p_ip IS NOT NULL AND public.ip_rede(e.ip) = public.ip_rede(p_ip)
    AND e.metodo = p_metodo
    AND e.resultado = 'falhou' AND e.quando > now() - interval '15 minutes';
  RETURN falhas_ip >= 5 OR (falhas_email >= 5 AND (p_ip IS NULL OR falhas_ip > 0));
END
$$;

-- Apoio (interna): as trancas do limite, por esta ordem sempre: o e-mail e
-- depois a rede do IP.
CREATE FUNCTION entrada_trancar(p_metodo text, p_email_resumo text, p_ip inet) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_metodo || ':' || p_email_resumo, 0));
  IF p_ip IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(p_metodo || '-ip:' || public.ip_rede(p_ip)::text, 0));
  END IF;
END
$$;

-- Apoio (interna): há outra forma de entrar além desta? (a última não se
-- retira).
CREATE FUNCTION pessoa_tem_passkey(p_pessoa uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.passkey k WHERE k.pessoa_id = p_pessoa)
$$;

-- As portas da API.

-- Escolher uma palavra-passe nova (sessão recente): fica pendente até ao
-- primeiro código certo. Uma pendente anterior é substituída; a activa, se
-- houver, continua até a nova se confirmar.
CREATE FUNCTION palavra_passe_preparar(p_segredo_sessao text, p_resumo text,
                                       p_totp_cifrado bytea, p_chave_versao integer)
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  s public.sessao;
BEGIN
  s := public.sessao_recente(p_segredo_sessao);
  PERFORM 1 FROM public.pessoa p WHERE p.id = s.pessoa_id FOR UPDATE;
  DELETE FROM public.palavra_passe w WHERE w.pessoa_id = s.pessoa_id AND w.estado = 'pendente';
  INSERT INTO public.palavra_passe (pessoa_id, estado, resumo, totp_cifrado, chave_versao)
  VALUES (s.pessoa_id, 'pendente', p_resumo, p_totp_cifrado, p_chave_versao);
END
$$;

-- O segredo TOTP cifrado da palavra-passe pendente (sessão recente), para a
-- API conferir o primeiro código. Devolve também o id da pendente: a
-- confirmação só activa essa (revisão do #147, P3-1).
CREATE FUNCTION palavra_passe_pendente(p_segredo_sessao text)
  RETURNS TABLE (id uuid, pessoa_id uuid, totp_cifrado bytea, chave_versao integer)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  s public.sessao;
BEGIN
  s := public.sessao_recente(p_segredo_sessao);
  RETURN QUERY SELECT w.id, w.pessoa_id, w.totp_cifrado, w.chave_versao
               FROM public.palavra_passe w
               WHERE w.pessoa_id = s.pessoa_id AND w.estado = 'pendente';
END
$$;

-- Confirmar a pendente com o primeiro código (o passo que a API aceitou):
-- passa a activa, a antiga sai, todas as sessões caem e nasce uma (§7). Só
-- a pendente cujo código a API conferiu: outra escolhida entretanto (outro
-- separador) não se activa às cegas.
CREATE FUNCTION palavra_passe_confirmar(p_segredo_sessao text, p_pendente uuid,
                                        p_passo bigint, p_resumo_nova text)
  RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  s public.sessao;
BEGIN
  s := public.sessao_recente(p_segredo_sessao);
  PERFORM 1 FROM public.pessoa p WHERE p.id = s.pessoa_id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM public.palavra_passe w
                 WHERE w.id = p_pendente AND w.pessoa_id = s.pessoa_id
                   AND w.estado = 'pendente') THEN
    RAISE EXCEPTION 'password.not_pending: não há palavra-passe à espera de confirmação';
  END IF;
  DELETE FROM public.palavra_passe w WHERE w.pessoa_id = s.pessoa_id AND w.estado = 'activa';
  UPDATE public.palavra_passe w SET estado = 'activa', ultimo_passo = p_passo
  WHERE w.id = p_pendente;
  INSERT INTO public.evento_conta (acto, pessoa_id, quem)
  VALUES ('palavra_passe_activada', s.pessoa_id, 'pessoa:per_' || s.pessoa_id::text);
  RETURN public.sessoes_trocar_todas(s.pessoa_id, 'palavra_passe', p_resumo_nova, s.id);
END
$$;

-- Retirar a palavra-passe activa (sessão recente). Nunca a última forma de
-- entrar. Uma pendente sai com ela.
CREATE FUNCTION palavra_passe_retirar(p_segredo_sessao text, p_resumo_nova text)
  RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  s public.sessao;
BEGIN
  s := public.sessao_recente(p_segredo_sessao);
  PERFORM 1 FROM public.pessoa p WHERE p.id = s.pessoa_id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM public.palavra_passe w
                 WHERE w.pessoa_id = s.pessoa_id AND w.estado = 'activa') THEN
    RAISE EXCEPTION 'password.not_found: a conta não tem palavra-passe activa';
  END IF;
  IF NOT public.pessoa_tem_passkey(s.pessoa_id) THEN
    RAISE EXCEPTION 'password.last_credential: é a última forma de entrar; acrescente uma passkey antes';
  END IF;
  DELETE FROM public.palavra_passe w WHERE w.pessoa_id = s.pessoa_id;
  INSERT INTO public.evento_conta (acto, pessoa_id, quem)
  VALUES ('palavra_passe_retirada', s.pessoa_id, 'pessoa:per_' || s.pessoa_id::text);
  RETURN public.sessoes_trocar_todas(s.pessoa_id, 'palavra_passe', p_resumo_nova, s.id);
END
$$;

-- Entrar, passo 1: dentro das trancas, o limite (IP, e-mail e conta) e, se
-- não bloqueia, a tentativa fica já registada como falha (passa a `ok` no
-- passo 2). Devolve sempre uma linha: `bloqueado`, ou `ok` com a tentativa e
-- os dados da conta — nulos se não houver conta activa com palavra-passe (a
-- API calcula um Argon2id falso nesse caso: o mesmo tempo, §8).
CREATE FUNCTION palavra_passe_para_entrar(p_email text, p_ip inet)
  RETURNS TABLE (resultado text, tentativa uuid, pessoa_id uuid, resumo text,
                 totp_cifrado bytea, chave_versao integer, ultimo_passo bigint)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  tentado text := public.email_resumo(p_email);
  conta public.palavra_passe;
  nova uuid;
BEGIN
  PERFORM public.entrada_trancar('palavra_passe', tentado, p_ip);
  SELECT w.* INTO conta
  FROM public.pessoa p JOIN public.palavra_passe w ON w.pessoa_id = p.id AND w.estado = 'activa'
  WHERE lower(p.email) = lower(btrim(coalesce(p_email, ''))) AND p.estado = 'activa';
  IF public.entrada_bloqueada(tentado, p_ip, 'palavra_passe')
     -- Por conta (§8): códigos errados depois de uma palavra-passe certa.
     OR (conta.pessoa_id IS NOT NULL AND (
       SELECT count(*) FROM public.entrada e
       WHERE e.pessoa_id = conta.pessoa_id AND e.metodo = 'palavra_passe'
         AND e.resultado = 'falhou' AND e.quando > now() - interval '15 minutes') >= 5) THEN
    INSERT INTO public.entrada (email_resumo, metodo, resultado, ip)
    VALUES (tentado, 'palavra_passe', 'bloqueado', p_ip);
    RETURN QUERY SELECT 'bloqueado'::text, NULL::uuid, NULL::uuid, NULL::text, NULL::bytea,
                        NULL::integer, NULL::bigint;
    RETURN;
  END IF;
  INSERT INTO public.entrada (email_resumo, metodo, resultado, ip)
  VALUES (tentado, 'palavra_passe', 'falhou', p_ip)
  RETURNING entrada.id INTO nova;
  RETURN QUERY SELECT 'ok'::text, nova, conta.pessoa_id, conta.resumo, conta.totp_cifrado,
                      conta.chave_versao, conta.ultimo_passo;
END
$$;

-- Entrar, palavra-passe certa mas código errado: a tentativa passa a contar
-- também para a conta (o limite por conta, §8).
CREATE FUNCTION palavra_passe_codigo_errado(p_tentativa uuid, p_pessoa uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  UPDATE public.entrada e SET pessoa_id = p_pessoa
  WHERE e.id = p_tentativa AND e.metodo = 'palavra_passe' AND e.resultado = 'falhou'
    AND e.pessoa_id IS NULL;
END
$$;

-- Entrar, passo 2: depois de a API conferir a palavra-passe e o código, o
-- passo de tempo avança (o mesmo código não vale duas vezes), a tentativa
-- passa a `ok` e nasce a sessão.
CREATE FUNCTION entrar_com_palavra_passe(p_tentativa uuid, p_pessoa uuid, p_passo bigint,
                                         p_resumo_sessao text)
  RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  UPDATE public.palavra_passe w SET ultimo_passo = p_passo
  WHERE w.pessoa_id = p_pessoa AND w.estado = 'activa'
    AND p_passo IS NOT NULL AND p_passo > w.ultimo_passo;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'auth.unauthenticated: código já usado ou palavra-passe inexistente';
  END IF;
  UPDATE public.entrada e SET resultado = 'ok', pessoa_id = p_pessoa
  WHERE e.id = p_tentativa AND e.metodo = 'palavra_passe' AND e.resultado = 'falhou'
    AND e.quando > now() - interval '5 minutes';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'auth.unauthenticated: tentativa desconhecida';
  END IF;
  RETURN public.sessao_nova(p_pessoa, p_resumo_sessao);
END
$$;

-- Recuperar, passo 1 (substitui a da 0022, mesma assinatura): o mesmo
-- limite, agora com a rede /64 no IPv6 (revisão do #147, P2-1).
CREATE OR REPLACE FUNCTION recuperacao_iniciar(p_resumo_desafio text, p_email text,
                                               p_resumo_codigo text, p_ip inet)
  RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  tentado text := public.email_resumo(p_email);
  pessoa uuid;
BEGIN
  PERFORM public.entrada_trancar('recuperacao', tentado, p_ip);
  IF public.entrada_bloqueada(tentado, p_ip, 'recuperacao') THEN
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

-- Retirar uma passkey (substitui a da 0022, mesma assinatura): a última
-- forma de entrar conta também com a palavra-passe activa.
CREATE OR REPLACE FUNCTION passkey_retirar(p_segredo_sessao text, p_passkey uuid, p_resumo_nova text)
  RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  s public.sessao;
BEGIN
  s := public.sessao_recente(p_segredo_sessao);
  -- Duas retiradas ao mesmo tempo não deixam a pessoa sem forma de entrar.
  PERFORM 1 FROM public.pessoa p WHERE p.id = s.pessoa_id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM public.passkey k
                 WHERE k.id = p_passkey AND k.pessoa_id = s.pessoa_id) THEN
    RAISE EXCEPTION 'passkey.not_found: a passkey não existe nesta conta';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.passkey k
                 WHERE k.pessoa_id = s.pessoa_id AND k.id <> p_passkey)
     AND NOT EXISTS (SELECT 1 FROM public.palavra_passe w
                     WHERE w.pessoa_id = s.pessoa_id AND w.estado = 'activa') THEN
    RAISE EXCEPTION 'passkey.last_credential: é a última forma de entrar; acrescente outra antes';
  END IF;
  DELETE FROM public.passkey k WHERE k.id = p_passkey;
  INSERT INTO public.evento_conta (acto, pessoa_id, quem)
  VALUES ('passkey_retirada', s.pessoa_id, 'pessoa:per_' || s.pessoa_id::text);
  RETURN public.sessoes_trocar_todas(s.pessoa_id, 'passkey_retirada', p_resumo_nova, s.id);
END
$$;

REVOKE ALL ON FUNCTION palavra_passe_antes_de_gravar(), ip_rede(inet),
  entrada_bloqueada(text, inet, text), entrada_trancar(text, text, inet),
  pessoa_tem_passkey(uuid),
  palavra_passe_preparar(text, text, bytea, integer), palavra_passe_pendente(text),
  palavra_passe_confirmar(text, uuid, bigint, text), palavra_passe_retirar(text, text),
  palavra_passe_para_entrar(text, inet), palavra_passe_codigo_errado(uuid, uuid),
  entrar_com_palavra_passe(uuid, uuid, bigint, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  palavra_passe_preparar(text, text, bytea, integer), palavra_passe_pendente(text),
  palavra_passe_confirmar(text, uuid, bigint, text), palavra_passe_retirar(text, text),
  palavra_passe_para_entrar(text, inet), palavra_passe_codigo_errado(uuid, uuid),
  entrar_com_palavra_passe(uuid, uuid, bigint, text)
  TO eurolify_api;
