import { sql, type Kysely } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BaseDados } from "../src/base/esquema.js";
import { apagarRascunho, criarArtigo } from "../src/catalogo/repositorio.js";
import {
  comComerciante,
  criarEntidadeLegal,
  criarLoja,
  registarComerciante,
} from "../src/comerciante/repositorio.js";
import {
  alterarMercado,
  criarCanal,
  criarLista,
  criarMercado,
  definirMercadosDoCanal,
  definirPreco,
  ErroPrecos,
  ESPERA_MAXIMA,
  historicoDoPreco,
  mercadosDoCanal,
  mudarEstadoLista,
  mudarEstadoMercado,
  obterMercado,
  precosDaLista,
  tirarPreco,
  traduzir,
  verificarPrecos,
  type DadosMercado,
} from "../src/precos/repositorio.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";

// Preços e mercados, parte 1 (docs/20 §3.1 a §3.5, §4 e §5; migração 0017;
// issue #127), contra o PostgreSQL 18 verdadeiro e com o eurolify_api.

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
const QUEM = "pessoa:teste";

async function codigoDoErro(promessa: Promise<unknown>): Promise<string> {
  try {
    await promessa;
  } catch (erro) {
    if (erro instanceof ErroPrecos) return erro.codigo;
    const pgErro = erro as { code?: unknown; message?: unknown };
    return `pg:${String(pgErro.code)}:${String(pgErro.message)}`;
  }
  return "sem erro";
}

// Corre sem base: as restrições da 0017 têm código próprio.
it("as restrições da 0017 traduzem-se para os códigos de Preços", () => {
  const erro = (code: string, constraint: string, table: string) =>
    Object.assign(new Error("recusado"), { code, constraint, table });
  const codigo = (e: Error) => (traduzir(e) as ErroPrecos).codigo;
  expect(codigo(erro("23514", "preco_gratuito_so_a_zero", "preco"))).toBe(
    "prices.free_only_at_zero",
  );
  expect(
    codigo(erro("23505", "lista_precos_uma_base_activa", "lista_precos")),
  ).toBe("prices.base_list_duplicate");
  expect(codigo(erro("23503", "preco_da_lista", "preco"))).toBe(
    "prices.not_found",
  );
  expect(
    codigo(
      Object.assign(new Error("prices.country_in_other_market: PT já está"), {
        code: "P0001",
      }),
    ),
  ).toBe("prices.country_in_other_market");
});

