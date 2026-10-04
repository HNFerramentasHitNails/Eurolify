import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { criarApp } from "../src/app.js";

describe("GET /health", () => {
  let app: ReturnType<typeof criarApp>;

  beforeEach(() => {
    app = criarApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it("responde 200 com o estado ok", async () => {
    const resposta = await app.inject({ method: "GET", url: "/health" });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json<unknown>()).toEqual({ estado: "ok" });
  });

  it("um caminho que não existe dá 404, não 200", async () => {
    const resposta = await app.inject({ method: "GET", url: "/nao-existe" });

    expect(resposta.statusCode).toBe(404);
  });
});
