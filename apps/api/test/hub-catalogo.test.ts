import { randomUUID } from "node:crypto";
import { sql, type Kysely } from "kysely";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArmazenamentoEmDisco } from "../src/catalogo/armazenamento.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Classificacao } from "../src/catalogo/classificacao.js";
import { opcoesDoArtigoPaginadas } from "../src/catalogo/consultas.js";
import { publicar } from "../src/catalogo/publicacao.js";
import {
  classificarArtigo,
  mudarEstadoArtigo,
  obterArtigo,
} from "../src/catalogo/repositorio.js";
import {
  comComerciante,
  criarEntidadeLegal,
  criarLoja,
  mudarEstado,
  registarComerciante,
} from "../src/comerciante/repositorio.js";
import {
  criarCanal,
  criarLista,
  criarMercado,
  definirMercadosDoCanal,
  definirPreco,
  mudarEstadoCanal,
  mudarEstadoMercado,
  nomesDeCanaisEMercados,
  obterCanal,
} from "../src/precos/repositorio.js";
import type { BaseDados } from "../src/base/esquema.js";
import { criarChave } from "../src/identidade/repositorio.js";
import { PAPEIS } from "../src/identidade/papeis.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";
import { ambitosConhecidos } from "../src/identidade/hub.js";
import { hubDeTeste } from "./hub-de-teste.js";
import { JPEG, PNG } from "./imagens-de-teste.js";

// A lista de artigos no Hub (docs/22 §11; issue #199): GET /hub/products é a
// mesma função, filtros e resposta do GET /products, com a sessão de uma
// pessoa cujo papel tem catalog:read. Contra o PostgreSQL 18.

