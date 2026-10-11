-- Pós-venda: a marca «selado por higiene» (R4; docs/30 §15; issue #328;
-- Diogo, 11/10/2026: «aprovado», docs/06, DT).
--
-- A regra: a Directiva 2011/83/UE, art. 16.º, e) — não há direito de
-- retractação «ao fornecimento de bens selados não susceptíveis de devolução
-- por motivos de protecção da saúde ou de higiene quando abertos após a
-- entrega» (W, texto original; que artigos cabem é **C**, J2).
--
-- O que esta migração faz:
-- - H1: `artigo.selado_por_higiene`, por omissão não, só num artigo físico
--   (um físico é um bem; a natureza admite só `bem`, 0006).
-- - H2: `linha_encomenda.selado_por_higiene`, copiada no botão final. A base
--   confere que é a marca do artigo nesse instante: o cliente é julgado pelo
--   que lhe foi mostrado (o resumo leva a marca na impressão).
-- - H6: `linha_devolucao.decisao_higiene` (`reembolsar` ou
--   `excepcao_higiene`), só numa linha marcada, devolvida por livre
--   resolução e inspeccionada `aberto`. Sem escolha por omissão: a devolução
--   não se decide nem se fecha sem ela, e o reembolso não leva uma linha
--   com a excepção nem uma linha ainda por decidir.

SET LOCAL lock_timeout = '10s';

-- ------------------------------------------------------------ H1: o artigo

ALTER TABLE artigo
  ADD COLUMN selado_por_higiene boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT artigo_selado_so_em_bens CHECK (NOT selado_por_higiene OR tipo = 'fisico');

-- ------------------------------------------------- H2: a linha da encomenda

-- Sem gatilho de UPDATE: a linha da encomenda só se acrescenta (0041). As
-- linhas de antes ficam sem a marca, que ainda não existia.
ALTER TABLE linha_encomenda
  ADD COLUMN selado_por_higiene boolean NOT NULL DEFAULT false;

CREATE FUNCTION linha_encomenda_confere_selado() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  marca boolean;
BEGIN
  SELECT a.selado_por_higiene INTO marca
  FROM public.variante v JOIN public.artigo a ON a.id = v.artigo_id
  WHERE v.id = NEW.variante_id;
  IF NEW.selado_por_higiene IS DISTINCT FROM coalesce(marca, false) THEN
    RAISE EXCEPTION 'checkout.total_changed: a marca «selado por higiene» do artigo mudou desde o resumo';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER linha_encomenda_confere_selado BEFORE INSERT ON linha_encomenda
  FOR EACH ROW EXECUTE FUNCTION linha_encomenda_confere_selado();
ALTER TABLE linha_encomenda ENABLE ALWAYS TRIGGER linha_encomenda_confere_selado;

GRANT INSERT (selado_por_higiene) ON linha_encomenda TO eurolify_api;

-- ----------------------------------------------------- H6: a decisão por linha

ALTER TABLE linha_devolucao
  ADD COLUMN decisao_higiene text
    CHECK (decisao_higiene IS NULL OR decisao_higiene IN ('reembolsar', 'excepcao_higiene'));

-- A linha onde a decisão é obrigatória: marcada na encomenda, devolvida por
-- livre resolução (H7: um problema ou uma devolução comercial não é
-- retractação) e inspeccionada com o selo aberto.
CREATE FUNCTION posvenda_higiene_por_decidir(p_devolucao uuid, p_linha uuid) RETURNS boolean
  LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.linha_devolucao l
    JOIN public.devolucao d ON d.id = l.devolucao_id
    JOIN public.linha_encomenda le ON le.id = l.linha_encomenda_id
    WHERE l.devolucao_id = p_devolucao AND l.linha_encomenda_id = p_linha
      AND d.origem = 'livre_resolucao' AND le.selado_por_higiene
      AND l.estado_artigo = 'aberto')
$$;
-- Chamam-na os gatilhos (como a API) e a leitura da devolução.
GRANT EXECUTE ON FUNCTION posvenda_higiene_por_decidir(uuid, uuid) TO eurolify_api;

