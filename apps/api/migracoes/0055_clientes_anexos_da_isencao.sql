-- Clientes: os anexos da isenção manual de IVA (docs/23 §13.5; issue #233).
-- Ex.: a loja põe uma isenção «transportadora própria, declaração aduaneira
-- entregue» e anexa o PDF da declaração; o contabilista lê-o pela API.
--
-- Onde: **na base de dados** (Diogo, 10/10/2026: «A»; docs/06, DM), e não
-- na pasta das imagens: lá há uma limpeza dos ficheiros sem registo, e os
-- anexos são prova. Na base ficam com o RLS de cada comerciante, entram nas
-- cópias que já existem e saem com a pseudonimização.
--
-- As regras (proposta do §13.5): PDF, JPEG ou PNG, até 10 MB cada, até 5 por
-- isenção e até 1 GB por comerciante (como as imagens; revisão do #338,
-- P2-2); só uma pessoa ou a chave dela os põe; só numa isenção em vigor, de
-- um perfil activo numa ficha activa (P2-1);
-- não se alteram nem se apagam (são a prova; o prazo é o fiscal, C, V2),
-- salvo na pseudonimização dos perfis que nenhum documento nem encomenda
-- usou (0049). Os bytes ficam como chegaram: não se limpam metadados, porque
-- é a prova.

SET LOCAL lock_timeout = '10s';

-- A chave composta: o anexo e a isenção são do mesmo comerciante, também
-- sem o gatilho (revisão do #338, P3-1).
ALTER TABLE isencao_manual ADD CONSTRAINT isencao_manual_do_comerciante
  UNIQUE (comerciante_id, id);

CREATE TABLE anexo_isencao (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  isencao_id uuid NOT NULL,
  -- O nome do ficheiro que a loja deu (sem caminho); opcional.
  nome text CHECK (nome IS NULL OR (length(nome) BETWEEN 1 AND 200 AND nome !~ '[/\\[:cntrl:]]')),
  tipo text NOT NULL CHECK (tipo IN ('application/pdf', 'image/jpeg', 'image/png')),
  bytes bytea NOT NULL,
  -- Postos pelo gatilho a partir dos bytes.
  tamanho integer NOT NULL CHECK (tamanho BETWEEN 1 AND 10485760),
  resumo text NOT NULL CHECK (resumo ~ '^[0-9a-f]{64}$'),
  posto_por text NOT NULL,
  posto_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT anexo_isencao_tamanho CHECK (octet_length(bytes) = tamanho),
  -- Os primeiros bytes têm de ser do tipo dito (um .exe com o nome .pdf não
  -- entra).
  CONSTRAINT anexo_isencao_assinatura CHECK (CASE tipo
    WHEN 'application/pdf' THEN substring(bytes FROM 1 FOR 5) = '\x255044462d'::bytea
    WHEN 'image/jpeg' THEN substring(bytes FROM 1 FOR 3) = '\xffd8ff'::bytea
    WHEN 'image/png' THEN substring(bytes FROM 1 FOR 8) = '\x89504e470d0a1a0a'::bytea
  END),
  CONSTRAINT anexo_da_isencao FOREIGN KEY (comerciante_id, isencao_id)
    REFERENCES isencao_manual (comerciante_id, id)
);
-- PDF e JPEG já vêm comprimidos: guardados sem voltar a comprimir (P3-3).
ALTER TABLE anexo_isencao ALTER COLUMN bytes SET STORAGE EXTERNAL;
CREATE INDEX anexo_por_isencao ON anexo_isencao (comerciante_id, isencao_id, id);

-- O limite dos anexos por comerciante, num sítio (proposta, como a quota
-- das imagens, docs/14 §3.5).
CREATE FUNCTION anexos_quota_por_comerciante() RETURNS bigint
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT 1073741824::bigint
$$;

CREATE FUNCTION anexo_isencao_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem text := nullif(btrim(current_setting('eurolify.quem', true)), '');
  isencao record;
  dono record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Só a pseudonimização (0049) os apaga, com a marca dela.
    IF public.clientes_pseudonimizacao_em_curso() THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'audit.append_only: um anexo da isenção não se apaga (é a prova)';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'audit.append_only: um anexo da isenção não se altera';
  END IF;
  -- Como a isenção: só uma pessoa ou a chave dela (lista branca).
  IF quem IS NULL OR quem !~ '^(pessoa:per_|chave:key_)' THEN
    RAISE EXCEPTION 'customers.exemption_by_person: um anexo da isenção só o põe uma pessoa (quem: %)',
      coalesce(quem, 'nenhum');
  END IF;
  -- A isenção tomada: os anexos dela entram um de cada vez, e a contagem é
  -- a certa; uma retirada ao mesmo tempo espera.
  SELECT i.comerciante_id, i.retirada_em, i.perfil_id INTO isencao
  FROM public.isencao_manual i
  WHERE i.comerciante_id = NEW.comerciante_id AND i.id = NEW.isencao_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'customers.not_found: a isenção não existe';
  END IF;
  IF isencao.retirada_em IS NOT NULL THEN
    RAISE EXCEPTION 'customers.exemption_immutable: a isenção foi retirada; não leva anexos novos';
  END IF;
  -- O perfil activo, numa ficha activa: um perfil arquivado ou pseudonimizado
  -- (a isenção dele fica «em vigor», limpa) não recebe dados novos (revisão
  -- do #338, P2-1).
  SELECT p.estado AS perfil, c.estado AS ficha INTO dono
  FROM public.perfil_faturacao p
  JOIN public.cliente c ON c.comerciante_id = p.comerciante_id AND c.id = p.cliente_id
  WHERE p.comerciante_id = NEW.comerciante_id AND p.id = isencao.perfil_id
  FOR SHARE OF p;
  IF dono.perfil IS DISTINCT FROM 'activo' OR dono.ficha IS DISTINCT FROM 'activo' THEN
    RAISE EXCEPTION 'customers.invalid_transition: o perfil ou a ficha da isenção não estão activos';
  END IF;
  IF (SELECT count(*) FROM public.anexo_isencao a
      WHERE a.comerciante_id = NEW.comerciante_id AND a.isencao_id = NEW.isencao_id) >= 5 THEN
    RAISE EXCEPTION 'customers.exemption_attachments_full: uma isenção leva no máximo 5 anexos';
  END IF;
  -- Até 1 GB de anexos por comerciante (como as imagens): os anexos não se
  -- apagam, e uma chave que retirasse e voltasse a pôr isenções enchia o
  -- disco. Os anexos do comerciante entram um de cada vez para a soma.
  PERFORM pg_advisory_xact_lock(hashtextextended('anexo_isencao:' || NEW.comerciante_id::text, 0));
  IF (SELECT coalesce(sum(a.tamanho), 0) FROM public.anexo_isencao a
      WHERE a.comerciante_id = NEW.comerciante_id) + octet_length(NEW.bytes)
     > public.anexos_quota_por_comerciante() THEN
    RAISE EXCEPTION 'customers.exemption_attachments_quota: os anexos do comerciante passavam de % bytes',
      public.anexos_quota_por_comerciante();
  END IF;
  NEW.tamanho := octet_length(NEW.bytes);
  NEW.resumo := encode(sha256(NEW.bytes), 'hex');
  NEW.posto_por := quem;
  NEW.posto_em := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER anexo_isencao_antes_de_gravar
  BEFORE INSERT OR UPDATE OR DELETE ON anexo_isencao
  FOR EACH ROW EXECUTE FUNCTION anexo_isencao_antes_de_gravar();
ALTER TABLE anexo_isencao ENABLE ALWAYS TRIGGER anexo_isencao_antes_de_gravar;
CREATE TRIGGER anexo_isencao_sem_truncate
  BEFORE TRUNCATE ON anexo_isencao
  FOR EACH STATEMENT EXECUTE FUNCTION rasto_so_se_acrescenta();
ALTER TABLE anexo_isencao ENABLE ALWAYS TRIGGER anexo_isencao_sem_truncate;

-- A pseudonimização (0049) limpa a isenção dos perfis que ninguém usou: os
-- anexos dela saem com ela (podem ter o nome e a morada da pessoa).
CREATE FUNCTION isencao_pseudonimizada_sem_anexos() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF public.clientes_pseudonimizacao_em_curso() THEN
    DELETE FROM public.anexo_isencao a
    WHERE a.comerciante_id = NEW.comerciante_id AND a.isencao_id = NEW.id;
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER isencao_pseudonimizada_sem_anexos
  AFTER UPDATE ON isencao_manual
  FOR EACH ROW EXECUTE FUNCTION isencao_pseudonimizada_sem_anexos();
ALTER TABLE isencao_manual ENABLE ALWAYS TRIGGER isencao_pseudonimizada_sem_anexos;

ALTER TABLE anexo_isencao ENABLE ROW LEVEL SECURITY;
ALTER TABLE anexo_isencao FORCE ROW LEVEL SECURITY;
CREATE POLICY so_o_proprio ON anexo_isencao
  USING (comerciante_id = comerciante_actual())
  WITH CHECK (comerciante_id = comerciante_actual());
GRANT SELECT ON anexo_isencao TO eurolify_api;
GRANT INSERT (comerciante_id, isencao_id, nome, tipo, bytes) ON anexo_isencao TO eurolify_api;

-- As funções dos gatilhos não precisam de EXECUTE para quem escreve (só
-- quem cria o gatilho; revisão do #338, P3-2); a da quota corre dentro do
-- gatilho, com quem escreve.
REVOKE EXECUTE ON FUNCTION anexo_isencao_antes_de_gravar(),
  isencao_pseudonimizada_sem_anexos(), anexos_quota_por_comerciante() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION anexos_quota_por_comerciante() TO eurolify_api;
