-- Documentos fiscais, parte 3: o relatório OSS (docs/37; docs/06, EF; issue
-- #310).
--
-- - `relatorio_oss_fecho`: o fecho de um período (um trimestre ou um mês), com
--   a fotografia congelada dos números, quem fechou e quando (P3); só se
--   acrescenta e não se reabre (P6);
-- - `relatorio_oss_documento`: cada documento que entrou num fecho, por
--   granularidade, uma vez só — um documento que chegue depois com a data de
--   um período fechado entra no período seguinte como alteração (P4; Diretiva
--   IVA, art. 369.º-G, n.º 4);
-- - `relatorio_oss_classificacao`: a decisão do dono sobre um documento que
--   o relatório não classifica sozinho (P1-A da 2.ª revisão do #392);
-- - o evento `tax_report.closed`.

SET LOCAL lock_timeout = '10s';

CREATE TABLE relatorio_oss_fecho (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  entidade_legal_id uuid NOT NULL,
  -- `trimestre` (o OSS, art. 369.º-F) ou `mes` (a declaração nacional).
  granularidade text NOT NULL CHECK (granularidade IN ('trimestre', 'mes')),
  -- 2026-T4 ou 2026-10.
  periodo text NOT NULL CHECK (periodo ~ '^[0-9]{4}-(T[1-4]|(0[1-9]|1[0-2]))$'),
  CHECK ((granularidade = 'trimestre') = (periodo ~ '-T')),
  -- Os números como foram mostrados ao fechar (nunca recalculados).
  fotografia jsonb NOT NULL CHECK (jsonb_typeof(fotografia) = 'object'),
  -- A versão da regra dos baldes (docs/37 §2.1) com que se fez.
  versao_regra integer NOT NULL CHECK (versao_regra >= 1),
  -- O que a pessoa confirmou ter visto (P5).
  confirmacoes jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(confirmacoes) = 'object'),
  fechado_por text NOT NULL,
  fechado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (comerciante_id, id),
  UNIQUE (entidade_legal_id, granularidade, periodo),
  FOREIGN KEY (comerciante_id, entidade_legal_id) REFERENCES entidade_legal (comerciante_id, id)
);

CREATE TABLE relatorio_oss_documento (
  comerciante_id uuid NOT NULL,
  fecho_id uuid NOT NULL,
  granularidade text NOT NULL CHECK (granularidade IN ('trimestre', 'mes')),
  documento_id uuid NOT NULL,
  -- O período da data do documento; diferente do do fecho numa alteração.
  periodo_original text NOT NULL,
  -- O balde e o país de cada linha como entraram no fecho: os registos de um
  -- período fechado lêem-se daqui, nunca da regra actual (revisão do #392,
  -- P2-2). Vazio numa venda emitida fora do Eurolify (sem linhas).
  linhas jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(linhas) = 'array'),
  PRIMARY KEY (granularidade, documento_id),
  FOREIGN KEY (comerciante_id, fecho_id) REFERENCES relatorio_oss_fecho (comerciante_id, id),
  FOREIGN KEY (comerciante_id, documento_id) REFERENCES documento_fiscal (comerciante_id, id)
);
CREATE INDEX relatorio_oss_documento_fecho ON relatorio_oss_documento (fecho_id);

