-- Documentos fiscais, parte 2b: ligar o Moloni pela autorização dele
-- (docs/29 §17; §13.4 e M1, docs/06 DZ; issue #310).
--
-- `autorizacao_faturacao`: um pedido de autorização de uma ligação. Guarda só
-- o resumo SHA-256 do valor dado ao dono (`state`), a empresa pedida, quando
-- expira (10 minutos) e quando se usou. Uma autorização gasta-se uma vez: a
-- API marca-a usada antes de trocar o código no Moloni.

SET LOCAL lock_timeout = '10s';

CREATE TABLE autorizacao_faturacao (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  ligacao_id uuid NOT NULL,
  -- O company_id do Moloni (só uma empresa da lista de teste, M8).
  empresa text NOT NULL CHECK (empresa ~ '^[0-9]{1,12}$'),
  resumo bytea NOT NULL UNIQUE CHECK (length(resumo) = 32),
  criada_por text NOT NULL,
  criada_em timestamptz NOT NULL DEFAULT now(),
  expira_em timestamptz NOT NULL,
  usada_em timestamptz,
  CHECK (expira_em > criada_em AND expira_em <= criada_em + interval '1 hour'),
  FOREIGN KEY (comerciante_id, ligacao_id) REFERENCES ligacao_faturacao (comerciante_id, id)
);
CREATE INDEX autorizacao_faturacao_ligacao ON autorizacao_faturacao (ligacao_id);

-- Usada não volta atrás; nada mais muda.
CREATE FUNCTION autorizacao_faturacao_so_usar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'invoices.immutable: uma autorização não se apaga';
  END IF;
  IF OLD.usada_em IS NOT NULL
     OR NEW.usada_em IS NULL
     OR ROW(NEW.id, NEW.comerciante_id, NEW.ligacao_id, NEW.empresa, NEW.resumo, NEW.criada_por,
            NEW.criada_em, NEW.expira_em)
        IS DISTINCT FROM
        ROW(OLD.id, OLD.comerciante_id, OLD.ligacao_id, OLD.empresa, OLD.resumo, OLD.criada_por,
            OLD.criada_em, OLD.expira_em) THEN
    RAISE EXCEPTION 'invoices.immutable: uma autorização só se marca usada, uma vez';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER autorizacao_faturacao_so_usar BEFORE UPDATE OR DELETE ON autorizacao_faturacao
  FOR EACH ROW EXECUTE FUNCTION autorizacao_faturacao_so_usar();
ALTER TABLE autorizacao_faturacao ENABLE ALWAYS TRIGGER autorizacao_faturacao_so_usar;

ALTER TABLE autorizacao_faturacao ENABLE ROW LEVEL SECURITY;
ALTER TABLE autorizacao_faturacao FORCE ROW LEVEL SECURITY;
CREATE POLICY so_o_proprio ON autorizacao_faturacao
  USING (comerciante_id = comerciante_actual())
  WITH CHECK (comerciante_id = comerciante_actual());

REVOKE ALL ON autorizacao_faturacao FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION autorizacao_faturacao_so_usar() FROM PUBLIC;
GRANT SELECT ON autorizacao_faturacao TO eurolify_api;
GRANT INSERT (comerciante_id, ligacao_id, empresa, resumo, criada_por, expira_em)
  ON autorizacao_faturacao TO eurolify_api;
GRANT UPDATE (usada_em) ON autorizacao_faturacao TO eurolify_api;
