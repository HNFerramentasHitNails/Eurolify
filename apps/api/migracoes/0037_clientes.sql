-- Clientes e perfis de faturação, parte 1 (docs/23; issue #233; Diogo,
-- 09/10/2026: «sim, aprovo; avança com o código da fatia 5»). Ex.: a ficha
-- «Ana Silva», com um perfil particular sem NIF (o principal) e um perfil
-- empresa «Salão Ana, Lda» com o NIF 263631656 (português, sem prefixo num
-- comerciante português; `FR40303265045` para um contribuinte francês).
--
-- O que esta migração faz:
-- - a ficha (`cliente`, §3.1) e os perfis de faturação (`perfil_faturacao`,
--   §3.2), com o RLS forçado;
-- - a régua do NIF numa função só (`nif_regua`, §3.3): limpa a pontuação,
--   tira o prefixo fiscal (o da Grécia é EL), deduz PT nos 9 dígitos sem
--   prefixo que passam o dígito de controlo português, confere o dígito de
--   controlo português e recusa os números impossíveis; compara-se só o
--   número (`nif_numero`);
-- - o NIF a mostrar (`nif_com_prefixo`): com o prefixo, excepto no país do
--   comerciante (o das entidades legais activas, se for um só);
-- - um principal por ficha, na base (R5); o primeiro perfil activo é o
--   principal; arquivar o principal quando há outro activo é recusado;
-- - um perfil usado num documento emitido não muda de NIF, tipo nem país
--   (R4; Q3 decidida); a marca `usado_em_documento` põe-na o domínio dos
--   documentos (fatia 10), não a API;
-- - o estado do VIES (§4.2) só em `nao_aplicavel` ou `por_validar`: a
--   consulta é a parte 3 (§11);
-- - as etiquetas de cliente (§3.5) e a chave estrangeira de
--   `lista_precos.etiqueta_id` (a 0017 deixou-a só com o id): as etiquetas
--   que as listas já referiam nascem aqui com um nome que o diz;
-- - o rasto (`alteracao_cliente`, §3.8), que só se acrescenta, escrito por
--   gatilhos com `eurolify.quem` obrigatório, como a 0033;
-- - os eventos `customer.created`, `customer.updated`,
--   `billing_profile.created` e `billing_profile.updated` (§6), só com
--   identificadores e os nomes dos campos (R12);
-- - os âmbitos `customers:read` e `customers:write` (§7): nas chaves e nos
--   papéis dono, gestor e apoio; e `customers:billing` (os perfis de
--   faturação: NIF e morada fiscal), só no dono (Diogo, 09/10/2026: «sim, só
--   o dono»; revisão do #234, P3-13).
--
-- O que não faz (e onde fica): consentimentos, duplicados, fusões e pedidos
-- dos titulares (parte 2); VIES e isenção manual (parte 3); os dígitos de
-- controlo dos outros países (não verificados, C — §3.3); o login dos
-- clientes (Q5: é da Loja).

SET LOCAL lock_timeout = '10s';

-- ------------------------------------------------------------ A régua do NIF

-- Os prefixos fiscais da UE (o do VIES): o ISO, excepto a Grécia (EL).
CREATE FUNCTION prefixo_fiscal(p_pais text) RETURNS text
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT CASE
    WHEN p_pais = 'GR' THEN 'EL'
    WHEN p_pais IN ('AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
      'DE', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO',
      'SK', 'SI', 'ES', 'SE') THEN p_pais
  END
$$;

CREATE FUNCTION pais_do_prefixo_fiscal(p_prefixo text) RETURNS text
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT CASE
    WHEN p_prefixo = 'EL' THEN 'GR'
    WHEN p_prefixo = 'GR' THEN NULL
    WHEN public.prefixo_fiscal(p_prefixo) IS NOT NULL THEN p_prefixo
  END
$$;

-- O dígito de controlo português (módulo 11, pesos 9 a 2): «M» nos sistemas
-- actuais. `000000000` e `123456789` passam-no e são impossíveis (#5414 nos
-- sistemas actuais, 30/09/2026): recusados pela lista.
CREATE FUNCTION nif_portugues_valido(p_numero text) RETURNS boolean
  LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  soma integer := 0;
  controlo integer;
BEGIN
  IF p_numero IS NULL OR p_numero !~ '^[0-9]{9}$' THEN
    RETURN false;
  END IF;
  IF p_numero ~ '^(.)\1{8}$' OR p_numero = '123456789' THEN
    RETURN false;
  END IF;
  FOR i IN 1..8 LOOP
    soma := soma + substr(p_numero, i, 1)::integer * (10 - i);
  END LOOP;
  controlo := 11 - (soma % 11);
  IF controlo >= 10 THEN
    controlo := 0;
  END IF;
  RETURN controlo = substr(p_numero, 9, 1)::integer;
END
$$;

-- O NIF sem espaços, pontos, hífenes nem barras, em maiúsculas.
CREATE FUNCTION nif_limpo(p text) RETURNS text
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT upper(regexp_replace(p, '[[:space:].\-/]', '', 'g'))
$$;

-- O número para procurar (GET /customers?procura=…): limpo e sem o prefixo
-- fiscal, se o tiver — a mesma comparação da régua (só o número).
CREATE FUNCTION nif_para_procura(p text) RETURNS text
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT CASE
    WHEN public.pais_do_prefixo_fiscal(left(l, 2)) IS NOT NULL AND length(l) > 2
      THEN substr(l, 3)
    ELSE l
  END
  FROM (SELECT public.nif_limpo(p) AS l) x
$$;

-- A régua (§3.3): do que a pessoa escreveu e do país que indicou (ou nenhum)
-- tira o país do contribuinte e o número sem prefixo nem pontuação. Recusa
-- com `customers.nif_invalid` ou `customers.nif_country_required`; nunca
-- devolve «sem NIF» a quem deu um número. `p_deduzir_pt`: só num comerciante
-- português se deduz PT de 9 dígitos sem prefixo (revisão do #234, P2-1: o
-- SIREN francês também tem 9 dígitos e 1 em 11 passa o controlo português).
CREATE FUNCTION nif_regua(p_escrito text, p_pais text, p_deduzir_pt boolean,
  OUT pais text, OUT numero text)
  LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  limpo text;
  do_prefixo text;
BEGIN
  IF p_escrito IS NULL THEN
    RETURN;
  END IF;
  IF p_pais IS NOT NULL AND p_pais !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'customers.nif_invalid: o país do contribuinte não é um código de país';
  END IF;
  limpo := public.nif_limpo(p_escrito);
  IF limpo = '' THEN
    RAISE EXCEPTION 'customers.nif_invalid: o NIF está vazio';
  END IF;
  do_prefixo := public.pais_do_prefixo_fiscal(left(limpo, 2));
  IF do_prefixo IS NOT NULL AND length(limpo) > 2 THEN
    IF p_pais IS NOT NULL AND p_pais <> do_prefixo THEN
      RAISE EXCEPTION 'customers.nif_invalid: o prefixo % não é do país indicado (%)', left(limpo, 2), p_pais;
    END IF;
    pais := do_prefixo;
    numero := substr(limpo, 3);
  ELSIF p_pais IS NOT NULL THEN
    -- `GR123…` com o país GR: o prefixo fiscal grego é EL, e o número não
    -- pode levar o código do país (seriam dois números para o mesmo
    -- contribuinte; revisão do #234, P2-2).
    IF left(limpo, 2) = p_pais AND length(limpo) > 2 THEN
      RAISE EXCEPTION 'customers.nif_invalid: o número começa pelo código do país (%); o prefixo fiscal é %',
        p_pais, coalesce(public.prefixo_fiscal(p_pais), 'outro');
    END IF;
    pais := p_pais;
    numero := limpo;
  ELSIF p_deduzir_pt AND public.nif_portugues_valido(limpo) THEN
    -- 9 dígitos sem prefixo que passam o dígito de controlo português: PT
    -- (o padrão das emigrantes, 8 casos nos sistemas actuais, 16/09/2026).
    pais := 'PT';
    numero := limpo;
  ELSE
    RAISE EXCEPTION 'customers.nif_country_required: sem prefixo nem país, não se sabe de que país é o NIF';
  END IF;
  IF numero !~ '^[A-Z0-9]{2,20}$' THEN
    RAISE EXCEPTION 'customers.nif_invalid: o NIF tem caracteres ou um tamanho que não são de um número fiscal';
  END IF;
  IF pais = 'PT' AND NOT public.nif_portugues_valido(numero) THEN
    RAISE EXCEPTION 'customers.nif_invalid: não é um NIF português válido';
  END IF;
END
$$;

-- O país do comerciante (para o prefixo e o VIES): o das entidades legais
-- activas, se for um só; com entidades em dois países, nenhum (o NIF
-- mostra-se sempre com prefixo).
CREATE FUNCTION pais_do_comerciante(p_comerciante uuid) RETURNS text
  LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT CASE WHEN count(DISTINCT e.pais) = 1 THEN min(e.pais) END
  FROM public.entidade_legal e
  WHERE e.comerciante_id = p_comerciante AND e.estado = 'activa'
$$;

-- O NIF como se guarda e mostra (§3.3): com o prefixo fiscal, excepto no país
-- do comerciante. Fora da UE, só o número (os prefixos de fora não estão
-- verificados — C).
CREATE FUNCTION nif_com_prefixo(p_pais text, p_numero text, p_pais_comerciante text)
  RETURNS text
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT CASE
    WHEN p_numero IS NULL THEN NULL
    WHEN p_pais = p_pais_comerciante THEN p_numero
    ELSE coalesce(public.prefixo_fiscal(p_pais), '') || p_numero
  END
$$;

-- --------------------------------------------------------------- A ficha

CREATE FUNCTION emails_validos(p text[]) RETURNS boolean
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT cardinality(p) <= 10
    AND NOT EXISTS (SELECT FROM unnest(p) e
      WHERE e IS NULL OR length(e) > 254 OR e !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
    AND cardinality(p) = (SELECT count(DISTINCT lower(e)) FROM unnest(p) e)
$$;

CREATE FUNCTION telefones_validos(p text[]) RETURNS boolean
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT cardinality(p) <= 10
    AND NOT EXISTS (SELECT FROM unnest(p) t WHERE t IS NULL OR t !~ '^\+[1-9][0-9]{6,14}$')
    AND cardinality(p) = (SELECT count(DISTINCT t) FROM unnest(p) t)
$$;

CREATE TABLE cliente (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  -- Como o cliente o escreveu; nunca decide identidade (R10).
  nome text NOT NULL,
  -- O primeiro é o de contacto; não são únicos no comerciante (§3.1).
  emails text[] NOT NULL DEFAULT '{}',
  telefones text[] NOT NULL DEFAULT '{}',
  lingua text,
  -- País de residência declarado; não é o do contribuinte.
  pais text,
  estado text NOT NULL DEFAULT 'activo'
    CHECK (estado IN ('activo', 'fundido', 'pseudonimizado')),
  -- Da parte 2 (fusões e limitação); ficam já, para o modelo não mudar.
  fundido_em uuid,
  limitado boolean NOT NULL DEFAULT false,
  criado_em timestamptz NOT NULL DEFAULT now(),
  actualizado_em timestamptz NOT NULL DEFAULT now(),
  versao integer NOT NULL DEFAULT 1,
  CONSTRAINT cliente_nome_check CHECK (length(btrim(nome)) > 0 AND length(nome) <= 200),
  CONSTRAINT cliente_emails_validos CHECK (emails_validos(emails)),
  CONSTRAINT cliente_telefones_validos CHECK (telefones_validos(telefones)),
  CONSTRAINT cliente_lingua_valida CHECK (lingua IS NULL OR lingua ~ '^[a-z]{2,3}(-[A-Z]{2})?$'),
  CONSTRAINT cliente_pais_valido CHECK (pais IS NULL OR pais ~ '^[A-Z]{2}$'),
  CONSTRAINT cliente_fundido_inteiro CHECK ((estado = 'fundido') = (fundido_em IS NOT NULL)),
  UNIQUE (comerciante_id, id)
);
CREATE INDEX cliente_por_comerciante ON cliente (comerciante_id, id);

CREATE FUNCTION cliente_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.estado <> 'activo' THEN
      RAISE EXCEPTION 'customers.invalid_transition: uma ficha nasce activa';
    END IF;
    NEW.versao := 1;
    NEW.criado_em := now();
    NEW.actualizado_em := now();
    RETURN NEW;
  END IF;
  IF NEW.id <> OLD.id OR NEW.comerciante_id <> OLD.comerciante_id THEN
    RAISE EXCEPTION 'customers.immutable_identity: o id e o comerciante de uma ficha não mudam';
  END IF;
  IF OLD.estado <> 'activo' THEN
    RAISE EXCEPTION 'customers.invalid_transition: uma ficha % não se altera', OLD.estado;
  END IF;
  NEW.criado_em := OLD.criado_em;
  NEW.actualizado_em := now();
  NEW.versao := OLD.versao + 1;
  RETURN NEW;
END
$$;
CREATE TRIGGER cliente_antes_de_gravar
  BEFORE INSERT OR UPDATE ON cliente
  FOR EACH ROW EXECUTE FUNCTION cliente_antes_de_gravar();

-- ------------------------------------------------------- Perfil de faturação

CREATE TABLE perfil_faturacao (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  cliente_id uuid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('particular', 'empresa')),
  nome_documento text NOT NULL,
  -- Exactamente o que a pessoa escreveu; mantém-se sempre (§3.2).
  nif_escrito text,
  -- Postos pela régua (nif_regua), não pela API.
  pais_contribuinte text,
  nif_numero text,
  morada_linha1 text,
  morada_linha2 text,
  morada_codigo_postal text,
  morada_localidade text,
  morada_pais text,
  principal boolean NOT NULL DEFAULT false,
  estado_vies text NOT NULL DEFAULT 'nao_aplicavel' CHECK (estado_vies IN (
    'nao_aplicavel', 'por_validar', 'valido', 'invalido', 'indisponivel')),
  estado text NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'arquivado')),
  usado_em_documento boolean NOT NULL DEFAULT false,
  criado_em timestamptz NOT NULL DEFAULT now(),
  actualizado_em timestamptz NOT NULL DEFAULT now(),
  versao integer NOT NULL DEFAULT 1,
  CONSTRAINT perfil_nome_documento_check CHECK (
    length(btrim(nome_documento)) > 0 AND length(nome_documento) <= 200),
  CONSTRAINT perfil_nif_escrito_check CHECK (nif_escrito IS NULL OR length(nif_escrito) <= 40),
  CONSTRAINT perfil_nif_inteiro CHECK (
    (nif_escrito IS NULL) = (nif_numero IS NULL) AND (nif_numero IS NULL) = (pais_contribuinte IS NULL)),
  -- Uma empresa sem NIF não tem como ser faturada como tal (§3.2, proposta).
  CONSTRAINT perfil_empresa_com_nif CHECK (tipo = 'particular' OR nif_numero IS NOT NULL),
  CONSTRAINT perfil_morada_inteira CHECK (
    (morada_linha1 IS NULL AND morada_linha2 IS NULL AND morada_codigo_postal IS NULL
      AND morada_localidade IS NULL AND morada_pais IS NULL)
    OR (morada_linha1 IS NOT NULL AND morada_codigo_postal IS NOT NULL
      AND morada_localidade IS NOT NULL AND morada_pais IS NOT NULL)),
  CONSTRAINT perfil_morada_valida CHECK (
    (morada_linha1 IS NULL OR length(btrim(morada_linha1)) BETWEEN 1 AND 200)
    AND (morada_linha2 IS NULL OR length(morada_linha2) <= 200)
    AND (morada_codigo_postal IS NULL OR length(btrim(morada_codigo_postal)) BETWEEN 1 AND 20)
    AND (morada_localidade IS NULL OR length(btrim(morada_localidade)) BETWEEN 1 AND 100)
    AND (morada_pais IS NULL OR morada_pais ~ '^[A-Z]{2}$')),
  CONSTRAINT perfil_principal_activo CHECK (NOT principal OR estado = 'activo'),
  UNIQUE (comerciante_id, id),
  CONSTRAINT perfil_do_cliente FOREIGN KEY (comerciante_id, cliente_id)
    REFERENCES cliente (comerciante_id, id)
);
CREATE INDEX perfil_por_cliente ON perfil_faturacao (comerciante_id, cliente_id);
-- A procura por NIF e, na parte 2, os duplicados: pelo número (§3.3).
CREATE INDEX perfil_por_nif ON perfil_faturacao (comerciante_id, nif_numero)
  WHERE nif_numero IS NOT NULL;
