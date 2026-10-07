import { sql, type Kysely } from "kysely";
import type { BaseDados } from "../src/base/esquema.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarApp } from "../src/app.js";
import type { Classificacao } from "../src/catalogo/classificacao.js";
import {
  classificarArtigo,
  criarArtigo,
  mudarEstadoArtigo,
} from "../src/catalogo/repositorio.js";
import { publicar } from "../src/catalogo/publicacao.js";
import {
  comComerciante,
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

// A API de Administração do Catálogo, parte 1: as consultas (docs/14 §7.1;
// docs/18 §2a). Contra o PostgreSQL 18 verdadeiro, pela app inteira (chave,
// âmbito, RLS, contrato).

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
const QUEM = "pessoa:teste";
const CLASSIFICACAO: Classificacao = {
  familias: ["retalho_geral"],
  natureza_consumidor: "bem",
};

interface Pagina {
  dados: { id: string; nome: string; estado: string }[];
  total: number;
  ha_mais: boolean;
  cursor_seguinte: string | null;
}

describe.skipIf(URL_BASE === undefined)("API do Catálogo: consultas", () => {
  let base: BaseDeTeste;
  let app: ReturnType<typeof criarApp>;
  let a: string;
  let b: string;
  let leitura: string;
  let semCatalogo: string;
  let gel: string;
  let lima: string;
  let verniz: string;
  let deB: string;
  let canal: string;
  let mercado: string;

  const pedir = (
    url: string,
    segredo: string | null = leitura,
    metodo: "GET" | "POST" = "GET",
    corpo?: unknown,
  ) =>
    app.inject({
      method: metodo,
      url,
      headers: {
        ...(segredo === null ? {} : { authorization: `Bearer ${segredo}` }),
        ...(corpo === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(corpo === undefined ? {} : { payload: JSON.stringify(corpo) }),
    });

  async function artigo(c: string, nome: string, sku: string) {
    return criarArtigo(
      base.api,
      c,
      { tipo: "fisico", nome, categoria_fiscal: "normal" },
      [{ sku, unidade_de_venda: "unidade", peso_g: 30 }],
    );
  }

  beforeAll(async () => {
    base = await criarBaseDeTeste(URL_BASE ?? "");
    app = criarApp({ logger: false }, undefined, base.api);
    a = await registarComerciante(base.api, NOVO);
    b = await registarComerciante(base.api, NOVO);
    const servidor = { tipo: "servidor" as const, criadaPor: "operador:teste" };
    // Criar chaves só o dono faz (o comando do operador; revisão do #110).
    const dono: Kysely<BaseDados> = base.dono;
    leitura = (
      await criarChave(dono, a, {
        ...servidor,
        nome: "Leitura",
        ambitos: ["catalog:read"],
      })
    ).segredo;
    semCatalogo = (
      await criarChave(dono, a, {
        ...servidor,
        nome: "Chaves",
        ambitos: ["keys:write"],
      })
    ).segredo;
    // A: o «Gel» activo e publicado, a «Lima» em rascunho, o «Verniz 50%»
    // arquivado; B: um artigo que A nunca vê.
    gel = await artigo(a, "Gel", "GEL-001");
    lima = await artigo(a, "Lima", "LIMA-001");
    verniz = await artigo(a, "Verniz 50%", "VERNIZ-001");
    deB = await artigo(b, "Gel", "GEL-001");
    for (const id of [gel, verniz]) {
      await classificarArtigo(base.api, a, id, 1, CLASSIFICACAO, QUEM);
      await mudarEstadoArtigo(base.api, a, id, 2, "activo");
    }
    await mudarEstadoArtigo(base.api, a, verniz, 3, "arquivado");
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
    const lista = await criarLista(base.api, a, {
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
    const [v] = await comComerciante(base.api, a, (trx) =>
      trx
        .selectFrom("variante")
        .select("id")
        .where("artigo_id", "=", gel)
        .execute(),
    );
    if (v === undefined) throw new Error("falta a variante");
    await definirPreco(base.api, a, QUEM, lista, v.id, { montante: 990 });
    const r = await publicar(base.api, a, QUEM, {
      artigo_id: gel,
      canal_id: canal,
      mercado_id: mercado,
    });
    expect(r.publicada).toBe(true);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await base.fechar();
  });

  it("sem chave dá 401; uma chave sem catalog:read dá 403", async () => {
    const sem = await pedir("/products", null);
    expect(sem.statusCode).toBe(401);
    expect(sem.json()).toMatchObject({ codigo: "auth.required" });
    const r = await pedir("/products", semCatalogo);
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ codigo: "auth.forbidden" });
  });

  it("a lista dá só os artigos do comerciante da chave, com o total, por páginas e sem cortar", async () => {
    const r1 = await pedir("/products?limite=2");
    expect(r1.statusCode).toBe(200);
    const p1 = r1.json<Pagina>();
    expect(p1.total).toBe(3);
    expect(p1.dados.map((d) => d.nome)).toEqual(["Gel", "Lima"]);
    expect(p1.ha_mais).toBe(true);
    expect(p1.cursor_seguinte).not.toBeNull();
    const p2 = (
      await pedir(`/products?limite=2&cursor=${p1.cursor_seguinte ?? ""}`)
    ).json<Pagina>();
    expect(p2).toMatchObject({
      total: 3,
      ha_mais: false,
      cursor_seguinte: null,
    });
    expect(p2.dados.map((d) => d.nome)).toEqual(["Verniz 50%"]);
    // O de B nunca aparece.
    expect([...p1.dados, ...p2.dados].map((d) => d.id)).not.toContain(
      `prd_${deB}`,
    );
  });

  it("os filtros: estado, tipo, SKU sem distinguir maiúsculas e parte do nome (o % é uma letra)", async () => {
    const nomes = async (consulta: string) =>
      (await pedir(`/products?${consulta}`))
        .json<Pagina>()
        .dados.map((d) => d.nome);
    expect(await nomes("estado=rascunho")).toEqual(["Lima"]);
    expect(await nomes("tipo=fisico")).toEqual(["Gel", "Lima", "Verniz 50%"]);
    expect(await nomes("sku=gel-001")).toEqual(["Gel"]);
    expect(await nomes("texto=GE")).toEqual(["Gel"]);
    expect(await nomes(`texto=${encodeURIComponent("50%")}`)).toEqual([
      "Verniz 50%",
    ]);
    expect(await nomes(`texto=${encodeURIComponent("%")}`)).toEqual([
      "Verniz 50%",
    ]);
    const r = (await pedir("/products?estado=activo")).json<Pagina>();
    expect(r).toMatchObject({ total: 1, ha_mais: false });
  });

  it("um pedido mal feito dá 400: limite fora, cursor inventado, filtro desconhecido", async () => {
    for (const consulta of [
      "limite=0",
      "limite=101",
      "cursor=nao-e-um-cursor",
      "cor=azul",
      "estado=apagado",
    ]) {
      const r = await pedir(`/products?${consulta}`);
      expect(r.statusCode, consulta).toBe(400);
      expect(r.json(), consulta).toMatchObject({ codigo: "request.invalid" });
    }
  });

  it("a ficha do artigo traz as variantes e os identificadores com prefixo; o de outro comerciante é 404", async () => {
    const r = await pedir(`/products/prd_${gel}`);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      id: `prd_${gel}`,
      estado: "activo",
      nome: "Gel",
      classificacao: {
        familias: ["retalho_geral"],
        natureza_consumidor: "bem",
        classificado_por: QUEM,
      },
      variantes: [
        {
          sku: "GEL-001",
          estado: "activa",
          unidade_de_venda: "unidade",
          peso_g: 30,
        },
      ],
    });
    const deOutro = await pedir(`/products/prd_${deB}`);
    expect(deOutro.statusCode).toBe(404);
    expect(deOutro.json()).toMatchObject({ codigo: "catalog.not_found" });
    expect((await pedir(`/products/${gel}`)).statusCode).toBe(400);
  });

  it("as publicações do artigo, com a última verificação; um artigo que não existe é 404", async () => {
    const r = await pedir(`/products/prd_${gel}/publications`);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      dados: [
        {
          artigo: `prd_${gel}`,
          canal: `chn_${canal}`,
          mercado: `mkt_${mercado}`,
          estado: "publicado",
          publicado_por: QUEM,
          ultima_verificacao: {
            impedimentos: [],
            nao_verificado: ["conformidade", "media"],
          },
        },
      ],
    });
    expect((await pedir(`/products/prd_${lima}/publications`)).json()).toEqual({
      dados: [],
    });
    const deOutro = await pedir(`/products/prd_${deB}/publications`);
    expect(deOutro.statusCode).toBe(404);
  });

  it("«pode publicar?» devolve os impedimentos e o que não se verifica, sem escrever nada", async () => {
    const antes = await sql<{ n: number }>`
      select count(*)::int as n from publicacao`.execute(base.dono);
    const r = await pedir(
      `/products/prd_${lima}/publications/check`,
      leitura,
      "POST",
      { canal: `chn_${canal}`, mercado: `mkt_${mercado}` },
    );
    expect(r.statusCode).toBe(200);
    const corpo = r.json<{
      impedimentos: { codigo: string }[];
      nao_verificado: string[];
    }>();
    expect(corpo.impedimentos.map((i) => i.codigo)).toEqual([
      "artigo_nao_activo",
      "classificacao_em_falta",
      "preco_em_falta",
    ]);
    expect(corpo.nao_verificado).toEqual(["conformidade", "media"]);
    const depois = await sql<{ n: number }>`
      select count(*)::int as n from publicacao`.execute(base.dono);
    expect(depois.rows[0]?.n).toBe(antes.rows[0]?.n);
    // Um canal que não existe é 404; um campo a mais é 400.
    const semCanal = await pedir(
      `/products/prd_${lima}/publications/check`,
      leitura,
      "POST",
      { canal: `chn_${lima}`, mercado: `mkt_${mercado}` },
    );
    expect(semCanal.statusCode).toBe(404);
    expect(semCanal.json()).toMatchObject({ codigo: "catalog.not_found" });
    const aMais = await pedir(
      `/products/prd_${lima}/publications/check`,
      leitura,
      "POST",
      { canal: `chn_${canal}`, mercado: `mkt_${mercado}`, publicar: true },
    );
    expect(aMais.statusCode).toBe(400);
  });

  it("a versão da API por data: a resposta diz qual; uma versão desconhecida dá 400", async () => {
    const r = await pedir("/products?limite=1");
    expect(r.headers["eurolify-versao"]).toBe("2026-10");
    const comVersao = await app.inject({
      method: "GET",
      url: "/products?limite=1",
      headers: {
        authorization: `Bearer ${leitura}`,
        "eurolify-versao": "2026-10",
      },
    });
    expect(comVersao.statusCode).toBe(200);
    const antiga = await app.inject({
      method: "GET",
      url: "/products?limite=1",
      headers: {
        authorization: `Bearer ${leitura}`,
        "eurolify-versao": "2025-01",
      },
    });
    expect(antiga.statusCode).toBe(400);
    expect(antiga.json()).toMatchObject({ codigo: "version.unsupported" });
    expect(antiga.headers["eurolify-versao"]).toBe("2026-10");
  });

  it("as quatro rotas estão no contrato, com a chave e as listas fechadas", async () => {
    const contrato = (await pedir("/openapi.json", null)).json<{
      paths: Record<
        string,
        Record<
          string,
          {
            security?: unknown;
            parameters?: { name: string; schema: unknown }[];
          }
        >
      >;
    }>();
    for (const [caminho, metodo] of [
      ["/products", "get"],
      ["/products/{id}", "get"],
      ["/products/{id}/publications", "get"],
      ["/products/{id}/publications/check", "post"],
    ] as const) {
      expect(contrato.paths[caminho]?.[metodo]?.security, caminho).toEqual([
        { chave: [] },
      ]);
    }
    const estado = contrato.paths["/products"]?.["get"]?.parameters?.find(
      (p) => p.name === "estado",
    );
    expect(JSON.stringify(estado?.schema)).toContain("rascunho");
  });
});
