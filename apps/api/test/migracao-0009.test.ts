import { randomBytes } from "node:crypto";
import { copyFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Kysely, PostgresDialect, sql } from "kysely";
import pg from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { migrar, PASTA_MIGRACOES } from "../src/base/migracoes.js";
import { apagarBase, URL_BASE } from "./base-de-teste.js";

// A migração 0009 (a língua de origem passa da loja para o comerciante, P13)
// sobre uma base com a 0007 aplicada e dados, como a VPS. Corre com um
// migrador como o da VPS — dono da base, sem ser superutilizador nem ignorar
// o RLS (infra/vps/preparar.sh, eurolify_migrador) —, porque é assim que o
// RLS forçado do comerciante e da loja se aplica a quem migra.

const A = "01900000-0000-7000-8000-0000000000c1";
const B = "01900000-0000-7000-8000-0000000000c2";
const ENTIDADE = "01900000-0000-7000-8000-0000000000e1";
const SENHA = "so-para-testes";

describe.skipIf(URL_BASE === undefined)("migração 0009 sobre dados", () => {
  const aFechar: (() => Promise<void>)[] = [];

  afterEach(async () => {
    const erros: unknown[] = [];
    for (const fechar of aFechar.splice(0).reverse()) {
      try {
        await fechar();
      } catch (erro) {
        erros.push(erro);
      }
    }
    if (erros.length > 0) {
      throw new AggregateError(erros, "a limpeza da migração 0009 falhou");
    }
  });

  async function pastaAte(ultima: string): Promise<URL> {
    const pasta = await mkdtemp(join(tmpdir(), "migracoes-ate-"));
    aFechar.push(() => rm(pasta, { recursive: true, force: true }));
    for (const f of (await readdir(PASTA_MIGRACOES)).sort()) {
      if (f.endsWith(".sql") && f <= ultima) {
        await copyFile(new URL(f, PASTA_MIGRACOES), join(pasta, f));
      }
    }
    return pathToFileURL(`${pasta}/`);
  }

  it("os comerciantes ficam com a língua da primeira loja ou a do Hub; o RLS e o trigger voltam", async () => {
    const urlAdmin = URL_BASE ?? "";
    const sufixo = randomBytes(6).toString("hex");
    const nome = `eurolify_teste_${sufixo}`;
    const migrador = `zz_migrador_${sufixo}`;
    const admin = new pg.Client({ connectionString: urlAdmin });
    await admin.connect();
    try {
      await admin.query(
        `CREATE ROLE ${migrador} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD '${SENHA}'`,
      );
      // O eurolify_api é da instância; a 0001 só o cria se faltar, e este
      // migrador não pode criar papéis (como na VPS, onde já existe).
      await admin.query(`DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'eurolify_api') THEN
          CREATE ROLE eurolify_api NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
        END IF; END $$`);
      await admin.query(`CREATE DATABASE ${nome} OWNER ${migrador}`);
    } finally {
      await admin.end();
    }
    aFechar.push(async () => {
      const fim = new pg.Client({ connectionString: urlAdmin });
      await fim.connect();
      try {
        await apagarBase(fim, nome);
        await fim.query(`DROP ROLE IF EXISTS ${migrador}`);
      } finally {
        await fim.end();
      }
    });

    const url = new URL(urlAdmin);
    url.pathname = `/${nome}`;
    url.username = migrador;
    url.password = SENHA;
    const db = new Kysely<unknown>({
      dialect: new PostgresDialect({
        pool: new pg.Pool({ connectionString: url.toString(), max: 1 }),
      }),
    });
    aFechar.push(() => db.destroy());

    await migrar(db, await pastaAte("0008_rasto_imutavel_e_funcoes_fechadas.sql"));
    // A tem uma loja em es (Hub em pt); B não tem loja (Hub em fr). O RLS
    // forçado aplica-se a este migrador: cada um no seu contexto.
    await db.transaction().execute(async (trx) => {
      await sql`select set_config('eurolify.comerciante', ${A}, true)`.execute(
        trx,
      );
      await sql`insert into comerciante (id, nome, lingua, fuso) values (${A}, 'A', 'pt', 'Europe/Lisbon')`.execute(
        trx,
      );
      await sql`insert into entidade_legal (id, comerciante_id, denominacao, forma_juridica, pais, numero_fiscal, morada_linha, morada_codigo_postal, morada_localidade)
        values (${ENTIDADE}, ${A}, 'A Lda', 'Lda', 'PT', '123456789', 'Rua 1', '1000-001', 'Lisboa')`.execute(
        trx,
      );
      await sql`insert into loja (comerciante_id, entidade_legal_id, nome, lingua_origem) values (${A}, ${ENTIDADE}, 'Loja', 'es')`.execute(
        trx,
      );
    });
    await db.transaction().execute(async (trx) => {
      await sql`select set_config('eurolify.comerciante', ${B}, true)`.execute(
        trx,
      );
      await sql`insert into comerciante (id, nome, lingua, fuso) values (${B}, 'B', 'fr', 'Europe/Paris')`.execute(
        trx,
      );
    });

    const { results } = await migrar(
      db,
      await pastaAte("0009_catalogo_traducoes.sql"),
    );
    expect(results?.map((r) => [r.migrationName, r.status])).toEqual([
      ["0009_catalogo_traducoes", "Success"],
    ]);

    const lidos = await db.transaction().execute(async (trx) => {
      const linhas = [];
      for (const id of [A, B]) {
        await sql`select set_config('eurolify.comerciante', ${id}, true)`.execute(
          trx,
        );
        const { rows } = await sql<{ lingua_origem: string; versao: number }>`
          select lingua_origem, versao from comerciante where id = ${id}`.execute(
          trx,
        );
        linhas.push(rows[0]);
      }
      return linhas;
    });
    // A versão não sobe: preencher a coluna nova não é uma alteração.
    expect(lidos).toEqual([
      { lingua_origem: "es", versao: 1 },
      { lingua_origem: "fr", versao: 1 },
    ]);
    const { rows: tabelas } = await sql<{ relname: string; forcado: boolean }>`
      select relname, relforcerowsecurity as forcado from pg_class
      where relname in ('comerciante', 'loja') order by relname`.execute(db);
    expect(tabelas).toEqual([
      { relname: "comerciante", forcado: true },
      { relname: "loja", forcado: true },
    ]);
    const { rows: gatilhos } = await sql<{ tgenabled: string }>`
      select tgenabled from pg_trigger
      where tgname = 'comerciante_antes_de_gravar'`.execute(db);
    expect(gatilhos).toEqual([{ tgenabled: "O" }]);
    const { rows: colunas } = await sql<{ n: number }>`
      select count(*)::int as n from information_schema.columns
      where table_name = 'loja' and column_name = 'lingua_origem'`.execute(db);
    expect(colunas[0]?.n).toBe(0);
  }, 60_000);
});