-- R5: um principal por ficha, na base.
CREATE UNIQUE INDEX perfil_um_principal ON perfil_faturacao (cliente_id) WHERE principal;

CREATE FUNCTION perfil_antes_de_gravar() RETURNS trigger
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
  ELSE
    NEW.estado_vies := OLD.estado_vies;
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
CREATE TRIGGER perfil_antes_de_gravar
  BEFORE INSERT OR UPDATE ON perfil_faturacao
  FOR EACH ROW EXECUTE FUNCTION perfil_antes_de_gravar();

-- Trocar o principal (§7.1, make-primary): numa só chamada, para não ficar
-- uma ficha sem principal entre duas escritas. Com os direitos do dono: a API
-- não escreve a coluna `principal` (revisão do #234, P3-2); o RLS forçado
-- aplica-se ao dono, com o comerciante da transacção. Toma a ficha antes dos
-- perfis, pela ordem do gatilho (P3-1).
CREATE FUNCTION perfil_tornar_principal(p_perfil uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  perfil record;
  ficha uuid;
BEGIN
  SELECT p.cliente_id INTO ficha FROM public.perfil_faturacao p WHERE p.id = p_perfil;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'customers.not_found: o perfil não existe';
  END IF;
  PERFORM FROM public.cliente c WHERE c.id = ficha FOR UPDATE;
  SELECT p.cliente_id, p.estado, p.principal INTO perfil
  FROM public.perfil_faturacao p WHERE p.id = p_perfil;
  IF perfil.estado <> 'activo' THEN
    RAISE EXCEPTION 'customers.invalid_transition: só um perfil activo é o principal';
  END IF;
  IF perfil.principal THEN
    RETURN;
  END IF;
  UPDATE public.perfil_faturacao SET principal = false
  WHERE cliente_id = perfil.cliente_id AND principal;
  UPDATE public.perfil_faturacao SET principal = true WHERE id = p_perfil;
END
$$;

-- ---------------------------------------------------------------- Etiquetas

CREATE TABLE etiqueta_cliente (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  nome text NOT NULL,
  estado text NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa', 'arquivada')),
  criado_em timestamptz NOT NULL DEFAULT now(),
  actualizado_em timestamptz NOT NULL DEFAULT now(),
  versao integer NOT NULL DEFAULT 1,
  CONSTRAINT etiqueta_cliente_nome_check CHECK (length(btrim(nome)) > 0 AND length(nome) <= 100),
  UNIQUE (comerciante_id, id)
);
CREATE UNIQUE INDEX etiqueta_cliente_nome_unico
  ON etiqueta_cliente (comerciante_id, lower(btrim(nome)));

-- As etiquetas que as listas B2B já referiam (a 0017 guardava só o id):
-- nascem com um nome que o diz, para a chave estrangeira entrar validada e
-- nenhuma lista deixar de se aplicar. Antes do RLS e do rasto: é a migração.
-- A lista tem o RLS forçado e a migração corre sem comerciante: o NO FORCE só
-- dura esta transacção (como o preenchimento da 0035).
--
-- Uma etiqueta por (comerciante, id): o nome começa pelo id, para nunca
-- repetir (o nome das listas não é único; revisão do #234, P1-2). O mesmo id
-- em dois comerciantes (a 0017 não lhe dava dono) fica com o primeiro; os
-- outros recebem um id novo e as listas deles passam a apontar para ele.
ALTER TABLE lista_precos NO FORCE ROW LEVEL SECURITY;
CREATE TEMPORARY TABLE etiqueta_0037 ON COMMIT DROP AS
SELECT x.comerciante_id, x.antigo,
  CASE WHEN row_number() OVER (PARTITION BY x.antigo ORDER BY x.primeira) = 1
    THEN x.antigo ELSE uuidv7() END AS novo,
  x.nome_lista
FROM (
  SELECT DISTINCT ON (l.comerciante_id, l.etiqueta_id)
    l.comerciante_id, l.etiqueta_id AS antigo, l.id AS primeira, l.nome AS nome_lista
  FROM lista_precos l
  WHERE l.etiqueta_id IS NOT NULL
  ORDER BY l.comerciante_id, l.etiqueta_id, l.id
) x;
INSERT INTO etiqueta_cliente (id, comerciante_id, nome)
SELECT novo, comerciante_id,
  left('Etiqueta ' || novo || ' (da lista «' || nome_lista || '», 0037)', 100)
FROM etiqueta_0037;
-- O gatilho da lista lê o mercado, com o RLS forçado e sem comerciante:
-- desligado só nesta troca de identificador (a versão da lista não sobe).
ALTER TABLE lista_precos DISABLE TRIGGER lista_precos_antes_de_gravar;
UPDATE lista_precos l SET etiqueta_id = m.novo
FROM etiqueta_0037 m
WHERE l.comerciante_id = m.comerciante_id AND l.etiqueta_id = m.antigo
  AND m.novo <> m.antigo;
ALTER TABLE lista_precos ENABLE TRIGGER lista_precos_antes_de_gravar;

ALTER TABLE lista_precos ADD CONSTRAINT lista_precos_da_etiqueta
  FOREIGN KEY (comerciante_id, etiqueta_id) REFERENCES etiqueta_cliente (comerciante_id, id);
-- A validação da chave lê as listas com o RLS: só depois volta o FORCE.
ALTER TABLE lista_precos FORCE ROW LEVEL SECURITY;

CREATE TABLE cliente_etiqueta (
  comerciante_id uuid NOT NULL,
  cliente_id uuid NOT NULL,
  etiqueta_id uuid NOT NULL,
  posta_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cliente_id, etiqueta_id),
  CONSTRAINT cliente_etiqueta_do_cliente FOREIGN KEY (comerciante_id, cliente_id)
    REFERENCES cliente (comerciante_id, id),
  CONSTRAINT cliente_etiqueta_da_etiqueta FOREIGN KEY (comerciante_id, etiqueta_id)
    REFERENCES etiqueta_cliente (comerciante_id, id)
);
CREATE INDEX cliente_etiqueta_por_etiqueta ON cliente_etiqueta (comerciante_id, etiqueta_id);

CREATE FUNCTION etiqueta_cliente_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.estado <> 'activa' THEN
      RAISE EXCEPTION 'customers.invalid_transition: uma etiqueta nasce activa';
    END IF;
    NEW.versao := 1;
    NEW.criado_em := now();
    NEW.actualizado_em := now();
    RETURN NEW;
  END IF;
  IF NEW.id <> OLD.id OR NEW.comerciante_id <> OLD.comerciante_id THEN
    RAISE EXCEPTION 'customers.immutable_identity: o id e o comerciante de uma etiqueta não mudam';
  END IF;
  IF OLD.estado = 'activa' AND NEW.estado = 'arquivada' AND EXISTS (
    SELECT FROM public.lista_precos l
    WHERE l.comerciante_id = NEW.comerciante_id AND l.etiqueta_id = NEW.id
      AND l.estado = 'activa') THEN
    RAISE EXCEPTION 'customers.tag_in_use: a etiqueta está numa lista de preços B2B activa; arquive a lista primeiro';
  END IF;
  NEW.criado_em := OLD.criado_em;
  NEW.actualizado_em := now();
  NEW.versao := OLD.versao + 1;
  RETURN NEW;
END
$$;
CREATE TRIGGER etiqueta_cliente_antes_de_gravar
  BEFORE INSERT OR UPDATE ON etiqueta_cliente
  FOR EACH ROW EXECUTE FUNCTION etiqueta_cliente_antes_de_gravar();

-- Pôr uma etiqueta: a ficha activa e a etiqueta activa.
CREATE FUNCTION cliente_etiqueta_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  estado_da_ficha text;
  estado_da_etiqueta text;
BEGIN
  SELECT c.estado INTO estado_da_ficha FROM public.cliente c
  WHERE c.comerciante_id = NEW.comerciante_id AND c.id = NEW.cliente_id;
  SELECT e.estado INTO estado_da_etiqueta FROM public.etiqueta_cliente e
  WHERE e.comerciante_id = NEW.comerciante_id AND e.id = NEW.etiqueta_id
  FOR SHARE;
  IF estado_da_ficha IS NULL OR estado_da_etiqueta IS NULL THEN
    RAISE EXCEPTION 'customers.not_found: a ficha ou a etiqueta não existem';
  END IF;
  IF estado_da_ficha <> 'activo' THEN
    RAISE EXCEPTION 'customers.invalid_transition: a ficha está %', estado_da_ficha;
  END IF;
  IF estado_da_etiqueta <> 'activa' THEN
    RAISE EXCEPTION 'customers.tag_archived: a etiqueta está arquivada';
  END IF;
  NEW.posta_em := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER cliente_etiqueta_antes_de_gravar
  BEFORE INSERT ON cliente_etiqueta
  FOR EACH ROW EXECUTE FUNCTION cliente_etiqueta_antes_de_gravar();

-- Uma lista B2B activa aponta para uma etiqueta activa (a chave estrangeira
-- já garante que existe e é do comerciante).
CREATE FUNCTION lista_precos_etiqueta_activa() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  estado_da_etiqueta text;
BEGIN
  IF NEW.etiqueta_id IS NULL OR NEW.estado <> 'activa' THEN
    RETURN NEW;
  END IF;
  -- FOR SHARE, só pelo id: espera por um arquivo da etiqueta em curso e lê
  -- o estado depois dele (sem isto, arquivar a etiqueta e repor a lista ao
  -- mesmo tempo deixavam uma lista activa com a etiqueta arquivada; revisão
  -- do #234, P2-3). A chave estrangeira diz se existe.
  SELECT e.estado INTO estado_da_etiqueta FROM public.etiqueta_cliente e
  WHERE e.comerciante_id = NEW.comerciante_id AND e.id = NEW.etiqueta_id
  FOR SHARE;
  IF estado_da_etiqueta = 'arquivada' THEN
    RAISE EXCEPTION 'prices.label_archived: a etiqueta de cliente está arquivada';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER lista_precos_etiqueta_activa
  BEFORE INSERT OR UPDATE OF etiqueta_id, estado ON lista_precos
  FOR EACH ROW EXECUTE FUNCTION lista_precos_etiqueta_activa();

-- -------------------------------------------------------------------- Rasto

CREATE TABLE alteracao_cliente (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  -- Vazio nas alterações de uma etiqueta (não são de uma ficha).
  cliente_id uuid,
  entidade text NOT NULL CHECK (entidade IN (
    'cliente', 'perfil_faturacao', 'etiqueta_cliente', 'cliente_etiqueta')),
  entidade_id uuid,
  operacao text NOT NULL CHECK (operacao IN ('criado', 'alterado', 'apagado')),
  campos jsonb NOT NULL CHECK (jsonb_typeof(campos) = 'object' AND campos <> '{}'),
  quem text NOT NULL CHECK (length(quem) BETWEEN 1 AND 200),
  origem text CHECK (origem IS NULL OR length(origem) BETWEEN 1 AND 200),
  transacao uuid NOT NULL,
  em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX alteracao_cliente_por_cliente
  ON alteracao_cliente (comerciante_id, cliente_id, id);

CREATE TRIGGER alteracao_cliente_so_se_acrescenta
  BEFORE UPDATE OR DELETE ON alteracao_cliente
  FOR EACH ROW EXECUTE FUNCTION rasto_so_se_acrescenta();
CREATE TRIGGER alteracao_cliente_sem_truncate
  BEFORE TRUNCATE ON alteracao_cliente
  FOR EACH STATEMENT EXECUTE FUNCTION rasto_so_se_acrescenta();
ALTER TABLE alteracao_cliente ENABLE ALWAYS TRIGGER alteracao_cliente_so_se_acrescenta;
ALTER TABLE alteracao_cliente ENABLE ALWAYS TRIGGER alteracao_cliente_sem_truncate;

CREATE FUNCTION clientes_sem_tecnicos(j jsonb) RETURNS jsonb
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT j - ARRAY['id', 'comerciante_id', 'criado_em', 'actualizado_em',
                   'versao', 'posta_em']
$$;

-- Os campos que mudaram, sem os técnicos (como a 0033).
CREATE FUNCTION clientes_campos_mudados(p_op text, p_antes jsonb, p_depois jsonb)
  RETURNS jsonb
  LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  antes jsonb := coalesce(public.clientes_sem_tecnicos(p_antes), '{}');
  depois jsonb := coalesce(public.clientes_sem_tecnicos(p_depois), '{}');
  campos jsonb := '{}';
  chave text;
BEGIN
  FOR chave IN SELECT k FROM jsonb_object_keys(antes || depois) AS k LOOP
    CONTINUE WHEN p_op = 'INSERT' AND jsonb_typeof(depois -> chave) = 'null';
    CONTINUE WHEN p_op = 'DELETE' AND jsonb_typeof(antes -> chave) = 'null';
    IF (antes -> chave) IS DISTINCT FROM (depois -> chave) THEN
      campos := campos || jsonb_build_object(chave, jsonb_build_object(
        'antes', antes -> chave, 'depois', depois -> chave));
    END IF;
  END LOOP;
  RETURN campos;
END
$$;

CREATE FUNCTION clientes_escrever_alteracao() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem text := nullif(btrim(current_setting('eurolify.quem', true)), '');
  origem text := nullif(btrim(current_setting('eurolify.origem', true)), '');
  linha jsonb := CASE TG_OP WHEN 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  campos jsonb;
  transacao uuid;
BEGIN
  campos := public.clientes_campos_mudados(TG_OP,
    CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END);
  IF campos = '{}' THEN
    RETURN NULL;
  END IF;
  IF quem IS NULL THEN
    RAISE EXCEPTION 'customers.change_without_who: % em % sem eurolify.quem', TG_OP, TG_TABLE_NAME;
  END IF;
  transacao := nullif(current_setting('eurolify.transacao_rasto', true), '')::uuid;
  IF transacao IS NULL THEN
    transacao := uuidv7();
    PERFORM set_config('eurolify.transacao_rasto', transacao::text, true);
  END IF;
  INSERT INTO public.alteracao_cliente (comerciante_id, cliente_id, entidade,
    entidade_id, operacao, campos, quem, origem, transacao)
  VALUES ((linha ->> 'comerciante_id')::uuid,
    CASE TG_TABLE_NAME
      WHEN 'cliente' THEN (linha ->> 'id')::uuid
      WHEN 'etiqueta_cliente' THEN NULL
      ELSE (linha ->> 'cliente_id')::uuid
    END,
    TG_TABLE_NAME,
    CASE TG_TABLE_NAME WHEN 'cliente_etiqueta' THEN NULL ELSE (linha ->> 'id')::uuid END,
    CASE TG_OP WHEN 'INSERT' THEN 'criado' WHEN 'UPDATE' THEN 'alterado' ELSE 'apagado' END,
    campos, quem, origem, transacao);
  RETURN NULL;
END
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cliente', 'perfil_faturacao', 'etiqueta_cliente',
    'cliente_etiqueta'] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION clientes_escrever_alteracao()',
      t || '_rasto', t);
    EXECUTE format('ALTER TABLE %I ENABLE ALWAYS TRIGGER %I', t, t || '_rasto');
  END LOOP;
END
$$;

-- ------------------------------------------------------------------ Eventos

-- Só identificadores e os nomes dos campos (R12): o receptor pede o resto à
-- API, com o âmbito.
CREATE FUNCTION clientes_evento() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  campos jsonb;
  nomes jsonb;
  dados jsonb;
  quem text := nullif(btrim(current_setting('eurolify.quem', true)), '');
BEGIN
  campos := public.clientes_campos_mudados(TG_OP,
    CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) END, to_jsonb(NEW));
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
CREATE TRIGGER cliente_evento
  AFTER INSERT OR UPDATE ON cliente
  FOR EACH ROW EXECUTE FUNCTION clientes_evento();
CREATE TRIGGER perfil_faturacao_evento
  AFTER INSERT OR UPDATE ON perfil_faturacao
  FOR EACH ROW EXECUTE FUNCTION clientes_evento();

-- ----------------------------------------------------- RLS e permissões

DO $$
DECLARE
  tabela text;
BEGIN
  FOREACH tabela IN ARRAY ARRAY['cliente', 'perfil_faturacao', 'etiqueta_cliente',
    'cliente_etiqueta'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tabela);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tabela);
    EXECUTE format(
      'CREATE POLICY so_o_proprio ON %I USING (comerciante_id = comerciante_actual()) WITH CHECK (comerciante_id = comerciante_actual())',
      tabela);
  END LOOP;
