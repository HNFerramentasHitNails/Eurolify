import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
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

// A API de Administração do Catálogo, parte 6: as categorias e as colecções
// (docs/14 §3.6, §3.7 e §7.1). Contra o PostgreSQL 18 verdadeiro, pela app
// inteira. Ex.: «Unhas» com «Unhas de gel» dentro; a colecção «Novidades».

const NOVO = { nome: "Loja de Teste", lingua: "pt", fuso: "Europe/Lisbon" };

interface Categoria {
  id: string;
  nome: string;
  endereco_amigavel: string;
  pai: string | null;
  posicao: number;
  estado: string;
  versao: number;
}
interface Colecao {
  id: string;
  nome: string;
  descricao: string | null;
  endereco_amigavel: string;
  estado: string;
  total_artigos: number;
  versao: number;
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
}
interface CategoriasDoArtigo {
  artigo: string;
  versao: number;
  categorias: Categoria[];
}

describe.skipIf(URL_BASE === undefined)(
  "API do Catálogo: categorias e colecções",
  () => {
    let base: BaseDeTeste;
    let app: ReturnType<typeof criarApp>;
    let escrita: string;
    let leitura: string;
    let publicacao: string;
    let escritaDeB: string;

    const pedir = (
      metodo: "POST" | "PUT" | "PATCH" | "GET" | "DELETE",
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

    /** Um comerciante novo com uma chave de escrita (listas sem ruído). */
    async function comercianteNovo() {
      const c = await registarComerciante(base.api, NOVO);
      const dono: Kysely<BaseDados> = base.dono;
      return (
        await criarChave(dono, c, {
          tipo: "servidor",
          criadaPor: "operador:teste",
          nome: "Escrita",
          ambitos: ["catalog:read", "catalog:write"],
        })
      ).segredo;
    }

    async function categoria(
      nome: string,
      endereco: string,
      extra: object = {},
      segredo = escrita,
    ) {
      const r = await pedir(
        "POST",
        "/categories",
        { nome, endereco_amigavel: endereco, ...extra },
        { segredo },
      );
      expect(r.statusCode, r.body).toBe(201);
      return r.json<Categoria>();
    }

    async function artigo(nome: string, sku: string, segredo = escrita) {
      const r = await pedir(
        "POST",
        "/products",
        {
          tipo: "fisico",
          nome,
          categoria_fiscal: "normal",
          variantes: [{ sku, unidade_de_venda: "unidade" }],
        },
        { segredo },
      );
      expect(r.statusCode).toBe(201);
      return r.json<Ficha>();
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
      publicacao = await chaveDe(a, "Publicação", ["catalog:publish"]);
      escritaDeB = await chaveDe(b, "Escrita de B", [
        "catalog:read",
        "catalog:write",
      ]);
    }, 60_000);

    afterAll(async () => {
      await app.close();
      await base.fechar();
    });

    it("cria, lê, altera e move categorias; a árvore não tem ciclos", async () => {
      const unhas = await categoria("Unhas", "unhas");
      expect(unhas).toMatchObject({
        nome: "Unhas",
        endereco_amigavel: "unhas",
        pai: null,
        posicao: 0,
        estado: "activa",
        versao: 1,
      });
      expect(unhas.id).toMatch(/^cat_/);
      const r = await pedir("POST", "/categories", {
        nome: "Unhas de gel",
        endereco_amigavel: "unhas-de-gel",
        pai: unhas.id,
        posicao: 2,
      });
      expect(r.headers.location).toBe(`/categories/${r.json<Categoria>().id}`);
      const gel = r.json<Categoria>();
      expect(gel).toMatchObject({ pai: unhas.id, posicao: 2 });
      const lida = await pedir("GET", `/categories/${gel.id}`, undefined, {
        segredo: leitura,
      });
      expect(lida.json()).toEqual(gel);
      // Alterar: a versão sobe; o mesmo valor não a sobe; a antiga dá 409.
      const p = await pedir("PATCH", `/categories/${gel.id}`, {
        versao: 1,
        nome: "Gel",
      });
      expect(p.json()).toMatchObject({ nome: "Gel", versao: 2 });
      const igual = await pedir("PATCH", `/categories/${gel.id}`, {
        versao: 2,
        nome: "Gel",
      });
      expect(igual.json()).toMatchObject({ versao: 2 });
      const velha = await pedir("PATCH", `/categories/${gel.id}`, {
        versao: 1,
        nome: "Outro",
      });
      expect(velha.statusCode).toBe(409);
      expect(velha.json()).toMatchObject({
        codigo: "catalog.version_conflict",
      });
      // Mover o pai para dentro do filho: ciclo.
      const ciclo = await pedir("POST", `/categories/${unhas.id}/move`, {
        versao: 1,
        pai: gel.id,
      });
      expect(ciclo.statusCode).toBe(422);
      expect(ciclo.json()).toMatchObject({ codigo: "catalog.category_cycle" });
      const propria = await pedir("POST", `/categories/${unhas.id}/move`, {
        versao: 1,
        pai: unhas.id,
      });
      expect(propria.json()).toMatchObject({
        codigo: "catalog.category_cycle",
      });
      // Para a raiz.
      const raiz = await pedir("POST", `/categories/${gel.id}/move`, {
        versao: 2,
        pai: null,
      });
      expect(raiz.json()).toMatchObject({ pai: null, versao: 3 });
      // Para dentro de outra que não existe: 404.
      const semPai = await pedir("POST", `/categories/${gel.id}/move`, {
        versao: 3,
        pai: `cat_${randomUUID()}`,
      });
      expect(semPai.statusCode).toBe(404);
    });

    it("arquivar de baixo para cima e repor de cima para baixo; pedir o estado em que já está não muda nada", async () => {
      const pes = await categoria("Pés", "pes");
      const filha = await categoria("Pedicure", "pedicure", { pai: pes.id });
      const comFilha = await pedir("POST", `/categories/${pes.id}/archive`, {
        versao: 1,
      });
      expect(comFilha.statusCode).toBe(409);
      expect(comFilha.json()).toMatchObject({
        codigo: "catalog.category_has_children",
      });
      const f = await pedir("POST", `/categories/${filha.id}/archive`, {
        versao: 1,
      });
      expect(f.json()).toMatchObject({ estado: "arquivada", versao: 2 });
      const outraVez = await pedir("POST", `/categories/${filha.id}/archive`, {
        versao: 2,
      });
      expect(outraVez.json()).toMatchObject({
        estado: "arquivada",
        versao: 2,
      });
      const p = await pedir("POST", `/categories/${pes.id}/archive`, {
        versao: 1,
      });
      expect(p.json()).toMatchObject({ estado: "arquivada" });
      // Repor a filha dentro de uma arquivada: recusado.
      const dentro = await pedir("POST", `/categories/${filha.id}/restore`, {
        versao: 2,
      });
      expect(dentro.statusCode).toBe(422);
      expect(dentro.json()).toMatchObject({
        codigo: "catalog.category_archived",
      });
      // Criar dentro de uma arquivada também.
      const nova = await pedir("POST", "/categories", {
        nome: "Outra",
        endereco_amigavel: "outra-pe",
        pai: pes.id,
      });
      expect(nova.json()).toMatchObject({
        codigo: "catalog.category_archived",
      });
      await pedir("POST", `/categories/${pes.id}/restore`, { versao: 2 });
      const reposta = await pedir("POST", `/categories/${filha.id}/restore`, {
        versao: 2,
      });
      expect(reposta.json()).toMatchObject({ estado: "activa", versao: 3 });
    });

    it("a lista, por páginas e por estado, e os endereços: formato, repetidos, e categorias e colecções à parte", async () => {
      const segredo = await comercianteNovo();
      const c1 = await categoria("Um", "um", {}, segredo);
      const c2 = await categoria("Dois", "dois", {}, segredo);
      const c3 = await categoria("Três", "tres", {}, segredo);
      await pedir(
        "POST",
        `/categories/${c2.id}/archive`,
        { versao: 1 },
        {
          segredo,
        },
      );
      const lista = async (q: string) =>
        (await pedir("GET", `/categories?${q}`, undefined, { segredo })).json<
          Pagina<Categoria>
        >();
      const toda = await lista("");
      expect(toda.total).toBe(3);
      expect(toda.dados.map((c) => c.id)).toEqual([c1.id, c2.id, c3.id]);
      expect((await lista("estado=arquivada")).dados.map((c) => c.id)).toEqual([
        c2.id,
      ]);
      expect((await lista("estado=activa")).total).toBe(2);
      const vistos: string[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < 5; i++) {
        const q: string =
          cursor === null ? "limite=1" : `limite=1&cursor=${cursor}`;
        const p = await lista(q);
        expect(p.total).toBe(3);
        vistos.push(...p.dados.map((c) => c.id));
        cursor = p.cursor_seguinte;
        if (!p.ha_mais) break;
      }
      expect(vistos).toEqual([c1.id, c2.id, c3.id]);
      expect(cursor).toBeNull();
      // O endereço: formato (contrato), repetido (base), também arquivado.
      for (const endereco of ["Com-Maiusculas", "acentuação", "a--b", ""]) {
        const r = await pedir(
          "POST",
          "/categories",
          { nome: "X", endereco_amigavel: endereco },
          { segredo },
        );
        expect(r.statusCode, endereco).toBe(400);
        expect(r.json(), endereco).toMatchObject({ codigo: "request.invalid" });
      }
      const repetido = await pedir(
        "POST",
        "/categories",
        { nome: "Outro dois", endereco_amigavel: "dois" },
        { segredo },
      );
      expect(repetido.statusCode).toBe(409);
      expect(repetido.json()).toMatchObject({
        codigo: "catalog.slug_duplicate",
      });
      const mudar = await pedir(
        "PATCH",
        `/categories/${c1.id}`,
        { versao: 1, endereco_amigavel: "tres" },
        { segredo },
      );
      expect(mudar.json()).toMatchObject({ codigo: "catalog.slug_duplicate" });
      // Uma colecção pode ter o endereço de uma categoria.
      const col = await pedir(
        "POST",
        "/collections",
        { nome: "Um", endereco_amigavel: "um" },
        { segredo },
      );
      expect(col.statusCode).toBe(201);
    });

    it("as categorias de um artigo: substituir com a versão, nova arquivada recusada, arquivada que já tinha fica, repetida e alheia", async () => {
      const segredo = await comercianteNovo();
      const a = await categoria("A", "a", {}, segredo);
      const b = await categoria("B", "b", {}, segredo);
      const f = await artigo("Lima", "CAT-1", segredo);
      const por = (versao: number, categorias: string[]) =>
        pedir(
          "PUT",
          `/products/${f.id}/categories`,
          { versao, categorias },
          { segredo },
        );
      const r = await por(f.versao, [a.id, b.id]);
      expect(r.statusCode).toBe(200);
      const dep = r.json<CategoriasDoArtigo>();
      expect(dep.versao).toBe(f.versao + 1);
      expect(dep.categorias.map((c) => c.id)).toEqual([a.id, b.id]);
      // A mesma lista: a versão não sobe.
      expect((await por(dep.versao, [b.id, a.id])).json()).toMatchObject({
        versao: dep.versao,
      });
      // Versão antiga: 409.
      const velha = await por(f.versao, [a.id]);
      expect(velha.json()).toMatchObject({
        codigo: "catalog.version_conflict",
      });
      // A arquivada que já tinha fica; uma nova arquivada é recusada.
      await pedir(
        "POST",
        `/categories/${b.id}/archive`,
        { versao: 1 },
        {
          segredo,
        },
      );
      const fica = await por(dep.versao, [b.id]);
      expect(fica.statusCode).toBe(200);
      expect(fica.json<CategoriasDoArtigo>().categorias).toMatchObject([
        { id: b.id, estado: "arquivada" },
      ]);
      const v = fica.json<CategoriasDoArtigo>().versao;
      const c = await categoria("C", "c", {}, segredo);
      await pedir(
        "POST",
        `/categories/${c.id}/archive`,
        { versao: 1 },
        {
          segredo,
        },
      );
      const nova = await por(v, [b.id, c.id]);
      expect(nova.statusCode).toBe(422);
      expect(nova.json()).toMatchObject({
        codigo: "catalog.category_archived",
      });
      const repetida = await por(v, [b.id, b.id]);
      expect(repetida.statusCode).toBe(422);
      expect(repetida.json()).toMatchObject({
        codigo: "catalog.category_duplicate",
      });
      // Uma categoria de outro comerciante não existe.
      const alheia = await categoria("Alheia", "alheia");
      const outra = await por(v, [alheia.id]);
      expect(outra.statusCode).toBe(404);
      // Mais de 100: o contrato recusa.
      const muitas = await por(
        v,
        Array.from({ length: 101 }, () => `cat_${randomUUID()}`),
      );
      expect(muitas.json()).toMatchObject({ codigo: "request.invalid" });
      // Ler: com a versão do artigo.
      const lidas = (
        await pedir("GET", `/products/${f.id}/categories`, undefined, {
          segredo,
        })
      ).json<CategoriasDoArtigo>();
      expect(lidas).toMatchObject({ artigo: f.id, versao: v });
      expect(lidas.categorias.map((x) => x.id)).toEqual([b.id]);
      // Vazia: fica sem categorias.
      expect((await por(v, [])).json<CategoriasDoArtigo>().categorias).toEqual(
        [],
      );
    });

    it("colecções: criar, alterar, a lista de artigos pela ordem, por páginas, e mudar a lista de uma arquivada", async () => {
      const segredo = await comercianteNovo();
      const r = await pedir(
        "POST",
        "/collections",
        {
          nome: "Novidades",
          endereco_amigavel: "novidades",
          descricao: "O que chegou",
        },
        { segredo },
      );
      expect(r.statusCode).toBe(201);
      const col = r.json<Colecao>();
      expect(r.headers.location).toBe(`/collections/${col.id}`);
      expect(col).toMatchObject({
        nome: "Novidades",
        descricao: "O que chegou",
        estado: "activa",
        total_artigos: 0,
        versao: 1,
      });
      expect(col.id).toMatch(/^col_/);
      const sem = await pedir(
        "PATCH",
        `/collections/${col.id}`,
        { versao: 1, descricao: null },
        { segredo },
      );
      expect(sem.json()).toMatchObject({ descricao: null, versao: 2 });
      const f1 = await artigo("Um", "COL-1", segredo);
      const f2 = await artigo("Dois", "COL-2", segredo);
      const f3 = await artigo("Três", "COL-3", segredo);
      const por = (versao: number, artigos: string[]) =>
        pedir(
          "PUT",
          `/collections/${col.id}/products`,
          { versao, artigos },
          { segredo },
        );
      const p = await por(2, [f3.id, f1.id, f2.id]);
      expect(p.json()).toMatchObject({ total_artigos: 3, versao: 3 });
      // A mesma lista e ordem: a versão não sobe; outra ordem sobe.
      expect((await por(3, [f3.id, f1.id, f2.id])).json()).toMatchObject({
        versao: 3,
      });
      expect((await por(3, [f1.id, f3.id, f2.id])).json()).toMatchObject({
        versao: 4,
      });
      // Por páginas, pela ordem da colecção.
      const vistos: string[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < 5; i++) {
        const q: string =
          cursor === null ? "limite=2" : `limite=2&cursor=${cursor}`;
        const pg = (
          await pedir(
            "GET",
            `/collections/${col.id}/products?${q}`,
            undefined,
            {
              segredo,
            },
          )
        ).json<Pagina<{ artigo: string; posicao: number; estado: string }>>();
        expect(pg.total).toBe(3);
        vistos.push(...pg.dados.map((d) => d.artigo));
        cursor = pg.cursor_seguinte;
        if (!pg.ha_mais) break;
      }
      expect(vistos).toEqual([f1.id, f3.id, f2.id]);
      const repetido = await por(4, [f1.id, f1.id]);
      expect(repetido.statusCode).toBe(422);
      expect(repetido.json()).toMatchObject({
        codigo: "catalog.collection_product_duplicate",
      });
      const inexistente = await por(4, [`prd_${randomUUID()}`]);
      expect(inexistente.statusCode).toBe(404);
      // Arquivada: a lista ainda se muda; repor.
      const arq = await pedir(
        "POST",
        `/collections/${col.id}/archive`,
        { versao: 4 },
        { segredo },
      );
      expect(arq.json()).toMatchObject({ estado: "arquivada", versao: 5 });
      expect((await por(5, [f2.id])).json()).toMatchObject({
        total_artigos: 1,
        versao: 6,
      });
      const rep = await pedir(
        "POST",
        `/collections/${col.id}/restore`,
        { versao: 6 },
        { segredo },
      );
      expect(rep.json()).toMatchObject({ estado: "activa", total_artigos: 1 });
      // Outra colecção, com outros artigos: cada uma conta os seus.
      const outono = (
        await pedir(
          "POST",
          "/collections",
          { nome: "Outono", endereco_amigavel: "outono" },
          { segredo },
        )
      ).json<Colecao>();
      await pedir(
        "PUT",
        `/collections/${outono.id}/products`,
        { versao: 1, artigos: [f1.id, f3.id] },
        { segredo },
      );
      expect(
        (
          await pedir("GET", `/collections/${col.id}`, undefined, { segredo })
        ).json<Colecao>().total_artigos,
      ).toBe(1);
      // A lista de colecções, com o total de artigos de cada uma.
      const lista = (
        await pedir("GET", "/collections", undefined, { segredo })
      ).json<Pagina<Colecao>>();
      expect(lista).toMatchObject({ total: 2, ha_mais: false });
      expect(lista.dados.map((d) => [d.id, d.total_artigos])).toEqual([
        [col.id, 1],
        [outono.id, 2],
      ]);
      expect(
        (
          await pedir("GET", "/collections?estado=arquivada", undefined, {
            segredo,
          })
        ).json<Pagina<Colecao>>().total,
      ).toBe(0);
      // Apagar o rascunho de um artigo tira-o da colecção.
      await pedir("DELETE", `/products/${f2.id}`, undefined, { segredo });
      expect(
        (
          await pedir("GET", `/collections/${col.id}`, undefined, { segredo })
        ).json<Colecao>().total_artigos,
      ).toBe(0);
    });

    it("a idempotência: a mesma chave devolve a mesma categoria sem criar outra; outro corpo dá key_reused; sem chave dá 400", async () => {
      const segredo = await comercianteNovo();
      const chave = randomUUID();
      const corpo = { nome: "Uma", endereco_amigavel: "uma" };
      const r1 = await pedir("POST", "/categories", corpo, { segredo, chave });
      const r2 = await pedir("POST", "/categories", corpo, { segredo, chave });
      expect(r2.statusCode).toBe(201);
      expect(r2.json()).toEqual(r1.json());
      expect(r2.headers.location).toBe(r1.headers.location);
      expect(
        (await pedir("GET", "/categories", undefined, { segredo })).json<
          Pagina<Categoria>
        >().total,
      ).toBe(1);
      const outro = await pedir(
        "POST",
        "/categories",
        { ...corpo, nome: "Outra" },
        { segredo, chave },
      );
      expect(outro.json()).toMatchObject({ codigo: "idempotency.key_reused" });
      for (const [metodo, url, c] of [
        ["POST", "/categories", corpo],
        ["POST", "/collections", corpo],
      ] as const) {
        const sem = await pedir(metodo, url, c, { segredo, chave: null });
        expect(sem.statusCode).toBe(400);
        expect(sem.json()).toMatchObject({
          codigo: "idempotency.key_required",
        });
      }
    });

    it("os pedidos estranhos dão 400 com o código", async () => {
      const cat = await categoria("Estranha", "estranha");
      for (const [metodo, url, corpo] of [
        ["GET", "/categories?estado=outro", undefined],
        ["GET", "/categories?cursor=!!", undefined],
        [
          "GET",
          `/categories?cursor=${Buffer.from("x").toString("base64url")}`,
          undefined,
        ],
        ["GET", `/categories/prd_${randomUUID()}`, undefined],
        ["GET", "/collections?limite=101", undefined],
        ["POST", "/categories", { nome: "X", endereco_amigavel: "x", cor: 1 }],
        ["POST", "/categories", { nome: "   ", endereco_amigavel: "x" }],
        [
          "POST",
          "/categories",
          { nome: "X", endereco_amigavel: "a".repeat(101) },
        ],
        [
          "POST",
          "/categories",
          { nome: "X", endereco_amigavel: "x", posicao: -1 },
        ],
        ["PATCH", `/categories/${cat.id}`, { nome: "Sem versão" }],
        ["POST", `/categories/${cat.id}/move`, { versao: 1 }],
        ["POST", `/categories/${cat.id}/move`, { versao: 1, pai: "raiz" }],
        [
          "POST",
          "/collections",
          { nome: "X", endereco_amigavel: "x", descricao: "a".repeat(10001) },
        ],
      ] as const) {
        const r = await pedir(metodo, url, corpo);
        expect(r.statusCode, `${metodo} ${url}`).toBe(400);
        expect(r.json(), `${metodo} ${url}`).toMatchObject({
          codigo: "request.invalid",
        });
      }
    });

    it("de outro comerciante: 404 em todas, nada muda, e as listas não o mostram; os âmbitos", async () => {
      const cat = await categoria("Minha", "minha");
      const col = (
        await pedir("POST", "/collections", {
          nome: "Minha",
          endereco_amigavel: "minha",
        })
      ).json<Colecao>();
      const f = await artigo("Meu", "CAT-B");
      for (const [metodo, url, corpo] of [
        ["GET", `/categories/${cat.id}`, undefined],
        ["PATCH", `/categories/${cat.id}`, { versao: 1, nome: "B" }],
        ["POST", `/categories/${cat.id}/move`, { versao: 1, pai: null }],
        ["POST", `/categories/${cat.id}/archive`, { versao: 1 }],
        ["GET", `/collections/${col.id}`, undefined],
        ["GET", `/collections/${col.id}/products`, undefined],
        ["PATCH", `/collections/${col.id}`, { versao: 1, nome: "B" }],
        ["POST", `/collections/${col.id}/archive`, { versao: 1 }],
        ["PUT", `/collections/${col.id}/products`, { versao: 1, artigos: [] }],
        ["GET", `/products/${f.id}/categories`, undefined],
        [
          "PUT",
          `/products/${f.id}/categories`,
          { versao: f.versao, categorias: [] },
        ],
      ] as const) {
        const r = await pedir(metodo, url, corpo, { segredo: escritaDeB });
        expect(r.statusCode, `${metodo} ${url}`).toBe(404);
        expect(r.json(), `${metodo} ${url}`).toMatchObject({
          codigo: "catalog.not_found",
        });
      }
      // Criar dentro da categoria de outro: «não existe».
      const dentro = await pedir(
        "POST",
        "/categories",
        { nome: "B", endereco_amigavel: "b-dentro", pai: cat.id },
        { segredo: escritaDeB },
      );
      expect(dentro.statusCode).toBe(404);
      // Nada mudou.
      expect(
        (await pedir("GET", `/categories/${cat.id}`)).json<Categoria>(),
      ).toMatchObject({ nome: "Minha", estado: "activa", versao: 1 });
      expect(
        (await pedir("GET", `/collections/${col.id}`)).json<Colecao>(),
      ).toMatchObject({ nome: "Minha", estado: "activa", versao: 1 });
      // As listas de B não mostram as de A.
      for (const url of ["/categories", "/collections"]) {
        const lista = (
          await pedir("GET", url, undefined, { segredo: escritaDeB })
        ).json<Pagina<{ id: string }>>();
        expect(lista.dados.map((d) => d.id)).not.toContain(
          url === "/categories" ? cat.id : col.id,
        );
      }
      // Os âmbitos: escrever pede catalog:write; ler, catalog:read.
      for (const [metodo, url, corpo] of [
        ["POST", "/categories", { nome: "L", endereco_amigavel: "l" }],
        ["PATCH", `/categories/${cat.id}`, { versao: 1, nome: "L" }],
        ["POST", `/categories/${cat.id}/move`, { versao: 1, pai: null }],
        ["POST", `/categories/${cat.id}/archive`, { versao: 1 }],
        ["POST", `/categories/${cat.id}/restore`, { versao: 1 }],
        ["POST", "/collections", { nome: "L", endereco_amigavel: "l" }],
        ["PATCH", `/collections/${col.id}`, { versao: 1, nome: "L" }],
        ["POST", `/collections/${col.id}/archive`, { versao: 1 }],
        ["POST", `/collections/${col.id}/restore`, { versao: 1 }],
        ["PUT", `/collections/${col.id}/products`, { versao: 1, artigos: [] }],
        [
          "PUT",
          `/products/${f.id}/categories`,
          { versao: f.versao, categorias: [] },
        ],
      ] as const) {
        const r = await pedir(metodo, url, corpo, { segredo: leitura });
        expect(r.statusCode, `${metodo} ${url}`).toBe(403);
      }
      for (const url of [
        "/categories",
        `/categories/${cat.id}`,
        "/collections",
        `/collections/${col.id}`,
        `/collections/${col.id}/products`,
        `/products/${f.id}/categories`,
      ]) {
        const r = await pedir("GET", url, undefined, { segredo: publicacao });
        expect(r.statusCode, url).toBe(403);
      }
      // Nada mudou com os 403.
      expect(
        (await pedir("GET", `/categories/${cat.id}`)).json<Categoria>().versao,
      ).toBe(1);
    });
  },
);
