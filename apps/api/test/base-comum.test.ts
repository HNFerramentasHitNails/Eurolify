import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Type } from "typebox";
import { criarApp } from "../src/app.js";
import { RESPOSTA_DE_ERRO, TIPO_PROBLEMA } from "../src/base/erros.js";

// Base comum da API (docs/18): erros RFC 9457 e contrato OpenAPI.

interface Contrato {
  openapi: string;
  paths: Record<
    string,
    Record<
      string,
      { responses?: Record<string, { content?: Record<string, unknown> }> }
    >
  >;
  components?: { schemas?: Record<string, unknown> };
}

describe("base comum da API", () => {
  let app: ReturnType<typeof criarApp>;

  beforeEach(() => {
    app = criarApp();
  });

  afterEach(async () => {
    await app.close();
  });

  describe("erros num formato único (RFC 9457)", () => {
    it("um caminho que não existe dá 404 em problem+json, com código estável", async () => {
      const r = await app.inject({ method: "GET", url: "/nao-existe" });
      expect(r.statusCode).toBe(404);
      expect(r.headers["content-type"]).toMatch(/^application\/problem\+json/);
      expect(r.json()).toEqual({
        type: "/erros/route.not_found",
        title: "Caminho não encontrado",
        status: 404,
        instance: expect.any(String) as string,
        codigo: "route.not_found",
        mensagem: { pt: "Caminho não encontrado", en: "Route not found" },
      });
    });

    it("um método que a rota não tem também dá 404 em problem+json", async () => {
      const r = await app.inject({ method: "DELETE", url: "/health" });
      expect(r.statusCode).toBe(404);
      expect(r.json<{ codigo: string }>().codigo).toBe("route.not_found");
    });

    it("um corpo inválido dá 400 com cada campo em ponteiro JSON", async () => {
      app.post(
        "/teste-validacao",
        {
          schema: {
            body: Type.Object({ nome: Type.String({ minLength: 1 }) }),
            response: { 200: Type.Object({}), ...RESPOSTA_DE_ERRO },
          },
        },
        () => ({}),
      );
      const r = await app.inject({
        method: "POST",
        url: "/teste-validacao",
        payload: { nome: "" },
      });
      expect(r.statusCode).toBe(400);
      expect(r.headers["content-type"]).toMatch(/^application\/problem\+json/);
      const corpo = r.json<{
        codigo: string;
        erros: { campo: string; mensagem: string }[];
      }>();
      expect(corpo.codigo).toBe("request.invalid");
      expect(corpo.erros).toEqual([
        { campo: "/body/nome", mensagem: expect.any(String) as string },
      ]);
    });

    it("um tipo de conteúdo que a rota não aceita dá 415", async () => {
      app.post(
        "/teste-tipo",
        { schema: { response: { 200: Type.Object({}), ...RESPOSTA_DE_ERRO } } },
        () => ({}),
      );
      const r = await app.inject({
        method: "POST",
        url: "/teste-tipo",
        headers: { "content-type": "application/x-nada" },
        payload: "x",
      });
      expect(r.statusCode).toBe(415);
      expect(r.json<{ codigo: string }>().codigo).toBe(
        "media_type.unsupported",
      );
    });

    it("um erro interno dá 500 sem pormenor para o cliente", async () => {
      app.get(
        "/teste-rebenta",
        { schema: { response: { 200: Type.Object({}), ...RESPOSTA_DE_ERRO } } },
        () => {
          throw new Error("segredo da base: password=abc");
        },
      );
      const r = await app.inject({ method: "GET", url: "/teste-rebenta" });
      expect(r.statusCode).toBe(500);
      expect(r.headers["content-type"]).toMatch(/^application\/problem\+json/);
      expect(r.body).not.toContain("segredo");
      expect(r.json<{ codigo: string }>().codigo).toBe("internal.error");
    });
  });

  describe("contrato OpenAPI 3.1", () => {
    async function contrato(): Promise<Contrato> {
      const r = await app.inject({ method: "GET", url: "/openapi.json" });
      expect(r.statusCode).toBe(200);
      return r.json<Contrato>();
    }

    it("é OpenAPI 3.1 e traz o esquema do problema", async () => {
      const c = await contrato();
      expect(c.openapi).toBe("3.1.0");
      expect(Object.keys(c.components?.schemas ?? {})).toContain("Problema");
    });

    it("cada rota do contrato tem o sucesso e o erro em problem+json", async () => {
      const c = await contrato();
      const noContrato = Object.entries(c.paths).flatMap(([caminho, ops]) =>
        Object.keys(ops).map((metodo) => ({ metodo, caminho })),
      );
      expect(noContrato).toEqual([
        { metodo: "get", caminho: "/health" },
        { metodo: "get", caminho: "/paises" },
      ]);
      for (const [caminho, ops] of Object.entries(c.paths)) {
        for (const [metodo, op] of Object.entries(ops)) {
          const respostas = op.responses ?? {};
          expect(respostas["200"], `${metodo} ${caminho}: 200`).toBeDefined();
          for (const erro of ["4XX", "5XX"]) {
            expect(
              Object.keys(respostas[erro]?.content ?? {}),
              `${metodo} ${caminho}: ${erro}`,
            ).toEqual([TIPO_PROBLEMA]);
          }
        }
      }
    });

    it("uma rota sem a resposta de erro não se regista: nada fora do contrato", () => {
      expect(() =>
        app.get(
          "/sem-erro",
          { schema: { response: { 200: Type.Object({}) } } },
          () => ({}),
        ),
      ).toThrow(/fora do contrato/);
      expect(() => app.get("/sem-esquema", () => ({}))).toThrow(
        /fora do contrato/,
      );
    });

    it("o /openapi.json não aparece no próprio contrato", async () => {
      const c = await contrato();
      expect(Object.keys(c.paths)).not.toContain("/openapi.json");
    });
  });
});
