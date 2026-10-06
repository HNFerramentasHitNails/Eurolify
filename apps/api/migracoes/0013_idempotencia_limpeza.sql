-- A limpeza diária da idempotência (docs/18 §4; docs/17 §3; issue #107;
-- Diogo, 06/10/2026: «avança com a tarefa diária da idempotência»). Ex.: a
-- resposta guardada de um `POST /keys` de segunda-feira às 10:00 apaga-se na
-- limpeza de terça às 05:00, depois de expirar (24 h).
--
-- Uma função, para a regra («expirada é `expira_em <= now()`») viver num só
-- sítio e ter teste. Não é SECURITY DEFINER: a tabela tem RLS forçado, que se
-- aplica também ao dono quando ele não é superutilizador (o eurolify_migrador
-- na VPS; revisão do #118, P3-9). Quem a chama é o programa
-- `eurolify-limpeza` da VPS, como o superutilizador do PostgreSQL (o mesmo das
-- cópias, `eurolify-copia`), que passa o RLS e apaga as de todos os
-- comerciantes. A API não a pode chamar.
--
-- Devolve quantas linhas apagou, para ficar no registo da máquina.

SET LOCAL lock_timeout = '10s';

CREATE FUNCTION idempotencia_apagar_expiradas() RETURNS integer
  LANGUAGE sql SET search_path = pg_catalog, public, pg_temp AS $$
  WITH apagadas AS (
    DELETE FROM public.idempotencia WHERE expira_em <= now() RETURNING 1
  )
  SELECT count(*)::integer FROM apagadas
$$;

REVOKE EXECUTE ON FUNCTION idempotencia_apagar_expiradas() FROM PUBLIC;
