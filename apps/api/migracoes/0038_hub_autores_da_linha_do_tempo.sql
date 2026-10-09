-- Hub: o nome de quem fez cada alteração na linha do tempo do artigo
-- (docs/22 §16.2; issue #239; Diogo, 09/10/2026: «sim, avança com o código
-- do histórico do artigo»). Ex.: a entrada guardada diz `pessoa:per_…`; o
-- dono vê «Ana Teste», porque a Ana é (ou foi) da equipa deste comerciante.
--
-- A API não lê a `pessoa` (0018: sem privilégios nem política) nem tem de
-- saber de quem é cada chave: o nome sai só por esta função, que:
-- - valida a sessão e exige que quem pede seja membro activo do comerciante
--   posto, com `catalog:history` no papel (o dono e o gestor);
-- - dá o nome de uma pessoa só se ela é ou foi membro **deste** comerciante
--   (uma pessoa pseudonimizada já tem o nome «Pessoa pseudonimizada», 0026);
-- - dá o nome de uma chave só se é deste comerciante;
-- - aceita no máximo 200 identificadores de cada vez (uma página tem 100).
-- O que não vem na resposta fica sem nome no ecrã (§16.2).

SET LOCAL lock_timeout = '10s';

CREATE FUNCTION autores_da_linha_do_tempo(
  p_segredo text, p_pessoas uuid[], p_chaves uuid[])
  RETURNS TABLE (tipo text, id uuid, nome text)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  quem public.membro;
BEGIN
  quem := public.membro_de_quem_pede(p_segredo, false);
  IF NOT ('catalog:history' = ANY (public.papel_ambitos(quem.papel))) THEN
    RAISE EXCEPTION 'member.role_escalation: o papel não vê a linha do tempo';
  END IF;
  IF coalesce(cardinality(p_pessoas), 0) > 200
     OR coalesce(cardinality(p_chaves), 0) > 200 THEN
    RAISE EXCEPTION 'autores_da_linha_do_tempo: no máximo 200 identificadores de cada vez';
  END IF;
  RETURN QUERY
    SELECT 'pessoa'::text, p.id, p.nome
    FROM public.pessoa p
    WHERE p.id = ANY (coalesce(p_pessoas, '{}'))
      AND EXISTS (SELECT 1 FROM public.membro m
                  WHERE m.pessoa_id = p.id
                    AND m.comerciante_id = quem.comerciante_id)
    UNION ALL
    SELECT 'chave'::text, c.id, c.nome
    FROM public.chave_api c
    WHERE c.id = ANY (coalesce(p_chaves, '{}'))
      AND c.comerciante_id = quem.comerciante_id;
END
$$;

REVOKE ALL ON FUNCTION autores_da_linha_do_tempo(text, uuid[], uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION autores_da_linha_do_tempo(text, uuid[], uuid[]) TO eurolify_api;
