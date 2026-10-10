-- O rasto de auditoria comum, passo 2 (docs/28 §4; decisão DK; Diogo,
-- 10/10/2026: «aprovado»; issue #322). Ex.: uma pessoa que, no Hub, muda o
-- nome de um artigo deixa em `alteracao_catalogo` a linha de sempre e agora
-- também `canal = 'hub'`, `pedido = '<id do pedido>'` e
-- `autorizado_por = 'pessoa:per_…'`; um agente com chave e o cabeçalho
-- `Eurolify-IA` deixa `canal = 'api'` e `ia = {"modelo": …, "prova":
-- "declarado"}`, com `autorizado_por` vazio (§3.2: uma chave não autoriza).
--
-- O que esta migração faz:
-- - acrescenta às oito tabelas do rasto que já existem (§2, mais o
--   `documento_rasto` da 0050) as colunas `canal`, `pedido`, `ia` e
--   `autorizado_por`, e o `motivo` às que não o tinham. As linhas antigas
--   ficam vazias, isto é, «desconhecido»: não se inventa passado (§4, passo 2);
-- - um só gatilho, `rasto_completar()`, antes de cada linha entrar numa
--   dessas tabelas, preenche-as com `contexto_do_rasto()` (0051). As funções
--   que já escrevem o rasto não mudam: uma regra num sítio (§3.1);
-- - o gatilho sobrepõe sempre o canal, o pedido, a IA e quem autorizou (quem
--   escreve a linha não os escolhe); o motivo só entra onde a linha não o
--   trouxe, porque há domínios que o põem eles próprios. O `eurolify.motivo`
--   vale para a transacção inteira: uma linha de outro domínio escrita na
--   mesma transacção herda-o (revisão do #334, P3-2). O `quem` e a `origem`
--   ficam como cada domínio os grava (a `origem` dos pagamentos tem outra
--   lista, 0044);
-- - corre como o dono (SECURITY DEFINER), para servir também as linhas
--   escritas por papéis sem acesso à `contexto_do_rasto()`, como a tarefa
--   dos prazos das contas (`eurolify_limpeza`). Ao contrário do que a 0051
--   previa, os gatilhos não correm com quem escreve (revisão do #334, P3-8);
-- - não fica ALWAYS: é um gatilho que escreve, e uma cópia em modo
--   `replica` tem de guardar as linhas como estão (regra da 0017; revisão
--   do #334, P2-1);
-- - a `contexto_do_rasto()` passa a cortar um motivo com mais de 500
--   caracteres, em vez de o recusar: era o que os Pagamentos já faziam
--   (`left(motivo, 500)`, 0044), e recusar desfazia a operação inteira
--   (revisão do #334, P1-1).
--
-- Ficam fora, por não serem o rasto de alterações (são o próprio registo do
-- domínio, com quem e quando): `movimento_stock`, `pedido_titular`,
-- `consentimento`, `validacao_vies` e `diferenca_pagamento` (docs/28 §2).
--
-- Não faz: os dados sensíveis (passo 3) nem o Hub a mostrar (passo 4).

SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION contexto_do_rasto() RETURNS jsonb
  LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem text := nullif(btrim(current_setting('eurolify.quem', true)), '');
  canal text := nullif(btrim(current_setting('eurolify.canal', true)), '');
  pedido text := nullif(btrim(current_setting('eurolify.pedido', true)), '');
  origem text := nullif(btrim(current_setting('eurolify.origem', true)), '');
  -- Cortado, não recusado (revisão do #334, P1-1).
  motivo text := left(nullif(btrim(current_setting('eurolify.motivo', true)), ''), 500);
  autorizado text := nullif(btrim(current_setting('eurolify.autorizado_por', true)), '');
  ia_texto text := nullif(btrim(current_setting('eurolify.ia', true)), '');
  ia jsonb;
  chave text;
BEGIN
  IF canal IS NOT NULL AND canal NOT IN
     ('hub', 'api', 'importacao', 'integracao', 'mcp', 'sistema', 'operador') THEN
    RAISE EXCEPTION 'audit.context_invalid: canal desconhecido';
  END IF;
  IF pedido IS NOT NULL AND pedido !~ '^[A-Za-z0-9._:-]{1,100}$' THEN
    RAISE EXCEPTION 'audit.context_invalid: identificador do pedido mal formado';
  END IF;
  -- Quem autoriza é sempre uma pessoa (docs/28 §3.2): nunca uma chave nem uma IA.
  IF autorizado IS NOT NULL
     AND autorizado !~ '^pessoa:per_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'audit.context_invalid: quem autoriza tem de ser uma pessoa';
  END IF;
  IF ia_texto IS NOT NULL THEN
    IF NOT pg_input_is_valid(ia_texto, 'jsonb') THEN
      RAISE EXCEPTION 'audit.context_invalid: a IA não é JSON';
    END IF;
    ia := ia_texto::jsonb;
    -- §3.3: só «comprovado» ou «declarado»; «desconhecido» é não haver IA.
    IF jsonb_typeof(ia) <> 'object'
       OR (ia ->> 'prova') IS NULL
       OR (ia ->> 'prova') NOT IN ('comprovado', 'declarado') THEN
      RAISE EXCEPTION 'audit.context_invalid: a IA precisa da prova (comprovado ou declarado)';
    END IF;
    FOR chave IN SELECT jsonb_object_keys(ia) LOOP
      IF chave NOT IN ('fornecedor', 'modelo', 'execucao', 'prova')
         OR jsonb_typeof(ia -> chave) <> 'string'
         OR length(ia ->> chave) NOT BETWEEN 1 AND 100 THEN
        RAISE EXCEPTION 'audit.context_invalid: campo da IA desconhecido ou mal formado';
      END IF;
    END LOOP;
  END IF;
  RETURN jsonb_strip_nulls(jsonb_build_object(
    'quem', quem, 'canal', canal, 'pedido', pedido, 'origem', origem,
    'motivo', motivo, 'autorizado_por', autorizado, 'ia', ia));
END
$$;

ALTER TABLE transicao_estado
  ADD COLUMN canal text, ADD COLUMN pedido text, ADD COLUMN ia jsonb,
  ADD COLUMN autorizado_por text;
ALTER TABLE alteracao_catalogo
  ADD COLUMN canal text, ADD COLUMN pedido text, ADD COLUMN ia jsonb,
  ADD COLUMN autorizado_por text, ADD COLUMN motivo text;
ALTER TABLE alteracao_cliente
  ADD COLUMN canal text, ADD COLUMN pedido text, ADD COLUMN ia jsonb,
  ADD COLUMN autorizado_por text, ADD COLUMN motivo text;
ALTER TABLE transicao_pagamento
  ADD COLUMN canal text, ADD COLUMN pedido text, ADD COLUMN ia jsonb,
  ADD COLUMN autorizado_por text;
ALTER TABLE transicao_encomenda
  ADD COLUMN canal text, ADD COLUMN pedido text, ADD COLUMN ia jsonb,
  ADD COLUMN autorizado_por text;
ALTER TABLE historico_preco
  ADD COLUMN canal text, ADD COLUMN pedido text, ADD COLUMN ia jsonb,
  ADD COLUMN autorizado_por text, ADD COLUMN motivo text;
ALTER TABLE evento_conta
  ADD COLUMN canal text, ADD COLUMN pedido text, ADD COLUMN ia jsonb,
  ADD COLUMN autorizado_por text, ADD COLUMN motivo text;
ALTER TABLE documento_rasto
  ADD COLUMN canal text, ADD COLUMN pedido text, ADD COLUMN ia jsonb,
  ADD COLUMN autorizado_por text;

-- As oito tabelas têm as mesmas cinco colunas: o PL/pgSQL prepara o acesso
-- a `NEW` por tabela, sem passar a linha a JSON (revisão do #334, P3-4).
CREATE FUNCTION rasto_completar() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  contexto jsonb := public.contexto_do_rasto();
BEGIN
  NEW.canal := contexto ->> 'canal';
  NEW.pedido := contexto ->> 'pedido';
  NEW.ia := contexto -> 'ia';
  NEW.autorizado_por := contexto ->> 'autorizado_por';
  IF NEW.motivo IS NULL THEN
    NEW.motivo := contexto ->> 'motivo';
  END IF;
  RETURN NEW;
END
$$;

REVOKE EXECUTE ON FUNCTION rasto_completar() FROM PUBLIC;

CREATE TRIGGER rasto_completar BEFORE INSERT ON transicao_estado
  FOR EACH ROW EXECUTE FUNCTION rasto_completar();
CREATE TRIGGER rasto_completar BEFORE INSERT ON alteracao_catalogo
  FOR EACH ROW EXECUTE FUNCTION rasto_completar();
CREATE TRIGGER rasto_completar BEFORE INSERT ON alteracao_cliente
  FOR EACH ROW EXECUTE FUNCTION rasto_completar();
CREATE TRIGGER rasto_completar BEFORE INSERT ON transicao_pagamento
  FOR EACH ROW EXECUTE FUNCTION rasto_completar();
CREATE TRIGGER rasto_completar BEFORE INSERT ON transicao_encomenda
  FOR EACH ROW EXECUTE FUNCTION rasto_completar();
CREATE TRIGGER rasto_completar BEFORE INSERT ON historico_preco
  FOR EACH ROW EXECUTE FUNCTION rasto_completar();
CREATE TRIGGER rasto_completar BEFORE INSERT ON evento_conta
  FOR EACH ROW EXECUTE FUNCTION rasto_completar();
CREATE TRIGGER rasto_completar BEFORE INSERT ON documento_rasto
  FOR EACH ROW EXECUTE FUNCTION rasto_completar();
