import { randomBytes } from "node:crypto";
import { readdir } from "node:fs/promises";
import { Kysely, PostgresDialect, sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrar, PASTA_MIGRACOES } from "../src/base/migracoes.js";
import {
  aceitarContrato,
  criarEntidadeLegal,
  mudarEstado,
  registarComerciante,
  registarVerificacao,
} from "../src/comerciante/repositorio.js";
import {
  apagarBase,
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";

// Migração 0008 (auditoria docs/16, «Segurança e dados»): o rasto do
// Comerciante só se acrescenta, também para o dono das tabelas; e as funções
// da base nascem fechadas. Contra o PostgreSQL 18 verdadeiro (ADR-0025).

/** As funções que a API pode chamar; qualquer outra tem de ser recusada. */
const FUNCOES_DA_API = [
  "catalogo_estado_do_artigo",
  "catalogo_fila_do_artigo",
  "catalogo_marcar_combinacoes",
  "catalogo_verificar_combinacoes",
  "chave_criar_pela_api",
  "chave_listar",
  "chave_resolver",
  "chave_revogar_pela_api",
  "comerciante_actual",
  "conta_nova_com_passkey",
  "convite_aceitar",
  "convite_cancelar",
  "convite_criar",
  "desafio_criar_entrada",
  "desafio_criar_registo",
  "entrar_com_passkey",
  "gtin_valido",
  "membro_mudar_papel",
  "membro_terminar",
  "membros_listar",
  "passkey_para_entrar",
  "pessoa_eu",
  "reautenticar_com_passkey",
  "sessao_resolver",
  "sessao_terminar",
  "sessao_verificar",
];

const RASTO = [
  "transicao_estado",
  "aceitacao_contrato",
  "prova_verificacao",
] as const;

async function mensagemDoErro(promessa: Promise<unknown>): Promise<string> {
  try {
    await promessa;
  } catch (erro) {
    return String((erro as { message?: unknown }).message);
  }
  return "sem erro";
}

describe.skipIf(URL_BASE === undefined)("segurança da base (0008)", () => {
  let base: BaseDeTeste;

  beforeAll(async () => {
    base = await criarBaseDeTeste(URL_BASE ?? "");
    // Uma linha em cada tabela do rasto, pelo caminho da API.
    const id = await registarComerciante(base.api, {
      nome: "Loja de Teste",
      lingua: "pt",
      fuso: "Europe/Lisbon",
    });
    const entidade = await criarEntidadeLegal(base.api, id, {
      denominacao: "Exemplo, Lda.",
      forma_juridica: "sociedade por quotas",
      pais: "PT",
      numero_fiscal: "123456789",
      morada_linha: "Rua de Teste, 1",
      morada_codigo_postal: "1000-001",
      morada_localidade: "Lisboa",
    });
    await mudarEstado(base.api, id, {
      de: "rascunho",
      para: "prova_pendente",
      motivo: "teste",
      quem: "teste",
    });
    await aceitarContrato(base.api, id, {
      tipo: "contrato_servico",
      versao_texto: "v1-teste",
      aceite_por: "teste",
    });
    await registarVerificacao(base.api, id, {
      entidade_legal_id: entidade,
      finalidade: "identificacao_fiscal",
      origem: "manual",
      origem_detalhe: "teste",
      resultado: "aceite",
    });
  }, 60_000);

  afterAll(async () => {
    await base.fechar();
  });

  describe("o rasto só se acrescenta, também para o dono", () => {
    it("há uma linha em cada tabela do rasto", async () => {
      for (const tabela of RASTO) {
        const { rows } = await sql<{ n: number }>`
          select count(*)::int as n from ${sql.table(tabela)}`.execute(
          base.dono,
        );
        expect(rows[0]?.n, tabela).toBe(1);
      }
    });

    it.each(RASTO)(
      "o dono não altera, não apaga nem esvazia %s",
      async (tabela) => {
        for (const consulta of [
          sql`update ${sql.table(tabela)} set comerciante_id = comerciante_id`,
          sql`delete from ${sql.table(tabela)}`,
          sql`truncate ${sql.table(tabela)}`,
        ]) {
          expect(await mensagemDoErro(consulta.execute(base.dono))).toMatch(
            /^audit\.append_only:/,
          );
        }
        const { rows } = await sql<{ n: number }>`
        select count(*)::int as n from ${sql.table(tabela)}`.execute(base.dono);
        expect(rows[0]?.n).toBe(1);
      },
    );
  });

  it("os seis gatilhos do rasto existem e estão sempre ligados", async () => {
    const { rows } = await sql<{ nome: string; ligado: string }>`
      select t.tgname as nome, t.tgenabled as ligado
      from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where c.relname in ('transicao_estado', 'aceitacao_contrato',
                          'prova_verificacao')
        and t.tgfoid = 'rasto_so_se_acrescenta'::regproc
      order by 1`.execute(base.dono);
    expect(rows).toEqual(
      RASTO.flatMap((tabela) => [
        { nome: `${tabela}_sem_truncate`, ligado: "A" },
        { nome: `${tabela}_so_se_acrescenta`, ligado: "A" },
      ]).sort((a, b) => a.nome.localeCompare(b.nome)),
    );
  });

  describe("funções fechadas por omissão", () => {
    it("nenhuma função do esquema public fica aberta a PUBLIC", async () => {
      const { rows } = await sql<{ nome: string }>`
        select p.proname as nome
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and (p.proacl is null or exists (
            select 1 from aclexplode(p.proacl) a
            where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
        order by 1`.execute(base.dono);
      expect(rows.map((r) => r.nome)).toEqual([]);
    });

    it("as funções SECURITY DEFINER têm o search_path fixo", async () => {
      const { rows } = await sql<{ nome: string; config: string[] | null }>`
        select p.proname as nome, p.proconfig as config
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef
        order by 1`.execute(base.dono);
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        expect(r.config ?? [], r.nome).toContain(
          "search_path=pg_catalog, public, pg_temp",
        );
      }
    });

    it("a API só pode chamar as funções da lista", async () => {
      const { rows } = await sql<{ nome: string }>`
        select p.proname as nome
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and has_function_privilege('eurolify_api', p.oid, 'EXECUTE')
        order by 1`.execute(base.dono);
      expect(rows.map((r) => r.nome)).toEqual(FUNCOES_DA_API);
    });

    it("uma função nova de quem migra nasce fechada", async () => {
      await sql`create function funcao_nova_de_teste() returns int
        language sql as 'select 1'`.execute(base.dono);
      try {
        const { rows } = await sql<{ pode: boolean }>`
          select has_function_privilege('eurolify_api',
            'funcao_nova_de_teste()', 'EXECUTE') as pode`.execute(base.dono);
        expect(rows[0]?.pode).toBe(false);
      } finally {
        await sql`drop function funcao_nova_de_teste()`.execute(base.dono);
      }
    });
  });

  // Como na VPS (infra/vps/preparar.sh, passo 10b): o eurolify_migrador é
  // dono da base, sem superutilizador, BYPASSRLS, CREATEDB nem CREATEROLE, e
  // corre as migrações todas. No resto do CI quem migra é o superutilizador,
  // que não prova nada sobre a VPS (revisão do #104, P3-1).
  describe("as migrações todas com um migrador sem poderes, dono da base", () => {
    const sufixo = randomBytes(4).toString("hex");
    const papel = `migrador_vps_${sufixo}`;
    const nome = `eurolify_migrador_${sufixo}`;
    const senha = "so-para-testes";
    let admin: pg.Client | undefined;
    let migrador: Kysely<unknown> | undefined;
    let resultado: Awaited<ReturnType<typeof migrar>> | undefined;
    let erroDaMigracao: unknown;

    beforeAll(async () => {
      admin = new pg.Client({ connectionString: URL_BASE });
      await admin.connect();
      // O eurolify_api é do cluster e na VPS cria-o o preparar.sh antes do
      // migrador (este não tem CREATEROLE). Aqui o beforeAll de fora já o
      // criou; o bloco fica para este describe também correr sozinho.
      await admin.query(`DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'eurolify_api') THEN
          CREATE ROLE eurolify_api NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
        END IF;
      EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
      END $$`);
      await admin.query(
        `CREATE ROLE ${papel} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD '${senha}'`,
      );
      await admin.query(`CREATE DATABASE ${nome} OWNER ${papel}`);
      const url = new URL(URL_BASE ?? "");
      url.pathname = `/${nome}`;
      url.username = papel;
      url.password = senha;
      migrador = new Kysely<unknown>({
        dialect: new PostgresDialect({
          pool: new pg.Pool({ connectionString: url.toString(), max: 1 }),
        }),
      });
      // Migra aqui: se falhar, cada teste diz porquê (revisão, P3-2).
      try {
        resultado = await migrar(migrador);
      } catch (erro) {
        erroDaMigracao = erro;
      }
    }, 60_000);

    /** O migrador, ou falha com o erro da migração, se a houve. */
    function soMigrado(): Kysely<unknown> {
      if (erroDaMigracao !== undefined) {
        throw erroDaMigracao instanceof Error
          ? erroDaMigracao
          : new Error("a migração falhou", { cause: erroDaMigracao });
      }
      if (migrador === undefined) throw new Error("o migrador não foi criado");
      return migrador;
    }

    // Cada passo da limpeza no seu try: uma falha na preparação ou no fecho
    // não deixa a base nem o papel para trás nem esconde o erro (revisão,
    // P3-1).
    afterAll(async () => {
      try {
        await migrador?.destroy();
      } finally {
        try {
          if (admin !== undefined) await apagarBase(admin, nome);
        } finally {
          try {
            await admin?.query(`DROP ROLE IF EXISTS ${papel}`);
          } finally {
            await admin?.end();
          }
        }
      }
    });

    it("o migrador é como o da VPS: sem poderes e dono da base", async () => {
      const { rows } = await sql<{
        super: boolean;
        bypass: boolean;
        createdb: boolean;
        createrole: boolean;
        dono: boolean;
      }>`
        select r.rolsuper as super, r.rolbypassrls as bypass,
          r.rolcreatedb as createdb, r.rolcreaterole as createrole,
          d.datdba = r.oid as dono
        from pg_roles r, pg_database d
        where r.rolname = current_user and d.datname = current_database()`.execute(
        soMigrado(),
      );
      expect(rows[0]).toEqual({
        super: false,
        bypass: false,
        createdb: false,
        createrole: false,
        dono: true,
      });
    });

    it("corre todas as migrações da pasta, sem erro", async () => {
      soMigrado();
      const ficheiros = (await readdir(PASTA_MIGRACOES))
        .filter((f) => f.endsWith(".sql"))
        .map((f) => f.replace(/\.sql$/, ""))
        .sort();
      expect(ficheiros.length).toBeGreaterThanOrEqual(8);
      expect(resultado?.error).toBeUndefined();
      expect(resultado?.results?.map((r) => r.migrationName)).toEqual(
        ficheiros,
      );
      expect(resultado?.results?.every((r) => r.status === "Success")).toBe(
        true,
      );
    });

    it("nenhuma função fica aberta a PUBLIC e a API só chama as da lista", async () => {
      const { rows: abertas } = await sql<{ nome: string }>`
        select p.proname as nome
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and (p.proacl is null or exists (
            select 1 from aclexplode(p.proacl) a
            where a.grantee = 0 and a.privilege_type = 'EXECUTE'))`.execute(
        soMigrado(),
      );
      expect(abertas).toEqual([]);
      const { rows: daApi } = await sql<{ nome: string }>`
        select p.proname as nome
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and has_function_privilege('eurolify_api', p.oid, 'EXECUTE')
        order by 1`.execute(soMigrado());
      expect(daApi.map((r) => r.nome)).toEqual(FUNCOES_DA_API);
    });

    it("uma função nova do migrador nasce fechada", async () => {
      await sql`create function funcao_nova_do_migrador() returns int
        language sql as 'select 1'`.execute(soMigrado());
      const { rows } = await sql<{ pode: boolean }>`
        select has_function_privilege('eurolify_api',
          'funcao_nova_do_migrador()', 'EXECUTE') as pode`.execute(soMigrado());
      expect(rows[0]?.pode).toBe(false);
    });

    it.each(RASTO)("o migrador, dono, não esvazia %s", async (tabela) => {
      // O TRUNCATE dispara o gatilho por instrução, mesmo sem linhas.
      expect(
        await mensagemDoErro(
          sql`truncate ${sql.table(tabela)}`.execute(soMigrado()),
        ),
      ).toMatch(/^audit\.append_only:/);
    });
  });
});
