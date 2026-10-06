-- Fatia «identidade», parte B1: pessoas, membros de um comerciante, convites,
-- sessões e o rasto das contas (docs/21 §4.1, §4.2, §4.4 a §4.6 e §5; issue
-- #140; desenho aprovado pelo Diogo a 06/10/2026: «sim, aprovo; junta o #138
-- e começa o código»). Ex.: o dono da «Loja de Teste» convida
-- ana@exemplo.test como gestora; a ligação vale uma vez durante 7 dias; ao
-- aceitá-la nasce a pessoa e o membro «gestor»; quando o dono a retira da
-- equipa, as sessões dela deixam de valer nesse comerciante e as chaves de API
-- que ela lá criou ficam revogadas.
--
-- O que esta migração faz:
-- - as tabelas `pessoa`, `membro`, `convite`, `sessao` e `evento_conta` (o
--   rasto, que só se acrescenta, como o da 0008). As credenciais (passkey,
--   palavra-passe, TOTP, códigos de recuperação) e o registo de entradas
--   vêm nas partes B2 e B3;
-- - as regras dos papéis, impostas na base: um dono convida com qualquer
--   papel, um gestor só com armazém ou apoio, ninguém mais convida; o papel
--   dono só o dá um dono; só um dono muda papéis e ninguém muda o seu; cada
--   comerciante tem sempre um dono activo de uma pessoa activa, também com
--   dois pedidos ao mesmo tempo (tranca por comerciante, como no T11);
-- - um convite vale uma vez e 7 dias (proposta do docs/21 §4.2); para um
--   e-mail que já tem conta só se aceita com uma sessão dessa pessoa, e
--   nunca acrescenta uma credencial (P-T9); dois aceites ao mesmo tempo, só
--   um passa (FOR UPDATE);
-- - sair da equipa: as sessões deixam de valer nesse comerciante (o resolver
--   exige um membro activo) e as chaves que a pessoa lá criou
--   (`criada_por = 'pessoa:per_<id>'`) ficam revogadas;
-- - a sessão: 12 h sem uso e no máximo 30 dias (CD); a autenticação recente
--   vale 10 minutos (proposta, docs/21 §4.3). O segredo nunca chega à base
--   na criação: vem só o resumo (sha256), como as chaves (0010);
-- - comerciante `suspenso` ou `fechado` (AZ): não convida, não muda papéis e
--   não aceita convites; tirar alguém da equipa continua, porque fecha
--   acessos (como revogar chaves, 0012).
--
-- Acesso: a API não tem nenhum privilégio nestas tabelas nem, por agora,
-- EXECUTE nestas funções; as rotas da parte B2 recebem-no com o código que as
-- usa (como as chaves, 0010). O RLS fica ligado sem FORCE, como na
-- `chave_api`: a sessão é da pessoa e atravessa comerciantes, e as funções
-- (do dono das tabelas) têm de ver as linhas antes de haver contexto. Nas
-- tabelas sem comerciante, o RLS sem políticas recusa tudo a quem não é dono.
--
-- O que não faz (e onde fica): entrar (B2, B3); listar membros e convites
-- (B2, com as rotas); os prazos de apagar e pseudonimizar (B4); as chaves
-- criadas por uma chave que a pessoa criou não se revogam em cadeia (fica
-- escrito no docs/21).

SET LOCAL lock_timeout = '10s';

-- Os âmbitos de cada papel (docs/21 §5). Uma lista por papel, por ordem, para
-- ser sempre a mesma; o teste confere-a com a do código.
CREATE FUNCTION papel_ambitos(p_papel text) RETURNS text[]
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT CASE p_papel
    WHEN 'dono' THEN ARRAY['catalog:import', 'catalog:publish', 'catalog:read',
                           'catalog:write', 'keys:write', 'merchant:read',
                           'merchant:write']
    WHEN 'gestor' THEN ARRAY['catalog:import', 'catalog:publish', 'catalog:read',
                             'catalog:write', 'merchant:read']
    WHEN 'armazem' THEN ARRAY['catalog:read']
    WHEN 'apoio' THEN ARRAY['catalog:read', 'merchant:read']
  END::text[]
$$;

CREATE TABLE pessoa (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  -- Não confirmado (docs/21 §4.1): vem do convite, nunca de quem o abre.
  email text NOT NULL CHECK (length(email) BETWEEN 3 AND 254
                             AND email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  nome text NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 100),
  estado text NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa', 'desactivada')),
  criada_em timestamptz NOT NULL DEFAULT now(),
  desactivada_em timestamptz,
  CONSTRAINT pessoa_desactivacao_inteira CHECK ((estado = 'desactivada') = (desactivada_em IS NOT NULL))
);
-- Único sem distinguir maiúsculas.
CREATE UNIQUE INDEX pessoa_email_unico ON pessoa (lower(email));

