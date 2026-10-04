import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FilaDePedidos, pedidoValido } from "../src/pedidos.js";

describe("pedidos permitidos", () => {
  it.each([
    "medir",
    "publicacoes",
    "copia",
    "reposicao",
    "reiniciar-api",
    "actualizar",
    "reiniciar-vps",
  ])("aceita «%s»", (comando) => {
    expect(pedidoValido(comando)).toBe(true);
  });

  it("aceita publicar com um resumo sha256", () => {
    expect(pedidoValido(`publicar sha256:${"a".repeat(64)}`)).toBe(true);
  });

  it.each([
    "",
    "rm -rf /",
    "medir; rm -rf /",
    "medir\nreiniciar-vps",
    "publicar sha256:xyz",
    `publicar sha256:${"a".repeat(64)} && id`,
    "publicar ghcr.io/outra/imagem:latest",
    "MEDIR",
  ])("recusa %j", (comando) => {
    expect(pedidoValido(comando)).toBe(false);
  });
});

describe("FilaDePedidos", () => {
  let pasta: string;
  let maquina: NodeJS.Timeout;

  beforeEach(async () => {
    pasta = await mkdtemp(join(tmpdir(), "eurolify-pedidos-"));
    // Faz de serviço da máquina: lê o pedido e responde em resultado.<id>.
    maquina = setInterval(() => {
      void (async () => {
        const nomes = await readdir(pasta);
        if (!nomes.includes("pedido")) return;
        const [comando, id] = (
          await readFile(join(pasta, "pedido"), "utf8")
        ).split("\n");
        await rm(join(pasta, "pedido"));
        await writeFile(
          join(pasta, `resultado.${String(id)}`),
          `0\nfeito: ${String(comando)}\n`,
        );
      })();
    }, 20);
  });

  afterEach(async () => {
    clearInterval(maquina);
    await rm(pasta, { recursive: true, force: true });
  });

  it("deixa o pedido, lê a resposta pelo identificador e limpa", async () => {
    const fila = new FilaDePedidos(pasta, 5_000, 20);
    await expect(fila.pedir("medir")).resolves.toEqual({
      codigo: 0,
      saida: "feito: medir",
    });
    expect(await readdir(pasta)).toEqual([]);
  });

  it("trata os pedidos um de cada vez, pela ordem", async () => {
    const fila = new FilaDePedidos(pasta, 5_000, 20);
    const respostas = await Promise.all([
      fila.pedir("copia"),
      fila.pedir("reposicao"),
    ]);
    expect(respostas.map((r) => r.saida)).toEqual([
      "feito: copia",
      "feito: reposicao",
    ]);
  });

  it("um pedido fora da lista nunca chega à máquina", async () => {
    const fila = new FilaDePedidos(pasta, 5_000, 20);
    await expect(fila.pedir("rm -rf /")).rejects.toThrow(/fora da lista/);
    expect(await readdir(pasta)).toEqual([]);
  });

  it("sem resposta, falha em vez de ficar à espera para sempre", async () => {
    clearInterval(maquina);
    const fila = new FilaDePedidos(pasta, 100, 20);
    await expect(fila.pedir("medir")).rejects.toThrow(/sem resposta/);
  });
});
