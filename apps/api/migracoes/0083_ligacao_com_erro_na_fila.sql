-- O aviso ao dono quando a ligação ao software de faturação fica com erro
-- (docs/29 §18; issue #310; Diogo, 13/10/2026: «sim, aprovo o desenho com a
-- Q1 em A»; docs/06, EJ). Ex.: no sábado, o Moloni recusa renovar os tokens da
-- «Loja Exemplo»; a ligação fica `com_erro`, entra na fila
-- `ligacao_faturacao` do «A decidir» e sai logo um e-mail aos donos.
--
-- O que esta migração faz:
-- - Na ligação: `com_erro_desde` e `com_erro_passagem` (postos pelo gatilho
--   quando o estado passa a `com_erro`, limpos quando sai) e o motivo,
--   `com_erro_motivo` (`renovacao_recusada` ou `teste_falhou`), que a API
--   grava na mesma actualização (L2, L5).
-- - A oitava fila, `ligacao_faturacao` (L1): lê `invoices:read`, decide
--   `invoices:accounts` (só o dono; L3), prazo por omissão de 1 dia (L4). A
--   régua, o prazo, a lista comum e a restrição da atribuição passam a ter as
--   oito (`tarefas_filas()`, `tarefas_prazo_por_omissao()`, `tarefas_casos()`
--   e `atribuicao.fila`, 0066).
-- - O e-mail logo (Q1 A): o tipo `invoicing.connection_error`, um por dono e
--   por passagem, só quando a ligação fica com erro pela renovação recusada;
--   no envio, confere-se que a ligação ainda está com erro na mesma passagem
--   e que a pessoa ainda pode ligar a conta, e contam-se as faturas retidas.

SET LOCAL lock_timeout = '10s';

-- --------------------------------------------------------- Na ligação

ALTER TABLE ligacao_faturacao
  ADD COLUMN com_erro_desde timestamptz,
  ADD COLUMN com_erro_passagem uuid,
  ADD COLUMN com_erro_motivo text
    CHECK (com_erro_motivo IN ('renovacao_recusada', 'teste_falhou'));

-- As ligações que já estão com erro: a passagem começa agora, sem motivo (não
-- se sabe qual foi; a fila mostra `com_erro`). Não se reescreve o passado.
-- O RLS forçado afrouxa só durante este acerto (como na 0009), para o dono
-- das tabelas ver as ligações de todos os comerciantes. O gatilho da 0069
-- (`ALWAYS`) actualiza o `actualizada_em` destas linhas: a hora de entrada
-- lê-se antes, no próprio SET.
ALTER TABLE ligacao_faturacao NO FORCE ROW LEVEL SECURITY;
UPDATE ligacao_faturacao
SET com_erro_desde = actualizada_em, com_erro_passagem = uuidv7()
WHERE estado = 'com_erro';
ALTER TABLE ligacao_faturacao FORCE ROW LEVEL SECURITY;

ALTER TABLE ligacao_faturacao ADD CONSTRAINT ligacao_faturacao_com_erro_coerente
  CHECK ((estado = 'com_erro') = (com_erro_desde IS NOT NULL)
     AND (com_erro_desde IS NULL) = (com_erro_passagem IS NULL)
     AND (estado = 'com_erro' OR com_erro_motivo IS NULL));

