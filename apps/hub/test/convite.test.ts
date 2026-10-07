import { describe, expect, it } from "vitest";
import { ligacaoDoConvite, segredoDoFragmento } from "../src/convite";

// O segredo do convite vem no fragmento da ligação (docs/22 §2).

const SEGREDO = `euc_${"A".repeat(43)}`;

describe("o segredo do convite", () => {
  it("lê o segredo do fragmento; outro formato não vale", () => {
    expect(segredoDoFragmento(`#${SEGREDO}`)).toBe(SEGREDO);
    expect(segredoDoFragmento("")).toBeNull();
    expect(segredoDoFragmento("#euc_curto")).toBeNull();
    expect(segredoDoFragmento(`#eus_${"A".repeat(43)}`)).toBeNull();
    expect(segredoDoFragmento(`#${SEGREDO}&x=1`)).toBeNull();
    // Mal formado: não rebenta (revisão do #158, P3-1).
    expect(segredoDoFragmento("#%E0")).toBeNull();
  });

  it("a ligação leva o segredo depois do #, que o navegador não envia", () => {
    const l = ligacaoDoConvite("https://hub.exemplo.eu", SEGREDO);
    expect(l).toBe(`https://hub.exemplo.eu/convite#${SEGREDO}`);
    expect(new URL(l).search).toBe("");
    expect(new URL(l).pathname).toBe("/convite");
  });
});
