-- Uma empresa do emissor, uma ligação só (docs/29 §19; revisão do #407,
-- P2-1; Diogo, 14/10/2026: «sim, aprovo o desenho com a Q1 em B»; docs/06,
-- EP). Ex.: a «Loja Exemplo» liga a empresa 401965 do Moloni; outra loja,
-- com o código de autorização dessa empresa, já não a consegue ligar à sua.
--
-- O `company_id` só vivia dentro das credenciais cifradas: a base não o via.
-- Passa a ficar à vista em `conta_emissor` (não é segredo nem dado pessoal),
-- escrito pela API na mesma escrita das credenciais, e um índice único
-- impede a mesma conta em duas ligações activas do mesmo emissor, de
-- qualquer comerciante (o RLS esconde as dos outros; o índice não).
--
-- As ligações Moloni que já existem não têm a conta: as prontas passam a
-- «por testar», e o teste (`testarLigacao`) preenche-a a partir das
-- credenciais. Hoje só há ligações de ensaio (ADR-0019).
SET LOCAL lock_timeout = '10s';

ALTER TABLE ligacao_faturacao
  ADD COLUMN conta_emissor text CHECK (conta_emissor ~ '^[A-Za-z0-9._:-]{1,64}$');

CREATE UNIQUE INDEX ligacao_faturacao_uma_por_conta
  ON ligacao_faturacao (adaptador, conta_emissor)
  WHERE activa AND conta_emissor IS NOT NULL;

-- A migração corre sem comerciante: o NO FORCE só dura esta transacção.
ALTER TABLE ligacao_faturacao NO FORCE ROW LEVEL SECURITY;
UPDATE ligacao_faturacao SET estado = 'por_testar'
WHERE adaptador = 'moloni' AND estado = 'pronta' AND conta_emissor IS NULL;
ALTER TABLE ligacao_faturacao FORCE ROW LEVEL SECURITY;

-- Uma ligação Moloni pronta diz a conta: sem ela, não emite.
ALTER TABLE ligacao_faturacao ADD CONSTRAINT ligacao_faturacao_pronta_com_conta
  CHECK (estado <> 'pronta' OR adaptador <> 'moloni' OR conta_emissor IS NOT NULL);

GRANT UPDATE (conta_emissor) ON ligacao_faturacao TO eurolify_api;
