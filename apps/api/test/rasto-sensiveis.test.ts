import { createHmac, randomBytes } from "node:crypto";
import { copyFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Kysely, PostgresDialect, sql } from "kysely";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { BaseDados } from "../src/base/esquema.js";
import { migrar, PASTA_MIGRACOES } from "../src/base/migracoes.js";
import { registarComerciante } from "../src/comerciante/repositorio.js";
import {
  apagarBase,
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";

// O rasto de auditoria comum, passo 3 (docs/28 §3.4; migração 0054; #322):
// os campos sensíveis dos Clientes guardam um marcador, nunca o valor.

const SENHA = "so-para-testes";
const RESUMO = /^[0-9a-f]{8}$/;

interface Marcador {
  protegido: true;
  resumo: string;
}
type Campos = Record<string, { antes: unknown; depois: unknown }>;

/** Uma ficha criada como a API a cria, no comerciante dado. */
async function comCliente<T>(
  db: Kysely<BaseDados>,
  c: string,
  fn: (trx: Kysely<BaseDados>) => Promise<T>,
): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await sql`select set_config('eurolify.comerciante', ${c}, true),
      set_config('eurolify.quem', 'teste:sql', true)`.execute(trx);
    return fn(trx);
  });
}

describe.skipIf(URL_BASE === undefined)(
  "rasto: os campos sensíveis (0054)",
  () => {
    let base: BaseDeTeste;
    let a: string;

    beforeAll(async () => {
      base = await criarBaseDeTeste(URL_BASE ?? "");
      a = await registarComerciante(base.api, {
        nome: "Loja A",
        lingua: "pt",
        fuso: "Europe/Lisbon",
      });
    }, 60_000);

    afterAll(async () => {
      await base.fechar();
    });

    async function linhas(
      cliente: string,
    ): Promise<{ entidade: string; campos: Campos }[]> {
      const { rows } = await sql<{ entidade: string; campos: Campos }>`
      select entidade, campos from alteracao_cliente
      where cliente_id = ${cliente}::uuid order by id`.execute(base.dono);
      return rows;
    }

    it("o nome, os e-mails e os telefones da ficha ficam marcados; a língua fica em claro", async () => {
      const id = await comCliente(base.api, a, async (trx) => {
        const { id } = await trx
          .insertInto("cliente")
          .values({
            comerciante_id: a,
            nome: "Ana Sousa",
            emails: ["ana@exemplo.pt"],
            lingua: "pt",
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        return id;
      });
      await comCliente(base.api, a, (trx) =>
        trx
          .updateTable("cliente")
          .set({ emails: ["ana.sousa@exemplo.pt"], lingua: "en" })
          .where("id", "=", id)
          .execute(),
      );
      const [criado, alterado] = await linhas(id);
      // Ao criar: o «antes» não existia (fica vazio); o «depois» é o marcador.
      expect(criado?.campos["nome"]).toEqual({
        antes: null,
        depois: {
          protegido: true,
          resumo: expect.stringMatching(RESUMO) as string,
        },
      });
      expect(alterado?.campos["lingua"]).toEqual({ antes: "pt", depois: "en" });
      const emails = alterado?.campos["emails"] as {
        antes: Marcador;
        depois: Marcador;
      };
      expect(emails.antes).toEqual({
        protegido: true,
        resumo: expect.stringMatching(RESUMO) as string,
      });
      expect(emails.antes.resumo).not.toBe(emails.depois.resumo);
      // O mesmo valor dá o mesmo resumo: o e-mail de antes da alteração é o
      // de depois da criação.
      expect(emails.antes.resumo).toBe(
        (criado?.campos["emails"] as { depois: Marcador }).depois.resumo,
      );
      const tudo = JSON.stringify(await linhas(id));
      expect(tudo).not.toContain("exemplo.pt");
      expect(tudo).not.toContain("Ana Sousa");
    });

    it("o resumo é o HMAC-SHA-256 do valor com a chave da base, cortado a 8", async () => {
      const { rows } = await sql<{ interna: Buffer; resumo: string }>`
      select interna, rasto_resumo('["x@exemplo.pt"]'::jsonb) as resumo
      from chave_do_rasto`.execute(base.dono);
      const linha = rows[0];
      if (linha === undefined) throw new Error("sem chave");
      // A chave é a parte interna sem o 0x36 (RFC 2104), nos 32 primeiros bytes.
      const chave = Buffer.from(
        linha.interna.subarray(0, 32).map((b) => b ^ 0x36),
      );
      const esperado = createHmac("sha256", chave)
        .update('["x@exemplo.pt"]')
        .digest("hex")
        .slice(0, 8);
      expect(linha.resumo).toBe(esperado);
    });

    it("o nome de uma etiqueta não é sensível: a lista é por entidade", async () => {
      const etiqueta = await comCliente(base.api, a, async (trx) => {
        const { id } = await trx
          .insertInto("etiqueta_cliente")
          .values({ comerciante_id: a, nome: "VIP" })
          .returning("id")
          .executeTakeFirstOrThrow();
        return id;
      });
      const { rows } = await sql<{ campos: Campos }>`
      select campos from alteracao_cliente
      where entidade = 'etiqueta_cliente' and entidade_id = ${etiqueta}::uuid`.execute(
        base.dono,
      );
      expect(rows[0]?.campos["nome"]).toEqual({ antes: null, depois: "VIP" });
    });

    it("a API não lê a chave nem a lista, nem calcula resumos", async () => {
      for (const consulta of [
        sql`select * from chave_do_rasto`,
        sql`select * from campo_sensivel`,
        sql`select rasto_resumo('1'::jsonb)`,
        sql`select rasto_proteger('alteracao_cliente', 'cliente', '{}'::jsonb)`,
      ]) {
        await expect(consulta.execute(base.api)).rejects.toThrow(
          /permission denied/,
        );
      }
    });
  },
);

describe.skipIf(URL_BASE === undefined)(
  "migração 0054 sobre dados (Q2)",
  () => {
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

    async function baseAte0053(): Promise<Kysely<BaseDados>> {
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
        await pastaAte("0053_rasto_colunas.sql"),
      );
      return db;
    }

    it("os valores em claro de dois comerciantes passam a marcador; o rasto volta a só se acrescentar e o RLS forçado", async () => {
      const db = await baseAte0053();
      const novo = { lingua: "pt", fuso: "Europe/Lisbon" };
      const A = await registarComerciante(db, { nome: "A", ...novo });
      const B = await registarComerciante(db, { nome: "B", ...novo });
      for (const [c, nome] of [
        [A, "Rui Antigo"],
        [B, "Eva Antiga"],
      ] as const) {
        await comCliente(db, c, (trx) =>
          trx
            .insertInto("cliente")
            .values({
              comerciante_id: c,
              nome,
              emails: [`${nome.slice(0, 1)}@exemplo.pt`],
            })
            .execute(),
        );
      }
      // Antes da 0054, o nome está em claro no rasto.
      const antes = await comCliente(db, A, async (trx) => {
        const { rows } = await sql<{ t: string }>`
        select campos::text as t from alteracao_cliente`.execute(trx);
        return rows.map((r) => r.t).join();
      });
      expect(antes).toContain("Rui Antigo");

      await migrar(db as Kysely<unknown>, PASTA_MIGRACOES);

      for (const [c, nome] of [
        [A, "Rui Antigo"],
        [B, "Eva Antiga"],
      ] as const) {
        const campos = await comCliente(db, c, async (trx) => {
          const { rows } = await sql<{ campos: Campos }>`
          select campos from alteracao_cliente`.execute(trx);
          return rows;
        });
        expect(campos).toHaveLength(1);
        const texto = JSON.stringify(campos);
        expect(texto).not.toContain(nome);
        expect(texto).not.toContain("exemplo.pt");
        expect(campos[0]?.campos["nome"]?.depois).toEqual({
          protegido: true,
          resumo: expect.stringMatching(RESUMO) as string,
        });
      }
      // O rasto volta a recusar alterações, e o RLS volta forçado.
      await expect(
        comCliente(db, A, (trx) =>
          sql`update alteracao_cliente set quem = 'x'`.execute(trx),
        ),
      ).rejects.toThrow(/audit\.append_only/);
      const { rows } = await sql<{ forcado: boolean }>`
      select relforcerowsecurity as forcado from pg_class
      where relname = 'alteracao_cliente'`.execute(db);
      expect(rows).toEqual([{ forcado: true }]);
    });
  },
);
