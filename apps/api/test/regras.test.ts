import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { criarApp } from "../src/app.js";
import { decidir } from "../src/regras/decidir.js";
import { REGISTO_INICIAL } from "../src/regras/registo.js";
import {
  CODIGOS_UE,
  DOMINIOS_OBRIGATORIOS,
  type PerfilPais,
  type Regra,
  type Registo,
} from "../src/regras/tipos.js";

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

/** Registo de teste: Portugal com o consumidor verificado. */
function registoComPortugal(regras: Regra[], versao = 2): Registo {
  return {
    versao,
    regras,
    paises: REGISTO_INICIAL.paises.map((perfil): PerfilPais =>
      perfil.codigo === "PT"
        ? {
            ...perfil,
            dominios: { ...perfil.dominios, consumidor: VERIFICADO },
          }
        : perfil,
    ),
  };
}

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

  it("com ele, nenhuma combinação dos 27 sai permitida", () => {
    for (const pais of CODIGOS_UE) {
      const decisao = decidir(REGISTO_INICIAL, {
        pais,
        dominios: DOMINIOS_OBRIGATORIOS,
        momento: AGORA,
      });
      expect(decisao.estado).toBe("revisao_necessaria");
      expect(decisao.motivos).toHaveLength(DOMINIOS_OBRIGATORIOS.length);
    }
  });
});

describe("decidir", () => {
  it("país fora dos 27 é recusado (Suíça, Reino Unido, código EL)", () => {
    for (const pais of ["CH", "GB", "EL", "pt", ""]) {
      const decisao = decidir(REGISTO_INICIAL, {
        pais,
        dominios: ["consumidor"],
        momento: AGORA,
      });
      expect(decisao.estado).toBe("recusado");
      expect(decisao.motivos).toEqual([{ codigo: "pais_fora_da_ue", pais }]);
    }
  });

  it("momento inválido é recusado, não tratado como agora", () => {
    const decisao = decidir(REGISTO_INICIAL, {
      pais: "PT",
      dominios: ["consumidor"],
      momento: "ontem",
    });
    expect(decisao.estado).toBe("recusado");
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

  it("uma versão nova do registo não reescreve uma decisão já tomada", () => {
    const v2 = registoComPortugal([regraTeste({ id: "pt-consumidor-1" })], 2);
    const tomada = decidir(v2, {
      pais: "PT",
      dominios: ["consumidor"],
      momento: AGORA,
    });
    const copia = structuredClone(tomada);

    const v3 = registoComPortugal([], 3);
    const nova = decidir(v3, {
      pais: "PT",
      dominios: ["consumidor"],
      momento: AGORA,
    });

    expect(tomada).toEqual(copia);
    expect(tomada.versaoRegisto).toBe(2);
    expect(nova.versaoRegisto).toBe(3);
    expect(nova.estado).toBe("revisao_necessaria");
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
    for (const pais of corpo.paises) {
      expect(pais.territoriosMapeados).toBe(false);
      expect(new Set(Object.values(pais.dominios))).toEqual(
        new Set(["por_verificar"]),
      );
    }
  });
});
