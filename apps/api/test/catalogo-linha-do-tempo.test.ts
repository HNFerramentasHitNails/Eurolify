import { randomUUID } from "node:crypto";
import { sql, type Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarApp } from "../src/app.js";
import {
  ENTIDADES_DA_LINHA_DO_TEMPO,
  type BaseDados,
} from "../src/base/esquema.js";
import { traduzir } from "../src/catalogo/erros.js";
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

// A linha do tempo do artigo (docs/14 §3.12; C7; migração 0033), pela app
// inteira. A base é criada **sem** o «quem» por omissão dos outros testes:
// cada escrita pela API tem de trazer o seu (posto em `escrever`), e uma que
// não o traga falha aqui.

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

interface Ficha {
  id: string;
  versao: number;
  variantes: { id: string; sku: string }[];
}
interface Alteracao {
  id: string;
  em: string;
  quem: string;
  origem: string | null;
  transacao: string;
  entidade: string;
  entidade_id: string | null;
  operacao: string;
  campos: Record<string, { antes: unknown; depois: unknown }>;
}
interface Pagina {
  dados: Alteracao[];
  total: number;
  ha_mais: boolean;
  cursor_seguinte: string | null;
}

const sem = (id: string) => id.slice(id.indexOf("_") + 1);

describe.skipIf(URL_BASE === undefined)("linha do tempo do artigo", () => {
  let base: BaseDeTeste;
  let app: ReturnType<typeof criarApp>;
  let a: string;
  let b: string;
  let escrita: string;
  let escritaId: string;
  let publica: string;
  let publicaId: string;
  let historia: string;
  let leitura: string;
  let historiaB: string;
  let importa: string;
  let canal: string;
  let mercado: string;
  let lista: string;

  const pedir = (
    metodo: "POST" | "PATCH" | "PUT" | "DELETE" | "GET",
    url: string,
    corpo?: unknown,
    segredo = escrita,
  ) =>
    app.inject({
      method: metodo,
      url,
      headers: {
        authorization: `Bearer ${segredo}`,
        ...(metodo === "GET" ? {} : { "idempotency-key": randomUUID() }),
        ...(corpo === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(corpo === undefined ? {} : { payload: JSON.stringify(corpo) }),
    });

  async function linhaDoTempo(id: string, consulta = "", segredo = historia) {
    const r = await pedir(
      "GET",
      `/products/${id}/timeline${consulta}`,
      undefined,
      segredo,
    );
    expect(r.statusCode, r.body).toBe(200);
    return r.json<Pagina>();
  }

  async function novo(sku: string, nome = "Gel UV 15 ml") {
    const r = await pedir("POST", "/products", {
      tipo: "fisico",
      nome,
      categoria_fiscal: "normal",
      variantes: [{ sku, unidade_de_venda: "unidade", peso_g: 30 }],
    });
    expect(r.statusCode, r.body).toBe(201);
    return r.json<Ficha>();
  }

  beforeAll(async () => {
    base = await criarBaseDeTeste(URL_BASE ?? "", { quemPorOmissao: false });
    app = criarApp({ logger: false }, undefined, base.api);
    a = await registarComerciante(base.api, NOVO);
    b = await registarComerciante(base.api, NOVO);
    const dono: Kysely<BaseDados> = base.dono;
    const chave = async (c: string, nome: string, ambitos: string[]) =>
      criarChave(dono, c, {
        tipo: "servidor",
        criadaPor: "operador:teste",
        nome,
        ambitos: ambitos as never,
      });
    const e = await chave(a, "Escrita", ["catalog:read", "catalog:write"]);
    escrita = e.segredo;
    escritaId = e.id;
    const p = await chave(a, "Publicação", ["catalog:publish"]);
    publica = p.segredo;
    publicaId = p.id;
    historia = (await chave(a, "Histórico", ["catalog:history"])).segredo;
    leitura = (await chave(a, "Leitura", ["catalog:read"])).segredo;
    historiaB = (await chave(b, "Histórico B", ["catalog:history"])).segredo;
    importa = (await chave(a, "Importar", ["catalog:import"])).segredo;
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

  it("cada escrita pela API fica com quem, quando, antes e depois; a mais recente primeiro", async () => {
    const f = await novo("TL-1");
    const v = f.variantes[0]?.id ?? "";
    // O mesmo nome: a versão pode subir, mas nenhum campo muda e nada
    // fica na linha do tempo.
    const igual = await pedir("PATCH", `/products/${f.id}`, {
      versao: f.versao,
      nome: "Gel UV 15 ml",
    });
    expect(igual.statusCode).toBe(200);
    const mudou = await pedir("PATCH", `/products/${f.id}`, {
      versao: igual.json<Ficha>().versao,
      nome: "Gel UV 15 ml transparente",
    });
    expect(mudou.statusCode, mudou.body).toBe(200);
    const c = await pedir("PUT", `/products/${f.id}/classification`, {
      versao: mudou.json<Ficha>().versao,
      familias: ["retalho_geral"],
      natureza_consumidor: "bem",
    });
    expect(c.statusCode, c.body).toBe(200);
    const act = await pedir("POST", `/products/${f.id}/activate`, {
      versao: c.json<Ficha>().versao,
    });
    expect(act.statusCode, act.body).toBe(200);
    await definirPreco(base.api, a, "pessoa:per_teste", lista, sem(v), {
      montante: 990,
    });
    const pub = await pedir(
      "POST",
      `/products/${f.id}/publications`,
      { canal: `chn_${canal}`, mercado: `mkt_${mercado}` },
      publica,
    );
    expect(pub.statusCode, pub.body).toBe(200);
    expect(pub.json<{ publicada: boolean }>().publicada).toBe(true);

    const { dados, total } = await linhaDoTempo(f.id);
    expect(total).toBe(dados.length);
    // A mais recente primeiro.
    const ids = dados.map((d) => d.id);
    expect([...ids].sort().reverse()).toEqual(ids);
    // Quem: a chave de cada pedido, nunca outro.
    for (const d of dados) {
      expect(d.quem, JSON.stringify(d)).toMatch(
        new RegExp(`^chave:key_(${escritaId}|${publicaId})$`),
      );
      expect(d.origem).toBeNull();
      expect(d.id).toMatch(/^chg_/);
    }
    // O nome: uma entrada só, com o antes e o depois, sem campos técnicos.
    const nome = dados.filter(
      (d) => d.entidade === "artigo" && d.campos["nome"] !== undefined,
    );
    expect(nome.map((d) => [d.operacao, d.campos["nome"]])).toEqual([
      [
        "alterado",
        { antes: "Gel UV 15 ml", depois: "Gel UV 15 ml transparente" },
      ],
      ["criado", { antes: null, depois: "Gel UV 15 ml" }],
    ]);
    expect(Object.keys(nome[0]?.campos ?? {})).toEqual(["nome"]);
    expect(nome[0]?.entidade_id).toBe(f.id);
    // Criar o artigo e a variante foi uma transacção só.
    const criacao = dados.filter((d) => d.operacao === "criado");
    const artigoCriado = criacao.find((d) => d.entidade === "artigo");
    const varianteCriada = criacao.find((d) => d.entidade === "variante");
    expect(varianteCriada?.entidade_id).toBe(v);
    expect(varianteCriada?.transacao).toBe(artigoCriado?.transacao);
    expect(varianteCriada?.campos["sku"]).toEqual({
      antes: null,
      depois: "TL-1",
    });
    // Nem quem classificou nem a versão entram nos campos.
    for (const d of dados) {
      for (const k of ["versao", "classificado_por", "publicado_por"]) {
        expect(d.campos[k], k).toBeUndefined();
      }
    }
    // A classificação, a activação e a publicação estão lá.
    expect(
      dados.some(
        (d) =>
          d.entidade === "artigo" &&
          (d.campos["estado"]?.depois as string | undefined) === "activo",
      ),
    ).toBe(true);
    expect(
      dados.some(
        (d) => d.entidade === "publicacao" && d.quem.endsWith(publicaId),
      ),
    ).toBe(true);
    // O preço é de Preços e mercados: não entra aqui.
    expect(dados.every((d) => d.quem !== "pessoa:per_teste")).toBe(true);
  });

  it("por páginas, e com os filtros da entidade e do instante", async () => {
    const f = await novo("TL-2");
    let versao = f.versao;
    for (const nome of ["A", "B", "C"]) {
      const r = await pedir("PATCH", `/products/${f.id}`, { versao, nome });
      versao = r.json<Ficha>().versao;
    }
    const p1 = await linhaDoTempo(f.id, "?limite=2");
    expect(p1.dados).toHaveLength(2);
    expect(p1.ha_mais).toBe(true);
    const p2 = await linhaDoTempo(
      f.id,
      `?limite=2&cursor=${p1.cursor_seguinte ?? ""}`,
    );
    const todos = await linhaDoTempo(f.id);
    expect([...p1.dados, ...p2.dados].map((d) => d.id)).toEqual(
      todos.dados.slice(0, 4).map((d) => d.id),
    );
    const variantes = await linhaDoTempo(f.id, "?entidade=variante");
    expect(variantes.dados.map((d) => d.entidade)).toEqual(["variante"]);
    expect(variantes.total).toBe(1);
    const futuro = new Date(Date.now() + 3_600_000).toISOString();
    expect(
      (await linhaDoTempo(f.id, `?desde=${encodeURIComponent(futuro)}`)).dados,
    ).toEqual([]);
    const ano0 = await pedir(
      "GET",
      `/products/${f.id}/timeline?desde=0000-01-01T00:00:00Z`,
      undefined,
      historia,
    );
    expect(ano0.statusCode).toBe(400);
  });

  it("pede catalog:history; outro comerciante não vê; um artigo que não existe dá 404", async () => {
    const f = await novo("TL-3");
    const semAmbito = await pedir(
      "GET",
      `/products/${f.id}/timeline`,
      undefined,
      leitura,
    );
    expect(semAmbito.statusCode).toBe(403);
    const deB = await pedir(
      "GET",
      `/products/${f.id}/timeline`,
      undefined,
      historiaB,
    );
    expect(deB.statusCode).toBe(404);
    expect(deB.json()).toMatchObject({ codigo: "catalog.not_found" });
    const nenhum = await pedir(
      "GET",
      `/products/prd_${randomUUID()}/timeline`,
      undefined,
      historia,
    );
    expect(nenhum.statusCode).toBe(404);
  });

  it("apagar um rascunho deixa as entradas, com a do apagamento", async () => {
    const f = await novo("TL-4");
    expect((await pedir("DELETE", `/products/${f.id}`)).statusCode).toBe(204);
    const { dados } = await linhaDoTempo(f.id);
    expect(
      dados.filter((d) => d.operacao === "apagado").map((d) => d.entidade),
    ).toEqual(expect.arrayContaining(["artigo", "variante"]));
    expect(dados.filter((d) => d.operacao === "criado")).toHaveLength(2);
  });

  it("o que a importação muda leva a origem", async () => {
    const f = await novo("TL-5");
    const ficheiro =
      [
        "artigo,tipo,nome,descricao,sku,unidade_de_venda,peso_g,gtin,gtin_origem",
        `${f.id},,Gel importado,,TL-5,,45,,`,
      ].join("\r\n") + "\r\n";
    const ensaio = await app.inject({
      method: "POST",
      url: "/imports",
      headers: {
        authorization: `Bearer ${importa}`,
        "idempotency-key": randomUUID(),
        "content-type": "text/csv",
      },
      payload: ficheiro,
    });
    expect(ensaio.statusCode, ensaio.body).toBe(201);
    const imp = ensaio.json<{ id: string }>().id;
    const aplicar = await app.inject({
      method: "POST",
      url: `/imports/${imp}/apply`,
      headers: {
        authorization: `Bearer ${importa}`,
        "idempotency-key": randomUUID(),
      },
    });
    expect(aplicar.statusCode, aplicar.body).toBe(200);
    const { dados } = await linhaDoTempo(f.id);
    const importadas = dados.filter((d) => d.origem !== null);
    expect(importadas.map((d) => [d.entidade, d.origem])).toEqual(
      expect.arrayContaining([
        ["artigo", `importacao:${imp}`],
        ["variante", `importacao:${imp}`],
      ]),
    );
    expect(
      importadas.find((d) => d.entidade === "variante")?.campos["peso_g"],
    ).toEqual({ antes: 30, depois: 45 });
  });

  it("sem quem, a base recusa a mudança; o rasto só se acrescenta; a API não o escreve", async () => {
    const f = await novo("TL-6");
    const semQuem = await comComerciante(base.api, a, (trx) =>
      sql`update artigo set nome = 'Outro' where id = ${sem(f.id)}`.execute(
        trx,
      ),
    ).then(
      () => "sem erro",
      (e: unknown) => {
        const t = traduzir(e);
        return t instanceof Error ? t.message : String(t);
      },
    );
    expect(semQuem).toMatch(/catalog\.change_without_who/);
    // Nem o dono (superutilizador) altera ou apaga uma entrada.
    for (const texto of [
      sql`update alteracao_catalogo set quem = 'x'`,
      sql`delete from alteracao_catalogo`,
      sql`truncate alteracao_catalogo`,
    ]) {
      await expect(texto.execute(base.dono)).rejects.toThrow(
        /audit\.append_only/,
      );
    }
    // A API só lê.
    await expect(
      comComerciante(base.api, a, (trx) =>
        sql`insert into alteracao_catalogo (comerciante_id, entidade, operacao, campos, quem, transacao)
            values (${a}, 'artigo', 'criado', '{"x":{"antes":null,"depois":1}}', 'eu', 1)`.execute(
          trx,
        ),
      ),
    ).rejects.toThrow(/permission denied/);
    // E só vê as do seu comerciante.
    const deB = await comComerciante(base.api, b, (trx) =>
      trx
        .selectFrom("alteracao_catalogo")
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .executeTakeFirstOrThrow(),
    );
    expect(Number(deB.n)).toBe(0);
  });

  it("todas as tabelas do Catálogo têm o gatilho; o âmbito novo é do dono e do gestor", async () => {
    // As que têm artigo, mais as que pertencem a um artigo por outro
    // caminho (a composição, pelo kit) e as categorias e colecções. Uma
    // tabela nova com `artigo_id` sem gatilho faz falhar este teste.
    const { rows: comArtigo } = await sql<{ tabela: string }>`
      select table_name as tabela from information_schema.columns
      where table_schema = 'public' and column_name = 'artigo_id'
        and table_name not in ('alteracao_catalogo', 'combinacoes_por_verificar')`.execute(
      base.dono,
    );
    const esperadas = [
      ...new Set([
        ...comArtigo.map((r) => r.tabela),
        "artigo",
        "componente",
        "categoria",
        "colecao",
      ]),
    ].sort();
    const { rows: comGatilho } = await sql<{ tabela: string }>`
      select c.relname as tabela from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      where t.tgname = c.relname || '_linha_do_tempo' and t.tgenabled <> 'D'
      order by 1`.execute(base.dono);
    expect(comGatilho.map((r) => r.tabela)).toEqual(esperadas);
    expect(esperadas).toEqual([...ENTIDADES_DA_LINHA_DO_TEMPO].sort());
    const { rows } = await sql<{ papel: string; tem: boolean }>`
      select p as papel, 'catalog:history' = any (papel_ambitos(p)) as tem
      from unnest(array['dono', 'gestor', 'armazem', 'apoio']) as p`.execute(
      base.dono,
    );
    expect(rows).toEqual([
      { papel: "dono", tem: true },
      { papel: "gestor", tem: true },
      { papel: "armazem", tem: false },
      { papel: "apoio", tem: false },
    ]);
  });
});
