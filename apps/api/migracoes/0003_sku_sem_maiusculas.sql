-- Catálogo: «GEL-001» e «gel-001» são o mesmo SKU (docs/14 §9, P9; decisão
-- do Diogo, 05/10/2026: «sim, mesmo SKU»). O SKU guarda-se como foi escrito,
-- mas é único por comerciante sem distinguir maiúsculas — também contra as
-- variantes arquivadas (P7) e com a excepção da P8 (variante apagada de um
-- rascunho), que não muda.
--
-- O SKU só aceita letras sem acentos, algarismos e «. _ / -» (CHECK da 0002).
-- Com SKU só em ASCII, lower() dá o mesmo resultado nos locales usuais; um
-- locale com regras próprias para o «I» (o turco, por exemplo) daria outro,
-- mas o índice e a procura usam a mesma função, por isso continuam de acordo.
-- Não verifiquei o locale da base na VPS.
--
-- Se já houver dois SKU iguais sem contar as maiúsculas no mesmo comerciante,
-- o índice não se cria e a migração inteira falha sem mudar nada (a
-- publicação pára e fica a versão anterior): resolve-se à mão, com uma pessoa
-- a decidir, antes de a correr outra vez. Para ver quais são:
--   SELECT comerciante_id, lower(sku), array_agg(sku), count(*)
--   FROM variante GROUP BY 1, 2 HAVING count(*) > 1;

ALTER TABLE variante DROP CONSTRAINT variante_sku_unico;

-- O mesmo nome, para o código traduzir o erro como antes (catalog.sku_duplicate).
CREATE UNIQUE INDEX variante_sku_unico ON variante (comerciante_id, lower(sku));