-- «Com erro desde» e a passagem (L5): entrar põe-nos; continuar com erro
-- guarda-os; sair limpa-os. Entrar pede o motivo: só a renovação recusada e o
-- teste falhado põem uma ligação com erro. Na mesma passagem, o motivo só muda
-- para a causa mais grave: de `teste_falhou` para `renovacao_recusada` (a
-- autorização morreu; revisão do #422, P2-3).
CREATE FUNCTION ligacao_com_erro_desde() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.estado <> 'com_erro' THEN
    NEW.com_erro_desde := NULL;
    NEW.com_erro_passagem := NULL;
    NEW.com_erro_motivo := NULL;
  ELSIF TG_OP = 'INSERT' OR OLD.estado <> 'com_erro' THEN
    IF NEW.com_erro_motivo IS NULL THEN
      RAISE EXCEPTION 'invoices.invalid_field: uma ligação fica com erro com o motivo';
    END IF;
    NEW.com_erro_desde := now();
    NEW.com_erro_passagem := uuidv7();
  ELSE
    NEW.com_erro_desde := OLD.com_erro_desde;
    NEW.com_erro_passagem := OLD.com_erro_passagem;
    NEW.com_erro_motivo := CASE WHEN NEW.com_erro_motivo = 'renovacao_recusada'
      THEN 'renovacao_recusada' ELSE coalesce(OLD.com_erro_motivo, NEW.com_erro_motivo) END;
  END IF;
  RETURN NEW;
END
$$;
-- Sem `ALWAYS`, como os «na fila desde» da 0066: uma cópia reposta em modo
-- `replica` guarda as horas e as passagens que tinha (revisão do #422, P3-1).
CREATE TRIGGER ligacao_faturacao_com_erro BEFORE INSERT OR UPDATE ON ligacao_faturacao
  FOR EACH ROW EXECUTE FUNCTION ligacao_com_erro_desde();

GRANT UPDATE (com_erro_motivo) ON ligacao_faturacao TO eurolify_api;

-- ------------------------------------------------------------ A fila

-- Os casos da fila `ligacao_faturacao` (L1): as ligações activas com erro.
-- Sem encomenda: o caso abre o ecrã «Faturação» (L6).
CREATE FUNCTION faturacao_casos_a_decidir()
  RETURNS TABLE (caso uuid, entrou_em timestamptz, motivo text, prazo_legal date,
                 encomenda uuid)
  LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT l.id, l.com_erro_desde, coalesce(l.com_erro_motivo, 'com_erro'), NULL::date,
    NULL::uuid
  FROM public.ligacao_faturacao l
  WHERE l.comerciante_id = public.comerciante_actual()
    AND l.activa AND l.estado = 'com_erro'
$$;

CREATE OR REPLACE FUNCTION tarefas_filas()
  RETURNS TABLE (fila text, ambito_ler text, ambito_decidir text)
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  VALUES ('pagamento', 'payments:read', 'payments:resolve'),
         ('documento_fiscal', 'invoices:read', 'invoices:write'),
         ('duplicado_cliente', 'customers:read', 'customers:merge'),
         ('prazo_reembolso', 'returns:read', 'refunds:write'),
         ('livre_resolucao', 'returns:read', 'returns:write'),
         ('problema', 'returns:read', 'refunds:write'),
         ('reembolso', 'refunds:read', 'refunds:write'),
         ('ligacao_faturacao', 'invoices:read', 'invoices:accounts')
$$;

-- O prazo por omissão (R4; **não é lei**): 1 dia na ligação com erro (L4).
CREATE OR REPLACE FUNCTION tarefas_prazo_por_omissao(p_fila text, p_entrou timestamptz,
                                                     p_prazo_legal date, p_fuso text)
  RETURNS timestamptz
  LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT CASE p_fila
    WHEN 'pagamento' THEN p_entrou + interval '1 day'
    WHEN 'documento_fiscal' THEN p_entrou + interval '2 days'
    WHEN 'duplicado_cliente' THEN p_entrou + interval '7 days'
    WHEN 'prazo_reembolso' THEN x.fim
    WHEN 'livre_resolucao' THEN coalesce(x.fim, p_entrou + interval '2 days')
    WHEN 'problema' THEN p_entrou + interval '2 days'
    -- `least` ignora o nulo: sem prazo legal, 1 dia.
    WHEN 'reembolso' THEN least(p_entrou + interval '1 day', x.fim)
    WHEN 'ligacao_faturacao' THEN p_entrou + interval '1 day'
  END
  FROM (SELECT CASE WHEN p_prazo_legal IS NULL THEN NULL
          ELSE ((p_prazo_legal + 1)::timestamp AT TIME ZONE p_fuso) END AS fim) x
$$;

ALTER TABLE atribuicao DROP CONSTRAINT atribuicao_fila_check;
ALTER TABLE atribuicao ADD CONSTRAINT atribuicao_fila_check
  CHECK (fila IN ('pagamento', 'documento_fiscal', 'duplicado_cliente', 'prazo_reembolso',
    'livre_resolucao', 'problema', 'reembolso', 'ligacao_faturacao'));

CREATE OR REPLACE FUNCTION tarefas_casos(p_filas text[])
  RETURNS TABLE (fila text, caso uuid, entrou_em timestamptz, motivo text,
                 prazo_legal date, encomenda uuid, atribuicao uuid, responsavel uuid,
                 prazo timestamptz, prazo_definido boolean, vencida boolean,
                 aviso_vencido_em timestamptz, versao integer)
  LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  WITH casos AS (
    SELECT 'pagamento'::text AS fila, x.* FROM public.pagamentos_casos_a_decidir() x
    WHERE 'pagamento' = ANY (p_filas)
    UNION ALL
    SELECT 'documento_fiscal', x.* FROM public.documentos_casos_a_decidir() x
    WHERE 'documento_fiscal' = ANY (p_filas)
    UNION ALL
    SELECT 'duplicado_cliente', x.* FROM public.clientes_casos_a_decidir() x
    WHERE 'duplicado_cliente' = ANY (p_filas)
    UNION ALL
    SELECT x.* FROM public.posvenda_casos_a_decidir() x
    WHERE p_filas && ARRAY['prazo_reembolso', 'livre_resolucao', 'problema', 'reembolso']
      AND x.fila = ANY (p_filas)
    UNION ALL
    SELECT 'ligacao_faturacao', x.* FROM public.faturacao_casos_a_decidir() x
    WHERE 'ligacao_faturacao' = ANY (p_filas)
  )
  SELECT k.fila, k.caso, k.entrou_em, k.motivo, k.prazo_legal, k.encomenda,
    a.id, a.responsavel, p.prazo, a.prazo IS NOT NULL, p.prazo <= now(),
    a.aviso_vencido_em, coalesce(a.versao, 0)
  FROM casos k
  CROSS JOIN (SELECT c.fuso FROM public.comerciante c
              WHERE c.id = public.comerciante_actual()) f
  LEFT JOIN public.atribuicao a
    ON a.comerciante_id = public.comerciante_actual() AND a.fila = k.fila
   AND a.caso = k.caso AND a.entrou_em = k.entrou_em
  CROSS JOIN LATERAL (SELECT coalesce(a.prazo,
    public.tarefas_prazo_por_omissao(k.fila, k.entrou_em, k.prazo_legal, f.fuso)) AS prazo) p
$$;

-- ------------------------------------------------- O e-mail logo (Q1 A)

ALTER TABLE notificacao DROP CONSTRAINT notificacao_tipo_check;
ALTER TABLE notificacao ADD CONSTRAINT notificacao_tipo_check
  CHECK (tipo IN ('refund.deadline_approaching', 'refund.deadline_passed', 'task.overdue',
    'invoicing.connection_error'));

-- A pessoa pode receber o aviso da ligação: membro activo, pessoa activa, e
-- o papel liga a conta (`invoices:accounts`, a régua única `papel_ambitos()`).
CREATE FUNCTION faturacao_aviso_pode_receber(p_comerciante uuid, p_pessoa uuid)
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.membro m
    JOIN public.pessoa p ON p.id = m.pessoa_id
    WHERE m.comerciante_id = p_comerciante AND m.pessoa_id = p_pessoa
      AND m.ate IS NULL AND p.estado = 'activa'
      AND 'invoices:accounts' = ANY (public.papel_ambitos(m.papel)))
$$;

-- Quando a ligação fica com erro pela renovação recusada (ao entrar, ou na
-- mesma passagem depois de um teste falhado; P2-3): uma notificação por
-- pessoa que pode ligar a conta, na língua do Hub (N4). A `referencia` é a
-- passagem: uma por passagem e por pessoa (N5). Só códigos, a loja e a
-- entidade (o nome da empresa do comerciante); nunca a frase do emissor nem
-- dados de clientes (docs/29 §18.3). O número de faturas retidas lê-se no
-- envio, não aqui: a fatura que deu o erro só fica retida depois (revisão do
-- #422, P1-2).
CREATE FUNCTION ligacao_com_erro_notificacao() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  lingua text;
  loja text;
  fuso text;
  entidade text;
BEGIN
  IF NEW.estado <> 'com_erro' OR NOT NEW.activa
     OR NEW.com_erro_motivo IS DISTINCT FROM 'renovacao_recusada'
     OR (TG_OP = 'UPDATE' AND OLD.estado = 'com_erro'
         AND OLD.com_erro_motivo IS NOT DISTINCT FROM 'renovacao_recusada') THEN
    RETURN NULL;
  END IF;
  SELECT CASE WHEN c.lingua IN ('pt', 'es', 'en') THEN c.lingua ELSE 'en' END, c.nome, c.fuso
    INTO lingua, loja, fuso FROM public.comerciante c WHERE c.id = NEW.comerciante_id;
  SELECT e.denominacao INTO entidade FROM public.entidade_legal e
  WHERE e.id = NEW.entidade_legal_id AND e.comerciante_id = NEW.comerciante_id;
  INSERT INTO public.notificacao (comerciante_id, tipo, referencia, pessoa_id, lingua, dados)
  SELECT NEW.comerciante_id, 'invoicing.connection_error', NEW.com_erro_passagem, m.pessoa_id,
    lingua,
    jsonb_build_object('loja', loja, 'entidade', entidade, 'ligacao', NEW.id,
      'adaptador', NEW.adaptador, 'motivo', NEW.com_erro_motivo,
      'desde', to_char(NEW.com_erro_desde AT TIME ZONE fuso, 'YYYY-MM-DD HH24:MI'),
      'fuso', fuso)
  FROM public.membro m
  WHERE m.comerciante_id = NEW.comerciante_id
    AND public.faturacao_aviso_pode_receber(NEW.comerciante_id, m.pessoa_id)
  ON CONFLICT (tipo, referencia, pessoa_id) DO NOTHING;
  RETURN NULL;
END
$$;
CREATE TRIGGER ligacao_faturacao_com_erro_notificacao AFTER INSERT OR UPDATE
  ON ligacao_faturacao FOR EACH ROW EXECUTE FUNCTION ligacao_com_erro_notificacao();
ALTER TABLE ligacao_faturacao ENABLE ALWAYS TRIGGER ligacao_faturacao_com_erro_notificacao;

-- O aviso ainda faz sentido, lido no envio: a ligação continua activa e com
-- erro, na mesma passagem.
CREATE FUNCTION faturacao_aviso_espera(p_passagem uuid) RETURNS boolean
  LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.ligacao_faturacao l
    WHERE l.comerciante_id = public.comerciante_actual() AND l.com_erro_passagem = p_passagem
      AND l.activa AND l.estado = 'com_erro')
$$;

-- As faturas retidas à espera da ligação desta passagem, contadas no envio
-- (P1-2): as da entidade dela retidas por `ligacao_sem_teste`.
CREATE FUNCTION faturacao_aviso_retidas(p_passagem uuid) RETURNS integer
  LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT count(*)::integer FROM public.documento_fiscal d
  JOIN public.ligacao_faturacao l ON l.comerciante_id = d.comerciante_id
    AND l.entidade_legal_id = d.entidade_legal_id
  WHERE l.comerciante_id = public.comerciante_actual() AND l.com_erro_passagem = p_passagem
    AND d.estado = 'retido' AND 'ligacao_sem_teste' = ANY (d.motivos)
$$;

-- Quem recebe, lido no envio (N9): o reembolso como na 0067, o caso vencido
-- como na 0071 e, no aviso da ligação, quem ainda pode ligar a conta.
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
          ELSE m.papel IN ('dono', 'gestor') END
$$;

-- ------------------------------------------------------------ Permissões

REVOKE EXECUTE ON FUNCTION ligacao_com_erro_desde(), faturacao_casos_a_decidir(),
  faturacao_aviso_pode_receber(uuid, uuid), ligacao_com_erro_notificacao(),
  faturacao_aviso_espera(uuid), faturacao_aviso_retidas(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION faturacao_casos_a_decidir(), faturacao_aviso_espera(uuid),
  faturacao_aviso_retidas(uuid) TO eurolify_api;
