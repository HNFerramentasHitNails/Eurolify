import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ESTADOS_COMERCIANTE, TIPOS_CONTRATO } from "../src/base/esquema.js";
import { migrar } from "../src/base/migracoes.js";
import {
  aceitarContrato,
  comComerciante,
  criarEntidadeLegal,
  criarLoja,
  ErroComerciante,
  mudarEstado,
  obterComerciante,
  registarComerciante,
  registarVerificacao,
  type DadosEntidadeLegal,
} from "../src/comerciante/repositorio.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";

// Testes contra o PostgreSQL 18 verdadeiro (ADR-0025). Sem BASE_DADOS_URL
// saltam; no GitHub o fluxo põe EXIGIR_BASE=1 e o base.test.ts falha se a
// base faltar, por isso aqui não se salta em silêncio no CI.

const ENTIDADE: DadosEntidadeLegal = {
  denominacao: "Exemplo, Lda.",
  forma_juridica: "sociedade por quotas",
  pais: "PT",
  numero_fiscal: "123456789",
  morada_linha: "Rua de Teste, 1",
  morada_codigo_postal: "1000-001",
  morada_localidade: "Lisboa",
};

const NOVO = { nome: "Loja de Teste", lingua: "pt", fuso: "Europe/Lisbon" };

async function codigoDoErro(promessa: Promise<unknown>): Promise<string> {
  try {
    await promessa;
  } catch (erro) {
    if (erro instanceof ErroComerciante) return erro.codigo;
    const pgErro = erro as { code?: unknown; message?: unknown };
    return `pg:${String(pgErro.code)}:${String(pgErro.message)}`;
  }
  return "sem erro";
}

