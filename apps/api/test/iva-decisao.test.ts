import { describe, expect, it } from "vitest";
import {
  decidirIva,
  dividirArredondado,
  MONTANTE_MAXIMO,
  type EntradaDecisao,
  type Tabelas,
  type Taxa,
} from "../src/iva/decisao.js";

// A decisão de IVA, ramo a ramo (docs/24 §5; eu-vat-oss-ioss, «Antes de
// dizer está feito»: um teste por ramo da ordem, incluindo a #D4248 e as
// Canárias). Sem base: a função é pura.

const taxa = (
  pais: string,
  regiao: string | null,
  percentagem: number,
  inicio = "2026-10-09",
  categoria = "normal",
): Taxa => ({
  id: `${pais}-${regiao ?? ""}-${categoria}-${inicio}`,
  pais,
  regiao,
  categoria,
  tipo: "taxa",
  percentagem,
  codigo_motivo: null,
  inicio,
  fonte: "teste",
  verificado: false,
});

// As tabelas da migração 0040 (as de produção são as mesmas).
const TABELAS: Tabelas = {
  categorias: [
    { codigo: "normal", estado: "activa" },
    { codigo: "livros", estado: "por_validar" },
  ],
  taxas: [
    taxa("PT", null, 2300),
    taxa("PT", "PT-20", 1600),
    taxa("PT", "PT-30", 2200),
  ],
  territorios: [
    {
      pais: "ES",
      prefixo_cp: "35",
      efeito: "fora_do_iva_ue",
      regiao: null,
      nome: "Canárias",
    },
    {
      pais: "ES",
      prefixo_cp: "38",
      efeito: "fora_do_iva_ue",
      regiao: null,
      nome: "Canárias",
    },
    {
      pais: "ES",
      prefixo_cp: "51",
      efeito: "fora_do_iva_ue",
      regiao: null,
      nome: "Ceuta",
    },
    {
      pais: "PT",
      prefixo_cp: "9",
      efeito: "por_validar",
      regiao: null,
      nome: "Açores e Madeira",
    },
    {
      pais: "FI",
      prefixo_cp: "22",
      efeito: "por_validar",
      regiao: null,
      nome: "Åland",
    },
    {
      pais: "GB",
      prefixo_cp: "BT",
      efeito: "por_validar",
      regiao: null,
      nome: "Irlanda do Norte",
    },
    {
      pais: "MC",
      prefixo_cp: "",
      efeito: "por_validar",
      regiao: null,
      nome: "Mónaco",
    },
  ],
  motivos: [
    { pais: "PT", codigo: "M05", tipo: "exportacao" },
    { pais: "PT", codigo: "M16", tipo: "intracomunitaria" },
    { pais: "PT", codigo: "M07", tipo: "isento_natureza" },
  ],
};

const AGORA = new Date("2026-10-10T12:00:00Z");

const entrada = (mudancas: Partial<EntradaDecisao> = {}): EntradaDecisao => ({
  momento: AGORA,
  comerciante: { pais: "PT", regime: "por_declarar", fuso: "Europe/Lisbon" },
  linha: {
    categoria: "normal",
    natureza: "bem",
    local_prestacao: null,
    montante: 1230,
    moeda: "EUR",
    preco_inclui_iva: true,
  },
  entrega: { pais: "PT", codigo_postal: "1000-001" },
  finalidade: "consumo",
  perfil: null,
  ...mudancas,
});

const empresaFrancesa = (
  mudancas: Partial<NonNullable<EntradaDecisao["perfil"]>> = {},
): NonNullable<EntradaDecisao["perfil"]> => ({
  pais: "FR",
  numero: "40303265045",
  estado_vies: "valido",
  validado_em: new Date("2026-10-10T03:00:00Z"),
  prova_vies: "prova-1",
  isencao: null,
  ...mudancas,
});

