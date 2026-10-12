-- Os pedidos do titular em todos os domínios (docs/23 §15; docs/06, DU;
-- issue #233; Diogo, 11/10/2026: «aprovado, junta o #369 e avança com o
-- código»). Ex.: a Ana compra sem conta, a encomenda é cancelada e ela pede o
-- apagamento. Até aqui a ficha ficava «Pseudonimizado» mas a encomenda
-- continuava com o e-mail, o telefone, a morada e o NIF dela; passam a
-- marcador «(pseudonimizado)».
--
-- A regra (§15.1): a prova fiscal fica 10 anos (art. 52.º do CIVA, W); os
-- dados de uma encomenda em curso ficam até ela acabar e limpam-se sozinhos
-- (Q1); o resto limpa-se logo.
--
-- O que esta migração faz:
-- - `titular_limpeza_permitida()`: os gatilhos que hoje recusam mudanças
--   deixam passar só as colunas com dados pessoais, só com a marca da 0049
--   (`pseudonimizacao_em_curso`), que só o dono põe;
-- - `titular_limpar_encomenda()`: limpa uma encomenda acabada — contacto,
--   morada de entrega (fica o país), cópia do perfil quando não há nada
--   fiscal, o texto da prova de entrega, os motivos das transições, o aviso
--   em bruto do prestador (passa a resumo, Q3), o e-mail do pedido de livre
--   resolução e os textos livres da pós-venda;
-- - `titular_pendente`: as encomendas em curso de um pedido de apagamento,
--   que a tarefa (`titular_pendentes_aplicar()`) limpa quando acabarem;
-- - `cliente_pseudonimizar()` (corpo da 0062): o perfil de faturação só fica
--   se um documento o usou ou uma encomenda que não foi cancelada sem
--   pagamento aponta para ele (Q2); limpa as encomendas acabadas e põe as
--   outras na fila.
--
-- Não toca: os documentos fiscais (conteúdo, prova, PDF, rasto) — grupo A;
-- o registo do negócio (linhas, totais, estados, datas); as sessões de
-- checkout (parte 2, por prazo).

SET LOCAL lock_timeout = '10s';

-- ----------------------------------------------- A abertura dos gatilhos

CREATE FUNCTION titular_limpeza_permitida(p_old jsonb, p_new jsonb, p_colunas text[])
  RETURNS boolean
  LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  -- Primeiro a marca: fora da função do dono, nem se compara.
  IF NOT public.clientes_pseudonimizacao_em_curso() THEN
    RETURN false;
  END IF;
  RETURN (p_new - p_colunas) = (p_old - p_colunas);
END
$$;

CREATE OR REPLACE FUNCTION encomenda_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem text := nullif(btrim(current_setting('eurolify.quem', true)), '');
BEGIN
  -- O apagamento do titular (0072): só as colunas com dados pessoais, só
  -- dentro da função do dono.
  IF TG_OP = 'UPDATE' AND public.titular_limpeza_permitida(to_jsonb(OLD), to_jsonb(NEW),
       ARRAY['contacto', 'entrega', 'perfil_copia']) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'orders.immutable: uma encomenda não se apaga';
  END IF;
  IF quem IS NULL THEN
    RAISE EXCEPTION 'orders.change_without_who: % sem eurolify.quem', TG_OP;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.estado := 'a_aguardar_pagamento';
    NEW.criada_por := quem;
    NEW.criada_em := now();
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - 'estado') IS DISTINCT FROM (to_jsonb(OLD) - 'estado') THEN
    RAISE EXCEPTION 'orders.immutable: as cópias da encomenda não mudam';
  END IF;
  -- Só para a frente (docs/27 §4.1); cancelar uma paga não expedida
  -- (docs/30, Q7).
  IF NOT (OLD.estado, NEW.estado) IN (
       ('paga', 'cancelada'), ('em_preparacao', 'cancelada'),
       ('a_aguardar_pagamento', 'paga'), ('a_aguardar_pagamento', 'cancelada_sem_pagamento'),
       ('paga', 'em_preparacao'), ('em_preparacao', 'expedida_parcial'),
       ('em_preparacao', 'expedida'), ('expedida_parcial', 'expedida'),
       ('expedida', 'entregue'), ('entregue', 'concluida'),
       -- Devolvida pela soma do reembolsado nas devoluções (docs/30 §4.4),
       -- só depois de tudo entregue (uma expedição ainda a caminho não fica
       -- presa a um estado de devolução).
       ('entregue', 'devolvida_parcial'), ('entregue', 'devolvida'),
       ('concluida', 'devolvida_parcial'), ('concluida', 'devolvida'),
       ('devolvida_parcial', 'devolvida')) THEN
    RAISE EXCEPTION 'orders.invalid_transition: % → %', OLD.estado, NEW.estado;
  END IF;
  -- Uma encomenda com uma expedição que não foi cancelada já não se cancela
  -- (devolve-se).
  IF NEW.estado = 'cancelada' AND EXISTS (SELECT 1 FROM public.expedicao x
       WHERE x.encomenda_id = NEW.id AND x.estado <> 'cancelada') THEN
    RAISE EXCEPTION 'orders.invalid_transition: há uma expedição; devolve-se em vez de cancelar';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION expedicao_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem text := nullif(btrim(current_setting('eurolify.quem', true)), '');
