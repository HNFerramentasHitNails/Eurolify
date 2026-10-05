import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  acrescentarValor,
  apagarRascunho,
  arquivarVariante,
  criarArtigo,
  criarOpcao,
  criarVariante,
  criarVarianteComValores,
  definirValoresDaVariante,
  ErroCatalogo,
  mudarEstadoArtigo,
  opcoesDoArtigo,
  valoresDaVariante,
  varianteComSku,
  type DadosVariante,
} from "../src/catalogo/repositorio.js";
import { registarComerciante } from "../src/comerciante/repositorio.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";

// Catálogo, parte 2b: opções e valores (docs/14 §3.3 e §3.2; migração 0005;
// issue #77), contra o PostgreSQL 18 verdadeiro e com o eurolify_api.

const NOVO = { nome: "Loja de Teste", lingua: "pt", fuso: "Europe/Lisbon" };

function variante(sku: string): DadosVariante {
  return { sku, unidade_de_venda: "unidade" };
}

async function codigoDoErro(promessa: Promise<unknown>): Promise<string> {
  try {
    await promessa;
  } catch (erro) {
    if (erro instanceof ErroCatalogo) return erro.codigo;
    const pgErro = erro as { code?: unknown; message?: unknown };
    return `pg:${String(pgErro.code)}:${String(pgErro.message)}`;
  }
  return "sem erro";
}

