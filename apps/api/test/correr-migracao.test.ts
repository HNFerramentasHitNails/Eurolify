import { randomBytes } from "node:crypto";
import { copyFile, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { correrMigracao } from "../src/base/correr-migracao.js";
import { PASTA_MIGRACOES } from "../src/base/migracoes.js";
import { apagarBase, URL_BASE } from "./base-de-teste.js";

// O que a publicação escreve quando uma migração falha numa tabela com dados
// pessoais (revisão do #80, 3.ª, P1): só onde falhou, e sem lançar — se
// lançasse, o Node imprimiria o objecto do erro com a linha inteira.

const MIGRACAO_QUE_FALHA = `
CREATE TABLE cliente_x (id integer PRIMARY KEY, email text, nome text NOT NULL);
INSERT INTO cliente_x VALUES (1, 'maria.silva@exemplo.pt', 'Maria Silva');
UPDATE cliente_x SET nome = NULL;
`;

describe.skipIf(URL_BASE === undefined)("correrMigracao", () => {
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
      throw new AggregateError(erros, "a limpeza de correrMigracao falhou");
    }
  });

  /** Uma base vazia e uma pasta com as migrações do produto (+ `extra`). */
  async function preparar(extra?: string) {
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
    const pasta = await mkdtemp(join(tmpdir(), "migracoes-ensaio-"));
    aFechar.push(() => rm(pasta, { recursive: true, force: true }));
    for (const f of await readdir(PASTA_MIGRACOES)) {
      await copyFile(new URL(f, PASTA_MIGRACOES), join(pasta, f));
    }
    if (extra !== undefined) {
      await writeFile(join(pasta, "9999_ensaio.sql"), extra);
    }
    const url = new URL(urlAdmin);
    url.pathname = `/${nome}`;
    return { url: url.toString(), pasta: pathToFileURL(`${pasta}/`) };
  }

  function apanhar() {
    const linhas: string[] = [];
    return {
      linhas,
      saida: {
        log: (t: string) => linhas.push(t),
        erro: (t: string) => linhas.push(t),
      },
    };
  }

  it("uma migração que falha numa linha com dados pessoais: código 1, sem os valores", async () => {
    const { url, pasta } = await preparar(MIGRACAO_QUE_FALHA);
    const { linhas, saida } = apanhar();
    // Não lança: devolve o código (é isto que impede o Node de imprimir).
    const codigo = await correrMigracao(url, saida, pasta);
    expect(codigo).toBe(1);
    const tudo = linhas.join("\n");
    expect(tudo).toContain("migrar: falhou: code=23502");
    expect(tudo).toContain("table=cliente_x");
    expect(tudo).not.toContain("maria.silva@exemplo.pt");
    expect(tudo).not.toContain("Maria Silva");
    expect(tudo).not.toContain("Failing row");
  });

  it("se fechar a ligação falhar, não lança, não escreve valores e fica o código", async () => {
    const { url, pasta } = await preparar();
    const { linhas, saida } = apanhar();
    // Fecha de verdade (a base de teste tem de ficar sem ligações) e depois
    // falha, como um erro ao fechar.
    type Fechar = (this: pg.Pool) => Promise<void>;
    const fecharDeVerdade: unknown = Reflect.get(pg.Pool.prototype, "end");
    const falhar = Object.assign(new Error("ao fechar"), {
      code: "XX000",
      detail: "Failing row contains (maria.silva@exemplo.pt)",
    });
    const fim = vi
      .spyOn(pg.Pool.prototype as unknown as { end: Fechar }, "end")
      .mockImplementationOnce(function (this: pg.Pool) {
        return (fecharDeVerdade as Fechar).call(this).then(() => {
          throw falhar;
        });
      });
    try {
      expect(await correrMigracao(url, saida, pasta)).toBe(0);
    } finally {
      fim.mockRestore();
    }
    const tudo = linhas.join("\n");
    expect(tudo).toContain("migrar: aviso: a ligação não fechou: code=XX000");
    expect(tudo).not.toContain("maria.silva@exemplo.pt");
  });

  it("sem falhas: código 0 e a lista do que se aplicou", async () => {
    const { url, pasta } = await preparar();
    const { linhas, saida } = apanhar();
    expect(await correrMigracao(url, saida, pasta)).toBe(0);
    expect(linhas.join("\n")).toMatch(/^migrar: aplicadas 0001_comerciante, /);
  });
});
