import { describe, expect, it } from "vitest";
import {
  ErroDaApi,
  ErroDeRede,
  ErroDoSdk,
  criarAdministracao,
  criarLoja,
  itens,
  novaChaveDeIdempotencia,
  paginas,
  type Pagina,
} from "../src/index.js";

// Sem rede: um `fetch` injectado regista o pedido e devolve o que o teste manda.

interface Chamada {
  url: string;
  metodo: string;
  cabecalhos: Headers;
  corpo: string | undefined;
}

function falso(respostas: (Response | Error)[]) {
  const chamadas: Chamada[] = [];
  const fn = (url: string | URL | Request, init?: RequestInit) => {
    chamadas.push({
      url:
        typeof url === "string" ? url : url instanceof URL ? url.href : url.url,
      metodo: init?.method ?? "GET",
      cabecalhos: new Headers(init?.headers),
      corpo: typeof init?.body === "string" ? init.body : undefined,
    });
    const r = respostas.shift();
    if (r === undefined) throw new Error("sem mais respostas no teste");
    return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
  };
  return { fetch: fn, chamadas };
}

const json = (
  corpo: unknown,
  estado = 200,
  extra: Record<string, string> = {},
) =>
  new Response(JSON.stringify(corpo), {
    status: estado,
    headers: { "content-type": "application/json", ...extra },
  });

const PROBLEMA = {
  type: "/erros/inventory.insufficient",
  title: "Stock insuficiente",
  status: 409,
  instance: "req_123",
  codigo: "inventory.insufficient",
  mensagem: { pt: "Stock insuficiente", en: "Insufficient stock" },
};

const PK = `eul_pk_${"a".repeat(52)}`;
const SK = `eul_sk_${"b".repeat(52)}`;
const URL_BASE = "https://api.exemplo.test/";

describe("pedidos", () => {
  it("GET na Loja: URL, aceita JSON, sem chave nem corpo", async () => {
    const { fetch, chamadas } = falso([json({ estado: "ok" })]);
    const loja = criarLoja({ url: URL_BASE, fetch });
    const r = await loja.get("/health");
    expect(r.dados).toEqual({ estado: "ok" });
    expect(r.estado).toBe(200);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]?.url).toBe("https://api.exemplo.test/health");
    expect(chamadas[0]?.metodo).toBe("GET");
    expect(chamadas[0]?.cabecalhos.get("accept")).toBe("application/json");
    expect(chamadas[0]?.cabecalhos.has("authorization")).toBe(false);
  });

  it("a chave vai em Authorization e a versão em Eurolify-Versao", async () => {
    const { fetch, chamadas } = falso([json({ estado: "ok" })]);
    const loja = criarLoja({
      url: URL_BASE,
      chave: PK,
      versao: "2026-10",
      fetch,
    });
    await loja.get("/health");
    expect(chamadas[0]?.cabecalhos.get("authorization")).toBe(`Bearer ${PK}`);
    expect(chamadas[0]?.cabecalhos.get("eurolify-versao")).toBe("2026-10");
  });

  it("caminho codificado, consulta sem undefined e cabeçalho do contrato", async () => {
    const { fetch, chamadas } = falso([json({ dados: [] })]);
    const loja = criarLoja({ url: URL_BASE, fetch });
    await loja.get("/store/carts/{id}", {
      caminho: { id: "crt_a/b c" },
      cabecalhos: { "x-cart-secret": "segredo" },
    });
    expect(chamadas[0]?.url).toBe(
      "https://api.exemplo.test/store/carts/crt_a%2Fb%20c",
    );
    expect(chamadas[0]?.cabecalhos.get("x-cart-secret")).toBe("segredo");
  });

  it("escrita: corpo JSON e Idempotency-Key obrigatória nos tipos", async () => {
    const { fetch, chamadas } = falso([
      json({ id: "crt_1", segredo: "s" }, 201),
    ]);
    const loja = criarLoja({ url: URL_BASE, chave: PK, fetch });
    const corpo = {
      canal: "chn_00000000-0000-0000-0000-000000000000",
      mercado: "mkt_00000000-0000-0000-0000-000000000000",
      lingua: "pt",
    };
    // Só tipos (não corre): sem `idempotencia` não compila (docs/39 §7).
    const soTipos = () =>
      // @ts-expect-error — falta `idempotencia`
      loja.post("/store/carts", { corpo });
    expect(soTipos).toBeTypeOf("function");
    const r = await loja.post("/store/carts", {
      corpo,
      idempotencia: "chave-1",
    });
    expect(r.estado).toBe(201);
    expect(r.dados.id).toBe("crt_1");
    const escrita = chamadas.at(-1);
    expect(escrita?.cabecalhos.get("idempotency-key")).toBe("chave-1");
    expect(escrita?.cabecalhos.get("content-type")).toBe("application/json");
    expect(JSON.parse(escrita?.corpo ?? "null")).toEqual(corpo);
  });

  it("204 devolve dados indefinidos", async () => {
    const { fetch } = falso([new Response(null, { status: 204 })]);
    const admin = criarAdministracao({
      url: URL_BASE,
      chave: SK,
      fetch,
    });
    const r = await admin.delete("/products/{id}", {
      caminho: { id: "prd_1" },
      idempotencia: novaChaveDeIdempotencia(),
    });
    expect(r.estado).toBe(204);
    expect(r.dados).toBeUndefined();
  });

  it("uma rota que não existe no contrato não compila", () => {
    const { fetch } = falso([]);
    const loja = criarLoja({ url: URL_BASE, fetch });
    // Só tipos (não correm).
    const soTipos = [
      () =>
        // @ts-expect-error — /products é da Administração, não da Loja
        loja.get("/products"),
      () =>
        // @ts-expect-error — um método que a rota não tem
        loja.delete("/health"),
    ];
    expect(soTipos).toHaveLength(2);
  });
});

