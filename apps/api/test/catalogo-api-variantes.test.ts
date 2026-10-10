import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarApp } from "../src/app.js";
import type { BaseDados } from "../src/base/esquema.js";
import {
  acrescentarValor,
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
    // O pormenor sem o texto nem o nome da restrição da base (docs/18 §2).
    // Não diz qual é o SKU: com o RLS, a base não o dá (#77).
    const detalhe = dup.json<{ detail: string }>().detail;
    expect(detalhe).toBe(
      "já existe uma variante com este SKU (sem distinguir maiúsculas)",
    );
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

  it("arquiva: final, o artigo fica; outra vez devolve-a sem mudar (como no artigo); a mesma chave repete; com corpo dá 400", async () => {
    const f = await artigo("ARQ-1", true);
    const v = (
      await pedir("POST", `/products/${f.id}/variants`, nova("ARQ-2"))
    ).json<Variante>();
    const url = `/variants/${v.id}/archive`;
    const comCorpo = await pedir("POST", url, { x: 1 });
    expect(comCorpo.statusCode).toBe(400);
    // JSON vazio com o Content-Type também é corpo a mais.
    const jsonVazio = await app.inject({
      method: "POST",
      url,
      headers: {
        authorization: `Bearer ${escrita}`,
        "idempotency-key": randomUUID(),
        "content-type": "application/json",
      },
      payload: "",
    });
    expect(jsonVazio.statusCode).toBe(400);
    const chave = randomUUID();
    const r = await pedir("POST", url, undefined, { chave });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ estado: "arquivada", sku: "ARQ-2" });
    // A mesma chave: a mesma resposta.
    const mesma = await pedir("POST", url, undefined, { chave });
    expect(mesma.statusCode).toBe(200);
    expect(mesma.json()).toEqual(r.json());
    // Outra chave, já arquivada: devolve-a, sem erro e sem mudar nada.
    const outra = await pedir("POST", url);
    expect(outra.statusCode).toBe(200);
    expect(outra.json()).toEqual(r.json());
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
    // O GTIN de outro comerciante não aparece.
    const deB = await pedir(
      "POST",
      "/products",
      {
        tipo: "fisico",
        nome: "De B",
        categoria_fiscal: "normal",
        variantes: [
          nova("B-GTIN", { gtin: "5901234123457", gtin_origem: "fornecedor" }),
        ],
      },
      { segredo: escritaDeB },
    );
    expect(deB.statusCode).toBe(201);
    expect(await procura("gtin=5901234123457")).toEqual([]);
    for (const q of [
      "",
      `sku=A&gtin=${GTIN}`,
      "gtin=123",
      "outro=1",
      "sku=X&outro=1",
    ]) {
      const r = await pedir("GET", `/variants?${q}`, undefined, {
        segredo: leitura,
      });
      expect(r.statusCode, q).toBe(400);
    }
  });

  it("a lista das variantes vai por páginas, por posição e SKU, com o total; um cursor estranho dá 400", async () => {
    const r = await pedir("POST", "/products", {
      tipo: "fisico",
      nome: "Paginado",
      categoria_fiscal: "normal",
      variantes: [
        nova("PAG-C", { posicao: 0 }),
        nova("PAG-A", { posicao: 1 }),
        nova("PAG-B", { posicao: 1 }),
      ],
    });
    const f = r.json<Ficha>();
    type Pagina = {
      dados: Variante[];
      total: number;
      ha_mais: boolean;
      cursor_seguinte: string | null;
    };
    const p1 = (
      await pedir("GET", `/products/${f.id}/variants?limite=2`)
    ).json<Pagina>();
    expect(p1.dados.map((d) => d.sku)).toEqual(["PAG-C", "PAG-A"]);
    expect(p1).toMatchObject({ total: 3, ha_mais: true });
    const p2 = (
      await pedir(
        "GET",
        `/products/${f.id}/variants?limite=2&cursor=${p1.cursor_seguinte ?? ""}`,
      )
    ).json<Pagina>();
    expect(p2.dados.map((d) => d.sku)).toEqual(["PAG-B"]);
    expect(p2).toMatchObject({
      total: 3,
      ha_mais: false,
      cursor_seguinte: null,
    });
    for (const cursor of [
      "eHl6",
      Buffer.from(JSON.stringify([0, "A", "nao-uuid"])).toString("base64url"),
    ]) {
      const mau = await pedir(
        "GET",
        `/products/${f.id}/variants?cursor=${cursor}`,
      );
      expect(mau.statusCode, cursor).toBe(400);
    }
  });

  it("a idempotência da criação: outro corpo com a mesma chave dá 422; uma recusa no COMMIT não gasta a chave; a mesma chave ao mesmo tempo cria uma só", async () => {
    const f = await artigo("IDEM-1");
    const url = `/products/${f.id}/variants`;
    const chave = randomUUID();
    expect(
      (await pedir("POST", url, nova("IDEM-2"), { chave })).statusCode,
    ).toBe(201);
    const outro = await pedir("POST", url, nova("IDEM-3"), { chave });
    expect(outro.statusCode).toBe(422);
    expect(outro.json()).toMatchObject({ codigo: "idempotency.key_reused" });
    // Duas ao mesmo tempo, a mesma chave: uma variante só.
    const paralela = randomUUID();
    const [r1, r2] = await Promise.all([
      pedir("POST", url, nova("IDEM-4"), { chave: paralela }),
      pedir("POST", url, nova("IDEM-4"), { chave: paralela }),
    ]);
    // Ou a segunda viu a primeira em curso (409 in_progress), ou recebeu a
    // mesma resposta guardada (201 igual); nunca o SKU repetido, que é o
    // que daria sem a idempotência (revisão do #159, 2.ª, P2-N1).
    const estados = [r1.statusCode, r2.statusCode].sort();
    expect([
      [201, 201],
      [201, 409],
    ]).toContainEqual(estados);
    if (estados[1] === 409) {
      const emCurso = r1.statusCode === 409 ? r1 : r2;
      expect(emCurso.json()).toMatchObject({
        codigo: "idempotency.in_progress",
      });
    } else {
      expect(r2.json()).toEqual(r1.json());
    }
    const lista = (await pedir("GET", url)).json<{ dados: Variante[] }>();
    expect(lista.dados.filter((d) => d.sku === "IDEM-4")).toHaveLength(1);
  });

  it("opções: os valores saem pela ordem das opções; repetidos, de mais, mal escritos ou dois da mesma opção recusam; duas criações iguais ao mesmo tempo, só uma entra; a recusa no COMMIT não gasta a chave", async () => {
    const f = await artigo("ORDEM-1");
    const id = f.id.slice("prd_".length);
    const cor = await criarOpcao(base.api, a, id, "Cor", ["Rosa"]);
    const tam = await criarOpcao(base.api, a, id, "Tamanho", ["S"]);
    // Um valor de Cor criado depois do de Tamanho: o id dele é maior.
    const azul = await acrescentarValor(base.api, a, cor.id, "Azul");
    const rosa = cor.valores[0]?.id ?? "";
    const s = tam.valores[0]?.id ?? "";
    await definirValoresDaVariante(
      base.api,
      a,
      (f.variantes[0]?.id ?? "").slice("var_".length),
      [rosa, s],
    );
    const url = `/products/${f.id}/variants`;
    const r = await pedir(
      "POST",
      url,
      nova("ORDEM-AZUL", { valores: [`ovl_${s}`, `ovl_${azul}`] }),
    );
    expect(r.statusCode).toBe(201);
    expect(r.json<Variante>().valores).toEqual([`ovl_${azul}`, `ovl_${s}`]);
    for (const valores of [
      [`ovl_${rosa}`, `ovl_${rosa}`],
      ["x"],
      Array.from({ length: 21 }, () => `ovl_${randomUUID()}`),
    ]) {
      const mau = await pedir("POST", url, nova("ORDEM-MAU", { valores }));
      expect(mau.statusCode, JSON.stringify(valores).slice(0, 40)).toBe(400);
    }
    const doisDaCor = await pedir(
      "POST",
      url,
      nova("ORDEM-DOIS", { valores: [`ovl_${rosa}`, `ovl_${azul}`] }),
    );
    expect(doisDaCor.statusCode).toBe(422);
    expect(doisDaCor.json()).toMatchObject({
      codigo: "catalog.option_repeated",
    });
    // Activo: duas criações com a mesma combinação ao mesmo tempo.
    const ficha = (await pedir("GET", `/products/${f.id}`)).json<Ficha>();
    const c = await pedir("PUT", `/products/${f.id}/classification`, {
      versao: ficha.versao,
      ...CLASSIFICACAO,
    });
    expect(c.statusCode).toBe(200);
    const activado = await pedir("POST", `/products/${f.id}/activate`, {
      versao: c.json<Ficha>().versao,
    });
    expect(activado.statusCode).toBe(200);
    expect(activado.json()).toMatchObject({ estado: "activo" });
    const verde = await acrescentarValor(base.api, a, cor.id, "Verde");
    const combinacao = [`ovl_${verde}`, `ovl_${s}`];
    const [p1, p2] = await Promise.all([
      pedir("POST", url, nova("PAR-1", { valores: combinacao })),
      pedir("POST", url, nova("PAR-2", { valores: combinacao })),
    ]);
    expect([p1.statusCode, p2.statusCode].sort()).toEqual([201, 409]);
    const recusada = p1.statusCode === 409 ? p1 : p2;
    expect(recusada.json()).toMatchObject({
      codigo: "catalog.option_combination_duplicate",
    });
    // A recusa no COMMIT não gasta a chave: o mesmo pedido volta a ser
    // tratado (e recusado outra vez), não fica «em curso».
    const chave = randomUUID();
    const sem1 = await pedir("POST", url, nova("SEM-VAL"), { chave });
    const sem2 = await pedir("POST", url, nova("SEM-VAL"), { chave });
    expect([sem1.statusCode, sem2.statusCode]).toEqual([422, 422]);
    expect(sem2.json()).toMatchObject({
      codigo: "catalog.options_incomplete",
    });
  });

  it("o GTIN: com zeros à esquerda é o mesmo (409); o dígito errado dá 422; o GTIN-12 encontra-se como EAN-13; sem a origem, ou a origem sem GTIN, dá 400", async () => {
    const f = await artigo("GTIN-1");
    const url = `/products/${f.id}/variants`;
    const upc = "036000291452";
    expect(
      (
        await pedir(
          "POST",
          url,
          nova("GTIN-UPC", { gtin: upc, gtin_origem: "fornecedor" }),
        )
      ).statusCode,
    ).toBe(201);
    const zeros = await pedir(
      "POST",
      url,
      nova("GTIN-ZEROS", { gtin: `0${upc}`, gtin_origem: "fornecedor" }),
    );
    expect(zeros.statusCode).toBe(409);
    expect(zeros.json()).toMatchObject({ codigo: "catalog.gtin_duplicate" });
    // O pormenor sem o texto da base (docs/18 §2; #77).
    expect(zeros.json<{ detail: string }>().detail).toBe(
      "já existe uma variante com este GTIN (com ou sem zeros à esquerda)",
    );
    const digito = await pedir(
      "POST",
      url,
      nova("GTIN-MAU", { gtin: "4006381333932", gtin_origem: "fornecedor" }),
    );
    expect(digito.statusCode).toBe(422);
    expect(digito.json()).toMatchObject({ codigo: "catalog.gtin_invalid" });
    const achada = await pedir("GET", `/variants?gtin=0${upc}`);
    expect(
      achada.json<{ dados: Variante[] }>().dados.map((d) => d.sku),
    ).toEqual(["GTIN-UPC"]);
    for (const extra of [{ gtin: GTIN }, { gtin_origem: "fornecedor" }]) {
      const r = await pedir("POST", url, nova("GTIN-SO", extra));
      expect(r.statusCode, JSON.stringify(extra)).toBe(400);
      expect(r.json()).toMatchObject({ codigo: "request.invalid" });
    }
    const noArtigo = await pedir("POST", "/products", {
      tipo: "fisico",
      nome: "Sem origem",
      categoria_fiscal: "normal",
      variantes: [nova("GTIN-ART", { gtin: GTIN })],
    });
    expect(noArtigo.statusCode).toBe(400);
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
