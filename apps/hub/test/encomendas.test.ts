import { describe, expect, it } from "vitest";
import type { TransicaoDaEncomenda } from "../src/api";
import {
  contactoDe,
  contagemDaLista,
  dataLimiteDe,
  emCentimos,
  enderecoEncomenda,
  enderecoEncomendas,
  ESTADOS_ENCOMENDA,
  estadoDoFiltro,
  ivaDaLinha,
  moradaDe,
  nomeDoMetodo,
  perfilDe,
  quemFez,
  taxaEmTexto,
  TEXTO_DO_DOCUMENTO,
  TEXTO_DO_EMISSOR,
  textoDoEstado,
  totalDosPortes,
} from "../src/encomendas";
import { TEXTOS } from "../src/textos";

// As encomendas no Hub (docs/22 §35): o Hub lê o que a API decidiu e nunca
// o recalcula; o que não percebe, não inventa.

describe("os estados e o filtro", () => {
  it("todos os estados da API têm texto nas três línguas", () => {
    for (const l of ["pt", "es", "en"] as const) {
      for (const e of ESTADOS_ENCOMENDA) {
        const k = `encomendaEstado_${e}` as keyof typeof TEXTOS.pt;
        expect(TEXTOS[l][k], `${l} ${e}`).not.toBe("");
        expect(textoDoEstado(TEXTOS[l], e)).toBe(TEXTOS[l][k]);
      }
    }
  });

  it("os estados são os onze da API, sem repetidos", () => {
    expect(new Set(ESTADOS_ENCOMENDA).size).toBe(11);
  });

  it("um estado que o Hub não conhece sai como a API o deu", () => {
    expect(textoDoEstado(TEXTOS.pt, "inventado")).toBe("inventado");
  });

  it("o filtro só aceita um estado conhecido", () => {
    expect(estadoDoFiltro("paga")).toBe("paga");
    expect(estadoDoFiltro("inventado")).toBeNull();
    expect(estadoDoFiltro(null)).toBeNull();
    expect(estadoDoFiltro("")).toBeNull();
  });

  it("os estados dos documentos e dos emissores têm texto", () => {
    for (const k of [
      ...Object.values(TEXTO_DO_DOCUMENTO),
      ...Object.values(TEXTO_DO_EMISSOR),
    ]) {
      for (const l of ["pt", "es", "en"] as const) {
        expect(TEXTOS[l][k], `${l} ${k}`).not.toBe("");
      }
    }
  });
});

describe("os endereços", () => {
  it("levam sempre o comerciante, codificado", () => {
    expect(enderecoEncomendas("mer_a&b")).toBe(
      "/encomendas?comerciante=mer_a%26b",
    );
    expect(enderecoEncomendas("mer_1", "paga")).toBe(
      "/encomendas?comerciante=mer_1&estado=paga",
    );
    expect(enderecoEncomenda("mer_1", "ord_2")).toBe(
      "/encomendas/ord_2?comerciante=mer_1",
    );
  });
});

describe("a contagem da lista", () => {
  it("vazia, uma, várias, ou as mais recentes no limite — nunca corta em silêncio", () => {
    expect(contagemDaLista(0, 100, false)).toBe("encomendasVazio");
    expect(contagemDaLista(0, 100, true)).toBe("encomendasVazioNoFiltro");
    expect(contagemDaLista(1, 100, false)).toBe("encomendasContagemUm");
    expect(contagemDaLista(5, 100, false)).toBe("encomendasContagem");
    expect(contagemDaLista(100, 100, false)).toBe("encomendasContagemMaximo");
  });
});

describe("os valores", () => {
  it("a API dá cêntimos: 2959 são 29,59 €", () => {
    expect(emCentimos(2959, "EUR", "pt-PT").replace(/\s/g, " ")).toBe(
      "29,59 €",
    );
  });

  it("uma moeda desconhecida mostra o número e o código", () => {
    expect(emCentimos(1000, "XXXX", "pt-PT")).toBe("10.00 XXXX");
  });

  it("a taxa vem em centésimas de ponto: 2300 são 23 %", () => {
    expect(taxaEmTexto(2300, "pt-PT")).toBe("23");
    expect(taxaEmTexto(550, "pt-PT")).toBe("5,5");
  });
});

