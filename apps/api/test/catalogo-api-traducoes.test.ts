import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarApp } from "../src/app.js";
import type { BaseDados } from "../src/base/esquema.js";
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

// A API de Administração do Catálogo, parte 5: as traduções (docs/14 §3.8,
// §4.3 e §7.1). Contra o PostgreSQL 18 verdadeiro, pela app inteira. A língua
// de origem do comerciante é «pt»; traduz-se para «es».

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

interface Traducao {
  recurso: string;
  campo: string;
  lingua: string;
  texto: string;
  estado: string;
  origem: string;
  revista: boolean;
}
interface Pagina<T> {
  dados: T[];
  total: number;
  ha_mais: boolean;
  cursor_seguinte: string | null;
}
interface Ficha {
  id: string;
  nome: string;
  versao: number;
  variantes: { id: string }[];
}

describe.skipIf(URL_BASE === undefined)("API do Catálogo: traduções", () => {
  let base: BaseDeTeste;
  let app: ReturnType<typeof criarApp>;
  let a: string;
  let escrita: string;
  let revisora: string;
  let publicacao: string;
  let leitura: string;
  let semCatalogo: string;
  let escritaDeB: string;
  let canal: string;
  let mercado: string;
  let lista: string;

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
        ...(corpo === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(corpo === undefined ? {} : { payload: JSON.stringify(corpo) }),
    });

  async function artigo(nome: string, sku: string, activar = false) {
    const r = await pedir("POST", "/products", {
      tipo: "fisico",
      nome,
      descricao: `Descrição de ${nome}`,
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

  const traduzir = (
    recurso: string,
    campo: string,
    texto: string,
    originalVisto: string,
    opcoes: { origem?: string; segredo?: string; chave?: string } = {},
  ) =>
    pedir(
      "PUT",
      `/translations/${recurso}/${campo}/es`,
      {
        texto,
        origem: opcoes.origem ?? "pessoa",
        original_visto: originalVisto,
      },
      {
        ...(opcoes.segredo === undefined ? {} : { segredo: opcoes.segredo }),
        ...(opcoes.chave === undefined ? {} : { chave: opcoes.chave }),
      },
    );

  beforeAll(async () => {
    base = await criarBaseDeTeste(URL_BASE ?? "");
    app = criarApp({ logger: false }, undefined, base.api);
    a = await registarComerciante(base.api, NOVO);
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
    revisora = await chaveDe(a, "Revisora", ["catalog:read", "catalog:write"]);
    publicacao = await chaveDe(a, "Publicação", ["catalog:publish"]);
    leitura = await chaveDe(a, "Leitura", ["catalog:read"]);
    semCatalogo = await chaveDe(a, "Chaves", ["keys:write"]);
    escritaDeB = await chaveDe(b, "Escrita de B", [
      "catalog:read",
      "catalog:write",
    ]);
    const entidade = await criarEntidadeLegal(base.api, a, ENTIDADE);
    const loja = await criarLoja(base.api, a, {
      entidade_legal_id: entidade,
      nome: "Loja online",
    });
    mercado = await criarMercado(base.api, a, {
      loja_id: loja,
      nome: "Ibérico",
      paises: ["PT", "ES"],
      moeda: "EUR",
      linguas: ["pt", "es"],
      lingua_principal: "pt",
    });
    lista = await criarLista(base.api, a, {
      mercado_id: mercado,
      nome: "Base",
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

  it("traduz, lê pelo recurso (e pela língua), fica desactualizada quando o original muda e completa outra vez", async () => {
    const f = await artigo("Gel construtor", "TR-1");
    const r = await traduzir(f.id, "nome", "Gel constructor", "Gel construtor");
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      recurso: f.id,
      campo: "nome",
      lingua: "es",
      texto: "Gel constructor",
      estado: "completa",
      origem: "pessoa",
      revista: false,
    });
    // Não sai quem traduziu (CL).
    expect(Object.keys(r.json<object>())).not.toContain("traduzido_por");
    await traduzir(
      f.id,
      "descricao",
      "Descripción",
      "Descrição de Gel construtor",
    );
    const lidas = (
      await pedir("GET", `/translations?resource=${f.id}`, undefined, {
        segredo: leitura,
      })
    ).json<Pagina<Traducao>>();
    expect(lidas.dados.map((t) => t.campo)).toEqual(["descricao", "nome"]);
    expect(lidas).toMatchObject({ total: 2, ha_mais: false });
    // Outra língua: com `locale`, só a pedida.
    await pedir("PUT", `/translations/${f.id}/nome/fr`, {
      texto: "Gel de construction",
      origem: "pessoa",
      original_visto: "Gel construtor",
    });
    const so = (
      await pedir("GET", `/translations?resource=${f.id}&locale=fr`)
    ).json<Pagina<Traducao>>();
    expect(so.dados.map((t) => [t.campo, t.lingua])).toEqual([["nome", "fr"]]);
    // O original muda: desactualizada.
    const p = await pedir("PATCH", `/products/${f.id}`, {
      versao: f.versao,
      nome: "Gel construtor rosa",
    });
    expect(p.statusCode).toBe(200);
    const depois = (
      await pedir("GET", `/translations?resource=${f.id}&locale=es`)
    ).json<Pagina<Traducao>>();
    expect(depois.dados.find((t) => t.campo === "nome")?.estado).toBe(
      "desactualizada",
    );
    // Traduzir com o original velho dá conflito; com o novo, completa.
    const velho = await traduzir(
      f.id,
      "nome",
      "Gel constructor rosa",
      "Gel construtor",
    );
    expect(velho.statusCode).toBe(409);
    expect(velho.json()).toMatchObject({ codigo: "catalog.version_conflict" });
    const novo = await traduzir(
      f.id,
      "nome",
      "Gel constructor rosa",
      "Gel construtor rosa",
    );
    expect(novo.json()).toMatchObject({ estado: "completa" });
  });

  it("a fila de uma língua, por páginas: em falta e desactualizadas; a língua de origem não tem fila", async () => {
    const r = await registarComerciante(base.api, NOVO);
    const dono: Kysely<BaseDados> = base.dono;
    const segredo = (
      await criarChave(dono, r, {
        tipo: "servidor",
        criadaPor: "operador:teste",
        nome: "Fila",
        ambitos: ["catalog:read", "catalog:write"],
      })
    ).segredo;
    const criar = async (nome: string, sku: string) =>
      (
        await pedir(
          "POST",
          "/products",
          {
            tipo: "fisico",
            nome,
            categoria_fiscal: "normal",
            variantes: [{ sku, unidade_de_venda: "unidade" }],
          },
          { segredo },
        )
      ).json<Ficha>();
    const f1 = await criar("Um", "F-1");
    const f2 = await criar("Dois", "F-2");
    // Um traduzido e depois o original muda: desactualizado.
    await pedir(
      "PUT",
      `/translations/${f1.id}/nome/es`,
      { texto: "Uno", origem: "pessoa", original_visto: "Um" },
      { segredo },
    );
    await pedir(
      "PATCH",
      `/products/${f1.id}`,
      { versao: f1.versao, nome: "Um!" },
      { segredo },
    );
    const fila = async (q: string) =>
      (await pedir("GET", `/translations?${q}`, undefined, { segredo })).json<
        Pagina<{ recurso: string; campo: string; estado: string }>
      >();
    const toda = await fila("locale=es");
    expect(toda.total).toBe(2);
    expect(
      toda.dados.map((d) => [d.recurso, d.campo, d.estado]).sort(),
    ).toEqual(
      [
        [f1.id, "nome", "desactualizada"],
        [f2.id, "nome", "em_falta"],
      ].sort(),
    );
    expect((await fila("locale=es&estado=em_falta")).dados).toEqual([
      { recurso: f2.id, campo: "nome", estado: "em_falta" },
    ]);
    expect((await fila("locale=es&estado=desactualizada")).dados).toEqual([
      { recurso: f1.id, campo: "nome", estado: "desactualizada" },
    ]);
    const p1 = await fila("locale=es&limite=1");
    expect(p1).toMatchObject({ total: 2, ha_mais: true });
    const p2 = await fila(
      `locale=es&limite=1&cursor=${p1.cursor_seguinte ?? ""}`,
    );
    expect(p2.ha_mais).toBe(false);
    expect([...p1.dados, ...p2.dados].map((d) => d.recurso).sort()).toEqual(
      [f1.id, f2.id].sort(),
    );
    const origem = await pedir("GET", "/translations?locale=pt", undefined, {
      segredo,
    });
    expect(origem.statusCode).toBe(422);
    expect(origem.json()).toMatchObject({
      codigo: "catalog.translation_same_language",
    });
  });

  it("os pedidos estranhos dão 400: sem resource nem locale, campo de outro tipo, prefixo desconhecido, estado com resource, cursor mau", async () => {
    const f = await artigo("Lima", "TR-400");
    for (const url of [
      "/translations",
      `/translations?resource=${f.id}&estado=em_falta`,
      `/translations?resource=var_${randomUUID()}`,
      "/translations?locale=ES",
      "/translations?locale=es&estado=outro",
      `/translations?locale=es&cursor=${Buffer.from('["x"]').toString("base64url")}`,
    ]) {
      const r = await pedir("GET", url);
      expect(r.statusCode, url).toBe(400);
    }
    // Recusado pelo contrato (o campo não é deste tipo), não pela base.
    const campo = await traduzir(f.id, "valor", "x", "Lima");
    expect(campo.statusCode).toBe(400);
    expect(campo.json()).toMatchObject({ codigo: "request.invalid" });
    const lingua = await pedir("PUT", `/translations/${f.id}/nome/ES`, {
      texto: "x",
      origem: "pessoa",
      original_visto: "Lima",
    });
    expect(lingua.statusCode).toBe(400);
    const vazio = await traduzir(f.id, "nome", "   ", "Lima");
    expect(vazio.statusCode).toBe(400);
  });

  it("as recusas da base: língua de origem, campo sem original", async () => {
    const r = await pedir("POST", "/products", {
      tipo: "fisico",
      nome: "Sem descrição",
      categoria_fiscal: "normal",
      variantes: [{ sku: "TR-SD", unidade_de_venda: "unidade" }],
    });
    const f = r.json<Ficha>();
    const origem = await pedir("PUT", `/translations/${f.id}/nome/pt`, {
      texto: "Outro",
      origem: "pessoa",
      original_visto: "Sem descrição",
    });
    expect(origem.statusCode).toBe(422);
    expect(origem.json()).toMatchObject({
      codigo: "catalog.translation_same_language",
    });
    const semOriginal = await traduzir(f.id, "descricao", "Descripción", "");
    expect(semOriginal.statusCode).toBe(422);
    expect(semOriginal.json()).toMatchObject({
      codigo: "catalog.translation_no_original",
    });
  });

  it("rever: só uma proposta de IA, e não por quem a traduziu; traduzir outra vez apaga a revisão", async () => {
    const f = await artigo("Verniz", "TR-REV");
    const rever = (segredo: string) =>
      pedir("POST", `/translations/${f.id}/nome/es/review`, undefined, {
        segredo,
      });
    await traduzir(f.id, "nome", "Barniz", "Verniz");
    const dePessoa = await rever(revisora);
    expect(dePessoa.statusCode).toBe(422);
    expect(dePessoa.json()).toMatchObject({
      codigo: "catalog.translation_not_ai",
    });
    await traduzir(f.id, "nome", "Esmalte", "Verniz", { origem: "ia" });
    const propria = await rever(escrita);
    expect(propria.statusCode).toBe(422);
    expect(propria.json()).toMatchObject({
      codigo: "catalog.translation_self_review",
    });
    const revista = await rever(revisora);
    expect(revista.statusCode).toBe(200);
    expect(revista.json()).toMatchObject({ revista: true, origem: "ia" });
    const outraVez = await traduzir(f.id, "nome", "Esmalte 2", "Verniz", {
      origem: "ia",
    });
    expect(outraVez.json()).toMatchObject({ revista: false });
    const comCorpo = await pedir(
      "POST",
      `/translations/${f.id}/nome/es/review`,
      { x: 1 },
      { segredo: revisora },
    );
    expect(comCorpo.statusCode).toBe(400);
  });

  it("a idempotência: a mesma chave devolve a resposta guardada; outro corpo dá 422", async () => {
    const f = await artigo("Top coat", "TR-IDEM");
    const chave = randomUUID();
    const r1 = await traduzir(f.id, "nome", "Top coat ES", "Top coat", {
      chave,
    });
    // Outra tradução, com outra chave, muda o texto.
    await traduzir(f.id, "nome", "Capa final", "Top coat");
    const r2 = await traduzir(f.id, "nome", "Top coat ES", "Top coat", {
      chave,
    });
    expect(r2.json()).toEqual(r1.json());
    const lida = (
      await pedir("GET", `/translations?resource=${f.id}&locale=es`)
    ).json<Pagina<Traducao>>();
    expect(lida.dados[0]?.texto).toBe("Capa final");
    const outro = await traduzir(f.id, "nome", "Outro", "Top coat", { chave });
    expect(outro.json()).toMatchObject({ codigo: "idempotency.key_reused" });
  });

  it("tirar a tradução do nome de um artigo publicado num mercado dessa língua tira-o de venda; tirar outra vez dá 404", async () => {
    const f = await artigo("Base", "TR-PUB", true);
    await traduzir(f.id, "nome", "Base ES", "Base");
    await definirPreco(
      base.api,
      a,
      "pessoa:teste",
      lista,
      (f.variantes[0]?.id ?? "").slice("var_".length),
      { montante: 500 },
    );
    const pub = await pedir(
      "POST",
      `/products/${f.id}/publications`,
      { canal: `chn_${canal}`, mercado: `mkt_${mercado}` },
      { segredo: publicacao },
    );
    expect(pub.json<{ publicada: boolean }>().publicada).toBe(true);
    const r = await pedir("DELETE", `/translations/${f.id}/nome/es`);
    expect(r.statusCode).toBe(204);
    const pubs = (await pedir("GET", `/products/${f.id}/publications`)).json<{
      dados: { estado: string; motivo_arquivo: string | null }[];
    }>();
    expect(pubs.dados[0]).toMatchObject({
      estado: "arquivado",
      motivo_arquivo: "verificacao_falhou",
    });
    const outra = await pedir("DELETE", `/translations/${f.id}/nome/es`);
    expect(outra.statusCode).toBe(404);
  });

  it("as opções e os valores também se traduzem", async () => {
    const f = await artigo("Com cor", "TR-OPC");
    const o = (
      await pedir("POST", `/products/${f.id}/options`, {
        nome: "Cor",
        valores: ["Rosa"],
      })
    ).json<{ id: string; valores: { id: string }[] }>();
    const opcao = await traduzir(o.id, "nome", "Color", "Cor");
    expect(opcao.json()).toMatchObject({ recurso: o.id, estado: "completa" });
    const ovl = o.valores[0]?.id ?? "";
    const valor = await traduzir(ovl, "valor", "Rosa ES", "Rosa");
    expect(valor.json()).toMatchObject({ recurso: ovl, campo: "valor" });
  });

  it("de outro comerciante: 404 em todas; os âmbitos", async () => {
    const f = await artigo("Alheio", "TR-B");
    await traduzir(f.id, "nome", "Ajeno", "Alheio");
    for (const [metodo, url, corpo] of [
      ["GET", `/translations?resource=${f.id}`, undefined],
      [
        "PUT",
        `/translations/${f.id}/nome/es`,
        { texto: "X", origem: "pessoa", original_visto: "Alheio" },
      ],
      ["POST", `/translations/${f.id}/nome/es/review`, undefined],
      ["DELETE", `/translations/${f.id}/nome/es`, undefined],
    ] as const) {
      const r = await pedir(metodo, url, corpo, { segredo: escritaDeB });
      expect(r.statusCode, `${metodo} ${url}`).toBe(404);
      expect(r.json()).toMatchObject({ codigo: "catalog.not_found" });
    }
    // Nada mudou.
    expect(
      (await pedir("GET", `/translations?resource=${f.id}`)).json<
        Pagina<Traducao>
      >().dados[0]?.texto,
    ).toBe("Ajeno");
    // A fila de B não mostra o que é de A.
    const filaB = (
      await pedir("GET", "/translations?locale=es", undefined, {
        segredo: escritaDeB,
      })
    ).json<Pagina<{ recurso: string }>>();
    expect(filaB.dados.map((d) => d.recurso)).not.toContain(f.id);
    expect(
      (
        await pedir(
          "PUT",
          `/translations/${f.id}/nome/es`,
          { texto: "Y", origem: "pessoa", original_visto: "Alheio" },
          { segredo: leitura },
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await pedir("GET", `/translations?resource=${f.id}`, undefined, {
          segredo: semCatalogo,
        })
      ).statusCode,
    ).toBe(403);
  });
});
