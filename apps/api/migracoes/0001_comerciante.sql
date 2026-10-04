-- Domínio Comerciante, fatia 2 (docs/15-dominio-comerciante.md).
-- Isolamento por comerciante imposto pela base: RLS forçado em todas as
-- tabelas, para o utilizador da API, que não ignora o RLS.

-- O utilizador da API nasce sem acesso à rede da base (NOLOGIN) e sem
-- palavra-passe: quem a dá é a configuração de cada ambiente (VPS, CI),
-- nunca uma migração (segredos fora do repositório).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'eurolify_api') THEN
    CREATE ROLE eurolify_api NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END
$$;

-- O comerciante do pedido, posto com SET LOCAL eurolify.comerciante.
-- Sem ele dá erro, nunca vazio: numa ligação nova o parâmetro não existe;
-- numa ligação reaproveitada vale '' e falha a conversão para uuid.
CREATE FUNCTION comerciante_actual() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT current_setting('eurolify.comerciante')::uuid $$;

CREATE TABLE comerciante (
  id uuid PRIMARY KEY,
  estado text NOT NULL DEFAULT 'rascunho' CHECK (estado IN (
    'rascunho', 'prova_pendente', 'em_revisao', 'aprovado_limitado',
    'activo', 'suspenso', 'fechado')),
  -- Para onde volta um comerciante suspenso.
  estado_antes_de_suspenso text CHECK (estado_antes_de_suspenso IN (
    'rascunho', 'prova_pendente', 'em_revisao', 'aprovado_limitado', 'activo')),
  nome text NOT NULL CHECK (length(btrim(nome)) > 0),
  lingua text NOT NULL CHECK (lingua ~ '^[a-z]{2}$'),
  -- Um fuso que o PostgreSQL não conhece faz falhar a conversão.
  fuso text NOT NULL CHECK ((timestamptz '2000-01-01 00:00:00+00' AT TIME ZONE fuso) IS NOT NULL),
  criado_em timestamptz NOT NULL DEFAULT now(),
  actualizado_em timestamptz NOT NULL DEFAULT now(),
  versao integer NOT NULL DEFAULT 1 CHECK (versao >= 1)
);

CREATE TABLE entidade_legal (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  denominacao text NOT NULL CHECK (length(btrim(denominacao)) > 0),
  forma_juridica text NOT NULL CHECK (length(btrim(forma_juridica)) > 0),
  pais text NOT NULL CHECK (pais IN (
    'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR',
    'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK',
    'SI', 'ES', 'SE')),
  -- Sem o prefixo do país; o formato de cada país ainda não está validado (C).
  numero_fiscal text NOT NULL CHECK (numero_fiscal ~ '^[A-Z0-9]{2,20}$'),
  morada_linha text NOT NULL CHECK (length(btrim(morada_linha)) > 0),
  morada_codigo_postal text NOT NULL CHECK (length(btrim(morada_codigo_postal)) > 0),
  morada_localidade text NOT NULL CHECK (length(btrim(morada_localidade)) > 0),
  estado text NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa', 'arquivada')),
  criado_em timestamptz NOT NULL DEFAULT now(),
  -- Único por país dentro do comerciante; nunca entre comerciantes.
  UNIQUE (comerciante_id, pais, numero_fiscal),
  UNIQUE (comerciante_id, id)
);

CREATE TABLE loja (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  entidade_legal_id uuid NOT NULL,
  nome text NOT NULL CHECK (length(btrim(nome)) > 0),
  lingua_origem text NOT NULL CHECK (lingua_origem ~ '^[a-z]{2}$'),
  estado text NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa', 'arquivada')),
  criado_em timestamptz NOT NULL DEFAULT now(),
  -- A entidade que vende tem de ser do mesmo comerciante.
  FOREIGN KEY (comerciante_id, entidade_legal_id)
    REFERENCES entidade_legal (comerciante_id, id)
);

-- Só se acrescenta: retirar ou mudar é uma linha nova.
CREATE TABLE aceitacao_contrato (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  tipo text NOT NULL CHECK (tipo IN ('contrato_servico', 'acordo_tratamento_dados')),
  versao_texto text NOT NULL CHECK (length(btrim(versao_texto)) > 0),
  aceite_por text NOT NULL CHECK (length(btrim(aceite_por)) > 0),
  aceite_em timestamptz NOT NULL DEFAULT now()
);

-- Só se acrescenta: uma prova nova substitui a anterior.
CREATE TABLE prova_verificacao (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  entidade_legal_id uuid NOT NULL,
  finalidade text NOT NULL CHECK (finalidade IN (
    'identificacao_fiscal', 'contrato', 'prestador_pagamento')),
  origem text NOT NULL CHECK (origem IN ('manual', 'vies', 'documento')),
  -- Quem verificou à mão, ou a resposta do VIES; nunca o documento inteiro.
  origem_detalhe text NOT NULL CHECK (length(btrim(origem_detalhe)) > 0),
  resultado text NOT NULL CHECK (resultado IN ('aceite', 'recusada', 'por_rever')),
  verificado_em timestamptz NOT NULL DEFAULT now(),
  rever_ate timestamptz,
  documento text,
  CHECK (rever_ate IS NULL OR rever_ate > verificado_em),
  FOREIGN KEY (comerciante_id, entidade_legal_id)
    REFERENCES entidade_legal (comerciante_id, id)
);

-- Só se acrescenta: cada mudança de estado, com motivo e quem.
CREATE TABLE transicao_estado (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  de text NOT NULL,
  para text NOT NULL,
  motivo text NOT NULL CHECK (length(btrim(motivo)) > 0),
  quem text NOT NULL CHECK (length(btrim(quem)) > 0),
  quando timestamptz NOT NULL DEFAULT now(),
  -- A transacção que a escreveu: prova que a mudança e o rasto foram juntos.
  transacao xid8 NOT NULL DEFAULT pg_current_xact_id()
);

