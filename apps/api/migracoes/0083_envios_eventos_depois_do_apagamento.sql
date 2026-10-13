-- O que a transportadora manda depois do apagamento do titular (revisão do
-- #414, P3-1; Diogo, 13/10/2026: «sim, avança num pedido à parte»; issue
-- #233). Ex.: a encomenda da Ana é limpa a 1/11; a 3/11 a transportadora
-- reenvia «Entregue a Ana Silva». Até aqui o evento entrava com o nome e
-- nada o voltava a limpar: a limpeza da 0079 corre uma vez, quando a
-- encomenda é limpa.
--
-- Agora, numa encomenda já limpa:
-- - o evento de seguimento grava-se logo com o marcador no texto da
--   transportadora (o estado normalizado e a data ficam: mudam a expedição);
-- - o aviso em bruto, quando se liga à expedição, passa ao marcador (como a
--   0079 faz no apagamento).
-- Uma encomenda em curso do titular apagado ainda não está limpa: quando
-- acabar, a limpeza da 0079 apanha os eventos que entretanto chegaram.

SET LOCAL lock_timeout = '10s';

-- A encomenda da expedição já foi limpa pelo apagamento do titular: o
-- e-mail do contacto é o marcador (titular_limpar_encomenda, 0072). Só o
-- e-mail: o nome é texto livre e um cliente podia escrever o marcador; o
-- e-mail tem de ter «@» (revisão do #420, P2-2).
--
-- A leitura toma a encomenda (FOR KEY SHARE): um apagamento a meio tem-na
-- FOR UPDATE (0072), e o evento ou o aviso esperam por ele e lêem-na já
-- limpa; se chegaram primeiro, é o apagamento que espera e já os vê
-- (revisão do #420, P2-1). Por isso VOLATILE (um FOR não corre em STABLE).
CREATE FUNCTION envios_encomenda_limpa(p_expedicao uuid) RETURNS boolean
  LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  email text;
BEGIN
  SELECT e.contacto ->> 'email' INTO email
  FROM public.expedicao x
  JOIN public.encomenda e ON e.comerciante_id = x.comerciante_id AND e.id = x.encomenda_id
  WHERE x.id = p_expedicao
  FOR KEY SHARE OF e;
  RETURN email IS NOT DISTINCT FROM '(pseudonimizado)';
END
$$;

CREATE FUNCTION evento_seguimento_ao_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF public.envios_encomenda_limpa(NEW.expedicao_id) THEN
    NEW.estado_transportadora := '(pseudonimizado)';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER evento_seguimento_ao_gravar
  BEFORE INSERT ON evento_seguimento
  FOR EACH ROW EXECUTE FUNCTION evento_seguimento_ao_gravar();
ALTER TABLE evento_seguimento ENABLE ALWAYS TRIGGER evento_seguimento_ao_gravar;

-- O aviso: o mesmo gatilho da 0079, e ao ligar-se a uma expedição de uma
-- encomenda limpa o corpo passa ao marcador (é a única mudança ao corpo
-- fora da marca da 0049).
CREATE OR REPLACE FUNCTION aviso_transportadora_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND public.titular_limpeza_permitida(to_jsonb(OLD), to_jsonb(NEW),
       ARRAY['corpo']) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'shipping.immutable: um aviso não se apaga';
  END IF;
  IF (to_jsonb(NEW) - 'expedicao_id' - 'resultado' - 'erro' - 'processado_em')
     IS DISTINCT FROM (to_jsonb(OLD) - 'expedicao_id' - 'resultado' - 'erro' - 'processado_em') THEN
    RAISE EXCEPTION 'shipping.immutable: o aviso em bruto não muda';
  END IF;
  IF OLD.resultado IS NOT NULL AND OLD.resultado <> 'erro' THEN
    RAISE EXCEPTION 'shipping.immutable: um aviso tratado não muda';
  END IF;
  IF OLD.expedicao_id IS NULL AND NEW.expedicao_id IS NOT NULL
     AND public.envios_encomenda_limpa(NEW.expedicao_id) THEN
    NEW.corpo := '(pseudonimizado)';
  END IF;
  RETURN NEW;
END
$$;

REVOKE EXECUTE ON FUNCTION envios_encomenda_limpa(uuid), evento_seguimento_ao_gravar()
  FROM PUBLIC;
-- O gatilho corre com quem grava (a API) e chama a função.
GRANT EXECUTE ON FUNCTION envios_encomenda_limpa(uuid) TO eurolify_api;
