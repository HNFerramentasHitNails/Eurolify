-- As vendas do dia e do mês (docs/35; peça 22 da Fase 1; decisão DY; Diogo,
-- 12/10/2026: «aprovado»; issue #367). Ex.: o dono pede as vendas de ontem e
-- recebe o encomendado, o pago, o faturado e o devolvido, com e sem IVA, por
-- canal e mercado.
--
-- O que esta migração faz:
-- - o âmbito novo `sales:read`, no dono e no gestor (Q1);
-- - os índices por comerciante e instante que a consulta usa (§7): sem eles,
--   cada pedido lia as tabelas inteiras do comerciante. Medir antes de
--   pré-calcular: não há tabela de totais.

SET LOCAL lock_timeout = '10s';

-- ------------------------------------------------- O âmbito sales:read

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
    'tasks:assign', 'sales:read', 'keys:write', 'storefront'
  ]::text[]);

CREATE OR REPLACE FUNCTION papel_ambitos(p_papel text) RETURNS text[]
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  -- Por ordem alfabética, como em src/identidade/papeis.ts. Como a 0066, mais
  -- o sales:read no dono e no gestor (docs/35 §5 e Q1; decisão DY).
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
                  'refunds:write', 'returns:read', 'returns:write', 'sales:read', 'shipping:read',
                  'shipping:write', 'tasks:assign', 'tax:read', 'tax:write']
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

-- ------------------------------------------------------------ Os índices

CREATE INDEX encomenda_por_criacao ON encomenda (comerciante_id, criada_em);
CREATE INDEX transicao_pagamento_capturas ON transicao_pagamento (comerciante_id, em)
  WHERE para = 'capturado';
CREATE INDEX documento_rasto_emissoes ON documento_rasto (comerciante_id, em)
  WHERE passo = 'estado' AND para = 'emitido';
CREATE INDEX reembolso_por_execucao ON reembolso (comerciante_id, executado_em)
  WHERE estado = 'executado';
