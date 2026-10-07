import { randomUUID } from "node:crypto";
import { sql, type Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarApp } from "../src/app.js";
import type { BaseDados } from "../src/base/esquema.js";
import { criarArtigo } from "../src/catalogo/repositorio.js";
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

// A API de Administração do Catálogo, parte 2: as escritas (docs/14 §7.1;
// docs/18 §4, idempotência). Contra o PostgreSQL 18 verdadeiro, pela app
// inteira (chave, âmbito, Idempotency-Key, RLS, contrato).

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
const NOVO_ARTIGO = {
  tipo: "fisico",
  nome: "Gel construtor",
  categoria_fiscal: "normal",
  variantes: [{ sku: "GEL-100", unidade_de_venda: "unidade", peso_g: 30 }],
};
const CLASSIFICACAO = {
  familias: ["retalho_geral"],
  natureza_consumidor: "bem",
};

interface Ficha {
  id: string;
  nome: string;
  estado: string;
  versao: number;
  variantes: { id: string; sku: string }[];
}

describe.skipIf(URL_BASE === undefined)("API do Catálogo: escritas", () => {
  let base: BaseDeTeste;
  let app: ReturnType<typeof criarApp>;
  let a: string;
  let b: string;
  let escrita: string;
  let escritaId: string;
  let publicacao: string;
  let publicacaoId: string;
  let leitura: string;
  let deB: string;
  let canal: string;
  let mercado: string;
  let lista: string;

  const pedir = (
    metodo: "POST" | "PATCH" | "PUT" | "DELETE" | "GET",
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
        ...(chave === null ? {} : { "idempotency-key": chave }),
        ...(corpo === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(corpo === undefined ? {} : { payload: JSON.stringify(corpo) }),
    });

  /** Cria pela API e devolve a ficha. */
  async function novo(sku: string, nome = "Gel construtor") {
    const r = await pedir("POST", "/products", {
      ...NOVO_ARTIGO,
      nome,
      variantes: [{ sku, unidade_de_venda: "unidade", peso_g: 30 }],
    });
    expect(r.statusCode).toBe(201);
    return r.json<Ficha>();
  }

  /** Classifica e activa pela API; devolve a ficha. */
  async function activo(sku: string) {
    const f = await novo(sku);
    const c = await pedir("PUT", `/products/${f.id}/classification`, {
      versao: f.versao,
      ...CLASSIFICACAO,
    });
    expect(c.statusCode).toBe(200);
    const r = await pedir("POST", `/products/${f.id}/activate`, {
      versao: c.json<Ficha>().versao,
    });
    expect(r.statusCode).toBe(200);
    return r.json<Ficha>();
  }

  beforeAll(async () => {
    base = await criarBaseDeTeste(URL_BASE ?? "");
    app = criarApp({ logger: false }, undefined, base.api);
    a = await registarComerciante(base.api, NOVO);
    b = await registarComerciante(base.api, NOVO);
    const servidor = { tipo: "servidor" as const, criadaPor: "operador:teste" };
    const dono: Kysely<BaseDados> = base.dono;
    const e = await criarChave(dono, a, {
      ...servidor,
      nome: "Escrita",
      ambitos: ["catalog:read", "catalog:write"],
    });
    escrita = e.segredo;
    escritaId = e.id;
    const p = await criarChave(dono, a, {
      ...servidor,
      nome: "Publicação",
      ambitos: ["catalog:publish"],
    });
    publicacao = p.segredo;
    publicacaoId = p.id;
    leitura = (
      await criarChave(dono, a, {
        ...servidor,
        nome: "Leitura",
        ambitos: ["catalog:read"],
      })
    ).segredo;
    deB = await criarArtigo(
      base.api,
      b,
      { tipo: "fisico", nome: "Gel", categoria_fiscal: "normal" },
      [{ sku: "GEL-B", unidade_de_venda: "unidade" }],
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

  it("cria um artigo em rascunho com as variantes e devolve a ficha (201)", async () => {
    const f = await novo("CRIA-1");
    expect(f).toMatchObject({
      nome: "Gel construtor",
      estado: "rascunho",
      versao: 1,
    });
    expect(f.id).toMatch(/^prd_/);
    expect(f.variantes).toHaveLength(1);
    expect(f.variantes[0]).toMatchObject({ sku: "CRIA-1" });
    expect(f.variantes[0]?.id).toMatch(/^var_/);
  });

  it("repetir com a mesma Idempotency-Key devolve a mesma resposta e não cria outro", async () => {
    const chave = randomUUID();
    const corpo = {
      ...NOVO_ARTIGO,
      variantes: [{ sku: "REPETE-1", unidade_de_venda: "unidade" }],
    };
    const r1 = await pedir("POST", "/products", corpo, { chave });
    const r2 = await pedir("POST", "/products", corpo, { chave });
    expect(r1.statusCode).toBe(201);
    expect(r2.statusCode).toBe(201);
    expect(r2.json()).toEqual(r1.json());
    const n = await comComerciante(base.api, a, (trx) =>
      trx
        .selectFrom("variante")
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .where("sku", "=", "REPETE-1")
        .executeTakeFirstOrThrow(),
    );
    expect(Number(n.n)).toBe(1);
  });

  it("a mesma chave com outro corpo dá 422 idempotency.key_reused; sem chave dá 400", async () => {
    const chave = randomUUID();
    const corpo = {
      ...NOVO_ARTIGO,
      variantes: [{ sku: "REUSA-1", unidade_de_venda: "unidade" }],
    };
    expect(
      (await pedir("POST", "/products", corpo, { chave })).statusCode,
    ).toBe(201);
    const outro = await pedir(
      "POST",
      "/products",
      { ...corpo, nome: "Outro" },
      { chave },
    );
    expect(outro.statusCode).toBe(422);
    expect(outro.json()).toMatchObject({ codigo: "idempotency.key_reused" });
    const sem = await pedir("POST", "/products", corpo, { chave: null });
    expect(sem.statusCode).toBe(400);
    expect(sem.json()).toMatchObject({ codigo: "idempotency.key_required" });
  });

  it("uma escrita que falha não gasta a chave: resolvido o conflito, a mesma chave serve", async () => {
    const primeiro = await novo("DUP-1");
    const chave = randomUUID();
    const corpo = {
      ...NOVO_ARTIGO,
      variantes: [{ sku: "DUP-1", unidade_de_venda: "unidade" }],
    };
    const r1 = await pedir("POST", "/products", corpo, { chave });
    expect(r1.statusCode).toBe(409);
    expect(r1.json()).toMatchObject({ codigo: "catalog.sku_duplicate" });
    // Apagado o rascunho que tinha o SKU, o mesmo pedido com a mesma chave
    // escreve: a falha não deixou a chave «em curso» nem guardou o 409.
    expect((await pedir("DELETE", `/products/${primeiro.id}`)).statusCode).toBe(
      204,
    );
    const r2 = await pedir("POST", "/products", corpo, { chave });
    expect(r2.statusCode).toBe(201);
  });

  it("o corpo é fechado: um campo a mais ou sem variantes dá 400", async () => {
    const mais = await pedir("POST", "/products", { ...NOVO_ARTIGO, preco: 1 });
    expect(mais.statusCode).toBe(400);
    const sem = await pedir("POST", "/products", {
      ...NOVO_ARTIGO,
      variantes: [],
    });
    expect(sem.statusCode).toBe(400);
  });

  it("altera na versão lida; outra versão dá 409 catalog.version_conflict", async () => {
    const f = await novo("ALTERA-1");
    const r = await pedir("PATCH", `/products/${f.id}`, {
      versao: f.versao,
      nome: "Gel construtor rosa",
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ nome: "Gel construtor rosa", versao: 2 });
    const velha = await pedir("PATCH", `/products/${f.id}`, {
      versao: f.versao,
      nome: "Outro",
    });
    expect(velha.statusCode).toBe(409);
    expect(velha.json()).toMatchObject({ codigo: "catalog.version_conflict" });
  });

  it("classifica, activa, arquiva e repõe, cada passo na versão lida", async () => {
    const f = await activo("ESTADOS-1");
    expect(f.estado).toBe("activo");
    const arq = await pedir("POST", `/products/${f.id}/archive`, {
      versao: f.versao,
    });
    expect(arq.statusCode).toBe(200);
    expect(arq.json()).toMatchObject({ estado: "arquivado" });
    const rep = await pedir("POST", `/products/${f.id}/restore`, {
      versao: arq.json<Ficha>().versao,
    });
    expect(rep.statusCode).toBe(200);
    expect(rep.json()).toMatchObject({ estado: "activo" });
  });

  it("cada mudança de estado só parte do seu: repor um rascunho ou activar um arquivado recusa", async () => {
    const f = await novo("TRANSICAO-1");
    const repor = await pedir("POST", `/products/${f.id}/restore`, {
      versao: f.versao,
    });
    expect(repor.statusCode).toBe(409);
    expect(repor.json()).toMatchObject({
      codigo: "catalog.invalid_transition",
    });
    const arquivar = await pedir("POST", `/products/${f.id}/archive`, {
      versao: f.versao,
    });
    expect(arquivar.json()).toMatchObject({
      codigo: "catalog.invalid_transition",
    });
    const act = await activo("TRANSICAO-2");
    const arq = await pedir("POST", `/products/${act.id}/archive`, {
      versao: act.versao,
    });
    const activar = await pedir("POST", `/products/${act.id}/activate`, {
      versao: arq.json<Ficha>().versao,
    });
    expect(activar.json()).toMatchObject({
      codigo: "catalog.invalid_transition",
    });
    // Nada mudou: continua rascunho e arquivado.
    expect((await pedir("GET", `/products/${f.id}`)).json<Ficha>().estado).toBe(
      "rascunho",
    );
    expect(
      (await pedir("GET", `/products/${act.id}`)).json<Ficha>().estado,
    ).toBe("arquivado");
  });

  it("a classificação guarda a chave como quem classificou (chave:key_…)", async () => {
    const f = await novo("QUEM-1");
    const r = await pedir("PUT", `/products/${f.id}/classification`, {
      versao: f.versao,
      ...CLASSIFICACAO,
    });
    expect(r.statusCode).toBe(200);
    const linha = await comComerciante(base.api, a, (trx) =>
      trx
        .selectFrom("artigo")
        .select("classificado_por")
        .where("id", "=", f.id.slice("prd_".length))
        .executeTakeFirstOrThrow(),
    );
    expect(linha.classificado_por).toBe(`chave:key_${escritaId}`);
  });

  it("apaga um rascunho (204); um activo dá 409/422 sem apagar", async () => {
    const f = await novo("APAGA-1");
    const r = await pedir("DELETE", `/products/${f.id}`);
    expect(r.statusCode).toBe(204);
    expect(r.body).toBe("");
    const lido = await pedir("GET", `/products/${f.id}`);
    expect(lido.statusCode).toBe(404);
    const act = await activo("APAGA-2");
    const recusa = await pedir("DELETE", `/products/${act.id}`);
    expect(recusa.json()).toMatchObject({ codigo: "catalog.not_draft" });
    expect((await pedir("GET", `/products/${act.id}`)).statusCode).toBe(200);
  });

  it("o artigo de outro comerciante é 404 em todas as escritas", async () => {
    const id = `prd_${deB}`;
    for (const [metodo, url, corpo] of [
      ["PATCH", `/products/${id}`, { versao: 1, nome: "X" }],
      [
        "PUT",
        `/products/${id}/classification`,
        { versao: 1, ...CLASSIFICACAO },
      ],
      ["POST", `/products/${id}/activate`, { versao: 1 }],
      ["DELETE", `/products/${id}`, undefined],
    ] as const) {
      const r = await pedir(metodo, url, corpo);
      expect(r.statusCode, `${metodo} ${url}`).toBe(404);
      expect(r.json()).toMatchObject({ codigo: "catalog.not_found" });
    }
    const p = await pedir(
      "POST",
      `/products/${id}/publications`,
      { canal: `chn_${canal}`, mercado: `mkt_${mercado}` },
      { segredo: publicacao },
    );
    expect(p.statusCode).toBe(404);
  });

  it("os âmbitos: catalog:read não escreve; catalog:write não publica; catalog:publish não cria", async () => {
    const r1 = await pedir("POST", "/products", NOVO_ARTIGO, {
      segredo: leitura,
    });
    expect(r1.statusCode).toBe(403);
    const f = await activo("AMBITO-1");
    const r2 = await pedir("POST", `/products/${f.id}/publications`, {
      canal: `chn_${canal}`,
      mercado: `mkt_${mercado}`,
    });
    expect(r2.statusCode).toBe(403);
    const r3 = await pedir("POST", "/products", NOVO_ARTIGO, {
      segredo: publicacao,
    });
    expect(r3.statusCode).toBe(403);
  });

  it("publica com impedimentos: publicada falsa, a lista e nada à venda", async () => {
    const f = await activo("SEMPRECO-1");
    const r = await pedir(
      "POST",
      `/products/${f.id}/publications`,
      { canal: `chn_${canal}`, mercado: `mkt_${mercado}` },
      { segredo: publicacao },
    );
    expect(r.statusCode).toBe(200);
    const corpo = r.json<{
      publicada: boolean;
      verificacao: { impedimentos: unknown[] };
      publicacao: { estado: string } | null;
    }>();
    expect(corpo.publicada).toBe(false);
    expect(corpo.verificacao.impedimentos.length).toBeGreaterThan(0);
    expect(corpo.publicacao?.estado).not.toBe("publicado");
  });

  it("publica e retira: a chave fica como quem, e saem os eventos", async () => {
    const f = await activo("PUBLICA-1");
    const variante = f.variantes[0]?.id.slice("var_".length) ?? "";
    await definirPreco(base.api, a, "pessoa:teste", lista, variante, {
      montante: 990,
    });
    const r = await pedir(
      "POST",
      `/products/${f.id}/publications`,
      { canal: `chn_${canal}`, mercado: `mkt_${mercado}` },
      { segredo: publicacao },
    );
    expect(r.statusCode).toBe(200);
    const corpo = r.json<{
      publicada: boolean;
      publicacao: { id: string; estado: string };
    }>();
    expect(corpo.publicada).toBe(true);
    expect(corpo.publicacao.estado).toBe("publicado");
    expect(corpo.publicacao.id).toMatch(/^pub_/);
    const pubId = corpo.publicacao.id.slice("pub_".length);
    const quem = await comComerciante(base.api, a, (trx) =>
      trx
        .selectFrom("publicacao")
        .select("publicado_por")
        .where("id", "=", pubId)
        .executeTakeFirstOrThrow(),
    );
    expect(quem.publicado_por).toBe(`chave:key_${publicacaoId}`);

    const ret = await pedir(
      "POST",
      `/publications/${corpo.publicacao.id}/archive`,
      undefined,
      { segredo: publicacao },
    );
    expect(ret.statusCode).toBe(200);
    expect(ret.json()).toMatchObject({
      estado: "arquivado",
      motivo_arquivo: "retirada",
    });
    // Retirar outra vez (outra chave) recusa: só se retira o publicado.
    const outra = await pedir(
      "POST",
      `/publications/${corpo.publicacao.id}/archive`,
      undefined,
      { segredo: publicacao },
    );
    expect(outra.statusCode).toBeGreaterThanOrEqual(400);
    expect(outra.statusCode).toBeLessThan(500);
    // Os eventos lê-os o publicador (o dono), não a API.
    const { rows: eventos } = await sql<{ tipo: string }>`
      select tipo from evento_saida
      where agregado_tipo = 'artigo'
        and agregado_id = ${f.id.slice("prd_".length)}::uuid
      order by criado_em, id`.execute(base.dono);
    expect(eventos.map((e) => e.tipo)).toEqual([
      "product.published",
      "product.unpublished",
    ]);
  });

  it("dentro de uma transacção já aberta, o Catálogo só escreve para o comerciante dela", async () => {
    // A rota corre o repositório na transacção da idempotência; uma
    // transacção de A nunca escreve para B (nem por engano no código).
    await expect(
      comComerciante(base.api, a, (trx) =>
        criarArtigo(
          trx,
          b,
          { tipo: "fisico", nome: "Intruso", categoria_fiscal: "normal" },
          [{ sku: "INTRUSO-1", unidade_de_venda: "unidade" }],
        ),
      ),
    ).rejects.toThrow(/outro comerciante/);
    await expect(
      base.api.transaction().execute((trx) =>
        criarArtigo(
          trx,
          a,
          {
            tipo: "fisico",
            nome: "Sem contexto",
            categoria_fiscal: "normal",
          },
          [{ sku: "INTRUSO-2", unidade_de_venda: "unidade" }],
        ),
      ),
    ).rejects.toThrow(/outro comerciante/);
  });

  it("um id com o prefixo errado dá 400 antes de chegar à base", async () => {
    const r = await pedir("PATCH", `/products/var_${randomUUID()}`, {
      versao: 1,
      nome: "X",
    });
    expect(r.statusCode).toBe(400);
  });
});