END
$$;

ALTER TABLE alteracao_cliente ENABLE ROW LEVEL SECURITY;
ALTER TABLE alteracao_cliente FORCE ROW LEVEL SECURITY;
-- Como a 0033: ler, só as do comerciante posto; escrever, só o gatilho.
CREATE POLICY ler_o_proprio ON alteracao_cliente FOR SELECT
  USING (comerciante_id = comerciante_actual());
CREATE POLICY escreve_o_gatilho ON alteracao_cliente FOR INSERT
  WITH CHECK (true);

GRANT SELECT ON cliente, perfil_faturacao, etiqueta_cliente, cliente_etiqueta,
  alteracao_cliente TO eurolify_api;
GRANT INSERT (comerciante_id, nome, emails, telefones, lingua, pais) ON cliente TO eurolify_api;
GRANT UPDATE (nome, emails, telefones, lingua, pais) ON cliente TO eurolify_api;
GRANT INSERT (comerciante_id, cliente_id, tipo, nome_documento, nif_escrito, pais_contribuinte,
  morada_linha1, morada_linha2, morada_codigo_postal, morada_localidade, morada_pais)
  ON perfil_faturacao TO eurolify_api;
GRANT UPDATE (tipo, nome_documento, nif_escrito, pais_contribuinte, morada_linha1,
  morada_linha2, morada_codigo_postal, morada_localidade, morada_pais, estado)
  ON perfil_faturacao TO eurolify_api;
