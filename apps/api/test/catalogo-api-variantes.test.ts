import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarApp } from "../src/app.js";
import type { BaseDados } from "../src/base/esquema.js";
import {
  criarArtigo,
  criarOpcao,
  definirValoresDaVariante,
} from "../src/catalogo/repositorio.js";
import {
  criarEntidadeLegal,
  criarLoja,
  registarComerciante,
} from "../src/comerciante/repositorio.js";
import { criarChave } from "../src/identidade/repositorio.js";
import {
  criarCanal,
  criarLista,
  criarMercado,
  definirMercadosDoCanal,
  definirPreco,
  mudarEstadoMercado,
} from "../src/precos/repositorio.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";

// A API de Administração do Catálogo, parte 3: as variantes (docs/14 §7.1).
// Contra o PostgreSQL 18 verdadeiro, pela app inteira.

const NOVO = { nome: "Loja de Teste", lingua: "pt", fuso: "Europe/Lisbon" };
const ENTIDADE = {
  denominacao: "Exemplo, Lda.",
  forma_juridica: "sociedade por quotas",
  pais: "PT",
  numero_fiscal: "123456789",
  morada_linha: "Rua de Teste, 1",
  morada_codigo_postal: "1000-001",
  morada_localidade: "Lisboa",
};
const CLASSIFICACAO = {
  familias: ["retalho_geral"],
  natureza_consumidor: "bem",
};
/** Um EAN-13 com o dígito de controlo certo. */
const GTIN = "4006381333931";

interface Variante {
  id: string;
  sku: string;
  estado: string;
  artigo: string;
  gtin: string | null;
  valores: string[];
}
interface Ficha {
  id: string;
  estado: string;
  versao: number;
  variantes: { id: string; sku: string }[];
}

