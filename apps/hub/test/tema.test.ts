import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { aplicarTema, lerTema, TEMAS } from "../src/tema";

// Escolher o tema (docs/22 §4, issue #226).

describe("o tema escolhido", () => {
  it("só aceita os três temas; o resto é «automático»", () => {
    expect(TEMAS).toEqual(["automatico", "claro", "escuro"]);
    expect(lerTema("claro")).toBe("claro");
    expect(lerTema("escuro")).toBe("escuro");
    for (const v of [null, undefined, "", "dark", "ESCURO", 1, {}]) {
      expect(lerTema(v), JSON.stringify(v)).toBe("automatico");
    }
  });

  it("aplicar põe data-tema e color-scheme; automático tira os dois", () => {
    const raiz = { dataset: {} as DOMStringMap, style: { colorScheme: "" } };
    const el = raiz as unknown as HTMLElement;
    aplicarTema("escuro", el);
    expect(raiz.dataset.tema).toBe("escuro");
    expect(raiz.style.colorScheme).toBe("dark");
    aplicarTema("claro", el);
    expect(raiz.dataset.tema).toBe("claro");
    expect(raiz.style.colorScheme).toBe("light");
    aplicarTema("automatico", el);
    expect(raiz.dataset.tema).toBeUndefined();
    expect(raiz.style.colorScheme).toBe("");
  });
});

describe("os tokens do tema escuro", () => {
  const css = readFileSync(
    new URL("../src/tokens.css", import.meta.url),
    "utf8",
  );
  const declaracoes = (bloco: string) =>
    [...bloco.matchAll(/(--[\w-]+):\s*([^;]+);/g)]
      .map((m) => `${m[1] ?? ""}: ${(m[2] ?? "").trim()}`)
      .sort();
  const corpo = (inicio: string) => {
    const i = css.indexOf(inicio);
    if (i < 0) throw new Error(`falta ${inicio}`);
    const abre = css.indexOf("{", i + inicio.length - 1);
    return css.slice(abre + 1, css.indexOf("}", abre));
  };

  it("o bloco do aparelho em escuro e o de «Tema escuro» são iguais", () => {
    const doAparelho = declaracoes(corpo(':root:not([data-tema="claro"]) {'));
    const escolhido = declaracoes(corpo(':root[data-tema="escuro"] {'));
    expect(doAparelho.length).toBeGreaterThan(10);
    expect(escolhido).toEqual(doAparelho);
  });

  it("o escuro do aparelho não se aplica com «Tema claro» escolhido", () => {
    expect(css).toContain(
      '@media (prefers-color-scheme: dark) {\n  :root:not([data-tema="claro"]) {',
    );
  });
});
