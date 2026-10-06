-- A limpeza diária da idempotência (docs/18 §4; docs/17 §3; issue #107;
-- Diogo, 06/10/2026: «avança com a tarefa diária da idempotência»). Ex.: a
-- resposta guardada de um `POST /keys` de segunda-feira às 10:00 apaga-se na
-- limpeza de quarta às 05:00 (expira na terça às 10:00, depois da limpeza
-- desse dia).
--
-- A função diz o que é «expirada» para a limpeza (`expira_em <= now()`; a API
-- usa a mesma regra para substituir uma linha da mesma chave,
-- `src/base/idempotencia.ts`). Devolve quantas apagou, para o registo.
--
-- Quem a chama é o papel `eurolify_limpeza` (revisão do #119, P2-2): entra na
-- base com a sua própria sessão (LOGIN sem palavra-passe: só pelo socket local
-- do contentor da base, com `docker exec`, que só o root da VPS tem), não é
-- superutilizador, passa o RLS forçado da tabela (BYPASSRLS) e só tem
-- SELECT/DELETE na `idempotencia` e EXECUTE nesta função. Antes, chamava-a o
-- superutilizador: o dono das tabelas (o eurolify_migrador na VPS) podia
-- refazer a função ou pôr um gatilho na tabela, e esse código corria todos os
-- dias como superutilizador. Agora corre com os direitos deste papel; uma
-- função SECURITY DEFINER do dono corre com os direitos do dono, que já os
-- tem. Um SET ROLE a partir do superutilizador não chegava: o código chamado
-- podia fazer RESET ROLE.
--
-- Na VPS o migrador não pode criar papéis (nem BYPASSRLS, que exige
-- superutilizador): cria-o o preparar.sh (passo 10b), como o eurolify_api, e
-- dá-lhe os privilégios se esta migração não os tiver dado. Aqui só se cria
-- quando quem migra pode (o superutilizador dos testes).

SET LOCAL lock_timeout = '10s';

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'eurolify_limpeza') THEN
    BEGIN
      CREATE ROLE eurolify_limpeza LOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'migracao 0013: sem permissão para criar o papel eurolify_limpeza; cria-o o preparar.sh (passo 10b)';
    END;
  END IF;
END
$$;

CREATE FUNCTION idempotencia_apagar_expiradas() RETURNS integer
  LANGUAGE sql SET search_path = pg_catalog, public, pg_temp AS $$
  WITH apagadas AS (
    DELETE FROM public.idempotencia WHERE expira_em <= now() RETURNING 1
  )
  SELECT count(*)::integer FROM apagadas
$$;

REVOKE EXECUTE ON FUNCTION idempotencia_apagar_expiradas() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'eurolify_limpeza') THEN
    GRANT SELECT, DELETE ON idempotencia TO eurolify_limpeza;
    GRANT EXECUTE ON FUNCTION idempotencia_apagar_expiradas() TO eurolify_limpeza;
  END IF;
END
$$;
