import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  apagarRascunho,
  arquivarVariante,
  componentesDoKit,
  criarArtigo,
  definirComponentes,
  ErroCatalogo,
  mudarEstadoArtigo,
  traduzir,
  varianteComSku,
  type DadosVariante,
} from "../src/catalogo/repositorio.js";
import {
  comComerciante,
  registarComerciante,
} from "../src/comerciante/repositorio.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";

// Catálogo, parte 2a: composição dos kits (docs/14 §3.4; migração 0004;
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

// Corre sem base: só a tradução (revisão do #81, 2.ª, P3-4).
it("componente_em_uso: «em uso» só ao apagar; ao inserir é «não existe»", () => {
  const erro = Object.assign(new Error("fk"), {
    code: "23503",
    constraint: "componente_em_uso",
    table: "componente",
  });
  expect((traduzir(erro) as ErroCatalogo).codigo).toBe("catalog.not_found");
  expect((traduzir(erro, { apagar: true }) as ErroCatalogo).codigo).toBe(
    "catalog.component_in_use",
  );
});

describe.skipIf(URL_BASE === undefined)("kits na base", () => {
  let base: BaseDeTeste;

  beforeAll(async () => {
    base = await criarBaseDeTeste(URL_BASE ?? "");
  }, 60_000);

  afterAll(async () => {
    await base.fechar();
  });

  /** Um comerciante com um artigo por SKU; devolve o id da variante por SKU. */
  async function catalogo(...skus: string[]) {
    const c = await registarComerciante(base.api, NOVO);
    const ids: Record<string, string> = {};
    const artigos: Record<string, string> = {};
    for (const sku of skus) {
      artigos[sku] = await criarArtigo(
        base.api,
        c,
        { tipo: "fisico", nome: sku },
        [variante(sku)],
      );
      const v = await varianteComSku(base.api, c, sku);
      ids[sku] = v?.id ?? "";
    }
    return { c, ids, artigos };
  }

  async function transaccaoAberta(
    c: string,
    texto: string,
    valores: unknown[],
  ) {
    const cliente = new pg.Client({ connectionString: base.urlApi });
    cliente.on("error", () => undefined);
    try {
      await cliente.connect();
      await cliente.query("begin");
      await cliente.query(
        "select set_config('eurolify.comerciante', $1, true)",
        [c],
      );
      await cliente.query(texto, valores);
    } catch (erro) {
      await cliente.end().catch(() => undefined);
      throw erro;
    }
    return {
      fechar: async () => {
        try {
          await cliente.query("commit");
        } finally {
          await cliente.end();
        }
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

  it("define, lê pela ordem, substitui e esvazia a composição", async () => {
    const { c, ids } = await catalogo("KIT", "LIMA", "GEL", "TOP");
    await definirComponentes(base.api, c, ids["KIT"] ?? "", [
      { varianteId: ids["GEL"] ?? "", quantidade: 2 },
      { varianteId: ids["LIMA"] ?? "", quantidade: 1 },
    ]);
    expect(await componentesDoKit(base.api, c, ids["KIT"] ?? "")).toEqual([
      { varianteId: ids["GEL"], quantidade: 2 },
      { varianteId: ids["LIMA"], quantidade: 1 },
    ]);
    await definirComponentes(base.api, c, ids["KIT"] ?? "", [
      { varianteId: ids["TOP"] ?? "", quantidade: 3 },
    ]);
    expect(await componentesDoKit(base.api, c, ids["KIT"] ?? "")).toEqual([
      { varianteId: ids["TOP"], quantidade: 3 },
    ]);
    await definirComponentes(base.api, c, ids["KIT"] ?? "", []);
    expect(await componentesDoKit(base.api, c, ids["KIT"] ?? "")).toEqual([]);
  });

  it("sem ciclos: nem o próprio kit, nem por outro kit, a nenhum nível", async () => {
    const { c, ids } = await catalogo("A", "B", "C");
    const a = ids["A"] ?? "";
    const b = ids["B"] ?? "";
    const cc = ids["C"] ?? "";
    expect(
      await codigoDoErro(
        definirComponentes(base.api, c, a, [{ varianteId: a, quantidade: 1 }]),
      ),
    ).toBe("catalog.component_cycle");
    // Um kit dentro de outro é permitido…
    await definirComponentes(base.api, c, a, [
      { varianteId: b, quantidade: 1 },
    ]);
    await definirComponentes(base.api, c, b, [
      { varianteId: cc, quantidade: 1 },
    ]);
    // …mas não a fechar o círculo, directo ou a dois níveis.
    expect(
      await codigoDoErro(
        definirComponentes(base.api, c, b, [{ varianteId: a, quantidade: 1 }]),
      ),
    ).toBe("catalog.component_cycle");
    expect(
      await codigoDoErro(
        definirComponentes(base.api, c, cc, [{ varianteId: a, quantidade: 1 }]),
      ),
    ).toBe("catalog.component_cycle");
    // A recusa não estraga o que lá estava.
    expect(await componentesDoKit(base.api, c, b)).toEqual([
      { varianteId: cc, quantidade: 1 },
    ]);
  });

  it("duas composições ao mesmo tempo que fechariam um círculo: só uma passa", async () => {
    // Com B em C e D em A já gravados, «A contém B» e «C contém D» fecham o
    // círculo A → B → C → D → A. As duas tocam em linhas diferentes (A, B e
    // C, D), por isso só o bloqueio por comerciante as põe em fila.
    const { c, ids } = await catalogo("A", "B", "C", "D");
    const [a, b, cc, d] = ["A", "B", "C", "D"].map((k) => ids[k] ?? "");
    await definirComponentes(base.api, c, b ?? "", [
      { varianteId: cc ?? "", quantidade: 1 },
    ]);
    await definirComponentes(base.api, c, d ?? "", [
      { varianteId: a ?? "", quantidade: 1 },
    ]);
    const primeira = await transaccaoAberta(
      c,
      "insert into componente (comerciante_id, kit_id, componente_id, quantidade) values ($1, $2, $3, 1)",
      [c, a, b],
    );
    const segunda = codigoDoErro(
      definirComponentes(base.api, c, cc ?? "", [
        { varianteId: d ?? "", quantidade: 1 },
      ]),
    );
    let esperou: boolean;
    try {
      esperou = await esperaBloqueio(segunda);
    } finally {
      await primeira.fechar();
    }
    expect(esperou).toBe(true);
    expect(await segunda).toBe("catalog.component_cycle");
    expect(await componentesDoKit(base.api, c, cc ?? "")).toEqual([]);
  });

  it("um componente novo tem de estar activo; arquivá-lo depois não toca no kit (C6)", async () => {
    const { c, ids } = await catalogo("KIT", "GEL", "VELHO");
    await arquivarVariante(base.api, c, ids["VELHO"] ?? "");
    expect(
      await codigoDoErro(
        definirComponentes(base.api, c, ids["KIT"] ?? "", [
          { varianteId: ids["VELHO"] ?? "", quantidade: 1 },
        ]),
      ),
    ).toBe("catalog.component_archived");
    await definirComponentes(base.api, c, ids["KIT"] ?? "", [
      { varianteId: ids["GEL"] ?? "", quantidade: 1 },
    ]);
    await arquivarVariante(base.api, c, ids["GEL"] ?? "");
    expect(await componentesDoKit(base.api, c, ids["KIT"] ?? "")).toEqual([
      { varianteId: ids["GEL"], quantidade: 1 },
    ]);
  });

  it("a composição de um kit arquivado não muda", async () => {
    const { c, ids } = await catalogo("KIT", "GEL", "LIMA");
    await definirComponentes(base.api, c, ids["KIT"] ?? "", [
      { varianteId: ids["GEL"] ?? "", quantidade: 1 },
    ]);
    await arquivarVariante(base.api, c, ids["KIT"] ?? "");
    expect(
      await codigoDoErro(
        definirComponentes(base.api, c, ids["KIT"] ?? "", [
          { varianteId: ids["LIMA"] ?? "", quantidade: 1 },
        ]),
      ),
    ).toBe("catalog.variant_archived_is_final");
    expect(await componentesDoKit(base.api, c, ids["KIT"] ?? "")).toEqual([
      { varianteId: ids["GEL"], quantidade: 1 },
    ]);
  });

  it("repetidos e quantidades inválidas são recusados", async () => {
    const { c, ids } = await catalogo("KIT", "GEL");
    const gel = ids["GEL"] ?? "";
    expect(
      await codigoDoErro(
        definirComponentes(base.api, c, ids["KIT"] ?? "", [
          { varianteId: gel, quantidade: 1 },
          { varianteId: gel, quantidade: 2 },
        ]),
      ),
    ).toBe("catalog.component_duplicate");
    for (const quantidade of [0, -1, 1.5]) {
      expect(
        await codigoDoErro(
          definirComponentes(base.api, c, ids["KIT"] ?? "", [
            { varianteId: gel, quantidade },
          ]),
        ),
      ).toBe("catalog.invalid_field");
    }
  });

  it("apagar rascunhos: o kit leva a composição; um componente em uso não se apaga", async () => {
    const { c, ids, artigos } = await catalogo("KIT", "GEL");
    await definirComponentes(base.api, c, ids["KIT"] ?? "", [
      { varianteId: ids["GEL"] ?? "", quantidade: 1 },
    ]);
    expect(
      await codigoDoErro(apagarRascunho(base.api, c, artigos["GEL"] ?? "")),
    ).toBe("catalog.component_in_use");
    await apagarRascunho(base.api, c, artigos["KIT"] ?? "");
    const { rows } = await sql<{ n: number }>`
      select count(*)::int as n from componente where comerciante_id = ${c}`.execute(
      base.dono,
    );
    expect(rows[0]?.n).toBe(0);
    // Sem o kit, o componente já se apaga.
    await apagarRascunho(base.api, c, artigos["GEL"] ?? "");
  });

  it("um rascunho com o kit e o componente dentro apaga-se inteiro, por qualquer ordem", async () => {
    const c = await registarComerciante(base.api, NOVO);
    // As duas ordens de criação: o componente antes do kit era o caso que
    // ficava preso (revisão do #81, P1-1).
    for (const [primeira, segunda] of [
      ["CJ-KIT", "CJ-GEL"],
      ["CJ2-GEL", "CJ2-KIT"],
    ] as const) {
      const artigo = await criarArtigo(
        base.api,
        c,
        { tipo: "fisico", nome: "Conjunto" },
        [variante(primeira), variante(segunda)],
      );
      const kitSku = primeira.endsWith("KIT") ? primeira : segunda;
      const gelSku = primeira.endsWith("GEL") ? primeira : segunda;
      const kit = await varianteComSku(base.api, c, kitSku);
      const gel = await varianteComSku(base.api, c, gelSku);
      await definirComponentes(base.api, c, kit?.id ?? "", [
        { varianteId: gel?.id ?? "", quantidade: 2 },
      ]);
      await apagarRascunho(base.api, c, artigo);
      expect(await varianteComSku(base.api, c, gelSku)).toBeUndefined();
      expect(await varianteComSku(base.api, c, kitSku)).toBeUndefined();
    }
  });

  it("um rascunho com um kit arquivado também se apaga (P8)", async () => {
    const c = await registarComerciante(base.api, NOVO);
    const artigo = await criarArtigo(
      base.api,
      c,
      { tipo: "fisico", nome: "Conjunto" },
      [variante("AR-GEL"), variante("AR-KIT")],
    );
    const kit = await varianteComSku(base.api, c, "AR-KIT");
    const gel = await varianteComSku(base.api, c, "AR-GEL");
    await definirComponentes(base.api, c, kit?.id ?? "", [
      { varianteId: gel?.id ?? "", quantidade: 1 },
    ]);
    await arquivarVariante(base.api, c, kit?.id ?? "");
    // Sem apagar o rascunho, a composição do kit arquivado não muda, nem
    // esvaziada (revisão do #81, 2.ª, P3-3).
    expect(
      await codigoDoErro(definirComponentes(base.api, c, kit?.id ?? "", [])),
    ).toBe("catalog.variant_archived_is_final");
    await apagarRascunho(base.api, c, artigo);
    expect(await varianteComSku(base.api, c, "AR-KIT")).toBeUndefined();
  });

  it("um kit arquivado de um artigo à venda não perde a composição", async () => {
    // O caminho que protege um kit já vendido (revisão do #81, 2.ª, P2-2).
    const c = await registarComerciante(base.api, NOVO);
    const artigo = await criarArtigo(
      base.api,
      c,
      { tipo: "fisico", nome: "Conjunto" },
      [variante("VD-KIT"), variante("VD-GEL")],
    );
    const kit = (await varianteComSku(base.api, c, "VD-KIT"))?.id ?? "";
    const gel = (await varianteComSku(base.api, c, "VD-GEL"))?.id ?? "";
    await definirComponentes(base.api, c, kit, [
      { varianteId: gel, quantidade: 1 },
    ]);
    await mudarEstadoArtigo(base.api, c, artigo, 1, "activo");
    await arquivarVariante(base.api, c, kit);
    for (const lista of [[], [{ varianteId: gel, quantidade: 5 }]]) {
      expect(
        await codigoDoErro(definirComponentes(base.api, c, kit, lista)),
      ).toBe("catalog.variant_archived_is_final");
    }
    // Nem por SQL directo.
    for (const texto of [
      "delete from componente where kit_id = $1",
      "update componente set quantidade = 5 where kit_id = $1",
    ]) {
      expect(
        await codigoDoErro(
          comComerciante(base.api, c, (trx) =>
            sql.raw(texto.replace("$1", `'${kit}'`)).execute(trx),
          ),
        ),
      ).toMatch(/catalog\.variant_archived_is_final/);
    }
    expect(await componentesDoKit(base.api, c, kit)).toEqual([
      { varianteId: gel, quantidade: 1 },
    ]);
  });

  it("apagar o rascunho e mudar um kit dele ao mesmo tempo: nunca um impasse", async () => {
    // Revisão do #81, 2.ª, P2-1: antes, 4 em 30 davam 40P01.
    for (let ronda = 0; ronda < 30; ronda++) {
      const c = await registarComerciante(base.api, NOVO);
      const artigo = await criarArtigo(
        base.api,
        c,
        { tipo: "fisico", nome: "Conjunto" },
        [
          variante(`IP-GEL-${String(ronda)}`),
          variante(`IP-KIT-${String(ronda)}`),
        ],
      );
      const kit =
        (await varianteComSku(base.api, c, `IP-KIT-${String(ronda)}`))?.id ??
        "";
      const gel =
        (await varianteComSku(base.api, c, `IP-GEL-${String(ronda)}`))?.id ??
        "";
      await definirComponentes(base.api, c, kit, [
        { varianteId: gel, quantidade: 1 },
      ]);
      const [mudar, apagar] = await Promise.all([
        codigoDoErro(
          definirComponentes(base.api, c, kit, [
            { varianteId: gel, quantidade: 2 },
          ]),
        ),
        codigoDoErro(apagarRascunho(base.api, c, artigo)),
      ]);
      expect(apagar).toBe("sem erro");
      expect(["sem erro", "catalog.not_found"]).toContain(mudar);
    }
  });

  it("arquivar o kit ou um componente a meio de uma substituição: espera e recusa", async () => {
    // Os bloqueios das linhas (revisão do #81, 2.ª, P2-3): a linha do kit
    // presa pelo repositório e cada componente novo preso pelo trigger.
    for (const qual of ["kit", "componente"] as const) {
      const { c, ids } = await catalogo(`K-${qual}`, `G-${qual}`);
      const kit = ids[`K-${qual}`] ?? "";
      const gel = ids[`G-${qual}`] ?? "";
      const arquivo = await transaccaoAberta(
        c,
        "update variante set estado = 'arquivada' where id = $1",
        [qual === "kit" ? kit : gel],
      );
      const mudar = codigoDoErro(
        definirComponentes(base.api, c, kit, [
          { varianteId: gel, quantidade: 1 },
        ]),
      );
      let esperou: boolean;
      try {
        esperou = await esperaBloqueio(mudar);
      } finally {
        await arquivo.fechar();
      }
      expect(esperou, qual).toBe(true);
      expect(await mudar, qual).toBe(
        qual === "kit"
          ? "catalog.variant_archived_is_final"
          : "catalog.component_archived",
      );
      expect(await componentesDoKit(base.api, c, kit), qual).toEqual([]);
    }
  });

  it("um componente arquivado que já estava no kit pode ficar ao mudar a lista", async () => {
    const { c, ids } = await catalogo("KIT", "GEL", "LIMA", "TOP", "VELHO");
    const [kit, gel, lima, top, velho] = [
      "KIT",
      "GEL",
      "LIMA",
      "TOP",
      "VELHO",
    ].map((k) => ids[k] ?? "");
    await definirComponentes(base.api, c, kit ?? "", [
      { varianteId: gel ?? "", quantidade: 1 },
      { varianteId: lima ?? "", quantidade: 1 },
    ]);
    await arquivarVariante(base.api, c, gel ?? "");
    // Reenviar a mesma lista e acrescentar outro: o GEL arquivado fica.
    await definirComponentes(base.api, c, kit ?? "", [
      { varianteId: lima ?? "", quantidade: 2 },
      { varianteId: gel ?? "", quantidade: 1 },
      { varianteId: top ?? "", quantidade: 1 },
    ]);
    expect(await componentesDoKit(base.api, c, kit ?? "")).toEqual([
      { varianteId: lima, quantidade: 2 },
      { varianteId: gel, quantidade: 1 },
      { varianteId: top, quantidade: 1 },
    ]);
    // Um arquivado novo continua recusado; depois de sair, não volta.
    await arquivarVariante(base.api, c, velho ?? "");
    expect(
      await codigoDoErro(
        definirComponentes(base.api, c, kit ?? "", [
          { varianteId: velho ?? "", quantidade: 1 },
        ]),
      ),
    ).toBe("catalog.component_archived");
    await definirComponentes(base.api, c, kit ?? "", [
      { varianteId: lima ?? "", quantidade: 1 },
    ]);
    expect(
      await codigoDoErro(
        definirComponentes(base.api, c, kit ?? "", [
          { varianteId: gel ?? "", quantidade: 1 },
        ]),
      ),
    ).toBe("catalog.component_archived");
  });

  it("substituições cruzadas ao mesmo tempo: uma passa, a outra é um ciclo, nunca um impasse", async () => {
    for (let ronda = 0; ronda < 5; ronda++) {
      const { c, ids } = await catalogo(
        `X${String(ronda)}`,
        `Y${String(ronda)}`,
      );
      const x = ids[`X${String(ronda)}`] ?? "";
      const y = ids[`Y${String(ronda)}`] ?? "";
      const resultados = await Promise.all([
        codigoDoErro(
          definirComponentes(base.api, c, x, [
            { varianteId: y, quantidade: 1 },
          ]),
        ),
        codigoDoErro(
          definirComponentes(base.api, c, y, [
            { varianteId: x, quantidade: 1 },
          ]),
        ),
      ]);
      expect(resultados.sort()).toEqual([
        "catalog.component_cycle",
        "sem erro",
      ]);
    }
  });

  it("isolamento: outro comerciante não usa, não lê e não muda os kits de um", async () => {
    const a = await catalogo("KIT", "GEL");
    const b = await catalogo("MEU");
    await definirComponentes(base.api, a.c, a.ids["KIT"] ?? "", [
      { varianteId: a.ids["GEL"] ?? "", quantidade: 1 },
    ]);
    // b não põe uma variante de a no seu kit, nem mexe no kit de a.
    expect(
      await codigoDoErro(
        definirComponentes(base.api, b.c, b.ids["MEU"] ?? "", [
          { varianteId: a.ids["GEL"] ?? "", quantidade: 1 },
        ]),
      ),
    ).toBe("catalog.not_found");
    expect(
      await codigoDoErro(
        definirComponentes(base.api, b.c, a.ids["KIT"] ?? "", []),
      ),
    ).toBe("catalog.not_found");
    expect(await componentesDoKit(base.api, b.c, a.ids["KIT"] ?? "")).toEqual(
      [],
    );
    // Nem por SQL directo com o comerciante de a (RLS).
    expect(
      await codigoDoErro(
        transaccaoAberta(
          b.c,
          "insert into componente (comerciante_id, kit_id, componente_id, quantidade) values ($1, $2, $3, 1)",
          [a.c, a.ids["KIT"], b.ids["MEU"]],
        ),
      ),
    ).toMatch(/^pg:42501:/);
    // Por SQL directo, como b: não vê, não apaga, não muda as linhas de a
    // (RLS: revisão do #81, P2-3), e não usa um componente de a no seu kit
    // (a chave estrangeira é por comerciante).
    const sqlComo = async (texto: string, valores: unknown[] = []) => {
      const cliente = new pg.Client({ connectionString: base.urlApi });
      await cliente.connect();
      try {
        await cliente.query("begin");
        await cliente.query(
          "select set_config('eurolify.comerciante', $1, true)",
          [b.c],
        );
        const r = await cliente.query(texto, valores);
        await cliente.query("commit");
        return r;
      } finally {
        await cliente.end();
      }
    };
    expect((await sqlComo("select * from componente")).rowCount).toBe(0);
    expect(
      (await sqlComo("update componente set quantidade = 9")).rowCount,
    ).toBe(0);
    expect((await sqlComo("delete from componente")).rowCount).toBe(0);
    expect(
      await codigoDoErro(
        sqlComo(
          "insert into componente (comerciante_id, kit_id, componente_id, quantidade) values ($1, $2, $3, 1)",
          [b.c, b.ids["MEU"], a.ids["GEL"]],
        ),
      ),
    ).toMatch(/^pg:23503:/);
    expect(await componentesDoKit(base.api, a.c, a.ids["KIT"] ?? "")).toEqual([
      { varianteId: a.ids["GEL"], quantidade: 1 },
    ]);
  });
});
