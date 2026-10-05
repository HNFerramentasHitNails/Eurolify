import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  Confirmacoes,
  MAXIMO_POR_CONTA,
  VALIDADE_MS,
} from "../src/confirmacoes.js";
import { criarServidorMcp, type Pedinte } from "../src/ferramentas.js";

describe("Confirmacoes", () => {
  let agora: number;
  let c: Confirmacoes;
  beforeEach(() => {
    agora = 1_000_000;
    c = new Confirmacoes(() => agora);
  });

  it("dá um código de 8 caracteres sem letras que se confundam", () => {
    const codigo = c.pedir("ana", "copia");
    expect(codigo).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
  });

  it("confirma uma vez, com a mesma conta e o mesmo comando", () => {
    const codigo = c.pedir("ana", "copia") ?? "";
    expect(c.confirmar("ana", "copia", codigo)).toEqual({ ok: true });
    expect(c.confirmar("ana", "copia", codigo)).toEqual({
      ok: false,
      motivo: "desconhecido",
    });
  });

  it("aceita o código em minúsculas", () => {
    const codigo = c.pedir("ana", "copia") ?? "";
    expect(c.confirmar("ana", "copia", codigo.toLowerCase()).ok).toBe(true);
  });

  it("recusa outra conta sem gastar o código", () => {
    const codigo = c.pedir("ana", "copia") ?? "";
    expect(c.confirmar("rui", "copia", codigo)).toEqual({
      ok: false,
      motivo: "outra_conta",
    });
    expect(c.confirmar("ana", "copia", codigo).ok).toBe(true);
  });

  it("recusa outro comando e gasta o código", () => {
    const codigo = c.pedir("ana", `publicar sha256:${"a".repeat(64)}`) ?? "";
    expect(
      c.confirmar("ana", `publicar sha256:${"b".repeat(64)}`, codigo),
    ).toEqual({ ok: false, motivo: "outro_comando" });
    expect(
      c.confirmar("ana", `publicar sha256:${"a".repeat(64)}`, codigo),
    ).toEqual({ ok: false, motivo: "desconhecido" });
  });

  it("caduca ao fim da validade", () => {
    const codigo = c.pedir("ana", "copia") ?? "";
    agora += VALIDADE_MS;
    expect(c.confirmar("ana", "copia", codigo)).toEqual({
      ok: false,
      motivo: "caducado",
    });
  });

  it("vale até ao último milissegundo", () => {
    const codigo = c.pedir("ana", "copia") ?? "";
    agora += VALIDADE_MS - 1;
    expect(c.confirmar("ana", "copia", codigo).ok).toBe(true);
  });

  it("limita os códigos por confirmar de cada conta, e liberta-os ao caducar", () => {
    for (let i = 0; i < MAXIMO_POR_CONTA; i++) {
      expect(c.pedir("ana", "copia")).not.toBeNull();
    }
    expect(c.pedir("ana", "copia")).toBeNull();
    expect(c.pedir("rui", "copia")).not.toBeNull();
    agora += VALIDADE_MS;
    expect(c.pedir("ana", "copia")).not.toBeNull();
  });
});

