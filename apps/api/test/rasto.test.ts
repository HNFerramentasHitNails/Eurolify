import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarApp } from "../src/app.js";
import {
  canalDoCaminho,
  comRasto,
  iaDoCabecalho,
  rastoActual,
  type ContextoRasto,
} from "../src/base/rasto.js";
import {
  comComerciante,
  registarComerciante,
} from "../src/comerciante/repositorio.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";

// O contexto comum do rasto de auditoria (docs/28 §3.1 e §4, passo 1; #322):
// lido pela API num só sítio e conferido pela base em `contexto_do_rasto()`.

describe("o cabeçalho Eurolify-IA (docs/28 §3.3)", () => {
  it("lê o que vem e grava-o como declarado, nunca como comprovado", () => {
    expect(
      iaDoCabecalho("fornecedor=anthropic; modelo=claude-x; execucao=run_42"),
    ).toEqual({
      fornecedor: "anthropic",
      modelo: "claude-x",
      execucao: "run_42",
      prova: "declarado",
    });
    expect(iaDoCabecalho("modelo=m1")).toEqual({
      modelo: "m1",
      prova: "declarado",
    });
  });

  it("sem cabeçalho, não há IA: fica desconhecido", () => {
    expect(iaDoCabecalho(undefined)).toBeUndefined();
  });

  it.each([
    "",
    "  ",
    "prova=comprovado",
    "fornecedor=a; fornecedor=b",
    "fornecedor=",
    "fornecedor=tem espaço",
    "modelo=" + "x".repeat(101),
    "lixo",
  ])("recusa um cabeçalho mal formado: %j", (valor) => {
    expect(() => iaDoCabecalho(valor)).toThrow(/Eurolify-IA/);
  });

  it("recusa o cabeçalho repetido (chega como lista)", () => {
    expect(() => iaDoCabecalho(["modelo=a", "modelo=b"])).toThrow(
      /Eurolify-IA/,
    );
  });
});

describe("o canal de um pedido HTTP", () => {
  it("o Hub pelas suas rotas, o resto é a API", () => {
    expect(canalDoCaminho("/hub/session")).toBe("hub");
    expect(canalDoCaminho("/hub")).toBe("hub");
    expect(canalDoCaminho("/hubx")).toBe("api");
    expect(canalDoCaminho("/v1/products")).toBe("api");
  });
});

describe("o contexto em cada pedido (app.ts)", () => {
  it("chega ao resto do pedido, um por pedido, mesmo em simultâneo", async () => {
    const app = criarApp({ genReqId: (p) => `req-${String(p.url)}` });
    const vistos = new Map<string, ContextoRasto | undefined>();
    app.addHook("preHandler", async (pedido) => {
      await new Promise((r) => setTimeout(r, 5));
      vistos.set(String(pedido.headers["eurolify-ia"]), rastoActual());
    });
    await app.ready();
    const respostas = await Promise.all(
      ["a", "b", "c"].map((m) =>
        app.inject({
          method: "GET",
          url: "/health",
          headers: { "eurolify-ia": `modelo=${m}` },
        }),
      ),
    );
    expect(respostas.map((r) => r.statusCode)).toEqual([200, 200, 200]);
    // Nada passa para quem chamou (com o `enterWith`, passava).
    expect(rastoActual()).toBeUndefined();
    for (const m of ["a", "b", "c"]) {
      expect(vistos.get(`modelo=${m}`)).toEqual({
        canal: "api",
        pedido: "req-/health",
        ia: { modelo: m, prova: "declarado" },
      });
    }
    await app.close();
  });

  it("um cabeçalho Eurolify-IA mal formado dá 400 com a forma pedida", async () => {
    const app = criarApp();
    const resposta = await app.inject({
      method: "GET",
      url: "/health",
      headers: { "eurolify-ia": "prova=comprovado" },
    });
    expect(resposta.statusCode).toBe(400);
    expect(resposta.json<{ codigo: string; detail: string }>()).toMatchObject({
      codigo: "request.invalid",
      detail: expect.stringContaining("fornecedor=…") as string,
    });
    await app.close();
  });
});