describe.skipIf(URL_BASE === undefined)("preços e mercados na base", () => {
  let base: BaseDeTeste;

  beforeAll(async () => {
    base = await criarBaseDeTeste(URL_BASE ?? "");
  }, 60_000);

  afterAll(async () => {
    await base.fechar();
  });

  /** Um comerciante com uma loja, um artigo com duas variantes. */
  async function cenario() {
    const c = await registarComerciante(base.api, NOVO);
    const entidade = await criarEntidadeLegal(base.api, c, ENTIDADE);
    const loja = await criarLoja(base.api, c, {
      entidade_legal_id: entidade,
      nome: "Loja online",
    });
    const artigo = await criarArtigo(
      base.api,
      c,
      { tipo: "fisico", nome: "Gel" },
      [
        { sku: "GEL-001", unidade_de_venda: "unidade" },
        { sku: "GEL-002", unidade_de_venda: "unidade" },
      ],
    );
    const variantes = await comComerciante(base.api, c, (trx) =>
      trx
        .selectFrom("variante")
        .select(["id", "sku"])
        .where("artigo_id", "=", artigo)
        .orderBy("sku")
        .execute(),
    );
    const [v1, v2] = variantes.map((v) => v.id);
    if (v1 === undefined || v2 === undefined)
      throw new Error("faltam variantes");
    return { c, loja, entidade, artigo, v1, v2 };
  }

  function mercadoPT(
    loja: string,
    extra: Partial<DadosMercado> = {},
  ): DadosMercado {
    return {
      loja_id: loja,
      nome: "Portugal",
      paises: ["PT"],
      moeda: "EUR",
      linguas: ["pt"],
      lingua_principal: "pt",
      ...extra,
    };
  }

  /** Um mercado activo com a lista de base. */
  async function mercadoActivo(
    c: string,
    loja: string,
    extra: Partial<DadosMercado> = {},
  ) {
    const mercado = await criarMercado(base.api, c, mercadoPT(loja, extra));
    const lista = await criarLista(base.api, c, {
      mercado_id: mercado,
      nome: "Base",
      tipo: "base",
    });
    await mudarEstadoMercado(base.api, c, mercado, 1, "activo");
    return { mercado, lista };
  }

  it("um mercado nasce em rascunho e, por omissão, com os preços com IVA (Q1)", async () => {
    const { c, loja } = await cenario();
    const id = await criarMercado(base.api, c, mercadoPT(loja));
    const m = await obterMercado(base.api, c, id);
    expect(m.estado).toBe("rascunho");
    expect(m.preco_inclui_iva).toBe(true);
    expect(m.versao).toBe(1);
  });

  it("países, moeda e línguas em código; a língua principal é uma das línguas", async () => {
    const { c, loja } = await cenario();
    expect(
      await codigoDoErro(
        criarMercado(base.api, c, mercadoPT(loja, { paises: ["pt"] })),
      ),
    ).toBe("prices.country_invalid");
    expect(
      await codigoDoErro(
        criarMercado(base.api, c, mercadoPT(loja, { paises: ["PT", "PT"] })),
      ),
    ).toBe("prices.country_invalid");
    expect(
      await codigoDoErro(
        criarMercado(base.api, c, mercadoPT(loja, { paises: [] })),
      ),
    ).toBe("prices.country_invalid");
    expect(
      await codigoDoErro(
        criarMercado(base.api, c, mercadoPT(loja, { moeda: "eur" })),
      ),
    ).toBe("prices.currency_invalid");
    expect(
      await codigoDoErro(
        criarMercado(
          base.api,
          c,
          mercadoPT(loja, { linguas: ["PT"], lingua_principal: "PT" }),
        ),
      ),
    ).toBe("prices.language_invalid");
    expect(
      await codigoDoErro(
        criarMercado(base.api, c, mercadoPT(loja, { linguas: ["pt", "pt"] })),
      ),
    ).toBe("prices.language_invalid");
    expect(
      await codigoDoErro(
        criarMercado(base.api, c, mercadoPT(loja, { lingua_principal: "es" })),
      ),
    ).toBe("prices.main_language_not_listed");
    expect(
      await codigoDoErro(
        criarMercado(base.api, c, mercadoPT(loja, { nome: "  " })),
      ),
    ).toBe("prices.name_required");
  });

  it("activar exige a lista de base activa; as transições são as do §4.1", async () => {
    const { c, loja } = await cenario();
    const mercado = await criarMercado(base.api, c, mercadoPT(loja));
    expect(
      await codigoDoErro(mudarEstadoMercado(base.api, c, mercado, 1, "activo")),
    ).toBe("prices.base_list_required");
    expect(
      await codigoDoErro(
        mudarEstadoMercado(base.api, c, mercado, 1, "arquivado"),
      ),
    ).toBe("prices.invalid_transition");
    await criarLista(base.api, c, {
      mercado_id: mercado,
      nome: "Base",
      tipo: "base",
    });
    expect(await mudarEstadoMercado(base.api, c, mercado, 1, "activo")).toBe(2);
    expect(await mudarEstadoMercado(base.api, c, mercado, 2, "arquivado")).toBe(
      3,
    );
    expect(await mudarEstadoMercado(base.api, c, mercado, 3, "activo")).toBe(4);
    expect(
      await codigoDoErro(
        comComerciante(base.api, c, (trx) =>
          sql`update mercado set estado = 'rascunho' where id = ${mercado}`.execute(
            trx,
          ),
        ).catch((e: unknown) => {
          throw traduzir(e);
        }),
      ),
    ).toBe("prices.invalid_transition");
  });

  it("numa loja, um país só está num mercado activo (Q4); noutra loja pode", async () => {
    const { c, loja, entidade } = await cenario();
    const primeiro = await mercadoActivo(c, loja);
    const segundo = await criarMercado(
      base.api,
      c,
      mercadoPT(loja, {
        nome: "Península",
        paises: ["ES", "PT"],
        linguas: ["es", "pt"],
      }),
    );
    await criarLista(base.api, c, {
      mercado_id: segundo,
      nome: "Base",
      tipo: "base",
    });
    expect(
      await codigoDoErro(mudarEstadoMercado(base.api, c, segundo, 1, "activo")),
    ).toBe("prices.country_in_other_market");
    // Noutra loja do mesmo comerciante, Portugal pode estar activo.
    const outraLoja = await criarLoja(base.api, c, {
      entidade_legal_id: entidade,
      nome: "Outra marca",
    });
    await mercadoActivo(c, outraLoja);
    // Arquivado o primeiro, o segundo activa-se.
    await mudarEstadoMercado(base.api, c, primeiro.mercado, 2, "arquivado");
    expect(await mudarEstadoMercado(base.api, c, segundo, 1, "activo")).toBe(2);
    // E acrescentar um país de um mercado activo a outro activo é recusado.
    const terceiro = await mercadoActivo(c, loja, {
      nome: "França",
      paises: ["FR"],
      linguas: ["fr"],
      lingua_principal: "fr",
    });
    expect(
      await codigoDoErro(
        alterarMercado(base.api, c, terceiro.mercado, 2, {
          paises: ["FR", "ES"],
        }),
      ),
    ).toBe("prices.country_in_other_market");
  });

  it("listas: uma de base activa por mercado; a de um mercado activo não se arquiva; B2B por etiqueta", async () => {
    const { c, loja } = await cenario();
    const { mercado, lista } = await mercadoActivo(c, loja);
    expect(
      await codigoDoErro(
        criarLista(base.api, c, {
          mercado_id: mercado,
          nome: "Outra",
          tipo: "base",
        }),
      ),
    ).toBe("prices.base_list_duplicate");
    expect(
      await codigoDoErro(mudarEstadoLista(base.api, c, lista, 1, "arquivada")),
    ).toBe("prices.base_list_in_use");
    expect(
      await codigoDoErro(
        criarLista(base.api, c, {
          mercado_id: mercado,
          nome: "Pro",
          tipo: "b2b",
        }),
      ),
    ).toBe("prices.b2b_label_required");
    const etiqueta = "0192a3b4-0000-7000-8000-000000000001";
    await criarLista(base.api, c, {
      mercado_id: mercado,
      nome: "Profissionais",
      tipo: "b2b",
      etiqueta_id: etiqueta,
      prioridade: 10,
    });
    expect(
      await codigoDoErro(
        criarLista(base.api, c, {
          mercado_id: mercado,
          nome: "Salões",
          tipo: "b2b",
          etiqueta_id: "0192a3b4-0000-7000-8000-000000000002",
          prioridade: 10,
        }),
      ),
    ).toBe("prices.priority_duplicate");
    expect(
      await codigoDoErro(
        criarLista(base.api, c, {
          mercado_id: mercado,
          nome: "Repetida",
          tipo: "b2b",
          etiqueta_id: etiqueta,
          prioridade: 20,
        }),
      ),
    ).toBe("prices.label_duplicate");
    // Num mercado em rascunho, a lista de base arquiva-se.
    const rascunho = await criarMercado(
      base.api,
      c,
      mercadoPT(loja, {
        nome: "ES",
        paises: ["ES"],
        linguas: ["es"],
        lingua_principal: "es",
      }),
    );
    const baseRascunho = await criarLista(base.api, c, {
      mercado_id: rascunho,
      nome: "Base ES",
      tipo: "base",
    });
    expect(
      await mudarEstadoLista(base.api, c, baseRascunho, 1, "arquivada"),
    ).toBe(2);
  });

  it("um preço nasce e muda com linhas no histórico; as quantidades não contam como mudança de preço", async () => {
    const { c, loja, v1 } = await cenario();
    const { lista } = await mercadoActivo(c, loja);
    const p = await definirPreco(base.api, c, QUEM, lista, v1, {
      montante: 990,
    });
    expect(p).toMatchObject({
      montante: 990,
      gratuito: false,
      quantidade_minima: 1,
      multiplo: 1,
      versao: 1,
      definido_por: QUEM,
    });
    await definirPreco(base.api, c, QUEM, lista, v1, { montante: 1090 });
    await definirPreco(base.api, c, QUEM, lista, v1, {
      montante: 1090,
      quantidade_minima: 6,
      multiplo: 6,
    });
    const precos = await precosDaLista(base.api, c, lista);
    expect(precos).toHaveLength(1);
    expect(precos[0]).toMatchObject({
      montante: 1090,
      quantidade_minima: 6,
      multiplo: 6,
      versao: 3,
    });
    const historico = await historicoDoPreco(base.api, c, lista, v1);
    expect(historico.map((h) => [h.montante, h.saiu])).toEqual([
      [990, false],
      [1090, false],
    ]);
  });

  it("nada a 0,00 € sem ser gratuito, e gratuito só a 0 (R4)", async () => {
    const { c, loja, v1, v2 } = await cenario();
    const { lista } = await mercadoActivo(c, loja);
    expect(
      await codigoDoErro(
        definirPreco(base.api, c, QUEM, lista, v1, { montante: 0 }),
      ),
    ).toBe("prices.free_only_at_zero");
    expect(
      await codigoDoErro(
        definirPreco(base.api, c, QUEM, lista, v1, {
          montante: 990,
          gratuito: true,
        }),
      ),
    ).toBe("prices.free_only_at_zero");
    expect(
      await codigoDoErro(
        definirPreco(base.api, c, QUEM, lista, v1, { montante: -1 }),
      ),
    ).toBe("prices.amount_invalid");
    expect(
      await codigoDoErro(
        definirPreco(base.api, c, QUEM, lista, v1, { montante: 100000000001 }),
      ),
    ).toBe("prices.amount_invalid");
    expect(
      await codigoDoErro(
        definirPreco(base.api, c, QUEM, lista, v1, { montante: 9.9 }),
      ),
    ).toBe("prices.invalid_field");
    expect(
      await codigoDoErro(
        definirPreco(base.api, c, QUEM, lista, v1, {
          montante: 990,
          quantidade_minima: 0,
        }),
      ),
    ).toBe("prices.quantity_invalid");
    const gratis = await definirPreco(base.api, c, QUEM, lista, v2, {
      montante: 0,
      gratuito: true,
    });
    expect(gratis.gratuito).toBe(true);
  });

  it("quem define o preço é obrigatório; numa lista arquivada não se escreve", async () => {
    const { c, loja, v1 } = await cenario();
    const { lista, mercado } = await mercadoActivo(c, loja);
    expect(
      await codigoDoErro(
        definirPreco(base.api, c, "  ", lista, v1, { montante: 990 }),
      ),
    ).toBe("prices.defined_by_required");
    const b2b = await criarLista(base.api, c, {
      mercado_id: mercado,
      nome: "Pro",
      tipo: "b2b",
      etiqueta_id: "0192a3b4-0000-7000-8000-000000000003",
      prioridade: 1,
    });
    await mudarEstadoLista(base.api, c, b2b, 1, "arquivada");
    expect(
      await codigoDoErro(
        definirPreco(base.api, c, QUEM, b2b, v1, { montante: 990 }),
      ),
    ).toBe("prices.list_archived");
  });

  it("tirar um preço deixa a saída no histórico", async () => {
    const { c, loja, v1 } = await cenario();
    const { lista } = await mercadoActivo(c, loja);
    await definirPreco(base.api, c, QUEM, lista, v1, { montante: 990 });
    expect(await codigoDoErro(tirarPreco(base.api, c, "", lista, v1))).toBe(
      "prices.defined_by_required",
    );
    expect(await tirarPreco(base.api, c, "pessoa:outra", lista, v1)).toBe(true);
    expect(await tirarPreco(base.api, c, QUEM, lista, v1)).toBe(false);
    const historico = await historicoDoPreco(base.api, c, lista, v1);
    expect(historico.map((h) => [h.montante, h.saiu, h.definido_por])).toEqual([
      [990, false, QUEM],
      [null, true, "pessoa:outra"],
    ]);
  });

  it("apagar o rascunho de um artigo tira os preços e regista a saída", async () => {
    const { c, loja, artigo, v1 } = await cenario();
    const { lista } = await mercadoActivo(c, loja);
    await definirPreco(base.api, c, QUEM, lista, v1, { montante: 990 });
    await apagarRascunho(base.api, c, artigo);
    expect(await precosDaLista(base.api, c, lista)).toEqual([]);
    const historico = await historicoDoPreco(base.api, c, lista, v1);
    expect(
      historico.map((h) => [
        h.saiu,
        h.definido_por,
        h.moeda,
        h.preco_inclui_iva,
      ]),
    ).toEqual([
      [false, QUEM, "EUR", true],
      // Desde a linha do tempo (0033), toda a mudança no catálogo traz quem
      // (aqui, o da base de teste); o «catalogo:variante apagada» deixou de se ver.
      [true, "teste:base", "EUR", true],
    ]);
  });

  it("nem por escrita directa um mercado nasce activo ou uma lista nasce arquivada", async () => {
    const { c, loja } = await cenario();
    const dono = base.dono as Kysely<BaseDados>;
    expect(
      await codigoDoErro(
        sql`insert into mercado (comerciante_id, loja_id, nome, paises, moeda, linguas, lingua_principal, estado)
            values (${c}, ${loja}, 'Directo', '{PT}', 'EUR', '{pt}', 'pt', 'activo')`.execute(
          dono,
        ),
      ),
    ).toMatch(/prices\.invalid_transition/);
    const mercado = await criarMercado(base.api, c, mercadoPT(loja));
    expect(
      await codigoDoErro(
        sql`insert into lista_precos (comerciante_id, mercado_id, nome, tipo, estado)
            values (${c}, ${mercado}, 'Directa', 'base', 'arquivada')`.execute(
          dono,
        ),
      ),
    ).toMatch(/prices\.invalid_transition/);
  });

  it("o histórico só se acrescenta: nem o dono o altera, e a API não lhe escreve", async () => {
    const { c, loja, v1 } = await cenario();
    const { lista } = await mercadoActivo(c, loja);
    await definirPreco(base.api, c, QUEM, lista, v1, { montante: 990 });
    const dono = base.dono as Kysely<BaseDados>;
    expect(
      await codigoDoErro(
        sql`update historico_preco set montante = 1 where lista_id = ${lista}`.execute(
          dono,
        ),
      ),
    ).toMatch(/audit\.append_only/);
    expect(
      await codigoDoErro(
        sql`delete from historico_preco where lista_id = ${lista}`.execute(
          dono,
        ),
      ),
    ).toMatch(/audit\.append_only/);
    expect(
      await codigoDoErro(sql`truncate historico_preco`.execute(dono)),
    ).toMatch(/audit\.append_only/);
    expect(
      await codigoDoErro(
        comComerciante(base.api, c, (trx) =>
          sql`insert into historico_preco (comerciante_id, lista_id, variante_id, montante, gratuito, saiu, definido_por)
              values (${c}, ${lista}, ${v1}, 1, false, false, 'falso')`.execute(
            trx,
          ),
        ),
      ),
    ).toMatch(/^pg:42501/);
  });

  it("a moeda e o «preço inclui IVA» não mudam depois de haver preços", async () => {
    const { c, loja, v1 } = await cenario();
    const { mercado, lista } = await mercadoActivo(c, loja);
    expect(
      await alterarMercado(base.api, c, mercado, 2, {
        preco_inclui_iva: false,
      }),
    ).toBe(3);
    await definirPreco(base.api, c, QUEM, lista, v1, { montante: 990 });
    expect(
      await codigoDoErro(
        alterarMercado(base.api, c, mercado, 3, { moeda: "SEK" }),
      ),
    ).toBe("prices.market_has_prices");
    expect(
      await codigoDoErro(
        alterarMercado(base.api, c, mercado, 3, { preco_inclui_iva: true }),
      ),
    ).toBe("prices.market_has_prices");
    expect(
      await alterarMercado(base.api, c, mercado, 3, {
        nome: "Portugal continental",
      }),
    ).toBe(4);
  });

  it("escrita com versão antiga é recusada; um id que não existe é «não existe»; campos fora da lista não passam", async () => {
    const { c, loja } = await cenario();
    const mercado = await criarMercado(base.api, c, mercadoPT(loja));
    expect(await alterarMercado(base.api, c, mercado, 1, { nome: "PT" })).toBe(
      2,
    );
    expect(
      await codigoDoErro(
        alterarMercado(base.api, c, mercado, 1, { nome: "PT2" }),
      ),
    ).toBe("prices.version_conflict");
    expect(
      await codigoDoErro(
        alterarMercado(base.api, c, "0192a3b4-0000-7000-8000-00000000ffff", 1, {
          nome: "x",
        }),
      ),
    ).toBe("prices.not_found");
    expect(await codigoDoErro(obterMercado(base.api, c, "nao-e-um-uuid"))).toBe(
      "prices.not_found",
    );
    const comExtra = { nome: "PT3", estado: "activo" } as unknown as {
      nome: string;
    };
    expect(await alterarMercado(base.api, c, mercado, 2, comExtra)).toBe(3);
    expect((await obterMercado(base.api, c, mercado)).estado).toBe("rascunho");
  });

  it("um canal vende em mercados da sua loja; de outra loja é recusado", async () => {
    const { c, loja, entidade } = await cenario();
    const { mercado } = await mercadoActivo(c, loja);
    const canal = await criarCanal(base.api, c, {
      loja_id: loja,
      nome: "Loja online",
    });
    await definirMercadosDoCanal(base.api, c, canal, [mercado]);
    expect(await mercadosDoCanal(base.api, c, canal)).toEqual([mercado]);
    const outraLoja = await criarLoja(base.api, c, {
      entidade_legal_id: entidade,
      nome: "Outra",
    });
    const deOutra = await criarMercado(base.api, c, mercadoPT(outraLoja));
    expect(
      await codigoDoErro(
        definirMercadosDoCanal(base.api, c, canal, [mercado, deOutra]),
      ),
    ).toBe("prices.not_found");
    expect(await mercadosDoCanal(base.api, c, canal)).toEqual([mercado]);
    expect(
      await codigoDoErro(
        definirMercadosDoCanal(base.api, c, canal, [mercado, mercado]),
      ),
    ).toBe("prices.channel_market_duplicate");
    await definirMercadosDoCanal(base.api, c, canal, []);
    expect(await mercadosDoCanal(base.api, c, canal)).toEqual([]);
  });

  it("um comerciante não vê nem escreve nos preços de outro", async () => {
    const a = await cenario();
    const b = await cenario();
    const { mercado, lista } = await mercadoActivo(a.c, a.loja);
    await definirPreco(base.api, a.c, QUEM, lista, a.v1, { montante: 990 });
    expect(await precosDaLista(base.api, b.c, lista)).toEqual([]);
    expect(await codigoDoErro(obterMercado(base.api, b.c, mercado))).toBe(
      "prices.not_found",
    );
    expect(
      await codigoDoErro(
        definirPreco(base.api, b.c, QUEM, lista, b.v1, { montante: 1 }),
      ),
    ).toBe("prices.not_found");
    // A variante de outro comerciante também não serve.
    expect(
      await codigoDoErro(
        definirPreco(base.api, a.c, QUEM, lista, b.v1, { montante: 1 }),
      ),
    ).toBe("prices.not_found");
    expect(
      await codigoDoErro(criarMercado(base.api, b.c, mercadoPT(a.loja))),
    ).toBe("prices.not_found");
  });

  it("a pergunta da C2: há preço na lista de base de um mercado activo?", async () => {
    const { c, loja, v1, v2 } = await cenario();
    const rascunho = await criarMercado(base.api, c, mercadoPT(loja));
    expect(await verificarPrecos(base.api, c, rascunho, [v1])).toEqual([
      {
        variante_id: v1,
        com_preco: false,
        gratuito: false,
        impedimento: "prices.market_inactive",
      },
    ]);
    const lista = await criarLista(base.api, c, {
      mercado_id: rascunho,
      nome: "Base",
      tipo: "base",
    });
    await mudarEstadoMercado(base.api, c, rascunho, 1, "activo");
    await definirPreco(base.api, c, QUEM, lista, v1, {
      montante: 0,
      gratuito: true,
    });
    expect(await verificarPrecos(base.api, c, rascunho, [v1, v2])).toEqual([
      { variante_id: v1, com_preco: true, gratuito: true, impedimento: null },
      {
        variante_id: v2,
        com_preco: false,
        gratuito: false,
        impedimento: "prices.no_price",
      },
    ]);
    // Um preço só numa lista B2B não conta para a C2.
    const b2b = await criarLista(base.api, c, {
      mercado_id: rascunho,
      nome: "Pro",
      tipo: "b2b",
      etiqueta_id: "0192a3b4-0000-7000-8000-000000000004",
      prioridade: 1,
    });
    await definirPreco(base.api, c, QUEM, b2b, v2, { montante: 500 });
    expect(
      (await verificarPrecos(base.api, c, rascunho, [v2]))[0]?.impedimento,
    ).toBe("prices.no_price");
    expect(await verificarPrecos(base.api, c, rascunho, [])).toEqual([]);
  });

  // ------------------------------------------------------------------
  // Achados da revisão do #134 (1.ª ronda).

  it("tirados todos os preços, a moeda continua fixa; o histórico guarda a moeda e o IVA (P2-1)", async () => {
    const { c, loja, v1 } = await cenario();
    const { mercado, lista } = await mercadoActivo(c, loja);
    await definirPreco(base.api, c, QUEM, lista, v1, { montante: 990 });
    await tirarPreco(base.api, c, QUEM, lista, v1);
    expect(await precosDaLista(base.api, c, lista)).toEqual([]);
    expect(
      await codigoDoErro(
        alterarMercado(base.api, c, mercado, 2, { moeda: "SEK" }),
      ),
    ).toBe("prices.market_has_prices");
    const historico = await historicoDoPreco(base.api, c, lista, v1);
    expect(historico.map((h) => [h.saiu, h.moeda, h.preco_inclui_iva])).toEqual(
      [
        [false, "EUR", true],
        [true, "EUR", true],
      ],
    );
  });

  it("reenviar o mesmo preço não muda quem o definiu (P3-2)", async () => {
    const { c, loja, v1 } = await cenario();
    const { lista } = await mercadoActivo(c, loja);
    const primeiro = await definirPreco(base.api, c, QUEM, lista, v1, {
      montante: 990,
    });
    const outra = await definirPreco(base.api, c, "pessoa:outra", lista, v1, {
      montante: 990,
      multiplo: 2,
    });
    expect(outra).toMatchObject({
      definido_por: QUEM,
      definido_em: primeiro.definido_em,
      multiplo: 2,
      versao: 2,
    });
    const mudou = await definirPreco(base.api, c, "pessoa:outra", lista, v1, {
      montante: 1090,
      multiplo: 2,
    });
    expect(mudou.definido_por).toBe("pessoa:outra");
    const historico = await historicoDoPreco(base.api, c, lista, v1);
    expect(historico.map((h) => h.definido_por)).toEqual([
      QUEM,
      "pessoa:outra",
    ]);
  });

  it("uma etiqueta mal escrita é campo inválido; um montante fora do limite é montante inválido (P3-4)", async () => {
    const { c, loja, v1 } = await cenario();
    const { mercado, lista } = await mercadoActivo(c, loja);
    expect(
      await codigoDoErro(
        criarLista(base.api, c, {
          mercado_id: mercado,
          nome: "Pro",
          tipo: "b2b",
          etiqueta_id: "nao-e-uuid",
          prioridade: 1,
        }),
      ),
    ).toBe("prices.invalid_field");
    expect(
      await codigoDoErro(
        definirPreco(base.api, c, QUEM, lista, v1, { montante: 1e20 }),
      ),
    ).toBe("prices.amount_invalid");
    // A restrição da base também recusa, sem o repositório pelo meio.
    expect(
      await codigoDoErro(
        comComerciante(base.api, c, async (trx) => {
          await sql`select set_config('eurolify.quem', ${QUEM}, true)`.execute(
            trx,
          );
          await sql`insert into preco (comerciante_id, lista_id, variante_id, montante)
              values (${c}, ${lista}, ${v1}, -1)`.execute(trx);
        }).catch((e: unknown) => {
          throw traduzir(e);
        }),
      ),
    ).toBe("prices.amount_invalid");
  });

  it("nem o dono muda a loja de um mercado, o mercado de uma lista ou a loja de um canal (P3-9)", async () => {
    const { c, loja, entidade } = await cenario();
    const outraLoja = await criarLoja(base.api, c, {
      entidade_legal_id: entidade,
      nome: "Outra",
    });
    const mercado = await criarMercado(base.api, c, mercadoPT(loja));
    const outro = await criarMercado(
      base.api,
      c,
      mercadoPT(loja, { nome: "PT2" }),
    );
    const lista = await criarLista(base.api, c, {
      mercado_id: mercado,
      nome: "Base",
      tipo: "base",
    });
    const canal = await criarCanal(base.api, c, {
      loja_id: loja,
      nome: "Online",
    });
    const dono = base.dono as Kysely<BaseDados>;
    expect(
      await codigoDoErro(
        sql`update mercado set loja_id = ${outraLoja} where id = ${mercado}`.execute(
          dono,
        ),
      ),
    ).toMatch(/prices\.immutable_identity/);
    expect(
      await codigoDoErro(
        sql`update lista_precos set mercado_id = ${outro} where id = ${lista}`.execute(
          dono,
        ),
      ),
    ).toMatch(/prices\.immutable_identity/);
    expect(
      await codigoDoErro(
        sql`update canal set loja_id = ${outraLoja} where id = ${canal}`.execute(
          dono,
        ),
      ),
    ).toMatch(/prices\.immutable_identity/);
  });

  it("um canal nasce activo; quem define tem no máximo 200 caracteres; a variante de um preço não muda", async () => {
    const { c, loja, v1, v2 } = await cenario();
    const { lista } = await mercadoActivo(c, loja);
    const dono = base.dono as Kysely<BaseDados>;
    expect(
      await codigoDoErro(
        sql`insert into canal (comerciante_id, loja_id, nome, estado)
            values (${c}, ${loja}, 'Directo', 'arquivado')`.execute(dono),
      ),
    ).toMatch(/prices\.invalid_transition/);
    expect(
      await codigoDoErro(
        definirPreco(base.api, c, "x".repeat(201), lista, v1, {
          montante: 990,
        }),
      ),
    ).toBe("prices.defined_by_required");
    await definirPreco(base.api, c, QUEM, lista, v1, { montante: 990 });
    expect(
      await codigoDoErro(
        dono.transaction().execute(async (trx) => {
          await sql`select set_config('eurolify.quem', ${QUEM}, true)`.execute(
            trx,
          );
          await sql`update preco set variante_id = ${v2}
              where lista_id = ${lista} and variante_id = ${v1}`.execute(trx);
        }),
      ),
    ).toMatch(/prices\.immutable_identity/);
  });

  it("repor uma lista de base arquivada quando já há outra activa é recusado (P3-9)", async () => {
    const { c, loja } = await cenario();
    const mercado = await criarMercado(base.api, c, mercadoPT(loja));
    const antiga = await criarLista(base.api, c, {
      mercado_id: mercado,
      nome: "Base antiga",
      tipo: "base",
    });
    await mudarEstadoLista(base.api, c, antiga, 1, "arquivada");
    await criarLista(base.api, c, {
      mercado_id: mercado,
      nome: "Base",
      tipo: "base",
    });
    expect(
      await codigoDoErro(mudarEstadoLista(base.api, c, antiga, 2, "activa")),
    ).toBe("prices.base_list_duplicate");
  });

  describe("em concorrência (P1-1, P2-2, P2-3 e P2-4)", () => {
    // Cada ligação é uma transacção aberta do eurolify_api, com o comerciante
    // e quem escreve; prova-se que a segunda espera pela primeira (fica à
    // espera de um lock) e o que vê depois de a primeira confirmar.
    const abertas: pg.Client[] = [];

    afterAll(async () => {
      await Promise.all(abertas.map((l) => l.end()));
    });

    const pids = new Map<pg.Client, number>();

    async function ligacao(c: string): Promise<pg.Client> {
      const l = new pg.Client({ connectionString: base.urlApi });
      await l.connect();
      abertas.push(l);
      const { rows } = await l.query<{ pid: number }>(
        "select pg_backend_pid() as pid",
      );
      pids.set(l, rows[0]?.pid ?? -1);
      await l.query("begin");
      await l.query(
        "select set_config('eurolify.comerciante', $1, true), set_config('eurolify.quem', $2, true)",
        [c, QUEM],
      );
      return l;
    }

    /**
     * Uma escrita que vai ficar à espera. A promessa nunca é recusada: dá o
     * erro (ou `undefined`), para a recusa não chegar antes de alguém a ouvir
     * (o CI do ef85440 contou-a como «Unhandled Rejection»; 2.ª ronda, P3-D).
     */
    function escreve(
      l: pg.Client,
      texto: string,
      valores: unknown[],
    ): Promise<unknown> {
      return l.query(texto, valores).then(
        () => undefined,
        (erro: unknown) => erro ?? new Error("recusa sem erro"),
      );
    }

    /** Espera até a ligação `l` estar à espera de um lock. */
    async function espera(l: pg.Client): Promise<void> {
      const pid = pids.get(l) ?? -1;
      for (let i = 0; i < 100; i++) {
        const { rows } = await sql<{ n: number }>`
          select count(*)::int as n from pg_stat_activity
          where pid = ${pid} and wait_event_type = 'Lock'`.execute(base.dono);
        if ((rows[0]?.n ?? 0) > 0) return;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error("a segunda escrita não esperou pela primeira");
    }

    /** O código da escrita que esperava, já com a transacção acabada. */
    async function resultado(
      l: pg.Client,
      escrita: Promise<unknown>,
    ): Promise<string> {
      const erro = await escrita;
      if (erro === undefined) {
        await l.query("commit");
        return "sem erro";
      }
      await l.query("rollback");
      const t = traduzir(erro);
      if (t instanceof ErroPrecos) return t.codigo;
      return erro instanceof Error ? erro.message : JSON.stringify(erro);
    }

    it("mudar a moeda e escrever o primeiro preço: quem chega depois espera e vê o outro", async () => {
      const { c, loja, v1, v2 } = await cenario();
      const { mercado, lista } = await mercadoActivo(c, loja);
      // A moeda primeiro: o preço espera e fica escrito na moeda nova.
      const a = await ligacao(c);
      await a.query("update mercado set moeda = 'SEK' where id = $1", [
        mercado,
      ]);
      const b = await ligacao(c);
      const escrita = escreve(
        b,
        "insert into preco (comerciante_id, lista_id, variante_id, montante) values ($1, $2, $3, 990)",
        [c, lista, v1],
      );
      await espera(b);
      await a.query("commit");
      expect(await resultado(b, escrita)).toBe("sem erro");
      expect(
        (await historicoDoPreco(base.api, c, lista, v1)).map((h) => h.moeda),
      ).toEqual(["SEK"]);
      // O preço primeiro: a moeda espera e depois é recusada.
      const outro = await mercadoActivo(c, loja, {
        nome: "França",
        paises: ["FR"],
        linguas: ["fr"],
        lingua_principal: "fr",
      });
      const d = await ligacao(c);
      await d.query(
        "insert into preco (comerciante_id, lista_id, variante_id, montante) values ($1, $2, $3, 990)",
        [c, outro.lista, v2],
      );
      const e = await ligacao(c);
      const mudanca = escreve(
        e,
        "update mercado set moeda = 'SEK' where id = $1",
        [outro.mercado],
      );
      await espera(e);
      await d.query("commit");
      expect(await resultado(e, mudanca)).toBe("prices.market_has_prices");
    });

    it("arquivar uma lista e escrever um preço nela: o preço espera e é recusado", async () => {
      const { c, loja, v1 } = await cenario();
      const { mercado } = await mercadoActivo(c, loja);
      const b2b = await criarLista(base.api, c, {
        mercado_id: mercado,
        nome: "Pro",
        tipo: "b2b",
        etiqueta_id: "0192a3b4-0000-7000-8000-000000000005",
        prioridade: 1,
      });
      const a = await ligacao(c);
      await a.query(
        "update lista_precos set estado = 'arquivada' where id = $1",
        [b2b],
      );
      const b = await ligacao(c);
      const escrita = escreve(
        b,
        "insert into preco (comerciante_id, lista_id, variante_id, montante) values ($1, $2, $3, 990)",
        [c, b2b, v1],
      );
      await espera(b);
      await a.query("commit");
      expect(await resultado(b, escrita)).toBe("prices.list_archived");
    });

    it("o histórico fica pela ordem das escritas, não pela hora a que cada transacção começou", async () => {
      const { c, loja, v1 } = await cenario();
      const { lista } = await mercadoActivo(c, loja);
      await definirPreco(base.api, c, QUEM, lista, v1, { montante: 990 });
      // A começa primeiro mas escreve depois de B.
      const a = await ligacao(c);
      await a.query("select now()");
      await new Promise((r) => setTimeout(r, 20));
      const b = await ligacao(c);
      await b.query(
        "update preco set montante = 1100 where lista_id = $1 and variante_id = $2",
        [lista, v1],
      );
      const escrita = escreve(
        a,
        "update preco set montante = 1200 where lista_id = $1 and variante_id = $2",
        [lista, v1],
      );
      await espera(a);
      await b.query("commit");
      expect(await resultado(a, escrita)).toBe("sem erro");
      const historico = await historicoDoPreco(base.api, c, lista, v1);
      expect(historico.map((h) => h.montante)).toEqual([990, 1100, 1200]);
      expect((await precosDaLista(base.api, c, lista))[0]?.montante).toBe(1200);
    });

    it("dois mercados com o mesmo país activados ao mesmo tempo: só um fica activo", async () => {
      const { c, loja } = await cenario();
      const m1 = await criarMercado(base.api, c, mercadoPT(loja));
      const m2 = await criarMercado(
        base.api,
        c,
        mercadoPT(loja, { nome: "PT2" }),
      );
      for (const m of [m1, m2]) {
        await criarLista(base.api, c, {
          mercado_id: m,
          nome: "Base",
          tipo: "base",
        });
      }
      const a = await ligacao(c);
      await a.query("update mercado set estado = 'activo' where id = $1", [m1]);
      const b = await ligacao(c);
      const activar = escreve(
        b,
        "update mercado set estado = 'activo' where id = $1",
        [m2],
      );
      await espera(b);
      await a.query("commit");
      expect(await resultado(b, activar)).toBe(
        "prices.country_in_other_market",
      );
    });

    it("activar o mercado e arquivar a lista de base: nunca fica um mercado activo sem lista de base", async () => {
      const { c, loja } = await cenario();
      // Arquivar primeiro: a activação espera e é recusada.
      const m1 = await criarMercado(base.api, c, mercadoPT(loja));
      const l1 = await criarLista(base.api, c, {
        mercado_id: m1,
        nome: "Base",
        tipo: "base",
      });
      const a = await ligacao(c);
      await a.query(
        "update lista_precos set estado = 'arquivada' where id = $1",
        [l1],
      );
      const b = await ligacao(c);
      const activar = escreve(
        b,
        "update mercado set estado = 'activo' where id = $1",
        [m1],
      );
      await espera(b);
      await a.query("commit");
      expect(await resultado(b, activar)).toBe("prices.base_list_required");
      // Activar primeiro: o arquivo espera e é recusado.
      const m2 = await criarMercado(
        base.api,
        c,
        mercadoPT(loja, {
          nome: "ES",
          paises: ["ES"],
          linguas: ["es"],
          lingua_principal: "es",
        }),
      );
      const l2 = await criarLista(base.api, c, {
        mercado_id: m2,
        nome: "Base",
        tipo: "base",
      });
      const d = await ligacao(c);
      await d.query("update mercado set estado = 'activo' where id = $1", [m2]);
      const e = await ligacao(c);
      const arquivar = escreve(
        e,
        "update lista_precos set estado = 'arquivada' where id = $1",
        [l2],
      );
      await espera(e);
      await d.query("commit");
      expect(await resultado(e, arquivar)).toBe("prices.base_list_in_use");
    });

    it("um preço que volta depois de sair fica no histórico depois da saída", async () => {
      const { c, loja, v1 } = await cenario();
      const { lista } = await mercadoActivo(c, loja);
      await definirPreco(base.api, c, QUEM, lista, v1, { montante: 990 });
      const a = await ligacao(c);
      await a.query(
        "delete from preco where lista_id = $1 and variante_id = $2",
        [lista, v1],
      );
      // O INSERT de B espera pela saída de A (a mesma chave).
      const volta = definirPreco(base.api, c, QUEM, lista, v1, {
        montante: 1100,
      }).then(
        () => undefined,
        (erro: unknown) => erro,
      );
      for (let i = 0; i < 100; i++) {
        const { rows } = await sql<{ n: number }>`
          select count(*)::int as n from pg_stat_activity
          where usename = 'eurolify_api' and datname = current_database()
            and wait_event_type = 'Lock'`.execute(base.dono);
        if ((rows[0]?.n ?? 0) > 0) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      await a.query("commit");
      expect(await volta).toBeUndefined();
      const historico = await historicoDoPreco(base.api, c, lista, v1);
      expect(historico.map((h) => [h.montante, h.saiu])).toEqual([
        [990, false],
        [null, true],
        [1100, false],
      ]);
    });

    it(`quem espera mais de ${ESPERA_MAXIMA} por um lock recebe prices.retry (P3-C)`, async () => {
      const { c, loja, v1 } = await cenario();
      const { mercado, lista } = await mercadoActivo(c, loja);
      const a = await ligacao(c);
      await a.query(
        "update mercado set nome = 'Portugal (a mudar)' where id = $1",
        [mercado],
      );
      try {
        expect(
          await codigoDoErro(
            definirPreco(base.api, c, QUEM, lista, v1, { montante: 990 }),
          ),
        ).toBe("prices.retry");
      } finally {
        await a.query("rollback");
      }
    }, 20_000);
  });
});