CREATE TABLE membro (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  pessoa_id uuid NOT NULL REFERENCES pessoa (id),
  papel text NOT NULL CHECK (papel IN ('dono', 'gestor', 'armazem', 'apoio')),
  desde timestamptz NOT NULL DEFAULT now(),
  ate timestamptz,
  convidado_por text NOT NULL CHECK (length(btrim(convidado_por)) BETWEEN 1 AND 200),
  terminado_por text CHECK (terminado_por IS NULL OR length(btrim(terminado_por)) BETWEEN 1 AND 200),
  CONSTRAINT membro_fim_inteiro CHECK ((ate IS NULL) = (terminado_por IS NULL))
);
-- Um membro activo por pessoa e comerciante; os antigos ficam para a prova.
CREATE UNIQUE INDEX membro_activo_unico ON membro (comerciante_id, pessoa_id) WHERE ate IS NULL;
CREATE INDEX membro_por_pessoa ON membro (pessoa_id) WHERE ate IS NULL;

CREATE TABLE convite (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  email text NOT NULL CHECK (length(email) BETWEEN 3 AND 254
                             AND email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  papel text NOT NULL CHECK (papel IN ('dono', 'gestor', 'armazem', 'apoio')),
  resumo text NOT NULL CHECK (resumo ~ '^[0-9a-f]{64}$'),
  convidado_por text NOT NULL CHECK (length(btrim(convidado_por)) BETWEEN 1 AND 200),
  criado_em timestamptz NOT NULL DEFAULT now(),
  expira_em timestamptz NOT NULL,
  aceite_em timestamptz,
  aceite_por uuid REFERENCES pessoa (id),
  cancelado_em timestamptz,
  cancelado_por text CHECK (cancelado_por IS NULL OR length(btrim(cancelado_por)) BETWEEN 1 AND 200),
  CONSTRAINT convite_resumo_unico UNIQUE (resumo),
  CONSTRAINT convite_aceite_inteiro CHECK ((aceite_em IS NULL) = (aceite_por IS NULL)),
  CONSTRAINT convite_cancelamento_inteiro CHECK ((cancelado_em IS NULL) = (cancelado_por IS NULL)),
  CONSTRAINT convite_um_fim CHECK (aceite_em IS NULL OR cancelado_em IS NULL)
);
CREATE INDEX convite_por_comerciante ON convite (comerciante_id, criado_em);

CREATE TABLE sessao (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  pessoa_id uuid NOT NULL REFERENCES pessoa (id),
  resumo text NOT NULL CHECK (resumo ~ '^[0-9a-f]{64}$'),
  criada_em timestamptz NOT NULL DEFAULT now(),
  ultimo_uso_em timestamptz NOT NULL DEFAULT now(),
  -- Passkey, ou palavra-passe + TOTP, nesta sessão (docs/21 §4.3).
  autenticada_em timestamptz NOT NULL DEFAULT now(),
  revogada_em timestamptz,
  revogada_motivo text CHECK (revogada_motivo IN ('saiu', 'pessoa_desactivada', 'recuperacao', 'terminar_todas')),
  CONSTRAINT sessao_resumo_unico UNIQUE (resumo),
  CONSTRAINT sessao_revogacao_inteira CHECK ((revogada_em IS NULL) = (revogada_motivo IS NULL))
);
CREATE INDEX sessao_por_pessoa ON sessao (pessoa_id) WHERE revogada_em IS NULL;

-- O rasto das contas: só se acrescenta (0008).
CREATE TABLE evento_conta (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  quando timestamptz NOT NULL DEFAULT now(),
  acto text NOT NULL CHECK (acto IN ('convite_criado', 'convite_cancelado',
    'convite_aceite', 'conta_criada', 'papel_mudado', 'membro_terminado',
    'pessoa_desactivada')),
  comerciante_id uuid REFERENCES comerciante (id),
  pessoa_id uuid REFERENCES pessoa (id),
  convite_id uuid REFERENCES convite (id),
  membro_id uuid REFERENCES membro (id),
  papel text CHECK (papel IN ('dono', 'gestor', 'armazem', 'apoio')),
  -- Numa mudança de papel, o de antes (revisão do #141, P3-7).
  papel_antes text CHECK (papel_antes IN ('dono', 'gestor', 'armazem', 'apoio')),
  quem text NOT NULL CHECK (length(btrim(quem)) BETWEEN 1 AND 200)
);
CREATE INDEX evento_conta_por_pessoa ON evento_conta (pessoa_id, quando);
CREATE INDEX evento_conta_por_comerciante ON evento_conta (comerciante_id, quando);

CREATE TRIGGER evento_conta_so_se_acrescenta
  BEFORE UPDATE OR DELETE ON evento_conta
  FOR EACH ROW EXECUTE FUNCTION rasto_so_se_acrescenta();
CREATE TRIGGER evento_conta_sem_truncate
  BEFORE TRUNCATE ON evento_conta
  FOR EACH STATEMENT EXECUTE FUNCTION rasto_so_se_acrescenta();
ALTER TABLE evento_conta ENABLE ALWAYS TRIGGER evento_conta_so_se_acrescenta;
ALTER TABLE evento_conta ENABLE ALWAYS TRIGGER evento_conta_sem_truncate;

-- As datas são da base; o que identifica uma linha não muda; um fim não
-- se desfaz. As regras de quem pode o quê ficam nas funções abaixo.
CREATE FUNCTION pessoas_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Apagar e pseudonimizar são da tarefa dos prazos (parte B4).
    RAISE EXCEPTION 'account.immutable: % não se apaga', TG_TABLE_NAME;
  END IF;
  IF TG_TABLE_NAME = 'pessoa' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.criada_em := now();
      NEW.estado := 'activa';
      NEW.desactivada_em := NULL;
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

DO $$
DECLARE
  tabela text;
BEGIN
  FOREACH tabela IN ARRAY ARRAY['pessoa', 'membro', 'convite', 'sessao'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON %I
                    FOR EACH ROW EXECUTE FUNCTION pessoas_antes_de_gravar()',
                   tabela || '_antes_de_gravar', tabela);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I
                    FOR EACH STATEMENT EXECUTE FUNCTION rasto_so_se_acrescenta()',
                   tabela || '_sem_truncate', tabela);
    EXECUTE format('ALTER TABLE %I ENABLE ALWAYS TRIGGER %I', tabela, tabela || '_antes_de_gravar');
    EXECUTE format('ALTER TABLE %I ENABLE ALWAYS TRIGGER %I', tabela, tabela || '_sem_truncate');
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tabela);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC', tabela);
  END LOOP;
