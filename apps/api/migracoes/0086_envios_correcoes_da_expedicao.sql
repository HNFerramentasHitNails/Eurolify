-- Envios: corrigir o peso e mudar o serviço de uma expedição, com motivo
-- (docs/36 §19 e §3.3; issue #393; Diogo, 13/10/2026: «sim, aprovo; avança
-- com o código»). O que foi vendido não muda: a encomenda e a cópia do
-- método na expedição (`metodo_entrega`) ficam como estão (L1, L2, L10). O
-- peso corrigido e o serviço escolhido ficam em colunas próprias; a etiqueta
-- usa-os em vez do calculado e do vendido. Só antes de haver uma etiqueta
-- viva, e cada mudança fica no rasto com o valor antigo, o novo e o motivo.
SET LOCAL lock_timeout = '10s';

-- A chave estrangeira nova valida-se lendo as linhas existentes, e a migração
-- corre sem comerciante: o NO FORCE só dura esta transacção (como a 0079).
ALTER TABLE expedicao NO FORCE ROW LEVEL SECURITY;
ALTER TABLE conta_transportadora NO FORCE ROW LEVEL SECURITY;
ALTER TABLE expedicao
  ADD COLUMN peso_corrigido_g integer
    CHECK (peso_corrigido_g IS NULL OR peso_corrigido_g BETWEEN 1 AND 1000000),
  ADD COLUMN conta_escolhida_id uuid,
  -- O mesmo formato do serviço do método (0080).
  ADD COLUMN servico_escolhido text
    CHECK (servico_escolhido IS NULL OR servico_escolhido ~ '^[0-9A-Za-z_.:/-]{1,100}$'),
  ADD CONSTRAINT expedicao_servico_escolhido_com_conta
    CHECK ((conta_escolhida_id IS NULL) = (servico_escolhido IS NULL)),
  ADD CONSTRAINT expedicao_conta_escolhida_fk FOREIGN KEY (comerciante_id, conta_escolhida_id)
    REFERENCES conta_transportadora (comerciante_id, id);
ALTER TABLE expedicao FORCE ROW LEVEL SECURITY;
ALTER TABLE conta_transportadora FORCE ROW LEVEL SECURITY;

GRANT UPDATE (peso_corrigido_g, conta_escolhida_id, servico_escolhido) ON expedicao
  TO eurolify_api;

-- O rasto das correcções: só se acrescenta, com o contexto da transacção
-- (docs/28 §3.1; `rasto_completar()`, 0053). Escreve-o o gatilho da
-- expedição, nunca a API.
CREATE TABLE correcao_expedicao (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  expedicao_id uuid NOT NULL,
  campo text NOT NULL CHECK (campo IN ('peso', 'servico')),
  antes jsonb,
  depois jsonb,
  motivo text CHECK (motivo IS NULL OR length(btrim(motivo)) BETWEEN 1 AND 500),
  quem text NOT NULL CHECK (length(btrim(quem)) BETWEEN 1 AND 200),
  em timestamptz NOT NULL DEFAULT clock_timestamp(),
  canal text,
  pedido text,
  ia jsonb,
  autorizado_por text,
  a_pedido_de jsonb,
  FOREIGN KEY (comerciante_id, expedicao_id) REFERENCES expedicao (comerciante_id, id)
);
CREATE INDEX correcao_expedicao_por_expedicao ON correcao_expedicao (expedicao_id, em);
CREATE TRIGGER rasto_completar BEFORE INSERT ON correcao_expedicao
  FOR EACH ROW EXECUTE FUNCTION rasto_completar();
CREATE TRIGGER correcao_expedicao_so_se_acrescenta BEFORE UPDATE OR DELETE ON correcao_expedicao
  FOR EACH ROW EXECUTE FUNCTION rasto_so_se_acrescenta();
CREATE TRIGGER correcao_expedicao_sem_truncate BEFORE TRUNCATE ON correcao_expedicao
  FOR EACH STATEMENT EXECUTE FUNCTION rasto_so_se_acrescenta();
ALTER TABLE correcao_expedicao ENABLE ALWAYS TRIGGER correcao_expedicao_so_se_acrescenta;
ALTER TABLE correcao_expedicao ENABLE ALWAYS TRIGGER correcao_expedicao_sem_truncate;
ALTER TABLE correcao_expedicao ENABLE ROW LEVEL SECURITY;
ALTER TABLE correcao_expedicao FORCE ROW LEVEL SECURITY;
CREATE POLICY so_o_proprio ON correcao_expedicao
  USING (comerciante_id = comerciante_actual())
  WITH CHECK (comerciante_id = comerciante_actual());
REVOKE ALL ON correcao_expedicao FROM PUBLIC;
GRANT SELECT ON correcao_expedicao TO eurolify_api;

-- Só com a expedição criada e sem etiqueta viva (§19.1: com uma viva,
-- anula-se primeiro), e sempre com motivo. Cada campo mudado, uma linha no
-- rasto. Não fica ALWAYS: escreve (regra da 0053).
CREATE FUNCTION expedicao_correcao() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem text := nullif(btrim(current_setting('eurolify.quem', true)), '');
  motivo text := nullif(btrim(current_setting('eurolify.motivo', true)), '');
  peso_mudou boolean := NEW.peso_corrigido_g IS DISTINCT FROM OLD.peso_corrigido_g;
  servico_mudou boolean := NEW.conta_escolhida_id IS DISTINCT FROM OLD.conta_escolhida_id
    OR NEW.servico_escolhido IS DISTINCT FROM OLD.servico_escolhido;
BEGIN
  IF NOT peso_mudou AND NOT servico_mudou THEN
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
  RETURN NEW;
END
$$;
CREATE TRIGGER expedicao_correcao
  BEFORE UPDATE OF peso_corrigido_g, conta_escolhida_id, servico_escolhido ON expedicao
  FOR EACH ROW EXECUTE FUNCTION expedicao_correcao();

REVOKE ALL ON FUNCTION expedicao_correcao() FROM PUBLIC;
