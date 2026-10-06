-- A chave pública de uma loja arquivada deixa de funcionar (Diogo,
-- 06/10/2026: «sim, concordo, deixa de funcionar»; decisão AY; e, se a loja
-- voltar a activa, as antigas não voltam: «fica a a)»; docs/19 §5, T13;
-- issue #107). Ex.: a loja «Espanha» é arquivada a 10/11/2026; o site que a
-- mostrava pela chave pública passa a receber 401 e, se a loja reabrir em
-- janeiro, precisa de uma chave nova.
--
-- O que esta migração faz:
-- - ao arquivar uma loja, as chaves públicas dela ficam revogadas, com
--   `revogada_por = 'loja_arquivada:sto_<id>'`. A revogação é a que já existe
--   (0010): o resolver já não as aceita e a linha fica para o registo. Fica
--   num gatilho da loja, SECURITY DEFINER, porque a API tem o privilégio de
--   arquivar a loja (ainda sem rota) mas nenhum na tabela das chaves (T7);
-- - não se cria nenhuma chave para uma loja arquivada, por nenhum caminho (a
--   API e o comando do operador): o gatilho da chave recusa com
--   `key.store_archived`. O FOR SHARE na loja põe em fila quem cria e quem
--   arquiva: quem arquiva primeiro faz a criação ler a loja já arquivada
--   (recusa); quem cria primeiro faz o arquivo esperar, e a chave nova é
--   revogada com as outras. Conta com o isolamento READ COMMITTED (o da
--   API): em REPEATABLE READ, o arquivo não veria a chave nova;
-- - não trata lojas arquivadas antes desta migração: não há rota que arquive
--   lojas, só SQL à mão (revisão do #131, P3-2).
--
-- A versão anterior da API recebe `key.store_archived` como 500 (não 422)
-- enquanto as duas convivem; nenhuma chave indevida se cria.

SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION chave_api_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  estado_da_loja text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'key.immutable: uma chave não se apaga; revoga-se';
  END IF;
  IF TG_OP = 'INSERT' THEN
    -- T13: nenhuma chave para uma loja arquivada. Sem linha (loja de outro
    -- comerciante ou inexistente), a chave estrangeira recusa a seguir.
    IF NEW.loja_id IS NOT NULL THEN
      SELECT l.estado INTO estado_da_loja
      FROM public.loja l
      WHERE l.comerciante_id = NEW.comerciante_id AND l.id = NEW.loja_id
      FOR SHARE;
      IF estado_da_loja = 'arquivada' THEN
        RAISE EXCEPTION 'key.store_archived: a loja está arquivada; não se criam chaves para ela';
      END IF;
    END IF;
    NEW.criada_em := now();
    NEW.revogada_em := NULL;
    NEW.revogada_por := NULL;
    NEW.ultimo_uso_em := NULL;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.comerciante_id, NEW.tipo, NEW.loja_id, NEW.nome, NEW.ambitos,
      NEW.prefixo, NEW.resumo, NEW.criada_por, NEW.criada_em, NEW.expira_em)
     IS DISTINCT FROM
     (OLD.id, OLD.comerciante_id, OLD.tipo, OLD.loja_id, OLD.nome, OLD.ambitos,
      OLD.prefixo, OLD.resumo, OLD.criada_por, OLD.criada_em, OLD.expira_em) THEN
    RAISE EXCEPTION 'key.immutable: uma chave não se altera; cria-se outra';
  END IF;
  IF OLD.revogada_por IS NOT NULL
     AND (NEW.revogada_por, NEW.revogada_em) IS DISTINCT FROM (OLD.revogada_por, OLD.revogada_em) THEN
    RAISE EXCEPTION 'key.already_revoked: a chave já foi revogada';
  END IF;
  IF OLD.revogada_por IS NULL AND NEW.revogada_por IS NOT NULL THEN
    NEW.revogada_em := now();
  END IF;
  RETURN NEW;
END
$$;

-- Ao arquivar uma loja, as chaves dela ficam revogadas para sempre (se a loja
-- voltar a activa, criam-se chaves novas). Só o que muda de activa para
-- arquivada; uma chave já revogada fica como estava.
CREATE FUNCTION loja_revogar_chaves_ao_arquivar() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  UPDATE public.chave_api c
  SET revogada_por = 'loja_arquivada:sto_' || NEW.id::text
  WHERE c.comerciante_id = NEW.comerciante_id
    AND c.loja_id = NEW.id
    AND c.revogada_por IS NULL;
  RETURN NULL;
END
$$;

REVOKE EXECUTE ON FUNCTION loja_revogar_chaves_ao_arquivar() FROM PUBLIC;

CREATE TRIGGER loja_revogar_chaves_ao_arquivar
  AFTER UPDATE OF estado ON loja
  FOR EACH ROW
  WHEN (OLD.estado = 'activa' AND NEW.estado = 'arquivada')
  EXECUTE FUNCTION loja_revogar_chaves_ao_arquivar();
ALTER TABLE loja ENABLE ALWAYS TRIGGER loja_revogar_chaves_ao_arquivar;
