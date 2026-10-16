-- O rasto da pós-venda (docs/30 §16; docs/28 §4; issue #480; decisão DK do
-- Diogo, 10/10/2026). Ex.: a Ana pede a livre resolução, o armazém recebe e
-- inspecciona, o apoio decide e um agente de IA executa o reembolso: a
-- linha do tempo da devolução diz quem fez cada passo, de onde veio, com que
-- IA, a pedido de quem e quem autorizou, e mostra «sem autorização de uma
-- pessoa» no reembolso que nenhuma pessoa confirmou (docs/28 §3.6).
--
-- Até aqui a pós-venda só tinha os eventos (`evento_saida`, que não é
-- rasto) e o historial das etiquetas: nenhuma das tabelas tinha o gatilho
-- `rasto_completar()` (conferido nas migrações 0058, 0061, 0063, 0065 e
-- 0093). Esta migração acrescenta o rasto, só de acréscimo.
--
-- O que faz:
-- - `transicao_posvenda`: uma linha por mudança de estado do pedido de livre
--   resolução, da devolução, da etiqueta de devolução, do problema e do
--   reembolso (de, para, quem, motivo) e por decisão de higiene de uma linha
--   (a 0065 só guardava o valor final); com as colunas do rasto comum,
--   preenchidas por `rasto_completar()` (0053, 0060);
-- - os gatilhos que a escrevem, um por tabela (recusam a escrita sem
--   `eurolify.quem`; não ficam `ALWAYS`, escrevem: regra da 0053 e da 0091);
-- - só se acrescenta (gatilhos `ALWAYS`, também ao dono): a única excepção é a
--   do apagamento do titular, que passa o motivo a marcador (como as
--   transições da encomenda, 0072);
-- - `titular_limpar_encomenda()` (última versão: 0102) passa a limpar também
--   o motivo destas transições. O resto do texto livre da pós-venda já se
--   limpava (0072).
--
-- Não toca: as linhas já escritas (as de antes ficam sem rasto: o estado
-- final está na própria tabela, e os eventos não se reescrevem) nem o
-- historial das etiquetas (0093), que guarda o seguimento.
SET LOCAL lock_timeout = '10s';

CREATE TABLE transicao_posvenda (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  encomenda_id uuid NOT NULL,
  entidade text NOT NULL CHECK (entidade IN ('pedido_livre_resolucao', 'devolucao',
    'etiqueta_devolucao', 'problema', 'reembolso')),
  -- O id da entidade; na etiqueta é o da devolução (uma etiqueta por
  -- devolução, 0093).
  entidade_id uuid NOT NULL,
  campo text NOT NULL DEFAULT 'estado' CHECK (campo IN ('estado', 'decisao_higiene')),
  -- Só na decisão de higiene: a linha da encomenda a que se refere.
  linha_encomenda_id uuid,
  de text,
  para text NOT NULL,
  quem text NOT NULL CHECK (length(btrim(quem)) BETWEEN 1 AND 200),
  motivo text CHECK (motivo IS NULL OR length(motivo) <= 500),
  em timestamptz NOT NULL DEFAULT clock_timestamp(),
  canal text,
  pedido text,
  ia jsonb,
  autorizado_por text,
  a_pedido_de jsonb,
  -- Sem chave estrangeira para a encomenda, de propósito: só os gatilhos
  -- escrevem, copiando o comerciante e a encomenda de uma linha que já a
  -- tem (as cinco tabelas, 0058 e 0093), e os testes das filas (0066)
  -- criam casos sem encomenda verdadeira.
  CHECK ((campo = 'decisao_higiene') = (linha_encomenda_id IS NOT NULL))
);
CREATE INDEX transicao_posvenda_por_entidade ON transicao_posvenda (entidade, entidade_id, em);
CREATE INDEX transicao_posvenda_por_encomenda ON transicao_posvenda (encomenda_id, em);

CREATE TRIGGER rasto_completar BEFORE INSERT ON transicao_posvenda
  FOR EACH ROW EXECUTE FUNCTION rasto_completar();
-- Só se acrescenta; a excepção é a do apagamento do titular (0072).
CREATE TRIGGER transicao_posvenda_so_se_acrescenta BEFORE UPDATE OR DELETE ON transicao_posvenda
  FOR EACH ROW EXECUTE FUNCTION titular_rasto_so_se_acrescenta();
