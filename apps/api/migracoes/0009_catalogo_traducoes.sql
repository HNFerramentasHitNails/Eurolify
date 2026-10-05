-- Domínio Catálogo, parte 3b: traduções (docs/14 §3.8 e §4.3; issue #77), e
-- a língua de origem do catálogo, que passa da loja para o comerciante (P13,
-- Diogo, 05/10/2026: «sim, uma só língua de origem por comerciante»).
-- Ex.: o artigo «Gel de construção» (original em pt) com o nome em es
-- «Gel de construcción»; se o original mudar para «Gel construtor», a
-- tradução fica desactualizada até alguém a rever.
--
-- Regras (as marcadas «proposta» são desta parte do código, docs/14 §3.8):
-- - campos traduzíveis: artigo (nome, descricao), opção (nome), valor
--   (valor), categoria (nome, endereco_amigavel), colecção (nome, descricao,
--   endereco_amigavel);
-- - a base guarda com a tradução o texto do original nesse momento; o estado
--   (completa, desactualizada, em falta) calcula-se ao ler, comparando com o
--   original de agora (proposta, em vez da versão do recurso);
-- - não se traduz para a língua de origem, nem um campo sem original;
-- - quem traduz vem de `eurolify.quem` (como a classificação, 0006); a data é
--   da base; traduzir outra vez apaga a revisão; só uma proposta de IA se
--   revê (proposta);
-- - o endereço traduzido tem o formato do original e é único por comerciante
--   e por língua, entre categorias e, à parte, entre colecções;
-- - a língua de origem não muda depois de o comerciante ter catálogo
--   (proposta); criar o primeiro artigo, categoria ou colecção espera por
--   quem a esteja a mudar (revisão do #105, P1-1);
-- - quem traduz diz o original que viu: se já não é o de agora, a tradução é
--   recusada (no repositório, com a linha do recurso presa; revisão do #105,
--   P2-3); quem traduziu não revê a sua própria tradução, e uma revisão não
--   se repete (P2-1 e P2-2). Que uma revisão é de uma pessoa, e não de um
--   agente, só a camada da API o pode saber (pela conta que chama).
--
-- Compatível com a versão anterior da aplicação (`infra/vps/LEIA-ME.md`,
-- «Migrações compatíveis com a versão anterior»; revisão do #105, P2-4): a
-- `loja.lingua_origem` fica, sem obrigação, até uma migração seguinte (data
-- de fim: 31/10/2026), e um comerciante criado sem `lingua_origem` fica com
-- a `lingua`.
--
-- Também (revisão do #97, P3-A): um artigo a entrar numa categoria espera
-- por quem a esteja a arquivar e lê o estado novo.

-- 1. A língua de origem passa para o comerciante. Os que já existem ficam
-- com a da primeira loja ou, sem loja, com a `lingua` do Hub (proposta). O
-- RLS forçado e o trigger da versão desligam-se só durante o preenchimento,
-- dentro desta transacção: quem migra não tem comerciante no contexto, e
-- preencher uma coluna nova não é uma alteração do comerciante.
ALTER TABLE comerciante ADD COLUMN lingua_origem text;
ALTER TABLE comerciante NO FORCE ROW LEVEL SECURITY;
ALTER TABLE loja NO FORCE ROW LEVEL SECURITY;
-- Um comerciante com lojas em línguas diferentes: a migração pára, em vez de
-- escolher sozinha uma delas (AGENTS.md, regra fiscal 6, por analogia;
-- revisão do #105, P3-A). Uma pessoa decide a língua de cada um e põe as
-- lojas dele na mesma antes de migrar.
DO $$
DECLARE
  quantos integer;
BEGIN
  SELECT count(*) INTO quantos FROM (
    SELECT l.comerciante_id FROM loja l
    GROUP BY l.comerciante_id
    HAVING count(DISTINCT l.lingua_origem) > 1) diferentes;
  IF quantos > 0 THEN
    RAISE EXCEPTION 'a 0009 pára: % comerciante(s) com lojas em línguas de origem diferentes; uma pessoa decide antes de migrar', quantos;
  END IF;
END
$$;
ALTER TABLE comerciante DISABLE TRIGGER comerciante_antes_de_gravar;
UPDATE comerciante c SET lingua_origem = coalesce(
  (SELECT l.lingua_origem FROM loja l
   WHERE l.comerciante_id = c.id
   ORDER BY l.criado_em, l.id LIMIT 1),
  c.lingua);
ALTER TABLE comerciante ENABLE TRIGGER comerciante_antes_de_gravar;
ALTER TABLE comerciante FORCE ROW LEVEL SECURITY;
ALTER TABLE loja FORCE ROW LEVEL SECURITY;
-- Confirmação: o RLS forçado e o trigger voltaram (uma linha a menos acima e
-- a migração não passa).
DO $$
BEGIN
  IF NOT (SELECT c.relforcerowsecurity FROM pg_catalog.pg_class c
          WHERE c.oid = 'public.comerciante'::regclass)
     OR NOT (SELECT c.relforcerowsecurity FROM pg_catalog.pg_class c
             WHERE c.oid = 'public.loja'::regclass)
     OR (SELECT g.tgenabled FROM pg_catalog.pg_trigger g
         WHERE g.tgrelid = 'public.comerciante'::regclass
           AND g.tgname = 'comerciante_antes_de_gravar') <> 'O' THEN
    RAISE EXCEPTION 'a 0009 pára: o RLS forçado ou o trigger do comerciante não voltaram';
  END IF;
END
$$;
ALTER TABLE comerciante
  ALTER COLUMN lingua_origem SET NOT NULL,
  ADD CONSTRAINT comerciante_lingua_origem_check CHECK (lingua_origem ~ '^[a-z]{2}$');
-- A da loja fica, sem obrigação, para a versão anterior da aplicação poder
-- voltar; sai numa migração seguinte (data de fim: 31/10/2026).
ALTER TABLE loja ALTER COLUMN lingua_origem DROP NOT NULL;
COMMENT ON COLUMN loja.lingua_origem IS
  'Obsoleta desde a 0009 (passou para comerciante.lingua_origem); sai numa migração seguinte, até 31/10/2026.';

-- Sem língua de origem, a do Hub (proposta, docs/14 §3.8): também para a
-- versão anterior da aplicação, que não a escreve.
CREATE FUNCTION comerciante_lingua_origem_por_omissao() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.lingua_origem IS NULL THEN
    NEW.lingua_origem := NEW.lingua;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER comerciante_lingua_origem_por_omissao
  BEFORE INSERT ON comerciante
  FOR EACH ROW EXECUTE FUNCTION comerciante_lingua_origem_por_omissao();

CREATE FUNCTION comerciante_lingua_origem_fixa() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.lingua_origem IS DISTINCT FROM OLD.lingua_origem AND (
       EXISTS (SELECT FROM public.artigo a WHERE a.comerciante_id = NEW.id)
       OR EXISTS (SELECT FROM public.categoria c WHERE c.comerciante_id = NEW.id)
       OR EXISTS (SELECT FROM public.colecao c WHERE c.comerciante_id = NEW.id)) THEN
    RAISE EXCEPTION 'merchant.origin_language_locked: a língua de origem não muda depois de haver catálogo';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER comerciante_lingua_origem_fixa
  BEFORE UPDATE OF lingua_origem ON comerciante
  FOR EACH ROW EXECUTE FUNCTION comerciante_lingua_origem_fixa();

-- Criar um artigo, uma categoria ou uma colecção prende o comerciante (FOR
-- SHARE): quem muda a língua de origem ao mesmo tempo espera por esta
-- criação (e depois vê o catálogo e recusa), ou esta espera por ele (revisão
-- do #105, P1-1). Sem isto, os dois passavam: a chave estrangeira só pede
-- KEY SHARE, que não choca com o UPDATE da língua.
CREATE FUNCTION catalogo_prende_o_comerciante() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM FROM public.comerciante c WHERE c.id = NEW.comerciante_id FOR SHARE;
  RETURN NEW;
END
$$;

CREATE TRIGGER artigo_prende_o_comerciante
  BEFORE INSERT ON artigo
  FOR EACH ROW EXECUTE FUNCTION catalogo_prende_o_comerciante();
CREATE TRIGGER categoria_prende_o_comerciante
  BEFORE INSERT ON categoria
  FOR EACH ROW EXECUTE FUNCTION catalogo_prende_o_comerciante();
CREATE TRIGGER colecao_prende_o_comerciante
  BEFORE INSERT ON colecao
  FOR EACH ROW EXECUTE FUNCTION catalogo_prende_o_comerciante();

-- 2. As traduções. Uma coluna por tipo de recurso, para cada uma ter a sua
-- chave estrangeira (apagar o recurso apaga as traduções dele).
ALTER TABLE opcao ADD CONSTRAINT opcao_comerciante_id_unico UNIQUE (comerciante_id, id);
ALTER TABLE valor_opcao ADD CONSTRAINT valor_opcao_comerciante_id_unico UNIQUE (comerciante_id, id);

CREATE TABLE traducao (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  comerciante_id uuid NOT NULL,
  artigo_id uuid,
  opcao_id uuid,
  valor_opcao_id uuid,
  categoria_id uuid,
  colecao_id uuid,
  recurso_id uuid NOT NULL GENERATED ALWAYS AS (
    coalesce(artigo_id, opcao_id, valor_opcao_id, categoria_id, colecao_id)) STORED,
  campo text NOT NULL,
  lingua text NOT NULL CHECK (lingua ~ '^[a-z]{2}$'),
  texto text NOT NULL,
  -- O original quando se traduziu (posto pela base).
  original text NOT NULL,
  origem text NOT NULL CHECK (origem IN ('pessoa', 'ia')),
  traduzido_por text NOT NULL,
  traduzido_em timestamptz NOT NULL DEFAULT now(),
  -- Só numa proposta de IA; quem e quando vêm da base.
  revista boolean NOT NULL DEFAULT false,
  revisto_por text,
  revisto_em timestamptz,
  CONSTRAINT traducao_um_recurso CHECK (
    num_nonnulls(artigo_id, opcao_id, valor_opcao_id, categoria_id, colecao_id) = 1),
  CONSTRAINT traducao_campo_do_recurso CHECK (
    (artigo_id IS NOT NULL AND campo IN ('nome', 'descricao'))
    OR (opcao_id IS NOT NULL AND campo = 'nome')
    OR (valor_opcao_id IS NOT NULL AND campo = 'valor')
    OR (categoria_id IS NOT NULL AND campo IN ('nome', 'endereco_amigavel'))
    OR (colecao_id IS NOT NULL AND campo IN ('nome', 'descricao', 'endereco_amigavel'))),
  CONSTRAINT traducao_texto_check CHECK (length(btrim(texto)) > 0),
  -- Limites (proposta; revisão do #105, P3-E): nomes e valores até 200, como
  -- o nome de uma categoria; descrições até 20 000; o endereço até 100.
  CONSTRAINT traducao_texto_comprimento CHECK (
    (campo IN ('nome', 'valor') AND length(texto) <= 200)
    OR (campo = 'descricao' AND length(texto) <= 20000)
    OR campo = 'endereco_amigavel'),
  CONSTRAINT traducao_endereco_valido CHECK (
    campo <> 'endereco_amigavel'
    OR (texto ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(texto) <= 100)),
  CONSTRAINT traducao_revisao_completa CHECK (
    (revista AND origem = 'ia' AND revisto_por IS NOT NULL AND revisto_em IS NOT NULL)
    OR (NOT revista AND revisto_por IS NULL AND revisto_em IS NULL)),
  CONSTRAINT traducao_unica UNIQUE (comerciante_id, recurso_id, campo, lingua),
  CONSTRAINT traducao_artigo FOREIGN KEY (comerciante_id, artigo_id)
    REFERENCES artigo (comerciante_id, id) ON DELETE CASCADE,
  CONSTRAINT traducao_opcao FOREIGN KEY (comerciante_id, opcao_id)
    REFERENCES opcao (comerciante_id, id) ON DELETE CASCADE,
  CONSTRAINT traducao_valor_opcao FOREIGN KEY (comerciante_id, valor_opcao_id)
    REFERENCES valor_opcao (comerciante_id, id) ON DELETE CASCADE,
  CONSTRAINT traducao_categoria FOREIGN KEY (comerciante_id, categoria_id)
    REFERENCES categoria (comerciante_id, id) ON DELETE CASCADE,
  CONSTRAINT traducao_colecao FOREIGN KEY (comerciante_id, colecao_id)
    REFERENCES colecao (comerciante_id, id) ON DELETE CASCADE
);
CREATE INDEX traducao_por_lingua ON traducao (comerciante_id, lingua);
-- Para apagar em cascata sem ler as traduções todas do comerciante (revisão
-- do #105, P3-B).
CREATE INDEX traducao_por_artigo ON traducao (comerciante_id, artigo_id) WHERE artigo_id IS NOT NULL;
CREATE INDEX traducao_por_opcao ON traducao (comerciante_id, opcao_id) WHERE opcao_id IS NOT NULL;
CREATE INDEX traducao_por_valor ON traducao (comerciante_id, valor_opcao_id) WHERE valor_opcao_id IS NOT NULL;
CREATE INDEX traducao_por_categoria ON traducao (comerciante_id, categoria_id) WHERE categoria_id IS NOT NULL;
CREATE INDEX traducao_por_colecao ON traducao (comerciante_id, colecao_id) WHERE colecao_id IS NOT NULL;
CREATE UNIQUE INDEX traducao_endereco_unico_categoria
  ON traducao (comerciante_id, lingua, texto)
  WHERE campo = 'endereco_amigavel' AND categoria_id IS NOT NULL;
CREATE UNIQUE INDEX traducao_endereco_unico_colecao
  ON traducao (comerciante_id, lingua, texto)
  WHERE campo = 'endereco_amigavel' AND colecao_id IS NOT NULL;

-- Os textos originais traduzíveis, um por recurso e campo. Com os direitos de
-- quem lê (security_invoker): o RLS de cada tabela aplica-se.
CREATE VIEW texto_original WITH (security_invoker = true) AS
  SELECT comerciante_id, 'artigo'::text AS tipo, id AS recurso_id,
         'nome'::text AS campo, nome AS texto FROM artigo
  UNION ALL
  SELECT comerciante_id, 'artigo', id, 'descricao', descricao FROM artigo
  UNION ALL
  SELECT comerciante_id, 'opcao', id, 'nome', nome FROM opcao
  UNION ALL
  SELECT comerciante_id, 'valor_opcao', id, 'valor', valor FROM valor_opcao
  UNION ALL
  SELECT comerciante_id, 'categoria', id, 'nome', nome FROM categoria
  UNION ALL
  SELECT comerciante_id, 'categoria', id, 'endereco_amigavel', endereco_amigavel FROM categoria
  UNION ALL
  SELECT comerciante_id, 'colecao', id, 'nome', nome FROM colecao
  UNION ALL
  SELECT comerciante_id, 'colecao', id, 'descricao', descricao FROM colecao
  UNION ALL
  SELECT comerciante_id, 'colecao', id, 'endereco_amigavel', endereco_amigavel FROM colecao;

CREATE FUNCTION traducao_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem text := nullif(btrim(current_setting('eurolify.quem', true)), '');
  lingua_de_origem text;
  texto_do_original text;
BEGIN
  -- Rever outra vez o que já está revisto: recusado. Se o original mudou
  -- entretanto, a revisão repetida dava-a por completa sem ninguém a ver
  -- (revisão do #105, P2-1); traduz-se (ou confirma-se) outra vez.
  IF TG_OP = 'UPDATE'
     AND (NEW.texto, NEW.origem) IS NOT DISTINCT FROM (OLD.texto, OLD.origem)
     AND NEW.revista AND OLD.revista THEN
    RAISE EXCEPTION 'catalog.invalid_transition: a tradução já está revista; traduzir outra vez para a mudar';
  END IF;
  -- Uma revisão: só muda `revista` de falso para verdadeiro. Pôr `revista` a
  -- falso é traduzir outra vez (abaixo).
  IF TG_OP = 'UPDATE'
     AND (NEW.texto, NEW.origem) IS NOT DISTINCT FROM (OLD.texto, OLD.origem)
     AND NEW.revista AND NOT OLD.revista THEN
    IF OLD.origem <> 'ia' THEN
      RAISE EXCEPTION 'catalog.translation_not_ai: só uma proposta de IA se revê';
    END IF;
    IF quem IS NULL THEN
      RAISE EXCEPTION 'catalog.translated_by_required: rever exige quem reviu';
    END IF;
    -- Quem traduziu não se revê a si próprio (revisão do #105, P2-2).
    IF quem = OLD.traduzido_por THEN
      RAISE EXCEPTION 'catalog.translation_self_review: quem traduziu não revê a própria tradução';
    END IF;
    NEW.revisto_por := quem;
    NEW.revisto_em := now();
    NEW.original := OLD.original;
    NEW.traduzido_por := OLD.traduzido_por;
    NEW.traduzido_em := OLD.traduzido_em;
    RETURN NEW;
  END IF;

  -- Traduzir (ou traduzir outra vez, também com o mesmo texto: confirma a
  -- tradução contra o original de agora).
  IF quem IS NULL THEN
    RAISE EXCEPTION 'catalog.translated_by_required: traduzir exige quem traduziu';
  END IF;
  -- Sem bloqueio: uma tradução é de um recurso que já existe, e com catálogo
  -- a língua de origem já não muda (comerciante_lingua_origem_fixa e
  -- catalogo_prende_o_comerciante).
  SELECT c.lingua_origem INTO lingua_de_origem FROM public.comerciante c
  WHERE c.id = NEW.comerciante_id;
  IF NEW.lingua = lingua_de_origem THEN
    RAISE EXCEPTION 'catalog.translation_same_language: % é a língua de origem', NEW.lingua;
  END IF;
  SELECT t.texto INTO texto_do_original FROM public.texto_original t
  WHERE t.comerciante_id = NEW.comerciante_id
    AND t.recurso_id = coalesce(NEW.artigo_id, NEW.opcao_id, NEW.valor_opcao_id,
                                NEW.categoria_id, NEW.colecao_id)
    AND t.campo = NEW.campo;
  -- Sem linha: o recurso não existe (a chave estrangeira recusa a seguir).
  IF FOUND AND (texto_do_original IS NULL OR btrim(texto_do_original) = '') THEN
    RAISE EXCEPTION 'catalog.translation_no_original: o campo % não tem original', NEW.campo;
  END IF;
  NEW.original := coalesce(texto_do_original, '');
  NEW.traduzido_por := quem;
  NEW.traduzido_em := now();
  NEW.revista := false;
  NEW.revisto_por := NULL;
  NEW.revisto_em := NULL;
  RETURN NEW;
END
$$;

CREATE TRIGGER traducao_antes_de_gravar
  BEFORE INSERT OR UPDATE ON traducao
  FOR EACH ROW EXECUTE FUNCTION traducao_antes_de_gravar();

ALTER TABLE traducao ENABLE ROW LEVEL SECURITY;
ALTER TABLE traducao FORCE ROW LEVEL SECURITY;
CREATE POLICY so_o_proprio ON traducao
  USING (comerciante_id = comerciante_actual())
  WITH CHECK (comerciante_id = comerciante_actual());

-- A API não escolhe ids, o original, quem nem datas; pede a revisão
-- (`revista`), que a base valida e assina.
GRANT SELECT, DELETE ON traducao TO eurolify_api;
GRANT INSERT (comerciante_id, artigo_id, opcao_id, valor_opcao_id, categoria_id,
  colecao_id, campo, lingua, texto, origem) ON traducao TO eurolify_api;
GRANT UPDATE (texto, origem, revista) ON traducao TO eurolify_api;
GRANT SELECT ON texto_original TO eurolify_api;

-- 3. Revisão do #97, P3-A: entrar numa categoria lê-a com FOR SHARE, que
-- espera por quem a esteja a arquivar (FOR KEY SHARE não esperava) e relê o
-- estado novo.
-- O estado lê-se para uma variável na mesma instrução que prende a linha,
-- como na loja (0001). A primeira versão (EXISTS sobre uma subconsulta com
-- FOR SHARE e o filtro do estado fora) esperava com o superutilizador mas não
-- com o eurolify_api (medido; não verifiquei porquê ao certo).
CREATE OR REPLACE FUNCTION artigo_categoria_antes_de_inserir() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  estado_da_categoria text;
BEGIN
  SELECT c.estado INTO estado_da_categoria FROM public.categoria c
  WHERE c.comerciante_id = NEW.comerciante_id AND c.id = NEW.categoria_id
  FOR SHARE;
  -- Sem linha: a chave estrangeira recusa a seguir («não existe»).
  IF estado_da_categoria = 'arquivada' THEN
    RAISE EXCEPTION 'catalog.category_archived: um artigo não entra numa categoria arquivada';
  END IF;
  RETURN NEW;
END
$$;