describe("erros normalizados", () => {
  it("um problema da API vira ErroDaApi com o código estável", async () => {
    const { fetch } = falso([
      new Response(JSON.stringify(PROBLEMA), {
        status: 409,
        headers: {
          "content-type": "application/problem+json",
          "retry-after": "7",
        },
      }),
    ]);
    const loja = criarLoja({ url: URL_BASE, fetch });
    const erro = await loja.get("/health").catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroDaApi);
    const e = erro as ErroDaApi;
    expect(e.estado).toBe(409);
    expect(e.codigo).toBe("inventory.insufficient");
    expect(e.pedido).toBe("req_123");
    expect(e.esperarSegundos).toBe(7);
    expect(e.problema?.mensagem.pt).toBe("Stock insuficiente");
  });

  it("um erro que não é problema não passa por sucesso nem por erro da API", async () => {
    const { fetch } = falso([
      new Response("<html>Bad gateway</html>", { status: 502 }),
    ]);
    const loja = criarLoja({ url: URL_BASE, fetch });
    const erro = (await loja
      .get("/health")
      .catch((e: unknown) => e)) as ErroDaApi;
    expect(erro).toBeInstanceOf(ErroDaApi);
    expect(erro.codigo).toBe("sdk.resposta_inesperada");
    expect(erro.problema).toBeUndefined();
  });

  it("um 200 que não é JSON é erro, não sucesso", async () => {
    const { fetch } = falso([new Response("ok", { status: 200 })]);
    const loja = criarLoja({ url: URL_BASE, fetch });
    await expect(loja.get("/health")).rejects.toBeInstanceOf(ErroDoSdk);
  });

  it("sem resposta: ErroDeRede, com a causa", async () => {
    const causa = new TypeError("fetch failed");
    const { fetch } = falso([causa]);
    const loja = criarLoja({ url: URL_BASE, fetch });
    const erro = (await loja
      .get("/health")
      .catch((e: unknown) => e)) as ErroDeRede;
    expect(erro).toBeInstanceOf(ErroDeRede);
    expect(erro.cause).toBe(causa);
  });

  it("não repete sozinho: um erro é uma chamada", async () => {
    const { fetch, chamadas } = falso([json(PROBLEMA, 503)]);
    const loja = criarLoja({ url: URL_BASE, fetch });
    await loja.get("/health").catch(() => undefined);
    expect(chamadas).toHaveLength(1);
  });
});

describe("chaves", () => {
  it("a Loja recusa a chave de servidor", () => {
    expect(() => criarLoja({ url: URL_BASE, chave: SK })).toThrow(ErroDoSdk);
  });

  it("a Administração só aceita a chave de servidor", () => {
    expect(() =>
      criarAdministracao({ url: "https://api.exemplo.test/", chave: PK }),
    ).toThrow(ErroDoSdk);
    expect(() =>
      criarAdministracao({ url: "api.exemplo.test", chave: SK }),
    ).toThrow(ErroDoSdk);
  });
});