describe("a decisão de IVA lida, nunca refeita", () => {
  it("tributada com a taxa do servidor", () => {
    expect(ivaDaLinha({ resultado: "tributada", taxa: 2300 })).toEqual({
      tipo: "tributada",
      taxa: 2300,
    });
  });
  it("isenta e bloqueada", () => {
    expect(ivaDaLinha({ resultado: "isenta", taxa: 0 })).toEqual({
      tipo: "isenta",
    });
    expect(ivaDaLinha({ resultado: "bloqueada" })).toEqual({
      tipo: "bloqueada",
    });
  });
  it("o que não se percebe não se inventa: fica «desconhecida»", () => {
    for (const x of [
      null,
      "x",
      [],
      {},
      { resultado: "tributada" },
      { resultado: "tributada", taxa: "23" },
      { resultado: "outra" },
    ]) {
      expect(ivaDaLinha(x), JSON.stringify(x)).toEqual({
        tipo: "desconhecida",
      });
    }
  });
});

describe("as cópias guardadas na encomenda", () => {
  it("a morada, com ponto de recolha", () => {
    expect(
      moradaDe({
        pais: "PT",
        codigo_postal: "1000-001",
        linha1: "Rua A 1",
        linha2: null,
        localidade: "Lisboa",
        ponto: { id: "pnt_1", nome: "Loja X" },
      }),
    ).toEqual({
      ponto: "Loja X",
      linhas: ["Rua A 1", "1000-001 Lisboa", "PT"],
    });
    expect(moradaDe(null)).toBeNull();
    expect(moradaDe("x")).toBeNull();
    expect(moradaDe({})).toBeNull();
  });

  it("o contacto e o perfil só com o que vem", () => {
    expect(
      contactoDe({ nome: "Rui", email: "r@x.pt", telefone: null }),
    ).toEqual({ nome: "Rui", email: "r@x.pt", telefone: null });
    expect(contactoDe({})).toBeNull();
    expect(perfilDe({ nome_documento: "Rui Lda", nif: "999999990" })).toEqual({
      nome: "Rui Lda",
      nif: "999999990",
    });
    expect(perfilDe(null)).toBeNull();
  });

  it("o método de entrega na língua pedida, com a de reserva; a data-limite só em AAAA-MM-DD", () => {
    const m = {
      nome: { pt: "Correio", en: "Mail" },
      data_limite: "2026-10-20",
    };
    expect(nomeDoMetodo(m, "en")).toBe("Mail");
    expect(nomeDoMetodo(m, "es")).toBe("Correio");
    expect(nomeDoMetodo({ nome: "Simples" }, "pt")).toBe("Simples");
    expect(nomeDoMetodo(null, "pt")).toBeNull();
    expect(dataLimiteDe(m)).toBe("2026-10-20");
    expect(dataLimiteDe({ data_limite: "amanhã" })).toBeNull();
  });

  it("os portes são o total que a API copiou", () => {
    expect(totalDosPortes({ total: 499 })).toBe(499);
    expect(totalDosPortes({ total: "499" })).toBeNull();
    expect(totalDosPortes(null)).toBeNull();
  });
});

describe("quem mudou o estado", () => {
  const t = (
    quem: string,
    tipo: TransicaoDaEncomenda["tipo_de_autor"],
  ): TransicaoDaEncomenda => ({
    de: null,
    para: "paga",
    quem,
    em: "2026-10-16T10:00:00Z",
    motivo: null,
    tipo_de_autor: tipo,
  });
  it("uma pessoa vai pelo identificador; uma chave nunca mostra o identificador", () => {
    expect(quemFez(t("pessoa:per_abc", "pessoa"))).toEqual({
      tipo: "pessoa",
      pessoa: "abc",
    });
    expect(quemFez(t("chave:key_secreta", "chave"))).toEqual({
      tipo: "chave",
    });
    expect(quemFez(t("chave:key_secreta", "agente"))).toEqual({
      tipo: "chave",
    });
    expect(quemFez(t("prestador:eupago", "prestador"))).toEqual({
      tipo: "prestador",
    });
    expect(quemFez(t("x", "desconhecido"))).toEqual({ tipo: "desconhecido" });
  });
});
