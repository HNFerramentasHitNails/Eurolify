import { Value } from "typebox/value";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { criarApp } from "../src/app.js";
import { decidir } from "../src/regras/decidir.js";
import { instante } from "../src/regras/instante.js";
import { REGISTO_INICIAL } from "../src/regras/registo.js";
import { RespostaPaises } from "../src/regras/rotas.js";
import {
  CODIGOS_UE,
  DOMINIOS_CONDICIONAIS,
  DOMINIOS_OBRIGATORIOS,
  type PedidoDecisao,
  type PerfilPais,
  type Regra,
  type Registo,
} from "../src/regras/tipos.js";
import { errosDoRegisto } from "../src/regras/validar.js";

// Regras e perfis de TESTE: os URL e os artigos são inventados de propósito e
// nunca entram no registo real (nenhuma taxa nem prazo de verdade aqui).
const VERIFICADO = {
  estado: "verificado",
  verificadoEm: "2026-10-04T00:00:00Z",
  revistoPor: "teste",
} as const;

function regraTeste(parcial: Partial<Regra> & Pick<Regra, "id">): Regra {
  return {
    versao: 1,
    dominio: "consumidor",
    pais: "PT",
    territorios: [],
    estadoLegal: "em_vigor",
    aplicaDesde: "2020-01-01T00:00:00Z",
    aplicaAte: null,
    base: {
      url: "https://exemplo.invalid/teste",
      titulo: "teste",
      artigo: "teste",
    },
    verificadaEm: "2026-10-04T00:00:00Z",
    revistaPor: "teste",
    ...parcial,
  };
}

/**
 * Registo de teste: Portugal com o consumidor verificado; com `territorios`,
 * esses territórios ficam mapeados.
 */
function registoComPortugal(
  regras: Regra[],
  versao = 2,
  territorios: readonly string[] | null = null,
): Registo {
  return {
    versao,
    regras,
    paises: REGISTO_INICIAL.paises.map((perfil): PerfilPais =>
      perfil.codigo === "PT"
        ? {
            ...perfil,
            dominios: { ...perfil.dominios, consumidor: VERIFICADO },
            territorios,
          }
        : perfil,
    ),
  };
}

const TODOS_OS_DOMINIOS = [
  ...DOMINIOS_OBRIGATORIOS,
  ...DOMINIOS_CONDICIONAIS,
] as const;

const AGORA = "2026-10-04T12:00:00Z";

describe("registo de partida", () => {
  it("tem os 27 países da UE, uma vez cada", () => {
    const codigos = REGISTO_INICIAL.paises.map((p) => p.codigo);
    expect(codigos).toHaveLength(27);
    expect(new Set(codigos)).toEqual(new Set(CODIGOS_UE));
  });

  it("a Grécia é GR (ISO), não EL", () => {
    expect(CODIGOS_UE).toContain("GR");
    expect(CODIGOS_UE).not.toContain("EL");
  });

  it("não traz nenhuma regra e tem tudo por verificar", () => {
    expect(REGISTO_INICIAL.regras).toHaveLength(0);
    for (const perfil of REGISTO_INICIAL.paises) {
      expect(perfil.territorios).toBeNull();
      for (const revisao of Object.values(perfil.dominios)) {
        expect(revisao.estado).toBe("por_verificar");
      }
    }
  });

  it("com ele, nenhuma combinação dos 27 sai permitida (11 domínios, e cada um)", () => {
    for (const pais of CODIGOS_UE) {
      const decisao = decidir(REGISTO_INICIAL, {
        pais,
        dominios: TODOS_OS_DOMINIOS,
        momento: AGORA,
      });
      expect(decisao.estado).toBe("revisao_necessaria");
      expect(decisao.motivos).toHaveLength(TODOS_OS_DOMINIOS.length);
      for (const dominio of TODOS_OS_DOMINIOS) {
        expect(
          decidir(REGISTO_INICIAL, {
            pais,
            dominios: [dominio],
            momento: AGORA,
          }).estado,
        ).not.toBe("permitido");
      }
    }
  });

  it("é coerente e está congelado (mudar é uma versão nova)", () => {
    expect(errosDoRegisto(REGISTO_INICIAL)).toEqual([]);
    expect(Object.isFrozen(REGISTO_INICIAL)).toBe(true);
    expect(Object.isFrozen(REGISTO_INICIAL.paises)).toBe(true);
    const portugal = REGISTO_INICIAL.paises.find((p) => p.codigo === "PT");
    expect(portugal && Object.isFrozen(portugal.dominios)).toBe(true);
    expect(() => {
      (REGISTO_INICIAL as { versao: number }).versao = 2;
    }).toThrow(TypeError);
  });
});

