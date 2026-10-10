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

// A migração 0051 (o consentimento por contacto) sobre uma base com
// declarações antigas, sem contacto, como pode estar a do ensaio: cada uma
// fica inferida para os contactos que a ficha tinha nesse momento, e um
// contacto acrescentado depois não herda nada (revisão do #330, P2-1). Corre
// com um migrador como o da VPS (dono da base, sem ser superutilizador nem
// ignorar o RLS).

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

  async function baseAte0050(): Promise<Kysely<BaseDados>> {
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
      await pastaAte("0050_documentos_fiscais.sql"),
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

  it("as declarações antigas valem para os contactos que a ficha tinha; um acrescentado depois não herda; o RLS volta forçado", async () => {
    const db = await baseAte0050();
    const A = await registarComerciante(db, {
      nome: "A",
      lingua: "pt",
      fuso: "Europe/Lisbon",
    });
    const id = await ficha(db, A, "Ana", ["Ana@Exemplo.pt"]);
    const noA = <T>(fn: (trx: Kysely<BaseDados>) => Promise<T>) =>
      db.transaction().execute(async (trx) => {
        await sql`select set_config('eurolify.comerciante', ${A}, true)`.execute(
          trx,
        );
        await sql`select set_config('eurolify.quem', 'teste:sql', true)`.execute(
          trx,
        );
        return fn(trx);
      });
    await noA((trx) =>
      sql`insert into consentimento (comerciante_id, cliente_id, canal, declaracao,
            texto, versao_texto, onde)
          values (${A}::uuid, ${id}::uuid, 'email', 'aceitou', 't', 'v1', 'x')`.execute(
        trx,
      ),
    );

    const { results } = await migrar(
      db as Kysely<unknown>,
      await pastaAte("0051_clientes_consentimento_por_contacto.sql"),
    );
    expect(results?.map((r) => [r.migrationName, r.status])).toEqual([
      ["0051_clientes_consentimento_por_contacto", "Success"],
    ]);

    const inferidos = await noA(
      async (trx) =>
        (
          await sql<{ contacto: string }>`
            select contacto from consentimento_contacto_inferido`.execute(trx)
        ).rows,
    );
    expect(inferidos).toEqual([{ contacto: "ana@exemplo.pt" }]);
    const contactos = () =>
      noA(
        async (trx) =>
          (
            await sql<{ c: string[] }>`
              select contactos_com_marketing(${id}::uuid, 'email') as c`.execute(
              trx,
            )
          ).rows[0]?.c,
      );
    expect(await contactos()).toEqual(["ana@exemplo.pt"]);
    await noA((trx) =>
      sql`update cliente set emails = emails || array['nova@exemplo.pt']
          where id = ${id}::uuid`.execute(trx),
    );
    expect(await contactos()).toEqual(["ana@exemplo.pt"]);

    const { rows: tabelas } = await sql<{ relname: string; forcado: boolean }>`
      select relname, relforcerowsecurity as forcado from pg_class
      where relname in ('cliente', 'consentimento', 'consentimento_contacto_inferido',
        'confirmacao_consentimento')
      order by relname`.execute(db);
    expect(tabelas).toHaveLength(4);
    expect(tabelas.every((t) => t.forcado)).toBe(true);
  });
});