describe("a decisão de IVA (a ordem do Bruno)", () => {
  it("nacional: um consumidor em Lisboa, preço com IVA — 12,30 € = 10,00 € + 2,30 €", () => {
    expect(decidirIva(TABELAS, entrada())).toMatchObject({
      resultado: "tributada",
      pais_imposto: "PT",
      regiao: null,
      taxa: 2300,
      base: 1000,
      iva: 230,
      total: 1230,
      regra: "nacional",
      evidencia: { verificado: false, taxa: { verificado: false } },
    });
  });

  it("preço sem IVA: 10,00 € + 23 %; arredondamento ao cêntimo, metade para cima, por linha", () => {
    const sem = (montante: number) =>
      decidirIva(
        TABELAS,
        entrada({
          linha: { ...entrada().linha, montante, preco_inclui_iva: false },
        }),
      );
    expect(sem(1000)).toMatchObject({ base: 1000, iva: 230, total: 1230 });
    // 9,99 € × 23 % = 2,2977 € → 2,30 €.
    expect(sem(999)).toMatchObject({ iva: 230, total: 1229 });
    // 10,00 € com IVA → base 8,13 € (8,1300…), IVA 1,87 €.
    expect(
      decidirIva(
        TABELAS,
        entrada({ linha: { ...entrada().linha, montante: 1000 } }),
      ),
    ).toMatchObject({ base: 813, iva: 187, total: 1000 });
    expect(dividirArredondado(5, 2)).toBe(3);
    expect(dividirArredondado(4, 2)).toBe(2);
  });

  it("a #D4248: a isenção manual vale com entrega em Portugal; o cliente paga sem o IVA (Q1)", () => {
    const d = decidirIva(
      TABELAS,
      entrada({
        perfil: {
          pais: "PT",
          numero: "263631656",
          estado_vies: "nao_aplicavel",
          validado_em: null,
          prova_vies: null,
          isencao: {
            id: "exm-1",
            codigo_motivo: "M05",
            pais: "PT",
            numero: "263631656",
          },
        },
      }),
    );
    expect(d).toMatchObject({
      resultado: "isenta",
      codigo_motivo: "M05",
      regra: "isencao_manual",
      base: 1000,
      iva: 0,
      total: 1000,
      evidencia: {
        isencao: "exm_exm-1",
        isencao_ignorada: false,
        verificado: false,
      },
    });
  });

  it("a isenção de outro NIF não conta (R3); sem código, não se vende isento", () => {
    const perfil = (
      isencao: NonNullable<EntradaDecisao["perfil"]>["isencao"],
    ): NonNullable<EntradaDecisao["perfil"]> => ({
      pais: "PT",
      numero: "263631656",
      estado_vies: "nao_aplicavel",
      validado_em: null,
      prova_vies: null,
      isencao,
    });
    expect(
      decidirIva(
        TABELAS,
        entrada({
          perfil: perfil({
            id: "exm-1",
            codigo_motivo: "M05",
            pais: "PT",
            numero: "513207384",
          }),
        }),
      ),
    ).toMatchObject({
      resultado: "tributada",
      regra: "nacional",
      evidencia: { isencao: null, isencao_ignorada: true },
    });
    expect(
      decidirIva(
        TABELAS,
        entrada({
          perfil: perfil({
            id: "exm-1",
            codigo_motivo: null,
            pais: "PT",
            numero: "263631656",
          }),
        }),
      ),
    ).toMatchObject({ resultado: "bloqueada", motivo: "isencao_sem_codigo" });
    // O mesmo número, de outro país: outra isenção.
    expect(
      decidirIva(
        TABELAS,
        entrada({
          perfil: perfil({
            id: "exm-1",
            codigo_motivo: "M05",
            pais: "ES",
            numero: "263631656",
          }),
        }),
      ),
    ).toMatchObject({ resultado: "tributada", regra: "nacional" });
  });

  it("VIES: empresa francesa válida, que compra como profissional, entrega em França — isenta (M16)", () => {
    expect(
      decidirIva(
        TABELAS,
        entrada({
          entrega: { pais: "FR", codigo_postal: "75001" },
          finalidade: "profissional",
          perfil: empresaFrancesa(),
        }),
      ),
    ).toMatchObject({
      resultado: "isenta",
      codigo_motivo: "M16",
      regra: "vies_intracomunitaria",
      base: 1000,
      total: 1000,
      evidencia: {
        moeda: "EUR",
        vies: { estado: "valido", prova: "vvc_prova-1" },
      },
    });
  });

  it("a entrega em Portugal anula o VIES; ter NIF não faz de alguém profissional; sem VIES válido, uma empresa não compra como empresa (P1-3)", () => {
    const base = {
      entrega: { pais: "FR", codigo_postal: "75001" },
      finalidade: "profissional" as const,
    };
    expect(
      decidirIva(
        TABELAS,
        entrada({
          ...base,
          entrega: { pais: "PT", codigo_postal: "4000-001" },
          perfil: empresaFrancesa(),
        }),
      ),
    ).toMatchObject({ resultado: "tributada", regra: "nacional", taxa: 2300 });
    expect(
      decidirIva(
        TABELAS,
        entrada({ ...base, finalidade: "consumo", perfil: empresaFrancesa() }),
      ),
    ).toMatchObject({ resultado: "bloqueada", motivo: "regime_por_declarar" });
    // 73 h depois da última resposta (V5, C: 72 h).
    expect(
      decidirIva(
        TABELAS,
        entrada({
          ...base,
          perfil: empresaFrancesa({
            validado_em: new Date(AGORA.getTime() - 73 * 3600_000),
          }),
        }),
      ),
    ).toMatchObject({ resultado: "bloqueada", motivo: "b2b_sem_vies" });
    // Uma resposta «do futuro» também não conta (P2-8).
    expect(
      decidirIva(
        TABELAS,
        entrada({
          ...base,
          perfil: empresaFrancesa({
            validado_em: new Date(AGORA.getTime() + 3600_000),
          }),
        }),
      ),
    ).toMatchObject({ resultado: "bloqueada", motivo: "b2b_sem_vies" });
    // Mesmo a 72 h certas, conta (o limite inclui-se).
    expect(
      decidirIva(
        TABELAS,
        entrada({
          ...base,
          perfil: empresaFrancesa({
            validado_em: new Date(AGORA.getTime() - 72 * 3600_000),
          }),
        }),
      ),
    ).toMatchObject({ resultado: "isenta", regra: "vies_intracomunitaria" });
    expect(
      decidirIva(
        TABELAS,
        entrada({
          ...base,
          perfil: empresaFrancesa({ estado_vies: "indisponivel" }),
        }),
      ),
    ).toMatchObject({ resultado: "bloqueada", motivo: "b2b_sem_vies" });
    // Uma empresa portuguesa com VIES válido a receber em França não é
    // intracomunitária (o NIF é do país do comerciante).
    expect(
      decidirIva(
        TABELAS,
        entrada({
          ...base,
          perfil: empresaFrancesa({ pais: "PT", numero: "263631656" }),
        }),
      ),
    ).toMatchObject({ resultado: "bloqueada", motivo: "b2b_sem_vies" });
    // Uma empresa sem perfil, a revender: não compra como empresa.
    expect(
      decidirIva(TABELAS, entrada({ ...base, finalidade: "revenda" })),
    ).toMatchObject({ resultado: "bloqueada", motivo: "b2b_sem_vies" });
  });

  it("exportação: Las Palmas (35xxx) e a Suíça; Palma de Maiorca (07xxx) não é Canárias", () => {
    for (const entrega of [
      { pais: "ES", codigo_postal: "35001" },
      { pais: "ES", codigo_postal: "38 001" },
      { pais: "CH", codigo_postal: "8001" },
    ]) {
      expect(decidirIva(TABELAS, entrada({ entrega }))).toMatchObject({
        resultado: "isenta",
        codigo_motivo: "M05",
        regra: "exportacao",
        total: 1000,
      });
    }
    // Palma de Maiorca é Espanha dentro do IVA da UE: consumidor, regime
    // destino, e não há taxa espanhola carregada — não se vende.
    expect(
      decidirIva(
        TABELAS,
        entrada({
          entrega: { pais: "ES", codigo_postal: "07001" },
          comerciante: { pais: "PT", regime: "destino", fuso: "Europe/Lisbon" },
        }),
      ),
    ).toMatchObject({ resultado: "bloqueada", motivo: "taxa_em_falta" });
  });

  it("territórios por validar: Açores, Madeira (Q3) e Åland não se vendem", () => {
    for (const entrega of [
      { pais: "PT", codigo_postal: "9500-123" },
      { pais: "PT", codigo_postal: "9000-018" },
      { pais: "FI", codigo_postal: "22100" },
    ]) {
      expect(decidirIva(TABELAS, entrada({ entrega }))).toMatchObject({
        resultado: "bloqueada",
        motivo: "territorio_por_validar",
      });
    }
  });

  it("vendas à distância a consumidores: por declarar bloqueia (Q2); origem leva a taxa portuguesa; destino a do país", () => {
    const fr = { entrega: { pais: "FR", codigo_postal: "75001" } };
    expect(decidirIva(TABELAS, entrada(fr))).toMatchObject({
      resultado: "bloqueada",
      motivo: "regime_por_declarar",
    });
    expect(
      decidirIva(
        TABELAS,
        entrada({
          ...fr,
          comerciante: { pais: "PT", regime: "origem", fuso: "Europe/Lisbon" },
        }),
      ),
    ).toMatchObject({
      resultado: "tributada",
      pais_imposto: "PT",
      taxa: 2300,
      regra: "distancia_origem",
    });
    const comFranca: Tabelas = {
      ...TABELAS,
      taxas: [...TABELAS.taxas, taxa("FR", null, 2000)],
    };
    expect(
      decidirIva(
        comFranca,
        entrada({
          ...fr,
          comerciante: { pais: "PT", regime: "destino", fuso: "Europe/Lisbon" },
        }),
      ),
    ).toMatchObject({
      resultado: "tributada",
      pais_imposto: "FR",
      taxa: 2000,
      regra: "distancia_destino",
      base: 1025,
      iva: 205,
      total: 1230,
    });
  });

  it("serviços e eventos: só no país do comerciante (Q5); à distância, electrónico e vale bloqueados; um bem sem entrega também", () => {
    const servico = (
      natureza: EntradaDecisao["linha"]["natureza"],
      local: string | null,
    ) =>
      decidirIva(
        TABELAS,
        entrada({
          linha: { ...entrada().linha, natureza, local_prestacao: local },
          entrega: null,
        }),
      );
    expect(servico("servico_presencial", "PT")).toMatchObject({
      resultado: "tributada",
      regra: "servico_no_lugar",
      taxa: 2300,
    });
    expect(servico("acesso_evento_presencial", "PT")).toMatchObject({
      resultado: "tributada",
    });
    expect(servico("servico_presencial", "ES")).toMatchObject({
      resultado: "bloqueada",
      motivo: "servico_fora_do_pais",
    });
    for (const n of [
      "servico_a_distancia",
      "servico_electronico",
      "vale",
    ] as const) {
      expect(servico(n, null)).toMatchObject({
        resultado: "bloqueada",
        motivo: "natureza_bloqueada",
      });
    }
    expect(decidirIva(TABELAS, entrada({ entrega: null }))).toMatchObject({
      resultado: "bloqueada",
      motivo: "entrega_em_falta",
    });
  });

  it("categoria por validar ou desconhecida: não se vende", () => {
    for (const categoria of ["livros", "inexistente"]) {
      expect(
        decidirIva(
          TABELAS,
          entrada({ linha: { ...entrada().linha, categoria } }),
        ),
      ).toMatchObject({
        resultado: "bloqueada",
        motivo: "categoria_por_validar",
      });
    }
  });

  it("isento por natureza (quando a categoria o for no país do comerciante): o preço não perde IVA que não tinha", () => {
    const tabelas: Tabelas = {
      ...TABELAS,
      categorias: [
        ...TABELAS.categorias,
        { codigo: "formacao", estado: "activa" },
      ],
      taxas: [
        ...TABELAS.taxas,
        {
          ...taxa("PT", null, 0, "2026-10-09", "formacao"),
          tipo: "isenta",
          percentagem: null,
          codigo_motivo: "M07",
        },
      ],
    };
    expect(
      decidirIva(
        tabelas,
        entrada({
          linha: { ...entrada().linha, categoria: "formacao" },
          entrega: { pais: "FR", codigo_postal: "75001" },
        }),
      ),
    ).toMatchObject({
      resultado: "isenta",
      codigo_motivo: "M07",
      regra: "isento_natureza",
      base: 1230,
      total: 1230,
    });
  });

  it("a taxa é a em vigor no dia da operação (R4)", () => {
    const tabelas: Tabelas = {
      ...TABELAS,
      taxas: [...TABELAS.taxas, taxa("PT", null, 2400, "2027-01-01")],
    };
    const em = (momento: string) =>
      decidirIva(tabelas, entrada({ momento: new Date(momento) }));
    expect(em("2026-12-31T23:00:00Z")).toMatchObject({ taxa: 2300 });
    expect(em("2027-01-02T10:00:00Z")).toMatchObject({ taxa: 2400 });
    // Antes da primeira taxa carregada: não há taxa.
    expect(em("2026-01-01T10:00:00Z")).toMatchObject({
      resultado: "bloqueada",
      motivo: "taxa_em_falta",
    });
  });

  it("sem código de motivo para o país do comerciante, não há venda isenta (R6)", () => {
    expect(
      decidirIva(
        { ...TABELAS, motivos: [] },
        entrada({ entrega: { pais: "CH", codigo_postal: "8001" } }),
      ),
    ).toMatchObject({ resultado: "bloqueada", motivo: "motivo_em_falta" });
  });

  it("um país que não existe bloqueia, nunca é «fora da UE»; um comerciante fora da UE também (P1-1)", () => {
    for (const pais of ["XX", "EL", "XI"]) {
      expect(
        decidirIva(TABELAS, entrada({ entrega: { pais, codigo_postal: "1" } })),
      ).toMatchObject({ resultado: "bloqueada", motivo: "pais_invalido" });
    }
    expect(
      decidirIva(
        TABELAS,
        entrada({
          comerciante: { pais: "CH", regime: "origem", fuso: "Europe/Zurich" },
        }),
      ),
    ).toMatchObject({ resultado: "bloqueada", motivo: "pais_invalido" });
  });

  it("territórios: a Irlanda do Norte (BT) e o Mónaco (o país todo) por validar; o resto do Reino Unido é exportação", () => {
    for (const entrega of [
      { pais: "GB", codigo_postal: "BT1 1AA" },
      { pais: "MC", codigo_postal: "98000" },
      { pais: "MC", codigo_postal: null },
    ]) {
      expect(decidirIva(TABELAS, entrada({ entrega }))).toMatchObject({
        resultado: "bloqueada",
        motivo: "territorio_por_validar",
      });
    }
    expect(
      decidirIva(
        TABELAS,
        entrada({ entrega: { pais: "GB", codigo_postal: "SW1A 1AA" } }),
      ),
    ).toMatchObject({ resultado: "isenta", regra: "exportacao" });
  });

  it("onde há territórios especiais, o código postal é obrigatório e tem de ter a forma do país (P1-2)", () => {
    for (const entrega of [
      { pais: "PT", codigo_postal: null },
      { pais: "ES", codigo_postal: " - " },
      { pais: "GB", codigo_postal: null },
    ]) {
      expect(decidirIva(TABELAS, entrada({ entrega }))).toMatchObject({
        resultado: "bloqueada",
        motivo: "codigo_postal_em_falta",
      });
    }
    // «9OOO» com a letra O (Madeira escrita mal) e um símbolo nas Canárias.
    for (const entrega of [
      { pais: "PT", codigo_postal: "9OOO-018" },
      { pais: "ES", codigo_postal: "35.001" },
      { pais: "GB", codigo_postal: "SW1A.1AA" },
    ]) {
      expect(decidirIva(TABELAS, entrada({ entrega }))).toMatchObject({
        resultado: "bloqueada",
        motivo: "codigo_postal_invalido",
      });
    }
    // Num país sem territórios na tabela, o código postal não decide.
    expect(
      decidirIva(
        TABELAS,
        entrada({ entrega: { pais: "CH", codigo_postal: null } }),
      ),
    ).toMatchObject({ resultado: "isenta", regra: "exportacao" });
  });

  it("verificada só com a regra validada e a taxa verificada (P2-1)", () => {
    const verificada: Tabelas = {
      ...TABELAS,
      taxas: [{ ...taxa("PT", null, 2300), verificado: true }],
    };
    expect(decidirIva(verificada, entrada())).toMatchObject({
      evidencia: { verificado: false, taxa: { verificado: true } },
    });
    expect(
      decidirIva(verificada, entrada(), {
        regrasValidadas: new Set(["nacional"]),
      }),
    ).toMatchObject({ evidencia: { verificado: true } });
    expect(
      decidirIva(TABELAS, entrada(), {
        regrasValidadas: new Set(["nacional"]),
      }),
    ).toMatchObject({ evidencia: { verificado: false } });
  });

  it("o dia da taxa conta-se no fuso do comerciante (P2-2); um fuso que não existe bloqueia", () => {
    const tabelas: Tabelas = {
      ...TABELAS,
      taxas: [...TABELAS.taxas, taxa("PT", null, 2400, "2027-07-01")],
    };
    // 23 h 30 UTC de 30/06 são 0 h 30 de 01/07 em Lisboa (hora de Verão).
    const d = decidirIva(
      tabelas,
      entrada({ momento: new Date("2027-06-30T23:30:00Z") }),
    );
    expect(d).toMatchObject({ taxa: 2400, evidencia: { dia: "2027-07-01" } });
    expect(
      decidirIva(
        tabelas,
        entrada({
          momento: new Date("2027-06-30T23:30:00Z"),
          comerciante: { pais: "PT", regime: "origem", fuso: "UTC" },
        }),
      ),
    ).toMatchObject({ taxa: 2300 });
    expect(
      decidirIva(
        TABELAS,
        entrada({
          comerciante: { pais: "PT", regime: "origem", fuso: "Lua/Mar" },
        }),
      ),
    ).toMatchObject({ resultado: "bloqueada", motivo: "fuso_invalido" });
  });

  it("montantes: inteiros, não negativos e até ao limite seguro (P2-3)", () => {
    const com = (montante: number) =>
      decidirIva(TABELAS, entrada({ linha: { ...entrada().linha, montante } }));
    for (const m of [1.5, -1, MONTANTE_MAXIMO + 1, Number.NaN]) {
      expect(com(m)).toMatchObject({
        resultado: "bloqueada",
        motivo: "montante_invalido",
      });
    }
    const d = com(MONTANTE_MAXIMO);
    expect(d).toMatchObject({ resultado: "tributada" });
    if (d.resultado !== "tributada") throw new Error("tributada");
    expect(d.base + d.iva).toBe(MONTANTE_MAXIMO);
    expect(com(0)).toMatchObject({ base: 0, iva: 0, total: 0 });
  });

  it("um serviço presencial a uma empresa de outro país (ou sem perfil) fica por validar (P2-4)", () => {
    const servico = (
      natureza: EntradaDecisao["linha"]["natureza"],
      mudancas: Partial<EntradaDecisao>,
    ) =>
      decidirIva(
        TABELAS,
        entrada({
          linha: { ...entrada().linha, natureza, local_prestacao: "PT" },
          entrega: null,
          ...mudancas,
        }),
      );
    expect(
      servico("servico_presencial", { finalidade: "profissional" }),
    ).toMatchObject({
      resultado: "bloqueada",
      motivo: "servico_b2b_por_validar",
    });
    expect(
      servico("servico_presencial", {
        finalidade: "profissional",
        perfil: empresaFrancesa(),
      }),
    ).toMatchObject({
      resultado: "bloqueada",
      motivo: "servico_b2b_por_validar",
    });
    expect(
      servico("servico_presencial", {
        finalidade: "profissional",
        perfil: empresaFrancesa({ pais: "PT", numero: "263631656" }),
      }),
    ).toMatchObject({ resultado: "tributada", regra: "servico_no_lugar" });
    expect(
      servico("acesso_evento_presencial", { finalidade: "profissional" }),
    ).toMatchObject({ resultado: "tributada", regra: "servico_no_lugar" });
  });

  it("uma taxa sem percentagem não se aplica como 0 % (P3)", () => {
    const tabelas: Tabelas = {
      ...TABELAS,
      taxas: [{ ...taxa("PT", null, 2300), percentagem: null }],
    };
    expect(decidirIva(tabelas, entrada())).toMatchObject({
      resultado: "bloqueada",
      motivo: "taxa_sem_percentagem",
    });
    // Também quando é a taxa de origem de uma isenção num preço com IVA.
    expect(
      decidirIva(
        tabelas,
        entrada({ entrega: { pais: "CH", codigo_postal: "8001" } }),
      ),
    ).toMatchObject({
      resultado: "bloqueada",
      motivo: "taxa_sem_percentagem",
    });
  });
});