describe("decidir", () => {
  it("país fora dos 27 é recusado (Suíça, Reino Unido, código EL)", () => {
    for (const pais of ["CH", "GB", "EL"]) {
      const decisao = decidir(REGISTO_INICIAL, {
        pais,
        dominios: ["consumidor"],
        momento: AGORA,
      });
      expect(decisao.estado).toBe("recusado");
      expect(decisao.motivos).toEqual([{ codigo: "pais_fora_da_ue", pais }]);
    }
  });

  it("código de país mal escrito é recusado com o motivo certo, sem normalizar", () => {
    for (const pais of ["pt", "", "PRT", "P1"]) {
      const decisao = decidir(REGISTO_INICIAL, {
        pais,
        dominios: ["consumidor"],
        momento: AGORA,
      });
      expect(decisao.estado).toBe("recusado");
      expect(decisao.motivos).toEqual([
        { codigo: "codigo_pais_invalido", pais },
      ]);
    }
  });

  it("momento que não é ISO 8601 com fuso é recusado, não interpretado", () => {
    for (const momento of [
      "ontem",
      "1",
      "10/04/2026",
      "2026-10-04",
      "2026-10-04T12:00:00",
      "2026-02-30T00:00:00Z",
      "2026-13-01T00:00:00Z",
      "2026-10-04T24:00:00Z",
    ]) {
      const decisao = decidir(REGISTO_INICIAL, {
        pais: "PT",
        dominios: ["consumidor"],
        momento,
      });
      expect(decisao.motivos).toEqual([
        { codigo: "momento_invalido", momento },
      ]);
      expect(decisao.estado).toBe("recusado");
    }
  });

  it("lista de domínios vazia é recusada, nunca permitida (revisão do #37, P0-1)", () => {
    const vazio = {
      pais: "PT",
      dominios: [],
      momento: AGORA,
    } as unknown as PedidoDecisao;
    for (const registo of [
      REGISTO_INICIAL,
      registoComPortugal([regraTeste({ id: "pt-consumidor-1" })]),
    ]) {
      expect(decidir(registo, vazio)).toEqual({
        estado: "recusado",
        regrasAplicadas: [],
        versaoRegisto: registo.versao,
        motivos: [{ codigo: "sem_dominios" }],
      });
    }
  });

  it("domínio desconhecido vindo de fora é recusado, não rebenta", () => {
    const pedido = {
      pais: "PT",
      dominios: ["inexistente"],
      momento: AGORA,
    } as unknown as PedidoDecisao;
    expect(decidir(REGISTO_INICIAL, pedido)).toMatchObject({
      estado: "recusado",
      motivos: [{ codigo: "dominio_desconhecido", dominio: "inexistente" }],
    });
  });

  it("chaves do protótipo não são domínios; sem lista de domínios é recusado (revisão do #40, P2-2)", () => {
    for (const dominio of ["constructor", "__proto__", "toString"]) {
      const pedido = {
        pais: "PT",
        dominios: [dominio],
        momento: AGORA,
      } as unknown as PedidoDecisao;
      expect(decidir(REGISTO_INICIAL, pedido)).toMatchObject({
        estado: "recusado",
        motivos: [{ codigo: "dominio_desconhecido", dominio }],
      });
    }
    for (const dominios of [
      null,
      undefined,
      "consumidor",
      { 0: "consumidor" },
    ]) {
      const pedido = {
        pais: "PT",
        dominios,
        momento: AGORA,
      } as unknown as PedidoDecisao;
      expect(decidir(REGISTO_INICIAL, pedido)).toMatchObject({
        estado: "recusado",
        motivos: [{ codigo: "sem_dominios" }],
      });
    }
  });

  it("um estado de revisão desconhecido não conta como verificado, mesmo com regra (revisão do #40, P1-1)", () => {
    const base = registoComPortugal([
      regraTeste({ id: "pt-consumidor-1" }),
      regraTeste({ id: "pt-iva-1", dominio: "iva" }),
    ]);
    const registo = {
      ...base,
      paises: base.paises.map((perfil) =>
        perfil.codigo === "PT"
          ? {
              ...perfil,
              dominios: { ...perfil.dominios, iva: { estado: "verificadoo" } },
            }
          : perfil,
      ),
    } as unknown as Registo;
    const decisao = decidir(registo, {
      pais: "PT",
      dominios: ["consumidor", "iva"],
      momento: AGORA,
    });
    expect(decisao.estado).toBe("revisao_necessaria");
    expect(decisao.motivos).toEqual([
      { codigo: "dominio_por_verificar", dominio: "iva" },
    ]);
    expect(decisao.regrasAplicadas).toEqual(["pt-consumidor-1@1"]);
    expect(errosDoRegisto(registo)).toContain(
      "PT/iva: estado de revisão desconhecido «verificadoo»",
    );
  });

  it("um estado de revisão desconhecido sem regra é o único erro listado (revisão do #45)", () => {
    const registo = {
      ...REGISTO_INICIAL,
      paises: REGISTO_INICIAL.paises.map((perfil) =>
        perfil.codigo === "PT"
          ? {
              ...perfil,
              dominios: { ...perfil.dominios, iva: { estado: "verificadoo" } },
            }
          : perfil,
      ),
    } as unknown as Registo;
    expect(errosDoRegisto(registo)).toEqual([
      "PT/iva: estado de revisão desconhecido «verificadoo»",
    ]);
  });

  it("um estado legal desconhecido não conta e é erro do registo (revisão do #45, P1-1)", () => {
    for (const estadoLegal of ["Proposta", "propostaa", "draft", undefined]) {
      const regra = {
        ...regraTeste({ id: "r" }),
        estadoLegal,
      } as unknown as Regra;
      const registo = registoComPortugal([regra]);
      expect(
        decidir(registo, {
          pais: "PT",
          dominios: ["consumidor"],
          momento: AGORA,
        }),
      ).toMatchObject({
        estado: "revisao_necessaria",
        regrasAplicadas: [],
        motivos: [{ codigo: "sem_regra_em_vigor", dominio: "consumidor" }],
      });
      expect(errosDoRegisto(registo)).toEqual([
        `r@1: estado legal desconhecido «${String(estadoLegal)}»`,
      ]);
    }
    // «revogado» sem data de fim também não conta para sempre.
    const revogado = registoComPortugal([
      {
        ...regraTeste({ id: "r" }),
        estadoLegal: "revogado",
      } as unknown as Regra,
    ]);
    expect(
      decidir(revogado, {
        pais: "PT",
        dominios: ["consumidor"],
        momento: AGORA,
      }).estado,
    ).toBe("revisao_necessaria");
  });

  it("um domínio a mais no perfil não passa a valer em decidir (revisão do #45, P2-1)", () => {
    const base = registoComPortugal([
      { ...regraTeste({ id: "f" }), dominio: "foo" } as unknown as Regra,
    ]);
    const registo = {
      ...base,
      paises: base.paises.map((perfil) =>
        perfil.codigo === "PT"
          ? { ...perfil, dominios: { ...perfil.dominios, foo: VERIFICADO } }
          : perfil,
      ),
    } as unknown as Registo;
    const pedido = {
      pais: "PT",
      dominios: ["foo"],
      momento: AGORA,
    } as unknown as PedidoDecisao;
    expect(decidir(registo, pedido)).toMatchObject({
      estado: "recusado",
      motivos: [{ codigo: "dominio_desconhecido", dominio: "foo" }],
    });
  });

  it("territórios do perfil que não são lista: não mapeiam e são erro (revisão do #45, segunda volta, P1-1)", () => {
    for (const territorios of ["PT-30", {}, 5, true]) {
      const registo = registoComPortugal(
        [regraTeste({ id: "r", territorios: ["PT-3"] })],
        2,
        territorios as unknown as readonly string[],
      );
      expect(
        decidir(registo, {
          pais: "PT",
          territorio: "PT-3",
          dominios: ["consumidor"],
          momento: AGORA,
        }),
      ).toMatchObject({
        estado: "revisao_necessaria",
        regrasAplicadas: [],
        motivos: [{ codigo: "territorio_nao_mapeado", territorio: "PT-3" }],
      });
      expect(errosDoRegisto(registo)).toEqual([
        "PT: «territorios» tem de ser uma lista ou null",
        "r@1: território PT-3 não mapeado em PT",
      ]);
    }
  });

  it("revisões e territórios com forma errada não contam (revisão do #45, P2-2)", () => {
    const comNull = registoComPortugal([regraTeste({ id: "r" })]);
    const registo = {
      ...comNull,
      paises: comNull.paises.map((perfil) =>
        perfil.codigo === "PT"
          ? { ...perfil, dominios: { ...perfil.dominios, iva: null } }
          : perfil,
      ),
    } as unknown as Registo;
    expect(
      decidir(registo, { pais: "PT", dominios: ["iva"], momento: AGORA }),
    ).toMatchObject({
      estado: "revisao_necessaria",
      motivos: [{ codigo: "dominio_por_verificar", dominio: "iva" }],
    });
    const territorioTexto = registoComPortugal([
      { ...regraTeste({ id: "r" }), territorios: "" } as unknown as Regra,
    ]);
    expect(
      decidir(territorioTexto, {
        pais: "PT",
        dominios: ["consumidor"],
        momento: AGORA,
      }).estado,
    ).toBe("revisao_necessaria");
  });

  it("domínio verificado com regra em vigor sai permitido, com a regra e a versão", () => {
    const registo = registoComPortugal([regraTeste({ id: "pt-consumidor-1" })]);
    const decisao = decidir(registo, {
      pais: "PT",
      dominios: ["consumidor"],
      momento: AGORA,
    });
    expect(decisao).toEqual({
      estado: "permitido",
      regrasAplicadas: ["pt-consumidor-1@1"],
      versaoRegisto: 2,
      motivos: [],
    });
  });

  it("domínio verificado sem regra em vigor pede revisão", () => {
    const decisao = decidir(registoComPortugal([]), {
      pais: "PT",
      dominios: ["consumidor"],
      momento: AGORA,
    });
    expect(decisao.estado).toBe("revisao_necessaria");
    expect(decisao.motivos).toEqual([
      { codigo: "sem_regra_em_vigor", dominio: "consumidor" },
    ]);
  });

  it("uma proposta nunca decide, mesmo com data passada", () => {
    const registo = registoComPortugal([
      regraTeste({ id: "pt-proposta", estadoLegal: "proposta" }),
    ]);
    const decisao = decidir(registo, {
      pais: "PT",
      dominios: ["consumidor"],
      momento: AGORA,
    });
    expect(decisao.estado).toBe("revisao_necessaria");
  });

  it("uma regra adoptada só conta a partir da data de aplicação", () => {
    const registo = registoComPortugal([
      regraTeste({
        id: "pt-futura",
        estadoLegal: "adoptada_futura",
        aplicaDesde: "2027-01-01T00:00:00Z",
      }),
    ]);
    const antes = decidir(registo, {
      pais: "PT",
      dominios: ["consumidor"],
      momento: "2026-12-31T23:59:59Z",
    });
    const depois = decidir(registo, {
      pais: "PT",
      dominios: ["consumidor"],
      momento: "2027-01-01T00:00:00Z",
    });
    expect(antes.estado).toBe("revisao_necessaria");
    expect(depois.estado).toBe("permitido");
  });

  it("uma regra revogada deixa de valer na data de fim, não antes", () => {
    const registo = registoComPortugal([
      regraTeste({
        id: "pt-revogada",
        estadoLegal: "revogada",
        aplicaAte: "2025-07-20T00:00:00Z",
      }),
    ]);
    const vespera = decidir(registo, {
      pais: "PT",
      dominios: ["consumidor"],
      momento: "2025-07-19T23:59:59Z",
    });
    const dia = decidir(registo, {
      pais: "PT",
      dominios: ["consumidor"],
      momento: "2025-07-20T00:00:00Z",
    });
    expect(vespera.estado).toBe("permitido");
    expect(dia.estado).toBe("revisao_necessaria");
  });

  it("revogada sem data de fim não conta", () => {
    const registo = registoComPortugal([
      regraTeste({ id: "pt-revogada-sem-data", estadoLegal: "revogada" }),
    ]);
    const decisao = decidir(registo, {
      pais: "PT",
      dominios: ["consumidor"],
      momento: AGORA,
    });
    expect(decisao.estado).toBe("revisao_necessaria");
  });

  it("um território não mapeado não herda a regra do continente", () => {
    const registo = registoComPortugal([regraTeste({ id: "pt-continente" })]);
    const decisao = decidir(registo, {
      pais: "PT",
      territorio: "PT-20",
      dominios: ["consumidor"],
      momento: AGORA,
    });
    expect(decisao.estado).toBe("revisao_necessaria");
    expect(decisao.motivos).toContainEqual({
      codigo: "territorio_nao_mapeado",
      territorio: "PT-20",
    });
    expect(decisao.regrasAplicadas).toEqual([]);
  });

  it("território mapeado com regra desse território sai permitido", () => {
    const registo = registoComPortugal(
      [regraTeste({ id: "pt-20-consumidor", territorios: ["PT-20"] })],
      2,
      ["PT-20"],
    );
    expect(errosDoRegisto(registo)).toEqual([]);
    const decisao = decidir(registo, {
      pais: "PT",
      territorio: "PT-20",
      dominios: ["consumidor"],
      momento: AGORA,
    });
    expect(decisao.estado).toBe("permitido");
    expect(decisao.regrasAplicadas).toEqual(["pt-20-consumidor@1"]);
  });

  it("território mapeado só com a regra do continente pede revisão (não herda)", () => {
    const registo = registoComPortugal(
      [regraTeste({ id: "pt-continente" })],
      2,
      ["PT-20"],
    );
    const decisao = decidir(registo, {
      pais: "PT",
      territorio: "PT-20",
      dominios: ["consumidor"],
      momento: AGORA,
    });
    expect(decisao.motivos).toEqual([
      { codigo: "sem_regra_em_vigor", dominio: "consumidor" },
    ]);
  });

  it("só domínios «não aplicáveis» não chegam para permitir", () => {
    const registo: Registo = {
      ...REGISTO_INICIAL,
      paises: REGISTO_INICIAL.paises.map((perfil) =>
        perfil.codigo === "PT"
          ? {
              ...perfil,
              dominios: {
                ...perfil.dominios,
                agencia_comercial: {
                  estado: "nao_aplicavel",
                  justificacao: "sem agentes (teste)",
                  prova: "teste",
                  revistoPor: "teste",
                },
              },
            }
          : perfil,
      ),
    };
    const decisao = decidir(registo, {
      pais: "PT",
      dominios: ["agencia_comercial"],
      momento: AGORA,
    });
    expect(decisao.estado).toBe("revisao_necessaria");
    expect(decisao.motivos).toEqual([{ codigo: "sem_regra_aplicada" }]);
  });

  it("uma regra com data sem fuso não conta (não depende do fuso do servidor)", () => {
    const registo = registoComPortugal([
      regraTeste({ id: "pt-sem-fuso", aplicaDesde: "2020-01-01T00:00:00" }),
    ]);
    expect(
      decidir(registo, { pais: "PT", dominios: ["consumidor"], momento: AGORA })
        .estado,
    ).toBe("revisao_necessaria");
    expect(errosDoRegisto(registo)).toContain(
      "pt-sem-fuso@1: aplicaDesde inválido «2020-01-01T00:00:00»",
    );
  });

  it("um domínio aprovado não aprova os outros", () => {
    const registo = registoComPortugal([regraTeste({ id: "pt-consumidor-1" })]);
    const decisao = decidir(registo, {
      pais: "PT",
      dominios: ["consumidor", "iva"],
      momento: AGORA,
    });
    expect(decisao.estado).toBe("revisao_necessaria");
    expect(decisao.motivos).toEqual([
      { codigo: "dominio_por_verificar", dominio: "iva" },
    ]);
  });

  it("o bloqueio de um país não toca noutro", () => {
    const registo = registoComPortugal([regraTeste({ id: "pt-consumidor-1" })]);
    expect(
      decidir(registo, { pais: "FR", dominios: ["consumidor"], momento: AGORA })
        .estado,
    ).toBe("revisao_necessaria");
    expect(
      decidir(registo, { pais: "PT", dominios: ["consumidor"], momento: AGORA })
        .estado,
    ).toBe("permitido");
  });

  it("«não aplicável» com justificação não bloqueia", () => {
    const base = registoComPortugal([regraTeste({ id: "pt-consumidor-1" })]);
    const registo: Registo = {
      ...base,
      paises: base.paises.map((perfil) =>
        perfil.codigo === "PT"
          ? {
              ...perfil,
              dominios: {
                ...perfil.dominios,
                agencia_comercial: {
                  estado: "nao_aplicavel",
                  justificacao: "sem agentes (teste)",
                  prova: "teste",
                  revistoPor: "teste",
                },
              },
            }
          : perfil,
      ),
    };
    const decisao = decidir(registo, {
      pais: "PT",
      dominios: ["consumidor", "agencia_comercial"],
      momento: AGORA,
    });
    expect(decisao.estado).toBe("permitido");
  });

  it("cada decisão diz a versão do registo que a tomou", () => {
    const pedido = {
      pais: "PT",
      dominios: ["consumidor"],
      momento: AGORA,
    } as const;
    const v2 = decidir(
      registoComPortugal([regraTeste({ id: "pt-consumidor-1" })], 2),
      pedido,
    );
    const v3 = decidir(registoComPortugal([], 3), pedido);
    expect([v2.versaoRegisto, v2.estado]).toEqual([2, "permitido"]);
    expect([v3.versaoRegisto, v3.estado]).toEqual([3, "revisao_necessaria"]);
  });
});

