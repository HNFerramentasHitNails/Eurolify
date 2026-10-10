import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { sql, type Kysely } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BaseDados } from "../src/base/esquema.js";
import {
  alterarVariante,
  criarArtigo,
  noCatalogo,
} from "../src/catalogo/repositorio.js";
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
import { hubDeTeste } from "./hub-de-teste.js";

// Alterar uma variante (docs/14 §7.1, «Alterar uma variante»; docs/22 §23;
// issue #301): o PATCH /variants/{id} e o PATCH /hub/variants/{id}, contra o
// PostgreSQL 18.

/** Um EAN-13 com o dígito de controlo certo, e outro. */
const GTIN = "4006381333931";
const OUTRO_GTIN = "5901234123457";

interface Variante {
  id: string;
  sku: string;
  estado: string;
  artigo: string;
  unidade_de_venda: string;
  gtin: string | null;
  gtin_origem: string | null;
  conteudo_quantidade: number | null;
  conteudo_unidade: string | null;
  peso_g: number | null;
  comprimento_mm: number | null;
  onu: string | null;
  classe_adr: string | null;
  posicao: number;
  versao: number;
}
interface Ficha {
  id: string;
  versao: number;
  estado: string;
  variantes: Variante[];
}

const ENTIDADE = {
  denominacao: "Exemplo, Lda.",
  forma_juridica: "sociedade por quotas",
  pais: "PT",
  numero_fiscal: "123456789",
  morada_linha: "Rua de Teste, 1",
  morada_codigo_postal: "1000-001",
  morada_localidade: "Lisboa",
};