describe.skipIf(URL_BASE === undefined)("API do Catálogo: variantes", () => {
  let base: BaseDeTeste;
  let app: ReturnType<typeof criarApp>;
  let a: string;
  let escrita: string;
  let publicacao: string;
  let leitura: string;
  let semCatalogo: string;
  let deB: string;
  let escritaDeB: string;
  let canal: string;
  let mercado: string;
  let lista: string;

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
        ...(corpo === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(corpo === undefined ? {} : { payload: JSON.stringify(corpo) }),
    });

  /** Um artigo pela API, com uma variante; activo se pedido. */
  async function artigo(sku: string, activar = false) {
    const r = await pedir("POST", "/products", {
      tipo: "fisico",
      nome: "Gel",
      categoria_fiscal: "normal",
      variantes: [{ sku, unidade_de_venda: "unidade", peso_g: 30 }],
    });
    expect(r.statusCode).toBe(201);
    let f = r.json<Ficha>();
    if (activar) {
      const c = await pedir("PUT", `/products/${f.id}/classification`, {
        versao: f.versao,
        ...CLASSIFICACAO,
      });
      const at = await pedir("POST", `/products/${f.id}/activate`, {
        versao: c.json<Ficha>().versao,
      });
      expect(at.statusCode).toBe(200);
      f = at.json<Ficha>();
    }
    return f;
  }

  const nova = (sku: string, extra: object = {}) => ({
    sku,
    unidade_de_venda: "unidade",
    peso_g: 30,
    ...extra,
  });

  beforeAll(async () => {
    base = await criarBaseDeTeste(URL_BASE ?? "");
    app = criarApp({ logger: false }, undefined, base.api);
    a = await registarComerciante(base.api, NOVO);
    const b = await registarComerciante(base.api, NOVO);
    const servidor = { tipo: "servidor" as const, criadaPor: "operador:teste" };
    const dono: Kysely<BaseDados> = base.dono;
    const chaveDe = async (c: string, nome: string, ambitos: string[]) =>
      (
        await criarChave(dono, c, {
          ...servidor,
          nome,
          ambitos: ambitos as never,
        })
      ).segredo;
    escrita = await chaveDe(a, "Escrita", ["catalog:read", "catalog:write"]);
    publicacao = await chaveDe(a, "Publicação", ["catalog:publish"]);
    leitura = await chaveDe(a, "Leitura", ["catalog:read"]);
    semCatalogo = await chaveDe(a, "Chaves", ["keys:write"]);
    escritaDeB = await chaveDe(b, "Escrita de B", [
      "catalog:read",
      "catalog:write",
    ]);
    deB = await criarArtigo(
      base.api,
      b,
      { tipo: "fisico", nome: "Gel", categoria_fiscal: "normal" },
      [{ sku: "DE-B-1", unidade_de_venda: "unidade" }],
    );
    const entidade = await criarEntidadeLegal(base.api, a, ENTIDADE);
    const loja = await criarLoja(base.api, a, {
      entidade_legal_id: entidade,
      nome: "Loja online",
    });
    mercado = await criarMercado(base.api, a, {
      loja_id: loja,
      nome: "Portugal",
      paises: ["PT"],
      moeda: "EUR",
      linguas: ["pt"],
      lingua_principal: "pt",
    });
    lista = await criarLista(base.api, a, {
      mercado_id: mercado,
      nome: "Base PT",
      tipo: "base",
    });
    await mudarEstadoMercado(base.api, a, mercado, 1, "activo");
    canal = await criarCanal(base.api, a, {
      loja_id: loja,
      nome: "Loja online",
    });
    await definirMercadosDoCanal(base.api, a, canal, [mercado]);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await base.fechar();
  });

  it("acrescenta uma variante (201, Location) e lê-a sozinha e na lista do artigo", async () => {
    const f = await artigo("LISTA-1");
    const r = await pedir(
      "POST",
      `/products/${f.id}/variants`,
      nova("LISTA-2"),
    );
    expect(r.statusCode).toBe(201);
    const v = r.json<Variante>();
    expect(v).toMatchObject({
      sku: "LISTA-2",
      estado: "activa",
      artigo: f.id,
      valores: [],
    });
    expect(v.id).toMatch(/^var_/);
    expect(r.headers["location"]).toBe(`/variants/${v.id}`);
    const sozinha = await pedir("GET", `/variants/${v.id}`, undefined, {
      segredo: leitura,
    });
    expect(sozinha.statusCode).toBe(200);
    expect(sozinha.json()).toEqual(v);
    const lista = await pedir("GET", `/products/${f.id}/variants`, undefined, {
      segredo: leitura,
    });
    expect(lista.statusCode).toBe(200);
    expect(lista.json<{ dados: Variante[] }>().dados.map((d) => d.sku)).toEqual(
      ["LISTA-1", "LISTA-2"],
    );
  });

  it("repetir com a mesma chave devolve a mesma variante; o SKU repetido (sem distinguir maiúsculas) dá 409", async () => {
    const f = await artigo("REPETE-1");
    const chave = randomUUID();
    const url = `/products/${f.id}/variants`;
    const r1 = await pedir("POST", url, nova("REPETE-2"), { chave });
    const r2 = await pedir("POST", url, nova("REPETE-2"), { chave });
    expect(r1.statusCode).toBe(201);
    expect(r2.json()).toEqual(r1.json());
    const dup = await pedir("POST", url, nova("repete-2"));
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toMatchObject({ codigo: "catalog.sku_duplicate" });
    const lista = (await pedir("GET", url)).json<{ dados: Variante[] }>();
    expect(lista.dados).toHaveLength(2);
  });

  it("num artigo com opções: os valores entram; activo, sem combinação completa recusa com o código do Catálogo (no COMMIT), e a repetida também", async () => {
    const f = await artigo("COR-ROSA");
    const id = f.id.slice("prd_".length);
    const cor = await criarOpcao(base.api, a, id, "Cor", [
      "Rosa",
      "Azul",
      "Verde",
    ]);
    const [rosa, azul, verde] = cor.valores.map((v) => `ovl_${v.id}`);
    // A primeira variante leva o valor dela (ainda em rascunho).
    const varRosa = f.variantes[0]?.id ?? "";
    await definirValoresDaVariante(base.api, a, varRosa.slice("var_".length), [
      cor.valores[0]?.id ?? "",
    ]);
    const url = `/products/${f.id}/variants`;
    const r = await pedir("POST", url, nova("COR-AZUL", { valores: [azul] }));
    expect(r.statusCode).toBe(201);
    expect(r.json<Variante>().valores).toEqual([azul]);
    // Activo: a combinação verifica-se no fim da transacção.
    const ficha = (await pedir("GET", `/products/${f.id}`)).json<Ficha>();
    const c = await pedir("PUT", `/products/${f.id}/classification`, {
      versao: ficha.versao,
      ...CLASSIFICACAO,
    });
    expect(
      (
        await pedir("POST", `/products/${f.id}/activate`, {
          versao: c.json<Ficha>().versao,
        })
      ).statusCode,
    ).toBe(200);
    const sem = await pedir("POST", url, nova("COR-SEM"));
    expect(sem.statusCode).toBe(422);
    expect(sem.json()).toMatchObject({ codigo: "catalog.options_incomplete" });
    const repetida = await pedir(
      "POST",
      url,
      nova("COR-ROSA-2", { valores: [rosa] }),
    );
    expect(repetida.statusCode).toBe(409);
    expect(repetida.json()).toMatchObject({
      codigo: "catalog.option_combination_duplicate",
    });
    const verdeOk = await pedir(
      "POST",
      url,
      nova("COR-VERDE", { valores: [verde] }),
    );
    expect(verdeOk.statusCode).toBe(201);
    // Nenhuma das recusadas ficou.
    const skus = (await pedir("GET", url))
      .json<{ dados: Variante[] }>()
      .dados.map((d) => d.sku)
      .sort();
    expect(skus).toEqual(["COR-AZUL", "COR-ROSA", "COR-VERDE"]);
    // Um valor de outro artigo não serve.
    const outro = await artigo("OUTRO-ART");
    const deOutro = await pedir(
      "POST",
      `/products/${outro.id}/variants`,
      nova("OUTRO-2", { valores: [azul] }),
    );
    expect(deOutro.statusCode).toBe(404);
  });

  it("arquiva: final, o artigo fica; outra vez dá 409; com corpo dá 400", async () => {
    const f = await artigo("ARQ-1", true);
    const v = (
      await pedir("POST", `/products/${f.id}/variants`, nova("ARQ-2"))
    ).json<Variante>();
    const url = `/variants/${v.id}/archive`;
    const comCorpo = await pedir("POST", url, { x: 1 });
    expect(comCorpo.statusCode).toBe(400);
    const r = await pedir("POST", url);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ estado: "arquivada", sku: "ARQ-2" });
    const outra = await pedir("POST", url);
    expect(outra.statusCode).toBe(409);
    expect(outra.json()).toMatchObject({
      codigo: "catalog.variant_archived_is_final",
    });
    expect((await pedir("GET", `/products/${f.id}`)).json<Ficha>().estado).toBe(
      "activo",
    );
    // O SKU arquivado não volta (P7).
    const volta = await pedir(
      "POST",
      `/products/${f.id}/variants`,
      nova("ARQ-2"),
    );
    expect(volta.json()).toMatchObject({ codigo: "catalog.sku_duplicate" });
  });

  it("arquivar a última variante à venda tira a publicação de venda (CJ); uma variante nova num artigo publicado nasce fora", async () => {
    const f = await artigo("PUB-1", true);
    const v1 = f.variantes[0]?.id ?? "";
    await definirPreco(
      base.api,
      a,
      "pessoa:teste",
      lista,
      v1.slice("var_".length),
      { montante: 990 },
    );
    const pub = await pedir(
      "POST",
      `/products/${f.id}/publications`,
      { canal: `chn_${canal}`, mercado: `mkt_${mercado}` },
      { segredo: publicacao },
    );
    expect(pub.json<{ publicada: boolean }>().publicada).toBe(true);
    const v2 = (
      await pedir("POST", `/products/${f.id}/variants`, nova("PUB-2"))
    ).json<Variante>();
    const pubs = async () =>
      (await pedir("GET", `/products/${f.id}/publications`)).json<{
        dados: {
          estado: string;
          motivo_arquivo: string | null;
          variantes_fora: string[];
        }[];
      }>().dados;
    expect((await pubs())[0]?.variantes_fora).toEqual([v2.id]);
    const r = await pedir("POST", `/variants/${v1}/archive`);
    expect(r.statusCode).toBe(200);
    expect((await pubs())[0]).toMatchObject({
      estado: "arquivado",
      motivo_arquivo: "verificacao_falhou",
    });
  });

  it("procura por SKU (sem maiúsculas) e por GTIN (zeros à esquerda não contam), também arquivada; um dos dois, nunca ambos", async () => {
    const f = await artigo("PROCURA-1");
    const v = (
      await pedir(
        "POST",
        `/products/${f.id}/variants`,
        nova("PROCURA-2", { gtin: GTIN, gtin_origem: "fornecedor" }),
      )
    ).json<Variante>();
    const procura = async (q: string) => {
      const r = await pedir("GET", `/variants?${q}`, undefined, {
        segredo: leitura,
      });
      expect(r.statusCode, q).toBe(200);
      return r.json<{ dados: Variante[] }>().dados.map((d) => d.id);
    };
    expect(await procura("sku=procura-2")).toEqual([v.id]);
    expect(await procura(`gtin=${GTIN}`)).toEqual([v.id]);
    expect(await procura(`gtin=0${GTIN}`)).toEqual([v.id]);
    expect(await procura("sku=NAO-EXISTE")).toEqual([]);
    // O SKU de outro comerciante não aparece.
    expect(await procura("sku=DE-B-1")).toEqual([]);
    await pedir("POST", `/variants/${v.id}/archive`);
    expect(await procura("sku=PROCURA-2")).toEqual([v.id]);
    for (const q of ["", `sku=A&gtin=${GTIN}`, "gtin=123", "outro=1"]) {
      const r = await pedir("GET", `/variants?${q}`, undefined, {
        segredo: leitura,
      });
      expect(r.statusCode, q).toBe(400);
    }
  });

  it("de outro comerciante: 404 em todas; os âmbitos: catalog:read não escreve, sem catalog:read não lê", async () => {
    const f = await artigo("AMBITO-1");
    const v = f.variantes[0]?.id ?? "";
    for (const [metodo, url, corpo] of [
      ["GET", `/products/${f.id}/variants`, undefined],
      ["GET", `/variants/${v}`, undefined],
      ["POST", `/products/${f.id}/variants`, nova("B-TENTA")],
      ["POST", `/variants/${v}/archive`, undefined],
    ] as const) {
      const r = await pedir(metodo, url, corpo, { segredo: escritaDeB });
      expect(r.statusCode, `${metodo} ${url}`).toBe(404);
      expect(r.json()).toMatchObject({ codigo: "catalog.not_found" });
    }
    // O artigo de B visto por A.
    const r = await pedir(
      "POST",
      `/products/prd_${deB}/variants`,
      nova("A-TENTA"),
    );
    expect(r.statusCode).toBe(404);
    const escreve = await pedir(
      "POST",
      `/products/${f.id}/variants`,
      nova("LEITURA-1"),
      { segredo: leitura },
    );
    expect(escreve.statusCode).toBe(403);
    for (const url of [
      `/products/${f.id}/variants`,
      `/variants/${v}`,
      "/variants?sku=X",
    ]) {
      const sem = await pedir("GET", url, undefined, { segredo: semCatalogo });
      expect(sem.statusCode, url).toBe(403);
    }
  });
});