BEGIN
  -- O apagamento do titular (0072): só as colunas com dados pessoais, só
  -- dentro da função do dono.
  IF TG_OP = 'UPDATE' AND public.titular_limpeza_permitida(to_jsonb(OLD), to_jsonb(NEW),
       ARRAY['prova_entrega']) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'shipments.immutable: uma expedição não se apaga';
  END IF;
  IF quem IS NULL THEN
    RAISE EXCEPTION 'shipments.change_without_who: % sem eurolify.quem', TG_OP;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.estado := 'criada';
    NEW.expedida_em := NULL;
    NEW.entregue_em := NULL;
    NEW.criada_por := quem;
    NEW.criada_em := now();
    RETURN NEW;
  END IF;
  IF NEW.encomenda_id IS DISTINCT FROM OLD.encomenda_id OR NEW.armazem_id IS DISTINCT FROM OLD.armazem_id
     OR NEW.metodo_entrega IS DISTINCT FROM OLD.metodo_entrega OR NEW.criada_por IS DISTINCT FROM OLD.criada_por THEN
    RAISE EXCEPTION 'shipments.immutable: a encomenda, o armazém e o método de entrega não mudam';
  END IF;
  IF OLD.estado IN ('entregue', 'devolvida_ao_remetente', 'perdida', 'cancelada') THEN
    RAISE EXCEPTION 'shipments.immutable: uma expedição acabada não muda';
  END IF;
  -- Uma expedição criada por engano cancela-se antes de sair (revisão do
  -- #296, P1-2).
  IF NEW.estado IS DISTINCT FROM OLD.estado AND NOT (
       (OLD.estado = 'criada' AND NEW.estado IN ('expedida', 'cancelada'))
    OR (OLD.estado = 'expedida' AND NEW.estado IN ('entregue', 'devolvida_ao_remetente', 'perdida'))) THEN
    RAISE EXCEPTION 'shipments.invalid_transition: % → %', OLD.estado, NEW.estado;
  END IF;
  IF NEW.estado = 'expedida' AND OLD.estado = 'criada' THEN NEW.expedida_em := now(); END IF;
  IF NEW.estado = 'entregue' AND OLD.estado <> 'entregue' THEN NEW.entregue_em := now(); END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION aviso_pagamento_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  -- O apagamento do titular (0072): só as colunas com dados pessoais, só
  -- dentro da função do dono.
  IF TG_OP = 'UPDATE' AND public.titular_limpeza_permitida(to_jsonb(OLD), to_jsonb(NEW),
       ARRAY['corpo']) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payments.immutable: um aviso não se apaga';
  END IF;
  IF (to_jsonb(NEW) - 'pagamento_id' - 'resultado' - 'erro' - 'processado_em')
     IS DISTINCT FROM (to_jsonb(OLD) - 'pagamento_id' - 'resultado' - 'erro' - 'processado_em') THEN
    RAISE EXCEPTION 'payments.immutable: o aviso em bruto não muda';
  END IF;
  IF OLD.resultado IS NOT NULL AND OLD.resultado <> 'erro' THEN
    RAISE EXCEPTION 'payments.immutable: um aviso tratado não muda';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION pedido_livre_resolucao_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  -- O apagamento do titular (0072): só as colunas com dados pessoais, só
  -- dentro da função do dono.
  IF TG_OP = 'UPDATE' AND public.titular_limpeza_permitida(to_jsonb(OLD), to_jsonb(NEW),
       ARRAY['contacto', 'motivo_decisao']) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'returns.immutable: um pedido de livre resolução não se apaga';
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.recebido_em := now();
    NEW.versao := 1;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - 'estado' - 'decidido_por' - 'motivo_decisao' - 'versao')
     IS DISTINCT FROM (to_jsonb(OLD) - 'estado' - 'decidido_por' - 'motivo_decisao' - 'versao') THEN
    RAISE EXCEPTION 'returns.immutable: o pedido e a confirmação não mudam';
  END IF;
  IF NEW.estado IS DISTINCT FROM OLD.estado AND NOT (OLD.estado IN ('fora_de_prazo', 'pendente')
       AND NEW.estado IN ('aceite', 'recusado')) THEN
    RAISE EXCEPTION 'returns.invalid_transition: % → %', OLD.estado, NEW.estado;
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION devolucao_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem text := nullif(btrim(current_setting('eurolify.quem', true)), '');
  prazo record;
