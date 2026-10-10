import { randomBytes } from "node:crypto";
import { copyFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Kysely, PostgresDialect, sql } from "kysely";
import pg from "pg";
import { afterEach, describe, expect, it } from "vitest";
import type { BaseDados } from "../src/base/esquema.js";
import { migrar, PASTA_MIGRACOES } from "../src/base/migracoes.js";
import { registarComerciante } from "../src/comerciante/repositorio.js";
import { apagarBase, URL_BASE } from "./base-de-teste.js";

// A migração 0046 (duplicados e fusões) sobre uma base com fichas que já
// existiam, como pode estar a do ensaio: as que partilham um e-mail entram na
// fila uma vez, só dentro do mesmo comerciante, e o RLS das tabelas que a
// migração desliga volta forçado. Corre com um migrador como o da VPS (dono
// da base, sem ser superutilizador nem ignorar o RLS), como o da 0037.

const SENHA = "so-para-testes";

describe.skipIf(URL_BASE === undefined)("migração 0046 sobre dados", () => {
  const aFechar: (() => Promise<void>)[] = [];

  afterEach(async () => {
    for (const fechar of aFechar.splice(0).reverse()) await fechar();
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

  async function baseAte0045(): Promise<Kysely<BaseDados>> {
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
      for (const papel of ["eurolify_api", "eurolify_limpeza"]) {
        await admin.query(`DO $$ BEGIN
          IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${papel}') THEN
            CREATE ROLE ${papel} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
          END IF; END $$`);
      }
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
    const db = new Kysely<BaseDados>({
      dialect: new PostgresDialect({
        pool: new pg.Pool({ connectionString: url.toString(), max: 1 }),
      }),
    });
    aFechar.push(() => db.destroy());
    await migrar(
      db as Kysely<unknown>,
      await pastaAte("0045_operador_papel_minimo.sql"),
    );
    return db;
  }

  /** Uma ficha criada como a API a cria, no comerciante dado. */
  async function ficha(
    db: Kysely<BaseDados>,
    c: string,
    nome: string,
    emails: string[],
  ): Promise<string> {
    return db.transaction().execute(async (trx) => {
      await sql`select set_config('eurolify.comerciante', ${c}, true)`.execute(
        trx,
      );
      await sql`select set_config('eurolify.quem', 'teste:sql', true)`.execute(
        trx,
      );
      const { id } = await trx
        .insertInto("cliente")
        .values({ comerciante_id: c, nome, emails })
        .returning("id")
        .executeTakeFirstOrThrow();
      return id;
    });
  }

  it("as fichas que já partilhavam um e-mail entram na fila, só no mesmo comerciante; o RLS volta forçado", async () => {
    const db = await baseAte0045();
    const A = await registarComerciante(db, {
      nome: "A",
      lingua: "pt",
      fuso: "Europe/Lisbon",
    });
    const B = await registarComerciante(db, {
      nome: "B",
      lingua: "pt",
      fuso: "Europe/Lisbon",
    });
    const a1 = await ficha(db, A, "Ana", ["ana@exemplo.pt"]);
    const a2 = await ficha(db, A, "A. Silva", ["ANA@exemplo.pt"]);
    await ficha(db, A, "Rui", ["rui@exemplo.pt"]);
    await ficha(db, B, "Ana", ["ana@exemplo.pt"]);

    const { results } = await migrar(
      db as Kysely<unknown>,
      await pastaAte("0046_clientes_duplicados_fusoes.sql"),
    );
    expect(results?.map((r) => [r.migrationName, r.status])).toEqual([
      ["0046_clientes_duplicados_fusoes", "Success"],
    ]);

    const fila = (c: string) =>
      db.transaction().execute(async (trx) => {
        await sql`select set_config('eurolify.comerciante', ${c}, true)`.execute(
          trx,
        );
        return trx
          .selectFrom("duplicado_cliente")
          .select(["cliente_a", "cliente_b", "sinais", "estado"])
          .execute();
      });
    expect(await fila(A)).toEqual([
      {
        cliente_a: a1 < a2 ? a1 : a2,
        cliente_b: a1 < a2 ? a2 : a1,
        sinais: ["email"],
        estado: "por_decidir",
      },
    ]);
    expect(await fila(B)).toEqual([]);

    const { rows: tabelas } = await sql<{ relname: string; forcado: boolean }>`
      select relname, relforcerowsecurity as forcado from pg_class
      where relname in ('cliente', 'perfil_faturacao', 'duplicado_cliente')
      order by relname`.execute(db);
    expect(tabelas).toHaveLength(3);
    expect(tabelas.every((t) => t.forcado)).toBe(true);
    const { rows: chaves } = await sql<{ validada: boolean }>`
      select convalidated as validada from pg_constraint
      where conname in ('cliente_fundida_em', 'perfil_copiado_de')`.execute(db);
    expect(chaves).toEqual([{ validada: true }, { validada: true }]);
  });
});
