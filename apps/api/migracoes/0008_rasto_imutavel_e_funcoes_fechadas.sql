-- Segurança da base (auditoria docs/16, «Segurança e dados»; pedido do Diogo,
-- 05/10/2026: «avança com a migração 0008»). Ex.: uma transição de
-- `rascunho` para `prova_pendente` registada a 05/10 nunca mais muda, nem
-- pela mão do dono das tabelas.
--
-- O que esta migração faz:
-- 1. O rasto do Comerciante só se acrescenta, imposto por gatilho e não só
--    por permissões: `transicao_estado`, `aceitacao_contrato` e
--    `prova_verificacao` recusam UPDATE, DELETE e TRUNCATE a qualquer
--    utilizador, o dono incluído (observability-security, «Registo de
--    auditoria»: corrige-se com uma entrada nova).
-- 2. As funções nascem fechadas: tira-se o EXECUTE a PUBLIC em todas as
--    funções do esquema `public` e nas que este utilizador criar daqui para
--    a frente (fechado por omissão; no Hub actual, 77 funções abertas,
--    observability-security). A API fica só com as que chama: a das
--    políticas por comerciante e a do GTIN. As funções de gatilho não
--    precisam de EXECUTE para disparar.
--
-- O que não faz (e onde fica):
-- - um superutilizador ainda pode desligar o gatilho (ALTER TABLE ... DISABLE
--   TRIGGER) ou ser dono das tabelas: na VPS o migrador não é superutilizador
--   (docs/15 §5);
-- - «de onde» e «que IA e que modelo» na `transicao_estado`, e o rasto do
--   Catálogo: são desenho por fazer (docs/16);
-- - pseudonimizar o rasto num pedido de apagamento: desenho por fazer
--   (docs/17 §3).

SET LOCAL lock_timeout = '10s';

-- 1. Rasto que só se acrescenta.
CREATE FUNCTION rasto_so_se_acrescenta() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'audit.append_only: % em % recusado: o rasto só se acrescenta (corrige-se com uma entrada nova)',
    TG_OP, TG_TABLE_NAME;
END
$$;

CREATE TRIGGER transicao_estado_so_se_acrescenta
  BEFORE UPDATE OR DELETE ON transicao_estado
  FOR EACH ROW EXECUTE FUNCTION rasto_so_se_acrescenta();
CREATE TRIGGER transicao_estado_sem_truncate
  BEFORE TRUNCATE ON transicao_estado
  FOR EACH STATEMENT EXECUTE FUNCTION rasto_so_se_acrescenta();

CREATE TRIGGER aceitacao_contrato_so_se_acrescenta
  BEFORE UPDATE OR DELETE ON aceitacao_contrato
  FOR EACH ROW EXECUTE FUNCTION rasto_so_se_acrescenta();
CREATE TRIGGER aceitacao_contrato_sem_truncate
  BEFORE TRUNCATE ON aceitacao_contrato
  FOR EACH STATEMENT EXECUTE FUNCTION rasto_so_se_acrescenta();

CREATE TRIGGER prova_verificacao_so_se_acrescenta
  BEFORE UPDATE OR DELETE ON prova_verificacao
  FOR EACH ROW EXECUTE FUNCTION rasto_so_se_acrescenta();
CREATE TRIGGER prova_verificacao_sem_truncate
  BEFORE TRUNCATE ON prova_verificacao
  FOR EACH STATEMENT EXECUTE FUNCTION rasto_so_se_acrescenta();

-- 2. Funções fechadas por omissão.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
-- Só a forma global tira o EXECUTE que o PostgreSQL dá a PUBLIC por
-- omissão (a forma IN SCHEMA só acrescenta). Vale para as funções que o
-- utilizador que corre as migrações criar.
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
-- O que a API chama: as políticas por comerciante (0001) e a verificação do
-- GTIN (0002). As do Catálogo (0005) já tinham as suas.
GRANT EXECUTE ON FUNCTION comerciante_actual(), gtin_valido(text) TO eurolify_api;