BEGIN
  -- O apagamento do titular (0072): só as colunas com dados pessoais, só
  -- dentro da função do dono.
  IF TG_OP = 'UPDATE' AND public.titular_limpeza_permitida(to_jsonb(OLD), to_jsonb(NEW),
       ARRAY['motivo']) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'returns.immutable: uma devolução não se apaga';
  END IF;
  IF quem IS NULL THEN
    RAISE EXCEPTION 'returns.change_without_who: % sem eurolify.quem', TG_OP;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.estado := 'a_aguardar';
    NEW.criada_por := quem;
    NEW.criada_em := now();
    NEW.versao := 1;
    RETURN NEW;
  END IF;
  IF NEW.encomenda_id <> OLD.encomenda_id OR NEW.armazem_id <> OLD.armazem_id
     OR NEW.origem <> OLD.origem
     OR NEW.pedido_livre_resolucao_id IS DISTINCT FROM OLD.pedido_livre_resolucao_id
     OR NEW.criada_por <> OLD.criada_por OR NEW.criada_em <> OLD.criada_em THEN
    RAISE EXCEPTION 'returns.immutable: a encomenda, o armazém e a origem não mudam';
  END IF;
  -- Os avisos do prazo do reembolso (docs/30 §14): só numa devolução de um
  -- pedido de livre resolução, gravam-se uma vez e nunca se apagam.
  IF (OLD.aviso_prazo_em IS NOT NULL AND NEW.aviso_prazo_em IS DISTINCT FROM OLD.aviso_prazo_em)
     OR (OLD.prazo_passado_em IS NOT NULL
         AND NEW.prazo_passado_em IS DISTINCT FROM OLD.prazo_passado_em) THEN
    RAISE EXCEPTION 'returns.immutable: um aviso do prazo não muda';
  END IF;
  IF (NEW.aviso_prazo_em IS NOT NULL OR NEW.prazo_passado_em IS NOT NULL)
     AND NEW.pedido_livre_resolucao_id IS NULL THEN
    RAISE EXCEPTION 'returns.invalid_field: só uma devolução de livre resolução tem o prazo do reembolso';
  END IF;
  -- Só à hora e numa devolução que ainda espera (revisão do #353, P2-1 e
  -- P3-2): o aviso com 3 dias ou menos, o passado depois do último dia.
  IF NEW.aviso_prazo_em IS NOT NULL AND OLD.aviso_prazo_em IS NULL THEN
    SELECT * INTO prazo FROM public.posvenda_prazo_da_devolucao(NEW.id);
    IF NEW.estado IN ('fechada', 'cancelada') OR prazo.dias IS NULL
       OR prazo.dias > public.posvenda_dias_de_aviso() THEN
      RAISE EXCEPTION 'returns.invalid_transition: ainda não é hora do aviso do prazo, ou a devolução já não espera';
    END IF;
  END IF;
  IF NEW.prazo_passado_em IS NOT NULL AND OLD.prazo_passado_em IS NULL THEN
    SELECT * INTO prazo FROM public.posvenda_prazo_da_devolucao(NEW.id);
    IF NEW.estado IN ('fechada', 'cancelada') OR prazo.dias IS NULL OR prazo.dias >= 0 THEN
      RAISE EXCEPTION 'returns.invalid_transition: o prazo ainda não passou, ou a devolução já não espera';
    END IF;
  END IF;
  IF NEW.estado IS DISTINCT FROM OLD.estado AND NOT (OLD.estado, NEW.estado) IN (
       ('a_aguardar', 'recebida'), ('recebida', 'inspeccionada'), ('inspeccionada', 'decidida'),
       ('decidida', 'fechada'), ('a_aguardar', 'cancelada'), ('recebida', 'cancelada'),
       -- Fechada sem reembolso, com motivo (nada a reembolsar; revisão do
       -- #329, P2-5); de volta a inspeccionada quando o reembolso se anula
       -- antes de executado (P1-4).
       ('inspeccionada', 'fechada'), ('decidida', 'inspeccionada')) THEN
    RAISE EXCEPTION 'returns.invalid_transition: % → %', OLD.estado, NEW.estado;
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION problema_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem text := nullif(btrim(current_setting('eurolify.quem', true)), '');
BEGIN
  -- O apagamento do titular (0072): só as colunas com dados pessoais, só
  -- dentro da função do dono.
  IF TG_OP = 'UPDATE' AND public.titular_limpeza_permitida(to_jsonb(OLD), to_jsonb(NEW),
       ARRAY['descricao']) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'returns.immutable: um problema não se apaga';
  END IF;
  IF quem IS NULL THEN
    RAISE EXCEPTION 'returns.change_without_who: % sem eurolify.quem', TG_OP;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.estado := 'aberto';
    NEW.criado_por := quem;
    NEW.criado_em := now();
    NEW.versao := 1;
    RETURN NEW;
  END IF;
  IF NEW.encomenda_id <> OLD.encomenda_id OR NEW.tipo <> OLD.tipo
     OR NEW.descricao <> OLD.descricao OR NEW.criado_por <> OLD.criado_por THEN
    RAISE EXCEPTION 'returns.immutable: o problema não muda (abre-se outro)';
  END IF;
  IF NEW.estado IS DISTINCT FROM OLD.estado AND NOT (OLD.estado, NEW.estado) IN (
       ('aberto', 'decidido'), ('decidido', 'fechado'), ('aberto', 'fechado'),
       ('decidido', 'aberto')) THEN
    RAISE EXCEPTION 'returns.invalid_transition: % → %', OLD.estado, NEW.estado;
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION sessao_checkout_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  -- O apagamento do titular (0072): os dados pessoais de uma sessão já
  -- fechada, só dentro da função do dono (revisão do #374, P2-1).
  IF TG_OP = 'UPDATE' AND public.titular_limpeza_permitida(to_jsonb(OLD), to_jsonb(NEW),
       ARRAY['email', 'nome', 'telefone', 'entrega', 'faturacao']) THEN
    RETURN NEW;
  END IF;
  IF OLD.estado <> 'aberta' THEN
    RAISE EXCEPTION 'checkout.closed: a sessão está %', OLD.estado;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.comerciante_id IS DISTINCT FROM OLD.comerciante_id
     OR NEW.carrinho_id IS DISTINCT FROM OLD.carrinho_id
     OR NEW.token_resumo IS DISTINCT FROM OLD.token_resumo
     OR NEW.loja_id IS DISTINCT FROM OLD.loja_id THEN
    RAISE EXCEPTION 'checkout.invalid_field: campos fixos';
  END IF;
  NEW.actualizado_em := now();
  NEW.versao := OLD.versao + 1;
  RETURN NEW;
END
$$;

-- Os motivos das transições (texto livre de uma pessoa) passam a marcador;
-- o resto da transição não muda.
CREATE FUNCTION titular_rasto_so_se_acrescenta() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND public.titular_limpeza_permitida(to_jsonb(OLD), to_jsonb(NEW),
       ARRAY['motivo']) AND NEW.motivo = '(pseudonimizado)' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'audit.append_only: % em % recusado: o rasto só se acrescenta (corrige-se com uma entrada nova)',
    TG_OP, TG_TABLE_NAME;
END
$$;
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['transicao_encomenda', 'transicao_pagamento'] LOOP
    EXECUTE format('DROP TRIGGER %I ON %I', t || '_so_se_acrescenta', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION titular_rasto_so_se_acrescenta()', t || '_so_se_acrescenta', t);
    EXECUTE format('ALTER TABLE %I ENABLE ALWAYS TRIGGER %I', t, t || '_so_se_acrescenta');
  END LOOP;
END
$$;

-- ----------------------------------------------------- Limpar uma encomenda

-- Num objecto, tudo passa a marcador menos o que se diz para guardar (o
-- país, o tipo): uma chave nova que apareça fica limpa, não esquecida
-- (revisão do #374, P3).
CREATE FUNCTION titular_jsonb_so(p jsonb, p_guardar text[]) RETURNS jsonb
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT CASE WHEN p IS NULL OR jsonb_typeof(p) <> 'object' THEN p ELSE
    (SELECT coalesce(jsonb_object_agg(e.k, CASE
       WHEN e.k = ANY (p_guardar) OR e.v = 'null'::jsonb THEN e.v
       ELSE to_jsonb('(pseudonimizado)'::text) END), '{}'::jsonb)
     FROM jsonb_each(p) AS e(k, v)) END
$$;

-- A morada sem o que identifica a casa; fica o país (o IVA e o OSS
-- dependem dele; a decisão do IVA já está em cada linha).
CREATE FUNCTION titular_morada_sem(p jsonb) RETURNS jsonb
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT public.titular_jsonb_so(p, ARRAY['pais'])
$$;

-- Uma encomenda acabou: estado final e nada aberto na pós-venda (§15.3).
-- Duas que nunca chegam a um estado final também contam, sem nada aberto
-- (revisão do #374, P1-1; Diogo, 12/10/2026, «A»; os estados da encomenda
-- não mudam):
--  - `devolvida_parcial`, que só passa a `devolvida`;
--  - `expedida` sem expedição viva e com alguma perdida ou devolvida ao
--    remetente, e todo o pagamento capturado já reembolsado: até lá, o
--    comerciante ainda reenvia (precisa da morada) ou reembolsa.
CREATE FUNCTION titular_encomenda_acabou(p_encomenda uuid) RETURNS boolean
  LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT EXISTS (SELECT FROM public.encomenda e
      WHERE e.comerciante_id = public.comerciante_actual() AND e.id = p_encomenda
        AND (e.estado IN ('concluida', 'cancelada', 'cancelada_sem_pagamento', 'devolvida',
                          'devolvida_parcial')
          OR (e.estado = 'expedida'
            AND EXISTS (SELECT FROM public.expedicao x
              WHERE x.encomenda_id = e.id AND x.estado IN ('perdida', 'devolvida_ao_remetente'))
            AND NOT EXISTS (SELECT FROM public.expedicao x
              WHERE x.encomenda_id = e.id AND x.estado IN ('criada', 'expedida'))
            AND NOT EXISTS (SELECT FROM public.pagamento g
              WHERE g.encomenda_id = e.id
                AND g.estado IN ('capturado', 'reembolsado_parcial', 'em_disputa'))
            AND EXISTS (SELECT FROM public.pagamento g
              WHERE g.encomenda_id = e.id AND g.estado = 'reembolsado'))))
    AND NOT EXISTS (SELECT FROM public.pedido_livre_resolucao p
      WHERE p.encomenda_id = p_encomenda AND p.estado IN ('pendente', 'fora_de_prazo'))
    AND NOT EXISTS (SELECT FROM public.devolucao d
      WHERE d.encomenda_id = p_encomenda AND d.estado NOT IN ('fechada', 'cancelada'))
    AND NOT EXISTS (SELECT FROM public.problema x
      WHERE x.encomenda_id = p_encomenda AND x.estado <> 'fechado')
    AND NOT EXISTS (SELECT FROM public.reembolso r
      WHERE r.encomenda_id = p_encomenda AND r.estado NOT IN ('executado', 'cancelado'))
    -- Nem pagamento vivo ou incerto, nem diferença por resolver (ex.: pago
    -- depois de cancelada: o comerciante ainda tem de devolver o dinheiro;
    -- revisão do #374, P2-3).
    AND NOT EXISTS (SELECT FROM public.pagamento g
      WHERE g.encomenda_id = p_encomenda
        AND g.estado IN ('criado', 'a_aguardar_cliente', 'autorizado', 'incerto'))
    AND NOT EXISTS (SELECT FROM public.diferenca_pagamento d
      JOIN public.pagamento g ON g.id = d.pagamento_id
      WHERE g.encomenda_id = p_encomenda AND d.estado = 'aberta')
$$;

-- Limpa uma encomenda acabada. Só corre com a marca (os gatilhos recusam
-- sem ela) e só a chamam as funções do dono.
CREATE FUNCTION titular_limpar_encomenda(p_encomenda uuid) RETURNS jsonb
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
  RETURN jsonb_build_object(
    'dados_fiscais_mantidos', fiscal,
    'sessoes_de_checkout', n_sessoes,
    'expedicoes', n_expedicoes,
    'transicoes', n_transicoes + n_transicoes_pagamento,
    'avisos_de_pagamento', n_avisos,
    'pedidos_de_livre_resolucao', n_pedidos,
    'devolucoes', n_devolucoes,
    'problemas', n_problemas);
END
$$;

-- ------------------------------------------- As encomendas por acabar (§15.3)

CREATE TABLE titular_pendente (
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  pedido_id uuid NOT NULL REFERENCES pedido_titular (id),
  encomenda_id uuid NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  aplicado_em timestamptz,
  -- O que se limpou (contagens), sem dados pessoais.
  resultado jsonb CHECK (resultado IS NULL OR jsonb_typeof(resultado) = 'object'),
  PRIMARY KEY (pedido_id, encomenda_id),
  FOREIGN KEY (comerciante_id, encomenda_id) REFERENCES encomenda (comerciante_id, id),
  CHECK ((aplicado_em IS NULL) = (resultado IS NULL))
);
CREATE INDEX titular_pendente_por_aplicar ON titular_pendente (comerciante_id)
  WHERE aplicado_em IS NULL;

-- Não se apaga; só se marca como aplicada, uma vez.
CREATE FUNCTION titular_pendente_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'audit.append_only: um pedido de apagamento por aplicar não se apaga';
  END IF;
  IF OLD.aplicado_em IS NOT NULL OR (to_jsonb(NEW) - 'aplicado_em' - 'resultado')
       IS DISTINCT FROM (to_jsonb(OLD) - 'aplicado_em' - 'resultado') THEN
    RAISE EXCEPTION 'audit.append_only: só se marca como aplicada, uma vez';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER titular_pendente_antes_de_gravar BEFORE UPDATE OR DELETE ON titular_pendente
  FOR EACH ROW EXECUTE FUNCTION titular_pendente_antes_de_gravar();
ALTER TABLE titular_pendente ENABLE ALWAYS TRIGGER titular_pendente_antes_de_gravar;
CREATE TRIGGER titular_pendente_sem_truncate BEFORE TRUNCATE ON titular_pendente
  FOR EACH STATEMENT EXECUTE FUNCTION rasto_so_se_acrescenta();
ALTER TABLE titular_pendente ENABLE ALWAYS TRIGGER titular_pendente_sem_truncate;

-- Interna, como as outras filas (tarefa_encomenda): só as funções do dono
-- lhe tocam; a API lê as contagens pela titular_por_acabar().
REVOKE ALL ON titular_pendente FROM PUBLIC;

-- Quantas encomendas de cada pedido ainda esperam, no comerciante do
-- contexto (a lista dos pedidos do titular mostra-o).
CREATE FUNCTION titular_por_acabar(p_pedidos uuid[])
  RETURNS TABLE (pedido_id uuid, n integer)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT t.pedido_id, count(*)::integer FROM public.titular_pendente t
  WHERE t.comerciante_id = public.comerciante_actual()
    AND t.pedido_id = ANY (p_pedidos) AND t.aplicado_em IS NULL
  GROUP BY t.pedido_id
$$;

-- Os comerciantes com encomendas por limpar (a tarefa corre por comerciante).
CREATE FUNCTION titular_comerciantes_com_pendentes() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT DISTINCT t.comerciante_id FROM public.titular_pendente t WHERE t.aplicado_em IS NULL
$$;

-- A tarefa: limpa, no comerciante do contexto, as encomendas da fila que já
-- acabaram. Devolve quantas limpou.
CREATE FUNCTION titular_pendentes_aplicar(p_limite integer) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  c uuid := public.comerciante_actual();
  p record;
  limpeza jsonb;
  perfis jsonb;
  n integer := 0;
  falhas integer := 0;
  erro text;
BEGIN
  IF c IS NULL THEN
    RAISE EXCEPTION 'merchant.context_required: sem comerciante';
  END IF;
  INSERT INTO public.pseudonimizacao_em_curso VALUES (pg_current_xact_id())
    ON CONFLICT DO NOTHING;
  -- Só as que já acabaram, antes do limite: as que esperam não tapam as
  -- outras (revisão do #374, P1-2).
  FOR p IN SELECT t.pedido_id, t.encomenda_id, e.perfil_id
           FROM public.titular_pendente t
           JOIN public.encomenda e ON e.comerciante_id = t.comerciante_id AND e.id = t.encomenda_id
           WHERE t.comerciante_id = c AND t.aplicado_em IS NULL
             AND public.titular_encomenda_acabou(t.encomenda_id)
           ORDER BY t.criado_em, t.encomenda_id
           LIMIT greatest(p_limite, 0)
           FOR UPDATE OF t SKIP LOCKED LOOP
    -- Cada encomenda à parte: uma que falhe não desfaz as outras, e conta-se
    -- (revisão do #374, P2-4).
    BEGIN
      limpeza := public.titular_limpar_encomenda(p.encomenda_id);
      CONTINUE WHEN limpeza IS NULL;
      perfis := public.titular_perfis_sem_uso(ARRAY[p.perfil_id]);
      UPDATE public.titular_pendente t
      SET resultado = limpeza || jsonb_build_object('perfis_limpos', perfis -> 'perfis'),
          aplicado_em = now()
      WHERE t.pedido_id = p.pedido_id AND t.encomenda_id = p.encomenda_id;
      n := n + 1;
    EXCEPTION WHEN OTHERS THEN
      falhas := falhas + 1;
      -- Só o código (o texto antes dos dois pontos), sem dados.
      erro := SQLSTATE || ' ' || left(split_part(SQLERRM, ':', 1), 80);
    END;
  END LOOP;
  DELETE FROM public.pseudonimizacao_em_curso m WHERE m.transaccao = pg_current_xact_id();
  RETURN jsonb_build_object('limpas', n, 'falhas', falhas, 'erro', erro);
END
$$;

-- ------------------------------------------- Os perfis que deixaram de servir

-- Os perfis de faturação que nenhum documento usou nem nenhuma encomenda
-- (que não foi cancelada sem pagamento) aponta: sem nome, NIF nem morada,
-- arquivados, sem as provas do VIES e com as isenções limpas (Q2; o que a
-- 0049 fazia aos perfis não usados). Devolve quantos limpou. A limpeza
-- adiada também a chama: uma encomenda por pagar que acabou cancelada larga
-- o perfil (revisão do #374, P2-2).
CREATE FUNCTION titular_perfis_sem_uso(p_perfis uuid[]) RETURNS jsonb
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  c uuid := public.comerciante_actual();
  livres uuid[];
  n_validacoes integer;
  n_isencoes integer;
BEGIN
  livres := ARRAY(SELECT p.id FROM public.perfil_faturacao p
    WHERE p.comerciante_id = c AND p.id = ANY (p_perfis)
      AND NOT p.usado_em_documento
      AND NOT EXISTS (SELECT FROM public.encomenda e
        WHERE e.comerciante_id = c AND e.perfil_id = p.id
          AND e.estado <> 'cancelada_sem_pagamento')
      AND p.nome_documento IS DISTINCT FROM 'Pseudonimizado');
  DELETE FROM public.vies_fila v WHERE v.perfil_id = ANY (livres);
  DELETE FROM public.validacao_vies v
  WHERE v.comerciante_id = c AND v.perfil_id = ANY (livres);
  GET DIAGNOSTICS n_validacoes = ROW_COUNT;
  UPDATE public.isencao_manual i
  SET nif_numero = NULL, pais_contribuinte = NULL, nota = NULL, motivo = '(pseudonimizado)',
      motivo_retirada = CASE WHEN i.motivo_retirada IS NULL THEN NULL ELSE '(pseudonimizado)' END
  WHERE i.comerciante_id = c AND i.perfil_id = ANY (livres);
  GET DIAGNOSTICS n_isencoes = ROW_COUNT;
  UPDATE public.perfil_faturacao p
  SET tipo = 'particular', nome_documento = 'Pseudonimizado', nif_escrito = NULL,
      pais_contribuinte = NULL, morada_linha1 = NULL, morada_linha2 = NULL,
      morada_codigo_postal = NULL, morada_localidade = NULL, morada_pais = NULL,
      estado = 'arquivado', principal = false
  WHERE p.comerciante_id = c AND p.id = ANY (livres);
  RETURN jsonb_build_object('perfis', cardinality(livres), 'provas_vies', n_validacoes,
    'isencoes', n_isencoes);
END
$$;

-- ---------------------------------------------------- O pedido de apagamento

CREATE OR REPLACE FUNCTION cliente_pseudonimizar(p_cliente uuid, p_confirmacao text, p_verificacao text)
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
  acabadas uuid[];
  por_acabar uuid[];
  enc uuid;
  limpeza jsonb;
  n_fiscais integer := 0;
  pedido uuid;
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
  -- delas (R9; revisão do #314, P1-1). Uma encomenda cancelada sem pagamento
  -- não gera documento e já não conta (Q2 do docs/23 §15; C contabilista).
  usados := ARRAY(SELECT p.id FROM public.perfil_faturacao p
    WHERE p.comerciante_id = comerciante AND p.cliente_id = ANY (grupo)
      AND (p.usado_em_documento OR EXISTS (
        SELECT FROM public.encomenda e
        WHERE e.comerciante_id = comerciante AND e.perfil_id = p.id
          AND e.estado <> 'cancelada_sem_pagamento')));
  nao_usados := ARRAY(SELECT p.id FROM public.perfil_faturacao p
    WHERE p.comerciante_id = comerciante AND p.cliente_id = ANY (grupo)
      AND p.id <> ALL (usados));
  -- As encomendas (docs/23 §15): as acabadas limpam-se já; as outras ficam
  -- na fila e limpam-se quando acabarem (Q1).
  acabadas := ARRAY(SELECT e.id FROM public.encomenda e
    WHERE e.comerciante_id = comerciante AND e.cliente_id = ANY (grupo)
      AND public.titular_encomenda_acabou(e.id) ORDER BY e.id);
  por_acabar := ARRAY(SELECT e.id FROM public.encomenda e
    WHERE e.comerciante_id = comerciante AND e.cliente_id = ANY (grupo)
      AND e.id <> ALL (acabadas) ORDER BY e.id);
  n_encomendas := cardinality(por_acabar);

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
  -- Os valores de um perfil usado num documento ficam (R9; já marcadores
  -- desde a 0054); o motivo, texto livre que pode falar da pessoa, limpa-se
  -- em todas, também nesses: a prova fiscal é a cópia no documento (Diogo,
  -- 10/10/2026, R9; revisão do #354, P2-2).
  SET campos = CASE
        WHEN a.entidade = 'perfil_faturacao' AND a.entidade_id = ANY (usados) THEN a.campos
        ELSE public.clientes_rasto_sem_dados(a.campos) END,
      motivo = CASE WHEN a.motivo IS NULL THEN NULL ELSE '(pseudonimizado)' END
  WHERE a.comerciante_id = comerciante
    AND (a.cliente_id = ANY (grupo)
      -- Um par de duplicados fica na linha do tempo da primeira ficha do
      -- par, que pode ser a outra pessoa; o motivo escrito fala das duas.
      OR (a.entidade = 'duplicado_cliente' AND a.entidade_id IN (
        SELECT d.id FROM public.duplicado_cliente d
        WHERE d.comerciante_id = comerciante
          AND (d.cliente_a = ANY (grupo) OR d.cliente_b = ANY (grupo)))))
    AND ((NOT (a.entidade = 'perfil_faturacao' AND a.entidade_id = ANY (usados))
          AND a.campos IS DISTINCT FROM public.clientes_rasto_sem_dados(a.campos))
      OR a.motivo IS DISTINCT FROM
        CASE WHEN a.motivo IS NULL THEN NULL ELSE '(pseudonimizado)' END);
  GET DIAGNOSTICS n_rasto = ROW_COUNT;

  FOREACH enc IN ARRAY acabadas LOOP
    limpeza := public.titular_limpar_encomenda(enc);
    IF limpeza IS NULL THEN
      -- Voltou a ficar em curso: vai para a fila em vez de falhar o pedido
      -- todo (revisão do #374, P3).
      acabadas := array_remove(acabadas, enc);
      por_acabar := por_acabar || enc;
    ELSIF (limpeza ->> 'dados_fiscais_mantidos')::boolean THEN
      n_fiscais := n_fiscais + 1;
    END IF;
  END LOOP;
  n_encomendas := cardinality(por_acabar);

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
    'encomendas_limpas', cardinality(acabadas),
    'encomendas_com_dados_fiscais_mantidos', n_fiscais,
    'encomendas_por_acabar', n_encomendas,
    -- Com mais de zero, o apagamento ainda não está completo: as que faltam
    -- limpam-se quando acabarem (P2-4; §15.3).
    'encomendas_com_dados_por_tratar', n_encomendas);
  INSERT INTO public.evento_saida (comerciante_id, tipo, agregado_tipo, agregado_id, dados)
  VALUES (comerciante, 'customer.pseudonymized', 'cliente', p_cliente,
    jsonb_build_object('cliente_id', p_cliente, 'fichas', cardinality(grupo), 'quem', quem,
      'em', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
  pedido := public.pedido_titular_registar(p_cliente, 'apagamento', p_verificacao, resultado);
  INSERT INTO public.titular_pendente (comerciante_id, pedido_id, encomenda_id)
  SELECT comerciante, pedido, x FROM unnest(por_acabar) AS x;
  RETURN resultado;
END
$$;

-- ------------------------------------------------------------- Permissões

REVOKE EXECUTE ON FUNCTION titular_limpeza_permitida(jsonb, jsonb, text[]),
  titular_morada_sem(jsonb),
  titular_encomenda_acabou(uuid), titular_limpar_encomenda(uuid),
  titular_rasto_so_se_acrescenta(), titular_pendente_antes_de_gravar(),
  titular_comerciantes_com_pendentes(), titular_pendentes_aplicar(integer),
  titular_por_acabar(uuid[]), titular_perfis_sem_uso(uuid[]), titular_jsonb_so(jsonb, text[]) FROM PUBLIC;
-- Os gatilhos correm com quem escreve: a API precisa da que diz se a limpeza
-- está aberta (dá falso fora da função do dono). A tarefa corre pela API.
GRANT EXECUTE ON FUNCTION titular_limpeza_permitida(jsonb, jsonb, text[]),
  titular_comerciantes_com_pendentes(), titular_pendentes_aplicar(integer),
  titular_por_acabar(uuid[]) TO eurolify_api;
