import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { sql } from "kysely";
import { Type } from "typebox";
import { CamposDoRasto, respostasDoRasto } from "../src/base/rasto-resposta.js";
import { CANAIS } from "../src/base/rasto.js";
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
    quem: "catalogo:variante apagada",
    canal: null,
    pedido: null,
    ia: null,
    autorizado_por: null,
    motivo: null,
  };

  it("uma linha de antes da 0053 fica toda desconhecida, com a IA explícita", () => {
    expect(respostasDoRasto(vazia)).toEqual({
      canal: null,
      pedido: null,
      autorizado_por: null,
      motivo: null,
      ia: DESCONHECIDA,
      // Um «quem» antigo sem forma reconhecida; sem pessoa a autorizar, o
      // aviso aparece (docs/28 §3.6).
      tipo_de_autor: "desconhecido",
      sem_autorizacao_de_pessoa: true,
    });
  });

  it.each([
    ["pessoa:per_1", null, "pessoa"],
    ["chave:key_1", null, "chave"],
    ["chave:key_1", { prova: "declarado" }, "agente"],
    ["sistema:encomendas", null, "sistema"],
    ["operador:github:7", null, "operador"],
    ["lixo", null, "desconhecido"],
  ] as const)("o tipo de autor de %s com a IA %j é %s", (quem, ia, tipo) => {
    expect(
      respostasDoRasto({ ...vazia, quem, ia: ia === null ? null : { ...ia } })
        .tipo_de_autor,
    ).toBe(tipo);
  });

  it("o aviso vale para todas as origens sem pessoa a autorizar, e só para essas", () => {
    for (const quem of ["chave:key_1", "sistema:x", "operador:github:1"]) {
      expect(
        respostasDoRasto({ ...vazia, quem, canal: "api" })
          .sem_autorizacao_de_pessoa,
      ).toBe(true);
    }
    expect(
      respostasDoRasto({
        ...vazia,
        quem: "pessoa:per_1",
        canal: "hub",
        autorizado_por: "pessoa:per_1",
      }).sem_autorizacao_de_pessoa,
    ).toBe(false);
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

  it("uma prova que não é comprovado nem declarado nunca passa a verdade, nem leva o resto", () => {
    expect(
      respostasDoRasto({
        ...vazia,
        ia: { prova: "talvez", fornecedor: "x", modelo: "y" },
      }).ia,
    ).toEqual(DESCONHECIDA);
  });

  it("um canal que a base aceite e esta lista não conheça sai como está, sem 500", async () => {
    const app = Fastify();
    app.get(
      "/t",
      { schema: { response: { 200: Type.Object(CamposDoRasto) } } },
      () => ({
        ...respostasDoRasto({ ...vazia, canal: "pos", motivo: "m" }),
      }),
    );
    const r = await app.inject({ method: "GET", url: "/t" });
    await app.close();
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json<{ canal: string }>().canal).toBe("pos");
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

    it("a lista dos canais é a mesma da base (contexto_do_rasto)", async () => {
      const { rows } = await sql<{ fonte: string }>`
        select prosrc as fonte from pg_proc where proname = 'contexto_do_rasto'`.execute(
        base.dono,
      );
      expect(rows).toHaveLength(1);
      const lista = /canal NOT IN\s*\(([^)]*)\)/.exec(rows[0]?.fonte ?? "");
      expect(lista, "a lista dos canais na função").not.toBeNull();
      const naBase = [...(lista?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map(
        (m) => m[1],
      );
      expect([...naBase].sort()).toEqual([...CANAIS].sort());
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