describe.skipIf(URL_BASE === undefined)("alterar uma variante (#301)", () => {
  let base: BaseDeTeste;
  let h: ReturnType<typeof hubDeTeste>;

  /** Um comerciante com uma chave de escrita e outra de publicação. */
  async function comerciante(nome: string) {
    const id = await registarComerciante(base.api, {
      nome,
      lingua: "pt",
      fuso: "Europe/Lisbon",
    });
    const chaveCom = async (ambitos: string[]) =>
      (
        await criarChave(base.dono, id, {
          tipo: "servidor",
          criadaPor: "operador:teste",
          nome: ambitos.join(" "),
          ambitos: ambitos as never,
        })
      ).segredo;
    return {
      id,
      segredo: await chaveCom([
        "catalog:read",
        "catalog:write",
        "catalog:history",
      ]),
      publicar: await chaveCom(["catalog:publish"]),
      leitura: await chaveCom(["catalog:read"]),
    };
  }

  const chave = (
    segredo: string,
    metodo: "GET" | "POST" | "PUT" | "PATCH",
    url: string,
    corpo?: unknown,
    idempotencia: string = randomUUID(),
  ) =>
    h.app.inject({
      method: metodo,
      url,
      headers: {
        authorization: `Bearer ${segredo}`,
        ...(metodo === "GET" ? {} : { "idempotency-key": idempotencia }),
        ...(corpo === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(corpo === undefined ? {} : { payload: JSON.stringify(corpo) }),
    });

  /** Um rascunho com duas variantes; activo, se pedido. */
  async function artigo(segredo: string, activar = false) {
    const r = await chave(segredo, "POST", "/products", {
      tipo: "fisico",
      nome: "Verniz Rosa 2",
      categoria_fiscal: "normal",
      variantes: [
        // A ordem da ficha é a posição e o SKU: a primeira é a sem peso.
        { sku: `ENS-A-${randomUUID()}`, unidade_de_venda: "unidade" },
        {
          sku: `ENS-B-${randomUUID()}`,
          unidade_de_venda: "unidade",
          peso_g: 60,
        },
      ],
    });
    expect(r.statusCode, r.body).toBe(201);
    let f = r.json<Ficha>();
    if (activar) {
      const c = await chave(
        segredo,
        "PUT",
        `/products/${f.id}/classification`,
        {
          versao: f.versao,
          familias: ["retalho_geral"],
          natureza_consumidor: "bem",
        },
      );
      expect(c.statusCode, c.body).toBe(200);
      const a = await chave(segredo, "POST", `/products/${f.id}/activate`, {
        versao: c.json<Ficha>().versao,
      });
      expect(a.statusCode, a.body).toBe(200);
      f = a.json<Ficha>();
    }
    return f;
  }

  const variante = async (segredo: string, id: string) =>
    (await chave(segredo, "GET", `/variants/${id}`)).json<Variante>();

  beforeAll(async () => {
    base = await criarBaseDeTeste(URL_BASE ?? "");
    h = hubDeTeste(base);
  }, 60_000);

  afterAll(async () => {
    await h.app.close();
    await base.fechar();
  });

  it("num rascunho: muda tudo menos o SKU, na versão lida; a versão sobe uma vez; sem nada para mudar, fica; a versão antiga dá 409 e nada muda", async () => {
    const c = await comerciante("Loja Variante Rascunho");
    const f = await artigo(c.segredo);
    const v = f.variantes[0];
    expect(v?.versao).toBe(1);
    const url = `/variants/${v?.id ?? ""}`;
    const r = await chave(c.segredo, "PATCH", url, {
      versao: 1,
      unidade_de_venda: "embalagem",
      conteudo_quantidade: 15,
      conteudo_unidade: "ml",
      peso_g: 60,
      comprimento_mm: 30,
      largura_mm: 30,
      altura_mm: 90,
      gtin: GTIN,
      gtin_origem: "fornecedor",
      onu: "UN1263",
      classe_adr: "3",
      posicao: 5,
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json<Variante>()).toMatchObject({
      sku: v?.sku,
      unidade_de_venda: "embalagem",
      conteudo_quantidade: 15,
      conteudo_unidade: "ml",
      peso_g: 60,
      comprimento_mm: 30,
      gtin: GTIN,
      gtin_origem: "fornecedor",
      onu: "UN1263",
      classe_adr: "3",
      posicao: 5,
      versao: 2,
      artigo: f.id,
    });
    expect(await variante(c.segredo, v?.id ?? "")).toEqual(r.json());
    // Na ficha do artigo, a versão nova também.
    const ficha = (
      await chave(c.segredo, "GET", `/products/${f.id}`)
    ).json<Ficha>();
    expect(ficha.variantes.find((x) => x.id === v?.id)?.versao).toBe(2);
    // Só a versão: nada muda, e a versão fica.
    const nada = await chave(c.segredo, "PATCH", url, { versao: 2 });
    expect(nada.statusCode, nada.body).toBe(200);
    expect(nada.json<Variante>().versao).toBe(2);
    // O mesmo valor que já tem: também não sobe.
    const igual = await chave(c.segredo, "PATCH", url, {
      versao: 2,
      peso_g: 60,
    });
    expect(igual.json<Variante>().versao).toBe(2);
    // Com a versão de antes: 409, e o peso fica.
    const velha = await chave(c.segredo, "PATCH", url, {
      versao: 1,
      peso_g: 70,
    });
    expect(velha.statusCode).toBe(409);
    expect(h.codigo(velha)).toBe("catalog.version_conflict");
    expect((await variante(c.segredo, v?.id ?? "")).peso_g).toBe(60);
    // Tirar o GTIN leva os dois a nulo.
    const semGtin = await chave(c.segredo, "PATCH", url, {
      versao: 2,
      gtin: null,
      gtin_origem: null,
    });
    expect(semGtin.statusCode, semGtin.body).toBe(200);
    expect(semGtin.json<Variante>()).toMatchObject({
      gtin: null,
      gtin_origem: null,
      versao: 3,
    });
  });

  it("depois de activo: o peso, o GTIN e o resto mudam; a unidade e o conteúdo dão catalog.not_draft, e nada do pedido se grava", async () => {
    const c = await comerciante("Loja Variante Activa");
    const f = await artigo(c.segredo, true);
    expect(f.estado).toBe("activo");
    const v = f.variantes[0];
    const url = `/variants/${v?.id ?? ""}`;
    const peso = await chave(c.segredo, "PATCH", url, {
      versao: v?.versao,
      peso_g: 60,
      gtin: GTIN,
      gtin_origem: "gs1_comerciante",
      onu: "UN1263",
    });
    expect(peso.statusCode, peso.body).toBe(200);
    const versao = peso.json<Variante>().versao;
    for (const corpo of [
      { unidade_de_venda: "par" },
      { conteudo_quantidade: 15, conteudo_unidade: "ml" },
      { peso_g: 70, conteudo_quantidade: 15, conteudo_unidade: "ml" },
    ]) {
      const r = await chave(c.segredo, "PATCH", url, { versao, ...corpo });
      expect(r.statusCode, JSON.stringify(corpo)).toBe(409);
      expect(h.codigo(r)).toBe("catalog.not_draft");
    }
    const depois = await variante(c.segredo, v?.id ?? "");
    expect(depois).toMatchObject({
      unidade_de_venda: "unidade",
      conteudo_quantidade: null,
      peso_g: 60,
      versao,
    });
  });

  it("as recusas: o SKU não vem; o GTIN sem a origem (ou ao contrário), repetido ou com o dígito errado; uma variante arquivada; um campo mal escrito", async () => {
    const c = await comerciante("Loja Variante Recusas");
    const f = await artigo(c.segredo);
    const [v1, v2] = f.variantes;
    const url = `/variants/${v1?.id ?? ""}`;
    const sku = await chave(c.segredo, "PATCH", url, {
      versao: 1,
      sku: "OUTRO",
    });
    expect(sku.statusCode).toBe(400);
    for (const corpo of [
      { gtin: GTIN },
      { gtin_origem: "interno" },
      { gtin: GTIN, gtin_origem: null },
      { gtin: null, gtin_origem: "interno" },
    ]) {
      const r = await chave(c.segredo, "PATCH", url, { versao: 1, ...corpo });
      expect(r.statusCode, JSON.stringify(corpo)).toBe(400);
    }
    const daOutra = await chave(
      c.segredo,
      "PATCH",
      `/variants/${v2?.id ?? ""}`,
      {
        versao: 1,
        gtin: OUTRO_GTIN,
        gtin_origem: "fornecedor",
      },
    );
    expect(daOutra.statusCode, daOutra.body).toBe(200);
    const repetido = await chave(c.segredo, "PATCH", url, {
      versao: 1,
      gtin: `0${OUTRO_GTIN}`,
      gtin_origem: "fornecedor",
    });
    expect(h.codigo(repetido)).toBe("catalog.gtin_duplicate");
    const digito = await chave(c.segredo, "PATCH", url, {
      versao: 1,
      gtin: "4006381333932",
      gtin_origem: "fornecedor",
    });
    expect(h.codigo(digito)).toBe("catalog.gtin_invalid");
    for (const corpo of [
      { peso_g: 0 },
      { onu: "1263" },
      { unidade_de_venda: "litro" },
      { conteudo_quantidade: 15 },
    ]) {
      const r = await chave(c.segredo, "PATCH", url, { versao: 1, ...corpo });
      expect(r.statusCode, JSON.stringify(corpo)).toBeGreaterThanOrEqual(400);
      expect(r.statusCode, JSON.stringify(corpo)).toBeLessThan(500);
    }
    expect((await variante(c.segredo, v1?.id ?? "")).versao).toBe(1);
    // Arquivada: sobe a versão ao arquivar e já não muda.
    const arq = await chave(c.segredo, "POST", `${url}/archive`);
    expect(arq.statusCode, arq.body).toBe(200);
    expect(arq.json<Variante>().versao).toBe(2);
    // Com a versão actual ou com uma antiga: é final, não um conflito
    // (revisão do #306, P3-1).
    for (const versao of [2, 1]) {
      const depois = await chave(c.segredo, "PATCH", url, {
        versao,
        peso_g: 10,
      });
      expect(h.codigo(depois), String(versao)).toBe(
        "catalog.variant_archived_is_final",
      );
    }
  });

  it("o peso de uma variante à venda não se apaga (catalog.published_in_use); muda-se, e uma que não está à venda perde-o", async () => {
    const c = await comerciante("Loja Variante Publicada");
    const entidade = await criarEntidadeLegal(base.api, c.id, ENTIDADE);
    const loja = await criarLoja(base.api, c.id, {
      entidade_legal_id: entidade,
      nome: "Loja online",
    });
    const mercado = await criarMercado(base.api, c.id, {
      loja_id: loja,
      nome: "Portugal",
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
      nome: "Loja online",
    });
    await definirMercadosDoCanal(base.api, c.id, canal, [mercado]);
    const f = await artigo(c.segredo, true);
    const [v1, v2] = f.variantes;
    // A primeira sem peso: a publicação diz «peso em falta»; dar-lho resolve.
    for (const v of [v1, v2]) {
      await definirPreco(
        base.api,
        c.id,
        "pessoa:teste",
        lista,
        (v?.id ?? "").slice("var_".length),
        { montante: 990 },
      );
    }
    const publicar = () =>
      chave(c.publicar, "POST", `/products/${f.id}/publications`, {
        canal: `chn_${canal}`,
        mercado: `mkt_${mercado}`,
      });
    const antes = await publicar();
    expect(antes.json<{ publicada: boolean }>().publicada).toBe(false);
    expect(antes.body).toContain("peso_em_falta");
    const peso = await chave(c.segredo, "PATCH", `/variants/${v1?.id ?? ""}`, {
      versao: v1?.versao,
      peso_g: 60,
    });
    expect(peso.statusCode, peso.body).toBe(200);
    const depois = await publicar();
    expect(depois.json<{ publicada: boolean }>().publicada, depois.body).toBe(
      true,
    );
    const versao = peso.json<Variante>().versao;
    const apagar = await chave(
      c.segredo,
      "PATCH",
      `/variants/${v1?.id ?? ""}`,
      {
        versao,
        peso_g: null,
      },
    );
    expect(apagar.statusCode).toBe(409);
    expect(h.codigo(apagar)).toBe("catalog.published_in_use");
    const mudar = await chave(c.segredo, "PATCH", `/variants/${v1?.id ?? ""}`, {
      versao,
      peso_g: 65,
    });
    expect(mudar.statusCode, mudar.body).toBe(200);
    // Uma variante nova nasce fora da publicação: pode perder o peso.
    const nova = await chave(c.segredo, "POST", `/products/${f.id}/variants`, {
      sku: `ENS-${randomUUID()}`,
      unidade_de_venda: "unidade",
      peso_g: 10,
    });
    const fora = nova.json<Variante>();
    const semPeso = await chave(c.segredo, "PATCH", `/variants/${fora.id}`, {
      versao: fora.versao,
      peso_g: null,
    });
    expect(semPeso.statusCode, semPeso.body).toBe(200);
  });

  it("duas alterações ao mesmo tempo com a mesma versão: uma entra, a outra dá 409", async () => {
    const c = await comerciante("Loja Variante Corrida");
    const f = await artigo(c.segredo);
    const url = `/variants/${f.variantes[0]?.id ?? ""}`;
    const [a, b] = await Promise.all([
      chave(c.segredo, "PATCH", url, { versao: 1, peso_g: 10 }),
      chave(c.segredo, "PATCH", url, { versao: 1, peso_g: 20 }),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    const ganhou = a.statusCode === 200 ? 10 : 20;
    expect(await variante(c.segredo, f.variantes[0]?.id ?? "")).toMatchObject({
      peso_g: ganhou,
      versao: 2,
    });
  });

  it("a mesma Idempotency-Key devolve a mesma resposta sem mudar outra vez", async () => {
    const c = await comerciante("Loja Variante Idempotencia");
    const f = await artigo(c.segredo);
    const url = `/variants/${f.variantes[0]?.id ?? ""}`;
    const k = randomUUID();
    const r1 = await chave(
      c.segredo,
      "PATCH",
      url,
      { versao: 1, peso_g: 10 },
      k,
    );
    const r2 = await chave(
      c.segredo,
      "PATCH",
      url,
      { versao: 1, peso_g: 10 },
      k,
    );
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    expect(r2.json()).toEqual(r1.json());
    expect((await variante(c.segredo, f.variantes[0]?.id ?? "")).versao).toBe(
      2,
    );
  });

  it("a versão: nunca o valor que quem escreve lá puser; sobe só com uma mudança", async () => {
    const c = await comerciante("Loja Variante Versao");
    const f = await artigo(c.segredo);
    const id = (f.variantes[0]?.id ?? "").slice("var_".length);
    const versao = () =>
      comComerciante(base.api, c.id, async (trx) => {
        await sql`select set_config('eurolify.quem', 'teste:sql', true)`.execute(
          trx,
        );
        return (
          await sql<{ versao: number }>`
            select versao from variante where id = ${id}::uuid`.execute(trx)
        ).rows[0]?.versao;
      });
    const escrever = (consulta: ReturnType<typeof sql>) =>
      comComerciante(base.api, c.id, async (trx) => {
        await sql`select set_config('eurolify.quem', 'teste:sql', true)`.execute(
          trx,
        );
        await consulta.execute(trx);
      });
    await escrever(sql`update variante set versao = 99 where id = ${id}::uuid`);
    expect(await versao()).toBe(1);
    await escrever(
      sql`update variante set versao = 99, peso_g = 5 where id = ${id}::uuid`,
    );
    expect(await versao()).toBe(2);
  });

  it("a base recusa a unidade fora do rascunho também no SQL escrito à mão", async () => {
    const c = await comerciante("Loja Variante SQL");
    const f = await artigo(c.segredo, true);
    const id = (f.variantes[0]?.id ?? "").slice("var_".length);
    const r = await comComerciante(base.api, c.id, async (trx) => {
      await sql`select set_config('eurolify.quem', 'teste:sql', true)`.execute(
        trx,
      );
      await sql`update variante set unidade_de_venda = 'par' where id = ${id}::uuid`.execute(
        trx,
      );
    }).then(
      () => "sem erro",
      (e: unknown) => (e as Error).message,
    );
    expect(r).toContain("catalog.not_draft");
  });

  it("outro comerciante não chega à variante de A, nem pela chave, nem pela função (com o dono, que passa a RLS); catalog:read não escreve", async () => {
    const a = await comerciante("Loja Variante A");
    const b = await comerciante("Loja Variante B");
    const f = await artigo(a.segredo);
    const v = f.variantes[0]?.id ?? "";
    const r = await chave(b.segredo, "PATCH", `/variants/${v}`, {
      versao: 1,
      peso_g: 10,
    });
    expect(r.statusCode, r.body).toBe(404);
    const leitura = await chave(a.leitura, "PATCH", `/variants/${v}`, {
      versao: 1,
      peso_g: 10,
    });
    expect(leitura.statusCode).toBe(403);
    const dono = base.dono as Kysely<BaseDados>;
    const pelaFuncao = await noCatalogo(dono, b.id, (trx) =>
      alterarVariante(trx, b.id, v.slice("var_".length), 1, { peso_g: 10 }),
    ).then(
      () => "sem erro",
      (e: unknown) => (e as { codigo?: string }).codigo,
    );
    expect(pelaFuncao).toBe("catalog.not_found");
    expect((await variante(a.segredo, v)).peso_g).toBeNull();
  });

  /** Um cliente da API com uma transacção aberta, do comerciante dado. */
  async function transaccaoAberta(comercianteId: string) {
    const cliente = new pg.Client({ connectionString: base.urlApi });
    cliente.on("error", () => undefined);
    await cliente.connect();
    await cliente.query("begin");
    await cliente.query("select set_config('eurolify.comerciante', $1, true)", [
      comercianteId,
    ]);
    await cliente.query(
      "select set_config('eurolify.quem', 'teste:preso', true)",
    );
    return cliente;
  }

  /** Espera até haver um pedido à espera de um bloqueio na base. */
  async function aEsperaDeBloqueio() {
    for (let i = 0; i < 100; i++) {
      const { rows } = await sql<{ n: number }>`
        select count(*)::int as n from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'
          and query ilike '%"variante"%'`.execute(base.dono);
      if ((rows[0]?.n ?? 0) > 0) return true;
      await new Promise((r) => {
        setTimeout(r, 50);
      });
    }
    return false;
  }

  it("com a variante presa por outro: a espera acaba em 503 catalog.retry ao fim de 5 s, e nada muda (revisão do #306, P2-1)", async () => {
    const c = await comerciante("Loja Variante Presa");
    const f = await artigo(c.segredo);
    const v = f.variantes[0]?.id ?? "";
    const cliente = await transaccaoAberta(c.id);
    try {
      await cliente.query("select id from variante where id = $1 for update", [
        v.slice("var_".length),
      ]);
      const inicio = Date.now();
      const r = await chave(c.segredo, "PATCH", `/variants/${v}`, {
        versao: 1,
        peso_g: 10,
      });
      expect(r.statusCode, r.body).toBe(503);
      expect(h.codigo(r)).toBe("catalog.retry");
      expect(r.headers["retry-after"]).toBe("1");
      expect(Date.now() - inicio).toBeLessThan(8000);
    } finally {
      await cliente.query("rollback").catch(() => undefined);
      await cliente.end();
    }
    expect((await variante(c.segredo, v)).peso_g).toBeNull();
  }, 20_000);

  it("activar e mudar a unidade ao mesmo tempo: quem muda espera pela activação e recebe catalog.not_draft (revisão do #306, P3-3a)", async () => {
    const c = await comerciante("Loja Variante Corrida Activar");
    const f = await artigo(c.segredo);
    const cl = await chave(
      c.segredo,
      "PUT",
      `/products/${f.id}/classification`,
      {
        versao: f.versao,
        familias: ["retalho_geral"],
        natureza_consumidor: "bem",
      },
    );
    expect(cl.statusCode, cl.body).toBe(200);
    const v = f.variantes[0]?.id ?? "";
    const cliente = await transaccaoAberta(c.id);
    try {
      // A activação a meio: o artigo já activo e as variantes em FOR SHARE.
      await cliente.query("update artigo set estado = 'activo' where id = $1", [
        f.id.slice("prd_".length),
      ]);
      const mudar = chave(c.segredo, "PATCH", `/variants/${v}`, {
        versao: 1,
        unidade_de_venda: "par",
      });
      expect(await aEsperaDeBloqueio()).toBe(true);
      await cliente.query("commit");
      const r = await mudar;
      expect(r.statusCode, r.body).toBe(409);
      expect(h.codigo(r)).toBe("catalog.not_draft");
    } finally {
      await cliente.query("rollback").catch(() => undefined);
      await cliente.end();
    }
    expect((await variante(c.segredo, v)).unidade_de_venda).toBe("unidade");
    expect(
      (await chave(c.segredo, "GET", `/products/${f.id}`)).json<Ficha>().estado,
    ).toBe("activo");
  }, 20_000);

  it("fora do rascunho, a mesma unidade e o mesmo conteúdo passam sem mudar a versão; num artigo arquivado, outra unidade dá catalog.not_draft (P3-3c, e)", async () => {
    const c = await comerciante("Loja Variante Mesmos Valores");
    const f = await artigo(c.segredo, true);
    const v = f.variantes[0];
    const url = `/variants/${v?.id ?? ""}`;
    const igual = await chave(c.segredo, "PATCH", url, {
      versao: 1,
      unidade_de_venda: "unidade",
      conteudo_quantidade: null,
      conteudo_unidade: null,
      peso_g: null,
    });
    expect(igual.statusCode, igual.body).toBe(200);
    expect(igual.json<Variante>().versao).toBe(1);
    const arq = await chave(c.segredo, "POST", `/products/${f.id}/archive`, {
      versao: f.versao,
    });
    expect(arq.statusCode, arq.body).toBe(200);
    const r = await chave(c.segredo, "PATCH", url, {
      versao: 1,
      unidade_de_venda: "par",
    });
    expect(h.codigo(r)).toBe("catalog.not_draft");
    const peso = await chave(c.segredo, "PATCH", url, {
      versao: 1,
      peso_g: 12,
    });
    expect(peso.statusCode, peso.body).toBe(200);
  });

  it("a linha do tempo tem a mudança com quem fez", async () => {
    const c = await comerciante("Loja Variante Rasto");
    const f = await artigo(c.segredo);
    const r = await chave(
      c.segredo,
      "PATCH",
      `/variants/${f.variantes[0]?.id ?? ""}`,
      {
        versao: 1,
        peso_g: 60,
      },
    );
    expect(r.statusCode, r.body).toBe(200);
    const linha = (
      await chave(c.segredo, "GET", `/products/${f.id}/timeline`)
    ).json<{
      dados: {
        entidade: string;
        quem: string;
        campos: Record<string, unknown>;
      }[];
    }>();
    const mudanca = linha.dados.find(
      (d) =>
        d.entidade === "variante" &&
        "peso_g" in d.campos &&
        !("sku" in d.campos),
    );
    expect(mudanca?.campos).toEqual({ peso_g: { antes: null, depois: 60 } });
    expect(mudanca?.quem).toMatch(/^chave:/);
  });

  it("pelo Hub: o dono e o gestor alteram; o armazém e o apoio recebem 403; outro comerciante, 404; a versão antiga, 409", async () => {
    const c = await comerciante("Loja Variante Hub");
    const outro = await comerciante("Loja Variante Hub B");
    const f = await artigo(c.segredo);
    const v = f.variantes[0]?.id ?? "";
    const url = `/hub/variants/${v}`;
    for (const papel of ["armazem", "apoio"]) {
      const p = await h.pessoaCom(c.id, papel);
      const r = await h.pedir("PATCH", url, {
        sessao: p.sessao,
        comerciante: c.id,
        corpo: { versao: 1, peso_g: 10 },
      });
      expect(r.statusCode, `${papel}: ${r.body}`).toBe(403);
    }
    const gestor = await h.pessoaCom(c.id, "gestor");
    const r = await h.pedir("PATCH", url, {
      sessao: gestor.sessao,
      comerciante: c.id,
      corpo: { versao: 1, peso_g: 60, gtin: GTIN, gtin_origem: "interno" },
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.headers["cache-control"]).toBe("private, no-store");
    expect(r.json<Variante>()).toMatchObject({ peso_g: 60, versao: 2 });
    const dono = await h.pessoaCom(c.id, "dono");
    const velha = await h.pedir("PATCH", url, {
      sessao: dono.sessao,
      comerciante: c.id,
      corpo: { versao: 1, peso_g: 70 },
    });
    expect(h.codigo(velha)).toBe("catalog.version_conflict");
    const deB = await h.pessoaCom(outro.id, "dono");
    const deOutro = await h.pedir("PATCH", url, {
      sessao: deB.sessao,
      comerciante: outro.id,
      corpo: { versao: 2, peso_g: 70 },
    });
    expect(deOutro.statusCode, deOutro.body).toBe(404);
    // A linha do tempo diz quem: a pessoa, não uma chave.
    const linha = (
      await chave(c.segredo, "GET", `/products/${f.id}/timeline`)
    ).json<{ dados: { entidade: string; quem: string }[] }>();
    expect(linha.dados.find((d) => d.entidade === "variante")?.quem).toMatch(
      /^pessoa:/,
    );
    expect((await variante(c.segredo, v)).peso_g).toBe(60);
  });

  it("acrescentar uma variante pelo Hub (#321): o dono e o gestor criam (201, com quem na linha do tempo); o armazém e o apoio, 403; outro comerciante, 404; o SKU repetido, 409", async () => {
    const c = await comerciante("Loja Variante Nova Hub");
    const outro = await comerciante("Loja Variante Nova Hub B");
    const f = await artigo(c.segredo, true);
    const url = `/hub/products/${f.id}/variants`;
    const nova = (sku: string) => ({
      sku,
      unidade_de_venda: "caixa",
      gtin: GTIN,
      gtin_origem: "fornecedor",
      peso_g: 400,
    });
    for (const papel of ["armazem", "apoio"]) {
      const p = await h.pessoaCom(c.id, papel);
      const r = await h.pedir("POST", url, {
        sessao: p.sessao,
        comerciante: c.id,
        corpo: nova(`ENS-${randomUUID()}`),
      });
      expect(r.statusCode, `${papel}: ${r.body}`).toBe(403);
    }
    const gestor = await h.pessoaCom(c.id, "gestor");
    const sku = `ENS-C-${randomUUID()}`;
    const r = await h.pedir("POST", url, {
      sessao: gestor.sessao,
      comerciante: c.id,
      corpo: nova(sku),
    });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.headers["cache-control"]).toBe("private, no-store");
    expect(r.json<Variante>()).toMatchObject({
      sku,
      artigo: f.id,
      estado: "activa",
      unidade_de_venda: "caixa",
      gtin: GTIN,
      peso_g: 400,
      versao: 1,
    });
    const ficha = (
      await chave(c.segredo, "GET", `/products/${f.id}`)
    ).json<Ficha>();
    expect(ficha.variantes.map((v) => v.sku)).toContain(sku);
    const linha = (
      await chave(c.segredo, "GET", `/products/${f.id}/timeline`)
    ).json<{
      dados: {
        entidade: string;
        quem: string;
        campos: Record<string, unknown>;
      }[];
    }>();
    expect(
      linha.dados.find(
        (d) =>
          d.entidade === "variante" &&
          (d.campos["sku"] as { depois?: string } | undefined)?.depois === sku,
      )?.quem,
    ).toMatch(/^pessoa:/);
    // O mesmo SKU (sem distinguir maiúsculas): 409, e não há outra.
    const dono = await h.pessoaCom(c.id, "dono");
    const repetido = await h.pedir("POST", url, {
      sessao: dono.sessao,
      comerciante: c.id,
      corpo: { ...nova(sku.toLowerCase()), gtin: null, gtin_origem: null },
    });
    expect(repetido.statusCode).toBe(409);
    expect(h.codigo(repetido)).toBe("catalog.sku_duplicate");
    // O dono de outro comerciante, com o cabeçalho dele, não chega a A.
    const deB = await h.pessoaCom(outro.id, "dono");
    const deOutro = await h.pedir("POST", url, {
      sessao: deB.sessao,
      comerciante: outro.id,
      corpo: nova(`ENS-${randomUUID()}`),
    });
    expect(deOutro.statusCode, deOutro.body).toBe(404);
    const depois = (
      await chave(c.segredo, "GET", `/products/${f.id}`)
    ).json<Ficha>();
    expect(depois.variantes).toHaveLength(3);
  });

  it("acrescentar pelo Hub num artigo activo com opções: sem um valor de cada opção, recusa; com a combinação de outra variante, também; com uma nova, cria", async () => {
    const c = await comerciante("Loja Variante Nova Opcoes");
    const f = await artigo(c.segredo);
    const o = (
      await chave(c.segredo, "POST", `/products/${f.id}/options`, {
        nome: "Tamanho",
        valores: ["15 ml", "30 ml", "50 ml"],
      })
    ).json<{ valores: { id: string }[] }>();
    const [v1, v2] = f.variantes;
    for (const [v, i] of [
      [v1, 0],
      [v2, 1],
    ] as const) {
      const d = await chave(
        c.segredo,
        "PUT",
        `/variants/${v?.id ?? ""}/values`,
        {
          valores: [o.valores[i]?.id],
        },
      );
      expect(d.statusCode, d.body).toBe(200);
    }
    const ficha = (
      await chave(c.segredo, "GET", `/products/${f.id}`)
    ).json<Ficha>();
    const cl = await chave(
      c.segredo,
      "PUT",
      `/products/${f.id}/classification`,
      {
        versao: ficha.versao,
        familias: ["retalho_geral"],
        natureza_consumidor: "bem",
      },
    );
    const act = await chave(c.segredo, "POST", `/products/${f.id}/activate`, {
      versao: cl.json<Ficha>().versao,
    });
    expect(act.statusCode, act.body).toBe(200);
    const dono = await h.pessoaCom(c.id, "dono");
    const criar = (valores: string[]) =>
      h.pedir("POST", `/hub/products/${f.id}/variants`, {
        sessao: dono.sessao,
        comerciante: c.id,
        corpo: {
          sku: `ENS-${randomUUID()}`,
          unidade_de_venda: "unidade",
          valores,
        },
      });
    const sem = await criar([]);
    expect(h.codigo(sem), sem.body).toBe("catalog.options_incomplete");
    const repetida = await criar([o.valores[0]?.id ?? ""]);
    expect(h.codigo(repetida), repetida.body).toBe(
      "catalog.option_combination_duplicate",
    );
    const boa = await criar([o.valores[2]?.id ?? ""]);
    expect(boa.statusCode, boa.body).toBe(201);
    expect(boa.json<{ valores: string[] }>().valores).toEqual([
      o.valores[2]?.id,
    ]);
  });

  it("pelo Hub, num artigo do sistema de gestão: catalog.external_field; pela chave, aceita", async () => {
    const c = await comerciante("Loja Variante Externo");
    const id = await comComerciante(base.api, c.id, async (trx) => {
      await sql`select set_config('eurolify.quem', 'teste:preparar', true)`.execute(
        trx,
      );
      return criarArtigo(
        trx,
        c.id,
        {
          tipo: "fisico",
          nome: "Verniz da Gestão",
          categoria_fiscal: "normal",
          origem_ref: "GESTAO-VAR",
        },
        [{ sku: `G-${randomUUID()}`, unidade_de_venda: "unidade" }],
      );
    });
    const f = (
      await chave(c.segredo, "GET", `/products/prd_${id}`)
    ).json<Ficha>();
    const v = f.variantes[0]?.id ?? "";
    const dono = await h.pessoaCom(c.id, "dono");
    const r = await h.pedir("PATCH", `/hub/variants/${v}`, {
      sessao: dono.sessao,
      comerciante: c.id,
      corpo: { versao: 1, peso_g: 10 },
    });
    expect(r.statusCode, r.body).toBe(409);
    expect(h.codigo(r)).toBe("catalog.external_field");
    // Acrescentar uma variante pelo Hub também recusa (#321).
    const nova = await h.pedir("POST", `/hub/products/prd_${id}/variants`, {
      sessao: dono.sessao,
      comerciante: c.id,
      corpo: { sku: `G-${randomUUID()}`, unidade_de_venda: "unidade" },
    });
    expect(nova.statusCode, nova.body).toBe(409);
    expect(h.codigo(nova)).toBe("catalog.external_field");
    const pelaChave = await chave(c.segredo, "PATCH", `/variants/${v}`, {
      versao: 1,
      peso_g: 10,
    });
    expect(pelaChave.statusCode, pelaChave.body).toBe(200);
  });

  it("a migração 0048 sobre variantes que já existiam: ficam na versão 1, e uma mudança sobe-a", async () => {
    const c = await comerciante("Loja Variante Migracao");
    const f = await artigo(c.segredo);
    const id = (f.variantes[0]?.id ?? "").slice("var_".length);
    const ficheiro = readFileSync(
      new URL(
        "../migracoes/0048_catalogo_versao_da_variante.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const dono = base.dono as Kysely<BaseDados>;
    // Como antes da 0048 (sem a coluna), com a variante já lá; corre o
    // ficheiro; desfaz-se tudo no fim.
    const desfazer = new Error("desfazer");
    const visto = await dono
      .transaction()
      .execute(async (trx) => {
        await sql`alter table variante drop column versao`.execute(trx);
        await sql.raw(ficheiro).execute(trx);
        const antes = await sql<{ versao: number }>`
          select versao from variante where id = ${id}::uuid`.execute(trx);
        await sql`select set_config('eurolify.quem', 'teste:migracao', true)`.execute(
          trx,
        );
        await sql`update variante set peso_g = 7 where id = ${id}::uuid`.execute(
          trx,
        );
        const depois = await sql<{ versao: number }>`
          select versao from variante where id = ${id}::uuid`.execute(trx);
        const resultado = [antes.rows[0]?.versao, depois.rows[0]?.versao];
        throw Object.assign(desfazer, { resultado });
      })
      .catch((e: unknown) => {
        if (e !== desfazer) throw e;
        return (e as Error & { resultado: unknown }).resultado;
      });
    expect(visto).toEqual([1, 2]);
  });
});
