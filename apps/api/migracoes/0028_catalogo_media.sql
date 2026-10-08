-- Domínio Catálogo: as imagens dos artigos (docs/14 §3.5; docs/06, CQ;
-- issue #77). Ex.: a fotografia do «Gel construtor rosa», principal do
-- artigo, com o texto alternativo «Frasco de gel construtor rosa, 30 ml».
--
-- Regras (as marcadas «proposta» são desta parte, docs/14 §3.5):
-- - o ficheiro é do comerciante e chama-se pelo resumo SHA-256 do conteúdo:
--   o mesmo ficheiro enviado duas vezes é uma linha só; os bytes vivem fora
--   da base (o armazenamento da API, por agora o disco da VPS, CQ);
-- - só imagens JPEG, PNG e WebP, até 10 MB (proposta); a API confere os
--   primeiros bytes, a base guarda o tipo e o tamanho que ela confirmou;
-- - uma media liga um ficheiro a um artigo e, se se quiser, a uma variante
--   desse mesmo artigo; apagar o rascunho do artigo (ou a variante) leva-a;
-- - uma só principal por artigo;
-- - o texto alternativo, se houver, não é só espaços (até 500, proposta).
--
-- Concorrência: as escritas na media de um artigo passam por uma fila só
-- delas (o repositório toma-a), porque a principal e a posição seguinte
-- olham para várias linhas.

CREATE TABLE ficheiro (
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  resumo text NOT NULL CHECK (resumo ~ '^[0-9a-f]{64}$'),
  tipo text NOT NULL CHECK (tipo IN ('image/jpeg', 'image/png', 'image/webp')),
  bytes integer NOT NULL CHECK (bytes > 0 AND bytes <= 10485760),
  criado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (comerciante_id, resumo)
);

CREATE TABLE media (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  artigo_id uuid NOT NULL,
  variante_id uuid,
  ficheiro_resumo text NOT NULL,
  texto_alternativo text,
  posicao integer NOT NULL CHECK (posicao >= 0),
  principal boolean NOT NULL DEFAULT false,
  criado_em timestamptz NOT NULL DEFAULT now(),
  actualizado_em timestamptz NOT NULL DEFAULT now(),
  versao integer NOT NULL DEFAULT 1,
  CONSTRAINT media_texto_alternativo_check CHECK (
    texto_alternativo IS NULL
    OR (length(btrim(texto_alternativo)) > 0 AND length(texto_alternativo) <= 500)),
  UNIQUE (comerciante_id, id),
  CONSTRAINT media_do_artigo FOREIGN KEY (comerciante_id, artigo_id)
    REFERENCES artigo (comerciante_id, id) ON DELETE CASCADE,
  -- A variante é do mesmo artigo (sem variante, a restrição não se aplica).
  CONSTRAINT media_da_variante FOREIGN KEY (comerciante_id, artigo_id, variante_id)
    REFERENCES variante (comerciante_id, artigo_id, id) ON DELETE CASCADE,
  CONSTRAINT media_do_ficheiro FOREIGN KEY (comerciante_id, ficheiro_resumo)
    REFERENCES ficheiro (comerciante_id, resumo)
);
CREATE UNIQUE INDEX media_uma_principal
  ON media (comerciante_id, artigo_id) WHERE principal;
CREATE INDEX media_por_artigo ON media (comerciante_id, artigo_id, posicao);
CREATE INDEX media_por_ficheiro ON media (comerciante_id, ficheiro_resumo);

CREATE FUNCTION media_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.versao := 1;
    NEW.criado_em := now();
    NEW.actualizado_em := now();
    RETURN NEW;
  END IF;
  IF NEW.id <> OLD.id OR NEW.comerciante_id <> OLD.comerciante_id
     OR NEW.artigo_id <> OLD.artigo_id
     OR NEW.ficheiro_resumo <> OLD.ficheiro_resumo THEN
    RAISE EXCEPTION 'catalog.immutable_identity: o id, o comerciante, o artigo e o ficheiro de uma media não mudam';
  END IF;
  NEW.criado_em := OLD.criado_em;
  NEW.versao := OLD.versao + 1;
  NEW.actualizado_em := now();
  RETURN NEW;
END
$$;

CREATE TRIGGER media_antes_de_gravar
  BEFORE INSERT OR UPDATE ON media
  FOR EACH ROW EXECUTE FUNCTION media_antes_de_gravar();

-- RLS forçado, como na 0001.
DO $$
DECLARE
  tabela text;
BEGIN
  FOREACH tabela IN ARRAY ARRAY['ficheiro', 'media']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tabela);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tabela);
    EXECUTE format(
      'CREATE POLICY so_o_proprio ON %I USING (comerciante_id = comerciante_actual()) WITH CHECK (comerciante_id = comerciante_actual())',
      tabela);
  END LOOP;
END
$$;

-- A API não escolhe ids, datas nem versões; um ficheiro não muda nem se
-- apaga pela API (a limpeza dos órfãos entra depois); a media apaga-se.
GRANT SELECT ON ficheiro, media TO eurolify_api;
GRANT INSERT (comerciante_id, resumo, tipo, bytes) ON ficheiro TO eurolify_api;
GRANT INSERT (comerciante_id, artigo_id, variante_id, ficheiro_resumo,
  texto_alternativo, posicao, principal) ON media TO eurolify_api;
GRANT UPDATE (texto_alternativo, posicao, principal) ON media TO eurolify_api;
GRANT DELETE ON media TO eurolify_api;