CREATE TRIGGER transicao_posvenda_sem_truncate BEFORE TRUNCATE ON transicao_posvenda
  FOR EACH STATEMENT EXECUTE FUNCTION rasto_so_se_acrescenta();
-- Só recusam: ficam `ALWAYS`, como as do rasto (regra da 0091).
ALTER TABLE transicao_posvenda ENABLE ALWAYS TRIGGER transicao_posvenda_so_se_acrescenta;
ALTER TABLE transicao_posvenda ENABLE ALWAYS TRIGGER transicao_posvenda_sem_truncate;

ALTER TABLE transicao_posvenda ENABLE ROW LEVEL SECURITY;
ALTER TABLE transicao_posvenda FORCE ROW LEVEL SECURITY;
CREATE POLICY so_o_proprio ON transicao_posvenda
  USING (comerciante_id = comerciante_actual())
  WITH CHECK (comerciante_id = comerciante_actual());
REVOKE ALL ON transicao_posvenda FROM PUBLIC;
GRANT SELECT ON transicao_posvenda TO eurolify_api;

-- ------------------------------------------------ Quem escreve as transições

-- Uma função para as cinco tabelas; cada ramo lê só os campos da sua tabela.
-- Sem `eurolify.quem` recusa-se (a transacção volta atrás), como já fazem os
-- gatilhos de cada tabela. Uma escrita que não muda o estado (a limpeza do
-- titular, os avisos do prazo, o fim da etiqueta) não deixa linha.
CREATE FUNCTION posvenda_transicao() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem text := nullif(btrim(current_setting('eurolify.quem', true)), '');
  v_id uuid;
  v_encomenda uuid;
  v_de text;
  v_motivo text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.estado IS NOT DISTINCT FROM OLD.estado THEN
    RETURN NULL;
  END IF;
  IF quem IS NULL THEN
    RAISE EXCEPTION 'returns.change_without_who: % em % sem eurolify.quem', TG_OP, TG_TABLE_NAME;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    v_de := OLD.estado;
  END IF;
  IF TG_TABLE_NAME = 'etiqueta_devolucao' THEN
    v_id := NEW.devolucao_id;
    SELECT d.encomenda_id INTO v_encomenda FROM public.devolucao d
    WHERE d.comerciante_id = NEW.comerciante_id AND d.id = NEW.devolucao_id;
    -- O motivo da etiqueta (a recusa da transportadora), não o do pedido.
    v_motivo := left(NEW.motivo, 500);
  ELSE
    v_id := NEW.id;
    v_encomenda := NEW.encomenda_id;
  END IF;
  INSERT INTO public.transicao_posvenda (comerciante_id, encomenda_id, entidade, entidade_id,
    de, para, quem, motivo)
  VALUES (NEW.comerciante_id, v_encomenda, TG_TABLE_NAME, v_id, v_de, NEW.estado, quem, v_motivo);
  RETURN NULL;
END
$$;

CREATE TRIGGER posvenda_transicao AFTER INSERT OR UPDATE OF estado ON pedido_livre_resolucao
  FOR EACH ROW EXECUTE FUNCTION posvenda_transicao();
CREATE TRIGGER posvenda_transicao AFTER INSERT OR UPDATE OF estado ON devolucao
  FOR EACH ROW EXECUTE FUNCTION posvenda_transicao();
CREATE TRIGGER posvenda_transicao AFTER INSERT OR UPDATE OF estado ON etiqueta_devolucao
  FOR EACH ROW EXECUTE FUNCTION posvenda_transicao();
CREATE TRIGGER posvenda_transicao AFTER INSERT OR UPDATE OF estado ON problema
  FOR EACH ROW EXECUTE FUNCTION posvenda_transicao();
CREATE TRIGGER posvenda_transicao AFTER INSERT OR UPDATE OF estado ON reembolso
  FOR EACH ROW EXECUTE FUNCTION posvenda_transicao();

-- A decisão de higiene de uma linha (0065, H6): quem decidiu, quando e o
-- que decidiu. A 0065 só guardava o valor final; cada mudança fica aqui.
CREATE FUNCTION posvenda_transicao_higiene() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem text := nullif(btrim(current_setting('eurolify.quem', true)), '');
  v_encomenda uuid;
