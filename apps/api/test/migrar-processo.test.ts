import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PASTA_MIGRACOES } from "../src/base/migracoes.js";
import { apagarBase, URL_BASE } from "./base-de-teste.js";

// O programa que a publicação corre (`node dist/migrar.js`), como processo:
// o código de saída é o que faz o `eurolify-publicar` parar, e a saída inteira
// (stdout e stderr) é o que vai para o registo da publicação (4.ª revisão do
// #80, P2-1). Compila-se para uma pasta dentro de node_modules/.cache, para o
// Node encontrar o `pg` e o `kysely`.

const correr = promisify(execFile);
const API = new URL("../", import.meta.url);
const TSC = fileURLToPath(
  new URL("../../../node_modules/.bin/tsc", import.meta.url),
);
const PASTA = new URL(
  `node_modules/.cache/migrar-${randomBytes(6).toString("hex")}/`,
  API,
);
const MIGRACAO_QUE_FALHA = `
CREATE TABLE cliente_x (id integer PRIMARY KEY, email text, nome text NOT NULL);
INSERT INTO cliente_x VALUES (1, 'maria.silva@exemplo.pt', 'Maria Silva');
UPDATE cliente_x SET nome = NULL;
`;

interface Resultado {
  codigo: number;
  tudo: string;
}

describe.skipIf(URL_BASE === undefined)("dist/migrar.js como processo", () => {
  const aFechar: (() => Promise<void>)[] = [];

  beforeAll(async () => {
    await mkdir(PASTA, { recursive: true });
    await correr(TSC, [
      "-p",
      fileURLToPath(new URL("tsconfig.build.json", API)),
      "--outDir",
      fileURLToPath(new URL("dist", PASTA)),
    ]);
    // dist/base/migracoes.js procura ../../migracoes/.
    await cp(PASTA_MIGRACOES, new URL("migracoes", PASTA), { recursive: true });
  }, 120_000);

  afterAll(async () => {
    await rm(PASTA, { recursive: true, force: true });
  });

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
      throw new AggregateError(erros, "a limpeza de migrar-processo falhou");
    }
  });

  async function baseNova(): Promise<string> {
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
    const url = new URL(urlAdmin);
    url.pathname = `/${nome}`;
    return url.toString();
  }

  async function migrarComo(url: string): Promise<Resultado> {
    try {
      const { stdout, stderr } = await correr(
        process.execPath,
        [fileURLToPath(new URL("dist/migrar.js", PASTA))],
        { env: { PATH: process.env["PATH"], BASE_DADOS_URL_MIGRACAO: url } },
      );
      return { codigo: 0, tudo: stdout + stderr };
    } catch (erro) {
      const e = erro as { code?: unknown; stdout?: string; stderr?: string };
      return {
        codigo: typeof e.code === "number" ? e.code : -1,
        tudo: (e.stdout ?? "") + (e.stderr ?? ""),
      };
    }
  }

  it("sem falhas: sai com 0 e diz o que aplicou", async () => {
    const { codigo, tudo } = await migrarComo(await baseNova());
    expect(codigo).toBe(0);
    expect(tudo).toMatch(/^migrar: aplicadas 0001_comerciante, /);
  });

  it("uma migração que falha numa linha com dados pessoais: sai com 1 e só diz onde", async () => {
    const extra = new URL("migracoes/9999_ensaio.sql", PASTA);
    await writeFile(extra, MIGRACAO_QUE_FALHA);
    aFechar.push(() => rm(extra, { force: true }));
    const url = await baseNova();
    const { codigo, tudo } = await migrarComo(url);
    expect(codigo).toBe(1);
    expect(tudo.trim()).toBe(
      "migrar: falhou: code=23502 schema=public table=cliente_x column=nome",
    );
    // E nunca a URL da base (leva o utilizador e a palavra-passe de teste).
    expect(tudo).not.toContain(new URL(url).password);
  });
});
