import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  aplicarTema,
  guardarTema,
  lerTema,
  temaGuardado,
  TEMAS,
} from "../src/tema";

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

// O que se guarda no navegador (revisão do #227, P2-1): só «claro» ou
// «escuro»; «automático» apaga; sem armazenamento, nada rebenta.
describe("o tema guardado no navegador", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function armazenamento() {
    const m = new Map<string, string>();
    const local = {
      getItem: vi.fn((k: string) => m.get(k) ?? null),
      setItem: vi.fn((k: string, v: string) => {
        m.set(k, v);
      }),
      removeItem: vi.fn((k: string) => {
        m.delete(k);
      }),
    };
    vi.stubGlobal("localStorage", local);
    return { m, local };
  }

  it("claro e escuro guardam-se e lêem-se; automático apaga a chave", () => {
    const { m, local } = armazenamento();
    guardarTema("escuro");
    expect([...m.entries()]).toEqual([["eurolify-hub-tema", "escuro"]]);
    expect(temaGuardado()).toBe("escuro");
    guardarTema("claro");
    expect(temaGuardado()).toBe("claro");
    guardarTema("automatico");
    expect(m.size).toBe(0);
    expect(local.removeItem).toHaveBeenCalledWith("eurolify-hub-tema");
    expect(local.setItem).not.toHaveBeenCalledWith(
      "eurolify-hub-tema",
      "automatico",
    );
    expect(temaGuardado()).toBe("automatico");
  });

  it("um valor estranho guardado lê-se como automático", () => {
    const { m } = armazenamento();
    m.set("eurolify-hub-tema", "roxo");
    expect(temaGuardado()).toBe("automatico");
  });

  it("sem armazenamento (navegação privada), automático e sem erro", () => {
    const falha = () => {
      throw new Error("sem armazenamento");
    };
    vi.stubGlobal("localStorage", {
      getItem: falha,
      setItem: falha,
      removeItem: falha,
    });
    expect(temaGuardado()).toBe("automatico");
    expect(() => {
      guardarTema("escuro");
    }).not.toThrow();
    expect(() => {
      guardarTema("automatico");
    }).not.toThrow();
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

  // Só a forma das regras (o comportamento mede-se no capturas.mjs): há
  // exactamente dois blocos escuros, um dentro do @media e excluído por
  // «Tema claro», o outro só com «Tema escuro» (revisão do #227, P2-2).
  it("só há dois blocos escuros e o do aparelho cede a «Tema claro»", () => {
    const semComentarios = css.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(
      /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root:not\(\[data-tema="claro"\]\)\s*\{/.test(
        semComentarios,
      ),
    ).toBe(true);
    expect(semComentarios.match(/prefers-color-scheme/g)?.length).toBe(1);
    expect(
      semComentarios.match(/--superficie:\s*var\(--cinzento-950\)/g)?.length,
    ).toBe(2);
  });
});