describe.skipIf(URL_BASE === undefined)("domínio Comerciante na base", () => {
  let base: BaseDeTeste;

  beforeAll(async () => {
    base = await criarBaseDeTeste(URL_BASE ?? "");
  }, 60_000);

  afterAll(async () => {
    await base.fechar();
  });

  describe("migrações e utilizadores", () => {
    it("a 0001 está aplicada e correr outra vez não faz nada", async () => {
      const { results } = await migrar(base.dono);
      expect(results).toEqual([]);
      const { rows } = await sql<{ name: string }>`
        select name from kysely_migration order by name`.execute(base.dono);
      expect(rows.map((r) => r.name)).toEqual(["0001_comerciante"]);
    });

    it("o eurolify_api não é superutilizador nem ignora o RLS", async () => {
      const { rows } = await sql<{ rolsuper: boolean; rolbypassrls: boolean }>`
        select rolsuper, rolbypassrls from pg_roles
        where rolname = 'eurolify_api'`.execute(base.dono);
      expect(rows).toEqual([{ rolsuper: false, rolbypassrls: false }]);
    });

    it("todas as tabelas do produto têm RLS forçado; as do migrador estão fechadas à API", async () => {
      const { rows } = await sql<{
        tabela: string;
        rls: boolean;
        forcado: boolean;
        api_le: boolean;
      }>`
        select c.relname as tabela, c.relrowsecurity as rls,
               c.relforcerowsecurity as forcado,
               has_table_privilege('eurolify_api', c.oid, 'SELECT') as api_le
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
        order by 1`.execute(base.dono);
      expect(rows.length).toBeGreaterThan(0);
      for (const linha of rows) {
        if (linha.tabela.startsWith("kysely_")) {
          expect(linha, linha.tabela).toMatchObject({ api_le: false });
        } else {
          expect(linha, linha.tabela).toMatchObject({
            rls: true,
            forcado: true,
          });
        }
      }
      expect(rows.filter((r) => !r.tabela.startsWith("kysely_"))).toHaveLength(
        6,
      );
    });

    it("a lista de estados do código é a mesma que a base aceita", async () => {
      const { rows } = await sql<{ definicao: string }>`
        select pg_get_constraintdef(oid) as definicao from pg_constraint
        where conname = 'comerciante_estado_check'`.execute(base.dono);
      const naBase = [
        ...(rows[0]?.definicao ?? "").matchAll(/'([a-z_]+)'/g),
      ].map((m) => m[1]);
      expect(naBase).toEqual([...ESTADOS_COMERCIANTE]);
      const contratos = await sql<{ definicao: string }>`
        select pg_get_constraintdef(oid) as definicao from pg_constraint
        where conname = 'aceitacao_contrato_tipo_check'`.execute(base.dono);
      expect(
        [...(contratos.rows[0]?.definicao ?? "").matchAll(/'([a-z_]+)'/g)].map(
          (m) => m[1],
        ),
      ).toEqual([...TIPOS_CONTRATO]);
    });
  });

  describe("isolamento entre comerciantes (RLS)", () => {
    let a: string;
    let b: string;
    let entidadeB: string;

    beforeAll(async () => {
      a = await registarComerciante(base.api, { ...NOVO, nome: "A" });
      b = await registarComerciante(base.api, { ...NOVO, nome: "B" });
      await criarEntidadeLegal(base.api, a, ENTIDADE);
      entidadeB = await criarEntidadeLegal(base.api, b, ENTIDADE);
    });

    it("sem comerciante definido, a base dá erro — não devolve vazio", async () => {
      const erro = await codigoDoErro(
        base.api.selectFrom("comerciante").selectAll().execute(),
      );
      expect(erro).toMatch(/^pg:(42704|22P02):/);
    });

    it("numa ligação reaproveitada sem contexto também dá erro", async () => {
      const cliente = new pg.Client({ connectionString: base.urlApi });
      await cliente.connect();
      try {
        await cliente.query("BEGIN");
        await cliente.query(
          "select set_config('eurolify.comerciante', $1, true)",
          [a],
        );
        await cliente.query("COMMIT");
        await expect(
          cliente.query("select * from comerciante"),
        ).rejects.toMatchObject({
          code: "22P02",
        });
      } finally {
        await cliente.end();
      }
    });

    it("cada comerciante só vê as suas linhas, em todas as tabelas", async () => {
      await comComerciante(base.api, a, async (trx) => {
        const comerciantes = await trx
          .selectFrom("comerciante")
          .select("id")
          .execute();
        expect(comerciantes).toEqual([{ id: a }]);
        const entidades = await trx
          .selectFrom("entidade_legal")
          .select("comerciante_id")
          .execute();
        expect(entidades.map((e) => e.comerciante_id)).toEqual([a]);
      });
    });

    it("com o contexto de A não se escreve em B", async () => {
      const inserir = codigoDoErro(
        comComerciante(base.api, a, (trx) =>
          trx
            .insertInto("entidade_legal")
            .values({ ...ENTIDADE, comerciante_id: b, numero_fiscal: "999" })
            .execute(),
        ),
      );
      expect(await inserir).toMatch(/^pg:42501:/);

      const alterados = await comComerciante(base.api, a, (trx) =>
        trx
          .updateTable("comerciante")
          .set({ nome: "invadido" })
          .where("id", "=", b)
          .executeTakeFirst(),
      );
      expect(alterados.numUpdatedRows).toBe(0n);
      expect((await obterComerciante(base.api, b)).nome).toBe("B");
    });

    it("uma loja de A não pode vender pela entidade legal de B", async () => {
      const erro = await codigoDoErro(
        criarLoja(base.api, a, {
          entidade_legal_id: entidadeB,
          nome: "Loja",
          lingua_origem: "pt",
        }),
      );
      expect(erro).toMatch(/^pg:23503:/);
    });

    it("o rasto e as provas só se acrescentam; o rasto só o escreve a base", async () => {
      for (const consulta of [
        sql`update transicao_estado set motivo = 'x'`,
        sql`delete from transicao_estado`,
        sql`insert into transicao_estado (comerciante_id, de, para, motivo, quem)
            values (${a}, 'aprovado_limitado', 'activo', 'nunca aconteceu', 'x')`,
        sql`delete from comerciante`,
        sql`update aceitacao_contrato set versao_texto = 'x'`,
        sql`update prova_verificacao set resultado = 'aceite'`,
        sql`insert into prova_verificacao (comerciante_id, entidade_legal_id,
              finalidade, origem, origem_detalhe, resultado, registado_em)
            select ${a}, id, 'identificacao_fiscal', 'manual', 'x', 'aceite',
              '2099-01-01' from entidade_legal`,
      ]) {
        const erro = await codigoDoErro(
          comComerciante(base.api, a, (trx) => consulta.execute(trx)),
        );
        expect(erro).toMatch(/^pg:42501:/);
      }
    });
  });

  describe("estados do comerciante", () => {
    async function comercianteProntoParaActivar(): Promise<string> {
      const id = await registarComerciante(base.api, NOVO);
      const entidade = await criarEntidadeLegal(base.api, id, ENTIDADE);
      for (const para of [
        "prova_pendente",
        "em_revisao",
        "aprovado_limitado",
      ] as const) {
        await mudarEstado(base.api, id, {
          para,
          motivo: "teste",
          quem: "teste",
        });
      }
      for (const tipo of TIPOS_CONTRATO) {
        await aceitarContrato(base.api, id, {
          tipo,
          versao_texto: "v1-teste",
          aceite_por: "teste",
        });
      }
      await registarVerificacao(base.api, id, {
        entidade_legal_id: entidade,
        finalidade: "identificacao_fiscal",
        origem: "manual",
        origem_detalhe: "teste",
        resultado: "aceite",
      });
      return id;
    }

    it("nasce em rascunho, com versão 1; o mesmo nome pode existir duas vezes", async () => {
      const x = await registarComerciante(base.api, NOVO);
      const y = await registarComerciante(base.api, NOVO);
      expect(x).not.toBe(y);
      const lido = await obterComerciante(base.api, x);
      expect(lido).toMatchObject({
        estado: "rascunho",
        versao: 1,
        nome: NOVO.nome,
      });
    });

    it("não nasce noutro estado", async () => {
      const { rows } = await sql<{ id: string }>`select uuidv7() as id`.execute(
        base.api,
      );
      const id = rows[0]?.id ?? "";
      const erro = await codigoDoErro(
        comComerciante(base.api, id, (trx) =>
          trx
            .insertInto("comerciante")
            .values({ id, ...NOVO, estado: "activo" })
            .execute(),
        ),
      );
      expect(erro).toBe("merchant.invalid_transition");
    });

    it("o caminho completo até activo deixa uma linha de rasto por mudança", async () => {
      const id = await comercianteProntoParaActivar();
      await mudarEstado(base.api, id, {
        para: "activo",
        motivo: "teste",
        quem: "teste",
      });
      const lido = await obterComerciante(base.api, id);
      expect(lido).toMatchObject({ estado: "activo", versao: 5 });
      const rasto = await comComerciante(base.api, id, (trx) =>
        trx
          .selectFrom("transicao_estado")
          .select(["de", "para"])
          .orderBy("quando")
          .execute(),
      );
      expect(rasto.map((t) => `${t.de}→${t.para}`)).toEqual([
        "rascunho→prova_pendente",
        "prova_pendente→em_revisao",
        "em_revisao→aprovado_limitado",
        "aprovado_limitado→activo",
      ]);
    });

    it("não se activa sem os dois contratos", async () => {
      const id = await registarComerciante(base.api, NOVO);
      await criarEntidadeLegal(base.api, id, ENTIDADE);
      for (const para of ["em_revisao", "aprovado_limitado"] as const) {
        await mudarEstado(base.api, id, {
          para,
          motivo: "teste",
          quem: "teste",
        });
      }
      const erro = await codigoDoErro(
        mudarEstado(base.api, id, {
          para: "activo",
          motivo: "teste",
          quem: "teste",
        }),
      );
      expect(erro).toBe("merchant.activation_blocked");
      expect((await obterComerciante(base.api, id)).estado).toBe(
        "aprovado_limitado",
      );
    });

    it("não se activa com a prova do número fiscal caducada", async () => {
      const id = await registarComerciante(base.api, NOVO);
      const entidade = await criarEntidadeLegal(base.api, id, ENTIDADE);
      for (const para of ["em_revisao", "aprovado_limitado"] as const) {
        await mudarEstado(base.api, id, {
          para,
          motivo: "teste",
          quem: "teste",
        });
      }
      for (const tipo of TIPOS_CONTRATO) {
        await aceitarContrato(base.api, id, {
          tipo,
          versao_texto: "v1",
          aceite_por: "teste",
        });
      }
      await comComerciante(base.api, id, (trx) =>
        trx
          .insertInto("prova_verificacao")
          .values({
            comerciante_id: id,
            entidade_legal_id: entidade,
            finalidade: "identificacao_fiscal",
            origem: "manual",
            origem_detalhe: "teste",
            resultado: "aceite",
            verificado_em: "2025-01-01T00:00:00Z",
            rever_ate: "2025-06-01T00:00:00Z",
            documento: null,
          })
          .execute(),
      );
      const erro = await codigoDoErro(
        mudarEstado(base.api, id, {
          para: "activo",
          motivo: "teste",
          quem: "teste",
        }),
      );
      expect(erro).toBe("merchant.activation_blocked");
    });

    it("o rasto guarda o motivo e quem, uma linha por mudança", async () => {
      const id = await registarComerciante(base.api, NOVO);
      await mudarEstado(base.api, id, {
        para: "em_revisao",
        motivo: "pedido de activação",
        quem: "dono-teste",
      });
      const rasto = await comComerciante(base.api, id, (trx) =>
        trx
          .selectFrom("transicao_estado")
          .select(["de", "para", "motivo", "quem"])
          .execute(),
      );
      expect(rasto).toEqual([
        {
          de: "rascunho",
          para: "em_revisao",
          motivo: "pedido de activação",
          quem: "dono-teste",
        },
      ]);
    });

    it("uma prova recusada depois de uma aceite trava a activação (revisão #43, P1-1)", async () => {
      const id = await comercianteProntoParaActivar();
      const entidade = await comComerciante(base.api, id, (trx) =>
        trx.selectFrom("entidade_legal").select("id").executeTakeFirstOrThrow(),
      );
      await registarVerificacao(base.api, id, {
        entidade_legal_id: entidade.id,
        finalidade: "identificacao_fiscal",
        origem: "vies",
        origem_detalhe: "VIES: número inválido",
        resultado: "recusada",
      });
      expect(
        await codigoDoErro(
          mudarEstado(base.api, id, {
            para: "activo",
            motivo: "teste",
            quem: "teste",
          }),
        ),
      ).toBe("merchant.activation_blocked");
    });

    it("cada entidade legal activa precisa da sua prova", async () => {
      const id = await comercianteProntoParaActivar();
      await criarEntidadeLegal(base.api, id, { ...ENTIDADE, pais: "ES" });
      expect(
        await codigoDoErro(
          mudarEstado(base.api, id, {
            para: "activo",
            motivo: "teste",
            quem: "teste",
          }),
        ),
      ).toBe("merchant.activation_blocked");
    });

    it("o país e o número fiscal de uma entidade não mudam (revisão #43, P1-2)", async () => {
      const id = await comercianteProntoParaActivar();
      for (const alteracao of [
        { numero_fiscal: "999999990" },
        { pais: "ES" },
      ]) {
        expect(
          await codigoDoErro(
            comComerciante(base.api, id, (trx) =>
              trx.updateTable("entidade_legal").set(alteracao).execute(),
            ),
          ),
        ).toBe("legal_entity.immutable_identity");
      }
      await comComerciante(base.api, id, (trx) =>
        trx
          .updateTable("entidade_legal")
          .set({ morada_localidade: "Porto" })
          .execute(),
      );
    });

    it("a data de criação não muda", async () => {
      const id = await registarComerciante(base.api, NOVO);
      const antes = await obterComerciante(base.api, id);
      await comComerciante(base.api, id, (trx) =>
        trx
          .updateTable("comerciante")
          .set({ nome: "outro", criado_em: "1999-01-01T00:00:00Z" } as never)
          .execute(),
      );
      const depois = await obterComerciante(base.api, id);
      expect(depois.criado_em).toEqual(antes.criado_em);
      expect(depois).toMatchObject({ nome: "outro", versao: 2 });
    });

    it("uma transição que não existe é recusada e não deixa rasto", async () => {
      const id = await registarComerciante(base.api, NOVO);
      const erro = await codigoDoErro(
        mudarEstado(base.api, id, {
          para: "activo",
          motivo: "teste",
          quem: "teste",
        }),
      );
      expect(erro).toBe("merchant.invalid_transition");
      const rasto = await comComerciante(base.api, id, (trx) =>
        trx.selectFrom("transicao_estado").selectAll().execute(),
      );
      expect(rasto).toEqual([]);
    });

    it("mudar o estado sem motivo nem quem é recusado", async () => {
      const id = await registarComerciante(base.api, NOVO);
      const erro = await codigoDoErro(
        comComerciante(base.api, id, (trx) =>
          trx
            .updateTable("comerciante")
            .set({ estado: "em_revisao" })
            .where("id", "=", id)
            .execute(),
        ),
      );
      expect(erro).toBe("merchant.transition_without_trail");
      expect((await obterComerciante(base.api, id)).estado).toBe("rascunho");
    });

    it("suspenso volta só ao estado de onde veio; fechado não sai", async () => {
      const id = await comercianteProntoParaActivar();
      await mudarEstado(base.api, id, {
        para: "activo",
        motivo: "teste",
        quem: "teste",
      });
      await mudarEstado(base.api, id, {
        para: "suspenso",
        motivo: "teste",
        quem: "teste",
      });
      expect(
        await codigoDoErro(
          mudarEstado(base.api, id, {
            para: "em_revisao",
            motivo: "teste",
            quem: "teste",
          }),
        ),
      ).toBe("merchant.invalid_transition");
      await mudarEstado(base.api, id, {
        para: "activo",
        motivo: "teste",
        quem: "teste",
      });
      await mudarEstado(base.api, id, {
        para: "fechado",
        motivo: "teste",
        quem: "teste",
      });
      expect(
        await codigoDoErro(
          mudarEstado(base.api, id, {
            para: "activo",
            motivo: "teste",
            quem: "teste",
          }),
        ),
      ).toBe("merchant.invalid_transition");
    });

    it("comerciante que não existe (ou de outro) dá not_found", async () => {
      const { rows } = await sql<{ id: string }>`select uuidv7() as id`.execute(
        base.api,
      );
      const erro = await codigoDoErro(
        obterComerciante(base.api, rows[0]?.id ?? ""),
      );
      expect(erro).toBe("merchant.not_found");
    });
  });

  describe("tabelas temporárias e entidades arquivadas (revisão do #43, P1-A/B/C)", () => {
    it("o eurolify_api não cria tabelas temporárias nesta base", async () => {
      const cliente = new pg.Client({ connectionString: base.urlApi });
      await cliente.connect();
      try {
        await expect(
          cliente.query("CREATE TEMP TABLE t (x int)"),
        ).rejects.toMatchObject({ code: "42501" });
      } finally {
        await cliente.end();
      }
    });

    it("mesmo com TEMP, tabelas temporárias não desviam o rasto nem enganam a activação", async () => {
      const id = await registarComerciante(base.api, NOVO);
      await criarEntidadeLegal(base.api, id, ENTIDADE);
      for (const para of ["em_revisao", "aprovado_limitado"] as const) {
        await mudarEstado(base.api, id, {
          para,
          motivo: "teste",
          quem: "teste",
        });
      }
      const nomeBase = new URL(base.urlApi).pathname.slice(1);
      await sql`${sql.raw(`GRANT TEMPORARY ON DATABASE ${nomeBase} TO eurolify_api`)}`.execute(
        base.dono,
      );
      const cliente = new pg.Client({ connectionString: base.urlApi });
      await cliente.connect();
      try {
        await cliente.query(
          "CREATE TEMP TABLE transicao_estado (comerciante_id uuid, de text, para text, motivo text, quem text)",
        );
        await cliente.query(
          "CREATE TEMP TABLE aceitacao_contrato (comerciante_id uuid, tipo text)",
        );
        await cliente.query(
          "CREATE TEMP TABLE prova_verificacao (comerciante_id uuid, entidade_legal_id uuid, finalidade text, resultado text, rever_ate timestamptz, registado_em timestamptz, id uuid)",
        );
        await cliente.query("BEGIN");
        await cliente.query(
          "select set_config('eurolify.comerciante', $1, true), set_config('eurolify.motivo', 'teste', true), set_config('eurolify.quem', 'teste', true)",
          [id],
        );
        await cliente.query(
          "INSERT INTO aceitacao_contrato VALUES ($1, 'contrato_servico'), ($1, 'acordo_tratamento_dados')",
          [id],
        );
        await cliente.query(
          "INSERT INTO prova_verificacao SELECT $1, e.id, 'identificacao_fiscal', 'aceite', NULL, now(), gen_random_uuid() FROM public.entidade_legal e",
          [id],
        );
        await expect(
          cliente.query("UPDATE public.comerciante SET estado = 'activo'"),
        ).rejects.toThrow(/merchant\.activation_blocked: faltam contratos/);
        await cliente.query("ROLLBACK");

        await cliente.query("BEGIN");
        await cliente.query(
          "select set_config('eurolify.comerciante', $1, true), set_config('eurolify.motivo', 'teste', true), set_config('eurolify.quem', 'teste', true)",
          [id],
        );
        await cliente.query(
          "UPDATE public.comerciante SET estado = 'suspenso'",
        );
        await cliente.query("COMMIT");
        const temporaria = await cliente.query(
          "SELECT count(*)::int AS n FROM pg_temp.transicao_estado",
        );
        expect(temporaria.rows[0]).toEqual({ n: 0 });
      } finally {
        await cliente.end();
        await sql`${sql.raw(`REVOKE TEMPORARY ON DATABASE ${nomeBase} FROM eurolify_api`)}`.execute(
          base.dono,
        );
      }
      const rasto = await comComerciante(base.api, id, (trx) =>
        trx.selectFrom("transicao_estado").select(["de", "para"]).execute(),
      );
      expect(rasto.map((t) => `${t.de}→${t.para}`)).toContain(
        "aprovado_limitado→suspenso",
      );
    });

    it("não se arquiva uma entidade por onde vende uma loja activa, nem se vende por uma arquivada", async () => {
      const id = await registarComerciante(base.api, NOVO);
      const pt = await criarEntidadeLegal(base.api, id, ENTIDADE);
      const es = await criarEntidadeLegal(base.api, id, {
        ...ENTIDADE,
        pais: "ES",
      });
      const loja = await criarLoja(base.api, id, {
        entidade_legal_id: pt,
        nome: "Loja",
        lingua_origem: "pt",
      });
      const arquivar = (entidade: string) =>
        comComerciante(base.api, id, (trx) =>
          trx
            .updateTable("entidade_legal")
            .set({ estado: "arquivada" as never })
            .where("id", "=", entidade)
            .execute(),
        );
      expect(await codigoDoErro(arquivar(pt))).toBe("legal_entity.in_use");
      await arquivar(es);
      expect(
        await codigoDoErro(
          criarLoja(base.api, id, {
            entidade_legal_id: es,
            nome: "Outra",
            lingua_origem: "es",
          }),
        ),
      ).toBe("store.legal_entity_archived");
      expect(
        await codigoDoErro(
          comComerciante(base.api, id, (trx) =>
            trx
              .updateTable("loja")
              .set({ entidade_legal_id: es })
              .where("id", "=", loja)
              .execute(),
          ),
        ),
      ).toBe("store.legal_entity_archived");
    });

    // Duas transacções ao mesmo tempo: sem o FOR SHARE de loja_antes_de_gravar,
    // passavam as duas e ficava uma loja activa numa entidade arquivada.
    it("em concorrência, arquivar a entidade e abrir uma loja nela não passam as duas", async () => {
      const id = await registarComerciante(base.api, NOVO);
      const pt = await criarEntidadeLegal(base.api, id, ENTIDADE);
      const es = await criarEntidadeLegal(base.api, id, {
        ...ENTIDADE,
        pais: "ES",
      });

      /** Espera até a promessa acabar ou ficar à espera de um bloqueio. */
      async function ateBloquear(promessa: Promise<unknown>): Promise<void> {
        const estado = { acabou: false };
        void promessa.then(
          () => (estado.acabou = true),
          () => (estado.acabou = true),
        );
        for (let i = 0; i < 100 && !estado.acabou; i++) {
          const { rows } = await sql<{ n: number }>`
            select count(*)::int as n from pg_stat_activity
            where usename = 'eurolify_api' and wait_event_type = 'Lock'`.execute(
            base.dono,
          );
          if ((rows[0]?.n ?? 0) > 0) return;
          await new Promise((r) => setTimeout(r, 50));
        }
      }

      const loja = new pg.Client({ connectionString: base.urlApi });
      const arquivo = new pg.Client({ connectionString: base.urlApi });
      await loja.connect();
      await arquivo.connect();
      const contexto = "select set_config('eurolify.comerciante', $1, true)";
      const abrirLoja =
        "INSERT INTO loja (comerciante_id, entidade_legal_id, nome, lingua_origem) VALUES ($1, $2, 'Loja', 'pt')";
      const arquivar =
        "UPDATE entidade_legal SET estado = 'arquivada' WHERE id = $1";
      try {
        // A loja primeiro: quem arquiva espera e, depois, vê a loja.
        await loja.query("BEGIN");
        await loja.query(contexto, [id]);
        await loja.query(abrirLoja, [id, pt]);
        await arquivo.query("BEGIN");
        await arquivo.query(contexto, [id]);
        const arquivamento = arquivo.query(arquivar, [pt]);
        await ateBloquear(arquivamento);
        await loja.query("COMMIT");
        await expect(arquivamento).rejects.toThrow(/^legal_entity\.in_use:/);
        await arquivo.query("ROLLBACK");

        // O arquivo primeiro: a loja espera e, depois, lê a entidade arquivada.
        await arquivo.query("BEGIN");
        await arquivo.query(contexto, [id]);
        await arquivo.query(arquivar, [es]);
        await loja.query("BEGIN");
        await loja.query(contexto, [id]);
        const abertura = loja.query(abrirLoja, [id, es]);
        await ateBloquear(abertura);
        await arquivo.query("COMMIT");
        await expect(abertura).rejects.toThrow(
          /^store\.legal_entity_archived:/,
        );
        await loja.query("ROLLBACK");
      } finally {
        await loja.end();
        await arquivo.end();
      }
    });
  });

  describe("entidades legais e valores", () => {
    it("o número fiscal é único por país dentro do comerciante, não entre comerciantes", async () => {
      const x = await registarComerciante(base.api, NOVO);
      const y = await registarComerciante(base.api, NOVO);
      await criarEntidadeLegal(base.api, x, ENTIDADE);
      expect(
        await codigoDoErro(criarEntidadeLegal(base.api, x, ENTIDADE)),
      ).toBe("legal_entity.tax_number_duplicate");
      await criarEntidadeLegal(base.api, x, { ...ENTIDADE, pais: "ES" });
      await expect(criarEntidadeLegal(base.api, y, ENTIDADE)).resolves.toMatch(
        /^[0-9a-f-]{36}$/,
      );
    });

    it("recusa país fora dos 27, língua e fuso inválidos, texto vazio", async () => {
      const x = await registarComerciante(base.api, NOVO);
      for (const mau of [
        { ...ENTIDADE, pais: "GB" },
        { ...ENTIDADE, pais: "EL" },
        { ...ENTIDADE, numero_fiscal: "12 34" },
        { ...ENTIDADE, denominacao: "   " },
        { ...ENTIDADE, numero_fiscal: "PT123456789" },
        { ...ENTIDADE, pais: "GR", numero_fiscal: "EL123456789" },
      ]) {
        expect(
          await codigoDoErro(criarEntidadeLegal(base.api, x, mau)),
        ).toMatch(/^pg:23514:/);
      }
      expect(
        await codigoDoErro(
          registarComerciante(base.api, { ...NOVO, lingua: "PT" }),
        ),
      ).toMatch(/^pg:23514:/);
      expect(
        await codigoDoErro(
          registarComerciante(base.api, { ...NOVO, fuso: "Lua/Base" }),
        ),
      ).toMatch(/^pg:22023:/);
    });
  });
});
