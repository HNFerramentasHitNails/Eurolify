-- Clientes: a régua do marketing numa ficha com fusões (Diogo, 10/10/2026,
-- em resposta à pergunta deixada na 2b: docs/06, DH; docs/23 §3.7). Ex.: a
-- Ana tinha retirado o e-mail na ficha antiga e aceitado na nova; fundidas,
-- a ficha fica sem marketing por e-mail até ela aceitar outra vez, já na
-- ficha fundida.
--
-- As regras, canal a canal (e-mail, SMS, WhatsApp; nunca um campo único):
-- 1. se alguma das fichas tem a última declaração «retirou», não há
--    marketing; um «sim» de outra ficha, mesmo mais recente, não o vence (o
--    «não» prevalece: a fusão junta fichas por sinais e decisão de uma
--    pessoa, não por prova de que são a mesma pessoa);
-- 2. uma ficha com «aceitou» e outra que nunca foi perguntada (sem
--    declarações): fica o «sim». A prova não se move: fica na ficha onde foi
--    dada e a ficha fundida lê-a pelo grupo (a lista dos consentimentos
--    mostra o grupo inteiro);
-- 3. uma declaração feita **depois** da fusão, na ficha que ficou (ou pelo
--    id antigo, que vai para lá), vale para as fichas que já lá estavam: é a
--    pessoa a decidir sobre a ficha fundida. Antes da fusão, cada ficha só
--    responde por si;
-- 4. sem nenhuma declaração, não.
-- O histórico das fichas originais fica (os consentimentos só se
-- acrescentam), e por isso dá para mostrar porque é que a ficha fundida tem
-- o valor que tem.
--
-- A base legal de juntar consentimentos de fichas diferentes continua C
-- (jurista, com a V4).

SET LOCAL lock_timeout = '10s';

-- A hora a que cada ficha foi fundida. As que já estavam fundidas: a hora da
-- última alteração, que é a da fusão (uma fundida não muda depois; a
-- pseudonimização muda-a, mas apaga também os consentimentos).
ALTER TABLE cliente ADD COLUMN fundido_quando timestamptz;
-- Sem os gatilhos: preencher a coluna não é uma alteração da ficha (sem
-- evento, sem linha do tempo, sem versão nova). Voltam como estavam (o rasto
-- sempre ligado).
ALTER TABLE cliente DISABLE TRIGGER cliente_antes_de_gravar;
ALTER TABLE cliente DISABLE TRIGGER cliente_rasto;
ALTER TABLE cliente DISABLE TRIGGER cliente_evento;
ALTER TABLE cliente DISABLE TRIGGER cliente_sinalizar_duplicados;
-- O dono, com o RLS forçado, não vê fichas sem comerciante posto: largado só
-- para preencher.
ALTER TABLE cliente NO FORCE ROW LEVEL SECURITY;
UPDATE cliente SET fundido_quando = actualizado_em WHERE fundido_em IS NOT NULL;
ALTER TABLE cliente FORCE ROW LEVEL SECURITY;
ALTER TABLE cliente ENABLE TRIGGER cliente_antes_de_gravar;
ALTER TABLE cliente ENABLE ALWAYS TRIGGER cliente_rasto;
ALTER TABLE cliente ENABLE TRIGGER cliente_evento;
ALTER TABLE cliente ENABLE TRIGGER cliente_sinalizar_duplicados;
ALTER TABLE cliente ADD CONSTRAINT cliente_fundido_quando
  CHECK ((fundido_em IS NULL) = (fundido_quando IS NULL));

