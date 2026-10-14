-- Envios: trocar a chave das credenciais sem as pedir outra vez (docs/36
-- §25; §14, P3-7; issue #393; Diogo, 14/10/2026: «sim, aprovo; avança com o
-- código»). Ex.: a ENVIOS_CHAVE pode ter sido exposta; põe-se uma nova
-- (versão «2») e a antiga passa a ENVIOS_CHAVE_ANTERIOR (versão «1»). A API
-- decifra com a anterior as contas que ainda estão nela e volta a cifrá-las
-- com a nova; quando não falta nenhuma, tira-se a anterior.
-- - Voltar a cifrar muda a cifra e a versão da chave, mas não as
--   credenciais nem quem as pôs: a conta pronta não volta a rascunho.
--   Credenciais novas (mudam `credenciais_em`) continuam a devolvê-la a
--   rascunho, com qualquer versão (revisão do #466, P2-2).
-- - Uma conta arquivada ainda segue as expedições que já tinham etiqueta:
--   também passa para a chave nova, e só a cifra e a versão mudam nela
--   (revisão do #466, P1-3).
-- - Quais contas faltam é uma leitura entre comerciantes, como o trabalho
--   dos envios (0079): só a função a faz, e só devolve identificadores.
SET LOCAL lock_timeout = '10s';

-- --------------------------------- A conta pronta não cai por voltar a cifrar

CREATE OR REPLACE FUNCTION conta_transportadora_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  troca boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'shipping.immutable: uma conta de transportadora não se apaga (arquiva-se)';
  END IF;
  IF NEW.transportadora IS DISTINCT FROM OLD.transportadora OR NEW.modo IS DISTINCT FROM OLD.modo
     OR NEW.comerciante_id IS DISTINCT FROM OLD.comerciante_id THEN
    RAISE EXCEPTION 'shipping.immutable: a transportadora e o modo de uma conta não mudam';
  END IF;
  -- A troca da chave (§25): outra versão, as mesmas credenciais (nem
  -- `credenciais_em` nem `credenciais_por` mudam) e nada mais na conta.
  troca := NEW.chave_versao IS DISTINCT FROM OLD.chave_versao
    AND NEW.credenciais_em IS NOT DISTINCT FROM OLD.credenciais_em
    AND NEW.credenciais_por IS NOT DISTINCT FROM OLD.credenciais_por;
  IF OLD.estado = 'arquivada' THEN
    -- Numa arquivada, só a troca da chave, e só a cifra e a versão.
    IF NOT troca OR (to_jsonb(NEW) - ARRAY['credenciais_cifra', 'segredo_aviso_cifra', 'chave_versao'])
                    IS DISTINCT FROM
                    (to_jsonb(OLD) - ARRAY['credenciais_cifra', 'segredo_aviso_cifra', 'chave_versao']) THEN
      RAISE EXCEPTION 'shipping.immutable: uma conta arquivada não muda';
    END IF;
    RETURN NEW;
  END IF;
  -- Uma cifra nova fora da troca da chave são credenciais novas: a conta
  -- volta a rascunho até à chamada de teste.
  IF (NEW.credenciais_cifra IS DISTINCT FROM OLD.credenciais_cifra
      OR NEW.segredo_aviso_cifra IS DISTINCT FROM OLD.segredo_aviso_cifra)
     AND NOT troca THEN
    IF NEW.estado = 'pronta' AND NEW.testada_em IS NOT DISTINCT FROM OLD.testada_em THEN
      NEW.estado := 'rascunho';
      NEW.testada_em := NULL;
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- ------------------------------------------- As contas por voltar a cifrar

-- As contas com credenciais cifradas por outra versão da chave que não
-- `p_versao` (a actual), de todos os comerciantes, com a versão em que estão;
-- com `p_so_versao`, só as dessa versão (a anterior: as que se podem passar
-- já, sem que as que nenhuma chave abre lhes tirem a vez; revisão do #466,
-- P2-1). Também as arquivadas (P1-3). Só identificadores; o limite protege
-- uma volta. Comerciante a comerciante (o RLS da conta é forçado), pela
-- porta dos avisos, que conhece todas as contas, como
-- `envios_avisos_resumir` (0079).
CREATE FUNCTION envios_contas_por_recifrar(p_versao text, p_so_versao text, p_limite integer)
  RETURNS TABLE (comerciante_id uuid, conta_id uuid, chave_versao text)
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
    FOR conta_id, chave_versao IN
      SELECT k.id, k.chave_versao FROM public.conta_transportadora k
      WHERE k.comerciante_id = c
        AND k.chave_versao IS NOT NULL AND k.chave_versao <> p_versao
        AND (p_so_versao IS NULL OR k.chave_versao = p_so_versao)
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

REVOKE ALL ON FUNCTION envios_contas_por_recifrar(text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION envios_contas_por_recifrar(text, text, integer) TO eurolify_api;
