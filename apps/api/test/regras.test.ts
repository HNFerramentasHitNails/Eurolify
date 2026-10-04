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
import {
  assegurarRegistoValido,
  errosDoRegisto,
} from "../src/regras/validar.js";

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

/** Um Proxy já revogado: qualquer operação sobre ele lança. */
function proxyRevogado(): object {
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  return proxy;
}

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

  it("um momento ou um território que não é texto aparece no motivo como texto (revisão do #50, P2-C)", () => {
    expect(
      decidir(REGISTO_INICIAL, {
        pais: "PT",
        dominios: ["consumidor"],
        momento: Symbol("m"),
      } as unknown as PedidoDecisao).motivos,
    ).toEqual([{ codigo: "momento_invalido", momento: "Symbol(m)" }]);
    expect(
      decidir(REGISTO_INICIAL, {
        pais: "PT",
        dominios: ["consumidor"],
        momento: AGORA,
        territorio: Symbol("t"),
      } as unknown as PedidoDecisao).motivos,
    ).toContainEqual({
      codigo: "territorio_nao_mapeado",
      territorio: "Symbol(t)",
    });
    // Também null e um objecto (revisão do #50, P2-2 da nona volta).
    for (const [mau, mostrado] of [
      [null, "null"],
      [{}, "(objecto)"],
    ] as const) {
      expect(
        decidir(REGISTO_INICIAL, {
          pais: "PT",
          dominios: ["consumidor"],
          momento: mau,
        } as unknown as PedidoDecisao).motivos,
      ).toEqual([{ codigo: "momento_invalido", momento: mostrado }]);
      expect(
        decidir(REGISTO_INICIAL, {
          pais: "PT",
          dominios: ["consumidor"],
          momento: AGORA,
          territorio: mau,
        } as unknown as PedidoDecisao).motivos,
      ).toContainEqual({
        codigo: "territorio_nao_mapeado",
        territorio: mostrado,
      });
    }
  });

  it("um Proxy revogado nas listas e objectos do pedido e do registo fica listado ou recusado (revisão do #50, P2-1 da nona volta)", () => {
    expect(
      decidir(REGISTO_INICIAL, {
        pais: "PT",
        dominios: proxyRevogado(),
        momento: AGORA,
      } as unknown as PedidoDecisao).motivos,
    ).toEqual([{ codigo: "sem_dominios" }]);

    const comPortugal = (alterado: object, regras: unknown[] = []) =>
      ({
        ...REGISTO_INICIAL,
        regras,
        paises: REGISTO_INICIAL.paises.map((perfil) =>
          perfil.codigo === "PT" ? { ...perfil, ...alterado } : perfil,
        ),
      }) as unknown as Registo;
    const portugal = REGISTO_INICIAL.paises.find((p) => p.codigo === "PT");
    const casos: [string, Registo, string[]][] = [
      [
        "«paises» do registo",
        { ...REGISTO_INICIAL, paises: proxyRevogado() } as unknown as Registo,
        ["«paises» não é uma lista"],
      ],
      [
        "«regras» do registo",
        { ...REGISTO_INICIAL, regras: proxyRevogado() } as unknown as Registo,
        ["«regras» não é uma lista"],
      ],
      [
        "um elemento de «paises»",
        {
          ...REGISTO_INICIAL,
          paises: [...REGISTO_INICIAL.paises, proxyRevogado()],
        } as unknown as Registo,
        ["paises[27] não é um objecto"],
      ],
      [
        "um elemento de «regras»",
        { ...REGISTO_INICIAL, regras: [proxyRevogado()] } as unknown as Registo,
        ["regras[0] não é um objecto"],
      ],
      [
        "«territorios» do perfil",
        comPortugal({ territorios: proxyRevogado() }),
        ["PT: «territorios» não é null nem uma lista"],
      ],
      [
        "«dominios» do perfil",
        comPortugal({ dominios: proxyRevogado() }),
        ["PT: «dominios» não é um objecto"],
      ],
      [
        "a revisão de um domínio",
        comPortugal({
          dominios: { ...portugal?.dominios, consumidor: proxyRevogado() },
        }),
        ["PT/consumidor: a revisão não é um objecto"],
      ],
      [
        "a «base» e os «territorios» de regras",
        comPortugal(
          { dominios: { ...portugal?.dominios, consumidor: VERIFICADO } },
          [
            regraTeste({ id: "r", base: proxyRevogado() as Regra["base"] }),
            regraTeste({
              id: "t",
              dominio: "consumidor",
              territorios: proxyRevogado() as string[],
            }),
          ],
        ),
        ["r@1: sem base legal", "t@1: «territorios» não é uma lista"],
      ],
    ];
    // Cada caso com nome, para a falha dizer qual foi (revisão do #50, P2-B).
    for (const [nome, registo, esperado] of casos) {
      let erros: string[] = [];
      expect(() => {
        erros = errosDoRegisto(registo);
      }, nome).not.toThrow();
      expect(erros, nome).toEqual(esperado);
    }
  });

  it("um país ou um domínio que não é texto é recusado, sem rebentar (revisão do #50, P2-3)", () => {
    const naoTexto: [unknown, string][] = [
      [Symbol("pt"), "Symbol(pt)"],
      [Object.create(null), "(objecto)"],
      [
        {
          toString() {
            throw new Error("toString");
          },
        },
        "(objecto)",
      ],
      [["PT"], "(lista)"],
      // Um Proxy revogado lança no Array.isArray (revisão do #50, P2-B).
      [proxyRevogado(), "(objecto)"],
    ];
    for (const [mau, mostrado] of naoTexto) {
      expect(
        decidir(REGISTO_INICIAL, {
          pais: mau,
          dominios: ["consumidor"],
          momento: AGORA,
        } as unknown as PedidoDecisao),
      ).toMatchObject({
        estado: "recusado",
        motivos: [{ codigo: "codigo_pais_invalido", pais: mostrado }],
      });
      expect(
        decidir(REGISTO_INICIAL, {
          pais: "PT",
          dominios: [mau],
          momento: AGORA,
        } as unknown as PedidoDecisao),
      ).toMatchObject({
        estado: "recusado",
        motivos: [{ codigo: "dominio_desconhecido", dominio: mostrado }],
      });
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
      // O momento lê-se com o mesmo instante.ts das regras (revisão do #50,
      // P2-2).
      "2026-10-04T12:00:00-00:00",
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

  it("chaves do protótipo não são domínios (revisão do #40, P2-2)", () => {
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
  });

  it("domínios que não são uma lista são recusados, não rebentam (revisão do #40, P2-2)", () => {
    for (const dominios of [null, undefined, "consumidor", { 0: "iva" }]) {
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

  it("um estado legal que não existe nunca conta (revisão do #47, P1)", () => {
    for (const estadoLegal of ["em_vigorr", undefined]) {
      // Um registo que não passou pelo validar, com uma gralha na regra.
      const registo = registoComPortugal([
        {
          ...regraTeste({ id: "pt-consumidor-1" }),
          estadoLegal,
        } as unknown as Regra,
      ]);
      expect(
        decidir(registo, {
          pais: "PT",
          dominios: ["consumidor"],
          momento: AGORA,
        }),
      ).toEqual({
        estado: "revisao_necessaria",
        regrasAplicadas: [],
        versaoRegisto: 2,
        motivos: [{ codigo: "sem_regra_em_vigor", dominio: "consumidor" }],
      });
    }
  });

  it("um estado de revisão que não existe bloqueia, mesmo com regra em vigor (revisão do #40, P1-1)", () => {
    const base = registoComPortugal([regraTeste({ id: "pt-consumidor-1" })]);
    // Um registo que não passou pelo validar, com uma gralha no estado.
    const comGralha = {
      ...base,
      paises: base.paises.map((perfil) =>
        perfil.codigo === "PT"
          ? {
              ...perfil,
              dominios: {
                ...perfil.dominios,
                consumidor: { ...VERIFICADO, estado: "verificadoo" },
              },
            }
          : perfil,
      ),
    } as unknown as Registo;
    expect(
      decidir(comGralha, {
        pais: "PT",
        dominios: ["consumidor"],
        momento: AGORA,
      }),
    ).toEqual({
      estado: "revisao_necessaria",
      regrasAplicadas: [],
      versaoRegisto: 2,
      motivos: [{ codigo: "dominio_por_verificar", dominio: "consumidor" }],
    });
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
    expect(instante("2024-02-29T00:00:00.500Z")).toBe(
      Date.UTC(2024, 1, 29, 0, 0, 0, 500),
    );
    expect(instante("2026-10-04T14:00:00+14:00")).toBe(Date.UTC(2026, 9, 4, 0));
    // Anos 0–99 não passam a 1900+ (revisão do #47, P2 n.º 4).
    expect(instante("0000-02-29T00:00:00Z")).not.toBeNull();
    expect(instante("0100-02-29T00:00:00Z")).toBeNull();
    expect(instante("2026-10-04T12:00:00+23:59")).toBe(
      Date.UTC(2026, 9, 3, 12, 1),
    );
  });

  it("o que não é texto dá null, não rebenta", () => {
    const valores: unknown[] = [123, null, undefined, {}];
    for (const valor of valores) {
      expect(instante(valor as string)).toBeNull();
    }
  });

  it("recusa o resto", () => {
    for (const texto of [
      "",
      "2025-02-29T00:00:00Z",
      "2026-10-04T12:00Z",
      " 2026-10-04T12:00:00Z",
      // O alcance decide-o a expressão, não o motor (revisão do #40, P2-6).
      "2026-10-04T12:00:00+24:00",
      "2026-10-04T12:00:00+00:60",
      "2026-10-04T12:00:00+99:99",
      "2026-10-04T23:59:60Z",
      "2026-10-04T12:00:00.1234Z",
      "2026-10-04T12:00:00+0100",
      // «Fuso desconhecido» na RFC 3339 (revisão do #45, P2-6).
      "2026-10-04T12:00:00-00:00",
      "2026-10-04T12:00:00.500-00:00",
    ]) {
      expect(instante(texto)).toBeNull();
    }
    // Só o -00:00: +00:00 e os fusos negativos continuam a valer.
    expect(instante("2026-10-04T12:00:00+00:00")).toBe(
      Date.UTC(2026, 9, 4, 12),
    );
    expect(instante("2026-10-04T12:00:00-00:30")).toBe(
      Date.UTC(2026, 9, 4, 12, 30),
    );
  });
});

describe("validar o registo", () => {
  it("a mesma id em dois domínios ou dois países é erro, propostas incluídas (revisão do #45, P2-4)", () => {
    const base = registoComPortugal([
      regraTeste({ id: "r", aplicaAte: "2026-01-01T00:00:00Z" }),
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
        estadoLegal: "proposta",
        pais: "ES",
        aplicaDesde: "2027-01-01T00:00:00Z",
      }),
      // Versões no mesmo país e domínio continuam a poder partilhar a id.
      regraTeste({ id: "t", aplicaAte: "2026-01-01T00:00:00Z" }),
      regraTeste({ id: "t", versao: 2, aplicaDesde: "2026-01-01T00:00:00Z" }),
    ]);
    // O consumidor de ES verificado aqui, para o teste não depender do
    // registo de partida (revisão do #50, P2-3).
    const registo: Registo = {
      ...base,
      paises: base.paises.map((perfil) =>
        perfil.codigo === "PT"
          ? { ...perfil, dominios: { ...perfil.dominios, iva: VERIFICADO } }
          : perfil.codigo === "ES"
            ? {
                ...perfil,
                dominios: { ...perfil.dominios, consumidor: VERIFICADO },
              }
            : perfil,
      ),
    };
    expect(errosDoRegisto(registo)).toEqual([
      "r: a mesma id em PT/consumidor e PT/iva",
      "s: a mesma id em PT/consumidor e ES/consumidor",
    ]);
  });

  it("uma id fora do formato é erro, sem erros por arrasto (revisão do #50, P2-1 e P2-A)", () => {
    const base = registoComPortugal([
      regraTeste({ id: "r", aplicaAte: "2026-01-01T00:00:00Z" }),
      regraTeste({
        id: "r ",
        versao: 2,
        dominio: "iva",
        aplicaDesde: "2026-01-01T00:00:00Z",
      }),
      regraTeste({ id: "R", versao: 3, aplicaDesde: "2026-01-01T00:00:00Z" }),
      regraTeste({ id: "a b", dominio: "iva" }),
      regraTeste({ id: "a  b", dominio: "iva" }),
      regraTeste({ id: "ı", dominio: "iva" }),
      regraTeste({ id: "-x", dominio: "iva" }),
      // Um espaço invisível vê-se na mensagem; repetida, a mesma id fora do
      // formato diz-se uma vez (revisão do #50, P2-1 e P2-2).
      regraTeste({ id: "r\u200b", dominio: "iva" }),
      regraTeste({ id: "r\u200b", dominio: "iva" }),
      regraTeste({ id: "r\u200b", versao: 2, dominio: "iva" }),
      // Aspas, barras, controlo, DEL e um par substituto saem escapados e sem
      // ambiguidade (revisão do #50, P2-A).
      regraTeste({ id: 'a"b', dominio: "iva" }),
      regraTeste({ id: "a\\u0041", dominio: "iva" }),
      regraTeste({ id: "a\nb", dominio: "iva" }),
      regraTeste({ id: "a\u007f", dominio: "iva" }),
      regraTeste({ id: "\u{1F600}", dominio: "iva" }),
      // Dentro do formato: pontos, sublinhados e hífenes, sem erro.
      regraTeste({ id: "pt.iva_2026-1", dominio: "iva" }),
    ]);
    const registo: Registo = {
      ...base,
      paises: base.paises.map((perfil) =>
        perfil.codigo === "PT"
          ? { ...perfil, dominios: { ...perfil.dominios, iva: VERIFICADO } }
          : perfil,
      ),
    };
    const formato = "id fora do formato (a-z, 0-9, «.», «_», «-»)";
    expect(errosDoRegisto(registo)).toEqual([
      `"r "@2: ${formato}`,
      `"R"@3: ${formato}`,
      `"a b"@1: ${formato}`,
      `"a  b"@1: ${formato}`,
      `"\\u0131"@1: ${formato}`,
      `"-x"@1: ${formato}`,
      `"r\\u200b"@1: ${formato}`,
      '"r\\u200b"@1: repetida',
      `"a\\"b"@1: ${formato}`,
      `"a\\\\u0041"@1: ${formato}`,
      `"a\\nb"@1: ${formato}`,
      `"a\\u007f"@1: ${formato}`,
      `"\\ud83d\\ude00"@1: ${formato}`,
    ]);
  });

  it("uma data de verificação com -00:00 é inválida (revisão do #50, P2-2)", () => {
    const registo = {
      ...REGISTO_INICIAL,
      paises: REGISTO_INICIAL.paises.map((perfil) =>
        perfil.codigo === "PT"
          ? {
              ...perfil,
              dominios: {
                ...perfil.dominios,
                consumidor: {
                  ...VERIFICADO,
                  verificadoEm: "2026-10-04T00:00:00-00:00",
                },
              },
            }
          : perfil,
      ),
    };
    expect(errosDoRegisto(registo)).toEqual([
      "PT/consumidor: data de verificação inválida «2026-10-04T00:00:00-00:00»",
    ]);
  });

  it("um valor que não vem de JSON, em qualquer campo, fica listado e não rebenta (revisão do #50, P2-A)", () => {
    const maus: unknown[] = [
      Symbol("s"),
      Object.create(null),
      {
        toString() {
          throw new Error("toString");
        },
      },
      5n,
    ];
    const campos = [
      "id",
      "versao",
      "estadoLegal",
      "aplicaDesde",
      "aplicaAte",
      "verificadaEm",
      "pais",
      "dominio",
    ] as const;
    for (const mau of maus) {
      const casos: Registo[] = [
        ...campos.map((campo) =>
          registoComPortugal([regraTeste({ id: "r", [campo]: mau })]),
        ),
        registoComPortugal([
          regraTeste({ id: "r", territorios: [mau] as unknown as string[] }),
        ]),
        {
          ...REGISTO_INICIAL,
          versao: mau as number,
          paises: REGISTO_INICIAL.paises.map((perfil) =>
            perfil.codigo === "PT"
              ? ({
                  ...perfil,
                  codigo: mau,
                  dominios: {
                    ...perfil.dominios,
                    consumidor: { ...VERIFICADO, verificadoEm: mau },
                  },
                } as unknown as PerfilPais)
              : perfil,
          ),
        },
      ];
      for (const registo of casos) {
        let erros: string[] = [];
        expect(() => {
          erros = errosDoRegisto(registo);
        }).not.toThrow();
        expect(erros.length).toBeGreaterThan(0);
      }
    }
  });

  it("um valor que não vem de JSON aparece pelo texto ou pelo tipo, nas mensagens todas (revisão do #50, P2-2)", () => {
    // O texto de cada tipo, num campo.
    const comAplicaDesde = (mau: unknown) =>
      errosDoRegisto(
        registoComPortugal([
          regraTeste({ id: "r", aplicaDesde: mau as string }),
        ]),
      );
    expect(comAplicaDesde(Symbol("s"))).toEqual([
      "r@1: aplicaDesde inválido «Symbol(s)»",
    ]);
    expect(comAplicaDesde(Object.create(null))).toEqual([
      "r@1: aplicaDesde inválido «(objecto)»",
    ]);
    expect(
      comAplicaDesde({
        toString() {
          throw new Error("toString");
        },
      }),
    ).toEqual(["r@1: aplicaDesde inválido «(objecto)»"]);
    expect(comAplicaDesde(5n)).toEqual(["r@1: aplicaDesde inválido «5»"]);
    expect(comAplicaDesde(["x"])).toEqual([
      "r@1: aplicaDesde inválido «(lista)»",
    ]);
    // Uma função mostra o tipo, não o código-fonte (revisão do #50, P2-A).
    expect(comAplicaDesde(() => 1)).toEqual([
      "r@1: aplicaDesde inválido «(função)»",
    ]);

    // As mensagens do perfil, com um código que não é texto.
    const s = Symbol("pt");
    const portugal = REGISTO_INICIAL.paises.find((p) => p.codigo === "PT");
    const dominiosSemIva = Object.fromEntries(
      Object.entries(portugal?.dominios ?? {}).filter(([d]) => d !== "iva"),
    );
    const comPortugal = (alterado: object, regras: unknown[] = []) =>
      ({
        ...REGISTO_INICIAL,
        regras,
        paises: REGISTO_INICIAL.paises.map((perfil) =>
          perfil.codigo === "PT" ? { ...perfil, ...alterado } : perfil,
        ),
      }) as unknown as Registo;
    expect(
      errosDoRegisto(
        comPortugal({
          codigo: s,
          nome: "",
          territorios: "x",
          dominios: {
            ...dominiosSemIva,
            consumidor: { estado: Object.create(null) as unknown },
            extra: { estado: "por_verificar" },
          },
        }),
      ),
    ).toEqual([
      "país PT aparece 0 vezes",
      "país Symbol(pt) não é um dos 27",
      "Symbol(pt): sem nome",
      "Symbol(pt): «territorios» não é null nem uma lista",
      "Symbol(pt): falta o domínio iva",
      "Symbol(pt): domínio desconhecido extra",
      "Symbol(pt)/consumidor: estado de revisão desconhecido «(objecto)»",
    ]);

    // Uma regra com país estranho igual ao código do perfil, num território
    // que não existe, e duas versões com versão estranha.
    expect(
      errosDoRegisto(
        comPortugal({ codigo: s }, [
          regraTeste({
            id: "r",
            pais: s as unknown as Regra["pais"],
            territorios: ["T-1"],
          }),
          regraTeste({ id: "v", versao: Symbol("v1") as unknown as number }),
          regraTeste({ id: "v", versao: Symbol("v2") as unknown as number }),
        ]),
      ),
    ).toEqual([
      "país PT aparece 0 vezes",
      "país Symbol(pt) não é um dos 27",
      "r@1: o domínio consumidor de Symbol(pt) não está verificado",
      "r@1: território T-1 não mapeado em Symbol(pt)",
      "v@Symbol(v1): versão inválida",
      "v@Symbol(v1): país PT sem perfil",
      "v@Symbol(v2): versão inválida",
      "v@Symbol(v2): país PT sem perfil",
      "v: as versões Symbol(v1) e Symbol(v2) valem ao mesmo tempo",
    ]);

    // A excepção do arranque diz a versão estranha sem rebentar.
    expect(() => {
      assegurarRegistoValido({
        ...REGISTO_INICIAL,
        versao: Object.create(null) as number,
      });
    }).toThrow("Registo de regras inválido (versão (objecto))");
  });

  it("um domínio que não é texto é desconhecido, mesmo que se converta num (revisão do #50, P2-1)", () => {
    for (const dominio of [
      ["consumidor"],
      { toString: () => "consumidor" },
    ] as unknown as Regra["dominio"][]) {
      const tipoDoDominio = Array.isArray(dominio) ? "(lista)" : "(objecto)";
      expect(
        errosDoRegisto(registoComPortugal([regraTeste({ id: "r", dominio })])),
      ).toEqual([`r@1: domínio desconhecido ${tipoDoDominio}`]);
    }
  });

  it("regras sem id dão só o erro «sem id», sem erros por arrasto", () => {
    const base = registoComPortugal([
      regraTeste({ id: "" }),
      // A mesma id vazia repetida: «repetida» e «sem id» (revisão do #50).
      regraTeste({ id: "" }),
      regraTeste({ id: "", versao: 2, dominio: "iva" }),
      // Só espaços que não se vêem: a mensagem mostra-os (revisão do #50,
      // P2-B).
      regraTeste({ id: "\u00a0\u00a0", versao: 3, dominio: "iva" }),
      // Uma id que não é texto mostra o tipo: o número 5 não se confunde com
      // a id "5", e um Symbol não rebenta a lista (revisão do #50).
      regraTeste({ id: 5 as unknown as string }),
      regraTeste({ id: "5", dominio: "iva" }),
      regraTeste({ id: null as unknown as string }),
      regraTeste({ id: Symbol("s") as unknown as string }),
      // As outras formas que não são texto, cada uma pelo seu tipo (revisão
      // do #50, P2-A); um Proxy revogado também não rebenta (P2-B).
      regraTeste({ id: true as unknown as string }),
      regraTeste({ id: 5n as unknown as string }),
      regraTeste({ id: (() => 1) as unknown as string }),
      regraTeste({ id: {} as unknown as string }),
      regraTeste({ id: [] as unknown as string }),
      regraTeste({ id: undefined as unknown as string }),
      regraTeste({ id: proxyRevogado() as unknown as string, versao: 2 }),
    ]);
    const registo: Registo = {
      ...base,
      paises: base.paises.map((perfil) =>
        perfil.codigo === "PT"
          ? { ...perfil, dominios: { ...perfil.dominios, iva: VERIFICADO } }
          : perfil,
      ),
    };
    expect(errosDoRegisto(registo)).toEqual([
      '""@1: sem id',
      '""@1: repetida',
      '""@1: sem id',
      '""@2: sem id',
      '"\\u00a0\\u00a0"@3: sem id',
      "(número: 5)@1: sem id",
      "(nulo)@1: sem id",
      "(símbolo: Symbol(s))@1: sem id",
      "(booleano: true)@1: sem id",
      "(bigint: 5)@1: sem id",
      "(função)@1: sem id",
      "(objecto)@1: sem id",
      "(lista)@1: sem id",
      "(indefinido)@1: sem id",
      "(objecto)@2: sem id",
    ]);
  });

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

  it("um país em falta ou a mais é erro", () => {
    const semPortugal: Registo = {
      ...REGISTO_INICIAL,
      paises: REGISTO_INICIAL.paises.filter((p) => p.codigo !== "PT"),
    };
    expect(errosDoRegisto(semPortugal)).toContain("país PT aparece 0 vezes");
  });

  it("um estado de revisão desconhecido é erro, mesmo sem regras (revisão do #40, P1-1)", () => {
    const registo = {
      ...REGISTO_INICIAL,
      paises: REGISTO_INICIAL.paises.map((perfil) =>
        perfil.codigo === "PT"
          ? {
              ...perfil,
              dominios: {
                ...perfil.dominios,
                iva: { ...VERIFICADO, estado: "verificadoo" },
              },
            }
          : perfil,
      ),
    } as unknown as Registo;
    expect(errosDoRegisto(registo)).toEqual([
      "PT/iva: estado de revisão desconhecido «verificadoo»",
    ]);
  });

  it("uma regra de domínio desconhecido é listada, não rebenta (revisão do #40, P2-1)", () => {
    const registo = registoComPortugal([
      regraTeste({ id: "x", dominio: "inexistente" as never }),
      regraTeste({ id: "y", aplicaDesde: "lixo" }),
    ]);
    expect(errosDoRegisto(registo)).toEqual(
      expect.arrayContaining([
        "x@1: domínio desconhecido inexistente",
        "y@1: aplicaDesde inválido «lixo»",
      ]),
    );
  });

  it("listas que não são listas são erro, não excepção (revisão do #40, P2-1)", () => {
    const registo = {
      versao: 1,
      paises: null,
      regras: null,
    } as unknown as Registo;
    expect(errosDoRegisto(registo)).toEqual([
      "«paises» não é uma lista",
      "«regras» não é uma lista",
    ]);
  });

  it("elementos que não são objectos são listados, não rebentam (revisão do #47, P2 n.º 1)", () => {
    const base = registoComPortugal([
      regraTeste({ id: "a", aplicaDesde: "lixo" }),
    ]);
    const registo = {
      ...base,
      paises: [
        ...base.paises.map((perfil) =>
          perfil.codigo === "PT"
            ? {
                ...perfil,
                dominios: { ...perfil.dominios, iva: null },
              }
            : perfil,
        ),
        null,
      ],
      regras: [...base.regras, null],
    } as unknown as Registo;
    expect(errosDoRegisto(registo)).toEqual([
      "paises[27] não é um objecto",
      "regras[1] não é um objecto",
      "PT/iva: a revisão não é um objecto",
      "a@1: aplicaDesde inválido «lixo»",
    ]);
  });

  it("uma proposta pode viver ao lado da versão em vigor (revisão do #40, P2-3)", () => {
    const registo = registoComPortugal([
      regraTeste({ id: "x", versao: 1 }),
      regraTeste({
        id: "x",
        versao: 2,
        estadoLegal: "proposta",
        aplicaDesde: "2027-01-01T00:00:00Z",
      }),
    ]);
    expect(errosDoRegisto(registo)).toEqual([]);
  });

  it("em vigor sem fim e adoptada futura da mesma regra é erro", () => {
    const registo = registoComPortugal([
      regraTeste({ id: "x", versao: 1 }),
      regraTeste({
        id: "x",
        versao: 2,
        estadoLegal: "adoptada_futura",
        aplicaDesde: "2027-01-01T00:00:00Z",
      }),
    ]);
    expect(errosDoRegisto(registo)).toEqual([
      "x: as versões 1 e 2 valem ao mesmo tempo",
    ]);
  });

  it("prova vazia, id vazia e versão inválida são erro (revisão do #40, P2-5)", () => {
    const registo = registoComPortugal([
      regraTeste({
        id: "a",
        base: { url: "", titulo: " ", artigo: "" },
        revistaPor: "",
      }),
      regraTeste({ id: "", versao: 3 }),
      regraTeste({ id: "b", versao: 0 }),
      regraTeste({ id: "c", versao: 1.5 }),
    ]);
    expect(errosDoRegisto(registo)).toEqual(
      expect.arrayContaining([
        "a@1: base sem url",
        "a@1: base sem título",
        "a@1: base sem artigo",
        "a@1: sem revistaPor",
        '""@3: sem id',
        "b@0: versão inválida",
        "c@1.5: versão inválida",
      ]),
    );
  });

  it("um domínio verificado sem revistoPor é erro (revisão do #40, P2-5)", () => {
    const base = registoComPortugal([]);
    const registo: Registo = {
      ...base,
      paises: base.paises.map((perfil) =>
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
    expect(errosDoRegisto(registo)).toEqual(["PT/consumidor: sem revistoPor"]);
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

describe("GET /paises e o esquema (revisão do #40, P2-4)", () => {
  it("quem trava um código fora dos 27 é o validar, ao arrancar", () => {
    const comXX: Registo = {
      ...REGISTO_INICIAL,
      paises: REGISTO_INICIAL.paises.map((perfil) =>
        perfil.codigo === "AT"
          ? ({ ...perfil, codigo: "XX" } as unknown as PerfilPais)
          : perfil,
      ),
    };
    expect(() => criarApp({}, comXX)).toThrow(/país XX não é um dos 27/);
  });

  it("a resposta real cumpre o esquema publicado", async () => {
    const app = criarApp();
    try {
      const resposta = await app.inject({ method: "GET", url: "/paises" });
      expect(Value.Check(RespostaPaises, resposta.json())).toBe(true);
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
    for (const pais of corpo.paises) {
      expect(Object.keys(pais.dominios)).toHaveLength(11);
      expect(pais.territoriosMapeados).toBe(false);
      expect(new Set(Object.values(pais.dominios))).toEqual(
        new Set(["por_verificar"]),
      );
    }
  });
});
