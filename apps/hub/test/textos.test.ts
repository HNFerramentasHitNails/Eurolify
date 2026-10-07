import { describe, expect, it } from "vitest";
import { preencher, TEXTOS } from "../src/textos";

// As três línguas têm as mesmas chaves e nenhum texto vazio (docs/22 §5).

describe("os textos", () => {
  const chaves = Object.keys(TEXTOS.pt).sort();

  it("ES e EN têm as mesmas chaves do PT", () => {
    expect(Object.keys(TEXTOS.es).sort()).toEqual(chaves);
    expect(Object.keys(TEXTOS.en).sort()).toEqual(chaves);
  });

  it("nenhum texto está vazio e os marcadores {…} são os mesmos nas três línguas", () => {
    const marcadores = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const k of chaves) {
      const pt = TEXTOS.pt[k as keyof typeof TEXTOS.pt];
      for (const l of ["es", "en"] as const) {
        const outro = TEXTOS[l][k as keyof typeof TEXTOS.pt];
        expect(outro.trim(), `${l}.${k}`).not.toBe("");
        expect(marcadores(outro), `${l}.${k}`).toEqual(marcadores(pt));
      }
    }
  });

  it("preencher troca os marcadores e deixa os que não conhece", () => {
    expect(preencher("{n} membros", { n: 3 })).toBe("3 membros");
    expect(preencher("{x}", {})).toBe("{x}");
  });
});
