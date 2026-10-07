-- Reverificar as publicações quando muda o que a verificação lê (docs/14 §8;
-- issue #77). Decisão do Diogo, 07/10/2026 (opção a; docs/06, CJ): uma
-- publicação publicada que deixa de passar na verificação sai de venda
-- sozinha, com o motivo `verificacao_falhou` e os impedimentos guardados em
-- `ultima_verificacao`. Ex.: tirar a classificação a um artigo publicado
-- arquiva as publicações dele na mesma transacção, e o evento
-- `product.unpublished` (0021) leva o motivo.
--
-- O que esta migração faz: acrescenta o motivo à lista fechada da 0019.
--
-- O que não faz (e onde fica): a reverificação corre no servidor
-- (`src/catalogo/publicacao.ts`, `reverificarPublicacoes`), chamada pelas
-- cinco operações que mudam o que a verificação lê e que a base não trava
-- (docs/14 §8). A verificação é do servidor (C2): repeti-la em gatilhos
-- seria a mesma regra em dois sítios. O limite: SQL à mão que mude um desses
-- campos não reverifica (como a C2 não corre em SQL à mão).

SET LOCAL lock_timeout = '10s';

ALTER TABLE publicacao DROP CONSTRAINT publicacao_motivo_arquivo_check;
ALTER TABLE publicacao ADD CONSTRAINT publicacao_motivo_arquivo_check
  CHECK (motivo_arquivo IS NULL OR motivo_arquivo IN (
    'retirada', 'artigo_arquivado', 'mercado_arquivado', 'canal_arquivado',
    'verificacao_falhou'));
