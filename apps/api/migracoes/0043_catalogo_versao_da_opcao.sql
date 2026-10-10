-- A versão da opção (docs/14 §7.1, «A escrita das opções»; issue #285;
-- desenho aprovado pelo Diogo, 09/10/2026: «sim, aprovo o desenho, junta o
-- #286»). Sobe com qualquer mudança à opção ou aos valores dela (nome, texto
-- de um valor, ordem dos valores, valor novo, valor apagado), para duas
-- pessoas a mudar a mesma opção não se apagarem uma à outra sem saber. A
-- posição da opção entre as outras não a muda: a ordem das opções guarda-se
-- pela lista inteira (catalog.order_mismatch), não pela versão.
SET LOCAL lock_timeout = '10s';

ALTER TABLE opcao ADD COLUMN versao integer NOT NULL DEFAULT 1;

-- O mesmo gatilho da 0005, com a versão: nasce a 1; sobe quando o nome muda
-- ou quando o gatilho dos valores (abaixo) a pede com `versao = versao + 1`;
-- nunca toma outro valor que não o seguinte, mesmo que se escreva outro.
CREATE OR REPLACE FUNCTION opcao_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  linha public.opcao;
  estado text;
BEGIN
  linha := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  PERFORM public.catalogo_fila_do_artigo(linha.comerciante_id, linha.artigo_id);
  estado := public.catalogo_estado_do_artigo(linha.comerciante_id, linha.artigo_id);
  IF TG_OP = 'UPDATE' AND (NEW.comerciante_id <> OLD.comerciante_id
      OR NEW.artigo_id <> OLD.artigo_id) THEN
    RAISE EXCEPTION 'catalog.immutable_identity: o artigo de uma opção não muda';
  END IF;
  -- Sem artigo: está a ser apagado (rascunho) e as opções vão com ele.
  IF estado IS NOT NULL AND estado <> 'rascunho' AND (TG_OP IN ('INSERT', 'DELETE')
      OR NEW.nome IS DISTINCT FROM OLD.nome) THEN
    RAISE EXCEPTION 'catalog.not_draft: as opções só se criam, apagam ou mudam de nome num rascunho';
  END IF;
  IF TG_OP <> 'UPDATE' AND estado IS NOT NULL THEN
    PERFORM public.catalogo_marcar_combinacoes(linha.comerciante_id, linha.artigo_id);
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.criado_em := now();
    NEW.versao := 1;
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.criado_em := OLD.criado_em;
    NEW.versao := CASE
      WHEN NEW.nome IS DISTINCT FROM OLD.nome
        OR NEW.versao IS DISTINCT FROM OLD.versao THEN OLD.versao + 1
      ELSE OLD.versao
    END;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;

-- Um valor criado, mudado (texto ou posição) ou apagado sobe a versão da
-- opção dele. Os valores com que a opção nasce (na mesma transacção: o
-- `criado_em` é o início dela e a linha é dela, `xmin`) não a sobem: a opção
-- nasce na versão 1 (revisão do #290, P3-2). Quando a opção está a
-- ser apagada (ou o rascunho inteiro), a linha dela já não existe e o UPDATE
-- não encontra nada.
CREATE FUNCTION valor_opcao_sobe_versao() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  linha public.valor_opcao;
BEGIN
  linha := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  IF TG_OP = 'UPDATE' AND NEW.valor IS NOT DISTINCT FROM OLD.valor
      AND NEW.posicao IS NOT DISTINCT FROM OLD.posicao THEN
    RETURN NULL;
  END IF;
  UPDATE public.opcao SET versao = versao + 1
  WHERE comerciante_id = linha.comerciante_id AND id = linha.opcao_id
    AND NOT (TG_OP = 'INSERT' AND criado_em = now()
             AND xmin = xid(pg_current_xact_id()));
  RETURN NULL;
END
$$;
CREATE TRIGGER valor_opcao_sobe_versao
  AFTER INSERT OR UPDATE OR DELETE ON valor_opcao
  FOR EACH ROW EXECUTE FUNCTION valor_opcao_sobe_versao();

-- O gatilho dos valores corre com os direitos de quem escreve (a API): é
-- por ele que a API precisa de mudar a coluna. O valor decide-o sempre o
-- gatilho da opção (revisão do #290, P3-1).
GRANT UPDATE (versao) ON opcao TO eurolify_api;
