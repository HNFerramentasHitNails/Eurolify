-- Relatório OSS: uma prova sem linhas declarada à parte (docs/37 §11; 3.ª
-- revisão do #392, P3-7; Diogo, 13/10/2026: «sim, aprovo a saída A» e «sim,
-- aprovo o desenho do §11»; docs/06, EL). Ex.: a FT 1/123 chega do emissor
-- sem linhas; a divergência é aceite; o dono declara-a à parte, com motivo,
-- e o valor declara-se à mão a partir do documento emitido.
--
-- Na mesma tabela da classificação (uma decisão por documento, só se
-- acrescenta): `a_parte` verdadeiro só com as linhas vazias; falso só com
-- pelo menos uma linha. As classificações que já existem têm linhas, por
-- isso ficam `a_parte = false`.
SET LOCAL lock_timeout = '10s';

ALTER TABLE relatorio_oss_classificacao
  ADD COLUMN a_parte boolean NOT NULL DEFAULT false;

ALTER TABLE relatorio_oss_classificacao
  DROP CONSTRAINT relatorio_oss_classificacao_linhas_check;
ALTER TABLE relatorio_oss_classificacao
  ADD CONSTRAINT relatorio_oss_classificacao_linhas_check CHECK (
    jsonb_typeof(linhas) = 'array' AND a_parte = (jsonb_array_length(linhas) = 0)
  );

GRANT INSERT (a_parte) ON relatorio_oss_classificacao TO eurolify_api;
