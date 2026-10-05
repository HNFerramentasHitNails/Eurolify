import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  FAMILIAS_RESTRITAS,
  FAMILIAS_SETORIAIS,
  NATUREZAS_CONSUMIDOR,
  NATUREZAS_DO_TIPO,
  TIPOS_ARTIGO,
} from "../src/base/esquema.js";
import {
  impedimentosDaClassificacao,
  type ArtigoClassificado,
} from "../src/catalogo/classificacao.js";
import {
  alterarArtigo,
  classificarArtigo,
  criarArtigo,
  ErroCatalogo,
  obterArtigo,
  traduzir,
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

// Classificação do artigo (docs/14 §3.10; migração 0006; Q2 do docs/16),
// contra o PostgreSQL 18 verdadeiro e com o eurolify_api.

const NOVO = { nome: "Loja de Teste", lingua: "pt", fuso: "Europe/Lisbon" };
const INICIO = new Date("2026-11-12T10:00:00Z");
const FIM = new Date("2026-11-12T13:00:00Z");

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

describe("impedimentos da classificação (sem base)", () => {
  const bilhete: ArtigoClassificado = {
    tipo: "bilhete",
    familias: ["turismo_alojamento_eventos"],
    natureza_consumidor: "acesso_com_data",
    modo: "presencial",
    prestacao_inicio: INICIO,
    prestacao_fim: FIM,
    local_pais: "PT",
  };

  it("um bilhete completo não tem impedimentos", () => {
    expect(impedimentosDaClassificacao(bilhete)).toEqual([]);
  });

  it("por classificar, ou sem natureza, impede", () => {
    expect(
      impedimentosDaClassificacao({
        ...bilhete,
        familias: ["por_classificar"],
      }),
    ).toContainEqual({ codigo: "classificacao_em_falta" });
    expect(
      impedimentosDaClassificacao({ ...bilhete, natureza_consumidor: null }),
    ).toContainEqual({ codigo: "classificacao_em_falta" });
    expect(
      impedimentosDaClassificacao({ ...bilhete, familias: [] }),
    ).toContainEqual({ codigo: "classificacao_em_falta" });
  });

  it("um bilhete sem data, sem modo ou presencial sem local impede", () => {
    expect(
      impedimentosDaClassificacao({
        ...bilhete,
        prestacao_inicio: null,
        prestacao_fim: null,
      }),
    ).toContainEqual({ codigo: "data_ou_local_em_falta", falta: ["data"] });
    expect(
      impedimentosDaClassificacao({ ...bilhete, modo: null }),
    ).toContainEqual({ codigo: "data_ou_local_em_falta", falta: ["modo"] });
    expect(
      impedimentosDaClassificacao({ ...bilhete, local_pais: null }),
    ).toContainEqual({ codigo: "data_ou_local_em_falta", falta: ["local"] });
  });

  it("um bilhete virtual não precisa de local", () => {
    expect(
      impedimentosDaClassificacao({
        ...bilhete,
        modo: "virtual",
        local_pais: null,
      }),
    ).toEqual([]);
  });

  it("um serviço presencial sem local impede; à distância não precisa", () => {
    const servico: ArtigoClassificado = {
      ...bilhete,
      tipo: "servico",
      familias: ["servicos_gerais_instalacao"],
      natureza_consumidor: "servico_presencial",
      prestacao_inicio: null,
      prestacao_fim: null,
      local_pais: null,
    };
    expect(impedimentosDaClassificacao(servico)).toContainEqual({
      codigo: "data_ou_local_em_falta",
      falta: ["local"],
    });
    expect(
      impedimentosDaClassificacao({
        ...servico,
        natureza_consumidor: "servico_humano_a_distancia",
        modo: "virtual",
      }),
    ).toEqual([]);
  });

  it.each(FAMILIAS_RESTRITAS)("a família restrita %s impede", (familia) => {
    expect(
      impedimentosDaClassificacao({
        ...bilhete,
        familias: ["turismo_alojamento_eventos", familia],
      }),
    ).toContainEqual({ codigo: "familia_restrita", familias: [familia] });
  });

  it("um serviço humano à distância sem modo impede", () => {
    expect(
      impedimentosDaClassificacao({
        ...bilhete,
        tipo: "servico",
        familias: ["educacao_formacao"],
        natureza_consumidor: "servico_humano_a_distancia",
        modo: null,
        prestacao_inicio: null,
        prestacao_fim: null,
        local_pais: null,
      }),
    ).toContainEqual({ codigo: "data_ou_local_em_falta", falta: ["modo"] });
  });

  it("uma família que não existe conta como por classificar", () => {
    expect(
      impedimentosDaClassificacao({ ...bilhete, familias: ["armas"] }),
    ).toContainEqual({ codigo: "classificacao_em_falta" });
  });

  it("a educação é uma família própria e não é restrita (Diogo, 05/10/2026)", () => {
    expect(
      impedimentosDaClassificacao({
        ...bilhete,
        familias: ["educacao_formacao"],
      }),
    ).toEqual([]);
    expect(FAMILIAS_RESTRITAS).not.toContain("educacao_formacao");
    expect(FAMILIAS_RESTRITAS).toContain("saude_profissoes_reguladas");
  });

  it("uma natureza que o tipo não admite impede (registo que não passou pela base)", () => {
    expect(
      impedimentosDaClassificacao({ ...bilhete, natureza_consumidor: "bem" }),
    ).toContainEqual({ codigo: "natureza_incompativel" });
  });
});

describe.skipIf(URL_BASE === undefined)(
  "classificação do artigo na base",
  () => {
    let base: BaseDeTeste;

    beforeAll(async () => {
      base = await criarBaseDeTeste(URL_BASE ?? "");
    }, 60_000);

    afterAll(async () => {
      await base.fechar();
    });

    async function artigo(tipo: (typeof TIPOS_ARTIGO)[number] = "bilhete") {
      const c = await registarComerciante(base.api, NOVO);
      const id = await criarArtigo(base.api, c, { tipo, nome: "Workshop" });
      return { c, id };
    }

    it("um artigo novo nasce por classificar, sem quem nem quando", async () => {
      const { c, id } = await artigo();
      const a = await obterArtigo(base.api, c, id);
      expect(a.familias).toEqual(["por_classificar"]);
      expect(a.natureza_consumidor).toBeNull();
      expect(a.lazer_com_data).toBe(false);
      expect(a.classificado_por).toBeNull();
      expect(a.classificado_em).toBeNull();
      expect(impedimentosDaClassificacao(a)).toContainEqual({
        codigo: "classificacao_em_falta",
      });
    });

    it("classificar guarda tudo, quem e quando, e sobe a versão", async () => {
      const { c, id } = await artigo();
      const v = await classificarArtigo(
        base.api,
        c,
        id,
        1,
        {
          familias: ["turismo_alojamento_eventos"],
          natureza_consumidor: "acesso_com_data",
          modo: "presencial",
          prestacao_inicio: INICIO,
          prestacao_fim: FIM,
          local_pais: "PT",
        },
        "ana",
      );
      expect(v).toBe(2);
      const a = await obterArtigo(base.api, c, id);
      expect(a).toMatchObject({
        familias: ["turismo_alojamento_eventos"],
        natureza_consumidor: "acesso_com_data",
        modo: "presencial",
        local_pais: "PT",
        lazer_com_data: false,
        classificado_por: "ana",
      });
      expect(a.classificado_em).toBeInstanceOf(Date);
      expect(impedimentosDaClassificacao(a)).toEqual([]);
    });

    it("com a versão antiga, recusa", async () => {
      const { c, id } = await artigo();
      await alterarArtigo(base.api, c, id, 1, { nome: "Outro" });
      expect(
        await codigoDoErro(
          classificarArtigo(
            base.api,
            c,
            id,
            1,
            { familias: ["retalho_geral"], natureza_consumidor: null },
            "ana",
          ),
        ),
      ).toBe("catalog.version_conflict");
    });

    it.each([
      ["fisico", "acesso_com_data"],
      ["servico", "bem"],
      ["bilhete", "servico_presencial"],
    ] as const)(
      "o tipo %s não admite a natureza %s",
      async (tipo, natureza) => {
        const { c, id } = await artigo(tipo);
        expect(
          await codigoDoErro(
            classificarArtigo(
              base.api,
              c,
              id,
              1,
              { familias: ["retalho_geral"], natureza_consumidor: natureza },
              "ana",
            ),
          ),
        ).toBe("catalog.nature_incompatible");
      },
    );

    it.each([
      [
        "lazer num serviço",
        "servico",
        {
          familias: ["servicos_gerais_instalacao"],
          natureza_consumidor: "servico_presencial",
          lazer_com_data: true,
        },
      ],
      [
        "por classificar com outra família",
        "bilhete",
        {
          familias: ["por_classificar", "retalho_geral"],
          natureza_consumidor: "acesso_com_data",
        },
      ],
      [
        "família que não existe",
        "bilhete",
        { familias: ["armas"], natureza_consumidor: "acesso_com_data" },
      ],
      [
        "nenhuma família",
        "bilhete",
        { familias: [], natureza_consumidor: "acesso_com_data" },
      ],
      [
        "serviço presencial em modo virtual",
        "servico",
        {
          familias: ["servicos_gerais_instalacao"],
          natureza_consumidor: "servico_presencial",
          modo: "virtual",
        },
      ],
      [
        "lazer sem natureza",
        "fisico",
        {
          familias: ["retalho_geral"],
          natureza_consumidor: null,
          lazer_com_data: true,
        },
      ],
      [
        "modo sem natureza",
        "servico",
        {
          familias: ["retalho_geral"],
          natureza_consumidor: null,
          modo: "virtual",
        },
      ],
      [
        "datas num bem",
        "fisico",
        {
          familias: ["retalho_geral"],
          natureza_consumidor: "bem",
          prestacao_inicio: INICIO,
          prestacao_fim: FIM,
        },
      ],
      [
        "local num acesso virtual",
        "bilhete",
        {
          familias: ["educacao_formacao"],
          natureza_consumidor: "acesso_com_data",
          modo: "virtual",
          local_pais: "PT",
        },
      ],
      [
        "local num serviço à distância",
        "servico",
        {
          familias: ["educacao_formacao"],
          natureza_consumidor: "servico_humano_a_distancia",
          local_pais: "PT",
        },
      ],
      [
        "modo num bem",
        "fisico",
        {
          familias: ["retalho_geral"],
          natureza_consumidor: "bem",
          modo: "presencial",
        },
      ],
      [
        "só o início da prestação",
        "bilhete",
        {
          familias: ["turismo_alojamento_eventos"],
          natureza_consumidor: "acesso_com_data",
          prestacao_inicio: INICIO,
        },
      ],
      [
        "fim antes do início",
        "bilhete",
        {
          familias: ["turismo_alojamento_eventos"],
          natureza_consumidor: "acesso_com_data",
          prestacao_inicio: FIM,
          prestacao_fim: INICIO,
        },
      ],
      [
        "país fora da UE",
        "bilhete",
        {
          familias: ["turismo_alojamento_eventos"],
          natureza_consumidor: "acesso_com_data",
          local_pais: "GB",
        },
      ],
      [
        "território sem país",
        "bilhete",
        {
          familias: ["turismo_alojamento_eventos"],
          natureza_consumidor: "acesso_com_data",
          local_territorio: "PT-20",
        },
      ],
    ] as const)("recusa: %s", async (_n, tipo, classificacao) => {
      const { c, id } = await artigo(tipo);
      expect(
        await codigoDoErro(
          classificarArtigo(
            base.api,
            c,
            id,
            1,
            classificacao as unknown as Parameters<typeof classificarArtigo>[4],
            "ana",
          ),
        ),
      ).toBe("catalog.classification_invalid");
    });

    it("o lazer com data só num acesso com data, e por omissão é não", async () => {
      const { c, id } = await artigo();
      await classificarArtigo(
        base.api,
        c,
        id,
        1,
        {
          familias: ["turismo_alojamento_eventos"],
          natureza_consumidor: "acesso_com_data",
          lazer_com_data: true,
        },
        "ana",
      );
      expect((await obterArtigo(base.api, c, id)).lazer_com_data).toBe(true);
    });

    it("classificar sem quem é recusado", async () => {
      const { c, id } = await artigo();
      expect(
        await codigoDoErro(
          classificarArtigo(
            base.api,
            c,
            id,
            1,
            { familias: ["retalho_geral"], natureza_consumidor: null },
            "  ",
          ),
        ),
      ).toBe("catalog.classified_by_required");
    });

    it("mudar a classificação por SQL, sem dizer quem, é recusado", async () => {
      const { c, id } = await artigo("fisico");
      expect(
        await codigoDoErro(
          comComerciante(base.api, c, (trx) =>
            sql`update artigo set familias = '{retalho_geral}' where id = ${id}`.execute(
              trx,
            ),
          ).catch((erro: unknown) => {
            throw traduzir(erro);
          }),
        ),
      ).toBe("catalog.classified_by_required");
    });

    it("as famílias guardam-se sem repetidos e por ordem", async () => {
      const { c, id } = await artigo("fisico");
      await classificarArtigo(
        base.api,
        c,
        id,
        1,
        {
          familias: [
            "electronica_radio_electrodomesticos",
            "cosmeticos_perfumaria",
            "cosmeticos_perfumaria",
          ],
          natureza_consumidor: "bem",
        },
        "ana",
      );
      expect((await obterArtigo(base.api, c, id)).familias).toEqual([
        "cosmeticos_perfumaria",
        "electronica_radio_electrodomesticos",
      ]);
    });

    it("alterar o nome não mexe em quem classificou nem quando", async () => {
      const { c, id } = await artigo("fisico");
      await classificarArtigo(
        base.api,
        c,
        id,
        1,
        { familias: ["retalho_geral"], natureza_consumidor: "bem" },
        "ana",
      );
      const antes = await obterArtigo(base.api, c, id);
      await alterarArtigo(base.api, c, id, 2, { nome: "Outro" });
      const depois = await obterArtigo(base.api, c, id);
      expect(depois.classificado_por).toBe("ana");
      expect(depois.classificado_em).toEqual(antes.classificado_em);
    });

    /** Corre SQL como o eurolify_api no comerciante `c`, com `quem` posto (ou não). */
    async function comoApi(
      c: string,
      quem: string | null,
      texto: ReturnType<typeof sql>,
    ) {
      return comComerciante(base.api, c, async (trx) => {
        if (quem !== null)
          await sql`select set_config('eurolify.quem', ${quem}, true)`.execute(
            trx,
          );
        await texto.execute(trx);
      }).catch((erro: unknown) => {
        throw traduzir(erro);
      });
    }

    it("quem e quando são da base: o eurolify_api não os escolhe", async () => {
      const { c, id } = await artigo("fisico");
      await comoApi(
        c,
        "ana",
        sql`update artigo set familias = '{retalho_geral}', classificado_por = 'x',
              classificado_em = '2000-01-01' where id = ${id}`,
      );
      const a = await obterArtigo(base.api, c, id);
      expect(a.classificado_por).toBe("ana");
      expect(a.classificado_em?.getUTCFullYear()).toBeGreaterThan(2000);
    });

    it("sem mudar a classificação, quem e quando não mudam", async () => {
      const { c, id } = await artigo("fisico");
      await classificarArtigo(
        base.api,
        c,
        id,
        1,
        { familias: ["retalho_geral"], natureza_consumidor: "bem" },
        "ana",
      );
      const antes = await obterArtigo(base.api, c, id);
      await comoApi(
        c,
        "rui",
        sql`update artigo set classificado_por = 'rui',
              classificado_em = '2000-01-01' where id = ${id}`,
      );
      const depois = await obterArtigo(base.api, c, id);
      expect(depois.classificado_por).toBe("ana");
      expect(depois.classificado_em).toEqual(antes.classificado_em);
    });

    it("uma segunda classificação sem quem é recusada (não fica o quem antigo)", async () => {
      const { c, id } = await artigo("fisico");
      await classificarArtigo(
        base.api,
        c,
        id,
        1,
        { familias: ["retalho_geral"], natureza_consumidor: "bem" },
        "ana",
      );
      expect(
        await codigoDoErro(
          comoApi(
            c,
            null,
            sql`update artigo set familias = '{baterias}' where id = ${id}`,
          ),
        ),
      ).toBe("catalog.classified_by_required");
      expect((await obterArtigo(base.api, c, id)).familias).toEqual([
        "retalho_geral",
      ]);
    });

    it("a mesma classificação não sobe a versão", async () => {
      const { c, id } = await artigo("fisico");
      const dados = {
        familias: ["retalho_geral"],
        natureza_consumidor: "bem",
      } as const;
      const v = await classificarArtigo(base.api, c, id, 1, dados, "ana");
      expect(await classificarArtigo(base.api, c, id, v, dados, "rui")).toBe(v);
      expect((await obterArtigo(base.api, c, id)).classificado_por).toBe("ana");
    });

    it("outro comerciante não classifica o artigo", async () => {
      const { id } = await artigo("fisico");
      const outro = await registarComerciante(base.api, NOVO);
      expect(
        await codigoDoErro(
          classificarArtigo(
            base.api,
            outro,
            id,
            1,
            { familias: ["retalho_geral"], natureza_consumidor: "bem" },
            "ana",
          ),
        ),
      ).toBe("catalog.not_found");
    });

    it("as listas do TypeScript são as da base (C8)", async () => {
      const definicao = async (restricao: string) => {
        const { rows } = await sql<{ definicao: string }>`
        select pg_get_constraintdef(oid) as definicao from pg_constraint
        where conname = ${restricao}`.execute(base.dono);
        return rows[0]?.definicao ?? "";
      };
      const valores = (texto: string) =>
        [...texto.matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1]);
      expect(valores(await definicao("artigo_familias_validas"))).toEqual([
        ...FAMILIAS_SETORIAIS,
        // A regra «por classificar não se junta a outra família».
        "por_classificar",
      ]);
      expect(valores(await definicao("artigo_natureza_valida"))).toEqual([
        ...NATUREZAS_CONSUMIDOR,
      ]);
    });

    it.each(["fisico", "servico", "bilhete"] as const)(
      "a base admite para %s exactamente as naturezas de NATUREZAS_DO_TIPO",
      async (tipo) => {
        const admitidas: string[] = [];
        for (const natureza of NATUREZAS_CONSUMIDOR) {
          const { c, id } = await artigo(tipo);
          const codigo = await codigoDoErro(
            classificarArtigo(
              base.api,
              c,
              id,
              1,
              { familias: ["retalho_geral"], natureza_consumidor: natureza },
              "ana",
            ),
          );
          if (codigo === "sem erro") admitidas.push(natureza);
          else expect(codigo).toBe("catalog.nature_incompatible");
        }
        expect(admitidas).toEqual([...NATUREZAS_DO_TIPO[tipo]]);
      },
    );
  },
);
