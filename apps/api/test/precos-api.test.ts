import { randomUUID } from "node:crypto";
import { sql, type Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarApp } from "../src/app.js";
import type { BaseDados } from "../src/base/esquema.js";
import {
  criarEntidadeLegal,
  criarLoja,
  registarComerciante,
} from "../src/comerciante/repositorio.js";
import { criarChave } from "../src/identidade/repositorio.js";
import { precoPorUnidade } from "../src/precos/repositorio.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";

// A API de Preços e mercados, parte 2 (docs/20 §10; issue #127; migração
// 0036), pela app inteira. A base é criada sem o «quem» por omissão dos
// testes: cada escrita pela API tem de trazer o seu.

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

interface Preco {
  variante: string;
  montante: number;
  reducao: {
    id: string;
    montante: number;
    preco_referencia: number;
    em_vigor: boolean;
    fim: string | null;
  } | null;
  preco_por_unidade: {
    valor: string;
    unidade: string;
    inclui_iva: boolean;
  } | null;
}

describe("o preço por unidade", () => {
  it("por kg, l, m, m² e m³, com quatro casas e sem arredondar para mostrar", () => {
    expect(precoPorUnidade(990, 15, "ml")).toEqual({
      valor: "660.0000",
      unidade: "l",
    });
    expect(precoPorUnidade(790, 15, "ml")).toEqual({
      valor: "526.6667",
      unidade: "l",
    });
    expect(precoPorUnidade(250, 500, "g")).toEqual({
      valor: "5.0000",
      unidade: "kg",
    });
    expect(precoPorUnidade(1, 3, "cl")).toEqual({
      valor: "0.3333",
      unidade: "l",
    });
    expect(precoPorUnidade(1999, 2, "m2")).toEqual({
      valor: "9.9950",
      unidade: "m2",
    });
    expect(precoPorUnidade(100, 250, "mg")).toEqual({
      valor: "4000.0000",
      unidade: "kg",
    });
    expect(precoPorUnidade(990, null, null)).toBeNull();
    expect(precoPorUnidade(990, 3, "unidade")).toBeNull();
  });
});