GRANT INSERT (comerciante_id, nome) ON etiqueta_cliente TO eurolify_api;
GRANT UPDATE (nome, estado) ON etiqueta_cliente TO eurolify_api;
GRANT INSERT (comerciante_id, cliente_id, etiqueta_id), DELETE ON cliente_etiqueta TO eurolify_api;

REVOKE EXECUTE ON FUNCTION prefixo_fiscal(text), pais_do_prefixo_fiscal(text),
  nif_limpo(text), nif_para_procura(text),
  nif_portugues_valido(text), nif_regua(text, text, boolean), pais_do_comerciante(uuid),
  nif_com_prefixo(text, text, text), emails_validos(text[]), telefones_validos(text[]),
  cliente_antes_de_gravar(), perfil_antes_de_gravar(), perfil_tornar_principal(uuid),
  etiqueta_cliente_antes_de_gravar(), cliente_etiqueta_antes_de_gravar(),
  lista_precos_etiqueta_activa(), clientes_sem_tecnicos(jsonb),
  clientes_campos_mudados(text, jsonb, jsonb), clientes_escrever_alteracao(),
  clientes_evento() FROM PUBLIC;
-- Os gatilhos correm com os direitos de quem escreve: precisam destas.
GRANT EXECUTE ON FUNCTION prefixo_fiscal(text), pais_do_prefixo_fiscal(text),
  nif_limpo(text), nif_para_procura(text),
  nif_portugues_valido(text), nif_regua(text, text, boolean), pais_do_comerciante(uuid),
  nif_com_prefixo(text, text, text), emails_validos(text[]), telefones_validos(text[]),
  perfil_tornar_principal(uuid) TO eurolify_api;

-- ------------------------------------------------------------- Os âmbitos

ALTER TABLE chave_api DROP CONSTRAINT chave_api_ambitos_validos;
ALTER TABLE chave_api ADD CONSTRAINT chave_api_ambitos_validos CHECK (
  cardinality(ambitos) BETWEEN 1 AND 20
  AND ambitos <@ ARRAY[
    'merchant:read', 'merchant:write',
    'catalog:read', 'catalog:write', 'catalog:publish', 'catalog:import',
    'catalog:history', 'prices:read', 'prices:write',
    'customers:read', 'customers:write', 'customers:billing', 'keys:write',
    'storefront'
  ]::text[]);

CREATE OR REPLACE FUNCTION papel_ambitos(p_papel text) RETURNS text[]
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT CASE p_papel
    WHEN 'dono' THEN ARRAY['catalog:history', 'catalog:import', 'catalog:publish',
                           'catalog:read', 'catalog:write', 'customers:billing',
                           'customers:read', 'customers:write', 'keys:write',
                           'merchant:read',
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
