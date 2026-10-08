-- As exportações dos dados do comerciante (docs/14 §3.11, «Exportação do
-- catálogo»; docs/15 §7; docs/06, CS; issue #77). Ex.: a exportação do
-- catálogo de uma loja com 300 artigos, um ZIP de 12 MB, que fica 7 dias.
--
-- Regras:
-- - um recurso comum aos domínios: `dominios` diz o que leva (hoje só
--   `catalogo`);
-- - a linha nasce quando o ZIP já está feito e guardado (`pronta`); o ZIP
--   vive no armazenamento da API, fora da base, pelo id;
-- - fica 7 dias (`expira_em`); depois, o ficheiro já não se descarrega;
-- - a API não muda nem apaga uma exportação.

CREATE TABLE exportacao (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  dominios text[] NOT NULL CHECK (
    cardinality(dominios) >= 1 AND dominios <@ ARRAY['catalogo']::text[]),
  estado text NOT NULL DEFAULT 'pronta' CHECK (estado IN ('pronta')),
  formato text NOT NULL CHECK (formato = 'eurolify.catalogo/1'),
  bytes bigint NOT NULL CHECK (bytes > 0),
  resumo text NOT NULL CHECK (resumo ~ '^[0-9a-f]{64}$'),
  criada_em timestamptz NOT NULL DEFAULT now(),
  expira_em timestamptz NOT NULL DEFAULT now() + interval '7 days',
  UNIQUE (comerciante_id, id)
);
CREATE INDEX exportacao_por_comerciante
  ON exportacao (comerciante_id, criada_em DESC, id DESC);

-- A data e o prazo são da base, não de quem pede.
CREATE FUNCTION exportacao_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  NEW.criada_em := now();
  NEW.expira_em := now() + interval '7 days';
  RETURN NEW;
END
$$;
CREATE TRIGGER exportacao_antes_de_gravar
  BEFORE INSERT ON exportacao
  FOR EACH ROW EXECUTE FUNCTION exportacao_antes_de_gravar();

ALTER TABLE exportacao ENABLE ROW LEVEL SECURITY;
ALTER TABLE exportacao FORCE ROW LEVEL SECURITY;
CREATE POLICY so_o_proprio ON exportacao
  USING (comerciante_id = comerciante_actual())
  WITH CHECK (comerciante_id = comerciante_actual());

GRANT SELECT ON exportacao TO eurolify_api;
GRANT INSERT (comerciante_id, dominios, formato, bytes, resumo)
  ON exportacao TO eurolify_api;
