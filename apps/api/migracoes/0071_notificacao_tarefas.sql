-- Notificações: o aviso de um caso vencido das tarefas das filas passa a
-- e-mail (docs/34 §12; issue #372; Diogo, 12/10/2026: «A, aprovado»,
-- docs/06, EB).
--
-- O que esta migração faz:
-- - O `tipo` da `notificacao` ganha `task.overdue`.
-- - O gatilho da linha `vencida` do `atribuicao_rasto` (0066) grava uma
--   notificação por pessoa, na mesma transacção que o aviso (N5, T2); e,
--   numa atribuição já avisada, as linhas `atribuida` e `retirada` levam o
--   mesmo aviso a quem passa a recebê-lo (revisão do #389, P2-1). Vai à
--   pessoa responsável pelo caso; sem responsável, a quem pode decidir a fila e
--   atribuir (`tasks:assign`) — Q12 A. A `referencia` é a linha do rasto:
--   um prazo novo que vence outra vez dá um aviso novo (R6). A fila
--   `prazo_reembolso` não entra: tem os avisos da 0067 (T3).
-- - `notificacao_destino()` passa a conferir, no `task.overdue`, que a
--   pessoa ainda pode receber pela mesma regra (T5).
-- - `tarefas_aviso_espera()`: o caso ainda espera — continua na fila na
--   mesma passagem, vencido, e o prazo não mudou depois do aviso (T5).

SET LOCAL lock_timeout = '10s';

ALTER TABLE notificacao DROP CONSTRAINT notificacao_tipo_check;
ALTER TABLE notificacao ADD CONSTRAINT notificacao_tipo_check
  CHECK (tipo IN ('refund.deadline_approaching', 'refund.deadline_passed', 'task.overdue'));

-- A pessoa pode receber o aviso de um caso da fila (Q12 A): membro activo e
-- pessoa activa, com o âmbito de decidir a fila no papel; e, havendo
-- responsável, é ela; sem responsável, o papel também atribui
-- (`tasks:assign`). O papel lê-se de `papel_ambitos()`, a régua única.
CREATE FUNCTION tarefas_aviso_pode_receber(p_comerciante uuid, p_pessoa uuid,
                                           p_fila text, p_responsavel uuid)
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.membro m
    JOIN public.pessoa p ON p.id = m.pessoa_id
    JOIN public.tarefas_filas() f ON f.fila = p_fila
    WHERE m.comerciante_id = p_comerciante AND m.pessoa_id = p_pessoa
      AND m.ate IS NULL AND p.estado = 'activa'
      AND f.ambito_decidir = ANY (public.papel_ambitos(m.papel))
      AND CASE WHEN p_responsavel IS NOT NULL THEN p_pessoa = p_responsavel
               ELSE 'tasks:assign' = ANY (public.papel_ambitos(m.papel)) END)
$$;

-- O responsável que conta para o aviso: o da atribuição, se ainda pode
-- decidir a fila; senão, nenhum (o caso vai a quem decide e atribui, nunca
-- fica sem ninguém). O R8 (0066) já tira quem deixa de poder; isto é a
-- segunda trava, para um aviso nunca ir para o vazio.
CREATE FUNCTION tarefas_aviso_responsavel(p_comerciante uuid, p_fila text,
                                          p_responsavel uuid)
  RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT CASE WHEN p_responsavel IS NOT NULL
    AND public.tarefas_aviso_pode_receber(p_comerciante, p_responsavel, p_fila, p_responsavel)
    THEN p_responsavel END
$$;

