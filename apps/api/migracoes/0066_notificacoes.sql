-- Notificações: o envio de e-mails, começando pelo aviso do prazo do
-- reembolso (docs/33; issue #372; Diogo, 11/10/2026: «aprovado, com a A»,
-- docs/06, DX).
--
-- O que esta migração faz:
-- - `notificacao`: a fila dos e-mails, uma por pessoa e por aviso (N5), com o
--   RLS do comerciante. Guarda a pessoa, não o endereço (N9), e os dados do
--   aviso sem nada do cliente (N3). Muda de estado só para a frente:
--   `a_enviar` → `enviada`, `falhada` ou `cancelada` (a pessoa saiu).
-- - O gatilho do aviso do prazo (0063) grava uma notificação por dono e
--   gestor activos (N2), na mesma transacção que o aviso.
-- - `notificacao_destino()`: o endereço e o nome de quem recebe, lidos no
--   envio, só para uma notificação deste comerciante ainda por enviar e com a
--   pessoa ainda dona ou gestora.
-- - As funções da tarefa (os comerciantes com envios, as notificações a
--   enviar) e a limpeza dos 90 dias (N9, **C**).

SET LOCAL lock_timeout = '10s';

CREATE TABLE notificacao (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  tipo text NOT NULL CHECK (tipo IN ('refund.deadline_approaching', 'refund.deadline_passed')),
  referencia uuid NOT NULL,
  pessoa_id uuid NOT NULL REFERENCES pessoa (id),
  lingua text NOT NULL CHECK (lingua IN ('pt', 'es', 'en')),
  -- Só identificadores, datas e números (N3): nunca dados do cliente.
  dados jsonb NOT NULL CHECK (jsonb_typeof(dados) = 'object'),
  estado text NOT NULL DEFAULT 'a_enviar'
    CHECK (estado IN ('a_enviar', 'enviada', 'falhada', 'cancelada')),
  tentativas integer NOT NULL DEFAULT 0 CHECK (tentativas BETWEEN 0 AND 6),
  proxima_em timestamptz NOT NULL DEFAULT now(),
  -- O código do erro (do SMTP ou da rede), sem a mensagem do servidor.
  ultimo_erro text CHECK (ultimo_erro IS NULL OR ultimo_erro ~ '^[a-z0-9_.]{1,60}$'),
  id_mensagem text CHECK (id_mensagem IS NULL OR length(id_mensagem) BETWEEN 1 AND 300),
  criada_em timestamptz NOT NULL DEFAULT now(),
  terminada_em timestamptz,
  UNIQUE (comerciante_id, id),
  -- Nunca duas para a mesma pessoa e o mesmo aviso (N5).
  UNIQUE (tipo, referencia, pessoa_id),
  CHECK ((estado = 'a_enviar') = (terminada_em IS NULL)),
  CHECK (estado <> 'enviada' OR id_mensagem IS NOT NULL)
);
CREATE INDEX notificacao_a_enviar ON notificacao (comerciante_id, proxima_em)
  WHERE estado = 'a_enviar';

-- Os estados só para a frente; o resto não muda; não se apaga (só a limpeza
-- dos 90 dias, pelo dono das tabelas).
CREATE FUNCTION notificacao_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.estado := 'a_enviar';
    NEW.tentativas := 0;
    NEW.ultimo_erro := NULL;
    NEW.id_mensagem := NULL;
    NEW.criada_em := now();
    NEW.terminada_em := NULL;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - 'estado' - 'tentativas' - 'proxima_em' - 'ultimo_erro' - 'id_mensagem'
      - 'terminada_em')
     IS DISTINCT FROM (to_jsonb(OLD) - 'estado' - 'tentativas' - 'proxima_em' - 'ultimo_erro'
      - 'id_mensagem' - 'terminada_em') THEN
    RAISE EXCEPTION 'notifications.immutable: a notificação não muda';
  END IF;
  IF OLD.estado <> 'a_enviar' THEN
    RAISE EXCEPTION 'notifications.immutable: uma notificação % não muda', OLD.estado;
  END IF;
  IF NEW.tentativas < OLD.tentativas THEN
    RAISE EXCEPTION 'notifications.invalid_transition: as tentativas não descem';
  END IF;
  IF NEW.estado <> 'a_enviar' THEN
    NEW.terminada_em := now();
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER notificacao_antes_de_gravar BEFORE INSERT OR UPDATE ON notificacao
  FOR EACH ROW EXECUTE FUNCTION notificacao_antes_de_gravar();
