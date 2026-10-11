-- O rasto de auditoria comum, passo 4, parte 3 (docs/28 §3.8; decisão DO;
-- Diogo, 11/10/2026, Q7; issue #322): o âmbito `prices:history`. Ex.: com
-- `prices:read`, o histórico do preço de Verniz Gel Vermelho diz «12,90 € →
-- 9,90 €, agente, sem autorização de uma pessoa»; só com `prices:history`
-- diz também qual chave mudou e quem autorizou.
--
-- O que esta migração faz:
-- - acrescenta `prices:history` à lista dos âmbitos de uma chave;
-- - dá-o ao dono e ao gestor (`papel_ambitos`), os papéis do
--   `catalog:history`; o armazém e o apoio continuam só com `prices:read`.
--
-- Não faz: dar o âmbito às chaves que já existem (as chaves não mudam,
-- 0010). Uma chave com ele cria-se pelo Hub (o dono, pelo `papel_ambitos`)
-- ou pelo comando do operador; pela API não, porque nenhuma chave antiga o
-- tem e uma chave não cria outra com âmbitos que não tem (T9). Sozinho, sem
-- `prices:read`, não abre nenhuma rota (revisão do #349, P3-3 e P3-7).

SET LOCAL lock_timeout = '10s';

ALTER TABLE chave_api DROP CONSTRAINT chave_api_ambitos_validos;
ALTER TABLE chave_api ADD CONSTRAINT chave_api_ambitos_validos CHECK (
  cardinality(ambitos) BETWEEN 1 AND 60
  AND ambitos <@ ARRAY[
    'merchant:read', 'merchant:write',
    'catalog:read', 'catalog:write', 'catalog:publish', 'catalog:import',
    'catalog:history', 'prices:read', 'prices:write', 'prices:history',
    'customers:read', 'customers:write', 'customers:billing',
    'customers:exemptions', 'customers:merge', 'customers:privacy', 'tax:read', 'tax:write',
    'legal:read', 'legal:write', 'shipping:read', 'shipping:write', 'orders:read',
    'payments:read', 'payments:write', 'payments:accounts', 'payments:resolve',
    'inventory:read', 'inventory:write', 'inventory:policy', 'fulfilment:read',
    'fulfilment:write', 'invoices:read', 'invoices:write', 'invoices:accounts',
    'returns:read', 'returns:write', 'refunds:read', 'refunds:write',
    'keys:write', 'storefront'
  ]::text[]);

CREATE OR REPLACE FUNCTION papel_ambitos(p_papel text) RETURNS text[]
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  -- Por ordem alfabética, como em src/identidade/papeis.ts. Como a 0058, mais
  -- o prices:history no dono e no gestor (os papéis do catalog:history;
  -- Diogo, 11/10/2026, Q7 do docs/28).
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
                  'refunds:write', 'returns:read', 'returns:write', 'shipping:read',
                  'shipping:write', 'tax:read', 'tax:write']
    WHEN 'gestor' THEN ARRAY['catalog:history', 'catalog:import', 'catalog:publish',
                  'catalog:read', 'catalog:write', 'customers:merge', 'customers:read',
                  'customers:write', 'fulfilment:read', 'fulfilment:write',
                  'inventory:policy', 'inventory:read', 'inventory:write',
                  'invoices:read', 'invoices:write', 'legal:read', 'merchant:read',
                  'orders:read', 'payments:read', 'payments:write', 'prices:history', 'prices:read',
                  'prices:write', 'refunds:read', 'refunds:write', 'returns:read',
                  'returns:write', 'shipping:read', 'shipping:write', 'tax:read']
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
