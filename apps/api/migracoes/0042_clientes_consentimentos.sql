-- Clientes, parte 2a: os consentimentos e a régua do marketing (docs/23
-- §3.6; issue #233; Diogo, 09/10/2026: «sim, avança com a parte 2»). Ex.: a
-- ficha «Ana Silva» aceita e-mails de marketing na loja (formulário de
-- registo, texto v3) a 09/10/2026 às 10:00 e retira-os às 11:00:
-- `pode_receber_marketing(ana, 'email')` passa de verdadeiro a falso; o SMS,
-- sem declaração, foi sempre falso.
--
-- O que esta migração faz:
-- - o consentimento (`consentimento`, §3.6): uma linha por declaração, com o
--   canal, a finalidade, `aceitou` ou `retirou`, o texto mostrado e a versão,
--   onde, quando e quem; **não se altera nem se apaga** (é a prova,
--   `eu-gdpr-privacy`, regra 3). «Nunca aceitou» é não haver linha (regra 5);
-- - a régua única `pode_receber_marketing(cliente, canal)` (R6;
--   `eu-gdpr-privacy`, regra 4): contam só as declarações explícitas; vale a
--   mais recente; empate ⇒ não; sem nenhuma ⇒ não; ficha que não está activa
--   ou que está `limitado` ⇒ não. O WhatsApp segue a mesma régua: sem uma
--   declaração explícita (a «fonte») dá não;
-- - as declarações de uma ficha entram uma de cada vez (a ficha fica tomada
--   até ao fim da transacção) e a hora é a do momento em que a tomam: a mais
--   recente é a última que entrou, mesmo com dois pedidos ao mesmo tempo;
-- - o evento `consent.changed` (§6), com o cliente, o canal, a finalidade e o
--   resultado da régua depois da declaração, sem o texto (R12);
-- - o rasto: as declarações entram na linha do tempo da ficha
--   (`alteracao_cliente`).
--
-- O que não faz (e onde fica): o consentimento implícito de quem já comprou
-- (art. 13.º, n.º 2, da Dir. 2002/58/CE — não verificado, C; V4 do docs/23):
-- só conta o explícito. Fusões, duplicados e pedidos do titular são as partes
-- 2b e 2c (revisão do #289, P2-4 e P3):
-- - a fusão (2b) não pode mudar as linhas de ficha (não se alteram) e a
--   ficha fundida recusa declarações novas: a régua da ficha que fica tem de
--   contar as das fichas absorvidas, e uma retirada com o id antigo tem de
--   seguir `fundido_em` (retirar tão fácil como dar);
-- - a pseudonimização (2c) apaga os consentimentos de marketing (§4.1): terá
--   de abrir, só para essa função, a recusa de apagar que esta migração põe,
--   e de alcançar a cópia do texto e do «onde» na linha do tempo.

SET LOCAL lock_timeout = '10s';

CREATE TABLE consentimento (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  cliente_id uuid NOT NULL,
  canal text NOT NULL CHECK (canal IN ('email', 'sms', 'whatsapp')),
  -- Só marketing na Fase 1; outras com finalidade escrita (§3.6, proposta).
  finalidade text NOT NULL DEFAULT 'marketing' CHECK (finalidade IN ('marketing')),
  declaracao text NOT NULL CHECK (declaracao IN ('aceitou', 'retirou')),
  -- O texto mostrado ao cliente e a versão dele.
  texto text NOT NULL CHECK (length(btrim(texto)) BETWEEN 1 AND 5000),
  versao_texto text NOT NULL CHECK (length(btrim(versao_texto)) BETWEEN 1 AND 50),
  -- A loja e o formulário, ou «Hub, a pedido do cliente por telefone».
  onde text NOT NULL CHECK (length(btrim(onde)) BETWEEN 1 AND 200),
  -- Põe-nos o gatilho: a hora e quem registou (eurolify.quem).
  declarado_em timestamptz NOT NULL DEFAULT now(),
  quem text NOT NULL,
  CONSTRAINT consentimento_da_ficha FOREIGN KEY (comerciante_id, cliente_id)
    REFERENCES cliente (comerciante_id, id)
);
CREATE INDEX consentimento_por_cliente
  ON consentimento (comerciante_id, cliente_id, canal, finalidade, declarado_em);

CREATE FUNCTION consentimento_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem text := nullif(btrim(current_setting('eurolify.quem', true)), '');
  estado_da_ficha text;
BEGIN
  IF quem IS NULL THEN
    RAISE EXCEPTION 'customers.change_without_who: um consentimento sem eurolify.quem';
  END IF;
  -- Toma a ficha até ao fim da transacção: duas declarações da mesma ficha
  -- entram uma de cada vez, e a hora (abaixo) segue a ordem em que entram.
  SELECT c.estado INTO estado_da_ficha FROM public.cliente c
  WHERE c.comerciante_id = NEW.comerciante_id AND c.id = NEW.cliente_id
  FOR NO KEY UPDATE;
  IF estado_da_ficha IS NULL THEN
    RAISE EXCEPTION 'customers.not_found: a ficha não existe';
  END IF;
  IF estado_da_ficha <> 'activo' THEN
    RAISE EXCEPTION 'customers.invalid_transition: a ficha está %', estado_da_ficha;
  END IF;
  -- A hora do relógio, depois de tomada a ficha (não a do início da
  -- transacção): uma declaração que esperou fica depois da que a fez esperar.
  -- E sempre depois da última da ficha, mesmo que o relógio da máquina
  -- recue (revisão do #289, P2-1): a ordem por hora é a ordem de entrada.
  NEW.declarado_em := greatest(clock_timestamp(), (
    SELECT max(c.declarado_em) + interval '1 microsecond'
    FROM public.consentimento c
    WHERE c.comerciante_id = NEW.comerciante_id AND c.cliente_id = NEW.cliente_id));
  NEW.quem := quem;
  RETURN NEW;
END
$$;
CREATE TRIGGER consentimento_antes_de_gravar
  BEFORE INSERT ON consentimento
  FOR EACH ROW EXECUTE FUNCTION consentimento_antes_de_gravar();
ALTER TABLE consentimento ENABLE ALWAYS TRIGGER consentimento_antes_de_gravar;

-- A prova não se altera nem se apaga, nem pelo dono da base.
CREATE TRIGGER consentimento_so_se_acrescenta
  BEFORE UPDATE OR DELETE ON consentimento
  FOR EACH ROW EXECUTE FUNCTION rasto_so_se_acrescenta();
CREATE TRIGGER consentimento_sem_truncate
  BEFORE TRUNCATE ON consentimento
  FOR EACH STATEMENT EXECUTE FUNCTION rasto_so_se_acrescenta();
ALTER TABLE consentimento ENABLE ALWAYS TRIGGER consentimento_so_se_acrescenta;
ALTER TABLE consentimento ENABLE ALWAYS TRIGGER consentimento_sem_truncate;

-- ------------------------------------------------------------ A régua única

-- «Este cliente pode receber marketing por este canal?» Notificações,
-- exportações e IAs perguntam aqui; nenhum outro sítio conta declarações
-- (R6). Corre com os direitos de quem pergunta: o RLS deixa ver só as fichas
-- do comerciante posto, e uma ficha de outro dá falso.
CREATE FUNCTION pode_receber_marketing(p_cliente uuid, p_canal text) RETURNS boolean
  LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  -- As declarações da hora mais recente da ficha activa e não limitada; se
  -- forem mais do que uma e uma retirou, é empate ⇒ não. Sem ficha nem
  -- declarações, bool_and dá nulo ⇒ não. Filtra pelo comerciante da ficha,
  -- para usar o índice também sem RLS (revisão do #289, P2-2).
  SELECT coalesce((
    SELECT bool_and(c.declaracao = 'aceitou')
    FROM public.cliente f
    JOIN public.consentimento c
      ON c.comerciante_id = f.comerciante_id AND c.cliente_id = f.id
    WHERE f.id = p_cliente AND f.estado = 'activo' AND NOT f.limitado
      AND c.canal = p_canal AND c.finalidade = 'marketing'
      AND c.declarado_em = (
        SELECT max(d.declarado_em) FROM public.consentimento d
        WHERE d.comerciante_id = f.comerciante_id AND d.cliente_id = f.id
          AND d.canal = p_canal AND d.finalidade = 'marketing')), false)
$$;

-- ------------------------------------------------------------------ Evento

-- Sem o texto, o «onde» nem dados da pessoa (R12): só identificadores, o
-- canal, a finalidade e o resultado da régua.
CREATE FUNCTION consentimento_evento() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  INSERT INTO public.evento_saida (comerciante_id, tipo, agregado_tipo, agregado_id, dados)
  VALUES (NEW.comerciante_id, 'consent.changed', 'cliente', NEW.cliente_id,
    jsonb_build_object('cliente_id', NEW.cliente_id, 'consentimento_id', NEW.id,
      'canal', NEW.canal, 'finalidade', NEW.finalidade,
      'pode_receber_marketing', public.pode_receber_marketing(NEW.cliente_id, NEW.canal),
      'quem', NEW.quem,
      'em', to_char(NEW.declarado_em AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
  RETURN NULL;
END
$$;
CREATE TRIGGER consentimento_evento
  AFTER INSERT ON consentimento
  FOR EACH ROW EXECUTE FUNCTION consentimento_evento();

-- -------------------------------------------------------------------- Rasto

ALTER TABLE alteracao_cliente DROP CONSTRAINT alteracao_cliente_entidade_check;
ALTER TABLE alteracao_cliente ADD CONSTRAINT alteracao_cliente_entidade_check
  CHECK (entidade IN ('cliente', 'perfil_faturacao', 'etiqueta_cliente',
    'cliente_etiqueta', 'consentimento'));
CREATE TRIGGER consentimento_rasto
  AFTER INSERT ON consentimento
  FOR EACH ROW EXECUTE FUNCTION clientes_escrever_alteracao();
ALTER TABLE consentimento ENABLE ALWAYS TRIGGER consentimento_rasto;

-- ----------------------------------------------------- RLS e permissões

ALTER TABLE consentimento ENABLE ROW LEVEL SECURITY;
ALTER TABLE consentimento FORCE ROW LEVEL SECURITY;
CREATE POLICY so_o_proprio ON consentimento
  USING (comerciante_id = comerciante_actual())
  WITH CHECK (comerciante_id = comerciante_actual());

GRANT SELECT ON consentimento TO eurolify_api;
GRANT INSERT (comerciante_id, cliente_id, canal, finalidade, declaracao, texto,
  versao_texto, onde) ON consentimento TO eurolify_api;

REVOKE EXECUTE ON FUNCTION consentimento_antes_de_gravar(), consentimento_evento(),
  pode_receber_marketing(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pode_receber_marketing(uuid, text) TO eurolify_api;