describe("instante", () => {
  it("lê ISO 8601 com fuso e o mesmo instante com fusos diferentes", () => {
    expect(instante("2026-10-04T12:00:00Z")).toBe(Date.UTC(2026, 9, 4, 12));
    expect(instante("2026-10-04T14:00:00+02:00")).toBe(
      Date.UTC(2026, 9, 4, 12),
    );
    expect(instante("2026-10-05T02:00:00+14:00")).toBe(
      Date.UTC(2026, 9, 4, 12),
    );
    expect(instante("2026-10-04T00:00:00-12:00")).toBe(
      Date.UTC(2026, 9, 4, 12),
    );
    expect(instante("2024-02-29T00:00:00.500Z")).toBe(
      Date.UTC(2024, 1, 29, 0, 0, 0, 500),
    );
  });

  it("recusa o resto: fuso fora de alcance, segundo 60, fracção longa, bissexto falso", () => {
    for (const texto of [
      "",
      "2025-02-29T00:00:00Z",
      "2100-02-29T00:00:00Z",
      "2026-10-04T12:00Z",
      " 2026-10-04T12:00:00Z",
      "2026-10-04T12:00:00+24:00",
      "2026-10-04T12:00:00+00:60",
      "2026-10-04T12:00:00+0200",
      "2026-10-04T23:59:60Z",
      "2026-10-04T12:00:00.1234Z",
      "2026-10-04T12:00:00.Z",
      "2026-10-04t12:00:00z",
      "2026-10-04T12:00:00-00:00",
    ]) {
      expect(instante(texto)).toBeNull();
    }
  });
});