describe.skipIf(URL_BASE === undefined)("catálogo no Hub (#199)", () => {
  let base: BaseDeTeste;
  let h: ReturnType<typeof hubDeTeste>;
  let pasta: string;

  /** Um comerciante com uma chave de escrita e N artigos criados por ela. */
  async function comerciante(nome: string, artigos: string[]) {
    const c = await registarComerciante(base.api, {
      nome,
      lingua: "pt",
      fuso: "Europe/Lisbon",
    });
    const { segredo } = await criarChave(base.dono, c, {
      tipo: "servidor",
      criadaPor: "operador:teste",
      nome: "Escrita",
      ambitos: ["catalog:read", "catalog:write"],
    });
    for (const n of artigos) {
      const r = await h.app.inject({
        method: "POST",
        url: "/products",
        headers: {
          authorization: `Bearer ${segredo}`,
          "idempotency-key": randomUUID(),
          "content-type": "application/json",
        },
        payload: JSON.stringify({
          tipo: "fisico",
          nome: n,
          categoria_fiscal: "normal",
          variantes: [
            { sku: `H-${randomUUID()}`, unidade_de_venda: "unidade" },
          ],
        }),
      });
      expect(r.statusCode, r.body).toBe(201);
    }
    return { id: c, segredo };
  }

  const comChave = (
    segredo: string,
    metodo: "GET" | "POST",
    url: string,
    corpo?: Buffer | object,
    tipo = "application/json",
  ) =>
    h.app.inject({
      method: metodo,
      url,
      headers: {
        authorization: `Bearer ${segredo}`,
        ...(metodo === "POST"
          ? { "idempotency-key": randomUUID(), "content-type": tipo }
          : {}),
      },
      ...(corpo === undefined
        ? {}
        : {
            payload: Buffer.isBuffer(corpo) ? corpo : JSON.stringify(corpo),
          }),
    });

  /** Um artigo com duas variantes, uma imagem com texto e outra sem. */
  async function artigoCompleto(
    c: { id: string; segredo: string },
    /** Com peso e os dois textos alternativos: pode publicar-se. */
    publicavel = false,
  ) {
    const peso = publicavel ? { peso_g: 30 } : {};
    const r = await comChave(c.segredo, "POST", "/products", {
      tipo: "fisico",
      nome: "Verniz Completo",
      marca: "Marca de Ensaio",
      categoria_fiscal: "normal",
      variantes: [
        { sku: `C-${randomUUID()}`, unidade_de_venda: "unidade", ...peso },
        { sku: `C-${randomUUID()}`, unidade_de_venda: "unidade", ...peso },
      ],
    });
    expect(r.statusCode, r.body).toBe(201);
    const artigo = r.json<{ id: string }>().id;
    const imagens: string[] = [];
    for (const [bytes, texto] of [
      [PNG, "Frasco de verniz azul"],
      [JPEG, publicavel ? "Frasco de verniz, de lado" : null],
    ] as const) {
      const f = await comChave(
        c.segredo,
        "POST",
        "/media/uploads",
        bytes,
        bytes === PNG ? "image/png" : "image/jpeg",
      );
      expect(f.statusCode, f.body).toBe(201);
      const m = await comChave(c.segredo, "POST", `/products/${artigo}/media`, {
        ficheiro: f.json<{ id: string }>().id,
        texto_alternativo: texto,
      });
      expect(m.statusCode, m.body).toBe(201);
      imagens.push(m.json<{ id: string }>().id);
    }
    return { artigo, imagens };
  }

  /**
   * Um artigo publicado num canal e num mercado com estes nomes, e outro
   * incompleto, que fica em rascunho (revisão do #206, P2-3).
   */
  async function publicado(
    c: { id: string; segredo: string },
    nomes = { canal: "Loja online", mercado: "Portugal", loja: "Loja online" },
  ) {
    const incompleto = (await artigoCompleto(c)).artigo;
    const { artigo } = await artigoCompleto(c, true);
    const quem = "pessoa:teste";
    const classificacao: Classificacao = {
      familias: ["retalho_geral"],
      natureza_consumidor: "bem",
    };
    const versao = async (id: string) =>
      (await obterArtigo(base.api, c.id, id)).versao;
    const semPrefixo = (a: string) => a.replace(/^prd_/, "");
    for (const a of [incompleto, artigo].map(semPrefixo)) {
      await classificarArtigo(
        base.api,
        c.id,
        a,
        await versao(a),
        classificacao,
        quem,
      );
      await mudarEstadoArtigo(base.api, c.id, a, await versao(a), "activo");
    }
    const id = semPrefixo(artigo);
    const entidade = await criarEntidadeLegal(base.api, c.id, {
      denominacao: "Exemplo, Lda.",
      forma_juridica: "sociedade por quotas",
      pais: "PT",
      numero_fiscal: "123456789",
      morada_linha: "Rua de Teste, 1",
      morada_codigo_postal: "1000-001",
      morada_localidade: "Lisboa",
    });
    const loja = await criarLoja(base.api, c.id, {
      entidade_legal_id: entidade,
      nome: nomes.loja,
    });
    const mercado = await criarMercado(base.api, c.id, {
      loja_id: loja,
      nome: nomes.mercado,
      paises: ["PT"],
      moeda: "EUR",
      linguas: ["pt"],
      lingua_principal: "pt",
    });
    const lista = await criarLista(base.api, c.id, {
      mercado_id: mercado,
      nome: "Base PT",
      tipo: "base",
    });
    await mudarEstadoMercado(base.api, c.id, mercado, 1, "activo");
    const canal = await criarCanal(base.api, c.id, {
      loja_id: loja,
      nome: nomes.canal,
    });
    await definirMercadosDoCanal(base.api, c.id, canal, [mercado]);
    const variantes = await comComerciante(base.api, c.id, (trx) =>
      trx
        .selectFrom("variante")
        .select("id")
        .where("artigo_id", "in", [id, semPrefixo(incompleto)])
        .execute(),
    );
    for (const v of variantes) {
      await definirPreco(base.api, c.id, quem, lista, v.id, { montante: 990 });
    }
    const r = await publicar(base.api, c.id, quem, {
      artigo_id: id,
      canal_id: canal,
      mercado_id: mercado,
    });
    expect(r.publicada, JSON.stringify(r)).toBe(true);
    // O incompleto fica em rascunho, com o que impede a publicação.
    const recusada = await publicar(base.api, c.id, quem, {
      artigo_id: semPrefixo(incompleto),
      canal_id: canal,
      mercado_id: mercado,
    });
    expect(recusada.publicada).toBe(false);
    return { artigo, incompleto, canal, mercado, versao, entidade };
  }

  const pelaChave = (segredo: string, q: string) =>
    h.app.inject({
      method: "GET",
      url: `/products${q}`,
      headers: { authorization: `Bearer ${segredo}` },
    });

  beforeAll(async () => {
    base = await criarBaseDeTeste(URL_BASE ?? "");
    pasta = await mkdtemp(join(tmpdir(), "eurolify-hub-media-"));
    h = hubDeTeste(base, { armazenamento: new ArmazenamentoEmDisco(pasta) });
  }, 60_000);

  afterAll(async () => {
    await h.app.close();
    await base.fechar();
    await rm(pasta, { recursive: true, force: true });
  });

  it("os quatro papéis lêem a lista; é igual à do GET /products, com os mesmos filtros e páginas", async () => {
    const c = await comerciante("Loja Artigos", [
      "Verniz Azul",
      "Verniz Rosa",
      "Lima de Unhas",
    ]);
    for (const papel of PAPEIS) {
      const p = await h.pessoaCom(c.id, papel);
      for (const q of ["", "?texto=verniz", "?limite=1", "?estado=rascunho"]) {
        const hub = await h.pedir("GET", `/hub/products${q}`, {
          sessao: p.sessao,
          comerciante: c.id,
        });
        expect(hub.statusCode, `${papel} ${q}: ${hub.body}`).toBe(200);
        expect(hub.headers["cache-control"]).toBe("private, no-store");
        const api = await pelaChave(c.segredo, q);
        expect(hub.json()).toEqual(api.json());
      }
    }
    const p = await h.pessoaCom(c.id, "armazem");
    const r = await h.pedir("GET", "/hub/products?texto=verniz", {
      sessao: p.sessao,
      comerciante: c.id,
    });
    const corpo = r.json<{ total: number; dados: { nome: string }[] }>();
    expect(corpo.total).toBe(2);
    expect(corpo.dados.map((a) => a.nome).sort()).toEqual([
      "Verniz Azul",
      "Verniz Rosa",
    ]);
    // A página seguinte pelo cursor, como no GET /products.
    const um = await h.pedir("GET", "/hub/products?limite=1", {
      sessao: p.sessao,
      comerciante: c.id,
    });
    const primeira = um.json<{ cursor_seguinte: string | null }>();
    expect(primeira.cursor_seguinte).not.toBeNull();
    const dois = await h.pedir(
      "GET",
      `/hub/products?limite=1&cursor=${encodeURIComponent(primeira.cursor_seguinte ?? "")}`,
      { sessao: p.sessao, comerciante: c.id },
    );
    expect(dois.statusCode).toBe(200);
    expect(dois.json()).toEqual(
      (
        await pelaChave(
          c.segredo,
          `?limite=1&cursor=${encodeURIComponent(primeira.cursor_seguinte ?? "")}`,
        )
      ).json(),
    );
  });

  it("só os artigos do comerciante do cabeçalho, e só de quem é membro dele", async () => {
    const a = await comerciante("Loja A", ["Artigo de A"]);
    const b = await comerciante("Loja B", ["Artigo de B"]);
    const p = await h.pessoaCom(a.id, "dono");
    const deA = await h.pedir("GET", "/hub/products", {
      sessao: p.sessao,
      comerciante: a.id,
    });
    expect(
      deA.json<{ dados: { nome: string }[] }>().dados.map((x) => x.nome),
    ).toEqual(["Artigo de A"]);
    const deB = await h.pedir("GET", "/hub/products", {
      sessao: p.sessao,
      comerciante: b.id,
    });
    expect(deB.statusCode).toBe(403);
    expect(deB.body).not.toContain("Artigo de B");
  });

  it("sem sessão, sem cabeçalho, com uma chave em vez da sessão ou de outro site: recusado", async () => {
    const c = await comerciante("Loja Fechada", ["Artigo"]);
    const p = await h.pessoaCom(c.id, "apoio");
    const semSessao = await h.pedir("GET", "/hub/products", {
      comerciante: c.id,
    });
    expect(semSessao.statusCode).toBe(401);
    const semCabecalho = await h.pedir("GET", "/hub/products", {
      sessao: p.sessao,
    });
    expect(semCabecalho.statusCode).toBe(400);
    // A chave não serve no caminho do Hub: lá só a sessão.
    const comChave = await h.app.inject({
      method: "GET",
      url: "/hub/products",
      headers: {
        authorization: `Bearer ${c.segredo}`,
        "eurolify-comerciante": `mer_${c.id}`,
      },
    });
    expect(comChave.statusCode).toBe(401);
    const deOutroSite = await h.app.inject({
      method: "GET",
      url: "/hub/products",
      headers: {
        cookie: `__Host-eurolify_sessao=${p.sessao}`,
        "eurolify-comerciante": `mer_${c.id}`,
        "sec-fetch-site": "cross-site",
      },
    });
    expect(deOutroSite.statusCode).toBe(403);
    // E a sessão não serve no GET /products: lá só a chave.
    const sessaoNaApi = await h.app.inject({
      method: "GET",
      url: "/products",
      headers: {
        cookie: `__Host-eurolify_sessao=${p.sessao}`,
        "eurolify-comerciante": `mer_${c.id}`,
      },
    });
    expect(sessaoNaApi.statusCode).toBe(401);
    // Desde a §14 do docs/22 (#221) o Hub cria artigos: o caminho existe
    // e um corpo sem variantes é recusado antes de escrever (os testes da
    // criação estão em hub-criacao.test.ts).
    const escreverNoHub = await h.pedir("POST", "/hub/products", {
      sessao: p.sessao,
      comerciante: c.id,
      corpo: { tipo: "fisico", nome: "Não entra" },
    });
    expect(escreverNoHub.statusCode).toBe(400);
    const escreverNaApi = await h.app.inject({
      method: "POST",
      url: "/products",
      headers: {
        cookie: `__Host-eurolify_sessao=${p.sessao}`,
        "eurolify-comerciante": `mer_${c.id}`,
        "content-type": "application/json",
      },
      payload: JSON.stringify({ tipo: "fisico", nome: "Não entra" }),
    });
    expect(escreverNaApi.statusCode).toBe(401);
    // Uma sessão terminada deixa de ler.
    const sair = await h.pedir("POST", "/hub/session/end", {
      sessao: p.sessao,
      corpo: {},
    });
    expect(sair.statusCode).toBe(200);
    const depoisDeSair = await h.pedir("GET", "/hub/products", {
      sessao: p.sessao,
      comerciante: c.id,
    });
    expect(depoisDeSair.statusCode).toBe(401);
    expect(depoisDeSair.body).not.toContain("Artigo");
  });

  it("um membro que saiu deixa de ler", async () => {
    const c = await comerciante("Loja Saida", ["Artigo"]);
    const p = await h.pessoaCom(c.id, "apoio");
    const eu = await h.pedir("GET", "/hub/me", { sessao: p.sessao });
    const membro =
      eu.json<{ comerciantes: { membro: string }[] }>().comerciantes[0]
        ?.membro ?? "";
    const sair = await h.pedir("POST", `/hub/members/${membro}/end`, {
      sessao: p.sessao,
      comerciante: c.id,
      corpo: {},
    });
    expect(sair.statusCode, sair.body).toBe(200);
    const depois = await h.pedir("GET", "/hub/products", {
      sessao: p.sessao,
      comerciante: c.id,
    });
    expect(depois.statusCode).toBe(403);
    expect(depois.body).not.toContain("Artigo");
  });

  it("o comerciante suspenso e o fechado lêem-se como pela chave (lê)", async () => {
    const c = await comerciante("Loja Suspensa", ["Artigo Parado"]);
    const p = await h.pessoaCom(c.id, "gestor");
    const ler = async () => {
      const hub = await h.pedir("GET", "/hub/products", {
        sessao: p.sessao,
        comerciante: c.id,
      });
      const api = await pelaChave(c.segredo, "");
      expect(hub.statusCode, hub.body).toBe(200);
      expect(api.statusCode).toBe(200);
      expect(hub.body).toContain("Artigo Parado");
      expect(hub.json()).toEqual(api.json());
    };
    await mudarEstado(base.api, c.id, {
      de: "rascunho",
      para: "suspenso",
      motivo: "teste",
      quem: "teste",
    });
    await ler();
    await mudarEstado(base.api, c.id, {
      de: "suspenso",
      para: "fechado",
      motivo: "teste",
      quem: "teste",
    });
    await ler();
  });

  it("um pedido recusado dá a mesma resposta nos dois caminhos (esquema e função)", async () => {
    const c = await comerciante("Loja Filtro", []);
    const p = await h.pessoaCom(c.id, "dono");
    const casos = [
      // Recusado pelo esquema, antes da função.
      "?estado=inventado",
      // Recusados pela própria listaDeArtigos (revisão do #201, P3-1).
      "?cursor=nao-e-um-cursor",
      "?actualizado_desde=0000-01-01T00:00:00Z",
      "?categoria=cat_00000000-0000-4000-8000-000000000000",
    ];
    for (const q of casos) {
      const hub = await h.pedir("GET", `/hub/products${q}`, {
        sessao: p.sessao,
        comerciante: c.id,
      });
      const api = await pelaChave(c.segredo, q);
      expect(hub.statusCode, `${q}: ${hub.body}`).toBeGreaterThanOrEqual(400);
      expect(hub.statusCode, q).toBe(api.statusCode);
      expect(h.codigo(hub), q).toBe(h.codigo(api));
    }
  });

  it("a ficha, as imagens, os bytes e as publicações são os mesmos pelo Hub e pela chave (#204)", async () => {
    const c = await comerciante("Loja Ficha", []);
    const { artigo, imagens } = await artigoCompleto(c);
    for (const papel of PAPEIS) {
      const p = await h.pessoaCom(c.id, papel);
      for (const caminho of [
        `/products/${artigo}`,
        `/products/${artigo}/media`,
        `/products/${artigo}/publications`,
      ]) {
        const hub = await h.pedir("GET", `/hub${caminho}`, {
          sessao: p.sessao,
          comerciante: c.id,
        });
        expect(hub.statusCode, `${papel} ${caminho}: ${hub.body}`).toBe(200);
        expect(hub.headers["cache-control"]).toBe("private, no-store");
        const api = await comChave(c.segredo, "GET", caminho);
        expect(hub.json()).toEqual(api.json());
      }
      for (const imagem of imagens) {
        const hub = await h.pedir("GET", `/hub/media/${imagem}/file`, {
          sessao: p.sessao,
          comerciante: c.id,
        });
        const api = await comChave(c.segredo, "GET", `/media/${imagem}/file`);
        // A rota pela chave fica como estava antes da extracção (revisão do
        // #206, P3-1): só o Hub muda o cache-control.
        expect(api.headers["cache-control"]).toBe("private, no-cache");
        expect(hub.headers["etag"]).toBe(api.headers["etag"]);
        expect(api.headers["etag"]).toMatch(/^"[0-9a-f]{64}"$/);
        expect(hub.statusCode, hub.body).toBe(200);
        expect(hub.rawPayload).toEqual(api.rawPayload);
        expect(hub.headers["content-type"]).toBe(api.headers["content-type"]);
        expect(hub.headers["x-content-type-options"]).toBe("nosniff");
        expect(hub.headers["content-security-policy"]).toBe(
          api.headers["content-security-policy"],
        );
        expect(hub.headers["cache-control"]).toBe("private, no-store");
      }
    }
    const p = await h.pessoaCom(c.id, "apoio");
    const ficha = await h.pedir("GET", `/hub/products/${artigo}`, {
      sessao: p.sessao,
      comerciante: c.id,
    });
    expect(ficha.json<{ variantes: unknown[] }>().variantes).toHaveLength(2);
    const media = await h.pedir("GET", `/hub/products/${artigo}/media`, {
      sessao: p.sessao,
      comerciante: c.id,
    });
    expect(
      media
        .json<{ dados: { texto_alternativo: string | null }[] }>()
        .dados.map((m) => m.texto_alternativo),
    ).toEqual(["Frasco de verniz azul", null]);
  });

  it("as publicações reais, publicada e depois arquivada, são as mesmas pelo Hub e pela chave (revisão do #206, P2-3)", async () => {
    const c = await comerciante("Loja Ficha Publicada", []);
    const { artigo, incompleto, versao } = await publicado(c);
    const p = await h.pessoaCom(c.id, "armazem");
    const comparar = async (de = artigo) => {
      const hub = await h.pedir("GET", `/hub/products/${de}/publications`, {
        sessao: p.sessao,
        comerciante: c.id,
      });
      const api = await comChave(
        c.segredo,
        "GET",
        `/products/${de}/publications`,
      );
      expect(hub.statusCode, hub.body).toBe(200);
      const dados = hub.json<{
        dados: {
          estado: string;
          motivo_arquivo: string | null;
          canal_nome?: string | null;
          mercado_nome?: string | null;
          loja_nome?: string | null;
        }[];
      }>().dados;
      // O Hub junta os três nomes (docs/22 §18.1, §19.1); o resto é
      // igual à rota pela chave, que não os tem.
      for (const d of dados) {
        expect(d.canal_nome).toBe("Loja online");
        expect(d.mercado_nome).toBe("Portugal");
        expect(d.loja_nome).toBe("Loja online");
      }
      const semNomes = dados.map((d) => {
        const copia = { ...d };
        delete copia.canal_nome;
        delete copia.mercado_nome;
        delete copia.loja_nome;
        return copia;
      });
      expect({ ...hub.json<object>(), dados: semNomes }).toEqual(api.json());
      for (const d of api.json<{ dados: object[] }>().dados) {
        expect(Object.keys(d)).not.toContain("canal_nome");
        expect(Object.keys(d)).not.toContain("mercado_nome");
        expect(Object.keys(d)).not.toContain("loja_nome");
      }
      return dados;
    };
    expect(await comparar(incompleto)).toMatchObject([
      { estado: "rascunho", motivo_arquivo: null },
    ]);
    expect(await comparar()).toMatchObject([
      { estado: "publicado", motivo_arquivo: null },
    ]);
    // Arquivar o artigo arquiva a publicação, com o motivo.
    const id = artigo.replace(/^prd_/, "");
    await mudarEstadoArtigo(base.api, c.id, id, await versao(id), "arquivado");
    expect(await comparar()).toMatchObject([
      { estado: "arquivado", motivo_arquivo: "artigo_arquivado" },
    ]);
  });

  it("as publicações no Hub trazem os nomes do canal, do mercado e da loja do comerciante, também arquivados (docs/22 §18, §19; #258, #271)", async () => {
    const a = await comerciante("Loja A Nomes", []);
    const b = await comerciante("Loja B Nomes", []);
    const deA = await publicado(a, {
      canal: "Loja online",
      mercado: "Portugal",
      loja: "Loja Norte",
    });
    // B tem um canal com o mesmo nome, um mercado e uma loja com outro.
    const deB = await publicado(b, {
      canal: "Loja online",
      mercado: "Espanha",
      loja: "Loja Sul",
    });
    const nomes = async (c: { id: string }, artigo: string) => {
      const p = await h.pessoaCom(c.id, "apoio");
      const r = await h.pedir("GET", `/hub/products/${artigo}/publications`, {
        sessao: p.sessao,
        comerciante: c.id,
      });
      expect(r.statusCode, r.body).toBe(200);
      return r
        .json<{
          dados: {
            canal: string;
            mercado: string;
            canal_nome: string | null;
            mercado_nome: string | null;
            loja_nome: string | null;
          }[];
        }>()
        .dados.map((d) => [
          d.canal,
          d.mercado,
          d.canal_nome,
          d.mercado_nome,
          d.loja_nome,
        ]);
    };
    expect(await nomes(a, deA.artigo)).toEqual([
      [
        `chn_${deA.canal}`,
        `mkt_${deA.mercado}`,
        "Loja online",
        "Portugal",
        "Loja Norte",
      ],
    ]);
    expect(await nomes(b, deB.artigo)).toEqual([
      [
        `chn_${deB.canal}`,
        `mkt_${deB.mercado}`,
        "Loja online",
        "Espanha",
        "Loja Sul",
      ],
    ]);
    // Um canal, um mercado e uma loja arquivados continuam com o nome
    // (§18.1, §19.1).
    const arquivada = await comComerciante(base.api, a.id, (trx) =>
      trx
        .updateTable("loja")
        .set({ estado: "arquivada" })
        .where("nome", "=", "Loja Norte")
        .executeTakeFirstOrThrow(),
    );
    expect(arquivada.numUpdatedRows).toBe(1n);
    const canal = await obterCanal(base.api, a.id, deA.canal);
    await mudarEstadoCanal(
      base.api,
      a.id,
      deA.canal,
      canal.versao,
      "arquivado",
    );
    const { versao: versaoMercado } = await comComerciante(
      base.api,
      a.id,
      (trx) =>
        trx
          .selectFrom("mercado")
          .select("versao")
          .where("id", "=", deA.mercado)
          .executeTakeFirstOrThrow(),
    );
    await mudarEstadoMercado(
      base.api,
      a.id,
      deA.mercado,
      versaoMercado,
      "arquivado",
    );
    expect(await nomes(a, deA.artigo)).toEqual([
      [
        `chn_${deA.canal}`,
        `mkt_${deA.mercado}`,
        "Loja online",
        "Portugal",
        "Loja Norte",
      ],
    ]);
    // Os ids de B, pedidos no contexto de A, não dão nomes nem a loja: nem
    // pela RLS (eurolify_api) nem pelo filtro escrito (com o dono, que
    // passa a RLS; sem o filtro do canal, este teste falha). A loja vem
    // pelo JOIN com o canal já filtrado: o filtro escrito na loja é uma
    // segunda guarda, que este teste não prova sozinha (revisão do #275,
    // P2-2).
    for (const db of [base.api, base.dono as Kysely<BaseDados>]) {
      const r = await nomesDeCanaisEMercados(
        db,
        a.id,
        [deB.canal, deA.canal],
        [deB.mercado, deA.mercado],
      );
      expect([...r.canais]).toEqual([[deA.canal, "Loja online"]]);
      expect([...r.mercados]).toEqual([[deA.mercado, "Portugal"]]);
      expect([...r.lojasDosCanais]).toEqual([[deA.canal, "Loja Norte"]]);
    }
  });

  it("o mesmo artigo em duas lojas do comerciante, cada uma com um canal «Loja online»: cada publicação traz a sua loja (docs/22 §19.1, #271)", async () => {
    const c = await comerciante("Loja Duas Lojas", []);
    const norte = await publicado(c, {
      canal: "Loja online",
      mercado: "Portugal",
      loja: "Loja Norte",
    });
    const id = norte.artigo.replace(/^prd_/, "");
    const quem = "pessoa:teste";
    // A segunda loja, com um canal e um mercado com os mesmos nomes.
    const lojaSul = await criarLoja(base.api, c.id, {
      entidade_legal_id: norte.entidade,
      nome: "Loja Sul",
    });
    const mercadoSul = await criarMercado(base.api, c.id, {
      loja_id: lojaSul,
      nome: "Portugal",
      paises: ["PT"],
      moeda: "EUR",
      linguas: ["pt"],
      lingua_principal: "pt",
    });
    const listaSul = await criarLista(base.api, c.id, {
      mercado_id: mercadoSul,
      nome: "Base Sul",
      tipo: "base",
    });
    await mudarEstadoMercado(base.api, c.id, mercadoSul, 1, "activo");
    const canalSul = await criarCanal(base.api, c.id, {
      loja_id: lojaSul,
      nome: "Loja online",
    });
    await definirMercadosDoCanal(base.api, c.id, canalSul, [mercadoSul]);
    const variantes = await comComerciante(base.api, c.id, (trx) =>
      trx
        .selectFrom("variante")
        .select("id")
        .where("artigo_id", "=", id)
        .execute(),
    );
    for (const v of variantes) {
      await definirPreco(base.api, c.id, quem, listaSul, v.id, {
        montante: 990,
      });
    }
    const r = await publicar(base.api, c.id, quem, {
      artigo_id: id,
      canal_id: canalSul,
      mercado_id: mercadoSul,
    });
    expect(r.publicada, JSON.stringify(r)).toBe(true);
    const p = await h.pessoaCom(c.id, "apoio");
    const resposta = await h.pedir(
      "GET",
      `/hub/products/${norte.artigo}/publications`,
      { sessao: p.sessao, comerciante: c.id },
    );
    expect(resposta.statusCode, resposta.body).toBe(200);
    const linhas = resposta
      .json<{
        dados: {
          canal: string;
          canal_nome: string | null;
          mercado_nome: string | null;
          loja_nome: string | null;
        }[];
      }>()
      .dados.map((d) => [d.canal, d.canal_nome, d.mercado_nome, d.loja_nome])
      .sort();
    expect(linhas).toEqual(
      [
        [`chn_${norte.canal}`, "Loja online", "Portugal", "Loja Norte"],
        [`chn_${canalSul}`, "Loja online", "Portugal", "Loja Sul"],
      ].sort(),
    );
  });

  /**
   * Um rascunho com as opções «Tamanho» (15 ml, 30 ml, 50 ml) e «Cor» (Azul),
   * as duas variantes de `artigoCompleto` sem valores, uma de 15 ml azul e
   * uma de 30 ml arquivada; os 50 ml não estão em nenhuma (docs/22 §20.3).
   */
  async function comOpcoes(c: { id: string; segredo: string }) {
    const { artigo } = await artigoCompleto(c);
    type Opcao = { id: string; valores: { id: string; valor: string }[] };
    const tamanho = await comChave(
      c.segredo,
      "POST",
      `/products/${artigo}/options`,
      { nome: "Tamanho", valores: ["15 ml", "30 ml", "50 ml"] },
    );
    expect(tamanho.statusCode, tamanho.body).toBe(201);
    const cor = await comChave(
      c.segredo,
      "POST",
      `/products/${artigo}/options`,
      {
        nome: "Cor",
        valores: ["Azul"],
      },
    );
    expect(cor.statusCode, cor.body).toBe(201);
    const [ml15, ml30, ml50] = tamanho.json<Opcao>().valores.map((v) => v.id);
    const azul = cor.json<Opcao>().valores[0]?.id ?? "";
    const variante = async (valores: string[]) => {
      const r = await comChave(
        c.segredo,
        "POST",
        `/products/${artigo}/variants`,
        { sku: `O-${randomUUID()}`, unidade_de_venda: "unidade", valores },
      );
      expect(r.statusCode, r.body).toBe(201);
      return r.json<{ id: string }>().id;
    };
    const v15 = await variante([ml15 ?? "", azul]);
    const v30 = await variante([ml30 ?? ""]);
    const arquivo = await comChave(
      c.segredo,
      "POST",
      `/variants/${v30}/archive`,
      {},
    );
    expect(arquivo.statusCode, arquivo.body).toBe(200);
    return { artigo, ml15, ml30, ml50, azul, v15, v30 };
  }

  type OpcaoNoHub = {
    id: string;
    nome: string;
    valores: { id: string; valor: string; variantes?: string[] }[];
  };

  it("as opções no Hub são as da chave, cada valor com as variantes que o têm, também as arquivadas (docs/22 §20.1)", async () => {
    const c = await comerciante("Loja Opcoes", []);
    const o = await comOpcoes(c);
    for (const papel of PAPEIS) {
      const p = await h.pessoaCom(c.id, papel);
      for (const consulta of ["", "?limite=1"]) {
        const caminho = `/products/${o.artigo}/options${consulta}`;
        const hub = await h.pedir("GET", `/hub${caminho}`, {
          sessao: p.sessao,
          comerciante: c.id,
        });
        expect(hub.statusCode, `${papel} ${caminho}: ${hub.body}`).toBe(200);
        expect(hub.headers["cache-control"]).toBe("private, no-store");
        const api = await comChave(c.segredo, "GET", caminho);
        expect(api.statusCode, api.body).toBe(200);
        const corpo = hub.json<{ dados: OpcaoNoHub[] }>();
        // Sem as `variantes`, é exactamente a resposta da chave.
        expect({
          ...corpo,
          dados: corpo.dados.map((d) => ({
            ...d,
            valores: d.valores.map((v) => ({ id: v.id, valor: v.valor })),
          })),
        }).toEqual(api.json());
        // Que a chave não as dá prova-o o contrato (o Fastify tira do corpo o
        // que o esquema não tem; revisão do #281, P3-5).
      }
    }
    const p = await h.pessoaCom(c.id, "apoio");
    const r = await h.pedir("GET", `/hub/products/${o.artigo}/options`, {
      sessao: p.sessao,
      comerciante: c.id,
    });
    expect(
      r
        .json<{ dados: OpcaoNoHub[] }>()
        .dados.map((d) => [
          d.nome,
          d.valores.map((v) => [v.valor, v.variantes]),
        ]),
    ).toEqual([
      [
        "Tamanho",
        [
          ["15 ml", [o.v15]],
          // A arquivada aparece no seu valor.
          ["30 ml", [o.v30]],
          // Um valor que nenhuma variante usa: a lista vazia.
          ["50 ml", []],
        ],
      ],
      ["Cor", [["Azul", [o.v15]]]],
    ]);
  });

  it("as variantes de outro comerciante não entram nos valores, nem pela RLS nem pelo filtro escrito (docs/22 §20.3)", async () => {
    const a = await comerciante("Loja Opcoes A", []);
    const b = await comerciante("Loja Opcoes B", []);
    const deA = await comOpcoes(a);
    const deB = await comOpcoes(b);
    const sem = (x: string) => x.replace(/^[a-z]+_/, "");
    // Uma linha de B que aponta para o valor «50 ml» de A. As chaves
    // compostas não a deixam existir; só sem elas (modo réplica, só neste
    // teste) se pode provar o filtro escrito: com o dono, que passa a RLS,
    // sem o `comerciante_id` na leitura este teste falha.
    const ml50 = sem(deA.ml50 ?? "");
    const linhaDeB = {
      comerciante_id: b.id,
      artigo_id: sem(deB.artigo),
      variante_id: sem(deB.v15),
      opcao_id: randomUUID(),
      valor_id: ml50,
    };
    await (base.dono as Kysely<BaseDados>)
      .transaction()
      .execute(async (trx) => {
        await sql`set local session_replication_role = replica`.execute(trx);
        await trx.insertInto("variante_valor").values(linhaDeB).execute();
      });
    try {
      for (const db of [base.api, base.dono as Kysely<BaseDados>]) {
        const r = await opcoesDoArtigoPaginadas(
          db,
          a.id,
          sem(deA.artigo),
          100,
          null,
          true,
        );
        const valores = r.dados.flatMap((d) => d.valores);
        expect(valores.find((v) => v.id === ml50)?.variantes).toEqual([]);
        expect(JSON.stringify(r)).not.toContain(sem(deB.v15));
      }
    } finally {
      // Também sem os gatilhos, como entrou.
      await (base.dono as Kysely<BaseDados>)
        .transaction()
        .execute(async (trx) => {
          await sql`set local session_replication_role = replica`.execute(trx);
          await trx
            .deleteFrom("variante_valor")
            .where("comerciante_id", "=", b.id)
            .where("valor_id", "=", ml50)
            .execute();
        });
    }
  });

  it("a ficha e as imagens de outro comerciante não saem pelo Hub (#204)", async () => {
    const a = await comerciante("Loja A Ficha", []);
    const b = await comerciante("Loja B Ficha", []);
    const deB = await artigoCompleto(b);
    const p = await h.pessoaCom(a.id, "dono");
    // Com o cabeçalho de A, o artigo de B não existe.
    for (const caminho of [
      `/hub/products/${deB.artigo}`,
      `/hub/products/${deB.artigo}/media`,
      `/hub/products/${deB.artigo}/publications`,
      `/hub/products/${deB.artigo}/options`,
      `/hub/media/${deB.imagens[0] ?? ""}/file`,
    ]) {
      const r = await h.pedir("GET", caminho, {
        sessao: p.sessao,
        comerciante: a.id,
      });
      expect(r.statusCode, `${caminho}: ${r.body}`).toBe(404);
      expect(r.body).not.toContain("Verniz Completo");
      expect(r.rawPayload.includes(PNG)).toBe(false);
      // Com o cabeçalho de B, sem ser membro de B, nem chega à função.
      const comB = await h.pedir("GET", caminho, {
        sessao: p.sessao,
        comerciante: b.id,
      });
      expect(comB.statusCode, caminho).toBe(403);
    }
    // Sem sessão, recusado.
    const semSessao = await h.pedir("GET", `/hub/products/${deB.artigo}`, {
      comerciante: b.id,
    });
    expect(semSessao.statusCode).toBe(401);
  });

  it("sem cabeçalho, membro que saiu e sessão terminada não lêem a ficha (#204)", async () => {
    const c = await comerciante("Loja Ficha Saida", []);
    const { artigo, imagens } = await artigoCompleto(c);
    const caminhos = [
      `/hub/products/${artigo}`,
      `/hub/products/${artigo}/media`,
      `/hub/products/${artigo}/publications`,
      `/hub/media/${imagens[0] ?? ""}/file`,
    ];
    const recusados = async (sessao: string, estado: number) => {
      for (const caminho of caminhos) {
        const r = await h.pedir("GET", caminho, { sessao, comerciante: c.id });
        expect(r.statusCode, `${caminho}: ${r.body}`).toBe(estado);
        expect(r.body).not.toContain("Verniz Completo");
        expect(r.rawPayload.includes(PNG)).toBe(false);
      }
    };
    // Sem o cabeçalho Eurolify-Comerciante.
    const semCabecalho = await h.pessoaCom(c.id, "dono");
    for (const caminho of caminhos) {
      const r = await h.pedir("GET", caminho, { sessao: semCabecalho.sessao });
      expect(r.statusCode, caminho).toBe(400);
    }
    // Um membro que saiu.
    const p = await h.pessoaCom(c.id, "apoio");
    const eu = await h.pedir("GET", "/hub/me", { sessao: p.sessao });
    const membro =
      eu.json<{ comerciantes: { membro: string }[] }>().comerciantes[0]
        ?.membro ?? "";
    const sair = await h.pedir("POST", `/hub/members/${membro}/end`, {
      sessao: p.sessao,
      comerciante: c.id,
      corpo: {},
    });
    expect(sair.statusCode, sair.body).toBe(200);
    await recusados(p.sessao, 403);
    // Uma sessão terminada.
    const q = await h.pessoaCom(c.id, "gestor");
    const fim = await h.pedir("POST", "/hub/session/end", {
      sessao: q.sessao,
      corpo: {},
    });
    expect(fim.statusCode).toBe(200);
    await recusados(q.sessao, 401);
  });

  it("o /hub/me dá, por comerciante, os âmbitos do papel lidos da base (docs/22 §13.2)", async () => {
    const c = await comerciante("Loja Ambitos", []);
    for (const papel of PAPEIS) {
      const p = await h.pessoaCom(c.id, papel);
      const eu = await h.pedir("GET", "/hub/me", { sessao: p.sessao });
      expect(eu.statusCode, eu.body).toBe(200);
      const meu = eu
        .json<{ comerciantes: { comerciante: string; ambitos: string[] }[] }>()
        .comerciantes.find((x) => x.comerciante === `mer_${c.id}`);
      const { rows } = await sql<{
        ambitos: string[];
      }>`select papel_ambitos(${papel}) as ambitos`.execute(base.dono);
      expect(meu?.ambitos, papel).toEqual(rows[0]?.ambitos);
    }
    // A mesma pessoa, dona de um comerciante e de apoio noutro: cada um com
    // os âmbitos do seu papel (revisão do #212, P2-1 e P2-2).
    const outro = await comerciante("Loja Ambitos B", []);
    const dona = await h.pessoaCom(c.id, "dono");
    await sql`insert into membro (comerciante_id, pessoa_id, papel, convidado_por)
      values (${outro.id}::uuid, ${dona.pessoa}::uuid, 'apoio', 'operador:teste')`.execute(
      base.dono,
    );
    const eu = await h.pedir("GET", "/hub/me", { sessao: dona.sessao });
    const porComerciante = new Map(
      eu
        .json<{
          comerciantes: { comerciante: string; ambitos: string[] }[];
        }>()
        .comerciantes.map((x) => [x.comerciante, x.ambitos]),
    );
    expect(porComerciante.get(`mer_${c.id}`)).toContain("catalog:write");
    expect(porComerciante.get(`mer_${outro.id}`)).not.toContain(
      "catalog:write",
    );
    expect(porComerciante.get(`mer_${outro.id}`)).toContain("catalog:read");
  });

  it("um âmbito que esta versão da API não conhece fica de fora do /hub/me (revisão do #212, P1-1)", () => {
    expect(
      ambitosConhecidos(["catalog:read", "catalog:futuro", "catalog:write"]),
    ).toEqual(["catalog:read", "catalog:write"]);
    expect(ambitosConhecidos(null)).toEqual([]);
    expect(ambitosConhecidos(undefined)).toEqual([]);
  });

  it("o contrato tem o caminho do Hub com a segurança da sessão e a resposta da lista", async () => {
    const r = await h.app.inject({ method: "GET", url: "/openapi.json" });
    const contrato = r.json<{
      paths: Record<
        string,
        Record<string, { security?: unknown; responses?: unknown }>
      >;
    }>();
    const hub = contrato.paths["/hub/products"]?.["get"];
    const api = contrato.paths["/products"]?.["get"];
    expect(hub?.security).toEqual([{ sessao: [] }]);
    expect(api?.security).toEqual([{ chave: [] }]);
    for (const caminho of [
      "/products/{id}",
      "/products/{id}/media",
      "/media/{id}/file",
    ]) {
      const doHub = contrato.paths[`/hub${caminho}`]?.["get"];
      const daApi = contrato.paths[caminho]?.["get"];
      expect(doHub?.security, caminho).toEqual([{ sessao: [] }]);
      expect(JSON.stringify(doHub?.responses), caminho).toBe(
        JSON.stringify(daApi?.responses),
      );
    }
    // As publicações do Hub têm os três nomes; as da chave não (§18.1,
    // §19.1).
    // Os campos de cada publicação (as chaves do esquema, não o texto).
    const campos = (caminho: string) => {
      const respostas = contrato.paths[caminho]?.["get"]?.responses as
        | Record<
            string,
            {
              content?: Record<
                string,
                {
                  schema?: {
                    properties?: {
                      dados?: { items?: { properties?: object } };
                    };
                  };
                }
              >;
            }
          >
        | undefined;
      return Object.keys(
        respostas?.["200"]?.content?.["application/json"]?.schema?.properties
          ?.dados?.items?.properties ?? {},
      ).sort();
    };
    const daChave = campos("/products/{id}/publications");
    expect(daChave).toContain("canal");
    expect(daChave).not.toContain("canal_nome");
    expect(daChave).not.toContain("mercado_nome");
    expect(daChave).not.toContain("loja_nome");
    expect(campos("/hub/products/{id}/publications")).toEqual(
      [...daChave, "canal_nome", "loja_nome", "mercado_nome"].sort(),
    );
    expect(
      contrato.paths["/hub/products/{id}/publications"]?.["get"]?.security,
    ).toEqual([{ sessao: [] }]);
    // As opções do Hub têm as `variantes` em cada valor; as da chave não
    // (docs/22 §20.1).
    const camposDosValores = (caminho: string) => {
      const esquema = (
        contrato.paths[caminho]?.["get"]?.responses as
          | Record<string, { content?: Record<string, { schema?: unknown }> }>
          | undefined
      )?.["200"]?.content?.["application/json"]?.schema as
        | {
            properties?: {
              dados?: {
                items?: {
                  properties?: {
                    valores?: { items?: { properties?: object } };
                  };
                };
              };
            };
          }
        | undefined;
      return Object.keys(
        esquema?.properties?.dados?.items?.properties?.valores?.items
          ?.properties ?? {},
      ).sort();
    };
    const valoresDaChave = camposDosValores("/products/{id}/options");
    expect(valoresDaChave).toEqual(["id", "valor"]);
    expect(camposDosValores("/hub/products/{id}/options")).toEqual([
      "id",
      "valor",
      "variantes",
    ]);
    expect(campos("/hub/products/{id}/options")).toEqual(
      campos("/products/{id}/options"),
    );
    expect(
      contrato.paths["/hub/products/{id}/options"]?.["get"]?.security,
    ).toEqual([{ sessao: [] }]);
    expect(
      JSON.stringify(
        (hub?.responses as Record<string, unknown> | undefined)?.["200"],
      ),
    ).toBe(
      JSON.stringify(
        (api?.responses as Record<string, unknown> | undefined)?.["200"],
      ),
    );
  });
});
