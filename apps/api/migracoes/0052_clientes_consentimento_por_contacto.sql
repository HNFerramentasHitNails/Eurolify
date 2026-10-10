-- Clientes: o consentimento de marketing por contacto e a dupla confirmação
-- (docs/23 §14; docs/06, DL; Diogo, 10/10/2026). Ex.: a Ana retirou
-- `ana@exemplo.pt` e aceitou `ana.silva@exemplo.pt`; recebe no segundo e não
-- no primeiro. Um «sim» novo para `ana@exemplo.pt` só conta depois de ela
-- confirmar pela ligação que o sistema da loja lhe envia (Q-C1: A).
--
-- As regras (C1–C7 do §14.1; as fontes, indicadas pelo Diogo, ficam C):
-- - o estado é por contacto e por canal, no comerciante (não por ficha nem
--   por grupo: o mesmo e-mail noutra ficha é o mesmo contacto; revisão do
--   #330, P1-4): a última declaração desse contacto; empate ⇒ não; sem
--   nenhuma ⇒ não;
-- - cada declaração nova diz o contacto, e o contacto tem de ser da ficha;
-- - sobre uma recusa activa desse contacto, um «aceitou» directo é recusado:
--   cria-se um pedido de confirmação, e só a confirmação regista o «sim»
--   (via dupla_confirmacao), com o pedido como prova;
-- - um «sim» noutro contacto não mexe nos outros;
-- - as declarações antigas (sem contacto) valem para os contactos que a
--   ficha tinha **nesta migração**, guardados à parte como inferidos; um
--   contacto acrescentado depois não herda nada (revisão do #330, P2-1; no
--   ensaio não há dados pessoais reais, ADR-0019);
-- - um pedido de confirmação cai se o contacto declarar depois dele (P1-2);
--   no máximo 3 pedidos por contacto e canal numa hora (P1-3);
-- - a prova fica na ficha de origem, lida pelo grupo; a pseudonimização
--   apaga as declarações (0049) e agora também os pedidos de confirmação.
-- O segredo da confirmação nunca se guarda: só o resumo, com o id do pedido.

SET LOCAL lock_timeout = '10s';

-- ------------------------------------------------- A declaração e o contacto

ALTER TABLE consentimento ADD COLUMN contacto text
  CHECK (contacto IS NULL OR length(contacto) BETWEEN 3 AND 254);
ALTER TABLE consentimento ADD COLUMN via text NOT NULL DEFAULT 'directa'
  CHECK (via IN ('directa', 'dupla_confirmacao'));
ALTER TABLE consentimento ADD COLUMN confirmacao_id uuid;
ALTER TABLE consentimento ADD CONSTRAINT consentimento_via_confirmacao
  CHECK ((via = 'dupla_confirmacao') = (confirmacao_id IS NOT NULL));
CREATE INDEX consentimento_por_contacto
  ON consentimento (comerciante_id, contacto, canal, finalidade, declarado_em);

-- O contacto como se compara: o e-mail sem espaços nas pontas e em
-- minúsculas (como os duplicados, 0046); o telefone como a ficha o guarda
-- (só o formato internacional, 0037).
CREATE FUNCTION contacto_para_comparar(p_canal text, p_contacto text) RETURNS text
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT CASE WHEN p_canal = 'email' THEN lower(btrim(p_contacto)) ELSE btrim(p_contacto) END
$$;

-- Os contactos de um conjunto de fichas para um canal, como se comparam.
CREATE FUNCTION contactos_das_fichas(p_comerciante uuid, p_clientes uuid[], p_canal text)
  RETURNS text[]
  LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT coalesce(array_agg(DISTINCT x), '{}')
  FROM public.cliente f,
    LATERAL unnest(CASE WHEN p_canal = 'email' THEN public.emails_para_comparar(f.emails)
                        ELSE f.telefones END) x
  WHERE f.comerciante_id = p_comerciante AND f.id = ANY (p_clientes)
$$;

-- As declarações antigas (sem contacto) e os contactos que a ficha delas
-- tinha agora: a prova de a que contactos se estendem (inferidas). Só se
-- acrescenta; a pseudonimização apaga-as com as declarações (chave em
-- cascata).
CREATE TABLE consentimento_contacto_inferido (
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  consentimento_id uuid NOT NULL REFERENCES consentimento (id) ON DELETE CASCADE,
  contacto text NOT NULL,
  PRIMARY KEY (consentimento_id, contacto)
);
CREATE INDEX consentimento_contacto_inferido_por_contacto
  ON consentimento_contacto_inferido (comerciante_id, contacto);
ALTER TABLE consentimento NO FORCE ROW LEVEL SECURITY;
ALTER TABLE cliente NO FORCE ROW LEVEL SECURITY;
INSERT INTO consentimento_contacto_inferido (comerciante_id, consentimento_id, contacto)
SELECT DISTINCT d.comerciante_id, d.id, x
FROM consentimento d
JOIN cliente f ON f.comerciante_id = d.comerciante_id AND f.id = d.cliente_id,
  LATERAL unnest(CASE WHEN d.canal = 'email' THEN emails_para_comparar(f.emails)
                      ELSE f.telefones END) x
WHERE d.contacto IS NULL;
ALTER TABLE cliente FORCE ROW LEVEL SECURITY;
ALTER TABLE consentimento FORCE ROW LEVEL SECURITY;
ALTER TABLE consentimento_contacto_inferido ENABLE ROW LEVEL SECURITY;
ALTER TABLE consentimento_contacto_inferido FORCE ROW LEVEL SECURITY;
CREATE POLICY so_o_proprio ON consentimento_contacto_inferido
  USING (comerciante_id = comerciante_actual())
  WITH CHECK (comerciante_id = comerciante_actual());
CREATE TRIGGER consentimento_contacto_inferido_so_se_acrescenta
  BEFORE UPDATE ON consentimento_contacto_inferido
  FOR EACH ROW EXECUTE FUNCTION rasto_so_se_acrescenta();
ALTER TABLE consentimento_contacto_inferido
  ENABLE ALWAYS TRIGGER consentimento_contacto_inferido_so_se_acrescenta;
GRANT SELECT ON consentimento_contacto_inferido TO eurolify_api;

-- A última declaração de um contacto no comerciante, em qualquer ficha: as
-- que dizem esse contacto e as antigas inferidas para ele. Empate ⇒
-- «retirou». Nulo se não há nenhuma.
CREATE FUNCTION marketing_do_contacto(p_comerciante uuid, p_canal text, p_contacto text)
  RETURNS text
  LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT d.declaracao
  FROM public.consentimento d
  WHERE d.comerciante_id = p_comerciante
    AND d.canal = p_canal AND d.finalidade = 'marketing'
    AND (d.contacto = public.contacto_para_comparar(p_canal, p_contacto)
      OR (d.contacto IS NULL AND EXISTS (
        SELECT FROM public.consentimento_contacto_inferido i
        WHERE i.comerciante_id = p_comerciante AND i.consentimento_id = d.id
          AND i.contacto = public.contacto_para_comparar(p_canal, p_contacto))))
  ORDER BY d.declarado_em DESC, (d.declaracao = 'aceitou')
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION consentimento_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem text := nullif(btrim(current_setting('eurolify.quem', true)), '');
  ficha record;
  passos integer := 0;
BEGIN
  IF quem IS NULL THEN
    RAISE EXCEPTION 'customers.change_without_who: um consentimento sem eurolify.quem';
  END IF;
  -- Toma a ficha até ao fim da transacção: duas declarações da mesma ficha
  -- entram uma de cada vez, e a hora (abaixo) segue a ordem em que entram.
  LOOP
    SELECT c.estado, c.fundido_em INTO ficha FROM public.cliente c
    WHERE c.comerciante_id = NEW.comerciante_id AND c.id = NEW.cliente_id
    FOR NO KEY UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'customers.not_found: a ficha não existe';
    END IF;
    EXIT WHEN ficha.estado <> 'fundido';
    passos := passos + 1;
    IF passos > 100 THEN
      RAISE EXCEPTION 'customers.invalid_transition: fusões encadeadas demais';
    END IF;
    NEW.cliente_id := ficha.fundido_em;
  END LOOP;
  IF ficha.estado <> 'activo' THEN
    RAISE EXCEPTION 'customers.invalid_transition: a ficha está %', ficha.estado;
  END IF;
  -- O contacto (0052): obrigatório, da ficha, como se compara.
  IF NEW.contacto IS NULL THEN
    RAISE EXCEPTION 'customers.consent_contact_unknown: a declaração diz o contacto (o e-mail ou o telefone)';
  END IF;
  NEW.contacto := public.contacto_para_comparar(NEW.canal, NEW.contacto);
  IF NOT NEW.contacto = ANY (public.contactos_das_fichas(NEW.comerciante_id,
       ARRAY[NEW.cliente_id], NEW.canal)) THEN
    RAISE EXCEPTION 'customers.consent_contact_unknown: o contacto não é % desta ficha',
      CASE WHEN NEW.canal = 'email' THEN 'um e-mail' ELSE 'um telefone' END;
  END IF;
  -- Só a confirmação regista um «sim» por dupla confirmação.
  IF NEW.via = 'dupla_confirmacao' AND NOT public.clientes_dono_a_escrever() THEN
    RAISE EXCEPTION 'customers.consent_confirmation_required: um «sim» por dupla confirmação só a confirmação o regista';
  END IF;
  -- Sobre uma recusa activa deste contacto, um «sim» directo não entra: é
  -- preciso confirmar no próprio contacto (C3; docs/23 §14).
  IF NEW.declaracao = 'aceitou' AND NEW.via = 'directa' AND public.marketing_do_contacto(
       NEW.comerciante_id, NEW.canal, NEW.contacto) = 'retirou' THEN
    RAISE EXCEPTION 'customers.consent_confirmation_required: o contacto recusou; o «sim» só conta depois de confirmado nele';
  END IF;
  -- A hora do relógio, depois de tomada a ficha, e sempre depois da última
  -- do grupo (revisão do #289, P2-1).
  NEW.declarado_em := greatest(clock_timestamp(), (
    SELECT max(c.declarado_em) + interval '1 microsecond'
    FROM public.consentimento c
    WHERE c.comerciante_id = NEW.comerciante_id
      AND c.cliente_id IN (SELECT public.clientes_do_grupo(NEW.cliente_id))));
  NEW.quem := quem;
  RETURN NEW;
END
$$;

-- ------------------------------------------------------------- As réguas

-- Um conjunto de fichas (o do ensaio da fusão: as duas) pode receber
-- marketing por um canal se algum contacto delas tem «sim». Conta os
-- contactos de todas as fichas do conjunto, também da que a fusão já marcou
-- fundida (o plano lê-se a meio da fusão).
CREATE OR REPLACE FUNCTION regua_marketing(p_comerciante uuid, p_clientes uuid[], p_canal text)
  RETURNS boolean
  LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT coalesce(bool_or(public.marketing_do_contacto(p_comerciante, p_canal, x)
           = 'aceitou'), false)
  FROM unnest(public.contactos_das_fichas(p_comerciante, p_clientes, p_canal)) x
$$;

-- A pergunta exacta: este contacto desta ficha pode receber por este canal?
CREATE FUNCTION pode_receber_marketing(p_cliente uuid, p_canal text, p_contacto text)
  RETURNS boolean
  LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT coalesce((
    SELECT public.contacto_para_comparar(p_canal, p_contacto)
        = ANY (public.contactos_das_fichas(f.comerciante_id, ARRAY[f.id], p_canal))
      AND public.marketing_do_contacto(f.comerciante_id, p_canal, p_contacto) = 'aceitou'
    FROM public.cliente f
    WHERE f.id = p_cliente AND f.estado = 'activo' AND NOT f.limitado), false)
$$;

-- Os contactos de uma ficha que podem receber por um canal.
CREATE FUNCTION contactos_com_marketing(p_cliente uuid, p_canal text) RETURNS text[]
  LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT coalesce(array_agg(x ORDER BY x), '{}')
  FROM public.cliente f,
    LATERAL unnest(public.contactos_das_fichas(f.comerciante_id, ARRAY[f.id], p_canal)) x
  WHERE f.id = p_cliente AND f.estado = 'activo' AND NOT f.limitado
    AND public.marketing_do_contacto(f.comerciante_id, p_canal, x) = 'aceitou'
$$;

-- Uma ficha pode receber por um canal se algum contacto **dela** tem «sim»
-- (um contacto tirado da ficha deixa de contar). É a que o evento e a lista
-- dos consentimentos usam (R6).
CREATE OR REPLACE FUNCTION pode_receber_marketing(p_cliente uuid, p_canal text) RETURNS boolean
  LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT cardinality(public.contactos_com_marketing(p_cliente, p_canal)) > 0
$$;

-- ------------------------------------------------ A dupla confirmação

CREATE TABLE confirmacao_consentimento (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  cliente_id uuid NOT NULL,
  canal text NOT NULL CHECK (canal IN ('email', 'sms')),
  contacto text NOT NULL CHECK (length(contacto) BETWEEN 3 AND 254),
  -- O que se mostrou ao cliente quando disse «sim»: vai para a declaração.
  texto text NOT NULL CHECK (length(btrim(texto)) BETWEEN 1 AND 5000),
  versao_texto text NOT NULL CHECK (length(btrim(versao_texto)) BETWEEN 1 AND 50),
  onde text NOT NULL CHECK (length(btrim(onde)) BETWEEN 1 AND 200),
  -- sha256 do id e do segredo; o segredo não se guarda.
  resumo text NOT NULL CHECK (resumo ~ '^[0-9a-f]{64}$'),
  estado text NOT NULL DEFAULT 'pendente'
    CHECK (estado IN ('pendente', 'confirmada', 'expirada', 'cancelada', 'esgotada')),
  tentativas integer NOT NULL DEFAULT 0 CHECK (tentativas BETWEEN 0 AND 5),
  expira_em timestamptz NOT NULL,
  pedida_por text NOT NULL,
  pedida_em timestamptz NOT NULL DEFAULT now(),
  fechada_em timestamptz,
  -- As duas chaves entre o pedido e a declaração só se verificam no fim da
  -- transacção: a pseudonimização apaga a declaração antes do pedido
  -- (revisão do #330, P1-1).
  consentimento_id uuid REFERENCES consentimento (id) DEFERRABLE INITIALLY DEFERRED,
  CHECK ((estado = 'pendente') = (fechada_em IS NULL)),
  CHECK ((estado = 'confirmada') = (consentimento_id IS NOT NULL)),
  FOREIGN KEY (comerciante_id, cliente_id) REFERENCES cliente (comerciante_id, id)
);
CREATE INDEX confirmacao_por_contacto
  ON confirmacao_consentimento (comerciante_id, contacto, canal) WHERE estado = 'pendente';
CREATE INDEX confirmacao_por_cliente ON confirmacao_consentimento (comerciante_id, cliente_id);
-- A validação da chave lê a tabela com o RLS forçado e sem comerciante
-- posto: largado só para isso (como na 0046).
ALTER TABLE consentimento NO FORCE ROW LEVEL SECURITY;
ALTER TABLE consentimento ADD CONSTRAINT consentimento_da_confirmacao
  FOREIGN KEY (confirmacao_id) REFERENCES confirmacao_consentimento (id)
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE consentimento FORCE ROW LEVEL SECURITY;

-- Os prazos e o limite de tentativas (§14.3, proposta).
CREATE FUNCTION confirmacao_prazo(p_canal text) RETURNS interval
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT CASE p_canal WHEN 'email' THEN interval '24 hours' ELSE interval '10 minutes' END
$$;

-- Pede a confirmação de um «sim» sobre uma recusa. O segredo vem do servidor
-- (uma ligação para o e-mail, um código de 6 dígitos para o SMS) e volta só
-- para quem pediu; aqui fica o resumo. Um pedido novo cancela o anterior do
-- mesmo contacto e canal.
CREATE FUNCTION consentimento_pedir_confirmacao(p_cliente uuid, p_canal text,
  p_contacto text, p_texto text, p_versao_texto text, p_onde text, p_segredo text,
  OUT id uuid, OUT expira_em timestamptz, OUT contacto text)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  comerciante uuid := public.comerciante_actual();
  quem text := nullif(btrim(current_setting('eurolify.quem', true)), '');
  ficha record;
  alvo uuid := p_cliente;
  passos integer := 0;
  v_contacto text := public.contacto_para_comparar(p_canal, p_contacto);
BEGIN
  IF quem IS NULL THEN
    RAISE EXCEPTION 'customers.change_without_who: um pedido de confirmação sem eurolify.quem';
  END IF;
  IF p_canal NOT IN ('email', 'sms') THEN
    RAISE EXCEPTION 'customers.confirmation_channel: a dupla confirmação é por e-mail ou SMS';
  END IF;
  IF p_segredo IS NULL OR length(p_segredo) < 6 THEN
    RAISE EXCEPTION 'customers.confirmation_invalid: segredo em falta';
  END IF;
  -- A ficha activa (uma fundida segue até à que ficou), tomada como numa
  -- declaração.
  LOOP
    SELECT c.estado, c.fundido_em INTO ficha FROM public.cliente c
    WHERE c.comerciante_id = comerciante AND c.id = alvo
    FOR NO KEY UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'customers.not_found: a ficha não existe';
    END IF;
    EXIT WHEN ficha.estado <> 'fundido';
    passos := passos + 1;
    IF passos > 100 THEN
      RAISE EXCEPTION 'customers.invalid_transition: fusões encadeadas demais';
    END IF;
    alvo := ficha.fundido_em;
  END LOOP;
  IF ficha.estado <> 'activo' THEN
    RAISE EXCEPTION 'customers.invalid_transition: a ficha está %', ficha.estado;
  END IF;
  IF NOT v_contacto = ANY (public.contactos_das_fichas(comerciante, ARRAY[alvo], p_canal)) THEN
    RAISE EXCEPTION 'customers.consent_contact_unknown: o contacto não é % desta ficha',
      CASE WHEN p_canal = 'email' THEN 'um e-mail' ELSE 'um telefone' END;
  END IF;
  -- No máximo 3 pedidos por contacto e canal numa hora: nem o contacto é
  -- inundado, nem um código de 6 dígitos se adivinha pedindo outro (revisão
  -- do #330, P1-3; observability-security, limites).
  IF (SELECT count(*) FROM public.confirmacao_consentimento c
      WHERE c.comerciante_id = comerciante AND c.contacto = v_contacto
        AND c.canal = p_canal AND c.pedida_em > now() - interval '1 hour') >= 3 THEN
    RAISE EXCEPTION 'customers.confirmation_rate_limited: já houve 3 pedidos para este contacto na última hora';
  END IF;
  UPDATE public.confirmacao_consentimento c
  SET estado = 'cancelada', fechada_em = now()
  WHERE c.comerciante_id = comerciante AND c.contacto = v_contacto AND c.canal = p_canal
    AND c.estado = 'pendente';
  id := uuidv7();
  expira_em := now() + public.confirmacao_prazo(p_canal);
  contacto := v_contacto;
  INSERT INTO public.confirmacao_consentimento (id, comerciante_id, cliente_id, canal,
    contacto, texto, versao_texto, onde, resumo, expira_em, pedida_por)
  VALUES (id, comerciante, alvo, p_canal, v_contacto, p_texto, p_versao_texto, p_onde,
    encode(sha256(convert_to(id::text || ':' || p_segredo, 'UTF8')), 'hex'),
    expira_em, quem);
  -- Só identificadores (R12): nem o contacto nem o segredo.
  INSERT INTO public.evento_saida (comerciante_id, tipo, agregado_tipo, agregado_id, dados)
  VALUES (comerciante, 'consent.confirmation_requested', 'cliente', alvo,
    jsonb_build_object('cliente_id', alvo, 'confirmacao_id', id, 'canal', p_canal,
      'quem', quem, 'expira_em', to_char(expira_em AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
END
$$;

-- Confirma com o que a pessoa trouxe. Devolve o resultado em vez de lançar,
-- para a tentativa errada ficar contada (um erro desfazia-a): confirmada,
-- errado, esgotada, expirada, cancelada, ja_confirmada ou nao_existe.
CREATE FUNCTION consentimento_confirmar(p_confirmacao uuid, p_segredo text,
  OUT resultado text, OUT consentimento_id uuid)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  comerciante uuid := public.comerciante_actual();
  p record;
  ficha record;
  alvo uuid;
  passos integer := 0;
BEGIN
  -- A ficha primeiro e só depois o pedido, pela ordem do pedir e das
  -- declarações (revisão do #330, P2-3).
  SELECT c.cliente_id INTO alvo FROM public.confirmacao_consentimento c
  WHERE c.comerciante_id = comerciante AND c.id = p_confirmacao;
  IF NOT FOUND THEN
    resultado := 'nao_existe';
    RETURN;
  END IF;
  LOOP
    SELECT c.estado, c.fundido_em INTO ficha FROM public.cliente c
    WHERE c.comerciante_id = comerciante AND c.id = alvo
    FOR NO KEY UPDATE;
    EXIT WHEN NOT FOUND OR ficha.estado <> 'fundido' OR passos > 100;
    passos := passos + 1;
    alvo := ficha.fundido_em;
  END LOOP;
  SELECT * INTO p FROM public.confirmacao_consentimento c
  WHERE c.comerciante_id = comerciante AND c.id = p_confirmacao
  FOR UPDATE;
  IF NOT FOUND THEN
    resultado := 'nao_existe';
    RETURN;
  END IF;
  IF p.estado <> 'pendente' THEN
    resultado := CASE p.estado WHEN 'confirmada' THEN 'ja_confirmada' ELSE p.estado END;
    RETURN;
  END IF;
  IF now() > p.expira_em THEN
    UPDATE public.confirmacao_consentimento SET estado = 'expirada', fechada_em = now()
    WHERE id = p.id;
    resultado := 'expirada';
    RETURN;
  END IF;
  IF p.resumo IS DISTINCT FROM encode(sha256(convert_to(p.id::text || ':'
       || coalesce(p_segredo, ''), 'UTF8')), 'hex') THEN
    UPDATE public.confirmacao_consentimento
    SET tentativas = p.tentativas + 1,
        estado = CASE WHEN p.tentativas + 1 >= 5 THEN 'esgotada' ELSE 'pendente' END,
        fechada_em = CASE WHEN p.tentativas + 1 >= 5 THEN now() END
    WHERE id = p.id;
    resultado := CASE WHEN p.tentativas + 1 >= 5 THEN 'esgotada' ELSE 'errado' END;
    RETURN;
  END IF;
  -- O contacto declarou depois do pedido (um «não» que chegou entretanto):
  -- a ligação antiga já não vale (revisão do #330, P1-2).
  IF EXISTS (SELECT FROM public.consentimento d
             WHERE d.comerciante_id = comerciante AND d.canal = p.canal
               AND d.finalidade = 'marketing' AND d.contacto = p.contacto
               AND d.declarado_em > p.pedida_em) THEN
    UPDATE public.confirmacao_consentimento SET estado = 'cancelada', fechada_em = now()
    WHERE id = p.id;
    resultado := 'cancelada';
    RETURN;
  END IF;
  INSERT INTO public.consentimento (comerciante_id, cliente_id, canal, finalidade,
    declaracao, texto, versao_texto, onde, contacto, via, confirmacao_id)
  VALUES (comerciante, p.cliente_id, p.canal, 'marketing', 'aceitou', p.texto,
    p.versao_texto, p.onde, p.contacto, 'dupla_confirmacao', p.id)
  RETURNING consentimento.id INTO consentimento_id;
  UPDATE public.confirmacao_consentimento
  SET estado = 'confirmada', fechada_em = now(), consentimento_id = consentimento_confirmar.consentimento_id
  WHERE id = p.id;
  resultado := 'confirmada';
END
$$;

-- Os pedidos só andam para a frente, e só pelas funções do dono; a
-- pseudonimização apaga-os (têm o contacto).
CREATE FUNCTION confirmacao_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF public.clientes_pseudonimizacao_em_curso() THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'audit.append_only: um pedido de confirmação não se apaga';
  END IF;
  IF NOT public.clientes_dono_a_escrever() THEN
    RAISE EXCEPTION 'customers.confirmation_invalid: um pedido de confirmação só muda pelas funções dele';
  END IF;
  IF NEW.id <> OLD.id OR NEW.comerciante_id <> OLD.comerciante_id
     OR NEW.cliente_id <> OLD.cliente_id OR NEW.canal <> OLD.canal
     OR NEW.contacto <> OLD.contacto OR NEW.resumo <> OLD.resumo
     OR NEW.texto <> OLD.texto OR NEW.versao_texto <> OLD.versao_texto
     OR NEW.onde <> OLD.onde OR NEW.expira_em <> OLD.expira_em
     OR NEW.pedida_por <> OLD.pedida_por OR NEW.pedida_em <> OLD.pedida_em
     OR OLD.estado <> 'pendente' OR NEW.tentativas < OLD.tentativas THEN
    RAISE EXCEPTION 'customers.confirmation_invalid: um pedido de confirmação só anda para a frente';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER confirmacao_antes_de_gravar
  BEFORE UPDATE OR DELETE ON confirmacao_consentimento
  FOR EACH ROW EXECUTE FUNCTION confirmacao_antes_de_gravar();
ALTER TABLE confirmacao_consentimento ENABLE ALWAYS TRIGGER confirmacao_antes_de_gravar;

-- A pseudonimização (0049) põe o nome «Pseudonimizado» em cada ficha do
-- grupo, com a marca dela: os pedidos de confirmação dessas fichas saem.
CREATE FUNCTION cliente_pseudonimizado_sem_confirmacoes() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF public.clientes_pseudonimizacao_em_curso() THEN
    DELETE FROM public.confirmacao_consentimento c
    WHERE c.comerciante_id = NEW.comerciante_id AND c.cliente_id = NEW.id;
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER cliente_pseudonimizado_sem_confirmacoes
  AFTER UPDATE ON cliente
  FOR EACH ROW EXECUTE FUNCTION cliente_pseudonimizado_sem_confirmacoes();
ALTER TABLE cliente ENABLE ALWAYS TRIGGER cliente_pseudonimizado_sem_confirmacoes;

-- O evento diz também se o contacto **desta** declaração pode receber (sem
-- o contacto, R12): um «retirou» de um e-mail com outro em «sim» dava só «a
-- ficha pode» (revisão do #330, P2-2). Quem envia lê os contactos em
-- contactos_com_marketing.
CREATE OR REPLACE FUNCTION consentimento_evento() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  INSERT INTO public.evento_saida (comerciante_id, tipo, agregado_tipo, agregado_id, dados)
  VALUES (NEW.comerciante_id, 'consent.changed', 'cliente', NEW.cliente_id,
    jsonb_build_object('cliente_id', NEW.cliente_id, 'consentimento_id', NEW.id,
      'canal', NEW.canal, 'finalidade', NEW.finalidade, 'via', NEW.via,
      'pode_receber_marketing', public.pode_receber_marketing(NEW.cliente_id, NEW.canal),
      'contacto_pode_receber', public.pode_receber_marketing(NEW.cliente_id, NEW.canal,
        NEW.contacto),
      'quem', NEW.quem,
      'em', to_char(NEW.declarado_em AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
  RETURN NULL;
END
$$;

-- A linha do tempo perde também o contacto das declarações (0049).
CREATE OR REPLACE FUNCTION clientes_rasto_sem_dados(p_campos jsonb) RETURNS jsonb
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT coalesce(jsonb_object_agg(k, CASE WHEN k = ANY (ARRAY['nome', 'emails',
      'telefones', 'lingua', 'pais', 'nome_documento', 'nif_escrito', 'nif_numero',
      'pais_contribuinte', 'morada_linha1', 'morada_linha2', 'morada_codigo_postal',
      'morada_localidade', 'morada_pais', 'texto', 'onde', 'motivo', 'motivo_retirada',
      'nota', 'contacto'])
    THEN jsonb_build_object(
      'antes', CASE WHEN jsonb_typeof(v -> 'antes') IN ('null') OR (v -> 'antes') IS NULL
                 THEN 'null'::jsonb ELSE to_jsonb('(pseudonimizado)'::text) END,
      'depois', CASE WHEN jsonb_typeof(v -> 'depois') IN ('null') OR (v -> 'depois') IS NULL
                 THEN 'null'::jsonb ELSE to_jsonb('(pseudonimizado)'::text) END)
    ELSE v END), '{}')
  FROM jsonb_each(p_campos) AS e (k, v)
$$;

-- ----------------------------------------------------- RLS e permissões

ALTER TABLE confirmacao_consentimento ENABLE ROW LEVEL SECURITY;
ALTER TABLE confirmacao_consentimento FORCE ROW LEVEL SECURITY;
CREATE POLICY so_o_proprio ON confirmacao_consentimento
  USING (comerciante_id = comerciante_actual())
  WITH CHECK (comerciante_id = comerciante_actual());
-- A API lê tudo menos o resumo (um código de 6 dígitos com o resumo à vista
-- adivinhava-se em segundos).
GRANT SELECT (id, comerciante_id, cliente_id, canal, contacto, texto, versao_texto, onde,
  estado, tentativas, expira_em, pedida_por, pedida_em, fechada_em, consentimento_id)
  ON confirmacao_consentimento TO eurolify_api;
GRANT INSERT (contacto) ON consentimento TO eurolify_api;

REVOKE EXECUTE ON FUNCTION contacto_para_comparar(text, text),
  contactos_das_fichas(uuid, uuid[], text), marketing_do_contacto(uuid, text, text),
  pode_receber_marketing(uuid, text, text), contactos_com_marketing(uuid, text),
  confirmacao_prazo(text),
  consentimento_pedir_confirmacao(uuid, text, text, text, text, text, text),
  consentimento_confirmar(uuid, text), confirmacao_antes_de_gravar(),
  cliente_pseudonimizado_sem_confirmacoes() FROM PUBLIC;
-- Os gatilhos e as réguas correm com quem escreve ou pergunta.
GRANT EXECUTE ON FUNCTION contacto_para_comparar(text, text),
  contactos_das_fichas(uuid, uuid[], text), marketing_do_contacto(uuid, text, text),
  pode_receber_marketing(uuid, text, text), contactos_com_marketing(uuid, text),
  consentimento_pedir_confirmacao(uuid, text, text, text, text, text, text),
  consentimento_confirmar(uuid, text), cliente_pseudonimizado_sem_confirmacoes()
  TO eurolify_api;
