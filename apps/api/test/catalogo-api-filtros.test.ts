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

// A procura de artigos com os filtros da docs/14 §7.1 («Procurar artigos»):
// categoria, tradução em falta numa língua e alterados desde um instante.
// Contra o PostgreSQL 18 verdadeiro, pela app inteira; cada teste usa um
// comerciante novo (língua de origem «pt»), para as listas não terem ruído.

const NOVO = { nome: "Loja de Teste", lingua: "pt", fuso: "Europe/Lisbon" };

interface Ficha {
  id: string;
  nome: string;
  versao: number;
  actualizado_em: string;
}
interface Pagina<T> {
  dados: T[];
  total: number;
  ha_mais: boolean;
  cursor_seguinte: string | null;
}

describe.skipIf(URL_BASE === undefined)(
  "API do Catálogo: filtros da procura de artigos",
  () => {
    let base: BaseDeTeste;
    let app: ReturnType<typeof criarApp>;

    const pedir = (
      segredo: string,
      metodo: "POST" | "PUT" | "PATCH" | "GET",
      url: string,
      corpo?: unknown,
    ) =>
      app.inject({
        method: metodo,
        url,
        headers: {
          authorization: `Bearer ${segredo}`,
          ...(metodo === "GET" ? {} : { "idempotency-key": randomUUID() }),
          ...(corpo === undefined
            ? {}
            : { "content-type": "application/json" }),
        },
        ...(corpo === undefined ? {} : { payload: JSON.stringify(corpo) }),
      });

    async function comerciante() {
      const c = await registarComerciante(base.api, NOVO);
      const dono: Kysely<BaseDados> = base.dono;
      const { segredo } = await criarChave(dono, c, {
        tipo: "servidor",
        criadaPor: "operador:teste",
        nome: "Escrita",
        ambitos: ["catalog:read", "catalog:write"],
      });
      const ap = (
        metodo: "POST" | "PUT" | "PATCH" | "GET",
        url: string,
        corpo?: unknown,
      ) => pedir(segredo, metodo, url, corpo);
      const artigo = async (nome: string, descricao: string | null = null) => {
        const r = await ap("POST", "/products", {
          tipo: "fisico",
          nome,
          descricao,
          categoria_fiscal: "normal",
          variantes: [
            { sku: `F-${randomUUID()}`, unidade_de_venda: "unidade" },
          ],
        });
        expect(r.statusCode).toBe(201);
        return r.json<Ficha>();
      };
      const procurar = async (q: string) => {
        const r = await ap("GET", `/products?${q}`);
        return r;
      };
      const ids = async (q: string) => {
        const r = await procurar(q);
        expect(r.statusCode, r.body).toBe(200);
        return r.json<Pagina<Ficha>>().dados.map((f) => f.id);
      };
      return { c, segredo, ap, artigo, procurar, ids };
    }

    beforeAll(async () => {
      base = await criarBaseDeTeste(URL_BASE ?? "");
      app = criarApp({ logger: false }, undefined, base.api);
    }, 60_000);

    afterAll(async () => {
      await app.close();
      await base.fechar();
    });

    it("por categoria: só os artigos nela, não os das subcategorias; uma que não existe dá 404", async () => {
      const { ap, artigo, ids, procurar } = await comerciante();
      const unhas = (
        await ap("POST", "/categories", {
          nome: "Unhas",
          endereco_amigavel: "unhas",
        })
      ).json<{ id: string }>();
      const gel = (
        await ap("POST", "/categories", {
          nome: "Gel",
          endereco_amigavel: "gel",
          pai: unhas.id,
        })
      ).json<{ id: string }>();
      const a = await artigo("Lima");
      const b = await artigo("Gel UV");
      await artigo("Sem categoria");
      await ap("PUT", `/products/${a.id}/categories`, {
        versao: a.versao,
        categorias: [unhas.id],
      });
      await ap("PUT", `/products/${b.id}/categories`, {
        versao: b.versao,
        categorias: [gel.id],
      });
      expect(await ids(`categoria=${unhas.id}`)).toEqual([a.id]);
      expect(await ids(`categoria=${gel.id}`)).toEqual([b.id]);
      // Junta-se aos outros filtros.
      expect(await ids(`categoria=${unhas.id}&texto=gel`)).toEqual([]);
      expect(await ids(`categoria=${unhas.id}&estado=rascunho`)).toEqual([
        a.id,
      ]);
      const inexistente = await procurar(`categoria=cat_${randomUUID()}`);
      expect(inexistente.statusCode).toBe(404);
      expect(inexistente.json()).toMatchObject({ codigo: "catalog.not_found" });
      // A categoria de outro comerciante também não existe.
      const outro = await comerciante();
      const alheia = await outro.procurar(`categoria=${unhas.id}`);
      expect(alheia.statusCode).toBe(404);
      const mau = await procurar("categoria=prd_1");
      expect(mau.statusCode).toBe(400);
      expect(mau.json()).toMatchObject({ codigo: "request.invalid" });
    });

    it("com tradução em falta numa língua: o nome ou a descrição em falta ou desactualizados, como a fila; a língua de origem dá 422", async () => {
      const { ap, artigo, ids, procurar } = await comerciante();
      const traduzir = (
        id: string,
        campo: string,
        texto: string,
        visto: string,
      ) =>
        ap("PUT", `/translations/${id}/${campo}/es`, {
          texto,
          original_visto: visto,
        });
      // Completo: nome e descrição traduzidos.
      const completo = await artigo("Lima", "Lima de unhas");
      await traduzir(completo.id, "nome", "Lima ES", "Lima");
      await traduzir(completo.id, "descricao", "Lima de uñas", "Lima de unhas");
      // Sem nenhuma tradução.
      const nada = await artigo("Gel");
      // Nome traduzido e sem descrição (nula) ou só com espaços: nada falta.
      const semDescricao = await artigo("Base");
      await traduzir(semDescricao.id, "nome", "Base ES", "Base");
      const espacos = await artigo("Top", "   ");
      await traduzir(espacos.id, "nome", "Top ES", "Top");
      // Só a descrição em falta.
      const soDescricao = await artigo("Verniz", "Verniz rosa");
      await traduzir(soDescricao.id, "nome", "Barniz", "Verniz");
      // Traduzido e depois o nome mudou: desactualizado.
      const mudou = await artigo("Primer");
      await traduzir(mudou.id, "nome", "Primer ES", "Primer");
      const p = await ap("PATCH", `/products/${mudou.id}`, {
        versao: mudou.versao,
        nome: "Primer novo",
      });
      expect(p.statusCode).toBe(200);
      const emFalta = await ids("traducao_em_falta=es");
      expect([...emFalta].sort()).toEqual(
        [nada.id, soDescricao.id, mudou.id].sort(),
      );
      const r = await procurar("traducao_em_falta=es");
      expect(r.json<Pagina<Ficha>>().total).toBe(3);
      // Noutra língua sem nada traduzido: todos os que têm texto.
      expect(await ids("traducao_em_falta=fr")).toHaveLength(6);
      // Por páginas, o filtro mantém-se.
      const p1 = (await procurar("traducao_em_falta=es&limite=2")).json<
        Pagina<Ficha>
      >();
      expect(p1).toMatchObject({ total: 3, ha_mais: true });
      const p2 = (
        await procurar(
          `traducao_em_falta=es&limite=2&cursor=${p1.cursor_seguinte ?? ""}`,
        )
      ).json<Pagina<Ficha>>();
      expect(p2).toMatchObject({ total: 3, ha_mais: false });
      expect([...p1.dados, ...p2.dados].map((f) => f.id).sort()).toEqual(
        [...emFalta].sort(),
      );
      // A língua de origem não se traduz.
      const origem = await procurar("traducao_em_falta=pt");
      expect(origem.statusCode).toBe(422);
      expect(origem.json()).toMatchObject({
        codigo: "catalog.translation_same_language",
      });
      for (const q of ["traducao_em_falta=ES", "traducao_em_falta=esp"]) {
        const mau = await procurar(q);
        expect(mau.statusCode, q).toBe(400);
        expect(mau.json(), q).toMatchObject({ codigo: "request.invalid" });
      }
    });

    it("alterados desde um instante: inclusive ao microssegundo, com o fuso; um artigo alterado volta a entrar", async () => {
      const { ap, artigo, ids, procurar } = await comerciante();
      const antigo = await artigo("Antigo");
      const novo = await artigo("Novo");
      // O instante como a base o guarda (ao microssegundo), sem aritmética
      // sobre o texto (revisão do #173, P3-1).
      const marca = async (id: string, expressao: string) => {
        const { rows } = await base.dono.executeQuery<{ m: string }>(
          sql`select ${sql.raw(expressao)} as m from artigo where id = ${id.slice("prd_".length)}`.compile(
            base.dono,
          ),
        );
        return encodeURIComponent(rows[0]?.m ?? "");
      };
      const utc = (mais: string) =>
        `to_char((actualizado_em ${mais}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
      const exacto = await marca(novo.id, utc(""));
      expect(decodeURIComponent(exacto)).toMatch(/\.\d{6}Z$/);
      // O próprio instante conta (inclusive); um microssegundo depois, não.
      expect(await ids(`actualizado_desde=${exacto}`)).toEqual([novo.id]);
      expect(
        await ids(
          `actualizado_desde=${await marca(novo.id, utc("+ interval '1 microsecond'"))}`,
        ),
      ).toEqual([]);
      // O mesmo instante noutro fuso.
      const menosUmaHora = await marca(
        novo.id,
        `to_char((actualizado_em - interval '1 hour') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '-01:00'`,
      );
      expect(await ids(`actualizado_desde=${menosUmaHora}`)).toEqual([novo.id]);
      // Alterar o antigo: passa a entrar.
      const p = await ap("PATCH", `/products/${antigo.id}`, {
        versao: antigo.versao,
        nome: "Antigo alterado",
      });
      expect(p.statusCode).toBe(200);
      expect(await ids(`actualizado_desde=${exacto}`)).toEqual([
        antigo.id,
        novo.id,
      ]);
      for (const q of [
        "actualizado_desde=ontem",
        "actualizado_desde=2026-10-08",
        "actualizado_desde=2026-10-08T00:00:00",
        "actualizado_desde=2026-13-08T00:00:00Z",
        "actualizado_desde=0000-01-01T00:00:00Z",
        "actualizado_desde=2026-10-08T25:00:00Z",
        "actualizado_desde=2026-10-08T00:00:00+25:00",
      ]) {
        const mau = await procurar(q);
        expect(mau.statusCode, q).toBe(400);
        expect(mau.json(), q).toMatchObject({ codigo: "request.invalid" });
      }
    });

    it("o que muda a data do artigo: alterar, classificar e as categorias; não as variantes, as opções nem as traduções", async () => {
      const { ap, artigo, ids } = await comerciante();
      const f = await artigo("Gel", "Gel UV");
      const cat = (
        await ap("POST", "/categories", { nome: "C", endereco_amigavel: "c" })
      ).json<{ id: string }>();
      // A marca: um microssegundo depois da data actual do artigo.
      const marca = async () => {
        const { rows } = await base.dono.executeQuery<{ m: string }>(
          sql`select to_char((actualizado_em + interval '1 microsecond') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as m from artigo where id = ${f.id.slice("prd_".length)}`.compile(
            base.dono,
          ),
        );
        return encodeURIComponent(rows[0]?.m ?? "");
      };
      const versao = async () =>
        (await ap("GET", `/products/${f.id}`)).json<Ficha>().versao;
      const muda = async (
        descricao: string,
        fazer: () => Promise<{ statusCode: number; body: string }>,
      ) => {
        const m = await marca();
        const r = await fazer();
        expect(r.statusCode, `${descricao}: ${r.body}`).toBeLessThan(300);
        expect(await ids(`actualizado_desde=${m}`), descricao).toEqual([f.id]);
      };
      const naoMuda = async (
        descricao: string,
        fazer: () => Promise<{ statusCode: number }>,
      ) => {
        const m = await marca();
        expect((await fazer()).statusCode, descricao).toBeLessThan(300);
        expect(await ids(`actualizado_desde=${m}`), descricao).toEqual([]);
      };
      await naoMuda("criar uma variante", () =>
        ap("POST", `/products/${f.id}/variants`, {
          sku: `V-${randomUUID()}`,
          unidade_de_venda: "unidade",
        }),
      );
      await naoMuda("criar uma opção", () =>
        ap("POST", `/products/${f.id}/options`, {
          nome: "Cor",
          valores: ["Rosa"],
        }),
      );
      await naoMuda("traduzir", () =>
        ap("PUT", `/translations/${f.id}/nome/es`, {
          texto: "Gel ES",
          original_visto: "Gel",
        }),
      );
      await muda("as categorias", async () =>
        ap("PUT", `/products/${f.id}/categories`, {
          versao: await versao(),
          categorias: [cat.id],
        }),
      );
      await muda("classificar", async () =>
        ap("PUT", `/products/${f.id}/classification`, {
          versao: await versao(),
          familias: ["retalho_geral"],
          natureza_consumidor: "bem",
        }),
      );
      await muda("alterar o nome", async () =>
        ap("PATCH", `/products/${f.id}`, {
          versao: await versao(),
          nome: "Gel novo",
        }),
      );
    });

    it("os três filtros juntos, por páginas; e as listas só têm os artigos do comerciante, com os dos outros na base", async () => {
      const { ap, artigo, ids, procurar } = await comerciante();
      const cat = (
        await ap("POST", "/categories", { nome: "X", endereco_amigavel: "x" })
      ).json<{ id: string }>();
      const comCat = async (nome: string) => {
        const f = await artigo(nome);
        await ap("PUT", `/products/${f.id}/categories`, {
          versao: f.versao,
          categorias: [cat.id],
        });
        return f;
      };
      const a = await comCat("A");
      const b = await comCat("B");
      const c = await comCat("C");
      const traduzido = await comCat("D");
      await ap("PUT", `/translations/${traduzido.id}/nome/es`, {
        texto: "D ES",
        original_visto: "D",
      });
      await artigo("Fora da categoria");
      // Outro comerciante, com artigos que passariam os mesmos filtros.
      const outro = await comerciante();
      await outro.artigo("Alheio");
      const filtros = `categoria=${cat.id}&traducao_em_falta=es&actualizado_desde=2000-01-01T00:00:00Z`;
      const vistos: string[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < 6; i++) {
        const q: string =
          cursor === null
            ? `${filtros}&limite=1`
            : `${filtros}&limite=1&cursor=${cursor}`;
        const pagina = (await procurar(q)).json<Pagina<Ficha>>();
        expect(pagina.total).toBe(3);
        vistos.push(...pagina.dados.map((f) => f.id));
        cursor = pagina.cursor_seguinte;
        if (!pagina.ha_mais) break;
      }
      expect(cursor).toBeNull();
      expect(vistos).toEqual([a.id, b.id, c.id]);
      // Só a categoria, por páginas: os quatro.
      const p1 = (await procurar(`categoria=${cat.id}&limite=3`)).json<
        Pagina<Ficha>
      >();
      expect(p1).toMatchObject({ total: 4, ha_mais: true });
      // Só a data, desde sempre: os cinco deste comerciante, nenhum do outro.
      expect(await ids("actualizado_desde=2000-01-01T00:00:00Z")).toHaveLength(
        5,
      );
      expect(await outro.ids("traducao_em_falta=es")).toHaveLength(1);
    });
  },
);