BEGIN
  IF NEW.decisao_higiene IS NULL
     OR (TG_OP = 'UPDATE' AND NEW.decisao_higiene IS NOT DISTINCT FROM OLD.decisao_higiene) THEN
    RETURN NULL;
  END IF;
  IF quem IS NULL THEN
    RAISE EXCEPTION 'returns.change_without_who: % em % sem eurolify.quem', TG_OP, TG_TABLE_NAME;
  END IF;
  SELECT d.encomenda_id INTO v_encomenda FROM public.devolucao d
  WHERE d.comerciante_id = NEW.comerciante_id AND d.id = NEW.devolucao_id;
  INSERT INTO public.transicao_posvenda (comerciante_id, encomenda_id, entidade, entidade_id,
    campo, linha_encomenda_id, de, para, quem)
  VALUES (NEW.comerciante_id, v_encomenda, 'devolucao', NEW.devolucao_id, 'decisao_higiene',
    NEW.linha_encomenda_id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.decisao_higiene END,
    NEW.decisao_higiene, quem);
  RETURN NULL;
END
$$;
CREATE TRIGGER posvenda_transicao_higiene AFTER INSERT OR UPDATE OF decisao_higiene
  ON linha_devolucao FOR EACH ROW EXECUTE FUNCTION posvenda_transicao_higiene();

REVOKE EXECUTE ON FUNCTION posvenda_transicao(), posvenda_transicao_higiene() FROM PUBLIC;

-- --------------------------------------------- O apagamento do titular (0072)

-- Cópia da 0102 com o que está marcado «0110»: o motivo das transições da
-- pós-venda. O resto não mudou.
CREATE OR REPLACE FUNCTION titular_limpar_encomenda(p_encomenda uuid) RETURNS jsonb
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  c uuid := public.comerciante_actual();
  e record;
  fiscal boolean;
  m text := '(pseudonimizado)';
  n_expedicoes integer;
  n_transicoes integer;
  n_transicoes_pagamento integer;
  n_avisos integer;
  n_pedidos integer;
  n_devolucoes integer;
  n_problemas integer;
  n_sessoes integer;
  n_motivos integer;
  n_posvenda integer;
