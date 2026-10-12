-- Documentos fiscais, parte 2: o adaptador Moloni (docs/29 §13; docs/06, DZ;
-- issue #310).
--
-- - `config` na ligação: os valores por omissão do comerciante no emissor
--   (língua, prazo de vencimento, métodos de pagamento, artigo dos portes,
--   categoria e unidade dos artigos que o Eurolify cria, o cliente
--   «Consumidor final») — §13.2, M2, M3;
-- - `sessao` na ligação: os tokens que o emissor renova sozinho (o Moloni
--   devolve um par novo a cada renovação, §13.4). Ficam cifrados como as
--   credenciais, mas **renovar não é mudar a ligação**: não a põe por testar
--   nem mexe na versão (R15);
-- - a lista dos comerciantes com ligações a renovar, para a tarefa diária.

SET LOCAL lock_timeout = '10s';

ALTER TABLE ligacao_faturacao
  ADD COLUMN config jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(config) = 'object'),
  ADD COLUMN sessao bytea,
  ADD COLUMN sessao_versao_chave text,
  ADD COLUMN sessao_em timestamptz,
  ADD CONSTRAINT ligacao_faturacao_sessao_cifrada
    CHECK ((sessao IS NULL) = (sessao_versao_chave IS NULL));

-- A mesma regra de 0050, com a configuração: mudá-la com documentos a meio é
-- recusado e obriga a testar outra vez, como a série e os mapas. A sessão
-- fica de fora de propósito (renovar tokens não muda a ligação).
CREATE OR REPLACE FUNCTION ligacao_faturacao_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'invoices.immutable: uma ligação não se apaga; desliga-se';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.taxas) t
       WHERE jsonb_typeof(t) <> 'object' OR t->>'pais' !~ '^[A-Z]{2}$'
         OR jsonb_typeof(t->'taxa') <> 'number' OR (t->>'taxa')::numeric < 0
         OR coalesce(t->>'emissor', '') !~ '^[A-Za-z0-9._:-]{1,60}$')
     OR (SELECT count(*) FROM jsonb_array_elements(NEW.taxas))
       <> (SELECT count(DISTINCT (t->>'pais', t->>'taxa')) FROM jsonb_array_elements(NEW.taxas) t)
     OR (SELECT count(*) FROM jsonb_array_elements(NEW.taxas))
       <> (SELECT count(DISTINCT t->>'emissor') FROM jsonb_array_elements(NEW.taxas) t) THEN
    RAISE EXCEPTION 'invoices.invalid_field: as taxas são pares (país, taxa) únicos, cada um com a sua taxa do emissor';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.isencoes) t
       WHERE jsonb_typeof(t) <> 'object' OR t->>'codigo' !~ '^[A-Z0-9]{1,10}$'
         OR coalesce(t->>'emissor', '') !~ '^[A-Za-z0-9._:-]{1,60}$')
     OR (SELECT count(*) FROM jsonb_array_elements(NEW.isencoes))
       <> (SELECT count(DISTINCT t->>'codigo') FROM jsonb_array_elements(NEW.isencoes) t)
     OR (SELECT count(*) FROM jsonb_array_elements(NEW.isencoes))
       <> (SELECT count(DISTINCT t->>'emissor') FROM jsonb_array_elements(NEW.isencoes) t) THEN
    RAISE EXCEPTION 'invoices.invalid_field: as isenções são códigos únicos, cada um com a sua isenção do emissor';
  END IF;
  -- A configuração só guarda identificadores do emissor (nunca um nome,
  -- AGENTS.md, «Não se erra…», regra 6): texto curto sem espaços, ou o mapa
  -- dos métodos de pagamento com valores iguais.
  IF EXISTS (SELECT 1 FROM jsonb_each(NEW.config) k
       WHERE k.key !~ '^[a-z_]{1,40}$'
         OR (k.key = 'metodos_pagamento' AND (jsonb_typeof(k.value) <> 'object'
               OR EXISTS (SELECT 1 FROM jsonb_each_text(k.value) m
                          WHERE m.key !~ '^[a-z0-9_]{1,40}$' OR m.value !~ '^[A-Za-z0-9._:-]{1,60}$')))
         OR (k.key <> 'metodos_pagamento' AND (jsonb_typeof(k.value) <> 'string'
               OR k.value #>> '{}' !~ '^[A-Za-z0-9._:-]{1,60}$'))) THEN
    RAISE EXCEPTION 'invoices.invalid_field: a configuração guarda identificadores do emissor';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.entidade_legal_id <> OLD.entidade_legal_id OR NEW.adaptador <> OLD.adaptador
       OR NEW.modo <> OLD.modo OR NEW.criada_por <> OLD.criada_por THEN
      RAISE EXCEPTION 'invoices.immutable: a entidade, o adaptador e o modo de uma ligação não mudam';
    END IF;
    -- Com documentos a meio no emissor, a ligação não muda (R15). As
    -- credenciais e a sessão podem trocar-se (revisão do #312, P2-11).
    IF (NEW.serie IS DISTINCT FROM OLD.serie
        OR NEW.taxas <> OLD.taxas OR NEW.isencoes <> OLD.isencoes OR NEW.config <> OLD.config
        OR NEW.activa <> OLD.activa)
       AND EXISTS (SELECT 1 FROM public.documento_fiscal d
         WHERE d.ligacao_id = NEW.id AND d.estado IN ('rascunho', 'incerto')) THEN
      RAISE EXCEPTION 'invoices.issuer_busy: há documentos a meio no emissor desta ligação';
    END IF;
    -- Mudar as credenciais, a série, os mapas ou a configuração obriga a
    -- testar outra vez; renovar a sessão não.
    IF NEW.credenciais IS DISTINCT FROM OLD.credenciais OR NEW.serie IS DISTINCT FROM OLD.serie
       OR NEW.taxas <> OLD.taxas OR NEW.isencoes <> OLD.isencoes OR NEW.config <> OLD.config THEN
      IF NEW.estado = 'pronta' AND OLD.estado = 'pronta' THEN
        NEW.estado := 'por_testar';
      END IF;
    END IF;
    -- Credenciais novas apagam a sessão da anterior (outra conta, outros
    -- tokens).
    IF NEW.credenciais IS DISTINCT FROM OLD.credenciais THEN
      NEW.sessao := NULL;
      NEW.sessao_versao_chave := NULL;
      NEW.sessao_em := NULL;
    END IF;
    NEW.criada_em := OLD.criada_em;
    -- Renovar a sessão não conta como alteração da ligação.
    IF NOT (NEW.sessao IS DISTINCT FROM OLD.sessao
            AND ROW(NEW.estado, NEW.activa, NEW.credenciais, NEW.serie, NEW.taxas, NEW.isencoes,
                    NEW.config, NEW.testada_em, NEW.erro, NEW.versao)
                IS NOT DISTINCT FROM
                ROW(OLD.estado, OLD.activa, OLD.credenciais, OLD.serie, OLD.taxas, OLD.isencoes,
                    OLD.config, OLD.testada_em, OLD.erro, OLD.versao)) THEN
      NEW.actualizada_em := now();
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- Os comerciantes com uma ligação Moloni activa e credenciais: a tarefa
-- diária renova-lhes os tokens antes dos 14 dias (§13.4).
CREATE FUNCTION ligacoes_comerciantes_a_renovar() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT DISTINCT l.comerciante_id FROM public.ligacao_faturacao l
  WHERE l.adaptador = 'moloni' AND l.activa AND l.credenciais IS NOT NULL
$$;

REVOKE EXECUTE ON FUNCTION ligacoes_comerciantes_a_renovar() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ligacoes_comerciantes_a_renovar() TO eurolify_api;

GRANT INSERT (config) ON ligacao_faturacao TO eurolify_api;
GRANT UPDATE (config, sessao, sessao_versao_chave, sessao_em) ON ligacao_faturacao TO eurolify_api;
