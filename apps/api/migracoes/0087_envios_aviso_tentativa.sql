-- Envios: o aviso a quem expede quando a transportadora diz «tentativa
-- falhada» ou «disponível para levantar» (docs/36 §20; Q4 da decisão ED;
-- issue #393; Diogo, 13/10/2026: «sim, aprovo; avança com o código»). Ex.: a
-- transportadora não encontra ninguém na morada da expedição; o dono, o
-- gestor e o armazém recebem um e-mail com a expedição, o seguimento e a
-- hora, sem o nome nem a morada de quem recebe.
--
-- Usa a fila de e-mails do docs/34 (§3–§4, §12, §12.1), sem mudar o
-- fornecedor nem as regras N4 a N11:
-- - o tipo `shipment.needs_attention`, um por expedição, por estado e por
--   pessoa (a `referencia` deriva-se da expedição e do estado: a segunda
--   tentativa falhada não avisa outra vez, um «para levantar» sim);
-- - a quem: quem expede (`fulfilment:write`: o dono, o gestor e o armazém),
--   lido outra vez no envio (`notificacao_destino()`);
-- - no envio fica `cancelada` se a expedição já acabou.
SET LOCAL lock_timeout = '10s';

ALTER TABLE notificacao DROP CONSTRAINT notificacao_tipo_check;
ALTER TABLE notificacao ADD CONSTRAINT notificacao_tipo_check
  CHECK (tipo IN ('refund.deadline_approaching', 'refund.deadline_passed', 'task.overdue',
    'invoicing.connection_error', 'shipment.needs_attention'));

-- Quem expede: membro activo, pessoa activa, e o papel tem `fulfilment:write`
-- (a régua única `papel_ambitos()`).
CREATE FUNCTION envios_aviso_pode_receber(p_comerciante uuid, p_pessoa uuid)
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.membro m
    JOIN public.pessoa p ON p.id = m.pessoa_id
    WHERE m.comerciante_id = p_comerciante AND m.pessoa_id = p_pessoa
      AND m.ate IS NULL AND p.estado = 'activa'
      AND 'fulfilment:write' = ANY (public.papel_ambitos(m.papel)))
$$;

-- A referência do aviso: a mesma para a mesma expedição e o mesmo estado
-- (N5: nunca dois para a mesma pessoa e o mesmo aviso).
CREATE FUNCTION envios_aviso_referencia(p_expedicao uuid, p_estado text) RETURNS uuid
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT md5('shipment.needs_attention:' || p_expedicao::text || ':' || p_estado)::uuid
$$;

-- Um evento novo de «tentativa falhada» ou «para levantar», numa expedição
-- que ainda não acabou: uma notificação por pessoa que expede, na língua do
-- Hub (N4). Só identificadores, o número de seguimento, o estado e a hora;
-- nunca o texto da transportadora (pode trazer quem recebe) nem a morada.
CREATE FUNCTION evento_seguimento_aviso() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  x public.expedicao;
  lingua text;
  loja text;
  fuso text;
BEGIN
  IF NEW.estado_normalizado NOT IN ('tentativa_falhada', 'disponivel_para_levantar') THEN
    RETURN NULL;
  END IF;
  SELECT * INTO x FROM public.expedicao e
  WHERE e.id = NEW.expedicao_id AND e.comerciante_id = NEW.comerciante_id;
  IF x.id IS NULL
     OR x.estado IN ('entregue', 'devolvida_ao_remetente', 'perdida', 'cancelada') THEN
    RETURN NULL;
  END IF;
  SELECT CASE WHEN c.lingua IN ('pt', 'es', 'en') THEN c.lingua ELSE 'en' END, c.nome, c.fuso
    INTO lingua, loja, fuso FROM public.comerciante c WHERE c.id = NEW.comerciante_id;
  INSERT INTO public.notificacao (comerciante_id, tipo, referencia, pessoa_id, lingua, dados)
  SELECT NEW.comerciante_id, 'shipment.needs_attention',
    public.envios_aviso_referencia(NEW.expedicao_id, NEW.estado_normalizado), m.pessoa_id,
    lingua,
    jsonb_build_object('loja', loja, 'expedicao', NEW.expedicao_id,
      'estado', NEW.estado_normalizado, 'transportadora', x.transportadora,
      'seguimento', x.seguimento,
      'em', to_char(NEW.em AT TIME ZONE fuso, 'YYYY-MM-DD HH24:MI'), 'fuso', fuso)
  FROM public.membro m
  WHERE m.comerciante_id = NEW.comerciante_id
    AND public.envios_aviso_pode_receber(NEW.comerciante_id, m.pessoa_id)
  ON CONFLICT (tipo, referencia, pessoa_id) DO NOTHING;
  RETURN NULL;
END
$$;
-- Sem `ALWAYS`, pela regra da 0053 (um gatilho que escreve não fica ALWAYS: uma
-- cópia reposta em modo `replica` guarda as linhas como estão e não cria
-- notificações a mais). Os gatilhos das notificações da 0067, 0071 e 0084
-- ficaram ALWAYS; o risco está no docs/34 §12 (P3-7 do #389).
CREATE TRIGGER evento_seguimento_aviso AFTER INSERT ON evento_seguimento
  FOR EACH ROW EXECUTE FUNCTION evento_seguimento_aviso();

-- O aviso ainda faz sentido, lido no envio: a expedição não acabou.
CREATE FUNCTION envios_aviso_espera(p_expedicao uuid) RETURNS boolean
  LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.expedicao e
    WHERE e.comerciante_id = public.comerciante_actual() AND e.id = p_expedicao
      AND e.estado NOT IN ('entregue', 'devolvida_ao_remetente', 'perdida', 'cancelada'))
$$;

-- Quem recebe, lido no envio (N9): como na 0084, e quem ainda expede.
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
          ELSE m.papel IN ('dono', 'gestor') END
$$;

REVOKE EXECUTE ON FUNCTION envios_aviso_pode_receber(uuid, uuid),
  envios_aviso_referencia(uuid, text), evento_seguimento_aviso(),
  envios_aviso_espera(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION envios_aviso_espera(uuid) TO eurolify_api;
