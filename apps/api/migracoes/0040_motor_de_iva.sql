-- Motor de IVA, fatia 6 (docs/24; issue #255; Diogo, 09/10/2026: «sim,
-- aprovo; avança com o código da fatia 6», com Q1 a Q5 como propostas). Ex.:
-- um gel a 12,30 € com IVA, vendido por um comerciante português a um
-- consumidor em Lisboa, sai tributado a 23 % (base 10,00 €, IVA 2,30 €); a uma
-- empresa francesa com VIES válido, isento (M16) a 10,00 € (Q1); para Las
-- Palmas (35xxx), exportação (M05).
--
-- O que esta migração faz (as tabelas globais, iguais para todos os
-- comerciantes, só se lêem pela API; escrevem-nas as migrações):
-- - `categoria_fiscal` (docs/24 §3.1): só `normal` na Fase 1;
-- - `taxa_iva` (§3.3): uma linha por país, região, categoria e início, com a
--   fonte; só se acrescenta (uma taxa nova é uma linha nova). Entram só as de
--   Portugal medidas nos sistemas actuais (M); as dos outros 26 países entram
--   noutro pedido, da base de dados de taxas da Comissão (TEDB) e com o
--   contabilista — até lá, uma venda que precise delas fica bloqueada;
-- - `territorio_fiscal` (§3.4): pelo prefixo do código postal da entrega;
--   Canárias, Ceuta e Melilla fora do IVA da UE (M); as ilhas portuguesas
--   (Q3) e os territórios C por validar (não se vende);
-- - `motivo_iva` (§3.6): os códigos da AT dos sistemas actuais (C);
-- - `declaracao_regime` (§3.5): o regime das vendas à distância de cada
--   entidade legal, declarado pelo dono; só se acrescenta (a última vale);
--   sem nenhuma, `por_declarar` (Q2);
-- - o código do motivo na isenção manual (Q4);
-- - o fim da rede temporária CM do Catálogo: a categoria fiscal de um artigo
--   tem de existir na lista (os artigos já gravados ficam como estão);
-- - os âmbitos `tax:read` (dono, gestor, apoio) e `tax:write` (dono).
--
-- O que não faz: a decisão (é uma função pura na API, `src/iva/decisao.ts`,
-- docs/24 §5); gravá-la na encomenda (fatia 7); a `natureza_iva` no artigo
-- (entra com o checkout; a simulação recebe-a explícita).

SET LOCAL lock_timeout = '10s';

-- ------------------------------------------------------------ Categorias

CREATE TABLE categoria_fiscal (
  codigo text PRIMARY KEY CHECK (codigo ~ '^[a-z][a-z0-9_]*$'),
  descricao_pt text NOT NULL,
  descricao_en text NOT NULL,
  estado text NOT NULL CHECK (estado IN ('activa', 'por_validar', 'arquivada'))
);
INSERT INTO categoria_fiscal VALUES
  ('normal', 'Taxa normal', 'Standard rate', 'activa');

-- O fim da rede CM (docs/06): uma categoria nova ou mudada tem de existir.
CREATE FUNCTION artigo_categoria_fiscal_existe() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.categoria_fiscal IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.categoria_fiscal IS DISTINCT FROM OLD.categoria_fiscal)
     AND NOT EXISTS (
       SELECT FROM public.categoria_fiscal c
       WHERE c.codigo = NEW.categoria_fiscal AND c.estado <> 'arquivada') THEN
    RAISE EXCEPTION 'catalog.tax_category_unknown: a categoria fiscal % não está na lista do Motor de IVA',
      NEW.categoria_fiscal;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER artigo_categoria_fiscal_existe
  BEFORE INSERT OR UPDATE OF categoria_fiscal ON artigo
  FOR EACH ROW EXECUTE FUNCTION artigo_categoria_fiscal_existe();

-- ----------------------------------------------------------------- Taxas

