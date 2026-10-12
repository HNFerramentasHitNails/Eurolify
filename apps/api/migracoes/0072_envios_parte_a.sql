-- Envios, parte A (docs/36; docs/06, ED; issue #393; Diogo, 12/10/2026:
-- «sim, aprovo; avança com a parte A»): as contas do comerciante numa
-- transportadora (só em modo teste) e o que o método de entrega passa a
-- dizer — a conta e o serviço que a etiqueta vai usar, a data-limite que o
-- comerciante se compromete a cumprir, os códigos postais que serve, os
-- números ONU que aceita e o peso máximo. As etiquetas e o seguimento são a
-- parte B.
SET LOCAL lock_timeout = '10s';

-- ------------------------------------------------- Conta de transportadora

CREATE TABLE conta_transportadora (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  -- A lista fechada dos adaptadores (third-party-extensions, 1); o
  -- agregador entra com a parte C (Q2).
  transportadora text NOT NULL CHECK (transportadora IN ('ctt')),
  nome text NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 100),
  -- Só teste: nenhum envio real sai do ensaio (ADR-0019), como nos
  -- pagamentos (0044). Abrir o modo real é uma migração com decisão escrita.
  modo text NOT NULL DEFAULT 'teste' CHECK (modo = 'teste'),
  -- As credenciais e o segredo dos avisos, cifrados com AES-256-GCM pela API
  -- (a chave fica fora da base, ENVIOS_CHAVE); nunca saem pela API.
  credenciais_cifra bytea,
  segredo_aviso_cifra bytea,
  chave_versao text CHECK (chave_versao IS NULL OR chave_versao ~ '^[0-9A-Za-z_-]{1,20}$'),
  credenciais_em timestamptz,
  credenciais_por text,
  testada_em timestamptz,
  -- A morada de recolha e o contacto que vão na etiqueta (normalmente os do
  -- armazém); o adaptador valida-os na parte B.
  remetente jsonb NOT NULL CHECK (jsonb_typeof(remetente) = 'object' AND remetente <> '{}'),
  estado text NOT NULL DEFAULT 'rascunho' CHECK (estado IN ('rascunho', 'pronta', 'arquivada')),
  criado_em timestamptz NOT NULL DEFAULT now(),
  actualizado_em timestamptz NOT NULL DEFAULT now(),
  versao integer NOT NULL DEFAULT 1,
  UNIQUE (comerciante_id, id),
  CHECK ((credenciais_cifra IS NULL) = (chave_versao IS NULL)),
  CHECK (segredo_aviso_cifra IS NULL OR credenciais_cifra IS NOT NULL),
  -- Pronta só com as credenciais e a chamada de teste.
  CHECK (estado <> 'pronta' OR (credenciais_cifra IS NOT NULL AND testada_em IS NOT NULL))
);

-- ----------------------------------------- Método de entrega: o que muda

-- A chave estrangeira nova valida-se lendo as linhas existentes: o dono das
-- tabelas não passa pelo RLS forçado durante a validação (como a 0044).
ALTER TABLE metodo_entrega NO FORCE ROW LEVEL SECURITY;
ALTER TABLE metodo_entrega
  ADD COLUMN conta_transportadora_id uuid,
  ADD COLUMN servico text CHECK (servico IS NULL OR servico ~ '^[0-9A-Za-z_.-]{1,50}$'),
  -- A data-limite (docs/36 L1, L4): dias a contar do dia seguinte ao botão
  -- final, no máximo 30 (o acordo com o consumidor para mais não existe).
  ADD COLUMN prazo_max_dias integer NOT NULL DEFAULT 30 CHECK (prazo_max_dias BETWEEN 1 AND 30),
  -- Os códigos postais servidos, por prefixo, sem espaços nem hífenes (L3);
  -- vazio = os países todos do mercado. Desvio do docs/36 §3.2: prefixos e
  -- não regiões com nome, porque os intervalos dos códigos postais das ilhas
  -- não estão verificados (o Motor de IVA tem «9» como C, 0040).
  ADD COLUMN codigos_postais text[] NOT NULL DEFAULT '{}' CHECK (
    cardinality(codigos_postais) <= 200
    AND (cardinality(codigos_postais) = 0
      OR array_to_string(codigos_postais, ',') ~ '^[0-9A-Z]{1,10}(,[0-9A-Z]{1,10})*$')),
  -- Os números ONU aceites (L9): vazio por omissão, nenhum perigoso.
  ADD COLUMN aceita_onu text[] NOT NULL DEFAULT '{}' CHECK (
    cardinality(aceita_onu) <= 200
    AND (cardinality(aceita_onu) = 0
      OR array_to_string(aceita_onu, ',') ~ '^UN[0-9]{4}(,UN[0-9]{4})*$')),
  ADD COLUMN peso_max_g integer CHECK (peso_max_g IS NULL OR peso_max_g BETWEEN 1 AND 1000000),
  -- Com conta, com serviço; sem conta, «manual» (a pessoa escreve a
  -- transportadora na expedição, como na 0047).
  ADD CONSTRAINT metodo_entrega_conta_e_servico CHECK (
    (conta_transportadora_id IS NULL) = (servico IS NULL)),
  ADD CONSTRAINT metodo_entrega_conta_fk FOREIGN KEY (comerciante_id, conta_transportadora_id)
    REFERENCES conta_transportadora (comerciante_id, id);
