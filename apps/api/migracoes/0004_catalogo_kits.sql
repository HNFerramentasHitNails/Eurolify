-- Domínio Catálogo, parte 2a: composição dos kits (docs/14 §3.4; issue #77).
-- Uma variante é um kit quando tem componentes, que são outras variantes do
-- mesmo comerciante, com quantidade. A disponibilidade do kit calcula-a o
-- Stock a partir daqui (§2); o Catálogo só guarda a lista.
--
-- Regras (as marcadas «proposta» são desta parte do código, docs/14 §3.4):
-- - um kit não se contém a si próprio, nem por outro kit (sem ciclos);
-- - um componente novo tem de ser uma variante activa (proposta); arquivar
--   depois um componente é permitido (C6): o kit fica, e o Stock dá-o sem
--   disponibilidade; um componente arquivado que já estava no kit pode ficar
--   quando se muda o resto da lista (revisão do #81, P2-1);
-- - a composição de uma variante arquivada não muda (arquivada é final);
-- - uma variante que é componente de um kit não se apaga (proposta: o kit
--   perderia um componente sem ninguém ver); por isso o rascunho de um artigo
--   cuja variante está no kit de outro artigo só se apaga depois de a tirar
--   desse kit (limitação conhecida, revisão do #81, P2-5);
-- - apagar um rascunho apaga primeiro a composição dos kits dele e só depois
--   as variantes, por qualquer ordem que estejam (revisão do #81, P1-1).

-- Para as chaves estrangeiras compostas (comerciante, variante), como o artigo.
ALTER TABLE variante ADD CONSTRAINT variante_comerciante_id_unico UNIQUE (comerciante_id, id);

CREATE TABLE componente (
  comerciante_id uuid NOT NULL,
  kit_id uuid NOT NULL,
  componente_id uuid NOT NULL,
  quantidade integer NOT NULL CHECK (quantidade > 0),
  posicao integer NOT NULL DEFAULT 0 CHECK (posicao >= 0),
  PRIMARY KEY (kit_id, componente_id),
  CONSTRAINT componente_nao_e_o_kit CHECK (kit_id <> componente_id),
  -- Apagar o kit (só um rascunho, 0002) leva a composição dele.
  CONSTRAINT componente_do_kit FOREIGN KEY (comerciante_id, kit_id)
    REFERENCES variante (comerciante_id, id) ON DELETE CASCADE,
  -- Apagar uma variante que é componente de um kit é recusado.
  CONSTRAINT componente_em_uso FOREIGN KEY (comerciante_id, componente_id)
    REFERENCES variante (comerciante_id, id)
);
CREATE INDEX componente_por_componente ON componente (comerciante_id, componente_id);

CREATE FUNCTION componente_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  linha public.componente;
  estado_do_kit text;
  estado_do_artigo text;
  estado_do_componente text;
BEGIN
  linha := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;

  SELECT v.estado, a.estado INTO estado_do_kit, estado_do_artigo
  FROM public.variante v
  JOIN public.artigo a ON a.comerciante_id = v.comerciante_id AND a.id = v.artigo_id
  WHERE v.comerciante_id = linha.comerciante_id AND v.id = linha.kit_id;
  -- Sem kit: está a ser apagado (rascunho) e a composição vai com ele. A
  -- composição de um kit arquivado só se apaga quando é o próprio rascunho do
  -- artigo dele que se apaga (P8): o DELETE vem então de outro trigger
  -- (artigo_antes_de_apagar), o que a API não consegue imitar — um DELETE
  -- directo da API corre com pg_trigger_depth() = 1 (revisão do #81, 2.ª, P3-3).
  IF estado_do_kit = 'arquivada'
     AND NOT (TG_OP = 'DELETE' AND estado_do_artigo = 'rascunho'
              AND pg_trigger_depth() > 1) THEN
    RAISE EXCEPTION 'catalog.variant_archived_is_final: a composição de uma variante arquivada não muda';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND (NEW.comerciante_id <> OLD.comerciante_id
      OR NEW.kit_id <> OLD.kit_id OR NEW.componente_id <> OLD.componente_id) THEN
    RAISE EXCEPTION 'catalog.immutable_identity: o kit e o componente de uma linha não mudam; substituir a lista';
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Quem acrescenta componentes no mesmo comerciante, um de cada vez: duas
    -- escritas ao mesmo tempo (A em B e B em A) não passam as duas na
    -- verificação dos ciclos.
    -- Uma linha com o comerciante de outro toma o bloqueio dele, mas o RLS
    -- recusa-a logo a seguir e o erro larga todos os bloqueios da transacção
    -- (medido a 05/10/2026: a sessão falhada não guarda nenhum), por isso não
    -- prende a fila do outro (revisões do #81: 1.ª, P3-1; 2.ª, P3-1).
    PERFORM pg_advisory_xact_lock(
      hashtextextended('eurolify.componente:' || NEW.comerciante_id::text, 0));

    SELECT v.estado INTO estado_do_componente FROM public.variante v
    WHERE v.comerciante_id = NEW.comerciante_id AND v.id = NEW.componente_id
    FOR SHARE;
    IF estado_do_componente = 'arquivada' THEN
      RAISE EXCEPTION 'catalog.component_archived: um componente novo tem de ser uma variante activa';
    END IF;

    -- Sem ciclos: o kit não pode estar dentro do componente, a nenhum nível.
    IF EXISTS (
      WITH RECURSIVE dentro (id) AS (
        SELECT NEW.componente_id
        UNION
        SELECT c.componente_id FROM public.componente c
        JOIN dentro d ON c.comerciante_id = NEW.comerciante_id AND c.kit_id = d.id
      )
      SELECT FROM dentro WHERE id = NEW.kit_id
    ) THEN
      RAISE EXCEPTION 'catalog.component_cycle: o kit ficaria dentro de si próprio';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- Apagar um rascunho (0002), agora com kits: primeiro a composição dos kits
-- do artigo, depois as variantes. Só com o DELETE das variantes, a ordem delas
-- decidia: se o componente vinha antes do kit, a chave `componente_em_uso`
-- recusava (revisão do #81, P1-1).
CREATE OR REPLACE FUNCTION artigo_antes_de_apagar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF OLD.estado <> 'rascunho' OR OLD.ja_esteve_activo THEN
    RAISE EXCEPTION 'catalog.not_draft: só se apaga um rascunho que nunca esteve activo; arquivar';
  END IF;
  -- Na mesma fila de quem muda kits do comerciante (definirComponentes e o
  -- trigger da composição), antes de prender linhas: sem isto, apagar o
  -- rascunho e substituir a composição de um kit dele ao mesmo tempo podiam
  -- esperar um pelo outro (40P01; revisão do #81, 2.ª, P2-1).
  PERFORM pg_advisory_xact_lock(
    hashtextextended('eurolify.componente:' || OLD.comerciante_id::text, 0));
  DELETE FROM public.componente c
  WHERE c.comerciante_id = OLD.comerciante_id
    AND c.kit_id IN (SELECT v.id FROM public.variante v
                     WHERE v.comerciante_id = OLD.comerciante_id
                       AND v.artigo_id = OLD.id);
  DELETE FROM public.variante v
  WHERE v.comerciante_id = OLD.comerciante_id AND v.artigo_id = OLD.id;
  RETURN OLD;
END
$$;

CREATE TRIGGER componente_antes_de_gravar
  BEFORE INSERT OR UPDATE OR DELETE ON componente
  FOR EACH ROW EXECUTE FUNCTION componente_antes_de_gravar();

ALTER TABLE componente ENABLE ROW LEVEL SECURITY;
ALTER TABLE componente FORCE ROW LEVEL SECURITY;
CREATE POLICY so_o_proprio ON componente
  USING (comerciante_id = comerciante_actual())
  WITH CHECK (comerciante_id = comerciante_actual());

-- A API substitui a lista inteira (apaga e insere) e pode mudar quantidade e
-- posição; o kit e o componente de uma linha não mudam.
GRANT SELECT, DELETE ON componente TO eurolify_api;
GRANT INSERT (comerciante_id, kit_id, componente_id, quantidade, posicao)
  ON componente TO eurolify_api;
GRANT UPDATE (quantidade, posicao) ON componente TO eurolify_api;