describe("instante sem coerção", () => {
  it("o que não é texto não é instante (revisão do #45, segunda volta, P2-2)", () => {
    for (const valor of [["2026-10-04T12:00:00Z"], 0, null, undefined, {}]) {
      expect(instante(valor as never)).toBeNull();
    }
    const registo = registoComPortugal([
      {
        ...regraTeste({ id: "r" }),
        aplicaDesde: ["2020-01-01T00:00:00Z"],
      } as unknown as Regra,
    ]);
    expect(
      decidir(registo, { pais: "PT", dominios: ["consumidor"], momento: AGORA })
        .estado,
    ).toBe("revisao_necessaria");
    expect(errosDoRegisto(registo)).toEqual([
      "r@1: aplicaDesde inválido «2020-01-01T00:00:00Z»",
    ]);
  });
});

describe("validar o registo", () => {
  it("lista todos os problemas de um registo incoerente", () => {
    const base = registoComPortugal([
      regraTeste({ id: "a", aplicaDesde: "lixo" }),
      regraTeste({
        id: "b",
        aplicaDesde: "2026-01-01T00:00:00Z",
        aplicaAte: "2025-01-01T00:00:00Z",
      }),
      regraTeste({ id: "c", estadoLegal: "revogada" }),
      regraTeste({ id: "d" }),
      regraTeste({ id: "d" }),
      regraTeste({ id: "e", versao: 1 }),
      regraTeste({ id: "e", versao: 2 }),
      regraTeste({ id: "f", dominio: "iva" }),
      regraTeste({ id: "g", territorios: ["PT-20"] }),
    ]);
    const erros = errosDoRegisto(base);
    expect(erros).toEqual(
      expect.arrayContaining([
        "a@1: aplicaDesde inválido «lixo»",
        "b@1: aplicaAte não é depois de aplicaDesde",
        "c@1: revogada sem aplicaAte",
        "d@1: repetida",
        "e: as versões 1 e 2 valem ao mesmo tempo",
        "f@1: o domínio iva de PT não está verificado",
        "g@1: território PT-20 não mapeado em PT",
      ]),
    );
  });

  it("versões da mesma regra em sequência são coerentes", () => {
    const registo = registoComPortugal([
      regraTeste({ id: "e", versao: 1, aplicaAte: "2026-01-01T00:00:00Z" }),
      regraTeste({ id: "e", versao: 2, aplicaDesde: "2026-01-01T00:00:00Z" }),
    ]);
    expect(errosDoRegisto(registo)).toEqual([]);
  });

  it("uma proposta ao lado da versão em vigor não é sobreposição (revisão do #40, P2-3)", () => {
    const registo = registoComPortugal([
      regraTeste({ id: "e", versao: 1 }),
      regraTeste({
        id: "e",
        versao: 2,
        estadoLegal: "proposta",
        aplicaDesde: "2027-01-01T00:00:00Z",
      }),
    ]);
    expect(errosDoRegisto(registo)).toEqual([]);
    // Mas uma adoptada sem a versão anterior ter fim, sim: a partir de 2027
    // contariam as duas.
    const sobreposto = registoComPortugal([
      regraTeste({ id: "e", versao: 1 }),
      regraTeste({
        id: "e",
        versao: 2,
        estadoLegal: "adoptada_futura",
        aplicaDesde: "2027-01-01T00:00:00Z",
      }),
    ]);
    expect(errosDoRegisto(sobreposto)).toEqual([
      "e: as versões 1 e 2 valem ao mesmo tempo",
    ]);
  });

  it("campos de prova vazios e versão inválida são erro (revisão do #40, P2-5)", () => {
    const registo = registoComPortugal([
      regraTeste({ id: "a", base: { url: "", titulo: "t", artigo: "t" } }),
      regraTeste({ id: "b", revistaPor: " " }),
      regraTeste({ id: "", versao: 0 }),
      regraTeste({ id: "d", versao: 1.5 }),
    ]);
    expect(errosDoRegisto(registo)).toEqual([
      "a@1: fonte incompleta (url, título e artigo)",
      "b@1: sem quem reviu",
      "@0: sem id",
      "@0: versão inválida «0»",
      "d@1.5: versão inválida «1.5»",
    ]);
    const semRevisor = {
      ...REGISTO_INICIAL,
      paises: REGISTO_INICIAL.paises.map((perfil) =>
        perfil.codigo === "PT"
          ? {
              ...perfil,
              dominios: {
                ...perfil.dominios,
                consumidor: { ...VERIFICADO, revistoPor: "" },
              },
            }
          : perfil,
      ),
    };
    expect(errosDoRegisto(semRevisor)).toEqual([
      "PT/consumidor: «verificado» sem quem reviu",
    ]);
  });

  it("domínio desconhecido numa regra e listas em falta ficam listados, não rebentam (revisão do #40, P2-1)", () => {
    const registo = registoComPortugal([
      regraTeste({ id: "x", dominio: "inexistente" as Regra["dominio"] }),
    ]);
    expect(errosDoRegisto(registo)).toEqual([
      "x@1: domínio desconhecido inexistente",
    ]);
    for (const campo of ["paises", "regras"] as const) {
      const partido = { ...REGISTO_INICIAL, [campo]: null };
      expect(errosDoRegisto(partido)).toEqual([
        "«paises» e «regras» têm de ser listas",
      ]);
    }
  });

  it("null e formas erradas vindos de fora ficam listados, não rebentam (revisão do #45, P2-2 e P2-3)", () => {
    const base = registoComPortugal([
      { ...regraTeste({ id: "a" }), base: null } as unknown as Regra,
      {
        ...regraTeste({ id: "b" }),
        territorios: undefined,
      } as unknown as Regra,
      { ...regraTeste({ id: "c" }), territorios: "" } as unknown as Regra,
    ]);
    const registo = {
      ...base,
      paises: base.paises.map((perfil) =>
        perfil.codigo === "PT"
          ? { ...perfil, dominios: { ...perfil.dominios, iva: null } }
          : perfil.codigo === "ES"
            ? { ...perfil, dominios: null }
            : perfil,
      ),
    } as unknown as Registo;
    expect(errosDoRegisto(registo)).toEqual([
      "PT/iva: revisão em falta",
      "ES: «dominios» tem de ser um objecto",
      "a@1: fonte incompleta (url, título e artigo)",
      "b@1: «territorios» tem de ser uma lista",
      "c@1: «territorios» tem de ser uma lista",
    ]);
  });

  it("a mesma id em dois domínios ou dois países é erro, propostas incluídas (revisão do #45, P2-4)", () => {
    const base = registoComPortugal([
      regraTeste({ id: "r", versao: 1, aplicaAte: "2026-01-01T00:00:00Z" }),
      regraTeste({
        id: "r",
        versao: 2,
        dominio: "iva",
        aplicaDesde: "2026-01-01T00:00:00Z",
      }),
      regraTeste({ id: "s", versao: 1 }),
      regraTeste({
        id: "s",
        versao: 2,
        pais: "ES",
        estadoLegal: "proposta",
        aplicaDesde: "2027-01-01T00:00:00Z",
      }),
    ]);
    const registo: Registo = {
      ...base,
      paises: base.paises.map((perfil) =>
        perfil.codigo === "PT" || perfil.codigo === "ES"
          ? {
              ...perfil,
              dominios: {
                ...perfil.dominios,
                consumidor: VERIFICADO,
                iva: VERIFICADO,
              },
            }
          : perfil,
      ),
    };
    expect(errosDoRegisto(registo)).toEqual([
      "r: a mesma id em PT/consumidor e PT/iva",
      "s: a mesma id em PT/consumidor e ES/consumidor",
    ]);
  });

  it("um país em falta ou a mais é erro", () => {
    const semPortugal: Registo = {
      ...REGISTO_INICIAL,
      paises: REGISTO_INICIAL.paises.filter((p) => p.codigo !== "PT"),
    };
    expect(errosDoRegisto(semPortugal)).toContain("país PT aparece 0 vezes");
  });

  it("a aplicação não arranca com um registo incoerente", () => {
    const invalido = registoComPortugal([
      regraTeste({ id: "c", estadoLegal: "revogada" }),
    ]);
    expect(() => criarApp({}, invalido)).toThrow(/revogada sem aplicaAte/);
  });
});

