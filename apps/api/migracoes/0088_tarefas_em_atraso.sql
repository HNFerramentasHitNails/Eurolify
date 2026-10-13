-- O aviso quando as duas tarefas da API param (docs/23 §15.11; issue #233;
-- Diogo, 13/10/2026: «A»). Ex.: a Ana pediu o apagamento e a encomenda dela
-- acabou há uma semana, mas a fila do titular não correu e o contacto e a
-- morada continuam lá; a verificação diária das 07:00 di-lo ao Diogo.
--
-- O que esta migração faz: duas contagens para a verificação diária da VPS
-- (`eurolify_limpeza`), como a `ficheiros_sem_uso_em_atraso()` da 0035. Cada
-- uma conta o que a tarefa já devia ter limpo há mais de um dia, pelo efeito
-- na base (T1): apanha a tarefa parada, a que falha sempre e a que nunca
-- arrancou. Só uma contagem de todos os comerciantes, sem dados pessoais nem
-- identificadores (T4).
--
-- A `encomenda` e a `sessao_checkout` têm o RLS forçado, também para o dono
-- com que estas funções correm: cada comerciante conta-se no contexto dele,
-- só durante a contagem, e volta o que estava (o padrão da 0027 e da 0035).
-- Por isso são VOLATILE: mudam um parâmetro da sessão.
--
-- O que não faz: as outras tarefas da API que correm sozinhas (§15.11, «fica
-- de fora»).

SET LOCAL lock_timeout = '10s';

-- T2: as linhas da fila por aplicar há mais de um dia cuja encomenda já
-- acabou, pela mesma regra da tarefa (`titular_encomenda_acabou`, 0072). A
-- encomenda não guarda quando mudou de estado: conta-se pela idade da linha.
CREATE FUNCTION titular_pendentes_em_atraso() RETURNS bigint
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  anterior text := pg_catalog.current_setting('eurolify.comerciante', true);
  c uuid;
  n bigint := 0;
BEGIN
  FOR c IN SELECT DISTINCT t.comerciante_id FROM public.titular_pendente t
      WHERE t.aplicado_em IS NULL AND t.criado_em < now() - interval '1 day'
      ORDER BY 1 LOOP
    PERFORM pg_catalog.set_config('eurolify.comerciante', c::text, true);
    n := n + (SELECT count(*) FROM public.titular_pendente t
      WHERE t.comerciante_id = c AND t.aplicado_em IS NULL
        AND t.criado_em < now() - interval '1 day'
        AND public.titular_encomenda_acabou(t.encomenda_id));
  END LOOP;
  PERFORM pg_catalog.set_config('eurolify.comerciante', coalesce(anterior, ''), true);
  RETURN n;
END
$$;

-- T3: as sessões que ainda têm dados e que pela regra da
-- `checkout_sessoes_limpar` (0077) já deviam estar limpas há mais de um dia:
-- 8 dias em vez de 7; a concluída limpa-se ao criar a encomenda, por isso
-- conta-se a que mudou há mais de um dia.
CREATE FUNCTION checkout_sessoes_em_atraso() RETURNS bigint
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  anterior text := pg_catalog.current_setting('eurolify.comerciante', true);
  c uuid;
  n bigint := 0;
BEGIN
  -- Os comerciantes que tiveram sessões, como a tarefa (0077).
  FOR c IN SELECT DISTINCT t.comerciante_id FROM public.token_checkout t ORDER BY 1 LOOP
    PERFORM pg_catalog.set_config('eurolify.comerciante', c::text, true);
    n := n + (SELECT count(*) FROM public.sessao_checkout s
      WHERE s.comerciante_id = c
        AND (s.email IS NOT NULL OR s.nome IS NOT NULL OR s.telefone IS NOT NULL
             OR s.entrega IS NOT NULL OR s.faturacao IS NOT NULL)
        AND ((s.estado = 'concluida' AND s.actualizado_em < now() - interval '1 day')
          OR (s.estado IN ('expirada', 'abandonada')
              AND least(s.actualizado_em, s.expira_em) < now() - interval '8 days')
          OR (s.estado = 'aberta' AND s.expira_em < now() - interval '8 days')));
  END LOOP;
  PERFORM pg_catalog.set_config('eurolify.comerciante', coalesce(anterior, ''), true);
  RETURN n;
END
$$;

-- Fechadas a todos; depois, só a quem as chama (como a 0035).
REVOKE EXECUTE ON FUNCTION titular_pendentes_em_atraso(), checkout_sessoes_em_atraso()
  FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'eurolify_limpeza') THEN
    GRANT EXECUTE ON FUNCTION titular_pendentes_em_atraso(), checkout_sessoes_em_atraso()
      TO eurolify_limpeza;
  END IF;
END
$$;
