import { request } from "node:http";
import { Type } from "typebox";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarApp } from "../src/app.js";
import { RESPOSTA_DE_ERRO } from "../src/base/erros.js";
import {
  comRasto,
  comRastoNaBase,
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

  it("recusa o cabeçalho repetido, como o Node o junta (revisão, P3-4)", () => {
    expect(() => iaDoCabecalho("modelo=a, modelo=b")).toThrow(/Eurolify-IA/);
    expect(() => iaDoCabecalho(["modelo=a", "modelo=b"])).toThrow(
      /Eurolify-IA/,
    );
  });
});

describe("o contexto em cada pedido (app.ts)", () => {
  it("chega ao resto do pedido, um por pedido, mesmo em simultâneo", async () => {
    const app = criarApp({
      genReqId: (p) => `req-${String(p.headers["eurolify-ia"]).slice(7)}`,
    });
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
        pedido: `req-${m}`,
        ia: { modelo: m, prova: "declarado" },
      });
    }
    await app.close();
  });

  it("chega ao handler quando o corpo vem aos bocados, num servidor a ouvir (revisão, P1-1)", async () => {
    const app = criarApp({ genReqId: () => "req-corpo" });
    let visto: ContextoRasto | undefined;
    app.post(
      "/teste-rasto",
      {
        config: { ambito: "publico" },
        schema: {
          body: Type.Object({ nome: Type.String() }),
          response: { 200: Type.Object({}), ...RESPOSTA_DE_ERRO },
        },
      },
      async () => {
        await new Promise((r) => setTimeout(r, 1));
        visto = rastoActual();
        return {};
      },
    );
    await app.listen({ port: 0, host: "127.0.0.1" });
    const endereco = app.server.address();
    if (endereco === null || typeof endereco === "string") throw new Error();
    const estado = await new Promise<number | undefined>((resolver, falhar) => {
      const pedido = request(
        {
          host: "127.0.0.1",
          port: endereco.port,
          method: "POST",
          path: "/teste-rasto",
          headers: {
            "content-type": "application/json",
            "content-length": "14",
            "eurolify-ia": "modelo=m",
          },
        },
        (resposta) => {
          resposta.resume();
          resposta.on("end", () => {
            resolver(resposta.statusCode);
          });
        },
      );
      pedido.on("error", falhar);
      pedido.flushHeaders();
      // O corpo chega depois, em dois bocados: o fim dele vem no contexto
      // da ligação, não no do pedido.
      setTimeout(() => {
        pedido.write('{"nome":');
        setTimeout(() => {
          pedido.end('"abc"}');
        }, 20);
      }, 20);
    });
    await app.close();
    expect(estado).toBe(200);
    expect(visto).toEqual({
      canal: "api",
      pedido: "req-corpo",
      ia: { modelo: "m", prova: "declarado" },
    });
  });

  it("nas rotas do Hub, o canal é «hub», pela marca da rota", async () => {
    const app = criarApp();
    let visto: ContextoRasto | undefined;
    app.get(
      "/teste-hub",
      {
        config: { ambito: "publico", hub: true },
        schema: { response: { 200: Type.Object({}), ...RESPOSTA_DE_ERRO } },
      },
      () => {
        visto = rastoActual();
        return {};
      },
    );
    const r = await app.inject({ method: "GET", url: "/teste-hub" });
    expect(r.statusCode).toBe(200);
    expect(visto?.canal).toBe("hub");
    await app.close();
  });

  it("um identificador do pedido que a base não aceitaria fica de fora (P3-3)", async () => {
    const app = criarApp({ genReqId: () => "req /com espaço" });
    let visto: ContextoRasto | undefined;
    app.addHook("preHandler", (_pedido, _resposta, feito) => {
      visto = rastoActual();
      feito();
    });
    await app.inject({ method: "GET", url: "/health" });
    expect(visto).toEqual({ canal: "api" });
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
  "contexto_do_rasto() na base (0051)",
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

    it("fora de um pedido, nada se inventa: o canal fica desconhecido", async () => {
      expect(rastoActual()).toBeUndefined();
      expect(await lido()).toEqual({ quem: "teste:base" });
    });

    it("uma tarefa agendada com o canal «sistema» leva-o à base", async () => {
      const contexto = await comRasto(
        { canal: "sistema", pedido: "tarefa:fila_vies" },
        () =>
          new Promise((resolver, falhar) => {
            setTimeout(() => {
              lido().then(resolver, falhar);
            }, 1);
          }),
      );
      expect(contexto).toEqual({
        quem: "teste:base",
        canal: "sistema",
        pedido: "tarefa:fila_vies",
      });
    });

    it("comRastoNaBase leva o contexto sem comerciante (o operador)", async () => {
      const contexto = await comRasto(
        { canal: "operador", pedido: "github-run:42" },
        () =>
          comRastoNaBase(base.api, async (trx) => {
            const { rows } = await sql<{
              c: unknown;
            }>`select contexto_do_rasto() as c`.execute(trx);
            return rows[0]?.c;
          }),
      );
      expect(contexto).toEqual({
        quem: "teste:base",
        canal: "operador",
        pedido: "github-run:42",
      });
    });

    it("aceita os limites: motivo de 500 e pedido de 100 caracteres", async () => {
      const contexto = await comRasto(
        { canal: "api", pedido: "p".repeat(100), motivo: "m".repeat(500) },
        lido,
      );
      expect(contexto).toMatchObject({
        pedido: "p".repeat(100),
        motivo: "m".repeat(500),
      });
      // Acima de 500, corta-se (0053; revisão do #334, P1-1).
      const cortado = await comRasto(
        { canal: "api", motivo: "m".repeat(600) },
        lido,
      );
      expect(cortado).toMatchObject({ motivo: "m".repeat(500) });
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

    it("o quem de uma chave ou de uma pessoa tem de ser quem se autenticou (0062)", async () => {
      const ka = `chave:key_${"a".repeat(8)}-aaaa-aaaa-aaaa-${"a".repeat(12)}`;
      const kb = `chave:key_${"b".repeat(8)}-bbbb-bbbb-bbbb-${"b".repeat(12)}`;
      const pa = `pessoa:per_${"a".repeat(8)}-aaaa-aaaa-aaaa-${"a".repeat(12)}`;
      const comQuem = (autenticado: string, quem: string) =>
        comRasto({ canal: "api", autenticado }, () =>
          comComerciante(base.api, a, async (trx) => {
            await sql`select set_config('eurolify.quem', ${quem}, true)`.execute(
              trx,
            );
            const { rows } = await sql<{
              c: { quem?: string };
            }>`select contexto_do_rasto() as c`.execute(trx);
            return rows[0]?.c.quem;
          }),
        );
      // O mesmo: passa.
      expect(await comQuem(ka, ka)).toBe(ka);
      // Outra chave, ou uma pessoa, com a chave A autenticada: recusa.
      await expect(comQuem(ka, kb)).rejects.toThrow(
        /quem executou não é quem se autenticou/,
      );
      await expect(comQuem(ka, pa)).rejects.toThrow(
        /quem executou não é quem se autenticou/,
      );
      // As consequências e os actores sem chave nem sessão passam.
      for (const quem of [
        "sistema:encomendas",
        "catalogo:variante apagada",
        "checkout:chk_1",
        "prestador:eupago",
      ]) {
        expect(await comQuem(ka, quem)).toBe(quem);
      }
      // Um autenticado mal formado recusa-se.
      await expect(comQuem("chave:outra", ka)).rejects.toThrow(
        /autenticado mal formado/,
      );
    });

    it("o contexto fica só na sua transacção", async () => {
      await comRasto({ canal: "mcp", pedido: "req-1" }, lido);
      expect(await lido()).toEqual({ quem: "teste:base" });
    });

    it.each<[string, Record<string, unknown>]>([
      ["canal desconhecido", { canal: "email" }],
      ["pedido mal formado", { pedido: "req 1; drop" }],
      ["pedido com 101 caracteres", { pedido: "p".repeat(101) }],
      ["IA com valor numérico", { ia: { prova: "declarado", modelo: 4 } }],
      ["IA com valor vazio", { ia: { prova: "declarado", modelo: "" } }],
      ["IA em lista", { ia: [{ prova: "declarado" }] }],
      ["quem autoriza é uma chave", { autorizadoPor: "chave:key_1" }],
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