-- Um comerciante nasce em rascunho; o id não muda; versão e data sobem.
CREATE FUNCTION comerciante_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.estado <> 'rascunho' OR NEW.estado_antes_de_suspenso IS NOT NULL THEN
      RAISE EXCEPTION 'merchant.invalid_transition: um comerciante nasce em rascunho';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id THEN
    RAISE EXCEPTION 'merchant.immutable_id: o id de um comerciante não muda';
  END IF;
  NEW.versao := OLD.versao + 1;
  NEW.actualizado_em := now();

  IF NEW.estado IS DISTINCT FROM OLD.estado THEN
    IF OLD.estado = 'fechado' THEN
      RAISE EXCEPTION 'merchant.invalid_transition: % → %', OLD.estado, NEW.estado;
    ELSIF NEW.estado = 'fechado' THEN
      NEW.estado_antes_de_suspenso := NULL;
    ELSIF NEW.estado = 'suspenso' THEN
      NEW.estado_antes_de_suspenso := OLD.estado;
    ELSIF OLD.estado = 'suspenso' THEN
      IF NEW.estado IS DISTINCT FROM OLD.estado_antes_de_suspenso THEN
        RAISE EXCEPTION 'merchant.invalid_transition: suspenso volta só a %', OLD.estado_antes_de_suspenso;
      END IF;
      NEW.estado_antes_de_suspenso := NULL;
    ELSIF NOT (
      (OLD.estado = 'rascunho' AND NEW.estado IN ('prova_pendente', 'em_revisao')) OR
      (OLD.estado = 'prova_pendente' AND NEW.estado = 'em_revisao') OR
      (OLD.estado = 'em_revisao' AND NEW.estado IN ('prova_pendente', 'aprovado_limitado')) OR
      (OLD.estado = 'aprovado_limitado' AND NEW.estado = 'activo')
    ) THEN
      RAISE EXCEPTION 'merchant.invalid_transition: % → %', OLD.estado, NEW.estado;
    END IF;

    -- Activar exige os dois contratos aceites e o número fiscal provado
    -- (decisão P3 do Diogo, 04/10/2026). Voltar de suspenso a activo também.
    IF NEW.estado = 'activo' THEN
      IF (SELECT count(DISTINCT tipo) FROM aceitacao_contrato
          WHERE comerciante_id = NEW.id) < 2 THEN
        RAISE EXCEPTION 'merchant.activation_blocked: faltam contratos aceites';
      END IF;
      IF NOT EXISTS (
        SELECT FROM prova_verificacao p
        JOIN entidade_legal e
          ON e.comerciante_id = p.comerciante_id AND e.id = p.entidade_legal_id
        WHERE p.comerciante_id = NEW.id
          AND e.estado = 'activa'
          AND p.finalidade = 'identificacao_fiscal'
          AND p.resultado = 'aceite'
          AND (p.rever_ate IS NULL OR p.rever_ate > now())
      ) THEN
        RAISE EXCEPTION 'merchant.activation_blocked: falta a prova do número fiscal';
      END IF;
    END IF;
  ELSIF NEW.estado_antes_de_suspenso IS DISTINCT FROM OLD.estado_antes_de_suspenso THEN
    RAISE EXCEPTION 'merchant.invalid_transition: estado_antes_de_suspenso só muda com o estado';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER comerciante_antes_de_gravar
  BEFORE INSERT OR UPDATE ON comerciante
  FOR EACH ROW EXECUTE FUNCTION comerciante_antes_de_gravar();

-- No fim da transacção: uma mudança de estado sem a linha de rasto da mesma
-- transacção é desfeita (nada muda de estado sem motivo e sem quem).
CREATE FUNCTION comerciante_estado_tem_rasto() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.estado IS DISTINCT FROM OLD.estado AND NOT EXISTS (
    SELECT FROM transicao_estado t
    WHERE t.comerciante_id = NEW.id
      AND t.de = OLD.estado
      AND t.para = NEW.estado
      AND t.transacao = pg_current_xact_id()
  ) THEN
    RAISE EXCEPTION 'merchant.transition_without_trail: % → % sem linha em transicao_estado', OLD.estado, NEW.estado;
  END IF;
  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER comerciante_estado_tem_rasto
  AFTER UPDATE OF estado ON comerciante
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION comerciante_estado_tem_rasto();

-- RLS forçado: nem o dono das tabelas o ignora (só um superutilizador).
ALTER TABLE comerciante ENABLE ROW LEVEL SECURITY;
ALTER TABLE comerciante FORCE ROW LEVEL SECURITY;
CREATE POLICY so_o_proprio ON comerciante
  USING (id = comerciante_actual())
  WITH CHECK (id = comerciante_actual());

DO $$
DECLARE
  tabela text;
BEGIN
  FOREACH tabela IN ARRAY ARRAY[
    'entidade_legal', 'loja', 'aceitacao_contrato', 'prova_verificacao',
    'transicao_estado']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tabela);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tabela);
    EXECUTE format(
      'CREATE POLICY so_o_proprio ON %I USING (comerciante_id = comerciante_actual()) WITH CHECK (comerciante_id = comerciante_actual())',
      tabela);
  END LOOP;
END
$$;

-- O que a API pode fazer. Sem DELETE em nenhuma; nas que só se acrescentam,
-- nem UPDATE.
GRANT USAGE ON SCHEMA public TO eurolify_api;
GRANT SELECT, INSERT, UPDATE ON comerciante, entidade_legal, loja TO eurolify_api;
GRANT SELECT, INSERT ON aceitacao_contrato, prova_verificacao, transicao_estado TO eurolify_api;
