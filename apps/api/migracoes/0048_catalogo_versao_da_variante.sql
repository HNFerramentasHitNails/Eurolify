-- Alterar uma variante (docs/14 §7.1, «Alterar uma variante»; docs/22 §23;
-- issue #301; desenho aprovado pelo Diogo, 10/10/2026: «sim, aprovo o
-- desenho, junta o #302»).
--
-- O que esta migração faz:
-- - `variante.versao`: nasce a 1 e sobe a cada mudança da linha (também ao
--   arquivar), como o artigo e a media; quem a sobe é o gatilho, a API só a
--   lê e a confere. Duas pessoas a mudar a mesma variante: a segunda recebe
--   catalog.version_conflict e nada se grava;
-- - a unidade de venda e o conteúdo só mudam enquanto o artigo é rascunho
--   (catalog.not_draft): a unidade é o que a fatura diz (C3) e o conteúdo
--   decide o preço por unidade que o cliente viu (Dir. 98/6/CE, W). Fica na
--   base para valer para todas as escritas: a rota, a importação e o SQL
--   escrito à mão.
--
-- Corrida com quem activa o artigo: activar toma FOR SHARE nas variantes
-- activas (0002) e a mudança da variante toma a linha dela; quem chega
-- depois espera, e o gatilho lê o estado do artigo já depois da espera.
SET LOCAL lock_timeout = '10s';

ALTER TABLE variante ADD COLUMN versao integer NOT NULL DEFAULT 1;

-- O mesmo gatilho da 0002, com a versão e a regra do rascunho.
CREATE OR REPLACE FUNCTION variante_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  estado_do_artigo text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT a.estado INTO estado_do_artigo FROM public.artigo a
    WHERE a.comerciante_id = OLD.comerciante_id AND a.id = OLD.artigo_id;
    -- Sem artigo (apagado na mesma instrução) ou artigo rascunho: deixa.
    IF estado_do_artigo IS NOT NULL AND estado_do_artigo <> 'rascunho' THEN
      RAISE EXCEPTION 'catalog.not_draft: uma variante não se apaga; arquivar';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.estado <> 'activa' THEN
      RAISE EXCEPTION 'catalog.invalid_transition: uma variante nasce activa';
    END IF;
    -- Um artigo arquivado pode receber variantes novas: é assim que se repõe
    -- um artigo cujas variantes estão todas arquivadas (decisão do Diogo,
    -- 05/10/2026, revisão do #78, P1-1, opção a). Arquivado não está à venda.
    -- As datas são da base (revisão do #78, P2-2).
    NEW.criado_em := now();
    NEW.versao := 1;
    RETURN NEW;
  END IF;
  IF OLD.estado = 'arquivada' THEN
    RAISE EXCEPTION 'catalog.variant_archived_is_final: uma variante arquivada não muda; o SKU não volta a ser usado';
  END IF;
  IF NEW.id <> OLD.id OR NEW.comerciante_id <> OLD.comerciante_id
     OR NEW.artigo_id <> OLD.artigo_id OR NEW.sku <> OLD.sku THEN
    RAISE EXCEPTION 'catalog.immutable_identity: o artigo e o SKU de uma variante não mudam';
  END IF;
  IF NEW.unidade_de_venda IS DISTINCT FROM OLD.unidade_de_venda
     OR NEW.conteudo_quantidade IS DISTINCT FROM OLD.conteudo_quantidade
     OR NEW.conteudo_unidade IS DISTINCT FROM OLD.conteudo_unidade THEN
    SELECT a.estado INTO estado_do_artigo FROM public.artigo a
    WHERE a.comerciante_id = NEW.comerciante_id AND a.id = NEW.artigo_id;
    IF estado_do_artigo IS DISTINCT FROM 'rascunho' THEN
      RAISE EXCEPTION 'catalog.not_draft: a unidade de venda e o conteúdo de uma variante só mudam num rascunho';
    END IF;
  END IF;
  NEW.criado_em := OLD.criado_em;
  -- Sobe uma vez por mudança, e só com uma mudança: nunca toma o valor que
  -- quem escreve lá puser.
  NEW.versao := CASE
    WHEN (to_jsonb(NEW) - 'versao' - 'criado_em')
         IS DISTINCT FROM (to_jsonb(OLD) - 'versao' - 'criado_em')
      THEN OLD.versao + 1
    ELSE OLD.versao
  END;
  RETURN NEW;
END
$$;
