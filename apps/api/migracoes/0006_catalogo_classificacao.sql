-- Domínio Catálogo: a classificação do artigo (docs/14 §3.10, «Classificação
-- do artigo»; Q2 do docs/16, decidida pelo Diogo a 05/10/2026: «podemos
-- classificar já»; #88, #89). Ex.: um workshop de unhas a 12/11 é um
-- `bilhete`, de natureza `acesso_com_data`, presencial, em PT.
--
-- O que esta migração faz:
-- - guarda no artigo a família setorial (uma ou mais), a natureza para o
--   consumidor, o modo, a data e o local da prestação, a declaração de lazer
--   com data, e quem classificou e quando (a data é da base);
-- - recusa as combinações que o desenho não admite (natureza do tipo, lazer
--   só num acesso com data, modo coerente com a natureza, local e datas
--   bem formados).
--
-- O que não faz (e onde fica):
-- - «sem classificação não se publica» é um impedimento da verificação
--   «pode publicar?» (C2), que ainda não existe: a função que dá esses
--   impedimentos está em src/catalogo/classificacao.ts e a C2 chama-a quando
--   a publicação entrar (parte 4 do #77);
-- - a natureza para o IVA espera pelo Motor de IVA (a lista é dele, §3.10).
--
-- As 27 famílias e o `por_classificar` são os de
-- .agents/skills/eurolify-legal-briefing-eu/references/sectors.md (tabela
-- «Famílias», 05/10/2026), pela mesma ordem; a lista vive também em
-- src/base/esquema.ts e um teste compara as duas (C8).

ALTER TABLE artigo
  ADD COLUMN familias text[] NOT NULL DEFAULT ARRAY['por_classificar']::text[],
  ADD COLUMN natureza_consumidor text,
  ADD COLUMN modo text,
  ADD COLUMN prestacao_inicio timestamptz,
  ADD COLUMN prestacao_fim timestamptz,
  ADD COLUMN local_pais text,
  ADD COLUMN local_territorio text,
  ADD COLUMN lazer_com_data boolean NOT NULL DEFAULT false,
  ADD COLUMN classificado_por text,
  ADD COLUMN classificado_em timestamptz;

ALTER TABLE artigo
  ADD CONSTRAINT artigo_familias_validas CHECK (
    cardinality(familias) BETWEEN 1 AND 27
    AND familias <@ ARRAY[
      'por_classificar',
      'retalho_geral',
      'texteis_calcado_joalharia',
      'cosmeticos_perfumaria',
      'alimentos_bebidas',
      'suplementos_novos_alimentos',
      'alcool_tabaco',
      'animais_plantas_sementes',
      'medicamentos',
      'dispositivos_medicos',
      'biocidas_fitofarmacos',
      'quimicos_misturas',
      'electronica_radio_electrodomesticos',
      'baterias',
      'brinquedos_infantis',
      'maquinas_ferramentas_epi',
      'construcao_medicao',
      'veiculos_pecas_drones',
      'cadeias_florestais_eudr',
      'usados_recondicionados',
      'personalizados_por_encomenda',
      'conteudos_servicos_digitais',
      'cartoes_oferta_vales',
      'servicos_gerais_instalacao',
      'saude_educacao_profissoes',
      'turismo_alojamento_eventos',
      'plataformas_intermediacao',
      'armas_explosivos_jogo'
    ]::text[]
    -- «Por classificar» não se junta a uma família: ou se sabe, ou não.
    AND (NOT ('por_classificar' = ANY (familias)) OR cardinality(familias) = 1)
  ),
  ADD CONSTRAINT artigo_natureza_valida CHECK (
    natureza_consumidor IS NULL OR natureza_consumidor IN (
      'bem', 'servico_presencial', 'servico_humano_a_distancia',
      'acesso_com_data', 'conteudo_digital', 'servico_digital', 'vale')
  ),
  -- Que natureza cada tipo admite (§3.10).
  ADD CONSTRAINT artigo_natureza_do_tipo CHECK (
    natureza_consumidor IS NULL
    OR (tipo = 'fisico' AND natureza_consumidor = 'bem')
    OR (tipo = 'servico' AND natureza_consumidor IN ('servico_presencial', 'servico_humano_a_distancia'))
    OR (tipo = 'bilhete' AND natureza_consumidor = 'acesso_com_data')
    OR (tipo = 'digital' AND natureza_consumidor IN ('conteudo_digital', 'servico_digital'))
    OR (tipo = 'cartao_oferta' AND natureza_consumidor = 'vale')
  ),
  ADD CONSTRAINT artigo_modo_valido CHECK (
    modo IS NULL OR modo IN ('presencial', 'virtual')
  ),
  -- O modo só existe no que se presta, e não contradiz a natureza.
  ADD CONSTRAINT artigo_modo_da_natureza CHECK (
    modo IS NULL
    OR (natureza_consumidor = 'acesso_com_data')
    OR (natureza_consumidor = 'servico_presencial' AND modo = 'presencial')
    OR (natureza_consumidor = 'servico_humano_a_distancia' AND modo = 'virtual')
  ),
  -- A excepção do lazer com data só se declara num acesso com data (§3.10;
  -- por omissão, não: nunca «tem data ⇒ sem livre resolução»).
  ADD CONSTRAINT artigo_lazer_so_em_acesso CHECK (
    NOT lazer_com_data OR natureza_consumidor = 'acesso_com_data'
  ),
  -- Início e fim vão juntos, e o fim é depois do início.
  ADD CONSTRAINT artigo_prestacao_datas CHECK (
    (prestacao_inicio IS NULL) = (prestacao_fim IS NULL)
    AND (prestacao_fim IS NULL OR prestacao_fim > prestacao_inicio)
  ),
  -- O país do local é um dos 27 (os mesmos do motor de regras); o
  -- território só com o país.
  ADD CONSTRAINT artigo_local_valido CHECK (
    (local_pais IS NULL OR local_pais IN (
      'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE',
      'IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE'))
    AND (local_territorio IS NULL OR (local_pais IS NOT NULL
      AND length(btrim(local_territorio)) BETWEEN 1 AND 20))
  ),
  ADD CONSTRAINT artigo_classificado_por_valido CHECK (
    classificado_por IS NULL OR length(btrim(classificado_por)) BETWEEN 1 AND 200
  );

-- Quem classificou e quando: mudar a classificação exige quem; a data é da
-- base. As famílias guardam-se sem repetidos e por ordem, para duas listas
-- iguais serem iguais.
CREATE FUNCTION artigo_classificacao_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  NEW.familias := ARRAY(SELECT DISTINCT f FROM unnest(NEW.familias) AS f ORDER BY f);
  IF TG_OP = 'INSERT' THEN
    NEW.classificado_por := NULL;
    NEW.classificado_em := NULL;
    RETURN NEW;
  END IF;
  IF (NEW.familias, NEW.natureza_consumidor, NEW.modo, NEW.prestacao_inicio,
      NEW.prestacao_fim, NEW.local_pais, NEW.local_territorio,
      NEW.lazer_com_data)
     IS DISTINCT FROM
     (OLD.familias, OLD.natureza_consumidor, OLD.modo, OLD.prestacao_inicio,
      OLD.prestacao_fim, OLD.local_pais, OLD.local_territorio,
      OLD.lazer_com_data)
  THEN
    IF NEW.classificado_por IS NULL OR btrim(NEW.classificado_por) = '' THEN
      RAISE EXCEPTION 'catalog.classified_by_required: mudar a classificação exige quem classificou';
    END IF;
    NEW.classificado_em := now();
  ELSE
    NEW.classificado_por := OLD.classificado_por;
    NEW.classificado_em := OLD.classificado_em;
  END IF;
  RETURN NEW;
END
$$;

-- Corre antes do artigo_antes_de_gravar (ordem alfabética dos triggers do
-- PostgreSQL), que sobe a versão.
CREATE TRIGGER artigo_classificacao_antes_de_gravar
  BEFORE INSERT OR UPDATE ON artigo
  FOR EACH ROW EXECUTE FUNCTION artigo_classificacao_antes_de_gravar();
