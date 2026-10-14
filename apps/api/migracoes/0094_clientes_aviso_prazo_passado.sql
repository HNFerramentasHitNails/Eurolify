-- O aviso quando o prazo legal de um pedido do titular passa, parte 2 (docs/23
-- §15.15, A1–A4; Diogo, 13/10/2026: Q-P3 «a»; docs/06, EO). Ex.: a Ana
-- escreve a 2/10 a pedir o apagamento; o dono regista a chegada; o prazo
-- legal é 2/11; a 3/11 o pedido continua aberto e, na volta seguinte da
-- tarefa, sai um e-mail aos donos da loja, uma vez.
--
-- A lei: RGPD, art. 12.º, n.º 3 (a mesma fonte da 0092: `eur-lex`
-- `corpus/dados-e-privacidade/32016R0679-rgpd.md`, versão consolidada
-- 02016R0679-20160504, obtido_em 2026-10-12): responde-se «no prazo de um
-- mês» (W); o prazo prorrogado, se houver, conta como o da 0092 (C).
--
-- O que esta migração faz:
-- - Em `pedido_titular_recebido`: `aviso_prazo_em`, quando se avisou. Põe-se
--   uma vez, num pedido aberto, e nunca se tira (a guarda da 0092 passa a
--   conferi-lo). Prorrogar depois não volta a avisar (A1).
-- - As funções da tarefa (A4): os comerciantes com pedidos por avisar, os
--   pedidos por avisar no comerciante do contexto (abertos, sem aviso, com o
--   dia de hoje no fuso do comerciante depois do prazo em vigor) e a que marca
--   um. A tarefa só marca; a base cria a notificação.
-- - O tipo `privacy.deadline_passed`: uma notificação por pessoa que pode
--   receber (A2: membro activo, pessoa activa e `customers:privacy` pela
--   régua `papel_ambitos()`, hoje só o dono), na língua do Hub, com a loja,
--   os identificadores do pedido e da ficha, o tipo e os dois dias (A3).
--   Nunca o nome, o e-mail nem o NIF do cliente. No envio, confere-se que o
--   pedido ainda está aberto e que a pessoa ainda pode receber.
-- - A contagem para a verificação diária da VPS (A4; padrão da 0088): os
--   pedidos abertos com o prazo passado há mais de um dia e sem aviso, de
--   todos os comerciantes; só o número.

SET LOCAL lock_timeout = '10s';

-- ------------------------------------------------------------ A coluna

ALTER TABLE pedido_titular_recebido ADD COLUMN aviso_prazo_em timestamptz;

-- A guarda da 0092, com o aviso: põe-se uma vez, num pedido aberto (o fechado
-- já não muda), nunca se tira nem se muda, e não no mesmo acto que fechar ou
-- prorrogar. Só recusa (é uma guarda): continua `ALWAYS` (regra da 0091).
CREATE OR REPLACE FUNCTION pedido_recebido_antes_de_alterar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  hoje date := public.clientes_hoje(OLD.comerciante_id);
BEGIN
  IF ROW(NEW.id, NEW.comerciante_id, NEW.cliente_id, NEW.tipo, NEW.canal, NEW.recebido_em,
         NEW.recebido_dia, NEW.quem, NEW.criado_em)
     IS DISTINCT FROM ROW(OLD.id, OLD.comerciante_id, OLD.cliente_id, OLD.tipo, OLD.canal,
         OLD.recebido_em, OLD.recebido_dia, OLD.quem, OLD.criado_em) THEN
    RAISE EXCEPTION 'customers.immutable_identity: o pedido recebido não muda de ficha, tipo, canal, data de chegada nem de quem o registou';
  END IF;
  IF OLD.estado <> 'aberto' THEN
    RAISE EXCEPTION 'customers.invalid_transition: o pedido recebido está %; fechado não muda',
      OLD.estado;
  END IF;
  IF NEW.aviso_prazo_em IS DISTINCT FROM OLD.aviso_prazo_em THEN
    IF OLD.aviso_prazo_em IS NOT NULL THEN
      RAISE EXCEPTION 'customers.invalid_transition: o aviso do prazo legal já foi dado; dá-se uma vez';
    END IF;
    IF NEW.estado <> OLD.estado
       OR ROW(NEW.prorrogado_ate, NEW.prorrogado_motivo, NEW.titular_informado_em)
          IS DISTINCT FROM ROW(OLD.prorrogado_ate, OLD.prorrogado_motivo,
                               OLD.titular_informado_em) THEN
      RAISE EXCEPTION 'customers.invalid_transition: avisar do prazo, prorrogar e fechar são actos diferentes';
    END IF;
  END IF;
  IF ROW(NEW.prorrogado_ate, NEW.prorrogado_motivo, NEW.titular_informado_em)
     IS DISTINCT FROM ROW(OLD.prorrogado_ate, OLD.prorrogado_motivo, OLD.titular_informado_em) THEN
    IF OLD.prorrogado_ate IS NOT NULL THEN
      RAISE EXCEPTION 'customers.invalid_transition: o prazo já foi prorrogado; prorroga-se uma vez';
    END IF;
    IF NEW.estado <> OLD.estado THEN
      RAISE EXCEPTION 'customers.invalid_transition: prorrogar e fechar são dois actos';
    END IF;
    IF NEW.titular_informado_em > hoje THEN
      RAISE EXCEPTION 'customers.invalid_field: o dia em que o titular foi informado não pode ser no futuro';
    END IF;
  END IF;
  IF NEW.estado <> OLD.estado AND NEW.fechado_em > hoje THEN
    RAISE EXCEPTION 'customers.invalid_field: o dia do fim não pode ser no futuro';
  END IF;
  RETURN NEW;
