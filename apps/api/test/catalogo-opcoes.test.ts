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
  traduzir,
  mudarEstadoArtigo,
  opcoesDoArtigo,
  valoresDaVariante,
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

it("um impasse ou conflito de serialização é «tentar outra vez» (revisão do #83, P2-2)", () => {
  for (const code of ["40P01", "40001"]) {
    const erro = Object.assign(new Error("x"), { code });
    expect((traduzir(erro) as ErroCatalogo).codigo).toBe("catalog.retry");
  }
});

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

  /**
   * SQL directo como `c` (o eurolify_api, com o RLS), numa transacção, com os
   * erros da base traduzidos como no repositório.
   */
  async function sqlComo(c: string, texto: string) {
    try {
      return await comComerciante(base.api, c, (trx) =>
        sql.raw(texto).execute(trx),
      );
    } catch (erro) {
      throw traduzir(erro);
    }
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
      await codigoDoErro(criarOpcao(base.api, c, artigo, " cor ", ["X"])),
    ).toBe("catalog.option_duplicate");
    expect(
      await codigoDoErro(acrescentarValor(base.api, c, cor.id, "NUDE")),
    ).toBe("catalog.option_value_duplicate");
    expect(
      await codigoDoErro(criarOpcao(base.api, c, artigo, "   ", ["X"])),
    ).toBe("catalog.invalid_field");
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
      await codigoDoErro(criarOpcao(base.api, b, a.artigo, "Intrusa", ["X"])),
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

  it("apagar uma opção que deixa duas variantes iguais é recusado (revisão do #83, P1-1)", async () => {
    const { c, artigo, tamanho, v } = await verniz();
    // Duas variantes só com a cor (o tamanho ficou por dar: rascunho).
    for (const sku of ["AP-1", "AP-2"]) {
      const id = await criarVariante(base.api, c, artigo, variante(sku));
      await definirValoresDaVariante(base.api, c, id, [v.vermelho]);
    }
    expect(
      await codigoDoErro(
        sqlComo(c, `delete from opcao where id = '${tamanho.id}'`),
      ),
    ).toBe("catalog.option_combination_duplicate");
    expect((await opcoesDoArtigo(base.api, c, artigo)).length).toBe(2);
  });

  it("muitas variantes de uma vez: a verificação corre uma vez por artigo (revisão do #83, P2-1)", async () => {
    const c = await registarComerciante(base.api, NOVO);
    const artigo = await criarArtigo(base.api, c, {
      tipo: "fisico",
      nome: "Paleta",
    });
    const nomes = Array.from({ length: 16 }, (_, i) => `N${String(i)}`);
    const cor = await criarOpcao(base.api, c, artigo, "Cor", nomes);
    const tam = await criarOpcao(base.api, c, artigo, "Tamanho", nomes);
    // 256 variantes e 512 valores numa só transacção (com uma verificação
    // por linha, o revisor mediu 23 s para 256).
    const inicio = Date.now();
    await comComerciante(base.api, c, async (trx) => {
      let n = 0;
      for (const a of cor.valores) {
        for (const b of tam.valores) {
          const { id } = await trx
            .insertInto("variante")
            .values({
              comerciante_id: c,
              artigo_id: artigo,
              sku: `PL-${String(n)}`,
              unidade_de_venda: "unidade",
            })
            .returning("id")
            .executeTakeFirstOrThrow();
          await trx
            .insertInto("variante_valor")
            .values([
              {
                comerciante_id: c,
                artigo_id: artigo,
                variante_id: id,
                opcao_id: cor.id,
                valor_id: a.id,
              },
              {
                comerciante_id: c,
                artigo_id: artigo,
                variante_id: id,
                opcao_id: tam.id,
                valor_id: b.id,
              },
            ])
            .execute();
          n += 1;
        }
      }
    });
    expect(Date.now() - inicio).toBeLessThan(8_000);
    await mudarEstadoArtigo(base.api, c, artigo, 1, "activo");
  }, 60_000);

  it("numa transacção com muitas linhas, a verificação corre uma só vez por artigo", async () => {
    const { c, artigo, cor, tamanho } = await verniz();
    const cliente = new pg.Client({ connectionString: base.urlApi });
    const avisos: string[] = [];
    cliente.on("notice", (aviso) => avisos.push(aviso.message ?? ""));
    await cliente.connect();
    try {
      await cliente.query("begin");
      await cliente.query(
        "select set_config('eurolify.comerciante', $1, true)",
        [c],
      );
      await cliente.query("set local client_min_messages = debug1");
      let n = 0;
      for (const a of cor.valores) {
        for (const b of tamanho.valores) {
          const { rows } = await cliente.query<{ id: string }>(
            "insert into variante (comerciante_id, artigo_id, sku, unidade_de_venda) values ($1, $2, $3, 'unidade') returning id",
            [c, artigo, `UM-${String(n)}`],
          );
          for (const [opcao, valor] of [
            [cor.id, a.id],
            [tamanho.id, b.id],
          ]) {
            await cliente.query(
              "insert into variante_valor (comerciante_id, artigo_id, variante_id, opcao_id, valor_id) values ($1, $2, $3, $4, $5)",
              [c, artigo, rows[0]?.id, opcao, valor],
            );
          }
          n += 1;
        }
      }
      await cliente.query("commit");
    } finally {
      await cliente.end();
    }
    // 4 variantes e 8 valores (12 linhas): uma verificação.
    expect(
      avisos.filter((m) => m.startsWith("eurolify: verificar combinacoes"))
        .length,
    ).toBe(1);
  });

  it("a API não salta a verificação: tirar a marca não é dela", async () => {
    const { c, artigo } = await verniz();
    expect(
      await codigoDoErro(
        sqlComo(c, `select catalogo_tirar_marca('${c}', '${artigo}')`),
      ),
    ).toMatch(/^pg:42501:/);
    expect(
      await codigoDoErro(sqlComo(c, "select * from combinacoes_por_verificar")),
    ).toMatch(/^pg:42501:/);
  });

  it("nomes e valores só mudam de texto num rascunho; a ordem muda sempre (P2-4)", async () => {
    const { c, artigo, cor, v } = await verniz();
    await sqlComo(c, `update opcao set nome = 'Cores' where id = '${cor.id}'`);
    await sqlComo(
      c,
      `update valor_opcao set valor = 'Vermelho 12' where id = '${v.vermelho}'`,
    );
    await criarVarianteComValores(base.api, c, artigo, variante("RN-1"), [
      v.vermelho,
      v.pequeno,
    ]);
    await mudarEstadoArtigo(base.api, c, artigo, 1, "activo");
    for (const texto of [
      `update opcao set nome = 'Tom' where id = '${cor.id}'`,
      `update valor_opcao set valor = 'Azul' where id = '${v.vermelho}'`,
    ]) {
      expect(await codigoDoErro(sqlComo(c, texto))).toBe("catalog.not_draft");
    }
    await sqlComo(c, `update opcao set posicao = 5 where id = '${cor.id}'`);
    await sqlComo(
      c,
      `update valor_opcao set posicao = 5 where id = '${v.vermelho}'`,
    );
    const opcoes = await opcoesDoArtigo(base.api, c, artigo);
    expect(opcoes.map((o) => o.nome)).toEqual(["Tamanho", "Cores"]);
    expect(opcoes[1]?.valores.map((x) => x.valor)).toEqual([
      "Nude",
      "Vermelho 12",
    ]);
  });

  it("por SQL directo num artigo à venda: nada muda nas opções nem nos valores das variantes", async () => {
    const { c, artigo, v } = await verniz();
    const a = await criarVarianteComValores(
      base.api,
      c,
      artigo,
      variante("SD-1"),
      [v.vermelho, v.pequeno],
    );
    await mudarEstadoArtigo(base.api, c, artigo, 1, "activo");
    for (const texto of [
      `update variante_valor set valor_id = '${v.nude}' where variante_id = '${a}' and valor_id = '${v.vermelho}'`,
      `delete from variante_valor where variante_id = '${a}'`,
      `insert into opcao (comerciante_id, artigo_id, nome) values ('${c}', '${artigo}', 'Nova')`,
      `delete from valor_opcao where id = '${v.grande}'`,
    ]) {
      expect(await codigoDoErro(sqlComo(c, texto)), texto).toBe(
        "catalog.not_draft",
      );
    }
    expect(await valoresDaVariante(base.api, c, a)).toEqual(
      [v.vermelho, v.pequeno].sort(),
    );
  });

  it("repor um artigo arquivado com uma variante nova completa", async () => {
    const { c, artigo, cor, v } = await verniz();
    const a = await criarVarianteComValores(
      base.api,
      c,
      artigo,
      variante("RP-1"),
      [v.vermelho, v.pequeno],
    );
    let versao = await mudarEstadoArtigo(base.api, c, artigo, 1, "activo");
    versao = await mudarEstadoArtigo(base.api, c, artigo, versao, "arquivado");
    await arquivarVariante(base.api, c, a);
    const coral = await acrescentarValor(base.api, c, cor.id, "Coral");
    await criarVarianteComValores(base.api, c, artigo, variante("RP-2"), [
      coral,
      v.pequeno,
    ]);
    await mudarEstadoArtigo(base.api, c, artigo, versao, "activo");
  });

  it("chaves compostas e RLS por SQL directo (revisão do #83, P2-3b e P2-5)", async () => {
    const a = await verniz();
    const outroArtigo = await verniz(a.c);
    const va = await criarVariante(base.api, a.c, a.artigo, variante("CK-1"));
    await definirValoresDaVariante(base.api, a.c, va, [a.v.vermelho]);
    // Um valor de outro artigo do mesmo comerciante: a chave composta recusa.
    expect(
      await codigoDoErro(
        sqlComo(
          a.c,
          `insert into variante_valor (comerciante_id, artigo_id, variante_id, opcao_id, valor_id)
           values ('${a.c}', '${a.artigo}', '${va}', '${outroArtigo.tamanho.id}', '${outroArtigo.v.pequeno}')`,
        ),
      ),
    ).toBe("catalog.not_found");
    const b = await registarComerciante(base.api, NOVO);
    // b com os ids de a: com o comerciante de a, o RLS recusa (42501); com o
    // seu, a chave estrangeira recusa (23503, «não existe») — nunca «já existe» (23505),
    // que diria que a linha de a existe.
    expect(
      await codigoDoErro(
        sqlComo(
          b,
          `insert into variante_valor (comerciante_id, artigo_id, variante_id, opcao_id, valor_id)
           values ('${a.c}', '${a.artigo}', '${va}', '${a.cor.id}', '${a.v.nude}')`,
        ),
      ),
    ).toMatch(/^pg:42501:/);
    expect(
      await codigoDoErro(
        sqlComo(
          b,
          `insert into variante_valor (comerciante_id, artigo_id, variante_id, opcao_id, valor_id)
           values ('${b}', '${a.artigo}', '${va}', '${a.cor.id}', '${a.v.nude}')`,
        ),
      ),
    ).toBe("catalog.not_found");
    for (const texto of [
      `insert into opcao (comerciante_id, artigo_id, nome) values ('${a.c}', '${a.artigo}', 'X')`,
      `insert into valor_opcao (comerciante_id, artigo_id, opcao_id, valor) values ('${a.c}', '${a.artigo}', '${a.cor.id}', 'X')`,
    ]) {
      expect(await codigoDoErro(sqlComo(b, texto)), texto).toMatch(
        /^pg:42501:/,
      );
    }
    for (const texto of [
      "update opcao set posicao = 9",
      "update valor_opcao set posicao = 9",
      "update variante_valor set valor_id = valor_id",
    ]) {
      const r = await sqlComo(b, texto);
      expect(Number(r.numAffectedRows ?? 0n), texto).toBe(0);
    }
  });

  it("a fila de um artigo é por comerciante: outro não entra nela (P2-3a)", async () => {
    const { c, artigo } = await verniz();
    const b = await registarComerciante(base.api, NOVO);
    // a segura a fila do artigo dele, numa transacção aberta.
    const cliente = new pg.Client({ connectionString: base.urlApi });
    cliente.on("error", () => undefined);
    await cliente.connect();
    try {
      await cliente.query("begin");
      await cliente.query(
        "select set_config('eurolify.comerciante', $1, true)",
        [c],
      );
      await cliente.query("select catalogo_fila_do_artigo($1, $2)", [
        c,
        artigo,
      ]);
      // b chama a função sobre o artigo de a: não espera.
      const deB = sqlComo(
        b,
        `select catalogo_fila_do_artigo('${c}', '${artigo}')`,
      );
      expect(await esperaBloqueio(deB)).toBe(false);
      await deB;
    } finally {
      await cliente.query("rollback").catch(() => undefined);
      await cliente.end();
    }
  });

  it("acertos: valores de uma arquivada não se tiram; uma opção leva valores", async () => {
    const { c, artigo, v } = await verniz();
    const a = await criarVariante(base.api, c, artigo, variante("AC-1"));
    await definirValoresDaVariante(base.api, c, a, [v.vermelho]);
    await arquivarVariante(base.api, c, a);
    expect(
      await codigoDoErro(
        sqlComo(c, `delete from variante_valor where variante_id = '${a}'`),
      ),
    ).toBe("catalog.variant_archived_is_final");
    expect(
      await codigoDoErro(criarOpcao(base.api, c, artigo, "Vazia", [])),
    ).toBe("catalog.option_values_required");
  });

  /** Uma ligação própria como `c`, com uma transacção aberta. */
  async function ligacaoComo(c: string) {
    const cliente = new pg.Client({ connectionString: base.urlApi });
    cliente.on("error", () => undefined);
    await cliente.connect();
    await cliente.query("begin");
    await cliente.query("select set_config('eurolify.comerciante', $1, true)", [
      c,
    ]);
    return cliente;
  }

  it("só os triggers marcam combinações: a API não chama a função (revisão do #83, 2.ª, P1-1)", async () => {
    const { c, artigo } = await verniz();
    const b = await registarComerciante(base.api, NOVO);
    for (const comerciante of [c, b]) {
      expect(
        await codigoDoErro(
          sqlComo(
            c,
            `select catalogo_marcar_combinacoes('${comerciante}', '${artigo}')`,
          ),
        ),
      ).toMatch(/^pg:42501:/);
    }
  });

  it("as marcas que ficam para trás limpam-se sozinhas (P2-2)", async () => {
    const { c, artigo } = await verniz();
    await criarVariante(base.api, c, artigo, variante("LX-1"));
    // Uma variante que não entra (SKU repetido, ON CONFLICT DO NOTHING):
    // marcou no trigger, mas nenhuma verificação no fim tirou a marca.
    await sqlComo(
      c,
      `insert into variante (comerciante_id, artigo_id, sku, unidade_de_venda)
       values ('${c}', '${artigo}', 'LX-1', 'unidade') on conflict do nothing`,
    );
    const contar = async () => {
      const { rows } = await sql<{ n: number }>`
        select count(*)::int as n from combinacoes_por_verificar
        where comerciante_id = ${c}`.execute(base.dono);
      return rows[0]?.n ?? -1;
    };
    expect(await contar()).toBe(1);
    // A próxima marca (de qualquer transacção) limpa as que já acabaram.
    await criarVariante(base.api, c, artigo, variante("LX-2"));
    expect(await contar()).toBe(0);
  });

  it("dar valores entra na fila do artigo antes de prender linhas (P2-1)", async () => {
    const { c, artigo, v } = await verniz();
    const a = await criarVariante(base.api, c, artigo, variante("FL-1"));
    await definirValoresDaVariante(base.api, c, a, [v.vermelho, v.pequeno]);
    // Alguém tem a fila do artigo (como quem apaga o rascunho).
    const fila = await ligacaoComo(c);
    let esperou: boolean | undefined;
    let mudar: Promise<string> | undefined;
    try {
      await fila.query("select catalogo_fila_do_artigo($1, $2)", [c, artigo]);
      mudar = codigoDoErro(
        definirValoresDaVariante(base.api, c, a, [v.nude, v.grande]),
      );
      esperou = await esperaBloqueio(mudar);
      // Enquanto espera, não prendeu nenhuma linha da variante.
      const outra = await ligacaoComo(c);
      try {
        await outra.query(
          "select 1 from variante_valor where variante_id = $1 for update nowait",
          [a],
        );
      } finally {
        await outra.query("rollback").catch(() => undefined);
        await outra.end();
      }
    } finally {
      await fila.query("rollback").catch(() => undefined);
      await fila.end();
    }
    expect(esperou).toBe(true);
    expect(await mudar).toBe("sem erro");
    expect(await valoresDaVariante(base.api, c, a)).toEqual(
      [v.nude, v.grande].sort(),
    );
  });

  it("um impasse verdadeiro chega como «tentar outra vez» (P2-3)", async () => {
    const x = await verniz();
    const y = await verniz(x.c);
    const um = await ligacaoComo(x.c);
    const dois = await ligacaoComo(x.c);
    try {
      await um.query("update opcao set posicao = 1 where id = $1", [x.cor.id]);
      await dois.query("update opcao set posicao = 1 where id = $1", [
        y.cor.id,
      ]);
      const resultados = await Promise.allSettled([
        um.query("update opcao set posicao = 2 where id = $1", [y.cor.id]),
        dois.query("update opcao set posicao = 2 where id = $1", [x.cor.id]),
      ]);
      const falhas = resultados.filter((r) => r.status === "rejected");
      expect(falhas).toHaveLength(1);
      const erro = (falhas[0] as PromiseRejectedResult).reason as unknown;
      expect((traduzir(erro) as ErroCatalogo).codigo).toBe("catalog.retry");
    } finally {
      for (const ligacao of [um, dois]) {
        await ligacao.query("rollback").catch(() => undefined);
        await ligacao.end();
      }
    }
  });
});
