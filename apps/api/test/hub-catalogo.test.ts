import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  mudarEstado,
  registarComerciante,
} from "../src/comerciante/repositorio.js";
import { criarChave } from "../src/identidade/repositorio.js";
import { PAPEIS } from "../src/identidade/papeis.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";
import { hubDeTeste } from "./hub-de-teste.js";

// A lista de artigos no Hub (docs/22 §11; issue #199): GET /hub/products é a
// mesma função, filtros e resposta do GET /products, com a sessão de uma
// pessoa cujo papel tem catalog:read. Contra o PostgreSQL 18.

describe.skipIf(URL_BASE === undefined)("catálogo no Hub (#199)", () => {
  let base: BaseDeTeste;
  let h: ReturnType<typeof hubDeTeste>;

  /** Um comerciante com uma chave de escrita e N artigos criados por ela. */
  async function comerciante(nome: string, artigos: string[]) {
    const c = await registarComerciante(base.api, {
      nome,
      lingua: "pt",
      fuso: "Europe/Lisbon",
    });
    const { segredo } = await criarChave(base.dono, c, {
      tipo: "servidor",
      criadaPor: "operador:teste",
      nome: "Escrita",
      ambitos: ["catalog:read", "catalog:write"],
    });
    for (const n of artigos) {
      const r = await h.app.inject({
        method: "POST",
        url: "/products",
        headers: {
          authorization: `Bearer ${segredo}`,
          "idempotency-key": randomUUID(),
          "content-type": "application/json",
        },
        payload: JSON.stringify({
          tipo: "fisico",
          nome: n,
          categoria_fiscal: "normal",
          variantes: [
            { sku: `H-${randomUUID()}`, unidade_de_venda: "unidade" },
          ],
        }),
      });
      expect(r.statusCode, r.body).toBe(201);
    }
    return { id: c, segredo };
  }

  const pelaChave = (segredo: string, q: string) =>
    h.app.inject({
      method: "GET",
      url: `/products${q}`,
      headers: { authorization: `Bearer ${segredo}` },
    });

  beforeAll(async () => {
    base = await criarBaseDeTeste(URL_BASE ?? "");
    h = hubDeTeste(base);
  }, 60_000);

  afterAll(async () => {
    await h.app.close();
    await base.fechar();
  });

  it("os quatro papéis lêem a lista; é igual à do GET /products, com os mesmos filtros e páginas", async () => {
    const c = await comerciante("Loja Artigos", [
      "Verniz Azul",
      "Verniz Rosa",
      "Lima de Unhas",
    ]);
    for (const papel of PAPEIS) {
      const p = await h.pessoaCom(c.id, papel);
      for (const q of ["", "?texto=verniz", "?limite=1", "?estado=rascunho"]) {
        const hub = await h.pedir("GET", `/hub/products${q}`, {
          sessao: p.sessao,
          comerciante: c.id,
        });
        expect(hub.statusCode, `${papel} ${q}: ${hub.body}`).toBe(200);
        expect(hub.headers["cache-control"]).toBe("private, no-store");
        const api = await pelaChave(c.segredo, q);
        expect(hub.json()).toEqual(api.json());
      }
    }
    const p = await h.pessoaCom(c.id, "armazem");
    const r = await h.pedir("GET", "/hub/products?texto=verniz", {
      sessao: p.sessao,
      comerciante: c.id,
    });
    const corpo = r.json<{ total: number; dados: { nome: string }[] }>();
    expect(corpo.total).toBe(2);
    expect(corpo.dados.map((a) => a.nome).sort()).toEqual([
      "Verniz Azul",
      "Verniz Rosa",
    ]);
    // A página seguinte pelo cursor, como no GET /products.
    const um = await h.pedir("GET", "/hub/products?limite=1", {
      sessao: p.sessao,
      comerciante: c.id,
    });
    const primeira = um.json<{ cursor_seguinte: string | null }>();
    expect(primeira.cursor_seguinte).not.toBeNull();
    const dois = await h.pedir(
      "GET",
      `/hub/products?limite=1&cursor=${encodeURIComponent(primeira.cursor_seguinte ?? "")}`,
      { sessao: p.sessao, comerciante: c.id },
    );
    expect(dois.statusCode).toBe(200);
    expect(dois.json()).toEqual(
      (
        await pelaChave(
          c.segredo,
          `?limite=1&cursor=${encodeURIComponent(primeira.cursor_seguinte ?? "")}`,
        )
      ).json(),
    );
  });

  it("só os artigos do comerciante do cabeçalho, e só de quem é membro dele", async () => {
    const a = await comerciante("Loja A", ["Artigo de A"]);
    const b = await comerciante("Loja B", ["Artigo de B"]);
    const p = await h.pessoaCom(a.id, "dono");
    const deA = await h.pedir("GET", "/hub/products", {
      sessao: p.sessao,
      comerciante: a.id,
    });
    expect(
      deA.json<{ dados: { nome: string }[] }>().dados.map((x) => x.nome),
    ).toEqual(["Artigo de A"]);
    const deB = await h.pedir("GET", "/hub/products", {
      sessao: p.sessao,
      comerciante: b.id,
    });
    expect(deB.statusCode).toBe(403);
    expect(deB.body).not.toContain("Artigo de B");
  });

  it("sem sessão, sem cabeçalho, com uma chave em vez da sessão ou de outro site: recusado", async () => {
    const c = await comerciante("Loja Fechada", ["Artigo"]);
    const p = await h.pessoaCom(c.id, "apoio");
    const semSessao = await h.pedir("GET", "/hub/products", {
      comerciante: c.id,
    });
    expect(semSessao.statusCode).toBe(401);
    const semCabecalho = await h.pedir("GET", "/hub/products", {
      sessao: p.sessao,
    });
    expect(semCabecalho.statusCode).toBe(400);
    // A chave não serve no caminho do Hub: lá só a sessão.
    const comChave = await h.app.inject({
      method: "GET",
      url: "/hub/products",
      headers: {
        authorization: `Bearer ${c.segredo}`,
        "eurolify-comerciante": `mer_${c.id}`,
      },
    });
    expect(comChave.statusCode).toBe(401);
    const deOutroSite = await h.app.inject({
      method: "GET",
      url: "/hub/products",
      headers: {
        cookie: `__Host-eurolify_sessao=${p.sessao}`,
        "eurolify-comerciante": `mer_${c.id}`,
        "sec-fetch-site": "cross-site",
      },
    });
    expect(deOutroSite.statusCode).toBe(403);
    // E a sessão não serve no GET /products: lá só a chave.
    const sessaoNaApi = await h.app.inject({
      method: "GET",
      url: "/products",
      headers: {
        cookie: `__Host-eurolify_sessao=${p.sessao}`,
        "eurolify-comerciante": `mer_${c.id}`,
      },
    });
    expect(sessaoNaApi.statusCode).toBe(401);
    // Só leitura: nenhuma escrita do catálogo com a sessão (docs/22 §11.1).
    const escreverNoHub = await h.pedir("POST", "/hub/products", {
      sessao: p.sessao,
      comerciante: c.id,
      corpo: { tipo: "fisico", nome: "Não entra" },
    });
    expect(escreverNoHub.statusCode).toBe(404);
    const escreverNaApi = await h.app.inject({
      method: "POST",
      url: "/products",
      headers: {
        cookie: `__Host-eurolify_sessao=${p.sessao}`,
        "eurolify-comerciante": `mer_${c.id}`,
        "content-type": "application/json",
      },
      payload: JSON.stringify({ tipo: "fisico", nome: "Não entra" }),
    });
    expect(escreverNaApi.statusCode).toBe(401);
    // Uma sessão terminada deixa de ler.
    const sair = await h.pedir("POST", "/hub/session/end", {
      sessao: p.sessao,
      corpo: {},
    });
    expect(sair.statusCode).toBe(200);
    const depoisDeSair = await h.pedir("GET", "/hub/products", {
      sessao: p.sessao,
      comerciante: c.id,
    });
    expect(depoisDeSair.statusCode).toBe(401);
    expect(depoisDeSair.body).not.toContain("Artigo");
  });

  it("um membro que saiu deixa de ler", async () => {
    const c = await comerciante("Loja Saida", ["Artigo"]);
    const p = await h.pessoaCom(c.id, "apoio");
    const eu = await h.pedir("GET", "/hub/me", { sessao: p.sessao });
    const membro =
      eu.json<{ comerciantes: { membro: string }[] }>().comerciantes[0]
        ?.membro ?? "";
    const sair = await h.pedir("POST", `/hub/members/${membro}/end`, {
      sessao: p.sessao,
      comerciante: c.id,
      corpo: {},
    });
    expect(sair.statusCode, sair.body).toBe(200);
    const depois = await h.pedir("GET", "/hub/products", {
      sessao: p.sessao,
      comerciante: c.id,
    });
    expect(depois.statusCode).toBe(403);
    expect(depois.body).not.toContain("Artigo");
  });

  it("o comerciante suspenso e o fechado lêem-se como pela chave (lê)", async () => {
    const c = await comerciante("Loja Suspensa", ["Artigo Parado"]);
    const p = await h.pessoaCom(c.id, "gestor");
    const ler = async () => {
      const hub = await h.pedir("GET", "/hub/products", {
        sessao: p.sessao,
        comerciante: c.id,
      });
      const api = await pelaChave(c.segredo, "");
      expect(hub.statusCode, hub.body).toBe(200);
      expect(api.statusCode).toBe(200);
      expect(hub.body).toContain("Artigo Parado");
      expect(hub.json()).toEqual(api.json());
    };
    await mudarEstado(base.api, c.id, {
      de: "rascunho",
      para: "suspenso",
      motivo: "teste",
      quem: "teste",
    });
    await ler();
    await mudarEstado(base.api, c.id, {
      de: "suspenso",
      para: "fechado",
      motivo: "teste",
      quem: "teste",
    });
    await ler();
  });

  it("um pedido recusado dá a mesma resposta nos dois caminhos (esquema e função)", async () => {
    const c = await comerciante("Loja Filtro", []);
    const p = await h.pessoaCom(c.id, "dono");
    const casos = [
      // Recusado pelo esquema, antes da função.
      "?estado=inventado",
      // Recusados pela própria listaDeArtigos (revisão do #201, P3-1).
      "?cursor=nao-e-um-cursor",
      "?actualizado_desde=0000-01-01T00:00:00Z",
      "?categoria=cat_00000000-0000-4000-8000-000000000000",
    ];
    for (const q of casos) {
      const hub = await h.pedir("GET", `/hub/products${q}`, {
        sessao: p.sessao,
        comerciante: c.id,
      });
      const api = await pelaChave(c.segredo, q);
      expect(hub.statusCode, `${q}: ${hub.body}`).toBeGreaterThanOrEqual(400);
      expect(hub.statusCode, q).toBe(api.statusCode);
      expect(h.codigo(hub), q).toBe(h.codigo(api));
    }
  });

  it("o contrato tem o caminho do Hub com a segurança da sessão e a resposta da lista", async () => {
    const r = await h.app.inject({ method: "GET", url: "/openapi.json" });
    const contrato = r.json<{
      paths: Record<
        string,
        Record<string, { security?: unknown; responses?: unknown }>
      >;
    }>();
    const hub = contrato.paths["/hub/products"]?.["get"];
    const api = contrato.paths["/products"]?.["get"];
    expect(hub?.security).toEqual([{ sessao: [] }]);
    expect(api?.security).toEqual([{ chave: [] }]);
    expect(
      JSON.stringify(
        (hub?.responses as Record<string, unknown> | undefined)?.["200"],
      ),
    ).toBe(
      JSON.stringify(
        (api?.responses as Record<string, unknown> | undefined)?.["200"],
      ),
    );
  });
});