-- O gatilho do aviso (T2): só identificadores, o motivo da fila (códigos),
-- o prazo no fuso do comerciante, a hora do aviso e a loja (T4); nunca dados
-- do cliente nem o motivo livre de uma mudança de prazo (docs/33 §6). O
-- membro e a pessoa têm RLS sem política para a API: lê-os o dono.
--
-- Corre na linha `vencida` (o aviso) e também nas linhas `atribuida` e
-- `retirada` de uma atribuição já avisada cujo caso ainda espera: quem passa
-- a receber pela T1 (o responsável novo, ou quem decide e atribui quando o
-- caso fica sem ninguém) recebe o mesmo aviso; o anterior cancela-se no
-- envio. Sem isto, um aviso marcado e ainda não enviado ficava sem ninguém
-- (revisão do #389, P2-1).
CREATE FUNCTION atribuicao_vencida_notificacao() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  a public.atribuicao;
  aviso public.atribuicao_rasto;
  resp uuid;
  motivo text;
  lingua text;
  loja text;
  fuso text;
BEGIN
  SELECT x.* INTO a FROM public.atribuicao x
  WHERE x.id = NEW.atribuicao_id AND x.comerciante_id = NEW.comerciante_id;
  IF NOT FOUND OR a.fila = 'prazo_reembolso' THEN
    RETURN NULL;
  END IF;
  IF NEW.acto = 'vencida' THEN
    aviso := NEW;
  ELSE
    IF a.aviso_vencido_em IS NULL THEN
      RETURN NULL;
    END IF;
    SELECT z.* INTO aviso FROM public.atribuicao_rasto z
    WHERE z.comerciante_id = NEW.comerciante_id AND z.atribuicao_id = a.id
      AND z.acto = 'vencida'
    ORDER BY z.em DESC, z.id DESC LIMIT 1;
    IF NOT FOUND OR NOT public.tarefas_aviso_espera(aviso.id) THEN
      RETURN NULL;
    END IF;
  END IF;
  resp := public.tarefas_aviso_responsavel(NEW.comerciante_id, a.fila, a.responsavel);
  SELECT x.motivo INTO motivo FROM public.tarefas_casos(ARRAY[a.fila]) x
  WHERE x.caso = a.caso AND x.entrou_em = a.entrou_em;
  SELECT CASE WHEN c.lingua IN ('pt', 'es', 'en') THEN c.lingua ELSE 'en' END, c.nome, c.fuso
    INTO lingua, loja, fuso FROM public.comerciante c WHERE c.id = NEW.comerciante_id;
  INSERT INTO public.notificacao (comerciante_id, tipo, referencia, pessoa_id, lingua, dados)
  SELECT NEW.comerciante_id, 'task.overdue', aviso.id, m.pessoa_id, lingua,
    jsonb_build_object('loja', loja, 'fila', a.fila, 'caso', a.caso, 'motivo', motivo,
      'prazo', to_char(aviso.prazo_depois AT TIME ZONE fuso, 'YYYY-MM-DD HH24:MI'),
      'avisado_em', to_char(aviso.em AT TIME ZONE fuso, 'YYYY-MM-DD HH24:MI'),
      'fuso', fuso)
  FROM public.membro m
  WHERE m.comerciante_id = NEW.comerciante_id
    AND public.tarefas_aviso_pode_receber(NEW.comerciante_id, m.pessoa_id, a.fila, resp)
  ON CONFLICT (tipo, referencia, pessoa_id) DO NOTHING;
  RETURN NULL;
END
$$;
CREATE TRIGGER atribuicao_vencida_notificacao AFTER INSERT ON atribuicao_rasto
  FOR EACH ROW WHEN (NEW.acto IN ('vencida', 'atribuida', 'retirada'))
  EXECUTE FUNCTION atribuicao_vencida_notificacao();
ALTER TABLE atribuicao_rasto ENABLE ALWAYS TRIGGER atribuicao_vencida_notificacao;

-- O caso do aviso ainda espera (T5): continua aberto na mesma passagem e
-- vencido, com a marca do aviso, e nenhum prazo novo nem aviso novo depois
-- desta linha. Senão, o e-mail diria o contrário da realidade.
CREATE FUNCTION tarefas_aviso_espera(p_rasto uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.atribuicao_rasto r
    JOIN public.atribuicao a ON a.comerciante_id = r.comerciante_id AND a.id = r.atribuicao_id
    JOIN public.tarefas_casos(ARRAY[a.fila]) x ON x.caso = a.caso AND x.entrou_em = a.entrou_em
    WHERE r.id = p_rasto AND r.comerciante_id = public.comerciante_actual()
      AND r.acto = 'vencida' AND x.vencida AND a.aviso_vencido_em IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.atribuicao_rasto z
        WHERE z.comerciante_id = r.comerciante_id AND z.atribuicao_id = r.atribuicao_id
          AND z.acto IN ('prazo_mudado', 'vencida') AND (z.em, z.id) > (r.em, r.id)))
$$;

-- Quem recebe, lido no envio (N9): no aviso do reembolso, como na 0067 (dono
-- ou gestor); no `task.overdue`, a regra do gatilho com o responsável de
-- agora (T5). Sem linha, a tarefa cancela-a.
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
    AND CASE WHEN n.tipo = 'task.overdue' THEN
          a.id IS NOT NULL AND public.tarefas_aviso_pode_receber(n.comerciante_id, n.pessoa_id,
            a.fila, public.tarefas_aviso_responsavel(n.comerciante_id, a.fila, a.responsavel))
        ELSE m.papel IN ('dono', 'gestor') END
$$;

REVOKE EXECUTE ON FUNCTION tarefas_aviso_pode_receber(uuid, uuid, text, uuid),
  tarefas_aviso_responsavel(uuid, text, uuid), atribuicao_vencida_notificacao(),
  tarefas_aviso_espera(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tarefas_aviso_espera(uuid) TO eurolify_api;