CREATE TABLE taxa_iva (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  pais text NOT NULL CHECK (prefixo_fiscal(pais) IS NOT NULL),
  -- Vazio: o país todo; ou a região (PT-20 Açores, PT-30 Madeira).
  regiao text CHECK (regiao IS NULL OR regiao ~ '^[A-Z]{2}-[0-9A-Z]{1,3}$'),
  categoria text NOT NULL REFERENCES categoria_fiscal (codigo),
  tipo text NOT NULL CHECK (tipo IN ('taxa', 'isenta')),
  -- Em centésimas de ponto: 2300 = 23 %.
  percentagem integer CHECK (percentagem BETWEEN 0 AND 10000),
  codigo_motivo text,
  inicio date NOT NULL,
  fonte text NOT NULL CHECK (length(btrim(fonte)) > 0),
  verificado boolean NOT NULL DEFAULT false,
  verificado_por text,
  CONSTRAINT taxa_iva_tipo CHECK (
    (tipo = 'taxa' AND percentagem IS NOT NULL AND codigo_motivo IS NULL)
    OR (tipo = 'isenta' AND percentagem IS NULL AND codigo_motivo IS NOT NULL)),
  CONSTRAINT taxa_iva_verificada CHECK (verificado = (verificado_por IS NOT NULL))
);
CREATE UNIQUE INDEX taxa_iva_uma_por_inicio
  ON taxa_iva (pais, coalesce(regiao, ''), categoria, inicio);
CREATE TRIGGER taxa_iva_so_se_acrescenta
  BEFORE UPDATE OR DELETE ON taxa_iva
  FOR EACH ROW EXECUTE FUNCTION rasto_so_se_acrescenta();
ALTER TABLE taxa_iva ENABLE ALWAYS TRIGGER taxa_iva_so_se_acrescenta;
-- Sem coluna `fim` (desvio do docs/24 §3.3, escrito no §13): uma taxa vale
-- até à linha seguinte do mesmo país, região e categoria. Uma linha errada
-- corrige-se com outra de início posterior; as decisões entre as duas ficam
-- com a errada (e com a cópia dela na encomenda), por isso as taxas só entram
-- por migração revista, com a fonte.

-- Medidas nos sistemas actuais (M), sem verificação do contabilista; com
-- início no dia desta migração (não se afirma desde quando vigoram).
INSERT INTO taxa_iva (pais, regiao, categoria, tipo, percentagem, inicio, fonte) VALUES
  ('PT', NULL, 'normal', 'taxa', 2300, '2026-10-09',
   'M: sistemas actuais (o Hub cobrava 23 % na taxa normal; eu-vat-oss-ioss, «As peças»)'),
  ('PT', 'PT-20', 'normal', 'taxa', 1600, '2026-10-09',
   'M: sistemas actuais (Açores, taxa normal; docs/03 §1)'),
  ('PT', 'PT-30', 'normal', 'taxa', 2200, '2026-10-09',
   'M: sistemas actuais (Madeira, taxa normal; docs/03 §1)');

-- ----------------------------------------------------------- Territórios

