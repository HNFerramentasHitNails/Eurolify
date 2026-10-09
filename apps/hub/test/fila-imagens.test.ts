import { afterEach, describe, expect, it, vi } from "vitest";
import { ErroHub, naFilaDasImagens, pedirBytes } from "../src/api";

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

describe("a fila das miniaturas", () => {
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