CREATE OR REPLACE FUNCTION cliente_antes_de_gravar() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.estado <> 'activo' THEN
      RAISE EXCEPTION 'customers.invalid_transition: uma ficha nasce activa';
    END IF;
    NEW.fundido_quando := NULL;
    NEW.versao := 1;
    NEW.criado_em := now();
    NEW.actualizado_em := now();
    RETURN NEW;
  END IF;
  IF NEW.id <> OLD.id OR NEW.comerciante_id <> OLD.comerciante_id THEN
    RAISE EXCEPTION 'customers.immutable_identity: o id e o comerciante de uma ficha não mudam';
  END IF;
  -- Só a pseudonimização mexe numa ficha que não está activa (as fundidas
  -- do grupo).
  IF OLD.estado <> 'activo' AND NOT public.clientes_pseudonimizacao_em_curso() THEN
    RAISE EXCEPTION 'customers.invalid_transition: uma ficha % não se altera', OLD.estado;
  END IF;
  -- Limitada, a API não lhe muda os dados pessoais (trava alterações sem
  -- apagar); levanta-se a limitação primeiro. As funções do dono (fusão,
  -- pseudonimização) passam.
  IF OLD.limitado AND NEW.limitado AND NOT public.clientes_dono_a_escrever()
     AND (NEW.nome IS DISTINCT FROM OLD.nome OR NEW.emails IS DISTINCT FROM OLD.emails
       OR NEW.telefones IS DISTINCT FROM OLD.telefones
       OR NEW.lingua IS DISTINCT FROM OLD.lingua OR NEW.pais IS DISTINCT FROM OLD.pais) THEN
    RAISE EXCEPTION 'customers.restricted: a ficha está limitada a pedido do titular; levante a limitação para a alterar';
  END IF;
  -- A hora da fusão (0050): só a passagem a fundido a põe; depois não muda.
  IF NEW.estado = 'fundido' AND OLD.estado <> 'fundido' THEN
    NEW.fundido_quando := clock_timestamp();
  ELSE
    NEW.fundido_quando := OLD.fundido_quando;
  END IF;
  NEW.criado_em := OLD.criado_em;
  NEW.actualizado_em := now();
  NEW.versao := OLD.versao + 1;
  RETURN NEW;
END
$$;

-- A régua sobre um conjunto de fichas (as de um grupo). Para cada ficha, a
-- última declaração que a cobre: as dela e as que foram feitas numa ficha
-- acima dela depois de ela lá ter entrado. Um empate dá «retirou». O
-- resultado é sim só se todas as fichas com declaração têm «aceitou» na
-- última; sem nenhuma, não. É a única que conta declarações: a
-- pode_receber_marketing e o ensaio da fusão chamam-na (R6).
CREATE OR REPLACE FUNCTION regua_marketing(p_comerciante uuid, p_clientes uuid[], p_canal text)
  RETURNS boolean
  LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  WITH RECURSIVE caminho (ficha, acima, desde, passos) AS (
    SELECT c.id, c.id, '-infinity'::timestamptz, 0
    FROM public.cliente c
    WHERE c.comerciante_id = p_comerciante AND c.id = ANY (p_clientes)
    UNION ALL
    -- Sobe uma fusão: as declarações de lá só contam depois da hora em que
    -- esta ficha (ou a de baixo) lá entrou.
    SELECT k.ficha, c.fundido_em, greatest(k.desde, c.fundido_quando), k.passos + 1
    FROM caminho k
    JOIN public.cliente c ON c.comerciante_id = p_comerciante AND c.id = k.acima
    WHERE c.fundido_em = ANY (p_clientes) AND k.passos < 100
  ),
  ultima AS (
    SELECT DISTINCT ON (k.ficha) k.ficha, d.declaracao
    FROM caminho k
    JOIN public.consentimento d
      ON d.comerciante_id = p_comerciante AND d.cliente_id = k.acima
     AND d.canal = p_canal AND d.finalidade = 'marketing' AND d.declarado_em > k.desde
    ORDER BY k.ficha, d.declarado_em DESC, (d.declaracao = 'aceitou')
  )
  SELECT coalesce(bool_and(u.declaracao = 'aceitou'), false) FROM ultima u
$$;
