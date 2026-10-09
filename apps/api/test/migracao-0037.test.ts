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
import {
  criarEntidadeLegal,
  criarLoja,
  registarComerciante,
} from "../src/comerciante/repositorio.js";
import { criarLista, criarMercado } from "../src/precos/repositorio.js";
import { apagarBase, URL_BASE } from "./base-de-teste.js";

// A migração 0037 (Clientes) sobre uma base com listas B2B que apontavam
// para etiquetas que ainda não tinham tabela (0017), como pode estar a do
// ensaio. Corre com um migrador como o da VPS — dono da base, sem ser
// superutilizador nem ignorar o RLS —, porque é assim que o RLS forçado das
// listas se aplica a quem migra (a 0037 tem de o desligar e voltar a ligar).

const SENHA = "so-para-testes";
const ETIQUETA_1 = "0192a3b4-0000-7000-8000-0000000000e1";
const ETIQUETA_2 = "0192a3b4-0000-7000-8000-0000000000e2";

describe.skipIf(URL_BASE === undefined)("migração 0037 sobre dados", () => {
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

  async function baseAte0036(): Promise<Kysely<BaseDados>> {
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
      await pastaAte("0036_precos_reducao_e_ambitos.sql"),
    );
    return db;
  }

  /** Um comerciante com uma loja; devolve o id e a loja. */
  async function comerciante(db: Kysely<BaseDados>, nome: string) {
    const c = await registarComerciante(db, {
      nome,
      lingua: "pt",
      fuso: "Europe/Lisbon",
    });
    const entidade = await criarEntidadeLegal(db, c, {
      denominacao: `${nome}, Lda.`,
      forma_juridica: "sociedade por quotas",
      pais: "PT",
      numero_fiscal: nome === "A" ? "509999990" : "513207384",
      morada_linha: "Rua 1",
      morada_codigo_postal: "1000-001",
      morada_localidade: "Lisboa",
    });
    const loja = await criarLoja(db, c, {
      entidade_legal_id: entidade,
      nome: "Loja",
    });
    return { c, loja };
  }

  async function listaB2B(
    db: Kysely<BaseDados>,
    c: string,
    loja: string,
    pais: string,
    nome: string,
    etiqueta: string,
  ) {
    const mercado = await criarMercado(db, c, {
      loja_id: loja,
      nome: pais,
      paises: [pais],
      moeda: "EUR",
      linguas: ["pt"],
      lingua_principal: "pt",
    });
    return criarLista(db, c, {
      mercado_id: mercado,
      nome,
      tipo: "b2b",
      etiqueta_id: etiqueta,
      prioridade: 1,
    });
  }

  async function noComerciante<T>(
    db: Kysely<BaseDados>,
    c: string,
    fn: (trx: Kysely<BaseDados>) => Promise<T>,
  ) {
    return db.transaction().execute(async (trx) => {
      await sql`select set_config('eurolify.comerciante', ${c}, true)`.execute(
        trx,
      );
      return fn(trx);
    });
  }

  it("as etiquetas que as listas B2B referiam nascem, sem nomes repetidos nem ids partilhados; a chave entra validada; o RLS volta forçado", async () => {
    const db = await baseAte0036();
    const A = await comerciante(db, "A");
    const B = await comerciante(db, "B");
    // A: duas listas com o mesmo nome, com etiquetas diferentes (o nome da
    // lista não é único), e uma com um nome longo; a mesma etiqueta em duas
    // listas. B: uma lista com o mesmo id de etiqueta que A (a 0017 não lhe
    // dava dono). Revisão do #234, P1-2.
    const longo = "R".repeat(100);
    const l1 = await listaB2B(
      db,
      A.c,
      A.loja,
      "PT",
      "Revendedores",
      ETIQUETA_1,
    );
    await listaB2B(db, A.c, A.loja, "ES", "Revendedores", ETIQUETA_2);
    await listaB2B(db, A.c, A.loja, "FR", longo, ETIQUETA_1);
    const lb = await listaB2B(
      db,
      B.c,
      B.loja,
      "PT",
      "Revendedores",
      ETIQUETA_1,
    );

    const { results } = await migrar(
      db as Kysely<unknown>,
      await pastaAte("0037_clientes.sql"),
    );
    expect(results?.map((r) => [r.migrationName, r.status])).toEqual([
      ["0037_clientes", "Success"],
    ]);

    const deA = await noComerciante(db, A.c, (trx) =>
      trx
        .selectFrom("etiqueta_cliente")
        .select(["id", "nome", "estado"])
        .orderBy("id")
        .execute(),
    );
    expect(deA).toEqual([
      {
        id: ETIQUETA_1,
        nome: `Etiqueta ${ETIQUETA_1} (da lista «Revendedores», 0037)`,
        estado: "activa",
      },
      {
        id: ETIQUETA_2,
        nome: `Etiqueta ${ETIQUETA_2} (da lista «Revendedores», 0037)`,
        estado: "activa",
      },
    ]);
    const deB = await noComerciante(db, B.c, async (trx) => ({
      etiquetas: await trx
        .selectFrom("etiqueta_cliente")
        .select(["id", "nome"])
        .execute(),
      lista: await trx
        .selectFrom("lista_precos")
        .select(["etiqueta_id", "versao"])
        .where("id", "=", lb)
        .executeTakeFirstOrThrow(),
    }));
    // B fica com uma etiqueta nova, e a lista dele aponta para ela.
    expect(deB.etiquetas).toHaveLength(1);
    const nova = deB.etiquetas[0]?.id;
    expect(nova).not.toBe(ETIQUETA_1);
    expect(deB.lista).toEqual({ etiqueta_id: nova, versao: 1 });
    // A lista de A continua com a etiqueta que tinha.
    const listaA = await noComerciante(db, A.c, (trx) =>
      trx
        .selectFrom("lista_precos")
        .select("etiqueta_id")
        .where("id", "=", l1)
        .executeTakeFirstOrThrow(),
    );
    expect(listaA.etiqueta_id).toBe(ETIQUETA_1);

    const { rows: chave } = await sql<{ validada: boolean }>`
      select convalidated as validada from pg_constraint
      where conname = 'lista_precos_da_etiqueta'`.execute(db);
    expect(chave).toEqual([{ validada: true }]);
    const { rows: tabelas } = await sql<{ relname: string; forcado: boolean }>`
      select relname, relforcerowsecurity as forcado from pg_class
      where relname in ('lista_precos', 'etiqueta_cliente', 'cliente', 'perfil_faturacao')
      order by relname`.execute(db);
    expect(tabelas.every((t) => t.forcado)).toBe(true);
    expect(tabelas).toHaveLength(4);
    // O gatilho da lista volta ligado.
    const { rows: gatilho } = await sql<{ tgenabled: string }>`
      select tgenabled from pg_trigger
      where tgname = 'lista_precos_antes_de_gravar'`.execute(db);
    expect(gatilho).toEqual([{ tgenabled: "O" }]);
  });
});
