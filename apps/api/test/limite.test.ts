import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarApp } from "../src/app.js";
import { chaveDoIp, LimitePorIp, proxyConfiavel } from "../src/base/limite.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";
import { HUB, ORIGEM } from "./hub-de-teste.js";

// O limite geral de pedidos por IP nas rotas do Hub (docs/21 §14).

describe("a chave do IP", () => {
  it("um IPv4 conta inteiro; um IPv6 pela rede /64; um IPv4 em IPv6 como IPv4", () => {
    expect(chaveDoIp("203.0.113.7")).toBe("203.0.113.7");
    expect(chaveDoIp("2001:db8:1:2:aaaa::1")).toBe("2001:db8:1:2::/64");
    expect(chaveDoIp("2001:0db8:0001:0002:ffff:ffff:ffff:ffff")).toBe(
      "2001:db8:1:2::/64",
    );
    expect(chaveDoIp("2001:db8::")).toBe("2001:db8:0:0::/64");
    expect(chaveDoIp("::1")).toBe("0:0:0:0::/64");
    expect(chaveDoIp("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    expect(chaveDoIp("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(chaveDoIp("::ffff:cb00:7107")).toBe("203.0.113.7");
    // Duas redes /64 diferentes não se misturam.
    expect(chaveDoIp("2001:db8:1:3::1")).not.toBe(chaveDoIp("2001:db8:1:2::1"));
  });
});

describe("o contador por IP", () => {
  it("aceita até ao limite, recusa com os segundos que faltam e recomeça na janela seguinte", () => {
    let t = 1_000_000;
    const l = new LimitePorIp({ pedidos: 3, janelaMs: 60_000 }, 100, () => t);
    expect([1, 2, 3].map(() => l.contar("198.51.100.1"))).toEqual([0, 0, 0]);
    t += 15_000;
    expect(l.contar("198.51.100.1")).toBe(45);
    // Outro IP tem o seu contador.
    expect(l.contar("198.51.100.2")).toBe(0);
    t += 44_999;
    expect(l.contar("198.51.100.1")).toBe(1);
    t += 1;
    expect(l.contar("198.51.100.1")).toBe(0);
  });

  it("guarda no máximo `maximo` IPs: saem os acabados e depois os mais antigos", () => {
    let t = 0;
    const l = new LimitePorIp({ pedidos: 1, janelaMs: 1_000 }, 3, () => t);
    l.contar("192.0.2.1");
    l.contar("192.0.2.2");
    l.contar("192.0.2.3");
    expect(l.tamanho).toBe(3);
    l.contar("192.0.2.4");
    expect(l.tamanho).toBe(3);
    // O mais antigo saiu: volta a contar do zero.
    expect(l.contar("192.0.2.1")).toBe(0);
    t = 5_000;
    // Todos acabaram: saem antes de entrar o novo.
    l.contar("192.0.2.9");
    expect(l.tamanho).toBe(1);
  });
});

describe("o proxy de confiança", () => {
  it("só endereços exactos; vazio não confia em nenhum", () => {
    expect(proxyConfiavel(undefined)).toEqual([]);
    expect(proxyConfiavel(" ")).toEqual([]);
    expect(proxyConfiavel("127.0.0.1, ::1")).toEqual(["127.0.0.1", "::1"]);
    expect(() => proxyConfiavel("10.0.0.0/8")).toThrow(/PROXY_CONFIAVEL/);
    expect(() => proxyConfiavel("true")).toThrow(/PROXY_CONFIAVEL/);
  });
});

describe.skipIf(URL_BASE === undefined)("o limite nas rotas do Hub", () => {
  let base: BaseDeTeste;
  const limites = {
    publicas: { pedidos: 3, janelaMs: 60_000 },
    todas: { pedidos: 5, janelaMs: 60_000 },
  };

  beforeAll(async () => {
    base = await criarBaseDeTeste(URL_BASE ?? "");
  }, 60_000);

  afterAll(async () => {
    await base.fechar();
  });

  const app = (trustProxy?: string[]) =>
    criarApp(
      trustProxy === undefined ? {} : { trustProxy },
      undefined,
      base.api,
      {
        ...HUB,
        limites,
      },
    );

  const pedir = (
    a: ReturnType<typeof criarApp>,
    url: string,
    ip: string,
    cabecalhos: Record<string, string> = {},
  ) =>
    a.inject({
      method: "POST",
      url,
      remoteAddress: ip,
      headers: {
        origin: ORIGEM,
        "content-type": "application/json",
        ...cabecalhos,
      },
      payload: "{}",
    });

  it("uma rota pública: o 4.º pedido do mesmo IP dá 429 com Retry-After; outro IP passa", async () => {
    const a = app();
    for (let i = 0; i < 3; i++) {
      expect(
        (await pedir(a, "/hub/session/options", "203.0.113.10")).statusCode,
      ).toBe(200);
    }
    const r = await pedir(a, "/hub/session/options", "203.0.113.10");
    expect(r.statusCode).toBe(429);
    expect(r.json<{ codigo: string }>().codigo).toBe("rate_limit.exceeded");
    expect(Number(r.headers["retry-after"])).toBeGreaterThan(0);
    expect(Number(r.headers["retry-after"])).toBeLessThanOrEqual(60);
    expect(
      (await pedir(a, "/hub/session/options", "203.0.113.11")).statusCode,
    ).toBe(200);
    await a.close();
  });

  it("uma rota com sessão conta no limite geral, antes de a sessão chegar à base", async () => {
    const a = app();
    const eu = () =>
      a.inject({
        method: "GET",
        url: "/hub/me",
        remoteAddress: "203.0.113.20",
        headers: { origin: ORIGEM },
      });
    for (let i = 0; i < 5; i++) {
      expect((await eu()).statusCode).toBe(401);
    }
    expect((await eu()).statusCode).toBe(429);
    await a.close();
  });

  it("as rotas fora do Hub não contam", async () => {
    const a = app();
    for (let i = 0; i < 10; i++) {
      const r = await a.inject({
        method: "GET",
        url: "/health",
        remoteAddress: "203.0.113.30",
      });
      expect(r.statusCode).toBe(200);
    }
    await a.close();
  });

  it("um IPv6 conta pela rede /64", async () => {
    const a = app();
    for (let i = 1; i <= 3; i++) {
      const ip = `2001:db8:7:7::${String(i)}`;
      expect((await pedir(a, "/hub/session/options", ip)).statusCode).toBe(200);
    }
    expect(
      (await pedir(a, "/hub/session/options", "2001:db8:7:7::99")).statusCode,
    ).toBe(429);
    expect(
      (await pedir(a, "/hub/session/options", "2001:db8:7:8::1")).statusCode,
    ).toBe(200);
    await a.close();
  });

  it("atrás do proxy de confiança conta o X-Forwarded-For; de outro endereço, não", async () => {
    const a = app(["127.0.0.1"]);
    // Pelo proxy: cada cliente com o seu contador.
    for (let i = 0; i < 3; i++) {
      await pedir(a, "/hub/session/options", "127.0.0.1", {
        "x-forwarded-for": "198.51.100.40",
      });
    }
    expect(
      (
        await pedir(a, "/hub/session/options", "127.0.0.1", {
          "x-forwarded-for": "198.51.100.40",
        })
      ).statusCode,
    ).toBe(429);
    expect(
      (
        await pedir(a, "/hub/session/options", "127.0.0.1", {
          "x-forwarded-for": "198.51.100.41",
        })
      ).statusCode,
    ).toBe(200);
    // Sem passar pelo proxy, o cabeçalho não muda o IP contado.
    for (let i = 0; i < 3; i++) {
      await pedir(a, "/hub/session/options", "203.0.113.50", {
        "x-forwarded-for": `198.51.100.${String(60 + i)}`,
      });
    }
    expect(
      (
        await pedir(a, "/hub/session/options", "203.0.113.50", {
          "x-forwarded-for": "198.51.100.99",
        })
      ).statusCode,
    ).toBe(429);
    await a.close();
  });
});