ALTER TABLE notificacao ENABLE ALWAYS TRIGGER notificacao_antes_de_gravar;
-- Nem esvaziar de uma vez (revisão do #373, P3-8), como as tabelas da 0018.
CREATE TRIGGER notificacao_sem_truncate BEFORE TRUNCATE ON notificacao
  FOR EACH STATEMENT EXECUTE FUNCTION rasto_so_se_acrescenta();
ALTER TABLE notificacao ENABLE ALWAYS TRIGGER notificacao_sem_truncate;

ALTER TABLE notificacao ENABLE ROW LEVEL SECURITY;
ALTER TABLE notificacao FORCE ROW LEVEL SECURITY;
CREATE POLICY so_o_proprio ON notificacao
  USING (comerciante_id = comerciante_actual())
  WITH CHECK (comerciante_id = comerciante_actual());
REVOKE ALL ON notificacao FROM PUBLIC;
GRANT SELECT ON notificacao TO eurolify_api;
GRANT UPDATE (estado, tentativas, proxima_em, ultimo_erro, id_mensagem, terminada_em)
  ON notificacao TO eurolify_api;

-- ---------------------------------------------- O aviso do prazo (N2, N3)

-- Uma por dono e gestor activos (N2), na língua do Hub do comerciante (N4). A
-- pessoa e o membro têm RLS sem política para a API: lê-os o dono.
CREATE FUNCTION devolucao_prazo_notificacao() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  t text;
  prazo record;
  lingua text;
  loja text;
BEGIN
  IF NEW.prazo_passado_em IS NOT NULL AND OLD.prazo_passado_em IS NULL THEN
    t := 'refund.deadline_passed';
  ELSIF NEW.aviso_prazo_em IS NOT NULL AND OLD.aviso_prazo_em IS NULL THEN
    t := 'refund.deadline_approaching';
  ELSE
    RETURN NULL;
  END IF;
  SELECT * INTO prazo FROM public.posvenda_prazo_da_devolucao(NEW.id);
  -- O nome da loja: uma pessoa pode ser da equipa de várias (revisão do
  -- #373, P2-4).
  SELECT CASE WHEN c.lingua IN ('pt', 'es', 'en') THEN c.lingua ELSE 'en' END, c.nome
    INTO lingua, loja FROM public.comerciante c WHERE c.id = NEW.comerciante_id;
  INSERT INTO public.notificacao (comerciante_id, tipo, referencia, pessoa_id, lingua, dados)
  SELECT NEW.comerciante_id, t, NEW.id, m.pessoa_id, lingua,
    jsonb_build_object('loja', loja, 'devolucao', NEW.id, 'encomenda', NEW.encomenda_id,
      'reembolsar_ate', to_char(prazo.ate, 'YYYY-MM-DD'), 'dias', prazo.dias)
  FROM public.membro m JOIN public.pessoa p ON p.id = m.pessoa_id
  WHERE m.comerciante_id = NEW.comerciante_id AND m.ate IS NULL
    AND m.papel IN ('dono', 'gestor') AND p.estado = 'activa'
  ON CONFLICT (tipo, referencia, pessoa_id) DO NOTHING;
  RETURN NULL;
END
$$;
CREATE TRIGGER devolucao_prazo_notificacao
  AFTER UPDATE OF aviso_prazo_em, prazo_passado_em ON devolucao
  FOR EACH ROW EXECUTE FUNCTION devolucao_prazo_notificacao();
ALTER TABLE devolucao ENABLE ALWAYS TRIGGER devolucao_prazo_notificacao;

-- ------------------------------------------------------------- O envio

-- Quem recebe, lido no envio (N9): só uma notificação deste comerciante
-- ainda por enviar, e só se a pessoa continua activa e dona ou gestora.
-- Sem linha, a tarefa cancela-a.
CREATE FUNCTION notificacao_destino(p_notificacao uuid)
  RETURNS TABLE (email text, nome text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT p.email, p.nome
  FROM public.notificacao n
  JOIN public.pessoa p ON p.id = n.pessoa_id AND p.estado = 'activa'
  JOIN public.membro m ON m.pessoa_id = n.pessoa_id AND m.comerciante_id = n.comerciante_id
    AND m.ate IS NULL AND m.papel IN ('dono', 'gestor')
  WHERE n.id = p_notificacao AND n.comerciante_id = public.comerciante_actual()
    AND n.estado = 'a_enviar'
$$;

-- O trabalho da tarefa, numa tabela interna como as filas da 0047 e da
-- 0063: a `notificacao` tem o RLS forçado e a tarefa precisa de saber, sem
-- comerciante, em quais entrar. `quando`: a hora do envio (por enviar) ou a
-- de apagar (terminada, 90 dias depois). Escreve-a o gatilho; lê-a a função.
CREATE TABLE tarefa_notificacao (
  notificacao_id uuid PRIMARY KEY,
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  quando timestamptz NOT NULL
);
CREATE INDEX tarefa_notificacao_quando ON tarefa_notificacao (quando);
ALTER TABLE tarefa_notificacao ENABLE ROW LEVEL SECURITY;
CREATE POLICY so_o_proprio ON tarefa_notificacao
  USING (comerciante_id = comerciante_actual())
  WITH CHECK (comerciante_id = comerciante_actual());
REVOKE ALL ON tarefa_notificacao FROM PUBLIC;

CREATE FUNCTION notificacao_tarefa() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.tarefa_notificacao WHERE notificacao_id = OLD.id;
    RETURN NULL;
  END IF;
  INSERT INTO public.tarefa_notificacao (notificacao_id, comerciante_id, quando)
  VALUES (NEW.id, NEW.comerciante_id, CASE WHEN NEW.estado = 'a_enviar' THEN NEW.proxima_em
    ELSE NEW.terminada_em + interval '90 days' END)
  ON CONFLICT (notificacao_id) DO UPDATE SET quando = EXCLUDED.quando;
  RETURN NULL;
END
$$;
CREATE TRIGGER notificacao_tarefa AFTER INSERT OR UPDATE OR DELETE ON notificacao
  FOR EACH ROW EXECUTE FUNCTION notificacao_tarefa();
ALTER TABLE notificacao ENABLE ALWAYS TRIGGER notificacao_tarefa;

-- Os comerciantes com trabalho: envios ou limpezas (a tarefa entra em cada um).
CREATE FUNCTION notificacao_comerciantes() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT DISTINCT t.comerciante_id FROM public.tarefa_notificacao t WHERE t.quando <= now()
$$;

-- A limpeza dos 90 dias depois de terminada (N9, **C**): pelo dono das
-- tabelas, só deste comerciante. Devolve quantas apagou.
CREATE FUNCTION notificacao_apagar_antigas() RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  n integer;
BEGIN
  DELETE FROM public.notificacao x
  WHERE x.comerciante_id = public.comerciante_actual() AND x.estado <> 'a_enviar'
    AND x.terminada_em < now() - interval '90 days';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;

-- O apagar só passa pela função acima: o gatilho recusa o resto.
CREATE FUNCTION notificacao_antes_de_apagar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF OLD.estado = 'a_enviar' OR OLD.terminada_em >= now() - interval '90 days' THEN
    RAISE EXCEPTION 'notifications.immutable: uma notificação só se apaga 90 dias depois de terminada';
  END IF;
  RETURN OLD;
END
$$;
CREATE TRIGGER notificacao_antes_de_apagar BEFORE DELETE ON notificacao
  FOR EACH ROW EXECUTE FUNCTION notificacao_antes_de_apagar();
ALTER TABLE notificacao ENABLE ALWAYS TRIGGER notificacao_antes_de_apagar;

REVOKE EXECUTE ON FUNCTION notificacao_antes_de_gravar(), devolucao_prazo_notificacao(),
  notificacao_tarefa(),
  notificacao_destino(uuid), notificacao_comerciantes(), notificacao_apagar_antigas(),
  notificacao_antes_de_apagar() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION notificacao_destino(uuid), notificacao_comerciantes(),
  notificacao_apagar_antigas() TO eurolify_api;
