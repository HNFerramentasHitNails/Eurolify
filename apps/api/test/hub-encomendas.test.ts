import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chavePagamentos } from "../src/pagamentos/cifra.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";
import { cenariosDeEnvios, type Cenario } from "./envios-cenario.js";
import { eupagoFalso } from "./eupago-falso.js";
import { hubDeTeste } from "./hub-de-teste.js";
import { transportadoraFalsa } from "./transportadora-falsa.js";

// As encomendas pelo Hub (docs/22 §35): a lista e a ficha só com orders:read
// (o dono, o gestor e o apoio; o armazém não), sem escrita, sempre fora das
// caches, e nunca as de outro comerciante.

type Json = Record<string, unknown>;

describe.skipIf(URL_BASE === undefined)("Hub: encomendas", () => {
  let base: BaseDeTeste;
  let h: ReturnType<typeof hubDeTeste>;
  const eupago = eupagoFalso();
  const ctt = transportadoraFalsa();
  let s: Cenario;
  let outro = "";
  const p: Record<string, { sessao: string }> = {};

  beforeAll(async () => {
    base = await criarBaseDeTeste(URL_BASE ?? "");
    h = hubDeTeste(base, {
      envios: {
        chave: chavePagamentos(randomBytes(32).toString("base64")),
        adaptadores: { ctt: ctt.adaptador },
        tempoLimiteMs: 1000,
      },
      pagamentos: eupago.config,
      limites: { pedidos: 100_000, janelaMs: 60_000 },
    });
    s = await apoio.cenario();
    for (const papel of ["dono", "gestor", "apoio", "armazem"]) {
      p[papel] = { sessao: (await h.pessoaCom(s.c, papel)).sessao };
    }
    const b = await apoio.cenario();
    outro = b.c;
    p["donoB"] = { sessao: (await h.pessoaCom(outro, "dono")).sessao };
  }, 180_000);

  afterAll(async () => {
    await h.app.close();
    await base.fechar();
  });

  const apoio = cenariosDeEnvios(
    () => h.app,
    () => base,
  );
  const ler = (papel: string, url: string) =>
    h.pedir("GET", url, {
      sessao: p[papel]?.sessao ?? "",
      comerciante: papel === "donoB" ? outro : s.c,
    });

  it("o dono, o gestor e o apoio vêem a lista sem dados pessoais e a ficha com as linhas, fora das caches; o armazém não vê", async () => {
    ctt.estado.pedir = "emitir";
    const { encomenda } = await apoio.expedicaoPaga(s, s.metodoCtt, 2, false);
    for (const papel of ["dono", "gestor", "apoio"]) {
      const r = await ler(papel, "/hub/orders");
      expect(r.statusCode, r.body).toBe(200);
      expect(r.headers["cache-control"]).toBe("private, no-store");
      const corpo = r.json<{ dados: Json[]; limite: number }>();
      expect(corpo.limite).toBe(100);
      const e = corpo.dados.find((x) => x["id"] === encomenda);
      expect(Object.keys(e ?? {}).sort()).toEqual(
        ["id", "estado", "total", "moeda", "cliente", "criada_em"].sort(),
      );
      expect(r.body).not.toContain("rui@exemplo.pt");
      const f = await ler(papel, `/hub/orders/${encomenda}`);
      expect(f.statusCode, f.body).toBe(200);
      expect(f.headers["cache-control"]).toBe("private, no-store");
      const ficha = f.json<Json>();
      expect(ficha["id"]).toBe(encomenda);
      expect((ficha["linhas"] as Json[]).length).toBeGreaterThan(0);
      expect(ficha["totais"]).toBeTypeOf("object");
      const t = await ler(papel, `/hub/orders/${encomenda}/timeline`);
      expect(t.statusCode, t.body).toBe(200);
      expect(t.json<{ dados: Json[] }>().dados.length).toBeGreaterThan(0);
    }
    for (const url of [
      "/hub/orders",
      `/hub/orders/${encomenda}`,
      `/hub/orders/${encomenda}/timeline`,
    ]) {
      const r = await ler("armazem", url);
      expect(r.statusCode, url).toBe(403);
      expect(r.headers["cache-control"]).toBe("private, no-store");
    }
  });

  it("o filtro por estado só traz esse estado; um estado desconhecido é recusado", async () => {
    const { encomenda } = await apoio.expedicaoPaga(s, s.metodoCtt, 1, false);
    const todas = (await ler("dono", "/hub/orders")).json<{ dados: Json[] }>()
      .dados;
    const estado = String(todas.find((x) => x["id"] === encomenda)?.["estado"]);
    const filtradas = (await ler("dono", `/hub/orders?estado=${estado}`)).json<{
      dados: Json[];
    }>().dados;
    expect(filtradas.length).toBeGreaterThan(0);
    expect(filtradas.every((x) => x["estado"] === estado)).toBe(true);
    expect(filtradas.some((x) => x["id"] === encomenda)).toBe(true);
    expect((await ler("dono", "/hub/orders?estado=inventado")).statusCode).toBe(
      400,
    );
  });

  it("outro comerciante não vê a lista nem a ficha nem o rasto, e sem sessão não há nada", async () => {
    const { encomenda } = await apoio.expedicaoPaga(s, s.metodoCtt, 1, false);
    const lista = (await ler("donoB", "/hub/orders")).json<{ dados: Json[] }>()
      .dados;
    expect(lista.some((x) => x["id"] === encomenda)).toBe(false);
    expect((await ler("donoB", `/hub/orders/${encomenda}`)).statusCode).toBe(
      404,
    );
    expect(
      (await ler("donoB", `/hub/orders/${encomenda}/timeline`)).statusCode,
    ).toBe(404);
    // A sessão de B com o cabeçalho do comerciante A não passa.
    const cruzado = await h.pedir("GET", `/hub/orders/${encomenda}`, {
      sessao: p["donoB"]?.sessao ?? "",
      comerciante: s.c,
    });
    expect(cruzado.statusCode).toBeGreaterThanOrEqual(400);
    expect(
      (await h.pedir("GET", "/hub/orders", { comerciante: s.c })).statusCode,
    ).toBe(401);
  });

  it("não há escrita: POST, PUT, PATCH e DELETE na encomenda não existem", async () => {
    const { encomenda } = await apoio.expedicaoPaga(s, s.metodoCtt, 1, false);
    for (const metodo of ["POST", "PUT", "PATCH", "DELETE"] as const) {
      const r = await h.pedir(metodo, `/hub/orders/${encomenda}`, {
        sessao: p["dono"]?.sessao ?? "",
        comerciante: s.c,
      });
      expect(r.statusCode, metodo).toBeGreaterThanOrEqual(400);
    }
  });
});
