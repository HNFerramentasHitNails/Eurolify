import { describe, expect, it } from "vitest";
import {
  decidirIva,
  dividirArredondado,
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
  comerciante: { pais: "PT", regime: "por_declarar" },
  linha: {
    categoria: "normal",
    natureza: "bem",
    local_prestacao: null,
    montante: 1230,
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
      evidencia: { isencao: "exm-1", verificado: false },
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
    ).toMatchObject({ resultado: "tributada", regra: "nacional" });
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
      evidencia: { vies: { estado: "valido", prova: "prova-1" } },
    });
  });

  it("a entrega em Portugal anula o VIES; ter NIF não faz de alguém profissional; um VIES antigo ou em baixo não isenta", () => {
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
    ).toMatchObject({
      resultado: "tributada",
      regra: "b2b_sem_vies_origem",
      taxa: 2300,
    });
    expect(
      decidirIva(
        TABELAS,
        entrada({
          ...base,
          perfil: empresaFrancesa({ estado_vies: "indisponivel" }),
        }),
      ),
    ).toMatchObject({ resultado: "tributada", regra: "b2b_sem_vies_origem" });
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
    ).toMatchObject({ resultado: "tributada", regra: "b2b_sem_vies_origem" });
    // Uma empresa sem perfil, a revender: paga à taxa de origem.
    expect(
      decidirIva(TABELAS, entrada({ ...base, finalidade: "revenda" })),
    ).toMatchObject({ resultado: "tributada", regra: "b2b_sem_vies_origem" });
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
          comerciante: { pais: "PT", regime: "destino" },
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
        entrada({ ...fr, comerciante: { pais: "PT", regime: "origem" } }),
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
        entrada({ ...fr, comerciante: { pais: "PT", regime: "destino" } }),
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
});
