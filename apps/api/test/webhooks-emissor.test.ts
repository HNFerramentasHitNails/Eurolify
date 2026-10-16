import { createServer as servidorHttp, request as pedidoHttp } from "node:http";
import { createServer, type Server, type Socket } from "node:net";
import type { AddressInfo } from "node:net";
import type { request as pedidoHttps } from "node:https";
import { afterEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { emissorHttps } from "../src/webhooks/emissor.js";
import { lerChavesWebhooks } from "../src/webhooks/chave.js";

// O emissor verdadeiro contra servidores locais lentos (revisão do #477,
// P1-1, P3-5, P3-7): o prazo é do pedido inteiro, e a resposta não se lê.
// O resolvedor devolve 127.0.0.1 e o filtro de endereços deixa passar tudo
// (só aqui, nos testes); em vez de TLS, o pedido vai por http para a porta do
// servidor falso.

const PEDIDO = {
  url: "https://alfa.example/h",
  corpo: '{"a":1}',
  cabecalhos: {},
};
const local = [{ address: "127.0.0.1", family: 4 }];

describe("o emissor com receptores lentos", () => {
  const fechar: (() => void)[] = [];
  const ligacoes = new Set<Socket>();
  afterEach(() => {
    for (const f of fechar.splice(0)) f();
    for (const s of ligacoes) s.destroy();
    ligacoes.clear();
  });

  /** Um servidor TCP cru, que decide o que escreve quando o pedido chega. */
  async function cru(aoReceber: (s: Socket) => void): Promise<number> {
    const servidor: Server = createServer((s) => {
      ligacoes.add(s);
      s.on("error", () => undefined);
      s.once("data", () => {
        aoReceber(s);
      });
    });
    await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
    fechar.push(() => servidor.close());
    return (servidor.address() as AddressInfo).port;
  }

  const emissorPara = (
    porta: number,
    limiteMs: number,
    espiar?: (o: Record<string, unknown>) => void,
  ) =>
    emissorHttps({
      resolver: () => Promise.resolve(local),
      limiteMs,
      endereco: () => true,
      pedido: ((opcoes: Record<string, unknown>, cb: never) => {
        espiar?.(opcoes);
        return pedidoHttp({ ...opcoes, port: porta } as never, cb);
      }) as unknown as typeof pedidoHttps,
    });

  it("um receptor que nunca responde acaba no prazo total", async () => {
    const porta = await cru(() => undefined);
    const t = Date.now();
    expect(await emissorPara(porta, 300)(PEDIDO)).toEqual({
      erro: "webhooks.timeout",
    });
    expect(Date.now() - t).toBeLessThan(1500);
  });

  it("cabeçalhos a pingar byte a byte não adiam o prazo (a inactividade não chega)", async () => {
    const porta = await cru((s) => {
      const resposta = "HTTP/1.1 200 OK\r\nX-Lento: ";
      let i = 0;
      const t = setInterval(() => {
        if (s.destroyed) {
          clearInterval(t);
          return;
        }
        s.write(resposta[i++ % resposta.length] ?? "x");
      }, 40);
      s.on("close", () => {
        clearInterval(t);
      });
    });
    const t = Date.now();
    expect(await emissorPara(porta, 400)(PEDIDO)).toEqual({
      erro: "webhooks.timeout",
    });
    expect(Date.now() - t).toBeLessThan(1500);
  });

  it("`100 Continue` sem fim também acaba no prazo", async () => {
    const porta = await cru((s) => {
      const t = setInterval(() => {
        if (s.destroyed) {
          clearInterval(t);
          return;
        }
        s.write("HTTP/1.1 100 Continue\r\n\r\n");
      }, 30);
      s.on("close", () => {
        clearInterval(t);
      });
    });
    const t = Date.now();
    expect(await emissorPara(porta, 400)(PEDIDO)).toEqual({
      erro: "webhooks.timeout",
    });
    expect(Date.now() - t).toBeLessThan(1500);
  });

  it("depois do código a resposta não se lê: a ligação fecha-se, mesmo com um corpo sem fim", async () => {
    let fechou!: () => void;
    const fechada = new Promise<void>((r) => (fechou = r));
    const porta = await cru((s) => {
      s.write("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n");
      const t = setInterval(() => {
        if (!s.destroyed) s.write("5\r\naaaaa\r\n");
      }, 20);
      s.on("close", () => {
        clearInterval(t);
        fechou();
      });
    });
    const t = Date.now();
    expect(await emissorPara(porta, 5000)(PEDIDO)).toEqual({ estado: 200 });
    expect(Date.now() - t).toBeLessThan(1500);
    // O servidor vê a ligação fechar-se pelo lado do Eurolify.
    await Promise.race([
      fechada,
      new Promise((_r, rej) =>
        setTimeout(() => {
          rej(new Error("a ligação não se fechou"));
        }, 2000),
      ),
    ]);
  });

  it("um DNS que nunca responde também acaba no prazo", async () => {
    const emissor = emissorHttps({
      resolver: () => new Promise(() => undefined),
      limiteMs: 300,
    });
    const t = Date.now();
    expect(await emissor(PEDIDO)).toEqual({ erro: "webhooks.timeout" });
    expect(Date.now() - t).toBeLessThan(1500);
  });

  it("um servidor normal entrega o código", async () => {
    const http = servidorHttp((_p, r) => {
      r.statusCode = 204;
      r.end();
    });
    await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
    fechar.push(() => http.close());
    const porta = (http.address() as AddressInfo).port;
    expect(await emissorPara(porta, 2000)(PEDIDO)).toEqual({ estado: 204 });
  });

  it("o SNI é o nome; com um IP literal não se põe", async () => {
    const porta = await cru((s) => s.end("HTTP/1.1 200 OK\r\n\r\n"));
    let visto: Record<string, unknown> = {};
    await emissorPara(porta, 2000, (o) => (visto = o))(PEDIDO);
    expect(visto["servername"]).toBe("alfa.example");
    await emissorPara(
      porta,
      2000,
      (o) => (visto = o),
    )({ ...PEDIDO, url: "https://8.8.8.8/h" });
    expect("servername" in visto).toBe(false);
  });
});

describe("as chaves dos webhooks (revisão do #477, P2-4)", () => {
  const k = () => randomBytes(32).toString("base64");
  it("a actual e a anterior; a anterior só com versão diferente", () => {
    const r = lerChavesWebhooks({
      WEBHOOKS_CHAVE: k(),
      WEBHOOKS_CHAVE_VERSAO: "2",
      WEBHOOKS_CHAVE_ANTERIOR: k(),
      WEBHOOKS_CHAVE_ANTERIOR_VERSAO: "1",
    });
    expect([r.chave?.versao, r.chaveAnterior?.versao]).toEqual(["2", "1"]);
    expect(() =>
      lerChavesWebhooks({
        WEBHOOKS_CHAVE: k(),
        WEBHOOKS_CHAVE_ANTERIOR: k(),
        WEBHOOKS_CHAVE_ANTERIOR_VERSAO: "1",
      }),
    ).toThrow(/diferente/);
  });
  it("as mensagens dizem a variável dos webhooks, nunca a dos pagamentos", () => {
    for (const env of [
      { WEBHOOKS_CHAVE: "curta" },
      {
        WEBHOOKS_CHAVE: k(),
        WEBHOOKS_CHAVE_ANTERIOR: "curta",
        WEBHOOKS_CHAVE_ANTERIOR_VERSAO: "1",
      },
      { WEBHOOKS_CHAVE_ANTERIOR: k() },
      { WEBHOOKS_CHAVE: k(), WEBHOOKS_CHAVE_ANTERIOR: k() },
      { WEBHOOKS_CHAVE_ANTERIOR_VERSAO: "1" },
    ]) {
      let mensagem = "";
      try {
        lerChavesWebhooks(env);
      } catch (e) {
        mensagem = (e as Error).message;
      }
      expect(mensagem).toMatch(/^WEBHOOKS_CHAVE/);
      expect(mensagem).not.toContain("PAGAMENTOS");
    }
  });
});
