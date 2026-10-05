import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  let contas: string[];
  let cliente: Client;
  let agora: number;
  let confirmacoes: Confirmacoes;
  const ANA = { conta: "1001", login: "ana" };
  const RUI = { conta: "1002", login: "rui" };

  const fila: Pedinte = {
    pedir: (comando, conta) => {
      pedidos.push(comando);
      contas.push(conta);
      return Promise.resolve({ codigo: 0, saida: `feito: ${comando}` });
    },
  };

  const ligar = async (quem = ANA) => {
    const servidor = criarServidorMcp(fila, quem, confirmacoes);
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
    contas = [];
    agora = 1_000_000;
    confirmacoes = new Confirmacoes(() => agora);
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
    const outro = await ligar(RUI);
    const r2 = await outro.callTool({
      name: "correr_copia",
      arguments: { confirmacao: codigoEm(textoDe(r1)) },
    });
    await outro.close();
    expect(r2.isError).toBe(true);
    // Não se diz a quem tenta que o código existe noutra conta.
    expect(textoDe(r2)).toContain("não existe ou já foi usado");
    expect(pedidos).toEqual([]);
  });

  it("o mesmo login com outro número de conta não confirma", async () => {
    const r1 = await cliente.callTool({ name: "correr_copia", arguments: {} });
    const outro = await ligar({ conta: "9999", login: "ana" });
    const r2 = await outro.callTool({
      name: "correr_copia",
      arguments: { confirmacao: codigoEm(textoDe(r1)) },
    });
    await outro.close();
    expect(r2.isError).toBe(true);
    expect(pedidos).toEqual([]);
  });

  it("dois pedidos ao mesmo tempo com o mesmo código: só um executa", async () => {
    const r1 = await cliente.callTool({ name: "correr_copia", arguments: {} });
    const confirmacao = codigoEm(textoDe(r1));
    const outro = await ligar();
    const [a, b] = await Promise.all([
      cliente.callTool({ name: "correr_copia", arguments: { confirmacao } }),
      outro.callTool({ name: "correr_copia", arguments: { confirmacao } }),
    ]);
    await outro.close();
    expect([a.isError, b.isError].filter((e) => e === true)).toHaveLength(1);
    expect(pedidos).toEqual(["copia"]);
  });

  it("um código caducado não executa", async () => {
    const r1 = await cliente.callTool({ name: "correr_copia", arguments: {} });
    agora += VALIDADE_MS;
    const r2 = await cliente.callTool({
      name: "correr_copia",
      arguments: { confirmacao: codigoEm(textoDe(r1)) },
    });
    expect(r2.isError).toBe(true);
    expect(textoDe(r2)).toContain("caducou");
    expect(pedidos).toEqual([]);
  });

  it("passado o limite, recusa a conta e não a outra", async () => {
    for (let i = 0; i < MAXIMO_POR_CONTA; i++) {
      await cliente.callTool({ name: "correr_copia", arguments: {} });
    }
    const r = await cliente.callTool({ name: "correr_copia", arguments: {} });
    expect(r.isError).toBe(true);
    expect(textoDe(r)).toContain("demasiadas");
    const outro = await ligar(RUI);
    const r2 = await outro.callTool({ name: "correr_copia", arguments: {} });
    await outro.close();
    expect(codigoEm(textoDe(r2))).toBeDefined();
    expect(pedidos).toEqual([]);
  });

  it("o código nunca vai para a consola", async () => {
    const consola = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const r1 = await cliente.callTool({
        name: "correr_copia",
        arguments: {},
      });
      const codigo = codigoEm(textoDe(r1)) ?? "";
      await cliente.callTool({
        name: "correr_copia",
        arguments: { confirmacao: codigo },
      });
      const escrito = consola.mock.calls.flat().join("\n");
      expect(codigo).not.toBe("");
      expect(escrito).not.toContain(codigo);
      expect(escrito).toContain("ana");
    } finally {
      consola.mockRestore();
    }
  });

  it("um código inventado não executa", async () => {
    const r = await cliente.callTool({
      name: "correr_copia",
      arguments: { confirmacao: "ABCDEFGH" },
    });
    expect(r.isError).toBe(true);
    expect(pedidos).toEqual([]);
  });

  it("a máquina recebe o número da conta de quem pede", async () => {
    const r1 = await cliente.callTool({ name: "reiniciar_api", arguments: {} });
    await cliente.callTool({
      name: "reiniciar_api",
      arguments: { confirmacao: codigoEm(textoDe(r1)) },
    });
    await cliente.callTool({ name: "estado_do_ensaio", arguments: {} });
    expect(contas).toEqual(["1001", "1001"]);
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
