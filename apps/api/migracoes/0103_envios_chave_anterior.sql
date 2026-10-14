-- Envios: trocar a chave das credenciais sem as pedir outra vez (docs/36
-- §25; §14, P3-7; issue #393; Diogo, 14/10/2026: «sim, aprovo; avança com o
-- código»). Ex.: a ENVIOS_CHAVE pode ter sido exposta; põe-se uma nova
-- (versão «2») e a antiga passa a ENVIOS_CHAVE_ANTERIOR (versão «1»). A API
-- decifra com a anterior as contas que ainda estão nela e volta a cifrá-las
-- com a nova; quando não falta nenhuma, tira-se a anterior.
-- - Voltar a cifrar muda a cifra e a versão da chave, mas não as
--   credenciais: a conta pronta não volta a rascunho. Credenciais novas
--   (a cifra muda e a versão fica) continuam a devolvê-la a rascunho.
-- - Quais contas faltam é uma leitura entre comerciantes, como o trabalho
--   dos envios (0079): só a função a faz, e só devolve identificadores.
SET LOCAL lock_timeout = '10s';

-- --------------------------------- A conta pronta não cai por voltar a cifrar

CREATE OR REPLACE FUNCTION conta_transportadora_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'shipping.immutable: uma conta de transportadora não se apaga (arquiva-se)';
  END IF;
  IF NEW.transportadora IS DISTINCT FROM OLD.transportadora OR NEW.modo IS DISTINCT FROM OLD.modo
     OR NEW.comerciante_id IS DISTINCT FROM OLD.comerciante_id THEN
    RAISE EXCEPTION 'shipping.immutable: a transportadora e o modo de uma conta não mudam';
  END IF;
  IF OLD.estado = 'arquivada' THEN
    RAISE EXCEPTION 'shipping.immutable: uma conta arquivada não muda';
  END IF;
  -- Com a mesma versão da chave, uma cifra nova são credenciais novas: a
  -- conta volta a rascunho até à chamada de teste. Com outra versão é a
  -- troca da chave (§25), que não muda o que está cifrado.
  IF (NEW.credenciais_cifra IS DISTINCT FROM OLD.credenciais_cifra
      OR NEW.segredo_aviso_cifra IS DISTINCT FROM OLD.segredo_aviso_cifra)
     AND NEW.chave_versao IS NOT DISTINCT FROM OLD.chave_versao THEN
    IF NEW.estado = 'pronta' AND NEW.testada_em IS NOT DISTINCT FROM OLD.testada_em THEN
      NEW.estado := 'rascunho';
      NEW.testada_em := NULL;
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- ------------------------------------------- As contas por voltar a cifrar

-- As contas não arquivadas com credenciais cifradas por outra versão da
-- chave, de todos os comerciantes (a tarefa entra depois em cada um). Só
-- identificadores; o limite protege uma volta. Comerciante a comerciante
-- (o RLS da conta é forçado), pela porta dos avisos, que conhece todas as
-- contas, como `envios_avisos_resumir` (0079).
CREATE FUNCTION envios_contas_por_recifrar(p_versao text, p_limite integer)
  RETURNS TABLE (comerciante_id uuid, conta_id uuid)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  antes text := current_setting('eurolify.comerciante', true);
  c uuid;
  n integer := 0;
  limite integer := greatest(least(p_limite, 1000), 0);
BEGIN
  FOR c IN SELECT DISTINCT p.comerciante_id FROM public.conta_transportadora_aviso p
           ORDER BY p.comerciante_id LOOP
    EXIT WHEN n >= limite;
    PERFORM set_config('eurolify.comerciante', c::text, true);
    FOR conta_id IN
      SELECT k.id FROM public.conta_transportadora k
      WHERE k.comerciante_id = c AND k.estado <> 'arquivada'
        AND k.chave_versao IS NOT NULL AND k.chave_versao <> p_versao
      ORDER BY k.id
      LIMIT limite - n
    LOOP
      comerciante_id := c;
      n := n + 1;
      RETURN NEXT;
    END LOOP;
  END LOOP;
  PERFORM set_config('eurolify.comerciante', coalesce(antes, ''), true);
END
$$;

REVOKE ALL ON FUNCTION envios_contas_por_recifrar(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION envios_contas_por_recifrar(text, integer) TO eurolify_api;