END
$$;
ALTER TABLE evento_conta ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON evento_conta FROM PUBLIC;
-- Segunda barreira, se um dia alguém der um privilégio à API: só o próprio
-- comerciante. As tabelas sem comerciante ficam sem política (nada).
CREATE POLICY so_o_proprio ON membro
  USING (comerciante_id = comerciante_actual())
  WITH CHECK (comerciante_id = comerciante_actual());
CREATE POLICY so_o_proprio ON convite
  USING (comerciante_id = comerciante_actual())
  WITH CHECK (comerciante_id = comerciante_actual());

-- Funções de apoio (internas: nem a API nem PUBLIC as chamam).

CREATE FUNCTION resumo_do_segredo(p_segredo text) RETURNS text
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT encode(sha256(convert_to(coalesce(p_segredo, ''), 'UTF8')), 'hex')
$$;

-- A sessão válida de um segredo: não revogada, usada nas últimas 12 h,
-- criada há menos de 30 dias (CD), de uma pessoa activa. Sem ela,
-- `auth.unauthenticated`.
CREATE FUNCTION sessao_valida(p_segredo text) RETURNS public.sessao
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  s public.sessao;
BEGIN
  SELECT x.* INTO s FROM public.sessao x
  JOIN public.pessoa p ON p.id = x.pessoa_id
  WHERE x.resumo = public.resumo_do_segredo(p_segredo)
    AND x.revogada_em IS NULL
    AND x.ultimo_uso_em > now() - interval '12 hours'
    AND x.criada_em > now() - interval '30 days'
    AND p.estado = 'activa';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'auth.unauthenticated: sessão inválida, expirada ou revogada';
  END IF;
  RETURN s;
END
$$;

-- O membro activo de uma sessão no comerciante do contexto. Sem ele,
-- `auth.forbidden` (a pessoa não trabalha para este comerciante).
CREATE FUNCTION membro_de_quem_pede(p_segredo text, p_recente boolean)
  RETURNS public.membro
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  s public.sessao;
  m public.membro;
BEGIN
  s := public.sessao_valida(p_segredo);
  SELECT x.* INTO m FROM public.membro x
  WHERE x.pessoa_id = s.pessoa_id
    AND x.comerciante_id = public.comerciante_actual()
    AND x.ate IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'auth.forbidden: a pessoa não é membro deste comerciante';
  END IF;
  -- Autenticação recente: 10 minutos (proposta, docs/21 §4.3).
  IF p_recente AND s.autenticada_em <= now() - interval '10 minutes' THEN
    RAISE EXCEPTION 'auth.reauthentication_required: autentique-se outra vez para esta operação';
  END IF;
  RETURN m;
END
$$;

-- Um comerciante suspenso ou fechado não escreve (AZ).
CREATE FUNCTION comerciante_escreve(p_comerciante uuid) RETURNS void
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF (SELECT c.estado FROM public.comerciante c WHERE c.id = p_comerciante)
     IN ('suspenso', 'fechado') THEN
    RAISE EXCEPTION 'member.merchant_inactive: um comerciante suspenso ou fechado não convida nem muda papéis';
  END IF;
END
$$;

