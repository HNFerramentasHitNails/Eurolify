-- Cada recusa da mesma empresa do emissor fica registada (docs/29 §19.7;
-- revisão do #449, P3-1; Diogo, 14/10/2026: «sim, regista cada recusa»;
-- docs/06, EQ). Ex.: o dono da «Loja B» pede para ligar a empresa 401965 do
-- Moloni, que está ligada a outra loja; recebe a recusa, e fica aqui uma
-- linha com a ligação dele, a empresa pedida, o passo, quem e quando.
--
-- Serve ao apoio do Eurolify para ver quem anda a experimentar empresas que
-- não são suas: a recusa diz que a empresa existe noutra ligação, nunca em
-- qual. Por isso a linha não guarda a outra ligação nem o outro
-- comerciante: o RLS dá a cada comerciante as suas recusas, e quem quer
-- cruzar é o apoio, com o papel de dono da base.
--
-- O rasto da tabela é o comum (docs/28 §3.1; `rasto_completar()`, 0053): só
-- se acrescenta e não se apaga até o jurista decidir quanto tempo se guarda
-- (docs/28, Q4). A API escreve-a numa transacção própria, depois da que foi
-- recusada, que volta atrás.
SET LOCAL lock_timeout = '10s';

CREATE TABLE recusa_conta_emissor (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  ligacao_id uuid NOT NULL,
  adaptador text NOT NULL CHECK (adaptador ~ '^[a-z_]{2,40}$'),
  -- O mesmo formato da `conta_emissor` (0095).
  conta text NOT NULL CHECK (conta ~ '^[A-Za-z0-9._:-]{1,64}$'),
  -- Onde a recusa saiu: ao pedir a autorização, ao gravar as credenciais
  -- pela API, ao voltar do emissor com a autorização, ou no teste.
  passo text NOT NULL CHECK (passo IN ('autorizar', 'credenciais', 'autorizacao', 'teste')),
  quem text NOT NULL CHECK (length(btrim(quem)) BETWEEN 1 AND 200),
  em timestamptz NOT NULL DEFAULT clock_timestamp(),
  canal text,
  pedido text,
  ia jsonb,
  autorizado_por text,
  a_pedido_de jsonb,
  motivo text CHECK (motivo IS NULL OR length(motivo) BETWEEN 1 AND 500),
  FOREIGN KEY (comerciante_id, ligacao_id) REFERENCES ligacao_faturacao (comerciante_id, id)
);
CREATE INDEX recusa_conta_emissor_por_conta ON recusa_conta_emissor (adaptador, conta, em);
CREATE INDEX recusa_conta_emissor_por_comerciante ON recusa_conta_emissor (comerciante_id, em);

CREATE TRIGGER rasto_completar BEFORE INSERT ON recusa_conta_emissor
  FOR EACH ROW EXECUTE FUNCTION rasto_completar();
CREATE TRIGGER recusa_conta_emissor_so_se_acrescenta BEFORE UPDATE OR DELETE ON recusa_conta_emissor
  FOR EACH ROW EXECUTE FUNCTION rasto_so_se_acrescenta();
CREATE TRIGGER recusa_conta_emissor_sem_truncate BEFORE TRUNCATE ON recusa_conta_emissor
  FOR EACH STATEMENT EXECUTE FUNCTION rasto_so_se_acrescenta();
-- Só recusam: ficam `ALWAYS`, como as do rasto (regra da 0091).
ALTER TABLE recusa_conta_emissor ENABLE ALWAYS TRIGGER recusa_conta_emissor_so_se_acrescenta;
ALTER TABLE recusa_conta_emissor ENABLE ALWAYS TRIGGER recusa_conta_emissor_sem_truncate;

ALTER TABLE recusa_conta_emissor ENABLE ROW LEVEL SECURITY;
ALTER TABLE recusa_conta_emissor FORCE ROW LEVEL SECURITY;
CREATE POLICY so_o_proprio ON recusa_conta_emissor
  USING (comerciante_id = comerciante_actual())
  WITH CHECK (comerciante_id = comerciante_actual());
REVOKE ALL ON recusa_conta_emissor FROM PUBLIC;
GRANT SELECT ON recusa_conta_emissor TO eurolify_api;
GRANT INSERT (comerciante_id, ligacao_id, adaptador, conta, passo, quem)
  ON recusa_conta_emissor TO eurolify_api;
