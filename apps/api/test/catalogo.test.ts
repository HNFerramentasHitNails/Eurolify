import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ESTADOS_ARTIGO,
  TIPOS_ARTIGO,
  UNIDADES_DE_VENDA,
} from "../src/base/esquema.js";
import {
  alterarArtigo,
  apagarRascunho,
  arquivarVariante,
  criarArtigo,
  criarVariante,
  ErroCatalogo,
  mudarEstadoArtigo,
  obterArtigo,
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

// Catálogo, parte 1 (docs/14 §3.1, §3.2, §4.1 e §5; issue #77), contra o
// PostgreSQL 18 verdadeiro e com o eurolify_api, que não ignora o RLS.

const NOVO = { nome: "Loja de Teste", lingua: "pt", fuso: "Europe/Lisbon" };
const VARIANTE: DadosVariante = { sku: "GEL-001", unidade_de_venda: "unidade" };

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

describe.skipIf(URL_BASE === undefined)("domínio Catálogo na base", () => {
  let base: BaseDeTeste;

  beforeAll(async () => {
    base = await criarBaseDeTeste(URL_BASE ?? "");
  }, 60_000);

  afterAll(async () => {
    await base.fechar();
  });

  async function comercianteNovo(): Promise<string> {
    return registarComerciante(base.api, NOVO);
  }

  describe("isolamento por comerciante (RLS)", () => {
    it("um comerciante não lê, não altera e não usa os artigos de outro", async () => {
      const a = await comercianteNovo();
      const b = await comercianteNovo();
      const artigo = await criarArtigo(
        base.api,
        a,
        { tipo: "fisico", nome: "Gel" },
        [VARIANTE],
      );
      expect(await codigoDoErro(obterArtigo(base.api, b, artigo))).toBe(
        "catalog.not_found",
      );
      expect(
        await codigoDoErro(mudarEstadoArtigo(base.api, b, artigo, 1, "activo")),
      ).toBe("catalog.not_found");
      // Uma variante de b num artigo de a: a chave estrangeira não vê o
      // artigo (o RLS esconde-o) e recusa.
      expect(
        await codigoDoErro(
          criarVariante(base.api, b, artigo, { ...VARIANTE, sku: "X-1" }),
        ),
      ).toMatch(/^pg:23503:/);
      expect(await varianteComSku(base.api, b, "GEL-001")).toBeUndefined();
      // O SKU de a pode existir em b: único por comerciante (C3).
      await criarArtigo(base.api, b, { tipo: "fisico", nome: "Outro" }, [
        VARIANTE,
      ]);
    });

    it("sem contexto, a base recusa", async () => {
      const cliente = new pg.Client({ connectionString: base.urlApi });
      await cliente.connect();
      try {
        await expect(cliente.query("select * from artigo")).rejects.toThrow();
      } finally {
        await cliente.end();
      }
    });
  });

  describe("artigo: estados (§4.1)", () => {
    it("nasce em rascunho, versão 1; o caminho rascunho → activo → arquivado → activo", async () => {
      const c = await comercianteNovo();
      const id = await criarArtigo(
        base.api,
        c,
        { tipo: "fisico", nome: "Gel" },
        [VARIANTE],
      );
      expect(await obterArtigo(base.api, c, id)).toMatchObject({
        estado: "rascunho",
        versao: 1,
        origem: "eurolify",
        ja_esteve_activo: false,
      });
      let v = await mudarEstadoArtigo(base.api, c, id, 1, "activo");
      v = await mudarEstadoArtigo(base.api, c, id, v, "arquivado");
      v = await mudarEstadoArtigo(base.api, c, id, v, "activo");
      expect(await obterArtigo(base.api, c, id)).toMatchObject({
        estado: "activo",
        versao: v,
        ja_esteve_activo: true,
      });
      expect(v).toBe(4);
    });

    it("não se activa sem uma variante activa", async () => {
      const c = await comercianteNovo();
      const semVariantes = await criarArtigo(base.api, c, {
        tipo: "fisico",
        nome: "Vazio",
      });
      expect(
        await codigoDoErro(
          mudarEstadoArtigo(base.api, c, semVariantes, 1, "activo"),
        ),
      ).toBe("catalog.no_variants");
      const soArquivadas = await criarArtigo(
        base.api,
        c,
        { tipo: "fisico", nome: "Gel" },
        [VARIANTE],
      );
      const variante = await varianteComSku(base.api, c, "GEL-001");
      await arquivarVariante(base.api, c, variante?.id ?? "");
      expect(
        await codigoDoErro(
          mudarEstadoArtigo(base.api, c, soArquivadas, 1, "activo"),
        ),
      ).toBe("catalog.no_variants");
    });

    it("transições que não existem são recusadas", async () => {
      const c = await comercianteNovo();
      const id = await criarArtigo(
        base.api,
        c,
        { tipo: "fisico", nome: "Gel" },
        [VARIANTE],
      );
      expect(
        await codigoDoErro(mudarEstadoArtigo(base.api, c, id, 1, "arquivado")),
      ).toBe("catalog.invalid_transition");
      expect(
        await codigoDoErro(
          comComerciante(base.api, c, (trx) =>
            trx
              .insertInto("artigo")
              .values({
                comerciante_id: c,
                tipo: "fisico",
                nome: "Já activo",
                estado: "activo",
              })
              .execute(),
          ),
        ),
      ).toMatch(/catalog\.invalid_transition/);
    });

    it("digital e cartão-oferta estão desligados (P3, ADR-0034)", async () => {
      const c = await comercianteNovo();
      for (const tipo of ["digital", "cartao_oferta"] as const) {
        expect(
          await codigoDoErro(criarArtigo(base.api, c, { tipo, nome: "X" })),
        ).toBe("catalog.type_disabled");
      }
      for (const tipo of ["fisico", "servico", "bilhete"] as const) {
        await criarArtigo(base.api, c, { tipo, nome: "X" });
      }
    });

    it("o tipo não muda", async () => {
      const c = await comercianteNovo();
      const id = await criarArtigo(base.api, c, { tipo: "fisico", nome: "X" });
      expect(
        await codigoDoErro(
          comComerciante(base.api, c, (trx) =>
            trx
              .updateTable("artigo")
              .set({ tipo: "servico" })
              .where("id", "=", id)
              .execute(),
          ),
        ),
      ).toMatch(/catalog\.immutable_type/);
    });

    it("apaga-se um rascunho que nunca esteve activo, com as variantes; o resto não", async () => {
      const c = await comercianteNovo();
      const rascunho = await criarArtigo(
        base.api,
        c,
        { tipo: "fisico", nome: "Gel" },
        [VARIANTE],
      );
      await apagarRascunho(base.api, c, rascunho);
      expect(await varianteComSku(base.api, c, "GEL-001")).toBeUndefined();
      const activo = await criarArtigo(
        base.api,
        c,
        { tipo: "fisico", nome: "Gel" },
        [{ ...VARIANTE, sku: "GEL-002" }],
      );
      await mudarEstadoArtigo(base.api, c, activo, 1, "activo");
      expect(await codigoDoErro(apagarRascunho(base.api, c, activo))).toBe(
        "catalog.not_draft",
      );
      // Nem uma variante sozinha de um artigo que não é rascunho.
      const variante = await varianteComSku(base.api, c, "GEL-002");
      expect(
        await codigoDoErro(
          comComerciante(base.api, c, (trx) =>
            trx
              .deleteFrom("variante")
              .where("id", "=", variante?.id ?? "")
              .execute(),
          ),
        ),
      ).toMatch(/catalog\.not_draft/);
    });

    it("a escrita com versão antiga é recusada (§3.1)", async () => {
      const c = await comercianteNovo();
      const id = await criarArtigo(base.api, c, {
        tipo: "fisico",
        nome: "Gel",
      });
      const v2 = await alterarArtigo(base.api, c, id, 1, { nome: "Gel novo" });
      expect(v2).toBe(2);
      expect(
        await codigoDoErro(
          alterarArtigo(base.api, c, id, 1, { nome: "Velho" }),
        ),
      ).toBe("catalog.version_conflict");
      expect((await obterArtigo(base.api, c, id)).nome).toBe("Gel novo");
    });

    it("a origem externa traz a referência; a do Eurolify não", async () => {
      const c = await comercianteNovo();
      const id = await criarArtigo(base.api, c, {
        tipo: "fisico",
        nome: "Gel",
        origem_ref: "HUB-123",
      });
      expect(await obterArtigo(base.api, c, id)).toMatchObject({
        origem: "externo",
        origem_ref: "HUB-123",
      });
      expect(
        await codigoDoErro(
          comComerciante(base.api, c, (trx) =>
            trx
              .insertInto("artigo")
              .values({
                comerciante_id: c,
                tipo: "fisico",
                nome: "X",
                origem: "externo",
              })
              .execute(),
          ),
        ),
      ).toMatch(/^pg:23514:/);
    });
  });

  describe("variante (§3.2, C3, C4, C6, P7)", () => {
    it("o SKU é único por comerciante, também contra uma variante arquivada (P7)", async () => {
      const c = await comercianteNovo();
      const id = await criarArtigo(
        base.api,
        c,
        { tipo: "fisico", nome: "Gel" },
        [VARIANTE],
      );
      expect(await codigoDoErro(criarVariante(base.api, c, id, VARIANTE))).toBe(
        "catalog.sku_duplicate",
      );
      const variante = await varianteComSku(base.api, c, "GEL-001");
      await arquivarVariante(base.api, c, variante?.id ?? "");
      expect(await codigoDoErro(criarVariante(base.api, c, id, VARIANTE))).toBe(
        "catalog.sku_duplicate",
      );
    });

    it("SKU e unidade de venda são obrigatórios e válidos (C3)", async () => {
      const c = await comercianteNovo();
      const id = await criarArtigo(base.api, c, {
        tipo: "fisico",
        nome: "Gel",
      });
      for (const ma of [
        { ...VARIANTE, sku: "" },
        { ...VARIANTE, sku: " GEL" },
        { ...VARIANTE, unidade_de_venda: "litro" as never },
      ]) {
        expect(await codigoDoErro(criarVariante(base.api, c, id, ma))).toMatch(
          /^pg:23(502|514):/,
        );
      }
    });

    it("o GTIN tem dígito de controlo certo, origem e é único (C4)", async () => {
      const c = await comercianteNovo();
      const id = await criarArtigo(base.api, c, {
        tipo: "fisico",
        nome: "Gel",
      });
      // Dígitos de controlo calculados à mão (pesos 3 e 1 da direita).
      let n = 0;
      for (const gtin of [
        "96385074",
        "000123456784",
        "4006381333931",
        "12345678901231",
      ]) {
        n += 1;
        await criarVariante(base.api, c, id, {
          ...VARIANTE,
          sku: `G-${String(n)}`,
          gtin,
          gtin_origem: "fornecedor",
        });
      }
      expect(
        await codigoDoErro(
          criarVariante(base.api, c, id, {
            ...VARIANTE,
            sku: "G-ERRADO",
            gtin: "4006381333932",
            gtin_origem: "fornecedor",
          }),
        ),
      ).toBe("catalog.gtin_invalid");
      expect(
        await codigoDoErro(
          criarVariante(base.api, c, id, {
            ...VARIANTE,
            sku: "G-TAMANHO",
            gtin: "123456789",
            gtin_origem: "fornecedor",
          }),
        ),
      ).toBe("catalog.gtin_invalid");
      expect(
        await codigoDoErro(
          criarVariante(base.api, c, id, {
            ...VARIANTE,
            sku: "G-REPETIDO",
            gtin: "4006381333931",
            gtin_origem: "interno",
          }),
        ),
      ).toBe("catalog.gtin_duplicate");
      expect(
        await codigoDoErro(
          criarVariante(base.api, c, id, {
            ...VARIANTE,
            sku: "G-SEM-ORIGEM",
            gtin: "96385074",
          }),
        ),
      ).toMatch(/^pg:23514:/);
    });

    it("arquivar uma variante não toca no artigo nem nas outras (C6)", async () => {
      const c = await comercianteNovo();
      const id = await criarArtigo(
        base.api,
        c,
        { tipo: "fisico", nome: "Gel" },
        [VARIANTE, { ...VARIANTE, sku: "GEL-REFILL" }],
      );
      await mudarEstadoArtigo(base.api, c, id, 1, "activo");
      const refill = await varianteComSku(base.api, c, "GEL-REFILL");
      await arquivarVariante(base.api, c, refill?.id ?? "");
      expect((await obterArtigo(base.api, c, id)).estado).toBe("activo");
      expect((await varianteComSku(base.api, c, "GEL-001"))?.estado).toBe(
        "activa",
      );
    });

    it("uma variante arquivada não muda, e o SKU de uma variante não muda", async () => {
      const c = await comercianteNovo();
      const id = await criarArtigo(
        base.api,
        c,
        { tipo: "fisico", nome: "Gel" },
        [VARIANTE, { ...VARIANTE, sku: "GEL-B" }],
      );
      const a = await varianteComSku(base.api, c, "GEL-001");
      const b = await varianteComSku(base.api, c, "GEL-B");
      await arquivarVariante(base.api, c, a?.id ?? "");
      expect(
        await codigoDoErro(
          comComerciante(base.api, c, (trx) =>
            trx
              .updateTable("variante")
              .set({ peso_g: 100 })
              .where("id", "=", a?.id ?? "")
              .execute(),
          ),
        ),
      ).toMatch(/catalog\.variant_archived_is_final/);
      expect(
        await codigoDoErro(
          comComerciante(base.api, c, (trx) =>
            trx
              .updateTable("variante")
              .set({ sku: "GEL-C" })
              .where("id", "=", b?.id ?? "")
              .execute(),
          ),
        ),
      ).toMatch(/catalog\.immutable_identity/);
      expect(id).toBeTruthy();
    });

    it("um artigo arquivado não recebe variantes novas", async () => {
      const c = await comercianteNovo();
      const id = await criarArtigo(
        base.api,
        c,
        { tipo: "fisico", nome: "Gel" },
        [VARIANTE],
      );
      const v = await mudarEstadoArtigo(base.api, c, id, 1, "activo");
      await mudarEstadoArtigo(base.api, c, id, v, "arquivado");
      expect(
        await codigoDoErro(
          criarVariante(base.api, c, id, { ...VARIANTE, sku: "GEL-NOVO" }),
        ),
      ).toBe("catalog.product_archived");
    });

    it("o conteúdo para o preço por unidade vem com quantidade e unidade", async () => {
      const c = await comercianteNovo();
      const id = await criarArtigo(base.api, c, {
        tipo: "fisico",
        nome: "Gel",
      });
      await criarVariante(base.api, c, id, {
        ...VARIANTE,
        conteudo_quantidade: 15,
        conteudo_unidade: "ml",
      });
      expect(
        await codigoDoErro(
          criarVariante(base.api, c, id, {
            ...VARIANTE,
            sku: "SO-QUANTIDADE",
            conteudo_quantidade: 15,
          }),
        ),
      ).toMatch(/^pg:23514:/);
    });
  });

  describe("as listas do código são as da base (C8)", () => {
    it("tipos, estados e unidades de venda", async () => {
      const lista = async (restricao: string) => {
        const { rows } = await sql<{ definicao: string }>`
          select pg_get_constraintdef(oid) as definicao from pg_constraint
          where conname = ${restricao}`.execute(base.dono);
        return [...(rows[0]?.definicao ?? "").matchAll(/'([a-z_0-9]+)'/g)].map(
          (m) => m[1],
        );
      };
      expect(await lista("artigo_tipo_check")).toEqual([...TIPOS_ARTIGO]);
      expect(await lista("artigo_estado_check")).toEqual([...ESTADOS_ARTIGO]);
      expect(await lista("variante_unidade_de_venda_check")).toEqual([
        ...UNIDADES_DE_VENDA,
      ]);
    });
  });
});
