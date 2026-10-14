import { describe, expect, it } from "vitest";
import { ErroHub, type EtiquetaDevolucao } from "../src/api";
import {
  accoesDaEtiqueta,
  erroDaDevolucao,
  estadoDoFiltro,
  INCERTA_IDADE_MINIMA_MS,
  MAX_TENTATIVAS,
} from "../src/devolucoes";
import { ErroDoEcra } from "../src/erros";

// As devoluções no Hub (docs/36 §22.10): o que se oferece na etiqueta vem
// do estado que a API dá, e só quem tem returns:write pede ou anula.

const AGORA = Date.parse("2026-10-14T10:00:00Z");

function etiqueta(
  estado: EtiquetaDevolucao["estado"],
  extra: Partial<EtiquetaDevolucao> = {},
): EtiquetaDevolucao {
  return {
    devolucao: "rma_1",
    estado,
    tentativa: 1,
    conta: "cac_1",
    transportadora: "sendcloud",
    servico: "sendcloud:letter",
    peso_g: 300,
    motivo: null,
    seguimento: estado === "emitida" ? "3SABC" : null,
    url_seguimento: null,
    em: new Date(AGORA - 60 * 60 * 1000).toISOString(),
    ficheiro: estado === "emitida" ? "pdf" : null,
    ...extra,
  };
}

describe("a etiqueta de uma devolução", () => {
  it("pede-se numa devolução à espera sem etiqueta, ou com a anterior recusada ou anulada", () => {
    expect(accoesDaEtiqueta("a_aguardar", null, true, AGORA).pedir).toBe(true);
    for (const e of ["recusada", "anulada"] as const) {
      expect(
        accoesDaEtiqueta("a_aguardar", etiqueta(e), true, AGORA).pedir,
        e,
      ).toBe(true);
    }
  });

  it("não se pede com uma viva ou incerta, fora de «à espera», sem returns:write nem depois de 10 tentativas", () => {
    for (const e of ["a_pedir", "emitida", "incerta"] as const) {
      expect(
        accoesDaEtiqueta("a_aguardar", etiqueta(e), true, AGORA).pedir,
        e,
      ).toBe(false);
    }
    expect(accoesDaEtiqueta("recebida", null, true, AGORA).pedir).toBe(false);
    expect(accoesDaEtiqueta("a_aguardar", null, false, AGORA).pedir).toBe(
      false,
    );
    expect(
      accoesDaEtiqueta(
        "a_aguardar",
        etiqueta("anulada", { tentativa: MAX_TENTATIVAS }),
        true,
        AGORA,
      ).pedir,
    ).toBe(false);
  });

  it("anula-se a emitida e a incerta; a incerta recente diz a partir de quando", () => {
    expect(
      accoesDaEtiqueta("a_aguardar", etiqueta("emitida"), true, AGORA),
    ).toMatchObject({ anular: true, anularAPartirDe: null, descarregar: true });
    expect(
      accoesDaEtiqueta("a_aguardar", etiqueta("incerta"), true, AGORA)
        .anularAPartirDe,
    ).toBeNull();
    const recente = etiqueta("incerta", {
      em: new Date(AGORA - 60_000).toISOString(),
    });
    expect(
      accoesDaEtiqueta("a_aguardar", recente, true, AGORA).anularAPartirDe,
    ).toEqual(new Date(AGORA - 60_000 + INCERTA_IDADE_MINIMA_MS));
    for (const e of ["a_pedir", "recusada", "anulada"] as const) {
      expect(
        accoesDaEtiqueta("a_aguardar", etiqueta(e), true, AGORA).anular,
        e,
      ).toBe(false);
    }
  });

  it("sem returns:write, só se descarrega", () => {
    expect(
      accoesDaEtiqueta("a_aguardar", etiqueta("emitida"), false, AGORA),
    ).toEqual({
      pedir: false,
      anular: false,
      anularAPartirDe: null,
      descarregar: true,
    });
  });
});

describe("o ecrã das devoluções", () => {
  it("o filtro do endereço só aceita um estado", () => {
    expect(estadoDoFiltro("fechada")).toBe("fechada");
    expect(estadoDoFiltro("tudo")).toBeNull();
    expect(estadoDoFiltro(null)).toBeNull();
  });

  it("os erros da etiqueta têm o texto da devolução, não o da expedição", () => {
    const erro = (codigo: string) =>
      new ErroHub(409, codigo, { pt: "x" }, undefined, undefined);
    const chave = (codigo: string) => {
      const e = erroDaDevolucao(erro(codigo));
      return e instanceof ErroDoEcra ? e.chave : null;
    };
    expect(chave("shipping.label_uncertain")).toBe(
      "etiquetaDevolucaoIncertaPrimeiro",
    );
    expect(chave("shipping.void_not_allowed")).toBe(
      "etiquetaDevolucaoNaoAnulaAinda",
    );
    expect(chave("returns.not_found")).toBe("devolucaoNaoExiste");
    // Os outros, como em «Expedir».
    expect(chave("shipping.account_not_ready")).toBe("etiquetaContaNaoPronta");
  });
});
