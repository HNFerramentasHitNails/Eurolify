import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ErroHub,
  imagensACorrer,
  naFilaDasImagens,
  pedirBytes,
} from "../src/api";

// A fila das miniaturas (issue #253): um pedido sem resposta não pode
// prender um lugar para sempre.

/** Um `fetch` que só responde quando é cancelado (como uma rede parada). */
function fetchParado() {
  return vi.fn(
    (_url: string, opcoes: { signal: AbortSignal }) =>
      new Promise<Response>((_ok, falha) => {
        opcoes.signal.addEventListener("abort", () => {
          falha(new DOMException("cancelado", "AbortError"));
        });
      }),
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("o prazo de uma miniatura", () => {
  it("um pedido sem resposta acaba em erro de rede ao fim do prazo", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", fetchParado());
    const pedido = pedirBytes(
      "/hub/media/med_1/file",
      "mer_1",
      undefined,
      1000,
    );
    const resultado = expect(pedido).rejects.toMatchObject({ estado: 0 });
    await vi.advanceTimersByTimeAsync(1000);
    await resultado;
  });

  it("antes do prazo continua à espera", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", fetchParado());
    let acabou = false;
    void pedirBytes("/hub/media/med_1/file", "mer_1", undefined, 1000).catch(
      () => {
        acabou = true;
      },
    );
    await vi.advanceTimersByTimeAsync(999);
    expect(acabou).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(acabou).toBe(true);
  });

  it("cancelar (a miniatura saiu do ecrã) acaba logo o pedido", async () => {
    vi.stubGlobal("fetch", fetchParado());
    const cancelar = new AbortController();
    const pedido = pedirBytes(
      "/hub/media/med_1/file",
      "mer_1",
      cancelar.signal,
    );
    cancelar.abort();
    await expect(pedido).rejects.toBeInstanceOf(ErroHub);
  });

  it("uma resposta de erro da API não passa a erro de rede", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ codigo: "media.not_found" }), {
            status: 404,
          }),
        ),
      ),
    );
    await expect(
      pedirBytes("/hub/media/med_1/file", "mer_1"),
    ).rejects.toMatchObject({ estado: 404 });
  });
});

/** Uma resposta cujos bytes chegam aos pedaços, um a cada `intervaloMs`. */
function respostaAosPedacos(
  pedacos: number,
  intervaloMs: number,
  parar = false,
) {
  let enviados = 0;
  const corpo = new ReadableStream<Uint8Array>({
    pull(c) {
      return new Promise<void>((ok) => {
        if (parar && enviados === 1) return; // fica parado depois do 1.º
        setTimeout(() => {
          if (enviados === pedacos) c.close();
          else {
            enviados++;
            c.enqueue(new Uint8Array([enviados]));
          }
          ok();
        }, intervaloMs);
      });
    },
  });
  return new Response(corpo, { headers: { "content-type": "image/png" } });
}

describe("o prazo conta o tempo sem receber nada (revisão do #280, P2)", () => {
  it("uma imagem que demora mais do que o prazo, mas vai chegando, não falha", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(respostaAosPedacos(5, 800))),
    );
    const pedido = pedirBytes(
      "/hub/media/med_1/file",
      "mer_1",
      undefined,
      1000,
    );
    await vi.advanceTimersByTimeAsync(5000);
    const blob = await pedido;
    expect(blob.size).toBe(5);
    expect(blob.type).toBe("image/png");
  });

  it("uma descarga que pára a meio acaba em erro de rede", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(respostaAosPedacos(5, 100, true))),
    );
    const pedido = pedirBytes(
      "/hub/media/med_1/file",
      "mer_1",
      undefined,
      1000,
    );
    const resultado = expect(pedido).rejects.toMatchObject({ estado: 0 });
    await vi.advanceTimersByTimeAsync(1200);
    await resultado;
  });
});

describe("a fila das miniaturas", () => {
  it("nunca corre mais de 4 ao mesmo tempo, e no fim fica a 0", async () => {
    let aCorrer = 0;
    let maximo = 0;
    const soltar: (() => void)[] = [];
    const pedido = () =>
      new Promise<string>((ok) => {
        aCorrer++;
        maximo = Math.max(maximo, aCorrer);
        soltar.push(() => {
          aCorrer--;
          ok("ok");
        });
      });
    const todos = Array.from({ length: 10 }, () => naFilaDasImagens(pedido));
    await Promise.resolve();
    expect(imagensACorrer()).toBe(4);
    while (soltar.length > 0) {
      soltar.shift()?.();
      // um pedido novo entre um acabar e o seguinte arrancar não passa à
      // frente (revisão do #280, P3)
      void naFilaDasImagens(() => Promise.resolve("à frente")).then(() => {
        maximo = Math.max(maximo, aCorrer);
      });
      await new Promise((ok) => setTimeout(ok, 0));
    }
    await Promise.all(todos);
    await new Promise((ok) => setTimeout(ok, 0));
    expect(maximo).toBeLessThanOrEqual(4);
    expect(imagensACorrer()).toBe(0);
  });

  it("quem é cancelado enquanto espera sai logo da fila", async () => {
    const soltar: (() => void)[] = [];
    const presos = Array.from({ length: 4 }, () =>
      naFilaDasImagens(
        () =>
          new Promise<string>((ok) => {
            soltar.push(() => {
              ok("ok");
            });
          }),
      ),
    );
    const desistiu = new AbortController();
    const emEspera = naFilaDasImagens(
      () => Promise.resolve("não devia correr"),
      desistiu.signal,
    );
    desistiu.abort();
    await expect(emEspera).rejects.toBeInstanceOf(ErroHub);
    for (const s of soltar) s();
    await Promise.all(presos);
    expect(imagensACorrer()).toBe(0);
  });

  it("quatro pedidos parados e cancelados não prendem o quinto", async () => {
    vi.stubGlobal("fetch", fetchParado());
    const presos = Array.from({ length: 4 }, () => new AbortController());
    const antigos = presos.map((c) =>
      naFilaDasImagens(
        () => pedirBytes("/hub/media/med_x/file", "mer_1", c.signal),
        c.signal,
      ).catch(() => "cancelado"),
    );
    let quintoCorreu = false;
    const quinto = naFilaDasImagens(() => {
      quintoCorreu = true;
      return Promise.resolve("ok");
    });
    await Promise.resolve();
    expect(quintoCorreu).toBe(false);
    for (const c of presos) c.abort();
    await expect(quinto).resolves.toBe("ok");
    expect(quintoCorreu).toBe(true);
    expect(await Promise.all(antigos)).toEqual(Array(4).fill("cancelado"));
  });

  it("quem foi cancelado enquanto esperava não chega a pedir", async () => {
    vi.stubGlobal("fetch", fetchParado());
    const presos = Array.from({ length: 4 }, () => new AbortController());
    const antigos = presos.map((c) =>
      naFilaDasImagens(
        () => pedirBytes("/hub/media/med_x/file", "mer_1", c.signal),
        c.signal,
      ).catch(() => "cancelado"),
    );
    const desistiu = new AbortController();
    let pediu = false;
    const emEspera = naFilaDasImagens(() => {
      pediu = true;
      return Promise.resolve("ok");
    }, desistiu.signal);
    desistiu.abort();
    for (const c of presos) c.abort();
    await expect(emEspera).rejects.toBeInstanceOf(ErroHub);
    expect(pediu).toBe(false);
    await Promise.all(antigos);
  });
});
