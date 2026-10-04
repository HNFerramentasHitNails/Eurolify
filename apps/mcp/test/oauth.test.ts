import { createHash, randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { criarApp } from "../src/app.js";
import { AutorizacaoGitHub } from "../src/oauth.js";
import type { FilaDePedidos } from "../src/pedidos.js";

const RETORNO_CLAUDE = "https://claude.ai/api/mcp/auth_callback";
const DIOGO = 259400126;
const BRUNO = 176623429;
const fetchReal = globalThis.fetch;

/** O GitHub de mentira: diz que quem fez login foi a conta `id` (`login`). */
function simularGitHub(id: number, login: string) {
  vi.stubGlobal("fetch", (url: string | URL | Request, init?: RequestInit) => {
    const u =
      typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    if (u.startsWith("https://github.com/login/oauth/access_token")) {
      return Promise.resolve(Response.json({ access_token: "gho_teste" }));
    }
    if (u.startsWith("https://api.github.com/user")) {
      return Promise.resolve(Response.json({ id, login }));
    }
    return fetchReal(url, init);
  });
}

describe("OAuth do MCP com o GitHub", () => {
  let servidor: Server;
  let base: string;
  const fila = {
    pedir: vi.fn(() =>
      Promise.resolve({ codigo: 0, saida: "medição de teste" }),
    ),
  } as unknown as FilaDePedidos;

  beforeEach(async () => {
    servidor = await new Promise<Server>((resolver) => {
      const s = criarApp({
        urlPublico: "http://127.0.0.1",
        autorizacao: new AutorizacaoGitHub({
          urlPublico: "http://127.0.0.1",
          githubClientId: "id-de-teste",
          githubClientSecret: "segredo-de-teste",
          contasPermitidas: [DIOGO, BRUNO],
        }),
        fila,
      }).listen(0, "127.0.0.1", () => {
        resolver(s);
      });
    });
    base = `http://127.0.0.1:${String((servidor.address() as AddressInfo).port)}`;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    servidor.close();
  });

  async function registar(): Promise<string> {
    const r = await fetch(`${base}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        redirect_uris: [RETORNO_CLAUDE],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        client_name: "teste",
      }),
    });
    expect(r.status).toBe(201);
    return ((await r.json()) as { client_id: string }).client_id;
  }

  /** Vai do /authorize ao regresso do GitHub e devolve o URL final para o Claude. */
  async function login(
    clientId: string,
    verificador: string,
    conta: [number, string],
  ): Promise<URL> {
    const desafio = createHash("sha256")
      .update(verificador)
      .digest("base64url");
    const pedido = new URL(`${base}/authorize`);
    pedido.search = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: RETORNO_CLAUDE,
      code_challenge: desafio,
      code_challenge_method: "S256",
      state: "estado-do-claude",
    }).toString();
    const paraGitHub = await fetch(pedido, { redirect: "manual" });
    expect(paraGitHub.status).toBe(302);
    const github = new URL(paraGitHub.headers.get("location") ?? "");
    expect(github.origin).toBe("https://github.com");

    simularGitHub(...conta);
    const volta = await fetch(
      `${base}/oauth/github/callback?code=codigo-github&state=${github.searchParams.get("state") ?? ""}`,
      { redirect: "manual" },
    );
    expect(volta.status).toBe(302);
    return new URL(volta.headers.get("location") ?? "");
  }

  async function trocar(clientId: string, codigo: string, verificador: string) {
    return fetch(`${base}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: codigo,
        code_verifier: verificador,
        client_id: clientId,
        redirect_uri: RETORNO_CLAUDE,
      }),
    });
  }

  it("publica os metadados com registo dinâmico e PKCE S256", async () => {
    const r = await fetch(`${base}/.well-known/oauth-authorization-server`);
    expect(r.status).toBe(200);
    const meta = (await r.json()) as Record<string, unknown>;
    expect(meta["registration_endpoint"]).toBeTruthy();
    expect(meta["code_challenge_methods_supported"]).toContain("S256");
  });

  it("o /mcp sem token responde 401 e diz onde estão os metadados", async () => {
    const r = await fetch(`${base}/mcp`, { method: "POST", body: "{}" });
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate") ?? "").toContain(
      "resource_metadata",
    );
  });

  it("uma conta fora da lista é recusada e não recebe código", async () => {
    const clientId = await registar();
    const final = await login(clientId, randomBytes(32).toString("base64url"), [
      999,
      "intruso",
    ]);
    expect(final.searchParams.get("error")).toBe("access_denied");
    expect(final.searchParams.get("code")).toBeNull();
    expect(final.searchParams.get("state")).toBe("estado-do-claude");
  });

  it("o nome de uma conta da lista com outro número é recusado", async () => {
    const clientId = await registar();
    const final = await login(clientId, randomBytes(32).toString("base64url"), [
      12345,
      "bruno-88",
    ]);
    expect(final.searchParams.get("error")).toBe("access_denied");
    expect(final.searchParams.get("code")).toBeNull();
  });

  it("um cliente com retorno que não é o do Claude não se regista", async () => {
    const r = await fetch(`${base}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        redirect_uris: [RETORNO_CLAUDE, "https://intruso.example/volta"],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      }),
    });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error?: string }).error).toBe(
      "invalid_client_metadata",
    );
  });

  it("o login no GitHub pede sempre a escolha da conta", async () => {
    const clientId = await registar();
    const pedido = new URL(`${base}/authorize`);
    pedido.search = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: RETORNO_CLAUDE,
      code_challenge: "a".repeat(43),
      code_challenge_method: "S256",
    }).toString();
    const r = await fetch(pedido, { redirect: "manual" });
    const github = new URL(r.headers.get("location") ?? "");
    expect(github.searchParams.get("prompt")).toBe("select_account");
  });

  it("uma conta da lista entra, e o código só serve uma vez", async () => {
    const clientId = await registar();
    const verificador = randomBytes(32).toString("base64url");
    const final = await login(clientId, verificador, [BRUNO, "bruno-88"]);
    const codigo = final.searchParams.get("code") ?? "";
    expect(codigo).not.toBe("");
    expect(final.searchParams.get("state")).toBe("estado-do-claude");

    const r = await trocar(clientId, codigo, verificador);
    expect(r.status).toBe(200);
    expect(
      ((await r.json()) as { access_token?: string }).access_token,
    ).toBeTruthy();

    const outraVez = await trocar(clientId, codigo, verificador);
    expect(outraVez.status).toBe(400);
  });

  it("um code_verifier errado (PKCE) é recusado", async () => {
    const clientId = await registar();
    const final = await login(clientId, randomBytes(32).toString("base64url"), [
      DIOGO,
      "HNFerramentasHitNails",
    ]);
    const r = await trocar(
      clientId,
      final.searchParams.get("code") ?? "",
      "verificador-errado-".repeat(3),
    );
    expect(r.status).toBe(400);
  });

  it("com token, lista as 8 ferramentas e as acções vêm marcadas como destrutivas", async () => {
    const clientId = await registar();
    const verificador = randomBytes(32).toString("base64url");
    const final = await login(clientId, verificador, [
      DIOGO,
      "HNFerramentasHitNails",
    ]);
    const tokens = (await (
      await trocar(clientId, final.searchParams.get("code") ?? "", verificador)
    ).json()) as {
      access_token: string;
    };

    const r = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      }),
    });
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as {
      result: {
        tools: { name: string; annotations?: { destructiveHint?: boolean } }[];
      };
    };
    const nomes = corpo.result.tools.map((t) => t.name).sort();
    expect(nomes).toEqual(
      [
        "actualizar_vps",
        "correr_copia",
        "correr_reposicao",
        "estado_do_ensaio",
        "publicacoes_recentes",
        "reiniciar_api",
        "reiniciar_vps",
        "voltar_a_publicacao",
      ].sort(),
    );
    for (const t of corpo.result.tools) {
      const leitura =
        t.name === "estado_do_ensaio" || t.name === "publicacoes_recentes";
      expect(t.annotations?.destructiveHint, t.name).toBe(!leitura);
    }
  });

  it("um token inventado é recusado", async () => {
    const r = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        Authorization: "Bearer inventado",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    expect(r.status).toBe(401);
  });
});