END
$$;

-- ------------------------------------------------------- A tarefa (A1, A4)

-- A regra, num sítio: o pedido do contexto está por avisar — aberto, sem
-- aviso e com o dia de hoje (fuso do comerciante) depois do prazo em vigor
-- (o prorrogado, se houver). A tarefa, a marca e a contagem lêem-na.
-- Do dono: a API não chama a `clientes_hoje()` (0092).
CREATE FUNCTION clientes_aviso_prazo_pendentes(p_limite integer) RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT r.id FROM public.pedido_titular_recebido r
  WHERE r.comerciante_id = public.comerciante_actual() AND r.estado = 'aberto'
    AND r.aviso_prazo_em IS NULL
    AND public.clientes_hoje(r.comerciante_id) > coalesce(r.prorrogado_ate, r.prazo_legal)
  ORDER BY coalesce(r.prorrogado_ate, r.prazo_legal), r.id
  LIMIT greatest(p_limite, 0)
$$;

-- Os comerciantes com pedidos por avisar. A tabela tem o RLS forçado, também
-- para o dono: cada comerciante vê-se no contexto dele, só durante a
-- pergunta, e volta o que estava (o padrão da 0088). Os comerciantes são os
-- da tarefa das filas (0066): com um membro activo ou uma chave válida —
-- sem nenhum, não há quem receba nem quem responda.
CREATE FUNCTION clientes_aviso_prazo_comerciantes() RETURNS SETOF uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  anterior text := pg_catalog.current_setting('eurolify.comerciante', true);
  c uuid;
  tem boolean;
BEGIN
  FOR c IN SELECT x FROM public.tarefas_comerciantes() x LOOP
    PERFORM pg_catalog.set_config('eurolify.comerciante', c::text, true);
    tem := EXISTS (SELECT 1 FROM public.clientes_aviso_prazo_pendentes(1));
    PERFORM pg_catalog.set_config('eurolify.comerciante', coalesce(anterior, ''), true);
    IF tem THEN
      RETURN NEXT c;
    END IF;
  END LOOP;
END
$$;

-- Marca um pedido do contexto como avisado, se ainda estiver por avisar (a
-- mesma regra, conferida outra vez depois do bloqueio da linha: um pedido
-- fechado ou avisado entretanto não marca). Só uma tarefa do sistema
-- (`eurolify.quem` = `sistema:…`). Devolve se marcou.
CREATE FUNCTION clientes_aviso_prazo_marcar(p_id uuid) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem text := nullif(btrim(current_setting('eurolify.quem', true)), '');
  n integer;
