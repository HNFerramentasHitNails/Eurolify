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

// A migração 0051 (a régua do marketing com fusões) sobre uma base com uma
// fusão já feita, como pode estar a do ensaio: a ficha fundida ganha a hora
// da fusão sem evento, sem linha do tempo e sem versão nova; os gatilhos
// voltam como estavam e o RLS volta forçado. Corre com um migrador como o da
// VPS (dono da base, sem ser superutilizador nem ignorar o RLS).

const SENHA = "so-para-testes";

describe.skipIf(URL_BASE === undefined)("migração 0051 sobre dados", () => {
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

  async function baseAte0049(): Promise<Kysely<BaseDados>> {
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
      await pastaAte("0049_clientes_pedidos_do_titular.sql"),
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

  it("a ficha já fundida ganha a hora da fusão, sem evento, sem linha do tempo nem versão nova; os gatilhos voltam como estavam", async () => {
    const db = await baseAte0049();
    const A = await registarComerciante(db, {
      nome: "A",
      lingua: "pt",
      fuso: "Europe/Lisbon",
    });
    const fica = await ficha(db, A, "Ana", ["ana@exemplo.pt"]);
    const absorve = await ficha(db, A, "A. Silva", ["ana2@exemplo.pt"]);
    await db.transaction().execute(async (trx) => {
      await sql`select set_config('eurolify.comerciante', ${A}, true)`.execute(
        trx,
      );
      await sql`select set_config('eurolify.quem', 'pessoa:per_teste', true)`.execute(
        trx,
      );
      await sql`select cliente_fundir(${fica}::uuid, ${absorve}::uuid, false)`.execute(
        trx,
      );
    });
    const contar = () =>
      db.transaction().execute(async (trx) => {
        await sql`select set_config('eurolify.comerciante', ${A}, true)`.execute(
          trx,
        );
        const { rows } = await sql<{ rasto: number; eventos: number }>`
          select (select count(*)::int from alteracao_cliente) as rasto,
                 (select count(*)::int from evento_saida) as eventos`.execute(
          trx,
        );
        const f = await sql<{ versao: number; actualizado_em: Date }>`
          select versao, actualizado_em from cliente where id = ${absorve}::uuid`.execute(
          trx,
        );
        return { ...rows[0], ficha: f.rows[0] };
      });
    const antes = await contar();

    const { results } = await migrar(
      db as Kysely<unknown>,
      await pastaAte("0051_clientes_regua_marketing_fusoes.sql"),
    );
    expect(results?.map((r) => [r.migrationName, r.status])).toEqual([
      ["0051_clientes_regua_marketing_fusoes", "Success"],
    ]);

    expect(await contar()).toEqual(antes);
    const quando = await db.transaction().execute(async (trx) => {
      await sql`select set_config('eurolify.comerciante', ${A}, true)`.execute(
        trx,
      );
      return (
        await sql<{ id: string; fundido_quando: Date | null }>`
          select id, fundido_quando from cliente order by id`.execute(trx)
      ).rows;
    });
    expect(quando.find((x) => x.id === absorve)?.fundido_quando).toEqual(
      antes.ficha?.actualizado_em,
    );
    expect(quando.find((x) => x.id === fica)?.fundido_quando).toBeNull();

    const { rows: gatilhos } = await sql<{ tgname: string; tgenabled: string }>`
      select tgname, tgenabled from pg_trigger
      where tgrelid = 'public.cliente'::regclass and not tgisinternal
      order by tgname`.execute(db);
    expect(gatilhos).toEqual([
      { tgname: "cliente_antes_de_gravar", tgenabled: "O" },
      { tgname: "cliente_evento", tgenabled: "O" },
      { tgname: "cliente_rasto", tgenabled: "A" },
      { tgname: "cliente_sinalizar_duplicados", tgenabled: "O" },
    ]);
    const { rows: forcado } = await sql<{ forcado: boolean }>`
      select relforcerowsecurity as forcado from pg_class
      where oid = 'public.cliente'::regclass`.execute(db);
    expect(forcado).toEqual([{ forcado: true }]);
  });
});