describe("acções do MCP em dois passos", () => {
  let pedidos: string[];
  let cliente: Client;
  let conta: string;
  let confirmacoes: Confirmacoes;

  const fila: Pedinte = {
    pedir: (comando) => {
      pedidos.push(comando);
      return Promise.resolve({ codigo: 0, saida: `feito: ${comando}` });
    },
  };

  const ligar = async () => {
    const servidor = criarServidorMcp(fila, () => conta, confirmacoes);
    const [lc, ls] = InMemoryTransport.createLinkedPair();
    const c = new Client({ name: "teste", version: "1.0.0" });
    await Promise.all([servidor.connect(ls), c.connect(lc)]);
    return c;
  };

  const textoDe = (r: Awaited<ReturnType<Client["callTool"]>>) =>
    (r.content as { type: string; text: string }[])[0]?.text ?? "";
  const codigoEm = (t: string) => /confirmacao: "([A-Z0-9]{8})"/.exec(t)?.[1];

  beforeEach(async () => {
    pedidos = [];
    conta = "ana";
    confirmacoes = new Confirmacoes();
    cliente = await ligar();
  });
  afterEach(async () => {
    await cliente.close();
  });

  it("o primeiro pedido não executa e devolve um código", async () => {
    const r = await cliente.callTool({ name: "reiniciar_api", arguments: {} });
    expect(r.isError).toBeFalsy();
    expect(textoDe(r)).toContain("NADA FOI FEITO AINDA");
    expect(codigoEm(textoDe(r))).toBeDefined();
    expect(pedidos).toEqual([]);
  });

  it("com o código, executa uma vez", async () => {
    const r1 = await cliente.callTool({ name: "reiniciar_api", arguments: {} });
    const codigo = codigoEm(textoDe(r1));
    const r2 = await cliente.callTool({
      name: "reiniciar_api",
      arguments: { confirmacao: codigo },
    });
    expect(r2.isError).toBeFalsy();
    expect(pedidos).toEqual(["reiniciar-api"]);
    const r3 = await cliente.callTool({
      name: "reiniciar_api",
      arguments: { confirmacao: codigo },
    });
    expect(r3.isError).toBe(true);
    expect(pedidos).toEqual(["reiniciar-api"]);
  });

  it("o código de uma acção não serve para outra", async () => {
    const r1 = await cliente.callTool({ name: "correr_copia", arguments: {} });
    const r2 = await cliente.callTool({
      name: "reiniciar_vps",
      arguments: { confirmacao: codigoEm(textoDe(r1)) },
    });
    expect(r2.isError).toBe(true);
    expect(textoDe(r2)).toContain("NADA FOI FEITO");
    expect(pedidos).toEqual([]);
  });

  it("o código de uma publicação não serve para outro resumo", async () => {
    const a = `sha256:${"a".repeat(64)}`;
    const b = `sha256:${"b".repeat(64)}`;
    const r1 = await cliente.callTool({
      name: "voltar_a_publicacao",
      arguments: { resumo: a },
    });
    const r2 = await cliente.callTool({
      name: "voltar_a_publicacao",
      arguments: { resumo: b, confirmacao: codigoEm(textoDe(r1)) },
    });
    expect(r2.isError).toBe(true);
    expect(pedidos).toEqual([]);
  });

  it("o código de uma conta não serve a outra", async () => {
    const r1 = await cliente.callTool({ name: "correr_copia", arguments: {} });
    conta = "rui";
    const r2 = await cliente.callTool({
      name: "correr_copia",
      arguments: { confirmacao: codigoEm(textoDe(r1)) },
    });
    expect(r2.isError).toBe(true);
    expect(pedidos).toEqual([]);
  });

  it("um código inventado não executa", async () => {
    const r = await cliente.callTool({
      name: "correr_copia",
      arguments: { confirmacao: "ABCDEFGH" },
    });
    expect(r.isError).toBe(true);
    expect(pedidos).toEqual([]);
  });

  it("as leituras continuam num só passo", async () => {
    const r = await cliente.callTool({
      name: "estado_do_ensaio",
      arguments: {},
    });
    expect(r.isError).toBeFalsy();
    expect(pedidos).toEqual(["medir"]);
  });

  it("todas as acções destrutivas pedem confirmação", async () => {
    const { tools } = await cliente.listTools();
    const destrutivas = tools.filter((t) => t.annotations?.destructiveHint);
    expect(destrutivas.map((t) => t.name).sort()).toEqual([
      "actualizar_vps",
      "correr_copia",
      "correr_reposicao",
      "reiniciar_api",
      "reiniciar_vps",
      "voltar_a_publicacao",
    ]);
    for (const t of destrutivas) {
      expect(Object.keys(t.inputSchema.properties ?? {})).toContain(
        "confirmacao",
      );
      const args =
        t.name === "voltar_a_publicacao"
          ? { resumo: `sha256:${"c".repeat(64)}` }
          : {};
      await cliente.callTool({ name: t.name, arguments: args });
    }
    expect(pedidos).toEqual([]);
  });
});