BEGIN
  IF quem IS NULL OR quem !~ '^sistema:' THEN
    RAISE EXCEPTION 'customers.change_without_who: o aviso do prazo legal marca-o a tarefa do sistema (quem: %)',
      coalesce(quem, 'nenhum');
  END IF;
  UPDATE public.pedido_titular_recebido r SET aviso_prazo_em = now()
  WHERE r.comerciante_id = public.comerciante_actual() AND r.id = p_id
    AND r.estado = 'aberto' AND r.aviso_prazo_em IS NULL
    AND public.clientes_hoje(r.comerciante_id) > coalesce(r.prorrogado_ate, r.prazo_legal);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END
$$;

-- ------------------------------------------------- A notificação (A2, A3)

ALTER TABLE notificacao DROP CONSTRAINT notificacao_tipo_check;
ALTER TABLE notificacao ADD CONSTRAINT notificacao_tipo_check
  CHECK (tipo IN ('refund.deadline_approaching', 'refund.deadline_passed', 'task.overdue',
    'invoicing.connection_error', 'shipment.needs_attention', 'privacy.deadline_passed'));

-- A pessoa pode receber o aviso (A2): membro activo, pessoa activa, e o papel
-- responde aos pedidos do titular (`customers:privacy`, a régua única
-- `papel_ambitos()`; hoje só o dono).
CREATE FUNCTION clientes_aviso_pode_receber(p_comerciante uuid, p_pessoa uuid)
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.membro m
    JOIN public.pessoa p ON p.id = m.pessoa_id
    WHERE m.comerciante_id = p_comerciante AND m.pessoa_id = p_pessoa
      AND m.ate IS NULL AND p.estado = 'activa'
      AND 'customers:privacy' = ANY (public.papel_ambitos(m.papel)))
$$;

-- Ao marcar (`aviso_prazo_em` de nulo para um valor): uma notificação por
-- pessoa que pode receber, na língua do Hub (N4). A `referencia` é o pedido:
-- uma por pedido e por pessoa (N5). Só a loja, os identificadores, o tipo e
-- os dois dias (A3); nunca o nome, o e-mail nem o NIF do cliente.
CREATE FUNCTION pedido_recebido_aviso_notificacao() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  lingua text;
  loja text;
BEGIN
  IF NEW.aviso_prazo_em IS NULL OR OLD.aviso_prazo_em IS NOT NULL THEN
    RETURN NULL;
  END IF;
  SELECT CASE WHEN c.lingua IN ('pt', 'es', 'en') THEN c.lingua ELSE 'en' END, c.nome
    INTO lingua, loja FROM public.comerciante c WHERE c.id = NEW.comerciante_id;
  INSERT INTO public.notificacao (comerciante_id, tipo, referencia, pessoa_id, lingua, dados)
  SELECT NEW.comerciante_id, 'privacy.deadline_passed', NEW.id, m.pessoa_id, lingua,
    jsonb_build_object('loja', loja, 'pedido', NEW.id, 'cliente', NEW.cliente_id,
      'tipo', NEW.tipo, 'recebido', to_char(NEW.recebido_dia, 'YYYY-MM-DD'),
      'prazo', to_char(coalesce(NEW.prorrogado_ate, NEW.prazo_legal), 'YYYY-MM-DD'))
  FROM public.membro m
  WHERE m.comerciante_id = NEW.comerciante_id
    AND public.clientes_aviso_pode_receber(NEW.comerciante_id, m.pessoa_id)
  ON CONFLICT (tipo, referencia, pessoa_id) DO NOTHING;
  RETURN NULL;
END
$$;
-- Sem `ALWAYS` (regra da 0053 e da 0091): um gatilho que escreve não corre
-- numa cópia reposta em modo `replica`, que já traz as notificações.
CREATE TRIGGER pedido_titular_recebido_aviso_notificacao
  AFTER UPDATE OF aviso_prazo_em ON pedido_titular_recebido
  FOR EACH ROW
  WHEN (OLD.aviso_prazo_em IS NULL AND NEW.aviso_prazo_em IS NOT NULL)
  EXECUTE FUNCTION pedido_recebido_aviso_notificacao();

-- O aviso ainda faz sentido, lido no envio: o pedido continua aberto (se
-- entretanto fechou, o e-mail não sai).
CREATE FUNCTION clientes_aviso_espera(p_pedido uuid) RETURNS boolean
  LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.pedido_titular_recebido r
    WHERE r.comerciante_id = public.comerciante_actual() AND r.id = p_pedido
      AND r.estado = 'aberto')
