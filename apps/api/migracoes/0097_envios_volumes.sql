-- Envios: vários volumes numa expedição (docs/36 §23; parte 3, Q6; issue
-- #393; Diogo, 14/10/2026: «sim, aprovo; avança com o código»). Ex.: 12
-- vernizes e um candeeiro UV em 2 caixas, de 1,2 kg e 2,8 kg: uma etiqueta e
-- um seguimento por caixa, no mesmo envio. Sem volumes, a expedição tem uma
-- caixa, como até aqui.
-- - Os volumes mudam como o peso corrigido (0086): só com a expedição
--   criada e sem etiqueta viva, com motivo, e cada mudança fica no rasto.
-- - O ficheiro da etiqueta passa a ter um por volume; o que apaga pela
--   expedição (Q7, apagamento do titular) apaga-os todos.
-- - Cada evento de seguimento diz de que volume é. A expedição só fica
--   entregue com todos os volumes entregues (L13; Dir. 2011/83/UE, art.
--   9.º, n.º 2, b), i) e ii)): é a API que o decide.
SET LOCAL lock_timeout = '10s';

-- ------------------------------------------------- Os volumes (§23.3)

-- O peso de cada caixa, em gramas; NULL = uma caixa, com o peso de sempre.
ALTER TABLE expedicao
  ADD COLUMN volumes_g integer[]
    CHECK (volumes_g IS NULL OR (
      array_ndims(volumes_g) = 1
      AND cardinality(volumes_g) BETWEEN 2 AND 15
      AND array_position(volumes_g, NULL) IS NULL
      AND 1 <= ALL (volumes_g) AND 1000000 >= ALL (volumes_g)));
GRANT UPDATE (volumes_g) ON expedicao TO eurolify_api;

ALTER TABLE correcao_expedicao DROP CONSTRAINT correcao_expedicao_campo_check;
ALTER TABLE correcao_expedicao ADD CONSTRAINT correcao_expedicao_campo_check
  CHECK (campo IN ('peso', 'servico', 'volumes'));

-- O gatilho da 0086, com os volumes: as mesmas portas e o mesmo rasto.
CREATE OR REPLACE FUNCTION expedicao_correcao() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem text := nullif(btrim(current_setting('eurolify.quem', true)), '');
  motivo text := nullif(btrim(current_setting('eurolify.motivo', true)), '');
  peso_mudou boolean := NEW.peso_corrigido_g IS DISTINCT FROM OLD.peso_corrigido_g;
  servico_mudou boolean := NEW.conta_escolhida_id IS DISTINCT FROM OLD.conta_escolhida_id
    OR NEW.servico_escolhido IS DISTINCT FROM OLD.servico_escolhido;
  volumes_mudou boolean := NEW.volumes_g IS DISTINCT FROM OLD.volumes_g;