describe("GET /paises com um domínio verificado", () => {
  it("mostra o estado, mas não quem reviu nem quando", async () => {
    const app = criarApp(
      {},
      registoComPortugal([regraTeste({ id: "pt-consumidor-1" })]),
    );
    try {
      const resposta = await app.inject({ method: "GET", url: "/paises" });
      expect(resposta.statusCode).toBe(200);
      const corpo = resposta.json<{
        paises: {
          codigo: string;
          nome: string;
          dominios: Record<string, string>;
        }[];
      }>();
      const portugal = corpo.paises.find((p) => p.codigo === "PT");
      expect(portugal?.nome).toBe("Portugal");
      expect(portugal?.dominios["consumidor"]).toBe("verificado");
      expect(resposta.body).not.toContain("revistoPor");
      expect(resposta.body).not.toContain("verificadoEm");
      expect(resposta.body).not.toContain("teste");
    } finally {
      await app.close();
    }
  });
});

describe("GET /paises", () => {
  let app: ReturnType<typeof criarApp>;

  beforeEach(() => {
    app = criarApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it("devolve os 27, todos por verificar, sem territórios mapeados", async () => {
    const resposta = await app.inject({ method: "GET", url: "/paises" });
    expect(resposta.statusCode).toBe(200);

    const corpo = resposta.json<{
      versaoRegisto: number;
      paises: {
        codigo: string;
        dominios: Record<string, string>;
        territoriosMapeados: boolean;
      }[];
    }>();
    expect(corpo.versaoRegisto).toBe(1);
    expect(corpo.paises).toHaveLength(27);
    // O serializador não valida o esquema; prova-se aqui que o corpo o cumpre.
    expect(Value.Check(RespostaPaises, corpo)).toBe(true);
    for (const pais of corpo.paises) {
      expect(Object.keys(pais.dominios)).toHaveLength(11);
      expect(pais.territoriosMapeados).toBe(false);
      expect(new Set(Object.values(pais.dominios))).toEqual(
        new Set(["por_verificar"]),
      );
    }
  });
});
