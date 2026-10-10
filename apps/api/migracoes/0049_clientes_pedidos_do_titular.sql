-- Clientes, parte 2c: os pedidos do titular (docs/23 §4.1, R9, §7.1; issue
-- #233; Diogo, 10/10/2026: «sim, avança com a parte 2c»). Ex.: a Ana pede
-- para ser esquecida; o dono confirma a identidade dela por e-mail, escreve
-- «pseudonimizar cus_…» e a ficha fica «Pseudonimizado», sem e-mails,
-- telefones nem consentimentos; a fatura de 09/10 continua a bater certo.
--
-- O que esta migração faz (skill eu-gdpr-privacy, «Pedidos dos titulares» e
-- «Retenção e apagamento»):
-- - o registo dos pedidos (pedido_titular): quem pediu o quê, como se
--   verificou a identidade, quem fez e quando; só se acrescenta;
-- - a limitação (cliente_limitar): liga e desliga a bandeira limitado; com
--   ela, a régua do marketing dá não e a API não muda o nome nem os
--   contactos (trava alterações sem apagar);
-- - a pseudonimização (cliente_pseudonimizar), irreversível, só por uma
--   pessoa ou a chave dela e com a confirmação escrita, sobre o grupo
--   inteiro (a ficha e as fundidas nela; revisão do #298, P3-3):
--   - o nome passa a «Pseudonimizado»; e-mails, telefones, língua e país
--     apagam-se; a ficha fica pseudonimizado (as fundidas ficam fundido);
--   - os consentimentos de marketing e as etiquetas apagam-se;
--   - os perfis que nenhum documento nem encomenda usou ficam sem nome, NIF
--     nem morada, arquivados; as provas do VIES deles apagam-se e as
--     isenções deles perdem o NIF, a nota e os motivos escritos (revisão do
--     #244, P3-11; revisão do #314, P1-1 e P2-3);
--   - os perfis usados num documento ou apontados por uma encomenda ficam
--     como estão, com as provas do VIES e as isenções, o prazo fiscal (R9;
--     10 anos em Portugal, art. 52.º do CIVA, W; os outros países não
--     verifiquei, C);
--   - a linha do tempo do grupo perde os valores pessoais (nome, contactos,
--     NIF, morada, texto dos consentimentos), salvo os dos perfis usados
--     (P2-4 da revisão do #234);
--   - os candidatos a duplicado do grupo fecham; o evento
--     customer.pseudonymized.
-- - o âmbito customers:privacy, só no dono (docs/23 §7).
--
-- As recusas de alterar ou apagar (a prova, a linha do tempo, a ficha que
-- não está activa) abrem-se **só** dentro da cliente_pseudonimizar: a marca
-- é uma linha da transacção numa tabela só do dono, e só vale quando quem
-- escreve é o dono das tabelas. Uma prova nova do VIES já não se grava numa
-- ficha que não esteja activa.
--
-- O que não faz: os dados que o checkout e as encomendas guardam (o
-- contacto, a entrega, a cópia do perfil) são desses domínios e ficam para
-- eles (docs/23 §7.1, «os outros domínios juntam o seu»); o resultado do
-- apagamento conta essas encomendas, para quem pede saber que ainda há o
-- que tratar. A exportação junta as encomendas e as linhas delas, só para
-- ler.

SET LOCAL lock_timeout = '10s';

-- ------------------------------------------------- Quem pode abrir as recusas

-- Verdadeiro só dentro da cliente_pseudonimizar. A marca é uma linha com a
-- transacção, numa tabela onde só o dono escreve, e não um parâmetro da
-- sessão: um parâmetro a API podia pô-lo e depois chamar outra função do
-- dono, que herdava a abertura (revisão do #314, P2-1). A linha sai no fim
-- da função; um erro desfaz tudo.
CREATE TABLE pseudonimizacao_em_curso (transaccao xid8 PRIMARY KEY);
REVOKE ALL ON pseudonimizacao_em_curso FROM PUBLIC;

CREATE FUNCTION clientes_dono_a_escrever() RETURNS boolean
  LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT current_user = (SELECT pg_catalog.pg_get_userbyid(c.relowner)
                         FROM pg_catalog.pg_class c WHERE c.oid = 'public.cliente'::regclass)
$$;
CREATE FUNCTION clientes_pseudonimizacao_em_curso() RETURNS boolean
  LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  -- Primeiro o dono: a API nem lê a tabela.
  IF NOT public.clientes_dono_a_escrever() THEN
    RETURN false;
  END IF;
  RETURN EXISTS (SELECT FROM public.pseudonimizacao_em_curso m
                 WHERE m.transaccao = pg_catalog.pg_current_xact_id());
END
$$;

-- --------------------------------------------------------------- A ficha

CREATE OR REPLACE FUNCTION cliente_antes_de_gravar() RETURNS trigger
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
  -- Só a pseudonimização mexe numa ficha que não está activa (as fundidas
  -- do grupo).
  IF OLD.estado <> 'activo' AND NOT public.clientes_pseudonimizacao_em_curso() THEN
    RAISE EXCEPTION 'customers.invalid_transition: uma ficha % não se altera', OLD.estado;
  END IF;
  -- Limitada, a API não lhe muda os dados pessoais (trava alterações sem
  -- apagar); levanta-se a limitação primeiro. As funções do dono (fusão,
  -- pseudonimização) passam.
  IF OLD.limitado AND NEW.limitado AND NOT public.clientes_dono_a_escrever()
     AND (NEW.nome IS DISTINCT FROM OLD.nome OR NEW.emails IS DISTINCT FROM OLD.emails
       OR NEW.telefones IS DISTINCT FROM OLD.telefones
       OR NEW.lingua IS DISTINCT FROM OLD.lingua OR NEW.pais IS DISTINCT FROM OLD.pais) THEN
    RAISE EXCEPTION 'customers.restricted: a ficha está limitada a pedido do titular; levante a limitação para a alterar';
  END IF;
  NEW.criado_em := OLD.criado_em;
  NEW.actualizado_em := now();
  NEW.versao := OLD.versao + 1;
  RETURN NEW;
END
$$;

-- ------------------------------------------------------- Perfis e isenções

CREATE OR REPLACE FUNCTION perfil_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  estado_da_ficha text;
  regua record;
  pais_comerciante text;
BEGIN
  -- A pseudonimização (0049) limpa os perfis não usados em documentos, também
  -- nas fichas fundidas no grupo; nunca toca num perfil usado (R9).
  IF TG_OP = 'UPDATE' AND public.clientes_pseudonimizacao_em_curso() THEN
    IF NEW.id <> OLD.id OR NEW.comerciante_id <> OLD.comerciante_id
       OR NEW.cliente_id <> OLD.cliente_id THEN
      RAISE EXCEPTION 'customers.immutable_identity: o id, o comerciante e a ficha de um perfil não mudam';
    END IF;
    IF OLD.usado_em_documento THEN
      RAISE EXCEPTION 'customers.profile_used: um perfil usado num documento fica o prazo fiscal (R9)';
    END IF;
    NEW.nif_numero := NULL;
    NEW.estado_vies := 'nao_aplicavel';
    NEW.criado_em := OLD.criado_em;
    NEW.actualizado_em := now();
    NEW.versao := OLD.versao + 1;
    RETURN NEW;
  END IF;

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
  ELSIF current_setting('eurolify.vies_registar', true) IS DISTINCT FROM 'sim' THEN
    -- Só a `vies_registar` (com a resposta do VIES) muda o estado do VIES.
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

CREATE OR REPLACE FUNCTION isencao_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem text := nullif(btrim(current_setting('eurolify.quem', true)), '');
  do_perfil record;
BEGIN
  -- Lista branca, não lista negra (revisão do #244, P2-3): só uma pessoa
  -- (pelo Hub) ou a chave que ela usa.
  IF quem IS NULL OR quem !~ '^(pessoa:per_|chave:key_)' THEN
    RAISE EXCEPTION 'customers.exemption_by_person: a isenção manual só a põe ou retira uma pessoa (quem: %)',
      coalesce(quem, 'nenhum');
  END IF;
  IF TG_OP = 'INSERT' THEN
    -- FOR SHARE: espera por um arquivo do perfil em curso (P3-9).
    SELECT p.estado, p.pais_contribuinte, p.nif_numero INTO do_perfil
    FROM public.perfil_faturacao p
    WHERE p.comerciante_id = NEW.comerciante_id AND p.id = NEW.perfil_id
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'customers.not_found: o perfil não existe';
    END IF;
    IF do_perfil.estado <> 'activo' THEN
      RAISE EXCEPTION 'customers.invalid_transition: o perfil está arquivado';
    END IF;
    -- O código do motivo (docs/24 §10, Q4): obrigatório numa isenção nova,
    -- da lista do país do comerciante; sem país único, não há isenção.
    IF NEW.codigo_motivo IS NULL OR NOT EXISTS (
      SELECT FROM public.motivo_iva m
      WHERE m.pais = public.pais_do_comerciante(NEW.comerciante_id)
        AND m.codigo = NEW.codigo_motivo) THEN
      RAISE EXCEPTION 'customers.exemption_reason_code: o código do motivo não é da lista do país do comerciante';
    END IF;
    NEW.pais_contribuinte := do_perfil.pais_contribuinte;
    NEW.nif_numero := do_perfil.nif_numero;
    NEW.posta_por := quem;
    NEW.posta_em := now();
    NEW.motivo_retirada := NULL;
    NEW.retirada_por := NULL;
    NEW.retirada_em := NULL;
    RETURN NEW;
  END IF;
  -- A pseudonimização (0049) limpa o NIF, a nota e os motivos escritos à mão
  -- das isenções dos perfis não usados (revisão do #314, P2-3); o código do
  -- motivo e quem e quando ficam.
  IF public.clientes_pseudonimizacao_em_curso()
     AND NEW.nif_numero IS NULL AND NEW.pais_contribuinte IS NULL AND NEW.nota IS NULL
     AND NEW.id = OLD.id AND NEW.perfil_id = OLD.perfil_id
     AND NEW.motivo = '(pseudonimizado)'
     AND NEW.codigo_motivo IS NOT DISTINCT FROM OLD.codigo_motivo
     AND NEW.posta_por = OLD.posta_por AND NEW.posta_em = OLD.posta_em
     AND (NEW.motivo_retirada IS NULL) = (OLD.motivo_retirada IS NULL)
     AND coalesce(NEW.motivo_retirada, '(pseudonimizado)') = '(pseudonimizado)'
     AND NEW.retirada_por IS NOT DISTINCT FROM OLD.retirada_por
     AND NEW.retirada_em IS NOT DISTINCT FROM OLD.retirada_em THEN
    RETURN NEW;
  END IF;
  IF OLD.retirada_em IS NOT NULL OR NEW.motivo_retirada IS NULL
     OR NEW.id <> OLD.id OR NEW.comerciante_id <> OLD.comerciante_id
     OR NEW.perfil_id <> OLD.perfil_id OR NEW.motivo <> OLD.motivo
     OR NEW.pais_contribuinte IS DISTINCT FROM OLD.pais_contribuinte
     OR NEW.nif_numero IS DISTINCT FROM OLD.nif_numero
     OR NEW.codigo_motivo IS DISTINCT FROM OLD.codigo_motivo
     OR NEW.nota IS DISTINCT FROM OLD.nota OR NEW.posta_por <> OLD.posta_por
     OR NEW.posta_em <> OLD.posta_em THEN
    RAISE EXCEPTION 'customers.exemption_immutable: uma isenção não se altera; retira-se, uma vez, e põe-se outra';
  END IF;
  NEW.retirada_por := quem;
  NEW.retirada_em := now();
  RETURN NEW;
END
$$;

-- A isenção só avisa quando é posta ou retirada (não quando a
-- pseudonimização lhe limpa o NIF).
CREATE OR REPLACE FUNCTION isencao_evento() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (OLD.retirada_em IS NOT NULL OR NEW.retirada_em IS NULL) THEN
    RETURN NULL;
  END IF;
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

-- ------------------------------------------ As provas que só se acrescentam

-- Como a rasto_so_se_acrescenta (0008), mas a pseudonimização pode apagar
-- os consentimentos e as provas do VIES dos perfis não usados, e reescrever
-- a linha do tempo. Mais nada, nem mais ninguém.
CREATE FUNCTION clientes_so_se_acrescenta() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF public.clientes_pseudonimizacao_em_curso() AND (
       (TG_OP = 'DELETE' AND TG_TABLE_NAME IN ('consentimento', 'validacao_vies'))
       OR (TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'alteracao_cliente')) THEN
    RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION 'audit.append_only: % em % recusado: o rasto só se acrescenta (corrige-se com uma entrada nova)',
    TG_OP, TG_TABLE_NAME;
END
$$;
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['consentimento', 'alteracao_cliente', 'validacao_vies'] LOOP
    EXECUTE format('DROP TRIGGER %I ON %I', t || '_so_se_acrescenta', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION clientes_so_se_acrescenta()', t || '_so_se_acrescenta', t);
    EXECUTE format('ALTER TABLE %I ENABLE ALWAYS TRIGGER %I', t, t || '_so_se_acrescenta');
  END LOOP;
END
$$;

-- Uma prova nova do VIES só numa ficha activa. A consulta HTTP faz-se fora
-- da transacção: uma resposta que chegue depois da pseudonimização gravava o
-- NIF e o nome devolvido num perfil já em branco, para sempre (revisão do
-- #314, P1-3). A vies_registar toma a ficha antes de gravar, por isso aqui
-- já se lê o estado final; a fila trata o erro como uma consulta falhada e a
-- linha dela já saiu.
CREATE FUNCTION validacao_vies_so_em_ficha_activa() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  estado_da_ficha text;
BEGIN
  SELECT c.estado INTO estado_da_ficha
  FROM public.perfil_faturacao p
  JOIN public.cliente c ON c.comerciante_id = p.comerciante_id AND c.id = p.cliente_id
  WHERE p.comerciante_id = NEW.comerciante_id AND p.id = NEW.perfil_id;
  IF estado_da_ficha IS DISTINCT FROM 'activo' THEN
    RAISE EXCEPTION 'customers.invalid_transition: a ficha está %; a prova do VIES não se grava',
      coalesce(estado_da_ficha, 'por encontrar');
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER validacao_vies_so_em_ficha_activa
  BEFORE INSERT ON validacao_vies
  FOR EACH ROW EXECUTE FUNCTION validacao_vies_so_em_ficha_activa();
ALTER TABLE validacao_vies ENABLE ALWAYS TRIGGER validacao_vies_so_em_ficha_activa;

CREATE OR REPLACE FUNCTION cliente_etiqueta_antes_de_tirar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  estado_da_ficha text;
BEGIN
  SELECT c.estado INTO estado_da_ficha FROM public.cliente c
  WHERE c.comerciante_id = OLD.comerciante_id AND c.id = OLD.cliente_id;
  IF estado_da_ficha <> 'activo' AND NOT public.clientes_pseudonimizacao_em_curso() THEN
    RAISE EXCEPTION 'customers.invalid_transition: a ficha está %', estado_da_ficha;
  END IF;
  RETURN OLD;
END
$$;

-- ------------------------------------------------- O registo dos pedidos

CREATE TABLE pedido_titular (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  cliente_id uuid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('exportacao', 'limitacao', 'fim_da_limitacao', 'apagamento')),
  -- Como se confirmou que quem pediu é o titular (ex.: «resposta do e-mail
  -- da ficha a 10/10/2026»). É a prova de quem decidiu, não um dado novo.
  verificacao text NOT NULL CHECK (length(btrim(verificacao)) BETWEEN 1 AND 500),
  quem text NOT NULL,
  em timestamptz NOT NULL DEFAULT now(),
  -- O que se fez (contagens), sem dados pessoais.
  resultado jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(resultado) = 'object'),
  FOREIGN KEY (comerciante_id, cliente_id) REFERENCES cliente (comerciante_id, id)
);
CREATE INDEX pedido_titular_por_cliente ON pedido_titular (comerciante_id, cliente_id, id);
CREATE TRIGGER pedido_titular_so_se_acrescenta
  BEFORE UPDATE OR DELETE ON pedido_titular
  FOR EACH ROW EXECUTE FUNCTION rasto_so_se_acrescenta();
CREATE TRIGGER pedido_titular_sem_truncate
  BEFORE TRUNCATE ON pedido_titular
  FOR EACH STATEMENT EXECUTE FUNCTION rasto_so_se_acrescenta();
ALTER TABLE pedido_titular ENABLE ALWAYS TRIGGER pedido_titular_so_se_acrescenta;
ALTER TABLE pedido_titular ENABLE ALWAYS TRIGGER pedido_titular_sem_truncate;

CREATE FUNCTION pedido_titular_registar(p_cliente uuid, p_tipo text, p_verificacao text,
  p_resultado jsonb DEFAULT '{}') RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem text := public.clientes_quem_decide();
  id uuid;
BEGIN
  IF NOT EXISTS (SELECT FROM public.cliente c
    WHERE c.comerciante_id = public.comerciante_actual() AND c.id = p_cliente) THEN
    RAISE EXCEPTION 'customers.not_found: a ficha não existe';
  END IF;
  INSERT INTO public.pedido_titular (comerciante_id, cliente_id, tipo, verificacao, quem, resultado)
  VALUES (public.comerciante_actual(), p_cliente, p_tipo, p_verificacao, quem, p_resultado)
  RETURNING pedido_titular.id INTO id;
  RETURN id;
END
$$;

-- A API só regista a exportação, com o tipo e o resultado fixos: o registo
-- é a prova perante o titular e não se escreve à escolha (revisão do #314,
-- P2-2). A limitação e o apagamento registam-se dentro das funções deles.
CREATE FUNCTION pedido_titular_exportar(p_cliente uuid, p_verificacao text)
  RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  RETURN public.pedido_titular_registar(p_cliente, 'exportacao', p_verificacao,
    jsonb_build_object('fichas', cardinality(ARRAY(SELECT public.clientes_do_grupo(p_cliente)))));
END
$$;

-- ------------------------------------------------------------ A limitação

CREATE FUNCTION cliente_limitar(p_cliente uuid, p_limitar boolean, p_verificacao text)
  RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  ficha record;
BEGIN
  PERFORM public.clientes_quem_decide();
  SELECT c.estado INTO ficha FROM public.cliente c
  WHERE c.comerciante_id = public.comerciante_actual() AND c.id = p_cliente
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'customers.not_found: a ficha não existe';
  END IF;
  IF ficha.estado <> 'activo' THEN
    RAISE EXCEPTION 'customers.invalid_transition: a ficha está %; peça pela ficha que ficou', ficha.estado;
  END IF;
  UPDATE public.cliente SET limitado = p_limitar WHERE id = p_cliente;
  RETURN public.pedido_titular_registar(p_cliente,
    CASE WHEN p_limitar THEN 'limitacao' ELSE 'fim_da_limitacao' END, p_verificacao);
END
$$;

-- ------------------------------------------------------ A pseudonimização

-- Os campos da linha do tempo que são da pessoa, ou texto livre que pode
-- falar dela (os motivos e as notas; revisão do #314, P2-3): os valores
-- saem, fica que mudaram.
CREATE FUNCTION clientes_rasto_sem_dados(p_campos jsonb) RETURNS jsonb
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT coalesce(jsonb_object_agg(k, CASE WHEN k = ANY (ARRAY['nome', 'emails',
      'telefones', 'lingua', 'pais', 'nome_documento', 'nif_escrito', 'nif_numero',
      'pais_contribuinte', 'morada_linha1', 'morada_linha2', 'morada_codigo_postal',
      'morada_localidade', 'morada_pais', 'texto', 'onde', 'motivo', 'motivo_retirada',
      'nota'])
    THEN jsonb_build_object(
      'antes', CASE WHEN jsonb_typeof(v -> 'antes') IN ('null') OR (v -> 'antes') IS NULL
                 THEN 'null'::jsonb ELSE to_jsonb('(pseudonimizado)'::text) END,
      'depois', CASE WHEN jsonb_typeof(v -> 'depois') IN ('null') OR (v -> 'depois') IS NULL
                 THEN 'null'::jsonb ELSE to_jsonb('(pseudonimizado)'::text) END)
    ELSE v END), '{}')
  FROM jsonb_each(p_campos) AS e (k, v)
$$;

CREATE FUNCTION cliente_pseudonimizar(p_cliente uuid, p_confirmacao text, p_verificacao text)
  RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  comerciante uuid := public.comerciante_actual();
  quem text := public.clientes_quem_decide();
  ficha record;
  grupo uuid[];
  usados uuid[];
  nao_usados uuid[];
  resultado jsonb;
  n_consentimentos integer;
  n_etiquetas integer;
  n_validacoes integer;
  n_isencoes integer;
  n_rasto integer;
  n_encomendas integer;
BEGIN
  -- Irreversível: a confirmação escreve o que vai acontecer (como as acções
  -- do MCP da VPS).
  IF p_confirmacao IS DISTINCT FROM 'pseudonimizar cus_' || p_cliente::text THEN
    -- A mensagem não repete a frase: quem confirma escreve-a (P3-5).
    RAISE EXCEPTION 'customers.confirmation_required: escreva «pseudonimizar» seguido de um espaço e do id da ficha para confirmar';
  END IF;
  -- A ficha pedida tomada primeiro, e só depois o grupo: uma fusão para ela
  -- precisa deste bloqueio, e as fundidas já não mudam, por isso o grupo
  -- lido a seguir está completo (revisão do #314, P1-2).
  SELECT c.estado INTO ficha FROM public.cliente c
  WHERE c.comerciante_id = comerciante AND c.id = p_cliente
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'customers.not_found: a ficha não existe';
  END IF;
  IF ficha.estado <> 'activo' THEN
    RAISE EXCEPTION 'customers.invalid_transition: a ficha está %; peça pela ficha que ficou', ficha.estado;
  END IF;
  grupo := ARRAY(SELECT public.clientes_do_grupo(p_cliente));
  -- As outras fichas do grupo, pela ordem dos ids (como a fusão).
  PERFORM 1 FROM public.cliente c
  WHERE c.comerciante_id = comerciante AND c.id = ANY (grupo)
  ORDER BY c.id FOR UPDATE;

  -- Ficam como estão os perfis usados num documento e os que uma encomenda
  -- aponta, com as provas do VIES e as isenções deles: a decisão do IVA da
  -- encomenda cita-as, e a fatura e a nota de crédito ainda podem precisar
  -- delas (R9; revisão do #314, P1-1). Até a fatia 10 marcar os documentos,
  -- qualquer encomenda conta, também a não paga; um critério mais estreito
  -- é do contabilista (C).
  usados := ARRAY(SELECT p.id FROM public.perfil_faturacao p
    WHERE p.comerciante_id = comerciante AND p.cliente_id = ANY (grupo)
      AND (p.usado_em_documento OR EXISTS (
        SELECT FROM public.encomenda e
        WHERE e.comerciante_id = comerciante AND e.perfil_id = p.id)));
  nao_usados := ARRAY(SELECT p.id FROM public.perfil_faturacao p
    WHERE p.comerciante_id = comerciante AND p.cliente_id = ANY (grupo)
      AND p.id <> ALL (usados));
  -- O que fica nas encomendas (o contacto, a entrega, a cópia do perfil) é
  -- delas e ainda não se trata aqui: o resultado di-lo (P2-4).
  SELECT count(*) INTO n_encomendas FROM public.encomenda e
  WHERE e.comerciante_id = comerciante AND e.cliente_id = ANY (grupo);

  INSERT INTO public.pseudonimizacao_em_curso VALUES (pg_current_xact_id());

  DELETE FROM public.vies_fila v WHERE v.perfil_id = ANY (nao_usados || usados);
  DELETE FROM public.validacao_vies v
  WHERE v.comerciante_id = comerciante AND v.perfil_id = ANY (nao_usados);
  GET DIAGNOSTICS n_validacoes = ROW_COUNT;
  UPDATE public.isencao_manual i
  SET nif_numero = NULL, pais_contribuinte = NULL, nota = NULL, motivo = '(pseudonimizado)',
      motivo_retirada = CASE WHEN i.motivo_retirada IS NULL THEN NULL ELSE '(pseudonimizado)' END
  WHERE i.comerciante_id = comerciante AND i.perfil_id = ANY (nao_usados);
  GET DIAGNOSTICS n_isencoes = ROW_COUNT;
  UPDATE public.perfil_faturacao p
  SET tipo = 'particular', nome_documento = 'Pseudonimizado', nif_escrito = NULL,
      pais_contribuinte = NULL, morada_linha1 = NULL, morada_linha2 = NULL,
      morada_codigo_postal = NULL, morada_localidade = NULL, morada_pais = NULL,
      estado = 'arquivado', principal = false
  WHERE p.comerciante_id = comerciante AND p.id = ANY (nao_usados);
  DELETE FROM public.consentimento c
  WHERE c.comerciante_id = comerciante AND c.cliente_id = ANY (grupo);
  GET DIAGNOSTICS n_consentimentos = ROW_COUNT;
  DELETE FROM public.cliente_etiqueta ce
  WHERE ce.comerciante_id = comerciante AND ce.cliente_id = ANY (grupo);
  GET DIAGNOSTICS n_etiquetas = ROW_COUNT;
  UPDATE public.duplicado_cliente d
  SET estado = 'fechado', motivo = 'uma das fichas foi pseudonimizada',
      decidido_por = quem, decidido_em = now(), actualizado_em = now()
  WHERE d.comerciante_id = comerciante AND d.estado IN ('por_decidir', 'descartado')
    AND (d.cliente_a = ANY (grupo) OR d.cliente_b = ANY (grupo));
  UPDATE public.cliente c
  SET nome = 'Pseudonimizado', emails = '{}', telefones = '{}', lingua = NULL, pais = NULL,
      estado = CASE WHEN c.id = p_cliente THEN 'pseudonimizado' ELSE c.estado END
  WHERE c.comerciante_id = comerciante AND c.id = ANY (grupo);

  -- Por último: as entradas que as escritas acima acabaram de criar também
  -- levavam os valores de antes.
  UPDATE public.alteracao_cliente a
  SET campos = public.clientes_rasto_sem_dados(a.campos)
  WHERE a.comerciante_id = comerciante
    AND (a.cliente_id = ANY (grupo)
      -- Um par de duplicados fica na linha do tempo da primeira ficha do
      -- par, que pode ser a outra pessoa; o motivo escrito fala das duas.
      OR (a.entidade = 'duplicado_cliente' AND a.entidade_id IN (
        SELECT d.id FROM public.duplicado_cliente d
        WHERE d.comerciante_id = comerciante
          AND (d.cliente_a = ANY (grupo) OR d.cliente_b = ANY (grupo)))))
    AND NOT (a.entidade = 'perfil_faturacao' AND a.entidade_id = ANY (usados))
    AND a.campos IS DISTINCT FROM public.clientes_rasto_sem_dados(a.campos);
  GET DIAGNOSTICS n_rasto = ROW_COUNT;

  DELETE FROM public.pseudonimizacao_em_curso m WHERE m.transaccao = pg_current_xact_id();

  resultado := jsonb_build_object(
    'fichas', cardinality(grupo),
    'perfis_pseudonimizados', cardinality(nao_usados),
    'perfis_mantidos_por_obrigacao_fiscal', cardinality(usados),
    'consentimentos_apagados', n_consentimentos,
    'etiquetas_retiradas', n_etiquetas,
    'provas_vies_apagadas', n_validacoes,
    'isencoes_limpas', n_isencoes,
    'entradas_da_linha_do_tempo', n_rasto,
    'encomendas_com_dados_por_tratar', n_encomendas);
  INSERT INTO public.evento_saida (comerciante_id, tipo, agregado_tipo, agregado_id, dados)
  VALUES (comerciante, 'customer.pseudonymized', 'cliente', p_cliente,
    jsonb_build_object('cliente_id', p_cliente, 'fichas', cardinality(grupo), 'quem', quem,
      'em', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
  PERFORM public.pedido_titular_registar(p_cliente, 'apagamento', p_verificacao, resultado);
  RETURN resultado;
END
$$;

-- ----------------------------------------------------- RLS e permissões

ALTER TABLE pedido_titular ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedido_titular FORCE ROW LEVEL SECURITY;
CREATE POLICY so_o_proprio ON pedido_titular
  USING (comerciante_id = comerciante_actual())
  WITH CHECK (comerciante_id = comerciante_actual());
GRANT SELECT ON pedido_titular TO eurolify_api;
-- A linha do tempo só tinha ler e acrescentar; a pseudonimização (função do
-- dono, com a bandeira) reescreve as entradas do comerciante posto. A API não
-- tem o privilégio de alterar.
CREATE POLICY reescreve_a_pseudonimizacao ON alteracao_cliente FOR UPDATE
  USING (comerciante_id = comerciante_actual())
  WITH CHECK (comerciante_id = comerciante_actual());

REVOKE EXECUTE ON FUNCTION clientes_dono_a_escrever(), clientes_pseudonimizacao_em_curso(),
  clientes_so_se_acrescenta(), pedido_titular_registar(uuid, text, text, jsonb),
  pedido_titular_exportar(uuid, text), cliente_limitar(uuid, boolean, text),
  clientes_rasto_sem_dados(jsonb), cliente_pseudonimizar(uuid, text, text),
  validacao_vies_so_em_ficha_activa() FROM PUBLIC;
-- Os gatilhos correm com quem escreve: precisam das duas primeiras. A
-- pedido_titular_registar fica só para as funções do dono (P2-2).
GRANT EXECUTE ON FUNCTION clientes_dono_a_escrever(), clientes_pseudonimizacao_em_curso(),
  pedido_titular_exportar(uuid, text), cliente_limitar(uuid, boolean, text),
  cliente_pseudonimizar(uuid, text, text), validacao_vies_so_em_ficha_activa() TO eurolify_api;

-- ------------------------------------------------------------- O âmbito

ALTER TABLE chave_api DROP CONSTRAINT chave_api_ambitos_validos;
ALTER TABLE chave_api ADD CONSTRAINT chave_api_ambitos_validos CHECK (
  cardinality(ambitos) BETWEEN 1 AND 40
  AND ambitos <@ ARRAY[
    'merchant:read', 'merchant:write',
    'catalog:read', 'catalog:write', 'catalog:publish', 'catalog:import',
    'catalog:history', 'prices:read', 'prices:write',
    'customers:read', 'customers:write', 'customers:billing',
    'customers:exemptions', 'customers:merge', 'customers:privacy', 'tax:read', 'tax:write',
    'legal:read', 'legal:write', 'shipping:read', 'shipping:write', 'orders:read',
    'payments:read', 'payments:write', 'payments:accounts', 'payments:resolve',
    'inventory:read', 'inventory:write', 'inventory:policy', 'fulfilment:read',
    'fulfilment:write',
    'keys:write', 'storefront'
  ]::text[]);

-- Como a 0047, mais o customers:privacy no dono.
CREATE OR REPLACE FUNCTION papel_ambitos(p_papel text) RETURNS text[]
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT CASE p_papel
    WHEN 'dono' THEN ARRAY['catalog:history', 'catalog:import', 'catalog:publish',
                  'catalog:read', 'catalog:write', 'customers:billing',
                  'customers:exemptions', 'customers:merge', 'customers:privacy',
                  'customers:read', 'customers:write', 'fulfilment:read', 'fulfilment:write',
                  'inventory:policy', 'inventory:read', 'inventory:write', 'keys:write', 'legal:read', 'legal:write',
                  'merchant:read', 'merchant:write', 'orders:read',
                  'payments:accounts', 'payments:read', 'payments:resolve',
                  'payments:write', 'prices:read', 'prices:write', 'shipping:read',
                  'shipping:write', 'tax:read', 'tax:write']
    WHEN 'gestor' THEN ARRAY['catalog:history', 'catalog:import', 'catalog:publish',
                  'catalog:read', 'catalog:write', 'customers:merge', 'customers:read',
                  'customers:write', 'fulfilment:read', 'fulfilment:write', 'inventory:policy', 'inventory:read',
                  'inventory:write', 'legal:read', 'merchant:read', 'orders:read',
                  'payments:read', 'payments:write', 'prices:read', 'prices:write',
                  'shipping:read', 'shipping:write', 'tax:read']
    WHEN 'armazem' THEN ARRAY['catalog:read', 'fulfilment:read', 'fulfilment:write',
                  'inventory:read', 'inventory:write', 'prices:read', 'shipping:read']
    WHEN 'apoio' THEN ARRAY['catalog:read', 'customers:read', 'customers:write',
                  'fulfilment:read', 'inventory:read', 'legal:read', 'merchant:read',
                  'orders:read', 'payments:read', 'prices:read', 'shipping:read',
                  'tax:read']
  END::text[]
$$;