describe.skipIf(URL_BASE === undefined)("API de Preços e mercados", () => {
  let base: BaseDeTeste;
  let app: ReturnType<typeof criarApp>;
  let a: string;
  let b: string;
  let loja: string;
  let precos: string;
  let precosId: string;
  let soLer: string;
  let catalogo: string;
  let catalogoId: string;
  let publica: string;
  let deB: string;

  const pedir = (
    metodo: "POST" | "PATCH" | "PUT" | "DELETE" | "GET",
    url: string,
    corpo?: unknown,
    segredo = precos,
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
  const ok = async (
    r: ReturnType<typeof pedir>,
    estado = 200,
  ): Promise<Record<string, unknown>> => {
    const x = await r;
    expect(x.statusCode, x.body).toBe(estado);
    return x.json();
  };

  /** Um mercado activo com a lista de base e um canal, pela API. */
  async function mercadoActivo(pais: string) {
    const m = await ok(
      pedir("POST", "/markets", {
        loja,
        nome: `Mercado ${pais}`,
        paises: [pais],
        moeda: "EUR",
        linguas: ["pt"],
        lingua_principal: "pt",
      }),
      201,
    );
    const l = await ok(
      pedir("POST", "/price-lists", {
        mercado: m["id"],
        nome: `Base ${pais}`,
        tipo: "base",
      }),
      201,
    );
    const act = await ok(
      pedir("POST", `/markets/${String(m["id"])}/activate`, {
        versao: m["versao"],
      }),
    );
    const c = await ok(
      pedir("POST", "/channels", {
        loja,
        nome: `Online ${pais}`,
        mercados: [m["id"]],
      }),
      201,
    );
    return {
      mercado: String(m["id"]),
      versaoMercado: Number(act["versao"]),
      lista: String(l["id"]),
      canal: String(c["id"]),
      versaoCanal: Number(c["versao"]),
    };
  }

  /** Um artigo com uma variante de 15 ml, pela API do Catálogo. */
  async function artigo(sku: string) {
    const r = await ok(
      pedir(
        "POST",
        "/products",
        {
          tipo: "fisico",
          nome: "Gel UV 15 ml",
          categoria_fiscal: "normal",
          variantes: [
            {
              sku,
              unidade_de_venda: "unidade",
              conteudo_quantidade: 15,
              conteudo_unidade: "ml",
              peso_g: 30,
            },
          ],
        },
        catalogo,
      ),
      201,
    );
    const variantes = r["variantes"] as { id: string }[];
    return {
      id: String(r["id"]),
      versao: Number(r["versao"]),
      variante: variantes[0]?.id ?? "",
    };
  }

  /**
   * Uma linha antiga no histórico, escrita à mão (o histórico só se
   * acrescenta: não se pode recuar uma linha). No contexto do comerciante:
   * os gatilhos dos eventos correm com o dono das tabelas, que tem o RLS
   * forçado.
   */
  async function linhaAntiga(
    lista: string,
    variante: string,
    montante: number,
    dias: number,
  ) {
    await base.dono.transaction().execute(async (trx) => {
      await sql`select set_config('eurolify.comerciante', ${a}, true)`.execute(
        trx,
      );
      await sql`insert into historico_preco (comerciante_id, lista_id, variante_id, montante,
                  gratuito, saiu, moeda, preco_inclui_iva, em_vigor_desde, definido_por)
                values (${a}, ${lista.slice(4)}, ${variante.slice(4)}, ${montante}, false, false,
                  'EUR', true, now() - make_interval(days => ${dias}), 'teste:antes')`.execute(
        trx,
      );
    });
  }

  /** Um preço com 40 dias de história (uma linha antiga no histórico, como se viesse de trás). */
  async function comHistoria(
    lista: string,
    variante: string,
    montante: number,
    dias = 40,
  ) {
    await ok(
      pedir("PUT", `/price-lists/${lista}/prices/${variante}`, { montante }),
    );
    await linhaAntiga(lista, variante, montante, dias);
  }

  beforeAll(async () => {
    base = await criarBaseDeTeste(URL_BASE ?? "", { quemPorOmissao: false });
    app = criarApp({ logger: false }, undefined, base.api);
    a = await registarComerciante(base.api, NOVO);
    b = await registarComerciante(base.api, NOVO);
    const entidade = await criarEntidadeLegal(base.api, a, ENTIDADE);
    loja = `sto_${await criarLoja(base.api, a, { entidade_legal_id: entidade, nome: "Loja online" })}`;
    const dono: Kysely<BaseDados> = base.dono;
    const chave = (c: string, nome: string, ambitos: string[]) =>
      criarChave(dono, c, {
        tipo: "servidor",
        criadaPor: "operador:teste",
        nome,
        ambitos: ambitos as never,
      });
    const p = await chave(a, "Preços", ["prices:read", "prices:write"]);
    precos = p.segredo;
    precosId = p.id;
    soLer = (await chave(a, "Ler preços", ["prices:read"])).segredo;
    const c = await chave(a, "Catálogo", ["catalog:read", "catalog:write"]);
    catalogo = c.segredo;
    catalogoId = c.id;
    publica = (await chave(a, "Publicar", ["catalog:publish"])).segredo;
    deB = (await chave(b, "Preços de B", ["prices:read", "prices:write"]))
      .segredo;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await base.fechar();
  });

  it("mercados, listas e canais pela API, com a versão; os âmbitos", async () => {
    const { mercado, lista, canal, versaoMercado } = await mercadoActivo("PT");
    expect(mercado).toMatch(/^mkt_/);
    expect(lista).toMatch(/^prl_/);
    expect(canal).toMatch(/^chn_/);
    const lido = await ok(
      pedir("GET", `/markets/${mercado}`, undefined, soLer),
    );
    expect(lido).toMatchObject({
      estado: "activo",
      preco_inclui_iva: true,
      loja,
    });
    const alterado = await ok(
      pedir("PATCH", `/markets/${mercado}`, {
        versao: versaoMercado,
        nome: "Portugal",
      }),
    );
    expect(alterado["nome"]).toBe("Portugal");
    const antigo = await pedir("PATCH", `/markets/${mercado}`, {
      versao: versaoMercado,
      nome: "Outro",
    });
    expect(antigo.statusCode).toBe(409);
    expect(antigo.json()).toMatchObject({ codigo: "prices.version_conflict" });
    const listas = await ok(
      pedir("GET", `/price-lists?mercado=${mercado}`, undefined, soLer),
    );
    expect((listas["dados"] as unknown[]).length).toBe(1);
    const canais = await ok(pedir("GET", "/channels", undefined, soLer));
    expect(canais["dados"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: canal, mercados: [mercado] }),
      ]),
    );
    // Só ler não escreve; o Catálogo não mexe em preços; outro comerciante não vê.
    expect((await pedir("POST", "/markets", {}, soLer)).statusCode).toBe(403);
    expect(
      (await pedir("GET", "/markets", undefined, catalogo)).statusCode,
    ).toBe(403);
    expect(
      (await pedir("GET", `/markets/${mercado}`, undefined, deB)).statusCode,
    ).toBe(404);
    // Um país já noutro mercado activo da loja.
    const m2 = await ok(
      pedir("POST", "/markets", {
        loja,
        nome: "Outra vez PT",
        paises: ["PT"],
        moeda: "EUR",
        linguas: ["pt"],
        lingua_principal: "pt",
      }),
      201,
    );
    await ok(
      pedir("POST", "/price-lists", {
        mercado: m2["id"],
        nome: "Base",
        tipo: "base",
      }),
      201,
    );
    const repetido = await pedir(
      "POST",
      `/markets/${String(m2["id"])}/activate`,
      {
        versao: m2["versao"],
      },
    );
    expect(repetido.statusCode).toBe(409);
    expect(repetido.json()).toMatchObject({
      codigo: "prices.country_in_other_market",
    });
  });

  it("o preço de uma variante: pôr, ler com o preço por unidade, o histórico, tirar; quem fez é a chave", async () => {
    const { lista } = await mercadoActivo("ES");
    const { variante } = await artigo("PRC-1");
    const p = (await ok(
      pedir("PUT", `/price-lists/${lista}/prices/${variante}`, {
        montante: 990,
      }),
    )) as unknown as Preco;
    expect(p).toMatchObject({
      variante,
      montante: 990,
      reducao: null,
      preco_por_unidade: { valor: "660.0000", unidade: "l", inclui_iva: true },
    });
    const zero = await pedir(
      "PUT",
      `/price-lists/${lista}/prices/${variante}`,
      { montante: 0 },
    );
    expect(zero.statusCode).toBe(422);
    expect(zero.json()).toMatchObject({ codigo: "prices.free_only_at_zero" });
    await ok(
      pedir("PUT", `/price-lists/${lista}/prices/${variante}`, {
        montante: 1090,
      }),
    );
    const todos = await ok(
      pedir("GET", `/price-lists/${lista}/prices`, undefined, soLer),
    );
    expect(todos["dados"]).toEqual([
      expect.objectContaining({ variante, montante: 1090 }),
    ]);
    const h = await ok(
      pedir(
        "GET",
        `/price-lists/${lista}/prices/${variante}/history`,
        undefined,
        soLer,
      ),
    );
    expect(
      (h["linhas"] as { montante: number }[]).map((l) => l.montante),
    ).toEqual([990, 1090]);
    const { rows } = await sql<{ definido_por: string }>`
      select definido_por from historico_preco where variante_id = ${variante.slice(4)}`.execute(
      base.dono,
    );
    expect(new Set(rows.map((r) => r.definido_por))).toEqual(
      new Set([`chave:key_${precosId}`]),
    );
    expect(
      (await pedir("DELETE", `/price-lists/${lista}/prices/${variante}`))
        .statusCode,
    ).toBe(204);
    expect(
      (await pedir("DELETE", `/price-lists/${lista}/prices/${variante}`))
        .statusCode,
    ).toBe(404);
  });

  it("a redução: o preço de referência do histórico; sem 30 dias, abaixo ou com outra em vigor, recusa; o preço não muda por baixo dela", async () => {
    const { lista } = await mercadoActivo("FR");
    const { variante } = await artigo("RED-1");
    const url = `/price-lists/${lista}/prices/${variante}`;
    await ok(pedir("PUT", url, { montante: 990 }));
    const semHistoria = await pedir("PUT", `${url}/reduction`, {
      montante: 790,
    });
    expect(semHistoria.statusCode).toBe(422);
    expect(semHistoria.json()).toMatchObject({
      codigo: "prices.reduction_without_history",
    });
    // 40 dias a 950 e agora 990: o mais baixo praticado nos 30 dias é 950.
    await linhaAntiga(lista, variante, 950, 40);
    const igual = await pedir("PUT", `${url}/reduction`, { montante: 950 });
    expect(igual.statusCode).toBe(422);
    expect(igual.json()).toMatchObject({
      codigo: "prices.reduction_not_lower",
    });
    const fim = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const r = (await ok(
      pedir("PUT", `${url}/reduction`, { montante: 790, fim }),
    )) as unknown as Preco;
    expect(r.reducao).toMatchObject({
      montante: 790,
      preco_referencia: 950,
      em_vigor: true,
    });
    expect(r.reducao?.id).toMatch(/^red_/);
    // O preço por unidade é o do preço reduzido.
    expect(r.preco_por_unidade?.valor).toBe("526.6667");
    const outra = await pedir("PUT", `${url}/reduction`, { montante: 700 });
    expect(outra.statusCode).toBe(409);
    expect(outra.json()).toMatchObject({ codigo: "prices.reduction_active" });
    const mudar = await pedir("PUT", url, { montante: 1200 });
    expect(mudar.statusCode).toBe(409);
    expect(mudar.json()).toMatchObject({ codigo: "prices.reduction_active" });
    expect((await pedir("DELETE", url)).statusCode).toBe(409);
    // Mudar só as quantidades não é mudar o preço.
    await ok(pedir("PUT", url, { montante: 990, quantidade_minima: 2 }));
    // Tirar a redução; depois, a seguinte conta com ela (o mais baixo praticado).
    const tirada = (await ok(
      pedir("DELETE", `${url}/reduction`),
    )) as unknown as Preco;
    expect(tirada.reducao).toBeNull();
    expect((await pedir("DELETE", `${url}/reduction`)).statusCode).toBe(404);
    const seguinte = (await ok(
      pedir("PUT", `${url}/reduction`, { montante: 700 }),
    )) as unknown as Preco;
    expect(seguinte.reducao?.preco_referencia).toBe(790);
    await ok(pedir("DELETE", `${url}/reduction`));
    const h = await ok(pedir("GET", `${url}/history`, undefined, soLer));
    expect(
      (h["reducoes"] as { montante: number; em_vigor: boolean }[]).map((x) => [
        x.montante,
        x.em_vigor,
      ]),
    ).toEqual([
      [790, false],
      [700, false],
    ]);
    // Os eventos e quem fez.
    const { rows } = await sql<{ tipo: string; quem: string }>`
      select tipo, dados->>'quem' as quem from evento_saida
      where tipo like 'promotion.%' and agregado_id = ${variante.slice(4)}
      order by criado_em, id`.execute(base.dono);
    expect(rows.map((x) => x.tipo)).toEqual([
      "promotion.started",
      "promotion.ended",
      "promotion.started",
      "promotion.ended",
    ]);
    expect(new Set(rows.map((x) => x.quem))).toEqual(
      new Set([`chave:key_${precosId}`]),
    );
  });

  it("um preço que saiu da lista dentro dos 30 dias não dá redução", async () => {
    const { lista } = await mercadoActivo("BE");
    const { variante } = await artigo("RED-4");
    await comHistoria(lista, variante, 990);
    await base.dono.transaction().execute(async (trx) => {
      await sql`select set_config('eurolify.comerciante', ${a}, true)`.execute(
        trx,
      );
      await sql`insert into historico_preco (comerciante_id, lista_id, variante_id, montante,
                  gratuito, saiu, moeda, preco_inclui_iva, em_vigor_desde, definido_por)
                values (${a}, ${lista.slice(4)}, ${variante.slice(4)}, null, null, true, 'EUR', true,
                  now() - interval '10 days', 'teste:antes')`.execute(trx);
    });
    const r = await pedir(
      "PUT",
      `/price-lists/${lista}/prices/${variante}/reduction`,
      {
        montante: 800,
      },
    );
    expect(r.statusCode).toBe(422);
    expect(r.json()).toMatchObject({
      codigo: "prices.reduction_without_history",
    });
  });

  it("a redução não se altera nem se apaga, nem pelo dono das tabelas", async () => {
    const { lista } = await mercadoActivo("IT");
    const { variante } = await artigo("RED-2");
    await comHistoria(lista, variante, 990);
    await ok(
      pedir("PUT", `/price-lists/${lista}/prices/${variante}/reduction`, {
        montante: 800,
      }),
    );
    for (const texto of [
      sql`update reducao set montante = 1 where variante_id = ${variante.slice(4)}`,
      sql`delete from reducao where variante_id = ${variante.slice(4)}`,
      sql`truncate reducao`,
    ]) {
      await expect(
        base.dono.transaction().execute(async (trx) => {
          await sql`select set_config('eurolify.quem', 'teste', true)`.execute(
            trx,
          );
          await texto.execute(trx);
        }),
      ).rejects.toThrow(/prices.immutable_identity|audit.append_only/);
    }
  });

  it("apagar o rascunho com uma redução em vigor termina a redução com ele", async () => {
    const { lista } = await mercadoActivo("DE");
    const { id, variante } = await artigo("RED-3");
    await comHistoria(lista, variante, 990);
    await ok(
      pedir("PUT", `/price-lists/${lista}/prices/${variante}/reduction`, {
        montante: 800,
      }),
    );
    expect(
      (await pedir("DELETE", `/products/${id}`, undefined, catalogo))
        .statusCode,
    ).toBe(204);
    const { rows } = await sql<{ terminada_por: string | null }>`
      select terminada_por from reducao where variante_id = ${variante.slice(4)}`.execute(
      base.dono,
    );
    expect(rows).toEqual([{ terminada_por: `chave:key_${catalogoId}` }]);
  });

  it("arquivar o mercado pela API tira de venda com quem fez (revisão do #208, P1-2)", async () => {
    const { mercado, lista, canal, versaoMercado } = await mercadoActivo("NL");
    const f = await artigo("PUB-1");
    const cl = await ok(
      pedir(
        "PUT",
        `/products/${f.id}/classification`,
        {
          versao: f.versao,
          familias: ["retalho_geral"],
          natureza_consumidor: "bem",
        },
        catalogo,
      ),
    );
    await ok(
      pedir(
        "POST",
        `/products/${f.id}/activate`,
        { versao: cl["versao"] },
        catalogo,
      ),
    );
    await ok(
      pedir("PUT", `/price-lists/${lista}/prices/${f.variante}`, {
        montante: 990,
      }),
    );
    const pub = await ok(
      pedir(
        "POST",
        `/products/${f.id}/publications`,
        { canal, mercado },
        publica,
      ),
    );
    expect(pub["publicada"], JSON.stringify(pub)).toBe(true);
    await ok(
      pedir("POST", `/markets/${mercado}/archive`, { versao: versaoMercado }),
    );
    const { rows } = await sql<{ estado: string; arquivado_por: string }>`
      select estado, arquivado_por from publicacao where artigo_id = ${f.id.slice(4)}`.execute(
      base.dono,
    );
    expect(rows).toEqual([
      { estado: "arquivado", arquivado_por: `chave:key_${precosId}` },
    ]);
  });

  it("os âmbitos dos papéis: dono e gestor escrevem; armazém e apoio só lêem", async () => {
    const { rows } = await sql<{ papel: string; ambitos: string[] }>`
      select p as papel, array(select x from unnest(papel_ambitos(p)) x where x like 'prices:%' order by x) as ambitos
      from unnest(array['dono', 'gestor', 'armazem', 'apoio']) as p`.execute(
      base.dono,
    );
    expect(rows).toEqual([
      { papel: "dono", ambitos: ["prices:read", "prices:write"] },
      { papel: "gestor", ambitos: ["prices:read", "prices:write"] },
      { papel: "armazem", ambitos: ["prices:read"] },
      { papel: "apoio", ambitos: ["prices:read"] },
    ]);
  });
});