BEGIN
  SELECT x.id, x.estado, x.perfil_copia, x.sessao_id INTO e FROM public.encomenda x
  WHERE x.comerciante_id = c AND x.id = p_encomenda FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'orders.not_found: a encomenda não existe';
  END IF;
  -- Voltou a ficar em curso entre a escolha e o bloqueio (ex.: abriu-se uma
  -- livre resolução): não se limpa, e quem chama põe-na na fila (revisão do
  -- #374, P3).
  IF NOT public.titular_encomenda_acabou(p_encomenda) THEN
    RETURN NULL;
  END IF;
  -- Grupo A: a cópia de onde se emite fica se há documento, ou se a
  -- encomenda foi paga (o documento é devido) — Q2, C contabilista.
  fiscal := e.estado <> 'cancelada_sem_pagamento' OR EXISTS (
    SELECT FROM public.documento_fiscal d WHERE d.comerciante_id = c AND d.encomenda_id = e.id);
  UPDATE public.encomenda x
  SET contacto = public.titular_jsonb_so(x.contacto, '{}'),
      entrega = public.titular_morada_sem(x.entrega),
      perfil_copia = CASE WHEN fiscal THEN x.perfil_copia ELSE
        public.titular_jsonb_so(x.perfil_copia,
          ARRAY['tipo', 'pais_contribuinte', 'outra_pessoa', 'morada'])
        || CASE WHEN jsonb_typeof(x.perfil_copia -> 'morada') = 'object'
             THEN jsonb_build_object('morada', public.titular_morada_sem(x.perfil_copia -> 'morada'))
             ELSE '{}'::jsonb END END
  WHERE x.comerciante_id = c AND x.id = e.id;
  -- A sessão de checkout desta encomenda tem a mesma cópia: chega-se a ela
  -- pela encomenda, sem decidir nada pelo e-mail (revisão do #374, P2-1).
  -- Vazia (o e-mail da sessão tem formato obrigatório).
  UPDATE public.sessao_checkout x
  SET email = NULL, nome = NULL, telefone = NULL, entrega = NULL, faturacao = NULL
  WHERE x.comerciante_id = c AND x.id = e.sessao_id
    AND (x.email IS NOT NULL OR x.nome IS NOT NULL OR x.telefone IS NOT NULL
         OR x.entrega IS NOT NULL OR x.faturacao IS NOT NULL);
  GET DIAGNOSTICS n_sessoes = ROW_COUNT;
  UPDATE public.expedicao x SET prova_entrega = m
  WHERE x.comerciante_id = c AND x.encomenda_id = e.id
    AND x.prova_entrega IS NOT NULL AND x.prova_entrega <> m;
  GET DIAGNOSTICS n_expedicoes = ROW_COUNT;
  UPDATE public.transicao_encomenda t SET motivo = m
  WHERE t.comerciante_id = c AND t.encomenda_id = e.id
    AND t.motivo IS NOT NULL AND t.motivo <> m;
  GET DIAGNOSTICS n_transicoes = ROW_COUNT;
  UPDATE public.transicao_pagamento t SET motivo = m
  WHERE t.comerciante_id = c AND t.motivo IS NOT NULL AND t.motivo <> m
    AND t.pagamento_id IN (SELECT p.id FROM public.pagamento p
                           WHERE p.comerciante_id = c AND p.encomenda_id = e.id);
  GET DIAGNOSTICS n_transicoes_pagamento = ROW_COUNT;
  -- O aviso em bruto passa a resumo (Q3): o pagamento guarda o montante, a
  -- referência e o estado. O resumo leva a chave do rasto (0054): sem ela,
  -- um telefone adivinha-se por tentativa (revisão do #374, P3).
  UPDATE public.aviso_pagamento a
  SET corpo = jsonb_build_object('pseudonimizado', true,
        'resumo', public.rasto_resumo(c, 'aviso_pagamento.corpo', to_jsonb(a.corpo)))::text
  WHERE a.comerciante_id = c AND a.corpo NOT LIKE '{"pseudonimizado"%'
    AND a.pagamento_id IN (SELECT p.id FROM public.pagamento p
                           WHERE p.comerciante_id = c AND p.encomenda_id = e.id);
  GET DIAGNOSTICS n_avisos = ROW_COUNT;
  UPDATE public.pedido_livre_resolucao p
  SET contacto = 'sem e-mail',
      motivo_decisao = CASE WHEN p.motivo_decisao IS NULL THEN NULL ELSE m END
  WHERE p.comerciante_id = c AND p.encomenda_id = e.id
    AND (p.contacto <> 'sem e-mail' OR p.motivo_decisao IS DISTINCT FROM
         CASE WHEN p.motivo_decisao IS NULL THEN NULL ELSE m END);
  GET DIAGNOSTICS n_pedidos = ROW_COUNT;
  UPDATE public.devolucao d SET motivo = m
  WHERE d.comerciante_id = c AND d.encomenda_id = e.id
    AND d.motivo IS NOT NULL AND d.motivo <> m;
  GET DIAGNOSTICS n_devolucoes = ROW_COUNT;
  UPDATE public.problema x SET descricao = m
  WHERE x.comerciante_id = c AND x.encomenda_id = e.id AND x.descricao <> m;
  GET DIAGNOSTICS n_problemas = ROW_COUNT;
  -- O motivo das transições da pós-venda desta encomenda: pedido, devolução,
  -- etiqueta, problema e reembolso (0110).
  UPDATE public.transicao_posvenda t SET motivo = m
  WHERE t.comerciante_id = c AND t.encomenda_id = e.id
    AND t.motivo IS NOT NULL AND t.motivo <> m;
  GET DIAGNOSTICS n_posvenda = ROW_COUNT;
  -- O motivo de uma mudança de prazo feita depois do pedido (0102).
  n_motivos := public.tarefas_limpar_motivos('{}'::uuid[], ARRAY[e.id]);
  RETURN jsonb_build_object(
    'dados_fiscais_mantidos', fiscal,
    'sessoes_de_checkout', n_sessoes,
    'expedicoes', n_expedicoes,
    'transicoes', n_transicoes + n_transicoes_pagamento + n_posvenda,
    'avisos_de_pagamento', n_avisos,
    'pedidos_de_livre_resolucao', n_pedidos,
    'devolucoes', n_devolucoes,
    'problemas', n_problemas,
    'motivos_de_prazo_limpos', n_motivos);
END
$$;