CREATE TABLE territorio_fiscal (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  pais text NOT NULL CHECK (pais ~ '^[A-Z]{2}$'),
  -- O prefixo do código postal, sem espaços nem hífenes; vazio é o país todo.
  prefixo_cp text NOT NULL CHECK (prefixo_cp ~ '^[0-9A-Z]{0,10}$'),
  efeito text NOT NULL CHECK (efeito IN ('fora_do_iva_ue', 'regiao', 'por_validar')),
  regiao text,
  nome text NOT NULL,
  fonte text NOT NULL,
  CONSTRAINT territorio_regiao CHECK ((efeito = 'regiao') = (regiao IS NOT NULL)),
  UNIQUE (pais, prefixo_cp)
);
INSERT INTO territorio_fiscal (pais, prefixo_cp, efeito, nome, fonte) VALUES
  ('ES', '35', 'fora_do_iva_ue', 'Canárias (Las Palmas)', 'M: canarias-ceuta-melilla-extra-ue-28set2026 (docs/03 §1)'),
  ('ES', '38', 'fora_do_iva_ue', 'Canárias (Santa Cruz de Tenerife)', 'M: idem'),
  ('ES', '51', 'fora_do_iva_ue', 'Ceuta', 'M: idem'),
  ('ES', '52', 'fora_do_iva_ue', 'Melilla', 'M: idem'),
  -- Q3: as ilhas portuguesas por validar até o contabilista dizer a taxa de
  -- uma venda do continente (docs/03 §1). O prefixo 9 (todas as ilhas) é C.
  ('PT', '9', 'por_validar', 'Açores e Madeira', 'C: prefixo dos códigos postais das ilhas (por confirmar); Q3 do docs/24'),
  -- Os territórios da skill por confirmar (C): não se vende para eles.
  ('FI', '22', 'por_validar', 'Åland', 'C: eu-vat-oss-ioss, «As peças»; prefixo por confirmar'),
  ('GR', '63086', 'por_validar', 'Monte Atos', 'C: idem'),
  ('DE', '78266', 'por_validar', 'Büsingen', 'C: idem'),
  ('DE', '27498', 'por_validar', 'Heligoland', 'C: idem'),
  ('IT', '23041', 'por_validar', 'Livigno', 'C: idem'),
  ('IT', '22061', 'por_validar', 'Campione d''Italia', 'C: idem'),
  -- Todo o 97xxx e 98xxx de França (departamentos e colectividades
  -- ultramarinos), até validar quais estão dentro do IVA da UE (revisão do
  -- #256, P2-5).
  ('FR', '97', 'por_validar', 'França ultramarina (97xxx)', 'C: idem'),
  ('FR', '98', 'por_validar', 'França ultramarina (98xxx)', 'C: idem'),
  -- A Irlanda do Norte (XI na skill) tem regras próprias nos bens: o código
  -- postal começa por BT (revisão do #256, P1-1). C.
  ('GB', 'BT', 'por_validar', 'Irlanda do Norte', 'C: eu-vat-oss-ioss, «As peças» (XI); prefixo BT por confirmar'),
  -- Mónaco e Ilha de Man: tratamento de IVA próprio, não verificado (C).
  ('MC', '', 'por_validar', 'Mónaco', 'C: revisão do #256, P1-1; não verificado'),
  ('IM', '', 'por_validar', 'Ilha de Man', 'C: idem'),
  -- Os territórios com código ISO próprio ligados a um país da UE (o
  -- ultramar francês, Åland) e os enclaves com acordos com Itália: na
  -- dúvida, por validar, nunca «exportação» por omissão. C.
  ('GP', '', 'por_validar', 'Guadalupe', 'C: idem'),
  ('MQ', '', 'por_validar', 'Martinica', 'C: idem'),
  ('GF', '', 'por_validar', 'Guiana Francesa', 'C: idem'),
  ('RE', '', 'por_validar', 'Reunião', 'C: idem'),
  ('YT', '', 'por_validar', 'Maiote', 'C: idem'),
  ('MF', '', 'por_validar', 'São Martinho', 'C: idem'),
  ('BL', '', 'por_validar', 'São Bartolomeu', 'C: idem'),
  ('PM', '', 'por_validar', 'São Pedro e Miquelão', 'C: idem'),
  ('NC', '', 'por_validar', 'Nova Caledónia', 'C: idem'),
  ('PF', '', 'por_validar', 'Polinésia Francesa', 'C: idem'),
  ('WF', '', 'por_validar', 'Wallis e Futuna', 'C: idem'),
  ('TF', '', 'por_validar', 'Terras Austrais Francesas', 'C: idem'),
  ('AX', '', 'por_validar', 'Åland', 'C: idem'),
  ('SM', '', 'por_validar', 'São Marinho', 'C: idem'),
  ('VA', '', 'por_validar', 'Vaticano', 'C: idem');

-- --------------------------------------------------------------- Motivos

CREATE TABLE motivo_iva (
  pais text NOT NULL CHECK (prefixo_fiscal(pais) IS NOT NULL),
  codigo text NOT NULL CHECK (codigo ~ '^[A-Z0-9]{1,10}$'),
  tipo text NOT NULL CHECK (tipo IN ('exportacao', 'intracomunitaria', 'isento_natureza', 'outro')),
  descricao text NOT NULL,
  fonte text NOT NULL,
  PRIMARY KEY (pais, codigo)
);
INSERT INTO motivo_iva VALUES
  ('PT', 'M05', 'exportacao', 'Exportação', 'C: códigos dos sistemas actuais (eu-vat-oss-ioss); a lista da AT não foi lida'),
  ('PT', 'M16', 'intracomunitaria', 'Transmissão intracomunitária', 'C: idem'),
  ('PT', 'M07', 'isento_natureza', 'Isento (art. 9.º do CIVA)', 'C: idem');

-- ------------------------------------------- O regime de cada entidade legal

CREATE TABLE declaracao_regime (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL REFERENCES comerciante (id),
  entidade_legal_id uuid NOT NULL,
  regime text NOT NULL CHECK (regime IN ('origem', 'destino')),
  oss_desde date,
  -- Os registos de IVA noutros países: [{"pais":"ES","numero":"B123","desde":"2026-01-01"}].
  registos jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(registos) = 'array'),
  declarado_por text NOT NULL,
  declarado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT declaracao_da_entidade FOREIGN KEY (comerciante_id, entidade_legal_id)
    REFERENCES entidade_legal (comerciante_id, id)
);
CREATE INDEX declaracao_por_entidade ON declaracao_regime (comerciante_id, entidade_legal_id, id);

CREATE FUNCTION declaracao_regime_antes() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem text := nullif(btrim(current_setting('eurolify.quem', true)), '');
  r jsonb;
BEGIN
  IF quem IS NULL OR quem !~ '^(pessoa:per_|chave:key_)' THEN
    RAISE EXCEPTION 'tax.declaration_by_person: o regime do IVA só o declara uma pessoa (ou a chave dela)';
  END IF;
  -- Coerência (revisão do #256): o OSS é do regime destino.
  IF NEW.regime = 'origem' AND NEW.oss_desde IS NOT NULL THEN
    RAISE EXCEPTION 'tax.invalid_registration: o regime origem não tem OSS (com OSS, o regime é destino)';
  END IF;
  IF jsonb_array_length(NEW.registos) > 30 THEN
    RAISE EXCEPTION 'tax.invalid_registration: no máximo 30 registos';
  END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(NEW.registos) LOOP
    IF jsonb_typeof(r) <> 'object'
       OR NOT (r ? 'pais' AND r ? 'numero')
       OR public.prefixo_fiscal(r ->> 'pais') IS NULL
       OR (r ->> 'numero') !~ '^[A-Z0-9]{2,20}$'
       OR (r ? 'desde' AND (r ->> 'desde') !~ '^\d{4}-\d{2}-\d{2}$') THEN
      RAISE EXCEPTION 'tax.invalid_registration: cada registo tem um país da UE, um número e, se tiver, a data (AAAA-MM-DD)';
    END IF;
  END LOOP;
  NEW.declarado_por := quem;
  NEW.declarado_em := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER declaracao_regime_antes
  BEFORE INSERT ON declaracao_regime
  FOR EACH ROW EXECUTE FUNCTION declaracao_regime_antes();
CREATE TRIGGER declaracao_regime_so_se_acrescenta
  BEFORE UPDATE OR DELETE ON declaracao_regime
  FOR EACH ROW EXECUTE FUNCTION rasto_so_se_acrescenta();
ALTER TABLE declaracao_regime ENABLE ALWAYS TRIGGER declaracao_regime_so_se_acrescenta;
CREATE TRIGGER declaracao_regime_sem_truncate
  BEFORE TRUNCATE ON declaracao_regime
  FOR EACH STATEMENT EXECUTE FUNCTION rasto_so_se_acrescenta();
ALTER TABLE declaracao_regime ENABLE ALWAYS TRIGGER declaracao_regime_sem_truncate;

CREATE FUNCTION declaracao_regime_evento() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  INSERT INTO public.evento_saida (comerciante_id, tipo, agregado_tipo, agregado_id, dados)
  VALUES (NEW.comerciante_id, 'tax.regime_changed', 'entidade_legal', NEW.entidade_legal_id,
    jsonb_build_object('entidade_legal_id', NEW.entidade_legal_id, 'regime', NEW.regime,
      'quem', NEW.declarado_por,
      'em', to_char(NEW.declarado_em AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
  RETURN NULL;
END
$$;
CREATE TRIGGER declaracao_regime_evento
  AFTER INSERT ON declaracao_regime
  FOR EACH ROW EXECUTE FUNCTION declaracao_regime_evento();

ALTER TABLE declaracao_regime ENABLE ROW LEVEL SECURITY;
ALTER TABLE declaracao_regime FORCE ROW LEVEL SECURITY;
CREATE POLICY so_o_proprio ON declaracao_regime
  USING (comerciante_id = comerciante_actual())
  WITH CHECK (comerciante_id = comerciante_actual());

-- ------------------------------------------ O código na isenção manual (Q4)

ALTER TABLE isencao_manual ADD COLUMN codigo_motivo text;

CREATE OR REPLACE FUNCTION isencao_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem text := nullif(btrim(current_setting('eurolify.quem', true)), '');
  do_perfil record;
BEGIN
  -- Lista branca, não lista negra (revisão do #244, P2-3): só uma pessoa
  -- (pelo Hub) ou a chave que ela usa.
  IF quem IS NULL OR quem !~ '^(pessoa:per_|chave:key_)' THEN
    RAISE EXCEPTION 'customers.exemption_by_person: a isenção manual só a põe ou retira uma pessoa (quem: %)',
      coalesce(quem, 'nenhum');
  END IF;
  IF TG_OP = 'INSERT' THEN
    -- FOR SHARE: espera por um arquivo do perfil em curso (P3-9).
    SELECT p.estado, p.pais_contribuinte, p.nif_numero INTO do_perfil
    FROM public.perfil_faturacao p
    WHERE p.comerciante_id = NEW.comerciante_id AND p.id = NEW.perfil_id
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'customers.not_found: o perfil não existe';
    END IF;
    IF do_perfil.estado <> 'activo' THEN
      RAISE EXCEPTION 'customers.invalid_transition: o perfil está arquivado';
    END IF;
    -- O código do motivo (docs/24 §10, Q4): obrigatório numa isenção nova,
    -- da lista do país do comerciante; sem país único, não há isenção.
    IF NEW.codigo_motivo IS NULL OR NOT EXISTS (
      SELECT FROM public.motivo_iva m
      WHERE m.pais = public.pais_do_comerciante(NEW.comerciante_id)
        AND m.codigo = NEW.codigo_motivo) THEN
      RAISE EXCEPTION 'customers.exemption_reason_code: o código do motivo não é da lista do país do comerciante';
    END IF;
    NEW.pais_contribuinte := do_perfil.pais_contribuinte;
    NEW.nif_numero := do_perfil.nif_numero;
    NEW.posta_por := quem;
    NEW.posta_em := now();
    NEW.motivo_retirada := NULL;
    NEW.retirada_por := NULL;
    NEW.retirada_em := NULL;
    RETURN NEW;
  END IF;
  IF OLD.retirada_em IS NOT NULL OR NEW.motivo_retirada IS NULL
     OR NEW.id <> OLD.id OR NEW.comerciante_id <> OLD.comerciante_id
     OR NEW.perfil_id <> OLD.perfil_id OR NEW.motivo <> OLD.motivo
     OR NEW.pais_contribuinte IS DISTINCT FROM OLD.pais_contribuinte
     OR NEW.nif_numero IS DISTINCT FROM OLD.nif_numero
     OR NEW.codigo_motivo IS DISTINCT FROM OLD.codigo_motivo
     OR NEW.nota IS DISTINCT FROM OLD.nota OR NEW.posta_por <> OLD.posta_por
     OR NEW.posta_em <> OLD.posta_em THEN
    RAISE EXCEPTION 'customers.exemption_immutable: uma isenção não se altera; retira-se, uma vez, e põe-se outra';
  END IF;
  NEW.retirada_por := quem;
  NEW.retirada_em := now();
  RETURN NEW;
END
$$;


-- ----------------------------------------------------- Permissões

GRANT SELECT ON categoria_fiscal, taxa_iva, territorio_fiscal, motivo_iva TO eurolify_api;
GRANT SELECT, INSERT (comerciante_id, entidade_legal_id, regime, oss_desde, registos)
  ON declaracao_regime TO eurolify_api;
GRANT INSERT (codigo_motivo) ON isencao_manual TO eurolify_api;
REVOKE EXECUTE ON FUNCTION artigo_categoria_fiscal_existe(), declaracao_regime_antes(),
  declaracao_regime_evento() FROM PUBLIC;

-- ------------------------------------------------------------- Os âmbitos

ALTER TABLE chave_api DROP CONSTRAINT chave_api_ambitos_validos;
ALTER TABLE chave_api ADD CONSTRAINT chave_api_ambitos_validos CHECK (
  cardinality(ambitos) BETWEEN 1 AND 20
  AND ambitos <@ ARRAY[
    'merchant:read', 'merchant:write',
    'catalog:read', 'catalog:write', 'catalog:publish', 'catalog:import',
    'catalog:history', 'prices:read', 'prices:write',
    'customers:read', 'customers:write', 'customers:billing',
    'customers:exemptions', 'tax:read', 'tax:write', 'keys:write', 'storefront'
  ]::text[]);

CREATE OR REPLACE FUNCTION papel_ambitos(p_papel text) RETURNS text[]
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT CASE p_papel
    WHEN 'dono' THEN ARRAY['catalog:history', 'catalog:import', 'catalog:publish',
                           'catalog:read', 'catalog:write', 'customers:billing',
                           'customers:exemptions', 'customers:read',
                           'customers:write', 'keys:write', 'merchant:read',
                           'merchant:write', 'prices:read', 'prices:write',
                           'tax:read', 'tax:write']
    WHEN 'gestor' THEN ARRAY['catalog:history', 'catalog:import', 'catalog:publish',
                             'catalog:read', 'catalog:write', 'customers:read',
                             'customers:write', 'merchant:read', 'prices:read',
                             'prices:write', 'tax:read']
    WHEN 'armazem' THEN ARRAY['catalog:read', 'prices:read']
    WHEN 'apoio' THEN ARRAY['catalog:read', 'customers:read', 'customers:write',
                            'merchant:read', 'prices:read', 'tax:read']
  END::text[]
$$;