-- A decisão grava-se só com a devolução inspeccionada (de novo, se o
-- reembolso se anulou: decidida → inspeccionada), só onde é obrigatória,
-- não volta a vazia e não muda com a linha num reembolso vivo.
CREATE FUNCTION linha_devolucao_confere_higiene() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  d record;
  selado boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.decisao_higiene IS NOT NULL THEN
      RAISE EXCEPTION 'returns.invalid_transition: a decisão da excepção de higiene é depois da inspecção';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.decisao_higiene IS NOT DISTINCT FROM OLD.decisao_higiene THEN
    RETURN NEW;
  END IF;
  IF NEW.decisao_higiene IS NULL THEN
    RAISE EXCEPTION 'returns.immutable: a decisão da excepção de higiene não volta a vazia';
  END IF;
  SELECT x.estado, x.origem INTO d FROM public.devolucao x WHERE x.id = NEW.devolucao_id;
  IF d.estado <> 'inspeccionada' THEN
    RAISE EXCEPTION 'returns.invalid_transition: a excepção de higiene decide-se com a devolução inspeccionada';
  END IF;
  SELECT le.selado_por_higiene INTO selado
  FROM public.linha_encomenda le WHERE le.id = NEW.linha_encomenda_id;
  IF d.origem <> 'livre_resolucao' OR NOT coalesce(selado, false)
     OR NEW.estado_artigo IS DISTINCT FROM 'aberto' THEN
    RAISE EXCEPTION 'returns.invalid_field: a excepção de higiene só se decide numa linha selada, devolvida por livre resolução e aberta';
  END IF;
  -- Com a linha num reembolso vivo desta devolução, a decisão não muda: um
  -- rascunho com «reembolsar» não sai com a excepção (revisão do #363, P2-2).
  IF EXISTS (SELECT 1 FROM public.linha_reembolso lr
       JOIN public.reembolso r ON r.id = lr.reembolso_id
       WHERE r.devolucao_id = NEW.devolucao_id AND r.estado <> 'cancelado'
         AND lr.linha_encomenda_id = NEW.linha_encomenda_id) THEN
    RAISE EXCEPTION 'returns.invalid_transition: a linha está num reembolso; anulá-lo antes de mudar a decisão';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER linha_devolucao_confere_higiene BEFORE INSERT OR UPDATE ON linha_devolucao
  FOR EACH ROW EXECUTE FUNCTION linha_devolucao_confere_higiene();
ALTER TABLE linha_devolucao ENABLE ALWAYS TRIGGER linha_devolucao_confere_higiene;

GRANT UPDATE (decisao_higiene) ON linha_devolucao TO eurolify_api;

-- O reembolso de uma devolução não leva uma linha com a excepção, nem uma
-- linha ainda por decidir.
CREATE FUNCTION linha_reembolso_confere_higiene() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  dev uuid;
  decisao text;
BEGIN
  IF NEW.linha_encomenda_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT r.devolucao_id INTO dev FROM public.reembolso r WHERE r.id = NEW.reembolso_id;
  IF dev IS NULL OR NOT public.posvenda_higiene_por_decidir(dev, NEW.linha_encomenda_id) THEN
    RETURN NEW;
  END IF;
  SELECT l.decisao_higiene INTO decisao FROM public.linha_devolucao l
  WHERE l.devolucao_id = dev AND l.linha_encomenda_id = NEW.linha_encomenda_id;
  IF decisao IS NULL THEN
    RAISE EXCEPTION 'returns.hygiene_decision_required: a linha selada voltou aberta; decidir se reembolsa ou aplica a excepção';
  END IF;
  IF decisao = 'excepcao_higiene' THEN
    RAISE EXCEPTION 'refunds.invalid_field: a linha tem a excepção de higiene e não se reembolsa';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER linha_reembolso_confere_higiene BEFORE INSERT ON linha_reembolso
  FOR EACH ROW EXECUTE FUNCTION linha_reembolso_confere_higiene();
ALTER TABLE linha_reembolso ENABLE ALWAYS TRIGGER linha_reembolso_confere_higiene;

-- A devolução inspeccionada não se decide nem se fecha com uma linha por
-- decidir; decidida, cada linha `reembolsar` está no reembolso vivo dela;
-- fechada sem reembolso, nenhuma linha diz `reembolsar`.
CREATE FUNCTION devolucao_confere_higiene() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF OLD.estado <> 'inspeccionada' OR NEW.estado NOT IN ('decidida', 'fechada') THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.linha_devolucao l
       WHERE l.devolucao_id = NEW.id AND l.decisao_higiene IS NULL
         AND public.posvenda_higiene_por_decidir(NEW.id, l.linha_encomenda_id)) THEN
    RAISE EXCEPTION 'returns.hygiene_decision_required: uma linha selada voltou aberta; decidir se reembolsa ou aplica a excepção';
  END IF;
  IF NEW.estado = 'fechada' AND EXISTS (SELECT 1 FROM public.linha_devolucao l
       WHERE l.devolucao_id = NEW.id AND l.decisao_higiene = 'reembolsar') THEN
    RAISE EXCEPTION 'returns.invalid_field: uma linha diz «reembolsar»; fechar sem reembolso contradiz a decisão';
  END IF;
  IF NEW.estado = 'decidida' AND EXISTS (SELECT 1 FROM public.linha_devolucao l
       WHERE l.devolucao_id = NEW.id AND l.decisao_higiene = 'reembolsar'
         AND NOT EXISTS (SELECT 1 FROM public.linha_reembolso lr
           JOIN public.reembolso r ON r.id = lr.reembolso_id
           WHERE r.devolucao_id = NEW.id AND r.estado <> 'cancelado'
             AND lr.linha_encomenda_id = l.linha_encomenda_id)) THEN
    RAISE EXCEPTION 'returns.invalid_field: uma linha diz «reembolsar» e não está no reembolso';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER devolucao_confere_higiene BEFORE UPDATE OF estado ON devolucao
  FOR EACH ROW EXECUTE FUNCTION devolucao_confere_higiene();
ALTER TABLE devolucao ENABLE ALWAYS TRIGGER devolucao_confere_higiene;
