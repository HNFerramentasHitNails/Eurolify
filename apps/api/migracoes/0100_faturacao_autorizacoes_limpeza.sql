-- A limpeza dos pedidos de autorização do emissor (docs/29 §20; revisão do
-- #407, P3-4; Diogo, 14/10/2026: «sim, aprovo o desenho com a Q1 em a)»;
-- docs/06, ER). Ex.: a «Loja Exemplo» pede a autorização às 10:00 de
-- 14/10/2026 e conclui às 10:02; a linha apaga-se na limpeza de 14/11/2026,
-- a primeira depois de passarem 30 dias.
--
-- Um pedido vale 10 minutos e uma vez (0081); depois, a linha só serve para
-- investigar uma ligação estranha. Guarda-se 30 dias depois do fim (usada ou
-- expirada) e apaga-se. O que tem de durar mais já fica noutro sítio: quem
-- ligou (`ligacao_faturacao.credenciais_por`) e as recusas
-- (`recusa_conta_emissor`, 0097).
--
-- A regra fica num sítio, `autorizacao_faturacao_apagavel`: o gatilho da 0081
-- passa a deixar apagar só o que ela deixa, a quem quer que apague (a API não
-- tem DELETE na tabela, nem passa a ter). Apaga a limpeza diária da VPS
-- (eurolify-limpeza, 05:00 UTC), com o papel eurolify_limpeza, que só recebe
-- o EXECUTE das duas funções; a verificação das 07:00 avisa se ficarem
-- linhas com o prazo passado há mais de um dia.
SET LOCAL lock_timeout = '10s';

-- A limpeza e a contagem percorrem a tabela por comerciante (revisão do
-- #456, P3-2).
CREATE INDEX autorizacao_faturacao_comerciante ON autorizacao_faturacao (comerciante_id);

-- O fim do pedido mais o prazo da Q1 já passou.
CREATE FUNCTION autorizacao_faturacao_apagavel(p_usada timestamptz, p_expira timestamptz)
  RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT coalesce(p_usada, p_expira) < now() - interval '30 days'
$$;

-- A da 0081, com o DELETE só para o que passou o prazo.
CREATE OR REPLACE FUNCTION autorizacao_faturacao_so_usar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF public.autorizacao_faturacao_apagavel(OLD.usada_em, OLD.expira_em) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'invoices.immutable: uma autorização só se apaga 30 dias depois de usada ou expirada';
  END IF;
  IF OLD.usada_em IS NOT NULL
     OR NEW.usada_em IS NULL
     OR ROW(NEW.id, NEW.comerciante_id, NEW.ligacao_id, NEW.empresa, NEW.resumo, NEW.criada_por,
            NEW.criada_em, NEW.expira_em)
        IS DISTINCT FROM
        ROW(OLD.id, OLD.comerciante_id, OLD.ligacao_id, OLD.empresa, OLD.resumo, OLD.criada_por,
            OLD.criada_em, OLD.expira_em) THEN
    RAISE EXCEPTION 'invoices.immutable: uma autorização só se marca usada, uma vez';
  END IF;
  RETURN NEW;
END
$$;

-- Os comerciantes que podem ter pedidos: quem pediu era um membro ou uma
-- chave do comerciante (0081, `criada_por`). Sem filtro de fim, para apanhar
-- também os que já não têm ninguém activo.
CREATE FUNCTION autorizacao_faturacao_comerciantes() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT m.comerciante_id FROM public.membro m
  UNION
  SELECT k.comerciante_id FROM public.chave_api k
  ORDER BY 1
$$;

-- A tarefa diária. Por comerciante, por causa do RLS forçado da tabela; até
-- 50 000 linhas por corrida, como a 0026: o resto fica para o dia seguinte e
-- a verificação avisa se se acumular. Devolve quantas apagou.
CREATE FUNCTION faturacao_autorizacoes_apagar() RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  anterior text := pg_catalog.current_setting('eurolify.comerciante', true);
  c uuid;
  n integer;
  total integer := 0;
BEGIN
  FOR c IN SELECT x FROM public.autorizacao_faturacao_comerciantes() x LOOP
    EXIT WHEN total >= 50000;
    PERFORM pg_catalog.set_config('eurolify.comerciante', c::text, true);
    DELETE FROM public.autorizacao_faturacao a WHERE a.id IN (
      SELECT x.id FROM public.autorizacao_faturacao x
      WHERE x.comerciante_id = c
        AND public.autorizacao_faturacao_apagavel(x.usada_em, x.expira_em)
      LIMIT 50000 - total);
    GET DIAGNOSTICS n = ROW_COUNT;
    total := total + n;
  END LOOP;
  PERFORM pg_catalog.set_config('eurolify.comerciante', coalesce(anterior, ''), true);
  RETURN total;
END
$$;

-- A verificação diária: as linhas que a limpeza já devia ter apagado há mais
-- de um dia. Só a contagem, de todos os comerciantes, sem identificadores.
-- VOLATILE: muda um parâmetro da sessão, como a 0088.
CREATE FUNCTION faturacao_autorizacoes_em_atraso() RETURNS bigint
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  anterior text := pg_catalog.current_setting('eurolify.comerciante', true);
  c uuid;
  n bigint := 0;
BEGIN
  FOR c IN SELECT x FROM public.autorizacao_faturacao_comerciantes() x LOOP
    PERFORM pg_catalog.set_config('eurolify.comerciante', c::text, true);
    n := n + (SELECT count(*) FROM public.autorizacao_faturacao a
      WHERE a.comerciante_id = c
        AND public.autorizacao_faturacao_apagavel(a.usada_em + interval '1 day',
                                                  a.expira_em + interval '1 day'));
  END LOOP;
  PERFORM pg_catalog.set_config('eurolify.comerciante', coalesce(anterior, ''), true);
  RETURN n;
END
$$;

-- ------------------------------------------------------------ Permissões

REVOKE EXECUTE ON FUNCTION autorizacao_faturacao_apagavel(timestamptz, timestamptz),
  autorizacao_faturacao_comerciantes(), faturacao_autorizacoes_apagar(),
  faturacao_autorizacoes_em_atraso() FROM PUBLIC;
-- O gatilho corre com quem apaga; só o dono e a função apagam.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'eurolify_limpeza') THEN
    GRANT EXECUTE ON FUNCTION faturacao_autorizacoes_apagar(),
      faturacao_autorizacoes_em_atraso() TO eurolify_limpeza;
  END IF;
END
$$;