BEGIN
  IF NOT peso_mudou AND NOT servico_mudou AND NOT volumes_mudou THEN
    RETURN NEW;
  END IF;
  IF OLD.estado <> 'criada' THEN
    RAISE EXCEPTION 'shipping.invalid_transition: a expedição já não está criada (%)', OLD.estado;
  END IF;
  IF OLD.etiqueta NOT IN ('por_pedir', 'recusada', 'anulada') THEN
    RAISE EXCEPTION 'shipping.label_exists: com a etiqueta % não se corrige (anula-se primeiro)', OLD.etiqueta;
  END IF;
  IF quem IS NULL THEN
    RAISE EXCEPTION 'shipments.change_without_who: correcção sem eurolify.quem';
  END IF;
  IF motivo IS NULL OR length(motivo) < 3 THEN
    RAISE EXCEPTION 'shipping.invalid_field: a correcção pede um motivo';
  END IF;
  IF peso_mudou THEN
    INSERT INTO public.correcao_expedicao (comerciante_id, expedicao_id, campo, antes, depois, motivo, quem)
    VALUES (NEW.comerciante_id, NEW.id, 'peso', to_jsonb(OLD.peso_corrigido_g),
      to_jsonb(NEW.peso_corrigido_g), left(motivo, 500), quem);
  END IF;
  IF servico_mudou THEN
    INSERT INTO public.correcao_expedicao (comerciante_id, expedicao_id, campo, antes, depois, motivo, quem)
    VALUES (NEW.comerciante_id, NEW.id, 'servico',
      CASE WHEN OLD.conta_escolhida_id IS NULL THEN NULL
        ELSE jsonb_build_object('conta', OLD.conta_escolhida_id, 'servico', OLD.servico_escolhido) END,
      CASE WHEN NEW.conta_escolhida_id IS NULL THEN NULL
        ELSE jsonb_build_object('conta', NEW.conta_escolhida_id, 'servico', NEW.servico_escolhido) END,
      left(motivo, 500), quem);
  END IF;
  IF volumes_mudou THEN
    INSERT INTO public.correcao_expedicao (comerciante_id, expedicao_id, campo, antes, depois, motivo, quem)
    VALUES (NEW.comerciante_id, NEW.id, 'volumes', to_jsonb(OLD.volumes_g),
      to_jsonb(NEW.volumes_g), left(motivo, 500), quem);
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER expedicao_correcao ON expedicao;
CREATE TRIGGER expedicao_correcao
  BEFORE UPDATE OF peso_corrigido_g, conta_escolhida_id, servico_escolhido, volumes_g ON expedicao
  FOR EACH ROW EXECUTE FUNCTION expedicao_correcao();
REVOKE ALL ON FUNCTION expedicao_correcao() FROM PUBLIC;

-- ------------------------------------------ Um ficheiro por volume (Q7)

-- O que apaga pela expedição (os 30 dias, o apagamento do titular, anular)
-- apaga os volumes todos; o volume 1 é o de sempre.
ALTER TABLE etiqueta_ficheiro
  ADD COLUMN volume smallint NOT NULL DEFAULT 1 CHECK (volume BETWEEN 1 AND 15);
ALTER TABLE etiqueta_ficheiro DROP CONSTRAINT etiqueta_ficheiro_pkey;
ALTER TABLE etiqueta_ficheiro ADD PRIMARY KEY (expedicao_id, volume);
GRANT INSERT (volume) ON etiqueta_ficheiro TO eurolify_api;

-- ---------------------------------- O seguimento de cada volume (§23.3)

-- O número e o endereço de cada volume de uma expedição com vários; o
-- volume 1 fica também na expedição (o aviso e a consulta de sempre).
CREATE TABLE volume_seguimento (
  expedicao_id uuid NOT NULL,
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  volume smallint NOT NULL CHECK (volume BETWEEN 1 AND 15),
  seguimento text NOT NULL CHECK (length(btrim(seguimento)) BETWEEN 1 AND 200),
  url_seguimento text CHECK (url_seguimento IS NULL
    OR (length(url_seguimento) <= 500 AND url_seguimento ~ '^https://')),
  PRIMARY KEY (expedicao_id, volume),
  FOREIGN KEY (comerciante_id, expedicao_id) REFERENCES expedicao (comerciante_id, id)
);
CREATE INDEX volume_seguimento_por_numero ON volume_seguimento (comerciante_id, seguimento);
ALTER TABLE volume_seguimento ENABLE ROW LEVEL SECURITY;
ALTER TABLE volume_seguimento FORCE ROW LEVEL SECURITY;
CREATE POLICY so_o_proprio ON volume_seguimento
  USING (comerciante_id = comerciante_actual())
  WITH CHECK (comerciante_id = comerciante_actual());
REVOKE ALL ON volume_seguimento FROM PUBLIC;
GRANT SELECT, INSERT, DELETE ON volume_seguimento TO eurolify_api;

-- O volume de cada evento (NULL = a expedição de uma caixa só).
ALTER TABLE evento_seguimento
  ADD COLUMN volume smallint CHECK (volume IS NULL OR volume BETWEEN 1 AND 15);
GRANT INSERT (volume) ON evento_seguimento TO eurolify_api;
