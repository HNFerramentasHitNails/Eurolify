-- Fatia «identidade»: as funções das contas de pessoas que lêem o comerciante
-- passam a fazê-lo com o contexto DESSE comerciante, limitado à função
-- (issue #156; pedido #168).
--
-- Porquê: a tabela `comerciante` tem FORCE ROW LEVEL SECURITY (0001), e a
-- política lê `comerciante_actual()`, que falha sem `eurolify.comerciante`
-- (42704). As funções SECURITY DEFINER correm como o dono das tabelas; na VPS
-- esse dono não é superutilizador nem salta o RLS, por isso aceitar um
-- convite, criar o convite do operador ou ler os comerciantes de quem entrou
-- falhavam lá (medido a 08/10/2026: o primeiro convite pelo fluxo «operar»
-- deu 42704). Os testes não o viam porque o dono das tabelas era um
-- superutilizador; desde este pedido, os testes usam um dono como o da VPS.
--
-- Como: `comerciante_resumo(id)` lê o nome e o estado de UM comerciante com
-- `eurolify.comerciante` posto nesse id e repõe o valor que havia antes de
-- sair, por isso o contexto não passa para quem a chamou (a cláusula SET da
-- função não serve: um dono sem superutilizador não a pode pôr num parâmetro
-- destes). Se a função falhar a meio, a transacção ou a subtransacção desfaz
-- também o set_config. Se não havia contexto nenhum, à saída fica o valor
-- vazio: uma leitura protegida continua recusada (22P02 em vez de 42704).
--
-- Só as funções da base a chamam (ninguém tem EXECUTE): nunca se chega a ela
-- pela API, e não dá a ninguém dados de um comerciante que já não tivesse.

SET LOCAL lock_timeout = '10s';

CREATE FUNCTION comerciante_resumo(p_comerciante uuid)
  RETURNS TABLE (nome text, estado text)
  -- VOLATILE (o valor por omissão): muda um parâmetro da sessão.
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  anterior text := pg_catalog.current_setting('eurolify.comerciante', true);
BEGIN
  IF p_comerciante IS NULL THEN
    RETURN;
  END IF;
  PERFORM pg_catalog.set_config('eurolify.comerciante', p_comerciante::text, true);
  -- RETURN QUERY lê já: o contexto pode voltar ao que era a seguir.
  RETURN QUERY SELECT c.nome, c.estado FROM public.comerciante c WHERE c.id = p_comerciante;
  PERFORM pg_catalog.set_config('eurolify.comerciante', coalesce(anterior, ''), true);
END
$$;

-- 0018: a mesma regra, agora sem depender do contexto de quem chama.
CREATE OR REPLACE FUNCTION comerciante_escreve(p_comerciante uuid) RETURNS void
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF (SELECT r.estado FROM public.comerciante_resumo(p_comerciante) r)
     IN ('suspenso', 'fechado') THEN
    RAISE EXCEPTION 'member.merchant_inactive: um comerciante suspenso ou fechado não convida nem muda papéis';
  END IF;
END
$$;

-- 0020: os comerciantes de que a pessoa é membro activo, cada um lido com o
-- seu contexto. A mesma resposta de antes.
CREATE OR REPLACE FUNCTION pessoa_eu(p_segredo text) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  s public.sessao;
BEGIN
  s := public.sessao_valida(p_segredo);
  RETURN (
    SELECT jsonb_build_object(
      'pessoa', p.id, 'nome', p.nome, 'email', p.email,
      'comerciantes', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
                 'comerciante', m.comerciante_id, 'nome', c.nome,
                 'papel', m.papel, 'membro', m.id)
               ORDER BY c.nome, m.comerciante_id)
        FROM public.membro m
        CROSS JOIN LATERAL public.comerciante_resumo(m.comerciante_id) c
        WHERE m.pessoa_id = p.id AND m.ate IS NULL), '[]'::jsonb))
    FROM public.pessoa p WHERE p.id = s.pessoa_id);
END
$$;

REVOKE ALL ON FUNCTION comerciante_resumo(uuid) FROM PUBLIC;
