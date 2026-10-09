-- As importações do catálogo, com ensaio antes de gravar (docs/14 §3.11,
-- «Importação do catálogo»; docs/06, CT; issue #77). Ex.: um CSV com 300
-- variantes: o ensaio guarda o relatório («280 a criar, 15 a alterar, 5
-- recusadas») e o plano; aplicar grava o plano, tudo ou nada.
--
-- Regras:
-- - o ficheiro não se guarda: só o resumo SHA-256, o tamanho, o relatório e
--   o plano;
-- - nasce `analisada`, com 24 h para se aplicar (`expira_em`, da base);
-- - passa a `aplicada` uma vez, antes de expirar, e não volta atrás;
-- - a API não apaga importações nem muda o relatório ou o plano.

CREATE TABLE importacao (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  formato text NOT NULL CHECK (formato IN ('csv', 'eurolify.catalogo/1')),
  resumo text NOT NULL CHECK (resumo ~ '^[0-9a-f]{64}$'),
  bytes integer NOT NULL CHECK (bytes > 0 AND bytes <= 10485760),
  estado text NOT NULL DEFAULT 'analisada' CHECK (estado IN ('analisada', 'aplicada')),
  relatorio jsonb NOT NULL,
  plano jsonb NOT NULL,
  resultado jsonb,
  analisada_em timestamptz NOT NULL DEFAULT now(),
  aplicada_em timestamptz,
  expira_em timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  UNIQUE (comerciante_id, id),
  CONSTRAINT importacao_aplicada_com_data CHECK (
    (estado = 'aplicada') = (aplicada_em IS NOT NULL AND resultado IS NOT NULL))
);
CREATE INDEX importacao_por_comerciante ON importacao (comerciante_id, id DESC);

CREATE FUNCTION importacao_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.estado := 'analisada';
    NEW.analisada_em := now();
    NEW.expira_em := now() + interval '24 hours';
    NEW.aplicada_em := NULL;
    NEW.resultado := NULL;
    RETURN NEW;
  END IF;
  IF OLD.estado = 'aplicada' THEN
    RAISE EXCEPTION 'import.already_applied: uma importação aplica-se uma vez';
  END IF;
  IF NEW.estado <> 'aplicada' THEN
    RAISE EXCEPTION 'import.invalid_transition: só analisada → aplicada';
  END IF;
  IF OLD.expira_em <= now() THEN
    RAISE EXCEPTION 'import.expired: o ensaio expirou; faça outro';
  END IF;
  NEW.aplicada_em := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER importacao_antes_de_gravar
  BEFORE INSERT OR UPDATE ON importacao
  FOR EACH ROW EXECUTE FUNCTION importacao_antes_de_gravar();

ALTER TABLE importacao ENABLE ROW LEVEL SECURITY;
ALTER TABLE importacao FORCE ROW LEVEL SECURITY;
CREATE POLICY so_o_proprio ON importacao
  USING (comerciante_id = comerciante_actual())
  WITH CHECK (comerciante_id = comerciante_actual());

GRANT SELECT ON importacao TO eurolify_api;
GRANT INSERT (comerciante_id, formato, resumo, bytes, relatorio, plano)
  ON importacao TO eurolify_api;
GRANT UPDATE (estado, resultado) ON importacao TO eurolify_api;
