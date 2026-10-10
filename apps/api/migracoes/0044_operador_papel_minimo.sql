-- O comando do operador (docs/19 §6; issue #107): repetir o pedido de um
-- comerciante não cria outro, e o comando deixa de correr com o dono das
-- tabelas (revisão do #110, P2-2 e P3-8). Ex.: o fluxo «operar» da execução
-- 1234567 cria a «Loja de Ensaio» e a resposta perde-se; o operador carrega
-- em «Re-run» (o número da execução não muda) e recebe o mesmo `mer_…`, com
-- `ja_existia: true`, em vez de uma segunda loja.
--
-- O que esta migração faz:
-- - `pedido_do_operador`: um pedido (`github-run:<número>`) para um
--   comerciante; tabela interna (RLS sem FORÇAR, como a `token_checkout` da
--   0041), que só a função escreve e lê;
-- - `comerciante_criar_pelo_operador(pedido, nome, língua, fuso, quem)`:
--   cria o comerciante e o pedido na mesma transacção; o mesmo pedido outra
--   vez devolve o mesmo comerciante. Dois pedidos iguais ao mesmo tempo: o
--   segundo espera pelo primeiro (a chave primária) e devolve o dele;
-- - o papel `eurolify_operador`: entra com palavra-passe (o operador corre
--   num contentor, pela rede), não é superutilizador, não passa o RLS e só
--   tem EXECUTE nas três portas do operador: esta, a `chave_criar` (0010) e a
--   `convite_criar_pelo_operador` (0018), todas SECURITY DEFINER do dono.
--   Antes, o comando corria com o dono das tabelas, que pode mudar funções e
--   gatilhos e passa o RLS não forçado da `chave_api`.
--
-- Na VPS o migrador não pode criar papéis: cria-o o preparar.sh (passo 10b),
-- como o eurolify_api e o eurolify_limpeza, e dá-lhe os privilégios se esta
-- migração correr antes dele. Aqui só se cria quando quem migra pode.

SET LOCAL lock_timeout = '10s';

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'eurolify_operador') THEN
    BEGIN
      CREATE ROLE eurolify_operador NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'migracao 0044: sem permissão para criar o papel eurolify_operador; cria-o o preparar.sh (passo 10b)';
    END;
  END IF;
END
$$;

CREATE TABLE pedido_do_operador (
  pedido text PRIMARY KEY CHECK (pedido ~ '^github-run:[0-9]{1,20}$'),
  -- Diferida: o pedido entra antes do comerciante, na mesma transacção.
  comerciante_id uuid NOT NULL
    REFERENCES comerciante (id) DEFERRABLE INITIALLY DEFERRED,
  quem text NOT NULL CHECK (quem ~ '^operador:github:[0-9]{1,20}$'),
  criado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE pedido_do_operador ENABLE ROW LEVEL SECURITY;
CREATE POLICY so_o_proprio ON pedido_do_operador
  USING (comerciante_id = comerciante_actual())
  WITH CHECK (comerciante_id = comerciante_actual());
REVOKE ALL ON pedido_do_operador FROM PUBLIC;

CREATE FUNCTION comerciante_criar_pelo_operador(p_pedido text, p_nome text,
                                               p_lingua text, p_fuso text,
                                               p_quem text)
  RETURNS TABLE (id uuid, ja_existia boolean)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  novo uuid := pg_catalog.uuidv7();
  existente uuid;
BEGIN
  -- Primeiro o pedido: se já existe (ou outro o está a criar), espera e
  -- devolve o comerciante dele, sem criar outro. O pedido identifica-se só
  -- pelo número da execução: o nome, a língua e o fuso de uma repetição não
  -- se comparam (num «Re-run» são os mesmos; revisão do #293, P3-5). Se o
  -- comerciante falhar (ex.: um fuso que a base não conhece), o pedido sai
  -- com ele, e repetir com os dados certos cria-o.
  INSERT INTO public.pedido_do_operador (pedido, comerciante_id, quem)
  VALUES (p_pedido, novo, p_quem)
  ON CONFLICT (pedido) DO NOTHING;
  IF NOT FOUND THEN
    SELECT o.comerciante_id INTO existente
    FROM public.pedido_do_operador o WHERE o.pedido = p_pedido;
    RETURN QUERY SELECT existente, true;
    RETURN;
  END IF;
  -- O RLS forçado do comerciante vale também para o dono: o contexto é o
  -- comerciante novo, só nesta transacção.
  PERFORM pg_catalog.set_config('eurolify.comerciante', novo::text, true);
  INSERT INTO public.comerciante (id, nome, lingua, fuso)
  VALUES (novo, p_nome, p_lingua, p_fuso);
  RETURN QUERY SELECT novo, false;
END
$$;

REVOKE EXECUTE ON FUNCTION
  comerciante_criar_pelo_operador(text, text, text, text, text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'eurolify_operador') THEN
    GRANT EXECUTE ON FUNCTION
      comerciante_criar_pelo_operador(text, text, text, text, text),
      chave_criar(text, uuid, text, text[], text, text, text, timestamptz),
      convite_criar_pelo_operador(uuid, text, text, text, text)
      TO eurolify_operador;
  END IF;
END
$$;
