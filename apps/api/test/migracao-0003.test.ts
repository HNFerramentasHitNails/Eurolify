import { randomBytes } from "node:crypto";
import { mkdtemp, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Kysely, PostgresDialect, sql } from "kysely";
import pg from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { migrar, PASTA_MIGRACOES } from "../src/base/migracoes.js";
import { apagarBase, URL_BASE } from "./base-de-teste.js";

// A migração 0003 (SKU sem maiúsculas, P9) sobre uma base que já tem a 0002
// aplicada e dados, como a VPS (revisão do #80, P2-2). Corre com o
// superutilizador: aqui prova-se a migração e o índice, não o RLS.

const COMERCIANTE = "01900000-0000-7000-8000-000000000001";
const OUTRO = "01900000-0000-7000-8000-000000000002";
const ARTIGO = "01900000-0000-7000-8000-0000000000a1";
const ARTIGO_OUTRO = "01900000-0000-7000-8000-0000000000a2";

describe.skipIf(URL_BASE === undefined)("migração 0003 sobre dados", () => {
  const aFechar: (() => Promise<void>)[] = [];

  // Cada limpeza corre mesmo que a anterior falhe; o primeiro erro sai no
  // fim (revisão do #80, 2.ª, P3-B).
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
      throw new AggregateError(erros, "a limpeza da migração 0003 falhou");
    }
  });

  /** Uma base nova, migrada só até à 0002. */
  async function baseAte0002(): Promise<Kysely<unknown>> {
    // Como em base-de-teste.ts: um nome ao acaso não colide com uma base
    // deixada por uma corrida morta (P3-A).
    const nome = `eurolify_teste_${randomBytes(6).toString("hex")}`;
    const urlAdmin = URL_BASE ?? "";
    const admin = new pg.Client({ connectionString: urlAdmin });
    try {
      await admin.connect();
      await admin.query(`CREATE DATABASE ${nome}`);
    } finally {
      await admin.end();
    }
    aFechar.push(async () => {
      const fim = new pg.Client({ connectionString: urlAdmin });
      await fim.connect();
      try {
        await apagarBase(fim, nome);
      } finally {
        await fim.end();
      }
    });

    const pasta = await mkdtemp(join(tmpdir(), "migracoes-ate-0002-"));
    aFechar.push(() => rm(pasta, { recursive: true, force: true }));
    for (const f of ["0001_comerciante.sql", "0002_catalogo_artigos.sql"]) {
      await copyFile(new URL(f, PASTA_MIGRACOES), join(pasta, f));
    }

    const url = new URL(urlAdmin);
    url.pathname = `/${nome}`;
    const db = new Kysely<unknown>({
      dialect: new PostgresDialect({
        pool: new pg.Pool({ connectionString: url.toString(), max: 1 }),
      }),
    });
    aFechar.push(() => db.destroy());
    await migrar(db, pathToFileURL(`${pasta}/`));
    await sql`
      insert into comerciante (id, nome, lingua, fuso) values
        (${COMERCIANTE}, 'A', 'pt', 'Europe/Lisbon'),
        (${OUTRO}, 'B', 'pt', 'Europe/Lisbon');
      `.execute(db);
    await sql`
      insert into artigo (id, comerciante_id, tipo, nome) values
        (${ARTIGO}, ${COMERCIANTE}, 'fisico', 'Gel'),
        (${ARTIGO_OUTRO}, ${OUTRO}, 'fisico', 'Gel')`.execute(db);
    return db;
  }

  async function variante(
    db: Kysely<unknown>,
    comerciante: string,
    artigo: string,
    sku: string,
  ) {
    await sql`
      insert into variante (comerciante_id, artigo_id, sku, unidade_de_venda)
      values (${comerciante}, ${artigo}, ${sku}, 'unidade')`.execute(db);
  }

  async function estado(db: Kysely<unknown>) {
    const { rows } = await sql<{
      migracoes: string[];
      definicao: string | null;
      variantes: number;
    }>`
      select
        (select array_agg(name order by name) from kysely_migration) as migracoes,
        (select pg_get_indexdef(i.indexrelid) from pg_index i
          join pg_class c on c.oid = i.indexrelid
          where c.relname = 'variante_sku_unico') as definicao,
        (select count(*)::int from variante) as variantes`.execute(db);
    return rows[0];
  }

  it("com SKU repetidos sem contar maiúsculas, falha e não muda nada", async () => {
    const db = await baseAte0002();
    await variante(db, COMERCIANTE, ARTIGO, "GEL-001");
    await variante(db, COMERCIANTE, ARTIGO, "gel-001");
    const antes = await estado(db);
    expect(antes?.migracoes).toEqual([
      "0001_comerciante",
      "0002_catalogo_artigos",
    ]);
    expect(antes?.definicao).toMatch(/\(comerciante_id, sku\)/);

    await expect(migrar(db)).rejects.toMatchObject({
      code: "23505",
      detail: expect.stringContaining("gel-001") as unknown,
    });
    expect(await estado(db)).toEqual(antes);
  });

  it("sem repetidos, passa; o índice recusa outras maiúsculas só no mesmo comerciante", async () => {
    const db = await baseAte0002();
    await variante(db, COMERCIANTE, ARTIGO, "GEL-001");
    await variante(db, OUTRO, ARTIGO_OUTRO, "GEL-001");
    await migrar(db);
    const depois = await estado(db);
    expect(depois?.migracoes).toContain("0003_sku_sem_maiusculas");
    expect(depois?.definicao).toMatch(/\(comerciante_id, lower\(sku\)\)/);
    expect(depois?.variantes).toBe(2);

    // Directamente na base, sem o repositório.
    await expect(
      variante(db, COMERCIANTE, ARTIGO, "Gel-001"),
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "variante_sku_unico",
    });
    await variante(db, OUTRO, ARTIGO_OUTRO, "OUTRO-1");
    await expect(
      variante(db, OUTRO, ARTIGO_OUTRO, "outro-1"),
    ).rejects.toMatchObject({ code: "23505" });
  });
});
