import { randomUUID } from "node:crypto";
import { sql, type Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarApp } from "../src/app.js";
import type { BaseDados } from "../src/base/esquema.js";
import { registarComerciante } from "../src/comerciante/repositorio.js";
import { criarChave } from "../src/identidade/repositorio.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";

// A API de Administração do Catálogo, parte 4: as opções e a composição dos
// kits (docs/14 §3.3, §3.4 e §7.1). Contra o PostgreSQL 18 verdadeiro, pela
// app inteira.

const NOVO = { nome: "Loja de Teste", lingua: "pt", fuso: "Europe/Lisbon" };
const CLASSIFICACAO = {
  familias: ["retalho_geral"],
  natureza_consumidor: "bem",
};

interface Opcao {
  id: string;
  artigo: string;
  nome: string;
  posicao: number;
  valores: { id: string; valor: string }[];
}
interface Pagina<T> {
  dados: T[];
  total: number;
  ha_mais: boolean;
  cursor_seguinte: string | null;
}
interface Ficha {
  id: string;
  versao: number;
  variantes: { id: string; sku: string }[];
}

describe.skipIf(URL_BASE === undefined)(
  "API do Catálogo: opções e kits",
  () => {
    let base: BaseDeTeste;
    let app: ReturnType<typeof criarApp>;
    let escrita: string;
    let leitura: string;
    let semCatalogo: string;
    let escritaDeB: string;

    const pedir = (
      metodo: "POST" | "PUT" | "GET",
      url: string,
      corpo?: unknown,
      {
        segredo = escrita,
        chave = randomUUID(),
      }: { segredo?: string; chave?: string | null } = {},
    ) =>
      app.inject({
        method: metodo,
        url,
        headers: {
          authorization: `Bearer ${segredo}`,
          ...(chave === null || metodo === "GET"
            ? {}
            : { "idempotency-key": chave }),
          ...(corpo === undefined
            ? {}
            : { "content-type": "application/json" }),
        },
        ...(corpo === undefined ? {} : { payload: JSON.stringify(corpo) }),
      });

    /** Um artigo pela API, com as variantes dadas (SKU); activo se pedido. */
    async function artigo(skus: string[], activar = false) {
      const r = await pedir("POST", "/products", {
        tipo: "fisico",
        nome: "Artigo",
        categoria_fiscal: "normal",
        variantes: skus.map((sku) => ({
          sku,
          unidade_de_venda: "unidade",
          peso_g: 30,
        })),
      });
      expect(r.statusCode).toBe(201);
      let f = r.json<Ficha>();
      if (activar) {
        const c = await pedir("PUT", `/products/${f.id}/classification`, {
          versao: f.versao,
          ...CLASSIFICACAO,
        });
        expect(c.statusCode).toBe(200);
        const at = await pedir("POST", `/products/${f.id}/activate`, {
          versao: c.json<Ficha>().versao,
        });
        expect(at.statusCode).toBe(200);
        f = at.json<Ficha>();
      }
      return f;
    }

    beforeAll(async () => {
      base = await criarBaseDeTeste(URL_BASE ?? "");
      app = criarApp({ logger: false }, undefined, base.api);
      const a = await registarComerciante(base.api, NOVO);
      const b = await registarComerciante(base.api, NOVO);
      const dono: Kysely<BaseDados> = base.dono;
      const chaveDe = async (c: string, nome: string, ambitos: string[]) =>
        (
          await criarChave(dono, c, {
            tipo: "servidor",
            criadaPor: "operador:teste",
            nome,
            ambitos: ambitos as never,
          })
        ).segredo;
      escrita = await chaveDe(a, "Escrita", ["catalog:read", "catalog:write"]);
      leitura = await chaveDe(a, "Leitura", ["catalog:read"]);
      semCatalogo = await chaveDe(a, "Chaves", ["keys:write"]);
      escritaDeB = await chaveDe(b, "Escrita de B", [
        "catalog:read",
        "catalog:write",
      ]);
    }, 60_000);

    afterAll(async () => {
      await app.close();
      await base.fechar();
    });

    it("cria uma opção com os valores (201, Location), lê-a sozinha e na lista; acrescenta um valor no fim", async () => {
      const f = await artigo(["OPC-1"]);
      const r = await pedir("POST", `/products/${f.id}/options`, {
        nome: "Cor",
        valores: ["Rosa", "Azul"],
      });
      expect(r.statusCode).toBe(201);
      const o = r.json<Opcao>();
      expect(o).toMatchObject({ nome: "Cor", artigo: f.id, posicao: 0 });
      expect(o.id).toMatch(/^opt_/);
      expect(o.valores.map((v) => v.valor)).toEqual(["Rosa", "Azul"]);
      expect(o.valores[0]?.id).toMatch(/^ovl_/);
      expect(r.headers["location"]).toBe(`/options/${o.id}`);
      const sozinha = await pedir("GET", `/options/${o.id}`, undefined, {
        segredo: leitura,
      });
      expect(sozinha.json()).toEqual(o);
      const tam = await pedir("POST", `/products/${f.id}/options`, {
        nome: "Tamanho",
        valores: ["S"],
      });
      expect(tam.json<Opcao>().posicao).toBe(1);
      const lista = (
        await pedir("GET", `/products/${f.id}/options`, undefined, {
          segredo: leitura,
        })
      ).json<Pagina<Opcao>>();
      expect(lista.dados.map((d) => d.nome)).toEqual(["Cor", "Tamanho"]);
      expect(lista).toMatchObject({ total: 2, ha_mais: false });
      const verde = await pedir("POST", `/options/${o.id}/values`, {
        valor: "Verde",
      });
      expect(verde.statusCode).toBe(201);
      expect(verde.headers["location"]).toBe(`/options/${o.id}`);
      expect(verde.json<Opcao>().valores.map((v) => v.valor)).toEqual([
        "Rosa",
        "Azul",
        "Verde",
      ]);
    });

    it("as recusas das opções: nome repetido, valor repetido, sem valores, valores iguais no pedido, num artigo activo", async () => {
      const f = await artigo(["REC-1"]);
      const url = `/products/${f.id}/options`;
      const o = (
        await pedir("POST", url, { nome: "Cor", valores: ["Rosa"] })
      ).json<Opcao>();
      const nome = await pedir("POST", url, { nome: "Cor", valores: ["X"] });
      expect(nome.statusCode).toBe(409);
      expect(nome.json()).toMatchObject({ codigo: "catalog.option_duplicate" });
      const valor = await pedir("POST", `/options/${o.id}/values`, {
        valor: "Rosa",
      });
      expect(valor.statusCode).toBe(409);
      expect(valor.json()).toMatchObject({
        codigo: "catalog.option_value_duplicate",
      });
      for (const corpo of [
        { nome: "Vazia", valores: [] },
        { nome: "Iguais", valores: ["A", "A"] },
        { nome: "   ", valores: ["A"] },
        { nome: "Mais", valores: ["A"], extra: 1 },
      ]) {
        const r = await pedir("POST", url, corpo);
        expect(r.statusCode, JSON.stringify(corpo)).toBe(400);
      }
      const activo = await artigo(["REC-ACT"], true);
      const r = await pedir("POST", `/products/${activo.id}/options`, {
        nome: "Cor",
        valores: ["Rosa"],
      });
      expect(r.statusCode).toBe(409);
      expect(r.json()).toMatchObject({ codigo: "catalog.not_draft" });
    });

    it("a idempotência: a mesma chave devolve a mesma opção; outro corpo dá 422", async () => {
      const f = await artigo(["IDEM-1"]);
      const url = `/products/${f.id}/options`;
      const chave = randomUUID();
      const r1 = await pedir(
        "POST",
        url,
        { nome: "Cor", valores: ["Rosa"] },
        { chave },
      );
      const r2 = await pedir(
        "POST",
        url,
        { nome: "Cor", valores: ["Rosa"] },
        { chave },
      );
      expect(r1.statusCode).toBe(201);
      expect(r2.json()).toEqual(r1.json());
      const outro = await pedir(
        "POST",
        url,
        { nome: "Tamanho", valores: ["S"] },
        { chave },
      );
      expect(outro.json()).toMatchObject({ codigo: "idempotency.key_reused" });
      const lista = (await pedir("GET", url)).json<Pagina<Opcao>>();
      expect(lista.total).toBe(1);
    });

    it("as opções vão por páginas; um cursor estranho dá 400", async () => {
      const f = await artigo(["PAG-1"]);
      for (const nome of ["A", "B", "C"]) {
        await pedir("POST", `/products/${f.id}/options`, {
          nome,
          valores: ["1"],
        });
      }
      const p1 = (
        await pedir("GET", `/products/${f.id}/options?limite=2`)
      ).json<Pagina<Opcao>>();
      expect(p1.dados.map((d) => d.nome)).toEqual(["A", "B"]);
      expect(p1).toMatchObject({ total: 3, ha_mais: true });
      const p2 = (
        await pedir(
          "GET",
          `/products/${f.id}/options?limite=2&cursor=${p1.cursor_seguinte ?? ""}`,
        )
      ).json<Pagina<Opcao>>();
      expect(p2.dados.map((d) => d.nome)).toEqual(["C"]);
      expect(p2).toMatchObject({ ha_mais: false, cursor_seguinte: null });
      const mau = await pedir(
        "GET",
        `/products/${f.id}/options?cursor=${Buffer.from("[0]").toString("base64url")}`,
      );
      expect(mau.statusCode).toBe(400);
    });

    type Comp = { variante: string; quantidade: number; estado: string };

    it("a composição do kit: substitui-se inteira, pela ordem, com o estado; vazia deixa de ser kit; por páginas", async () => {
      const f = await artigo(["KIT", "GEL", "LIMA", "TOP"]);
      const [kit = "", gel = "", lima = "", top = ""] = f.variantes.map(
        (v) => v.id,
      );
      const url = `/variants/${kit}/components`;
      const r = await pedir("PUT", url, {
        componentes: [
          { variante: gel, quantidade: 2 },
          { variante: lima, quantidade: 1 },
        ],
      });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toEqual({
        dados: [
          { variante: gel, quantidade: 2, estado: "activa" },
          { variante: lima, quantidade: 1, estado: "activa" },
        ],
        total: 2,
        ha_mais: false,
        cursor_seguinte: null,
      });
      // Substitui: a ordem e as quantidades novas, e o que sai, sai.
      await pedir("PUT", url, {
        componentes: [
          { variante: top, quantidade: 3 },
          { variante: gel, quantidade: 5 },
        ],
      });
      const lida = (
        await pedir("GET", url, undefined, { segredo: leitura })
      ).json<Pagina<Comp>>();
      expect(lida.dados.map((d) => [d.variante, d.quantidade])).toEqual([
        [top, 3],
        [gel, 5],
      ]);
      const p1 = (await pedir("GET", `${url}?limite=1`)).json<Pagina<Comp>>();
      expect(p1).toMatchObject({ total: 2, ha_mais: true });
      const p2 = (
        await pedir("GET", `${url}?limite=1&cursor=${p1.cursor_seguinte ?? ""}`)
      ).json<Pagina<Comp>>();
      expect(p2.dados.map((d) => d.variante)).toEqual([gel]);
      expect(
        (await pedir("PUT", url, { componentes: [] })).json<Pagina<Comp>>()
          .total,
      ).toBe(0);
    });

    it("a idempotência do PUT: a mesma chave devolve a resposta guardada, não o estado de agora; outro corpo dá 422", async () => {
      const f = await artigo(["I-KIT", "I-GEL", "I-LIMA"]);
      const [kit = "", gel = "", lima = ""] = f.variantes.map((v) => v.id);
      const url = `/variants/${kit}/components`;
      const chave = randomUUID();
      const comGel = { componentes: [{ variante: gel, quantidade: 2 }] };
      const r1 = await pedir("PUT", url, comGel, { chave });
      // Outra escrita, com outra chave, muda a composição.
      await pedir("PUT", url, {
        componentes: [{ variante: lima, quantidade: 1 }],
      });
      // A repetição devolve a resposta guardada e não volta a escrever.
      const r2 = await pedir("PUT", url, comGel, { chave });
      expect(r2.statusCode).toBe(200);
      expect(r2.json()).toEqual(r1.json());
      expect(
        (await pedir("GET", url))
          .json<Pagina<Comp>>()
          .dados.map((d) => d.variante),
      ).toEqual([lima]);
      const outro = await pedir("PUT", url, { componentes: [] }, { chave });
      expect(outro.statusCode).toBe(422);
      expect(outro.json()).toMatchObject({ codigo: "idempotency.key_reused" });
    });

    it("as recusas da composição não mudam nada: ciclo, repetido, componente arquivado, de outro comerciante; o arquivado que já estava fica; kit arquivado recusa", async () => {
      const f = await artigo(["C-KIT", "C-GEL", "C-LIMA", "C-VELHO"], true);
      const [kit = "", gel = "", lima = "", velho = ""] = f.variantes.map(
        (v) => v.id,
      );
      const url = `/variants/${kit}/components`;
      const antes = {
        componentes: [
          { variante: gel, quantidade: 2 },
          { variante: lima, quantidade: 1 },
        ],
      };
      expect((await pedir("PUT", url, antes)).statusCode).toBe(200);
      const composicao = async () =>
        (await pedir("GET", url))
          .json<Pagina<Comp>>()
          .dados.map((d) => [d.variante, d.quantidade]);
      const esperada = [
        [gel, 2],
        [lima, 1],
      ];
      const recusa = async (corpo: object, estado: number, codigo: string) => {
        const r = await pedir("PUT", url, corpo);
        expect(r.statusCode, codigo).toBe(estado);
        expect(r.json()).toMatchObject({ codigo });
        expect(await composicao(), codigo).toEqual(esperada);
      };
      await recusa(
        { componentes: [{ variante: kit, quantidade: 1 }] },
        422,
        "catalog.component_cycle",
      );
      // Ciclo por outro kit: GEL leva KIT, e depois KIT levaria GEL.
      expect(
        (
          await pedir("PUT", `/variants/${gel}/components`, {
            componentes: [{ variante: kit, quantidade: 1 }],
          })
        ).statusCode,
      ).toBe(422);
      await recusa(
        {
          componentes: [
            { variante: gel, quantidade: 1 },
            { variante: gel, quantidade: 2 },
          ],
        },
        422,
        "catalog.component_duplicate",
      );
      expect(
        (await pedir("POST", `/variants/${velho}/archive`)).statusCode,
      ).toBe(200);
      await recusa(
        {
          componentes: [
            { variante: gel, quantidade: 2 },
            { variante: velho, quantidade: 1 },
          ],
        },
        422,
        "catalog.component_archived",
      );
      const deB = await pedir(
        "POST",
        "/products",
        {
          tipo: "fisico",
          nome: "De B",
          categoria_fiscal: "normal",
          variantes: [{ sku: "B-1", unidade_de_venda: "unidade" }],
        },
        { segredo: escritaDeB },
      );
      const varB = deB.json<Ficha>().variantes[0]?.id ?? "";
      await recusa(
        {
          componentes: [
            { variante: gel, quantidade: 2 },
            { variante: varB, quantidade: 1 },
          ],
        },
        404,
        "catalog.not_found",
      );
      // O componente que já estava fica, mesmo arquivado, e vê-se o estado.
      expect(
        (await pedir("POST", `/variants/${lima}/archive`)).statusCode,
      ).toBe(200);
      const fica = await pedir("PUT", url, {
        componentes: [
          { variante: lima, quantidade: 4 },
          { variante: gel, quantidade: 2 },
        ],
      });
      expect(fica.statusCode).toBe(200);
      expect(fica.json<Pagina<Comp>>().dados).toEqual([
        { variante: lima, quantidade: 4, estado: "arquivada" },
        { variante: gel, quantidade: 2, estado: "activa" },
      ]);
      // Um kit arquivado não muda.
      expect((await pedir("POST", `/variants/${kit}/archive`)).statusCode).toBe(
        200,
      );
      const arquivado = await pedir("PUT", url, { componentes: [] });
      expect(arquivado.statusCode).toBe(409);
      expect(arquivado.json()).toMatchObject({
        codigo: "catalog.variant_archived_is_final",
      });
    });

    it("os valores acrescentados: a mesma chave não acrescenta duas vezes; outro corpo dá 422; ao mesmo tempo, cada um com a sua posição, sem repetir", async () => {
      const f = await artigo(["VAL-1"]);
      const o = (
        await pedir("POST", `/products/${f.id}/options`, {
          nome: "Cor",
          valores: ["Rosa"],
        })
      ).json<Opcao>();
      const url = `/options/${o.id}/values`;
      const chave = randomUUID();
      const r1 = await pedir("POST", url, { valor: "Azul" }, { chave });
      const r2 = await pedir("POST", url, { valor: "Azul" }, { chave });
      expect([r1.statusCode, r2.statusCode]).toEqual([201, 201]);
      expect(r2.json()).toEqual(r1.json());
      const outro = await pedir("POST", url, { valor: "Verde" }, { chave });
      expect(outro.json()).toMatchObject({ codigo: "idempotency.key_reused" });
      const repetido = await pedir("POST", url, { valor: " azul " });
      expect(repetido.statusCode).toBe(409);
      expect(repetido.json()).toMatchObject({
        codigo: "catalog.option_value_duplicate",
      });
      // Cinco ao mesmo tempo.
      const novos = ["V1", "V2", "V3", "V4", "V5"];
      const rs = await Promise.all(
        novos.map((valor) => pedir("POST", url, { valor })),
      );
      expect(rs.map((r) => r.statusCode)).toEqual([201, 201, 201, 201, 201]);
      const { rows } = await sql<{ posicao: number }>`
        select posicao from valor_opcao
        where opcao_id = ${o.id.slice("opt_".length)}::uuid
        order by posicao`.execute(base.dono);
      expect(rows.map((l) => l.posicao)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    });

    it("os limites do contrato: 101 valores, 101 componentes, quantidade fora do inteiro, nome com 101, valor em branco", async () => {
      const f = await artigo(["LIM-KIT", "LIM-GEL"]);
      const [kit = "", gel = ""] = f.variantes.map((v) => v.id);
      const o = (
        await pedir("POST", `/products/${f.id}/options`, {
          nome: "Cor",
          valores: ["Rosa"],
        })
      ).json<Opcao>();
      for (const [metodo, url, corpo] of [
        [
          "POST",
          `/products/${f.id}/options`,
          {
            nome: "Muitos",
            valores: Array.from({ length: 101 }, (_, i) => `v${String(i)}`),
          },
        ],
        [
          "POST",
          `/products/${f.id}/options`,
          { nome: "x".repeat(101), valores: ["a"] },
        ],
        ["POST", `/options/${o.id}/values`, { valor: "   " }],
        [
          "PUT",
          `/variants/${kit}/components`,
          {
            componentes: Array.from({ length: 101 }, () => ({
              variante: gel,
              quantidade: 1,
            })),
          },
        ],
        [
          "PUT",
          `/variants/${kit}/components`,
          { componentes: [{ variante: gel, quantidade: 2147483648 }] },
        ],
        [
          "PUT",
          `/variants/${kit}/components`,
          { componentes: [{ variante: gel, quantidade: "2" }] },
        ],
        [
          "PUT",
          `/variants/${kit}/components`,
          { componentes: [{ variante: gel, quantidade: 0 }] },
        ],
      ] as const) {
        const r = await pedir(metodo, url, corpo);
        expect(r.statusCode, `${metodo} ${url}`).toBe(400);
      }
    });

    it("de outro comerciante: 404 em todas; os âmbitos", async () => {
      const f = await artigo(["AMB-1", "AMB-2"]);
      const [kit = "", gel = ""] = f.variantes.map((v) => v.id);
      const o = (
        await pedir("POST", `/products/${f.id}/options`, {
          nome: "Cor",
          valores: ["Rosa"],
        })
      ).json<Opcao>();
      for (const [metodo, url, corpo] of [
        ["GET", `/products/${f.id}/options`, undefined],
        ["GET", `/options/${o.id}`, undefined],
        ["POST", `/products/${f.id}/options`, { nome: "X", valores: ["1"] }],
        ["POST", `/options/${o.id}/values`, { valor: "Azul" }],
        ["GET", `/variants/${kit}/components`, undefined],
        [
          "PUT",
          `/variants/${kit}/components`,
          { componentes: [{ variante: gel, quantidade: 1 }] },
        ],
      ] as const) {
        const r = await pedir(metodo, url, corpo, { segredo: escritaDeB });
        expect(r.statusCode, `${metodo} ${url}`).toBe(404);
        expect(r.json()).toMatchObject({ codigo: "catalog.not_found" });
      }
      // Nada mudou.
      expect(
        (await pedir("GET", `/options/${o.id}`)).json<Opcao>().valores,
      ).toHaveLength(1);
      expect(
        (
          await pedir(
            "POST",
            `/products/${f.id}/options`,
            {
              nome: "Y",
              valores: ["1"],
            },
            { segredo: leitura },
          )
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await pedir(
            "PUT",
            `/variants/${kit}/components`,
            {
              componentes: [],
            },
            { segredo: leitura },
          )
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await pedir(
            "POST",
            `/options/${o.id}/values`,
            { valor: "Azul" },
            { segredo: leitura },
          )
        ).statusCode,
      ).toBe(403);
      for (const url of [
        `/products/${f.id}/options`,
        `/options/${o.id}`,
        `/variants/${kit}/components`,
      ]) {
        const r = await pedir("GET", url, undefined, { segredo: semCatalogo });
        expect(r.statusCode, url).toBe(403);
      }
    });
  },
);
