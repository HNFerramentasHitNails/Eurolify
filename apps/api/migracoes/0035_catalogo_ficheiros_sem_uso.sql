-- Os ficheiros de imagem sem uso (docs/14 §3.5, «Metadados, pessoas nas
-- imagens e ficheiros sem uso»; issue #179; Diogo, 09/10/2026: «sim, aprovo;
-- avança com o código da #179»). Ex.: o comerciante envia três fotografias do
-- «Gel UV», liga duas ao artigo e apaga uma delas mais tarde; a que nunca foi
-- ligada e a que foi desligada saem ao fim de 7 dias sem uso.
--
-- O que esta migração faz:
-- - a tabela interna `ficheiro_sem_uso`: uma linha por ficheiro que nenhuma
--   media usa, com o instante desde quando. Escrevem-na os gatilhos (ao
--   gravar o ficheiro, ao ligar e ao desligar uma media); a API não lhe toca.
--   Fica à parte da `ficheiro` (que tem o RLS forçado) para que a função que
--   diz que comerciantes têm ficheiros a apagar os veja a todos, só com os
--   identificadores;
-- - os 7 dias (**proposta**) vivem só aqui, nas funções;
-- - as funções que a API chama (com os direitos do dono): os comerciantes
--   com ficheiros a apagar; os ficheiros a apagar de um comerciante (no
--   contexto dele); apagar um, só se continuar sem media e com mais de 7
--   dias. O disco apaga-o a API, na mesma transacção e com a fila dos envios
--   do comerciante tomada (catalogo/limpeza-ficheiros.ts);
-- - a contagem para a verificação diária (`eurolify_limpeza`): ficheiros sem
--   uso há mais de 9 dias, sinal de que a limpeza parou.
--
-- O que não faz (e onde fica):
-- - os ficheiros gravados no disco sem linha na tabela (só se o COMMIT de um
--   envio falhar depois de gravar): uma volta que compare o disco com a
--   tabela fica para depois (docs/14 §3.5);
-- - as cópias: um ficheiro apagado fica nelas até rodarem (14 dias, docs/11).

SET LOCAL lock_timeout = '10s';

CREATE TABLE ficheiro_sem_uso (
  comerciante_id uuid NOT NULL,
  resumo text NOT NULL,
  desde timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (comerciante_id, resumo),
  FOREIGN KEY (comerciante_id, resumo)
    REFERENCES ficheiro (comerciante_id, resumo) ON DELETE CASCADE
);
CREATE INDEX ficheiro_sem_uso_por_data ON ficheiro_sem_uso (desde);
-- RLS sem forçar: o dono (as funções abaixo) vê todos; a API não tem
-- privilégio nenhum na tabela.
ALTER TABLE ficheiro_sem_uso ENABLE ROW LEVEL SECURITY;
CREATE POLICY so_o_proprio ON ficheiro_sem_uso
  USING (comerciante_id = comerciante_actual())
  WITH CHECK (comerciante_id = comerciante_actual());

-- Os que já existem e não têm media começam a contar agora. O dono das
-- tabelas lê-os todos só durante esta migração: o RLS forçado volta logo a
-- seguir (sem ele, a leitura pedia um comerciante posto).
ALTER TABLE ficheiro NO FORCE ROW LEVEL SECURITY;
ALTER TABLE media NO FORCE ROW LEVEL SECURITY;
INSERT INTO ficheiro_sem_uso (comerciante_id, resumo)
SELECT f.comerciante_id, f.resumo FROM ficheiro f
WHERE NOT EXISTS (
  SELECT FROM media m
  WHERE m.comerciante_id = f.comerciante_id AND m.ficheiro_resumo = f.resumo);
ALTER TABLE ficheiro FORCE ROW LEVEL SECURITY;
ALTER TABLE media FORCE ROW LEVEL SECURITY;

-- Um ficheiro novo começa sem uso.
CREATE FUNCTION ficheiro_sem_uso_ao_gravar() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  INSERT INTO public.ficheiro_sem_uso (comerciante_id, resumo)
  VALUES (NEW.comerciante_id, NEW.resumo)
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END
$$;
CREATE TRIGGER ficheiro_sem_uso_ao_gravar
  AFTER INSERT ON ficheiro
  FOR EACH ROW EXECUTE FUNCTION ficheiro_sem_uso_ao_gravar();

-- Ligar uma media tira o ficheiro da lista; desligar a última põe-no.
-- Desligar toma a linha do ficheiro (FOR UPDATE): duas medias do mesmo
-- ficheiro desligadas ao mesmo tempo não se vêem uma à outra e o ficheiro
-- ficava fora da lista; com a linha tomada, a segunda vê a primeira já
-- confirmada. Ligar toma a mesma linha (FOR KEY SHARE, pela chave
-- estrangeira), por isso também espera.
CREATE FUNCTION ficheiro_sem_uso_pela_media() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    DELETE FROM public.ficheiro_sem_uso s
    WHERE s.comerciante_id = NEW.comerciante_id AND s.resumo = NEW.ficheiro_resumo;
    RETURN NULL;
  END IF;
  PERFORM FROM public.ficheiro f
  WHERE f.comerciante_id = OLD.comerciante_id AND f.resumo = OLD.ficheiro_resumo
  FOR UPDATE;
  IF NOT EXISTS (
    SELECT FROM public.media m
    WHERE m.comerciante_id = OLD.comerciante_id
      AND m.ficheiro_resumo = OLD.ficheiro_resumo) THEN
    INSERT INTO public.ficheiro_sem_uso (comerciante_id, resumo)
    VALUES (OLD.comerciante_id, OLD.ficheiro_resumo)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER ficheiro_sem_uso_pela_media
  AFTER INSERT OR DELETE ON media
  FOR EACH ROW EXECUTE FUNCTION ficheiro_sem_uso_pela_media();

-- Os comerciantes com ficheiros sem uso há mais de 7 dias (só os ids).
CREATE FUNCTION ficheiros_comerciantes_sem_uso() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT DISTINCT s.comerciante_id FROM public.ficheiro_sem_uso s
  WHERE s.desde < now() - interval '7 days'
$$;

-- Os ficheiros sem uso há mais de 7 dias do comerciante posto, os mais
-- antigos primeiro.
CREATE FUNCTION ficheiros_sem_uso(p_limite integer) RETURNS SETOF text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT s.resumo FROM public.ficheiro_sem_uso s
  WHERE s.comerciante_id = public.comerciante_actual()
    AND s.desde < now() - interval '7 days'
  ORDER BY s.desde, s.resumo
  LIMIT greatest(p_limite, 0)
$$;

-- Apaga a linha de um ficheiro do comerciante posto, só se continuar sem
-- media e sem uso há mais de 7 dias. Diz se apagou: a API só apaga o disco
-- quando sim.
CREATE FUNCTION ficheiro_apagar_sem_uso(p_resumo text) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  apagados integer;
BEGIN
  DELETE FROM public.ficheiro f
  WHERE f.comerciante_id = public.comerciante_actual()
    AND f.resumo = p_resumo
    AND EXISTS (
      SELECT FROM public.ficheiro_sem_uso s
      WHERE s.comerciante_id = f.comerciante_id AND s.resumo = f.resumo
        AND s.desde < now() - interval '7 days')
    AND NOT EXISTS (
      SELECT FROM public.media m
      WHERE m.comerciante_id = f.comerciante_id AND m.ficheiro_resumo = f.resumo);
  GET DIAGNOSTICS apagados = ROW_COUNT;
  RETURN apagados > 0;
END
$$;

-- Um envio dos mesmos bytes de um ficheiro sem uso volta a contar os 7 dias:
-- quem o enviou outra vez vai ligá-lo. Corre na fila dos envios do
-- comerciante (registarFicheiro), a mesma que a limpeza toma: ou a limpeza
-- já apagou e o envio grava de novo, ou o envio renova e a limpeza não
-- apaga.
CREATE FUNCTION ficheiro_sem_uso_renovar(p_resumo text) RETURNS void
  LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  UPDATE public.ficheiro_sem_uso s SET desde = now()
  WHERE s.comerciante_id = public.comerciante_actual() AND s.resumo = p_resumo
$$;

-- Para a verificação diária: sem uso há mais de 9 dias (a limpeza parou).
CREATE FUNCTION ficheiros_sem_uso_em_atraso() RETURNS bigint
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT count(*) FROM public.ficheiro_sem_uso s
  WHERE s.desde < now() - interval '9 days'
$$;

GRANT EXECUTE ON FUNCTION ficheiros_comerciantes_sem_uso(), ficheiros_sem_uso(integer),
  ficheiro_apagar_sem_uso(text), ficheiro_sem_uso_renovar(text) TO eurolify_api;
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'eurolify_limpeza') THEN
    GRANT EXECUTE ON FUNCTION ficheiros_sem_uso_em_atraso() TO eurolify_limpeza;
  END IF;
END
$$;