$$;

-- Quem recebe, lido no envio (N9): como na 0087, e quem ainda responde aos
-- pedidos do titular.
CREATE OR REPLACE FUNCTION notificacao_destino(p_notificacao uuid)
  RETURNS TABLE (email text, nome text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT p.email, p.nome
  FROM public.notificacao n
  JOIN public.pessoa p ON p.id = n.pessoa_id AND p.estado = 'activa'
  JOIN public.membro m ON m.pessoa_id = n.pessoa_id AND m.comerciante_id = n.comerciante_id
    AND m.ate IS NULL
  LEFT JOIN public.atribuicao_rasto r ON n.tipo = 'task.overdue'
    AND r.comerciante_id = n.comerciante_id AND r.id = n.referencia
  LEFT JOIN public.atribuicao a ON a.comerciante_id = r.comerciante_id AND a.id = r.atribuicao_id
  WHERE n.id = p_notificacao AND n.comerciante_id = public.comerciante_actual()
    AND n.estado = 'a_enviar'
    AND CASE n.tipo
          WHEN 'task.overdue' THEN
            a.id IS NOT NULL AND public.tarefas_aviso_pode_receber(n.comerciante_id, n.pessoa_id,
              a.fila, public.tarefas_aviso_responsavel(n.comerciante_id, a.fila, a.responsavel))
          WHEN 'invoicing.connection_error' THEN
            public.faturacao_aviso_pode_receber(n.comerciante_id, n.pessoa_id)
          WHEN 'shipment.needs_attention' THEN
            public.envios_aviso_pode_receber(n.comerciante_id, n.pessoa_id)
          WHEN 'privacy.deadline_passed' THEN
            public.clientes_aviso_pode_receber(n.comerciante_id, n.pessoa_id)
          ELSE m.papel IN ('dono', 'gestor') END
$$;

-- ------------------------------------- A verificação diária (A4; 0088)

-- Os pedidos abertos com o prazo em vigor passado há mais de um dia (no fuso
-- do comerciante) e ainda sem aviso: a tarefa, de hora a hora, já os devia
-- ter marcado no primeiro dia. Só a contagem, de todos os comerciantes, sem
-- identificadores. VOLATILE: muda um parâmetro da sessão, como a 0088.
CREATE FUNCTION clientes_pedidos_sem_aviso_em_atraso() RETURNS bigint
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  anterior text := pg_catalog.current_setting('eurolify.comerciante', true);
  c uuid;
  n bigint := 0;
BEGIN
  FOR c IN SELECT x FROM public.tarefas_comerciantes() x LOOP
    PERFORM pg_catalog.set_config('eurolify.comerciante', c::text, true);
    n := n + (SELECT count(*) FROM public.pedido_titular_recebido r
      WHERE r.comerciante_id = c AND r.estado = 'aberto' AND r.aviso_prazo_em IS NULL
        AND public.clientes_hoje(c) > coalesce(r.prorrogado_ate, r.prazo_legal) + 1);
  END LOOP;
  PERFORM pg_catalog.set_config('eurolify.comerciante', coalesce(anterior, ''), true);
  RETURN n;
END
$$;

-- ------------------------------------------------------------ Permissões

REVOKE EXECUTE ON FUNCTION clientes_aviso_prazo_pendentes(integer),
  clientes_aviso_prazo_comerciantes(), clientes_aviso_prazo_marcar(uuid),
  clientes_aviso_pode_receber(uuid, uuid), pedido_recebido_aviso_notificacao(),
  clientes_aviso_espera(uuid), clientes_pedidos_sem_aviso_em_atraso() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION clientes_aviso_prazo_pendentes(integer),
  clientes_aviso_prazo_comerciantes(), clientes_aviso_prazo_marcar(uuid),
  clientes_aviso_espera(uuid) TO eurolify_api;
-- A contagem: só a quem a chama, a verificação diária (como a 0088).
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'eurolify_limpeza') THEN
    GRANT EXECUTE ON FUNCTION clientes_pedidos_sem_aviso_em_atraso() TO eurolify_limpeza;
  END IF;
END
$$;