-- Tranca por comerciante para as mudanças de membros (como o T11): dois
-- donos que se retiram ao mesmo tempo esperam um pelo outro.
CREATE FUNCTION membros_trancar(p_comerciante uuid) RETURNS void
  LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT pg_advisory_xact_lock(hashtextextended('membro:' || p_comerciante::text, 0))
$$;

-- Recusa se, sem este membro, o comerciante ficar sem dono activo de uma
-- pessoa activa. Chama-se com a tranca do comerciante.
CREATE FUNCTION membro_nao_e_o_ultimo_dono(p_membro public.membro) RETURNS void
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF p_membro.papel = 'dono' AND NOT EXISTS (
       SELECT 1 FROM public.membro x
       JOIN public.pessoa p ON p.id = x.pessoa_id
       WHERE x.comerciante_id = p_membro.comerciante_id
         AND x.id <> p_membro.id
         AND x.ate IS NULL
         AND x.papel = 'dono'
         AND p.estado = 'activa') THEN
    RAISE EXCEPTION 'member.last_owner: é o último dono activo deste comerciante; nomeie outro dono antes';
  END IF;
END
$$;

-- Validar o papel e o e-mail de um convite novo.
CREATE FUNCTION convite_validar(p_email text, p_papel text, p_resumo text) RETURNS void
  LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF p_papel IS NULL OR p_papel NOT IN ('dono', 'gestor', 'armazem', 'apoio') THEN
    RAISE EXCEPTION 'invite.invalid_role: papel desconhecido';
  END IF;
  IF p_email IS NULL OR length(p_email) NOT BETWEEN 3 AND 254
     OR p_email !~ '^[^@[:space:]]+@[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'invite.invalid_email: e-mail inválido';
  END IF;
  IF p_resumo IS NULL OR p_resumo !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invite.invalid_secret: resumo do convite inválido';
  END IF;
END
$$;

-- Que papéis um papel pode dar num convite (docs/21 §4.2, ponto 1).
CREATE FUNCTION papel_pode_convidar(p_quem text, p_papel text) RETURNS boolean
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT p_quem = 'dono' OR (p_quem = 'gestor' AND p_papel IN ('armazem', 'apoio'))
$$;

-- Fechar o que uma pessoa abriu num comerciante quando perde poderes nele
-- (revisão do #141, P1-1, P2-3 e P2-4): os convites em aberto que criou e
-- as chaves de API que criou. Com `p_papel_novo` nulo (saiu, desactivada),
-- tudo; numa mudança de papel, só os convites que o papel novo já não dá e
-- as chaves com âmbitos que o papel novo não tem. Chama-se com a tranca de
-- membros do comerciante; toma a das chaves a seguir (por esta ordem em todo
-- o lado), para uma chave criada ao mesmo tempo não escapar.
CREATE FUNCTION pessoa_fechar_acessos(p_comerciante uuid, p_pessoa uuid,
                                      p_papel_novo text, p_motivo text,
                                      p_quem text)
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  autor text := 'pessoa:per_' || p_pessoa::text;
  c public.convite;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('chave_api:' || p_comerciante::text, 0));
  FOR c IN SELECT x.* FROM public.convite x
           WHERE x.comerciante_id = p_comerciante
             AND x.convidado_por = autor
             AND x.aceite_em IS NULL AND x.cancelado_em IS NULL
             AND (p_papel_novo IS NULL OR NOT public.papel_pode_convidar(p_papel_novo, x.papel))
           ORDER BY x.id
           FOR UPDATE LOOP
    UPDATE public.convite x SET cancelado_por = p_motivo WHERE x.id = c.id;
    INSERT INTO public.evento_conta (acto, comerciante_id, convite_id, quem)
    VALUES ('convite_cancelado', p_comerciante, c.id, p_quem);
  END LOOP;
  UPDATE public.chave_api k SET revogada_por = p_motivo
  WHERE k.comerciante_id = p_comerciante
    AND k.criada_por = autor
    AND k.revogada_por IS NULL
    AND (p_papel_novo IS NULL OR NOT (k.ambitos <@ public.papel_ambitos(p_papel_novo)));
END
$$;

-- O convite em aberto de um segredo, trancado: dois aceites ao mesmo tempo,
-- o segundo espera e vê-o aceite.
CREATE FUNCTION convite_em_aberto(p_segredo text) RETURNS public.convite
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  c public.convite;
BEGIN
  SELECT x.* INTO c FROM public.convite x
  WHERE x.resumo = public.resumo_do_segredo(p_segredo)
  FOR UPDATE;
  -- A mesma resposta para «não existe», «já usado», «cancelado» e
  -- «expirado»: quem tem uma ligação velha não aprende nada.
  IF NOT FOUND OR c.aceite_em IS NOT NULL OR c.cancelado_em IS NOT NULL
     OR c.expira_em <= now() THEN
    RAISE EXCEPTION 'invite.invalid: o convite não existe, já foi usado, foi cancelado ou expirou';
  END IF;
  PERFORM public.comerciante_escreve(c.comerciante_id);
  RETURN c;