describe.skipIf(URL_BASE === undefined)(
  "contexto_do_rasto() na base (0052)",
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

    // A base de teste põe `eurolify.quem = 'teste:base'` (base-de-teste.ts):
    // o `quem` é do domínio, não deste passo.
    async function lido(): Promise<unknown> {
      return comComerciante(base.api, a, async (trx) => {
        const { rows } = await sql<{
          c: unknown;
        }>`select contexto_do_rasto() as c`.execute(trx);
        return rows[0]?.c;
      });
    }

    it("comComerciante passa o contexto do pedido à base", async () => {
      const contexto = await comRasto(
        {
          canal: "mcp",
          pedido: "req-8f2",
          ia: { fornecedor: "anthropic", modelo: "m", prova: "declarado" },
          autorizadoPor: "pessoa:per_0190e2a4-0000-7000-8000-000000000001",
          motivo: "pedido do titular",
        },
        lido,
      );
      expect(contexto).toEqual({
        quem: "teste:base",
        canal: "mcp",
        pedido: "req-8f2",
        ia: { fornecedor: "anthropic", modelo: "m", prova: "declarado" },
        autorizado_por: "pessoa:per_0190e2a4-0000-7000-8000-000000000001",
        motivo: "pedido do titular",
      });
    });

    it("fora de um pedido, o canal é «sistema» e nada mais se inventa", async () => {
      expect(rastoActual()).toBeUndefined();
      expect(await lido()).toEqual({
        quem: "teste:base",
        canal: "sistema",
      });
    });

    it("o quem e a origem que o domínio põe entram no mesmo contexto", async () => {
      const contexto = await comRasto({ canal: "importacao" }, () =>
        comComerciante(base.api, a, async (trx) => {
          await sql`select set_config('eurolify.quem', 'chave:key_1', true),
            set_config('eurolify.origem', 'importacao:imp_42', true)`.execute(
            trx,
          );
          const { rows } = await sql<{
            c: unknown;
          }>`select contexto_do_rasto() as c`.execute(trx);
          return rows[0]?.c;
        }),
      );
      expect(contexto).toEqual({
        canal: "importacao",
        quem: "chave:key_1",
        origem: "importacao:imp_42",
      });
    });

    it("o contexto fica só na sua transacção", async () => {
      await comRasto({ canal: "mcp", pedido: "req-1" }, lido);
      expect(await lido()).toEqual({
        quem: "teste:base",
        canal: "sistema",
      });
    });

    it.each<[string, Record<string, unknown>]>([
      ["canal desconhecido", { canal: "email" }],
      ["pedido mal formado", { pedido: "req 1; drop" }],
      ["quem autoriza é uma chave", { autorizadoPor: "chave:key_1" }],
      ["motivo comprido", { motivo: "x".repeat(501) }],
      ["IA sem prova", { ia: { modelo: "m" } }],
      ["IA «desconhecido» gravado", { ia: { prova: "desconhecido" } }],
      ["IA com campo a mais", { ia: { prova: "declarado", pessoa: "x" } }],
    ])("recusa o contexto mal formado: %s", async (_nome, parte) => {
      await expect(comRasto({ canal: "api", ...parte }, lido)).rejects.toThrow(
        /audit\.context_invalid/,
      );
    });

    it("a IA em texto que não é JSON é recusada", async () => {
      await expect(
        comComerciante(base.api, a, async (trx) => {
          await sql`select set_config('eurolify.ia', '{nao', true)`.execute(
            trx,
          );
          await sql`select contexto_do_rasto()`.execute(trx);
        }),
      ).rejects.toThrow(/audit\.context_invalid/);
    });
  },
);
