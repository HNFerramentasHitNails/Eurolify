import {
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
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
  let recebidos: string[];

  beforeEach(async () => {
    pasta = await mkdtemp(join(tmpdir(), "eurolify-pedidos-"));
    recebidos = [];
    // Faz de serviço da máquina: lê o pedido e responde em resultado.<id>.
    // Uma volta de cada vez, como o serviço verdadeiro: sem a trava, num
    // executor lento, duas voltas liam o mesmo pedido (a conta ficava duas
    // vezes e a segunda remoção dava ENOENT; CI do #115, 06/10/2026).
    let ocupada = false;
    maquina = setInterval(() => {
      if (ocupada) return;
      ocupada = true;
      void (async () => {
        const nomes = await readdir(pasta);
        if (!nomes.includes("pedido")) return;
        const [comando, id, conta] = (
          await readFile(join(pasta, "pedido"), "utf8")
        ).split("\n");
        recebidos.push(String(conta));
        await rm(join(pasta, "pedido"));
        // Como o serviço verdadeiro (eurolify-trabalho: mv -fT): a resposta
        // escreve-se ao lado e só depois toma o nome. Escrita directa, num
        // executor lento, a fila lia o ficheiro ainda vazio (publicar do
        // e554e19, 09/10/2026).
        const temporario = join(pasta, `.resultado.${String(id)}`);
        await writeFile(temporario, `0\nfeito: ${String(comando)}\n`);
        await rename(temporario, join(pasta, `resultado.${String(id)}`));
      })().finally(() => {
        ocupada = false;
      });
    }, 20);
  });

  afterEach(async () => {
    clearInterval(maquina);
    await rm(pasta, { recursive: true, force: true });
  });

  it("deixa o pedido, lê a resposta pelo identificador e limpa", async () => {
    const fila = new FilaDePedidos(pasta, 5_000, 20);
    await expect(fila.pedir("medir", "1001")).resolves.toEqual({
      codigo: 0,
      saida: "feito: medir",
    });
    expect(await readdir(pasta)).toEqual([]);
  });

  it("trata os pedidos um de cada vez, pela ordem", async () => {
    const fila = new FilaDePedidos(pasta, 5_000, 20);
    const respostas = await Promise.all([
      fila.pedir("copia", "1001"),
      fila.pedir("reposicao", "1001"),
    ]);
    expect(respostas.map((r) => r.saida)).toEqual([
      "feito: copia",
      "feito: reposicao",
    ]);
  });

  it("um pedido fora da lista nunca chega à máquina", async () => {
    const fila = new FilaDePedidos(pasta, 5_000, 20);
    await expect(fila.pedir("rm -rf /", "1001")).rejects.toThrow(
      /fora da lista/,
    );
    expect(await readdir(pasta)).toEqual([]);
  });

  it("leva o número da conta na terceira linha", async () => {
    const fila = new FilaDePedidos(pasta, 5_000, 20);
    await fila.pedir("medir", "1001");
    expect(recebidos).toEqual(["1001"]);
  });

  it.each(["", "ana", "1001\nreiniciar-vps", "1".repeat(21)])(
    "recusa a conta %j sem chegar à máquina",
    async (conta) => {
      const fila = new FilaDePedidos(pasta, 5_000, 20);
      await expect(fila.pedir("medir", conta)).rejects.toThrow(/conta/);
      expect(await readdir(pasta)).toEqual([]);
    },
  );

  it("sem resposta, falha em vez de ficar à espera para sempre", async () => {
    clearInterval(maquina);
    const fila = new FilaDePedidos(pasta, 100, 20);
    await expect(fila.pedir("medir", "1001")).rejects.toThrow(/sem resposta/);
  });
});