END
$$;

-- Acrescentar o membro de um convite aceite e registar.
CREATE FUNCTION convite_concluir(p_convite public.convite, p_pessoa uuid) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  novo uuid;
BEGIN
  PERFORM public.membros_trancar(p_convite.comerciante_id);
  -- Quem convidou ainda pode dar este papel aqui (revisão do #141, P1-1); o
  -- convite do operador não depende de ninguém.
  IF p_convite.convidado_por LIKE 'pessoa:per\_%' AND NOT EXISTS (
       SELECT 1 FROM public.membro x
       JOIN public.pessoa q ON q.id = x.pessoa_id
       WHERE x.comerciante_id = p_convite.comerciante_id
         AND 'pessoa:per_' || x.pessoa_id::text = p_convite.convidado_por
         AND x.ate IS NULL
         AND q.estado = 'activa'
         AND public.papel_pode_convidar(x.papel, p_convite.papel)) THEN
    RAISE EXCEPTION 'invite.invalid: o convite não existe, já foi usado, foi cancelado ou expirou';
  END IF;
  -- Quem aceita está activa; o FOR SHARE espera por uma desactivação em curso.
  PERFORM 1 FROM public.pessoa q WHERE q.id = p_pessoa AND q.estado = 'activa' FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'auth.unauthenticated: pessoa inexistente ou desactivada';
  END IF;
  IF EXISTS (SELECT 1 FROM public.membro x
             WHERE x.comerciante_id = p_convite.comerciante_id
               AND x.pessoa_id = p_pessoa AND x.ate IS NULL) THEN
    RAISE EXCEPTION 'invite.already_member: a pessoa já é membro deste comerciante';
  END IF;
  UPDATE public.convite x SET aceite_por = p_pessoa WHERE x.id = p_convite.id;
  INSERT INTO public.membro (comerciante_id, pessoa_id, papel, convidado_por)
  VALUES (p_convite.comerciante_id, p_pessoa, p_convite.papel, p_convite.convidado_por)
  RETURNING membro.id INTO novo;
  INSERT INTO public.evento_conta (acto, comerciante_id, pessoa_id, convite_id, membro_id, papel, quem)
  VALUES ('convite_aceite', p_convite.comerciante_id, p_pessoa, p_convite.id, novo,
          p_convite.papel, 'pessoa:per_' || p_pessoa::text);
  RETURN novo;
END
$$;

-- As portas (as rotas da parte B2 recebem o EXECUTE nas que usarem).

-- Criar uma sessão para uma pessoa activa, depois de a credencial ter sido
-- verificada (parte B2). O segredo nunca chega à base: só o resumo.
CREATE FUNCTION sessao_criar(p_pessoa uuid, p_resumo text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  nova uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.pessoa p WHERE p.id = p_pessoa AND p.estado = 'activa') THEN
    RAISE EXCEPTION 'auth.unauthenticated: pessoa inexistente ou desactivada';
  END IF;
  INSERT INTO public.sessao (pessoa_id, resumo) VALUES (p_pessoa, p_resumo)
  RETURNING sessao.id INTO nova;
  RETURN nova;
END
$$;

-- De um segredo de sessão e do comerciante do cabeçalho para o papel e os
-- âmbitos (docs/21 §4.6). Sem sessão válida, `auth.unauthenticated` (401);
-- sem membro activo nesse comerciante, `auth.forbidden` (403; revisão do
-- #141, P3-2). Marca o último uso no máximo uma vez por minuto.
CREATE FUNCTION sessao_resolver(p_segredo text, p_comerciante uuid)
  RETURNS TABLE (sessao_id uuid, pessoa_id uuid, membro_id uuid, papel text,
                 ambitos text[], recente boolean)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  s public.sessao;
  m public.membro;
BEGIN
  s := public.sessao_valida(p_segredo);
  SELECT x.* INTO m FROM public.membro x
  WHERE x.pessoa_id = s.pessoa_id
    AND x.comerciante_id = p_comerciante
    AND x.ate IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'auth.forbidden: a pessoa não é membro deste comerciante';
  END IF;
  -- Só uma sessão ainda em vigor: uma revogada entretanto fica como está
  -- (revisão do #141, P3-1).
  UPDATE public.sessao x SET ultimo_uso_em = now()
  WHERE x.id = s.id AND x.revogada_em IS NULL
    AND x.ultimo_uso_em < now() - interval '1 minute';
  RETURN QUERY SELECT s.id, s.pessoa_id, m.id, m.papel, public.papel_ambitos(m.papel),
                      s.autenticada_em > now() - interval '10 minutes';
END
$$;

-- Sair (a própria sessão). Falso se já não valia.
CREATE FUNCTION sessao_terminar(p_segredo text) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  UPDATE public.sessao s SET revogada_motivo = 'saiu'
  WHERE s.resumo = public.resumo_do_segredo(p_segredo) AND s.revogada_em IS NULL;
  RETURN FOUND;
END
$$;

-- Convidar, no comerciante do contexto, em nome da sessão (docs/21 §4.2):
-- o dono com qualquer papel; o gestor só armazém ou apoio; mais ninguém.
CREATE FUNCTION convite_criar(p_segredo_sessao text, p_email text, p_papel text,
                              p_resumo text)
  RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem public.membro;
  novo uuid;
BEGIN
  -- A tranca antes de ler o papel de quem pede: um dono que o despromove ao
  -- mesmo tempo espera ou é esperado, nunca se cruzam.
  PERFORM public.membros_trancar(public.comerciante_actual());
  quem := public.membro_de_quem_pede(p_segredo_sessao, true);
  PERFORM public.convite_validar(p_email, p_papel, p_resumo);
  PERFORM public.comerciante_escreve(quem.comerciante_id);
  IF NOT public.papel_pode_convidar(quem.papel, p_papel) THEN
    RAISE EXCEPTION 'member.role_escalation: só um dono convida com este papel';
  END IF;
  INSERT INTO public.convite (comerciante_id, email, papel, resumo, convidado_por, expira_em)
  VALUES (quem.comerciante_id, btrim(p_email), p_papel, p_resumo,
          'pessoa:per_' || quem.pessoa_id::text, now())
  RETURNING convite.id INTO novo;
  INSERT INTO public.evento_conta (acto, comerciante_id, convite_id, papel, quem)
  VALUES ('convite_criado', quem.comerciante_id, novo, p_papel,
          'pessoa:per_' || quem.pessoa_id::text);
  RETURN novo;
END
$$;

-- O convite do operador (docs/21 §7, ponto 5, e o primeiro dono de um
-- comerciante): o segredo gera-se no computador do operador; só o resumo
-- chega cá. Só o dono das tabelas (o comando do operador) a chama.
CREATE FUNCTION convite_criar_pelo_operador(p_comerciante uuid, p_email text,
                                            p_papel text, p_resumo text,
                                            p_quem text)
  RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  novo uuid;
BEGIN
  PERFORM public.convite_validar(p_email, p_papel, p_resumo);
  IF p_quem IS NULL OR p_quem !~ '^operador:github:[0-9]{1,20}$' THEN
    RAISE EXCEPTION 'invite.invalid_operator: quem tem de ser operador:github:<número>';
  END IF;
  PERFORM public.comerciante_escreve(p_comerciante);
  INSERT INTO public.convite (comerciante_id, email, papel, resumo, convidado_por, expira_em)
  VALUES (p_comerciante, btrim(p_email), p_papel, p_resumo, p_quem, now())
  RETURNING convite.id INTO novo;
  INSERT INTO public.evento_conta (acto, comerciante_id, convite_id, papel, quem)
  VALUES ('convite_criado', p_comerciante, novo, p_papel, p_quem);
  RETURN novo;
END
$$;

-- Cancelar um convite em aberto do comerciante do contexto: só um dono.
CREATE FUNCTION convite_cancelar(p_segredo_sessao text, p_convite uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem public.membro;
  c public.convite;
BEGIN
  quem := public.membro_de_quem_pede(p_segredo_sessao, false);
  IF quem.papel <> 'dono' THEN
    RAISE EXCEPTION 'member.role_escalation: só um dono cancela convites';
  END IF;
  SELECT x.* INTO c FROM public.convite x
  WHERE x.id = p_convite AND x.comerciante_id = quem.comerciante_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite.not_found: o convite não existe neste comerciante';
  END IF;
  IF c.aceite_em IS NOT NULL OR c.cancelado_em IS NOT NULL THEN
    RAISE EXCEPTION 'invite.used: o convite já foi aceite ou cancelado';
  END IF;
  UPDATE public.convite x SET cancelado_por = 'pessoa:per_' || quem.pessoa_id::text
  WHERE x.id = c.id;
  INSERT INTO public.evento_conta (acto, comerciante_id, convite_id, quem)
  VALUES ('convite_cancelado', c.comerciante_id, c.id, 'pessoa:per_' || quem.pessoa_id::text);
END
$$;

-- Aceitar um convite criando a conta (e-mail que ainda não tem conta;
-- docs/21 §4.2, ponto 3). O e-mail é o do convite. Se já há conta com esse
-- e-mail, recusa: aceita-se autenticado (função seguinte), nunca se lhe
-- acrescenta uma credencial (P-T9). A passkey entra na mesma transacção
-- (parte B2).
CREATE FUNCTION convite_aceitar_conta_nova(p_segredo_convite text, p_nome text)
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
  INSERT INTO public.evento_conta (acto, comerciante_id, pessoa_id, convite_id, quem)
  VALUES ('conta_criada', c.comerciante_id, nova, c.id, 'pessoa:per_' || nova::text);
  RETURN QUERY SELECT nova, c.comerciante_id, public.convite_concluir(c, nova);
END
$$;

-- Aceitar um convite com uma sessão da pessoa do e-mail do convite (docs/21
-- §4.2, ponto 4). Outra pessoa, recusa.
CREATE FUNCTION convite_aceitar(p_segredo_convite text, p_segredo_sessao text)
  RETURNS TABLE (comerciante_id uuid, membro_id uuid)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  s public.sessao;
  c public.convite;
BEGIN
  s := public.sessao_valida(p_segredo_sessao);
  -- Autenticação recente, como para dar um papel (revisão do #141, P3-5).
  IF s.autenticada_em <= now() - interval '10 minutes' THEN
    RAISE EXCEPTION 'auth.reauthentication_required: autentique-se outra vez para esta operação';
  END IF;
  c := public.convite_em_aberto(p_segredo_convite);
  IF NOT EXISTS (SELECT 1 FROM public.pessoa p
                 WHERE p.id = s.pessoa_id AND lower(p.email) = lower(c.email)) THEN
    RAISE EXCEPTION 'invite.other_person: o convite é para outro e-mail';
  END IF;
  RETURN QUERY SELECT c.comerciante_id, public.convite_concluir(c, s.pessoa_id);
END
$$;

-- Mudar o papel de um membro do comerciante do contexto: só um dono, com
-- autenticação recente, e nunca o seu (docs/21 §4.5).
CREATE FUNCTION membro_mudar_papel(p_segredo_sessao text, p_membro uuid, p_papel text)
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem public.membro;
  alvo public.membro;
BEGIN
  PERFORM public.membros_trancar(public.comerciante_actual());
  quem := public.membro_de_quem_pede(p_segredo_sessao, true);
  IF p_papel IS NULL OR p_papel NOT IN ('dono', 'gestor', 'armazem', 'apoio') THEN
    RAISE EXCEPTION 'invite.invalid_role: papel desconhecido';
  END IF;
  IF quem.papel <> 'dono' THEN
    RAISE EXCEPTION 'member.role_escalation: só um dono muda papéis';
  END IF;
  PERFORM public.comerciante_escreve(quem.comerciante_id);
  SELECT x.* INTO alvo FROM public.membro x
  WHERE x.id = p_membro AND x.comerciante_id = quem.comerciante_id AND x.ate IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'member.not_found: o membro não existe neste comerciante';
  END IF;
  IF alvo.pessoa_id = quem.pessoa_id THEN
    RAISE EXCEPTION 'member.self_role_change: ninguém muda o seu próprio papel';
  END IF;
  IF alvo.papel = p_papel THEN
    RETURN;
  END IF;
  IF alvo.papel = 'dono' THEN
    PERFORM public.membro_nao_e_o_ultimo_dono(alvo);
  END IF;
  UPDATE public.membro x SET papel = p_papel WHERE x.id = alvo.id;
  INSERT INTO public.evento_conta (acto, comerciante_id, pessoa_id, membro_id, papel,
                                   papel_antes, quem)
  VALUES ('papel_mudado', alvo.comerciante_id, alvo.pessoa_id, alvo.id, p_papel,
          alvo.papel, 'pessoa:per_' || quem.pessoa_id::text);
  PERFORM public.pessoa_fechar_acessos(alvo.comerciante_id, alvo.pessoa_id, p_papel,
    'papel_mudado:per_' || alvo.pessoa_id::text, 'pessoa:per_' || quem.pessoa_id::text);
END
$$;

-- Tirar um membro da equipa (docs/21 §4.4): um dono tira qualquer outro, com
-- autenticação recente; cada um sai por si. Nunca o último dono. As chaves
-- que a pessoa criou neste comerciante ficam revogadas.
CREATE FUNCTION membro_terminar(p_segredo_sessao text, p_membro uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem public.membro;
  alvo public.membro;
  proprio boolean;
BEGIN
  PERFORM public.membros_trancar(public.comerciante_actual());
  quem := public.membro_de_quem_pede(p_segredo_sessao, false);
  SELECT x.* INTO alvo FROM public.membro x
  WHERE x.id = p_membro AND x.comerciante_id = quem.comerciante_id AND x.ate IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'member.not_found: o membro não existe neste comerciante';
  END IF;
  proprio := alvo.pessoa_id = quem.pessoa_id;
  IF NOT proprio THEN
    IF quem.papel <> 'dono' THEN
      RAISE EXCEPTION 'member.role_escalation: só um dono tira outros da equipa';
    END IF;
    -- Autenticação recente para tirar outro.
    PERFORM public.membro_de_quem_pede(p_segredo_sessao, true);
  END IF;
  PERFORM public.membro_nao_e_o_ultimo_dono(alvo);
  UPDATE public.membro x SET terminado_por = 'pessoa:per_' || quem.pessoa_id::text
  WHERE x.id = alvo.id;
  PERFORM public.pessoa_fechar_acessos(alvo.comerciante_id, alvo.pessoa_id, NULL,
    'membro_terminado:per_' || alvo.pessoa_id::text, 'pessoa:per_' || quem.pessoa_id::text);
  INSERT INTO public.evento_conta (acto, comerciante_id, pessoa_id, membro_id, papel, quem)
  VALUES ('membro_terminado', alvo.comerciante_id, alvo.pessoa_id, alvo.id, alvo.papel,
          'pessoa:per_' || quem.pessoa_id::text);
END
$$;

-- Desactivar uma pessoa (o operador; docs/21 §4.5): recusa se for o último
-- dono activo de algum comerciante; senão, todas as sessões caem, sai de
-- todas as equipas e os convites e as chaves que criou fecham-se (revisão
-- do #141, P2-3). As trancas de todos os comerciantes dela primeiro, por
-- ordem, e só depois a da pessoa: a mesma ordem das outras funções (revisão
-- do #141, P3-3).
CREATE FUNCTION pessoa_desactivar(p_pessoa uuid, p_quem text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  comerciante uuid;
  m public.membro;
BEGIN
  IF p_quem IS NULL OR p_quem !~ '^operador:github:[0-9]{1,20}$' THEN
    RAISE EXCEPTION 'invite.invalid_operator: quem tem de ser operador:github:<número>';
  END IF;
  FOR comerciante IN SELECT DISTINCT x.comerciante_id FROM public.membro x
                     WHERE x.pessoa_id = p_pessoa AND x.ate IS NULL
                     ORDER BY 1 LOOP
    PERFORM public.membros_trancar(comerciante);
  END LOOP;
  PERFORM 1 FROM public.pessoa p WHERE p.id = p_pessoa AND p.estado = 'activa' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'person.not_found: a pessoa não existe ou já está desactivada';
  END IF;
  -- Releitura com as trancas: um membro novo entretanto (com outra tranca)
  -- faz recusar, para não ficar de fora.
  IF EXISTS (SELECT 1 FROM public.membro x
             WHERE x.pessoa_id = p_pessoa AND x.ate IS NULL
               AND NOT pg_catalog.pg_try_advisory_xact_lock(
                 hashtextextended('membro:' || x.comerciante_id::text, 0))) THEN
    RAISE EXCEPTION 'person.busy: a equipa desta pessoa mudou entretanto; tente outra vez';
  END IF;
  FOR m IN SELECT x.* FROM public.membro x
           WHERE x.pessoa_id = p_pessoa AND x.ate IS NULL
           ORDER BY x.comerciante_id LOOP
    PERFORM public.membro_nao_e_o_ultimo_dono(m);
  END LOOP;
  UPDATE public.pessoa p SET estado = 'desactivada' WHERE p.id = p_pessoa;
  UPDATE public.sessao s SET revogada_motivo = 'pessoa_desactivada'
  WHERE s.pessoa_id = p_pessoa AND s.revogada_em IS NULL;
  FOR m IN SELECT x.* FROM public.membro x
           WHERE x.pessoa_id = p_pessoa AND x.ate IS NULL
           ORDER BY x.comerciante_id LOOP
    UPDATE public.membro x SET terminado_por = p_quem WHERE x.id = m.id;
    INSERT INTO public.evento_conta (acto, comerciante_id, pessoa_id, membro_id, papel, quem)
    VALUES ('membro_terminado', m.comerciante_id, p_pessoa, m.id, m.papel, p_quem);
    PERFORM public.pessoa_fechar_acessos(m.comerciante_id, p_pessoa, NULL,
      'pessoa_desactivada:per_' || p_pessoa::text, p_quem);
  END LOOP;
  INSERT INTO public.evento_conta (acto, pessoa_id, quem)
  VALUES ('pessoa_desactivada', p_pessoa, p_quem);
END
$$;

-- Tudo fechado: nem a API nem PUBLIC chamam estas funções nesta parte.
REVOKE ALL ON FUNCTION papel_ambitos(text), resumo_do_segredo(text),
  sessao_valida(text), membro_de_quem_pede(text, boolean),
  comerciante_escreve(uuid), membros_trancar(uuid),
  membro_nao_e_o_ultimo_dono(membro), convite_validar(text, text, text),
  convite_em_aberto(text), convite_concluir(convite, uuid),
  papel_pode_convidar(text, text),
  pessoa_fechar_acessos(uuid, uuid, text, text, text),
  sessao_criar(uuid, text), sessao_resolver(text, uuid), sessao_terminar(text),
  convite_criar(text, text, text, text),
  convite_criar_pelo_operador(uuid, text, text, text, text),
  convite_cancelar(text, uuid), convite_aceitar_conta_nova(text, text),
  convite_aceitar(text, text), membro_mudar_papel(text, uuid, text),
  membro_terminar(text, uuid), pessoa_desactivar(uuid, text),
  pessoas_antes_de_gravar() FROM PUBLIC;