ALTER TABLE metodo_entrega FORCE ROW LEVEL SECURITY;

-- --------------------------------------------- O âmbito shipping:accounts

-- Só o dono liga ou muda uma conta de transportadora (docs/36 §3.1), como
-- o payments:accounts nas contas de pagamento (docs/26, Q3).
ALTER TABLE chave_api DROP CONSTRAINT chave_api_ambitos_validos;
ALTER TABLE chave_api ADD CONSTRAINT chave_api_ambitos_validos CHECK (
  cardinality(ambitos) BETWEEN 1 AND 60
  AND ambitos <@ ARRAY[
    'merchant:read', 'merchant:write',
    'catalog:read', 'catalog:write', 'catalog:publish', 'catalog:import',
    'catalog:history', 'prices:read', 'prices:write', 'prices:history',
    'customers:read', 'customers:write', 'customers:billing',
    'customers:exemptions', 'customers:merge', 'customers:privacy', 'tax:read', 'tax:write',
    'legal:read', 'legal:write', 'shipping:read', 'shipping:write', 'shipping:accounts',
    'orders:read',
    'payments:read', 'payments:write', 'payments:accounts', 'payments:resolve',
    'inventory:read', 'inventory:write', 'inventory:policy', 'fulfilment:read',
    'fulfilment:write', 'invoices:read', 'invoices:write', 'invoices:accounts',
    'returns:read', 'returns:write', 'refunds:read', 'refunds:write',
    'tasks:assign', 'sales:read', 'keys:write', 'storefront'
  ]::text[]);

CREATE OR REPLACE FUNCTION papel_ambitos(p_papel text) RETURNS text[]
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  -- Por ordem alfabética, como em src/identidade/papeis.ts. Como a 0068, mais
  -- o shipping:accounts no dono (docs/36 §3.1; decisão ED).
  SELECT CASE p_papel
    WHEN 'dono' THEN ARRAY['catalog:history', 'catalog:import', 'catalog:publish',
                  'catalog:read', 'catalog:write', 'customers:billing',
                  'customers:exemptions', 'customers:merge', 'customers:privacy',
                  'customers:read', 'customers:write', 'fulfilment:read', 'fulfilment:write',
                  'inventory:policy', 'inventory:read', 'inventory:write',
                  'invoices:accounts', 'invoices:read', 'invoices:write',
                  'keys:write', 'legal:read', 'legal:write',
                  'merchant:read', 'merchant:write', 'orders:read',
                  'payments:accounts', 'payments:read', 'payments:resolve',
                  'payments:write', 'prices:history', 'prices:read', 'prices:write', 'refunds:read',
                  'refunds:write', 'returns:read', 'returns:write', 'sales:read',
                  'shipping:accounts', 'shipping:read', 'shipping:write', 'tasks:assign',
                  'tax:read', 'tax:write']
    WHEN 'gestor' THEN ARRAY['catalog:history', 'catalog:import', 'catalog:publish',
                  'catalog:read', 'catalog:write', 'customers:merge', 'customers:read',
                  'customers:write', 'fulfilment:read', 'fulfilment:write',
                  'inventory:policy', 'inventory:read', 'inventory:write',
                  'invoices:read', 'invoices:write', 'legal:read', 'merchant:read',
                  'orders:read', 'payments:read', 'payments:write', 'prices:history', 'prices:read',
                  'prices:write', 'refunds:read', 'refunds:write', 'returns:read',
                  'returns:write', 'sales:read', 'shipping:read', 'shipping:write', 'tasks:assign',
                  'tax:read']
    WHEN 'armazem' THEN ARRAY['catalog:read', 'fulfilment:read', 'fulfilment:write',
                  'inventory:read', 'inventory:write', 'prices:read', 'returns:read',
                  'returns:write', 'shipping:read']
    WHEN 'apoio' THEN ARRAY['catalog:read', 'customers:read', 'customers:write',
                  'fulfilment:read', 'inventory:read', 'invoices:read', 'legal:read',
                  'merchant:read', 'orders:read', 'payments:read', 'prices:read',
                  'refunds:read', 'returns:read', 'returns:write', 'shipping:read',
                  'tax:read']
  END::text[]
$$;

-- ----------------------------------------------------- RLS e permissões

ALTER TABLE conta_transportadora ENABLE ROW LEVEL SECURITY;
ALTER TABLE conta_transportadora FORCE ROW LEVEL SECURITY;
CREATE POLICY so_o_proprio ON conta_transportadora
  USING (comerciante_id = comerciante_actual())
  WITH CHECK (comerciante_id = comerciante_actual());
REVOKE ALL ON conta_transportadora FROM PUBLIC;

GRANT SELECT ON conta_transportadora TO eurolify_api;
GRANT INSERT (comerciante_id, transportadora, nome, remetente) ON conta_transportadora
  TO eurolify_api;
GRANT UPDATE (nome, remetente, credenciais_cifra, segredo_aviso_cifra, chave_versao,
  credenciais_em, credenciais_por, testada_em, estado, actualizado_em, versao)
  ON conta_transportadora TO eurolify_api;
GRANT INSERT (conta_transportadora_id, servico, prazo_max_dias, codigos_postais, aceita_onu,
  peso_max_g) ON metodo_entrega TO eurolify_api;
GRANT UPDATE (conta_transportadora_id, servico, prazo_max_dias, codigos_postais, aceita_onu,
  peso_max_g) ON metodo_entrega TO eurolify_api;