describe.skipIf(URL_BASE === undefined)("opções na base", () => {
  let base: BaseDeTeste;

  beforeAll(async () => {
    base = await criarBaseDeTeste(URL_BASE ?? "");
  }, 60_000);

  afterAll(async () => {
    await base.fechar();
  });

  /** Um rascunho «Verniz» com Cor (Vermelho, Nude) e Tamanho (5 ml, 15 ml). */
  async function verniz(c?: string) {
    const comerciante = c ?? (await registarComerciante(base.api, NOVO));
    const artigo = await criarArtigo(base.api, comerciante, {
      tipo: "fisico",
      nome: "Verniz",
    });
    const cor = await criarOpcao(base.api, comerciante, artigo, "Cor", [
      "Vermelho",
      "Nude",
    ]);
    const tamanho = await criarOpcao(base.api, comerciante, artigo, "Tamanho", [
      "5 ml",
      "15 ml",
    ]);
    const [vermelho, nude] = cor.valores.map((v) => v.id);
    const [pequeno, grande] = tamanho.valores.map((v) => v.id);
    return {
      c: comerciante,
      artigo,
      cor,
      tamanho,
      v: {
        vermelho: vermelho ?? "",
        nude: nude ?? "",
        pequeno: pequeno ?? "",
        grande: grande ?? "",
      },
    };
  }

  async function esperaBloqueio(promessa: Promise<unknown>): Promise<boolean> {
    const estado = { acabou: false };
    const fim = () => {
      estado.acabou = true;
    };
    promessa.then(fim, fim);
    for (let i = 0; i < 100 && !estado.acabou; i++) {
      const { rows } = await sql<{ n: number }>`
        select count(*)::int as n from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'`.execute(
        base.dono,
      );
      if ((rows[0]?.n ?? 0) > 0) return true;
      await new Promise((r) => {
        setTimeout(r, 50);
      });
    }
    return false;
  }

  it("cria opções com valores e lê-as pela ordem", async () => {
    const { c, artigo } = await verniz();
    expect(
      (await opcoesDoArtigo(base.api, c, artigo)).map((o) => [
        o.nome,
        o.valores.map((v) => v.valor),
      ]),
    ).toEqual([
      ["Cor", ["Vermelho", "Nude"]],
      ["Tamanho", ["5 ml", "15 ml"]],
    ]);
  });

  it("nomes de opção e valores não se repetem, sem distinguir maiúsculas", async () => {
    const { c, artigo, cor } = await verniz();
    expect(
      await codigoDoErro(criarOpcao(base.api, c, artigo, " cor ", [])),
    ).toBe("catalog.option_duplicate");
    expect(
      await codigoDoErro(acrescentarValor(base.api, c, cor.id, "NUDE")),
    ).toBe("catalog.option_value_duplicate");
    expect(await codigoDoErro(criarOpcao(base.api, c, artigo, "   ", []))).toBe(
      "catalog.invalid_field",
    );
  });

  it("sem opções, várias variantes são permitidas e o artigo activa (P10)", async () => {
    const c = await registarComerciante(base.api, NOVO);
    const artigo = await criarArtigo(
      base.api,
      c,
      { tipo: "fisico", nome: "Gel" },
      [variante("GEL-001"), variante("GEL-REFILL")],
    );
    await mudarEstadoArtigo(base.api, c, artigo, 1, "activo");
  });

  it("num rascunho a combinação pode estar incompleta; activar exige-a completa", async () => {
    const { c, artigo, v } = await verniz();
    const a = await criarVariante(base.api, c, artigo, variante("VZ-1"));
    await definirValoresDaVariante(base.api, c, a, [v.vermelho]);
    expect(
      await codigoDoErro(mudarEstadoArtigo(base.api, c, artigo, 1, "activo")),
    ).toBe("catalog.options_incomplete");
    await definirValoresDaVariante(base.api, c, a, [v.vermelho, v.pequeno]);
    await mudarEstadoArtigo(base.api, c, artigo, 1, "activo");
    expect(await valoresDaVariante(base.api, c, a)).toEqual(
      [v.vermelho, v.pequeno].sort(),
    );
  });

  it("duas variantes activas não têm a mesma combinação; a de uma arquivada volta", async () => {
    const { c, artigo, v } = await verniz();
    const a = await criarVarianteComValores(
      base.api,
      c,
      artigo,
      variante("VZ-A"),
      [v.vermelho, v.pequeno],
    );
    expect(
      await codigoDoErro(
        criarVarianteComValores(base.api, c, artigo, variante("VZ-B"), [
          v.pequeno,
          v.vermelho,
        ]),
      ),
    ).toBe("catalog.option_combination_duplicate");
    // A recusa não deixou a variante B.
    expect(await varianteComSku(base.api, c, "VZ-B")).toBeUndefined();
    await mudarEstadoArtigo(base.api, c, artigo, 1, "activo");
    await arquivarVariante(base.api, c, a);
    await criarVarianteComValores(base.api, c, artigo, variante("VZ-C"), [
      v.vermelho,
      v.pequeno,
    ]);
  });

  it("num artigo à venda: variante nova completa, opções e valores das variantes fixos", async () => {
    const { c, artigo, cor, v } = await verniz();
    const a = await criarVarianteComValores(
      base.api,
      c,
      artigo,
      variante("VV-A"),
      [v.vermelho, v.pequeno],
    );
    await mudarEstadoArtigo(base.api, c, artigo, 1, "activo");
    // Variante nova sem valores, ou só com alguns: recusada.
    expect(
      await codigoDoErro(criarVariante(base.api, c, artigo, variante("VV-B"))),
    ).toBe("catalog.options_incomplete");
    expect(
      await codigoDoErro(
        criarVarianteComValores(base.api, c, artigo, variante("VV-C"), [
          v.nude,
        ]),
      ),
    ).toBe("catalog.options_incomplete");
    // Valor novo e variante nova com ele: sim.
    const coral = await acrescentarValor(base.api, c, cor.id, "Coral");
    await criarVarianteComValores(base.api, c, artigo, variante("VV-D"), [
      coral,
      v.grande,
    ]);
    // Opção nova, ou mudar os valores de uma variante vendida: não.
    expect(
      await codigoDoErro(
        criarOpcao(base.api, c, artigo, "Acabamento", ["Mate"]),
      ),
    ).toBe("catalog.not_draft");
    expect(
      await codigoDoErro(
        definirValoresDaVariante(base.api, c, a, [v.nude, v.pequeno]),
      ),
    ).toBe("catalog.not_draft");
    expect(await valoresDaVariante(base.api, c, a)).toEqual(
      [v.vermelho, v.pequeno].sort(),
    );
  });

  it("valores de outro artigo, ou dois da mesma opção, são recusados", async () => {
    const um = await verniz();
    const outro = await verniz(um.c);
    const a = await criarVariante(base.api, um.c, um.artigo, variante("VO-A"));
    expect(
      await codigoDoErro(
        definirValoresDaVariante(base.api, um.c, a, [outro.v.vermelho]),
      ),
    ).toBe("catalog.not_found");
    expect(
      await codigoDoErro(
        definirValoresDaVariante(base.api, um.c, a, [um.v.vermelho, um.v.nude]),
      ),
    ).toBe("catalog.option_repeated");
  });

  it("apaga-se o rascunho com opções, valores e variantes", async () => {
    const { c, artigo, v } = await verniz();
    await criarVarianteComValores(base.api, c, artigo, variante("VR-A"), [
      v.vermelho,
      v.pequeno,
    ]);
    await apagarRascunho(base.api, c, artigo);
    expect(await opcoesDoArtigo(base.api, c, artigo)).toEqual([]);
    const { rows } = await sql<{ n: number }>`
      select (select count(*) from valor_opcao where comerciante_id = ${c})
           + (select count(*) from variante_valor where comerciante_id = ${c}) as n`.execute(
      base.dono,
    );
    expect(Number(rows[0]?.n)).toBe(0);
  });

  it("isolamento: outro comerciante não cria, não lê e não usa as opções de um", async () => {
    const a = await verniz();
    const b = await registarComerciante(base.api, NOVO);
    const artigoB = await criarArtigo(base.api, b, {
      tipo: "fisico",
      nome: "Meu",
    });
    const varB = await criarVariante(base.api, b, artigoB, variante("MEU-1"));
    expect(
      await codigoDoErro(criarOpcao(base.api, b, a.artigo, "Intrusa", [])),
    ).toBe("catalog.not_found");
    expect(
      await codigoDoErro(acrescentarValor(base.api, b, a.cor.id, "X")),
    ).toBe("catalog.not_found");
    expect(await opcoesDoArtigo(base.api, b, a.artigo)).toEqual([]);
    expect(
      await codigoDoErro(
        definirValoresDaVariante(base.api, b, varB, [a.v.vermelho]),
      ),
    ).toBe("catalog.not_found");
    // Por SQL directo, como b: nada se vê, nada se apaga.
    const cliente = new pg.Client({ connectionString: base.urlApi });
    await cliente.connect();
    try {
      await cliente.query("begin");
      await cliente.query(
        "select set_config('eurolify.comerciante', $1, true)",
        [b],
      );
      for (const tabela of ["opcao", "valor_opcao", "variante_valor"]) {
        expect((await cliente.query(`select * from ${tabela}`)).rowCount).toBe(
          0,
        );
        expect((await cliente.query(`delete from ${tabela}`)).rowCount).toBe(0);
      }
      await cliente.query("commit");
    } finally {
      await cliente.end();
    }
    expect((await opcoesDoArtigo(base.api, a.c, a.artigo)).length).toBe(2);
  });

  it("duas variantes com a mesma combinação ao mesmo tempo: só uma passa", async () => {
    const { c, artigo, v } = await verniz();
    await criarVarianteComValores(base.api, c, artigo, variante("VC-0"), [
      v.nude,
      v.grande,
    ]);
    await mudarEstadoArtigo(base.api, c, artigo, 1, "activo");
    // A primeira fica a meio, com os valores dados e por confirmar.
    const cliente = new pg.Client({ connectionString: base.urlApi });
    cliente.on("error", () => undefined);
    await cliente.connect();
    let segunda: Promise<string> | undefined;
    let esperou: boolean | undefined;
    try {
      await cliente.query("begin");
      await cliente.query(
        "select set_config('eurolify.comerciante', $1, true)",
        [c],
      );
      const { rows } = await cliente.query<{ id: string }>(
        "insert into variante (comerciante_id, artigo_id, sku, unidade_de_venda) values ($1, $2, 'VC-1', 'unidade') returning id",
        [c, artigo],
      );
      for (const valor of [v.vermelho, v.pequeno]) {
        await cliente.query(
          `insert into variante_valor (comerciante_id, artigo_id, variante_id, opcao_id, valor_id)
           select $1, $2, $3, opcao_id, id from valor_opcao where id = $4`,
          [c, artigo, rows[0]?.id, valor],
        );
      }
      segunda = codigoDoErro(
        criarVarianteComValores(base.api, c, artigo, variante("VC-2"), [
          v.vermelho,
          v.pequeno,
        ]),
      );
      esperou = await esperaBloqueio(segunda);
      await cliente.query("commit");
    } finally {
      await cliente.end();
    }
    expect(esperou).toBe(true);
    expect(await segunda).toBe("catalog.option_combination_duplicate");
    expect(await varianteComSku(base.api, c, "VC-1")).toBeDefined();
    expect(await varianteComSku(base.api, c, "VC-2")).toBeUndefined();
  });
});