describe("protecções da revisão do #476", () => {
  it("a chave tem de ter o formato exacto", () => {
    expect(() => criarLoja({ url: URL_BASE, chave: "eul_pk_abc" })).toThrow(
      ErroDoSdk,
    );
    expect(() => criarLoja({ url: URL_BASE, chave: SK })).toThrow(ErroDoSdk);
    expect(() =>
      criarAdministracao({ url: "https://x.test", chave: "eul_sk_abc" }),
    ).toThrow(ErroDoSdk);
  });

  it("a mensagem de recusa não leva a chave", () => {
    try {
      criarLoja({ url: URL_BASE, chave: SK });
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).not.toContain(SK);
    }
  });

  it("recusa authorization em qualquer caixa, nas opções e no pedido", async () => {
    expect(() =>
      criarLoja({ url: URL_BASE, cabecalhos: { Authorization: "x" } }),
    ).toThrow(ErroDoSdk);
    const { fetch, chamadas } = falso([]);
    const loja = criarLoja({ url: URL_BASE, fetch });
    await expect(
      loja.get("/store/carts/{id}", {
        caminho: { id: "crt_1" },
        cabecalhos: { aUtHoRiZaTiOn: "x" } as never,
      }),
    ).rejects.toBeInstanceOf(ErroDoSdk);
    expect(chamadas).toHaveLength(0);
  });

  it("na Loja, nenhum cabeçalho leva uma chave de servidor", async () => {
    expect(() =>
      criarLoja({ url: URL_BASE, cabecalhos: { "x-outro": `a ${SK}` } }),
    ).toThrow(ErroDoSdk);
    const { fetch } = falso([]);
    const loja = criarLoja({ url: URL_BASE, fetch });
    await expect(
      loja.get("/store/carts/{id}", {
        caminho: { id: "crt_1" },
        cabecalhos: { "x-cart-secret": SK },
      }),
    ).rejects.toBeInstanceOf(ErroDoSdk);
  });

  it("parâmetros de caminho vazios, «.» e «..» são recusados", async () => {
    const { fetch, chamadas } = falso([]);
    const loja = criarLoja({ url: URL_BASE, fetch });
    for (const id of ["", ".", ".."]) {
      await expect(
        loja.get("/store/carts/{id}", { caminho: { id } }),
      ).rejects.toBeInstanceOf(ErroDoSdk);
    }
    expect(chamadas).toHaveLength(0);
  });

  it("a Administração só segue por https (ou localhost)", () => {
    expect(() =>
      criarAdministracao({ url: "http://api.exemplo.test", chave: SK }),
    ).toThrow(ErroDoSdk);
    expect(() =>
      criarAdministracao({ url: "http://localhost:8080", chave: SK }),
    ).not.toThrow();
    expect(() =>
      criarAdministracao({ url: "http://127.0.0.1:8080", chave: SK }),
    ).not.toThrow();
  });

  it("um 2xx que não é JSON diz que a escrita pode ter sido feita", async () => {
    const { fetch } = falso([new Response("ok", { status: 200 })]);
    const loja = criarLoja({ url: URL_BASE, fetch });
    await expect(loja.get("/health")).rejects.toThrow(/mesma chave/);
  });

  it("sem fetch no ambiente: ErroDoSdk", () => {
    const original = globalThis.fetch;
    // @ts-expect-error — simula um ambiente sem fetch
    delete globalThis.fetch;
    try {
      expect(() => criarLoja({ url: URL_BASE })).toThrow(ErroDoSdk);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("um cursor vazio ou ausente pára a paginação", async () => {
    for (const cursor of ["", undefined]) {
      const lista = paginas(() =>
        Promise.resolve({
          dados: {
            dados: [1],
            ha_mais: true,
            cursor_seguinte: cursor as string | null,
          },
          estado: 200,
          cabecalhos: new Headers(),
        }),
      );
      await lista.next();
      await expect(lista.next()).rejects.toBeInstanceOf(ErroDoSdk);
    }
  });
});

describe("paginação por cursor", () => {
  const pagina = (dados: number[], cursor: string | null): Pagina<number> => ({
    dados,
    total: 5,
    ha_mais: cursor !== null,
    cursor_seguinte: cursor,
  });

  it("segue os cursores até ao fim e junta tudo", async () => {
    const vistos: (string | undefined)[] = [];
    const paginasDadas = [
      pagina([1, 2], "a"),
      pagina([3, 4], "b"),
      pagina([5], null),
    ];
    const todos: number[] = [];
    for await (const n of itens((mais) => {
      vistos.push(mais.cursor);
      const p = paginasDadas.shift();
      if (p === undefined) throw new Error("a mais");
      return Promise.resolve({
        dados: p,
        estado: 200,
        cabecalhos: new Headers(),
      });
    })) {
      todos.push(n);
    }
    expect(todos).toEqual([1, 2, 3, 4, 5]);
    expect(vistos).toEqual([undefined, "a", "b"]);
  });

  it("ha_mais sem cursor não corta em silêncio", async () => {
    const lista = paginas(() =>
      Promise.resolve({
        dados: { dados: [1], ha_mais: true, cursor_seguinte: null },
        estado: 200,
        cabecalhos: new Headers(),
      }),
    );
    await lista.next();
    await expect(lista.next()).rejects.toBeInstanceOf(ErroDoSdk);
  });

  it("um cursor repetido pára em vez de dar voltas", async () => {
    const lista = paginas(() =>
      Promise.resolve({
        dados: { dados: [1], ha_mais: true, cursor_seguinte: "igual" },
        estado: 200,
        cabecalhos: new Headers(),
      }),
    );
    await lista.next();
    await lista.next();
    await expect(lista.next()).rejects.toBeInstanceOf(ErroDoSdk);
  });
});
