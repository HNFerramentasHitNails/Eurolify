import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { respostasDoRasto } from "../src/base/rasto-resposta.js";
import { registarComerciante } from "../src/comerciante/repositorio.js";
import { criarChave } from "../src/identidade/repositorio.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";
import { hubDeTeste } from "./hub-de-teste.js";

// O rasto de auditoria comum, passo 4, parte 2 (docs/28 §1 e §4; #322): as
// linhas do tempo da API devolvem as seis respostas — o que mudou, quem, de
// onde, a IA, quem autorizou, quando e porquê — iguais em todas.

const DESCONHECIDA = {
  prova: "desconhecido",
  fornecedor: null,
  modelo: null,
  execucao: null,
};

describe("as respostas a partir de uma linha do rasto", () => {
  const vazia = {
    canal: null,
    pedido: null,
    ia: null,
    autorizado_por: null,
    motivo: null,
  };

  it("uma linha de antes da 0053 fica toda desconhecida, com a IA explícita", () => {
    expect(respostasDoRasto(vazia)).toEqual({ ...vazia, ia: DESCONHECIDA });
  });

  it("a IA declarada leva o que foi dito, e vazio o que não foi", () => {
    expect(
      respostasDoRasto({
        ...vazia,
        canal: "api",
        ia: { prova: "declarado", modelo: "m-1" },
      }).ia,
    ).toEqual({
      prova: "declarado",
      fornecedor: null,
      modelo: "m-1",
      execucao: null,
    });
  });

  it("uma prova que não é comprovado nem declarado nunca passa a verdade", () => {
    expect(
      respostasDoRasto({ ...vazia, ia: { prova: "talvez" } }).ia.prova,
    ).toBe("desconhecido");
  });
});

describe.skipIf(URL_BASE === undefined)(
  "rasto: as seis respostas nas linhas do tempo",
  () => {
    let base: BaseDeTeste;
    let h: ReturnType<typeof hubDeTeste>;
    let a: string;
    let segredo: string;
    let chaveId: string;

    const comChave = (
      metodo: "GET" | "POST",
      url: string,
      corpo?: object,
      extra: Record<string, string> = {},
    ) =>
      h.app.inject({
        method: metodo,
        url,
        headers: {
          authorization: `Bearer ${segredo}`,
          ...(corpo === undefined
            ? {}
            : {
                "idempotency-key": randomUUID(),
                "content-type": "application/json",
              }),
          ...extra,
        },
        ...(corpo === undefined ? {} : { payload: JSON.stringify(corpo) }),
      });

    const artigo = () => ({
      tipo: "fisico",
      nome: "Verniz",
      categoria_fiscal: "normal",
      variantes: [
        {
          sku: `H-${randomUUID().slice(0, 8)}`,
          unidade_de_venda: "unidade",
          peso_g: 15,
        },
      ],
    });

    beforeAll(async () => {
      base = await criarBaseDeTeste(URL_BASE ?? "");
      h = hubDeTeste(base);
      a = await registarComerciante(base.api, {
        nome: "Loja Histórico",
        lingua: "pt",
        fuso: "Europe/Lisbon",
      });
      const k = await criarChave(base.dono, a, {
        tipo: "servidor",
        criadaPor: "operador:teste",
        nome: "Integração",
        ambitos: [
          "catalog:read",
          "catalog:write",
          "catalog:history",
          "customers:read",
          "customers:write",
        ],
      });
      segredo = k.segredo;
      chaveId = k.id;
    }, 60_000);

    afterAll(async () => {
      await h.app.close();
      await base.fechar();
    });

    it("o artigo pela API com IA declarada: de onde, o pedido, a IA; ninguém autorizou", async () => {
      const r = await comChave("POST", "/products", artigo(), {
        "eurolify-ia": "fornecedor=anthropic; modelo=claude-x; execucao=run_9",
      });
      expect(r.statusCode, r.body).toBe(201);
      const id = r.json<{ id: string }>().id;
      const t = await comChave("GET", `/products/${id}/timeline`);
      expect(t.statusCode, t.body).toBe(200);
      const dados = t.json<{ dados: Record<string, unknown>[] }>().dados;
      expect(dados.length).toBeGreaterThan(0);
      for (const e of dados) {
        expect(e).toMatchObject({
          quem: `chave:key_${chaveId}`,
          canal: "api",
          ia: {
            prova: "declarado",
            fornecedor: "anthropic",
            modelo: "claude-x",
            execucao: "run_9",
          },
          autorizado_por: null,
          motivo: null,
        });
        expect(e["pedido"]).toEqual(expect.any(String));
      }
    });

    it("sem nada que indique IA, a resposta diz desconhecido, nunca «sem IA»", async () => {
      const r = await comChave("POST", "/products", artigo());
      const id = r.json<{ id: string }>().id;
      const t = await comChave("GET", `/products/${id}/timeline`);
      for (const e of t.json<{ dados: Record<string, unknown>[] }>().dados) {
        expect(e["ia"]).toEqual(DESCONHECIDA);
      }
    });

    it("no Hub, a pessoa que criou fica como quem autorizou, e o histórico do Hub traz o mesmo", async () => {
      const p = await h.pessoaCom(a, "dono");
      const r = await h.pedir("POST", "/hub/products", {
        sessao: p.sessao,
        comerciante: a,
        corpo: {
          tipo: "fisico",
          nome: "Gel",
          variantes: [
            {
              sku: `G-${randomUUID().slice(0, 8)}`,
              unidade_de_venda: "unidade",
            },
          ],
        },
      });
      expect(r.statusCode, r.body).toBe(201);
      const id = r.json<{ id: string }>().id;
      const t = await h.pedir("GET", `/hub/products/${id}/timeline`, {
        sessao: p.sessao,
        comerciante: a,
      });
      expect(t.statusCode, t.body).toBe(200);
      const dados = t.json<{ dados: Record<string, unknown>[] }>().dados;
      expect(dados.length).toBeGreaterThan(0);
      for (const e of dados) {
        expect(e).toMatchObject({
          quem: `pessoa:per_${p.pessoa}`,
          canal: "hub",
          ia: DESCONHECIDA,
          autorizado_por: `pessoa:per_${p.pessoa}`,
        });
      }
    });

    it("a ficha de cliente traz as mesmas respostas", async () => {
      const r = await comChave("POST", "/customers", { nome: "Ana" });
      expect(r.statusCode, r.body).toBe(201);
      const id = r.json<{ id: string }>().id;
      const t = await comChave("GET", `/customers/${id}/timeline`);
      expect(t.statusCode, t.body).toBe(200);
      const dados = t.json<{ dados: Record<string, unknown>[] }>().dados;
      expect(dados.length).toBeGreaterThan(0);
      for (const e of dados) {
        expect(e).toMatchObject({
          canal: "api",
          ia: DESCONHECIDA,
          autorizado_por: null,
          motivo: null,
        });
        expect(e["pedido"]).toEqual(expect.any(String));
      }
    });
  },
);