-- A classificação de um documento que o relatório não sabe classificar
-- sozinho (P1-A da 2.ª revisão do #392; Diogo, 12/10/2026): uma fatura
-- `resolvido` cuja prova não bate com o pedido, uma prova sem data ou uma
-- linha sem balde. O dono escolhe o balde e o país de cada linha da prova (a
-- taxa e os valores vêm sempre da prova) e, se a prova não tem data, a data.
-- Uma vez por documento; não muda.
CREATE TABLE relatorio_oss_classificacao (
  comerciante_id uuid NOT NULL,
  documento_id uuid NOT NULL,
  -- [{balde, pais}], uma por linha da prova, pela ordem dela.
  linhas jsonb NOT NULL CHECK (jsonb_typeof(linhas) = 'array' AND jsonb_array_length(linhas) > 0),
  data date,
  motivo text NOT NULL CHECK (length(btrim(motivo)) BETWEEN 1 AND 500),
  decidido_por text NOT NULL,
  decidido_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (documento_id),
  FOREIGN KEY (comerciante_id, documento_id) REFERENCES documento_fiscal (comerciante_id, id)
);

-- Só se acrescenta (P3, P6): nem se muda, nem se apaga.
CREATE FUNCTION relatorio_oss_so_acrescenta() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'tax_reports.immutable: um período fechado não muda nem se reabre';
END
$$;
CREATE TRIGGER relatorio_oss_fecho_so_acrescenta BEFORE UPDATE OR DELETE ON relatorio_oss_fecho
  FOR EACH ROW EXECUTE FUNCTION relatorio_oss_so_acrescenta();
ALTER TABLE relatorio_oss_fecho ENABLE ALWAYS TRIGGER relatorio_oss_fecho_so_acrescenta;
CREATE TRIGGER relatorio_oss_documento_so_acrescenta BEFORE UPDATE OR DELETE ON relatorio_oss_documento
  FOR EACH ROW EXECUTE FUNCTION relatorio_oss_so_acrescenta();
ALTER TABLE relatorio_oss_documento ENABLE ALWAYS TRIGGER relatorio_oss_documento_so_acrescenta;
-- Também contra TRUNCATE, como os documentos (0050; revisão do #392, P3).
CREATE TRIGGER relatorio_oss_fecho_sem_truncate BEFORE TRUNCATE ON relatorio_oss_fecho
  FOR EACH STATEMENT EXECUTE FUNCTION relatorio_oss_so_acrescenta();
ALTER TABLE relatorio_oss_fecho ENABLE ALWAYS TRIGGER relatorio_oss_fecho_sem_truncate;
CREATE TRIGGER relatorio_oss_documento_sem_truncate BEFORE TRUNCATE ON relatorio_oss_documento
  FOR EACH STATEMENT EXECUTE FUNCTION relatorio_oss_so_acrescenta();
ALTER TABLE relatorio_oss_documento ENABLE ALWAYS TRIGGER relatorio_oss_documento_sem_truncate;

CREATE TRIGGER relatorio_oss_classificacao_so_acrescenta BEFORE UPDATE OR DELETE ON relatorio_oss_classificacao
  FOR EACH ROW EXECUTE FUNCTION relatorio_oss_so_acrescenta();
ALTER TABLE relatorio_oss_classificacao ENABLE ALWAYS TRIGGER relatorio_oss_classificacao_so_acrescenta;
CREATE TRIGGER relatorio_oss_classificacao_sem_truncate BEFORE TRUNCATE ON relatorio_oss_classificacao
  FOR EACH STATEMENT EXECUTE FUNCTION relatorio_oss_so_acrescenta();
ALTER TABLE relatorio_oss_classificacao ENABLE ALWAYS TRIGGER relatorio_oss_classificacao_sem_truncate;

-- O evento do fecho: só identificadores (headless-commerce).
CREATE FUNCTION relatorio_oss_evento() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  INSERT INTO public.evento_saida (comerciante_id, tipo, agregado_tipo, agregado_id, dados)
  VALUES (NEW.comerciante_id, 'tax_report.closed', 'relatorio_oss_fecho', NEW.id,
    jsonb_build_object('fecho_id', NEW.id, 'entidade_legal_id', NEW.entidade_legal_id,
      'granularidade', NEW.granularidade, 'periodo', NEW.periodo,
      'em', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
  RETURN NULL;
END
$$;
CREATE TRIGGER relatorio_oss_fecho_evento AFTER INSERT ON relatorio_oss_fecho
  FOR EACH ROW EXECUTE FUNCTION relatorio_oss_evento();
ALTER TABLE relatorio_oss_fecho ENABLE ALWAYS TRIGGER relatorio_oss_fecho_evento;

ALTER TABLE relatorio_oss_fecho ENABLE ROW LEVEL SECURITY;
ALTER TABLE relatorio_oss_fecho FORCE ROW LEVEL SECURITY;
CREATE POLICY so_o_proprio ON relatorio_oss_fecho
  USING (comerciante_id = comerciante_actual())
  WITH CHECK (comerciante_id = comerciante_actual());
ALTER TABLE relatorio_oss_documento ENABLE ROW LEVEL SECURITY;
ALTER TABLE relatorio_oss_documento FORCE ROW LEVEL SECURITY;
CREATE POLICY so_o_proprio ON relatorio_oss_documento
  USING (comerciante_id = comerciante_actual())
  WITH CHECK (comerciante_id = comerciante_actual());

ALTER TABLE relatorio_oss_classificacao ENABLE ROW LEVEL SECURITY;
ALTER TABLE relatorio_oss_classificacao FORCE ROW LEVEL SECURITY;
CREATE POLICY so_o_proprio ON relatorio_oss_classificacao
  USING (comerciante_id = comerciante_actual())
  WITH CHECK (comerciante_id = comerciante_actual());

REVOKE ALL ON relatorio_oss_fecho, relatorio_oss_documento, relatorio_oss_classificacao FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION relatorio_oss_so_acrescenta(), relatorio_oss_evento() FROM PUBLIC;
GRANT SELECT ON relatorio_oss_fecho, relatorio_oss_documento TO eurolify_api;
GRANT INSERT (comerciante_id, entidade_legal_id, granularidade, periodo, fotografia, versao_regra,
  confirmacoes, fechado_por) ON relatorio_oss_fecho TO eurolify_api;
GRANT INSERT ON relatorio_oss_documento TO eurolify_api;
GRANT SELECT ON relatorio_oss_classificacao TO eurolify_api;
GRANT INSERT (comerciante_id, documento_id, linhas, data, motivo, decidido_por)
  ON relatorio_oss_classificacao TO eurolify_api;
