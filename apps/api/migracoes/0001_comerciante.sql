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
  -- Sem o prefixo do país (o do VIES na Grécia é EL); o formato de cada país
  -- ainda não está validado (C).
  numero_fiscal text NOT NULL CHECK (numero_fiscal ~ '^[A-Z0-9]{2,20}$'),
  morada_linha text NOT NULL CHECK (length(btrim(morada_linha)) > 0),
  morada_codigo_postal text NOT NULL CHECK (length(btrim(morada_codigo_postal)) > 0),
  morada_localidade text NOT NULL CHECK (length(btrim(morada_localidade)) > 0),
  estado text NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa', 'arquivada')),
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT entidade_legal_sem_prefixo_do_pais CHECK (
    left(numero_fiscal, 2) <> pais
    AND NOT (pais = 'GR' AND left(numero_fiscal, 2) = 'EL')),
  -- Único por país dentro do comerciante; nunca entre comerciantes.
  CONSTRAINT entidade_legal_nif_unico_por_pais
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

-- Só se acrescenta: a prova mais recente (pela ordem em que foi registada,
-- que a API não escolhe) é a que vale.
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
  registado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (rever_ate IS NULL OR rever_ate > verificado_em),
  FOREIGN KEY (comerciante_id, entidade_legal_id)
    REFERENCES entidade_legal (comerciante_id, id)
);

-- Só se acrescenta, e só pelo gatilho do comerciante: uma linha por mudança
-- de estado, nem mais nem menos. A API não escreve aqui directamente.
CREATE TABLE transicao_estado (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  de text NOT NULL CHECK (de IN (
    'rascunho', 'prova_pendente', 'em_revisao', 'aprovado_limitado',
    'activo', 'suspenso', 'fechado')),
  para text NOT NULL CHECK (para IN (
    'rascunho', 'prova_pendente', 'em_revisao', 'aprovado_limitado',
    'activo', 'suspenso', 'fechado')),
  motivo text NOT NULL CHECK (length(btrim(motivo)) > 0),
  quem text NOT NULL CHECK (length(btrim(quem)) > 0),
  quando timestamptz NOT NULL DEFAULT now(),
  CHECK (de <> para)
);

-- Um comerciante nasce em rascunho; o id e a data de criação não mudam;
-- versão e data de alteração sobem. As transições e a activação decidem-se
-- aqui (docs/15 §4).
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
  NEW.criado_em := OLD.criado_em;
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

    -- Activar (também ao voltar de suspenso) exige os dois contratos aceites
    -- e, em cada entidade legal activa (pelo menos uma), a prova mais recente
    -- do número fiscal aceite e não caducada (decisão P3 do Diogo,
    -- 04/10/2026). A versão em vigor dos contratos ainda não existe (G11).
    IF NEW.estado = 'activo' THEN
      IF (SELECT count(DISTINCT tipo) FROM aceitacao_contrato
          WHERE comerciante_id = NEW.id) < 2 THEN
        RAISE EXCEPTION 'merchant.activation_blocked: faltam contratos aceites';
      END IF;
      IF NOT EXISTS (
        SELECT FROM entidade_legal e
        WHERE e.comerciante_id = NEW.id AND e.estado = 'activa'
      ) OR EXISTS (
        SELECT FROM entidade_legal e
        WHERE e.comerciante_id = NEW.id AND e.estado = 'activa'
          AND NOT EXISTS (
            SELECT FROM (
              SELECT p.resultado, p.rever_ate
              FROM prova_verificacao p
              WHERE p.comerciante_id = e.comerciante_id
                AND p.entidade_legal_id = e.id
                AND p.finalidade = 'identificacao_fiscal'
              ORDER BY p.registado_em DESC, p.id DESC
              LIMIT 1
            ) ultima
            WHERE ultima.resultado = 'aceite'
              AND (ultima.rever_ate IS NULL OR ultima.rever_ate > now())
          )
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

-- O rasto escreve-o a base, depois de cada mudança de estado, com o motivo e
-- quem postos pela aplicação (SET LOCAL eurolify.motivo / eurolify.quem).
-- Sem eles, a mudança falha. Corre com os direitos do dono das tabelas (a API
-- não tem INSERT em transicao_estado); o RLS forçado aplica-se na mesma.
CREATE FUNCTION comerciante_escrever_rasto() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  motivo text := nullif(btrim(current_setting('eurolify.motivo', true)), '');
  quem text := nullif(btrim(current_setting('eurolify.quem', true)), '');
BEGIN
  IF motivo IS NULL OR quem IS NULL THEN
    RAISE EXCEPTION 'merchant.transition_without_trail: % → % sem motivo ou sem quem', OLD.estado, NEW.estado;
  END IF;
  INSERT INTO transicao_estado (comerciante_id, de, para, motivo, quem)
  VALUES (NEW.id, OLD.estado, NEW.estado, motivo, quem);
  RETURN NULL;
END
$$;

CREATE TRIGGER comerciante_escrever_rasto
  AFTER UPDATE OF estado ON comerciante
  FOR EACH ROW WHEN (NEW.estado IS DISTINCT FROM OLD.estado)
  EXECUTE FUNCTION comerciante_escrever_rasto();

-- Uma entidade com outro número fiscal ou de outro país é outra entidade
-- (nunca decidir identidade pelo nome): arquiva-se e cria-se outra, e as
-- provas da anterior não passam para ela.
CREATE FUNCTION entidade_legal_antes_de_alterar() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.pais IS DISTINCT FROM OLD.pais
     OR NEW.numero_fiscal IS DISTINCT FROM OLD.numero_fiscal
     OR NEW.comerciante_id IS DISTINCT FROM OLD.comerciante_id
     OR NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'legal_entity.immutable_identity: país e número fiscal não mudam; arquivar e criar outra';
  END IF;
  NEW.criado_em := OLD.criado_em;
  RETURN NEW;
END
$$;

CREATE TRIGGER entidade_legal_antes_de_alterar
  BEFORE UPDATE ON entidade_legal
  FOR EACH ROW EXECUTE FUNCTION entidade_legal_antes_de_alterar();

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
-- nem UPDATE; no rasto, só ler; na prova, sem escolher a ordem de registo.
GRANT USAGE ON SCHEMA public TO eurolify_api;
GRANT SELECT, INSERT, UPDATE ON comerciante, entidade_legal, loja TO eurolify_api;
GRANT SELECT, INSERT ON aceitacao_contrato TO eurolify_api;
GRANT SELECT ON prova_verificacao, transicao_estado TO eurolify_api;
GRANT INSERT (comerciante_id, entidade_legal_id, finalidade, origem,
  origem_detalhe, resultado, verificado_em, rever_ate, documento)
  ON prova_verificacao TO eurolify_api;
REVOKE EXECUTE ON FUNCTION comerciante_escrever_rasto() FROM PUBLIC;
